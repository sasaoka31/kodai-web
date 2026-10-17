// 画像のトレース: 色の境目(輪郭)を、線のパス(あとで点を動かせる・太さや色を変えられる)にする
//   1) 色の境目の画素を取り出す(imageproc.js の edgeMask。Sobel + 細線化)
//   2) 1画素の太さまで細くする(Zhang–Suen)
//   3) つながった画素をたどって、線(点の並び)にする。短い線は省く
//   4) 点の並びに、少ない点の曲線を当てはめる(fitcurve.js)
// 画像の取り込みの「輪郭を抽出」と、画像のレイヤーを選んだときに上のバーに出る「トレース…」から使う
import { state, toast } from './state.js';
import { VectorLayer, createCanvas } from './document.js';
import { insertLayers } from './layers.js';
import { openModal } from './modal.js';
import { toHex8 } from './color.js';
import { edgeMask } from './imageproc.js';
import { fitOpen, fitLoop } from './fitcurve.js';
import { newShapeId, drawShapes } from './vector.js';

const MAX_SIDE = 1200; // なぞるときの絵の大きさ(これより大きい絵は、縮めてなぞる)

// 1画素の太さまで細くする(Zhang–Suen)。m は W×H(1 = 線)。端の1画素は消す
function thin(m, W, H) {
  for (let x = 0; x < W; x++) { m[x] = 0; m[(H - 1) * W + x] = 0; }
  for (let y = 0; y < H; y++) { m[y * W] = 0; m[y * W + W - 1] = 0; }
  const del = [];
  for (let guard = 0; guard < 40; guard++) {
    let changed = false;
    for (let pass = 0; pass < 2; pass++) {
      del.length = 0;
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const p = y * W + x;
          if (!m[p]) continue;
          // 上から時計回り
          const p2 = m[p - W], p3 = m[p - W + 1], p4 = m[p + 1], p5 = m[p + W + 1], p6 = m[p + W], p7 = m[p + W - 1], p8 = m[p - 1], p9 = m[p - W - 1];
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (b < 2 || b > 6) continue;
          const a = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
          if (a !== 1) continue;
          if (pass === 0 ? (p2 && p4 && p6) || (p4 && p6 && p8) : (p2 && p4 && p8) || (p2 && p6 && p8)) continue;
          del.push(p);
        }
      }
      for (const p of del) m[p] = 0;
      if (del.length) changed = true;
    }
    if (!changed) break;
  }
  return m;
}

// つながった画素をたどる → [{ pts: [画素の番号…], closed }]
function chains(m, W, H) {
  const DX = [1, 0, -1, 0, 1, -1, -1, 1], DY = [0, 1, 0, -1, 1, 1, -1, -1]; // 上下左右を先に
  const off = DX.map((dx, k) => DY[k] * W + dx);
  const owner = new Int32Array(W * H); // どの線に入ったか(0 = まだ)
  const degree = (p) => { let n = 0; for (let k = 0; k < 8; k++) n += m[p + off[k]]; return n; };
  // まだたどっていない隣(上下左右を先に。同じなら、今までの向きに近い方)
  const next = (p, dir) => {
    let best = -1, bs = -Infinity;
    for (let k = 0; k < 8; k++) {
      const q = p + off[k];
      if (!m[q] || owner[q]) continue;
      const s = (k < 4 ? 10 : 0) + (dir < 0 ? 0 : DX[k] * DX[dir] + DY[k] * DY[dir]);
      if (s > bs) { bs = s; best = k; }
    }
    return best;
  };
  const walk = (start, id) => {
    const pts = [];
    let p = start, dir = -1;
    for (;;) {
      const k = next(p, dir);
      if (k < 0) break;
      p += off[k];
      owner[p] = id;
      pts.push(p);
      dir = k;
    }
    return pts;
  };
  // 端がほかの線にふれていれば、その画素までつなぐ(枝分かれの所で、線が離れないように)
  const touch = (p, id) => {
    for (let k = 0; k < 8; k++) { const q = p + off[k]; if (m[q] && owner[q] && owner[q] !== id) return q; }
    return -1;
  };
  const out = [];
  let id = 0;
  const start = (p) => {
    id++;
    owner[p] = id;
    const fwd = walk(p, id), back = walk(p, id);
    const pts = [...back.reverse(), p, ...fwd];
    const a = pts[0], b = pts[pts.length - 1];
    const ax = a % W, ay = (a - ax) / W, bx = b % W, by = (b - bx) / W;
    const closed = pts.length > 8 && Math.abs(ax - bx) <= 1 && Math.abs(ay - by) <= 1;
    if (!closed) {
      const ta = touch(a, id), tb = touch(b, id);
      if (ta >= 0) pts.unshift(ta);
      if (tb >= 0) pts.push(tb);
    }
    out.push({ pts, closed });
  };
  // 端(隣が1つ)から先に。残り(輪・枝)はそのあと
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const p = y * W + x; if (m[p] && !owner[p] && degree(p) === 1) start(p); }
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const p = y * W + x; if (m[p] && !owner[p]) start(p); }
  return out;
}

