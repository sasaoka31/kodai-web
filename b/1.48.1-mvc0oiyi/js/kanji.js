// 漢字の自動作成(フォント作成モード)
//   漢字 = 「骨組み」(画の中心線・画の種類・書き順)+「筆の癖」(入り・止め・はね・払い・線の太さ)と考える。
//   骨組みは KanjiVG(CC BY-SA 3.0。lib/kanjivg.js が初回ダウンロード)。筆の癖はユーザーが描く「筆の部品」:
//     横画・縦画・はね・左払い・右払い・点 の6つ(+ 画の種類ごとの上書き)。
//   かな・英数字(アルファベット・数字・記号)も KanjiVG に骨組みがある(画の種類は付いていない)。
//     それぞれ専用の部品「かな」「英数字」1本を、曲がった画にもそのまま沿わせる。英数字は字ごとに幅を変え、ベースラインに合わせる。
//   部品は横向きに描いた1本の画(左 = 書き始め、右 = 終わり、上下の中心 = 画の中心線)。これを骨組みの中心線に沿って
//   曲げて貼る(イラレの「アートブラシ」と同じ考え方)。入りと終わりの部分は長さを保ち、間だけ伸ばす。
//   折れ(㇕ など)は角で区間に分け、区間ごとに横画/縦画の部品を貼って角で重ねる。はねの画は最後の短い区間を「はね」で描く。
//   自動で作った字は保存しない(骨組み + 部品から毎回作る)。部品を直すと全部の字がすぐ変わる。
//   「手で直す」でその字だけ図形にすると、あとは普通の字形として扱う
import { traceDrawing, simplifyLoop, loopToNodes, depths, cellRings } from './outline.js';
import { drawShape, visualBounds } from './vector.js';
import { fitLoop } from './fitcurve.js';
import { drawText } from './text.js';

export const BRUSH_W = 1000, BRUSH_H = 400, BRUSH_CY = 200; // 部品を描くフレームの大きさと中心線
const KVG = 109; // KanjiVG の座標(109×109)
const STEP = 4; // 中心線の点の間隔(フォントの単位)

// 筆の部品。zones = 入り・終わりの長さを保つ(横画・縦画)。それ以外は画の長さに合わせて全体を伸ばす
export const BRUSHES = [
  { key: 'yoko', label: '横画', hint: '横の画(入り〜止め)', head: 60, tail: 60 },
  { key: 'tate', label: '縦画', hint: '縦の画(入り〜止め)。部品の下側が画の左側になる', head: 60, tail: 60 },
  { key: 'hane', label: 'はね', hint: 'はねの部分(付け根〜先)。はね上げ(㇀)にも使う', head: 0, tail: 0 },
  { key: 'lharai', label: '左払い', hint: '左払い(書き始め〜先)', head: 0, tail: 0 },
  { key: 'rharai', label: '右払い', hint: '右払い(書き始め〜先)', head: 0, tail: 0 },
  { key: 'ten', label: '点', hint: '点(書き始め〜終わり)', head: 0, tail: 0 },
  { key: 'kana', label: 'かな', hint: 'ひらがな・カタカナの画(入り〜止め)。曲がった画にもこの1本を沿わせる', head: 60, tail: 60 },
  { key: 'latin', label: '英数字', hint: 'アルファベット・数字・記号の画(入り〜止め)。曲がった画にもこの1本を沿わせる', head: 60, tail: 60 },
];
// かな・英数字の部品は、作っていなければ(前の版のファイル)横画・縦画で描く
const CLASS_BRUSH = new Set(['kana', 'latin']);

// 字の種類: 'latin'(アルファベット・数字・記号)/ 'kana'(ひらがな・カタカナ)/ ''(漢字など)
export function charClass(ch) {
  const u = ch.codePointAt(0);
  if (u < 0x80) return 'latin';
  if ((u >= 0x3041 && u <= 0x309f) || (u >= 0x30a1 && u <= 0x30ff)) return 'kana';
  return '';
}

