// 定規・ガイド・ものさし(1.47.0。イラレと同じ考え方)
//   定規: キャンバスの上と左の目盛り(px。ワールド座標)。表示 → 定規(Ctrl+R)。このPCに覚える
//   ガイド: 定規からキャンバスへドラッグで置く(上の定規 = 横のガイド、左の定規 = 縦のガイド)。矢印ツールでガイドをドラッグして動かす、
//     定規へ戻すと消える。図形を矢印ツールで動かすと、枠の端・真ん中がガイドに吸い付く。doc.guides = { v: [x…], h: [y…] }(ファイルに入る)
//   ものさし(M): 2点をドラッグして、距離・角度・幅・高さを測る(Shift で 45°ずつ)。測った線は、ほかのツールにするまで残る
import { state, on, emit, requestRender, toast } from './state.js';

const KEY = 'pixelrig.guides';
export const guideOpts = { rulers: true, show: true, lock: false, snap: true, smart: true };
try { Object.assign(guideOpts, JSON.parse(localStorage.getItem(KEY)) || {}); } catch { /* 保存なし */ }
const saveOpts = () => { try { localStorage.setItem(KEY, JSON.stringify(guideOpts)); } catch { /* 覚えられなくても動く */ } };

export const RULER = 18; // 定規の太さ(画面 px)
const GUIDE_COLOR = '#22d3ee';
const docGuides = (doc = state.doc) => (doc.guides ||= { v: [], h: [] });
export const hasGuides = () => !!state.doc && (docGuides().v.length + docGuides().h.length) > 0;

// ---- 表示の切り替え ----
export function toggleRulers() { guideOpts.rulers = !guideOpts.rulers; saveOpts(); applyRulers(); toast(guideOpts.rulers ? '定規を表示' : '定規を隠す'); }
export function toggleGuides() { guideOpts.show = !guideOpts.show; saveOpts(); requestRender(); toast(guideOpts.show ? 'ガイドを表示' : 'ガイドを隠す'); }
export function toggleGuideLock() { guideOpts.lock = !guideOpts.lock; saveOpts(); toast(guideOpts.lock ? 'ガイドをロック(動かせない)' : 'ガイドのロックを外す'); }
export function toggleSmart() { guideOpts.smart = !guideOpts.smart; saveOpts(); toast(guideOpts.smart ? 'スマートガイド: オン(ほかの図形・アートボードの端と真ん中に吸い付く)' : 'スマートガイド: オフ'); }
export function toggleSnap() { guideOpts.snap = !guideOpts.snap; saveOpts(); toast(guideOpts.snap ? 'ガイドにスナップ: オン' : 'ガイドにスナップ: オフ'); }
export function clearGuides() {
  const g = docGuides();
  if (!g.v.length && !g.h.length) { toast('ガイドはありません'); return; }
  pushGuides('ガイドを消す', { v: [], h: [] });
}
function applyRulers() {
  document.body.classList.toggle('rulers-on', guideOpts.rulers);
  requestRender();
}

// ガイドを変えて、元に戻せるように履歴へ
function pushGuides(label, next) {
  const doc = state.doc, before = structuredClone(docGuides(doc)), after = structuredClone(next);
  const set = (g) => { doc.guides = structuredClone(g); requestRender(); };
  set(after);
  state.history.push({ label, undo: () => set(before), redo: () => set(after) });
}

// ---- 描く(viewport.js の render から) ----
export function drawGuides(ctx, view) {
  if (!guideOpts.show || !state.doc) return;
  const g = docGuides(), d = view.dpr;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0); // デバイスの画素で(線をくっきり)
  ctx.lineWidth = 1;
  ctx.strokeStyle = GUIDE_COLOR;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  for (const x of g.v) { const sx = Math.round((view.ox + x * view.zoom) * d) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, view.h * d); }
  for (const y of g.h) { const sy = Math.round((view.oy + y * view.zoom) * d) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(view.w * d, sy); }
  ctx.stroke();
  // 定規から引き出している最中のガイド
  if (pull?.pos !== undefined && pull.pos !== null) {
    ctx.setLineDash([4 * d, 3 * d]);
    ctx.beginPath();
    if (pull.axis === 'v') { const sx = Math.round((view.ox + pull.pos * view.zoom) * d) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, view.h * d); }
    else { const sy = Math.round((view.oy + pull.pos * view.zoom) * d) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(view.w * d, sy); }
    ctx.stroke();
  }
  ctx.restore();
}

