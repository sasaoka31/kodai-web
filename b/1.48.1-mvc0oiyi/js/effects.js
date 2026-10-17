// エフェクト(レイヤーに付ける、あとで外せる効果。オーラ・炎・光・影・電撃・キラキラ・立ちのぼる粒・点滅・ゆらゆら)
//   layer.fx = { dot: ドットの大きさ(px), items: [{ type, on, ...値 }] }
//   レイヤーの絵の形(アルファ)から、フレームごとに「後ろ」「前」(と、ゆらゆらは「絵そのもの」)の絵を計算する。
//   動きはフレーム番号 / フレーム数 で一周する(GIF でつなぎ目が出ない)。フレームが1つなら止まった絵
//   計算は 1ドット = dot px のマス目(ワールドの原点にそろえる)。大きな絵はマスを粗くして 36万マスまでに抑える
import { createCanvas } from './document.js';
import { parseHex } from './color.js';
import { GDP_OPTIONS, renderGdParticles, gdpVersion } from './gdparticles.js';

// 種類ごとの名前・既定値・ダイアログの項目
//   kind: color / range(min, max, step) / select(options)
export const FX_TYPES = {
  aura: {
    label: 'オーラ', note: '形のまわりにゆらめく気のオーラ(後ろ)',
    defaults: { color: '#5ad1ff', size: 6, speed: 1, rise: 0.6 },
    params: [['color', '色'], ['size', '大きさ', 1, 32, 1], ['rise', '上への伸び', 0, 1.5, 0.1], ['speed', '速さ', 1, 6, 1]],
  },
  fire: {
    label: '炎', note: '形から立ちのぼる炎(後ろ。「体を包む」で前にも)',
    defaults: { color: '#ff7a1a', size: 12, speed: 2, cover: 0.2, front: true },
    params: [['color', '色'], ['size', '炎の高さ', 2, 48, 1], ['cover', '体を包む量', 0, 1, 0.05], ['speed', '速さ', 1, 6, 1]],
  },
  glow: {
    label: '光(ふちが光る)', note: 'ぼんやり光る(後ろ)。明るさが脈打つ',
    defaults: { color: '#fff3a0', size: 4, pulse: 0.5, speed: 1 },
    params: [['color', '色'], ['size', '広がり', 1, 24, 1], ['pulse', '明滅', 0, 1, 0.05], ['speed', '速さ', 1, 6, 1]],
  },
  shadow: {
    label: '影', note: '形をずらした影(後ろ)',
    defaults: { color: '#000000', dx: 2, dy: 2, alpha: 0.4 },
    params: [['color', '色'], ['dx', '横のずれ', -32, 32, 1], ['dy', '縦のずれ', -32, 32, 1], ['alpha', '濃さ', 0.05, 1, 0.05]],
  },
  spark: {
    label: '電撃', note: '形のふちから走るギザギザの稲妻(前)。コマごとに変わる',
    defaults: { color: '#9fe8ff', count: 4, size: 10, seed: 1 },
    params: [['color', '色'], ['count', '本数', 1, 12, 1], ['size', '長さ', 3, 40, 1], ['seed', '種', 1, 99, 1]],
  },
  sparkle: {
    label: 'キラキラ', note: '十字の光がまたたく(前)',
    defaults: { color: '#ffffff', count: 10, size: 2, speed: 1, seed: 1 },
    params: [['color', '色'], ['count', '数', 1, 40, 1], ['size', '大きさ', 1, 6, 1], ['speed', '速さ', 1, 6, 1], ['seed', '種', 1, 99, 1]],
  },
  rise: {
    label: '立ちのぼる粒(湯気・泡・毒)', note: '形の上から粒が昇って消える(前)',
    defaults: { color: '#9cff6a', count: 10, size: 14, grain: 2, shape: 'dot', speed: 1, seed: 1 },
    params: [['color', '色'], ['shape', '形', [['dot', '丸'], ['ring', '泡(輪)']]], ['count', '数', 1, 40, 1], ['size', '昇る高さ', 4, 64, 1],
      ['grain', '粒の大きさ', 1, 6, 1], ['speed', '速さ', 1, 6, 1], ['seed', '種', 1, 99, 1]],
  },
  flash: {
    label: '点滅(ダメージ)', note: '絵が色に光る(前)。「交互」は1コマおき',
    defaults: { color: '#ffffff', amount: 0.85, mode: 'blink', speed: 1 },
    params: [['color', '色'], ['mode', '光り方', [['blink', '交互(1コマおき)'], ['pulse', 'じわっと']]], ['amount', '強さ', 0.05, 1, 0.05], ['speed', '速さ', 1, 6, 1]],
  },
  wave: {
    label: 'ゆらゆら(陽炎・水中)', note: '絵を横にゆらす(絵そのもの)',
    defaults: { amp: 1, length: 16, speed: 1 },
    params: [['amp', 'ゆれ幅', 1, 12, 1], ['length', '波の長さ', 4, 96, 1], ['speed', '速さ', 1, 6, 1]],
  },
};