// 画の種類(KanjiVG の記号)。上書き用の一覧
export const STROKE_TYPES = [
  ['㇐', '横(二・三)'], ['㇑', '縦(十・中)'], ['㇒', '左払い(人・大)'], ['㇏', '右払い(人・大)'], ['㇔', '点(小・心)'], ['㇀', 'はね上げ(氵の3画目)'],
  ['㇕', '横→縦(口の右上)'], ['㇆', '横→縦→はね(月・門)'], ['㇚', '縦→はね(亅・小)'], ['㇟', '縦→曲がり→はね(乚・元)'], ['㇄', '縦→横(L・山)'],
  ['㇗', '縦→横(口の左下)'], ['㇇', '横→左払い(又・今)'], ['㇖', '横→はね(冖・子)'], ['㇂', '戈の長い画(戈・我)'], ['㇃', '心の長い画(心)'],
  ['㇁', '犭の曲がり(犭・豕)'], ['㇓', '縦→左払い(月の左)'], ['㇜', '左払い→点(女・く)'], ['㇛', '女の左(女)'], ['㇙', '縦→はね上げ(衣・食)'],
  ['㇉', '弓の下(弓)'], ['㇈', '九・風(九・几)'], ['㇋', '及・廴(及・建)'],
];
const TYPE_BRUSH = { '㇐': 'yoko', '㇑': 'tate', '㇒': 'lharai', '㇏': 'rharai', '㇔': 'ten', '㇀': 'hane', '㇇': 'lharai', '㇓': 'lharai' };
export const typeBaseBrush = (t) => TYPE_BRUSH[t] || 'yoko';

const END = { hane: '㇚㇆㇟㇁㇃㇉㇈㇖㇡㇂㇅', lharai: '㇒㇓㇇㇋', rharai: '㇏', dot: '㇔', rise: '㇀' };
function strokeEnd(base) {
  for (const [k, s] of Object.entries(END)) if (base && s.includes(base)) return k;
  return 'tome';
}

// ---- 最初から入っている部品(ゴシック風)----

const poly = (pts) => ({ type: 'path', closed: true, nodes: pts.map(([x, y]) => ({ x, y })), fill: '#000000ff', stroke: null, strokeWidth: 0 });
export function defaultBrushShapes(key) {
  const c = BRUSH_CY;
  switch (key) {
    case 'yoko': return [poly([[100, c - 36], [900, c - 36], [900, c + 36], [100, c + 36]])];
    case 'tate': return [poly([[100, c - 42], [900, c - 42], [900, c + 42], [100, c + 42]])];
    case 'hane': return [poly([[100, c - 40], [900, c - 8], [900, c + 8], [100, c + 40]])];
    case 'lharai': return [poly([[100, c - 40], [550, c - 38], [900, c - 6], [900, c + 6], [550, c + 38], [100, c + 40]])];
    case 'rharai': return [poly([[100, c - 22], [650, c - 44], [900, c - 30], [900, c + 30], [650, c + 44], [100, c + 22]])];
    case 'ten': return [poly([[100, c - 38], [900, c - 44], [900, c + 44], [100, c + 38]])];
    case 'kana': return [poly([[100, c - 38], [900, c - 38], [900, c + 38], [100, c + 38]])];
    case 'latin': return [poly([[100, c - 38], [900, c - 38], [900, c + 38], [100, c + 38]])];
    default: return [poly([[100, c - 36], [900, c - 36], [900, c + 36], [100, c + 36]])];
  }
}

// ---- 骨組みのデータ ----

let skel = null; // { 文字: [[種類, d], …] }
const parsed = new Map(); // 文字 → [{ base, end, pts(109 の座標) }]

export const skeletonReady = () => !!skel;
export const hasSkeleton = (ch) => !!skel?.[ch];
export const skeletonChars = () => (skel ? Object.keys(skel) : []);

// download = true ならまだないときにダウンロードする。読めたら true
export async function loadSkeleton({ download = false, onProgress } = {}) {
  if (skel) return true;
  const n = window.native?.kanjivg;
  if (!n) return false;
  const st = await n.status();
  if (!st.ready) {
    if (!download) return false;
    const off = n.onProgress((p) => onProgress?.(p));
    try { await n.ensure(); } finally { off(); }
  }
  skel = JSON.parse(await n.read()).chars;
  return true;
}
export async function skeletonStatus() {
  if (skel) return { ready: true, loaded: true };
  const n = window.native?.kanjivg;
  if (!n) return { ready: false, loaded: false, unsupported: true };
  return { ...(await n.status()), loaded: false };
}
// 動作確認用: データを直接入れる
export function setSkeleton(data) { skel = data; parsed.clear(); xRanges.clear(); }

