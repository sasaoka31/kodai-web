// 隠れた部分の自動穴埋め(AI: LaMa。完全オフライン・CPU)
//   パーツに分けたあと、前のパーツ(例: 腕)に隠れていた後ろのパーツ(例: 胴体)の部分を描き足す。
//   埋める範囲 = 「前のパーツがある所」∩「後ろのパーツの形を閉じた(すき間をふさいだ)範囲」。
//   閉じる大きさは画像の長辺の 10%(腕くらいの幅の隠れを埋め、はみ出した所は埋めない)
import { createCanvas } from './document.js';

const N = 512; // LaMa の入力の大きさ
export const CLOSE_RATIO = 0.1;

// ---- 形の処理(距離変換で太らせる・細らせる) ----

// 0 以外の画素からの距離(3-4 チャンファー距離 / 3 ≒ px)
function distanceFrom(src, W, H) {
  const INF = 1e9;
  const d = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) d[i] = src[i] ? 0 : INF;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    let v = d[i];
    if (!v) continue;
    if (x > 0) v = Math.min(v, d[i - 1] + 3);
    if (y > 0) {
      v = Math.min(v, d[i - W] + 3);
      if (x > 0) v = Math.min(v, d[i - W - 1] + 4);
      if (x < W - 1) v = Math.min(v, d[i - W + 1] + 4);
    }
    d[i] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x;
    let v = d[i];
    if (!v) continue;
    if (x < W - 1) v = Math.min(v, d[i + 1] + 3);
    if (y < H - 1) {
      v = Math.min(v, d[i + W] + 3);
      if (x < W - 1) v = Math.min(v, d[i + W + 1] + 4);
      if (x > 0) v = Math.min(v, d[i + W - 1] + 4);
    }
    d[i] = v;
  }
  return d;
}

// 閉じる(太らせてから細らせる): 幅 2r 以下のすき間・くぼみがふさがる
export function closeShape(mask, W, H, r) {
  const r3 = r * 3;
  const d1 = distanceFrom(mask, W, H);
  const outside = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) outside[i] = d1[i] > r3 ? 1 : 0;
  const d2 = distanceFrom(outside, W, H);
  const out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = d2[i] > r3 ? 1 : 0;
  return out;
}

// 縦か横に、両側を同じ形にはさまれたすき間(maxGap 以下)。まっすぐな辺が途切れた所を、くびれずにつなぐ
export function bridgeGaps(mask, W, H, maxGap) {
  const out = new Uint8Array(W * H);
  const run = (get, set, len) => {
    let last = -1;
    for (let t = 0; t < len; t++) {
      if (!get(t)) continue;
      if (last >= 0 && t - last - 1 > 0 && t - last - 1 <= maxGap) for (let u = last + 1; u < t; u++) set(u);
      last = t;
    }
  };
  for (let y = 0; y < H; y++) run((x) => mask[y * W + x], (x) => { out[y * W + x] = 1; }, W);
  for (let x = 0; x < W; x++) run((y) => mask[y * W + x], (y) => { out[y * W + x] = 1; }, H);
  return out;
}

// つながった部分ごとの外接矩形
function componentBoxes(mask, W, H, minPx) {
  const seen = new Uint8Array(W * H);
  const boxes = [];
  const stack = [];
  for (let s = 0; s < W * H; s++) {
    if (!mask[s] || seen[s]) continue;
    let x0 = W, y0 = H, x1 = 0, y1 = 0, n = 0;
    seen[s] = 1;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop(), x = i % W, y = (i / W) | 0;
      n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
      if (x < W - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && mask[i - W] && !seen[i - W]) { seen[i - W] = 1; stack.push(i - W); }
      if (y < H - 1 && mask[i + W] && !seen[i + W]) { seen[i + W] = 1; stack.push(i + W); }
    }
    if (n >= minPx) boxes.push({ x0, y0, x1: x1 + 1, y1: y1 + 1 });
  }
  return boxes;
}

