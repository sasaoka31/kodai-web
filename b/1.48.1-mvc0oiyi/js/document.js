// ドキュメントモデル
// 座標はワールド座標(ピクセル単位)。アートボード(書き出し範囲)とは独立していて、
// アートボードの外に描いた絵や図形も保持される(イラレのアートボードと同じ考え方)。
import { DEFAULT_PALETTE } from './color.js';
import { TileMap } from './tiles.js';
import { newRig, bumpRig } from './rig.js';
import { normalizeFx } from './effects.js';

let seq = 0;
export function uid(prefix = 'id') {
  seq++;
  return `${prefix}${Date.now().toString(36)}${seq}`;
}

export function createCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// ワークスペース(描画可能範囲)はアートボードの縦横それぞれ20倍
export const WORKSPACE_SCALE = 20;
export const MAX_ARTBOARD = { pixel: 4096, illust: 16384 };

// ---- アニメーション ----
// 各レイヤーはフレームごとの中身(セル)を持つ。layer.cels[フレーム番号]。
// layer.tiles / layer.shapes は「現在のフレーム」のセルを指すので、描画ツールは
// フレームを意識せずに今のフレームへ描ける。

export const timeline = { frame: 0 }; // 現在のフレーム番号
export const DEFAULT_DURATION = 100; // ms

export class RasterCel {
  constructor(tiles = new TileMap()) {
    this.tiles = tiles;
    this.version = 0; // 中身が変わるたびに増やす(リグ変形のキャッシュ用)
  }

  clone() {
    return new RasterCel(this.tiles.clone());
  }
}

export class VectorCel {
  constructor(shapes = []) {
    this.shapes = shapes;
    // 図形が変わるたびに増やす(ドット絵モードのラスタライズキャッシュ用)
    this.version = 0;
  }

  clone() {
    return new VectorCel(structuredClone(this.shapes));
  }
}

export function isEmptyCel(c) {
  if (!c) return true;
  return c.tiles ? c.tiles.size === 0 : c.shapes.length === 0;
}

class BaseLayer {
  constructor(type, name) {
    this.id = uid(type[0]);
    this.type = type;
    this.name = name;
    this.visible = true;
    this.opacity = 1;
    this.locked = false;
    this.cels = []; // 空きがあってよい(空のフレーム)
    // リグへのバインド: null / { mode: 'auto' } / { mode: 'bone' | 'chain', boneId }
    this.rigBind = null;
    this.pixel = 0; // レイヤー全体のドット化(1ドットの大きさ px。0=なし)
    this.pixelGrad = null; // レイヤー全体のドットの粗さのグラデーション(pixelfx.js)。pixel より優先
    this.fx = null; // エフェクト(effects.js): { dot, items: [{ type, on, ... }] }
  }

  // 現在のフレームのセル(無ければ空のセルを作る)。
  // リグにバインドしたレイヤーは、空のフレームでは直前の絵を使い続ける(そこに描き足す)
  // リグで動くレイヤーか(レイヤー自身か、中の図形のどれかがバインドされている)
  get rigged() {
    if (this.rigBind) return true;
    if (this.type !== 'vector') return false;
    const any = (list) => list.some((s) => s.rigBind || (s.type === 'group' && any(s.children)));
    return this.cels.some((c) => c && any(c.shapes));
  }

  get cel() {
    const f = timeline.frame;
    if (this.rigged && isEmptyCel(this.cels[f])) {
      const held = this.displayCelAt(f);
      if (held) return held;
    }
    return (this.cels[f] ||= this.newCel());
  }

  celAt(i) {
    return this.cels[i] || null;
  }

  // 表示に使うセル。バインドしたレイヤーは空のフレームなら直前の絵を保持
  displayCelAt(i) {
    if (!this.rigged) return this.celAt(i);
    for (let j = i; j >= 0; j--) if (!isEmptyCel(this.cels[j])) return this.cels[j];
    return this.celAt(i);
  }

  clone(name) {
    const l = new this.constructor(name ?? this.name);
    l.visible = this.visible;
    l.opacity = this.opacity;
    l.rigBind = this.rigBind ? { ...this.rigBind } : null;
    l.pixel = this.pixel || 0;
    l.pixelGrad = this.pixelGrad ? { ...this.pixelGrad } : null;
    l.fx = this.fx ? structuredClone(this.fx) : null;
    l.cels = this.cels.map((c) => c && c.clone());
    return l;
  }
}