// SVG のパス(M m L l H h V v C c S s)→ 点列
function parseD(d) {
  const tok = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) || [];
  const pts = [];
  let i = 0, cmd = '', x = 0, y = 0, lc = null;
  const num = () => parseFloat(tok[i++]);
  const cubic = (x1, y1, x2, y2, x3, y3) => {
    const len = Math.hypot(x1 - x, y1 - y) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2);
    const n = Math.max(4, Math.ceil(len / 0.5));
    for (let k = 1; k <= n; k++) {
      const t = k / n, u = 1 - t;
      pts.push({ x: u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, y: u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3 });
    }
    lc = { x: x2, y: y2 };
    x = x3; y = y3;
  };
  while (i < tok.length) {
    if (/[a-zA-Z]/.test(tok[i])) cmd = tok[i++];
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M': x = ox + num(); y = oy + num(); pts.push({ x, y }); lc = null; cmd = rel ? 'l' : 'L'; break;
      case 'L': x = ox + num(); y = oy + num(); pts.push({ x, y }); lc = null; break;
      case 'H': x = ox + num(); pts.push({ x, y }); lc = null; break;
      case 'V': y = oy + num(); pts.push({ x, y }); lc = null; break;
      case 'C': { const a = ox + num(), b = oy + num(), c = ox + num(), e = oy + num(), f = ox + num(), g = oy + num(); cubic(a, b, c, e, f, g); break; }
      case 'S': {
        const a = lc ? 2 * x - lc.x : x, b = lc ? 2 * y - lc.y : y;
        const c = ox + num(), e = oy + num(), f = ox + num(), g = oy + num();
        cubic(a, b, c, e, f, g);
        break;
      }
      case 'Z': lc = null; break;
      default: i++;
    }
  }
  return pts;
}

function strokesOf(ch) {
  if (parsed.has(ch)) return parsed.get(ch);
  const cls = charClass(ch);
  const list = (skel?.[ch] || []).map(([type, d]) => {
    const base = (type || '').split('/')[0].charAt(0);
    return { base, end: strokeEnd(base), cls, pts: parseD(d) };
  }).filter((s) => s.pts.length >= 2);
  parsed.set(ch, list);
  return list;
}

// 骨組みの左右の端(109 の座標)。英数字は字ごとに幅が違うので、これで字の幅と置く位置を決める
const xRanges = new Map();
function xRange(ch) {
  if (xRanges.has(ch)) return xRanges.get(ch);
  let x0 = Infinity, x1 = -Infinity;
  for (const st of strokesOf(ch)) for (const p of st.pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); }
  const r = x0 <= x1 ? { x0, x1 } : null;
  xRanges.set(ch, r);
  return r;
}

// ---- 線(点列)の道具 ----

// 等間隔に打ち直す
function resample(pts, step) {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-9) continue;
    let t = step - carry;
    while (t <= len) {
      out.push({ x: a.x + ((b.x - a.x) * t) / len, y: a.y + ((b.y - a.y) * t) / len });
      t += step;
    }
    carry = len - (t - step);
  }
  const last = pts[pts.length - 1], p = out[out.length - 1];
  if (Math.hypot(last.x - p.x, last.y - p.y) > step * 0.3) out.push({ ...last });
  else out[out.length - 1] = { ...last };
  return out;
}

// 中心線(点列)→ 長さ・向きを引ける形
function makeLine(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const n = pts.length;
  // 点ごとの向き(前後の点で平均。少しなめらかにする)
  const tan = pts.map((_, i) => {
    const a = pts[Math.max(0, i - 2)], b = pts[Math.min(n - 1, i + 2)];
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    return { x: dx / l, y: dy / l };
  });
  // 端からはみ出す向き(角の近くは丸みで曲がっているので、端から少し離れた点までのまっすぐな向き)
  const dir = (p, q) => { const dx = q.x - p.x, dy = q.y - p.y, l = Math.hypot(dx, dy) || 1; return { x: dx / l, y: dy / l }; };
  const m = Math.min(n - 1, 6);
  return { pts, cum, tan, len: cum[n - 1], e0: dir(pts[m], pts[0]), e1: dir(pts[n - 1 - m], pts[n - 1]) };
}

