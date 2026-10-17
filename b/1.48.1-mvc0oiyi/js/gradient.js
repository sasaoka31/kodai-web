// 色のグラデーション(図形の塗り・線)
//   s.fillGrad / s.strokeGrad = { type: 'linear'|'radial', stops: [{ o: 0〜1, c: '#rrggbbaa' }], angle(度、線形の向き),
//                                 cx, cy(0〜1、円形の中心。図形の枠の中の位置), r(円形の大きさ。枠の対角線の半分 = 1) }
//   位置は図形の枠に対する割合で持つので、移動・拡大縮小・リグで図形が動いてもグラデーションが付いてくる(回転は角度に足す)。
//   s.fill / s.stroke には最初の色を入れておく(グラデーションを知らない処理はその色の単色として扱う)
import { parseHex, toHex8 } from './color.js';

export const GRAD_TYPES = { solid: '単色', linear: '線形', radial: '円形' };

export function defaultGradient(type, color = '#000000ff') {
  const c = parseHex(color);
  const end = toHex8({ r: 255, g: 255, b: 255, a: c.a ?? 255 });
  return { type, stops: [{ o: 0, c: toHex8(c) }, { o: 1, c: color.toLowerCase() === end ? '#000000ff' : end }], angle: type === 'linear' ? 90 : 0, cx: 0.5, cy: 0.5, r: 1 };
}

const sorted = (g) => [...g.stops].sort((a, b) => a.o - b.o);

// 枠 b(ワールド座標)に合わせた CanvasGradient
export function canvasGradient(ctx, g, b) {
  const w = b.x1 - b.x0, h = b.y1 - b.y0;
  let grad;
  if (g.type === 'radial') {
    const cx = b.x0 + (g.cx ?? 0.5) * w, cy = b.y0 + (g.cy ?? 0.5) * h;
    grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1e-3, ((g.r ?? 1) * Math.hypot(w, h)) / 2));
  } else {
    const a = ((g.angle ?? 0) * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a);
    const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    grad = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
  }
  for (const s of sorted(g)) grad.addColorStop(Math.min(1, Math.max(0, s.o)), s.c);
  return grad;
}

// t(0〜1)の位置の色
export function colorAt(g, t) {
  const st = sorted(g);
  if (t <= st[0].o) return st[0].c;
  for (let i = 1; i < st.length; i++) {
    if (t <= st[i].o) {
      const a = parseHex(st[i - 1].c), b = parseHex(st[i].c), f = (t - st[i - 1].o) / (st[i].o - st[i - 1].o || 1);
      const m = (k) => Math.round(a[k] + (b[k] - a[k]) * f);
      return toHex8({ r: m('r'), g: m('g'), b: m('b'), a: m('a') });
    }
  }
  return st[st.length - 1].c;
}

// パネルの帯に使う CSS
export function gradientCss(g) {
  const toRgba = (h) => { const c = parseHex(h); return `rgba(${c.r},${c.g},${c.b},${(c.a ?? 255) / 255})`; };
  return `linear-gradient(90deg, ${sorted(g).map((s) => `${toRgba(s.c)} ${(s.o * 100).toFixed(1)}%`).join(', ')})`;
}

// 図形を angle 度回したとき(線形の向きも回す)
// 元の図形とグラデーションを共有していることがあるので、書き換えずに新しいものを作る
export function rotateGrads(s, deg) {
  const out = { ...s };
  for (const k of ['fillGrad', 'strokeGrad']) if (s[k]?.type === 'linear') out[k] = { ...s[k], angle: (((s[k].angle ?? 0) + deg + 540) % 360) - 180 };
  if (s.children) out.children = s.children.map((c) => rotateGrads(c, deg));
  return out;
}
