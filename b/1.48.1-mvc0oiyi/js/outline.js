// パスのアウトライン化・縁取り
//   アウトライン化: 選んだ図形の「線」を、同じ見た目の「塗りの図形」に変換する(イラレの「パスのアウトライン」)
//   縁取り       : 選んだ図形・グループ全体のシルエットをなぞった外周パスを新しく作る
// どちらも「高解像度で描く → アルファ 50% の等高線をなぞる(マーチングスクエア)→ 間引いてベジェに戻す」で作る。
// 線の太さ・角・線端・重なりの合体を幾何計算せずに正しく扱えるため。
// ドット化した図形は、ドットのマス目の境目をそのままなぞる(カクカクの形のまま。色ごとに1つのパス)
import { fitLoop } from './fitcurve.js';
import { state, toast } from './state.js';
import { shapesBounds } from './render.js';
import { prefs } from './prefs.js';
import { shapePath, fillRule, hasFill, hasStroke, visualBounds, newShapeId, isGroup } from './vector.js';
import { selectedItems, selectionLayer, modifySelection, setSelection } from './select.js';
import { toHex, toHex8, parseHex, clamp } from './color.js';
import { openModal } from './modal.js';
import { drawText } from './text.js';
import { pixelateCells, drawObjects, isPixelated, hasPixelGrad, pixelGradCells } from './pixelfx.js';

const MAX_PX = 6e6; // なぞるときのキャンバスの最大画素数
const PAD = 2;

// ---- 輪郭のトレース ----

// draw(ctx) で描いたもの(ワールド座標)を scale 倍でラスタライズし、輪郭を輪(点列)の配列で返す
export function traceDrawing(bounds, draw, targetScale) {
  const w0 = Math.max(1e-3, bounds.x1 - bounds.x0), h0 = Math.max(1e-3, bounds.y1 - bounds.y0);
  const scale = Math.min(targetScale, Math.sqrt(MAX_PX / (w0 * h0)));
  const W = Math.ceil(w0 * scale) + PAD * 2, H = Math.ceil(h0 * scale) + PAD * 2;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.setTransform(scale, 0, 0, scale, PAD - bounds.x0 * scale, PAD - bounds.y0 * scale);
  draw(ctx);
  const d = ctx.getImageData(0, 0, W, H).data;
  const a = new Uint8Array(W * H);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
  // 端は必ず透明にする(輪が閉じるように)
  for (let x = 0; x < W; x++) { a[x] = 0; a[(H - 1) * W + x] = 0; }
  for (let y = 0; y < H; y++) { a[y * W] = 0; a[y * W + W - 1] = 0; }
  const toWorld = (p) => ({ x: (p.x + 0.5 - PAD) / scale + bounds.x0, y: (p.y + 0.5 - PAD) / scale + bounds.y0 });
  const loops = marchingSquares(a, W, H, 128).map((l) => l.map(toWorld));
  return { loops, scale };
}

// アルファの配列(W×H、0〜255)の輪郭をワールド座標の輪にする。toWorld = 画素の座標 → ワールド
export function traceAlpha(a, W, H, toWorld) {
  for (let x = 0; x < W; x++) { a[x] = 0; a[(H - 1) * W + x] = 0; }
  for (let y = 0; y < H; y++) { a[y * W] = 0; a[y * W + W - 1] = 0; }
  return marchingSquares(a, W, H, 128).map((l) => l.map(toWorld));
}