// 定規の目盛り(1・2・5 の倍数で、大きい目盛りの間が 60px 以上になる刻み)
function step(zoom) {
  for (const s of [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000]) if (s * zoom >= 60) return s;
  return 20000;
}
export function drawRulers(view) {
  if (!guideOpts.rulers) return;
  for (const axis of ['h', 'v']) {
    const c = document.getElementById(axis === 'h' ? 'ruler-h' : 'ruler-v');
    if (!c) continue;
    // 定規の絵は、キャンバスの左上から RULER だけずれた所から始まる(角の四角の分)
    const d = view.dpr, len = (axis === 'h' ? view.w : view.h) - RULER;
    const W = Math.round((axis === 'h' ? len : RULER) * d), H = Math.round((axis === 'h' ? RULER : len) * d);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = c.getContext('2d');
    g.setTransform(d, 0, 0, d, 0, 0);
    g.fillStyle = '#25282e';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#6b7280';
    g.fillStyle = '#9aa1ab';
    g.font = '9px "Segoe UI", sans-serif';
    const z = view.zoom, o = (axis === 'h' ? view.ox : view.oy) - RULER, s = step(z), minor = s / (s % 5 === 0 ? 5 : 2);
    const w0 = Math.floor((-o) / z / minor) * minor, w1 = (len - o) / z;
    g.beginPath();
    for (let w = w0; w <= w1; w += minor) {
      const p = Math.round(o + w * z) + 0.5, major = Math.abs(w / s - Math.round(w / s)) < 1e-6, t = major ? RULER : RULER * 0.35;
      if (axis === 'h') { g.moveTo(p, RULER); g.lineTo(p, RULER - t); } else { g.moveTo(RULER, p); g.lineTo(RULER - t, p); }
      if (major) {
        const label = String(Math.round(w));
        if (axis === 'h') g.fillText(label, p + 2, 9);
        else { g.save(); g.translate(9, p + 2); g.rotate(-Math.PI / 2); g.textAlign = 'right'; g.fillText(label, 0, 0); g.restore(); }
      }
    }
    g.stroke();
    // アートボードの範囲を薄く
    const a = state.doc?.artboard;
    if (a) {
      g.fillStyle = 'rgba(59,130,246,.18)';
      const p0 = o + (axis === 'h' ? a.x : a.y) * z, p1 = p0 + (axis === 'h' ? a.w : a.h) * z;
      if (axis === 'h') g.fillRect(p0, RULER - 4, p1 - p0, 4); else g.fillRect(RULER - 4, p0, 4, p1 - p0);
    }
    // マウスの位置
    const cur = state.cursor;
    if (cur) {
      g.strokeStyle = '#3b82f6';
      g.beginPath();
      const p = Math.round(o + (axis === 'h' ? cur.x : cur.y) * z) + 0.5;
      if (axis === 'h') { g.moveTo(p, 0); g.lineTo(p, RULER); } else { g.moveTo(0, p); g.lineTo(RULER, p); }
      g.stroke();
    }
  }
}

// ---- 定規からガイドを引き出す ----
let pull = null; // { axis: 'v' | 'h', pos }
function initRulerDrag(el, axis) {
  // 上の定規から = 横のガイド(y)、左の定規から = 縦のガイド(x)
  const ga = axis === 'h' ? 'h' : 'v';
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !state.doc) return;
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* つかめなくても、定規の上の動きで続ける */ }
    pull = { axis: ga, pos: null };
  });
  el.addEventListener('pointermove', (e) => {
    if (!pull) return;
    const r = document.getElementById('view').getBoundingClientRect();
    const p = state.view.screenToDoc(e.clientX - r.left, e.clientY - r.top);
    const inside = e.clientX - r.left > RULER && e.clientY - r.top > RULER;
    pull.pos = inside ? Math.round(ga === 'v' ? p.x : p.y) : null;
    requestRender();
  });
  const end = () => {
    if (!pull) return;
    const p = pull;
    pull = null;
    if (p.pos === null) { requestRender(); return; }
    const g = structuredClone(docGuides());
    g[p.axis].push(p.pos);
    if (!guideOpts.show) { guideOpts.show = true; saveOpts(); }
    pushGuides('ガイドを置く', g);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', () => { pull = null; requestRender(); });
}

// ---- 矢印ツールでガイドを動かす(select.js から) ----
// 画面の (sx, sy) の近く(4px)にあるガイド { axis, index }
export function guideAt(ev) {
  if (!guideOpts.show || guideOpts.lock || !state.doc) return null;
  const g = docGuides(), v = state.view;
  let best = null;
  g.v.forEach((x, i) => { const d = Math.abs(v.ox + x * v.zoom - ev.sx); if (d <= 4 && (!best || d < best.d)) best = { axis: 'v', index: i, d }; });
  g.h.forEach((y, i) => { const d = Math.abs(v.oy + y * v.zoom - ev.sy); if (d <= 4 && (!best || d < best.d)) best = { axis: 'h', index: i, d }; });
  return best;
}
export function beginGuideDrag(hit) { return { kind: 'guide', axis: hit.axis, index: hit.index, before: structuredClone(docGuides()) }; }
export function moveGuideDrag(d, ev) {
  const g = docGuides();
  g[d.axis][d.index] = Math.round(d.axis === 'v' ? ev.x : ev.y);
  d.off = d.axis === 'v' ? ev.sx < RULER && guideOpts.rulers : ev.sy < RULER && guideOpts.rulers; // 定規の上 = 消える
  requestRender();
}
export function endGuideDrag(d) {
  const after = structuredClone(docGuides());
  if (d.off) after[d.axis].splice(d.index, 1);
  state.doc.guides = structuredClone(d.before);
  pushGuides(d.off ? 'ガイドを消す' : 'ガイドを動かす', after);
}

