// 絵を立体にする(荒いポリゴン)。AI は使わず、輪郭からの計算だけ
//   buildSolid({ front, side?, back? }, opts) → { positions, uvs, normals, indices, atlas(キャンバス), stats }
//   ・カード: 輪郭を同じ厚みで押し出した板(紙の人形。2D の動きを 3D でやる用。既定。裏は表と同じ絵 = 裏から見ると左右が逆)
//   ・正面だけ: 輪郭を「ふくらませる」(真ん中ほど厚く、ふちほど薄い。輪郭の中に入る一番大きい玉を並べた形)
//   ・正面 + 真横: 2方向から型抜き(行ごとに、正面の幅 × 真横の奥行きの楕円。round を切ると四角いまま)
//   ・面は「サーフェスネット」(マス目の中に点を1つ置いて、となりどうしを四角でつなぐ)。マス目の数 res = 荒さ
//   ・絵は正面から(後ろ向きの面には後ろの絵。なければ正面を暗くしたもの)、真横の絵があれば横向きの面に貼る
//   座標: 書き出すときは x = 右、y = 上、z = 手前(glTF・Blender の取り込みと同じ)。足もとが y = 0
//   solidToGlb(solid, opts) → Uint8Array(.glb。絵は中に埋め込む)
import { createCanvas } from './document.js';

export const SOLID_DEFAULTS = {
  shape: 'card', // 形: card(同じ厚みの板)/ inflate(ふくらませる)/ auto(真横の絵があれば型抜き、なければふくらませる)
  cardDepth: 0.06, // カードの厚み(高さ比。thick を掛ける)
  res: 56, // 高さ方向のマス目の数(少ないほど荒い)
  thick: 1, // 厚みの倍率
  round: true, // 真横の絵があるとき、断面を丸くする
  flat: true, // 面をカクカクに見せる(法線を付けない)
  nearest: true, // 絵をドットのまま貼る(ぼかさない)
  sideLeft: false, // 真横の絵が左向き
  height: 1, // 書き出すときの高さ(m)
  backDark: 0.2, // 後ろの絵がないとき、正面の絵をどれだけ暗くして使うか
  backBlur: true, // 後ろの絵がないとき、正面の絵をぼかして色だけ使う(後頭部に顔が出ないように)
  inset: 0.03, // ふちの面が拾う色を、どれだけ内側にずらすか(高さ比)
  removeBg: 'auto', // 背景を抜く: auto(透明な所がない絵だけ)/ on / off
};
export const SOLID_RES = [12, 96];

// ---- 絵の下ごしらえ ----

// 四隅の色に近い所を、外側からたどって透明にする(透明のない絵 = 背景つきの絵用)
export function removeBackground(img, tol = 28) {
  const { width: W, height: H, data: d } = img;
  const out = new ImageData(new Uint8ClampedArray(d), W, H), o = out.data;
  const seen = new Uint8Array(W * H), stack = [];
  const corners = [0, W - 1, (H - 1) * W, H * W - 1];
  for (const c of corners) {
    const r = d[c * 4], g = d[c * 4 + 1], b = d[c * 4 + 2];
    stack.push(c);
    while (stack.length) {
      const i = stack.pop();
      if (seen[i]) continue;
      const k = i * 4;
      if (Math.abs(d[k] - r) > tol || Math.abs(d[k + 1] - g) > tol || Math.abs(d[k + 2] - b) > tol) continue;
      seen[i] = 1; o[k + 3] = 0;
      const x = i % W, y = (i / W) | 0;
      if (x > 0) stack.push(i - 1);
      if (x < W - 1) stack.push(i + 1);
      if (y > 0) stack.push(i - W);
      if (y < H - 1) stack.push(i + W);
    }
  }
  return out;
}
const hasTransparent = (img) => { const d = img.data; for (let i = 3; i < d.length; i += 4) if (d[i] < 128) return true; return false; };

export function bboxOf(img) {
  const { width: W, height: H, data: d } = img;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] >= 128) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// 絵の枠 b を nx × ny のマスに分けて、マスごとの「絵のある割合」(0〜1)。まわりに pad マスの空き
