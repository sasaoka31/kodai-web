// タイル分割ラスター。描いた場所だけ 256px 四方のタイルを確保するので、
// アートボードの外(広いワークスペース)に描いてもメモリをほとんど使わない。

export const TILE = 256;

const key = (tx, ty) => tx + ',' + ty;

export function createTile(tx, ty) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TILE;
  return { tx, ty, x: tx * TILE, y: ty * TILE, canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }) };
}

// 矩形 [x0,x1)×[y0,y1) を覆うタイル座標の範囲
export function tileRange(x0, y0, x1, y1) {
  return {
    tx0: Math.floor(x0 / TILE), ty0: Math.floor(y0 / TILE),
    tx1: Math.floor((x1 - 1) / TILE), ty1: Math.floor((y1 - 1) / TILE),
  };
}

export function tileCoordsInRect(x0, y0, x1, y1) {
  const out = [];
  if (x1 <= x0 || y1 <= y0) return out;
  const r = tileRange(x0, y0, x1, y1);
  for (let ty = r.ty0; ty <= r.ty1; ty++) for (let tx = r.tx0; tx <= r.tx1; tx++) out.push([tx, ty]);
  return out;
}

function regionEmpty(img, sx, sy, w, h) {
  const d = img.data, W = img.width;
  for (let y = 0; y < h; y++) {
    let i = ((sy + y) * W + sx) * 4 + 3;
    for (let x = 0; x < w; x++, i += 4) if (d[i]) return false;
  }
  return true;
}

export class TileMap {
  constructor() {
    this.map = new Map();
  }

  get size() { return this.map.size; }
  values() { return this.map.values(); }
  get(tx, ty) { return this.map.get(key(tx, ty)); }
  delete(tx, ty) { this.map.delete(key(tx, ty)); }
  clear() { this.map.clear(); }

  ensure(tx, ty) {
    let t = this.get(tx, ty);
    if (!t) {
      t = createTile(tx, ty);
      this.map.set(key(tx, ty), t);
    }
    return t;
  }

  // 矩形にかかるタイルを列挙(create=true なら無ければ作る)
  *inRect(x0, y0, x1, y1, create = false) {
    for (const [tx, ty] of tileCoordsInRect(x0, y0, x1, y1)) {
      const t = create ? this.ensure(tx, ty) : this.get(tx, ty);
      if (t) yield t;
    }
  }

  // 描かれている領域の正確な外接矩形 {x0,y0,x1,y1}(空なら null)
  exactBounds() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const t of this.map.values()) {
      // タイル全体が既存の範囲内なら走査不要
      if (t.x >= x0 && t.y >= y0 && t.x + TILE <= x1 && t.y + TILE <= y1) continue;
      const d = t.ctx.getImageData(0, 0, TILE, TILE).data;
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          if (!d[(y * TILE + x) * 4 + 3]) continue;
          const wx = t.x + x, wy = t.y + y;
          if (wx < x0) x0 = wx;
          if (wx + 1 > x1) x1 = wx + 1;
          if (wy < y0) y0 = wy;
          if (wy + 1 > y1) y1 = wy + 1;
        }
      }
    }
    return x0 === Infinity ? null : { x0, y0, x1, y1 };
  }

  getImageData(x, y, w, h) {
    const out = new ImageData(w, h);
    for (const t of this.inRect(x, y, x + w, y + h)) {
      const ix0 = Math.max(x, t.x), iy0 = Math.max(y, t.y);
      const ix1 = Math.min(x + w, t.x + TILE), iy1 = Math.min(y + h, t.y + TILE);
      const pw = ix1 - ix0, ph = iy1 - iy0;
      const part = t.ctx.getImageData(ix0 - t.x, iy0 - t.y, pw, ph).data;
      for (let r = 0; r < ph; r++) {
        out.data.set(part.subarray(r * pw * 4, (r + 1) * pw * 4), ((iy0 - y + r) * w + (ix0 - x)) * 4);
      }
    }
    return out;
  }

  // img の部分矩形 (sx,sy,sw,sh) をワールド座標 (x+sx, y+sy) に書き込む
  putImageData(img, x, y, sx = 0, sy = 0, sw = img.width, sh = img.height) {
    const wx0 = x + sx, wy0 = y + sy, wx1 = wx0 + sw, wy1 = wy0 + sh;
    for (const [tx, ty] of tileCoordsInRect(wx0, wy0, wx1, wy1)) {
      const tX = tx * TILE, tY = ty * TILE;
      const ix0 = Math.max(wx0, tX), iy0 = Math.max(wy0, tY);
      const ix1 = Math.min(wx1, tX + TILE), iy1 = Math.min(wy1, tY + TILE);
      let t = this.get(tx, ty);
      if (!t) {
        if (regionEmpty(img, ix0 - x, iy0 - y, ix1 - ix0, iy1 - iy0)) continue;
        t = this.ensure(tx, ty);
      }
      t.ctx.putImageData(img, x - t.x, y - t.y, ix0 - x, iy0 - y, ix1 - ix0, iy1 - iy0);
    }
  }

  clone() {
    const m = new TileMap();
    for (const t of this.map.values()) m.ensure(t.tx, t.ty).ctx.drawImage(t.canvas, 0, 0);
    return m;
  }
}