function lineAt(L, s) {
  const { pts, cum, tan } = L, n = pts.length;
  if (s <= 0) { const t = L.e0; return { x: pts[0].x - t.x * s, y: pts[0].y - t.y * s, tx: -t.x, ty: -t.y }; }
  if (s >= L.len) { const t = L.e1, e = s - L.len; return { x: pts[n - 1].x + t.x * e, y: pts[n - 1].y + t.y * e, tx: t.x, ty: t.y }; }
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
  const f = (s - cum[lo]) / (cum[hi] - cum[lo] || 1);
  const a = pts[lo], b = pts[hi], ta = tan[lo], tb = tan[hi];
  let tx = ta.x + (tb.x - ta.x) * f, ty = ta.y + (tb.y - ta.y) * f;
  const tl = Math.hypot(tx, ty) || 1;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, tx: tx / tl, ty: ty / tl };
}

// 角(曲がりの大きい所)の番号。w = 前後に見る点の数
function corners(pts, w, minDeg, endGap) {
  const n = pts.length, lim = Math.cos((minDeg * Math.PI) / 180);
  const cand = [];
  for (let i = endGap; i < n - endGap; i++) {
    const a = pts[Math.max(0, i - w)], p = pts[i], b = pts[Math.min(n - 1, i + w)];
    const ux = p.x - a.x, uy = p.y - a.y, vx = b.x - p.x, vy = b.y - p.y;
    const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    if (lu < 1e-6 || lv < 1e-6) continue;
    const c = (ux * vx + uy * vy) / (lu * lv);
    if (c < lim) cand.push({ i, c });
  }
  // 近い候補は一番曲がっている所だけ
  const out = [];
  for (const k of cand) {
    const last = out[out.length - 1];
    if (last && k.i - last.i <= w) { if (k.c < last.c) out[out.length - 1] = k; } else out.push(k);
  }
  return out.map((k) => k.i);
}

// ---- 部品の形 ----

function frameShapes(doc, i) {
  const out = [];
  for (const l of doc.layers) {
    if (l.type !== 'vector' || !l.visible) continue;
    const cel = l.cels[i];
    if (cel) out.push(...cel.shapes);
  }
  return out;
}

function drawInk(c, s) {
  if (s.type === 'group') { s.children.forEach((k) => drawInk(c, k)); return; }
  if (s.type === 'text') { drawText(c, s, { fill: s.fill ? '#000' : null, stroke: s.stroke ? '#000' : null }); return; }
  drawShape(c, { ...s, fill: s.fill ? '#000' : null, stroke: s.stroke ? '#000' : null });
}

const area = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; } return a / 2; };

// 図形 → 部品の輪郭。外側の輪は area < 0(フォントの座標で反時計回り)、穴は area > 0 にそろえる
const geomCache = new Map(); // key → geom
function geomOf(shapes, key, head, tail) {
  const ck = `${key}|${head}|${tail}`;
  if (geomCache.has(ck)) return geomCache.get(ck);
  let geom = null;
  if (shapes.length) {
    let b = null;
    for (const s of shapes) {
      const v = visualBounds(s);
      b = b ? { x0: Math.min(b.x0, v.x0), y0: Math.min(b.y0, v.y0), x1: Math.max(b.x1, v.x1), y1: Math.max(b.y1, v.y1) } : v;
    }
    b = { x0: b.x0 - 2, y0: b.y0 - 2, x1: b.x1 + 2, y1: b.y1 + 2 };
    const { loops, scale } = traceDrawing(b, (c) => shapes.forEach((s) => drawInk(c, s)), 1.5);
    let rings = loops.filter((l) => Math.abs(area(l)) * scale * scale >= 4).map((l) => simplifyLoop(l, 0.35)).filter((l) => l.length >= 3);
    const dep = depths(rings);
    rings = rings.map((r, k) => ((area(r) < 0) === (dep[k] % 2 === 0) ? r : r.slice().reverse()));
    if (rings.length) {
      let x0 = Infinity, x1 = -Infinity, half = 0;
      for (const r of rings) for (const p of r) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); }
      const hb = x0 + head, tb = x1 - tail;
      for (const r of rings) for (const p of r) if (p.x >= hb - 1 && p.x <= tb + 1) half = Math.max(half, Math.abs(p.y - BRUSH_CY));
      if (!half) for (const r of rings) for (const p of r) half = Math.max(half, Math.abs(p.y - BRUSH_CY));
      geom = { rings, x0, x1, head: Math.max(0, head), tail: Math.max(0, tail), half };
    }
  }
  if (geomCache.size > 200) geomCache.clear();
  geomCache.set(ck, geom);
  return geom;
}

