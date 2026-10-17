// テクスチャの自動生成(計算で模様を作る。AI・インターネットは使わない)
//   makeTexture(opts) → ImageData。画面のダイアログ(texturedlg.js)と Claude 連携(mcp.js)の両方から使う
//   opts = { type, width, height, seed, scale(模様の大きさの倍率、1 = 標準), colors(暗い → 明るいの色の並び),
//            mortar(目地の色。レンガ・石畳・タイル), seamless(並べても継ぎ目が出ない), levels(色の段数。0 = なめらか),
//            pixel(1ドットの大きさ px。2 以上でドット絵風) }
//   しくみ: 種類ごとに 0〜1 の値(目地は -1)を計算 → 色の並びに当てはめる。継ぎ目なしは、ノイズ・格子を周期的にする
import { parseHex } from './color.js';

export const TEXTURE_TYPES = {
  clouds: { label: '雲・ノイズ', colors: ['#1e3a8a', '#60a5fa', '#f8fafc'] },
  dirt: { label: '土・砂', colors: ['#3f2a1d', '#6b4a2f', '#9a7148', '#c49a6c'] },
  grass: { label: '草', colors: ['#14532d', '#2f7d32', '#5fae3a', '#a3d65c'] },
  stone: { label: '石畳', colors: ['#4b5563', '#6b7280', '#9ca3af', '#d1d5db'], mortar: '#27272a' },
  brick: { label: 'レンガ', colors: ['#6b1d14', '#9c3426', '#c2553a', '#d9825f'], mortar: '#cfc6b8' },
  tiles: { label: 'タイル', colors: ['#0f766e', '#14b8a6', '#99f6e4'], mortar: '#e5e7eb' },
  wood: { label: '木目', colors: ['#5b3416', '#8b5a2b', '#b07a45', '#d6a56b'] },
  marble: { label: '大理石', colors: ['#6b7280', '#d1d5db', '#f8fafc'] },
  water: { label: '水面', colors: ['#0c4a6e', '#0284c7', '#38bdf8', '#e0f2fe'] },
  fabric: { label: '布(織り目)', colors: ['#7f1d1d', '#b91c1c', '#ef4444'] },
  // 和風の家の中(1.36.0)。大きい絵(512・1024px)は「模様の大きさ」を幅 ÷ 64 くらいにすると、1枚に畳2枚・板4〜16枚が入る
  tatami: { label: '畳', colors: ['#6f6a45', '#958f5e', '#b3ad78', '#cdc795'], mortar: '#23252b' },
  plaster: { label: '塗り壁(漆喰・砂壁)', colors: ['#b9b1a0', '#d3ccbc', '#e6e0d2'] },
  planks: { label: '板張り(床板)', colors: ['#4a3220', '#6e4b2e', '#8f6842', '#a98155'], mortar: '#1c140d' },
  ceiling: { label: '天井板(竿縁)', colors: ['#5a4630', '#8a7152', '#ab9272', '#c4ad8c'], mortar: '#2a2018' },
  oldwall: { label: '古い塗り壁(汚れ・しみ・ひび)', colors: ['#4f4538', '#8a7e6a', '#b0a48e', '#cbc0aa', '#ddd4c0'] },
  oldwood: { label: '古い板(風化した床板・縁側)', colors: ['#3a2a1c', '#5c4631', '#7d6144', '#916f4d', '#a8815a', '#d2a372'], mortar: '#120c07' },
};

export const TEXTURE_DEFAULTS = { type: 'clouds', width: 64, height: 64, seed: 1, scale: 1, seamless: true, levels: 0, pixel: 1 };

// ---- 乱数・ノイズ(周期つき) ----

function hash(x, y, s) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (s | 0) * 2147483647;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const mod = (a, n) => ((a % n) + n) % n;
const fade = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
const fract = (v) => v - Math.floor(v);

// 値ノイズ: 格子 px × py で一周する(継ぎ目なし)。(x, y) は格子の単位
function vnoise(x, y, px, py, s) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = fade(x - x0), fy = fade(y - y0);
  const X0 = mod(x0, px), X1 = mod(x0 + 1, px), Y0 = mod(y0, py), Y1 = mod(y0 + 1, py);
  return lerp(lerp(hash(X0, Y0, s), hash(X1, Y0, s), fx), lerp(hash(X0, Y1, s), hash(X1, Y1, s), fx), fy);
}