function coverage(img, b, nx, ny, pad) {
  const { width: W, data: d } = img;
  const GW = nx + pad * 2, GH = ny + pad * 2, g = new Float32Array(GW * GH);
  for (let j = 0; j < ny; j++) {
    const ya = b.y + Math.floor((j * b.h) / ny), yb = Math.max(ya + 1, b.y + Math.floor(((j + 1) * b.h) / ny));
    for (let i = 0; i < nx; i++) {
      const xa = b.x + Math.floor((i * b.w) / nx), xb = Math.max(xa + 1, b.x + Math.floor(((i + 1) * b.w) / nx));
      let n = 0, on = 0;
      for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) { n++; if (d[(y * W + x) * 4 + 3] >= 128) on++; }
      g[(j + pad) * GW + i + pad] = n ? on / n : 0;
    }
  }
  return { g, GW, GH };
}

// ---- 厚み(ふくらませる)----

// マスク(cov >= 0.5)の中の、ふちまでの距離 dist と、その場所を含む一番大きい玉の半径 R(マス単位)
function inflateDepth(cov, GW, GH) {
  const n = GW * GH, INF = 1e9, D = new Float32Array(n);
  for (let i = 0; i < n; i++) D[i] = cov[i] >= 0.5 ? INF : 0;
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const i = y * GW + x;
    if (!D[i]) continue;
    let v = D[i];
    if (x > 0) v = Math.min(v, D[i - 1] + 3);
    if (y > 0) { v = Math.min(v, D[i - GW] + 3); if (x > 0) v = Math.min(v, D[i - GW - 1] + 4); if (x < GW - 1) v = Math.min(v, D[i - GW + 1] + 4); }
    D[i] = v;
  }
  for (let y = GH - 1; y >= 0; y--) for (let x = GW - 1; x >= 0; x--) {
    const i = y * GW + x;
    if (!D[i]) continue;
    let v = D[i];
    if (x < GW - 1) v = Math.min(v, D[i + 1] + 3);
    if (y < GH - 1) { v = Math.min(v, D[i + GW] + 3); if (x < GW - 1) v = Math.min(v, D[i + GW + 1] + 4); if (x > 0) v = Math.min(v, D[i + GW - 1] + 4); }
    D[i] = v;
  }
  // ふちのマスは 0.5(マスの中心からふちまで)
  for (let i = 0; i < n; i++) if (D[i]) D[i] = D[i] / 3 - 0.5;
  // 玉の半径: 距離の山(まわりより大きい所)から、その半径の円を押して最大を取る
  const R = new Float32Array(n);
  for (let y = 1; y < GH - 1; y++) for (let x = 1; x < GW - 1; x++) {
    const i = y * GW + x, d = D[i];
    if (!d) continue;
    if (d < D[i - 1] || d < D[i + 1] || d < D[i - GW] || d < D[i + GW] || d < D[i - GW - 1] || d < D[i - GW + 1] || d < D[i + GW - 1] || d < D[i + GW + 1]) continue;
    const r = Math.ceil(d);
    for (let yy = Math.max(0, y - r); yy <= Math.min(GH - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(GW - 1, x + r); xx++) {
      if ((xx - x) ** 2 + (yy - y) ** 2 > (d + 0.5) ** 2) continue;
      const k = yy * GW + xx;
      if (D[k] && R[k] < d) R[k] = d;
    }
  }
  const Z = new Float32Array(n);
  for (let i = 0; i < n; i++) if (D[i]) { const r = Math.max(R[i], D[i]); Z[i] = Math.sqrt(Math.max(0, D[i] * (2 * r - D[i]))); }
  return Z;
}

// 1行の中の「つながった区間」[始め, 終わり](cov >= 0.5)
function runs(cov, off, n, step = 1) {
  const out = [];
  let s = -1;
  for (let i = 0; i < n; i++) {
    const on = cov[off + i * step] >= 0.5;
    if (on && s < 0) s = i;
    if (!on && s >= 0) { out.push([s, i - 1]); s = -1; }
  }
  if (s >= 0) out.push([s, n - 1]);
  return out;
}

// ---- 面を作る(サーフェスネット)----

