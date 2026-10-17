// パスファインダー(イラレと同じ4つ): 合体・前面オブジェクトで型抜き・交差・中マド
//   選んだ図形(グループは中身全部で1つ)の「形」を高解像度で描いてアルファにし、画素ごとに組み合わせてから
//   輪郭をなぞって1つのパス(穴があれば複合パス)にする(アウトライン化・縁取りと同じ仕組み。見た目の差はほぼ出ない)。
//   形 = 閉じた図形(四角・楕円・閉じたパス・多角形・文字)は塗りの範囲(塗りがなくても形の内側)、
//        直線・開いたパスは線の範囲(線幅)
//   できた図形の色: 合体・交差・中マドは一番前の図形、型抜きは一番後ろの図形の色(線・塗り・線幅・グラデーション)
import { toast } from './state.js';
import { selectedItems, modifySelection, setSelection, selectionLayer } from './select.js';
import { shapePath, fillRule, visualBounds, hasStroke } from './vector.js';
import { drawText } from './text.js';
import { traceAlpha, loopsToPath, leaves } from './outline.js';

const MAX_PX = 6e6;
const PAD = 2;

export const PATHFINDER = {
  unite: { label: '合体', hint: '選んだ図形を1つの形にまとめる' },
  minus: { label: '前面で型抜き', hint: '一番後ろの図形から、前の図形の形を抜く' },
  intersect: { label: '交差', hint: '全部が重なっている所だけ残す' },
  exclude: { label: '中マド', hint: '重なっている所を抜く(奇数枚が重なる所だけ残す)' },
};

const isClosed = (s) => s.type === 'rect' || s.type === 'ellipse' || s.type === 'text' || (s.type === 'path' && s.closed);

function drawRegion(ctx, s) {
  ctx.fillStyle = ctx.strokeStyle = '#000';
  if (s.type === 'text') { drawText(ctx, s, { fill: '#000', stroke: null }); return; }
  const p = shapePath(s);
  if (isClosed(s)) { ctx.fill(p, fillRule(s)); return; }
  if (hasStroke(s)) {
    ctx.lineWidth = s.strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(p);
  }
}

// 図形(グループなら中身全部)の形のアルファ
function mask(shape, b, scale, W, H) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.setTransform(scale, 0, 0, scale, PAD - b.x0 * scale, PAD - b.y0 * scale);
  for (const s of leaves(shape)) drawRegion(x, s);
  const d = x.getImageData(0, 0, W, H).data;
  const a = new Uint8Array(W * H);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
  return a;
}

// 色などを引き継ぐ図形(グループなら塗りのある最初の図形)
function styleOf(shape) {
  const ls = leaves(shape);
  const s = ls.find((k) => k.fill) || ls[0] || shape;
  const out = { fill: s.fill ?? null, stroke: s.stroke ?? null, strokeWidth: s.strokeWidth || 0 };
  for (const k of ['fillGrad', 'strokeGrad']) if (s[k]) out[k] = structuredClone(s[k]);
  if (!out.fill && !isClosed(s) && s.stroke) { out.fill = s.stroke; out.stroke = null; } // 線だけの直線 → 塗りの形に
  for (const k of ['pixel', 'pixelGrad', 'rigBind']) if (shape[k]) out[k] = structuredClone(shape[k]);
  return out;
}

// op: unite|minus|intersect|exclude。items は背面から前面の順
export function combine(op, items) {
  const bs = items.map((it) => visualBounds(it.shape));
  const b0 = bs.reduce((r, b) => ({ x0: Math.min(r.x0, b.x0), y0: Math.min(r.y0, b.y0), x1: Math.max(r.x1, b.x1), y1: Math.max(r.y1, b.y1) }));
  const b = { x0: b0.x0 - 1, y0: b0.y0 - 1, x1: b0.x1 + 1, y1: b0.y1 + 1 };
  const w0 = b.x1 - b.x0, h0 = b.y1 - b.y0;
  const scale = Math.min(8, Math.sqrt(MAX_PX / Math.max(1, w0 * h0)));
  const W = Math.ceil(w0 * scale) + PAD * 2, H = Math.ceil(h0 * scale) + PAD * 2;
  const ms = items.map((it) => mask(it.shape, b, scale, W, H));
  const out = new Uint8Array(W * H);
  for (let i = 0; i < out.length; i++) {
    let v;
    if (op === 'unite') { v = 0; for (const m of ms) if (m[i] > v) v = m[i]; }
    else if (op === 'intersect') { v = 255; for (const m of ms) if (m[i] < v) v = m[i]; }
    else if (op === 'minus') { let f = 0; for (let k = 1; k < ms.length; k++) if (ms[k][i] > f) f = ms[k][i]; v = Math.min(ms[0][i], 255 - f); }
    else { let t = 0; for (const m of ms) { const a = m[i] / 255; t = t + a - 2 * t * a; } v = Math.round(t * 255); } // 中マド(ぼかしの縁もなめらかに)
    out[i] = v;
  }
  const toWorld = (p) => ({ x: (p.x + 0.5 - PAD) / scale + b.x0, y: (p.y + 0.5 - PAD) / scale + b.y0 });
  return loopsToPath(traceAlpha(out, W, H, toWorld), scale);
}

export function pathfinder(op) {
  const items = selectedItems();
  const info = PATHFINDER[op];
  if (!info) return;
  if (items.length < 2) { toast(`${info.label}: 図形を2つ以上選んでください`); return; }
  let made = null;
  modifySelection(`パスファインダー(${info.label})`, (its, layer) => {
    const path = combine(op, its);
    if (!path) return false;
    const src = op === 'minus' ? its[0] : its[its.length - 1];
    Object.assign(path, styleOf(src.shape));
    const ids = new Set(its.map((it) => it.shape.id));
    // できた図形は、合体などは一番前の図形の位置、型抜きは一番後ろの図形の位置に
    const at = src.index - its.filter((it) => it.index < src.index).length;
    layer.shapes = layer.shapes.filter((s) => !ids.has(s.id));
    layer.shapes.splice(at, 0, path);
    made = path.id;
  });
  if (!made) { toast(`${info.label}: 何も残りませんでした(重なっている所がない など)`); return; }
  setSelection(selectionLayer(), [made]);
  toast(`${info.label}しました`);
}
