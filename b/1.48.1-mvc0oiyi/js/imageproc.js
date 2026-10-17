// 画像処理: 縮小・減色・ディザリング(写真→ドット絵)、線画抽出、色の境目(輪郭。線のパスにするのは trace.js)
import { createCanvas } from './document.js';
import { parseHex } from './color.js';

// ---- 読み込み・縮小 ----

// ビットマップを w×h の ImageData にする。
// box=true なら面積平均で縮小(ドット絵変換向け。細部が潰れすぎず色が濁りにくい)
export function bitmapToImageData(bitmap, w, h, { box = false } = {}) {
  if (!box || (w >= bitmap.width && h >= bitmap.height)) {
    const c = createCanvas(w, h);
    const x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingEnabled = !box;
    x.imageSmoothingQuality = 'high';
    x.drawImage(bitmap, 0, 0, w, h);
    return x.getImageData(0, 0, w, h);
  }
  // 大きすぎる元画像は先に 2048px 程度へ縮めてから平均する
  const s = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
  const sw = Math.max(w, Math.round(bitmap.width * s)), sh = Math.max(h, Math.round(bitmap.height * s));
  const src = bitmapToImageData(bitmap, sw, sh);
  return boxDownscale(src, w, h);
}

function boxDownscale(src, w, h) {
  const out = new ImageData(w, h);
  const sd = src.data, od = out.data, SW = src.width, SH = src.height;
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor((y * SH) / h), sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * SH) / h));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor((x * SW) / w), sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * SW) / w));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = sy0; yy < sy1; yy++) {
        for (let xx = sx0; xx < sx1; xx++) {
          const i = (yy * SW + xx) * 4;
          const al = sd[i + 3];
          r += sd[i] * al; g += sd[i + 1] * al; b += sd[i + 2] * al; a += al; n++;
        }
      }
      const o = (y * w + x) * 4;
      if (a > 0) { od[o] = r / a; od[o + 1] = g / a; od[o + 2] = b / a; }
      od[o + 3] = a / n;
    }
  }
  return out;
}

// ---- 減色(メディアンカット) ----

export function medianCut(img, n) {
  const d = img.data;
  const pts = [];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] >= 128) pts.push([d[i], d[i + 1], d[i + 2]]);
  if (!pts.length) return [{ r: 0, g: 0, b: 0 }];
  let boxes = [pts];
  while (boxes.length < n) {
    // 色の広がりが最大の箱を、広がりが最大の軸の中央値で分割
    let best = -1, bestRange = -1, bestAxis = 0;
    boxes.forEach((box, bi) => {
      if (box.length < 2) return;
      for (let ax = 0; ax < 3; ax++) {
        let lo = 255, hi = 0;
        for (const p of box) { if (p[ax] < lo) lo = p[ax]; if (p[ax] > hi) hi = p[ax]; }
        const range = (hi - lo) * Math.sqrt(box.length);
        if (range > bestRange) { bestRange = range; best = bi; bestAxis = ax; }
      }
    });
    if (best < 0 || bestRange <= 0) break;
    const box = boxes[best].sort((a, b) => a[bestAxis] - b[bestAxis]);
    const m = box.length >> 1;
    boxes.splice(best, 1, box.slice(0, m), box.slice(m));
  }
  return boxes.map((box) => {
    let r = 0, g = 0, b = 0;
    for (const p of box) { r += p[0]; g += p[1]; b += p[2]; }
    return { r: Math.round(r / box.length), g: Math.round(g / box.length), b: Math.round(b / box.length) };
  });
}

export function paletteFromHex(list) {
  return list.map(parseHex).map(({ r, g, b }) => ({ r, g, b }));
}

function nearest(pal, r, g, b) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < pal.length; i++) {
    const p = pal[i];
    // 人の目の感度に合わせた重み付き距離
    const dr = p.r - r, dg = p.g - g, db = p.b - b;
    const dist = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
    if (dist < bd) { bd = dist; best = i; }
  }
  return pal[best];
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

// パレットに減色。dither: 'none' | 'fs'(誤差拡散) | 'bayer'(パターン)
export function quantize(img, pal, dither = 'none') {
  const W = img.width, H = img.height;
  const d = img.data;
  const out = new ImageData(W, H);
  const od = out.data;
  const buf = Float32Array.from(d);
  const spread = 64 / Math.cbrt(Math.max(2, pal.length));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (d[i + 3] < 128) continue; // 半透明は透明にする(ドット絵向け)
      let r = buf[i], g = buf[i + 1], b = buf[i + 2];
      if (dither === 'bayer') {
        const t = (BAYER4[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * spread;
        r += t; g += t; b += t;
      }
      const c = nearest(pal, r, g, b);
      od[i] = c.r; od[i + 1] = c.g; od[i + 2] = c.b; od[i + 3] = 255;
      if (dither === 'fs') {
        const er = r - c.r, eg = g - c.g, eb = b - c.b;
        const push = (xx, yy, k) => {
          if (xx < 0 || xx >= W || yy >= H) return;
          const j = (yy * W + xx) * 4;
          buf[j] += er * k; buf[j + 1] += eg * k; buf[j + 2] += eb * k;
        };
        push(x + 1, y, 7 / 16);
        push(x - 1, y + 1, 3 / 16);
        push(x, y + 1, 5 / 16);
        push(x + 1, y + 1, 1 / 16);
      }
    }
  }
  return out;
}