// 画素のぎざぎざをならす(端は動かさない。輪は一周つなげて)
function smooth(pts, closed, times = 2) {
  let p = pts;
  const n = p.length;
  for (let t = 0; t < times && n >= 3; t++) {
    p = p.map((q, i) => {
      if (!closed && (i === 0 || i === n - 1)) return q;
      const a = p[(i - 1 + n) % n], b = p[(i + 1) % n];
      return { x: (a.x + 2 * q.x + b.x) / 4, y: (a.y + 2 * q.y + b.y) / 4 };
    });
  }
  return p;
}

function hasAlpha(img) {
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
  return false;
}

// まわりに n px の透明なふちを足した絵
function padded(img, n) {
  const out = new ImageData(img.width + n * 2, img.height + n * 2);
  const s = new Uint32Array(img.data.buffer, img.data.byteOffset, img.width * img.height), d = new Uint32Array(out.data.buffer);
  for (let y = 0; y < img.height; y++) d.set(s.subarray(y * img.width, (y + 1) * img.width), (y + n) * out.width + n);
  return out;
}

// img(ImageData)の色の境目 → 線のパスの配列。
// opts = { sensitivity(0〜100), blur(0〜4), detail(許すずれ px。大きいほど点が少ない), minLen(これより短い線は省く px),
//          color(#rrggbbaa), width(線の太さ), x, y(置く位置), scale(画素 → ワールドの倍率) }
export function traceImage(img, { sensitivity = 50, blur = 1, detail = 1, minLen = 10, color = '#000000ff', width = 2, x = 0, y = 0, scale = 1 } = {}) {
  // 透明な所のある絵(切り抜いた絵など)は、まわりに透明なふちを足す(絵のはしにある輪郭も、とぎれずにたどれるように)。
  // 全部が不透明な絵(写真など)には足さない(絵のわくが、線になってしまうため)
  const PAD = hasAlpha(img) ? 4 : 0;
  if (PAD) { img = padded(img, PAD); x -= PAD * scale; y -= PAD * scale; }
  const W = img.width, H = img.height;
  const m = thin(edgeMask(img, { sensitivity, blur }), W, H);
  const shapes = [];
  const put = (n) => {
    const q = { x: n.x * scale + x, y: n.y * scale + y };
    if (n.hin) q.hin = { x: n.hin.x * scale + x, y: n.hin.y * scale + y };
    if (n.hout) q.hout = { x: n.hout.x * scale + x, y: n.hout.y * scale + y };
    return q;
  };
  for (const c of chains(m, W, H)) {
    if (c.pts.length < Math.max(3, minLen)) continue;
    const pts = smooth(c.pts.map((p) => ({ x: (p % W) + 0.5, y: Math.floor(p / W) + 0.5 })), c.closed);
    const nodes = c.closed ? fitLoop(pts, detail) : fitOpen(pts, detail);
    if (nodes.length < 2) continue;
    shapes.push({ type: 'path', id: newShapeId(), nodes: nodes.map(put), closed: c.closed, fill: null, stroke: color, strokeWidth: width });
  }
  return shapes;
}

// 線のパスの節点の数(「点 ○個」の表示用)
export const countNodes = (shapes) => shapes.reduce((n, s) => n + s.nodes.length, 0);

// ImageData を w×h に縮める
function shrink(img, w, h) {
  const src = createCanvas(img.width, img.height);
  src.getContext('2d').putImageData(img, 0, 0);
  const c = createCanvas(w, h);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, w, h);
  return x.getImageData(0, 0, w, h);
}

// レイヤー(ラスター)の絵と、置く位置・倍率(大きい絵は縮める)。絵がなければ null
function layerSource(layer) {
  const b = layer?.type === 'raster' ? layer.bounds() : null;
  if (!b) return null;
  const w = b.x1 - b.x0, h = b.y1 - b.y0;
  const k = Math.max(1, Math.max(w, h) / MAX_SIDE);
  let img = layer.getImageData(b.x0, b.y0, w, h);
  if (k > 1) img = shrink(img, Math.max(1, Math.round(w / k)), Math.max(1, Math.round(h / k)));
  return { img, x: b.x0, y: b.y0, scale: w / img.width };
}

// 「なめらかさ」のつまみ(1〜10)→ 許すずれ(px)。大きいほど、点が少なくなめらか
export const detailTol = (v) => 0.4 + (v - 1) * 0.28;

