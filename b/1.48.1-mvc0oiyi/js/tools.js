// 描画ツール
// 各ツールは down(ev) / move(ev) / up(ev) を持つ。down が true を返すとドラッグ操作が始まる。
// ev = { x, y (ワールド座標・小数), px, py (ピクセル座標), sx, sy (画面座標), button, shift, alt, ctrl, pressure, pointerType }
import { applyPicked } from './paint.js';
import { prefs } from './prefs.js';
import { setSelection } from './select.js';
import { state, emit, requestRender, toast, isPixelMode, modeKey } from './state.js';
import { pack, toRgbCss, toHex8, toHex } from './color.js';
import { TileMap, TILE, tileCoordsInRect } from './tiles.js';
import {
  bresenham, brushOffset, rasterShapeRegion, flatten, flattenLayers, celBounds,
  abRect, unionRect, intersectRect,
} from './render.js';
import { fillRegion, expandRegion } from './fill.js';
import { traceAlpha, loopsToPath } from './outline.js';
import { drawShape, hitShape, hitLeafForPaint, smoothFreehand, shapeBounds, ensureIds, polygonNodes, hasFill, hasStroke } from './vector.js';
import { recordTiles, vectorEntry, appendEntry, docPropsEntry } from './history.js';
import { addLayer, setActiveLayer } from './layers.js';
import { useColor } from './recent.js';

export const brushSize = (tool) => state.opts.size[tool][modeKey()];
const strokeWidth = () => state.opts.strokeWidth[modeKey()];
const zoom = () => state.view?.zoom || 1;
export const hitTol = () => 4 / zoom() + (isPixelMode() ? 0.5 : 0);

export function editableLayer() {
  const l = state.doc.activeLayer;
  if (!l) return null;
  if (!l.visible) { toast('非表示のレイヤーには描画できません'); return null; }
  if (l.locked) { toast('レイヤーがロックされています'); return null; }
  return l;
}

const inLimits = (x, y) => {
  const L = state.doc.limits;
  return x >= L.x0 && y >= L.y0 && x < L.x1 && y < L.y1;
};

// ---- ラスター描画のプレビュー ----
// 確定前のストロークはプレビュー用タイルに描き、表示時にレイヤーへ重ねる。
// 確定時に触れたタイルだけを履歴に保存する。

function newPreview(layer, { op = 'source-over', alpha = 1 } = {}) {
  const p = { layerId: layer.id, op, alpha, tiles: new TileMap(), dirty: new Set() };
  state.preview = p;
  return p;
}

function pixelTile(p, x, y) {
  const t = p.tiles.ensure(Math.floor(x / TILE), Math.floor(y / TILE));
  if (!t.img) {
    t.img = t.ctx.createImageData(TILE, TILE);
    t.u32 = new Uint32Array(t.img.data.buffer);
  }
  return t;
}

function stampPixels(p, x, y, size, packed) {
  const o = brushOffset(size);
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const xx = x - o + dx, yy = y - o + dy;
      if (!inLimits(xx, yy)) continue;
      const t = pixelTile(p, xx, yy);
      t.u32[(yy - t.y) * TILE + (xx - t.x)] = packed;
      p.dirty.add(t);
    }
  }
}

function flushPixels(p) {
  for (const t of p.dirty) t.ctx.putImageData(t.img, 0, 0);
  p.dirty.clear();
}

// ワールド矩形にかかるプレビュータイルに描く(描画範囲の外はクリップ)
function previewDraw(p, x0, y0, x1, y1, fn) {
  const L = state.doc.limits;
  const r = intersectRect({ x0: Math.floor(x0), y0: Math.floor(y0), x1: Math.ceil(x1), y1: Math.ceil(y1) }, L);
  if (!r) return;
  for (const t of p.tiles.inRect(r.x0, r.y0, r.x1, r.y1, true)) {
    const c = t.ctx;
    c.save();
    c.setTransform(1, 0, 0, 1, -t.x, -t.y);
    c.beginPath();
    c.rect(L.x0, L.y0, L.x1 - L.x0, L.y1 - L.y0);
    c.clip();
    fn(c);
    c.restore();
  }
}

export function cancelPreview() {
  state.preview = null;
  requestRender();
}

export function commitPreview(label) {
  const p = state.preview;
  state.preview = null;
  if (!p || !p.tiles || !p.tiles.size) { requestRender(); return; }
  const layer = state.doc.layerById(p.layerId);
  if (!layer) { requestRender(); return; }
  const erase = p.op === 'destination-out';
  const tiles = [...p.tiles.values()].filter((t) => !erase || layer.tiles.get(t.tx, t.ty));
  recordTiles(state.history, label, layer, tiles.map((t) => [t.tx, t.ty]), () => {
    for (const pt of tiles) {
      const c = layer.tiles.ensure(pt.tx, pt.ty).ctx;
      c.save();
      c.globalAlpha = p.alpha;
      c.globalCompositeOperation = p.op;
      c.drawImage(pt.canvas, 0, 0);
      c.restore();
    }
  });
  requestRender();
}

