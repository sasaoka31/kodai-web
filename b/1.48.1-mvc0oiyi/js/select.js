// 矢印(選択)ツール(V)
//   クリック: 図形を選ぶ(他のレイヤーの図形ならそのレイヤーに切り替え) / Shift+クリック: 追加・解除
//   何もない所からドラッグ: 範囲選択 / 選んだ図形をドラッグ: 移動 / 矢印キー: 1px(Shift で 10px)移動
//   枠の角・辺: 拡大縮小(Shift で縦横比固定、Ctrl / Alt で中心から) / 角の外側: 回転(Shift で15°単位)
//   Ctrl+G: グループ化 / Ctrl+Shift+G: グループ解除
//   Alt+ホイール・右クリックメニュー・ツールオプション: ドット化の粗さ
//   ラスターレイヤーで図形のない所をドラッグ: レイヤーの絵全体を移動
// state.selection = { layerId, ids: [図形の id] }(選べるのは1つのベクターレイヤーの中の図形)
import { state, emit, requestRender, toast } from './state.js';
import { hitShape, hitInterior, canRound, translateShape, deformShape, visualBounds, ensureIds, newShapeId, shapeBounds, toPath, pathRings } from './vector.js';
import { pushVector, pushAppend, hitTol, rasterMove } from './tools.js';
import { propEntry, moveEntry } from './history.js';
import { setActiveLayer } from './layers.js';
import { stepPixel, stepToPixel, pixelToStep, pixelLabel, PIXEL_STEPS, hasPixelGrad } from './pixelfx.js';
import { outlineSelection, borderDialog } from './outline.js';
import { copySelection, cutSelection, paste, withNewIds } from './clipboard.js';
import { pathfinder, PATHFINDER } from './pathfinder.js';
import { rotateGrads } from './gradient.js';
import { pixelGradDialog } from './dotgrad.js';
import { flip } from './reflect.js';
import { guideAt, beginGuideDrag, moveGuideDrag, endGuideDrag, smartTargets, smartSnap, setBoundsFn, constrain } from './guides.js';
import { recordTransform } from './repeat.js';

const S = (p) => state.view.toScreen(p);

// ---- 選択の状態 ----

export function selectionLayer() {
  const s = state.selection;
  if (!s || !state.doc) return null;
  const l = state.doc.layerById(s.layerId);
  return l && l.type === 'vector' ? l : null;
}

export function selectedItems() {
  const l = selectionLayer();
  if (!l) return [];
  const ids = new Set(state.selection.ids);
  const out = [];
  l.shapes.forEach((shape, index) => { if (ids.has(shape.id)) out.push({ shape, index }); });
  return out;
}

export function setSelection(layer, ids) {
  flushPixel();
  state.selection = layer && ids.length ? { layerId: layer.id, ids: [...ids] } : null;
  emit('selection');
  requestRender();
}

export function clearSelection() {
  flushPixel();
  if (!state.selection) return;
  state.selection = null;
  emit('selection');
  requestRender();
}

function unionBounds(list) {
  let r = null;
  for (const b of list) r = r ? { x0: Math.min(r.x0, b.x0), y0: Math.min(r.y0, b.y0), x1: Math.max(r.x1, b.x1), y1: Math.max(r.y1, b.y1) } : { ...b };
  return r;
}

export function selectionBounds(items = selectedItems()) {
  return unionBounds(items.map((it) => visualBounds(it.shape)));
}

// 一番上の図形を全レイヤーから探す(表示中・ロックなしのベクターレイヤー)。
// 見えている塗り・線に当たらなければ、塗りのない形の内側でも選べる(ふちを狙わなくていいように)
function hitAnyObject(ev) {
  const doc = state.doc;
  const tol = hitTol();
  const layers = doc.layers.filter((l) => l.type === 'vector' && l.visible && !l.locked).reverse();
  for (const test of [(s) => hitShape(s, ev.x, ev.y, tol), (s) => hitInterior(s, ev.x, ev.y)]) {
    for (const l of layers) {
      const shapes = l.shapes;
      for (let i = shapes.length - 1; i >= 0; i--) if (test(shapes[i])) return { layer: l, index: i, shape: shapes[i] };
    }
  }
  return null;
}

// ---- 変形用の図形操作 ----

