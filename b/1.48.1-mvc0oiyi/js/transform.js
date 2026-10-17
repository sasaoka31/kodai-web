// 自由変形ツール(イラレの自由変形に相当)
//   枠の中をドラッグ: 移動 / 角: その角だけ動かす(自由な形に歪める)/ 辺(真ん中の点): その辺ごと平行に動かす(正方形 → 平行四辺形)
//   Shift: 真横か縦にだけ動かす / Ctrl: 中心から(反対の角・辺も逆向きに動く)/ Alt+角: 拡大縮小 / Alt+辺: 片方向に伸縮
//   枠の外(角の近く)をドラッグ: 回転(Shift で15°単位)
//   Enter: 確定 / Esc: 取り消し
// 対象: ベクターレイヤーはクリックした図形、ラスターレイヤーはレイヤー全体の絵。
import { state, emit, requestRender, toast, isPixelMode } from './state.js';
import { quadGrid, mapPoint, warpImage, gridBounds } from './warp.js';
import { hitTop, shapeBounds, translateShape, deformShape, ensureIds } from './vector.js';
import { editableLayer, hitTol, pushVector } from './tools.js';
import { recordTiles } from './history.js';
import { tileCoordsInRect } from './tiles.js';

const MAX_WARP_AREA = 64e6;

// ---- 図形の写像 ----