// 粒子(Free GDevelop Particles Library の 43 個。gdparticles.js)
FX_TYPES.particle = {
  label: '粒子(火花・魔法・煙・雪・爆発 など 43 種)', note: 'GDevelop Particles の粒子。形の真ん中(上・下・形の中)から出る。大きさは「広がり」で決める',
  defaults: { preset: 'Magic', where: 'center', size: 40, amount: 1, loop: 2, angle: 0, tint: 'off', color: '#ff4040', layer: 'front', seed: 1 },
  params: [['preset', '種類', GDP_OPTIONS], ['where', '出る所', [['center', '真ん中'], ['top', '上'], ['bottom', '下'], ['shape', '形の中']]],
    ['size', '広がり', 4, 600, 1], ['amount', '量', 0.1, 3, 0.1], ['loop', '一周の長さ(秒)', 0.5, 8, 0.5], ['angle', '向きを回す', -180, 180, 5],
    ['tint', '色', [['off', '元の色'], ['on', '下の色にする']]], ['color', '色(「下の色にする」のとき)'], ['layer', '重ね方', [['front', '前'], ['back', '後ろ']]], ['seed', '種', 1, 99, 1]],
};

// お手本(組み合わせ)
export const FX_PRESETS = {
  ki: { label: '気のオーラ(青)', items: [{ type: 'aura', color: '#5ad1ff', size: 6 }, { type: 'sparkle', color: '#e0f7ff', count: 4 }] },
  rage: { label: '怒りのオーラ(赤)', items: [{ type: 'aura', color: '#ff4040', size: 7, rise: 1 }, { type: 'spark', color: '#ffb0b0', count: 2, size: 8 }] },
  burn: { label: '燃える', items: [{ type: 'fire', color: '#ff7a1a', size: 12, cover: 0.2 }] },
  blue: { label: '青い炎', items: [{ type: 'fire', color: '#3aa0ff', size: 14, cover: 0.1 }, { type: 'glow', color: '#9fd8ff', size: 3 }] },
  holy: { label: '聖なる光', items: [{ type: 'glow', color: '#fff3a0', size: 6, pulse: 0.6 }, { type: 'sparkle', color: '#ffffff', count: 8, size: 2 }] },
  thunder: { label: '雷をまとう', items: [{ type: 'glow', color: '#9fe8ff', size: 3, pulse: 0.8, speed: 2 }, { type: 'spark', color: '#9fe8ff', count: 4, size: 12 }] },
  poison: { label: '毒', items: [{ type: 'rise', color: '#9cff6a', shape: 'ring', count: 8, size: 16 }, { type: 'flash', color: '#7cff4a', mode: 'pulse', amount: 0.35 }] },
  cold: { label: '冷気', items: [{ type: 'rise', color: '#d8f4ff', shape: 'dot', count: 14, size: 12, grain: 1 }, { type: 'glow', color: '#bfe8ff', size: 3, pulse: 0.2 }] },
  damage: { label: 'ダメージ', items: [{ type: 'flash', color: '#ffffff', mode: 'blink', amount: 0.9 }] },
  water: { label: '水中・陽炎', items: [{ type: 'wave', amp: 1, length: 16 }] },
  shadow: { label: '影を落とす', items: [{ type: 'shadow', dx: 2, dy: 2, alpha: 0.4 }] },
};

export const MAX_FX_CELLS = 360000;
export const FX_DOT_MAX = 16;

export function newFxItem(type, over = {}) {
  return { type, on: true, ...structuredClone(FX_TYPES[type].defaults), ...over };
}

export function hasFx(fx) {
  return !!(fx && Array.isArray(fx.items) && fx.items.some((it) => it.on !== false && FX_TYPES[it.type]));
}

