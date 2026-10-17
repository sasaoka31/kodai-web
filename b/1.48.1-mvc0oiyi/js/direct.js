// ダイレクト選択ツール(アンカーポイントを選んで動かす。矢印ボタンを長押しして切り替え)
//   アンカーポイントをクリック: そのポイントだけを選ぶ(Shift で追加・外す。まだ選んでいない図形のポイントもつかめる)/ ドラッグ: 選んだポイントを動かす
//   線(区間)をクリック: その区間の両はしのポイントを選ぶ(ドラッグで区間ごと動かす)
//   図形の中をクリック: その図形のポイントを表示する(ドラッグで図形ごと動かす。ポイントは選ばない)
//   何もない所からドラッグ: 範囲の中のアンカーポイントを選ぶ
//   選んだポイントの方向線(ハンドル)の先をドラッグ: 曲がり方を変える(反対側も向きをそろえる。Alt で片側だけ)
//   四角・楕円・直線は、ポイントを動かすとパスになる。グループの中の図形も直接さわれる(文字は対象外)
//   ポイントの追加: パスの線の上をダブルクリック / 削除: 選んで Delete・Backspace、または Alt+クリック
import { state, emit, requestRender, toast } from './state.js';
import { hitShape, hitInterior, toPath, pathRings, ensureIds, shapeBounds } from './vector.js';
import { replaceEntry } from './history.js';
import { setSelection } from './select.js';
import { hitTol, pushVector } from './tools.js';

const S = (p) => state.view.toScreen(p);
let sel = null; // { layerId, leafIds: Set, pts: Set('id|ring|index') }
let drag = null;

const keyOf = (id, r, i) => `${id}|${r}|${i}`;
const editable = (s) => s.type === 'path' || s.type === 'rect' || s.type === 'ellipse' || s.type === 'line';

function activeLayer() {
  const l = state.doc?.activeLayer;
  return l && l.type === 'vector' && l.visible && !l.locked ? l : null;
}

// レイヤーの中の、さわれる図形(グループの中まで)。{ leaf, top(一番上の図形) }
function leavesOf(layer) {
  const out = [];
  const walk = (s, top) => { if (s.type === 'group') s.children.forEach((c) => walk(c, top)); else if (editable(s)) out.push({ leaf: s, top }); };
  for (const s of layer.shapes) walk(s, s);
  return out;
}

// 図形のアンカーポイント(直線は両端、四角・楕円はパスにしたときの点)
function ringsOf(s) {
  if (s.type === 'line') return [{ nodes: [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }], closed: false }];
  return pathRings(s.type === 'path' ? s : toPath(s));
}

// 動かせる形(パス)に直す
function asPath(s) {
  if (s.type === 'line') return { ...s, type: 'path', closed: false, nodes: [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }], fill: null };
  return s.type === 'path' ? s : toPath(s);
}

// 一番上の図形の中の葉(id)を fn で置き換えた新しい一番上の図形
function replaceLeaf(top, id, fn) {
  if (top.id === id) return fn(top);
  if (top.type !== 'group') return top;
  return { ...top, children: top.children.map((c) => replaceLeaf(c, id, fn)) };
}

function shown() {
  const layer = activeLayer();
  if (!sel || !layer || sel.layerId !== layer.id) return [];
  return leavesOf(layer).filter((x) => sel.leafIds.has(x.leaf.id));
}

function hitAnchor(ev, list) {
  const s = { x: ev.sx, y: ev.sy };
  for (let k = list.length - 1; k >= 0; k--) {
    const { leaf } = list[k];
    const rings = ringsOf(leaf);
    for (let r = 0; r < rings.length; r++) {
      const nodes = rings[r].nodes;
      for (let i = 0; i < nodes.length; i++) {
        const q = S(nodes[i]);
        if (Math.abs(q.x - s.x) <= 5 && Math.abs(q.y - s.y) <= 5) return { leaf, r, i };
      }
    }
  }
  return null;
}

// 選んだポイントの方向線の先
function hitHandle(ev, list) {
  const s = { x: ev.sx, y: ev.sy };
  for (const { leaf } of list) {
    if (leaf.type !== 'path') continue;
    pathRings(leaf).forEach((ring, r) => ring.nodes.forEach((n, i) => {
      if (!sel.pts.has(keyOf(leaf.id, r, i))) return;
      for (const side of ['hin', 'hout']) {
        if (!n[side]) continue;
        const q = S(n[side]);
        if (Math.abs(q.x - s.x) <= 5 && Math.abs(q.y - s.y) <= 5) throw { found: { leaf, r, i, side } };
      }
    }));
  }
  return null;
}
const findHandle = (ev, list) => { try { return hitHandle(ev, list); } catch (e) { if (e.found) return e.found; throw e; } };

function select(layer, leafIds, pts) {
  sel = { layerId: layer.id, leafIds: new Set(leafIds), pts: new Set(pts) };
  // 右の「線と塗り」パネルなどは、その図形(一番上)を選んでいるものとして動く
  const tops = new Set();
  for (const x of leavesOf(layer)) if (sel.leafIds.has(x.leaf.id)) tops.add(x.top.id);
  setSelection(layer, [...tops]);
  requestRender();
}

export function clearDirect() { sel = null; drag = null; requestRender(); }