function surfaceNets(f, nx, ny, nz) {
  const at = (i, j, k) => f[i + nx * (j + ny * k)];
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cell = new Int32Array(cx * cy * cz).fill(-1);
  const verts = [];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]; // かどの番号 = x + 2y + 4z
  const v = new Float32Array(8);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    let pos = 0;
    for (let c = 0; c < 8; c++) { v[c] = at(i + (c & 1), j + ((c >> 1) & 1), k + (c >> 2)); if (v[c] > 0) pos++; }
    if (pos === 0 || pos === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of E) {
      if ((v[a] > 0) === (v[b] > 0)) continue;
      const t = v[a] / (v[a] - v[b]);
      sx += (a & 1) + ((b & 1) - (a & 1)) * t; sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t; sz += (a >> 2) + ((b >> 2) - (a >> 2)) * t; n++;
    }
    cell[i + cx * (j + cy * k)] = verts.length / 3;
    verts.push(i + sx / n, j + sy / n, k + sz / n);
  }
  const cv = (i, j, k) => cell[i + cx * (j + cy * k)];
  const quads = [];
  const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) quads.push(a, d, c, b); else quads.push(a, b, c, d); };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = at(i, j, k) > 0;
    // 辺のまわりの4つのマスを、辺の向きに対して左回りに。中 → 外 の向きなら面は辺の向きを向く
    if (i < nx - 1 && j > 0 && k > 0 && j < ny - 1 && k < nz - 1 && a !== at(i + 1, j, k) > 0) quad(cv(i, j - 1, k - 1), cv(i, j, k - 1), cv(i, j, k), cv(i, j - 1, k), !a);
    if (j < ny - 1 && i > 0 && k > 0 && i < nx - 1 && k < nz - 1 && a !== at(i, j + 1, k) > 0) quad(cv(i - 1, j, k - 1), cv(i - 1, j, k), cv(i, j, k), cv(i, j, k - 1), !a);
    if (k < nz - 1 && i > 0 && j > 0 && i < nx - 1 && j < ny - 1 && a !== at(i, j, k + 1) > 0) quad(cv(i - 1, j - 1, k), cv(i, j - 1, k), cv(i, j, k), cv(i - 1, j, k), !a);
  }
  return { verts, quads };
}

// ---- 貼る絵(アトラス)----

// 透明な所へ、となりの色をにじませる(面のふちが絵の外に少し出ても色が付くように)。残りは平均の色で埋める
function bleed(ctx, x0, y0, w, h, rounds) {
  const img = ctx.getImageData(x0, y0, w, h), d = img.data;
  let filled = new Uint8Array(w * h), sr = 0, sg = 0, sb = 0, sn = 0;
  for (let i = 0; i < w * h; i++) if (d[i * 4 + 3] >= 128) { filled[i] = 1; sr += d[i * 4]; sg += d[i * 4 + 1]; sb += d[i * 4 + 2]; sn++; }
  for (let r = 0; r < rounds; r++) {
    const next = new Uint8Array(filled);
    let any = false;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (filled[i]) continue;
      let R = 0, G = 0, B = 0, n = 0;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const k = yy * w + xx;
        if (filled[k]) { R += d[k * 4]; G += d[k * 4 + 1]; B += d[k * 4 + 2]; n++; }
      }
      if (n) { d[i * 4] = R / n; d[i * 4 + 1] = G / n; d[i * 4 + 2] = B / n; next[i] = 1; any = true; }
    }
    filled = next;
    if (!any) break;
  }
  const ar = sn ? sr / sn : 128, ag = sn ? sg / sn : 128, ab = sn ? sb / sn : 128;
  for (let i = 0; i < w * h; i++) { if (!filled[i]) { d[i * 4] = ar; d[i * 4 + 1] = ag; d[i * 4 + 2] = ab; } d[i * 4 + 3] = 255; }
  ctx.putImageData(img, x0, y0);
}

const toCanvas = (img) => { const c = createCanvas(img.width, img.height); c.getContext('2d').putImageData(img, 0, 0); return c; };

// ---- 本体 ----

