// 軽量ベクターレンダラー
// 図形:
//   rect    { x, y, w, h }
//   ellipse { cx, cy, rx, ry }
//   line    { x1, y1, x2, y2 }
//   path    { nodes: [{ x, y, hin?:{x,y}, hout?:{x,y} }], closed, subpaths?: [{ nodes, closed }] }
//           subpaths がある = 複合パス(アウトライン化で作る穴あきの形)。塗りは evenodd
//   group   { children: [図形...] }
//   text    { text, family, size, lineHeight, letterSpacing, align, m:[a,b,c,d,e,f] }(text.js)
// 共通: id, stroke(#rrggbbaa|null), fill(#rrggbbaa|null), strokeWidth
//       round(角丸の半径 px。0/未設定=なし。四角・パスの直線どうしの角を表示時に丸める。あとで戻せる)
//       pixel(ドット化の粗さ px。0/未設定=なし)、rigBind(この図形だけのリグのバインド)
//       fillGrad / strokeGrad(色のグラデーション。gradient.js)、pixelGrad(ドットの粗さのグラデーション。pixelfx.js)

import { canvasGradient } from './gradient.js';
import { drawText, textBoxPath, textCorners, deformText } from './text.js';

let idSeq = 0;
export function newShapeId() {
  return `s${Date.now().toString(36)}${(++idSeq).toString(36)}`;
}

// id のない図形に id を付ける(グループの中も)
export function ensureIds(shapes) {
  for (const s of shapes) {
    if (!s.id) s.id = newShapeId();
    if (s.type === 'group') ensureIds(s.children);
  }
  return shapes;
}

export const isGroup = (s) => s.type === 'group';

// パスの Path2D は作るのが重い(ドットをアウトライン化したパスは輪が数千)ので、同じ形の間は使い回す。
// 形が変わるときは節点の配列ごと新しくなる(translateShape などは作り直す)ので、配列が同じなら同じ形
const pathCache = new WeakMap(); // 図形 → { nodes, subpaths, closed, round, path }

export function shapePath(s) {
  if (s.type === 'path') {
    const c = pathCache.get(s);
    if (c && c.nodes === s.nodes && c.subpaths === s.subpaths && c.closed === s.closed && c.round === s.round && c.n === s.nodes?.length) return c.path;
    const path = buildShapePath(s);
    pathCache.set(s, { nodes: s.nodes, subpaths: s.subpaths, closed: s.closed, round: s.round, n: s.nodes?.length, path });
    return path;
  }
  return buildShapePath(s);
}

function buildShapePath(s) {
  const p = new Path2D();
  if (s.round > 0 && s.type === 'rect') return shapePath(toPath(s));
  if (s.type === 'text') return textBoxPath(s);
  switch (s.type) {
    case 'rect':
      p.rect(s.x, s.y, s.w, s.h);
      break;
    case 'ellipse':
      p.ellipse(s.cx, s.cy, Math.abs(s.rx), Math.abs(s.ry), 0, 0, Math.PI * 2);
      break;
    case 'line':
      p.moveTo(s.x1, s.y1);
      p.lineTo(s.x2, s.y2);
      break;
    case 'path':
      for (const r of drawRings(s)) {
        const n = r.nodes;
        if (!n.length) continue;
        p.moveTo(n[0].x, n[0].y);
        for (let i = 1; i < n.length; i++) segment(p, n[i - 1], n[i]);
        if (r.closed && n.length > 2) {
          segment(p, n[n.length - 1], n[0]);
          p.closePath();
        }
      }
      break;
  }
  return p;
}

// パスの輪(本体+複合パスの残り)
export function pathRings(s) {
  const main = { nodes: s.nodes, closed: s.closed };
  return s.subpaths?.length ? [main, ...s.subpaths] : [main];
}

// 描くときの輪(角丸を反映)
function drawRings(s) {
  const rings = pathRings(s);
  return s.round > 0 ? rings.map((r) => ({ ...r, nodes: roundCorners(r.nodes, r.closed, s.round) })) : rings;
}