// 動かした枠 b(ワールド)の端・真ん中が、近くのガイドに吸い付くずらし量 { dx, dy }(6px 以内)
export function snapToGuides(b) {
  if (!guideOpts.snap || !guideOpts.show || !state.doc) return { dx: 0, dy: 0 };
  const g = docGuides(), tol = 6 / state.view.zoom;
  const best = (cands, lines) => {
    let r = null;
    for (const c of cands) for (const l of lines) { const d = l - c; if (Math.abs(d) <= tol && (r === null || Math.abs(d) < Math.abs(r))) r = d; }
    return r || 0;
  };
  return { dx: best([b.x0, (b.x0 + b.x1) / 2, b.x1], g.v), dy: best([b.y0, (b.y0 + b.y1) / 2, b.y1], g.h) };
}

// ---- スマートガイド(1.48.0): 図形を動かすとき、ほかの図形・アートボードの端と真ん中に吸い付いて、線と「中心」などを出す ----
//   smartTargets(動かす図形の id)= 吸い付く先(ドラッグの始めに1回だけ作る)。smartSnap(動かした枠, 先, 動いてよい向き)= { dx, dy, marks }
//   marks は state.smart に入れて drawSmart が描く(ピンクの線と文字)。ガイド(snapToGuides)と両方あれば、近い方
let boundsOf = () => ({ x0: 0, y0: 0, x1: 0, y1: 0 });
export const setBoundsFn = (fn) => { boundsOf = fn; }; // vector.js の visualBounds(読み込みの輪を作らないよう、select.js から渡す)

export function smartTargets(exclude) {
  const doc = state.doc, xs = [], ys = [];
  if (!guideOpts.smart || !doc) return { xs, ys };
  const add = (b, name) => {
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    xs.push({ v: b.x0, label: name + 'の左端', a: b.y0, b: b.y1 }, { v: cx, label: name + 'の中心', a: b.y0, b: b.y1 }, { v: b.x1, label: name + 'の右端', a: b.y0, b: b.y1 });
    ys.push({ v: b.y0, label: name + 'の上端', a: b.x0, b: b.x1 }, { v: cy, label: name + 'の中心', a: b.x0, b: b.x1 }, { v: b.y1, label: name + 'の下端', a: b.x0, b: b.x1 });
  };
  const ar = doc.artboard;
  add({ x0: ar.x, y0: ar.y, x1: ar.x + ar.w, y1: ar.y + ar.h }, 'アートボード');
  for (const l of doc.layers) {
    if (l.type !== 'vector' || !l.visible) continue;
    for (const sh of l.shapes || []) if (!exclude.has(sh.id)) add(boundsOf(sh), '図形');
  }
  return { xs, ys };
}

export function smartSnap(b, T, { x = true, y = true } = {}) {
  const tol = 6 / state.view.zoom, marks = [];
  const pick = (cands, list) => {
    let best = null;
    for (const c of cands) for (const t of list) { const d = t.v - c; if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, t }; }
    return best;
  };
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const bx = x ? pick([b.x0, cx, b.x1], T.xs) : null;
  const by = y ? pick([b.y0, cy, b.y1], T.ys) : null;
  const g = guideOpts.snap && guideOpts.show ? snapToGuides(b) : { dx: 0, dy: 0 };
  let dx = bx ? bx.d : 0, dy = by ? by.d : 0;
  // ガイドの方が近ければ、ガイドに
  if (x && g.dx && (!bx || Math.abs(g.dx) < Math.abs(dx))) dx = g.dx;
  if (y && g.dy && (!by || Math.abs(g.dy) < Math.abs(dy))) dy = g.dy;
  const nb = { x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy };
  // 吸い付いた所の線: 同じ値の先(端・中心)を全部、動かした枠まで伸ばして
  if (bx && dx === bx.d) {
    const v = bx.t.v, same = T.xs.filter((t) => Math.abs(t.v - v) < 0.01);
    marks.push({ x0: v, y0: Math.min(nb.y0, ...same.map((t) => t.a)), x1: v, y1: Math.max(nb.y1, ...same.map((t) => t.b)), label: bx.t.label });
  }
  if (by && dy === by.d) {
    const v = by.t.v, same = T.ys.filter((t) => Math.abs(t.v - v) < 0.01);
    marks.push({ x0: Math.min(nb.x0, ...same.map((t) => t.a)), y0: v, x1: Math.max(nb.x1, ...same.map((t) => t.b)), y1: v, label: by.t.label });
  }
  return { dx, dy, marks };
}