// 値 >= iso を内側とする等高線。向きのそろった閉じた輪を返す(外周と穴で回る向きが逆)
function marchingSquares(v, W, H, iso) {
  const hKey = (i, j) => (j * W + i) * 2;
  const vKey = (i, j) => (j * W + i) * 2 + 1;
  const segs = new Map(); // 始点の辺 → 終点の辺
  const pts = new Map(); // 辺 → 交点
  const cross = (key, i0, j0, i1, j1) => {
    if (pts.has(key)) return;
    const a = v[j0 * W + i0], b = v[j1 * W + i1];
    const t = (iso - a) / (b - a);
    pts.set(key, { x: i0 + (i1 - i0) * t, y: j0 + (j1 - j0) * t });
  };
  for (let j = 0; j < H - 1; j++) {
    for (let i = 0; i < W - 1; i++) {
      const c = [v[j * W + i], v[j * W + i + 1], v[(j + 1) * W + i + 1], v[(j + 1) * W + i]];
      const b = c.map((x) => x >= iso);
      if (b[0] === b[1] && b[1] === b[2] && b[2] === b[3]) continue;
      // 時計回りの辺: 上(TL→TR) 右(TR→BR) 下(BR→BL) 左(BL→TL)
      const keys = [hKey(i, j), vKey(i + 1, j), hKey(i, j + 1), vKey(i, j)];
      const ends = [[i, j, i + 1, j], [i + 1, j, i + 1, j + 1], [i + 1, j + 1, i, j + 1], [i, j + 1, i, j]];
      const inOut = [], outIn = [];
      for (let k = 0; k < 4; k++) {
        if (b[k] === b[(k + 1) % 4]) continue;
        const [x0, y0, x1, y1] = ends[k];
        // 交点は向きによらず同じ位置になるよう、小さい座標側から計算
        if (x0 < x1 || y0 < y1) cross(keys[k], x0, y0, x1, y1);
        else cross(keys[k], x1, y1, x0, y0);
        (b[k] ? inOut : outIn).push(k);
      }
      if (inOut.length === 1) {
        segs.set(keys[outIn[0]], keys[inOut[0]]);
      } else {
        // 鞍点: 中心が内側なら外側の角を切り離し、外側なら内側の角を切り離す
        const centerIn = (c[0] + c[1] + c[2] + c[3]) / 4 >= iso;
        for (const k of outIn) {
          if (centerIn) segs.set(keys[k], keys[(k + 3) % 4]); // 外側の角 k を囲む(k-1 が in→out)
          else segs.set(keys[k], keys[(k + 1) % 4]); // 内側の角 k+1 を囲む
        }
      }
    }
  }
  const loops = [];
  for (const start of [...segs.keys()]) {
    if (!segs.has(start)) continue;
    const loop = [];
    let k = start;
    while (segs.has(k)) {
      loop.push(pts.get(k));
      const next = segs.get(k);
      segs.delete(k);
      k = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

export function signedArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y);
  return a / 2;
}

function pointInPoly(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// 他の輪にいくつ囲まれているか(0 = 一番外側)
export function depths(loops) {
  return loops.map((l, i) => loops.reduce((n, o, j) => n + (j !== i && pointInPoly(l[0], o) ? 1 : 0), 0));
}

// ---- 点列 → ベジェの節点 ----
//   アウトライン化・パスファインダー・縁取りは fitcurve.js の fitLoop(少ない点の曲線を当てはめる。1.42.0 から)。
//   下の simplifyLoop + loopToNodes(間引いた点を1つずつ節点にする)は、フォントの書き出しなどで使う

function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const a = pts[0], b = pts[pts.length - 1];
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  let maxD = -1, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const d = len < 1e-9 ? Math.hypot(p.x - a.x, p.y - a.y) : Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [a, b];
  return rdp(pts.slice(0, idx + 1), eps).slice(0, -1).concat(rdp(pts.slice(idx), eps));
}

// 閉じた輪の間引き(始点と一番遠い点で2つに分けて RDP)
export function simplifyLoop(pts, eps) {
  let far = 0, fd = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[0].x, pts[i].y - pts[0].y);
    if (d > fd) { fd = d; far = i; }
  }
  const a = rdp(pts.slice(0, far + 1), eps);
  const b = rdp(pts.slice(far).concat([pts[0]]), eps);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

// 曲がりの小さい点はなめらかな節点(ハンドル付き)、大きい点は角にする
const CORNER = (40 * Math.PI) / 180;

export function loopToNodes(pts) {
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const ux = p.x - a.x, uy = p.y - a.y, vx = b.x - p.x, vy = b.y - p.y;
    const la = Math.hypot(ux, uy), lb = Math.hypot(vx, vy);
    const node = { x: p.x, y: p.y };
    if (la < 1e-9 || lb < 1e-9) return node;
    const turn = Math.acos(clamp((ux * vx + uy * vy) / (la * lb), -1, 1));
    if (turn > CORNER) return node;
    let tx = b.x - a.x, ty = b.y - a.y;
    const lt = Math.hypot(tx, ty) || 1;
    tx /= lt; ty /= lt;
    node.hin = { x: p.x - (tx * la) / 3, y: p.y - (ty * la) / 3 };
    node.hout = { x: p.x + (tx * lb) / 3, y: p.y + (ty * lb) / 3 };
    return node;
  });
}