// 軸に沿った拡大縮小(四角・楕円は種類を保つ)
export function scaleShape(s, ax, ay, sx, sy) {
  const X = (x) => ax + (x - ax) * sx, Y = (y) => ay + (y - ay) * sy;
  switch (s.type) {
    case 'group': return { ...s, children: s.children.map((c) => scaleShape(c, ax, ay, sx, sy)) };
    case 'rect': {
      const x0 = X(s.x), x1 = X(s.x + s.w), y0 = Y(s.y), y1 = Y(s.y + s.h);
      return { ...s, x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
    }
    case 'ellipse': return { ...s, cx: X(s.cx), cy: Y(s.cy), rx: Math.abs(s.rx * sx), ry: Math.abs(s.ry * sy) };
    default: return deformShape(s, (x, y) => ({ x: X(x), y: Y(y) }));
  }
}

export function rotateShape(s, cx, cy, a) {
  const c = Math.cos(a), sn = Math.sin(a);
  return rotateGrads(deformShape(s, (x, y) => ({ x: cx + (x - cx) * c - (y - cy) * sn, y: cy + (x - cx) * sn + (y - cy) * c })), (a * 180) / Math.PI);
}

// ---- ツール本体 ----

const HANDLES = [
  ['nw', 0, 0], ['n', 0.5, 0], ['ne', 1, 0], ['e', 1, 0.5], ['se', 1, 1], ['s', 0.5, 1], ['sw', 0, 1], ['w', 0, 0.5],
];

function handlePoints(b) {
  return HANDLES.map(([name, u, v]) => ({ name, u, v, p: { x: b.x0 + (b.x1 - b.x0) * u, y: b.y0 + (b.y1 - b.y0) * v } }));
}

export const selectTool = {
  cursor: 'default',

  handleAt(ev, items) {
    const b = selectionBounds(items);
    if (!b) return null;
    const s = { x: ev.sx, y: ev.sy };
    for (const h of handlePoints(b)) {
      const q = S(h.p);
      if (Math.abs(q.x - s.x) <= 6 && Math.abs(q.y - s.y) <= 6) return { kind: 'scale', h, b };
    }
    // 角の外側 20px 以内は回転
    const a = S({ x: b.x0, y: b.y0 }), c = S({ x: b.x1, y: b.y1 });
    const inside = s.x >= a.x && s.x <= c.x && s.y >= a.y && s.y <= c.y;
    if (!inside) {
      for (const [x, y] of [[a.x, a.y], [c.x, a.y], [c.x, c.y], [a.x, c.y]]) {
        if (Math.hypot(x - s.x, y - s.y) <= 20) return { kind: 'rotate', b };
      }
    }
    return null;
  },

  cursorFor(ev) {
    const items = selectedItems();
    const h = items.length ? this.handleAt(ev, items) : null;
    if (!h) { const g = guideAt(ev); if (g) return g.axis === 'v' ? 'col-resize' : 'row-resize'; }
    if (!h) return hitAnyObject(ev) ? 'move' : 'default';
    if (h.kind === 'rotate') return 'alias';
    const n = h.h.name;
    return n === 'n' || n === 's' ? 'ns-resize' : n === 'e' || n === 'w' ? 'ew-resize' : n === 'nw' || n === 'se' ? 'nwse-resize' : 'nesw-resize';
  },

  down(ev) {
    this.drag = null;
    const doc = state.doc;
    const items = selectedItems();
    // 1) 選択枠のハンドル
    if (ev.button === 0 && items.length && !selectionLayer().locked) {
      const h = this.handleAt(ev, items);
      if (h) return this.begin(h, ev, items);
    }
    // 1.5) ガイド(定規から引き出した線)をつかむ: ドラッグで動かす・定規へ戻すと消える(guides.js)
    if (ev.button === 0 && !ev.shift) {
      const g = guideAt(ev);
      if (g) { this.drag = beginGuideDrag(g); return true; }
    }
    // 2) 図形をクリック
    const hit = hitAnyObject(ev);
    if (hit) {
      if (hit.layer.id !== doc.activeId) setActiveLayer(hit.layer.id);
      ensureIds(hit.layer.shapes);
      const id = hit.shape.id;
      let ids = state.selection?.layerId === hit.layer.id ? [...state.selection.ids] : [];
      if (ev.shift && ev.button === 0) {
        setSelection(hit.layer, ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
        return false;
      }
      if (!ids.includes(id)) ids = [id];
      setSelection(hit.layer, ids);
      if (ev.button !== 0) return false;
      return this.begin({ kind: 'move' }, ev, selectedItems());
    }
    if (ev.button !== 0) return false;
    // 3) ラスターレイヤーなら絵全体を移動
    const layer = doc.activeLayer;
    if (layer?.type === 'raster' && !ev.shift) {
      clearSelection();
      if (rasterMove.down(ev)) { this.drag = { kind: 'raster' }; return true; }
      return false;
    }
    // 4) 範囲選択
    if (!ev.shift) clearSelection();
    this.drag = { kind: 'marquee', start: { x: ev.x, y: ev.y }, cur: { x: ev.x, y: ev.y }, add: ev.shift, keep: state.selection?.ids || [] };
    return true;
  },

  begin(h, ev, items) {
    const layer = selectionLayer();
    // 移動は軽い方法で: ドラッグ中は図形を書き換えず、描いた絵をずらして見せるだけ(離したときに1回だけ動かす)。
    // Ctrl を押しながらドラッグすると複製。レイヤー全体のドット化があるときは今までどおり(毎回動かす)
    if (h.kind === 'move' && !(layer.pixel >= 1) && !hasPixelGrad(layer.pixelGrad)) {
      const ids = items.map((it) => it.shape.id);
      setBoundsFn(visualBounds);
      this.drag = { kind: 'move', fast: true, layer, start: { x: ev.x, y: ev.y }, ids, dup: !!ev.ctrl, changed: false, b0: selectionBounds(items), targets: smartTargets(new Set(ids)) };
      return true;
    }
    this.drag = {
      ...h, layer,
      start: { x: ev.x, y: ev.y },
      before: structuredClone(layer.shapes),
      orig: new Map(items.map((it) => [it.shape.id, structuredClone(it.shape)])),
      changed: false,
    };
    return true;
  },

  move(ev) {
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'raster') { rasterMove.move(ev); return; }
    if (d.kind === 'guide') { moveGuideDrag(d, ev); return; }
    if (d.kind === 'marquee') { d.cur = { x: ev.x, y: ev.y }; requestRender(); return; }
    if (d.fast) {
      d.dx = ev.x - d.start.x;
      d.dy = ev.y - d.start.y;
      // Shift: まっすぐ(横・縦・45°)だけ。吸い付きは、その向きにだけ
      let axis = 'both';
      if (ev.shift) ({ dx: d.dx, dy: d.dy, axis } = constrain(d.dx, d.dy));
      // ガイド・スマートガイド(ほかの図形・アートボードの端と真ん中)に吸い付く(guides.js)。Alt で吸い付かない
      state.smart = null;
      if (d.b0 && !ev.alt && axis !== 'none') {
        const sn = smartSnap({ x0: d.b0.x0 + d.dx, y0: d.b0.y0 + d.dy, x1: d.b0.x1 + d.dx, y1: d.b0.y1 + d.dy }, d.targets, { x: axis !== 'y', y: axis !== 'x' });
        d.dx += sn.dx; d.dy += sn.dy;
        state.smart = sn.marks;
      }
      d.dup = d.dup || !!ev.ctrl;
      d.changed = d.dx !== 0 || d.dy !== 0;
      state.moving = { layerId: d.layer.id, ids: new Set(d.ids), dx: d.dx, dy: d.dy, dup: d.dup, token: d };
      requestRender();
      return;
    }
    let fn;
    if (d.kind === 'move') {
      let dx = ev.x - d.start.x, dy = ev.y - d.start.y;
      if (ev.shift) ({ dx, dy } = constrain(dx, dy)); // Shift: まっすぐ
      d.op = { kind: 'move', dx, dy };
      fn = (s) => translateShape(s, dx, dy);
    } else if (d.kind === 'rotate') {
      const cx = (d.b.x0 + d.b.x1) / 2, cy = (d.b.y0 + d.b.y1) / 2;
      let a = Math.atan2(ev.y - cy, ev.x - cx) - Math.atan2(d.start.y - cy, d.start.x - cx);
      if (ev.shift) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
      d.op = { kind: 'rotate', a };
      fn = (s) => rotateShape(s, cx, cy, a);
    } else {
      // 拡大縮小: 反対側を固定。Ctrl(Alt)なら中心を固定(中心に向かって縮む・中心から広がる)
      const { u, v } = d.h, b = d.b;
      const centered = ev.ctrl || ev.alt;
      const ax = centered ? (b.x0 + b.x1) / 2 : b.x0 + (b.x1 - b.x0) * (1 - u);
      const ay = centered ? (b.y0 + b.y1) / 2 : b.y0 + (b.y1 - b.y0) * (1 - v);
      const hx = b.x0 + (b.x1 - b.x0) * u, hy = b.y0 + (b.y1 - b.y0) * v;
      let sx = u === 0.5 ? 1 : (ev.x - ax) / (hx - ax || 1);
      let sy = v === 0.5 ? 1 : (ev.y - ay) / (hy - ay || 1);
      // Shift: 縦横比を保つ(角は大きく動かした方に、辺は動かした向きの倍率をもう片方にも)
      if (ev.shift) {
        if (u !== 0.5 && v !== 0.5) { const k = Math.max(Math.abs(sx), Math.abs(sy)); sx = Math.sign(sx || 1) * k; sy = Math.sign(sy || 1) * k; }
        else if (u === 0.5) sx = Math.abs(sy);
        else sy = Math.abs(sx);
      }
      // 辺のハンドルを Shift で動かすときは、もう片方の向きは中心から広げる
      const bx = ev.shift && u === 0.5 ? (b.x0 + b.x1) / 2 : ax, by = ev.shift && v === 0.5 ? (b.y0 + b.y1) / 2 : ay;
      if (Math.abs(sx) < 0.01) sx = 0.01 * (Math.sign(sx) || 1);
      if (Math.abs(sy) < 0.01) sy = 0.01 * (Math.sign(sy) || 1);
      d.op = { kind: 'scale', sx, sy, u: (bx - b.x0) / (b.x1 - b.x0 || 1), v: (by - b.y0) / (b.y1 - b.y0 || 1) };
      fn = (s) => scaleShape(s, bx, by, sx, sy);
    }
    const shapes = d.layer.shapes;
    for (let i = 0; i < shapes.length; i++) {
      const o = d.orig.get(shapes[i].id);
      if (o) shapes[i] = fn(o);
    }
    d.changed = true;
    d.layer.touch();
    requestRender();
  },

  up(ev) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.kind === 'raster') { rasterMove.up(ev); return; }
    if (d.kind === 'guide') { endGuideDrag(d); return; }
    if (d.kind === 'marquee') {
      const layer = state.doc.activeLayer;
      if (layer?.type !== 'vector') { requestRender(); return; }
      const r = { x0: Math.min(d.start.x, d.cur.x), y0: Math.min(d.start.y, d.cur.y), x1: Math.max(d.start.x, d.cur.x), y1: Math.max(d.start.y, d.cur.y) };
      ensureIds(layer.shapes);
      const hits = layer.shapes.filter((s) => {
        const b = visualBounds(s);
        return b.x1 >= r.x0 && b.x0 <= r.x1 && b.y1 >= r.y0 && b.y0 <= r.y1;
      }).map((s) => s.id);
      setSelection(layer, d.add ? [...new Set([...d.keep, ...hits])] : hits);
      return;
    }
    if (d.fast) {
      state.moving = null;
      state.smart = null;
      if (!d.changed) { requestRender(); return; }
      recordTransform({ kind: 'move', dx: d.dx, dy: d.dy, copy: d.dup }); // Ctrl+D でくり返せるように(repeat.js)
      const ids = new Set(d.ids);
      if (d.dup) {
        // 複製: 動かした先に新しい図形を置いて、それを選ぶ(元の図形はそのまま)
        const copies = d.layer.shapes.filter((s) => ids.has(s.id)).map((s) => translateShape(withNewIds(s), d.dx, d.dy));
        pushAppend('複製', d.layer, copies);
        setSelection(d.layer, copies.map((s) => s.id));
      } else {
        d.layer.shapes = d.layer.shapes.map((s) => (ids.has(s.id) ? translateShape(s, d.dx, d.dy) : s));
        d.layer.touch();
        state.history.push(moveEntry('移動', d.layer, d.ids, d.dx, d.dy, translateShape));
        requestRender();
      }
      emit('selection');
      return;
    }
    if (!d.changed) return;
    if (d.op) recordTransform(d.op);
    const label = d.kind === 'move' ? '移動' : d.kind === 'rotate' ? '回転' : '拡大縮小';
    pushVector(label, d.layer, d.before);
    emit('selection');
  },
};