// 直線どうしがつながる角を、半径 radius の円弧(ベジェ近似)に置き換える。
// 曲線につながる節点・開いたパスの両端はそのまま。辺が短いときは半径を小さくする
export function roundCorners(nodes, closed, radius) {
  const n = nodes.length;
  if (n < 3 || !(radius > 0)) return nodes;
  const out = [];
  for (let i = 0; i < n; i++) {
    const v = nodes[i];
    const ends = !closed && (i === 0 || i === n - 1);
    const a = nodes[(i - 1 + n) % n], b = nodes[(i + 1) % n];
    const straight = !v.hin && !v.hout && !a.hout && !b.hin;
    if (ends || !straight) { out.push(v); continue; }
    const la = Math.hypot(a.x - v.x, a.y - v.y), lb = Math.hypot(b.x - v.x, b.y - v.y);
    if (la < 1e-6 || lb < 1e-6) { out.push(v); continue; }
    const ua = { x: (a.x - v.x) / la, y: (a.y - v.y) / la }, ub = { x: (b.x - v.x) / lb, y: (b.y - v.y) / lb };
    const theta = Math.acos(Math.max(-1, Math.min(1, ua.x * ub.x + ua.y * ub.y))); // 角の内角
    if (theta < 1e-3 || theta > Math.PI - 1e-3) { out.push(v); continue; }
    // 接点までの距離。隣の角と取り合わないよう辺の半分まで
    const t = Math.min(radius / Math.tan(theta / 2), la / 2, lb / 2);
    const r = t * Math.tan(theta / 2);
    const k = (4 / 3) * Math.tan((Math.PI - theta) / 4) * r;
    const p1 = { x: v.x + ua.x * t, y: v.y + ua.y * t }, p2 = { x: v.x + ub.x * t, y: v.y + ub.y * t };
    p1.hout = { x: p1.x - ua.x * k, y: p1.y - ua.y * k };
    p2.hin = { x: p2.x - ub.x * k, y: p2.y - ub.y * k };
    out.push(p1, p2);
  }
  return out;
}

// 角丸を付けられる図形か(四角、または直線の角を持つパス)
export function canRound(s) {
  if (s.type === 'rect') return true;
  if (s.type !== 'path') return false;
  return pathRings(s).some((r) => r.nodes.length >= 3 && r.nodes.some((v) => !v.hin && !v.hout));
}

// 正多角形の節点(中心・半径・角の数・最初の頂点の角度)
export function polygonNodes(cx, cy, r, sides, angle) {
  const out = [];
  for (let i = 0; i < sides; i++) {
    const a = angle + (i * Math.PI * 2) / sides;
    out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return out;
}

export const fillRule = (s) => (s.subpaths?.length ? 'evenodd' : 'nonzero');

function mapNodes(nodes, f) {
  return nodes.map((n) => {
    const o = f(n.x, n.y);
    if (n.hin) o.hin = f(n.hin.x, n.hin.y);
    if (n.hout) o.hout = f(n.hout.x, n.hout.y);
    return o;
  });
}

function segment(p, a, b) {
  if (a.hout || b.hin) {
    const c1 = a.hout || a;
    const c2 = b.hin || b;
    p.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y);
  } else {
    p.lineTo(b.x, b.y);
  }
}

export function hasFill(s) {
  return !!s.fill && s.type !== 'line' && s.type !== 'group';
}

export function hasStroke(s) {
  return !!s.stroke && s.strokeWidth > 0 && s.type !== 'group';
}

export function drawShape(ctx, s) {
  if (s.type === 'group') {
    for (const c of s.children) drawShape(ctx, c);
    return;
  }
  if (s.type === 'text') { drawText(ctx, s); return; }
  const p = shapePath(s);
  // グラデーションは図形の枠(線幅を含まない形の枠)に合わせる
  const gb = s.fillGrad || s.strokeGrad ? shapeBounds(s) : null;
  if (hasFill(s)) {
    ctx.fillStyle = s.fillGrad ? canvasGradient(ctx, s.fillGrad, gb) : s.fill;
    ctx.fill(p, fillRule(s));
  }
  if (hasStroke(s)) {
    ctx.strokeStyle = s.strokeGrad ? canvasGradient(ctx, s.strokeGrad, gb) : s.stroke;
    ctx.lineWidth = s.strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = s.type === 'rect' ? 'miter' : 'round';
    ctx.stroke(p);
  }
}

export function drawShapes(ctx, shapes) {
  for (const s of shapes) drawShape(ctx, s);
}

// ---- ヒットテスト ----

const hitCtx = document.createElement('canvas').getContext('2d');