// トレース結果 → 複合パス(一番大きい輪が本体)。keepHoles=false なら一番外側の輪だけ
export function loopsToPath(loops, scale, { keepHoles = true, tol: tolIn = 0 } = {}) {
  const minArea = 4 / (scale * scale);
  let list = loops.filter((l) => Math.abs(signedArea(l)) >= minArea);
  if (!keepHoles) {
    const dep = depths(list);
    list = list.filter((_, i) => dep[i] === 0);
  }
  // 許すずれ: なぞった画素の 1.5 個ぶん(「o」が外 4点 + 内 4点になるくらい)
  const tol = tolIn || Math.max(1.5 / scale, 0.1);
  const rings = list
    .sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)))
    .map((l) => ({ nodes: fitLoop(l, tol), closed: true }))
    .filter((r) => r.nodes.length >= 2);
  if (!rings.length) return null;
  const path = { type: 'path', id: newShapeId(), nodes: rings[0].nodes, closed: true };
  if (rings.length > 1) path.subpaths = rings.slice(1);
  return path;
}

function expand(b, e) {
  return { x0: b.x0 - e, y0: b.y0 - e, x1: b.x1 + e, y1: b.y1 + e };
}

function unionBounds(list) {
  let r = null;
  for (const b of list) r = r ? { x0: Math.min(r.x0, b.x0), y0: Math.min(r.y0, b.y0), x1: Math.max(r.x1, b.x1), y1: Math.max(r.y1, b.y1) } : { ...b };
  return r;
}

export function leaves(s, out = []) {
  if (isGroup(s)) s.children.forEach((c) => leaves(c, out));
  else out.push(s);
  return out;
}

// ---- 線のアウトライン化 ----

// 1つの図形の線 → 塗りの複合パス(線がなければ null)
export function strokeToPath(s) {
  if (!hasStroke(s)) return null;
  const sw = s.strokeWidth;
  const b = expand(visualBounds(s), 2);
  const { loops, scale } = traceDrawing(b, (ctx) => {
    if (s.type === 'text') { drawText(ctx, s, { fill: null, stroke: '#000', strokeWidth: sw }); return; }
    ctx.strokeStyle = '#000';
    ctx.lineWidth = sw;
    ctx.lineCap = 'round';
    ctx.lineJoin = s.type === 'rect' ? 'miter' : 'round';
    ctx.stroke(shapePath(s));
  }, clamp(12 / sw, 3, 16));
  const p = loopsToPath(loops, scale);
  if (!p) return null;
  p.fill = s.stroke;
  p.stroke = null;
  p.strokeWidth = sw;
  return p;
}

// 文字の塗り(字の形)→ 塗りの複合パス
export function textFillPath(s) {
  const b = expand(visualBounds(s), 2);
  // 細かくなぞって(字の大きさ 600px ぶんくらい)、字の大きさの 0.22% までのずれで少ない点にする(「o」= 外 4点 + 内 4点)
  const { loops, scale } = traceDrawing(b, (ctx) => drawText(ctx, s, { fill: '#000', stroke: null }), clamp(600 / s.size, 3, 16));
  const p = loopsToPath(loops, scale, { tol: Math.max(s.size * 0.0022, 1 / scale) });
  if (!p) return null;
  p.fill = s.fill;
  p.stroke = null;
  p.strokeWidth = 0;
  return p;
}

// ---- ドット化した図形のアウトライン化 ----