// ---- 選択への操作 ----

export function modifySelection(label, fn) {
  const layer = selectionLayer();
  const items = selectedItems();
  if (!items.length) { toast('図形が選択されていません'); return; }
  if (layer.locked) { toast('レイヤーがロックされています'); return; }
  const before = structuredClone(layer.shapes);
  if (fn(items, layer) === false) return;
  pushVector(label, layer, before);
  emit('selection');
}

// グループの中まで含めた、色を持つ図形すべてに fn を適用
export function eachLeaf(items, fn) {
  const walk = (s) => { if (s.type === 'group') s.children.forEach(walk); else fn(s); };
  for (const it of items) walk(it.shape);
}

export function deleteSelection() {
  modifySelection('削除', (items, layer) => {
    const ids = new Set(items.map((it) => it.shape.id));
    layer.shapes = layer.shapes.filter((s) => !ids.has(s.id));
    state.selection = null;
  });
}

export function nudgeSelection(dx, dy) {
  recordTransform({ kind: 'move', dx, dy });
  modifySelection('移動', (items, layer) => {
    const ids = new Set(items.map((it) => it.shape.id));
    layer.shapes = layer.shapes.map((s) => (ids.has(s.id) ? translateShape(s, dx, dy) : s));
  });
}

// 重ね順: dir = 1 前面へ / -1 背面へ / 'front' 最前面へ / 'back' 最背面へ(選んだ図形どうしの順は、そのまま)
export function reorderSelection(dir) {
  if (dir === 'front' || dir === 'back') {
    modifySelection(dir === 'front' ? '最前面へ' : '最背面へ', (items, layer) => {
      const ids = new Set(items.map((it) => it.shape.id));
      const pick = layer.shapes.filter((s) => ids.has(s.id)), rest = layer.shapes.filter((s) => !ids.has(s.id));
      const next = dir === 'front' ? [...rest, ...pick] : [...pick, ...rest];
      if (next.every((s, i) => s === layer.shapes[i])) return false;
      layer.shapes = next;
    });
    return;
  }
  modifySelection(dir > 0 ? '前面へ' : '背面へ', (items, layer) => {
    const ids = new Set(items.map((it) => it.shape.id));
    const a = layer.shapes;
    const order = dir > 0 ? [...a.keys()].reverse() : [...a.keys()];
    let moved = false;
    for (const i of order) {
      const j = i + dir;
      if (!ids.has(a[i].id) || j < 0 || j >= a.length || ids.has(a[j].id)) continue;
      [a[i], a[j]] = [a[j], a[i]];
      moved = true;
    }
    return moved ? undefined : false;
  });
}