// 部品のフレーム(frames[i].brush = { key, head, tail })の場所
let idx = { frames: null, len: -1, map: new Map() };
export function brushFrames(doc) {
  const ok = idx.frames === doc.frames && idx.len === doc.frames.length && [...idx.map].every(([k, i]) => doc.frames[i]?.brush?.key === k);
  if (!ok) {
    const map = new Map();
    doc.frames.forEach((f, i) => { if (f.brush) map.set(f.brush.key, i); });
    idx = { frames: doc.frames, len: doc.frames.length, map };
  }
  return idx.map;
}

// 今の部品一式。key は部品や設定が変わると変わる
function brushSet(doc) {
  const map = brushFrames(doc);
  const k = doc.font.kanji || {};
  const parts = [`${k.weight ?? 1}`, `${k.size ?? 1.1}`];
  const get = {};
  for (const [key, i] of map) {
    const fr = doc.frames[i].brush;
    const shapes = frameShapes(doc, i);
    const vers = doc.layers.map((l) => (l.cels[i] ? `${l.cels[i].version}.${l.cels[i].shapes?.length}` : '-')).join(',');
    const gk = `${doc.layers.map((l) => l.id).join()}#${i}#${vers}`;
    parts.push(`${key}:${gk}:${fr.head}:${fr.tail}`);
    get[key] = () => geomOf(shapes, gk, fr.head ?? 0, fr.tail ?? 0);
  }
  const own = new Set([...map.keys()].filter((k) => CLASS_BRUSH.has(k)));
  // 画像の字から筆を取り出したフォントは、英数字(かな)の部品だけを持つ。そのときは、かな(英数字)も同じ筆で描き、
  // 漢字の部品(横画・縦画…)を1つも作っていなければ、漢字も同じ筆で描く(とめ・はね・払いの区別はなし)
  const anyOwn = own.has('kana') ? 'kana' : own.has('latin') ? 'latin' : null;
  const kanjiOwn = BRUSHES.some((b) => !CLASS_BRUSH.has(b.key) && map.has(b.key)) ? null : anyOwn;
  for (const b of BRUSHES) {
    if (!get[b.key]) get[b.key] = () => geomOf(defaultBrushShapes(b.key), `default-${b.key}`, b.head, b.tail);
  }
  return { key: parts.join('|'), get, own, anyOwn, kanjiOwn };
}

// ---- 部品を中心線に沿って貼る ----

// 縦の線 x = c で切る(dir = 1 なら c より右を残す、-1 なら左)
function clipX(rings, c, dir) {
  const inside = (p) => (p.x - c) * dir >= 0;
  const out = [];
  for (const r of rings) {
    const res = [];
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      const ia = inside(a), ib = inside(b);
      if (ia) res.push(a);
      if (ia !== ib) { const t = (c - a.x) / (b.x - a.x); res.push({ x: c, y: a.y + (b.y - a.y) * t }); }
    }
    if (res.length >= 3) out.push(res);
  }
  return out;
}