export function drawSmart(ctx, view) {
  const ms = state.smart;
  if (!ms || !ms.length) return;
  const d = view.dpr;
  ctx.save();
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.strokeStyle = '#ff2fb4';
  ctx.lineWidth = 1;
  ctx.font = '11px "Segoe UI", "Yu Gothic UI", sans-serif';
  for (const m of ms) {
    const a = view.toScreen({ x: m.x0, y: m.y0 }), b = view.toScreen({ x: m.x1, y: m.y1 });
    ctx.beginPath(); ctx.moveTo(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5); ctx.lineTo(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5); ctx.stroke();
    const vert = Math.abs(a.x - b.x) < 0.5;
    const w = ctx.measureText(m.label).width + 8, lx = vert ? a.x + 4 : (a.x + b.x) / 2 - w / 2, ly = vert ? Math.min(a.y, b.y) - 2 : a.y - 18;
    ctx.fillStyle = '#ff2fb4';
    ctx.fillRect(lx, ly, w, 15);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(m.label, lx + 4, ly + 11);
  }
  ctx.restore();
}

// Shift でまっすぐ(横・縦・45°)に動かす量。axis = 'x'(横だけ)| 'y'(縦だけ)| 'none'(斜め)
export function constrain(dx, dy) {
  const len = Math.hypot(dx, dy);
  if (!len) return { dx, dy, axis: 'both' };
  const k = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)), ang = k * (Math.PI / 4);
  const m = ((k % 4) + 4) % 4; // 0 = 横、2 = 縦、1・3 = 斜め
  const along = dx * Math.cos(ang) + dy * Math.sin(ang);
  return { dx: Math.cos(ang) * along, dy: Math.sin(ang) * along, axis: m === 0 ? 'x' : m === 2 ? 'y' : 'none' };
}

// ---- ものさし(M) ----
export const measureTool = {
  cursor: 'crosshair',
  down(ev) {
    if (ev.button !== 0) return false;
    state.measure = { a: { x: ev.x, y: ev.y }, b: { x: ev.x, y: ev.y } };
    emit('measure');
    return true;
  },
  move(ev) {
    const m = state.measure;
    if (!m) return;
    let { x, y } = ev;
    if (ev.shift) {
      const ang = Math.round(Math.atan2(y - m.a.y, x - m.a.x) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(x - m.a.x, y - m.a.y);
      x = m.a.x + Math.cos(ang) * len; y = m.a.y + Math.sin(ang) * len;
    }
    m.b = { x, y };
    emit('measure');
    requestRender();
  },
  up() { emit('measure'); },
};
export function measureInfo(m = state.measure) {
  if (!m) return null;
  const dx = m.b.x - m.a.x, dy = m.b.y - m.a.y;
  let ang = -Math.atan2(dy, dx) * 180 / Math.PI; // 右 = 0°、上へ +(イラレと同じ)
  if (ang < 0) ang += 360;
  return { dist: Math.hypot(dx, dy), ang, dx, dy, x: m.a.x, y: m.a.y };
}
export function drawMeasure(ctx, view) {
  const m = state.measure;
  if (!m || state.tool !== 'measure') return;
  const d = view.dpr, A = view.toScreen(m.a), B = view.toScreen(m.b), info = measureInfo(m);
  ctx.save();
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.strokeStyle = '#f59e0b';
  ctx.fillStyle = '#f59e0b';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
  for (const p of [A, B]) { ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2); ctx.fill(); }
  const label = `${info.dist.toFixed(1)} px  ${info.ang.toFixed(1)}°`;
  ctx.font = '12px "Segoe UI", "Yu Gothic UI", sans-serif';
  const w = ctx.measureText(label).width + 10;
  ctx.fillStyle = 'rgba(17,19,24,.9)';
  ctx.fillRect(B.x + 10, B.y + 8, w, 20);
  ctx.fillStyle = '#fde68a';
  ctx.fillText(label, B.x + 15, B.y + 22);
  ctx.restore();
}

export function initGuides() {
  for (const [id, axis] of [['ruler-h', 'h'], ['ruler-v', 'v']]) { const el = document.getElementById(id); if (el) initRulerDrag(el, axis); }
  applyRulers();
  on('tool', () => { if (state.tool !== 'measure' && state.measure) { state.measure = null; requestRender(); } });
  on('cursor', () => { if (guideOpts.rulers && state.view) drawRulers(state.view); });
}