// 図形を1つ足すだけのとき: 足した図形だけを履歴に入れる(レイヤー全体をコピーしないので、図形が多くても軽い)
// select: 設定「図形を作ったら選ぶ」がオンなら、足した図形を選ぶ
export function pushAppend(label, layer, shape, select = false) {
  const list = Array.isArray(shape) ? shape : [shape];
  ensureIds(list);
  layer.shapes.push(...list);
  layer.touch();
  state.history.push(appendEntry(label, layer, list));
  if (select && prefs.selectNew) setSelection(layer, list.map((s) => s.id));
  requestRender();
}

export function pushVector(label, layer, before) {
  ensureIds(layer.shapes);
  layer.touch();
  state.history.push(vectorEntry(label, layer, before, layer.shapes));
  requestRender();
}

// ---- ペン / 消しゴム ----

function makeBrush(kind) {
  const erase = kind === 'eraser';
  return {
    cursor: 'none',

    down(ev) {
      const layer = editableLayer();
      if (!layer) return false;
      this.layer = layer;
      this.vec = null;
      const color = ev.button === 2 ? state.secondary : state.primary;
      if (!erase) useColor(color);
      if (layer.type === 'vector') return erase ? this.vecEraseDown(ev) : this.vecPenDown(ev, color);

      const size = brushSize(kind);
      const lp = state.lastPoint;
      const lineFromLast = ev.shift && lp && lp.layerId === layer.id && lp.pixel === isPixelMode();
      if (isPixelMode()) {
        // ドット絵: 置き換え方式で描くのでストローク内で色が重なって濃くならない
        const p = newPreview(layer, { op: erase ? 'destination-out' : 'source-over' });
        this.packed = erase ? 0xff000000 : pack(color);
        const cur = { x: ev.px, y: ev.py };
        if (lineFromLast) this.pixelLine(lp, cur, size);
        else stampPixels(p, cur.x, cur.y, size, this.packed);
        this.last = cur;
        flushPixels(p);
      } else {
        // イラスト: 不透明で描いて、合成時に色のアルファを一括適用
        newPreview(layer, { op: erase ? 'destination-out' : 'source-over', alpha: erase ? 1 : color.a / 255 });
        this.css = erase ? '#000' : toRgbCss(color);
        const cur = { x: ev.x, y: ev.y };
        if (lineFromLast) this.seg(lp, cur, size, ev);
        else this.dot(cur, size, ev);
        this.last = cur;
      }
      requestRender();
      return true;
    },

    move(ev) {
      if (this.vec) { this.vecMove(ev); return; }
      const p = state.preview;
      if (!p) return;
      const size = brushSize(kind);
      if (isPixelMode()) {
        const cur = { x: ev.px, y: ev.py };
        if (cur.x === this.last.x && cur.y === this.last.y) return;
        this.pixelLine(this.last, cur, size);
        this.last = cur;
        flushPixels(p);
      } else {
        const cur = { x: ev.x, y: ev.y };
        this.seg(this.last, cur, size, ev);
        this.last = cur;
      }
      requestRender();
    },

    up() {
      if (this.vec) { this.vecUp(); return; }
      if (!state.preview) return;
      commitPreview(erase ? '消しゴム' : 'ペン');
      state.lastPoint = { ...this.last, layerId: this.layer.id, pixel: isPixelMode() };
    },

    pixelLine(a, b, size) {
      const p = state.preview;
      bresenham(a.x, a.y, b.x, b.y, (x, y) => stampPixels(p, x, y, size, this.packed));
    },

    width(size, ev) {
      return ev.pointerType === 'pen' && ev.pressure > 0 ? Math.max(1, size * ev.pressure) : size;
    },

    dot(c, size, ev) {
      const r = this.width(size, ev) / 2;
      previewDraw(state.preview, c.x - r - 2, c.y - r - 2, c.x + r + 2, c.y + r + 2, (ctx) => {
        ctx.fillStyle = this.css;
        ctx.beginPath();
        ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
        ctx.fill();
      });
    },

    seg(a, b, size, ev) {
      const w = this.width(size, ev);
      const r = w / 2 + 2;
      previewDraw(state.preview, Math.min(a.x, b.x) - r, Math.min(a.y, b.y) - r, Math.max(a.x, b.x) + r, Math.max(a.y, b.y) + r, (ctx) => {
        ctx.strokeStyle = this.css;
        ctx.lineWidth = w;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      });
    },

    // ベクターレイヤー上のペン: フリーハンドのパス図形を作る
    vecPenDown(ev, color) {
      this.vec = { mode: 'pen', pts: [this.vecPoint(ev)], color };
      this.updateVecPreview();
      return true;
    },

    vecPoint(ev) {
      return isPixelMode() ? { x: ev.px + 0.5, y: ev.py + 0.5 } : { x: ev.x, y: ev.y };
    },

    freehandShape(nodes, color) {
      return { type: 'path', nodes, closed: false, stroke: toHex8(color), fill: null, strokeWidth: brushSize('pen') };
    },

    updateVecPreview() {
      const nodes = this.vec.pts.map((p) => ({ x: p.x, y: p.y }));
      if (nodes.length === 1) nodes.push({ x: nodes[0].x + 0.01, y: nodes[0].y });
      state.preview = { layerId: this.layer.id, shape: this.freehandShape(nodes, this.vec.color) };
      requestRender();
    },

    // ベクターレイヤー上の消しゴム: 触れた図形を削除
    vecEraseDown(ev) {
      this.vec = { mode: 'erase', before: structuredClone(this.layer.shapes), changed: false };
      this.vecEraseAt(ev);
      return true;
    },

    vecEraseAt(ev) {
      const shapes = this.layer.shapes;
      const tol = brushSize('eraser') / 2;
      for (let i = shapes.length - 1; i >= 0; i--) {
        if (hitShape(shapes[i], ev.x, ev.y, tol)) { shapes.splice(i, 1); this.vec.changed = true; }
      }
      if (this.vec.changed) { this.layer.touch(); state.selection = null; requestRender(); }
    },

    vecMove(ev) {
      if (this.vec.mode === 'erase') { this.vecEraseAt(ev); return; }
      const pt = this.vecPoint(ev);
      const last = this.vec.pts[this.vec.pts.length - 1];
      const minDist = isPixelMode() ? 1 : 2 / zoom();
      if (Math.hypot(pt.x - last.x, pt.y - last.y) < minDist) return;
      this.vec.pts.push(pt);
      this.updateVecPreview();
    },

    vecUp() {
      const v = this.vec;
      this.vec = null;
      if (v.mode === 'erase') {
        if (v.changed) state.history.push(vectorEntry('図形を消去', this.layer, v.before, this.layer.shapes));
        return;
      }
      state.preview = null;
      let nodes;
      if (v.pts.length === 1) nodes = [{ ...v.pts[0] }, { x: v.pts[0].x + 0.01, y: v.pts[0].y }];
      else if (isPixelMode()) nodes = v.pts.map((p) => ({ x: p.x, y: p.y }));
      else nodes = smoothFreehand(v.pts, 1.5 / zoom());
      const shape = this.freehandShape(nodes, v.color);
      pushAppend('ペン', this.layer, shape);
    },
  };
}