// 選んだアンカーポイントと、その間の線だけを、新しい開いたパスにしたもの(コピー用。イラレと同じ。1.47.0)
//   1つの輪の中で、続けて選んだ点の並び(2つ以上)ごとに1本。輪の点を全部選んでいれば、閉じたパスのまま。点が1つだけの所は入らない
//   線の色・太さは元の図形から(線がなければ塗りの色を線にする)。clipboard.js のコピーが、ダイレクト選択のときに使う
export function selectedPointShapes() {
  if (!sel || !sel.pts.size) return [];
  const out = [];
  for (const { leaf } of shown()) {
    const rings = ringsOf(leaf);
    rings.forEach((ring, r) => {
      const n = ring.nodes.length;
      const on = ring.nodes.map((_, i) => sel.pts.has(keyOf(leaf.id, r, i)));
      if (!on.some(Boolean)) return;
      const style = { stroke: leaf.stroke || leaf.fill || '#000000ff', strokeWidth: leaf.stroke ? leaf.strokeWidth || 1 : 2, fill: null };
      if (on.every(Boolean)) { out.push({ type: 'path', nodes: structuredClone(ring.nodes), closed: ring.closed, ...style, ...(ring.closed && leaf.fill ? { fill: leaf.fill } : {}) }); return; }
      // 続けて選んだ点の並び。閉じた輪なら、選んでいない点から数え始める(つなぎ目をまたぐ並びも1本に)
      const start = ring.closed ? on.findIndex((v) => !v) : 0;
      let run = [];
      const flush = () => {
        if (run.length >= 2) {
          const nodes = run.map((i) => structuredClone(ring.nodes[i]));
          delete nodes[0].hin;
          delete nodes[nodes.length - 1].hout;
          out.push({ type: 'path', nodes, closed: false, ...style });
        }
        run = [];
      };
      for (let k = 0; k < n; k++) {
        const i = (start + k) % n;
        if (on[i]) run.push(i); else flush();
      }
      flush();
    });
  }
  return out;
}

export const directTool = {
  cursor: 'default',

  down(ev) {
    const layer = activeLayer();
    if (!layer || ev.button !== 0) return false;
    ensureIds(layer.shapes);
    const list = shown();
    // 1) 方向線の先
    const h = sel && list.length ? findHandle(ev, list) : null;
    if (h) return this.begin(layer, ev, { handle: h });
    // 2) アンカーポイント(まだ選んでいない図形のポイントもつかめる)
    let a = list.length ? hitAnchor(ev, list) : null;
    if (!a) {
      const pad = 8 / state.view.zoom;
      const near = leavesOf(layer).filter(({ leaf }) => { const b = shapeBounds(leaf); return ev.x >= b.x0 - pad && ev.x <= b.x1 + pad && ev.y >= b.y0 - pad && ev.y <= b.y1 + pad; });
      a = near.length ? hitAnchor(ev, near) : null;
      if (a && !ev.alt) {
        const k = keyOf(a.leaf.id, a.r, a.i);
        const same = sel?.layerId === layer.id;
        select(layer, ev.shift && same ? [...sel.leafIds, a.leaf.id] : [a.leaf.id], ev.shift && same ? [...sel.pts, k] : [k]);
        return this.begin(layer, ev, {});
      }
    }
    if (a) {
      const k = keyOf(a.leaf.id, a.r, a.i);
      if (ev.alt) { deleteAnchors(k); return false; } // Alt+クリック: そのポイントを消す
      if (ev.shift) {
        const pts = new Set(sel.pts);
        if (pts.has(k)) pts.delete(k); else pts.add(k);
        select(layer, sel.leafIds, pts);
        return false;
      }
      if (!sel.pts.has(k)) select(layer, sel.leafIds, [k]);
      return this.begin(layer, ev, {});
    }
    // 3) 線(区間)の上 → その区間の両はしのポイントを選んで動かす(イラレのセグメント)
    const same = sel?.layerId === layer.id;
    const seg = nearestSegment(layer, ev);
    if (seg && seg.d <= 5) {
      const n = ringsOf(seg.leaf)[seg.r].nodes;
      const ks = [keyOf(seg.leaf.id, seg.r, seg.i), keyOf(seg.leaf.id, seg.r, (seg.i + 1) % n.length)];
      select(layer, ev.shift && same ? [...sel.leafIds, seg.leaf.id] : [seg.leaf.id], ev.shift && same ? [...sel.pts, ...ks] : ks);
      return this.begin(layer, ev, {});
    }
    // 4) 図形の中 → その図形のポイントを表示して、図形ごと動かす(ポイントは選ばない)
    const tol = hitTol();
    const all = leavesOf(layer);
    let hit = null;
    for (const test of [(s) => hitShape(s, ev.x, ev.y, tol), (s) => hitInterior(s, ev.x, ev.y)]) {
      for (let k = all.length - 1; k >= 0 && !hit; k--) if (test(all[k].leaf)) hit = all[k].leaf;
      if (hit) break;
    }
    if (hit) {
      const ids = ev.shift && same ? [...sel.leafIds, hit.id] : [hit.id];
      select(layer, ids, ev.shift && same ? [...sel.pts] : []);
      return this.begin(layer, ev, { whole: hit.id });
    }
    // 5) 範囲選択
    drag = { kind: 'marquee', layer, start: { x: ev.x, y: ev.y }, cur: { x: ev.x, y: ev.y }, add: ev.shift };
    return true;
  },

  begin(layer, ev, { handle, whole }) {
    // 動かす図形(一番上)を覚えておく(元に戻す用)。四角・楕円・直線はここでパスにする
    const tops = new Map();
    for (const x of leavesOf(layer)) if (sel.leafIds.has(x.leaf.id)) tops.set(x.top.id, x.top);
    drag = { kind: handle ? 'handle' : 'points', layer, handle, whole, start: { x: ev.x, y: ev.y }, before: [...tops].map(([id, s]) => [id, structuredClone(s)]), changed: false };
    layer.shapes = layer.shapes.map((s) => {
      if (!tops.has(s.id)) return s;
      let t = s;
      for (const id of sel.leafIds) t = replaceLeaf(t, id, (leaf) => structuredClone(asPath(leaf)));
      return t;
    });
    drag.base = new Map(layer.shapes.filter((s) => tops.has(s.id)).map((s) => [s.id, structuredClone(s)]));
    return true;
  },

  move(ev) {
    const d = drag;
    if (!d) return;
    if (d.kind === 'marquee') { d.cur = { x: ev.x, y: ev.y }; requestRender(); return; }
    const dx = ev.x - d.start.x, dy = ev.y - d.start.y;
    d.changed = true;
    d.layer.shapes = d.layer.shapes.map((s) => {
      const base = d.base.get(s.id);
      if (!base) return s;
      let t = structuredClone(base);
      for (const id of sel.leafIds) {
        t = replaceLeaf(t, id, (leaf) => {
          pathRings(leaf).forEach((ring, r) => ring.nodes.forEach((n, i) => {
            if (d.kind === 'handle') {
              const h = d.handle;
              if (h.leaf.id !== id || h.r !== r || h.i !== i) return;
              const hp = n[h.side];
              n[h.side] = { x: hp.x + dx, y: hp.y + dy };
              // 反対側の方向線は向きをそろえる(長さはそのまま)。Alt で片側だけ
              const other = h.side === 'hin' ? 'hout' : 'hin';
              if (!ev.alt && n[other]) {
                const vx = n.x - n[h.side].x, vy = n.y - n[h.side].y, len = Math.hypot(vx, vy);
                const ol = Math.hypot(n[other].x - n.x, n[other].y - n.y);
                if (len > 1e-6) n[other] = { x: n.x + (vx / len) * ol, y: n.y + (vy / len) * ol };
              }
              return;
            }
            if (d.whole !== id && !sel.pts.has(keyOf(id, r, i))) return;
            n.x += dx; n.y += dy;
            if (n.hin) n.hin = { x: n.hin.x + dx, y: n.hin.y + dy };
            if (n.hout) n.hout = { x: n.hout.x + dx, y: n.hout.y + dy };
          }));
          return leaf;
        });
      }
      return t;
    });
    d.layer.touch();
    requestRender();
  },

  up() {
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.kind === 'marquee') {
      const r = { x0: Math.min(d.start.x, d.cur.x), y0: Math.min(d.start.y, d.cur.y), x1: Math.max(d.start.x, d.cur.x), y1: Math.max(d.start.y, d.cur.y) };
      const ids = new Set(d.add && sel ? sel.leafIds : []), pts = new Set(d.add && sel ? sel.pts : []);
      for (const { leaf } of leavesOf(d.layer)) {
        ringsOf(leaf).forEach((ring, ri) => ring.nodes.forEach((n, i) => {
          if (n.x >= r.x0 && n.x <= r.x1 && n.y >= r.y0 && n.y <= r.y1) { ids.add(leaf.id); pts.add(keyOf(leaf.id, ri, i)); }
        }));
      }
      if (ids.size) select(d.layer, ids, pts);
      else { sel = null; setSelection(null, []); requestRender(); }
      return;
    }
    if (!d.changed) {
      // さわっただけ(パスに直しただけ)なら元に戻す
      const m = new Map(d.before);
      d.layer.shapes = d.layer.shapes.map((s) => (m.has(s.id) ? m.get(s.id) : s));
      d.layer.touch();
      requestRender();
      return;
    }
    const ids = new Set(d.before.map(([id]) => id));
    const after = d.layer.shapes.filter((s) => ids.has(s.id)).map((s) => [s.id, s]);
    state.history.push(replaceEntry(d.kind === 'handle' ? '方向線を動かす' : 'アンカーポイントを動かす', d.layer, d.before, after));
    emit('selection');
  },
};

