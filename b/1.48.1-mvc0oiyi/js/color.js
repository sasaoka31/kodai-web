// 色ユーティリティ。色は {r,g,b,a}(各0-255)で扱い、図形には #rrggbbaa 文字列で保存する

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function isValidHex(s) {
  return /^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s.trim());
}

export function parseHex(hex) {
  let h = hex.trim().replace('#', '');
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255,
  };
}

const hx = (n) => n.toString(16).padStart(2, '0');

export function toHex(c) {
  return '#' + hx(c.r) + hx(c.g) + hx(c.b);
}

export function toHex8(c) {
  return toHex(c) + hx(c.a);
}

export function toRgbCss(c) {
  return `rgb(${c.r},${c.g},${c.b})`;
}

export function toCss(c) {
  return `rgba(${c.r},${c.g},${c.b},${c.a / 255})`;
}

// ImageData の Uint32Array ビュー用(リトルエンディアン: ABGR)
export function pack(c) {
  return ((c.a << 24) | (c.b << 16) | (c.g << 8) | c.r) >>> 0;
}

export function sameColor(a, b) {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

// PICO-8 パレット + 白
export const DEFAULT_PALETTE = [
  '#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
  '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa',
  '#ffffff',
];
