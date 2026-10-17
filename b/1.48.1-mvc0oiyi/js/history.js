// Undo/Redo。各エントリは { label, undo(), redo() }
import { TILE } from './tiles.js';

export class History {
  constructor(limit = 200) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
    this.onChange = null;
  }

  push(entry) {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.onChange?.('push', entry);
  }

  undo() {
    const e = this.undoStack.pop();
    if (!e) return;
    e.undo();
    this.redoStack.push(e);
    this.onChange?.('undo', e);
  }

  redo() {
    const e = this.redoStack.pop();
    if (!e) return;
    e.redo();
    this.undoStack.push(e);
    this.onChange?.('redo', e);
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.onChange?.('clear', null);
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }
}

// 描画の変更は「セル(レイヤー×フレーム)」単位で記録する。
// エントリに layer と cel を持たせ、Undo 時にそのフレームへ移動できるようにする。

// ラスターの変更はタイル単位。coords のタイルの変更前後を保存し、fn() で実際の変更を行う。
function snapTile(tiles, tx, ty) {
  const t = tiles.get(tx, ty);
  return t ? t.ctx.getImageData(0, 0, TILE, TILE) : null;
}

function applyTiles(tiles, coords, snaps) {
  coords.forEach(([tx, ty], i) => {
    if (snaps[i]) tiles.ensure(tx, ty).ctx.putImageData(snaps[i], 0, 0);
    else tiles.delete(tx, ty);
  });
}

export function recordTiles(history, label, layer, coords, fn) {
  const cel = layer.cel;
  const seen = new Set();
  const uniq = coords.filter(([tx, ty]) => {
    const k = tx + ',' + ty;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const before = uniq.map(([tx, ty]) => snapTile(cel.tiles, tx, ty));
  fn();
  cel.version++;
  const after = uniq.map(([tx, ty]) => snapTile(cel.tiles, tx, ty));
  history.push({
    label, layer, cel,
    undo: () => { applyTiles(cel.tiles, uniq, before); cel.version++; },
    redo: () => { applyTiles(cel.tiles, uniq, after); cel.version++; },
  });
}

// ベクターの図形リストの変更
// 図形を足した(最後に)ときの履歴。足した図形だけを持つ(1つでも配列でも)
export function appendEntry(label, layer, shape) {
  const cel = layer.cel;
  const list = structuredClone(Array.isArray(shape) ? shape : [shape]);
  const ids = new Set(list.map((s) => s.id));
  return {
    label, layer, cel,
    undo: () => { cel.shapes = cel.shapes.filter((x) => !ids.has(x.id)); cel.version++; },
    redo: () => { cel.shapes.push(...structuredClone(list)); cel.version++; },
  };
}

// 図形を動かしたときの履歴(ずらした量だけを持つ。レイヤー全体をコピーしないので、大きな図形でも軽い)
export function moveEntry(label, layer, ids, dx, dy, translate) {
  const cel = layer.cel;
  const set = new Set(ids);
  const shift = (x, y) => { cel.shapes = cel.shapes.map((s) => (set.has(s.id) ? translate(s, x, y) : s)); cel.version++; };
  return { label, layer, cel, undo: () => shift(-dx, -dy), redo: () => shift(dx, dy) };
}

// いくつかの図形を書き換えたときの履歴(書き換えた図形の前後だけを持つ)
export function replaceEntry(label, layer, before, after) {
  const cel = layer.cel;
  const b = structuredClone(before), a = structuredClone(after); // Map でなく [[id, shape]]
  const put = (list) => { const m = new Map(list); cel.shapes = cel.shapes.map((s) => (m.has(s.id) ? structuredClone(m.get(s.id)) : s)); cel.version++; };
  return { label, layer, cel, undo: () => put(b), redo: () => put(a) };
}

export function vectorEntry(label, layer, before, after) {
  const cel = layer.cel;
  const b = structuredClone(before);
  const a = structuredClone(after);
  return {
    label, layer, cel,
    undo: () => { cel.shapes = structuredClone(b); cel.version++; },
    redo: () => { cel.shapes = structuredClone(a); cel.version++; },
  };
}

// フレーム構成(追加・削除・並べ替え・時間)の変更
export function snapshotFrames(doc, timeline) {
  return {
    frames: doc.frames.map((f) => ({ ...f })),
    cels: doc.layers.map((l) => [l, l.cels.slice()]),
    frame: timeline.frame,
  };
}

export function framesEntry(label, doc, timeline, before, after) {
  const restore = (s) => {
    doc.frames = s.frames.map((f) => ({ ...f }));
    for (const [l, cels] of s.cels) l.cels = cels.slice();
    timeline.frame = Math.min(s.frame, doc.frames.length - 1);
  };
  return { label, frames: true, undo: () => restore(before), redo: () => restore(after) };
}

// レイヤー構成(追加・削除・並べ替え・結合)の変更
export function snapshotLayers(doc) {
  return { layers: [...doc.layers], activeId: doc.activeId };
}

export function layersEntry(label, doc, before, after) {
  return {
    label,
    undo: () => { doc.layers = [...before.layers]; doc.activeId = before.activeId; },
    redo: () => { doc.layers = [...after.layers]; doc.activeId = after.activeId; },
  };
}

// リグの設定(ボーン・格子・バインド)の変更
export function snapshotRig(doc) {
  return { rig: structuredClone(doc.rig), binds: doc.layers.map((l) => [l, l.rigBind ? { ...l.rigBind } : null]) };
}

export function rigEntry(label, doc, before, after, bump) {
  const restore = (s) => {
    doc.rig = structuredClone(s.rig);
    for (const [l, b] of s.binds) l.rigBind = b ? { ...b } : null;
    bump(doc.rig);
  };
  return { label, rig: true, undo: () => restore(before), redo: () => restore(after) };
}

// ドキュメント設定(アートボード・背景色)の変更
export function docPropsEntry(label, doc, before, after) {
  return {
    label,
    undo: () => { doc.artboard = { ...before.artboard }; doc.background = before.background; },
    redo: () => { doc.artboard = { ...after.artboard }; doc.background = after.background; },
  };
}

// 単純なプロパティ変更(名前・不透明度など)
export function propEntry(label, obj, key, before, after) {
  return {
    label,
    undo: () => { obj[key] = before; },
    redo: () => { obj[key] = after; },
  };
}