// 読み込み・Claude 連携からの値を正しい形にそろえる(知らない種類は捨てる、範囲外は丸める)
export function normalizeFx(src) {
  if (!src || !Array.isArray(src.items)) return null;
  const items = [];
  for (const it of src.items) {
    const t = FX_TYPES[it?.type];
    if (!t) continue;
    const o = { type: it.type, on: it.on !== false };
    for (const [k, , min, max] of t.params) {
      const d = t.defaults[k];
      let v = it[k] ?? d;
      if (k === 'color') v = /^#?[0-9a-f]{3,8}$/i.test(String(v)) ? (String(v).startsWith('#') ? v : '#' + v) : d;
      else if (Array.isArray(min)) v = min.some(([val]) => val === v) ? v : d;
      else { v = Number(v); if (!Number.isFinite(v)) v = d; v = Math.min(max, Math.max(min, v)); }
      o[k] = v;
    }
    if ('front' in t.defaults) o.front = it.front ?? t.defaults.front;
    items.push(o);
  }
  if (!items.length) return null;
  const dot = Math.round(Number(src.dot) || 1);
  return { dot: Math.min(FX_DOT_MAX, Math.max(1, dot)), items };
}

// 効果が絵の外にはみ出す量(ワールド px)
function padOf(it) {
  switch (it.type) {
    case 'aura': return it.size * (2.2 + it.rise * 1.5) + 2;
    case 'fire': return it.size * 1.8 + 2;
    case 'glow': return it.size + 2;
    case 'shadow': return Math.max(Math.abs(it.dx), Math.abs(it.dy)) + 1;
    case 'spark': return it.size * 1.4 + 2;
    case 'sparkle': return it.size + 4;
    case 'rise': return it.size + it.grain * 2 + 4;
    case 'wave': return it.amp + 1;
    case 'particle': return it.size + 2;
    default: return 0;
  }
}

// ---- 乱数・ノイズ ----

function hash(x, y, s) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (s | 0) * 1442695041;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const mod = (a, n) => ((a % n) + n) % n;
const fade = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
const fract = (v) => v - Math.floor(v);

function rng(seed) {
  let a = (seed | 0) ^ 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 値ノイズ(縦方向だけ py で一周する = 時間でスクロールしても一周でつながる)
function vnoise(x, y, py, s) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = fade(x - x0), fy = fade(y - y0);
  const Y0 = mod(y0, py), Y1 = mod(y0 + 1, py);
  const a = hash(x0, Y0, s), b = hash(x0 + 1, Y0, s), c = hash(x0, Y1, s), d = hash(x0 + 1, Y1, s);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}
function fbm(x, y, py, s) {
  return (vnoise(x, y, py, s) * 0.57 + vnoise(x * 2, y * 2, py * 2, s + 7) * 0.29 + vnoise(x * 4, y * 4, py * 4, s + 13) * 0.14);
}

// ---- 色 ----

const rgbOf = (hex) => { const c = parseHex(hex); return [c.r, c.g, c.b]; };
const mix = (c, d, t) => [Math.round(lerp(c[0], d[0], t)), Math.round(lerp(c[1], d[1], t)), Math.round(lerp(c[2], d[2], t))];
const WHITE = [255, 255, 255], BLACK = [0, 0, 0];

// 炎の色の段(芯 → 外): 白っぽい黄 → 明るい色 → 色 → 赤寄りの暗い色
function fireRamp(base) {
  const warm = base[0] >= base[2]; // 暖色なら外側は赤、寒色なら外側は濃い青
  const outer = warm ? mix(base, [150, 20, 10], 0.55) : mix(base, [20, 30, 120], 0.55);
  const core = warm ? mix(base, [255, 250, 200], 0.8) : mix(base, WHITE, 0.8);
  return [outer, base, mix(base, WHITE, 0.4), core];
}

// ---- 準備(形の情報。フレームによらない) ----

