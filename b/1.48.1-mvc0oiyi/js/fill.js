// 塗りつぶしの範囲を求める(Kaiju のバケツと同じ仕組み)。ref = 境目にする絵(RGBA)、(sx, sy) = クリックした点、tol = 色の許容、gap = 隙間閉じ(px)
//   gap = 0: クリックした所とつながっている、似た色の所ぜんぶ
//   gap > 0: 線の切れ目(すき間)が gap px より狭ければ、そこから外へもれない(線がつながっていなくても塗れる)
//   contiguous = false: つながっていなくても、似た色の所ぜんぶ(隙間閉じは使わない)
// 戻り値 { mask(塗る所が 1), x0, y0, x1, y1 }(範囲。塗る所がなければ null)

export function fillRegion(ref, w, h, sx, sy, tol, gap = 0, contiguous = true) {
  const i0 = (sy * w + sx) * 4;
  const r0 = ref[i0], g0 = ref[i0 + 1], b0 = ref[i0 + 2], a0 = ref[i0 + 3];
  // 透明な所から始めたときは、透明さだけで比べる(透明な画素の色は当てにならない)
  const same = a0 === 0
    ? (i) => ref[i + 3] <= tol
    : (i) => Math.abs(ref[i] - r0) <= tol && Math.abs(ref[i + 1] - g0) <= tol && Math.abs(ref[i + 2] - b0) <= tol && Math.abs(ref[i + 3] - a0) <= tol;
  const mask = new Uint8Array(w * h);
  if (!contiguous) { for (let i = 0; i < w * h; i++) mask[i] = same(i * 4) ? 1 : 0; }
  else if (gap > 0) closedFill(mask, same, w, h, sx, sy, gap);
  else plainFill(mask, same, w, h, sx, sy);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      if (!mask[i]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? null : { mask, x0, y0, x1, y1 };
}

// 塗る範囲を n px 広げる(線の下にもぐらせて、線とのあいだに白いすき間を残さない)。
// → { x, y, w, h(広げたあとの範囲), on(その範囲の中で、塗る所が 1) }
export function expandRegion(region, w, h, n) {
  const x = Math.max(0, region.x0 - n), y = Math.max(0, region.y0 - n);
  const rw = Math.min(w - 1, region.x1 + n) - x + 1, rh = Math.min(h - 1, region.y1 + n) - y + 1;
  const on = new Uint8Array(rw * rh);
  const { mask } = region;
  if (n <= 0) {
    for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) on[j * rw + i] = mask[(y + j) * w + x + i];
    return { x, y, w: rw, h: rh, on };
  }
  const d = new Float32Array(rw * rh);
  for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) d[j * rw + i] = mask[(y + j) * w + x + i] ? 0 : INF;
  distance2(d, rw, rh);
  const lim = n * n + n; // (n + 0.5)² ほど
  for (let i = 0; i < d.length; i++) on[i] = d[i] <= lim ? 1 : 0;
  return { x, y, w: rw, h: rh, on };
}

function plainFill(mask, same, w, h, sx, sy) {
  const stack = [sx, sy];
  while (stack.length) {
    const y = stack.pop();
    let x = stack.pop();
    if (mask[y * w + x] || !same((y * w + x) * 4)) continue;
    while (x > 0 && !mask[y * w + x - 1] && same((y * w + x - 1) * 4)) x--;
    let up = false, down = false;
    for (; x < w && !mask[y * w + x] && same((y * w + x) * 4); x++) {
      mask[y * w + x] = 1;
      if (y > 0) {
        const ok = !mask[(y - 1) * w + x] && same(((y - 1) * w + x) * 4);
        if (ok && !up) stack.push(x, y - 1);
        up = ok;
      }
      if (y < h - 1) {
        const ok = !mask[(y + 1) * w + x] && same(((y + 1) * w + x) * 4);
        if (ok && !down) stack.push(x, y + 1);
        down = ok;
      }
    }
  }
}