export function mapShape(s, base, grid) {
  if (s.type === 'group') return { ...s, children: s.children.map((c) => mapShape(c, base, grid)) };
  const m = (p) => mapPoint(grid, base, p.x, p.y);
  if (s.type === 'line') {
    const a = m({ x: s.x1, y: s.y1 }), b = m({ x: s.x2, y: s.y2 });
    return { ...s, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  }
  const p = deformShape(s, (x, y) => m({ x, y }));
  // 線幅は面積の変化に合わせて調整
  if (p.strokeWidth) {
    const b = gridBounds(grid);
    const ratio = Math.sqrt(Math.max(1, (b.x1 - b.x0) * (b.y1 - b.y0)) / Math.max(1, base.w * base.h));
    p.strokeWidth = Math.max(0.1, s.strokeWidth * Math.min(4, Math.max(0.25, ratio)));
  }
  return p;
}

// ---- 状態 ----
// state.transform = { layerId, kind, base, quad:[TL,TR,BR,BL], orig?(Map id→図形), before?, src?, srcCanvas? }

const rectQuad = (b) => [
  { x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h },
];

function nonDegenerate(b) {
  const out = { ...b };
  if (out.w < 1e-3) { out.x -= 0.5; out.w = 1; }
  if (out.h < 1e-3) { out.y -= 0.5; out.h = 1; }
  return out;
}

// 選択中の図形(クリックした図形が選択に含まれていなければその図形だけ)をまとめて変形
function startVector(layer, index) {
  ensureIds(layer.shapes);
  const clicked = layer.shapes[index];
  const sel = state.selection?.layerId === layer.id ? state.selection.ids : [];
  const ids = sel.includes(clicked.id) ? sel : [clicked.id];
  const targets = layer.shapes.filter((s) => ids.includes(s.id));
  let r = null;
  for (const s of targets) {
    const b = shapeBounds(s);
    r = r ? { x0: Math.min(r.x0, b.x0), y0: Math.min(r.y0, b.y0), x1: Math.max(r.x1, b.x1), y1: Math.max(r.y1, b.y1) } : b;
  }
  const base = nonDegenerate({ x: r.x0, y: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0 });
  state.selection = { layerId: layer.id, ids: [...ids] };
  state.transform = {
    layerId: layer.id, kind: 'vector', base, quad: rectQuad(base),
    orig: new Map(targets.map((s) => [s.id, structuredClone(s)])), before: structuredClone(layer.shapes),
  };
  emit('selection');
}

function startRaster(layer) {
  const b = layer.bounds();
  if (!b) return false;
  const base = { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 };
  const src = layer.getImageData(base.x, base.y, base.w, base.h);
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = base.w;
  srcCanvas.height = base.h;
  srcCanvas.getContext('2d').putImageData(src, 0, 0);
  state.transform = { layerId: layer.id, kind: 'raster', base, quad: rectQuad(base), src, srcCanvas };
  emit('selection');
  return true;
}

const isIdentity = (T) => T.quad.every((p, i) => {
  const q = rectQuad(T.base)[i];
  return Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6;
});

// 平行移動だけなら図形の種類(四角・円)を保ったまま動かす
function translationOnly(T) {
  const r = rectQuad(T.base);
  const dx = T.quad[0].x - r[0].x, dy = T.quad[0].y - r[0].y;
  const ok = T.quad.every((p, i) => Math.abs(p.x - r[i].x - dx) < 1e-6 && Math.abs(p.y - r[i].y - dy) < 1e-6);
  return ok ? { dx, dy } : null;
}

// 平行四辺形(回転・拡大縮小・平行な歪み)なら、画像は行列1つで描ける → { 行列 }。歪みなら null
function affineOf(T) {
  const [a, b, c, d] = T.quad;
  const tol = 1e-3 * Math.max(1, T.base.w, T.base.h);
  if (Math.abs(a.x + c.x - b.x - d.x) > tol || Math.abs(a.y + c.y - b.y - d.y) > tol) return null;
  const w = T.base.w, h = T.base.h;
  // 元画像の (u,v) → a + (b-a)·u/w + (d-a)·v/h
  return [(b.x - a.x) / w, (b.y - a.y) / w, (d.x - a.x) / h, (d.y - a.y) / h, a.x, a.y];
}

function updatePreview() {
  const T = state.transform;
  const doc = state.doc;
  const layer = doc.layerById(T.layerId);
  if (T.kind === 'vector') {
    const t = translationOnly(T);
    const grid = quadGrid(T.quad);
    const shapes = layer.shapes;
    for (let i = 0; i < shapes.length; i++) {
      const o = T.orig.get(shapes[i].id);
      if (o) shapes[i] = t ? translateShape(o, t.dx, t.dy) : mapShape(o, T.base, grid);
    }
    layer.touch();
  } else {
    const m = affineOf(T);
    if (m) {
      // 回転・拡大縮小は画像を行列で描くだけ(軽い)
      state.preview = { layerId: T.layerId, affine: { canvas: T.srcCanvas, matrix: m } };
    } else {
      const grid = quadGrid(T.quad);
      const b = gridBounds(grid);
      const area = (b.x1 - b.x0) * (b.y1 - b.y0);
      // 歪みは画素ごとの計算が要るので、ドラッグ中は解像度を落としてプレビュー
      const step = Math.max(1, Math.ceil(Math.sqrt(area / 6e5)));
      const w = warpImage(T.src, T.base, grid, { step });
      const c = document.createElement('canvas');
      c.width = w.img.width;
      c.height = w.img.height;
      c.getContext('2d').putImageData(w.img, 0, 0);
      state.preview = { layerId: T.layerId, transform: { canvas: c, x: w.x, y: w.y, w: w.img.width * step, h: w.img.height * step } };
    }
  }
  requestRender();
}

export function applyTransform() {
  const T = state.transform;
  if (!T) return;
  state.transform = null;
  const layer = state.doc.layerById(T.layerId);
  if (!layer || isIdentity(T)) {
    if (layer && T.kind === 'vector') { layer.shapes = structuredClone(T.before); layer.touch(); }
    state.preview = null;
    requestRender();
    return;
  }
  if (T.kind === 'vector') {
    pushVector('変形', layer, T.before);
  } else {
    state.preview = null;
    const grid = quadGrid(T.quad);
    const b = gridBounds(grid);
    if ((b.x1 - b.x0) * (b.y1 - b.y0) > MAX_WARP_AREA) { toast('変形後のサイズが大きすぎます'); requestRender(); return; }
    let out;
    const m = affineOf(T);
    if (m) {
      // 行列で描いて確定(なめらかに補間される)
      const c = document.createElement('canvas');
      c.width = Math.max(1, b.x1 - b.x0);
      c.height = Math.max(1, b.y1 - b.y0);
      const x = c.getContext('2d', { willReadFrequently: true });
      x.imageSmoothingQuality = 'high';
      x.setTransform(m[0], m[1], m[2], m[3], m[4] - b.x0, m[5] - b.y0);
      x.drawImage(T.srcCanvas, 0, 0);
      out = { img: x.getImageData(0, 0, c.width, c.height), x: b.x0, y: b.y0 };
    } else {
      out = warpImage(T.src, T.base, grid);
    }
    const coords = [...layer.tiles.values()].map((t) => [t.tx, t.ty])
      .concat(tileCoordsInRect(out.x, out.y, out.x + out.img.width, out.y + out.img.height));
    recordTiles(state.history, '変形', layer, coords, () => {
      layer.tiles.clear();
      layer.putImageData(out.img, out.x, out.y);
    });
  }
  emit('selection');
  requestRender();
}

export function cancelTransform() {
  const T = state.transform;
  if (!T) return;
  state.transform = null;
  const layer = state.doc.layerById(T.layerId);
  if (layer && T.kind === 'vector') { layer.shapes = structuredClone(T.before); layer.touch(); }
  state.preview = null;
  emit('selection');
  requestRender();
}

// ---- 操作 ----

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const center = (q) => mul(q.reduce((s, p) => add(s, p), { x: 0, y: 0 }), 0.25);

function pointInQuad(q, p) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (c !== 0) {
      if (sign && Math.sign(c) !== sign) return false;
      sign = Math.sign(c);
    }
  }
  return true;
}