// prep = { x, y, cs, W, H, img(ImageData), A(アルファ 0〜1), M(形 0/1), D(外への距離、マス), U(下の形までの縦の距離), B(形の中で下のふちからの距離), edges, tops }
function prepare(region, cs, paint) {
  const W = Math.max(1, Math.round((region.x1 - region.x0) / cs)), H = Math.max(1, Math.round((region.y1 - region.y0) / cs));
  const cv = createCanvas(W, H);
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = cs > 1;
  ctx.setTransform(1 / cs, 0, 0, 1 / cs, -region.x0 / cs, -region.y0 / cs);
  paint(ctx, region);
  const img = ctx.getImageData(0, 0, W, H);
  const n = W * H, d = img.data;
  const A = new Float32Array(n), M = new Uint8Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    A[i] = d[i * 4 + 3] / 255;
    if (A[i] >= 0.4) { M[i] = 1; any = true; }
  }
  if (!any) return null;
  // 外への距離(3-4 の面取り距離 ÷ 3)
  const INF = 1e9, D = new Float32Array(n);
  for (let i = 0; i < n; i++) D[i] = M[i] ? 0 : INF;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    let v = D[i];
    if (x > 0) v = Math.min(v, D[i - 1] + 3);
    if (y > 0) {
      v = Math.min(v, D[i - W] + 3);
      if (x > 0) v = Math.min(v, D[i - W - 1] + 4);
      if (x < W - 1) v = Math.min(v, D[i - W + 1] + 4);
    }
    D[i] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x;
    let v = D[i];
    if (x < W - 1) v = Math.min(v, D[i + 1] + 3);
    if (y < H - 1) {
      v = Math.min(v, D[i + W] + 3);
      if (x < W - 1) v = Math.min(v, D[i + W + 1] + 4);
      if (x > 0) v = Math.min(v, D[i + W - 1] + 4);
    }
    D[i] = v;
  }
  for (let i = 0; i < n; i++) D[i] /= 3;
  // 縦の距離: U = 真下にある形までの距離、B = 形の中で下のふちから数えた距離
  const U = new Float32Array(n).fill(INF), B = new Float32Array(n).fill(-1);
  for (let x = 0; x < W; x++) {
    let u = INF, b = -1;
    for (let y = H - 1; y >= 0; y--) {
      const i = y * W + x;
      if (M[i]) { u = 0; b = b + 1; B[i] = b; } else { u = u + 1; b = -1; }
      U[i] = u;
    }
  }
  // ふちのマス(電撃の出どころ)
  const edges = [], tops = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!M[i]) continue;
    const up = y > 0 && M[i - W], dn = y < H - 1 && M[i + W], lf = x > 0 && M[i - 1], rt = x < W - 1 && M[i + 1];
    if (!(up && dn && lf && rt)) edges.push(i);
  }
  // 上のふち = 列ごとに一番上の形のマス(足の間などから出ないように)
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (M[y * W + x]) { tops.push(y * W + x); break; }
  return { x: region.x0, y: region.y0, cs, W, H, img, A, M, D, U, B, edges, tops };
}

// ---- フレームごとの絵 ----

function newBuf(p) { return new ImageData(p.W, p.H); }

// 上に重ねる(アルファ合成)
function put(buf, i, c, a) {
  if (a <= 0) return;
  const d = buf.data, k = i * 4;
  const da = d[k + 3] / 255, oa = a + da * (1 - a);
  if (oa <= 0) return;
  d[k] = (c[0] * a + d[k] * da * (1 - a)) / oa;
  d[k + 1] = (c[1] * a + d[k + 1] * da * (1 - a)) / oa;
  d[k + 2] = (c[2] * a + d[k + 2] * da * (1 - a)) / oa;
  d[k + 3] = oa * 255;
}

function renderAura(p, it, t, buf) {
  const { W, H, M, D, U } = p, cs = p.cs;
  const base = rgbOf(it.color), light = mix(base, WHITE, 0.55), dark = mix(base, BLACK, 0.25);
  const size = it.size / cs, sc = Math.max(1.5, size * 0.7), py = 4;
  const scroll = t * it.speed * py;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (M[i]) continue;
    const d = D[i];
    if (d > size * (2.2 + it.rise * 1.5)) continue;
    const n = fbm(x / sc, y / sc + scroll, py, 11);
    let reach = size * (0.45 + 1.1 * n);
    if (U[i] <= d * 1.3 + 1) reach *= 1 + it.rise * (0.6 + n); // 形の真上は上に伸びる
    const v = 1 - d / reach;
    if (v <= 0) continue;
    if (v > 0.66) put(buf, i, light, 1);
    else if (v > 0.33) put(buf, i, base, 0.9);
    else put(buf, i, dark, 0.55);
  }
}

