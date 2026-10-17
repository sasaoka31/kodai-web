// 画像の字を読み取って、フォントの字形にする(フォント作成モード)
//   ロゴや手書きの字の画像 → 字の色の所を取り出す → つながったかたまり(ピース)に分ける → 字ごとにまとめる →
//   輪郭をなぞって(outline.js のトレース)字形の図形にする。ドットのフォントはマス目に合わせてドットにする。
//   ・大きいピース(メイン)= 字の本体。小さいピース(かけら・点・しずく)は、いちばん近いメインに付ける(遠いものは捨てる)
//   ・字ごとのまとめ: メインを段(行)ごとに左から並べ、「前の字とつなぐ」印で字にする(K の縦棒と斜めの線のように、1字が2つに分かれているとき)。
//     入力した字の数より多く見つかったら、すき間のいちばん狭い所から順につなぐ。ダイアログではクリックで直せる
//   ・高さ: 段ごとに、字の多い帯(上の線〜ベースライン)を見つけ、その高さを「大文字の高さ」に合わせる
//   ・字の幅: 次の字の左端までの距離(画像の字間をそのまま写す)。段の最後の字は、本体の幅 + その段のすき間の中央の値
//   ・残りの字も作る: 画像の字の「縦の画」を1本取り出して横向きにし、文字の自動作成(kanji.js)の筆の部品(英数字・かな)にする。
//     画像にない字は、骨組みにその筆を沿わせて作る(線の太さ・かすれ・端の形は似るが、字ごとの飾りは出ない)
import { traceDrawing } from './outline.js';
import { fitLoop } from './fitcurve.js';

const MAX_SIDE = 2600; // これより大きい画像は縮めてから調べる
const MAIN_RATIO = 0.05; // いちばん大きいピースの面積のこの割合以上なら、字の本体(メイン)
const SAMPLES = 500; // ピースのふちの点(距離を測る用)をこの数まで間引く

// ImageBitmap・canvas・img → ImageData(大きすぎれば縮める)
export function imageDataOf(src) {
  const sw = src.width, sh = src.height;
  const k = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * k));
  c.height = Math.max(1, Math.round(sh * k));
  const x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, c.width, c.height);
  return x.getImageData(0, 0, c.width, c.height);
}

// 大津の方法(明るさの山を2つに分けるしきい値)
function otsu(str) {
  const hist = new Float64Array(256);
  for (let i = 0; i < str.length; i++) hist[str[i]]++;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let wB = 0, sumB = 0, best = 0, th = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = str.length - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const d = sumB / wB - (sum - sumB) / wF, v = wB * wF * d * d;
    if (v > best) { best = v; th = t; }
  }
  return Math.min(208, Math.max(48, th + 1));
}