export function selectAll() {
  const layer = state.doc.activeLayer;
  if (layer?.type !== 'vector') { toast('ベクターレイヤーを選んでください'); return; }
  ensureIds(layer.shapes);
  setSelection(layer, layer.shapes.map((s) => s.id));
}

export function groupSelection() {
  const items = selectedItems();
  if (!items.length) { toast('図形が選択されていません'); return; }
  let gid = null;
  modifySelection('グループ化', (its, layer) => {
    const ids = new Set(its.map((it) => it.shape.id));
    const top = Math.max(...its.map((it) => it.index));
    const group = { type: 'group', id: newShapeId(), children: its.map((it) => it.shape) };
    const rest = [];
    let at = 0;
    layer.shapes.forEach((s, i) => {
      if (ids.has(s.id)) { if (i === top) at = rest.length; return; }
      rest.push(s);
    });
    rest.splice(at, 0, group);
    layer.shapes = rest;
    gid = group.id;
  });
  if (gid) setSelection(selectionLayer() || state.doc.activeLayer, [gid]);
}

export function ungroupSelection() {
  const items = selectedItems().filter((it) => it.shape.type === 'group');
  if (!items.length) { toast('グループが選択されていません'); return; }
  let newIds = [];
  modifySelection('グループ解除', (its, layer) => {
    const out = [];
    for (const s of layer.shapes) {
      if (s.type !== 'group' || !its.some((it) => it.shape.id === s.id)) { out.push(s); continue; }
      for (const c of s.children) {
        // グループに付いていたドット化・リグのバインドは子に引き継ぐ
        const child = { ...c };
        if (s.pixel >= 1 && !(child.pixel >= 1)) child.pixel = s.pixel;
        if (s.rigBind && !child.rigBind) child.rigBind = { ...s.rigBind };
        out.push(child);
        newIds.push(child.id);
      }
    }
    layer.shapes = out;
  });
  const layer = selectionLayer() || state.doc.activeLayer;
  const keep = selectedItems().map((it) => it.shape.id);
  setSelection(layer, [...keep, ...newIds]);
}

