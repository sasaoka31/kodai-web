// キャンバス表示: ズーム・パン・レイヤー合成・アートボード・グリッド・オーバーレイ
// 座標系: ワールド座標(ピクセル)→ 画面 CSS px は  screen = o + world * zoom
import { drawDirectOverlay, drawBendOverlay } from './direct.js';
import { state, emit, on, requestRender, isPixelMode } from './state.js';
import { createCanvas, timeline } from './document.js';
import { TILE } from './tiles.js';
import { brushOffset, intersectRect, hasRigBind, celBounds, layerEffects } from './render.js';
import { drawFxPart } from './effects.js';
import { drawShape } from './vector.js';
import { drawObjects, drawPixelated, drawPixelGrad, hasPixelGrad } from './pixelfx.js';
import { draftShape, brushSize } from './tools.js';
import { drawSelectionOverlay } from './select.js';
import { drawGuides, drawRulers, drawMeasure, drawSmart } from './guides.js';
import { drawFontUnderlay, drawFontGuides, fontFitBox } from './fontmode.js';
import { transformHandles } from './transform.js';
import { drawReflectOverlay } from './reflect.js';
import { rigActive, evalPose } from './rig.js';
import { rigContent } from './rigrender.js';
import { drawRigOverlay, restDisplay } from './rigtool.js';

const ZOOM_LEVELS = [0.02, 0.05, 0.1, 0.25, 0.33, 0.5, 0.67, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64];
const MIN_ZOOM = 0.01, MAX_ZOOM = 64;
const OUTSIDE = '#1a1b1f'; // 描画範囲の外
const PASTEBOARD = '#2b2d33'; // 描画範囲内・アートボード外

// フォントが読み込まれたときなど、見た目が変わるのでレイヤーのキャッシュを捨てる
let layerCacheEpoch = 0;
export function clearLayerCache() { layerCacheEpoch++; }
on('fonts', clearLayerCache);
on('doc', clearLayerCache);
document.fonts?.addEventListener?.('loadingdone', () => { clearLayerCache(); requestRender(); });

