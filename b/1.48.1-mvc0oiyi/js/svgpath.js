// SVG のパス(d 属性)→ Kodai のパスの輪([{ nodes:[{x,y,hin?,hout?}], closed }])
//   M L H V C S Q T A Z(小文字 = 相対)に対応。Q・T は3次ベジェに、A(円弧)は90°ごとの3次ベジェに直す
//   Claude 連携(mcp.js)で、図形を SVG の書き方でも受け取れるようにするため

const near = (a, b) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

// 円弧(終点表記)→ 3次ベジェの列 [[c1, c2, p], …]
function arcToCubics(x0, y0, rx, ry, phiDeg, large, sweep, x, y) {
  if (rx === 0 || ry === 0) return [[{ x: x0, y: y0 }, { x, y }, { x, y }]];
  const phi = (phiDeg * Math.PI) / 180, cp = Math.cos(phi), sp = Math.sin(phi);
  const dx = (x0 - x) / 2, dy = (y0 - y) / 2;
  const x1 = cp * dx + sp * dy, y1 = -sp * dx + cp * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let co = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) co = -co;
  const cxp = (co * rx * y1) / ry, cyp = (-co * ry * x1) / rx;
  const cx = cp * cxp - sp * cyp + (x0 + x) / 2, cy = sp * cxp + cp * cyp + (y0 + y) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
  let dt = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  else if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2)));
  const seg = dt / n, k = (4 / 3) * Math.tan(seg / 4);
  const pt = (t) => ({ x: cx + rx * Math.cos(t) * cp - ry * Math.sin(t) * sp, y: cy + rx * Math.cos(t) * sp + ry * Math.sin(t) * cp });
  const dpt = (t) => ({ x: -rx * Math.sin(t) * cp - ry * Math.cos(t) * sp, y: -rx * Math.sin(t) * sp + ry * Math.cos(t) * cp });
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = t1 + i * seg, b = a + seg;
    const pa = pt(a), pb = pt(b), da = dpt(a), db = dpt(b);
    out.push([{ x: pa.x + k * da.x, y: pa.y + k * da.y }, { x: pb.x - k * db.x, y: pb.y - k * db.y }, i === n - 1 ? { x, y } : pb]);
  }
  return out;
}

export function parseSvgPath(d) {
  const tok = String(d).match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
  const rings = [];
  let ring = null, i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, lastC = null, lastQ = null;
  const num = () => { const v = parseFloat(tok[i++]); if (!Number.isFinite(v)) throw new Error('パスの数値が読めません: ' + d.slice(0, 40)); return v; };
  const flag = () => {
    // 円弧のフラグは "0" "1" がくっついて書かれることがある("a10 10 0 01 5 5")
    const t = tok[i];
    if (t.length > 1 && (t[0] === '0' || t[0] === '1') && !t.includes('.')) { tok[i] = t.slice(1); return t[0] === '1'; }
    i++;
    return t === '1';
  };
  const start = () => { ring = { nodes: [{ x, y }], closed: false }; rings.push(ring); };
  const last = () => ring.nodes[ring.nodes.length - 1];
  const line = (nx, ny) => { if (!ring) start(); x = nx; y = ny; ring.nodes.push({ x, y }); };
  const curve = (c1, c2, p) => {
    if (!ring) start();
    last().hout = { ...c1 };
    ring.nodes.push({ x: p.x, y: p.y, hin: { ...c2 } });
    x = p.x; y = p.y;
  };
  while (i < tok.length) {
    if (/[a-zA-Z]/.test(tok[i])) cmd = tok[i++];
    else if (!cmd) throw new Error('パスは M から始めてください');
    const rel = cmd !== cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    const C = cmd.toUpperCase();
    let keepC = false, keepQ = false;
    switch (C) {
      case 'M':
        x = ox + num(); y = oy + num(); sx = x; sy = y; start();
        cmd = rel ? 'l' : 'L';
        break;
      case 'L': line(ox + num(), oy + num()); break;
      case 'H': line(ox + num(), y); break;
      case 'V': line(x, oy + num()); break;
      case 'C': {
        const c1 = { x: ox + num(), y: oy + num() }, c2 = { x: ox + num(), y: oy + num() }, p = { x: ox + num(), y: oy + num() };
        curve(c1, c2, p); lastC = c2; keepC = true;
        break;
      }
      case 'S': {
        const c1 = lastC ? { x: 2 * x - lastC.x, y: 2 * y - lastC.y } : { x, y };
        const c2 = { x: ox + num(), y: oy + num() }, p = { x: ox + num(), y: oy + num() };
        curve(c1, c2, p); lastC = c2; keepC = true;
        break;
      }
      case 'Q': case 'T': {
        const q = C === 'Q' ? { x: ox + num(), y: oy + num() } : lastQ ? { x: 2 * x - lastQ.x, y: 2 * y - lastQ.y } : { x, y };
        const p = { x: ox + num(), y: oy + num() };
        curve({ x: x + (2 / 3) * (q.x - x), y: y + (2 / 3) * (q.y - y) }, { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) }, p);
        lastQ = q; keepQ = true;
        break;
      }
      case 'A': {
        const rx = num(), ry = num(), rot = num(), large = flag(), sweep = flag();
        const ex = ox + num(), ey = oy + num();
        for (const [c1, c2, p] of arcToCubics(x, y, rx, ry, rot, large, sweep, ex, ey)) curve(c1, c2, p);
        break;
      }
      case 'Z':
        if (ring) {
          // 終点が始点と同じなら1つにまとめる(始点の hin に入れる)
          if (ring.nodes.length > 1 && near(last(), ring.nodes[0])) {
            const l = ring.nodes.pop();
            if (l.hin) ring.nodes[0].hin = l.hin;
          }
          ring.closed = true;
        }
        x = sx; y = sy; ring = null;
        break;
      default:
        throw new Error('パスの命令が読めません: ' + cmd);
    }
    if (!keepC) lastC = null;
    if (!keepQ) lastQ = null;
  }
  return rings.filter((r) => r.nodes.length >= 2);
}

// SVG のパス → Kodai の path 図形の形の部分 { nodes, closed, subpaths? }
export function svgPathToShape(d) {
  const rings = parseSvgPath(d);
  if (!rings.length) throw new Error('パスに点がありません');
  const [first, ...rest] = rings;
  const out = { nodes: first.nodes, closed: first.closed };
  if (rest.length) out.subpaths = rest.map((r) => ({ nodes: r.nodes, closed: r.closed }));
  return out;
}
