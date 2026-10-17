// ドット化(あとで戻せる効果)
// 図形・グループ・レイヤーに pixel(1ドットの大きさ・ワールド px)を持たせると、
// いったん 1/pixel の解像度で描いて輪郭をくっきりさせ、ぼかさずに拡大して表示する。
// 元のパスはそのまま残るので、粗さはいつでも変えられる・0 で元に戻る。
// ドットの格子はワールド座標の原点にそろえるので、隣の図形とドットの位置が合う。
import { drawShape, visualBounds } from './vector.js';

// 粗さは「段階」0〜192 で選ぶ。0 = なし、1 = 1px(ほとんど分からないくらい)… 192 = 64px。
// 細かい所ほど細かく刻む(指数)ので、変化に気づかないくらいのギザギザから少しずつ粗くできる
export const PIXEL_STEPS = 192;
export const PIXEL_MAX = 64;
const MAX_CELLS = 4e6;

export const isPixelated = (v) => v >= 1;

export function stepToPixel(step) {
  const s = Math.round(step);
  if (s <= 0) return 0;
  return +Math.pow(PIXEL_MAX, (Math.min(s, PIXEL_STEPS) - 1) / (PIXEL_STEPS - 1)).toFixed(3);
}

export function pixelToStep(px) {
  if (!(px >= 1)) return 0;
  return Math.max(1, Math.min(PIXEL_STEPS, Math.round(1 + (Math.log(px) / Math.log(PIXEL_MAX)) * (PIXEL_STEPS - 1))));
}

export const pixelLabel = (px) => (px >= 1 ? `${px < 10 ? px.toFixed(2) : px.toFixed(1)}px` : 'なし');

// Alt+ホイール: 1回で 4段階(+で粗く / -で細かく)
export function stepPixel(cur, dir) {
  return stepToPixel(Math.max(0, Math.min(PIXEL_STEPS, pixelToStep(cur) + dir * 4)));
}

// ctx はワールド座標の変換が設定済みであること
export function drawObjects(ctx, objects) {
  for (const o of objects) drawObject(ctx, o);
}

export function drawObject(ctx, o) {
  if (hasPixelGrad(o.pixelGrad)) {
    const b = visualBounds(o);
    drawPixelGrad(ctx, o.pixelGrad, b, b, (c) => drawPlain(c, o));
    return;
  }
  if (isPixelated(o.pixel)) {
    drawPixelated(ctx, o.pixel, visualBounds(o), (c) => drawPlain(c, o));
    return;
  }
  drawPlain(ctx, o);
}

function drawPlain(ctx, o) {
  if (o.type === 'group') for (const c of o.children) drawObject(ctx, c);
  else drawShape(ctx, o);
}

// paint(c) で描いたものを p ドットの粗さにして ctx に描く。b はワールド座標の範囲
export function drawPixelated(ctx, p, b, paint) {
  const r = pixelateCells(p, b, paint);
  if (!r) { paint(ctx); return; }
  if (r.empty) return;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(r.canvas, r.gx0, r.gy0, r.w * p, r.h * p);
  ctx.restore();
}

// ドットの格子(1マス = 1画素)にした絵。{ canvas, gx0, gy0, w, h } / 大きすぎれば null / 何もなければ { empty }
export function pixelateCells(p, b, paint) {
  const i0 = Math.floor(b.x0 / p), j0 = Math.floor(b.y0 / p);
  const w = Math.ceil(b.x1 / p) - i0, h = Math.ceil(b.y1 / p) - j0;
  const gx0 = i0 * p, gy0 = j0 * p;
  if (w <= 0 || h <= 0) return { empty: true };
  if (w * h > MAX_CELLS) return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = 'high';
  x.setTransform(1 / p, 0, 0, 1 / p, -gx0 / p, -gy0 / p);
  paint(x);
  // 半分以上かかっているドットだけ残して、輪郭をくっきりさせる
  const img = x.getImageData(0, 0, w, h);
  const d = img.data;
  let maxA = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > maxA) maxA = d[i];
  if (!maxA) return { empty: true };
  const thr = maxA / 2;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= thr ? maxA : 0;
  x.putImageData(img, 0, 0);
  return { canvas: c, img, gx0, gy0, w, h };
}