// マス目の塗られた部分の境目の輪(マスの角の座標)。まっすぐ続く点は省く
export function cellRings(mask, w, h) {
  const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x];
  const out = new Map(); // "x,y" → [[x2,y2], ...](時計回りの辺)
  const add = (x1, y1, x2, y2) => {
    const k = `${x1},${y1}`;
    if (!out.has(k)) out.set(k, []);
    out.get(k).push([x2, y2]);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!at(x, y)) continue;
    if (!at(x, y - 1)) add(x, y, x + 1, y);
    if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1);
    if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1);
    if (!at(x - 1, y)) add(x, y + 1, x, y);
  }
  const rings = [];
  for (const [startKey, list] of out) {
    while (list.length) {
      const [sx, sy] = startKey.split(',').map(Number);
      const ring = [[sx, sy]];
      let [cx, cy] = [sx, sy];
      let [nx, ny] = list.pop();
      let dx = nx - cx, dy = ny - cy;
      for (let guard = 0; guard < 1e7; guard++) {
        cx = nx; cy = ny;
        if (cx === sx && cy === sy) break;
        ring.push([cx, cy]);
        const cand = out.get(`${cx},${cy}`);
        if (!cand?.length) break;
        // 斜めにだけ接しているマスは別の輪にする(右に曲がるのを優先)
        let best = 0, bc = -Infinity;
        cand.forEach(([ex, ey], i) => { const c = dx * (ey - cy) - dy * (ex - cx); if (c > bc) { bc = c; best = i; } });
        [nx, ny] = cand.splice(best, 1)[0];
        dx = nx - cx; dy = ny - cy;
      }
      // まっすぐ続く点を省く
      const r = ring.filter((p, i) => {
        const a = ring[(i - 1 + ring.length) % ring.length], b = ring[(i + 1) % ring.length];
        return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0;
      });
      if (r.length >= 4) rings.push(r);
    }
  }
  return rings;
}

// 図形の色(塗り・線)の一覧。ドットの色はこの中の一番近い色にそろえる(境目のにじんだ色をなくす)
function paletteOf(s, out = []) {
  if (s.type === 'group') { s.children.forEach((c) => paletteOf(c, out)); return out; }
  for (const c of [s.fill, s.stroke]) if (c && !out.includes(c)) out.push(c);
  return out;
}

// ドット化した図形 → ドットの形のパス(色ごと)。px = ドットの大きさ
export function pixelOutline(shape, px) {
  const plain = shape.type === 'group' ? shape.children : [{ ...shape, pixel: 0 }];
  const r = pixelateCells(px, visualBounds(shape), (c) => drawObjects(c, plain));
  if (!r || r.empty) return null;
  const pal = paletteOf(shape).map((h) => ({ h, c: parseHex(h) }));
  if (!pal.length) return null;
  const { w, h, gx0, gy0 } = r;
  const d = r.img.data;
  const masks = pal.map(() => new Uint8Array(w * h));
  for (let i = 0; i < w * h; i++) {
    if (!d[i * 4 + 3]) continue;
    let best = 0, bd = Infinity;
    pal.forEach((p, k) => {
      const e = (d[i * 4] - p.c.r) ** 2 + (d[i * 4 + 1] - p.c.g) ** 2 + (d[i * 4 + 2] - p.c.b) ** 2;
      if (e < bd) { bd = e; best = k; }
    });
    masks[best][i] = 1;
  }
  const paths = [];
  pal.forEach((p, k) => {
    const rings = cellRings(masks[k], w, h).map((ring) => ({ closed: true, nodes: ring.map(([x, y]) => ({ x: gx0 + x * px, y: gy0 + y * px })) }));
    if (!rings.length) return;
    const path = { type: 'path', id: newShapeId(), closed: true, nodes: rings[0].nodes, fill: p.h, stroke: null, strokeWidth: 0 };
    if (rings.length > 1) path.subpaths = rings.slice(1);
    paths.push(path);
  });
  if (!paths.length) return null;
  const keep = shape.rigBind ? { rigBind: structuredClone(shape.rigBind) } : {};
  return paths.length === 1 ? { ...paths[0], id: shape.id, ...keep } : { type: 'group', id: shape.id, children: paths, ...keep };
}

