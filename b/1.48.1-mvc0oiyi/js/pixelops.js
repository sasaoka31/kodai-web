// ドット絵の仕上げ道具(ラスターレイヤー。メニューの「レイヤー → ドット絵」と Claude 連携の kodai_pixel_ops から使う)
//   outline : 絵のまわり(透明な所)に 1ドットの輪郭(色は隣のドットを暗くした色 / 指定の色)
//   shade   : 左上から光が当たったように、右下のふちを影、左上のふちを明るく
//   mirror  : 左半分を右に(または右を左に、上下も)反転してコピー → 左右対称
//   reduce  : 色を n 色に減らす(メディアンカット)
//   toRows  : ドットを文字の行 + 色の表にする(Claude が読み返す用)
import { state, requestRender, toast } from './state.js';
import { recordTiles } from './history.js';
import { tileCoordsInRect } from './tiles.js';
import { ramp } from './charmaker.js';

const hex = (c) => '#' + c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('');
const lum = (d, i) => (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
const toRgb = (h) => { const s = h.replace('#', ''); return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]; };

export function outlineImage(img, { color = 'auto', diagonal = false } = {}) {
  const { width: W, height: H, data: d } = img;
  const out = new ImageData(new Uint8ClampedArray(d), W, H);
  const A = (x, y) => x >= 0 && y >= 0 && x < W && y < H && d[(y * W + x) * 4 + 3] > 127;
  const fixed = color !== 'auto' ? toRgb(color) : null;
  const dirs = diagonal ? [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]] : [[-1, 0], [1, 0], [0, -1], [0, 1]];
  let n = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (A(x, y)) continue;
      const nb = dirs.map(([dx, dy]) => [x + dx, y + dy]).filter(([a, b]) => A(a, b));
      if (!nb.length) continue;
      let c = fixed;
      if (!c) {
        // いちばん暗い隣の色を、さらに暗くした色(色つき輪郭)
        const [a, b] = nb.reduce((m, p) => (lum(d, (p[1] * W + p[0]) * 4) < lum(d, (m[1] * W + m[0]) * 4) ? p : m));
        const i = (b * W + a) * 4;
        c = ramp(hex([d[i], d[i + 1], d[i + 2]])).o;
      }
      const o = (y * W + x) * 4;
      out.data[o] = c[0]; out.data[o + 1] = c[1]; out.data[o + 2] = c[2]; out.data[o + 3] = 255;
      n++;
    }
  }
  return { img: out, changed: n };
}

export function shadeImage(img, { depth = 2, highlight = true } = {}) {
  const { width: W, height: H, data: d } = img;
  const out = new ImageData(new Uint8ClampedArray(d), W, H);
  const A = (x, y) => x >= 0 && y >= 0 && x < W && y < H && d[(y * W + x) * 4 + 3] > 127;
  // 同じ色のかたまりの「ふち」を見る(輪郭の線そのもの = とても暗い色は触らない)
  const same = (x, y, i) => A(x, y) && Math.abs(lum(d, (y * W + x) * 4) - lum(d, i)) < 0.18;
  let n = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (!A(x, y) || lum(d, i) < 0.16) continue;
      const r = ramp(hex([d[i], d[i + 1], d[i + 2]]));
      let c = null;
      for (let k = 1; k <= depth && !c; k++) if (!same(x + k, y + k, i) && (!same(x + k, y, i) || !same(x, y + k, i))) c = r.s;
      if (!c && highlight && !same(x - 1, y - 1, i) && !same(x - 1, y, i) && !same(x, y - 1, i)) c = r.h;
      if (!c) continue;
      out.data[i] = c[0]; out.data[i + 1] = c[1]; out.data[i + 2] = c[2];
      n++;
    }
  }
  return { img: out, changed: n };
}

// from: 'left'(左を右へ)/ 'right' / 'top' / 'bottom'。center = 対称の軸(画像の中の x / y。省略 = 真ん中)
export function mirrorImage(img, { from = 'left', center } = {}) {
  const { width: W, height: H, data: d } = img;
  const out = new ImageData(new Uint8ClampedArray(d), W, H);
  const hz = from === 'left' || from === 'right';
  const c = center ?? (hz ? W / 2 : H / 2);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = hz ? x + 0.5 : y + 0.5;
      const dst = from === 'left' || from === 'top' ? v > c : v < c;
      if (!dst) continue;
      const m = Math.floor(2 * c - v);
      const sx = hz ? m : x, sy = hz ? y : m;
      const o = (y * W + x) * 4;
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) { out.data.fill(0, o, o + 4); continue; }
      out.data.set(d.subarray((sy * W + sx) * 4, (sy * W + sx) * 4 + 4), o);
    }
  }
  return { img: out, changed: 1 };
}