// 周りの余白を足した正方形の切り出し範囲。重なるものはまとめる
function cropBoxes(boxes, W, H) {
  let crops = boxes.map((b) => {
    const side = Math.min(Math.max(W, H), Math.max(64, Math.round(Math.max(b.x1 - b.x0, b.y1 - b.y0) * 1.6)));
    return square((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, side, W, H);
  });
  for (let merged = true; merged;) {
    merged = false;
    outer: for (let i = 0; i < crops.length; i++) {
      for (let j = i + 1; j < crops.length; j++) {
        const a = crops[i], b = crops[j];
        if (a.x < b.x + b.s && b.x < a.x + a.s && a.y < b.y + b.s && b.y < a.y + a.s) {
          const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
          const x1 = Math.max(a.x + a.s, b.x + b.s), y1 = Math.max(a.y + a.s, b.y + b.s);
          crops[i] = square((x0 + x1) / 2, (y0 + y1) / 2, Math.max(x1 - x0, y1 - y0), W, H);
          crops.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return crops;
}

function square(cx, cy, side, W, H) {
  const s = Math.max(1, Math.min(Math.round(side), Math.max(W, H)));
  const x = Math.round(Math.max(0, Math.min(W - s, cx - s / 2)));
  const y = Math.round(Math.max(0, Math.min(H - s, cy - s / 2)));
  return { x, y, s };
}

// 画像の一部(正方形)を 512×512 に縮小・拡大して RGB で返す(透明な所は白)
function cropRGB(img, W, H, c) {
  const src = createCanvas(W, H);
  src.getContext('2d').putImageData(new ImageData(img, W, H), 0, 0);
  const t = createCanvas(N, N);
  const g = t.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff';
  g.fillRect(0, 0, N, N);
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, c.x, c.y, c.s, c.s, 0, 0, N, N);
  const d = g.getImageData(0, 0, N, N).data;
  const rgb = new Uint8Array(N * N * 3);
  for (let i = 0; i < N * N; i++) { rgb[i * 3] = d[i * 4]; rgb[i * 3 + 1] = d[i * 4 + 1]; rgb[i * 3 + 2] = d[i * 4 + 2]; }
  return rgb;
}

// マスク(W×H)の正方形部分を 512×512 に。少しでもかかる画素は埋める側に入れる
function cropMask(mask, W, H, c) {
  const out = new Uint8Array(N * N);
  const k = c.s / N;
  for (let y = 0; y < N; y++) {
    const sy0 = Math.floor(c.y + y * k), sy1 = Math.min(H, Math.ceil(c.y + (y + 1) * k));
    for (let x = 0; x < N; x++) {
      const sx0 = Math.floor(c.x + x * k), sx1 = Math.min(W, Math.ceil(c.x + (x + 1) * k));
      let hit = 0;
      for (let sy = sy0; sy < Math.max(sy1, sy0 + 1) && !hit; sy++) for (let sx = sx0; sx < Math.max(sx1, sx0 + 1); sx++) if (mask[sy * W + sx]) { hit = 1; break; }
      out[y * N + x] = hit;
    }
  }
  return out;
}

// 埋める作業の一覧を作る。split = { img, owner, used:[{name, pix}], PW, PH }(owner は used の番号・-1 は残り)
export function planFill(split) {
  const { owner, used, PW: W, PH: H } = split;
  const r = Math.max(4, Math.round(Math.max(W, H) * CLOSE_RATIO));
  // 前のパーツのふち(アンチエイリアスの画素)も隠す。残っているとその色が穴ににじむ
  const grow = Math.max(3, Math.round(Math.max(W, H) * 0.008));
  const jobs = [];
  for (let i = 1; i < used.length; i++) {
    const own = new Uint8Array(W * H), front0 = new Uint8Array(W * H);
    let nFront = 0;
    for (let p = 0; p < W * H; p++) {
      if (owner[p] === i) own[p] = 1;
      else if (owner[p] >= 0 && owner[p] < i) { front0[p] = 1; nFront++; }
    }
    if (!nFront) continue;
    const df = distanceFrom(front0, W, H);
    const front = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p++) front[p] = df[p] <= grow * 3 ? 1 : 0;
    const closed = closeShape(own, W, H, r);
    const bridged = bridgeGaps(own, W, H, r * 2);
    const fill = new Uint8Array(W * H);
    let n = 0;
    for (let p = 0; p < W * H; p++) if (front[p] && (closed[p] || bridged[p]) && !own[p]) { fill[p] = 1; n++; }
    if (n < 8) continue;
    for (const c of cropBoxes(componentBoxes(fill, W, H, 8), W, H)) jobs.push({ part: i, name: used[i].name, crop: c, fill, front });
  }
  return jobs;
}

// 1つの作業を実行して、そのパーツの画像(ImageData)に描き足す。戻り値: 埋めた画素数
export async function runFill(split, job, inpaintFn) {
  const { img, used, PW: W, PH: H } = split;
  const c = job.crop;
  // 前のパーツは全部「見えないもの」として隠す(腕の色が胴体ににじまないように)
  const rgb = cropRGB(img, W, H, c);
  const mask = cropMask(job.front, W, H, c);
  const out = await inpaintFn(rgb, mask);
  // 512×512 の結果を元の大きさに戻して、埋める範囲の画素だけ使う
  const t = createCanvas(N, N);
  const res = new ImageData(N, N);
  for (let i = 0; i < N * N; i++) { res.data[i * 4] = out[i * 3]; res.data[i * 4 + 1] = out[i * 3 + 1]; res.data[i * 4 + 2] = out[i * 3 + 2]; res.data[i * 4 + 3] = 255; }
  t.getContext('2d').putImageData(res, 0, 0);
  const back = createCanvas(c.s, c.s);
  const bg = back.getContext('2d', { willReadFrequently: true });
  bg.imageSmoothingQuality = 'high';
  bg.drawImage(t, 0, 0, c.s, c.s);
  const b = bg.getImageData(0, 0, c.s, c.s).data;
  const pix = used[job.part].pix.data;
  let n = 0;
  for (let y = 0; y < c.s; y++) for (let x = 0; x < c.s; x++) {
    const p = (c.y + y) * W + (c.x + x);
    if (!job.fill[p] || pix[p * 4 + 3]) continue;
    const q = (y * c.s + x) * 4;
    pix[p * 4] = b[q]; pix[p * 4 + 1] = b[q + 1]; pix[p * 4 + 2] = b[q + 2]; pix[p * 4 + 3] = 255;
    n++;
  }
  return n;
}