// グラデーションでドット化した図形 → ドット1つずつの形のパス(色ごとに1つのパス、ドットは複合パスの輪)。
// ref = 粗さの変化の基準の枠(図形なら図形の枠、レイヤー全体なら絵の枠)
export function pixelGradOutline(shape, g, ref) {
  const plain = shape.type === 'group' ? shape.children : [{ ...shape, pixel: 0, pixelGrad: null }];
  const b = visualBounds(shape);
  const cells = pixelGradCells(g, b, ref || b, (c) => drawObjects(c, plain));
  if (!cells.length) return null;
  const rough = prefs.outlineDetail === 'rough';
  // 色のグラデーションがなければ、図形の色の一番近い色にそろえる(ふちのドットの色のわずかなずれで、パスが分かれないように)。
  // グラデーションがあって「ざっくり」なら、色の段を 16段に減らす(パスの数が減る)
  const hasGrad = leaves(shape).some((x) => x.fillGrad || x.strokeGrad);
  const pal = hasGrad ? [] : paletteOf(shape).map((h) => ({ h, c: parseHex(h) }));
  const snap = (hex) => {
    if (!pal.length) {
      if (!rough) return hex;
      const c = parseHex(hex), q = (v) => Math.min(255, Math.round(v / 17) * 17);
      return toHex8({ r: q(c.r), g: q(c.g), b: q(c.b), a: c.a });
    }
    const c = parseHex(hex);
    let best = pal[0], bd = Infinity;
    for (const q of pal) { const e = (c.r - q.c.r) ** 2 + (c.g - q.c.g) ** 2 + (c.b - q.c.b) ** 2; if (e < bd) { bd = e; best = q; } }
    return best.h;
  };
  const byColor = new Map();
  for (const c of cells) {
    const col = snap(c.color);
    if (!byColor.has(col)) byColor.set(col, []);
    byColor.get(col).push(c);
  }
  const K = 0.5522847498;
  const paths = [...byColor].map(([color, list]) => {
    let rings = [];
    // 四角いドットとイラストのままの所(1px のマス): となり合う同じ色のマスを1つの輪にまとめる(回した座標でまとめてから戻す)。
    // 見た目は同じで、アンカーポイントがずっと少ない
    const squares = list.filter((c) => c.plain || g.style !== 'dot');
    const dots = list.filter((c) => !(c.plain || g.style !== 'dot'));
    if (squares.length) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const c of squares) { x0 = Math.min(x0, c.x0); y0 = Math.min(y0, c.y0); x1 = Math.max(x1, c.x0 + c.p); y1 = Math.max(y1, c.y0 + c.p); }
      const W = x1 - x0, H = y1 - y0, mask = new Uint8Array(W * H);
      for (const c of squares) for (let y = c.y0 - y0; y < c.y0 - y0 + c.p; y++) mask.fill(1, y * W + c.x0 - x0, y * W + c.x0 - x0 + c.p);
      const toW = squares[0].toW;
      rings.push(...cellRings(mask, W, H).map((r) => ({ closed: true, nodes: r.map(([x, y]) => { const q = toW({ x: x + x0, y: y + y0 }); return { x: q.x, y: q.y }; }) })));
    }
    if (dots.length && rough) {
      // 網点(ざっくり): 丸をアンカーポイント4つの円にする(マスからはみ出す分は小さくする)
      rings.push(...dots.map((c) => {
        const r = Math.min(c.rad, c.p / 2), cx = c.x0 + c.p / 2, cy = c.y0 + c.p / 2, k = r * K;
        const P = (x, y) => c.toW({ x, y });
        return { closed: true, nodes: [
          { ...P(cx, cy - r), hin: P(cx - k, cy - r), hout: P(cx + k, cy - r) },
          { ...P(cx + r, cy), hin: P(cx + r, cy - k), hout: P(cx + r, cy + k) },
          { ...P(cx, cy + r), hin: P(cx + k, cy + r), hout: P(cx - k, cy + r) },
          { ...P(cx - r, cy), hin: P(cx - r, cy + k), hout: P(cx - r, cy - k) },
        ] };
      }));
    } else if (dots.length) {
      rings.push(...dots.map((c) => ({ closed: true, nodes: c.pts.map((q) => ({ x: q.x, y: q.y })) })));
    }
    if (!rings.length) return null;
    const path = { type: 'path', id: newShapeId(), closed: true, nodes: rings[0].nodes, fill: color, stroke: null, strokeWidth: 0 };
    if (rings.length > 1) path.subpaths = rings.slice(1);
    return path;
  }).filter(Boolean);
  if (!paths.length) return null;
  const keep = shape.rigBind ? { rigBind: structuredClone(shape.rigBind) } : {};
  return paths.length === 1 ? { ...paths[0], id: shape.id, ...keep } : { type: 'group', id: shape.id, children: paths, ...keep };
}