// 輪がたくさんあるパス(ドットをアウトライン化したもの)の当たり判定は、点の近くの輪だけを調べる(全部だと重い)
const ringIndexCache = new WeakMap();
function ringIndex(s) {
  const c = ringIndexCache.get(s);
  if (c && c.nodes === s.nodes && c.subpaths === s.subpaths && c.round === s.round && c.n === s.nodes.length) return c.list;
  const list = drawRings(s).map((r) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (q) => { if (!q) return; x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); };
    for (const n of r.nodes) { add(n); add(n.hin); add(n.hout); }
    return { r, b: { x0, y0, x1, y1 }, path: null };
  });
  ringIndexCache.set(s, { nodes: s.nodes, subpaths: s.subpaths, round: s.round, n: s.nodes.length, list });
  return list;
}
const ringPath = (e) => {
  if (e.path) return e.path;
  const p = new Path2D(), n = e.r.nodes;
  if (n.length) {
    p.moveTo(n[0].x, n[0].y);
    for (let i = 1; i < n.length; i++) segment(p, n[i - 1], n[i]);
    if (e.r.closed && n.length > 2) { segment(p, n[n.length - 1], n[0]); p.closePath(); }
  }
  return (e.path = p);
};
const MANY_RINGS = 16;

// 輪ごとに: 塗り = 点を囲む輪の数が奇数(evenodd)、線 = 近くの輪の線に触れているか
function hitRings(s, x, y, pad, fill, stroke) {
  const near = ringIndex(s).filter((e) => x >= e.b.x0 - pad && x <= e.b.x1 + pad && y >= e.b.y0 - pad && y <= e.b.y1 + pad);
  if (!near.length) return false;
  if (fill) {
    let k = 0;
    for (const e of near) if (e.r.closed && x >= e.b.x0 && x <= e.b.x1 && y >= e.b.y0 && y <= e.b.y1 && hitCtx.isPointInPath(ringPath(e), x, y)) k++;
    if (k % 2 === 1) return true;
  }
  if (stroke) {
    hitCtx.lineWidth = pad * 2;
    hitCtx.lineCap = 'round';
    hitCtx.lineJoin = 'round';
    for (const e of near) if (hitCtx.isPointInStroke(ringPath(e), x, y)) return true;
  }
  return false;
}

export function hitShape(s, x, y, tol) {
  if (s.type === 'group') return s.children.some((c) => hitShape(c, x, y, tol));
  if (s.type === 'text') return hitCtx.isPointInPath(textBoxPath(s), x, y);
  if (s.type === 'path' && (s.subpaths?.length || 0) >= MANY_RINGS) {
    return hitRings(s, x, y, ((hasStroke(s) ? s.strokeWidth : 0) + tol * 2) / 2, hasFill(s), true);
  }
  const p = shapePath(s);
  if (hasFill(s) && hitCtx.isPointInPath(p, x, y, fillRule(s))) return true;
  hitCtx.lineWidth = (hasStroke(s) ? s.strokeWidth : 0) + tol * 2;
  hitCtx.lineCap = 'round';
  hitCtx.lineJoin = 'round';
  return hitCtx.isPointInStroke(p, x, y);
}

// 塗りがなくても「形の内側」なら当たり(直線・節点2つ以下の開いたパスは内側なし)
export function hitInterior(s, x, y) {
  if (s.type === 'group') return s.children.some((c) => hitInterior(c, x, y));
  if (s.type === 'line' || (s.type === 'path' && s.nodes.length < 3 && !s.subpaths?.length)) return false;
  if (s.type === 'path' && (s.subpaths?.length || 0) >= MANY_RINGS) return hitRings(s, x, y, 0, true, false);
  return hitCtx.isPointInPath(shapePath(s), x, y, fillRule(s));
}

export function hitTop(shapes, x, y, tol) {
  for (let i = shapes.length - 1; i >= 0; i--) {
    if (hitShape(shapes[i], x, y, tol)) return i;
  }
  return -1;
}

// クリックした位置の一番上の「色を持つ図形」(グループの中まで探す)。
// 見えている塗り・線に当たるか、塗りのない形の内側をクリックしたもの
export function hitLeafForPaint(shapes, x, y, tol) {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (s.type === 'group') {
      const r = hitLeafForPaint(s.children, x, y, tol);
      if (r) return { ...r, top: i };
      continue;
    }
    if (hitShape(s, x, y, tol) || hitInterior(s, x, y)) return { shape: s, top: i };
  }
  return null;
}

// ---- ジオメトリ ----

// 3次ベジェの、ある軸の端になる t(0〜1 の中)。導関数 = 0 の解
function bezierExtrema(p0, p1, p2, p3) {
  const a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), c = p1 - p0;
  const out = [];
  if (Math.abs(a) < 1e-12) { if (Math.abs(b) > 1e-12) out.push(-c / b); }
  else {
    const d = b * b - 4 * a * c;
    if (d >= 0) { const q = Math.sqrt(d); out.push((-b + q) / (2 * a), (-b - q) / (2 * a)); }
  }
  return out.filter((t) => t > 0 && t < 1);
}
function bezierAt(p0, p1, p2, p3, t) {
  const u = 1 - t, A = u * u * u, B = 3 * u * u * t, C = 3 * u * t * t, D = t * t * t;
  return { x: A * p0.x + B * p1.x + C * p2.x + D * p3.x, y: A * p0.y + B * p1.y + C * p2.y + D * p3.y };
}