// ---- 塗りつぶし ----
// 塗る範囲は「アートボード+レイヤーに描かれている範囲」(ワークスペース全体だと広すぎるため)。
// 範囲の求め方は fill.js(Kaiju のバケツと同じ): 色の許容・隙間閉じ(線が少し切れていても、もれない)・線へのはみ出し(線の下にもぐらせる)。
// 境目にする絵は、見えている絵ぜんぶ(既定)か、今のレイヤーだけ(state.opts.fillRef)

const MAX_FILL_AREA = 40e6;
const MAX_GAP_AREA = 16e6; // 隙間閉じは、距離の計算にメモリを使うので、これより広い範囲では使わない

// 境目にする絵(region = { x, y, w, h }(ワールド)を scale 倍で)
function fillRefData(layer, region, scale) {
  const doc = state.doc;
  const layers = state.opts.fillRef === 'layer' ? [layer] : doc.layers.filter((l) => l.visible);
  const c = flattenLayers(doc, layers, scale, region); // 背景色は入れない(何もない所 = 透明、として見る)
  return c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
}

const boundsOf = (l) => (l.cel ? celBounds(l, l.cel) : null);

// 範囲を広げる(線へのはみ出し)。広げた分は、何か描いてある所(線)だけ残す(まわりが透明な絵を塗り替えても、太らない)
function expandUnderLines(region, ref, w, h, n) {
  const e = expandRegion(region, w, h, n);
  if (n > 0) {
    for (let j = 0; j < e.h; j++) {
      for (let i = 0; i < e.w; i++) {
        const p = (e.y + j) * w + e.x + i;
        if (e.on[j * e.w + i] && !region.mask[p] && ref[p * 4 + 3] === 0) e.on[j * e.w + i] = 0;
      }
    }
  }
  return e;
}