// 部品 B を線 L に貼る。head / tail = 入り・終わりを描くか(描かない所は角で重なるように少しはみ出す)
// ovIn / ovOut = はみ出す量(部品の太さの半分に対する割合。角は 1、なめらかにつながる所は少しだけ)
function mapBrush(B, L, head, tail, weight, ovIn = 1, ovOut = 1) {
  const ov = B.half * weight;
  let rings = B.rings;
  const xs = [], ss = [];
  const zoned = B.head + B.tail > 0 && B.x1 - B.x0 > B.head + B.tail;
  if (!zoned) { xs.push(B.x0, B.x1); ss.push(0, L.len); }
  else {
    const f = Math.min(1, (0.8 * L.len) / (B.head + B.tail));
    const H = B.head * f, T = B.tail * f;
    const xb0 = B.x0 + B.head, xb1 = B.x1 - B.tail;
    if (head) { xs.push(B.x0, xb0); ss.push(0, H); } else { rings = clipX(rings, xb0, 1); xs.push(xb0); ss.push(-ov * ovIn); }
    if (tail) { xs.push(xb1, B.x1); ss.push(L.len - T, L.len); } else { rings = clipX(rings, xb1, -1); xs.push(xb1); ss.push(L.len + ov * ovOut); }
  }
  const n = xs.length;
  const mapS = (x) => {
    let k = 0;
    while (k < n - 2 && x > xs[k + 1]) k++;
    const dx = xs[k + 1] - xs[k];
    return ss[k] + (dx ? ((x - xs[k]) * (ss[k + 1] - ss[k])) / dx : 0);
  };
  const out = [];
  for (const r of rings) {
    const res = [];
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      const sa = mapS(a.x), sb = mapS(b.x);
      const m = Math.max(1, Math.ceil(Math.abs(sb - sa) / STEP));
      for (let j = 0; j < m; j++) {
        const t = j / m, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
        const p = lineAt(L, mapS(x)), off = (y - BRUSH_CY) * weight;
        res.push({ x: p.x - p.ty * off, y: p.y + p.tx * off });
      }
    }
    out.push(res);
  }
  return out;
}

// 1画 → 貼った部品の一覧 [{ brush, rings }]
function strokePieces(st, T, set, kanji) {
  const weight = kanji.weight ?? 1;
  const pts = resample(st.pts.map(T.f), STEP);
  if (pts.length < 2) return [];
  const override = set.get[`type:${st.base}`] && st.base ? `type:${st.base}` : null;
  // かな・英数字: 専用の部品があれば、向きに関係なく全部の区間をそれで描く
  const own = override ? null : set.own.has(st.cls) ? st.cls : st.cls ? (st.cls === 'kana' ? (set.own.has('latin') ? 'latin' : null) : (set.own.has('kana') ? 'kana' : null)) : set.kanjiOwn;
  const whole = (key) => {
    const B = set.get[override || own || key]();
    return B ? [{ brush: override || own || key, rings: mapBrush(B, makeLine(pts), true, true, weight) }] : [];
  };
  if (st.end === 'dot') return whole('ten');
  if (st.end === 'rise') return whole('hane');
  // 角で区間に分ける(KanjiVG の角は少し丸いので、前後 5(109 の座標)ずつ見て 60°以上曲がる所)。両端のすぐ近くは無視
  const L0 = makeLine(pts);
  const minSeg = 2.5 * T.k;
  let cuts = corners(pts, Math.max(2, Math.round((5 * T.k) / STEP)), 60, 3)
    .filter((c) => L0.cum[c] >= minSeg && L0.len - L0.cum[c] >= minSeg * 0.6)
    .map((i) => ({ i, corner: true }));
  let end = st.end;
  const lastCut = cuts[cuts.length - 1];
  let hook = end === 'hane' && !!lastCut && L0.len - L0.cum[lastCut.i] <= 0.4 * L0.len;
  // 乚・九 のはねは角でなく、なめらかに上へ曲がって終わる → 最後の上向きの部分をはねにする
  if (end === 'hane' && !hook) {
    let i = pts.length - 1;
    while (i > 0 && L0.tan[i].y < -0.4) i--;
    const up = L0.len - L0.cum[i];
    if (up >= minSeg && up <= 0.4 * L0.len && i > 0) { cuts.push({ i, corner: false }); hook = true; }
  }
  if (end === 'hane' && !hook) end = 'tome';
  const bounds = [{ i: 0 }, ...cuts, { i: pts.length - 1 }];
  const out = [];
  for (let j = 0; j < bounds.length - 1; j++) {
    const seg = pts.slice(bounds[j].i, bounds[j + 1].i + 1);
    if (seg.length < 2) continue;
    const last = j === bounds.length - 2;
    const isHook = hook && last;
    let key;
    if (own) key = own;
    else if (isHook) key = 'hane';
    else if (override) key = override;
    else if (last && (end === 'lharai' || end === 'rharai')) key = end;
    else {
      const a = seg[0], b = seg[seg.length - 1];
      key = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 'yoko' : 'tate';
    }
    const B = set.get[key]();
    if (!B) continue;
    const ovIn = bounds[j].corner === false ? 0.15 : 1, ovOut = bounds[j + 1].corner === false ? 0.15 : 1;
    out.push({ brush: key, rings: mapBrush(B, makeLine(seg), j === 0, last && !isHook, weight, ovIn, ovOut) });
  }
  return out;
}