// 重ねたノイズ(fBm)。u, v は 0〜1 の位置、cx, cy は一番粗い格子の数
function fbm(u, v, cx, cy, s, oct = 5) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < oct; o++) {
    const k = 2 ** o;
    sum += amp * vnoise(u * cx * k, v * cy * k, cx * k, cy * k, s + o * 101);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

// ボロノイ(石畳): 格子 cx × cy に1点ずつ。F1・F2(近い点までの距離)と、いちばん近いセルの番号
function voronoi(u, v, cx, cy, s, aspect) {
  const x = u * cx, y = v * cy;
  const ix = Math.floor(x), iy = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const gx = ix + i, gy = iy + j;
      const wx = mod(gx, cx), wy = mod(gy, cy);
      const px = gx + 0.15 + 0.7 * hash(wx, wy, s), py = gy + 0.15 + 0.7 * hash(wx, wy, s + 7);
      const d = Math.hypot((px - x) * aspect, py - y);
      if (d < f1) { f2 = f1; f1 = d; id = wy * cx + wx; } else if (d < f2) f2 = d;
    }
  }
  return { f1, f2, id };
}

// ---- 種類ごとの値(0〜1。目地は -1) ----

function field(type, u, v, o) {
  const s = o.seed * 1013, k = o.scale, W = o.w, H = o.h;
  const n = (cells, oct) => fbm(u, v, Math.max(1, Math.round(cells * (W / 64) / k)), Math.max(1, Math.round(cells * (H / 64) / k)), s, oct);
  const cellsX = (c) => Math.max(1, Math.round((c * W) / 64 / k)), cellsY = (c) => Math.max(1, Math.round((c * H) / 64 / k));
  switch (type) {
    case 'clouds': return n(3, 6);
    case 'dirt': {
      const base = n(4, 5);
      const sp = hash(Math.floor(u * o.pw), Math.floor(v * o.ph), s + 5);
      return Math.min(1, Math.max(0, base * 0.85 + (sp > 0.93 ? 0.25 : sp < 0.05 ? -0.2 : 0)));
    }
    case 'grass': {
      // 縦に長い草の筋(横は細かく・縦は粗いノイズ)+ ところどころ明るい葉先
      const cx = cellsX(24), cy = cellsY(4);
      const blades = fbm(u, v, cx, cy, s, 3);
      const base = n(3, 4);
      const tip = hash(Math.floor(u * o.pw), Math.floor(v * o.ph), s + 9) > 0.96 ? 0.25 : 0;
      return Math.min(1, blades * 0.65 + base * 0.35 + tip);
    }
    case 'stone': {
      const cx = cellsX(4), cy = cellsY(4);
      const { f1, f2, id } = voronoi(u, v, cx, cy, s, (W / cx) / (H / cy));
      if (f2 - f1 < 0.08) return -1;
      const tone = hash(id, 0, s + 3);
      const bevel = Math.min(1, (f2 - f1) * 3);
      return Math.min(1, tone * 0.45 + n(6, 4) * 0.35 + bevel * 0.25);
    }
    case 'brick': {
      const rows = Math.max(2, Math.round(cellsY(8) / 2) * 2), cols = Math.max(1, cellsX(4));
      const y = v * rows, row = Math.floor(y);
      const x = u * cols + (row % 2 ? 0.5 : 0), col = Math.floor(x);
      // 目地の太さ: 1ドット(大きい絵は少し太く)
      const m = Math.max(1, Math.round(o.pw / 64));
      const fx = fract(x), fy = fract(y);
      if (fx < m / (o.pw / cols) || fy < m / (o.ph / rows)) return -1;
      const tone = hash(mod(col, cols), row, s + 3);
      return Math.min(1, tone * 0.5 + n(8, 4) * 0.4 + (fy > 0.85 ? -0.1 : 0) + 0.05);
    }
    case 'tiles': {
      const cols = Math.max(1, cellsX(2)), rows = Math.max(1, cellsY(2));
      const x = u * cols, y = v * rows, fx = fract(x), fy = fract(y);
      const m = Math.max(1, Math.round(o.pw / 64));
      if (fx < m / (o.pw / cols) || fy < m / (o.ph / rows)) return -1;
      const tone = hash(Math.floor(x), Math.floor(y), s + 3);
      const edge = Math.min(fx - 0.05, fy - 0.05, 1 - fx, 1 - fy) * 6;
      return Math.min(1, 0.35 + tone * 0.3 + Math.min(1, edge) * 0.25 + n(6, 3) * 0.1);
    }
    case 'wood': {
      // 縦の年輪(横に何本か)を、ノイズでゆらす。本数は整数なので継ぎ目なし
      const rings = Math.max(1, cellsX(6));
      const warp = fbm(u, v, cellsX(2), cellsY(1), s, 4);
      const r = fract(u * rings + warp * 2.5);
      const grain = fbm(u, v, cellsX(32), cellsY(2), s + 5, 3);
      return Math.min(1, Math.max(0, 0.25 + 0.55 * Math.pow(Math.sin(r * Math.PI), 0.6) + (grain - 0.5) * 0.4));
    }
    case 'marble': {
      const t = n(3, 6);
      const stripes = Math.max(1, cellsX(2));
      const vein = Math.abs(Math.sin((u * stripes + v * stripes + t * 3) * Math.PI));
      return Math.min(1, Math.pow(vein, 0.35) * 0.85 + t * 0.15);
    }
    case 'water': {
      const t = n(3, 5);
      const ripple = Math.abs(Math.sin(t * Math.PI * 6));
      return Math.min(1, 0.6 * t + 0.4 * (1 - ripple) ** 3 + (1 - ripple) ** 12 * 0.5);
    }
    case 'fabric': {
      const cx = cellsX(8), cy = cellsY(8);
      const x = u * cx, y = v * cy, ix = Math.floor(x), iy = Math.floor(y);
      const over = (ix + iy) % 2 === 0; // 縦糸が上か横糸が上か(市松)
      const f = over ? fract(x) : fract(y);
      const thread = Math.sin(f * Math.PI);
      return Math.min(1, 0.25 + thread * 0.55 + (over ? 0.1 : 0) + n(4, 3) * 0.15);
    }
    case 'tatami': {
      // 1周に畳2枚(横に並ぶ)。目地の色 = 畳のへり。短い辺の合わせ目は、となりの畳と半分ずらす
      const px = cellsX(1), py = cellsY(1);
      const x = u * px * 2, mat = mod(Math.floor(x), px * 2), fx = fract(x);
      const mw = o.pw / (px * 2), mh = o.ph / py;
      const hw = Math.max(1, Math.round(mw * 0.034));
      const de = Math.min(fx, 1 - fx) * mw; // へりの外側の端までの px
      if (de < hw) return -1;
      const y = v * py + (mat % 2 ? 0.5 : 0), fy = fract(y), row = mod(Math.floor(y), py);
      const dj = Math.min(fy, 1 - fy) * mh, jw = Math.max(0.5, mh / 500);
      if (dj < jw) return 0.02; // 短い辺の合わせ目(となりの畳との境)
      // い草の目: 横の細い筋(4px で1本)と、縦糸のくぼみ(8px ごと)。本数は整数なので継ぎ目なし
      const lines = Math.max(2, Math.round(o.ph / 4)), cols = Math.max(2, Math.round(o.pw / 8));
      const ridge = 0.5 + 0.5 * Math.sin(v * lines * 2 * Math.PI);
      const dip = Math.pow(Math.max(0, Math.cos(u * cols * 2 * Math.PI)), 6);
      const tone = hash(mod(Math.floor(v * lines), lines), mat * 31 + row, s + 3);
      const streak = fbm(u, v, Math.max(1, cellsX(3)), lines, s + 5, 2);
      const stain = n(2, 4), mt = hash(mat, row, s + 11);
      const edge = Math.max(0, 1 - (de - hw) / (hw * 1.5)) * 0.12 + Math.max(0, 1 - (dj - jw) / (jw * 3)) * 0.14; // へり・合わせ目の際の影
      return Math.min(1, Math.max(0, 0.5 + (ridge - 0.5) * 0.2 + (tone - 0.5) * 0.2 + (streak - 0.5) * 0.3 + (stain - 0.5) * 0.45 + (mt - 0.5) * 0.12 - dip * 0.14 - edge));
    }
    case 'plaster': {
      // 大きなむら + 細かいむら + 砂の粒(1ドットごと)。ところどころに明るい粒・暗い粒
      const sp = hash(Math.floor(u * o.pw), Math.floor(v * o.ph), s + 5), sp2 = hash(Math.floor(u * o.pw), Math.floor(v * o.ph), s + 9);
      const grit = sp2 > 0.985 ? 0.2 : sp2 < 0.012 ? -0.25 : 0;
      return Math.min(1, Math.max(0, 0.5 + (n(2, 5) - 0.5) * 0.45 + (n(12, 3) - 0.5) * 0.3 + (sp - 0.5) * 0.26 + grit));
    }
    case 'planks': {
      // 縦に長い板を横に並べる。目地の色 = 板のすき間。板ごとに、色・木目のずれ・継ぎ手の位置を変える
      const nb = Math.max(1, cellsX(4)), segs = Math.max(1, Math.round(cellsY(1) / 4));
      const x = u * nb, b = mod(Math.floor(x), nb), fx = fract(x), bw = o.pw / nb;
      const m = Math.max(1, Math.round(o.pw / 256));
      if (fx * bw < m) return -1;
      const y = v * segs + hash(b, 1, s + 2), fy = fract(y), seg = mod(Math.floor(y), segs);
      if (fy * (o.ph / segs) < m) return -1;
      const tone = hash(b, seg + 7, s + 3), off = hash(b, seg + 3, s + 4);
      const warp = fbm(u + off, v + off, cellsX(2), cellsY(1), s, 3);
      const r = fract((u + off) * Math.max(1, cellsX(10)) + warp * 2.2);
      const grain = fbm(u + off, v + off, cellsX(40), cellsY(1.5), s + 5, 4);
      const edge = fx * bw < m + 1.5 || (1 - fx) * bw < 1.5 ? 0.1 : 0;
      return Math.min(1, Math.max(0, 0.2 + tone * 0.3 + 0.28 * Math.pow(Math.sin(r * Math.PI), 0.7) + (grain - 0.5) * 0.4 + (n(2, 3) - 0.5) * 0.2 - edge));
    }
    case 'oldwall': {
      // 築100年くらいの塗り壁。1枚 = 壁1面の高さ(上が天井・下が床): 上のすす、下の汚れ、雨だれのような縦のしみ、
      // はがれて下地が見える所、細いひび、大きなむら + ざらつき(1px と 2px の粒)
      const ix = Math.floor(u * o.pw), iy = Math.floor(v * o.ph);
      const sp = hash(ix, iy, s + 5), sp2 = hash(ix, iy, s + 9), sp3 = hash(ix >> 1, iy >> 1, s + 6);
      const grit = sp2 > 0.975 ? 0.22 : sp2 < 0.03 ? -0.28 : 0;
      const wr = o.wear === undefined ? 1 : o.wear; // 傷みの量(0〜1)
      const big = n(1.5, 4), mid = n(5, 4), fin = n(14, 3);
      const wob = fbm(u, v, cellsX(6), cellsY(6), s + 23, 3) - 0.5;
      // 上と下の汚れ(継ぎ目で同じ濃さになる)
      const band = 0.34 * wr * Math.max(Math.exp(-v / Math.max(0.01, 0.05 + 0.06 * wob)), Math.exp(-(1 - v) / Math.max(0.02, 0.13 + 0.2 * wob)));
      // 縦のしみ: 横に細かく・縦に長いノイズ。場所によって出たり出なかったり、上ほど濃い
      const st = fbm(u, v, cellsX(30), cellsY(1.2), s + 22, 3), sm = fbm(u, v, cellsX(3), cellsY(1), s + 26, 2);
      const streak = wr * Math.max(0, st - 0.58) * 2.0 * Math.max(0, sm - 0.5) * 2.6 * Math.max(0, 1 - v * 0.95);
      // はがれ: ノイズが高い所は下地(暗い)。ふちは少し明るい(塗りの厚みの欠け)
      const pt = fbm(u, v, cellsX(4.5), cellsY(4.5), s + 21, 5);
      const pth = 0.7 + (1 - wr) * 0.1, peel = pt > pth ? 0.17 + (mid - 0.5) * 0.25 : pt > pth - 0.01 ? -0.07 : 0;
      // ひび: ボロノイの境目(まっすぐな線が角で折れて枝分かれする = カクカクした割れ)。太い割れと、細い割れの2段。出る場所はノイズで決める
      const c1x = Math.max(2, cellsX(2.5)), c1y = Math.max(2, cellsY(2.5)), c2x = Math.max(2, cellsX(7)), c2y = Math.max(2, cellsY(7));
      // 線を小刻みに折る: なめらかにしない(直線でつないだ)ノイズで位置をずらす → ギザギザ
      const zx = Math.max(4, Math.round(o.pw / 22)), zy = Math.max(4, Math.round(o.ph / 22));
      const zig = (sd) => { const X = u * zx, Y = v * zy, x0 = Math.floor(X), y0 = Math.floor(Y), fx2 = X - x0, fy2 = Y - y0, h = (i, j) => hash(mod(x0 + i, zx), mod(y0 + j, zy), sd);
        return lerp(lerp(h(0, 0), h(1, 0), fx2), lerp(h(0, 1), h(1, 1), fx2), fy2) - 0.5; };
      const ju = u + zig(s + 30) * 14 / o.pw, jv = v + zig(s + 31) * 14 / o.ph;
      const v1 = voronoi(ju, jv, c1x, c1y, s + 24, (W / c1x) / (H / c1y)), v2 = voronoi(ju, jv, c2x, c2y, s + 27, (W / c2x) / (H / c2y));
      const cm = fbm(u, v, cellsX(2), cellsY(2), s + 25, 3), cm2 = fbm(u, v, cellsX(3), cellsY(3), s + 28, 3);
      const ct = 0.5 + (1 - wr) * 0.13, crack = (cm > ct && v1.f2 - v1.f1 < (0.004 + 0.01 * Math.min(1, (cm - ct) * 5)) * (0.5 + 0.5 * wr) ? 0.45 : 0) + (cm2 > 0.56 + (1 - wr) * 0.12 && v2.f2 - v2.f1 < 0.012 ? 0.3 : 0);
      const val = 0.66 + (big - 0.5) * 0.6 * (0.4 + 0.6 * wr) + (mid - 0.5) * 0.4 * (0.5 + 0.5 * wr) + (fin - 0.5) * 0.22 + (sp - 0.5) * 0.24 + (sp3 - 0.5) * 0.14 + grit - band - streak - peel - crack;
      return Math.min(1, Math.max(0, val));
    }
    case 'oldwood': {
      // 風化した古い板(縁側・床板): 縦に長い板。不ぞろいなすき間(目地の色)、強い繊維の筋、節、細い割れ、釘の頭の列
      const nb = Math.max(1, cellsX(4));
      const x = u * nb, b = mod(Math.floor(x), nb), fx = fract(x), bw = o.pw / nb;
      const gv = Math.max(2, cellsY(8));
      const gw = Math.max(1, o.pw / 300) * (0.7 + 1.0 * vnoise(v * gv, b * 3.7, gv, 4096, s + 1));
      if (fx * bw < gw) return -1;
      const tone = hash(b, 7, s + 3), off = hash(b, 3, s + 4);
      // 節: 板ごとに 0〜2 個。まわりの年輪が曲がり、中心は暗い
      let knot = 0, bend = 0;
      for (let k = 0; k < 2; k++) {
        if (hash(b, 20 + k, s + 12) > 0.6) continue;
        const kx = 0.25 + 0.5 * hash(b, 30 + k, s + 13), kv = hash(b, 40 + k, s + 14), rad = bw * (0.06 + 0.07 * hash(b, 50 + k, s + 15));
        let dv = v - kv; dv -= Math.round(dv);
        const dx = (fx - kx) * bw, dy = dv * o.ph, d = Math.hypot(dx, dy * 0.55) / rad;
        bend += Math.exp(-d * d / 5) * (dx < 0 ? -1 : 1) * 0.9;
        if (d < 1.5) knot = Math.max(knot, d < 1 ? 0.75 + 0.25 * Math.cos(d * 9) : (1.5 - d) * 1.1);
      }
      const warp = fbm(u + off, v + off, cellsX(2), cellsY(1), s, 3);
      const r = fract((u + off) * Math.max(1, cellsX(9)) + warp * 2.4 + bend);
      const fib = fbm(u + off, v + off, cellsX(72), cellsY(2), s + 5, 3), fib2 = fbm(u + off, v, cellsX(26), cellsY(1), s + 6, 3);
      // 細い繊維(2〜3px の筋)と、細い割れ(繊維に沿った暗い線)
      const fine = fbm(u + off, v + off, Math.max(4, Math.round(o.pw / 2.5)), cellsY(3), s + 7, 2), fine2 = fbm(u + off, v, Math.max(4, Math.round(o.pw / 5)), cellsY(5), s + 8, 2);
      const cr = fbm(u + off, v + off * 3, Math.max(4, Math.round(o.pw / 4)), cellsY(2.2), s + 9, 2), cr2 = fbm(u, v + off, cellsX(40), cellsY(1.2), s + 10, 2);
      const crack = (cr > 0.7 ? Math.min(0.55, (cr - 0.7) * 7) : 0) + (cr2 > 0.74 ? Math.min(0.3, (cr2 - 0.74) * 4) : 0);
      // 釘の頭: 1周に1列(v = 0.63 のあたり)、板ごとに少しずれる
      const nr = Math.max(1, Math.round(cellsY(1) / 4)), ny = fract(v * nr - 0.63 + (hash(b, 60, s + 16) - 0.5) * 0.02);
      const nd = Math.hypot((fx - 0.5 - (hash(b, 61, s + 17) - 0.5) * 0.3) * bw, (ny > 0.5 ? ny - 1 : ny) * (o.ph / nr)), nrad = Math.max(1.2, bw * 0.035);
      if (nd < nrad) return nd < nrad * 0.45 ? 0.3 : 0.06;
      const edge = Math.exp(-(fx * bw - gw) / (bw * 0.05)) * 0.2 + Math.exp(-((1 - fx) * bw) / (bw * 0.04)) * 0.12;
      const val = 0.4 + tone * 0.16 + 0.08 * Math.pow(Math.sin(r * Math.PI), 0.7) + (fib - 0.5) * 0.45 + (fib2 - 0.5) * 0.25 + (fine - 0.5) * 0.7 + (fine2 - 0.5) * 0.45 + (n(2, 3) - 0.5) * 0.3 - crack - edge - knot * 0.35;
      return Math.min(1, Math.max(0, val));
    }
    case 'ceiling': {
      // 幅の広い板(板目 = 山形の木目)を横に並べ、直角に細い竿縁を渡す。目地の色 = 板の重なりの影
      const nb = Math.max(1, cellsX(2)), nr = Math.max(1, cellsY(2));
      const x = u * nb, b = mod(Math.floor(x), nb), fx = fract(x), bw = o.pw / nb;
      const m = Math.max(1, Math.round(o.pw / 340));
      const y = v * nr, fy = fract(y), rh = o.ph / nr, rw = Math.max(1, Math.round(rh * 0.035));
      const dr = Math.min(fy, 1 - fy) * rh; // 竿縁の中心までの px
      if (dr < rw) return Math.min(1, 0.08 + 0.16 * fbm(u, v, cellsX(3), cellsY(40), s + 8, 3) + (fy < 0.5 ? 0 : 0.07));
      if (fx * bw < m) return -1;
      const tone = hash(b, 5, s + 3), off = hash(b, 9, s + 4);
      const warp = fbm(u + off, v, cellsX(2), cellsY(1), s, 3);
      const h = (fx - 0.5) * 2 + (warp - 0.5) * 0.5;
      const r = fract(h * h * 5 + 0.9 * Math.sin((v + off) * 2 * Math.PI) + warp * 1.5);
      const grain = fbm(u + off, v, cellsX(36), cellsY(1.5), s + 5, 3);
      const shadow = fy < 0.5 && dr < rw * 3.5 ? 0.22 * (1 - (dr - rw) / (rw * 2.5)) : 0; // 竿縁の下の影
      const lap = fx * bw < m + 2 ? 0.1 : 0;
      // 古び(wear): 板ごとの色の差が大きくなり、すすけた暗いむらと、竿縁の際の黒ずみが出る
      const wr = o.wear === undefined ? 1 : o.wear, soot = fbm(u, v, cellsX(1.5), cellsY(1.5), s + 31, 4), dark = wr * (0.3 * Math.max(0, soot - 0.38) + 0.07 * Math.exp(-(dr - rw) / (rw * 4)));
      return Math.min(1, Math.max(0, 0.3 + tone * (0.2 + 0.14 * wr) + 0.26 * Math.pow(Math.sin(r * Math.PI), 0.6) + (grain - 0.5) * 0.3 + (n(2, 3) - 0.5) * 0.25 - shadow - lap - dark));
    }
  }
  return 0;
}