export function buildSolid(images, options = {}) {
  const o = { ...SOLID_DEFAULTS, ...options };
  o.res = Math.round(Math.min(SOLID_RES[1], Math.max(SOLID_RES[0], o.res)));
  const prep = (img) => {
    if (!img) return null;
    const rm = o.removeBg === 'on' || (o.removeBg === 'auto' && !hasTransparent(img));
    return rm ? removeBackground(img) : img;
  };
  const front = prep(images.front), side = prep(images.side), back = prep(images.back);
  const B = front && bboxOf(front);
  if (!B) throw new Error('絵がありません(正面の絵が空です)');
  const card = o.shape === 'card';
  const SB = !card && o.shape !== 'inflate' && side ? bboxOf(side) : null, BB = back && bboxOf(back);

  // マス目: 高さ方向に res マス。1マス = cs px
  const pad = 2;
  // cell(1マスの px)が決まっていればそれに合わせる(パーツごとに作るとき、全部のパーツで同じ荒さにする)
  const ny = o.cell ? Math.max(1, Math.round(B.h / o.cell)) : Math.max(2, Math.min(o.res, B.h)), cs = B.h / ny, nx = Math.max(1, Math.round(B.w / cs));
  const F = coverage(front, B, nx, ny, pad);
  const GW = F.GW, GH = F.GH;

  // 奥行き(マス単位)を決めて、3D のマス目に「中 = 正、外 = 負」の値を入れる
  let nzh, field, NZ;
  const mode = card ? 'card' : SB ? 'hull' : 'inflate';
  let zScale = 1; // マス目の z → px の倍率(カードは、面をマスの半分の所に作ってから厚みに合わせて伸ばす)
  if (card) {
    nzh = 1; NZ = 3;
    field = new Float32Array(GW * GH * NZ);
    for (let k = 0; k < NZ; k++) for (let i = 0; i < GW * GH; i++) field[i + GW * GH * k] = F.g[i] >= 0.5 ? (k === 1 ? Math.min(0.5, (F.g[i] - 0.5) * 2 + 0.5) : -0.5) : -(0.5 - F.g[i]) - (k === 1 ? 0 : 0.5) - 0.01;
    zScale = ((o.cardDepthPx ?? B.h * o.cardDepth * o.thick) * 0.5) / (0.5 * cs); // cardDepthPx: 厚みを px で直接(パーツごとに作るとき、全部同じ厚みに)
  } else if (!SB) {
    const Z = inflateDepth(F.g, GW, GH);
    let zmax = 0;
    for (let i = 0; i < Z.length; i++) { Z[i] *= o.thick; if (Z[i] > zmax) zmax = Z[i]; }
    nzh = Math.ceil(zmax) + 2; NZ = nzh * 2 + 1;
    field = new Float32Array(GW * GH * NZ);
    for (let k = 0; k < NZ; k++) {
      const az = Math.abs(k - nzh);
      for (let i = 0; i < GW * GH; i++) field[i + GW * GH * k] = F.g[i] >= 0.5 ? Math.min(Z[i] - az, (F.g[i] - 0.5) * 2 + 0.5) : -(0.5 - F.g[i]) - az * 0.5 - 0.01;
    }
  } else {
    // 真横の絵: 高さを正面にそろえる。奥行きのマス数は、真横の絵の幅から
    const nzs = Math.max(1, Math.round(((SB.w / SB.h) * B.h * o.thick) / cs));
    const S = coverage(side, SB, nzs, ny, pad); // S.g[(j + pad) * S.GW + k + pad]
    NZ = S.GW; nzh = (NZ - 1) / 2;
    field = new Float32Array(GW * GH * NZ).fill(-1);
    const zi = (k) => (o.sideLeft ? NZ - 1 - k : k); // 右向きの絵は、絵の右 = 手前(z が大きい)。マス目は k が大きいほど手前
    for (let j = 0; j < GH; j++) {
      const fr = runs(F.g, j * GW, GW), sr = runs(S.g, j * S.GW, S.GW);
      if (!fr.length || !sr.length) continue;
      const widest = Math.max(...fr.map(([a, b]) => b - a + 1));
      for (const [i0, i1] of fr) for (const [k0, k1] of sr) {
        const a = (i1 - i0 + 1) / 2, ci = (i0 + i1) / 2;
        let b = (k1 - k0 + 1) / 2;
        const ck = (k0 + k1) / 2;
        // 細い区間(腕など)は、幅のわりに奥行きを取りすぎない
        if (i1 - i0 + 1 < widest) b = Math.min(b, Math.max(1, a * 1.6));
        for (let k = Math.max(0, Math.floor(ck - b - 1)); k <= Math.min(NZ - 1, Math.ceil(ck + b + 1)); k++) for (let i = Math.max(0, i0 - 1); i <= Math.min(GW - 1, i1 + 1); i++) {
          const u = (i - ci) / a, w = (k - ck) / b;
          const v = o.round ? (1 - Math.sqrt(u * u + w * w)) * Math.min(a, b) : Math.min((1 - Math.abs(u)) * a, (1 - Math.abs(w)) * b);
          const kk = zi(k), idx = i + GW * (j + GH * kk);
          if (v > field[idx]) field[idx] = v;
        }
      }
    }
    // ふちのマスは「絵のある割合」で少し内側・外側へ(輪郭をなめらかに)
    for (let k = 0; k < NZ; k++) for (let i = 0; i < GW * GH; i++) { const idx = i + GW * GH * k; if (field[idx] > 0) field[idx] = Math.min(field[idx], (F.g[i] - 0.5) * 2 + 0.5); if (field[idx] === 0) field[idx] = -0.01; }
  }

  const net = surfaceNets(field, GW, GH, NZ);
  if (!net.quads.length) throw new Error('立体にできませんでした(絵が小さすぎるかもしれません)');

  // マス目の座標 → 絵の px(x 右・y 下・z 手前)→ 書き出しの座標(m。y 上、足もと 0)
  // frame = { cx, footY, scale }: 絵の px → m の基準を外から決める(パーツごとに作るとき、全部のパーツで同じ基準にする)。z0 = 前後の位置(m)
  const fr = o.frame || { cx: B.x + B.w / 2, footY: B.y + B.h, scale: o.height / B.h };
  const scale = fr.scale, z0 = o.z0 || 0;
  const nv = net.verts.length / 3;
  const px = new Float32Array(nv * 3); // 絵の px 単位(貼る位置の計算用)
  const P = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    const x = B.x + (net.verts[i * 3] - pad + 0.5) * cs, y = B.y + (net.verts[i * 3 + 1] - pad + 0.5) * cs, z = (net.verts[i * 3 + 2] - nzh) * cs * zScale;
    px[i * 3] = x; px[i * 3 + 1] = y; px[i * 3 + 2] = z;
    P[i * 3] = (x - fr.cx) * scale; P[i * 3 + 1] = (fr.footY - y) * scale; P[i * 3 + 2] = z * scale + z0;
  }
  // 四角 → 三角(短いほうの対角線で割る)
  const tris = [];
  const d2 = (a, b) => (P[a * 3] - P[b * 3]) ** 2 + (P[a * 3 + 1] - P[b * 3 + 1]) ** 2 + (P[a * 3 + 2] - P[b * 3 + 2]) ** 2;
  for (let q = 0; q < net.quads.length; q += 4) {
    const [a, b, c, d] = [net.quads[q], net.quads[q + 1], net.quads[q + 2], net.quads[q + 3]];
    if (d2(a, c) <= d2(b, d)) tris.push(a, b, c, a, c, d); else tris.push(a, b, d, b, c, d);
  }
  // 面の向き: 外向きになるように(体積が正)
  let vol = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    vol += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  if (vol < 0) for (let t = 0; t < tris.length; t += 3) { const s = tris[t + 1]; tris[t + 1] = tris[t + 2]; tris[t + 2] = s; }

  // ---- 貼る絵: [正面 | 後ろ | 真横] を横に並べる ----
  const MAXT = 1024;
  const tk = Math.min(1, MAXT / Math.max(B.w, B.h)); // 大きな絵は縮める
  const tw = Math.max(1, Math.round(B.w * tk)), th = Math.max(1, Math.round(B.h * tk));
  const sw = SB ? Math.max(1, Math.round((SB.w / SB.h) * th)) : 0;
  const gut = 2;
  const AW = tw * 2 + gut * 3 + (SB ? sw + gut : 0), AH = th + gut * 2;
  const atlas = createCanvas(AW, AH), ax = atlas.getContext('2d', { willReadFrequently: true });
  ax.imageSmoothingEnabled = !o.nearest;
  const fc = toCanvas(front);
  const tile = { front: gut, back: gut * 2 + tw, side: gut * 3 + tw * 2 };
  ax.drawImage(fc, B.x, B.y, B.w, B.h, tile.front, gut, tw, th);
  if (BB) {
    ax.drawImage(toCanvas(back), BB.x, BB.y, BB.w, BB.h, tile.back, gut, tw, th);
  } else {
    if (o.backBlur && !card) {
      // 先にふちの外へ色をにじませてから、小さくして戻す(= ぼかし)。顔などの細かい絵は消えて、色の並びだけ残る
      const t = createCanvas(tw, th), tx = t.getContext('2d', { willReadFrequently: true });
      tx.drawImage(fc, B.x, B.y, B.w, B.h, 0, 0, tw, th);
      bleed(tx, 0, 0, tw, th, Math.max(tw, th));
      const k = Math.max(2, Math.round(th / 9)), sm = createCanvas(Math.max(1, Math.round(tw / k)), Math.max(1, Math.round(th / k)));
      const sx = sm.getContext('2d'); sx.imageSmoothingEnabled = true; sx.imageSmoothingQuality = 'high';
      sx.drawImage(t, 0, 0, sm.width, sm.height);
      ax.save(); ax.imageSmoothingEnabled = true; ax.imageSmoothingQuality = 'high'; ax.drawImage(sm, tile.back, gut, tw, th); ax.restore();
    } else ax.drawImage(fc, B.x, B.y, B.w, B.h, tile.back, gut, tw, th);
    ax.save(); ax.globalCompositeOperation = 'source-atop'; ax.fillStyle = `rgba(0,0,0,${card ? 0 : o.backDark})`; ax.fillRect(tile.back, gut, tw, th); ax.restore();
  }
  if (SB) ax.drawImage(toCanvas(side), SB.x, SB.y, SB.w, SB.h, tile.side, gut, sw, th);
  const rounds = Math.max(6, Math.ceil(cs * tk * 2.5));
  bleed(ax, 0, 0, tile.back - 1, AH, rounds);
  bleed(ax, tile.back - 1, 0, (SB ? tile.side - 1 : AW) - (tile.back - 1), AH, rounds);
  if (SB) bleed(ax, tile.side - 1, 0, AW - tile.side + 1, AH, rounds);

  // なめらかな法線(元の頂点ごと。絵の切り替わりで割れないように)
  const N = new Float32Array(nv * 3);
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    for (const q of [a, b, c]) { N[q] += n[0]; N[q + 1] += n[1]; N[q + 2] += n[2]; }
  }
  for (let i = 0; i < nv; i++) { const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) || 1; N[i * 3] /= l; N[i * 3 + 1] /= l; N[i * 3 + 2] /= l; }

  // ---- 面ごとに貼る絵を選ぶ: 手前向き = 正面、奥向き = 後ろ、横向き = 真横(あれば)----
  const depthPx = SB ? (SB.w / SB.h) * B.h * o.thick : 1;
  // ふちの面(横を向いた面)は、輪郭線の色が伸びて縞にならないよう、少し内側の色を拾う
  const inset = Math.max(1.5, B.h * o.inset);
  const uvOf = (vi, chart) => {
    let x = px[vi * 3], y = px[vi * 3 + 1];
    const z = px[vi * 3 + 2];
    if (chart !== 2) {
      const nx3 = N[vi * 3], ny3 = N[vi * 3 + 1], k = inset * (1 - Math.abs(N[vi * 3 + 2])) ** 1.5;
      x -= nx3 * k; y += ny3 * k; // 絵の y は下向き
    }
    const v = (gut + ((y - B.y) / B.h) * th) / AH;
    const fu = (x - B.x) / B.w;
    if (chart === 0) return [(tile.front + fu * tw) / AW, v];
    if (chart === 1) return [(tile.back + (BB ? 1 - fu : fu) * tw) / AW, v]; // 後ろの絵は左右が逆
    let su = z / depthPx + 0.5; // 右向きの絵: 右 = 手前
    if (o.sideLeft) su = 1 - su;
    return [(tile.side + Math.min(1, Math.max(0, su)) * sw) / AW, v];
  };
  const outPos = [], outUv = [], outIdx = [], owner = [], key = new Map();
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nxn = uy * vz - uz * vy, nzn = ux * vy - uy * vx;
    const chart = SB && Math.abs(nxn) > Math.abs(nzn) * 1.15 ? 2 : nzn >= 0 ? 0 : 1;
    for (let e = 0; e < 3; e++) {
      const vi = tris[t + e], kk = vi * 3 + chart;
      let id = key.get(kk);
      if (id === undefined) {
        id = outPos.length / 3; key.set(kk, id);
        outPos.push(P[vi * 3], P[vi * 3 + 1], P[vi * 3 + 2]);
        outUv.push(...uvOf(vi, chart)); owner.push(vi);
      }
      outIdx.push(id);
    }
  }
  const normals = new Float32Array(owner.length * 3);
  owner.forEach((vi, i) => { normals[i * 3] = N[vi * 3]; normals[i * 3 + 1] = N[vi * 3 + 1]; normals[i * 3 + 2] = N[vi * 3 + 2]; });
  const positions = new Float32Array(outPos);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let c = 0; c < 3; c++) { if (positions[i + c] < min[c]) min[c] = positions[i + c]; if (positions[i + c] > max[c]) max[c] = positions[i + c]; }
  // 頂点ごとの、もとの絵の中での位置(px)。ボーンの重みを決めるのに使う
  const restXY = new Float32Array(owner.length * 2);
  owner.forEach((vi, i) => { restXY[i * 2] = px[vi * 3]; restXY[i * 2 + 1] = px[vi * 3 + 1]; });
  return {
    positions, uvs: new Float32Array(outUv), normals, indices: new Uint32Array(outIdx), atlas, options: o, restXY,
    stats: { mode, vertices: nv, triangles: tris.length / 3, grid: [GW - pad * 2, GH - pad * 2, NZ], min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]], volume: Math.abs(vol) / 6, texture: [AW, AH] },
  };
}