// ---- ドット化 ----
// 選択中の図形(なければアクティブレイヤー)の粗さを変える。
// ホイールやスライダーの連続した操作は、止まってから1つの履歴にまとめる

let pending = null;

export function flushPixel() {
  if (!pending) return;
  const p = pending;
  pending = null;
  clearTimeout(p.timer);
  if (p.kind === 'shapes') pushVector('ドット化', p.layer, p.before);
  else if (p.before !== p.layer.pixel) state.history.push(propEntry('レイヤーのドット化', p.layer, 'pixel', p.before, p.layer.pixel));
}

export function currentPixel() {
  const items = selectedItems();
  if (items.length) return items[0].shape.pixel || 0;
  return state.doc.activeLayer?.pixel || 0;
}

export function setPixelLive(value) {
  const v = value >= 1 ? +(+value).toFixed(3) : 0;
  const items = selectedItems();
  const layer = items.length ? selectionLayer() : state.doc.activeLayer;
  if (!layer) return;
  if (layer.locked) { toast('レイヤーがロックされています'); return; }
  const kind = items.length ? 'shapes' : 'layer';
  if (pending && (pending.layer !== layer || pending.kind !== kind)) flushPixel();
  if (!pending) pending = { layer, kind, before: kind === 'shapes' ? structuredClone(layer.shapes) : layer.pixel || 0 };
  if (kind === 'shapes') {
    for (const it of items) {
      if (v) it.shape.pixel = v;
      else delete it.shape.pixel;
    }
    layer.touch();
  } else {
    layer.pixel = v;
  }
  clearTimeout(pending.timer);
  pending.timer = setTimeout(flushPixel, 500);
  state.dirty = true;
  emit('title');
  emit('pixel', v);
  requestRender();
}