// つまみの値(sensitivity・blur・smooth(1〜10)・minLen(px)・width・color)→ レイヤーの絵の線のパス(ワールド座標)
function traceSource(src, o) {
  return traceImage(src.img, {
    sensitivity: o.sensitivity, blur: o.blur, detail: detailTol(o.smooth ?? 4), minLen: (o.minLen ?? 10) / src.scale,
    color: o.color, width: o.width, x: src.x, y: src.y, scale: src.scale,
  });
}

// 今のレイヤー(ラスター)の絵をなぞって、線のパスのベクターレイヤーを上に足す
export function traceLayer(layer, opts = {}) {
  const src = layerSource(layer);
  const shapes = src ? traceSource(src, opts) : [];
  if (!shapes.length) return null;
  const vl = new VectorLayer(`${layer.name}(トレース)`);
  vl.shapes = shapes;
  insertLayers('画像をトレース', [vl]);
  return vl;
}

let last = { sensitivity: 50, blur: 1, smooth: 4, minLen: 10, width: 2 };

// 上のバーの「トレース…」: 今のレイヤー(画像)の色の境目を、線のパスにする
export async function traceDialog() {
  const layer = state.doc?.activeLayer;
  const src = layerSource(layer);
  if (!src) { toast('トレースする画像のレイヤー(ラスター)を選んでください'); return; }
  const body = document.createElement('div');
  body.className = 'import-dialog trace-dialog';
  body.innerHTML = `
    <div class="import-preview">
      <canvas width="420" height="320"></canvas>
      <div class="import-info"></div>
    </div>
    <div class="import-options form">
      <p class="note">画像の色の境目をなぞって、<b>線のパス</b>にします(新しいベクターレイヤーを、画像の上に作ります)。作ったあとは、矢印ツール・ダイレクト選択で1本ずつ直せます。線の色は、今のメインカラーです。</p>
      <label>感度 <input type="range" id="tr-sens" min="0" max="100" value="${last.sensitivity}"><em></em></label>
      <label>ぼかし <input type="range" id="tr-blur" min="0" max="4" value="${last.blur}"><em></em></label>
      <label title="大きいほど、点が少なくなめらかな線になります">なめらかさ <input type="range" id="tr-smooth" min="1" max="10" value="${last.smooth}"><em></em></label>
      <label title="これより短い線(px)は作りません">短い線を省く <input type="range" id="tr-min" min="0" max="80" value="${last.minLen}"><em></em></label>
      <label>線の太さ <input type="range" id="tr-width" min="1" max="20" value="${last.width}"><em></em></label>
    </div>`;
  const q = (s) => body.querySelector(s);
  const read = () => ({
    sensitivity: Number(q('#tr-sens').value), blur: Number(q('#tr-blur').value), smooth: Number(q('#tr-smooth').value),
    minLen: Number(q('#tr-min').value), width: Number(q('#tr-width').value),
  });
  const color = toHex8({ ...state.primary, a: 255 });
  const preview = q('canvas'), info = q('.import-info');
  const { img } = src;
  const srcCanvas = createCanvas(img.width, img.height);
  srcCanvas.getContext('2d').putImageData(img, 0, 0);
  function draw() {
    for (const el of body.querySelectorAll('label > input[type=range]')) el.nextElementSibling.textContent = el.value;
    const shapes = traceSource(src, { ...read(), color });
    const ctx = preview.getContext('2d');
    const PW = preview.width, PH = preview.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, PW, PH);
    const s = Math.min(PW / img.width, PH / img.height);
    const dw = img.width * s, dh = img.height * s, dx = (PW - dw) / 2, dy = (PH - dh) / 2;
    ctx.fillStyle = '#fff';
    ctx.fillRect(dx, dy, dw, dh);
    ctx.globalAlpha = 0.3;
    ctx.drawImage(srcCanvas, dx, dy, dw, dh);
    ctx.globalAlpha = 1;
    // ワールド座標の線を、確認の絵の中へ
    const k = s / src.scale;
    ctx.setTransform(k, 0, 0, k, dx - src.x * k, dy - src.y * k);
    drawShapes(ctx, shapes);
    info.textContent = shapes.length ? `線 ${shapes.length}本・点 ${countNodes(shapes)}個` : '線が見つかりません(感度を上げてください)';
  }
  let timer = 0;
  body.addEventListener('input', () => { clearTimeout(timer); info.textContent = '処理中…'; timer = setTimeout(draw, 80); });
  draw();
  const { value } = await openModal({
    title: `トレース(色の境目を線のパスに)— ${layer.name}`,
    body,
    width: 820,
    buttons: [{ label: 'キャンセル', value: null }, { label: 'パスを作る', value: 'ok', primary: true }],
  });
  clearTimeout(timer);
  if (value !== 'ok') return;
  last = read();
  if (state.doc.activeLayer !== layer) return;
  const vl = traceLayer(layer, { ...last, color });
  toast(vl ? `線のパスを ${vl.shapes.length}本 作りました(レイヤー「${vl.name}」)` : '線が見つかりませんでした(感度を上げてください)');
}