// 炎: 外側は「真下・ななめ下の形からの高さ」で、体の中は「下のふちからの高さ」で燃える
function renderFire(p, it, t, back, front) {
  const { W, H, M, D, U, B } = p, cs = p.cs;
  const ramp = fireRamp(rgbOf(it.color));
  const h = it.size / cs, sc = Math.max(1.2, h * 0.28), py = 6;
  const scroll = t * it.speed * py;
  const side = Math.max(1, h * 0.25);
  // 横に広げた高さ(ななめ下の形からも炎が出る)
  const r = Math.max(1, Math.round(h * 0.2));
  const U2 = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 1e9;
    for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx;
      if (xx < 0 || xx >= W) continue;
      v = Math.min(v, U[y * W + xx] + Math.abs(dx) * 1.6);
    }
    U2[y * W + x] = v;
  }
  const level = (heat) => (heat > 0.78 ? 3 : heat > 0.55 ? 2 : heat > 0.3 ? 1 : 0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const n = fbm(x / sc, y / sc + scroll, py, 23);
    if (!M[i]) {
      const len = h * (0.45 + 1.1 * n);
      const up = 1 - U2[i] / len;
      const sd = (1 - D[i] / side) * 0.6;
      const heat = Math.max(up, sd) * (0.65 + 0.6 * n);
      if (heat <= 0.12) continue;
      put(back, i, ramp[level(heat)], heat > 0.3 ? 1 : 0.75);
    } else if (front && it.cover > 0) {
      const len = h * it.cover * 2 * (0.4 + n);
      const heat = (1 - B[i] / Math.max(0.5, len)) * (0.55 + 0.7 * n);
      if (heat <= 0.3) continue;
      put(front, i, ramp[level(heat)], 0.92);
    }
  }
}

function renderGlow(p, it, t, buf) {
  const { W, H, M, D } = p;
  const base = rgbOf(it.color), size = it.size / p.cs;
  const k = 1 - it.pulse * 0.5 * (1 - Math.cos(2 * Math.PI * it.speed * t));
  for (let i = 0; i < W * H; i++) {
    if (M[i] || D[i] > size) continue;
    const a = Math.pow(1 - D[i] / (size + 0.5), 1.3) * k;
    put(buf, i, base, Math.round(a * 4) / 4); // 4段(ドット絵らしく)
  }
}

function renderShadow(p, it, buf) {
  const { W, H, A } = p, c = rgbOf(it.color);
  const ox = Math.round(it.dx / p.cs), oy = Math.round(it.dy / p.cs);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = x - ox, sy = y - oy;
    if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
    const a = A[sy * W + sx];
    if (a > 0) put(buf, y * W + x, c, a * it.alpha);
  }
}

function renderSpark(p, it, frame, buf) {
  const { W, H, edges, M } = p;
  if (!edges.length) return;
  const base = rgbOf(it.color), core = mix(base, WHITE, 0.7);
  const r = rng(it.seed * 7919 + frame * 104729);
  const len = it.size / p.cs;
  const cells = [];
  const bolt = (x, y, ang, steps, branch) => {
    for (let s = 0; s < steps; s++) {
      ang += (r() - 0.5) * 1.6;
      x += Math.cos(ang); y += Math.sin(ang);
      const xi = Math.round(x), yi = Math.round(y);
      if (xi < 0 || yi < 0 || xi >= W || yi >= H) return;
      cells.push(yi * W + xi);
      if (branch && r() < 0.12) bolt(x, y, ang + (r() < 0.5 ? -1 : 1) * 0.9, Math.round(steps * 0.4), false);
    }
  };
  for (let b = 0; b < it.count; b++) {
    if (r() < 0.2) continue; // ときどき消える(ちらつき)
    const i = edges[Math.floor(r() * edges.length)];
    const x = i % W, y = (i / W) | 0;
    // 外向き(形の重心から離れる向き)+ばらつき
    let gx = 0, gy = 0;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H || !M[yy * W + xx]) { gx += dx; gy += dy; }
    }
    const ang = (gx || gy ? Math.atan2(gy, gx) : r() * Math.PI * 2) + (r() - 0.5) * 1.2;
    bolt(x, y, ang, Math.max(2, Math.round(len * (0.5 + r() * 0.7))), true);
  }
  // まわりにうっすら光、芯は明るく
  for (const i of cells) {
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H) put(buf, yy * W + xx, base, 0.45);
    }
  }
  for (const i of cells) put(buf, i, core, 1);
}