// 画像 → 字の色の所とピース
//   polarity: 'auto' | 'light'(暗い背景に明るい字)| 'dark'(明るい背景に暗い字)。透明のある画像は、不透明な所が字
//   threshold: 字とみなす濃さ(16〜240)。null = 自動
export function analyzeImage(img, { threshold = null, polarity = 'auto' } = {}) {
  const w = img.width, h = img.height, data = img.data, n = w * h;
  let clear = 0;
  for (let i = 0; i < n; i++) if (data[i * 4 + 3] < 128) clear++;
  const str = new Uint8Array(n);
  let pol = polarity;
  if (clear > n * 0.02) {
    pol = 'alpha';
    for (let i = 0; i < n; i++) str[i] = data[i * 4 + 3];
  } else {
    const lum = (i) => 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    if (pol !== 'light' && pol !== 'dark') {
      // 画像のふちの明るさ = 背景
      let s = 0, c = 0;
      for (let x = 0; x < w; x++) { s += lum(x) + lum((h - 1) * w + x); c += 2; }
      for (let y = 0; y < h; y++) { s += lum(y * w) + lum(y * w + w - 1); c += 2; }
      pol = s / c < 128 ? 'light' : 'dark';
    }
    for (let i = 0; i < n; i++) { const v = lum(i); str[i] = pol === 'light' ? v : 255 - v; }
  }
  const th = Math.round(threshold ?? (pol === 'alpha' ? 128 : otsu(str)));
  // つながったかたまり(斜めもつながりとみなす)
  const labels = new Int32Array(n);
  const pieces = [null]; // 番号は 1 から
  const stack = new Int32Array(n);
  for (let s0 = 0; s0 < n; s0++) {
    if (str[s0] < th || labels[s0]) continue;
    const id = pieces.length;
    let sp = 0, area = 0, x0 = w, y0 = h, x1 = 0, y1 = 0, sx = 0, sy = 0;
    const edge = [];
    stack[sp++] = s0;
    labels[s0] = id;
    while (sp) {
      const p = stack[--sp], px = p % w, py = (p - px) / w;
      area++; sx += px; sy += py;
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
      let border = px === 0 || py === 0 || px === w - 1 || py === h - 1;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = py + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = px + dx;
          if ((!dx && !dy) || xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (str[q] < th) { if (!dx || !dy) border = true; continue; }
          if (!labels[q]) { labels[q] = id; stack[sp++] = q; }
        }
      }
      if (border) edge.push(px, py);
    }
    const step = Math.max(1, Math.ceil(edge.length / 2 / SAMPLES));
    const pts = [];
    for (let i = 0; i < edge.length; i += 2 * step) pts.push(edge[i], edge[i + 1]);
    pieces.push({ id, area, x0, y0, x1: x1 + 1, y1: y1 + 1, cx: sx / area, cy: sy / area, pts, main: false, owner: 0 });
  }
  let maxArea = 0;
  for (let i = 1; i < pieces.length; i++) maxArea = Math.max(maxArea, pieces[i].area);
  const mains = [];
  for (let i = 1; i < pieces.length; i++) {
    const p = pieces[i];
    p.main = p.area >= Math.max(12, maxArea * MAIN_RATIO);
    if (p.main) { p.owner = p.id; mains.push(p); }
  }
  // メインの「芯」の左右(字の色の画素の、左から 10%〜90% の範囲)。長く伸びたとげ・払いは枠を大きくするので、重なりは芯で見る
  for (const p of mains) {
    const col = new Int32Array(p.x1 - p.x0);
    for (let y = p.y0; y < p.y1; y++) for (let x = p.x0; x < p.x1; x++) if (labels[y * w + x] === p.id) col[x - p.x0]++;
    let acc = 0;
    p.c0 = p.x0; p.c1 = p.x1;
    for (let i = 0, lo = false; i < col.length; i++) {
      acc += col[i];
      if (!lo && acc >= p.area * 0.1) { p.c0 = p.x0 + i; lo = true; }
      if (acc >= p.area * 0.9) { p.c1 = p.x0 + i + 1; break; }
    }
  }
  // 段(行)に分ける: 上下の重なりが、低い方の高さの 3割以上なら同じ段
  const rows = [];
  for (const p of mains.slice().sort((a, b) => a.cy - b.cy)) {
    const r = rows.find((q) => Math.min(q.y1, p.y1) - Math.max(q.y0, p.y0) >= 0.3 * Math.min(p.y1 - p.y0, q.y1 - q.y0));
    if (r) { r.ids.push(p.id); r.y0 = Math.min(r.y0, p.y0); r.y1 = Math.max(r.y1, p.y1); } else rows.push({ ids: [p.id], y0: p.y0, y1: p.y1 });
  }
  rows.sort((a, b) => a.y0 - b.y0);
  rows.forEach((r, k) => { r.ids.sort((a, b) => pieces[a].x0 - pieces[b].x0); for (const id of r.ids) pieces[id].row = k; });
  // かけら → いちばん近いメイン(字の高さの 2割より遠いものは捨てる)
  const hs = mains.map((p) => p.y1 - p.y0).sort((a, b) => a - b);
  const limit = Math.max(6, 0.2 * (hs[hs.length >> 1] || 0));
  for (let i = 1; i < pieces.length; i++) {
    const p = pieces[i];
    if (p.main || p.area < 3) continue;
    let best = 0, bd = Infinity;
    for (const m of mains) {
      // 枠が遠ければ測らない
      const gx = Math.max(m.x0 - p.cx, p.cx - m.x1, 0), gy = Math.max(m.y0 - p.cy, p.cy - m.y1, 0);
      if (Math.hypot(gx, gy) > Math.min(bd, limit)) continue;
      const d = pointDist(p.cx, p.cy, m.pts);
      if (d < bd) { bd = d; best = m.id; }
    }
    if (best && bd <= limit) p.owner = best;
  }
  // 段ごとの帯(上の線・ベースライン): メインの字の色の画素を横に数えて、いちばん多い行の 4割以上ある範囲
  const bands = rows.map((r) => {
    const cnt = new Int32Array(r.y1 - r.y0);
    for (const id of r.ids) {
      const p = pieces[id];
      for (let y = p.y0; y < p.y1; y++) for (let x = p.x0; x < p.x1; x++) if (labels[y * w + x] === id) cnt[y - r.y0]++;
    }
    let mx = 0;
    for (const v of cnt) mx = Math.max(mx, v);
    let a = 0, b = cnt.length - 1;
    while (a < b && cnt[a] < mx * 0.4) a++;
    while (b > a && cnt[b] < mx * 0.4) b--;
    return { top: r.y0 + a, base: r.y0 + b + 1 };
  });
  return { w, h, str, th, polarity: pol, labels, pieces, rows, bands };
}

