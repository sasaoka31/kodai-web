// 粒子のエフェクト(Free GDevelop Particles Library の 43 個の粒子を、Kodai のエフェクトとして動かす)
//   設定は gdparticles-data.js(scripts/import-gdparticles.py が作る)、粒の絵は src/particles/*.png。クレジットは src/particles/CREDITS.txt
//   GDevelop の粒子(出る数・速さ・重力・寿命・大きさ・濃さ・色の変化)を、時刻から直接計算する(乱数は粒の番号と種から。毎回同じ絵)。
//   一周(loop 秒)でぴったりつながるように、粒は一周の中の決まった時刻に生まれ、寿命が一周をまたぐ粒は次の周にも描く
//   大きさ: 粒子ごとの「広がり」(出る範囲 + 飛ぶ距離 + 粒の大きさ)を、エフェクトの size(px)に合わせて縮める
import { GDP, GDP_TEXTURES } from './gdparticles-data.js';
import { requestRender } from './state.js';
import { parseHex } from './color.js';

export { GDP };
export const GDP_NAMES = Object.keys(GDP);
export const GDP_OPTIONS = GDP_NAMES.map((k) => [k, GDP[k].label]);

// ---- 粒の絵(起動のときに読む。読めるまでは絵のある粒子は出ない → 読めたら描き直す) ----
const TEX = {};
let version = 0;
export const gdpVersion = () => version;
function load(name) {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas');
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(im, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height);
      TEX[name] = { w: c.width, h: c.height, data: d.data };
      resolve();
    };
    im.onerror = () => { console.warn('粒子の絵を読めない: ' + name); resolve(); };
    im.src = `./particles/${name}.png`;
  });
}
export const gdpReady = typeof Image === 'undefined' ? Promise.resolve() : Promise.all(GDP_TEXTURES.map(load)).then(() => { version++; try { requestRender(); } catch { /* 画面がまだない */ } });

