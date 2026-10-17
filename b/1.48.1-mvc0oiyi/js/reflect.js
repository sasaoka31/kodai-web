// 反転ツール(F)(イラレのリフレクトツールに相当)
//   ドラッグ: 基準点を通る軸で反転(軸の向き = 基準点からマウスへの向き。Shift で 45°単位)/ Alt+ドラッグ: 反転したコピーを作る
//   クリック: 図形を選ぶ(Shift で追加)/ 選んだ図形の上・何もない所のクリック: 基準点をそこに置く
//   ツールオプション・右クリックメニュー: 左右反転 / 上下反転(ボタンは基準点で、矢印ツールからは中心で)
// 対象: ベクターレイヤーは選んだ図形、ラスターレイヤーはレイヤー全体の絵。基準点の既定は対象の中心
import { state, emit, requestRender, toast } from './state.js';
import { recordTransform } from './repeat.js';
import { hitTop, deformShape, shapeBounds, ensureIds } from './vector.js';
import { editableLayer, hitTol, pushVector, pushAppend } from './tools.js';
import { recordTiles } from './history.js';
import { tileCoordsInRect } from './tiles.js';
import { selectedItems, selectionLayer, setSelection } from './select.js';
import { withNewIds } from './clipboard.js';
import { gradAngle } from './pixelfx.js';

const S = (p) => state.view.toScreen(p);
const RAD = Math.PI / 180;

// ---- 反転の計算 ----

// cos・sin(2·deg)。45°単位はちょうどの値にする(sin 180° が 1e-16 になって座標が少しずれないように)
function cs2(deg) {
  const a = 2 * deg;
  const q = Math.round(a / 90);
  if (Math.abs(a - q * 90) < 1e-9) return [[1, 0], [0, 1], [-1, 0], [0, -1]][((q % 4) + 4) % 4];
  return [Math.cos(a * RAD), Math.sin(a * RAD)];
}

// 点 (cx,cy) を通り、角度 deg(0 = 横、90 = 縦)の軸について点を映す
function reflector(cx, cy, deg) {
  const [c, s] = cs2(deg);
  return (x, y) => {
    const dx = x - cx, dy = y - cy;
    return { x: cx + dx * c + dy * s, y: cy + dx * s - dy * c };
  };
}

const axisMod = (deg) => ((deg % 180) + 180) % 180;
const isAxisAligned = (deg) => { const d = axisMod(deg); return Math.abs(d) < 1e-9 || Math.abs(d - 90) < 1e-9; };

// 色のグラデーション・粗さのグラデーションの向きも映す(元の図形と共有していることがあるので新しいものを作る)
function reflectGrads(orig, out, f, deg) {
  for (const k of ['fillGrad', 'strokeGrad']) {
    const g = orig[k];
    if (!g) continue;
    if (g.type === 'radial') {
      const b0 = shapeBounds(orig), b1 = shapeBounds(out);
      const p = f(b0.x0 + (g.cx ?? 0.5) * (b0.x1 - b0.x0), b0.y0 + (g.cy ?? 0.5) * (b0.y1 - b0.y0));
      out[k] = { ...g, cx: (p.x - b1.x0) / (b1.x1 - b1.x0 || 1), cy: (p.y - b1.y0) / (b1.y1 - b1.y0 || 1) };
    } else {
      out[k] = { ...g, angle: (((2 * deg - (g.angle ?? 0) + 540) % 360) + 360) % 360 - 180 };
    }
  }
  if (orig.pixelGrad) out.pixelGrad = { ...orig.pixelGrad, angle: (((2 * deg - gradAngle(orig.pixelGrad)) % 360) + 360) % 360 };
  return out;
}