// KanjiVG の座標 → 字形の座標(アートボードの幅 = 字の幅)。上下は日本語フォントの字面の枠
// (ベースラインの上 0.88・下 0.12)の中央にそろえる
function placer(advance, upm, size, ascender) {
  const k = (upm / KVG) * size, cy = ascender - upm * 0.38;
  return { k, f: (p) => ({ x: (p.x - KVG / 2) * k + advance / 2, y: (p.y - KVG / 2) * k + cy }) };
}

// 英数字: KanjiVG の英数字はベースラインが y = 93、大文字の高さが 79(小文字 58・下に出る分 16)。
// 大文字の高さを「大文字の高さの線」に、ベースラインをベースラインに合わせ、左右は字の幅の中央に置く
const LATIN_BASE = 93, LATIN_CAP = 79;
const latinScale = (font, size) => ((font.capHeight || font.upm * 0.7) / LATIN_CAP) * (size / 1.1);
function latinPlacer(advance, font, size, ch) {
  const k = latinScale(font, size), r = xRange(ch) || { x0: 0, x1: KVG };
  const cx = (r.x0 + r.x1) / 2;
  return { k, f: (p) => ({ x: (p.x - cx) * k + advance / 2, y: (p.y - LATIN_BASE) * k + font.ascender }) };
}
// 英数字を足すときの字の幅(骨組みの幅 + 左右のすき間)。骨組みがなければ null
export function latinAdvance(font, ch) {
  if (charClass(ch) !== 'latin') return null;
  const r = xRange(ch);
  if (!r) return null;
  const w = (r.x1 - r.x0) * latinScale(font, 1.1) + font.upm * 0.2;
  if (font.kind !== 'dot') return Math.round(w);
  const cs = font.upm / font.grid;
  return Math.max(2, Math.round(w / cs)) * cs;
}

// ---- 字を作る ----

const glyphCache = new Map(); // 文字 → { key, value }
function cached(kind, doc, ch, advance, make) {
  const set = brushSet(doc);
  const key = `${kind}|${advance}|${doc.font.kind}|${doc.font.grid}|${set.key}`;
  const c = glyphCache.get(`${kind}:${ch}`);
  if (c && c.key === key) return c.value;
  const value = make(set);
  if (glyphCache.size > 20000) glyphCache.clear();
  glyphCache.set(`${kind}:${ch}`, { key, value });
  return value;
}

// 画ごとの輪の一覧 [[輪, …], …](ワールド座標)
export function kanjiStrokes(doc, ch, advance) {
  return cached('v', doc, ch, advance, (set) => {
    const kanji = doc.font.kanji || {};
    const size = kanji.size ?? 1.1;
    const T = charClass(ch) === 'latin' ? latinPlacer(advance, doc.font, size, ch) : placer(advance, doc.font.upm, size, doc.font.ascender);
    return strokesOf(ch).map((st) => strokePieces(st, T, set, kanji));
  });
}

// 今の部品一式を表す文字列(サムネイルのキャッシュ用)
export const kanjiKey = (doc) => brushSet(doc).key;

// ドットのフォント: マス目の塗り { mask, w, h, cs }
export function kanjiDots(doc, ch, advance) {
  return cached('d', doc, ch, advance, () => {
    const f = doc.font, cs = f.upm / f.grid;
    const w = Math.max(1, Math.round(advance / cs)), h = f.grid;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.scale(1 / cs, 1 / cs);
    x.fillStyle = '#000';
    const p = new Path2D();
    for (const pieces of kanjiStrokes(doc, ch, advance)) for (const pc of pieces) for (const r of pc.rings) {
      p.moveTo(r[0].x, r[0].y);
      for (let i = 1; i < r.length; i++) p.lineTo(r[i].x, r[i].y);
      p.closePath();
    }
    x.fill(p, 'nonzero');
    const d = x.getImageData(0, 0, w, h).data;
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < mask.length; i++) mask[i] = d[i * 4 + 3] >= 128 ? 1 : 0;
    return { mask, w, h, cs };
  });
}