// 画面座標で判定したハンドル
export function transformHandles(T, view) {
  const q = T.quad.map((p) => view.toScreen(p));
  const hs = q.map((p, i) => ({ mode: 'corner', idx: i, p }));
  for (let i = 0; i < 4; i++) hs.push({ mode: 'edge', idx: i, p: mid(q[i], q[(i + 1) % 4]) });
  return hs;
}

function hitHandle(T, ev) {
  const view = state.view;
  const s = { x: ev.sx, y: ev.sy };
  for (const h of transformHandles(T, view)) if (Math.hypot(h.p.x - s.x, h.p.y - s.y) <= 7) return h;
  const q = T.quad.map((p) => view.toScreen(p));
  if (pointInQuad(q, s)) return { mode: 'move' };
  // 角の外側 24px 以内なら回転
  for (const p of q) if (Math.hypot(p.x - s.x, p.y - s.y) <= 24) return { mode: 'rotate' };
  return null;
}

export function transformCursor(ev) {
  const T = state.transform;
  if (!T || T.layerId !== state.doc.activeLayer?.id) return 'default';
  const h = hitHandle(T, ev);
  if (!h) return 'default';
  if (h.mode === 'move') return 'move';
  if (h.mode === 'rotate') return 'alias';
  return 'crosshair';
}