function pointDist(x, y, pts) {
  let d = Infinity;
  for (let i = 0; i < pts.length; i += 2) { const v = (pts[i] - x) ** 2 + (pts[i + 1] - y) ** 2; if (v < d) d = v; }
  return Math.sqrt(d);
}
// 2つのピースのすき間(ふちの点どうしのいちばん近い距離)
function pieceDist(a, b) {
  let d = Infinity;
  const A = a.pts, B = b.pts;
  for (let i = 0; i < A.length; i += 2) for (let j = 0; j < B.length; j += 2) { const v = (A[i] - B[j]) ** 2 + (A[i + 1] - B[j + 1]) ** 2; if (v < d) d = v; }
  return Math.sqrt(d);
}

// 「前の字とつなぐ」印を自動で決める → { メインの番号: true }
//   ・上下に重なっているメイン(芯の横の重なりが、狭い方の芯の幅の 6割以上)はつなぐ(= や : のような字、字の中の離れたかけら)
//   ・count(字の数)より多ければ、すき間のいちばん狭い所から順につなぐ。すき間は「小さいかたまりほど字の一部らしい」として、
//     小さい方の面積(メインの面積の中央の値に対する割合)を掛けて比べる(K の斜めの線が、となりの E に付かないように)
export function autoJoins(an, count = 0) {
  const { pieces, rows } = an;
  const join = {};
  const areas = rows.flatMap((r) => r.ids.map((id) => pieces[id].area)).sort((a, b) => a - b);
  const mid = areas[areas.length >> 1] || 1;
  const areaOf = (L) => L.mains.reduce((a, id) => a + pieces[id].area, 0);
  for (const r of rows) {
    for (let i = 1; i < r.ids.length; i++) {
      const a = pieces[r.ids[i - 1]], b = pieces[r.ids[i]];
      const ov = Math.min(a.c1, b.c1) - Math.max(a.c0, b.c0);
      if (ov >= 0.6 * Math.min(a.c1 - a.c0, b.c1 - b.c0)) join[b.id] = true;
    }
  }
  if (count > 0) {
    for (;;) {
      const letters = lettersOf(an, join);
      if (letters.length <= count) break;
      let best = null;
      for (let i = 1; i < letters.length; i++) {
        const A = letters[i - 1], B = letters[i];
        if (A.row !== B.row) continue;
        let d = Infinity;
        for (const a of A.mains) for (const b of B.mains) d = Math.min(d, pieceDist(pieces[a], pieces[b]));
        d = (d + 1) * Math.min(1, Math.min(areaOf(A), areaOf(B)) / mid);
        if (!best || d < best.d) best = { d, id: B.mains[0] };
      }
      if (!best) break;
      join[best.id] = true;
    }
  }
  return join;
}