export class Viewport {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.zoom = 1;
    this.ox = 0; // ワールド原点の画面座標(CSS px)
    this.oy = 0;
    this.w = 1;
    this.h = 1;
    this.dpr = 1;
    this.pending = false;
    this.layerBuf = createCanvas(1, 1);
    this.layerCache = new Map(); // cel → { key, canvas }
    this.onionBuf = createCanvas(1, 1);
    this.tileBuf = createCanvas(TILE, TILE);
    this.checker = this.makeChecker();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
  }

  // 2×2 の市松模様。表示時に「1マス = 整数ピクセル」になるよう拡大してグリッドと揃える
  makeChecker() {
    const c = createCanvas(2, 2);
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, 2, 2);
    x.fillStyle = '#d4d4d8';
    x.fillRect(0, 0, 1, 1);
    x.fillRect(1, 1, 1, 1);
    return this.ctx.createPattern(c, 'repeat');
  }

  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    const first = this.w <= 1;
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    this.layerBuf.width = this.canvas.width;
    this.layerBuf.height = this.canvas.height;
    this.onionBuf.width = this.canvas.width;
    this.onionBuf.height = this.canvas.height;
    if (first && state.doc) this.fit();
    this.render();
  }

  fit() {
    const doc = state.doc;
    if (!doc) return;
    const a = fontFitBox(doc) || doc.artboard; // フォント作成の筆の部品はお手本の字まで入れる
    const pad = 40;
    let z = Math.min((this.w - pad * 2) / a.w, (this.h - pad * 2) / a.h);
    if (doc.mode === 'pixel' && z >= 1) z = Math.floor(z);
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
    this.ox = Math.round((this.w - a.w * this.zoom) / 2 - a.x * this.zoom);
    this.oy = Math.round((this.h - a.h * this.zoom) / 2 - a.y * this.zoom);
    emit('zoom');
    this.requestRender();
  }

  setZoom(z, sx = this.w / 2, sy = this.h / 2) {
    z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
    const wx = (sx - this.ox) / this.zoom;
    const wy = (sy - this.oy) / this.zoom;
    this.zoom = z;
    this.ox = Math.round(sx - wx * z);
    this.oy = Math.round(sy - wy * z);
    emit('zoom');
    this.requestRender();
  }

  zoomStep(dir, sx, sy) {
    const z = this.zoom;
    const next = dir > 0
      ? ZOOM_LEVELS.find((l) => l > z + 1e-6) ?? MAX_ZOOM
      : [...ZOOM_LEVELS].reverse().find((l) => l < z - 1e-6) ?? MIN_ZOOM;
    this.setZoom(next, sx, sy);
  }

  pan(ox, oy) {
    this.ox = Math.round(ox);
    this.oy = Math.round(oy);
    this.requestRender();
  }

  screenToDoc(sx, sy) {
    return { x: (sx - this.ox) / this.zoom, y: (sy - this.oy) / this.zoom };
  }

  toScreen(p) {
    return { x: this.ox + p.x * this.zoom, y: this.oy + p.y * this.zoom };
  }

  // 画面に見えているワールド矩形
  visibleRect() {
    const a = this.screenToDoc(0, 0), b = this.screenToDoc(this.w, this.h);
    return { x0: Math.floor(a.x), y0: Math.floor(a.y), x1: Math.ceil(b.x), y1: Math.ceil(b.y) };
  }

  // ワールド座標 → デバイスピクセル(隣り合うタイルに隙間ができないよう丸める)
  DX(x) { return Math.round((this.ox + x * this.zoom) * this.dpr); }
  DY(y) { return Math.round((this.oy + y * this.zoom) * this.dpr); }

  requestRender() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.render();
    });
  }

  render() {
    const { ctx, canvas } = this;
    const doc = state.doc;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = OUTSIDE;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!doc) return;

    // 描画範囲(ワークスペース)
    const L = doc.limits;
    ctx.fillStyle = PASTEBOARD;
    ctx.fillRect(this.DX(L.x0), this.DY(L.y0), this.DX(L.x1) - this.DX(L.x0), this.DY(L.y1) - this.DY(L.y0));

    // アートボード: 背景色 or 市松模様
    const a = doc.artboard;
    const ax = this.DX(a.x), ay = this.DY(a.y), aw = this.DX(a.x + a.w) - ax, ah = this.DY(a.y + a.h) - ay;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#fff';
    ctx.fillRect(ax, ay, aw, ah);
    ctx.restore();
    if (doc.background) {
      // 半透明の背景色なら下に市松模様を敷く
      this.fillChecker(ax, ay, aw, ah);
      ctx.fillStyle = doc.background;
      ctx.fillRect(ax, ay, aw, ah);
    } else {
      this.fillChecker(ax, ay, aw, ah);
    }

    const vis = this.visibleRect();

    // オニオンスキン: 前のフレームを赤、後のフレームを青で薄く表示
    const on = state.opts.onion;
    if (on.enabled && !state.playing && doc.frames.length > 1) {
      const n = doc.frames.length;
      const list = [];
      for (let d = on.prev; d >= 1; d--) list.push(-d);
      for (let d = on.next; d >= 1; d--) list.push(d);
      for (const d of list) {
        let f = timeline.frame + d;
        if (state.opts.loop) f = (f + n) % n;
        if (f < 0 || f >= n || f === timeline.frame) continue;
        this.renderFrameInto(this.onionBuf, f, null, vis);
        const o = this.onionBuf.getContext('2d');
        o.globalCompositeOperation = 'source-atop';
        o.fillStyle = d < 0 ? 'rgba(235,60,60,0.55)' : 'rgba(50,120,255,0.55)';
        o.fillRect(0, 0, this.onionBuf.width, this.onionBuf.height);
        o.globalCompositeOperation = 'source-over';
        const k = Math.abs(d) - 1, cnt = d < 0 ? on.prev : on.next;
        ctx.globalAlpha = on.opacity * (1 - k / (cnt + 1));
        ctx.drawImage(this.onionBuf, 0, 0);
        ctx.globalAlpha = 1;
      }
    }

    // フォント作成: 下書き(参考の文字)
    drawFontUnderlay(ctx, this);

    // 現在のフレームのレイヤー
    this.renderFrameInto(null, timeline.frame, state.preview, vis);

    // アートボードの枠
    ctx.lineWidth = 1;
    ctx.strokeStyle = state.tool === 'artboard' ? '#3b82f6' : 'rgba(0,0,0,0.7)';
    ctx.strokeRect(ax - 0.5, ay - 0.5, aw + 1, ah + 1);

    this.drawGrid(vis);
    this.drawOverlays();
    drawRulers(this); // 定規(キャンバスの上と左。guides.js)
  }

  // フレーム frame の表示レイヤーを合成して target(null なら画面)に描く
  renderFrameInto(target, frame, preview, vis) {
    const doc = state.doc;
    const dst = target ? target.getContext('2d') : this.ctx;
    if (target) {
      dst.setTransform(1, 0, 0, 1, 0, 0);
      dst.clearRect(0, 0, target.width, target.height);
    }
    const pose = rigActive(doc) ? evalPose(doc, frame) : null;
    for (const l of doc.layers) {
      if (!l.visible) continue;
      const cel = l.displayCelAt(frame);
      const p = preview && preview.layerId === l.id ? preview : null;
      if (!cel && !p) continue;
      const b = this.layerBuf.getContext('2d');
      b.setTransform(1, 0, 0, 1, 0, 0);
      b.clearRect(0, 0, this.layerBuf.width, this.layerBuf.height);
      b.imageSmoothingEnabled = this.zoom < 1;
      b.imageSmoothingQuality = 'high';
      const c = cel || l.cel;
      // リグで変形(描いている最中のレイヤーは元の形で表示)
      const rc = pose && !p && !restDisplay(l) && hasRigBind(l, c) ? rigContent(doc, l, c, pose, this.rigQuality(c)) : null;
      // ベクターのレイヤーは、中身が変わっていなければ前に描いた絵を使い回す(図形が多い・ドット化があると毎回描くのが重いため)。
      // ペンで描いている最中は、描き終わっている図形は使い回して、今の線だけ上に描く
      const penOnly = p && p.shape && Object.keys(p).length === 2 && !hasPixelGrad(l.pixelGrad) && !(l.pixel >= 1);
      const mv = state.moving;
      const moving = mv && mv.layerId === l.id;
      // エフェクト(effects.js): 後ろ → レイヤー → 前。描いている最中・動かしている最中は「絵そのもの」(ゆらゆら)は使わない
      const fx = cel ? layerEffects(doc, l, cel, rc, frame) : null;
      if (moving && l.type === 'vector' && c && !rc && !p) {
        this.paintMoving(b, l, c, mv);
      } else if (fx?.body && !p && !moving) {
        this.setWorld(b);
        drawFxPart(b, fx, 'body');
      } else if (l.type === 'vector' && c && !rc && (!p || penOnly) && !state.playing) {
        this.paintCached(b, l, c, vis);
        if (p) { this.setWorld(b); drawShape(b, p.shape); }
      } else this.paintLayerFx(b, l, c, p, rc, vis);
      b.setTransform(1, 0, 0, 1, 0, 0);
      dst.globalAlpha = l.opacity;
      if (fx?.back) { dst.save(); this.setWorld(dst); drawFxPart(dst, fx, 'back'); dst.restore(); }
      dst.drawImage(this.layerBuf, 0, 0);
      if (fx?.front) { dst.save(); this.setWorld(dst); drawFxPart(dst, fx, 'front'); dst.restore(); }
      dst.globalAlpha = 1;
    }
  }

  // レイヤーのキャッシュ(画面と同じ大きさの絵。表示位置・ズーム・中身・ドット化が同じなら使える)。最近の 12枚まで
  paintCached(b, l, c, vis) {
    const key = [c.version, c.shapes.length, l.pixel || 0, JSON.stringify(l.pixelGrad || null), this.zoom, this.ox, this.oy,
      this.layerBuf.width, this.layerBuf.height, this.dpr, layerCacheEpoch].join('|');
    const hit = this.layerCache.get(c);
    if (hit && hit.key === key) {
      this.layerCache.delete(c);
      this.layerCache.set(c, hit);
      b.drawImage(hit.canvas, 0, 0);
      return;
    }
    this.paintLayerFx(b, l, c, null, null, vis);
    const canvas = hit?.canvas && hit.canvas.width === this.layerBuf.width && hit.canvas.height === this.layerBuf.height ? hit.canvas : createCanvas(this.layerBuf.width, this.layerBuf.height);
    const x = canvas.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, canvas.width, canvas.height);
    x.drawImage(this.layerBuf, 0, 0);
    this.layerCache.delete(c);
    this.layerCache.set(c, { key, canvas });
    while (this.layerCache.size > 12) this.layerCache.delete(this.layerCache.keys().next().value);
  }

  // 矢印ツールで図形を動かしている最中: 「動かさない図形」と「動かす図形」を1回ずつ絵にしておき、動かす方をずらして重ねるだけ
  paintMoving(b, l, c, mv) {
    const key = [c.version, this.zoom, this.ox, this.oy, this.layerBuf.width, this.layerBuf.height, this.dpr, layerCacheEpoch].join('|');
    let m = this.moveCache;
    if (!m || m.token !== mv.token || m.key !== key) {
      const shot = (shapes) => {
        b.setTransform(1, 0, 0, 1, 0, 0);
        b.clearRect(0, 0, this.layerBuf.width, this.layerBuf.height);
        this.setWorld(b);
        drawObjects(b, shapes);
        const cv = createCanvas(this.layerBuf.width, this.layerBuf.height);
        cv.getContext('2d').drawImage(this.layerBuf, 0, 0);
        return cv;
      };
      const rest = c.shapes.filter((s) => mv.dup || !mv.ids.has(s.id));
      const sel = c.shapes.filter((s) => mv.ids.has(s.id));
      m = this.moveCache = { token: mv.token, key, base: shot(rest), sel: shot(sel) };
    }
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.clearRect(0, 0, this.layerBuf.width, this.layerBuf.height);
    b.drawImage(m.base, 0, 0);
    b.drawImage(m.sel, Math.round(mv.dx * this.zoom * this.dpr), Math.round(mv.dy * this.zoom * this.dpr));
  }

  // 1レイヤーを layerBuf に描く(レイヤーのドット化・ドットのグラデーションも)
  paintLayerFx(b, l, c, p, rc, vis) {
    const doc = state.doc;
    {
      if (hasPixelGrad(l.pixelGrad)) {
        // レイヤーのドットのグラデーション: 粗さの変化はレイヤーの絵の枠を基準にする(表示範囲が変わってもずれない)
        this.setWorld(b);
        const content = celBounds(l, rc?.cel || c);
        const r = content && !rc?.canvas && !p ? intersectRect(content, vis) : intersectRect(vis, doc.limits);
        if (r) drawPixelGrad(b, l.pixelGrad, r, content || r, (w) => this.paintLayer(this.worldOut(w), l, c, p, rc, vis));
      } else if (l.pixel >= 1) {
        // レイヤーのドット化: ワールド座標で描いてから粗くする
        this.setWorld(b);
        const content = rc?.canvas || p ? null : celBounds(l, rc?.cel || c);
        const r = content ? intersectRect(content, vis) : intersectRect(vis, doc.limits);
        if (r) drawPixelated(b, l.pixel, r, (w) => this.paintLayer(this.worldOut(w), l, c, p, rc, vis));
      } else {
        this.paintLayer(this.deviceOut(b), l, c, p, rc, vis);
      }
    }
  }

  setWorld(b) {
    const z = this.zoom * this.dpr;
    b.setTransform(z, 0, 0, z, this.ox * this.dpr, this.oy * this.dpr);
  }

  // 画像の描き先。device: 画面のピクセルに合わせて丸める(タイルの継ぎ目が出ない)/ world: ワールド座標のまま
  deviceOut(b) {
    return {
      ctx: b,
      world: () => this.setWorld(b),
      img: (src, wx, wy, w, h) => {
        b.setTransform(1, 0, 0, 1, 0, 0);
        const x0 = this.DX(wx), y0 = this.DY(wy);
        b.drawImage(src, x0, y0, this.DX(wx + w) - x0, this.DY(wy + h) - y0);
      },
      mat: (src, m, crisp = false) => {
        this.setWorld(b);
        b.save();
        b.imageSmoothingEnabled = !crisp;
        b.transform(...m);
        b.drawImage(src, 0, 0);
        b.restore();
      },
    };
  }

  worldOut(w) {
    return {
      ctx: w,
      world: () => {},
      img: (src, wx, wy, ww, hh) => w.drawImage(src, wx, wy, ww, hh),
      mat: (src, m, crisp = false) => {
        w.save();
        w.imageSmoothingEnabled = !crisp;
        w.transform(...m);
        w.drawImage(src, 0, 0);
        w.restore();
      },
    };
  }

  // ポーズをドラッグ中は、大きな絵なら解像度を落として軽くする
  rigQuality(cel) {
    if (!state.rigDragging || !cel.tiles) return { step: 1 };
    const n = cel.tiles.size * TILE * TILE;
    return { step: Math.max(1, Math.ceil(Math.sqrt(n / 1.5e6))) };
  }

  // 1レイヤーの中身を out に描く(rc: リグの変形結果、p: 描画中のプレビュー)
  paintLayer(out, l, cel, p, rc, vis) {
    if (rc?.canvas) {
      if (rc.matrix) out.mat(rc.canvas, rc.matrix, rc.crisp);
      else out.img(rc.canvas, rc.x, rc.y, rc.w, rc.h);
      return;
    }
    const c = rc?.cel || cel;
    if (l.type === 'raster') {
      this.drawRaster(out, c.tiles, p, vis);
      return;
    }
    out.world();
    drawObjects(out.ctx, c.shapes);
    if (p?.shape) drawShape(out.ctx, p.shape);
  }

  fillChecker(x, y, w, h) {
    const ctx = this.ctx;
    // 1マスが画面で 8px 以上になる最小の 2 の累乗(ワールド px)。ズームが大きいと 1 ピクセル = 1 マス
    const cell = Math.max(1, 2 ** Math.ceil(Math.log2(8 / (this.zoom * this.dpr))));
    const s = cell * this.zoom * this.dpr;
    this.checker.setTransform(new DOMMatrix([s, 0, 0, s, this.ox * this.dpr, this.oy * this.dpr]));
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = this.checker;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  drawRaster(out, tiles, p, vis) {
    const on = (t, dx = 0, dy = 0) => t.x + dx < vis.x1 && t.x + dx + TILE > vis.x0 && t.y + dy < vis.y1 && t.y + dy + TILE > vis.y0;

    if (p?.affine) {
      // 自由変形(回転・拡大縮小)のプレビュー: 行列で描くだけなので軽い
      out.mat(p.affine.canvas, p.affine.matrix);
      return;
    }
    if (p?.transform) {
      // 自由変形(歪み)のプレビュー
      const t = p.transform;
      out.img(t.canvas, t.x, t.y, t.w, t.h);
      return;
    }
    if (p?.offset) {
      for (const t of tiles.values()) if (on(t, p.offset.x, p.offset.y)) out.img(t.canvas, t.x + p.offset.x, t.y + p.offset.y, TILE, TILE);
      return;
    }
    if (p?.tiles) {
      // 描画中のストロークをタイルごとに重ねる
      const keys = new Map();
      for (const t of tiles.values()) if (on(t)) keys.set(t.tx + ',' + t.ty, [t.tx, t.ty]);
      for (const t of p.tiles.values()) if (on(t)) keys.set(t.tx + ',' + t.ty, [t.tx, t.ty]);
      for (const [tx, ty] of keys.values()) {
        const lt = tiles.get(tx, ty), pt = p.tiles.get(tx, ty);
        if (!pt) { out.img(lt.canvas, lt.x, lt.y, TILE, TILE); continue; }
        const buf = this.tileBuf;
        const bx = buf.getContext('2d');
        bx.clearRect(0, 0, TILE, TILE);
        if (lt) bx.drawImage(lt.canvas, 0, 0);
        bx.globalAlpha = p.alpha;
        bx.globalCompositeOperation = p.op;
        bx.drawImage(pt.canvas, 0, 0);
        bx.globalAlpha = 1;
        bx.globalCompositeOperation = 'source-over';
        out.img(buf, pt.x, pt.y, TILE, TILE);
      }
      return;
    }
    for (const t of tiles.values()) if (on(t)) out.img(t.canvas, t.x, t.y, TILE, TILE);
  }

  drawGrid(vis) {
    const doc = state.doc;
    if (doc.mode !== 'pixel' || !state.opts.showGrid || this.zoom < 6) return;
    const r = intersectRect(vis, doc.limits);
    if (!r) return;
    const ctx = this.ctx;
    ctx.beginPath();
    const top = this.DY(r.y0), bottom = this.DY(r.y1), left = this.DX(r.x0), right = this.DX(r.x1);
    for (let x = r.x0; x <= r.x1; x++) {
      const sx = this.DX(x) + 0.5;
      ctx.moveTo(sx, top);
      ctx.lineTo(sx, bottom);
    }
    for (let y = r.y0; y <= r.y1; y++) {
      const sy = this.DY(y) + 0.5;
      ctx.moveTo(left, sy);
      ctx.lineTo(right, sy);
    }
    ctx.strokeStyle = 'rgba(110,110,130,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // 以下は CSS px 座標で描く
  // スポイトの拡大鏡(小さめ: 直径 72px・5倍)。カーソルの右下に、画面に描いた絵を拡大して出す。真ん中の四角が拾う色
  drawPickLoupe(ctx) {
    if (state.tool !== 'eyedropper' || !state.cursor) return;
    const D = 72, Z = 5, src = D / Z;
    const c = this.toScreen(state.cursor);
    let lx = c.x + 18, ly = c.y + 18;
    if (lx + D > this.w) lx = c.x - 18 - D;
    if (ly + D > this.h) ly = c.y - 18 - D;
    ctx.save();
    ctx.beginPath();
    ctx.arc(lx + D / 2, ly + D / 2, D / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    const k = this.dpr;
    ctx.drawImage(this.canvas, (c.x - src / 2) * k, (c.y - src / 2) * k, src * k, src * k, lx, ly, D, D);
    ctx.restore();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#3b82f6';
    ctx.beginPath();
    ctx.arc(lx + D / 2, ly + D / 2, D / 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#000';
    ctx.strokeRect(lx + D / 2 - Z / 2 - 0.5, ly + D / 2 - Z / 2 - 0.5, Z + 1, Z + 1);
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(lx + D / 2 - Z / 2 - 1.5, ly + D / 2 - Z / 2 - 1.5, Z + 3, Z + 3);
  }

  drawOverlays() {
    const ctx = this.ctx;
    const z = this.zoom;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // アートボードツール: サイズ表示とハンドル
    if (state.tool === 'artboard') {
      const a = state.doc.artboard;
      const p0 = this.toScreen({ x: a.x, y: a.y }), p1 = this.toScreen({ x: a.x + a.w, y: a.y + a.h });
      const pts = [
        [p0.x, p0.y], [(p0.x + p1.x) / 2, p0.y], [p1.x, p0.y], [p1.x, (p0.y + p1.y) / 2],
        [p1.x, p1.y], [(p0.x + p1.x) / 2, p1.y], [p0.x, p1.y], [p0.x, (p0.y + p1.y) / 2],
      ];
      for (const [x, y] of pts) handle(ctx, x, y);
      const label = `アートボード  ${a.w} × ${a.h}`;
      ctx.font = '12px "Segoe UI", "Yu Gothic UI", sans-serif';
      ctx.fillStyle = '#9fc3ff';
      ctx.fillText(label, p0.x, p0.y - 8);
    }

    // フォント作成: ベースラインなどのガイド線・ドットのマス目
    drawFontGuides(ctx, this);

    // ガイド(定規から引き出した線)
    drawGuides(ctx, this);

    // 選択中の図形(矢印ツールの枠・範囲選択)
    drawSelectionOverlay(ctx, this);
    drawMeasure(ctx, this);
    drawSmart(ctx, this);
    drawReflectOverlay(ctx);
    drawDirectOverlay(ctx);
    drawBendOverlay(ctx);
    this.drawPickLoupe(ctx);

    // リグ(ボーン・格子)
    drawRigOverlay(ctx);

    // 自由変形の枠
    const T = state.transform;
    if (T && state.tool === 'transform') {
      const q = T.quad.map((p) => this.toScreen(p));
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#3b82f6';
      ctx.beginPath();
      q.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
      for (const h of transformHandles(T, this)) handle(ctx, h.p.x, h.p.y);
    }

    // 作成中のパス
    const d = state.pathDraft;
    if (d && d.nodes.length) {
      ctx.save();
      ctx.setTransform(this.dpr * z, 0, 0, this.dpr * z, this.ox * this.dpr, this.oy * this.dpr);
      const s = draftShape(d);
      drawShape(ctx, s.stroke ? s : { ...s, stroke: '#3b82f6ff', strokeWidth: 1 / z });
      ctx.restore();
      ctx.lineWidth = 1;
      const last = d.nodes[d.nodes.length - 1];
      if (state.cursor && state.tool === 'path') {
        const a = this.toScreen(last.hout || last), b = this.toScreen(state.cursor);
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = '#3b82f6';
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.setLineDash([]);
      }
      d.nodes.forEach((n, i) => {
        const p = this.toScreen(n);
        for (const h of [n.hin, n.hout]) {
          if (!h) continue;
          const q = this.toScreen(h);
          ctx.strokeStyle = '#3b82f6';
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
          ctx.fillStyle = '#3b82f6';
          ctx.beginPath(); ctx.arc(q.x, q.y, 3, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = i === 0 ? '#facc15' : '#ffffff';
        ctx.strokeStyle = '#1e3a8a';
        ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
        ctx.strokeRect(p.x - 4.5, p.y - 4.5, 9, 9);
      });
    }

    // ブラシカーソル
    const cur = state.cursor;
    if (cur && (state.tool === 'pen' || state.tool === 'eraser') && !this.panning) {
      const size = brushSize(state.tool);
      if (isPixelMode()) {
        const o = brushOffset(size);
        const x = Math.floor(cur.x) - o, y = Math.floor(cur.y) - o;
        const a = this.toScreen({ x, y });
        doubleRect(ctx, Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(size * z) - 1, Math.round(size * z) - 1);
      } else {
        const a = this.toScreen(cur);
        const r = Math.max(1.5, (size / 2) * z);
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.beginPath(); ctx.arc(a.x, a.y, r + 0.5, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath(); ctx.arc(a.x, a.y, r - 0.5, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }
}

function handle(ctx, x, y) {
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 1;
  ctx.fillRect(Math.round(x) - 4, Math.round(y) - 4, 8, 8);
  ctx.strokeRect(Math.round(x) - 4.5, Math.round(y) - 4.5, 9, 9);
}


function doubleRect(ctx, x, y, w, h) {
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.strokeRect(x, y, w, h);
}