// 図形を反転(左右・上下なら四角・楕円は種類を保つ。ほかはパスになる。文字は鏡に映した文字になる)
export function reflectShape(s, cx, cy, deg) {
  const f = reflector(cx, cy, deg);
  let out;
  if (s.type === 'group') out = { ...s, children: s.children.map((c) => reflectShape(c, cx, cy, deg)) };
  else if (s.type === 'rect' && isAxisAligned(deg)) {
    const a = f(s.x, s.y), b = f(s.x + s.w, s.y + s.h);
    out = { ...s, x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
  } else if (s.type === 'ellipse' && isAxisAligned(deg)) {
    const c = f(s.cx, s.cy);
    out = { ...s, cx: c.x, cy: c.y };
  } else out = deformShape(s, f);
  return reflectGrads(s, out, f, deg);
}

// 画像を反転する行列(元画像の (u,v) → ワールド。元画像は base の位置に置かれている)
function reflectMatrix(cx, cy, deg, base) {
  const [c, s] = cs2(deg);
  const e = cx - c * cx - s * cy, f = cy - s * cx + c * cy;
  return [c, s, s, -c, c * base.x + s * base.y + e, s * base.x - c * base.y + f];
}

// ラスター: 反転した絵(copy なら元の絵と重ねたもの)を作る → { canvas, x, y }
function rasterResult(R, cx, cy, deg, copy) {
  const m = reflectMatrix(cx, cy, deg, R.base);
  const pts = [[0, 0], [R.base.w, 0], [0, R.base.h], [R.base.w, R.base.h]].map(([u, v]) => ({ x: m[0] * u + m[2] * v + m[4], y: m[1] * u + m[3] * v + m[5] }));
  if (copy) pts.push({ x: R.base.x, y: R.base.y }, { x: R.base.x + R.base.w, y: R.base.y + R.base.h });
  const x0 = Math.floor(Math.min(...pts.map((p) => p.x))), y0 = Math.floor(Math.min(...pts.map((p) => p.y)));
  const x1 = Math.ceil(Math.max(...pts.map((p) => p.x))), y1 = Math.ceil(Math.max(...pts.map((p) => p.y)));
  const c = document.createElement('canvas');
  c.width = Math.max(1, x1 - x0);
  c.height = Math.max(1, y1 - y0);
  const x = c.getContext('2d', { willReadFrequently: true });
  if (copy) x.drawImage(R.canvas, R.base.x - x0, R.base.y - y0);
  // 45°単位ならドットがそのまま移るので補間しない(ぼけないように)
  x.imageSmoothingEnabled = Math.abs(axisMod(deg) % 45) > 1e-9;
  x.imageSmoothingQuality = 'high';
  x.setTransform(m[0], m[1], m[2], m[3], m[4] - x0, m[5] - y0);
  x.drawImage(R.canvas, 0, 0);
  return { canvas: c, x: x0, y: y0 };
}

function rasterSource(layer) {
  const b = layer.bounds();
  if (!b) return null;
  const base = { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 };
  const canvas = document.createElement('canvas');
  canvas.width = base.w;
  canvas.height = base.h;
  canvas.getContext('2d').putImageData(layer.getImageData(base.x, base.y, base.w, base.h), 0, 0);
  return { base, canvas };
}

function commitRaster(layer, out, label) {
  const img = out.canvas.getContext('2d').getImageData(0, 0, out.canvas.width, out.canvas.height);
  const coords = [...layer.tiles.values()].map((t) => [t.tx, t.ty])
    .concat(tileCoordsInRect(out.x, out.y, out.x + img.width, out.y + img.height));
  recordTiles(state.history, label, layer, coords, () => {
    layer.tiles.clear();
    layer.putImageData(img, out.x, out.y);
  });
}

// ---- 対象と基準点 ----

// 反転する対象: ベクターは選んだ図形、ラスターはレイヤー全体
function target() {
  const layer = state.doc.activeLayer;
  if (!layer) return null;
  if (layer.type === 'raster') {
    const b = layer.bounds();
    return b ? { kind: 'raster', layer, key: `raster:${layer.id}`, b } : null;
  }
  const items = selectedItems();
  if (!items.length) return null;
  let b = null;
  for (const it of items) {
    const r = shapeBounds(it.shape);
    b = b ? { x0: Math.min(b.x0, r.x0), y0: Math.min(b.y0, r.y0), x1: Math.max(b.x1, r.x1), y1: Math.max(b.y1, r.y1) } : r;
  }
  return { kind: 'vector', layer: selectionLayer(), items, key: `${selectionLayer().id}:${state.selection.ids.join(',')}`, b };
}

// 置いた基準点(対象が変わると中心に戻る)
let pivot = null; // { key, x, y }

function pivotOf(t, useCustom = true) {
  if (useCustom && pivot && pivot.key === t.key) return { x: pivot.x, y: pivot.y, custom: true };
  return { x: (t.b.x0 + t.b.x1) / 2, y: (t.b.y0 + t.b.y1) / 2, custom: false };
}

export function hasCustomPivot() {
  const t = state.doc && target();
  return !!(t && pivot && pivot.key === t.key);
}

export function resetPivot() {
  pivot = null;
  emit('selection');
  requestRender();
}

// ---- まとめて反転(ボタン・メニュー) ----

// axis: 'h' = 左右反転(縦の軸)/ 'v' = 上下反転(横の軸)。usePivot: 反転ツールで置いた基準点を使う
export function flip(axis, { usePivot = state.tool === 'reflect', copy = false, record = true } = {}) {
  const t = target();
  if (!t) { toast(state.doc.activeLayer?.type === 'raster' ? 'このレイヤーには反転する絵がありません' : '反転する図形を選んでください'); return; }
  if (!t.layer.visible) { toast('非表示のレイヤーは反転できません'); return; }
  if (t.layer.locked) { toast('レイヤーがロックされています'); return; }
  const p = pivotOf(t, usePivot);
  applyReflect(t, p, axis === 'h' ? 90 : 0, copy, axis === 'h' ? '左右反転' : '上下反転');
  if (record && t.kind !== 'raster') recordTransform({ kind: 'flip', axis, copy }); // Ctrl+D でくり返せるように(repeat.js)
}

function applyReflect(t, p, deg, copy, label) {
  if (t.kind === 'raster') {
    const R = rasterSource(t.layer);
    commitRaster(t.layer, rasterResult(R, p.x, p.y, deg, copy), label);
  } else {
    const layer = t.layer;
    if (copy) {
      const copies = t.items.map((it) => reflectShape(withNewIds(it.shape), p.x, p.y, deg));
      pushAppend(`${label}(コピー)`, layer, copies);
      setSelection(layer, copies.map((s) => s.id));
      if (pivot && pivot.key === t.key) pivot = { ...pivot, key: target().key }; // 基準点はコピーにも引き継ぐ
    } else {
      const before = structuredClone(layer.shapes);
      const ids = new Set(t.items.map((it) => it.shape.id));
      layer.shapes = layer.shapes.map((s) => (ids.has(s.id) ? reflectShape(s, p.x, p.y, deg) : s));
      pushVector(label, layer, before);
    }
  }
  emit('selection');
  requestRender();
}

// ---- ツール本体 ----

const DRAG_START = 4; // これ以上動かしたらドラッグ(画面の px)

export const reflectTool = {
  cursor: 'crosshair',

  down(ev) {
    this.drag = null;
    if (ev.button !== 0) return false;
    const layer = editableLayer();
    if (!layer) return false;
    if (layer.type === 'vector') {
      ensureIds(layer.shapes);
      const i = hitTop(layer.shapes, ev.x, ev.y, hitTol());
      const hit = i >= 0 ? layer.shapes[i] : null;
      const ids = state.selection?.layerId === layer.id ? state.selection.ids : [];
      if (hit && !ids.includes(hit.id)) {
        // まだ選んでいない図形: 選ぶだけ(Shift で追加)
        setSelection(layer, ev.shift ? [...ids, hit.id] : [hit.id]);
        return false;
      }
      if (!ids.length) { toast('反転する図形をクリックで選んでください'); return false; }
    }
    const t = target();
    if (!t) { toast('このレイヤーには反転する絵がありません'); return false; }
    this.drag = { t, p: pivotOf(t), start: { sx: ev.sx, sy: ev.sy, x: ev.x, y: ev.y }, moved: false };
    if (t.kind === 'raster') this.drag.R = rasterSource(t.layer);
    else {
      this.drag.before = structuredClone(t.layer.shapes);
      this.drag.ids = new Set(t.items.map((it) => it.shape.id));
    }
    return true;
  },

  axisAngle(ev) {
    const d = this.drag;
    let deg = Math.atan2(ev.y - d.p.y, ev.x - d.p.x) / RAD;
    if (ev.shift) deg = Math.round(deg / 45) * 45;
    return deg;
  },

  move(ev) {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(ev.sx - d.start.sx, ev.sy - d.start.sy) < DRAG_START) return;
    d.moved = true;
    d.deg = this.axisAngle(ev);
    d.copy = !!ev.alt;
    const { t, p } = d;
    if (t.kind === 'raster') {
      const out = rasterResult(d.R, p.x, p.y, d.deg, d.copy);
      state.preview = { layerId: t.layer.id, transform: { canvas: out.canvas, x: out.x, y: out.y, w: out.canvas.width, h: out.canvas.height } };
    } else {
      const shapes = d.before.map((s) => (d.ids.has(s.id) ? reflectShape(s, p.x, p.y, d.deg) : s));
      // コピーのときは元の図形を残して、反転したものを上に重ねて見せる
      t.layer.shapes = d.copy ? [...d.before, ...shapes.filter((s) => d.ids.has(s.id))] : shapes;
      t.layer.touch();
    }
    requestRender();
  },

  up(ev) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const { t, p } = d;
    if (!d.moved) {
      // クリック: 基準点をそこに置く
      pivot = { key: t.key, x: ev.x, y: ev.y };
      if (t.kind === 'raster') pivot = { ...pivot, x: Math.round(ev.x * 2) / 2, y: Math.round(ev.y * 2) / 2 }; // ドットがずれないように 0.5px 単位
      emit('selection');
      requestRender();
      return;
    }
    state.preview = null;
    if (t.kind === 'vector') { t.layer.shapes = d.before; t.layer.touch(); }
    applyReflect(t, p, d.deg, d.copy, '反転');
  },
};