// ---- アンカーポイントの追加・削除 ----
// 追加: パスの線の上をダブルクリック(曲線は形を変えずに分ける)/ 削除: ポイントを選んで Delete・Backspace、または Alt+クリック

// 図形(パスにしたもの)の輪を fn で直した新しい葉。輪がなくなったら null
function withRings(leaf, fn) {
  const p = structuredClone(asPath(leaf));
  const rings = fn(pathRings(p).map((r) => ({ nodes: r.nodes, closed: r.closed }))).filter((r) => r.nodes.length >= 2);
  if (!rings.length) return null;
  p.nodes = rings[0].nodes;
  p.closed = !!rings[0].closed && rings[0].nodes.length >= 3;
  if (rings.length > 1) p.subpaths = rings.slice(1).map((r) => ({ nodes: r.nodes, closed: !!r.closed && r.nodes.length >= 3 }));
  else delete p.subpaths;
  return p;
}

// 一番上の図形の中の葉(id)を消す(空になったグループも消す)。全部なくなったら null
function removeLeaf(top, id) {
  if (top.id === id) return null;
  if (top.type !== 'group') return top;
  const children = top.children.map((c) => removeLeaf(c, id)).filter(Boolean);
  return children.length ? { ...top, children } : null;
}

// 葉を書き換える(edits: Map(葉の id → 新しい葉 | null = 消す))。履歴はレイヤーの前後(たまにしか使わない操作なので確実な方法で)
function applyLeafEdits(layer, edits, label) {
  const before = structuredClone(layer.shapes);
  layer.shapes = layer.shapes.map((s) => {
    let t = s;
    for (const [id, leaf] of edits) if (t) t = leaf ? replaceLeaf(t, id, () => leaf) : removeLeaf(t, id);
    return t;
  }).filter(Boolean);
  pushVector(label, layer, before);
  emit('selection');
}

export const hasDirectPoints = () => !!sel?.pts.size && state.tool === 'direct';

// 選んだポイントを消す
export function deleteAnchors(only = null) {
  const layer = activeLayer();
  if (!layer || !sel) return false;
  const pts = only ? new Set([only]) : sel.pts;
  const edits = new Map();
  for (const { leaf } of shown()) {
    const mine = [...pts].filter((k) => k.startsWith(`${leaf.id}|`)).map((k) => k.split('|').map(Number).slice(1));
    if (!mine.length) continue;
    edits.set(leaf.id, withRings(leaf, (rings) => rings.map((r, ri) => ({ ...r, nodes: r.nodes.filter((_, i) => !mine.some(([mr, mi]) => mr === ri && mi === i)) }))));
  }
  if (!edits.size) return false;
  applyLeafEdits(layer, edits, 'アンカーポイントを削除');
  const left = [...sel.leafIds].filter((id) => !edits.has(id) || edits.get(id));
  select(layer, left, []);
  return true;
}

