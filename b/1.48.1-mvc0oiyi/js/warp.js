// 変形エンジン: 元の矩形を「制御点の格子」に写像する。
// 自由変形(4隅)は 2×2 の格子。Phase 4 のメッシュ変形(伸縮で動かす)も同じ仕組みで、
// 格子を細かくして各点をキーフレームで動かせば、そのままアニメーションに使える。
//
// grid: { cols, rows, pts: [{x,y}] }  pts は (rows+1)×(cols+1) 個、行優先、左上から
// base: 元の矩形 {x, y, w, h}

export function quadGrid(quad) {
  // quad: [左上, 右上, 右下, 左下]
  return { cols: 1, rows: 1, pts: [quad[0], quad[1], quad[3], quad[2]] };
}

export function rectGrid(base, cols = 1, rows = 1) {
  const pts = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) pts.push({ x: base.x + (base.w * i) / cols, y: base.y + (base.h * j) / rows });
  }
  return { cols, rows, pts };
}

function cellCorners(grid, i, j) {
  const n = grid.cols + 1;
  const p = grid.pts;
  return [p[j * n + i], p[j * n + i + 1], p[(j + 1) * n + i + 1], p[(j + 1) * n + i]];
}

// 元座標 → 変形後の座標(双一次補間)
export function mapPoint(grid, base, x, y) {
  let u = ((x - base.x) / base.w) * grid.cols;
  let v = ((y - base.y) / base.h) * grid.rows;
  const i = Math.min(grid.cols - 1, Math.max(0, Math.floor(u)));
  const j = Math.min(grid.rows - 1, Math.max(0, Math.floor(v)));
  u -= i;
  v -= j;
  const [a, b, c, d] = cellCorners(grid, i, j);
  return {
    x: a.x * (1 - u) * (1 - v) + b.x * u * (1 - v) + c.x * u * v + d.x * (1 - u) * v,
    y: a.y * (1 - u) * (1 - v) + b.y * u * (1 - v) + c.y * u * v + d.y * (1 - u) * v,
  };
}

const cross = (ax, ay, bx, by) => ax * by - ay * bx;

// 変形後の点 → セル内の (u,v)。四角形 a,b,c,d(左上,右上,右下,左下)の逆双一次写像
function invBilinear(px, py, a, b, c, d) {
  const ex = b.x - a.x, ey = b.y - a.y;
  const fx = d.x - a.x, fy = d.y - a.y;
  const gx = a.x - b.x + c.x - d.x, gy = a.y - b.y + c.y - d.y;
  const hx = px - a.x, hy = py - a.y;
  const k2 = cross(gx, gy, fx, fy);
  const k1 = cross(ex, ey, fx, fy) + cross(hx, hy, gx, gy);
  const k0 = cross(hx, hy, ex, ey);
  let v;
  if (Math.abs(k2) < 1e-9) {
    if (Math.abs(k1) < 1e-12) return null;
    v = -k0 / k1;
  } else {
    let w = k1 * k1 - 4 * k0 * k2;
    if (w < 0) return null;
    w = Math.sqrt(w);
    const ik2 = 0.5 / k2;
    v = (-k1 - w) * ik2;
    if (v < -1e-6 || v > 1 + 1e-6) v = (-k1 + w) * ik2;
  }
  const dx = ex + gx * v, dy = ey + gy * v;
  const u = Math.abs(dx) > Math.abs(dy) ? (hx - fx * v) / dx : (hy - fy * v) / dy;
  const eps = 1e-6;
  if (u < -eps || u > 1 + eps || v < -eps || v > 1 + eps) return null;
  return { u: Math.min(1, Math.max(0, u)), v: Math.min(1, Math.max(0, v)) };
}

export function gridBounds(grid) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of grid.pts) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  return { x0: Math.floor(x0), y0: Math.floor(y0), x1: Math.ceil(x1), y1: Math.ceil(y1) };
}

// 画像 src(ImageData、ワールド上では base に置かれている)を grid に沿って変形する。
// nearest: ドット絵用(補間なし) / step: プレビュー用の間引き(2なら縦横1/2解像度)
// 戻り値 { img, x, y, step }: img の左上がワールド座標 (x,y)、1ピクセル = step ワールドピクセル
export function warpImage(src, base, grid, { nearest = false, step = 1 } = {}) {
  const b = gridBounds(grid);
  const W = Math.max(1, Math.ceil((b.x1 - b.x0) / step)), H = Math.max(1, Math.ceil((b.y1 - b.y0) / step));
  const out = new ImageData(W, H);
  const od = out.data, sd = src.data, SW = src.width, SH = src.height;

  for (let j = 0; j < grid.rows; j++) {
    for (let i = 0; i < grid.cols; i++) {
      const [a, bb, c, d] = cellCorners(grid, i, j);
      const cx0 = Math.max(b.x0, Math.floor(Math.min(a.x, bb.x, c.x, d.x)));
      const cy0 = Math.max(b.y0, Math.floor(Math.min(a.y, bb.y, c.y, d.y)));
      const cx1 = Math.ceil(Math.max(a.x, bb.x, c.x, d.x));
      const cy1 = Math.ceil(Math.max(a.y, bb.y, c.y, d.y));
      const ox0 = Math.floor((cx0 - b.x0) / step), oy0 = Math.floor((cy0 - b.y0) / step);
      const ox1 = Math.min(W, Math.ceil((cx1 - b.x0) / step)), oy1 = Math.min(H, Math.ceil((cy1 - b.y0) / step));
      for (let oy = oy0; oy < oy1; oy++) {
        const py = b.y0 + (oy + 0.5) * step;
        for (let ox = ox0; ox < ox1; ox++) {
          const oi = (oy * W + ox) * 4;
          if (od[oi + 3]) continue; // 隣のセルで既に塗った
          const px = b.x0 + (ox + 0.5) * step;
          const uv = invBilinear(px, py, a, bb, c, d);
          if (!uv) continue;
          // セル内 (u,v) → 元画像の座標
          const sx = ((i + uv.u) / grid.cols) * SW;
          const sy = ((j + uv.v) / grid.rows) * SH;
          if (nearest) {
            const ix = Math.min(SW - 1, Math.floor(sx)), iy = Math.min(SH - 1, Math.floor(sy));
            const si = (iy * SW + ix) * 4;
            od[oi] = sd[si]; od[oi + 1] = sd[si + 1]; od[oi + 2] = sd[si + 2]; od[oi + 3] = sd[si + 3];
          } else {
            sampleBilinear(sd, SW, SH, sx - 0.5, sy - 0.5, od, oi);
          }
        }
      }
    }
  }
  return { img: out, x: b.x0, y: b.y0, step };
}

// プリマルチプライドで補間(透明部分の色がにじまないように)
function sampleBilinear(sd, W, H, x, y, od, oi) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  let r = 0, g = 0, b = 0, a = 0;
  for (let k = 0; k < 4; k++) {
    const xx = Math.min(W - 1, Math.max(0, x0 + (k & 1)));
    const yy = Math.min(H - 1, Math.max(0, y0 + (k >> 1)));
    const w = ((k & 1) ? fx : 1 - fx) * ((k >> 1) ? fy : 1 - fy);
    const si = (yy * W + xx) * 4;
    const al = sd[si + 3] * w;
    r += sd[si] * al; g += sd[si + 1] * al; b += sd[si + 2] * al; a += al;
  }
  if (a <= 0) return;
  od[oi] = r / a; od[oi + 1] = g / a; od[oi + 2] = b / a; od[oi + 3] = a;
}