function renderSparkle(p, it, t, buf) {
  const { W, H, M, D } = p;
  const base = rgbOf(it.color), core = mix(base, WHITE, 0.8);
  // 置ける場所: 形の中か、すぐ外
  const spots = [];
  for (let i = 0; i < W * H; i++) if (M[i] || D[i] <= 2) spots.push(i);
  if (!spots.length) return;
  for (let k = 0; k < it.count; k++) {
    const ph = hash(k, 3, it.seed);
    const u = t * it.speed + ph, cyc = Math.floor(u), f = u - cyc;
    const b = Math.max(0, Math.sin(Math.PI * Math.min(1, f * 2.2))); // 前半でぱっと光って消える
    const arm = Math.round(b * (it.size / p.cs + 0.4));
    if (b <= 0.15) continue;
    const i = spots[Math.floor(hash(k, cyc, it.seed + 1) * spots.length)];
    const x = i % W, y = (i / W) | 0;
    put(buf, i, core, 1);
    for (let s = 1; s <= arm; s++) {
      const a = s === arm ? 0.7 : 1;
      for (const [dx, dy] of [[s, 0], [-s, 0], [0, s], [0, -s]]) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H) put(buf, yy * W + xx, s === 1 ? core : base, a);
      }
    }
  }
}

function renderRise(p, it, t, buf) {
  const { W, H, tops } = p;
  if (!tops.length) return;
  const base = rgbOf(it.color), light = mix(base, WHITE, 0.5);
  const height = it.size / p.cs, gr = it.grain / p.cs;
  for (let k = 0; k < it.count; k++) {
    const ph = hash(k, 5, it.seed);
    const u = t * it.speed + ph, cyc = Math.floor(u), f = u - cyc;
    const i0 = tops[Math.floor(hash(k, cyc, it.seed + 3) * tops.length)];
    const x0 = i0 % W, y0 = (i0 / W) | 0;
    const wob = hash(k, cyc, it.seed + 5) * Math.PI * 2;
    const cx = x0 + Math.sin(f * Math.PI * 2 + wob) * Math.max(1, height * 0.08);
    const cy = y0 - 1 - f * height;
    const rad = Math.max(0.5, gr * (0.6 + f * 0.8));
    const alpha = f < 0.15 ? f / 0.15 : 1 - (f - 0.15) / 0.85;
    const col = f < 0.4 ? light : base;
    const R = Math.ceil(rad + 1);
    for (let yy = Math.floor(cy) - R; yy <= Math.floor(cy) + R; yy++) for (let xx = Math.floor(cx) - R; xx <= Math.floor(cx) + R; xx++) {
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const dd = Math.hypot(xx + 0.5 - cx, yy + 0.5 - cy);
      const inside = it.shape === 'ring' ? dd <= rad + 0.5 && dd > rad - 0.7 : dd <= rad + 0.25;
      if (inside) put(buf, yy * W + xx, col, Math.round(alpha * 3) / 3);
    }
  }
}

function renderFlash(p, it, t, frame, buf) {
  const { W, H, A } = p, c = rgbOf(it.color);
  const k = it.mode === 'blink' ? (Math.floor(frame / it.speed) % 2 === 0 ? it.amount : 0) : it.amount * 0.5 * (1 - Math.cos(2 * Math.PI * it.speed * t));
  if (k <= 0) return;
  for (let i = 0; i < W * H; i++) if (A[i] > 0) put(buf, i, c, A[i] * k);
}

function renderWave(p, it, t) {
  const { W, H, img } = p;
  const out = new ImageData(W, H), s = img.data, d = out.data;
  for (let y = 0; y < H; y++) {
    const off = Math.round((it.amp / p.cs) * Math.sin(2 * Math.PI * ((y * p.cs) / it.length + it.speed * t)));
    for (let x = 0; x < W; x++) {
      const sx = x - off;
      if (sx < 0 || sx >= W) continue;
      const a = (y * W + sx) * 4, b = (y * W + x) * 4;
      d[b] = s[a]; d[b + 1] = s[a + 1]; d[b + 2] = s[a + 2]; d[b + 3] = s[a + 3];
    }
  }
  return out;
}