// ---- 色 ----

function rgbOf(c) {
  const p = parseHex(c.startsWith('#') ? c : '#' + c);
  return [p.r, p.g, p.b, p.a ?? 255];
}

function colorAt(stops, t) {
  if (stops.length === 1) return stops[0];
  const x = Math.min(0.999999, Math.max(0, t)) * (stops.length - 1);
  const i = Math.floor(x), f = x - i;
  const a = stops[i], b = stops[i + 1];
  return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f), lerp(a[3], b[3], f)];
}

// ---- 本体 ----

export function textureOptions(o = {}) {
  const t = TEXTURE_TYPES[o.type] ? o.type : 'clouds';
  const def = TEXTURE_TYPES[t];
  const clampInt = (v, lo, hi, d) => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(+v) ? +v : d)));
  return {
    type: t,
    width: clampInt(o.width, 1, 4096, TEXTURE_DEFAULTS.width),
    height: clampInt(o.height, 1, 4096, TEXTURE_DEFAULTS.height),
    seed: clampInt(o.seed, 0, 2 ** 31 - 1, TEXTURE_DEFAULTS.seed),
    scale: Math.min(16, Math.max(0.125, Number(o.scale) || 1)),
    colors: Array.isArray(o.colors) && o.colors.length ? o.colors.slice(0, 16) : def.colors,
    mortar: o.mortar || def.mortar || '#222222',
    seamless: o.seamless !== false,
    levels: clampInt(o.levels, 0, 32, 0),
    pixel: clampInt(o.pixel, 1, 64, 1),
    // 傷み・汚れの量(0 = きれい 〜 1 = 荒れている)。古い塗り壁(oldwall)と天井板(ceiling)で使う
    wear: Math.min(1, Math.max(0, o.wear === undefined || !Number.isFinite(+o.wear) ? 1 : +o.wear)),
  };
}

