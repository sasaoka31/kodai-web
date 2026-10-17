// コピー・カット・ペースト
//   Ctrl+C: 選んだ図形をコピー(Kodai の中では図形のまま。Windows のクリップボードには画像も入るので、ほかのソフトにも貼れる)
//           図形を選んでいないときは、今のレイヤーの絵を画像としてコピー
//   Ctrl+X: カット / Ctrl+V: ペースト(少しずらして)/ Ctrl+Shift+V: 同じ位置にペースト
//   ほかのソフトでコピーした画像を Ctrl+V → 新しいレイヤーとして貼る
//   タブをまたいで貼れる(clip はアプリ全体で1つ)。フォントのタブに貼るとき(大きさはそのまま):
//     ベクターのフォント = 図形のまま(ほかのタブから来た図形は、字の枠の真ん中へ)
//     ドットのフォント = ドット(マス目)にする。元の絵の1ドット(ドット化していなければ 1px)= 1マス。字の幅の真ん中・ベースラインの上に置く
import { prefs } from './prefs.js';
import { state, toast, emit, requestRender } from './state.js';
import { selectedItems, selectionLayer, setSelection, deleteSelection } from './select.js';
import { newShapeId, visualBounds, translateShape } from './vector.js';
import { drawObjects } from './pixelfx.js';
import { pushAppend, shapeLayer } from './tools.js';
import { RasterLayer, createCanvas } from './document.js';
import { insertLayers } from './layers.js';
import { flattenLayers } from './render.js';

let clip = null; // { marker, shapes, pasted, doc(コピーした絵) }
const MARK = 'Kodai:図形';