export class RasterLayer extends BaseLayer {
  constructor(name) {
    super('raster', name);
  }

  newCel() {
    return new RasterCel();
  }

  get tiles() {
    return this.cel.tiles;
  }

  getImageData(x, y, w, h) {
    return this.tiles.getImageData(x, y, w, h);
  }

  putImageData(img, x, y) {
    this.tiles.putImageData(img, x, y);
  }

  // 描かれた領域 {x0,y0,x1,y1} または null
  bounds() {
    return this.tiles.exactBounds();
  }
}

export class VectorLayer extends BaseLayer {
  constructor(name) {
    super('vector', name);
  }

  newCel() {
    return new VectorCel();
  }

  get shapes() {
    return this.cel.shapes;
  }

  set shapes(v) {
    this.cel.shapes = v;
  }

  touch() {
    this.cel.version++;
  }
}

export class Doc {
  constructor(artboard, mode) {
    this.artboard = { ...artboard }; // {x,y,w,h} 書き出し範囲
    this.mode = mode; // 'pixel' | 'illust'
    this.background = null; // null=透明 / '#rrggbb[aa]'
    this.layers = []; // [0] が最背面
    this.activeId = null;
    this.palette = [...DEFAULT_PALETTE];
    this.frames = [{ duration: DEFAULT_DURATION }]; // { duration, pose? }
    this.rig = newRig();
  }

  // 描画できる範囲 {x0,y0,x1,y1}(アートボード中心に縦横20倍)
  get limits() {
    const a = this.artboard;
    const mx = Math.round((a.w * (WORKSPACE_SCALE - 1)) / 2);
    const my = Math.round((a.h * (WORKSPACE_SCALE - 1)) / 2);
    return { x0: a.x - mx, y0: a.y - my, x1: a.x + a.w + mx, y1: a.y + a.h + my };
  }

  get activeLayer() {
    return this.layers.find((l) => l.id === this.activeId) || this.layers[this.layers.length - 1] || null;
  }

  get activeIndex() {
    return this.layers.indexOf(this.activeLayer);
  }

  layerById(id) {
    return this.layers.find((l) => l.id === id) || null;
  }

  nextLayerName() {
    let n = this.layers.length + 1;
    while (this.layers.some((l) => l.name === `レイヤー ${n}`)) n++;
    return `レイヤー ${n}`;
  }
}

export function newDocument({ width, height, background = null }) {
  const doc = new Doc({ x: 0, y: 0, w: width, h: height }, 'illust');
  doc.background = background;
  // 最初のレイヤーはベクター(描いた図形が1つずつ選べる)。ペンで塗りたいときは「+ラスター」
  const base = new VectorLayer('レイヤー 1');
  doc.layers.push(base);
  doc.activeId = base.id;
  return doc;
}

// ---- プロジェクトファイル (.kodai = JSON。昔の Koneru の .koneru、PixelRig の .prig も同じ形式。format の名前は互換のため pixelrig-project のまま) ----
// ラスターのセルは描かれた範囲を1枚のPNG(dataURL)と位置で保存。空のセルは null

export const FORMAT_ID = 'pixelrig-project';
export const FORMAT_VERSION = 3;

function serializeCel(type, cel) {
  if (!cel) return null;
  if (type === 'vector') return cel.shapes.length ? { shapes: cel.shapes } : null;
  const b = cel.tiles.exactBounds();
  if (!b) return null;
  const w = b.x1 - b.x0, h = b.y1 - b.y0;
  const c = createCanvas(w, h);
  c.getContext('2d').putImageData(cel.tiles.getImageData(b.x0, b.y0, w, h), 0, 0);
  return { x: b.x0, y: b.y0, image: c.toDataURL('image/png') };
}

export function serialize(doc) {
  return {
    format: FORMAT_ID,
    version: FORMAT_VERSION,
    mode: doc.mode,
    artboard: doc.artboard,
    background: doc.background,
    palette: doc.palette,
    frames: doc.frames,
    crispRig: !!doc.crispRig,
    guides: doc.guides && (doc.guides.v.length || doc.guides.h.length) ? doc.guides : undefined, // ガイド(guides.js)
    font: doc.font || undefined, // フォント作成モードのファイル(フレーム = 1文字、frames[i].glyph = { char, advance })
    rig: { ...doc.rig, version: undefined },
    activeIndex: doc.activeIndex,
    layers: doc.layers.map((l) => ({
      type: l.type, name: l.name, visible: l.visible, opacity: l.opacity, locked: l.locked, rigBind: l.rigBind, pixel: l.pixel || 0, pixelGrad: l.pixelGrad || undefined, fx: l.fx || undefined,
      cels: doc.frames.map((_, i) => serializeCel(l.type, l.celAt(i))),
    })),
  };
}