// 字の一覧 [{ row, mains: [番号], pieces: [番号(かけらも)], x0, y0, x1, y1(全部の枠), mx0, mx1(本体の左右) }]
export function lettersOf(an, join = {}) {
  const { pieces, rows } = an;
  const out = [];
  rows.forEach((r, k) => {
    r.ids.forEach((id, i) => {
      if (i > 0 && join[id]) out[out.length - 1].mains.push(id);
      else out.push({ row: k, mains: [id] });
    });
  });
  const of = new Map();
  out.forEach((L, k) => { for (const id of L.mains) of.set(id, k); });
  for (const L of out) L.pieces = L.mains.slice();
  for (let i = 1; i < pieces.length; i++) { const p = pieces[i]; if (!p.main && p.owner && of.has(p.owner)) out[of.get(p.owner)].pieces.push(i); }
  for (const L of out) {
    L.x0 = L.y0 = Infinity; L.x1 = L.y1 = -Infinity; L.mx0 = Infinity; L.mx1 = -Infinity;
    for (const id of L.pieces) { const p = pieces[id]; L.x0 = Math.min(L.x0, p.x0); L.y0 = Math.min(L.y0, p.y0); L.x1 = Math.max(L.x1, p.x1); L.y1 = Math.max(L.y1, p.y1); }
    for (const id of L.mains) { const p = pieces[id]; L.mx0 = Math.min(L.mx0, p.x0); L.mx1 = Math.max(L.mx1, p.x1); }
  }
  return out;
}

// 字の形だけの絵(不透明 = 字)。枠の外に pad だけ余白
function letterMask(an, L, pad) {
  const { w, labels } = an;
  const set = new Set(L.pieces);
  const mw = L.x1 - L.x0 + pad * 2, mh = L.y1 - L.y0 + pad * 2;
  const c = document.createElement('canvas');
  c.width = mw; c.height = mh;
  const x = c.getContext('2d');
  const im = x.createImageData(mw, mh);
  for (let y = L.y0; y < L.y1; y++) for (let xx = L.x0; xx < L.x1; xx++) {
    if (set.has(labels[y * w + xx])) im.data[((y - L.y0 + pad) * mw + xx - L.x0 + pad) * 4 + 3] = 255;
  }
  x.putImageData(im, 0, 0);
  return c;
}

const ringArea = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i].x * q.y - q.x * p[i].y; } return Math.abs(a / 2); };

// 字の形を作る → [{ char, advance, shapes }]
//   chars: 字(画像の左上から順。空白は無視)。同じ字が2回あれば、最初のものだけ使う
//   font: doc.font。bands: 段ごとの { top, base }(省略 = 自動で見つけた帯)
export function buildGlyphs(an, letters, chars, font, bands = an.bands) {
  const list = [...chars].filter((c) => c.trim());
  const dot = font.kind === 'dot', cs = dot ? font.upm / font.grid : 1;
  const out = [], seen = new Set();
  // 段ごとのすき間の中央の値(最後の字の幅に使う)
  const gapOf = an.rows.map((_, k) => {
    const row = letters.filter((L) => L.row === k), g = [];
    for (let i = 1; i < row.length; i++) g.push(row[i].mx0 - row[i - 1].mx1);
    g.sort((a, b) => a - b);
    const bh = bands[k].base - bands[k].top;
    return Math.max(0.03 * bh, g.length ? g[g.length >> 1] : 0.08 * bh);
  });
  letters.forEach((L, i) => {
    const ch = list[i];
    if (!ch || seen.has(ch)) return;
    const band = bands[L.row], U = (font.capHeight || font.upm * 0.7) / Math.max(1, band.base - band.top);
    const next = letters[i + 1]?.row === L.row ? letters[i + 1] : null;
    let advance = (next ? next.mx0 - L.mx0 : L.mx1 - L.mx0 + gapOf[L.row]) * U;
    advance = dot ? Math.max(1, Math.round(advance / cs)) * cs : Math.max(10, Math.round(advance));
    const pad = 3, mask = letterMask(an, L, pad);
    // 画像の座標 → 字形の座標(左 = 本体の左端、ベースライン = 帯の下)
    const b = { x0: (L.x0 - pad - L.mx0) * U, y0: font.ascender + (L.y0 - pad - band.base) * U };
    b.x1 = b.x0 + mask.width * U; b.y1 = b.y0 + mask.height * U;
    const draw = (c) => { c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; c.drawImage(mask, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); };
    let shapes = [];
    if (dot) {
      const cols = Math.round(advance / cs), c = document.createElement('canvas');
      c.width = cols; c.height = font.grid;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.scale(1 / cs, 1 / cs);
      draw(x);
      const d = x.getImageData(0, 0, cols, font.grid).data;
      for (let yy = 0; yy < font.grid; yy++) for (let xx = 0; xx < cols; xx++) {
        if (d[(yy * cols + xx) * 4 + 3] >= 128) shapes.push({ type: 'rect', dot: true, x: xx * cs, y: yy * cs, w: cs, h: cs, fill: '#000000ff', stroke: null, strokeWidth: 0 });
      }
    } else {
      // 元の 1画素を 3画素くらいでなぞる(少しぼかして、ぎざぎざを取る)
      const { loops, scale } = traceDrawing(b, (c) => { c.filter = 'blur(1.2px)'; draw(c); c.filter = 'none'; }, Math.min(2, 3 / U));
      // 少ない点の曲線にする(許すずれ = なぞった画素の 1.5 個ぶん)
      const rings = loops.filter((l) => ringArea(l) >= 2 * U * U).map((l) => fitLoop(l, 1.5 / scale)).filter((r) => r.length >= 2);
      if (rings.length) shapes = [{ type: 'path', closed: true, nodes: rings[0], ...(rings.length > 1 ? { subpaths: rings.slice(1).map((r) => ({ nodes: r, closed: true })) } : {}), fill: '#000000ff', stroke: null, strokeWidth: 0 }];
    }
    if (!shapes.length) return;
    seen.add(ch);
    out.push({ char: ch, advance, shapes });
  });
  return out;
}

