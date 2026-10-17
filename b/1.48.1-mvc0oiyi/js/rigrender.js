// リグで変形したレイヤーの中身を作る(結果はセル×ポーズごとにキャッシュ)
// 絵そのものは書き換えない(非破壊)。表示・書き出しのたびにここで変形する。
import { createCanvas } from './document.js';
import { rectGrid, warpImage, gridBounds } from './warp.js';
import { makeDeformer, estimateRadii, boneMatrices, latticeGrid, poseIsRest } from './rig.js';

function imageCanvas(img) {
  const c = createCanvas(img.width, img.height);
  c.getContext('2d').putImageData(img, 0, 0);
  return c;
}
import { deformShape, drawShapes, shapeBounds } from './vector.js';

const MAX_AREA = 64e6;
const cache = new WeakMap(); // cel -> { version, map: Map<key, result>, src }

function cached(cel, key, make) {
  let c = cache.get(cel);
  if (!c || c.version !== cel.version) {
    c = { version: cel.version, map: new Map(), src: null };
    cache.set(cel, c);
  }
  if (c.map.has(key)) return c.map.get(key);
  const r = make(c);
  c.map.set(key, r);
  if (c.map.size > 96) c.map.delete(c.map.keys().next().value);
  return r;
}

// セルの絵を ImageData にする(ベクターは太さの計測用にラスタライズ)
function sourceImage(layer, cel) {
  if (layer.type === 'raster') {
    const b = cel.tiles.exactBounds();
    if (!b) return { empty: true };
    const base = { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 };
    return { base, img: cel.tiles.getImageData(base.x, base.y, base.w, base.h) };
  }
  if (!cel.shapes.length) return { empty: true };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of cel.shapes) {
    const b = shapeBounds(s), e = (s.stroke ? s.strokeWidth : 0) / 2 + 1;
    x0 = Math.min(x0, b.x0 - e); y0 = Math.min(y0, b.y0 - e);
    x1 = Math.max(x1, b.x1 + e); y1 = Math.max(y1, b.y1 + e);
  }
  const base = { x: Math.floor(x0), y: Math.floor(y0), w: Math.ceil(x1) - Math.floor(x0), h: Math.ceil(y1) - Math.floor(y0) };
  if (base.w * base.h > MAX_AREA) return { empty: true };
  const c = createCanvas(base.w, base.h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.translate(-base.x, -base.y);
  drawShapes(ctx, cel.shapes);
  return { base, img: ctx.getImageData(0, 0, base.w, base.h) };
}

function insideFn({ base, img }) {
  const d = img.data, W = img.width, H = img.height;
  return (x, y) => {
    const ix = Math.floor(x - base.x), iy = Math.floor(y - base.y);
    return ix >= 0 && iy >= 0 && ix < W && iy < H && d[(iy * W + ix) * 4 + 3] >= 64;
  };
}

// 変形後の中身を返す。変形なしなら null(呼び出し側は通常どおり描く)
//   ラスター: { canvas, x, y, w, h }(ワールド座標の矩形に描く)
//          または { canvas, matrix }(ボーンに固定: 行列で描くだけなので軽い)
//   ベクター: { cel: { shapes, version } }(図形ごとのバインドにも対応)
export function rigContent(doc, layer, cel, pose, { step = 1 } = {}) {
  if (!cel) return null;
  const key = `${doc.rig.version}|${JSON.stringify(layer.rigBind)}|${JSON.stringify(pose)}|${step}`;
  return cached(cel, key, (c) => {
    if (!c.src) c.src = sourceImage(layer, cel);
    if (c.src.empty) return null;
    // 自動バインドの重み付けに使うボーンの太さ(この絵から測る)
    if (c.radiiVersion !== doc.rig.version) {
      c.radii = estimateRadii(doc.rig, insideFn(c.src));
      c.radiiVersion = doc.rig.version;
    }
    if (layer.type === 'vector') {
      // 図形のバインド > 親グループのバインド > レイヤーのバインド
      const fs = new Map();
      const fOf = (bind) => {
        const k = JSON.stringify(bind);
        if (!fs.has(k)) fs.set(k, makeDeformer(doc, bind, pose, c.radii));
        return fs.get(k);
      };
      let changed = false;
      const walk = (s, inherited) => {
        const bind = s.rigBind || inherited;
        if (s.type === 'group') return { ...s, children: s.children.map((ch) => walk(ch, bind)) };
        const f = bind && fOf(bind);
        if (!f) return s;
        changed = true;
        return deformShape(s, f);
      };
      const shapes = cel.shapes.map((s) => walk(s, layer.rigBind));
      return changed ? { cel: { shapes, version: 0 } } : null;
    }
    const bind = layer.rigBind;
    if (!bind) return null;
    const { base, img } = c.src;
    // ボーンに固定で格子もなし → 行列1つで描ける(回転・移動が軽い)
    if (bind.mode === 'bone' && !latticeGrid(doc.rig, pose) && !poseIsRest(pose)) {
      const m = boneMatrices(doc.rig, pose).get(bind.boneId);
      if (!m) return null;
      c.srcCanvas ||= imageCanvas(img);
      return {
        canvas: c.srcCanvas,
        crisp: !!doc.crispRig,
        matrix: [m[0], m[1], m[2], m[3], m[0] * base.x + m[2] * base.y + m[4], m[1] * base.x + m[3] * base.y + m[5]],
      };
    }
    const f = makeDeformer(doc, bind, pose, c.radii);
    if (!f) return null;
    // 絵の範囲を細かい格子に分けて、各頂点を変形関数で動かす
    const cs = Math.max(2, Math.ceil(Math.max(base.w, base.h) / 48));
    const grid = rectGrid(base, Math.max(1, Math.ceil(base.w / cs)), Math.max(1, Math.ceil(base.h / cs)));
    grid.pts = grid.pts.map((p) => f(p.x, p.y));
    const gb = gridBounds(grid);
    if ((gb.x1 - gb.x0) * (gb.y1 - gb.y0) > MAX_AREA) return null;
    const w = warpImage(img, base, grid, { step, nearest: !!doc.crispRig });
    const canvas = createCanvas(w.img.width, w.img.height);
    canvas.getContext('2d').putImageData(w.img, 0, 0);
    return { canvas, x: w.x, y: w.y, w: w.img.width * step, h: w.img.height * step };
  });
}