// メディアンカットで n 色に減らす(透明はそのまま)
export function reduceImage(img, { colors = 8 } = {}) {
  const { data: d } = img;
  const px = [];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 127) px.push([d[i], d[i + 1], d[i + 2]]);
  if (!px.length) return { img, changed: 0, palette: [] };
  let boxes = [px];
  while (boxes.length < colors) {
    let bi = -1, best = -1, ch = 0;
    boxes.forEach((b, k) => {
      if (b.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let mn = 255, mx = 0;
        for (const p of b) { if (p[c] < mn) mn = p[c]; if (p[c] > mx) mx = p[c]; }
        if (mx - mn > best) { best = mx - mn; bi = k; ch = c; }
      }
    });
    if (bi < 0 || best <= 0) break;
    const b = boxes[bi].sort((p, q) => p[ch] - q[ch]);
    const mid = b.length >> 1;
    boxes.splice(bi, 1, b.slice(0, mid), b.slice(mid));
  }
  const pal = boxes.map((b) => [0, 1, 2].map((c) => Math.round(b.reduce((s, p) => s + p[c], 0) / b.length)));
  const out = new ImageData(new Uint8ClampedArray(d), img.width, img.height);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] <= 127) continue;
    let best = 0, bd = Infinity;
    pal.forEach((p, k) => { const e = (p[0] - d[i]) ** 2 + (p[1] - d[i + 1]) ** 2 + (p[2] - d[i + 2]) ** 2; if (e < bd) { bd = e; best = k; } });
    out.data[i] = pal[best][0]; out.data[i + 1] = pal[best][1]; out.data[i + 2] = pal[best][2]; out.data[i + 3] = 255;
  }
  return { img: out, changed: 1, palette: pal.map(hex) };
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export function toRows(img) {
  const { width: W, height: H, data: d } = img;
  const pal = new Map(), rows = [];
  for (let y = 0; y < H; y++) {
    let row = '';
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (d[i + 3] < 128) { row += '.'; continue; }
      const key = hex([d[i], d[i + 1], d[i + 2]]) + (d[i + 3] < 255 ? d[i + 3].toString(16).padStart(2, '0') : '');
      if (!pal.has(key)) {
        if (pal.size >= LETTERS.length) return { error: `色が多すぎます(${LETTERS.length}色まで)。先に reduce で色を減らしてください` };
        pal.set(key, LETTERS[pal.size]);
      }
      row += pal.get(key);
    }
    rows.push(row);
  }
  return { rows, palette: Object.fromEntries([...pal].map(([c, k]) => [k, c])) };
}

// ---- レイヤーに使う(範囲 = 絵の範囲 + 1ドットの余白。region を渡せばその範囲)----

export function applyToLayer(layer, label, fn, region) {
  if (!layer || layer.type !== 'raster') throw new Error('ドット絵の道具はラスターレイヤーで使います');
  if (layer.locked) throw new Error('レイヤーがロックされています');
  let r = region;
  if (!r) {
    const b = layer.bounds();
    if (!b) throw new Error('このレイヤーには絵がありません');
    r = { x: b.x0 - 1, y: b.y0 - 1, w: b.x1 - b.x0 + 2, h: b.y1 - b.y0 + 2 };
  }
  const src = layer.getImageData(r.x, r.y, r.w, r.h);
  const res = fn(src);
  if (!res.changed) return res;
  recordTiles(state.history, label, layer, tileCoordsInRect(r.x, r.y, r.x + r.w, r.y + r.h), () => {
    layer.tiles.clearRect?.(r.x, r.y, r.w, r.h);
    layer.putImageData(res.img, r.x, r.y);
  });
  requestRender();
  return res;
}

// メニューから(今のレイヤー)
export function pixelMenu(op) {
  const layer = state.doc.activeLayer;
  try {
    if (op === 'outline') applyToLayer(layer, '輪郭を付ける', (img) => outlineImage(img));
    else if (op === 'shade') applyToLayer(layer, '陰影を付ける', (img) => shadeImage(img));
    else if (op === 'mirror') {
      // アートボードの真ん中を軸に、左を右へ
      const a = state.doc.artboard;
      applyToLayer(layer, '左右対称にする', (img) => mirrorImage(img, { from: 'left' }), { x: a.x, y: a.y, w: a.w, h: a.h });
    } else if (op.startsWith('reduce')) applyToLayer(layer, '色を減らす', (img) => reduceImage(img, { colors: Number(op.slice(6)) || 8 }));
    toast('できました(Ctrl+Z で戻せます)');
  } catch (err) { toast(err.message); }
}