// 線幅を含まない図形の外接矩形(パスは曲線の端まで。角丸は無視した近似)
const boundsCache = new WeakMap(); // パス → { nodes, subpaths, n, b }

export function shapeBounds(s) {
  switch (s.type) {
    case 'text': {
      const c = textCorners(s);
      const xs = c.map((p) => p.x), ys = c.map((p) => p.y);
      return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    }
    case 'group': {
      let r = null;
      for (const c of s.children) {
        const b = shapeBounds(c);
        r = r ? { x0: Math.min(r.x0, b.x0), y0: Math.min(r.y0, b.y0), x1: Math.max(r.x1, b.x1), y1: Math.max(r.y1, b.y1) } : b;
      }
      return r || { x0: 0, y0: 0, x1: 0, y1: 0 };
    }
    case 'rect':
      return {
        x0: Math.min(s.x, s.x + s.w), y0: Math.min(s.y, s.y + s.h),
        x1: Math.max(s.x, s.x + s.w), y1: Math.max(s.y, s.y + s.h),
      };
    case 'ellipse': {
      const rx = Math.abs(s.rx), ry = Math.abs(s.ry);
      return { x0: s.cx - rx, y0: s.cy - ry, x1: s.cx + rx, y1: s.cy + ry };
    }
    case 'line':
      return {
        x0: Math.min(s.x1, s.x2), y0: Math.min(s.y1, s.y2),
        x1: Math.max(s.x1, s.x2), y1: Math.max(s.y1, s.y2),
      };
    case 'path': {
      // 節点の多いパス(ドットをアウトライン化したもの)は毎回数えると重いので、形が同じ間は覚えておく
      const c = boundsCache.get(s);
      if (c && c.nodes === s.nodes && c.subpaths === s.subpaths && c.n === s.nodes.length) return { ...c.b };
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const add = (p) => {
        if (!p) return;
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
      };
      // 曲線は、取っ手の先ではなく、曲線そのものの端で測る(1.47.0。前は取っ手まで含めていたので、曲線の多い図形の整列・等間隔がずれた)
      for (const r of pathRings(s)) {
        const ns = r.nodes, n = ns.length;
        for (const v of ns) add(v);
        for (let i = 0; i < (r.closed ? n : n - 1); i++) {
          const a = ns[i], b = ns[(i + 1) % n];
          if (!a.hout && !b.hin) continue;
          const p1 = a.hout || a, p2 = b.hin || b;
          for (const t of bezierExtrema(a.x, p1.x, p2.x, b.x).concat(bezierExtrema(a.y, p1.y, p2.y, b.y))) add(bezierAt(a, p1, p2, b, t));
        }
      }
      if (x0 === Infinity) return { x0: 0, y0: 0, x1: 0, y1: 0 };
      boundsCache.set(s, { nodes: s.nodes, subpaths: s.subpaths, n: s.nodes.length, b: { x0, y0, x1, y1 } });
      return { x0, y0, x1, y1 };
    }
  }
  return { x0: 0, y0: 0, x1: 0, y1: 0 };
}

// 線幅まで含めた外接矩形(選択枠の表示用)
export function visualBounds(s) {
  if (s.type === 'group') {
    let r = null;
    for (const c of s.children) {
      const b = visualBounds(c);
      r = r ? { x0: Math.min(r.x0, b.x0), y0: Math.min(r.y0, b.y0), x1: Math.max(r.x1, b.x1), y1: Math.max(r.y1, b.y1) } : b;
    }
    return r || { x0: 0, y0: 0, x1: 0, y1: 0 };
  }
  const b = shapeBounds(s), e = hasStroke(s) ? s.strokeWidth / 2 : 0;
  return { x0: b.x0 - e, y0: b.y0 - e, x1: b.x1 + e, y1: b.y1 + e };
}

export function translateShape(s, dx, dy) {
  if (s.type === 'group') return { ...s, children: s.children.map((c) => translateShape(c, dx, dy)) };
  const t = structuredClone(s);
  switch (t.type) {
    case 'text': { const m = t.m || [1, 0, 0, 1, 0, 0]; t.m = [m[0], m[1], m[2], m[3], m[4] + dx, m[5] + dy]; break; }
    case 'rect': t.x += dx; t.y += dy; break;
    case 'ellipse': t.cx += dx; t.cy += dy; break;
    case 'line': t.x1 += dx; t.y1 += dy; t.x2 += dx; t.y2 += dy; break;
    case 'path':
      for (const r of pathRings(t)) {
        for (const n of r.nodes) {
          n.x += dx; n.y += dy;
          if (n.hin) { n.hin.x += dx; n.hin.y += dy; }
          if (n.hout) { n.hout.x += dx; n.hout.y += dy; }
        }
      }
      break;
  }
  return t;
}