// Windows のクリップボード(ブラウザ標準の Clipboard API。PNG と文字)
const osClip = {
  async write({ text, png }) {
    const data = {};
    if (text) data['text/plain'] = new Blob([text], { type: 'text/plain' });
    if (png) data['image/png'] = new Blob([png], { type: 'image/png' });
    await navigator.clipboard.write([new ClipboardItem(data)]);
  },
  async read() {
    let text = '', png = null;
    for (const item of await navigator.clipboard.read()) {
      if (item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
      if (item.types.includes('image/png')) png = new Uint8Array(await (await item.getType('image/png')).arrayBuffer());
    }
    return { text, png };
  },
};
const native = () => (navigator.clipboard?.write ? osClip : null);

function union(list) {
  return list.reduce((r, b) => (r ? { x0: Math.min(r.x0, b.x0), y0: Math.min(r.y0, b.y0), x1: Math.max(r.x1, b.x1), y1: Math.max(r.y1, b.y1) } : { ...b }), null);
}

async function canvasPng(c) {
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

// 図形を画像に(ほかのソフトに貼る用)
function shapesCanvas(shapes) {
  const b = union(shapes.map(visualBounds));
  const x0 = Math.floor(b.x0), y0 = Math.floor(b.y0);
  const w = Math.max(1, Math.min(8192, Math.ceil(b.x1) - x0)), h = Math.max(1, Math.min(8192, Math.ceil(b.y1) - y0));
  const c = createCanvas(w, h);
  const g = c.getContext('2d');
  g.translate(-x0, -y0);
  drawObjects(g, shapes);
  return c;
}

export function withNewIds(s) {
  const t = { ...structuredClone(s), id: newShapeId() };
  if (t.type === 'group') t.children = t.children.map(withNewIds);
  return t;
}

export async function copySelection(cut = false) {
  // ダイレクト選択でアンカーポイントを選んでいるとき: 選んだ点とその間の線だけをコピー(direct.js。1.47.0)
  if (state.tool === 'direct') {
    const { selectedPointShapes, hasDirectPoints, deleteAnchors } = await import('./direct.js');
    const parts = hasDirectPoints() ? selectedPointShapes() : [];
    if (parts.length) {
      const marker = `${MARK} 点 ${parts.length}本 ${Date.now()}`;
      clip = { marker, shapes: parts, pasted: 0, doc: state.doc };
      try { await native()?.write({ text: marker, png: await canvasPng(shapesCanvas(parts)) }); } catch (err) { console.warn(err); }
      if (cut) deleteAnchors();
      toast(`選んだ点と、その間の線(${parts.length}本)を${cut ? 'カット' : 'コピー'}しました`);
      return true;
    }
  }
  const items = selectedItems();
  if (!items.length) {
    // 図形を選んでいない: 今のレイヤーの絵を画像でコピー
    const l = state.doc.activeLayer;
    if (cut) { toast('カットする図形を矢印ツールで選んでください'); return false; }
    const b = l?.type === 'raster' ? l.bounds() : null;
    if (!b) { toast('コピーする図形を矢印ツールで選んでください'); return false; }
    const c = flattenLayers(state.doc, [l], 1, { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 });
    clip = null;
    await native()?.write({ text: '', png: await canvasPng(c) });
    toast('レイヤーの絵を画像としてコピーしました');
    return true;
  }
  const shapes = items.map((it) => structuredClone(it.shape));
  const marker = `${MARK} ${shapes.length}個 ${Date.now()}`;
  clip = { marker, shapes, pasted: 0, doc: state.doc };
  try { await native()?.write({ text: marker, png: await canvasPng(shapesCanvas(shapes)) }); } catch (err) { console.warn(err); }
  if (cut) deleteSelection();
  toast(`${shapes.length}個の図形を${cut ? 'カット' : 'コピー'}しました`);
  return true;
}

export async function paste(inPlace = false) {
  const n = native();
  let os = { text: clip?.marker ?? '', png: null };
  if (n) { try { os = await n.read(); } catch (err) { console.warn(err); } }
  // Kodai でコピーした図形(Windows のクリップボードが変わっていなければ)
  const font = state.doc.font;
  // (ドットのフォントの字からコピーしたマス目は、そのまま同じマスへ)
  if (clip && (!n || os.text === clip.marker) && font?.kind === 'dot' && !(clip.doc === state.doc && clip.shapes.every((s) => s.dot))) return pasteDots(shapesCanvasAt(clip.shapes), '図形');
  if (clip && (!n || os.text === clip.marker)) {
    const layer = state.doc.activeLayer?.type === 'vector' ? state.doc.activeLayer : shapeLayer();
    if (!layer || layer.locked) { toast('貼り付けられるレイヤーがありません'); return false; }
    clip.pasted++;
    // ずらす量は設定(既定は 0 = コピーした図形と同じ位置)。続けて貼るとその分ずつずれる
    const dx = inPlace ? 0 : prefs.pasteDx * clip.pasted, dy = inPlace ? 0 : prefs.pasteDy * clip.pasted;
    let pasted = clip.shapes.map((s) => translateShape(withNewIds(s), dx, dy));
    // ほかのタブの図形をフォントの字に: 大きさはそのまま、字の枠の真ん中へ
    if (font && clip.doc !== state.doc) {
      const b = union(pasted.map(visualBounds)), a = state.doc.artboard;
      pasted = pasted.map((s) => translateShape(s, a.x + a.w / 2 - (b.x0 + b.x1) / 2, a.y + a.h / 2 - (b.y0 + b.y1) / 2));
    }
    pushAppend(inPlace ? '同じ位置にペースト' : 'ペースト', layer, pasted);
    setSelection(layer, pasted.map((s) => s.id));
    emit('request-tool', 'move');
    toast(`${pasted.length}個の図形を貼り付けました`);
    return true;
  }
  // ほかのソフトの画像 → 新しいレイヤー(アートボードの中央)
  if (os.png) {
    const bmp = await createImageBitmap(new Blob([os.png], { type: 'image/png' }));
    if (font?.kind === 'dot') { const c = createCanvas(bmp.width, bmp.height); c.getContext('2d').drawImage(bmp, 0, 0); return pasteDots(c, '画像'); }
    if (font) { toast('フォントの字に画像は貼れません。図形をコピーするか、「画像から作る…」で字を取り込んでください'); return false; }
    const a = state.doc.artboard;
    const c = createCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    const l = new RasterLayer('貼り付けた画像');
    l.putImageData(g.getImageData(0, 0, bmp.width, bmp.height), a.x + Math.round((a.w - bmp.width) / 2), a.y + Math.round((a.h - bmp.height) / 2));
    insertLayers('画像を貼り付け', [l]);
    requestRender();
    toast(`画像を貼り付けました(${bmp.width} × ${bmp.height})`);
    return true;
  }
  toast('貼り付けるものがありません');
  return false;
}

// 図形を、元の絵の1ドット = 1画素の画像に(ドット化した図形は、そのドットの大きさで)
function shapesCanvasAt(shapes) {
  const px = Math.max(1, ...shapes.map((s) => (s.dot ? s.w : s.pixel >= 1 ? s.pixel : 1))); // ほかのドットのフォントのマス目は 1マス = 1ドット
  const b = union(shapes.map(visualBounds));
  let d = px;
  // 大きすぎる絵は、512マスに収まるように粗く
  const span = Math.max(b.x1 - b.x0, b.y1 - b.y0);
  if (span / d > 512) d = span / 512;
  const w = Math.max(1, Math.ceil((b.x1 - b.x0) / d)), h = Math.max(1, Math.ceil((b.y1 - b.y0) / d));
  const c = createCanvas(w, h);
  const g = c.getContext('2d');
  g.scale(1 / d, 1 / d);
  g.translate(-b.x0, -b.y0);
  drawObjects(g, shapes);
  return c;
}

// 画像の見えている画素を、ドットのフォントのマス目に(1画素 = 1マス)。字の幅の真ん中・ベースラインの上に置く
function pasteDots(c, what) {
  const doc = state.doc, f = doc.font, cs = f.upm / f.grid;
  const layer = doc.layers.find((l) => l.type === 'vector' && l.visible && !l.locked);
  if (!layer) { toast('貼り付けられるレイヤーがありません'); return false; }
  let w = c.width, h = c.height;
  if (Math.max(w, h) > 512) { toast('大きすぎて貼れません(512マスまで)'); return false; }
  const data = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const cols = Math.max(1, Math.round(doc.artboard.w / cs));
  const left = Math.round((cols - w) / 2), top = Math.round(f.ascender / cs) - h;
  const have = new Set(layer.shapes.filter((s) => s.dot).map((s) => `${Math.round(s.x / cs)},${Math.round(s.y / cs)}`));
  const dots = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] < 128) continue;
    const cx = left + x, cy = top + y;
    if (have.has(`${cx},${cy}`)) continue;
    dots.push({ type: 'rect', dot: true, x: cx * cs, y: cy * cs, w: cs, h: cs, fill: '#000000ff', stroke: null, strokeWidth: 0 });
  }
  if (!dots.length) { toast('貼るドットがありません(透明か、もう塗ってあるマスだけ)'); return false; }
  pushAppend(`${what}をドットにして貼り付け`, layer, dots);
  toast(`${what}をドット(${dots.length}マス)にして貼り付けました`);
  return true;
}

export const hasClipShapes = () => !!clip;
export const cutSelection = () => copySelection(true);