// ラスター: 塗る範囲の画素を色にする。はみ出しの分(線の下)は、今ある絵の下に塗る(同じレイヤーの線を消さない)
function fillRaster(layer, ev, color) {
  const doc = state.doc, o = state.opts;
  if (!inLimits(ev.px, ev.py)) return;
  let r = unionRect(abRect(doc.artboard), layer.bounds());
  if (o.fillRef !== 'layer') for (const l of doc.layers) if (l.visible) r = unionRect(r, boundsOf(l));
  r = unionRect(r, { x0: ev.px, y0: ev.py, x1: ev.px + 1, y1: ev.py + 1 });
  r = intersectRect({ x0: Math.floor(r.x0), y0: Math.floor(r.y0), x1: Math.ceil(r.x1), y1: Math.ceil(r.y1) }, doc.limits);
  const w = r.x1 - r.x0, h = r.y1 - r.y0;
  if (w * h > MAX_FILL_AREA) { toast('塗りつぶす範囲が大きすぎます'); return; }
  const img = layer.getImageData(r.x0, r.y0, w, h);
  const ref = o.fillRef === 'layer' ? img.data : fillRefData(layer, { x: r.x0, y: r.y0, w, h }, 1);
  const gap = w * h > MAX_GAP_AREA ? 0 : o.fillGap;
  const region = fillRegion(ref, w, h, ev.px - r.x0, ev.py - r.y0, o.tolerance, gap, o.contiguous);
  if (!region) return;
  const e = expandUnderLines(region, ref, w, h, o.contiguous ? o.fillExpand : 0);
  const d = img.data, { r: cr, g: cg, b: cb, a: ca } = color;
  for (let j = 0; j < e.h; j++) {
    for (let i = 0; i < e.w; i++) {
      if (!e.on[j * e.w + i]) continue;
      const p = (e.y + j) * w + e.x + i, q = p * 4;
      if (region.mask[p]) { d[q] = cr; d[q + 1] = cg; d[q + 2] = cb; d[q + 3] = ca; continue; }
      // はみ出しの分: 今ある絵の下に塗る
      const da = d[q + 3] / 255, sa = (ca / 255) * (1 - da), oa = da + sa;
      if (oa <= 0) continue;
      d[q] = Math.round((d[q] * da + cr * sa) / oa);
      d[q + 1] = Math.round((d[q + 1] * da + cg * sa) / oa);
      d[q + 2] = Math.round((d[q + 2] * da + cb * sa) / oa);
      d[q + 3] = Math.round(oa * 255);
    }
  }
  const coords = tileCoordsInRect(r.x0 + e.x, r.y0 + e.y, r.x0 + e.x + e.w, r.y0 + e.y + e.h);
  recordTiles(state.history, '塗りつぶし', layer, coords, () => {
    layer.tiles.putImageData(img, r.x0, r.y0, e.x, e.y, e.w, e.h);
  });
  requestRender();
}

// ベクター: 線で囲まれた所(少し切れていてもよい)を、塗りのパスとして作り、線の下に置く。
// noLeak = 範囲が絵の外までもれたら、作らない(false を返す)
function fillVectorRegion(layer, ev, color, noLeak = false) {
  const doc = state.doc, o = state.opts;
  if (!inLimits(ev.px, ev.py)) return false;
  let r = abRect(doc.artboard);
  for (const l of o.fillRef === 'layer' ? [layer] : doc.layers.filter((x) => x.visible)) r = unionRect(r, boundsOf(l));
  r = intersectRect({ x0: Math.floor(r.x0) - 8, y0: Math.floor(r.y0) - 8, x1: Math.ceil(r.x1) + 8, y1: Math.ceil(r.y1) + 8 }, doc.limits);
  if (!r || ev.x < r.x0 || ev.y < r.y0 || ev.x >= r.x1 || ev.y >= r.y1) return false;
  const w0 = r.x1 - r.x0, h0 = r.y1 - r.y0;
  // 細かくなぞる(2倍まで。広い絵は粗く)
  const scale = Math.min(2, Math.sqrt(8e6 / (w0 * h0)));
  if (scale < 0.2) { if (!noLeak) toast('塗りつぶす範囲が大きすぎます'); return false; }
  const ref = fillRefData(layer, { x: r.x0, y: r.y0, w: w0, h: h0 }, scale);
  const W = Math.round(w0 * scale), H = Math.round(h0 * scale);
  const sx = Math.min(W - 1, Math.floor((ev.x - r.x0) * scale)), sy = Math.min(H - 1, Math.floor((ev.y - r.y0) * scale));
  const region = fillRegion(ref, W, H, sx, sy, o.tolerance, o.fillGap * scale);
  if (!region) return false;
  if (noLeak && (region.x0 === 0 || region.y0 === 0 || region.x1 === W - 1 || region.y1 === H - 1)) return false;
  const e = expandUnderLines(region, ref, W, H, Math.round(o.fillExpand * scale));
  // 範囲 → 輪郭 → パス(ふちを少しならしてから、なぞる)
  const P = 3, aw = e.w + P * 2, ah = e.h + P * 2;
  const hard = new Uint8Array(aw * ah);
  for (let j = 0; j < e.h; j++) for (let i = 0; i < e.w; i++) if (e.on[j * e.w + i]) hard[(j + P) * aw + i + P] = 1;
  const a = new Uint8Array(aw * ah);
  for (let y = 1; y < ah - 1; y++) {
    for (let x = 1; x < aw - 1; x++) {
      const p = y * aw + x;
      const n = hard[p - aw - 1] + hard[p - aw] + hard[p - aw + 1] + hard[p - 1] + hard[p] + hard[p + 1] + hard[p + aw - 1] + hard[p + aw] + hard[p + aw + 1];
      a[p] = Math.round((n * 255) / 9);
    }
  }
  const loops = traceAlpha(a, aw, ah, (p) => ({ x: (p.x - P + e.x + 0.5) / scale + r.x0, y: (p.y - P + e.y + 0.5) / scale + r.y0 }));
  const path = loopsToPath(loops, scale, { tol: 1 }); // ふちは線の下に隠れるので、点を少なく
  if (!path) return false;
  Object.assign(path, { fill: toHex8(color), stroke: null, strokeWidth: 0 });
  const before = structuredClone(layer.shapes);
  // 線(塗りのない図形)のうち、いちばん下のもののすぐ下へ。線がなければ、いちばん上へ
  const isLine = (s) => (s.type === 'group' ? s.children.some(isLine) : hasStroke(s) && !hasFill(s));
  const at = layer.shapes.findIndex(isLine);
  if (at < 0) layer.shapes.push(path);
  else layer.shapes.splice(at, 0, path);
  pushVector('塗りつぶし', layer, before);
  return true;
}