// 隙間閉じ:
//  1. 塗れる所(似た色)の各点から、いちばん近い線までの距離を求める
//  2. 線から gap/2 より離れた所(= すき間より広い所)だけを、クリックした所からたどる。狭いすき間は通れないので外へもれない
//  3. たどった所から gap/2 だけ広げて、線のきわまで塗る(線の向こう側は、線の太さの分だけ遠いので入らない)。
//     すき間の所は、内側から少しふくらんだ形で止まる
function closedFill(mask, same, w, h, sx, sy, gap) {
  const n = w * h;
  const pass = new Uint8Array(n);
  for (let i = 0; i < n; i++) pass[i] = same(i * 4) ? 1 : 0;
  if (!pass[sy * w + sx]) return;

  const d = new Float32Array(n); // 線までの距離の2乗
  for (let i = 0; i < n; i++) d[i] = pass[i] ? INF : 0;
  distance2(d, w, h);

  // クリックした所が線のそばなら、線から離れる向きに登って、広い所に出る
  let R = gap / 2;
  let p = sy * w + sx;
  for (let step = 0; step < 6000 && d[p] <= R * R; step++) {
    const x = p % w, y = (p - x) / w;
    let best = p;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (d[q] > d[best]) best = q;
      }
    }
    if (best === p) break;
    p = best;
  }
  // 広い所がない(すき間の設定より細い所をクリックした): その所の太さの半分に合わせる
  // (太さぎりぎりにすると、たどれる所が真ん中の細い線だけになって、途中で切れやすい)
  if (d[p] <= R * R) R = Math.sqrt(d[p]) / 2;
  const R2 = R * R;

  // 2. 広い所をたどる
  const queue = new Int32Array(n);
  let tail = 0;
  const core = new Float32Array(n); // たどった所までの距離の2乗
  core.fill(INF);
  const take = (q) => { mask[q] = 1; core[q] = 0; queue[tail++] = q; };
  take(p);
  for (let head = 0; head < tail; head++) {
    const c = queue[head], x = c % w;
    if (x > 0 && !mask[c - 1] && d[c - 1] > R2) take(c - 1);
    if (x < w - 1 && !mask[c + 1] && d[c + 1] > R2) take(c + 1);
    if (c >= w && !mask[c - w] && d[c - w] > R2) take(c - w);
    if (c < n - w && !mask[c + w] && d[c + w] > R2) take(c + w);
  }

  // 3. 線のきわまで広げる(つながっている所だけ)
  distance2(core, w, h);
  const lim = (R + 0.5) * (R + 0.5);
  const ok = (q) => !mask[q] && pass[q] && core[q] <= lim;
  const add = (q) => { mask[q] = 1; queue[tail++] = q; };
  for (let head = 0; head < tail; head++) {
    const c = queue[head], x = c % w;
    if (x > 0 && ok(c - 1)) add(c - 1);
    if (x < w - 1 && ok(c + 1)) add(c + 1);
    if (c >= w && ok(c - w)) add(c - w);
    if (c < n - w && ok(c + w)) add(c + w);
  }
}

// いちばん近い「0 の所」までの距離の2乗(正確な値。縦・横に1回ずつなめる Felzenszwalb の方法)
export const INF = 1e20;
export function distance2(g, w, h) {
  const m = Math.max(w, h);
  const f = new Float64Array(m), v = new Int32Array(m), z = new Float64Array(m + 1);
  const line = (len) => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s;
      for (;;) {
        const r = v[k];
        s = ((f[q] + q * q) - (f[r] + r * r)) / (2 * q - 2 * r);
        if (s > z[k]) break;
        k--;
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x];
    line(h);
    for (let y = 0, k = 0; y < h; y++) {
      while (z[k + 1] < y) k++;
      g[y * w + x] = (y - v[k]) * (y - v[k]) + f[v[k]];
    }
  }
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) f[x] = g[o + x];
    line(w);
    for (let x = 0, k = 0; x < w; x++) {
      while (z[k + 1] < x) k++;
      g[o + x] = (x - v[k]) * (x - v[k]) + f[v[k]];
    }
  }
}