async function deserializeCel(type, src) {
  if (!src) return null;
  if (type === 'vector') return new VectorCel(Array.isArray(src.shapes) ? src.shapes : []);
  const cel = new RasterCel();
  if (src.image) {
    const img = await loadImage(src.image);
    const c = createCanvas(img.width, img.height);
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0);
    cel.tiles.putImageData(cx.getImageData(0, 0, img.width, img.height), src.x || 0, src.y || 0);
  }
  return cel;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('レイヤー画像の読み込みに失敗しました'));
    img.src = src;
  });
}

export async function deserialize(obj) {
  if (!obj || obj.format !== FORMAT_ID) throw new Error('Kodai のプロジェクトファイルではありません');
  if (obj.version > FORMAT_VERSION) throw new Error('新しいバージョンで作成されたファイルです');
  const artboard = obj.artboard || { x: 0, y: 0, w: obj.width, h: obj.height }; // v1 互換
  // ドット絵モードは廃止。昔のドット絵ファイルもイラストとして開く(ドット感は「ドット化」で出す)
  const doc = new Doc(artboard, 'illust');
  // 昔のドット絵モードのファイルは、リグで動かしても補間でぼけないようにする
  doc.crispRig = obj.mode === 'pixel' || !!obj.crispRig;
  doc.background = obj.background || null;
  if (obj.guides) doc.guides = { v: (obj.guides.v || []).filter(Number.isFinite), h: (obj.guides.h || []).filter(Number.isFinite) };
  if (obj.font && typeof obj.font === 'object') doc.font = { ...obj.font };
  if (Array.isArray(obj.palette)) doc.palette = obj.palette;
  if (Array.isArray(obj.frames) && obj.frames.length) {
    doc.frames = obj.frames.map((f) => {
      const fr = { duration: Math.max(10, Number(f.duration) || DEFAULT_DURATION) };
      if (f.pose) fr.pose = f.pose;
      if (f.glyph && typeof f.glyph.char === 'string') fr.glyph = { char: f.glyph.char, advance: Number(f.glyph.advance) || 500 };
      if (f.brush && typeof f.brush.key === 'string') fr.brush = { key: f.brush.key, head: Math.max(0, Number(f.brush.head) || 0), tail: Math.max(0, Number(f.brush.tail) || 0) }; // 漢字の自動作成の筆の部品
      return fr;
    });
  }
  if (obj.rig && Array.isArray(obj.rig.bones)) {
    doc.rig = { ...newRig(), ...obj.rig, lattice: { ...newRig().lattice, ...obj.rig.lattice } };
    bumpRig(doc.rig);
  }
  for (const src of obj.layers) {
    const type = src.type === 'vector' ? 'vector' : 'raster';
    const layer = type === 'vector' ? new VectorLayer(src.name) : new RasterLayer(src.name);
    // v1/v2 はフレームが1つだけ(レイヤー直下に中身がある)
    const cels = Array.isArray(src.cels) ? src.cels : [src];
    for (let i = 0; i < Math.min(cels.length, doc.frames.length); i++) {
      const cel = await deserializeCel(type, cels[i]);
      if (cel) layer.cels[i] = cel;
    }
    layer.visible = src.visible !== false;
    layer.opacity = typeof src.opacity === 'number' ? src.opacity : 1;
    layer.locked = !!src.locked;
    layer.rigBind = src.rigBind || null;
    layer.pixel = Number(src.pixel) >= 1 ? Number(src.pixel) : 0;
    layer.pixelGrad = src.pixelGrad && Number(src.pixelGrad.from) >= 1 && Number(src.pixelGrad.to) >= 1 ? { ...src.pixelGrad } : null;
    layer.fx = normalizeFx(src.fx);
    doc.layers.push(layer);
  }
  if (!doc.layers.length) doc.layers.push(new RasterLayer('レイヤー 1'));
  const ai = Math.min(Math.max(obj.activeIndex ?? doc.layers.length - 1, 0), doc.layers.length - 1);
  doc.activeId = doc.layers[ai].id;
  return doc;
}