// 3次ベジェを t で2つに分ける(de Casteljau)
function splitCubic(a, b, t) {
  const p0 = a, p1 = a.hout || a, p2 = b.hin || b, p3 = b;
  const L = (u, v) => ({ x: u.x + (v.x - u.x) * t, y: u.y + (v.y - u.y) * t });
  const q0 = L(p0, p1), q1 = L(p1, p2), q2 = L(p2, p3), r0 = L(q0, q1), r1 = L(q1, q2), m = L(r0, r1);
  return { aOut: q0, mid: { x: m.x, y: m.y, hin: r0, hout: r1 }, bIn: q2 };
}
const cubicAt = (a, b, t) => {
  const p1 = a.hout || a, p2 = b.hin || b, u = 1 - t;
  return { x: u * u * u * a.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * b.x, y: u * u * u * a.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * b.y };
};

// ダブルクリックした所(パスの線の上)にポイントを足す。足せたら true
// 点の近くの線(区間)。{ d(画面 px), leaf, r, i(区間の始まりの点), t, curve } / なければ null
function nearestSegment(layer, ev) {
  let best = null;
  const pad = 8 / state.view.zoom;
  for (const { leaf } of leavesOf(layer)) {
    const b = shapeBounds(leaf);
    if (ev.x < b.x0 - pad || ev.x > b.x1 + pad || ev.y < b.y0 - pad || ev.y > b.y1 + pad) continue;
    ringsOf(leaf).forEach((ring, r) => {
      const n = ring.nodes, cnt = ring.closed ? n.length : n.length - 1;
      for (let i = 0; i < cnt; i++) {
        const a = n[i], b = n[(i + 1) % n.length];
        const curve = !!(a.hout || b.hin);
        // 線の上の一番近い所(画面の px で)
        for (let k = 0; k <= 64; k++) {
          const t = k / 64;
          const p = curve ? cubicAt(a, b, t) : { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
          const q = S(p);
          const d = Math.hypot(q.x - ev.sx, q.y - ev.sy);
          if (!best || d < best.d) best = { d, leaf, r, i, t, curve };
        }
      }
    });
  }
  return best;
}

export function addAnchorAt(ev) {
  const layer = activeLayer();
  if (!layer) return false;
  ensureIds(layer.shapes);
  const best = nearestSegment(layer, ev);
  if (!best || best.d > 6 || best.t < 0.02 || best.t > 0.98) return false;
  const { leaf, r, i, t, curve } = best;
  let newIndex = i + 1;
  const edited = withRings(leaf, (rings) => {
    const n = rings[r].nodes, a = n[i], j = (i + 1) % n.length, b = n[j];
    if (curve) {
      const sp = splitCubic(a, b, t);
      n[i] = { ...a, hout: sp.aOut };
      n[j] = { ...b, hin: sp.bIn };
      n.splice(i + 1, 0, sp.mid);
    } else {
      n.splice(i + 1, 0, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
    return rings;
  });
  applyLeafEdits(layer, new Map([[leaf.id, edited]]), 'アンカーポイントを追加');
  select(layer, [...new Set([...(sel?.layerId === layer.id ? sel.leafIds : []), leaf.id])], [keyOf(leaf.id, r, newIndex)]);
  return true;
}

// 画面に出すもの: 選んでいる図形のアンカーポイント(選んだ点は塗る)と方向線、範囲選択の枠
export function drawDirectOverlay(ctx) {
  if (state.tool !== 'direct' || !state.doc) return;
  if (drag?.kind === 'marquee') {
    const a = S(drag.start), b = S(drag.cur);
    ctx.fillStyle = 'rgba(59,130,246,0.12)';
    ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  }
  const list = shown();
  if (!list.length) return;
  const open = new Path2D(), filled = new Path2D(), lines = new Path2D(), knobs = new Path2D();
  let count = 0;
  for (const { leaf } of list) {
    ringsOf(leaf).forEach((ring, r) => ring.nodes.forEach((n, i) => {
      if (++count > 20000) return;
      const q = S(n);
      const on = sel.pts.has(keyOf(leaf.id, r, i));
      (on ? filled : open).rect(Math.round(q.x) - 3, Math.round(q.y) - 3, 6, 6);
      if (on && leaf.type === 'path') {
        for (const side of ['hin', 'hout']) {
          if (!n[side]) continue;
          const hq = S(n[side]);
          lines.moveTo(q.x, q.y);
          lines.lineTo(hq.x, hq.y);
          knobs.moveTo(hq.x + 3, hq.y);
          knobs.arc(hq.x, hq.y, 3, 0, Math.PI * 2);
        }
      }
    }));
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#3b82f6';
  ctx.stroke(lines);
  ctx.fillStyle = '#fff';
  ctx.fill(open);
  ctx.stroke(open);
  ctx.fillStyle = '#3b82f6';
  ctx.fill(filled);
  ctx.fill(knobs);
}

// ---- 曲げるツール(C。1.48.0)----
//   パスの線(区間)の上をドラッグすると、つかんだ所がマウスを通るように曲がる(両はしの方向線を同じだけ動かす。もう曲がっている線は、その曲がりからさらに)
//   Shift+ドラッグ: 両はしと、マウスの位置の3点を通る、ぴったりの円弧にする(90° ごとに点を足す。四角の辺を半円にするなど)
//   Alt+クリック: その線をまっすぐに戻す(方向線を消す)。四角・楕円・直線は、曲げるとパスになる。グループの中の図形もさわれる
const arcCtl = (r, sweep) => (4 / 3) * Math.tan(sweep / 4) * r; // 円弧(sweep ≤ 90°)をベジェにするときの方向線の長さ

function bendRing(ring, i, t, C, arc) {
  const n = ring.nodes, j = (i + 1) % n.length, a = n[i], b = n[j];
  if (!arc) {
    const p1 = a.hout || { x: a.x, y: a.y }, p2 = b.hin || { x: b.x, y: b.y };
    const B = cubicAt({ ...a, hout: p1 }, { ...b, hin: p2 }, t), k = 3 * t * (1 - t);
    const dx = (C.x - B.x) / k, dy = (C.y - B.y) / k;
    a.hout = { x: p1.x + dx, y: p1.y + dy };
    b.hin = { x: p2.x + dx, y: p2.y + dy };
    return;
  }
  // 3点(a・C・b)を通る円
  const ax = a.x, ay = a.y, bx = b.x, by = b.y, cx = C.x, cy = C.y;
  const D = 2 * (ax * (cy - by) + cx * (by - ay) + bx * (ay - cy));
  if (Math.abs(D) < 1e-9) { delete a.hout; delete b.hin; return; } // 一直線 = まっすぐ
  const sq = (x, y) => x * x + y * y;
  const ox = (sq(ax, ay) * (cy - by) + sq(cx, cy) * (by - ay) + sq(bx, by) * (ay - cy)) / D;
  const oy = (sq(ax, ay) * (bx - cx) + sq(cx, cy) * (ax - bx) + sq(bx, by) * (cx - ax)) / D;
  const R = Math.hypot(ax - ox, ay - oy);
  const ang = (x, y) => Math.atan2(y - oy, x - ox);
  const ta = ang(ax, ay), tc = ang(cx, cy), tb = ang(bx, by);
  const norm = (v) => { while (v <= -Math.PI) v += 2 * Math.PI; while (v > Math.PI) v -= 2 * Math.PI; return v; };
  // a → c → b の向き(c を通る方)
  let sweep = norm(tb - ta);
  const toC = norm(tc - ta);
  if (!(sweep > 0 ? toC > 0 && toC < sweep : toC < 0 && toC > sweep)) sweep = sweep > 0 ? sweep - 2 * Math.PI : sweep + 2 * Math.PI;
  const pieces = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9)), step = sweep / pieces, h = arcCtl(R, step);
  const pt = (th) => ({ x: ox + R * Math.cos(th), y: oy + R * Math.sin(th) });
  const tan = (th, len) => ({ x: -Math.sin(th) * len, y: Math.cos(th) * len }); // 円の接線(角度が増える向き)
  const mids = [];
  for (let k = 1; k < pieces; k++) {
    const th = ta + step * k, p = pt(th), v = tan(th, h);
    mids.push({ x: p.x, y: p.y, hin: { x: p.x - v.x, y: p.y - v.y }, hout: { x: p.x + v.x, y: p.y + v.y } });
  }
  const va = tan(ta, h), vb = tan(tb, h);
  a.hout = { x: a.x + va.x, y: a.y + va.y };
  b.hin = { x: b.x - vb.x, y: b.y - vb.y };
  n.splice(i + 1, 0, ...mids); // (閉じた輪のつなぎ目の区間なら、いちばんうしろに入る)
}

export const bendTool = {
  cursor: 'crosshair',
  down(ev) {
    const layer = activeLayer();
    if (!layer || ev.button !== 0) return false;
    ensureIds(layer.shapes);
    const seg = nearestSegment(layer, ev);
    if (!seg || seg.d > 6) { cancelJoinPick(); return false; }
    const top = leavesOf(layer).find((x) => x.leaf.id === seg.leaf.id)?.top;
    if (!top) return false;
    const before = [[top.id, structuredClone(top)]];
    // 四角・楕円・直線はパスにしてから
    layer.shapes = layer.shapes.map((s) => (s.id === top.id ? replaceLeaf(s, seg.leaf.id, (leaf) => structuredClone(asPath(leaf))) : s));
    const base = structuredClone(layer.shapes.find((s) => s.id === top.id));
    drag = { kind: 'bend', layer, top: top.id, leaf: seg.leaf.id, r: seg.r, i: seg.i, t: Math.min(0.85, Math.max(0.15, seg.t)), at: seg.t, start: { x: ev.x, y: ev.y }, before, base, changed: false };
    if (ev.alt) {
      // Alt+クリック: まっすぐに戻す
      this.apply((ring) => { const n = ring.nodes; delete n[seg.i].hout; delete n[(seg.i + 1) % n.length].hin; });
      drag.changed = true;
      joinPick = null;
      this.up();
      return false;
    }
    return true;
  },
  apply(fn) {
    const d = drag;
    const t = replaceLeaf(structuredClone(d.base), d.leaf, (leaf) => { fn(pathRings(leaf)[d.r]); return leaf; });
    d.layer.shapes = d.layer.shapes.map((s) => (s.id === d.top ? t : s));
    d.layer.touch();
    requestRender();
  },
  move(ev) {
    const d = drag;
    if (!d || d.kind !== 'bend') return;
    // 少し動いたら「曲げる」(動かさずに離したら「つなぐ」のクリック)
    if (!d.changed) {
      const q = S({ x: ev.x, y: ev.y }), o = S(d.start);
      if (Math.hypot(q.x - o.x, q.y - o.y) < 3) return;
      joinPick = null;
    }
    d.changed = true;
    this.apply((ring) => bendRing(ring, d.i, d.t, { x: ev.x, y: ev.y }, ev.shift));
  },
  up() {
    const d = drag;
    drag = null;
    if (!d || d.kind !== 'bend') return;
    if (!d.changed) {
      d.layer.shapes = d.layer.shapes.map((s) => (s.id === d.top ? d.before[0][1] : s));
      d.layer.touch();
      requestRender();
      clickToJoin(d.layer, { leaf: d.leaf, r: d.r, i: d.i, t: d.at });
      return;
    }
    const after = d.layer.shapes.filter((s) => s.id === d.top).map((s) => [s.id, s]);
    state.history.push(replaceEntry('線を曲げる', d.layer, d.before, after));
    emit('selection');
  },
};

// ---- 2本の辺をつなぐ(曲げるツールでクリック2回。1.48.0)----
//   1本目の辺をクリック(青く光る)→ 2本目の辺(別の図形・複合パスの別の輪)をクリックすると、1つのパスになってつながる。
//   閉じた図形どうし: 2本の辺の、近い方のはしどうしを「内側」、遠い方を「外側」として、2本の辺を消し、外側のはしどうしを
//     となりの辺から続けて、1か所だけで曲がってつなぐ(oneTurn。平行なら半円、直角なら 90° の角丸。届かない方の辺はまっすぐのばす)。
//     内側も同じ中心の円弧で丸める(1.48.1)。重なった点・まっすぐの途中の点・行って戻るだけの線は消す
//   開いたパス(線)どうし: クリックした所に近い方のはしどうしを、同じようにつなぐ
//   同じ辺をもう一度クリック・何もない所をクリック・Esc でやめる。ドラッグはこれまでどおり「曲げる」
let joinPick = null; // { layerId, leaf, r, i, t }

export const hasJoinPick = () => !!joinPick && state.tool === 'bend';
export function cancelJoinPick() { if (joinPick) { joinPick = null; requestRender(); } }

function clickToJoin(layer, pick) {
  const p = joinPick;
  if (!p || p.layerId !== layer.id || !leavesOf(layer).some((x) => x.leaf.id === p.leaf)) {
    joinPick = { layerId: layer.id, ...pick };
    requestRender();
    return;
  }
  joinPick = null;
  if (p.leaf === pick.leaf && p.r === pick.r) {
    if (p.i !== pick.i) toast('別の図形の辺を選んでください(同じ図形の中の辺どうしはつなげません)');
    requestRender();
    return;
  }
  joinEdges(layer, p, pick);
}

const cloneNode = (n) => { const m = { x: n.x, y: n.y }; if (n.hin) m.hin = { ...n.hin }; if (n.hout) m.hout = { ...n.hout }; return m; };
const reverseNodes = (list) => list.slice().reverse().map((n) => { const m = { x: n.x, y: n.y }; if (n.hout) m.hin = n.hout; if (n.hin) m.hout = n.hin; return m; });

// 閉じた輪から区間 i を抜いた残り(区間の終わりの点 → … → 区間の始まりの点)
function restOfRing(nodes, i) {
  const n = nodes.length, j = (i + 1) % n, out = [];
  for (let k = 0; k < n; k++) out.push(cloneNode(nodes[(j + k) % n]));
  delete out[0].hin;
  delete out[n - 1].hout;
  return out;
}

const unit = (x, y) => { const l = Math.hypot(x, y); return l > 1e-9 ? { x: x / l, y: y / l } : null; };
// 並びの最後の点に入ってくる向き / 最初の点から出ていく向き
function endDir(list) {
  const e = list[list.length - 1], p = list[list.length - 2];
  if (!p) return null;
  const from = e.hin || p.hout || p;
  return unit(e.x - from.x, e.y - from.y) || unit(e.x - p.x, e.y - p.y);
}
function startDir(list) {
  const s = list[0], q = list[1];
  if (!q) return null;
  const to = s.hout || q.hin || q;
  return unit(to.x - s.x, to.y - s.y) || unit(q.x - s.x, q.y - s.y);
}

// P1(向き d1 で来る)から P2(向き d2 で出ていく)へ、なめらかにつなぐ線。{ aOut(P1 の方向線), mids(途中の点), bIn(P2 の方向線) }
//   P1 で d1 に接して P2 を通る円が、P2 で d2 にも接するなら、ぴったりの円弧(平行 = 半円、直角 = 4分の1円)
//   そうでなければベジェ1本(2本の接線が前で交わるなら、その角へ向けて楕円の4分の1のように)
export function joinCurve(P1, d1, P2, d2) {
  const wx = P2.x - P1.x, wy = P2.y - P1.y, L = Math.hypot(wx, wy);
  if (L < 1e-6 || !d1 || !d2) return { mids: [] };
  const dot = (u, v) => u.x * v.x + u.y * v.y, cr = (u, v) => u.x * v.y - u.y * v.x;
  const c = { x: wx / L, y: wy / L }, side = cr(d1, c);
  if (Math.abs(side) < 1e-6) {
    if (dot(d1, c) > 0 && dot(d2, c) > 0.9995) return { mids: [] }; // 一直線
  } else {
    const k = 2 * dot(d1, c), end = { x: k * c.x - d1.x, y: k * c.y - d1.y }; // その円の、P2 での向き
    if (dot(end, d2) > Math.cos(Math.PI / 90)) {
      const sweep = 2 * Math.acos(Math.max(-1, Math.min(1, dot(d1, c)))), sg = side > 0 ? 1 : -1;
      const R = L / (2 * Math.sin(sweep / 2));
      const O = { x: P1.x - sg * d1.y * R, y: P1.y + sg * d1.x * R };
      const pieces = Math.max(1, Math.ceil(sweep / (Math.PI / 2) - 1e-9)), step = (sg * sweep) / pieces, h = arcCtl(R, sweep / pieces);
      const ta = Math.atan2(P1.y - O.y, P1.x - O.x);
      const tan = (th) => ({ x: -Math.sin(th) * sg * h, y: Math.cos(th) * sg * h });
      const mids = [];
      for (let m = 1; m < pieces; m++) {
        const th = ta + step * m, p = { x: O.x + R * Math.cos(th), y: O.y + R * Math.sin(th) }, v = tan(th);
        mids.push({ x: p.x, y: p.y, hin: { x: p.x - v.x, y: p.y - v.y }, hout: { x: p.x + v.x, y: p.y + v.y } });
      }
      const va = tan(ta), vb = tan(ta + sg * sweep);
      return { aOut: { x: P1.x + va.x, y: P1.y + va.y }, mids, bIn: { x: P2.x - vb.x, y: P2.y - vb.y } };
    }
  }
  const den = cr(d1, d2), w = { x: wx, y: wy };
  if (Math.abs(den) > 1e-6) {
    const u = cr(w, d2) / den, v = cr(d1, w) / den;
    if (u > 0 && v > 0) {
      const K = 0.5523;
      return { aOut: { x: P1.x + d1.x * u * K, y: P1.y + d1.y * u * K }, mids: [], bIn: { x: P2.x - d2.x * v * K, y: P2.y - d2.y * v * K } };
    }
  }
  const h = dot(d1, d2) < 0 ? (L * 2) / 3 : L / 3;
  return { aOut: { x: P1.x + d1.x * h, y: P1.y + d1.y * h }, mids: [], bIn: { x: P2.x - d2.x * h, y: P2.y - d2.y * h } };
}

// 1か所で曲がってつなぐ(P1 から向き d1 で進み、P2 から向き d2 で出ていく)。つなげない形なら null
//   向きが交わる: 2本の線をのばした角 X を、円弧1つで丸める。丸めの長さは X までの近い方(遠い方の辺は X の手前までまっすぐのばす)。
//     opt.radius があれば、その半径(入らなければ小さく)
//   向きが逆で平行(U ターン): 手前で終わっている方をまっすぐのばしてそろえ、半円(opt.reach があれば、そこまではのばす)
//   { T1, T2(円弧の両はし), arc(joinCurve), R(半径), center(半円の中心) }
function oneTurn(P1, d1, P2, d2, opt = {}) {
  if (!d1 || !d2) return null;
  const dot = (u, v) => u.x * v.x + u.y * v.y, cr = (u, v) => u.x * v.y - u.y * v.x;
  const w = { x: P2.x - P1.x, y: P2.y - P1.y }, den = cr(d1, d2);
  let T1, T2, R, center = null;
  if (Math.abs(den) < 1e-6) {
    if (dot(d1, d2) > 0) return null; // 同じ向き(段違い)は1か所では曲がれない
    const pb = dot(w, d1);
    let reach = Math.max(0, pb);
    if (opt.reach) reach = Math.max(reach, dot({ x: opt.reach.x - P1.x, y: opt.reach.y - P1.y }, d1));
    T1 = { x: P1.x + d1.x * reach, y: P1.y + d1.y * reach };
    T2 = { x: P2.x + d1.x * (reach - pb), y: P2.y + d1.y * (reach - pb) };
    R = Math.abs(cr(d1, w)) / 2;
    center = { x: (T1.x + T2.x) / 2, y: (T1.y + T2.y) / 2 };
  } else {
    const u = cr(w, d2) / den, v = cr(d1, w) / den; // P1 + u·d1 = P2 − v·d2 = X
    if (u < -1e-6 || v < -1e-6) return null;
    const X = { x: P1.x + d1.x * u, y: P1.y + d1.y * u };
    const k = Math.tan(Math.acos(Math.max(-1, Math.min(1, dot(d1, d2)))) / 2); // 角から接点まで = 半径 × k
    let t = Math.max(0, Math.min(u, v));
    if (opt.radius != null) t = Math.min(t, opt.radius * k);
    T1 = { x: X.x - d1.x * t, y: X.y - d1.y * t };
    T2 = { x: X.x + d2.x * t, y: X.y + d2.y * t };
    R = k > 1e-9 ? t / k : 0;
  }
  return { T1, T2, R, center, arc: joinCurve(T1, d1, T2, d2) };
}

// oneTurn の結果を点の並びに: Pa の方向線・のばした角の点・円弧の途中の点・Pb の方向線
function placeTurn(Pa, Pb, turn) {
  const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6;
  const { T1, T2, arc } = turn, mids = [];
  delete Pa.hout;
  delete Pb.hin;
  if (near(T1, Pa)) { if (arc.aOut) Pa.hout = arc.aOut; }
  else mids.push(arc.aOut ? { x: T1.x, y: T1.y, hout: arc.aOut } : { x: T1.x, y: T1.y });
  mids.push(...arc.mids);
  if (near(T2, Pb)) { if (arc.bIn) Pb.hin = arc.bIn; }
  else mids.push(arc.bIn ? { x: T2.x, y: T2.y, hin: arc.bIn } : { x: T2.x, y: T2.y });
  return mids;
}

// つないだ所の後片付け(marks の点のまわりだけ): 重なった点を1つに、まっすぐの途中の点・行って戻るだけの点を消す
function tidyJoin(nodes, closed, marks) {
  const same = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-3;
  for (let guard = 0; guard < 1000 && nodes.length > 2; guard++) {
    const n = nodes.length;
    let done = true;
    for (let k = 0; k < n; k++) {
      const v = nodes[k];
      if (!marks.has(v)) continue;
      const pk = (k - 1 + n) % n, nk = (k + 1) % n;
      if (same(v, nodes[nk]) && (closed || nk > k)) {
        const q = nodes[nk], m = { x: v.x, y: v.y };
        if (v.hin) m.hin = v.hin;
        if (q.hout) m.hout = q.hout;
        marks.add(m);
        nodes[k] = m;
        nodes.splice(nk, 1);
        done = false;
        break;
      }
      if (!closed && (k === 0 || k === n - 1)) continue;
      const p = nodes[pk], q = nodes[nk];
      if (v.hin || v.hout || p.hout || q.hin) continue;
      const ux = v.x - p.x, uy = v.y - p.y, wx = q.x - v.x, wy = q.y - v.y, lu = Math.hypot(ux, uy), lw = Math.hypot(wx, wy);
      if (lu > 1e-6 && lw > 1e-6 && Math.abs(ux * wy - uy * wx) / (lu * lw) < 1e-6) {
        nodes.splice(k, 1);
        marks.add(p);
        marks.add(q);
        done = false;
        break;
      }
    }
    if (done) break;
  }
  return nodes;
}

// 2本の辺(A・B = { leaf, r, i, t })をつないで1つのパスにする(色は A。B の図形は消える)。できたら true
export function joinEdges(layer, A, B) {
  const all = leavesOf(layer);
  const la = all.find((x) => x.leaf.id === A.leaf)?.leaf, lb = all.find((x) => x.leaf.id === B.leaf)?.leaf;
  if (!la || !lb) return false;
  const ringList = (p) => pathRings(p).map((r) => ({ nodes: r.nodes, closed: !!r.closed }));
  const pa = structuredClone(asPath(la)), pb = la === lb ? pa : structuredClone(asPath(lb));
  const ringsA = ringList(pa), ringsB = la === lb ? ringsA : ringList(pb);
  const ra = ringsA[A.r], rb = ringsB[B.r];
  if (!ra || !rb || ra === rb) return false;
  if (ra.closed !== rb.closed) { toast('閉じた図形どうし、または開いたパス(線)どうしを選んでください'); return false; }
  const closed = ra.closed, marks = new Set();
  let restA, restB;
  if (closed) {
    const na = ra.nodes, nb = rb.nodes;
    if (A.i >= na.length || B.i >= nb.length) return false;
    const ea = [na[A.i], na[(A.i + 1) % na.length]], eb = [nb[B.i], nb[(B.i + 1) % nb.length]];
    // 近い方のはしどうし = 内側
    let best = null;
    for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) {
      const d = Math.hypot(ea[x].x - eb[y].x, ea[x].y - eb[y].y);
      if (!best || d < best.d - 1e-9) best = { d, x, y };
    }
    restA = restOfRing(na, A.i); // 区間の終わり → … → 始まり。外側のはしを最後に
    if (best.x === 0) restA = reverseNodes(restA);
    restB = restOfRing(nb, B.i); // 外側のはしを最初に
    if (best.y === 1) restB = reverseNodes(restB);
    marks.add(restA[0]);
    marks.add(restB[restB.length - 1]);
  } else {
    // 開いたパス: クリックした所に近い方のはし
    const nearEnd = (ring, pick) => (pick.i + pick.t) / (ring.nodes.length - 1) >= 0.5;
    restA = ra.nodes.map(cloneNode);
    if (!nearEnd(ra, A)) restA = reverseNodes(restA);
    restB = rb.nodes.map(cloneNode);
    if (nearEnd(rb, B)) restB = reverseNodes(restB);
  }
  const OA = restA[restA.length - 1], OB = restB[0], dA = endDir(restA), dB = startDir(restB);
  // 外側: 曲がるのは1か所(届かない方の辺はまっすぐのばす)
  const turn = oneTurn(OA, dA, OB, dB);
  let outer;
  if (turn) outer = placeTurn(OA, OB, turn);
  else {
    // 1か所で曲がれない形(段違いで同じ向き など)は、ベジェ1本で
    const link = joinCurve(OA, dA, OB, dB);
    if (link.aOut) OA.hout = link.aOut; else delete OA.hout;
    if (link.bIn) OB.hin = link.bIn; else delete OB.hin;
    outer = link.mids;
  }
  // 内側(閉じた図形どうし): 外側と同じ中心の円弧(半径 = 外側 − 棒の太さ)。B の内側 → A の内側
  let inner = [];
  if (closed && turn) {
    const IA = restA[0], IB = restB[restB.length - 1], e = startDir(restA), f = endDir(restB);
    const wA = Math.abs(dA.x * (IA.y - OA.y) - dA.y * (IA.x - OA.x)), wB = Math.abs(dB.x * (IB.y - OB.y) - dB.y * (IB.x - OB.x));
    const t2 = oneTurn(IB, f, IA, e, { radius: Math.max(0, turn.R - Math.max(wA, wB)), reach: turn.center });
    if (t2) inner = placeTurn(IB, IA, t2);
  }
  for (const n of [OA, OB, ...outer, ...inner]) marks.add(n);
  const nodes = tidyJoin([...restA, ...outer, ...restB, ...inner], closed, marks);
  if (nodes.length < 2) return false;
  const merged = { nodes, closed: closed && nodes.length >= 3 };
  // A の図形に、つないだ輪と、A・B の残りの輪を入れる
  const rings = ringsA.map((r) => (r === ra ? merged : r)).filter((r) => r !== rb);
  if (la !== lb) rings.push(...ringsB.filter((r) => r !== rb));
  pa.nodes = rings[0].nodes;
  pa.closed = !!rings[0].closed;
  if (rings.length > 1) pa.subpaths = rings.slice(1).map((r) => ({ nodes: r.nodes, closed: !!r.closed }));
  else delete pa.subpaths;
  const edits = new Map([[la.id, pa]]);
  if (la !== lb) edits.set(lb.id, null);
  const topId = all.find((x) => x.leaf.id === la.id).top.id;
  applyLeafEdits(layer, edits, '辺をつなぐ');
  if (layer.shapes.some((s) => s.id === topId)) setSelection(layer, [topId]);
  return true;
}

// 曲げるツールで選んだ1本目の辺(青く太く)
export function drawBendOverlay(ctx) {
  if (state.tool !== 'bend' || !joinPick) return;
  const layer = activeLayer();
  if (!layer || layer.id !== joinPick.layerId) return;
  const leaf = leavesOf(layer).find((x) => x.leaf.id === joinPick.leaf)?.leaf;
  const ring = leaf && ringsOf(leaf)[joinPick.r];
  if (!ring || joinPick.i >= ring.nodes.length) return;
  const a = ring.nodes[joinPick.i], b = ring.nodes[(joinPick.i + 1) % ring.nodes.length];
  const q0 = S(a), q1 = S(b), c1 = S(a.hout || a), c2 = S(b.hin || b);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(q0.x, q0.y);
  ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, q1.x, q1.y);
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 9;
  ctx.stroke();
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.restore();
}