const toCanvas = (img) => {
  if (!img) return null;
  const c = createCanvas(img.width, img.height);
  c.getContext('2d').putImageData(img, 0, 0);
  return c;
};
const isEmpty = (img) => { const d = img.data; for (let i = 3; i < d.length; i += 4) if (d[i]) return false; return true; };

// 1フレーム分。戻り値 { x, y, w, h(ワールド), back, front, body(キャンバス or null) }
export function renderFx(p, fx, frame, frames) {
  const t = frames > 1 ? frame / frames : 0;
  const back = newBuf(p), front = newBuf(p);
  let body = null;
  for (const it of fx.items) {
    if (it.on === false) continue;
    switch (it.type) {
      case 'aura': renderAura(p, it, t, back); break;
      case 'fire': renderFire(p, it, t, back, it.front !== false ? front : null); break;
      case 'glow': renderGlow(p, it, t, back); break;
      case 'shadow': renderShadow(p, it, back); break;
      case 'spark': renderSpark(p, it, frame, front); break;
      case 'sparkle': renderSparkle(p, it, t, front); break;
      case 'rise': renderRise(p, it, t, front); break;
      case 'flash': renderFlash(p, it, t, frame, front); break;
      case 'particle': renderGdParticles(p, it, t, frames <= 1, it.layer === 'back' ? back : front); break;
      case 'wave': { const w = renderWave(p, it, t); p = { ...p, img: w }; body = w; break; }
    }
  }
  return {
    x: p.x, y: p.y, w: p.W * p.cs, h: p.H * p.cs,
    back: isEmpty(back) ? null : toCanvas(back),
    front: isEmpty(front) ? null : toCanvas(front),
    body: toCanvas(body),
  };
}

// ---- 入口(画面・書き出しの両方から) ----

// キャッシュ: セル(リグで動いているときはリグの結果)ごとに形の情報とフレームごとの絵
const cache = new WeakMap();

// getContent(): 絵の枠 {x0,y0,x1,y1}(ワールド。作り直すときだけ呼ぶ)。limits: 描ける範囲。paint(ctx, rect): ワールド座標でレイヤーを描く
export function layerFx({ layer, keyObj, version, getContent, limits, frame, frames, paint }) {
  const fx = layer.fx;
  if (!hasFx(fx) || !keyObj) return null;
  const pad = Math.max(...fx.items.filter((it) => it.on !== false).map(padOf), 1);
  const key = [version, gdpVersion(), JSON.stringify(fx), layer.pixel || 0, JSON.stringify(layer.pixelGrad || null), frames,
    limits.x0, limits.y0, limits.x1, limits.y1].join('|');
  let e = cache.get(keyObj);
  if (!e || e.key !== key) {
    const content = getContent();
    if (!content) { cache.set(keyObj, { key, prep: null }); return null; }
    // マスの大きさ: ドットの大きさ。大きな絵は 36万マスまでに粗くする
    let x0 = Math.max(limits.x0, content.x0 - pad), y0 = Math.max(limits.y0, content.y0 - pad);
    let x1 = Math.min(limits.x1, content.x1 + pad), y1 = Math.min(limits.y1, content.y1 + pad);
    let cs = Math.max(1, fx.dot || 1);
    while (((x1 - x0) / cs) * ((y1 - y0) / cs) > MAX_FX_CELLS) cs++;
    // マス目をワールドの原点にそろえる
    x0 = Math.floor(x0 / cs) * cs; y0 = Math.floor(y0 / cs) * cs;
    x1 = Math.ceil(x1 / cs) * cs; y1 = Math.ceil(y1 / cs) * cs;
    const prep = x1 > x0 && y1 > y0 ? prepare({ x0, y0, x1, y1 }, cs, paint) : null;
    e = { key, prep, frames: new Map() };
    cache.set(keyObj, e);
  }
  if (!e.prep) return null;
  const f = frames > 0 ? ((frame % frames) + frames) % frames : 0;
  let r = e.frames.get(f);
  if (!r) {
    r = renderFx(e.prep, fx, f, frames);
    e.frames.set(f, r);
  }
  return r;
}

// ワールド座標の ctx に、効果の絵(back / front / body)を描く
export function drawFxPart(ctx, r, part) {
  const c = r && r[part];
  if (!c) return;
  const s = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(c, r.x, r.y, r.w, r.h);
  ctx.imageSmoothingEnabled = s;
}