export function stepPixelSelection(dir) {
  const v = stepPixel(currentPixel(), dir);
  setPixelLive(v);
  toast(v ? `ドット化: ${pixelLabel(v)}(${pixelToStep(v)} / ${PIXEL_STEPS} 段階)` : 'ドット化: なし');
}

// ---- 角丸 ----
// 選んだ図形(グループの中も)の四角・パスの角を丸める。値は図形に残るので、あとで変えたり 0 で戻したりできる

let roundPending = null;

function roundLeaves(items) {
  const out = [];
  eachLeaf(items, (s) => { if (canRound(s)) out.push(s); });
  return out;
}

export function currentRound() {
  return roundLeaves(selectedItems())[0]?.round || 0;
}

function flushRound() {
  if (!roundPending) return;
  const p = roundPending;
  roundPending = null;
  clearTimeout(p.timer);
  pushVector('角丸', p.layer, p.before);
  emit('selection');
}

export function setRoundLive(value) {
  const layer = selectionLayer();
  const leaves = roundLeaves(selectedItems());
  if (!layer || !leaves.length) return;
  if (layer.locked) { toast('レイヤーがロックされています'); return; }
  if (!roundPending) roundPending = { layer, before: structuredClone(layer.shapes) };
  const v = Math.max(0, Math.round(value * 2) / 2);
  for (const s of leaves) {
    if (v) s.round = v;
    else delete s.round;
  }
  layer.touch();
  clearTimeout(roundPending.timer);
  roundPending.timer = setTimeout(flushRound, 500);
  requestRender();
}

// ---- 右クリックメニュー ----