// 筆にできる「縦の画」の候補 [{ letter(字の番号), id(ピース), x0, x1(列の範囲), width, fill, lone }](良い順)
//   縦の画 = 帯の高さの 6割以上が字の色の列が、続いている所。ほかの画がつながっていないもの(lone。I や、K の離れた縦棒)を先に
export function stemCandidates(an, letters, bands = an.bands) {
  const { w, labels, pieces } = an;
  const find = (ratio) => {
    const out = [];
    letters.forEach((L, li) => {
      const band = bands[L.row], bh = band.base - band.top;
      for (const id of L.mains) {
        const p = pieces[id], ya = Math.max(p.y0, band.top), yb = Math.min(p.y1, band.base);
        if (yb - ya < bh * ratio) continue;
        const col = new Float64Array(p.x1 - p.x0);
        for (let y = ya; y < yb; y++) for (let x = p.x0; x < p.x1; x++) if (labels[y * w + x] === id) col[x - p.x0]++;
        // かすれで列が途切れないように、となりの列とならす
        const sm = col.map((v, i) => (v + (col[i - 1] ?? v) + (col[i + 1] ?? v)) / 3);
        for (let i = 0; i < sm.length; i++) {
          if (sm[i] < bh * ratio) continue;
          let j = i, sum = 0;
          while (j < sm.length && sm[j] >= bh * ratio) sum += col[j++];
          const wd = j - i;
          if (wd >= Math.max(2, bh * 0.03) && wd <= bh * 0.6) out.push({ letter: li, id, x0: p.x0 + i, x1: p.x0 + j, width: wd, fill: sum / (wd * bh), lone: p.x1 - p.x0 <= wd * 2.4 });
          i = j;
        }
      }
    });
    return out;
  };
  let out = find(0.6);
  if (!out.length) out = find(0.42);
  out.sort((a, b) => (b.fill + (b.lone ? 0.2 : 0)) - (a.fill + (a.lone ? 0.2 : 0)));
  return out.slice(0, 8);
}