export const transformTool = {
  cursor: 'default',

  down(ev) {
    const layer = state.doc.activeLayer;
    let T = state.transform;
    if (T && T.layerId !== layer?.id) { applyTransform(); T = null; }
    if (T) {
      const h = hitHandle(T, ev);
      if (h) return this.begin(h, ev);
      applyTransform();
      T = null;
    }
    if (!editableLayer()) return false;
    if (layer.type === 'vector') {
      const i = hitTop(layer.shapes, ev.x, ev.y, hitTol());
      if (i < 0) { state.selection = null; emit('selection'); requestRender(); return false; }
      startVector(layer, i);
    } else if (!startRaster(layer)) {
      toast('このレイヤーには変形する絵がありません');
      return false;
    }
    requestRender();
    return this.begin({ mode: 'move' }, ev);
  },

  begin(h, ev) {
    const T = state.transform;
    this.drag = { ...h, startQuad: T.quad.map((p) => ({ ...p })), start: { x: ev.x, y: ev.y } };
    return true;
  },

  move(ev) {
    const T = state.transform;
    const d = this.drag;
    if (!T || !d) return;
    const sq = d.startQuad;
    let delta = sub({ x: ev.x, y: ev.y }, d.start);
    // Shift: 真横か縦(真上・真下)にだけ動かす(動かした量の大きい向き)
    if (ev.shift && d.mode !== 'rotate') delta = Math.abs(delta.x) >= Math.abs(delta.y) ? { x: delta.x, y: 0 } : { x: 0, y: delta.y };
    if (isPixelMode() && d.mode !== 'rotate') delta = { x: Math.round(delta.x), y: Math.round(delta.y) };
    let q;
    if (d.mode === 'move') {
      q = sq.map((p) => add(p, delta));
    } else if (d.mode === 'rotate') {
      const c = center(sq);
      let ang = Math.atan2(ev.y - c.y, ev.x - c.x) - Math.atan2(d.start.y - c.y, d.start.x - c.x);
      if (ev.shift) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
      const cs = Math.cos(ang), sn = Math.sin(ang);
      q = sq.map((p) => {
        const v = sub(p, c);
        return { x: c.x + v.x * cs - v.y * sn, y: c.y + v.x * sn + v.y * cs };
      });
    } else if (d.mode === 'corner') {
      const i = d.idx, k = (i + 2) % 4;
      q = sq.map((p) => ({ ...p }));
      if (!ev.alt) {
        q[i] = add(sq[i], delta); // その角だけ動かす(自由な形に歪める)
        if (ev.ctrl) q[k] = sub(sq[k], delta); // Ctrl: 中心から(反対の角も逆向きに動く)
      } else {
        // Alt: 拡大縮小(縦横比は保つ)。反対の角を固定、Ctrl なら中心を固定
        const o = ev.ctrl ? center(sq) : sq[k];
        const v0 = sub(sq[i], o);
        const a = dot(sub(add(sq[i], delta), o), v0) / Math.max(1e-9, dot(v0, v0));
        q = sq.map((p) => add(o, mul(sub(p, o), a)));
      }
    } else if (d.mode === 'edge') {
      const i = d.idx, j = (i + 1) % 4;
      const oi = (i + 3) % 4, oj = (i + 2) % 4; // 反対側の辺(i に対応するのが oi)
      q = sq.map((p) => ({ ...p }));
      if (!ev.alt) {
        q[i] = add(sq[i], delta); // 辺ごと平行に動かす(正方形 → 平行四辺形)
        q[j] = add(sq[j], delta);
        if (ev.ctrl) { q[oi] = sub(sq[oi], delta); q[oj] = sub(sq[oj], delta); } // Ctrl: 反対の辺も逆向きに
      } else if (!ev.ctrl) {
        // Alt: 片方向に伸縮(反対の辺を固定)
        const m0 = mid(sq[oi], sq[oj]);
        const dir = sub(mid(sq[i], sq[j]), m0);
        const s = dot(sub(add(mid(sq[i], sq[j]), delta), m0), dir) / Math.max(1e-9, dot(dir, dir));
        q[i] = add(sq[oi], mul(sub(sq[i], sq[oi]), s));
        q[j] = add(sq[oj], mul(sub(sq[j], sq[oj]), s));
      } else {
        // Ctrl+Alt: 中心を固定して片方向に伸縮(反対の辺も逆向きに)
        const dir = sub(mid(sq[i], sq[j]), center(sq));
        const s = dot(sub(add(mid(sq[i], sq[j]), delta), center(sq)), dir) / Math.max(1e-9, dot(dir, dir));
        const e = mul(dir, s - 1);
        q[i] = add(sq[i], e); q[j] = add(sq[j], e);
        q[oi] = sub(sq[oi], e); q[oj] = sub(sq[oj], e);
      }
    }
    T.quad = q;
    updatePreview();
  },

  up() {
    this.drag = null;
  },
};