export function openContextMenu(clientX, clientY) {
  closeContextMenu();
  const items = selectedItems();
  const menu = document.createElement('div');
  menu.id = 'ctx-menu';
  const target = items.length ? `選択中の図形(${items.length}個)` : `レイヤー「${state.doc.activeLayer.name}」`;
  menu.innerHTML = `<div class="ctx-title">ドット化 — ${target}</div>`;
  const row = document.createElement('div');
  row.className = 'ctx-row';
  const range = document.createElement('input');
  range.type = 'range';
  range.min = '0';
  range.max = String(PIXEL_STEPS);
  range.value = String(pixelToStep(currentPixel()));
  const val = document.createElement('em');
  const show = () => { val.textContent = pixelLabel(stepToPixel(Number(range.value))); };
  show();
  range.oninput = () => { setPixelLive(stepToPixel(Number(range.value))); show(); };
  row.append(range, val);
  menu.append(row);
  const presets = document.createElement('div');
  presets.className = 'ctx-presets';
  for (const v of [0, 1, 2, 4, 8, 16, 32]) {
    const b = document.createElement('button');
    b.textContent = v ? `${v}` : 'なし';
    b.onclick = () => { setPixelLive(v); range.value = String(pixelToStep(v)); show(); };
    presets.append(b);
  }
  menu.append(presets);
  const gradBtn = document.createElement('button');
  gradBtn.className = 'ctx-item';
  gradBtn.textContent = 'グラデーションでドット化…';
  gradBtn.title = '場所によって粗さの変わるドット(四角いドット / 網点)';
  gradBtn.onclick = () => { closeContextMenu(); pixelGradDialog(); };
  menu.append(gradBtn);
  const add = (label, fn, enabled = true) => {
    const b = document.createElement('button');
    b.className = 'ctx-item';
    b.textContent = label;
    b.disabled = !enabled;
    b.onclick = () => { closeContextMenu(); fn(); };
    menu.append(b);
  };
  if (items.length && roundLeaves(items).length) {
    // 角丸: スライダーを動かすとその場で丸くなる(0 = 角のまま)
    menu.append(document.createElement('hr'));
    const title = document.createElement('div');
    title.className = 'ctx-title';
    title.textContent = '角丸(四角・多角形・パスの角)';
    const rrow = document.createElement('div');
    rrow.className = 'ctx-row';
    const rr = document.createElement('input');
    rr.type = 'range';
    rr.min = '0';
    rr.max = '100';
    rr.step = '0.5';
    rr.value = String(currentRound());
    const rnum = document.createElement('input');
    rnum.type = 'number';
    rnum.className = 'ctx-num';
    Object.assign(rnum, { min: 0, max: 1000, step: 0.5, value: currentRound() });
    rr.oninput = () => { rnum.value = rr.value; setRoundLive(Number(rr.value)); };
    rnum.onchange = () => { rr.value = rnum.value; setRoundLive(Number(rnum.value) || 0); };
    rnum.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') rnum.onchange(); };
    rrow.append(rr, rnum, document.createTextNode('px'));
    menu.append(title, rrow);
  }
  menu.append(document.createElement('hr'));
  if (items.length) {
    add('カット (Ctrl+X)', () => cutSelection());
    add('コピー (Ctrl+C)', () => copySelection());
  }
  add('ペースト (Ctrl+V)', () => paste(false));
  add('同じ位置にペースト (Ctrl+Shift+V)', () => paste(true));
  if (items.length) {
    menu.append(document.createElement('hr'));
    add('グループ化 (Ctrl+G)', groupSelection);
    add('グループ解除 (Ctrl+Shift+G)', ungroupSelection, items.some((it) => it.shape.type === 'group'));
    if (items.length >= 2) {
      const sub = document.createElement('div');
      sub.className = 'ctx-pf';
      sub.innerHTML = '<span>パスファインダー</span>';
      for (const [k, v] of Object.entries(PATHFINDER)) {
        const b = document.createElement('button');
        b.textContent = v.label;
        b.title = v.hint;
        b.onclick = () => { closeContextMenu(); pathfinder(k); };
        sub.append(b);
      }
      menu.append(sub);
    }
    add('左右反転', () => flip('h', { usePivot: false }));
    add('上下反転', () => flip('v', { usePivot: false }));
    add('パスのアウトライン化 (Ctrl+Shift+O)', () => outlineSelection());
    add('縁取りを作成... (Ctrl+Shift+B)', () => borderDialog());
    add('最前面へ (Ctrl+Shift+])', () => reorderSelection('front'));
    add('前面へ (Ctrl+])', () => reorderSelection(1));
    add('背面へ (Ctrl+[)', () => reorderSelection(-1));
    add('最背面へ (Ctrl+Shift+[)', () => reorderSelection('back'));
    add('削除 (Delete)', deleteSelection);
  }
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(clientX, innerWidth - r.width - 8) + 'px';
  menu.style.top = Math.min(clientY, innerHeight - r.height - 8) + 'px';
  setTimeout(() => {
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onEsc, true);
  });
}

