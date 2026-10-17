// 点の並び(閉じた輪)→ 少ない節点の3次ベジェ
//   なぞって得た輪郭(1画素ごとの細かい点)を、人が描いたような少ない点のパスにする。「o」なら外側 4点 + 内側 4点。
//   1) 角を見つける(前後の向きが大きく変わる所)。角の位置は、前後のまっすぐな線の交点に寄せる(なぞると角が少し丸くなるため)
//   2) 角と角の間のなめらかな部分は、上下左右の端(接線が水平・垂直になる所)でも分ける(円なら 4つに分かれる)
//   3) 分けた区間ごとに、3次ベジェ1本を当てはめる(Schneider の方法)。ずれが tol を超える区間は、いちばんずれた所でさらに分ける
//   4) ほぼまっすぐな区間は直線にする(ハンドルなし)
//   戻り値は節点の配列 [{ x, y, hin?, hout? }](vector.js のパスの nodes と同じ形。ハンドルは絶対座標)

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const len = (a) => Math.hypot(a.x, a.y);
const unit = (a) => { const l = len(a); return l < 1e-12 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l }; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ---- 3次ベジェの当てはめ(Schneider, Graphics Gems)----

const B0 = (u) => (1 - u) ** 3, B1 = (u) => 3 * u * (1 - u) ** 2, B2 = (u) => 3 * u * u * (1 - u), B3 = (u) => u ** 3;
const bez = (c, u) => ({
  x: c[0].x * B0(u) + c[1].x * B1(u) + c[2].x * B2(u) + c[3].x * B3(u),
  y: c[0].y * B0(u) + c[1].y * B1(u) + c[2].y * B2(u) + c[3].y * B3(u),
});

function chordParams(d) {
  const u = [0];
  for (let i = 1; i < d.length; i++) u.push(u[i - 1] + dist(d[i], d[i - 1]));
  const total = u[u.length - 1] || 1;
  return u.map((v) => v / total);
}