// ---- 線画・輪郭 ----

// 白背景に合成したときの明るさ(0-255)
function luminance(img) {
  const d = img.data;
  const L = new Float32Array(img.width * img.height);
  for (let p = 0, i = 0; p < L.length; p++, i += 4) {
    const a = d[i + 3] / 255;
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    L[p] = l * a + 255 * (1 - a);
  }
  return L;
}

// 暗い部分(描かれた線)だけを残して背景を透明にする。
// color: 線の色 {r,g,b} / null なら元の色のまま。soft: 境目をなめらかに(イラスト向け)
export function extractLineArt(img, { threshold = 160, color = null, soft = false }) {
  const W = img.width, H = img.height;
  const L = luminance(img);
  const out = new ImageData(W, H);
  const d = img.data, od = out.data;
  const band = 48;
  for (let p = 0, i = 0; p < L.length; p++, i += 4) {
    let a;
    if (soft) a = Math.min(1, Math.max(0, (threshold - L[p]) / band + 0.5));
    else a = L[p] < threshold ? 1 : 0;
    if (!a) continue;
    if (color) { od[i] = color.r; od[i + 1] = color.g; od[i + 2] = color.b; }
    else { od[i] = d[i]; od[i + 1] = d[i + 1]; od[i + 2] = d[i + 2]; }
    od[i + 3] = Math.round(a * 255);
  }
  return out;
}

function boxBlur(L, W, H, r) {
  if (r <= 0) return L;
  const tmp = new Float32Array(L.length), out = new Float32Array(L.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < W) { s += L[y * W + xx]; n++; } }
      tmp[y * W + x] = s / n;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < H) { s += tmp[yy * W + x]; n++; } }
      out[y * W + x] = s / n;
    }
  }
  return out;
}

// 色の境目(輪郭)を取り出す。Sobel + 細線化(非極大抑制)。sensitivity: 0-100(大きいほど弱い境目も拾う)
// 色の境目の画素(1 = 境目。W×H)。線のパスにするとき(trace.js)もこれを使う
export function edgeMask(img, { sensitivity = 50, blur = 1 }) {
  const W = img.width, H = img.height;
  // 明るさの差に加えて、色(R/G/B)の差と透明部分との境目も輪郭にする
  const d = img.data;
  const ch = [0, 1, 2].map((k) => {
    const c = new Float32Array(W * H);
    for (let p = 0; p < c.length; p++) {
      const a = d[p * 4 + 3] / 255;
      c[p] = d[p * 4 + k] * a + 255 * (1 - a);
    }
    return boxBlur(c, W, H, blur);
  });
  const L = boxBlur(luminance(img), W, H, blur);
  const A = new Float32Array(W * H);
  for (let p = 0; p < A.length; p++) A[p] = d[p * 4 + 3];
  const channels = [L, ...ch, A];

  const mag = new Float32Array(W * H), dir = new Uint8Array(W * H);
  const at = (arr, x, y) => arr[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let gx = 0, gy = 0;
      for (const arr of channels) {
        const tl = at(arr, x - 1, y - 1), t = at(arr, x, y - 1), tr = at(arr, x + 1, y - 1);
        const l = at(arr, x - 1, y), r = at(arr, x + 1, y);
        const bl = at(arr, x - 1, y + 1), b = at(arr, x, y + 1), br = at(arr, x + 1, y + 1);
        const sx = tr + 2 * r + br - tl - 2 * l - bl;
        const sy = bl + 2 * b + br - tl - 2 * t - tr;
        if (Math.abs(sx) + Math.abs(sy) > Math.abs(gx) + Math.abs(gy)) { gx = sx; gy = sy; }
      }
      const p = y * W + x;
      mag[p] = Math.hypot(gx, gy);
      // 勾配方向を 0:横 1:斜め/ 2:縦 3:斜め\ に量子化
      const ang = ((Math.atan2(gy, gx) * 180) / Math.PI + 180) % 180;
      dir[p] = ang < 22.5 || ang >= 157.5 ? 0 : ang < 67.5 ? 1 : ang < 112.5 ? 2 : 3;
    }
  }
  const thr = 12 + (100 - sensitivity) * 3.5;
  const edge = new Uint8Array(W * H);
  const OFF = [[1, 0], [1, 1], [0, 1], [-1, 1]];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      const m = mag[p];
      if (m < thr) continue;
      const [ox, oy] = OFF[dir[p]];
      // 勾配方向の両隣より強いところだけ残す(線を細くする)
      if (m >= at(mag, x + ox, y + oy) && m >= at(mag, x - ox, y - oy)) edge[p] = 1;
    }
  }
  return edge;
}