// 縦の画 → 筆の部品の図形(横向き。左 = 上 = 書き始め、長さ 800、太さは字形の単位のまま)と太さ。作れなければ null
//   真ん中(帯の 15%〜85%)は画の列だけ、両端は少し広く取る(入り・止めの形、セリフ)
export const BRUSH_END = 110; // 入り・終わりとして形を保つ長さ
export function buildBrush(an, cand, band, font, { W = 1000, CY = 200 } = {}) {
  const { w, labels, pieces } = an;
  const p = pieces[cand.id], bh = band.base - band.top, U = (font.capHeight || font.upm * 0.7) / Math.max(1, bh);
  const m = Math.round(cand.width * 0.6);
  const xa = Math.max(p.x0, cand.x0 - m), xb = Math.min(p.x1, cand.x1 + m);
  const ya = Math.max(p.y0, band.top - Math.round(bh * 0.02)), yb = Math.min(p.y1, band.base + Math.round(bh * 0.02));
  if (xb - xa < 1 || yb - ya < 4) return null;
  const mc = document.createElement('canvas');
  mc.width = xb - xa; mc.height = yb - ya;
  const mx = mc.getContext('2d'), im = mx.createImageData(mc.width, mc.height);
  let sx = 0, sn = 0;
  for (let y = ya; y < yb; y++) {
    const t = (y - band.top) / bh, wide = cand.lone || t < 0.15 || t > 0.85, e = Math.max(2, Math.round(cand.width * 0.25));
    const c0 = wide ? xa : Math.max(xa, cand.x0 - e), c1 = wide ? xb : Math.min(xb, cand.x1 + e);
    for (let x = c0; x < c1; x++) {
      if (labels[y * w + x] !== cand.id) continue;
      im.data[((y - ya) * mc.width + x - xa) * 4 + 3] = 255;
      if (t >= 0.3 && t <= 0.7) { sx += x; sn++; }
    }
  }
  if (!sn) return null;
  mx.putImageData(im, 0, 0);
  const cx = sx / sn + 0.5, kx = (W - 200) / (yb - ya);
  const b = { x0: 90, y0: CY - (xb - cx) * U - 4, x1: W - 90, y1: CY + (cx - xa) * U + 4 };
  const { loops, scale } = traceDrawing(b, (c) => {
    c.filter = 'blur(1.2px)'; c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.transform(0, -U, kx, 0, 100, CY + (cx - xa) * U);
    c.drawImage(mc, 0, 0);
    c.filter = 'none';
  }, 2);
  const rings = loops.filter((l) => ringArea(l) >= 4).map((l) => fitLoop(l, 1.5 / scale)).filter((r) => r.length >= 2);
  if (!rings.length) return null;
  const shape = { type: 'path', closed: true, nodes: rings[0], ...(rings.length > 1 ? { subpaths: rings.slice(1).map((r) => ({ nodes: r, closed: true })) } : {}), fill: '#000000ff', stroke: null, strokeWidth: 0 };
  return { shapes: [shape], thick: Math.round((sn / (bh * 0.4 + 1)) * U) };
}

// 確認用の絵: 字ごとに色を変えて塗る(見つけた字の色の所だけ)。捨てるかけらは暗い灰色
const TINTS = [[255, 107, 107], [102, 217, 120], [94, 160, 255], [255, 212, 84], [222, 120, 255], [84, 226, 226], [255, 160, 90], [170, 190, 255]];
export function tintCanvas(an, letters) {
  const { w, h, labels, pieces } = an;
  const of = new Int32Array(pieces.length).fill(-1);
  letters.forEach((L, k) => { for (const id of L.pieces) of[id] = k; });
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  const im = x.createImageData(w, h), d = im.data;
  for (let i = 0; i < w * h; i++) {
    const id = labels[i];
    const t = !id ? [22, 24, 29] : of[id] < 0 ? [70, 72, 80] : TINTS[of[id] % TINTS.length];
    d[i * 4] = t[0]; d[i * 4 + 1] = t[1]; d[i * 4 + 2] = t[2]; d[i * 4 + 3] = 255;
  }
  x.putImageData(im, 0, 0);
  return c;
}

// 画像の点 (x, y) にあるメインの番号(かけらならその持ち主)。近く(r 画素)まで探す。なければ 0
export function mainAt(an, x, y, r = 4) {
  const { w, h, labels, pieces } = an;
  let best = 0, bd = Infinity;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const xx = Math.round(x) + dx, yy = Math.round(y) + dy;
    if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
    const id = labels[yy * w + xx];
    if (!id || !pieces[id].owner) continue;
    const dd = dx * dx + dy * dy;
    if (dd < bd) { bd = dd; best = pieces[id].owner; }
  }
  return best;
}
