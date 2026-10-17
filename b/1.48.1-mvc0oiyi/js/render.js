// 合成(書き出し/スポイト用)と、ドット絵モード用のアンチエイリアスなしラスタライザ
// 矩形は {x0,y0,x1,y1}(右下は含まない)で扱う。アートボードだけ {x,y,w,h}。
import { createCanvas, timeline } from './document.js';
import { TILE, tileRange } from './tiles.js';
import { shapePath, shapeBounds, visualBounds, flattenRings, fillRule, hasFill, hasStroke } from './vector.js';
import { drawObjects, drawPixelated, drawPixelGrad, hasPixelGrad } from './pixelfx.js';
import { parseHex } from './color.js';
import { rigActive, evalPose } from './rig.js';
import { rigContent } from './rigrender.js';
import { layerFx, drawFxPart, hasFx } from './effects.js';

// ---- 矩形ユーティリティ ----

export const abRect = (a) => ({ x0: a.x, y0: a.y, x1: a.x + a.w, y1: a.y + a.h });

export function unionRect(a, b) {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

export function intersectRect(a, b) {
  const r = { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
  return r.x1 > r.x0 && r.y1 > r.y0 ? r : null;
}

// 線幅を含めた図形の外接矩形(整数、少し余裕を持たせる)
export function outerBounds(s) {
  const b = visualBounds(s);
  const p = Math.max(s.pixel >= 1 ? s.pixel : 0, hasPixelGrad(s.pixelGrad) ? Math.max(s.pixelGrad.from, s.pixelGrad.to) : 0); // ドット化で格子にそろえる分
  return { x0: Math.floor(b.x0) - 1 - p, y0: Math.floor(b.y0) - 1 - p, x1: Math.ceil(b.x1) + 1 + p, y1: Math.ceil(b.y1) + 1 + p };
}

export function shapesBounds(shapes) {
  let r = null;
  for (const s of shapes) r = unionRect(r, outerBounds(s));
  return r;
}

export function layerBounds(layer) {
  return celBounds(layer, layer.cel);
}

export function celBounds(layer, cel) {
  return layer.type === 'raster' ? cel.tiles.exactBounds() : shapesBounds(cel.shapes);
}

// ---- ピクセル単位の基本処理 ----

export function bresenham(x0, y0, x1, y1, fn) {
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    fn(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

// 正方形ブラシの左上オフセット(サイズ偶数でもカーソル位置が中心寄りになる)
export const brushOffset = (size) => Math.floor((size - 1) / 2);

function blendAt(d, i, r, g, b, a) {
  if (a === 255 || d[i + 3] === 0) {
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
    return;
  }
  const sa = a / 255, da = d[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  d[i] = (r * sa + d[i] * da * (1 - sa)) / oa;
  d[i + 1] = (g * sa + d[i + 1] * da * (1 - sa)) / oa;
  d[i + 2] = (b * sa + d[i + 2] * da * (1 - sa)) / oa;
  d[i + 3] = oa * 255;
}

// 1図形パーツ内で同じピクセルを二重に塗らないためのマスク
let mask = new Uint8Array(0);
const touched = [];
let RW = 0, RH = 0, ROX = 0, ROY = 0; // 書き込み先 ImageData の幅・高さ・ワールド原点

function markPx(x, y) {
  x -= ROX; y -= ROY;
  if (x < 0 || y < 0 || x >= RW || y >= RH) return;
  const i = y * RW + x;
  if (!mask[i]) { mask[i] = 1; touched.push(i); }
}

function markStamp(x, y, size) {
  const o = brushOffset(size);
  for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) markPx(x - o + dx, y - o + dy);
}

function flushMask(img, c) {
  const d = img.data;
  for (const i of touched) {
    mask[i] = 0;
    blendAt(d, i * 4, c.r, c.g, c.b, c.a);
  }
  touched.length = 0;
}

// 楕円(外接 w×h)のマスクのうち部分矩形 (sx,sy,cw,ch) だけを作る
function ellipseMaskSub(w, h, sx, sy, cw, ch) {
  const m = new Uint8Array(cw * ch);
  const rx = w / 2, ry = h / 2;
  for (let yy = 0; yy < ch; yy++) {
    const y = sy + yy;
    const dy = (y + 0.5 - ry) / ry;
    const t = 1 - dy * dy;
    let x0 = 0, x1 = 0;
    if (t > 0) {
      const hw = rx * Math.sqrt(t);
      x0 = Math.round(rx - hw);
      x1 = Math.round(rx + hw);
    }
    if (x1 <= x0) { x0 = Math.max(0, Math.floor(rx - 0.5)); x1 = Math.min(w, x0 + (w % 2 === 0 ? 2 : 1)); }
    for (let x = Math.max(x0, sx); x < Math.min(x1, sx + cw); x++) m[yy * cw + (x - sx)] = 1;
  }
  return m;
}

// 4近傍収縮(外周1ピクセルを削る)。配列の外は「外側」とみなす
function erode(m, w, h) {
  const o = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (m[i] && m[i - 1] && m[i + 1] && m[i - w] && m[i + w]) o[i] = 1;
    }
  }
  return o;
}

const scratch = createCanvas(1, 1);
const sctx = scratch.getContext('2d', { willReadFrequently: true });

// 図形リストをアンチエイリアスなしで ImageData に合成する。
// img の左上はワールド座標 (ox, oy)。
export function rasterizeShapesPixel(shapes, img, ox = 0, oy = 0) {
  RW = img.width; RH = img.height; ROX = ox; ROY = oy;
  if (mask.length < RW * RH) mask = new Uint8Array(RW * RH);
  const region = { x0: ox, y0: oy, x1: ox + RW, y1: oy + RH };

  for (const s of shapes) {
    const fillC = hasFill(s) ? parseHex(s.fill) : null;
    const strokeC = hasStroke(s) ? parseHex(s.stroke) : null;
    const sw = strokeC ? Math.max(1, Math.round(s.strokeWidth)) : 0;
    if (!fillC && !strokeC) continue;
    if (!intersectRect(outerBounds(s), region)) continue;

    if (s.type === 'rect' || s.type === 'ellipse') {
      const b = shapeBounds(s);
      const e = strokeC ? s.strokeWidth / 2 : 0;
      const bx = Math.round(b.x0 - e), by = Math.round(b.y0 - e);
      const w = Math.round(b.x1 + e) - bx, h = Math.round(b.y1 + e) - by;
      if (w <= 0 || h <= 0) continue;
      // 書き込み範囲+線幅ぶんの余白だけマスクを作る(大きな図形でも軽い)
      const m0 = sw + 1;
      const cx0 = Math.max(bx, ox - m0), cy0 = Math.max(by, oy - m0);
      const cx1 = Math.min(bx + w, ox + RW + m0), cy1 = Math.min(by + h, oy + RH + m0);
      const cw = cx1 - cx0, ch = cy1 - cy0;
      if (cw <= 0 || ch <= 0) continue;
      const m = s.type === 'rect' ? rectMaskSub(w, h, cx0 - bx, cy0 - by, cw, ch) : ellipseMaskSub(w, h, cx0 - bx, cy0 - by, cw, ch);
      let inner = m;
      if (strokeC) for (let k = 0; k < sw; k++) inner = erode(inner, cw, ch);
      if (fillC) {
        for (let i = 0; i < cw * ch; i++) if (inner[i]) markPx(cx0 + (i % cw), cy0 + ((i / cw) | 0));
        flushMask(img, fillC);
      }
      if (strokeC) {
        for (let i = 0; i < cw * ch; i++) if (m[i] && !inner[i]) markPx(cx0 + (i % cw), cy0 + ((i / cw) | 0));
        flushMask(img, strokeC);
      }
    } else if (s.type === 'line') {
      bresenham(Math.floor(s.x1), Math.floor(s.y1), Math.floor(s.x2), Math.floor(s.y2), (x, y) => markStamp(x, y, sw));
      flushMask(img, strokeC);
    } else if (s.type === 'path') {
      if (fillC) {
        // 塗りはキャンバスで描いてアルファ50%以上を採用(しきい値化)
        const r = intersectRect(outerBounds(s), region);
        if (r) {
          const w = r.x1 - r.x0, h = r.y1 - r.y0;
          if (scratch.width < w || scratch.height < h) {
            scratch.width = Math.max(scratch.width, w);
            scratch.height = Math.max(scratch.height, h);
          }
          sctx.setTransform(1, 0, 0, 1, 0, 0);
          sctx.clearRect(0, 0, w, h);
          sctx.setTransform(1, 0, 0, 1, -r.x0, -r.y0);
          sctx.fillStyle = '#000';
          sctx.fill(shapePath(s), fillRule(s));
          const d = sctx.getImageData(0, 0, w, h).data;
          for (let i = 0; i < w * h; i++) if (d[i * 4 + 3] >= 128) markPx(r.x0 + (i % w), r.y0 + ((i / w) | 0));
          flushMask(img, fillC);
        }
      }
      if (strokeC) {
        for (const ring of flattenRings(s)) {
          let prev = null;
          for (const p of ring) {
            const q = { x: Math.floor(p.x), y: Math.floor(p.y) };
            if (!prev) markStamp(q.x, q.y, sw);
            else if (q.x !== prev.x || q.y !== prev.y) bresenham(prev.x, prev.y, q.x, q.y, (x, y) => markStamp(x, y, sw));
            prev = q;
          }
        }
        flushMask(img, strokeC);
      }
    }
  }
}

function rectMaskSub(w, h, sx, sy, cw, ch) {
  return new Uint8Array(cw * ch).fill(1);
}

// 1図形を limits 内でラスタライズ → { img, x, y } または null
export function rasterShapeRegion(shape, limits) {
  const r = intersectRect(outerBounds(shape), limits);
  if (!r) return null;
  const img = new ImageData(r.x1 - r.x0, r.y1 - r.y0);
  rasterizeShapesPixel([shape], img, r.x0, r.y0);
  return { img, x: r.x0, y: r.y0 };
}

// ドット絵モードのベクターはセル(フレームごとの中身)単位・タイル単位でラスタライズしてキャッシュ
const pixelCache = new WeakMap();

export function vectorPixelTile(cel, tx, ty) {
  let c = pixelCache.get(cel);
  if (!c || c.version !== cel.version) {
    c = { version: cel.version, tiles: new Map(), bounds: cel.shapes.map(outerBounds) };
    pixelCache.set(cel, c);
  }
  const k = tx + ',' + ty;
  if (c.tiles.has(k)) return c.tiles.get(k);
  if (c.tiles.size > 1024) c.tiles.clear();
  const x = tx * TILE, y = ty * TILE;
  const rect = { x0: x, y0: y, x1: x + TILE, y1: y + TILE };
  const shapes = cel.shapes.filter((s, i) => intersectRect(c.bounds[i], rect));
  let canvas = null;
  if (shapes.length) {
    const img = new ImageData(TILE, TILE);
    rasterizeShapesPixel(shapes, img, x, y);
    canvas = createCanvas(TILE, TILE);
    canvas.getContext('2d').putImageData(img, 0, 0);
  }
  c.tiles.set(k, canvas);
  return canvas;
}

// ベクターのセル(ドット絵)の、rect にかかるタイルを列挙
export function* vectorPixelTilesIn(cel, rect) {
  const b = shapesBounds(cel.shapes);
  const r = b && intersectRect(b, rect);
  if (!r) return;
  const tr = tileRange(r.x0, r.y0, r.x1, r.y1);
  for (let ty = tr.ty0; ty <= tr.ty1; ty++) {
    for (let tx = tr.tx0; tx <= tr.tx1; tx++) {
      const canvas = vectorPixelTile(cel, tx, ty);
      if (canvas) yield { canvas, x: tx * TILE, y: ty * TILE };
    }
  }
}

// ---- 合成 ----

// layers の frame 番目のフレームを region(ワールド矩形 {x,y,w,h})で切り出して scale 倍で合成
export function flattenLayers(doc, layers, scale = 1, region = doc.artboard, { background = false, frame = timeline.frame, effects = true } = {}) {
  const W = Math.round(region.w * scale), H = Math.round(region.h * scale);
  const out = createCanvas(W, H);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  const rr = abRect(region);
  if (background && doc.background) {
    const bg = intersectRect(rr, abRect(doc.artboard));
    if (bg) {
      ctx.fillStyle = doc.background;
      ctx.fillRect((bg.x0 - region.x) * scale, (bg.y0 - region.y) * scale, (bg.x1 - bg.x0) * scale, (bg.y1 - bg.y0) * scale);
    }
  }
  // レイヤーごとに一度別キャンバスに描いてから不透明度をかける(図形の重なりで二重にかからないように)
  const tmp = createCanvas(W, H);
  const t = tmp.getContext('2d');
  const pose = rigActive(doc) ? evalPose(doc, frame) : null;
  for (const l of layers) {
    const cel = l.displayCelAt(frame);
    if (!cel) continue;
    const rc = pose && hasRigBind(l, cel) ? rigContent(doc, l, cel, pose) : null;
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.clearRect(0, 0, W, H);
    t.setTransform(scale, 0, 0, scale, -region.x * scale, -region.y * scale);
    t.imageSmoothingEnabled = false;
    const fx = effects ? layerEffects(doc, l, cel, rc, frame) : null; // effects: false = エフェクトなし(立体にするときの絵)
    if (fx?.body) drawFxPart(t, fx, 'body');
    else drawLayerWorld(t, l, cel, rc, rr);
    if (fx) {
      // エフェクト: 後ろ → レイヤー → 前
      drawFxPart(t, fx, 'front');
      t.globalCompositeOperation = 'destination-over';
      drawFxPart(t, fx, 'back');
      t.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = l.opacity;
    ctx.drawImage(tmp, 0, 0);
  }
  ctx.globalAlpha = 1;
  return out;
}

// レイヤー自身か、中の図形のどれかがリグにバインドされているか
export function hasRigBind(layer, cel) {
  if (layer.rigBind) return true;
  if (layer.type !== 'vector' || !cel) return false;
  const any = (list) => list.some((s) => s.rigBind || (s.type === 'group' && any(s.children)));
  return any(cel.shapes);
}

// ワールド座標の変換が設定された ctx に、レイヤーの中身を描く。
// rc はリグで変形した結果(rigContent の戻り値)。rect は描く範囲(ワールド)。レイヤーのドット化もここで行う
export function drawLayerWorld(ctx, layer, cel, rc, rect) {
  const paint = (c) => {
    if (rc?.canvas) {
      c.save();
      c.imageSmoothingEnabled = !rc.crisp;
      if (rc.matrix) {
        c.transform(...rc.matrix);
        c.drawImage(rc.canvas, 0, 0);
      } else {
        c.drawImage(rc.canvas, rc.x, rc.y, rc.w, rc.h);
      }
      c.restore();
      return;
    }
    const cc = rc?.cel || cel;
    if (layer.type === 'raster') {
      for (const tl of cc.tiles.inRect(rect.x0, rect.y0, rect.x1, rect.y1)) c.drawImage(tl.canvas, tl.x, tl.y);
    } else {
      drawObjects(c, cc.shapes);
    }
  };
  if (hasPixelGrad(layer.pixelGrad)) {
    const content = celBounds(layer, rc?.cel || cel);
    const b = rc?.canvas ? rect : intersectRect(content || rect, rect);
    if (b) drawPixelGrad(ctx, layer.pixelGrad, b, content || b, paint);
  } else if (layer.pixel >= 1) {
    const b = rc?.canvas ? rect : intersectRect(celBounds(layer, rc?.cel || cel) || rect, rect);
    if (b) drawPixelated(ctx, layer.pixel, b, paint);
  } else {
    paint(ctx);
  }
}

// レイヤーのエフェクト(effects.js)の frame 番目の絵。なければ null
export function layerEffects(doc, layer, cel, rc, frame) {
  if (!hasFx(layer.fx) || !cel) return null;
  const c = rc?.cel || cel;
  return layerFx({
    layer, keyObj: rc || cel, frame, frames: doc.frames.length, limits: doc.limits,
    version: `${cel.version}|${c.shapes ? c.shapes.length : c.tiles.size}`,
    getContent: () => {
      if (rc?.canvas) {
        if (!rc.matrix) return { x0: rc.x, y0: rc.y, x1: rc.x + rc.w, y1: rc.y + rc.h };
        const m = rc.matrix, W = rc.canvas.width, H = rc.canvas.height;
        const pts = [[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
        return { x0: Math.floor(Math.min(...pts.map((p) => p[0]))), y0: Math.floor(Math.min(...pts.map((p) => p[1]))),
          x1: Math.ceil(Math.max(...pts.map((p) => p[0]))), y1: Math.ceil(Math.max(...pts.map((p) => p[1]))) };
      }
      const b = celBounds(layer, c);
      return b && b.x1 > b.x0 ? b : null;
    },
    paint: (ctx, rect) => drawLayerWorld(ctx, layer, cel, rc, rect),
  });
}

// 表示中レイヤー+背景色をアートボード範囲で合成(PNG・GIF書き出し用)
export function flatten(doc, scale = 1, region = doc.artboard, frame = timeline.frame) {
  return flattenLayers(doc, doc.layers.filter((l) => l.visible), scale, region, { background: true, frame });
}
