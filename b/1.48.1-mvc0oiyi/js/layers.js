// レイヤー構成の操作(すべて Undo 可能)
import { state, emit, requestRender, toast } from './state.js';
import { RasterLayer, VectorLayer, RasterCel, VectorCel } from './document.js';
import { snapshotLayers, layersEntry, propEntry } from './history.js';
import { flattenLayers, celBounds, unionRect } from './render.js';
import { finishPath } from './tools.js';
import { applyTransform } from './transform.js';

function structural(label, fn) {
  if (state.transform) applyTransform();
  const doc = state.doc;
  const before = snapshotLayers(doc);
  if (fn(doc) === false) return;
  state.history.push(layersEntry(label, doc, before, snapshotLayers(doc)));
  state.selection = null;
  emit('layers');
  requestRender();
}

export function setActiveLayer(id) {
  if (state.doc.activeId === id) return;
  if (state.pathDraft) finishPath();
  if (state.transform) applyTransform();
  state.doc.activeId = id;
  state.selection = null;
  emit('layers');
  requestRender();
}

export function addLayer(type) {
  structural('レイヤーを追加', (doc) => {
    const name = doc.nextLayerName();
    const l = type === 'vector' ? new VectorLayer(name) : new RasterLayer(name);
    doc.layers.splice(doc.activeIndex + 1, 0, l);
    doc.activeId = l.id;
  });
}

// 作成済みのレイヤー(下から順)をアクティブレイヤーの上に挿入
export function insertLayers(label, newLayers) {
  structural(label, (doc) => {
    doc.layers.splice(doc.activeIndex + 1, 0, ...newLayers);
    doc.activeId = newLayers[newLayers.length - 1].id;
  });
}

export function duplicateLayer() {
  structural('レイヤーを複製', (doc) => {
    const src = doc.activeLayer;
    const l = src.clone(`${src.name} のコピー`);
    doc.layers.splice(doc.activeIndex + 1, 0, l);
    doc.activeId = l.id;
  });
}

export function deleteLayer() {
  if (state.doc.layers.length <= 1) { toast('最後のレイヤーは削除できません'); return; }
  structural('レイヤーを削除', (doc) => {
    const i = doc.activeIndex;
    doc.layers.splice(i, 1);
    doc.activeId = doc.layers[Math.max(0, i - 1)].id;
  });
}

export function moveLayer(dir) {
  const doc = state.doc;
  const i = doc.activeIndex, j = i + dir;
  if (j < 0 || j >= doc.layers.length) return;
  structural('レイヤーの順序を変更', (d) => {
    [d.layers[i], d.layers[j]] = [d.layers[j], d.layers[i]];
  });
}

export function mergeDown() {
  const doc = state.doc;
  const i = doc.activeIndex;
  if (i <= 0) { toast('下にレイヤーがありません'); return; }
  const top = doc.layers[i], bottom = doc.layers[i - 1];
  if (!top.visible || !bottom.visible) { toast('非表示のレイヤーは結合できません'); return; }
  structural('下のレイヤーと結合', (d) => {
    // 全フレームそれぞれで結合する
    const asVector = top.type === 'vector' && bottom.type === 'vector' && top.opacity === bottom.opacity;
    const merged = asVector ? new VectorLayer(bottom.name) : new RasterLayer(bottom.name);
    if (asVector) merged.opacity = bottom.opacity;
    d.frames.forEach((_, f) => {
      const bc = bottom.celAt(f), tc = top.celAt(f);
      if (!bc && !tc) return;
      if (asVector) {
        merged.cels[f] = new VectorCel(structuredClone([...(bc?.shapes || []), ...(tc?.shapes || [])]));
        return;
      }
      const cel = (merged.cels[f] = new RasterCel());
      const b = unionRect(bc && celBounds(bottom, bc), tc && celBounds(top, tc));
      if (!b) return;
      const region = { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 };
      const c = flattenLayers(d, [bottom, top], 1, region, { frame: f });
      cel.tiles.putImageData(c.getContext('2d').getImageData(0, 0, region.w, region.h), region.x, region.y);
    });
    d.layers.splice(i - 1, 2, merged);
    d.activeId = merged.id;
  });
}

export function toggleVisible(layer) {
  layer.visible = !layer.visible;
  state.dirty = true;
  emit('title');
  emit('layers');
  requestRender();
}

export function toggleLock(layer) {
  layer.locked = !layer.locked;
  state.dirty = true;
  emit('title');
  emit('layers');
}

export function renameLayer(layer, name) {
  name = name.trim();
  if (!name || name === layer.name) return;
  state.history.push(propEntry('レイヤー名を変更', layer, 'name', layer.name, name));
  layer.name = name;
  emit('layers');
}

export function commitOpacity(layer, before) {
  if (before === layer.opacity) return;
  state.history.push(propEntry('不透明度を変更', layer, 'opacity', before, layer.opacity));
}