const fill = {
  cursor: 'crosshair',
  down(ev) {
    const layer = editableLayer();
    if (!layer) return false;
    const color = ev.button === 2 ? state.secondary : state.primary;
    useColor(color);
    if (layer.type === 'vector') {
      // 塗りのない形でも内側をクリックすれば塗れる(グループの中の図形も1つずつ)。Shift+クリックは線の色
      const hit = hitLeafForPaint(layer.shapes, ev.x, ev.y, hitTol());
      if (ev.shift) {
        if (!hit) return false;
        const before = structuredClone(layer.shapes);
        const s = hit.shape;
        s.stroke = toHex8(color);
        if (!(s.strokeWidth > 0)) s.strokeWidth = strokeWidth();
        pushVector('線の色', layer, before);
        return false;
      }
      // 図形のない所・開いた線(ペンの線など)の内側: 線で囲まれた所を、塗りのパスとして作る
      const s = hit?.shape;
      const loose = !!s && s.type === 'path' && !s.closed && !hasFill(s) && !hitShape(s, ev.x, ev.y, hitTol());
      if (!hit || loose) {
        if (fillVectorRegion(layer, ev, color, loose) || !hit) return false;
      }
      if (s.type === 'line') { toast('直線は塗りつぶせません(Shift+クリックで線の色を変更)'); return false; }
      const before = structuredClone(layer.shapes);
      s.fill = toHex8(color);
      pushVector('塗りつぶし', layer, before);
      return false;
    }
    fillRaster(layer, ev, color);
    return false;
  },
};

// ---- スポイト ----
// ツール(I): クリック・ドラッグでメイン(右ボタンはサブ)の色を拾う。
// startPick(kind): 「線と塗り」などのスポイトのボタンから。次のクリック1回で色を拾って、選んでいる図形の塗り / 線(図形がなければサブ / メイン)に入れ、元のツールに戻る。
// どちらも拡大鏡を出す(viewport.js の drawPickLoupe)
export const PICK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4l5 5"/><path d="M13 6l5 5"/><path d="M16 9L7 18l-3 1 1-3 9-9"/></svg>';

export function startPick(kind) {
  state.pick = { kind, prevTool: state.tool === 'eyedropper' ? 'move' : state.tool };
  emit('request-tool', 'eyedropper');
  toast('キャンバスの色をクリックで拾います(Esc でやめる)');
}

export function cancelPick() {
  if (!state.pick) return;
  const prev = state.pick.prevTool;
  state.pick = null;
  emit('request-tool', prev);
}

const eyedropper = {
  cursor: 'crosshair',
  down(ev) {
    if (state.pick) {
      const c = this.color(ev);
      const { kind } = state.pick;
      cancelPick();
      if (c) applyPicked(kind, toHex({ r: c[0], g: c[1], b: c[2] }));
      return false;
    }
    this.target = ev.button === 2 ? 'secondary' : 'primary';
    this.sample(ev);
    return true;
  },
  move(ev) { this.sample(ev); },
  up() {},
  color(ev) {
    const doc = state.doc;
    const region = { x: ev.px, y: ev.py, w: 1, h: 1 };
    const c = state.opts.sampleMerged || state.pick ? flatten(doc, 1, region) : flattenLayers(doc, [doc.activeLayer], 1, region);
    const d = c.getContext('2d').getImageData(0, 0, 1, 1).data;
    return d[3] === 0 ? null : d;
  },
  sample(ev) {
    const d = this.color(ev);
    if (!d) return;
    state[this.target] = { r: d[0], g: d[1], b: d[2], a: d[3] };
    emit('colors');
  },
};

// ---- 図形ツール(直線 / 四角 / 円) ----

function shapeStyle(kind, closed = true) {
  const o = state.opts;
  const stroke = kind === 'line' || o.shapeStroke || !closed ? toHex8(state.primary) : null;
  const fill = kind !== 'line' && closed && o.shapeFill ? toHex8(state.secondary) : null;
  const style = { stroke, fill, strokeWidth: strokeWidth() };
  // 前の図形のグラデーションも引き継ぐ(その後で色を選び直していなければ)
  const g = o.nextGrad || {};
  if (fill && g.fill?.color === fill) style.fillGrad = structuredClone(g.fill.grad);
  if (stroke && g.stroke?.color === stroke) style.strokeGrad = structuredClone(g.stroke.grad);
  return style;
}