// t1 = 始点から先へ向かう向き、t2 = 終点から手前へ向かう向き
function generate(d, u, t1, t2) {
  const p0 = d[0], p3 = d[d.length - 1];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < d.length; i++) {
    const a0 = mul(t1, B1(u[i])), a1 = mul(t2, B2(u[i]));
    c00 += dot(a0, a0); c01 += dot(a0, a1); c11 += dot(a1, a1);
    const tmp = sub(d[i], add(mul(p0, B0(u[i]) + B1(u[i])), mul(p3, B2(u[i]) + B3(u[i]))));
    x0 += dot(a0, tmp); x1 += dot(a1, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  const seg = dist(p0, p3);
  let al = Math.abs(det) < 1e-12 ? 0 : (x0 * c11 - x1 * c01) / det;
  let ar = Math.abs(det) < 1e-12 ? 0 : (c00 * x1 - c01 * x0) / det;
  // うまく決まらないときは、弦の 1/3(Wu / Barsky)
  if (!(al > seg * 1e-3) || !(ar > seg * 1e-3) || al > seg * 3 || ar > seg * 3) al = ar = seg / 3;
  return [p0, add(p0, mul(t1, al)), add(p3, mul(t2, ar)), p3];
}

function maxError(d, c, u) {
  let m = 0, at = d.length >> 1;
  for (let i = 1; i < d.length - 1; i++) {
    const e = dist(bez(c, u[i]), d[i]);
    if (e > m) { m = e; at = i; }
  }
  return { m, at };
}

// 点にいちばん近い曲線上の位置へ、パラメータを少し動かす(ニュートン法を1回)
function reparam(d, c, u) {
  const q1 = [mul(sub(c[1], c[0]), 3), mul(sub(c[2], c[1]), 3), mul(sub(c[3], c[2]), 3)];
  const q2 = [mul(sub(q1[1], q1[0]), 2), mul(sub(q1[2], q1[1]), 2)];
  return u.map((t, i) => {
    const p = bez(c, t), s = 1 - t;
    const d1 = { x: q1[0].x * s * s + q1[1].x * 2 * s * t + q1[2].x * t * t, y: q1[0].y * s * s + q1[1].y * 2 * s * t + q1[2].y * t * t };
    const d2 = { x: q2[0].x * s + q2[1].x * t, y: q2[0].y * s + q2[1].y * t };
    const diff = sub(p, d[i]);
    const den = dot(d1, d1) + dot(diff, d2);
    if (Math.abs(den) < 1e-12) return t;
    return Math.min(1, Math.max(0, t - dot(diff, d1) / den));
  });
}

// 点の並び d に、ずれが tol 以下になるまでベジェを当てはめる → [[p0, c1, c2, p3], …]
function fitCubic(d, t1, t2, tol, depth = 0) {
  if (d.length === 2) {
    const seg = dist(d[0], d[1]) / 3;
    return [[d[0], add(d[0], mul(t1, seg)), add(d[1], mul(t2, seg)), d[1]]];
  }
  let u = chordParams(d), c = generate(d, u, t1, t2), e = maxError(d, c, u);
  if (e.m <= tol) return [c];
  // もう少しでおさまりそうなら、パラメータを直してやり直す
  if (e.m <= tol * 4) {
    for (let k = 0; k < 24; k++) {
      u = reparam(d, c, u);
      c = generate(d, u, t1, t2);
      e = maxError(d, c, u);
      if (e.m <= tol) return [c];
    }
  }
  if (depth > 12) return [c];
  // いちばんずれた所で2つに分ける(分け目の接線は、前後の点から)
  const at = Math.min(d.length - 2, Math.max(1, e.at));
  const k = Math.max(1, Math.min(3, at, d.length - 1 - at));
  const tc = unit(sub(d[at - k], d[at + k])); // 手前へ向かう向き
  const tcFix = len(tc) ? tc : unit(sub(d[at - 1], d[at + 1]));
  return fitCubic(d.slice(0, at + 1), t1, tcFix, tol, depth + 1).concat(fitCubic(d.slice(at), mul(tcFix, -1), t2, tol, depth + 1));
}

// ---- 輪を区間に分ける ----

// 閉じた輪 pts → 節点。tol = 許すずれ(座標の単位)。corner = 角とみなす向きの変化(度)
export function fitLoop(pts, tol = 0.5, { corner = 42 } = {}) {
  // 同じ点・近すぎる点を除く
  const p = [];
  for (const q of pts) if (!p.length || dist(q, p[p.length - 1]) > 1e-6) p.push({ x: q.x, y: q.y });
  if (p.length > 1 && dist(p[0], p[p.length - 1]) < 1e-6) p.pop();
  const n = p.length;
  if (n < 8) return p;
  let total = 0;
  const segLen = new Array(n);
  for (let i = 0; i < n; i++) { segLen[i] = dist(p[i], p[(i + 1) % n]); total += segLen[i]; }
  const step = total / n;
  // 見る幅(点の数): 細かいぎざぎざに惑わされないよう、数点先を見る
  const w = Math.max(2, Math.min(Math.floor(n / 8), Math.round(Math.max(5 * step, 2.5 * tol) / step)));
  const at = (i) => p[((i % n) + n) % n];
  // 角: 手前の向きと先の向きの変化が大きく、近くでいちばん大きい所
  const cosLim = Math.cos((corner * Math.PI) / 180);
  const turn = new Float64Array(n);
  for (let i = 0; i < n; i++) turn[i] = dot(unit(sub(at(i), at(i - w))), unit(sub(at(i + w), at(i))));
  const corners = [];
  for (let i = 0; i < n; i++) {
    if (turn[i] > cosLim) continue;
    let best = true;
    for (let k = 1; k <= w && best; k++) if (turn[((i - k) % n + n) % n] < turn[i] || turn[(i + k) % n] <= turn[i]) best = false;
    if (best) corners.push(i);
  }
  // 近すぎる角(見る幅より近い)は、曲がりの大きい方だけ残す
  for (let k = corners.length - 1; k >= 0 && corners.length > 1; k--) {
    const i = corners[k], j = corners[(k + 1) % corners.length];
    const d = Math.min(Math.abs(i - j), n - Math.abs(i - j));
    if (i !== j && d <= w) corners.splice(turn[i] <= turn[j] ? (k + 1) % corners.length : k, 1);
  }
  // 角の位置を、前後のまっすぐな線の交点へ寄せる(近いときだけ)
  const moved = new Map();
  for (const i of corners) {
    const a = at(i - w), b = at(i + w);
    const da = unit(sub(a, at(i - 2 * w))), db = unit(sub(at(i + 2 * w), b));
    const den = da.x * db.y - da.y * db.x;
    if (Math.abs(den) < 0.2) continue;
    const t = ((b.x - a.x) * db.y - (b.y - a.y) * db.x) / den;
    const x = add(a, mul(da, t));
    if (dist(x, p[i]) <= Math.max(2 * step, 1.5 * tol)) moved.set(i, x);
  }
  // なめらかな所の向き(少し広く見る)
  const tan = (i) => unit(sub(at(i + w), at(i - w)));
  // 上下左右の端: 向きの x(y)成分の符号が、はっきり変わる所。角の近くは除く
  const isNear = (i, list, gap) => list.some((c) => { const d = Math.abs(i - c); return Math.min(d, n - d) <= gap; });
  const extrema = []; // { i, axis: 'x' | 'y' }(axis = 接線の向き。'y' = 接線が垂直 = 左右の端)
  const SIG = 0.22;
  for (const key of ['x', 'y']) {
    let last = null; // 最後に符号がはっきりしていた点 { i, s }
    // 1周 + 少し(輪のつなぎ目をまたぐ分)
    for (let j = 0; j < n + n / 2; j++) {
      const i = j % n, v = tan(i)[key];
      if (Math.abs(v) < SIG) continue;
      const s = Math.sign(v);
      if (last && last.s !== s && j - last.j < n / 2) {
        // はっきりしていた2点の間で、成分がいちばん 0 に近い点
        let bi = last.j, bv = Infinity;
        for (let m = last.j; m <= j; m++) { const a = Math.abs(tan(m % n)[key]); if (a < bv) { bv = a; bi = m; } }
        const idx = bi % n;
        // 輪のつなぎ目をまたぐ分で、同じ所を2回見るので、近くにもうあれば足さない
        if (!isNear(idx, corners, 2 * w) && !isNear(idx, extrema.map((e) => e.i), w)) extrema.push({ i: idx, axis: key === 'x' ? 'y' : 'x' });
      }
      last = { j, s };
    }
  }
  // 分け目を輪の順に並べる
  const cuts = [...corners.map((i) => ({ i, corner: true })), ...extrema.map((e) => ({ i: e.i, corner: false, axis: e.axis }))].sort((a, b) => a.i - b.i);
  if (!cuts.length) cuts.push({ i: 0, corner: false }, { i: n >> 1, corner: false });
  if (cuts.length === 1) cuts.push({ i: (cuts[0].i + (n >> 1)) % n, corner: false });
  const posOf = (c) => (c.corner && moved.has(c.i) ? moved.get(c.i) : p[c.i]);
  // 分け目での向き(先へ向かう向き)。角は区間ごとに自分の点から、端は軸にそろえる、ほかは前後の点から
  const dirOut = (c, d) => {
    if (c.corner) return unit(sub(d[Math.min(d.length - 1, w)], d[0]));
    const t = tan(c.i);
    if (c.axis === 'x') return { x: Math.sign(t.x) || 1, y: 0 };
    if (c.axis === 'y') return { x: 0, y: Math.sign(t.y) || 1 };
    return t;
  };
  const dirIn = (c, d) => { // 手前へ向かう向き
    if (c.corner) return unit(sub(d[Math.max(0, d.length - 1 - w)], d[d.length - 1]));
    return mul(dirOut(c, null), -1);
  };
  const nodes = [];
  for (let k = 0; k < cuts.length; k++) {
    const a = cuts[k], b = cuts[(k + 1) % cuts.length];
    const d = [];
    for (let i = a.i; ; i = (i + 1) % n) { d.push(p[i]); if (i === b.i && d.length > 1) break; if (d.length > n + 1) break; }
    d[0] = posOf(a); d[d.length - 1] = posOf(b);
    // まっすぐなら直線
    const chord = sub(d[d.length - 1], d[0]), cl = len(chord) || 1;
    let dev = 0;
    for (let i = 1; i < d.length - 1; i++) dev = Math.max(dev, Math.abs((d[i].x - d[0].x) * chord.y - (d[i].y - d[0].y) * chord.x) / cl);
    const curves = dev <= tol * 0.9 ? null : fitCubic(d, dirOut(a, d), dirIn(b, d), tol);
    if (!curves) { nodes.push({ p: d[0], out: null, inNext: null }); continue; }
    curves.forEach((c, j) => {
      nodes.push({ p: c[0], out: c[1], inNext: c[2], mid: j > 0 });
    });
  }
  // 節点にまとめる(次の区間の入りのハンドルを、次の節点へ)
  const out = nodes.map((q) => ({ x: q.p.x, y: q.p.y }));
  nodes.forEach((q, i) => {
    if (q.out) out[i].hout = { x: q.out.x, y: q.out.y };
    if (q.inNext) out[(i + 1) % out.length].hin = { x: q.inNext.x, y: q.inNext.y };
  });
  // まっすぐな辺の途中に残った点(前後とも直線で、3点が一直線)を除く
  for (let i = out.length - 1; i >= 0 && out.length > 3; i--) {
    const q = out[i], a = out[(i - 1 + out.length) % out.length], b = out[(i + 1) % out.length];
    if (q.hin || q.hout || a.hout || b.hin) continue;
    const ch = sub(b, a), cl = len(ch);
    if (cl < 1e-9) continue;
    const dev = Math.abs((q.x - a.x) * ch.y - (q.y - a.y) * ch.x) / cl;
    const along = dot(sub(q, a), ch) / (cl * cl);
    if (dev <= tol * 0.9 && along > 0 && along < 1) out.splice(i, 1);
  }
  return out;
}

// ---- 開いた線 ----

// 開いた点の並び pts → 節点(端はそのまま。角で分けて、間に曲線を当てはめる)。tol = 許すずれ、corner = 角とみなす向きの変化(度)
export function fitOpen(pts, tol = 0.5, { corner = 50 } = {}) {
  const p = [];
  for (const q of pts) if (!p.length || dist(q, p[p.length - 1]) > 1e-6) p.push({ x: q.x, y: q.y });
  const n = p.length;
  if (n < 3) return p;
  let total = 0;
  for (let i = 1; i < n; i++) total += dist(p[i], p[i - 1]);
  const step = total / (n - 1);
  const w = Math.max(1, Math.min(Math.floor(n / 4) || 1, Math.round(Math.max(5 * step, 2.5 * tol) / step)));
  // 角: 手前の向きと先の向きの変化が大きく、近くでいちばん大きい所
  const cosLim = Math.cos((corner * Math.PI) / 180);
  const turn = new Float64Array(n).fill(1);
  for (let i = w; i < n - w; i++) turn[i] = dot(unit(sub(p[i], p[i - w])), unit(sub(p[i + w], p[i])));
  const cuts = [0];
  for (let i = w; i < n - w; i++) {
    if (turn[i] > cosLim) continue;
    let best = true;
    for (let k = 1; k <= w && best; k++) if (turn[i - k] < turn[i] || turn[i + k] <= turn[i]) best = false;
    if (best && i - cuts[cuts.length - 1] > w) cuts.push(i);
  }
  cuts.push(n - 1);
  const nodes = [{ x: p[0].x, y: p[0].y }];
  for (let k = 0; k + 1 < cuts.length; k++) {
    const d = p.slice(cuts[k], cuts[k + 1] + 1);
    const a = d[0], b = d[d.length - 1];
    const chord = sub(b, a), cl = len(chord) || 1;
    let dev = 0;
    for (let i = 1; i < d.length - 1; i++) dev = Math.max(dev, Math.abs((d[i].x - a.x) * chord.y - (d[i].y - a.y) * chord.x) / cl);
    if (d.length < 3 || dev <= tol * 0.9) { nodes.push({ x: b.x, y: b.y }); continue; }
    const t1 = unit(sub(d[Math.min(d.length - 1, w)], a)), t2 = unit(sub(d[Math.max(0, d.length - 1 - w)], b));
    for (const c of fitCubic(d, t1, t2, tol)) {
      nodes[nodes.length - 1].hout = { x: c[1].x, y: c[1].y };
      nodes.push({ x: c[3].x, y: c[3].y, hin: { x: c[2].x, y: c[2].y } });
    }
  }
  return nodes;
}