// ---- ドットの粗さのグラデーション(あとで戻せる効果)----
// pixelGrad = { from, to(ドットの大きさ px), angle(粗くなる向き。度: 0 = 左 → 右、90 = 上 → 下 …。昔のファイルは dir),
//               style: 'square'(四角いドット)|'dot'(網点: 丸いドット), dotFrom, dotTo(網点の丸の大きさ 0〜1。1 = マスいっぱい) }
// 粗さは向きに沿って from → to に変わる(段階と同じく指数で。細かい所ほどゆっくり)。
// 向きに沿って「その場所の粗さ」の幅の帯を並べ、帯の中を正方形のマスに分ける(帯ごとにマスの大きさが違う)。
// 角度が 90°の倍数でないときは、ドットの並びごとその角度に回す(網点なら斜めのスクリーン)。
// 網点は各マスの色で丸を描き、丸の大きさも dotFrom → dotTo に変わる
export const DOT_DIRS = { right: 0, down: 90, left: 180, up: 270 };
// 粗さは片方を 0(= イラストのまま)にもできる。そのときは粗さがまっすぐ変わり、1px(網点は 3px)より細かい所はイラストのまま
export const hasPixelGrad = (g) => !!g && g.from >= 0 && g.to >= 0 && Math.max(g.from, g.to) >= 1;
export const gradAngle = (g) => ((((g.angle ?? DOT_DIRS[g.dir] ?? 0) % 360) + 360) % 360);
const MAX_SRC = 4e6;
let tmp = null;

// 帯とマスを順に作る。fn(strip) に { u, p, j0, n, d(マスの色 RGBA), tMid, horiz } を渡す。
// 軸にそろった向き(0/90/180/270°)専用。回すときは drawPixelGrad / pixelGradCells が座標を回してから呼ぶ
function eachStrip(g, dir, b0, ref, paint, fn) {
  if (b0.x1 <= b0.x0 || b0.y1 <= b0.y0) return null;
  const halftone = g.style === 'dot';
  // 元の絵は一番粗いドットの分だけ広く描く(端のマスが元の絵の外にはみ出しても色を取れるように)
  const m = Math.ceil(Math.max(g.from, g.to)) + 1;
  const b = { x0: Math.floor(b0.x0) - m, y0: Math.floor(b0.y0) - m, x1: Math.ceil(b0.x1) + m, y1: Math.ceil(b0.y1) + m };
  const w0 = b.x1 - b.x0, h0 = b.y1 - b.y0;
  const s = Math.min(1.5, Math.sqrt(MAX_SRC / (w0 * h0)));
  const W = Math.max(1, Math.ceil(w0 * s)), H = Math.max(1, Math.ceil(h0 * s));
  const src = document.createElement('canvas');
  src.width = W; src.height = H;
  const sx = src.getContext('2d', { willReadFrequently: true });
  sx.setTransform(s, 0, 0, s, -b.x0 * s, -b.y0 * s);
  paint(sx);
  // 一番濃いアルファの半分以上だけ残す(ドット化と同じ)
  const all = sx.getImageData(0, 0, W, H).data;
  let maxA = 0;
  for (let i = 3; i < all.length; i += 4) if (all[i] > maxA) maxA = all[i];
  if (!maxA) return null;
  const horiz = dir === 'right' || dir === 'left';
  const r0 = horiz ? ref.x0 : ref.y0, len = Math.max(1, horiz ? ref.x1 - ref.x0 : ref.y1 - ref.y0);
  const tAt = (u) => { const t = Math.min(1, Math.max(0, (u - r0) / len)); return dir === 'left' || dir === 'up' ? 1 - t : t; };
  // 帯の幅は整数(帯の境目に細いすき間が出ないように)。0 = イラストのままの所(1px ずつ進む)
  const minP = halftone ? 3 : 1;
  const rawP = (t) => (g.from >= 1 && g.to >= 1 ? g.from * Math.pow(g.to / g.from, t) : g.from + (g.to - g.from) * t);
  const pOf = (u) => { const r = rawP(tAt(u)); return r < minP ? 0 : Math.max(minP, Math.round(r)); };
  const pAt = (u) => pOf(u) || 1;
  const u0 = horiz ? b0.x0 : b0.y0, u1 = horiz ? b0.x1 : b0.y1;
  const v0 = horiz ? b0.y0 : b0.x0, v1 = horiz ? b0.y1 : b0.x1;
  // 帯の始まりは基準の枠の端から数える(描く範囲が変わってもドットの位置が動かないように)
  let u = Math.floor(r0);
  if (u > u0) u = u0 - pAt(u0);
  else while (u + pAt(u) <= u0) u += pAt(u);
  tmp ||= document.createElement('canvas');
  const tx = tmp.getContext('2d', { willReadFrequently: true });
  for (; u < u1; ) {
    const plain = pOf(u + 0.5) === 0;
    const p = pAt(u + 0.5);
    const j0 = Math.floor(v0 / p), j1 = Math.ceil(v1 / p);
    const n = j1 - j0;
    if (n > 0) {
      // 帯を 1 × n マスに縮める(マスごとの平均の色)
      const cw = horiz ? 1 : n, ch = horiz ? n : 1;
      if (tmp.width < cw || tmp.height < ch) { tmp.width = Math.max(tmp.width, cw); tmp.height = Math.max(tmp.height, ch); }
      tx.setTransform(1, 0, 0, 1, 0, 0);
      tx.clearRect(0, 0, cw, ch);
      tx.imageSmoothingEnabled = true;
      tx.imageSmoothingQuality = 'high';
      const wx = horiz ? u : j0 * p, wy = horiz ? j0 * p : u;
      const ww = horiz ? p : n * p, wh = horiz ? n * p : p;
      tx.drawImage(src, (wx - b.x0) * s, (wy - b.y0) * s, ww * s, wh * s, 0, 0, cw, ch);
      const img = tx.getImageData(0, 0, cw, ch);
      fn({ u, p, j0, n, d: img.data, img, cw, ch, wx, wy, ww, wh, horiz, tMid: tAt(u + p / 2), thr: maxA / 2, maxA, plain });
    }
    u += p;
  }
  return { maxA };
}