function buildShape(kind, a, b) {
  const pixel = isPixelMode();
  const style = shapeStyle(kind);
  let x0 = pixel ? a.px : a.x, y0 = pixel ? a.py : a.y;
  let x1 = pixel ? b.px : b.x, y1 = pixel ? b.py : b.y;

  if (kind === 'line') {
    if (b.shift) {
      // 45度単位にスナップ
      const dx = x1 - x0, dy = y1 - y0;
      const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const cx = Math.round(Math.cos(ang)), cy = Math.round(Math.sin(ang));
      const d = cx && cy ? Math.max(Math.abs(dx), Math.abs(dy)) : Math.abs(cx ? dx : dy);
      x1 = x0 + cx * d;
      y1 = y0 + cy * d;
    }
    const o = pixel ? 0.5 : 0; // ドット絵はピクセル中心を通す
    return { type: 'line', x1: x0 + o, y1: y0 + o, x2: x1 + o, y2: y1 + o, ...style, fill: null };
  }

  if (b.shift) {
    const dx = x1 - x0, dy = y1 - y0;
    const d = Math.max(Math.abs(dx), Math.abs(dy));
    x1 = x0 + (Math.sign(dx) || 1) * d;
    y1 = y0 + (Math.sign(dy) || 1) * d;
  }
  if (b.alt) { x0 -= x1 - x0; y0 -= y1 - y0; } // 中心から
  let L = Math.min(x0, x1), T = Math.min(y0, y1), R = Math.max(x0, x1), B = Math.max(y0, y1);
  if (pixel) {
    // ピクセル座標(両端を含む)→ 外接矩形。線はその内側に収まるよう半分だけ内寄せ
    R += 1; B += 1;
    const inset = style.stroke ? style.strokeWidth / 2 : 0;
    L += inset; T += inset; R -= inset; B -= inset;
    if (R < L) L = R = (L + R) / 2;
    if (B < T) T = B = (T + B) / 2;
  }
  if (kind === 'rect') return { type: 'rect', x: L, y: T, w: R - L, h: B - T, ...style };
  return { type: 'ellipse', cx: (L + R) / 2, cy: (T + B) / 2, rx: (R - L) / 2, ry: (B - T) / 2, ...style };
}

function isDegenerate(s) {
  if (isPixelMode()) return false;
  const b = shapeBounds(s);
  return b.x1 - b.x0 < 1 && b.y1 - b.y0 < 1;
}

// ラスターレイヤーに図形を描いたプレビューを作る
function previewShapeOnRaster(layer, shape) {
  let p = state.preview;
  if (!p || p.layerId !== layer.id || !p.tiles) p = newPreview(layer);
  p.tiles.clear();
  if (isPixelMode()) {
    const r = rasterShapeRegion(shape, state.doc.limits);
    if (r) p.tiles.putImageData(r.img, r.x, r.y);
  } else {
    const b = shapeBounds(shape);
    const e = (shape.strokeWidth || 0) + 2;
    previewDraw(p, b.x0 - e, b.y0 - e, b.x1 + e, b.y1 + e, (ctx) => drawShape(ctx, shape));
  }
}

// 図形・パスは必ずベクターレイヤーに描く(1つずつ選んで動かせるように)。
// アクティブがラスターなら、すぐ上のベクターレイヤーを使うか、無ければ作る
export function shapeLayer() {
  const doc = state.doc;
  const active = doc.activeLayer;
  if (active?.type === 'vector') return editableLayer();
  const above = doc.layers[doc.activeIndex + 1];
  if (above?.type === 'vector' && above.visible && !above.locked) {
    setActiveLayer(above.id);
  } else {
    addLayer('vector');
    doc.activeLayer.name = '図形';
    emit('layers');
    toast('図形はベクターレイヤーに描きます(「図形」レイヤーを作りました)');
  }
  return editableLayer();
}

function makeShapeTool(kind, label) {
  return {
    cursor: 'crosshair',
    down(ev) {
      const layer = shapeLayer();
      if (!layer) return false;
      if (kind !== 'line' && !state.opts.shapeStroke && !state.opts.shapeFill) {
        toast('ツールオプションで「線」か「塗り」を有効にしてください');
        return false;
      }
      this.layer = layer;
      this.start = ev;
      this.update(ev);
      return true;
    },
    move(ev) { this.update(ev); },
    up(ev) {
      this.update(ev);
      const shape = this.shape;
      if (isDegenerate(shape)) { cancelPreview(); return; }
      useColor(shape.stroke);
      useColor(shape.fill);
      if (this.layer.type === 'vector') {
        state.preview = null;
        pushAppend(label, this.layer, shape, true);
      } else {
        commitPreview(label);
      }
    },
    update(ev) {
      const shape = (this.shape = buildShape(kind, this.start, ev));
      if (this.layer.type === 'vector') state.preview = { layerId: this.layer.id, shape };
      else previewShapeOnRaster(this.layer, shape);
      requestRender();
    },
  };
}