export function makeTexture(opts) {
  const o = textureOptions(opts);
  const { width: W, height: H, pixel: P } = o;
  // ドット絵風: 小さく作ってから拡大(ぼかさない)
  const w = Math.max(1, Math.round(W / P)), h = Math.max(1, Math.round(H / P));
  const stops = o.colors.map(rgbOf), mortar = rgbOf(o.mortar);
  const small = new Uint8ClampedArray(w * h * 4);
  // 継ぎ目なしでないときは、周期を十分大きくして(1周の 4 倍の中の一部を使う)つながらないようにする
  const span = o.seamless ? 1 : 0.25, off = o.seamless ? 0 : 0.37;
  const ctx = { seed: o.seed, scale: o.scale, w: W, h: H, pw: w, ph: h, wear: o.wear };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = off + ((x + 0.5) / w) * span, v = off + ((y + 0.5) / h) * span;
      let t = field(o.type, u, v, ctx);
      let c;
      if (t < 0) c = mortar;
      else {
        if (o.levels > 0) t = Math.min(o.levels - 1, Math.floor(t * o.levels)) / Math.max(1, o.levels - 1);
        c = colorAt(stops, t);
      }
      const i = (y * w + x) * 4;
      small[i] = c[0]; small[i + 1] = c[1]; small[i + 2] = c[2]; small[i + 3] = c[3];
    }
  }
  if (w === W && h === H) return new ImageData(small, W, H);
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(h - 1, Math.floor((y * h) / H));
    for (let x = 0; x < W; x++) {
      const sx = Math.min(w - 1, Math.floor((x * w) / W));
      out.set(small.subarray((sy * w + sx) * 4, (sy * w + sx) * 4 + 4), (y * W + x) * 4);
    }
  }
  return new ImageData(out, W, H);
}

// 範囲 w × h に、テクスチャを並べて敷き詰めた ImageData
export function tileImage(img, w, h) {
  const out = new ImageData(w, h);
  for (let y = 0; y < h; y++) {
    const sy = y % img.height;
    for (let x = 0; x < w; x++) {
      const si = (sy * img.width + (x % img.width)) * 4, di = (y * w + x) * 4;
      out.data[di] = img.data[si]; out.data[di + 1] = img.data[si + 1]; out.data[di + 2] = img.data[si + 2]; out.data[di + 3] = img.data[si + 3];
    }
  }
  return out;
}