// 網点の丸の半径(マスの大きさ p、位置 t)
const dotRadius = (g, p, t) => (p / 2) * Math.SQRT2 * Math.max(0, (g.dotFrom ?? 1) + ((g.dotTo ?? 0.3) - (g.dotFrom ?? 1)) * t);

// 回す向きのとき: ワールド ⇔ 回した座標(基準の枠の中心のまわりに -angle 回す)
function rotFrame(g, ref) {
  const a = (gradAngle(g) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const cx = (ref.x0 + ref.x1) / 2, cy = (ref.y0 + ref.y1) / 2;
  const toF = (x, y) => ({ x: cx + (x - cx) * c + (y - cy) * s, y: cy - (x - cx) * s + (y - cy) * c });
  const toW = (x, y) => ({ x: cx + (x - cx) * c - (y - cy) * s, y: cy + (x - cx) * s + (y - cy) * c });
  const box = (r) => {
    const ps = [toF(r.x0, r.y0), toF(r.x1, r.y0), toF(r.x0, r.y1), toF(r.x1, r.y1)];
    return { x0: Math.min(...ps.map((q) => q.x)), y0: Math.min(...ps.map((q) => q.y)), x1: Math.max(...ps.map((q) => q.x)), y1: Math.max(...ps.map((q) => q.y)) };
  };
  return { a, c, s, cx, cy, toF, toW, box };
}

const AXIS = { 0: 'right', 90: 'down', 180: 'left', 270: 'up' };

// paint(c) で描いたもの(範囲 b0)を、ref(粗さの変化の基準の枠)に対するグラデーションでドットにして ctx に描く
export function drawPixelGrad(ctx, g, b0, ref, paint) {
  if (b0.x1 <= b0.x0 || b0.y1 <= b0.y0) return;
  const ang = gradAngle(g);
  const axis = AXIS[Math.round(ang * 1000) / 1000];
  if (axis) { drawAxis(ctx, g, axis, b0, ref, paint, false); return; }
  const R = rotFrame(g, ref);
  ctx.save();
  ctx.translate(R.cx, R.cy);
  ctx.rotate(R.a);
  ctx.translate(-R.cx, -R.cy);
  drawAxis(ctx, g, 'right', R.box(b0), R.box(ref), (c) => { c.translate(R.cx, R.cy); c.rotate(-R.a); c.translate(-R.cx, -R.cy); paint(c); }, true);
  ctx.restore();
}

function drawAxis(ctx, g, dir, b0, ref, paint, rotated) {
  const halftone = g.style === 'dot';
  // 四角いドットはいったん別のキャンバスに並べてから1回で描く(拡大表示で帯の境目に線が出ないように)。
  // 回したときは画面の拡大率に合わせて細かく作り、なめらかに描く
  const m = ctx.getTransform();
  const S = rotated ? Math.min(4, Math.max(1, Math.hypot(m.a, m.b))) : 1;
  const ox = Math.floor(b0.x0), oy = Math.floor(b0.y0);
  const OW = Math.ceil(b0.x1) - ox, OH = Math.ceil(b0.y1) - oy;
  const off = !halftone && OW * OH * S * S <= 16e6 ? document.createElement('canvas') : null;
  let out = ctx;
  if (off) {
    off.width = Math.max(1, Math.ceil(OW * S)); off.height = Math.max(1, Math.ceil(OH * S));
    out = off.getContext('2d');
    out.scale(S, S);
    out.translate(-ox, -oy);
  }
  out.save();
  out.imageSmoothingEnabled = false;
  const plains = []; // イラストのままの所 [u0, u1](あとで元の絵をそのまま描く)
  let horizDir = true;
  eachStrip(g, dir, b0, ref, paint, (st) => {
    const { d, horiz, p, u, j0, n } = st;
    horizDir = horiz;
    if (st.plain) {
      const last = plains[plains.length - 1];
      if (last && last[1] === u) last[1] = u + p; else plains.push([u, u + p]);
      return;
    }
    if (!halftone) {
      for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= st.thr ? st.maxA : 0;
      tmp.getContext('2d').putImageData(st.img, 0, 0);
      out.drawImage(tmp, 0, 0, st.cw, st.ch, st.wx, st.wy, st.ww, st.wh);
      return;
    }
    const rad = dotRadius(g, p, st.tMid);
    if (rad <= 0) return;
    for (let k = 0; k < n; k++) {
      if (d[k * 4 + 3] < st.thr) continue;
      const cx = horiz ? u + p / 2 : (j0 + k) * p + p / 2, cy = horiz ? (j0 + k) * p + p / 2 : u + p / 2;
      out.fillStyle = `rgba(${d[k * 4]},${d[k * 4 + 1]},${d[k * 4 + 2]},${st.maxA / 255})`;
      // 丸がマスより大きいときはマスで切る(となりのマスにはみ出さない)
      const clip = rad > p / 2;
      if (clip) { out.save(); out.beginPath(); out.rect(cx - p / 2, cy - p / 2, p, p); out.clip(); }
      out.beginPath();
      out.arc(cx, cy, rad, 0, Math.PI * 2);
      out.fill();
      if (clip) out.restore();
    }
  });
  out.restore();
  if (off) {
    ctx.save();
    ctx.imageSmoothingEnabled = rotated;
    ctx.drawImage(off, ox, oy, off.width / S, off.height / S);
    ctx.restore();
  }
  if (plains.length) {
    ctx.save();
    ctx.beginPath();
    // ドットの所に 1px 重ねる(境目に細い線が出ないように)
    for (const [a, b] of plains) {
      if (horizDir) ctx.rect(a - 1, b0.y0 - 1, b - a + 2, b0.y1 - b0.y0 + 2);
      else ctx.rect(b0.x0 - 1, a - 1, b0.x1 - b0.x0 + 2, b - a + 2);
    }
    ctx.clip();
    paint(ctx);
    ctx.restore();
  }
}

// ---- アウトライン化用: ドット1つずつの形と色 ----
// [{ color: '#rrggbbaa', pts: [{x,y}…](ワールド座標の輪), x0, y0, p(マス), rad(網点の丸の半径), toW(回した座標 → ワールド), axis(回していない) }]。
// 四角いドットは四角、網点は丸(マスからはみ出す所は切る)
export function pixelGradCells(g, b0, ref, paint) {
  const ang = gradAngle(g);
  const axis = AXIS[Math.round(ang * 1000) / 1000];
  const R = axis ? null : rotFrame(g, ref);
  const bb = R ? R.box(b0) : b0, rr = R ? R.box(ref) : ref;
  const pnt = R ? (c) => { c.translate(R.cx, R.cy); c.rotate(-R.a); c.translate(-R.cx, -R.cy); paint(c); } : paint;
  const toW = R ? (q) => R.toW(q.x, q.y) : (q) => q;
  const hex = (v) => v.toString(16).padStart(2, '0');
  const out = [];
  eachStrip(g, axis || 'right', bb, rr, pnt, (st) => {
    const { d, horiz, p, u, j0, n } = st;
    for (let k = 0; k < n; k++) {
      if (d[k * 4 + 3] < st.thr) continue;
      const x0 = horiz ? u : (j0 + k) * p, y0 = horiz ? (j0 + k) * p : u;
      let pts = null;
      if (g.style === 'dot' && !st.plain) {
        const rad = dotRadius(g, p, st.tMid);
        if (rad <= 0) continue;
        const cx = x0 + p / 2, cy = y0 + p / 2;
        if (rad >= (p / 2) * Math.SQRT2 - 1e-6) pts = null; // マスいっぱい → 四角
        else {
          // 丸(マスからはみ出す所はマスの辺にそろえる)
          const N = rad > p / 2 ? 64 : Math.max(16, Math.min(64, Math.round(rad * 2)));
          pts = [];
          for (let i = 0; i < N; i++) {
            const a = (i / N) * Math.PI * 2;
            pts.push({ x: Math.min(x0 + p, Math.max(x0, cx + Math.cos(a) * rad)), y: Math.min(y0 + p, Math.max(y0, cy + Math.sin(a) * rad)) });
          }
        }
      }
      if (!pts) {
        pts = [{ x: x0, y: y0 }, { x: x0 + p, y: y0 }, { x: x0 + p, y: y0 + p }, { x: x0, y: y0 + p }];
      }
      const rad = g.style === 'dot' && !st.plain ? dotRadius(g, p, st.tMid) : 0;
      out.push({ plain: st.plain, color: `#${hex(d[k * 4])}${hex(d[k * 4 + 1])}${hex(d[k * 4 + 2])}${hex(st.maxA)}`, pts: pts.map(toW), x0, y0, p, rad, toW, axis: !R });
    }
  });
  return out;
}