// ---- 多角形(正多角形。はじめは三角形) ----
// ドラッグ: 中心から外へ(距離 = 大きさ、向き = 最初の角の向き)/ Shift: まっすぐ上向き
// ドラッグ中に ↑↓←→ キー・マウスホイールで角の数を増減(3〜20)。できるのは閉じたパスなので、角丸・リグ・アウトライン化もそのまま使える

export const MAX_SIDES = 20;

const polygon = {
  cursor: 'crosshair',
  down(ev) {
    const layer = shapeLayer();
    if (!layer) return false;
    if (!state.opts.shapeStroke && !state.opts.shapeFill) {
      toast('ツールオプションで「線」か「塗り」を有効にしてください');
      return false;
    }
    this.layer = layer;
    this.start = ev;
    this.last = ev;
    this.update();
    return true;
  },
  move(ev) { this.last = ev; this.update(); },
  up(ev) {
    this.last = ev;
    this.update();
    const shape = this.shape;
    this.start = null;
    state.preview = null;
    if (isDegenerate(shape)) { requestRender(); return; }
    useColor(shape.stroke);
    useColor(shape.fill);
    pushAppend(`${state.opts.polygonSides}角形`, this.layer, shape, true);
  },
  // ドラッグ中の角の数の変更(app.js のホイール・キー入力から)
  changeSides(d) {
    const n = Math.max(3, Math.min(MAX_SIDES, state.opts.polygonSides + d));
    if (n === state.opts.polygonSides) return;
    state.opts.polygonSides = n;
    emit('tool');
    toast(`角の数: ${n}`);
    if (this.start) this.update();
  },
  wheel(dir) { this.changeSides(dir); },
  key(k) {
    const d = { arrowup: 1, arrowright: 1, arrowdown: -1, arrowleft: -1 }[k];
    if (!d) return false;
    this.changeSides(d);
    return true;
  },
  update() {
    const a = this.start, b = this.last;
    const r = Math.hypot(b.x - a.x, b.y - a.y);
    const angle = b.shift || r < 1e-6 ? -Math.PI / 2 : Math.atan2(b.y - a.y, b.x - a.x);
    const shape = (this.shape = {
      type: 'path', closed: true, nodes: polygonNodes(a.x, a.y, r, state.opts.polygonSides, angle), ...shapeStyle('polygon'),
    });
    state.preview = { layerId: this.layer.id, shape };
    requestRender();
  },
};

// ---- パス(簡易ベジェ) ----
// クリック: 角の点 / ドラッグ: 曲線の点(ハンドル付き) / 始点クリック: 閉じる
// 終点クリック・Enter: 開いたまま確定 / Esc: 取り消し

function pathPoint(ev) {
  return isPixelMode() ? { x: ev.px + 0.5, y: ev.py + 0.5 } : { x: ev.x, y: ev.y };
}

export function draftShape(d = state.pathDraft) {
  if (!d) return null;
  return { type: 'path', nodes: d.nodes, closed: d.closed, ...shapeStyle('path', d.closed) };
}

export function finishPath() {
  const d = state.pathDraft;
  state.pathDraft = null;
  if (!d || d.nodes.length < 2) { requestRender(); return; }
  const layer = state.doc.layerById(d.layerId);
  if (!layer || layer.locked || !layer.visible) { requestRender(); return; }
  const shape = structuredClone(draftShape(d));
  useColor(shape.stroke);
  useColor(shape.fill);
  if (layer.type === 'vector') {
    pushAppend('パス', layer, shape, true);
  } else {
    previewShapeOnRaster(layer, shape);
    commitPreview('パス');
  }
}

export function cancelPath() {
  state.pathDraft = null;
  requestRender();
}

const path = {
  cursor: 'crosshair',
  down(ev) {
    const layer = shapeLayer();
    if (!layer) return false;
    let d = state.pathDraft;
    if (d && d.layerId !== layer.id) { finishPath(); d = null; }
    const pt = pathPoint(ev);
    const near = (n) => Math.hypot(n.x - pt.x, n.y - pt.y) <= 6 / zoom();
    if (d && d.nodes.length >= 3 && near(d.nodes[0])) {
      d.closed = true;
      finishPath();
      return false;
    }
    if (d && d.nodes.length >= 2 && near(d.nodes[d.nodes.length - 1])) {
      finishPath();
      return false;
    }
    if (!d) d = state.pathDraft = { layerId: layer.id, nodes: [], closed: false };
    this.node = { x: pt.x, y: pt.y };
    d.nodes.push(this.node);
    requestRender();
    return true;
  },
  move(ev) {
    const n = this.node;
    if (!n) return;
    const h = { x: ev.x, y: ev.y };
    if (Math.hypot(h.x - n.x, h.y - n.y) < 3 / zoom()) {
      delete n.hout;
      delete n.hin;
    } else {
      n.hout = h;
      n.hin = { x: 2 * n.x - h.x, y: 2 * n.y - h.y };
    }
    requestRender();
  },
  up() { this.node = null; },
};