// 図形(グループなら中身すべて)の線をアウトライン化した図形を返す。変わらなければ null
// 文字は字の形そのものをパスにする(線があれば線もパスに)
function outlineShape(s, layerPixel = 0, layerGrad = null) {
  // グラデーションでドット化してあるものは、ドット1つずつの形のまま
  if (hasPixelGrad(s.pixelGrad)) return pixelGradOutline(s, s.pixelGrad, null);
  if (layerGrad) return pixelGradOutline(s, layerGrad.g, layerGrad.ref);
  // ドット化してあるものは、ドットの形のまま
  const px = isPixelated(s.pixel) ? s.pixel : layerPixel;
  if (isPixelated(px)) return pixelOutline(s, px);
  if (isGroup(s)) {
    let changed = false;
    const children = s.children.map((c) => {
      const o = outlineShape(c);
      if (o) changed = true;
      return o || c;
    });
    return changed ? { ...s, children } : null;
  }
  if (s.type === 'text') {
    const keepT = {};
    for (const k of ['pixel', 'rigBind']) if (s[k]) keepT[k] = structuredClone(s[k]);
    const parts = [hasFill(s) ? textFillPath(s) : null, strokeToPath(s)].filter(Boolean);
    if (!parts.length) return null;
    return parts.length === 1 ? { ...parts[0], id: s.id, ...keepT } : { type: 'group', id: s.id, children: parts, ...keepT };
  }
  const line = strokeToPath(s);
  if (!line) return null;
  const keep = {};
  for (const k of ['pixel', 'rigBind']) if (s[k]) keep[k] = structuredClone(s[k]);
  if (!hasFill(s)) return { ...line, id: s.id, ...keep };
  // 塗りもある図形は「塗り」と「線だったもの」のグループにする
  const body = { ...structuredClone(s), id: newShapeId(), stroke: null };
  delete body.pixel;
  delete body.rigBind;
  return { type: 'group', id: s.id, children: [body, line], ...keep };
}

export function outlineSelection() {
  const items = selectedItems();
  if (!items.length) { toast('アウトライン化する図形を矢印ツールで選んでください'); return; }
  let count = 0;
  modifySelection('パスのアウトライン化', (its, layer) => {
    const lp = isPixelated(layer.pixel) ? layer.pixel : 0;
    // レイヤー全体のグラデーションでドット化: 粗さの基準はレイヤーの絵の枠(画面の表示と同じ)
    const lg = hasPixelGrad(layer.pixelGrad) ? { g: layer.pixelGrad, ref: shapesBounds(layer.shapes) } : null;
    for (const it of its) {
      const o = outlineShape(it.shape, lp, lg);
      if (!o) continue;
      layer.shapes[it.index] = o;
      count += isPixelated(it.shape.pixel) || lp || lg || hasPixelGrad(it.shape.pixelGrad) ? 1 : leaves(it.shape).filter((x) => hasStroke(x) || x.type === 'text').length;
    }
    if (!count) return false;
  });
  toast(count ? `${count}個をアウトライン化しました(線・文字 → 塗りのパス)` : '選んだ図形に線・文字がありません');
}

// ---- 縁取り(シルエットの外周) ----

// items: [{shape}] 全体のシルエットをなぞったパス。width = 外に広げる量
export function silhouettePath(items, { width, holes = false }) {
  const all = items.flatMap((it) => leaves(it.shape)).filter((s) => hasFill(s) || hasStroke(s));
  if (!all.length) return null;
  const b = expand(unionBounds(all.map(visualBounds)), width + 2);
  const { loops, scale } = traceDrawing(b, (ctx) => {
    ctx.fillStyle = ctx.strokeStyle = '#000';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of all) {
      if (s.type === 'text') {
        drawText(ctx, s, { fill: '#000', stroke: '#000', strokeWidth: (hasStroke(s) ? s.strokeWidth : 0) + width * 2 });
        continue;
      }
      const p = shapePath(s);
      if (hasFill(s)) ctx.fill(p, fillRule(s));
      const lw = (hasStroke(s) ? s.strokeWidth : 0) + width * 2;
      if (lw > 0) {
        ctx.lineWidth = lw;
        ctx.stroke(p);
      }
    }
  }, clamp(12 / Math.max(1, width), 3, 8));
  return loopsToPath(loops, scale, { keepHoles: holes });
}