function onOutside(e) {
  if (!e.target.closest('#ctx-menu')) closeContextMenu();
}

function onEsc(e) {
  if (e.key === 'Escape') { e.stopPropagation(); closeContextMenu(); }
}

export function closeContextMenu() {
  flushRound();
  document.getElementById('ctx-menu')?.remove();
  document.removeEventListener('pointerdown', onOutside, true);
  document.removeEventListener('keydown', onEsc, true);
}

// ---- 画面への表示 ----

// 選んだ図形のアンカーポイント(節点)。多すぎるときは出さない
const MAX_ANCHORS = 20000;
export function anchorPoints(shape, out = []) {
  if (shape.type === 'group') { shape.children.forEach((c) => anchorPoints(c, out)); return out; }
  if (shape.type === 'line') { out.push({ x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 }); return out; }
  if (shape.type === 'rect' || shape.type === 'ellipse' || shape.type === 'path') {
    const p = shape.type === 'path' ? shape : toPath(shape);
    for (const r of pathRings(p)) for (const n of r.nodes) { out.push(n); if (out.length > MAX_ANCHORS) return out; }
  }
  return out;
}

function drawAnchors(ctx, items, off) {
  const pts = [];
  for (const it of items) { anchorPoints(it.shape, pts); if (pts.length > MAX_ANCHORS) return; }
  const path = new Path2D();
  for (const n of pts) {
    const q = S({ x: n.x + off.x, y: n.y + off.y });
    path.rect(Math.round(q.x) - 2.5, Math.round(q.y) - 2.5, 5, 5);
  }
  ctx.fillStyle = '#fff';
  ctx.fill(path);
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#3b82f6';
  ctx.stroke(path);
}

// 矢印ツール以外(図形ツールなど)でも、選んでいる図形の枠とアンカーポイントは出す(ハンドルは矢印ツールだけ)
const OVERLAY_TOOLS = new Set(['move', 'reflect', 'rect', 'ellipse', 'line', 'polygon', 'path', 'text']);

export function drawSelectionOverlay(ctx) {
  if (!OVERLAY_TOOLS.has(state.tool) || !state.doc) return;
  const handles = state.tool === 'move';
  const d = selectTool.drag;
  if (d?.kind === 'marquee') {
    const a = S(d.start), b = S(d.cur);
    ctx.fillStyle = 'rgba(59,130,246,0.12)';
    ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  }
  const items = selectedItems();
  if (!items.length) return;
  // 移動中(軽い方法)は、ずらした位置に出す
  const mv = state.moving;
  const off = mv && mv.layerId === selectionLayer().id ? { x: mv.dx, y: mv.dy } : { x: 0, y: 0 };
  const SS = (p) => S({ x: p.x + off.x, y: p.y + off.y });
  // 1つずつの外形(薄く)
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(59,130,246,0.55)';
  for (const it of items) {
    const b = shapeBounds(it.shape);
    const p = SS({ x: b.x0, y: b.y0 }), q = SS({ x: b.x1, y: b.y1 });
    ctx.strokeRect(Math.round(p.x) + 0.5, Math.round(p.y) + 0.5, Math.round(q.x - p.x), Math.round(q.y - p.y));
  }
  drawAnchors(ctx, items, off);
  // 全体の枠とハンドル
  const b = selectionBounds(items);
  const p = SS({ x: b.x0, y: b.y0 }), q = SS({ x: b.x1, y: b.y1 });
  ctx.strokeStyle = '#3b82f6';
  ctx.strokeRect(Math.round(p.x) + 0.5, Math.round(p.y) + 0.5, Math.round(q.x - p.x), Math.round(q.y - p.y));
  if (selectionLayer().locked || !handles) return;
  for (const h of handlePoints(b)) {
    const s = SS(h.p);
    ctx.fillStyle = '#fff';
    ctx.fillRect(Math.round(s.x) - 4, Math.round(s.y) - 4, 8, 8);
    ctx.strokeRect(Math.round(s.x) - 3.5, Math.round(s.y) - 3.5, 7, 7);
  }
}