// ---- ラスターレイヤーの移動(矢印ツールから使う) ----

export const rasterMove = {
  down(ev) {
    const layer = editableLayer();
    if (!layer || layer.type !== 'raster') return false;
    this.layer = layer;
    this.start = { x: ev.x, y: ev.y };
    this.dx = this.dy = 0;
    state.preview = { layerId: layer.id, offset: { x: 0, y: 0 } };
    return true;
  },
  move(ev) {
    // 補間でぼけないよう整数に丸める
    const dx = Math.round(ev.x - this.start.x), dy = Math.round(ev.y - this.start.y);
    if (dx === this.dx && dy === this.dy) return;
    this.dx = dx;
    this.dy = dy;
    state.preview.offset = { x: dx, y: dy };
    requestRender();
  },
  up() {
    const layer = this.layer;
    state.preview = null;
    const b = layer.bounds();
    if ((!this.dx && !this.dy) || !b) { requestRender(); return; }
    const w = b.x1 - b.x0, h = b.y1 - b.y0;
    const img = layer.getImageData(b.x0, b.y0, w, h);
    const coords = [...layer.tiles.values()].map((t) => [t.tx, t.ty])
      .concat(tileCoordsInRect(b.x0 + this.dx, b.y0 + this.dy, b.x1 + this.dx, b.y1 + this.dy));
    recordTiles(state.history, 'レイヤーを移動', layer, coords, () => {
      layer.tiles.clear();
      layer.putImageData(img, b.x0 + this.dx, b.y0 + this.dy);
    });
    requestRender();
  },
};

// ---- アートボード ----
// 内側ドラッグ: 移動 / 辺・角ドラッグ: サイズ変更。中の絵は動かない(書き出し範囲だけが変わる)

const artboard = {
  cursor: 'default',
  handleAt(ev) {
    const a = state.doc.artboard;
    const tol = 6 / zoom();
    const nearL = Math.abs(ev.x - a.x) <= tol, nearR = Math.abs(ev.x - (a.x + a.w)) <= tol;
    const nearT = Math.abs(ev.y - a.y) <= tol, nearB = Math.abs(ev.y - (a.y + a.h)) <= tol;
    const inX = ev.x > a.x - tol && ev.x < a.x + a.w + tol;
    const inY = ev.y > a.y - tol && ev.y < a.y + a.h + tol;
    const h = { l: nearL && inY, r: nearR && inY, t: nearT && inX, b: nearB && inX };
    if (h.l || h.r || h.t || h.b) return h;
    if (ev.x > a.x && ev.x < a.x + a.w && ev.y > a.y && ev.y < a.y + a.h) return 'move';
    return null;
  },
  cursorFor(ev) {
    const h = this.handleAt(ev);
    if (!h) return 'default';
    if (h === 'move') return 'move';
    if ((h.l && h.t) || (h.r && h.b)) return 'nwse-resize';
    if ((h.r && h.t) || (h.l && h.b)) return 'nesw-resize';
    return h.l || h.r ? 'ew-resize' : 'ns-resize';
  },
  down(ev) {
    const h = this.handleAt(ev);
    if (!h) return false;
    const doc = state.doc;
    this.h = h;
    this.start = { x: ev.x, y: ev.y };
    this.orig = { ...doc.artboard };
    this.before = { artboard: { ...doc.artboard }, background: doc.background };
    return true;
  },
  move(ev) {
    const doc = state.doc;
    const max = doc.mode === 'pixel' ? 4096 : 16384;
    const dx = Math.round(ev.x - this.start.x), dy = Math.round(ev.y - this.start.y);
    const o = this.orig;
    let { x, y, w, h } = o;
    if (this.h === 'move') { x += dx; y += dy; }
    else {
      if (this.h.l) { const nx = Math.min(o.x + o.w - 1, o.x + dx); w = o.x + o.w - nx; x = nx; }
      if (this.h.r) w = Math.max(1, o.w + dx);
      if (this.h.t) { const ny = Math.min(o.y + o.h - 1, o.y + dy); h = o.y + o.h - ny; y = ny; }
      if (this.h.b) h = Math.max(1, o.h + dy);
      w = Math.min(w, max);
      h = Math.min(h, max);
    }
    doc.artboard = { x, y, w, h };
    emit('artboard');
    requestRender();
  },
  up() {
    const doc = state.doc;
    const a = this.before.artboard, b = doc.artboard;
    if (a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h) return;
    state.history.push(docPropsEntry('アートボードを変更', doc, this.before, { artboard: { ...b }, background: doc.background }));
  },
};

export const tools = {
  pen: makeBrush('pen'),
  eraser: makeBrush('eraser'),
  fill,
  eyedropper,
  line: makeShapeTool('line', '直線'),
  rect: makeShapeTool('rect', '四角形'),
  ellipse: makeShapeTool('ellipse', '楕円'),
  polygon,
  path,
  artboard,
  hand: { cursor: 'grab', down: () => false },
};