// 全員が同じ値ならその値(ドット化・バインドを縁取りに引き継ぐ)
function common(items, key) {
  const vals = items.map((it) => JSON.stringify(it.shape[key] ?? null));
  return vals.every((v) => v === vals[0]) ? JSON.parse(vals[0]) : null;
}

// opts = { width, color(#rrggbbaa), mode: 'fill'|'line', holes, perItem }
export function makeBorder(opts) {
  const items = selectedItems();
  if (!items.length) { toast('縁取りする図形を矢印ツールで選んでください'); return []; }
  const sets = opts.perItem ? items.map((it) => [it]) : [items];
  const made = [];
  modifySelection('縁取りを作成', (_its, layer) => {
    // 下の図形から順に差し込むと、上の図形の位置がずれるので上から
    for (const set of [...sets].reverse()) {
      const line = opts.mode === 'line';
      const p = silhouettePath(set, { width: line ? 0 : opts.width, holes: opts.holes });
      if (!p) continue;
      if (line) Object.assign(p, { fill: null, stroke: opts.color, strokeWidth: opts.width * 2 });
      else Object.assign(p, { fill: opts.color, stroke: null, strokeWidth: opts.width });
      const px = common(set, 'pixel'), bind = common(set, 'rigBind');
      if (px >= 1) p.pixel = px;
      if (bind) p.rigBind = bind;
      const at = Math.min(...set.map((it) => it.index));
      layer.shapes.splice(at, 0, p);
      made.push(p.id);
    }
    if (!made.length) return false;
  });
  if (!made.length) { toast('縁取りできる図形がありません'); return []; }
  setSelection(selectionLayer(), made);
  toast(`縁取りを${made.length}個作りました(選択中。右の「線と塗り」で色・太さを変えられます)`);
  return made;
}

let lastBorder = { width: 6, mode: 'fill', holes: false, perItem: false, color: null };

export async function borderDialog() {
  const items = selectedItems();
  if (!items.length) { toast('縁取りする図形を矢印ツールで選んでください'); return; }
  const o = lastBorder;
  const color = o.color || toHex(state.primary);
  const body = document.createElement('div');
  body.className = 'form';
  body.innerHTML = `
    <label>太さ <input type="number" id="bd-w" min="1" max="200" value="${o.width}"> px</label>
    <label>色 <input type="color" id="bd-c" value="${color}"></label>
    <div class="seg">
      <label><input type="radio" name="bd-mode" value="fill"${o.mode === 'fill' ? ' checked' : ''}>フチ(塗りの図形)</label>
      <label><input type="radio" name="bd-mode" value="line"${o.mode === 'line' ? ' checked' : ''}>線(あとで線幅で調整)</label>
    </div>
    <label class="check"><input type="checkbox" id="bd-holes"${o.holes ? ' checked' : ''}>内側のすき間(穴)にも縁を付ける</label>
    <label class="check"><input type="checkbox" id="bd-each"${o.perItem ? ' checked' : ''}>選んだ図形ごとに別々に作る(リグで別々に動くパーツ向け)</label>
    <p class="note">選択中の ${items.length} 個の図形全体の形をなぞって、1本の外周パスを作り、選んだ図形のすぐ後ろに置きます。<br>
    「線」を選ぶと、形のふちに沿った線(線幅 = 太さ×2、内側の半分は絵の後ろに隠れる)になります。</p>`;
  const { value } = await openModal({
    title: '縁取りを作成',
    body,
    width: 440,
    buttons: [{ label: 'キャンセル', value: null }, { label: '作成', value: 'ok', primary: true }],
  });
  if (value !== 'ok') return;
  const q = (s) => body.querySelector(s);
  lastBorder = {
    width: clamp(Number(q('#bd-w').value) || 6, 1, 200),
    color: q('#bd-c').value,
    mode: q('input[name="bd-mode"]:checked').value,
    holes: q('#bd-holes').checked,
    perItem: q('#bd-each').checked,
  };
  makeBorder({ ...lastBorder, color: toHex8({ ...parseHex(lastBorder.color), a: 255 }) });
}