const ringShape = (rings, extra = {}) => ({
  type: 'path', closed: true, nodes: rings[0], ...(rings.length > 1 ? { subpaths: rings.slice(1).map((n) => ({ nodes: n, closed: true })) } : {}),
  fill: '#000000ff', stroke: null, strokeWidth: 0, ...extra,
});

// 表示用の図形(画面・一覧・試し書き)
export function kanjiShapes(doc, ch, advance) {
  if (doc.font.kind === 'dot') {
    const { mask, w, h, cs } = kanjiDots(doc, ch, advance);
    const out = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) out.push({ type: 'rect', dot: true, x: x * cs, y: y * cs, w: cs, h: cs, fill: '#000000ff', stroke: null, strokeWidth: 0 });
    return out;
  }
  return cached('s', doc, ch, advance, () => kanjiStrokes(doc, ch, advance).flat().filter((pc) => pc.rings.length).map((pc) => ringShape(pc.rings)));
}

// 「手で直す」用: 画ごとのグループ(節点を間引いてベジェにする)
export function kanjiEditableShapes(doc, ch, advance) {
  if (doc.font.kind === 'dot') return kanjiShapes(doc, ch, advance).map((s) => ({ ...s }));
  return kanjiStrokes(doc, ch, advance).map((pieces) => {
    const children = pieces.filter((pc) => pc.rings.length)
      .map((pc) => ringShape(pc.rings.map((r) => fitLoop(r, 1.2)).filter((n) => n.length >= 2)))
      .filter((s) => s.nodes?.length >= 2);
    return children.length === 1 ? children[0] : { type: 'group', children };
  }).filter((s) => s.type !== 'group' || s.children.length);
}

// 書き出し用の輪郭(フォントの座標: y は上が +、ベースライン = 0)。外側は反時計回り
export function kanjiContours(doc, ch, advance) {
  const asc = doc.font.ascender;
  if (doc.font.kind === 'dot') {
    const { mask, w, h, cs } = kanjiDots(doc, ch, advance);
    const rings = cellRings(mask, w, h).map((r) => r.map(([x, y]) => ({ x: x * cs, y: asc - y * cs })));
    const dep = depths(rings);
    return rings.map((r, k) => ((area(r) > 0) === (dep[k] % 2 === 0) ? r : r.slice().reverse()).map((p) => ({ x: p.x, y: p.y })));
  }
  const out = [];
  for (const pieces of kanjiStrokes(doc, ch, advance)) for (const pc of pieces) for (const r of pc.rings) {
    const pts = simplifyLoop(r, 0.8).map((p) => ({ x: p.x, y: asc - p.y }));
    if (pts.length >= 3) out.push(loopToNodes(pts));
  }
  return out;
}

// ---- 字の組(JIS 第1水準・第2水準)----

function jisRows(r0, r1) {
  const dec = new TextDecoder('shift_jis');
  let s = '';
  for (let r = r0; r <= r1; r++) {
    for (let c = 1; c <= 94; c++) {
      const s1 = ((r + 1) >> 1) + (r <= 62 ? 0x80 : 0xc0);
      const s2 = r % 2 ? c + (c <= 63 ? 0x3f : 0x40) : c + 0x9e;
      const ch = dec.decode(new Uint8Array([s1, s2]));
      if (ch.length === 1 && ch !== '�') s += ch;
    }
  }
  return s;
}
const HIRA = 'ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんゔゝゞ';
const KATA = 'ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶー・ヽヾ';
export const KANJI_SETS = {
  latin: ['アルファベット・数字・記号', () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!?,.:;'],
  hira: ['ひらがな', () => HIRA],
  kata: ['カタカナ', () => KATA],
  jis1: ['漢字 JIS 第1水準', () => jisRows(16, 47)],
  jis2: ['漢字 JIS 第1・第2水準', () => jisRows(16, 84)],
  kana: ['ひらがな・カタカナ(両方)', () => 'ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴ'],
};