const K = 0.5522847498; // 円をベジェ4本で近似する係数

// 四角・楕円をパスに変換(変形・リグで節点を個別に動かすため)
export function toPath(s) {
  if (s.type === 'rect') {
    return {
      ...s, type: 'path', closed: true,
      nodes: [{ x: s.x, y: s.y }, { x: s.x + s.w, y: s.y }, { x: s.x + s.w, y: s.y + s.h }, { x: s.x, y: s.y + s.h }],
    };
  }
  if (s.type === 'ellipse') {
    const { cx, cy } = s, rx = Math.abs(s.rx), ry = Math.abs(s.ry);
    const kx = rx * K, ky = ry * K;
    return {
      ...s, type: 'path', closed: true,
      nodes: [
        { x: cx, y: cy - ry, hin: { x: cx - kx, y: cy - ry }, hout: { x: cx + kx, y: cy - ry } },
        { x: cx + rx, y: cy, hin: { x: cx + rx, y: cy - ky }, hout: { x: cx + rx, y: cy + ky } },
        { x: cx, y: cy + ry, hin: { x: cx + kx, y: cy + ry }, hout: { x: cx - kx, y: cy + ry } },
        { x: cx - rx, y: cy, hin: { x: cx - rx, y: cy + ky }, hout: { x: cx - rx, y: cy - ky } },
      ],
    };
  }
  return s;
}

// 点の変形関数 f(x,y) で図形を変形(直線以外はパスになる)
export function deformShape(s, f) {
  if (s.type === 'group') return { ...s, children: s.children.map((c) => deformShape(c, f)) };
  if (s.type === 'text') return deformText(s, f);
  if (s.type === 'line') {
    const a = f(s.x1, s.y1), b = f(s.x2, s.y2);
    return { ...s, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  }
  const p = structuredClone(toPath(s));
  p.nodes = mapNodes(p.nodes, f);
  if (p.subpaths) p.subpaths = p.subpaths.map((r) => ({ ...r, nodes: mapNodes(r.nodes, f) }));
  return p;
}

function cubic(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

// パスを折れ線の点列に変換(ドット絵用ラスタライズで使用)。複合パスは輪ごとの配列
export function flattenRings(s) {
  return drawRings(s).map((r) => flattenPath(r));
}

export function flattenPath(s) {
  const n = s.nodes;
  if (!n.length) return [];
  const pts = [{ x: n[0].x, y: n[0].y }];
  const seg = (a, b) => {
    if (!a.hout && !b.hin) { pts.push({ x: b.x, y: b.y }); return; }
    const c1 = a.hout || a, c2 = b.hin || b;
    const len = Math.hypot(c1.x - a.x, c1.y - a.y) + Math.hypot(c2.x - c1.x, c2.y - c1.y) + Math.hypot(b.x - c2.x, b.y - c2.y);
    const steps = Math.max(4, Math.ceil(len));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      pts.push({ x: cubic(a.x, c1.x, c2.x, b.x, t), y: cubic(a.y, c1.y, c2.y, b.y, t) });
    }
  };
  for (let i = 1; i < n.length; i++) seg(n[i - 1], n[i]);
  if (s.closed && n.length > 2) seg(n[n.length - 1], n[0]);
  return pts;
}

// ---- フリーハンドの平滑化 (RDP 間引き + Catmull-Rom 由来のハンドル) ----

function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const a = pts[0], b = pts[pts.length - 1];
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  let maxD = -1, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i].x - dx * pts[i].y + b.x * a.y - b.y * a.x) / len;
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [a, b];
  const left = rdp(pts.slice(0, idx + 1), eps);
  const right = rdp(pts.slice(idx), eps);
  return left.slice(0, -1).concat(right);
}

export function smoothFreehand(pts, eps) {
  const s = rdp(pts, eps);
  return s.map((p, i) => {
    const prev = s[i - 1] || p;
    const next = s[i + 1] || p;
    const tx = (next.x - prev.x) / 6, ty = (next.y - prev.y) / 6;
    const node = { x: p.x, y: p.y };
    if (i > 0) node.hin = { x: p.x - tx, y: p.y - ty };
    if (i < s.length - 1) node.hout = { x: p.x + tx, y: p.y + ty };
    return node;
  });
}