// ---- 計算 ----
const lerp = (a, b, t) => a + (b - a) * t;
const mod = (a, n) => ((a % n) + n) % n;
function rng(seed) {
  let a = (seed | 0) ^ 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// 粒の基準の大きさ(px。大きさ 100% のとき)
function baseSize(P) {
  if (P.kind === 'quad') return [P.tw, P.th]; // 絵の粒は、絵そのものの大きさ × 大きさ(%)。r(基準の幅)は使わない(r で決めると、雪・魔法の光が点にしかならなかった)
  if (P.kind === 'point') return [Math.max(1, P.r[0]), Math.max(1, P.r[0])];
  return [Math.max(1, P.r[0]), Math.max(1, P.r[1])];
}
// 広がり(出る所からいちばん遠くまで届く距離の目安。px)
const EXT = {};
function extent(name) {
  if (EXT[name]) return EXT[name];
  const P = GDP[name], L = P.life[1], f = P.f[1];
  const fly = Math.max(f * L * 0.75, Math.hypot(P.g[0], P.g[1]) * L * L * 0.25);
  const [bw, bh] = baseSize(P), s = Math.max(P.size[0], P.size[1]) / 100;
  return (EXT[name] = Math.max(8, P.zone + fly + Math.max(bw, bh) * s * 0.5));
}

function putOver(d, k, r, g, b, a) {
  const da = d[k + 3] / 255, oa = a + da * (1 - a);
  if (oa <= 0) return;
  d[k] = (r * a + d[k] * da * (1 - a)) / oa; d[k + 1] = (g * a + d[k + 1] * da * (1 - a)) / oa; d[k + 2] = (b * a + d[k + 2] * da * (1 - a)) / oa; d[k + 3] = oa * 255;
}
// 足し算(光る粒): 色を足して、濃さも足す
function putAdd(d, k, r, g, b, a) {
  const da = d[k + 3] / 255, oa = Math.min(1, da + a);
  if (oa <= 0) return;
  d[k] = Math.min(255, (d[k] * da + r * a) / oa); d[k + 1] = Math.min(255, (d[k + 1] * da + g * a) / oa); d[k + 2] = Math.min(255, (d[k + 2] * da + b * a) / oa); d[k + 3] = oa * 255;
}

// 形の枠(マス)。p にしまっておく
function shapeBox(p) {
  if (p._gdpBox) return p._gdpBox;
  const { W, H, M } = p;
  let x0 = W, y0 = H, x1 = -1, y1 = -1; const inside = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (M[y * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (((x * 7 + y * 13) & 3) === 0) inside.push(y * W + x); }
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = W - 1; y1 = H - 1; }
  return (p._gdpBox = { x0, y0, x1: x1 + 1, y1: y1 + 1, inside });
}

// p: 形の情報(effects.js の prepare)、it: エフェクトの値、t: 0〜1(一周)、still: フレームが1つ(止まった絵)
export function renderGdParticles(p, it, t, still, buf) {
  const P = GDP[it.preset];
  if (!P) return;
  const tex = P.kind === 'quad' ? TEX[P.tex] : null;
  if (P.kind === 'quad' && !tex) return;
  const { W, H, cs } = p, d = buf.data, box = shapeBox(p);
  const k = it.size / extent(it.preset) / cs; // GDevelop の 1px → マス
  const T = Math.max(0.25, it.loop), tau = still ? T * 0.6 : t * T;
  const burst = P.tank > 0;
  const n = Math.max(1, Math.min(400, P.max, Math.round((burst ? P.tank : P.flow * T) * it.amount)));
  const dir0 = (P.dir + it.angle) * Math.PI / 180, cone = P.cone * Math.PI / 180;
  const tint = it.tint === 'on' ? parseHex(it.color) : null;
  const put = P.add ? putAdd : putOver;
  // 出る所(マス)
  const ex = (box.x0 + box.x1) / 2, ey = it.where === 'top' ? box.y0 : it.where === 'bottom' ? box.y1 : (box.y0 + box.y1) / 2;
  const [bw, bh] = baseSize(P);
  for (let i = 0; i < n; i++) {
    const R = rng(it.seed * 7919 + i * 104729 + 13);
    const born = burst ? Math.min(T * 0.5, i / Math.max(1, P.flow)) : ((i + R()) / n) * T;
    const life = Math.max(0.05, lerp(P.life[0], P.life[1], R()));
    const a0 = R() * Math.PI * 2, rr = Math.sqrt(R()) * P.zone * k;
    let sx = ex + Math.cos(a0) * rr, sy = ey + Math.sin(a0) * rr;
    if (it.where === 'shape' && box.inside.length) { const c = box.inside[Math.floor(R() * box.inside.length)]; sx = (c % W) + 0.5; sy = ((c / W) | 0) + 0.5; }
    const ang = dir0 + (R() - 0.5) * cone, sp = lerp(P.f[0], P.f[1], R());
    const vx = Math.cos(ang) * sp, vy = Math.sin(ang) * sp;
    const rotSp = lerp(P.rot[0], P.rot[1], R()) * Math.PI / 180, rot0 = P.rot[0] || P.rot[1] ? R() * Math.PI * 2 : 0;
    const cr = [R(), R(), R()];
    for (let age = mod(tau - born, T); age < life; age += T) {
      if (burst && still && age > life) break;
      const u = age / life;
      const alpha = Math.min(1, Math.max(0, lerp(P.alpha[0], P.alpha[1], u) / 255));
      const sz = Math.max(0, lerp(P.size[0], P.size[1], u) / 100);
      if (alpha < 0.01 || sz <= 0) continue;
      const x = sx + (vx * age + 0.5 * P.g[0] * age * age) * k, y = sy + (vy * age + 0.5 * P.g[1] * age * age) * k;
      let col;
      if (tint) col = [tint.r, tint.g, tint.b];
      else col = [0, 1, 2].map((c) => (P.cmode[c] === 'Mutable' ? lerp(P.c1[c], P.c2[c], u) : P.cmode[c] === 'Random' ? lerp(P.c1[c], P.c2[c], cr[c]) : P.c1[c]));
      if (P.kind === 'quad') {
        const w = bw * sz * k, h = bh * sz * k;
        if (w < 0.6 || h < 0.6) { const xi = Math.floor(x), yi = Math.floor(y); if (xi >= 0 && yi >= 0 && xi < W && yi < H) put(d, (yi * W + xi) * 4, col[0], col[1], col[2], alpha * Math.min(1, w * h)); continue; }
        const th = rot0 + rotSp * age, co = Math.cos(th), si = Math.sin(th), rad = Math.hypot(w, h) / 2;
        const X0 = Math.max(0, Math.floor(x - rad)), X1 = Math.min(W - 1, Math.ceil(x + rad)), Y0 = Math.max(0, Math.floor(y - rad)), Y1 = Math.min(H - 1, Math.ceil(y + rad));
        if ((X1 - X0) * (Y1 - Y0) > 90000) continue; // 大きすぎる粒は描かない(重くなる)
        for (let yy = Y0; yy <= Y1; yy++) for (let xx = X0; xx <= X1; xx++) {
          const dx = xx + 0.5 - x, dy = yy + 0.5 - y;
          const uu = (dx * co + dy * si) / w + 0.5, vv = (-dx * si + dy * co) / h + 0.5;
          if (uu < 0 || vv < 0 || uu >= 1 || vv >= 1) continue;
          const ti = (((vv * tex.h) | 0) * tex.w + ((uu * tex.w) | 0)) * 4, ta = tex.data[ti + 3] / 255;
          if (ta <= 0.01) continue;
          put(d, (yy * W + xx) * 4, tex.data[ti] * col[0] / 255, tex.data[ti + 1] * col[1] / 255, tex.data[ti + 2] * col[2] / 255, ta * alpha);
        }
      } else if (P.kind === 'point') {
        const rad = Math.max(0.5, bw * sz * k / 2), Rr = Math.ceil(rad + 1);
        for (let yy = Math.floor(y) - Rr; yy <= Math.floor(y) + Rr; yy++) for (let xx = Math.floor(x) - Rr; xx <= Math.floor(x) + Rr; xx++) {
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const dd = Math.hypot(xx + 0.5 - x, yy + 0.5 - y);
          if (dd <= rad + 0.25) put(d, (yy * W + xx) * 4, col[0], col[1], col[2], alpha * Math.min(1, rad + 0.75 - dd));
        }
      } else {
        // 線: 進む向きに伸びる
        const wx = vx + P.g[0] * age, wy = vy + P.g[1] * age, wl = Math.hypot(wx, wy) || 1, ux = wx / wl, uy = wy / wl;
        const len = Math.max(1, bw * sz * k), wid = Math.max(0.5, bh * sz * k / 2), steps = Math.min(600, Math.ceil(len * 1.5));
        for (let s = 0; s <= steps; s++) {
          const f = s / steps, px = x - ux * len * f, py = y - uy * len * f, Rw = Math.ceil(wid);
          for (let oy = -Rw; oy <= Rw; oy++) for (let ox = -Rw; ox <= Rw; ox++) {
            const xx = Math.floor(px) + ox, yy = Math.floor(py) + oy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H || Math.hypot(ox, oy) > wid + 0.3) continue;
            put(d, (yy * W + xx) * 4, col[0], col[1], col[2], alpha * (1 - f * 0.7) * 0.5);
          }
        }
      }
    }
  }
}