// ---- 画面への表示(基準点と軸) ----

export function drawReflectOverlay(ctx) {
  if (state.tool !== 'reflect' || !state.doc) return;
  const d = reflectTool.drag;
  const t = d?.t || target();
  if (!t) return;
  const p = d?.p || pivotOf(t);
  const c = S(p);
  ctx.save();
  ctx.lineWidth = 1;
  if (d?.moved) {
    // 軸(画面の端から端まで)
    const a = d.deg * RAD, L = 1e4;
    ctx.strokeStyle = '#3b82f6';
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(c.x - Math.cos(a) * L, c.y - Math.sin(a) * L);
    ctx.lineTo(c.x + Math.cos(a) * L, c.y + Math.sin(a) * L);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (t.kind === 'raster' && !d?.moved) {
    // ラスターは対象の枠も出す
    const q0 = S({ x: t.b.x0, y: t.b.y0 }), q1 = S({ x: t.b.x1, y: t.b.y1 });
    ctx.strokeStyle = 'rgba(59,130,246,0.55)';
    ctx.strokeRect(Math.round(q0.x) + 0.5, Math.round(q0.y) + 0.5, Math.round(q1.x - q0.x), Math.round(q1.y - q0.y));
  }
  // 基準点(円と十字)
  for (const [col, w] of [['#fff', 3], ['#3b82f6', 1.2]]) {
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
    ctx.moveTo(c.x - 9, c.y); ctx.lineTo(c.x + 9, c.y);
    ctx.moveTo(c.x, c.y - 9); ctx.lineTo(c.x, c.y + 9);
    ctx.stroke();
  }
  ctx.restore();
}