// ---- .glb(glTF 2.0 バイナリ。絵は中に入れる)----

export async function solidToGlb(solid, { name = 'Kodai' } = {}) {
  const o = solid.options;
  const png = new Uint8Array(await (await new Promise((r) => solid.atlas.toBlob(r, 'image/png'))).arrayBuffer());
  const nVert = solid.positions.length / 3;
  const idx = nVert > 65535 ? solid.indices : new Uint16Array(solid.indices);
  const chunks = [], views = [];
  let off = 0;
  const add = (u8, target) => {
    const padLen = (4 - (u8.byteLength % 4)) % 4;
    views.push({ buffer: 0, byteOffset: off, byteLength: u8.byteLength, ...(target ? { target } : {}) });
    chunks.push(new Uint8Array(u8.buffer, u8.byteOffset, u8.byteLength));
    if (padLen) chunks.push(new Uint8Array(padLen));
    off += u8.byteLength + padLen;
    return views.length - 1;
  };
  const vPos = add(solid.positions, 34962), vUv = add(solid.uvs, 34962);
  const vNor = o.flat ? -1 : add(solid.normals, 34962);
  const vIdx = add(idx, 34963), vImg = add(png);
  const accessors = [
    { bufferView: vPos, componentType: 5126, count: nVert, type: 'VEC3', min: solid.stats.min, max: solid.stats.max },
    { bufferView: vUv, componentType: 5126, count: nVert, type: 'VEC2' },
    { bufferView: vIdx, componentType: idx instanceof Uint16Array ? 5123 : 5125, count: idx.length, type: 'SCALAR' },
  ];
  const attributes = { POSITION: 0, TEXCOORD_0: 1 };
  if (!o.flat) { accessors.push({ bufferView: vNor, componentType: 5126, count: nVert, type: 'VEC3' }); attributes.NORMAL = 3; }
  const json = {
    asset: { version: '2.0', generator: 'Kodai' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives: [{ attributes, indices: 2, material: 0 }] }],
    materials: [{ name: name + '_mat', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 } }],
    textures: [{ sampler: 0, source: 0 }],
    samplers: [{ magFilter: o.nearest ? 9728 : 9729, minFilter: o.nearest ? 9728 : 9987, wrapS: 33071, wrapT: 33071 }],
    images: [{ bufferView: vImg, mimeType: 'image/png', name: name + '_tex' }],
    accessors, bufferViews: views, buffers: [{ byteLength: off }],
  };
  let js = new TextEncoder().encode(JSON.stringify(json));
  const jpad = (4 - (js.length % 4)) % 4;
  if (jpad) { const t = new Uint8Array(js.length + jpad).fill(0x20); t.set(js); js = t; }
  const total = 12 + 8 + js.length + 8 + off;
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, js.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(js, 20);
  let p = 20 + js.length;
  dv.setUint32(p, off, true); dv.setUint32(p + 4, 0x004e4942, true); p += 8;
  for (const c of chunks) { out.set(c, p); p += c.byteLength; }
  return out;
}
