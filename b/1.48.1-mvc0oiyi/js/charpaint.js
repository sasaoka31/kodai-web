// キャラメーカーの新しい画風(試作): 頭身が高い・輪郭線なし・面で塗る陰影・くすんだ色・顔は控えめ
//   paintHuman(opts, size) / paintQuad(opts, size) → ImageData(size × size、背景は透明)
//   ・形は「高さ = 1」の単位で作るので、頭身(heads)も絵の大きさ(size)も自由
//   ・陰影: 面の向き(法線)を粗く丸めてから光(左上)との向きで 明・中・影 の3段にカクッと分ける。手前のパーツのすぐ右下は影を落とす
//   ・色: 素材の色から、明るい面は暖かく、影は青みのあるくすんだ色へ(黒い輪郭線は使わない)
const hexToRgb = (h) => { const s = String(h).replace('#', ''); return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]; };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a, b) => [(a[0] * b[0]) / 255, (a[1] * b[1]) / 255, (a[2] * b[2]) / 255];
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

const WARM = [255, 240, 214], COOL = [70, 86, 122], DEEP = [38, 44, 72];
// 素材の色 → [明, 中, 影, 濃い影]。shade = 陰影の強さ(0〜1。0.7 がふつう、1 でいちばんきつい、0 で陰影なし)
function tones(hex, shade = 0.7) {
  const b = hexToRgb(hex), f = shade / 0.7;
  const dk = (m) => [255 - (255 - m[0]) * f, 255 - (255 - m[1]) * f, 255 - (255 - m[2]) * f].map((v) => Math.max(40, v));
  return [mix(b, WARM, Math.min(0.55, 0.3 * f)), b, mix(mul(b, dk([205, 205, 215])), COOL, Math.min(0.6, 0.3 * f)), mix(mul(b, dk([150, 150, 170])), DEEP, Math.min(0.8, 0.45 * f))]
    .map((c) => c.map((v) => Math.round(Math.min(255, Math.max(0, v)))));
}

// ---- 形(test = 中か、normal = 面の向き [x, y, z])----
const ell = (cx, cy, rx, ry, pw = 2) => ({
  test: (x, y) => Math.abs((x - cx) / rx) ** pw + Math.abs((y - cy) / ry) ** pw <= 1,
  normal: (x, y) => { const nx = (x - cx) / rx, ny = (y - cy) / ry; return [nx, ny, Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))]; },
});
// 太さの変わるカプセル(a の半径 ra → b の半径 rb)
function cap(ax, ay, bx, by, ra, rb = ra) {
  const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1e-9;
  const at = (x, y) => { const t = clamp01(((x - ax) * vx + (y - ay) * vy) / L2); return [x - (ax + vx * t), y - (ay + vy * t), ra + (rb - ra) * t]; };
  return {
    test: (x, y) => { const [dx, dy, r] = at(x, y); return dx * dx + dy * dy <= r * r; },
    normal: (x, y) => { const [dx, dy, r] = at(x, y); const nx = dx / r, ny = dy / r; return [nx, ny, Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))]; },
  };
}
function poly(pts, round = 0.8) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  // その高さでの左右の端(筒のように丸める中心と幅に使う)
  const span = (y) => {
    let a = Infinity, b = -Infinity;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y)) { const x = ((xj - xi) * (y - yi)) / (yj - yi) + xi; if (x < a) a = x; if (x > b) b = x; }
    }
    return a <= b ? [a, b] : [x0, x1];
  };
  return {
    test: (x, y) => {
      if (x < x0 || x > x1 || y < y0 || y > y1) return false;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    },
    normal: (x, y) => { const [a, b] = span(y); const nx = ((x - (a + b) / 2) / Math.max(1e-6, (b - a) / 2)) * round, ny = ((y - (y0 + y1) / 2) / Math.max(1e-6, (y1 - y0) / 2)) * 0.3; return [nx, ny, Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))]; },
  };
}
const flat = (s, n = [0, 0, 1]) => ({ test: s.test, normal: () => n });
const clip = (s, f) => ({ test: (x, y) => s.test(x, y) && f(x, y), normal: s.normal });

// ---- 描く ----
// parts = [{ shape, mat(色), z, dark?(1段暗く: 奥の脚など), noCast?(影を落とさない), tone?(段を決め打ち) }]
// fit = { x0, y0, x1, y1 }(単位の座標での絵の範囲)。size × size の中に収める
function rasterize(parts, fit, size, { facets = true, shade = 0.7 } = {}) {
  const img = new ImageData(size, size), d = img.data;
  const pad = Math.max(2, Math.round(size * 0.06));
  const s = Math.min((size - pad * 2) / (fit.x1 - fit.x0), (size - pad * 2) / (fit.y1 - fit.y0));
  const ox = size / 2 - ((fit.x0 + fit.x1) / 2) * s, oy = size - pad - fit.y1 * s; // 下ぞろえ(足もとを地面に)
  const sorted = parts.map((p, i) => ({ ...p, i })).sort((a, b) => a.z - b.z || a.i - b.i);
  const cache = new Map();
  const tn = (hex) => { if (!cache.has(hex)) cache.set(hex, tones(hex, shade)); return cache.get(hex); };
  const top = (x, y) => { for (let k = sorted.length - 1; k >= 0; k--) if (sorted[k].shape.test(x, y)) return sorted[k]; return null; };
  const L = [-0.5, -0.62, 0.6], ll = Math.hypot(...L);
  const px = 1 / s; // 1ドットの大きさ(単位)
  const castD = Math.max(1.2, size / 56) * px; // 影を落とす距離
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = (i + 0.5 - ox) / s, y = (j + 0.5 - oy) / s;
    const p = top(x, y);
    if (!p) continue;
    let t;
    if (p.tone !== undefined) t = p.tone;
    else {
      let [nx, ny, nz] = p.shape.normal(x, y);
      if (facets) { nx = Math.round(nx * 1.6) / 1.6; ny = Math.round(ny * 1.6) / 1.6; nz = Math.sqrt(Math.max(0.05, 1 - Math.min(0.95, nx * nx + ny * ny))); }
      const li = (nx * L[0] + ny * L[1] + nz * L[2]) / ll;
      t = li > 0.62 ? 0 : li > 0.2 ? 1 : 2;
      // 光の来る側(左上)のすぐ隣に、もっと手前のパーツがあれば、その影
      const q = top(x - castD, y - castD * 1.2);
      if (q && q !== p && q.z > p.z && !q.noCast) t = Math.min(3, t + 1);
      if (p.dark) t = Math.min(3, t + p.dark);
    }
    const c = tn(p.mat)[t], k = (j * size + i) * 4;
    d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2]; d[k + 3] = 255;
  }
  return img;
}

// ---- 人型(正面)----
export const HUMAN_OPTIONS = {
  frame: { full: '全身', bust: '胸から上(顔を大きく)' },
  face: { oval: 'ふつう', round: '丸い', square: '角ばった', long: '面長' },
  expr: { neutral: 'ふつう', smile: 'ほほえみ', grin: '笑う(歯)', angry: '怒り', sad: '悲しみ', surprised: '驚き', tired: '疲れ' },
  hair: { short: '短い', bob: 'ボブ', long: '長い', spiky: 'ツンツン', bald: 'なし' },
  hat: { none: 'なし', beanie: 'ニット帽', cap: 'キャップ', helmet: 'ヘルメット', brim: 'つば広の帽子' },
  beard: { none: 'なし', stubble: '無精ひげ', mustache: '口ひげ', full: 'あごひげ' },
  top: { shirt: '長そで', tshirt: '半そで', jacket: '上着', coat: 'コート', overalls: 'オーバーオール', jersey: 'ユニフォーム' },
  bottom: { pants: 'ズボン', shorts: '半ズボン', skirt: 'スカート' },
  shoes: { boots: 'ブーツ', shoes: 'くつ' },
  pose: { stand: '立つ', hips: '腰に手', wave: '手を上げる', hold: '物を持つ' },
  item: { none: 'なし', rod: 'さお・棒', bat: 'バット', lantern: 'ランタン', bag: 'かばん' },
};
export const HUMAN_COLORS = { skin: '肌', hair: '髪・ひげ', eyes: '目', top: '上の服', bottom: '下の服', shoes: 'くつ', hat: '帽子', accent: '飾り・小物' };
export const HUMAN_DEFAULTS = {
  heads: 6, build: 1, // 頭身、体格(肩幅・太さの倍率)
  frame: 'full', face: 'oval', expr: 'neutral', hair: 'short', hat: 'none', beard: 'none', top: 'shirt', bottom: 'pants', shoes: 'boots', pose: 'stand', item: 'none',
  colors: { skin: '#c9a084', hair: '#3b2e2a', eyes: '#2a2a34', top: '#7a8471', bottom: '#3f4a52', shoes: '#3a2f2a', hat: '#8a3b2e', accent: '#b9a16b' },
};
export const HUMAN_PRESETS = {
  fisher: { label: '漁師', heads: 6.2, build: 1.12, face: 'square', expr: 'tired', hat: 'beanie', beard: 'stubble', top: 'overalls', shoes: 'boots', pose: 'hold', item: 'rod', colors: { skin: '#c2a08a', hair: '#3a2c26', top: '#7b7f66', bottom: '#27403f', shoes: '#2c2a2a', hat: '#7a2f28', accent: '#8a8f96' } },
  player: { label: '選手', heads: 6.6, build: 1.05, expr: 'grin', hat: 'cap', top: 'jersey', shoes: 'shoes', pose: 'hold', item: 'bat', colors: { skin: '#cfa98c', hair: '#5a4030', top: '#e9ece8', bottom: '#dfe3df', shoes: '#3a3f47', hat: '#c4543a', accent: '#3f86a8' } },
  traveler: { label: '旅人', heads: 5.6, build: 0.95, face: 'long', expr: 'smile', hair: 'long', top: 'coat', shoes: 'boots', pose: 'hold', item: 'lantern', colors: { skin: '#d6b396', hair: '#6a3f2c', top: '#6b5a7a', bottom: '#4a4038', shoes: '#3d2e26', accent: '#e0b04e' } },
  worker: { label: '作業員', heads: 5, build: 1.2, face: 'square', expr: 'angry', hat: 'helmet', beard: 'full', top: 'jacket', shoes: 'boots', pose: 'hips', colors: { skin: '#b98d72', hair: '#2e2622', top: '#c58a2e', bottom: '#4b5560', shoes: '#2f2a28', hat: '#d9b23c', accent: '#d8dde0' } },
  kid: { label: '子ども', heads: 3.4, build: 0.95, face: 'round', expr: 'surprised', hair: 'spiky', top: 'tshirt', bottom: 'shorts', shoes: 'shoes', pose: 'wave', colors: { skin: '#e0b89b', hair: '#3f3a4a', top: '#4f8f8a', bottom: '#6a5a48', shoes: '#b0563e', accent: '#e8e2d0' } },
  lady: { label: '町の人', heads: 5.8, build: 0.9, face: 'oval', expr: 'smile', hair: 'bob', hat: 'brim', top: 'shirt', bottom: 'skirt', shoes: 'shoes', pose: 'hold', item: 'bag', colors: { skin: '#dcb79c', hair: '#4a3328', top: '#b9a58a', bottom: '#5f3f48', shoes: '#4a3a34', hat: '#cdbb8c', accent: '#7a5a3c' } },
};

// 絵の範囲(単位)と、1ドットの大きさ(単位)を先に決める(顔の細部を「最低1ドット」にするため)
function humanDims(o, size) {
  const H = Math.min(8, Math.max(2, o.heads)), t = clamp01((H - 2) / 5), B = o.build;
  const hd = 1 / H;
  const fw = { oval: 1, round: 1.08, square: 1.04, long: 0.9 }[o.face] || 1;
  const hw = hd * lerp(0.5, 0.39, t) * fw, hcy = hd * 0.52;
  const shY = hd * lerp(1.02, 1.18, t), sw = hd * lerp(0.52, 1.0, t) * B;
  const crY = Math.max(shY + hd * 0.5, lerp(0.74, 0.53, t));
  const wide = o.pose !== 'stand' || o.item !== 'none';
  let fit;
  if (o.frame === 'bust') { const top = -hd * (o.hat === 'none' ? (o.hair === 'spiky' ? 0.3 : 0.14) : 0.4), bot = shY + hd * 0.7, half = Math.max(sw * 1.12, (bot - top) / 2); fit = { x0: -half, x1: half, y0: top, y1: bot }; }
  else fit = { x0: -Math.max(sw * (wide ? 2.1 : 1.5), hw * 1.4), x1: Math.max(sw * (wide ? 2.1 : 1.5), hw * 1.4), y0: -hd * (o.item === 'rod' || o.item === 'bat' ? 0.75 : o.hat === 'none' ? 0.15 : 0.35), y1: 1 };
  const pad = Math.max(2, Math.round(size * 0.06));
  const s = Math.min((size - pad * 2) / (fit.x1 - fit.x0), (size - pad * 2) / (fit.y1 - fit.y0));
  return { H, t, B, hd, hw, hcy, shY, sw, crY, fit, px: 1 / s };
}

export function humanParts(o, size = 128) {
  const { H, t, hd, hw, hcy, shY, sw, crY, fit, px } = humanDims(o, size);
  const C = o.colors;
  const waY = shY + (crY - shY) * 0.6, wa = sw * 0.74, hip = sw * 0.84;
  const rA = sw * 0.2 * lerp(1.15, 1, t), rL = hip * 0.44;
  const P = [];
  const add = (shape, mat, z, extra = {}) => P.push({ shape, mat, z, ...extra });
  const mn = (v, dots) => Math.max(v, dots * px); // 最低でも dots ドット
  // ---- 脚と足 ----
  const legBot = 0.965, knY = lerp(crY, legBot, 0.5);
  for (const sgn of [-1, 1]) {
    const hx = sgn * hip * 0.5, fx = sgn * hip * 0.56;
    const bare = o.bottom === 'shorts' || o.bottom === 'skirt';
    add(cap(hx, crY - hd * 0.05, fx, knY, rL, rL * 0.82), o.bottom === 'skirt' ? C.skin : C.bottom, 2);
    add(cap(fx, knY, fx, legBot - rL * 0.3, rL * 0.8, rL * 0.62), bare ? C.skin : C.bottom, 1.9);
    if (o.shoes === 'boots') add(cap(fx, lerp(knY, legBot, 0.45), fx, legBot - rL * 0.3, rL * 0.86, rL * 0.74), C.shoes, 2.1);
    add(ell(fx + sgn * rL * 0.25, legBot, rL * 1.15, rL * 0.55), C.shoes, 2.2);
  }
  if (o.bottom === 'skirt') add(poly([[-wa, waY], [wa, waY], [hip * 1.25, lerp(crY, legBot, 0.38)], [-hip * 1.25, lerp(crY, legBot, 0.38)]]), C.bottom, 2.6);
  // ---- 胴 ----
  const torso = poly([[-sw, shY], [sw, shY], [sw * 0.98, shY + hd * 0.25], [wa, waY], [hip, crY], [-hip, crY], [-wa, waY], [-sw * 0.98, shY + hd * 0.25]]);
  add(torso, C.top, 3);
  add(ell(0, shY + hd * 0.06, sw * 1.02, hd * 0.2), C.top, 3); // 肩の丸み
  if (o.top === 'coat') add(poly([[-wa * 1.02, waY], [wa * 1.02, waY], [hip * 1.22, lerp(crY, legBot, 0.45)], [-hip * 1.22, lerp(crY, legBot, 0.45)]]), C.top, 3.2);
  if (o.top === 'overalls') {
    add(poly([[-wa * 0.82, shY + (waY - shY) * 0.45], [wa * 0.82, shY + (waY - shY) * 0.45], [hip, crY], [-hip, crY]]), C.bottom, 3.3);
    for (const sgn of [-1, 1]) add(poly([[sgn * wa * 0.78, shY + (waY - shY) * 0.47], [sgn * wa * 0.5, shY + (waY - shY) * 0.47], [sgn * sw * 0.42, shY], [sgn * sw * 0.66, shY]]), C.bottom, 3.3);
    for (const sgn of [-1, 1]) add(flat(ell(sgn * wa * 0.62, shY + (waY - shY) * 0.5, mn(hd * 0.045, 0.6), mn(hd * 0.045, 0.6))), C.accent, 3.4, { tone: 0 });
  }
  if (o.top === 'jersey' || o.top === 'jacket' || o.top === 'coat') add(flat(clip(torso, (x) => Math.abs(x) < mn(hd * 0.022, 0.5))), o.top === 'jersey' ? C.accent : C.top, 3.3, { tone: o.top === 'jersey' ? 1 : 3 }); // 前の合わせ
  if (o.top === 'jersey' || o.top === 'tshirt') add(poly([[-hw * 0.7, shY - hd * 0.02], [hw * 0.7, shY - hd * 0.02], [0, shY + hd * 0.3]]), o.top === 'jersey' ? C.accent : C.skin, 3.35, { noCast: true }); // えり元
  if (o.top === 'jacket' || o.top === 'coat') for (const sgn of [-1, 1]) add(poly([[sgn * hw * 0.12, shY + hd * 0.02], [sgn * hw * 0.9, shY - hd * 0.02], [sgn * hw * 0.55, shY + hd * 0.34]]), C.top, 3.4, { tone: sgn < 0 ? 0 : 2, noCast: true }); // えり
  if (o.top !== 'coat' && o.bottom !== 'skirt') add(flat(clip(torso, (x, y) => Math.abs(y - (crY - hd * 0.1)) < mn(hd * 0.035, 0.5))), C.shoes, 3.35, { tone: 1 }); // ベルト
  // ---- 腕(ポーズ)。角度は「真下から外向き」の度 ----
  const armLen = (crY - shY) * 1.02, la = armLen * 0.5, rad = Math.PI / 180;
  const hold = o.pose === 'hold' || (o.pose === 'stand' && o.item !== 'none');
  const ARM = { stand: [[6, 3], [6, 3]], hips: [[30, -42], [30, -42]], wave: [[6, 3], [78, 172]], hold: [[6, 3], [16, 78]] }[hold ? 'hold' : o.pose] || [[6, 3], [6, 3]];
  const short = o.top === 'tshirt' || (o.top === 'shirt' && H < 4.5);
  let hand = null;
  [-1, 1].forEach((sgn, k) => {
    const [U, F] = ARM[k];
    const sx = sgn * sw * 0.93, sy = shY + hd * 0.14;
    const ex = sx + sgn * Math.sin(U * rad) * la, ey = sy + Math.cos(U * rad) * la;
    const fl = la * (F > 60 && F < 120 ? 0.8 : 0.96); // 前に出した腕は短く見える
    const wx = ex + sgn * Math.sin(F * rad) * fl, wy = ey + Math.cos(F * rad) * fl;
    const z = o.pose === 'hips' ? 4.3 : 4;
    add(cap(sx, sy, ex, ey, rA * 1.1, rA * 0.95), C.top, z);
    add(cap(ex, ey, wx, wy, rA * 0.92, rA * 0.78), short ? C.skin : C.top, z);
    add(ell(wx + sgn * Math.sin(F * rad) * rA * 0.5, wy + Math.cos(F * rad) * rA * 0.5, rA * 0.98, rA * 1.05), C.skin, z + 0.3);
    if (k === 1) hand = [wx + sgn * Math.sin(F * rad) * rA * 0.5, wy + Math.cos(F * rad) * rA * 0.5];
  });
  // ---- 持ち物(右の手)----
  if (o.item !== 'none' && hand) {
    const [ix, iy] = hand;
    if (o.item === 'rod') add(cap(ix - sw * 0.05, iy + hd * 0.9, ix + sw * 0.5, -hd * 0.6, mn(hd * 0.03, 0.6), mn(hd * 0.018, 0.5)), C.accent, 4.2);
    if (o.item === 'bat') { add(cap(ix - sw * 0.04, iy + hd * 0.25, ix + sw * 0.22, iy - hd * 1.0, mn(hd * 0.035, 0.6), mn(hd * 0.05, 0.7)), '#c9a063', 4.2); add(cap(ix + sw * 0.22, iy - hd * 1.0, ix + sw * 0.4, iy - hd * 1.9, mn(hd * 0.06, 0.8), mn(hd * 0.085, 1)), '#c9a063', 4.2); }
    if (o.item === 'lantern') {
      add(flat(cap(ix, iy, ix, iy + hd * 0.35, mn(hd * 0.012, 0.5))), '#3a3632', 4.2, { tone: 1 });
      add(poly([[ix - hd * 0.15, iy + hd * 0.35], [ix + hd * 0.15, iy + hd * 0.35], [ix + hd * 0.18, iy + hd * 0.75], [ix - hd * 0.18, iy + hd * 0.75]]), '#3a3632', 4.6);
      add(flat(ell(ix, iy + hd * 0.55, hd * 0.11, hd * 0.15)), C.accent, 4.7, { tone: 0 });
    }
    if (o.item === 'bag') { add(flat(cap(ix, iy, ix, iy + hd * 0.2, mn(hd * 0.014, 0.5))), C.accent, 4.2, { tone: 2 }); add(poly([[ix - hd * 0.26, iy + hd * 0.2], [ix + hd * 0.26, iy + hd * 0.2], [ix + hd * 0.3, iy + hd * 0.75], [ix - hd * 0.3, iy + hd * 0.75]]), C.accent, 4.6); }
  }
  // ---- 首と頭 ----
  const pw = { oval: 2.6, round: 2.1, square: 3.6, long: 2.7 }[o.face] || 2.6;
  add(cap(0, shY - hd * 0.02, 0, hd * 0.8, hw * 0.42), C.skin, 5);
  const face = ell(0, hcy, hw, hd * 0.47, pw);
  add(face, C.skin, 6);
  add(ell(-hw * 0.98, hcy + hd * 0.03, hw * 0.13, hd * 0.09), C.skin, 5.9); add(ell(hw * 0.98, hcy + hd * 0.03, hw * 0.13, hd * 0.09), C.skin, 5.9, { dark: 1 });
  // ---- 顔 ----
  const eyeY = hcy + hd * 0.02, headPx = hd / px; // 頭の高さ(ドット)
  const X = { neutral: {}, smile: { browIn: -0.008, open: 0.8, mouth: 'smile' }, grin: { browIn: -0.012, open: 0.75, mouth: 'grin' }, angry: { browIn: 0.035, browOut: -0.012, open: 0.85, mouth: 'frown' },
    sad: { browIn: -0.03, browOut: 0.02, open: 0.9, mouth: 'frown' }, surprised: { browIn: -0.035, browOut: -0.03, open: 1.5, mouth: 'open' }, tired: { browIn: 0.006, open: 0.55, mouth: 'line', bags: true } }[o.expr] || {};
  const open = X.open ?? 1, skinMat = C.skin;
  // 影の側(右)のほお。面でカクッと暗く
  add(flat(clip(face, (x, y) => x > hw * 0.5 && y > eyeY - hd * 0.02 && y < eyeY + hd * 0.34 && x - hw * 0.5 > (y - eyeY) * 0.35)), skinMat, 6.05, { tone: 2 });
  // 眉の下のくぼみ
  for (const sgn of [-1, 1]) add(flat(ell(sgn * hw * 0.42, eyeY - hd * 0.012, hw * 0.27, mn(hd * 0.05, 0.9))), skinMat, 6.1, { tone: 2 });
  // 目: 頭が大きく描けるときは 白目 + 瞳 + 上まぶた、小さいときは点
  const ew = mn(hw * 0.19, 0.9), eh = mn(hd * 0.042 * open, 0.55);
  for (const sgn of [-1, 1]) {
    const ex = sgn * hw * 0.42, ey = eyeY + hd * 0.012;
    if (headPx >= 26) {
      add(flat(ell(ex, ey, ew, eh)), '#e8e2d6', 6.2, { tone: sgn > 0 ? 2 : 1 });
      add(flat(ell(ex + hw * 0.02, ey, Math.min(ew * 0.55, eh * 1.25), eh * 1.05)), C.eyes, 6.25, { tone: 1 });
      if (headPx >= 44) add(flat(ell(ex + hw * 0.02 - eh * 0.3, ey - eh * 0.35, mn(eh * 0.28, 0.5), mn(eh * 0.28, 0.5))), '#f4f0e8', 6.3, { tone: 0 }); // 目の光
      add(flat(clip(ell(ex, ey, ew * 1.08, eh * 1.25), (x, y) => y < ey - eh * (o.expr === 'tired' ? 0.1 : 0.55))), skinMat, 6.3, { tone: 3 }); // 上まぶた
    } else add(flat(ell(ex, ey, mn(ew * 0.5, 0.6), mn(eh, 0.6))), C.eyes, 6.2, { tone: 1 });
    if (X.bags && headPx >= 20) add(flat(clip(ell(ex, ey + eh * 1.6, ew * 1.05, mn(eh * 0.9, 0.5)), (x, y) => y > ey + eh * 1.3)), skinMat, 6.15, { tone: 2 });
    // 眉(髪の色。表情で傾く)
    const by = eyeY - hd * 0.095;
    add(flat(cap(sgn * hw * 0.16, by + hd * (X.browIn || 0), sgn * hw * 0.7, by + hd * (X.browOut || 0) + hd * 0.012, mn(hd * 0.02, 0.5), mn(hd * 0.014, 0.45))), C.hair, 6.35, { tone: 2 });
  }
  // 鼻: 明るい面 + 影の面 + 下の影
  add(flat(clip(face, (x, y) => x > -hw * 0.09 && x < hw * 0.07 && y > eyeY - hd * 0.02 && y < eyeY + hd * 0.17)), skinMat, 6.15, { tone: 0 });
  add(flat(clip(face, (x, y) => x >= hw * 0.07 && x < hw * 0.2 && y > eyeY + hd * 0.04 && y < eyeY + hd * 0.18)), skinMat, 6.15, { tone: 2 });
  add(flat(ell(hw * 0.03, eyeY + hd * 0.195, hw * 0.17, mn(hd * 0.018, 0.5))), skinMat, 6.16, { tone: 3 });
  // 口
  const my = eyeY + hd * 0.3, mw = hw * 0.3, mt = mn(hd * 0.016, 0.5), mouth = X.mouth || 'line';
  if (mouth === 'open') add(flat(ell(0, my + hd * 0.01, hw * 0.15, mn(hd * 0.05, 0.9))), '#4a2a2c', 6.2, { tone: 1 });
  else if (mouth === 'grin') { add(flat(ell(0, my, mw * 1.05, mn(hd * 0.045, 0.9))), '#4a2a2c', 6.2, { tone: 1 }); add(flat(clip(ell(0, my, mw * 0.95, mn(hd * 0.04, 0.8)), (x, y) => y < my + hd * 0.005)), '#efeadf', 6.25, { tone: 1 }); }
  else {
    add(flat(cap(-mw, my, mw, my, mt)), skinMat, 6.2, { tone: 3 });
    const dy = mouth === 'smile' ? -hd * 0.035 : mouth === 'frown' ? hd * 0.035 : 0;
    if (dy) for (const sgn of [-1, 1]) add(flat(cap(sgn * mw, my, sgn * mw * 1.35, my + dy, mt)), skinMat, 6.2, { tone: 3 });
    if (mouth === 'smile' && headPx >= 26) add(flat(ell(0, my + hd * 0.05, mw * 0.7, mn(hd * 0.018, 0.5))), skinMat, 6.18, { tone: 0 }); // 下くちびるの光
  }
  // ひげ
  const lower = (x, y) => y > eyeY + hd * 0.2;
  const mouthHole = (x, y) => Math.abs(x) < mw * 1.1 && Math.abs(y - my) < hd * 0.045;
  if (o.beard === 'full') add(clip(face, (x, y) => lower(x, y) && !mouthHole(x, y)), C.hair, 6.18);
  if (o.beard === 'stubble') add(flat(clip(face, (x, y) => y > eyeY + hd * 0.22 && !mouthHole(x, y) && !(Math.abs(x) < hw * 0.5 && y < my - hd * 0.05))), skinMat, 6.12, { tone: 2 });
  if (o.beard === 'mustache') add(clip(ell(0, my - hd * 0.045, mw * 1.25, mn(hd * 0.04, 0.8)), (x, y) => y < my - hd * 0.012), C.hair, 6.3);
  // ---- 髪・帽子 ----
  const crown = ell(0, hcy - hd * 0.06, hw * 1.08, hd * 0.47, 2.4);
  const sideDown = { short: 0.06, bob: 0.36, long: 0.5, spiky: 0.02 }[o.hair] ?? 0.06;
  if (o.hat === 'none' || o.hat === 'brim') {
    if (o.hair !== 'bald') {
      add(clip(crown, (x, y) => y < eyeY - hd * 0.13 - Math.abs(x) * 0.08 || (Math.abs(x) > hw * 0.84 && y < eyeY + hd * sideDown)), C.hair, 7);
      if (o.hair === 'bob') for (const sgn of [-1, 1]) add(cap(sgn * hw * 0.96, hcy - hd * 0.1, sgn * hw * 0.92, eyeY + hd * 0.36, hw * 0.26, hw * 0.2), C.hair, 6.6);
      if (o.hair === 'long') for (const sgn of [-1, 1]) add(cap(sgn * hw * 0.95, hcy, sgn * hw * 1.02, shY + hd * 0.25, hw * 0.24, hw * 0.16), C.hair, 5.5);
      if (o.hair === 'spiky' && o.hat === 'none') for (const [a, b] of [[-0.75, 0.16], [-0.35, 0.24], [0.05, 0.27], [0.45, 0.22], [0.8, 0.13]]) add(poly([[(a - 0.24) * hw, hcy - hd * 0.36], [(a + 0.24) * hw, hcy - hd * 0.36], [(a + 0.08) * hw, hcy - hd * (0.42 + b)]]), C.hair, 7.05);
    }
  } else add(clip(crown, (x, y) => y < eyeY - hd * 0.02 && y > eyeY - hd * 0.1 && Math.abs(x) > hw * 0.6), C.hair, 6.9); // こめかみの髪
  if (o.hat === 'beanie') { add(clip(ell(0, hcy - hd * 0.1, hw * 1.12, hd * 0.5, 2.2), (x, y) => y < eyeY - hd * 0.12), C.hat, 7.2); add(flat(clip(ell(0, hcy - hd * 0.1, hw * 1.16, hd * 0.52, 2.2), (x, y) => y < eyeY - hd * 0.1 && y > eyeY - hd * 0.22)), C.hat, 7.3, { tone: 2 }); }
  if (o.hat === 'cap') { add(clip(ell(0, hcy - hd * 0.08, hw * 1.1, hd * 0.48, 2.2), (x, y) => y < eyeY - hd * 0.14), C.hat, 7.2); add(ell(hw * 0.25, eyeY - hd * 0.13, hw * 0.95, hd * 0.07), C.hat, 7.3, { dark: 1 }); }
  if (o.hat === 'helmet') { add(clip(ell(0, hcy - hd * 0.06, hw * 1.2, hd * 0.56, 2), (x, y) => y < eyeY - hd * 0.13), C.hat, 7.2); add(ell(0, eyeY - hd * 0.13, hw * 1.32, hd * 0.06), C.hat, 7.3, { dark: 1 }); }
  if (o.hat === 'brim') { add(clip(ell(0, hcy - hd * 0.12, hw * 1.0, hd * 0.45, 2.2), (x, y) => y < eyeY - hd * 0.16), C.hat, 7.2); add(ell(0, eyeY - hd * 0.17, hw * 1.9, hd * 0.075), C.hat, 7.3); add(flat(clip(ell(0, hcy - hd * 0.12, hw * 1.02, hd * 0.46, 2.2), (x, y) => y < eyeY - hd * 0.2 && y > eyeY - hd * 0.27)), C.accent, 7.35, { tone: 2 }); }
  return { parts: P, fit };
}

export function humanOptions(o = {}) {
  const base = HUMAN_PRESETS[o.preset] || {};
  const r = { ...HUMAN_DEFAULTS, ...base, ...o, colors: { ...HUMAN_DEFAULTS.colors, ...(base.colors || {}), ...(o.colors || {}) } };
  if (r.beard === true) r.beard = 'full'; if (r.beard === false) r.beard = 'none';
  for (const k of Object.keys(HUMAN_OPTIONS)) if (!(r[k] in HUMAN_OPTIONS[k])) r[k] = HUMAN_DEFAULTS[k];
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  r.heads = Math.min(8, Math.max(2, num(r.heads, 6))); r.build = Math.min(1.5, Math.max(0.7, num(r.build, 1)));
  delete r.label; delete r.preset;
  return r;
}
// ro = { shade: 陰影の強さ 0〜1(0.7 がふつう), facets: 面をカクッと分ける }
export function paintHuman(opts, size = 128, ro) {
  const { parts, fit } = humanParts(humanOptions(opts), size);
  return rasterize(parts, fit, size, ro);
}

// ---- 四つ足(右向き)----
export const QUAD_DEFAULTS = {
  bodyLen: 0.5, bodyH: 0.26, chest: 1.12, belly: 0.9, legLen: 0.34, legW: 0.045, neckLen: 0.16, neckAng: 45, neckW: 0.1, headLen: 0.2, headH: 0.105, snout: 0.6,
  ear: 'point', tail: 'bushy', mane: false, antler: false, paw: 'paw',
  colors: { fur: '#7f7468', belly: '#b4aa9a', dark: '#4a443f', nose: '#2a2628', accent: '#e8e2d2' },
};
export const QUAD_PRESETS = {
  wolf: { label: '狼', bodyLen: 0.5, bodyH: 0.25, chest: 1.18, legLen: 0.36, legW: 0.042, neckLen: 0.15, neckAng: 36, neckW: 0.105, headLen: 0.22, headH: 0.105, snout: 0.62, ear: 'point', tail: 'bushy', colors: { fur: '#7f7d7c', belly: '#a9a59e', dark: '#4b4a4e', nose: '#26242a', accent: '#d9d4c7' } },
  dog: { label: '犬', bodyLen: 0.42, bodyH: 0.26, legLen: 0.28, legW: 0.045, neckLen: 0.12, neckAng: 50, neckW: 0.1, headLen: 0.19, headH: 0.115, snout: 0.45, ear: 'flop', tail: 'up', colors: { fur: '#b98a5a', belly: '#d9c4a0', dark: '#6e4a32', nose: '#2c2422', accent: '#f1e7d2' } },
  cat: { label: '猫', bodyLen: 0.42, bodyH: 0.22, chest: 1.0, legLen: 0.24, legW: 0.036, neckLen: 0.07, neckAng: 50, neckW: 0.085, headLen: 0.12, headH: 0.115, snout: 0.12, ear: 'point', tail: 'long', colors: { fur: '#5b5f66', belly: '#8d9197', dark: '#33363b', nose: '#b0787a', accent: '#d7dbde' } },
  horse: { label: '馬', bodyLen: 0.5, bodyH: 0.3, chest: 1.08, belly: 1, legLen: 0.5, legW: 0.04, neckLen: 0.3, neckAng: 52, neckW: 0.12, headLen: 0.26, headH: 0.1, snout: 0.85, ear: 'small', tail: 'horse', mane: true, paw: 'hoof', colors: { fur: '#7a4f36', belly: '#7f553b', dark: '#2e2523', nose: '#3a2e2c', accent: '#d8cdbd' } },
  deer: { label: '鹿', bodyLen: 0.45, bodyH: 0.24, chest: 1.05, legLen: 0.46, legW: 0.03, neckLen: 0.26, neckAng: 62, neckW: 0.08, headLen: 0.18, headH: 0.085, snout: 0.6, ear: 'leaf', tail: 'stub', antler: true, paw: 'hoof', colors: { fur: '#a9794f', belly: '#d2bf9f', dark: '#4a3526', nose: '#2a2220', accent: '#e9e0cc' } },
  boar: { label: '猪', bodyLen: 0.5, bodyH: 0.34, chest: 1.22, belly: 1, legLen: 0.2, legW: 0.045, neckLen: 0.05, neckAng: 10, neckW: 0.15, headLen: 0.24, headH: 0.13, snout: 0.7, ear: 'small', tail: 'stub', paw: 'hoof', colors: { fur: '#5a4a40', belly: '#62513f', dark: '#2f2824', nose: '#3b2f2c', accent: '#e6dfcf' } },
};
export const QUAD_OPTIONS = {
  ear: { point: 'とがった耳', flop: 'たれ耳', small: '小さい耳', leaf: '横向きの耳' },
  tail: { bushy: 'ふさふさ', up: '上向き', long: '長い', horse: '馬のしっぽ', stub: '短い' },
  paw: { paw: '足(肉球)', hoof: 'ひづめ' },
};
export const QUAD_COLORS = { fur: '毛', belly: 'おなか', dark: '濃い部分(たてがみ・ひづめ)', nose: '鼻', accent: '角・しっぽの白' };
export function quadOptions(o = {}) {
  const base = QUAD_PRESETS[o.preset] || {};
  const r = { ...QUAD_DEFAULTS, ...base, ...o, colors: { ...QUAD_DEFAULTS.colors, ...(base.colors || {}), ...(o.colors || {}) } };
  for (const k of Object.keys(QUAD_OPTIONS)) if (!(r[k] in QUAD_OPTIONS[k])) r[k] = QUAD_DEFAULTS[k];
  delete r.label; delete r.preset;
  return r;
}

export function quadParts(o) {
  const C = o.colors, P = [];
  const add = (shape, mat, z, extra = {}) => P.push({ shape, mat, z, ...extra });
  const ground = 0, backY = -(o.legLen + o.bodyH * 0.9); // 背中の高さ(y は下向きが正。地面 = 0)
  const hipX = -o.bodyLen / 2, shX = o.bodyLen / 2, midY = backY + o.bodyH / 2;
  const rh = (o.bodyH / 2) * 0.95, rs = (o.bodyH / 2) * o.chest;
  // 胴: 腰と胸の2つの丸をつなぐ + 腹
  add(cap(hipX + rh * 0.3, midY, shX - rs * 0.3, midY + (rs - rh) * 0.3, rh, rs), C.fur, 5);
  add(ell(shX - rs * 0.35, midY + (rs - rh) * 0.3, rs * 1.02, rs * 1.05), C.fur, 5); // 胸のかたまり
  add(ell(hipX + rh * 0.45, midY - rh * 0.02, rh * 1.05, rh * 1.02), C.fur, 5); // 腰のかたまり
  add(clip(cap(hipX + rh * 0.5, midY + rh * 0.35, shX - rs * 0.5, midY + rs * 0.4, rh * 0.75 * o.belly, rs * 0.7), (x, y) => y > midY + rh * 0.3), C.belly, 5.1, { noCast: true });
  // 脚: 奥(暗く)と手前。前脚はまっすぐ、後ろ脚は「く」の字
  const leg = (x, top, far, hind) => {
    const z = far ? 2 : 6, dk = far ? { dark: 1 } : {}, w = o.legW * (far ? 0.95 : 1), off = far ? o.legW * 0.9 : 0;
    const x0 = x + off, kneeY = lerp(top, ground, 0.52), ankleY = ground - o.legW * 0.9;
    if (hind) {
      add(cap(x0, top, x0 + o.legLen * 0.06, kneeY, w * 2.3, w * 1.15), C.fur, z, dk);
      add(cap(x0 + o.legLen * 0.06, kneeY, x0 - o.legLen * 0.07, lerp(kneeY, ankleY, 0.5), w * 1.1, w * 0.85), C.fur, z, dk);
      add(cap(x0 - o.legLen * 0.07, lerp(kneeY, ankleY, 0.5), x0 - o.legLen * 0.03, ankleY, w * 0.85, w * 0.8), C.fur, z, dk);
      add(ell(x0 + w * 0.5, ground - w * 0.55, w * 1.5, w * 0.62), o.paw === 'hoof' ? C.dark : C.fur, z + 0.1, dk);
    } else {
      add(cap(x0, top, x0 - o.legLen * 0.02, kneeY, w * 1.5, w * 1.02), C.fur, z, dk);
      add(cap(x0 - o.legLen * 0.02, kneeY, x0 + o.legLen * 0.01, ankleY, w, w * 0.82), C.fur, z, dk);
      add(ell(x0 + w * 0.6, ground - w * 0.55, w * 1.5, w * 0.62), o.paw === 'hoof' ? C.dark : C.fur, z + 0.1, dk);
    }
  };
  const legTop = midY + rh * 0.2;
  leg(hipX + rh * 0.15, legTop, true, true); leg(shX - rs * 0.35, legTop, true, false);
  leg(hipX + rh * 0.05, legTop, false, true); leg(shX - rs * 0.5, legTop, false, false);
  // 首と頭
  const a = (o.neckAng * Math.PI) / 180;
  const nx0 = shX - rs * 0.25, ny0 = midY - rs * 0.35, nx1 = nx0 + Math.cos(a) * o.neckLen, ny1 = ny0 - Math.sin(a) * o.neckLen;
  add(cap(nx0 - rs * 0.1, ny0 + rs * 0.3, nx1, ny1, Math.max(o.neckW * 1.6, rs * 0.8), o.neckW), C.fur, 5.5);
  const hx = nx1 + o.headLen * 0.12, hy = ny1 - o.headH * 0.1, hr = o.headH;
  add(ell(hx, hy, hr * 1.15, hr), C.fur, 7);
  const sx = hx + o.headLen * (0.35 + o.snout * 0.6), sy = hy + hr * 0.35;
  add(cap(hx + hr * 0.3, hy + hr * 0.18, sx, sy, hr * 0.78, hr * 0.5), C.fur, 6.9);
  add(clip(cap(hx + hr * 0.3, hy + hr * 0.5, sx, sy + hr * 0.12, hr * 0.5, hr * 0.34), (x, y) => y > hy + hr * 0.35), C.belly, 6.95, { noCast: true });
  add(flat(ell(sx + hr * 0.25, sy - hr * 0.08, hr * 0.2, hr * 0.17)), C.nose, 7.2, { tone: 1 });
  add(flat(ell(hx + hr * 0.45, hy - hr * 0.12, hr * 0.13, hr * 0.13)), '#1f1d22', 7.2, { tone: 1 });
  // 耳
  const ex = hx - hr * 0.35, ey = hy - hr * 0.75;
  if (o.ear === 'point') { add(poly([[ex - hr * 0.5, ey + hr * 0.3], [ex + hr * 0.45, ey + hr * 0.2], [ex - hr * 0.05, ey - hr * 1.0]]), C.fur, 7.1); add(poly([[ex - hr * 1.0, ey + hr * 0.5], [ex - hr * 0.2, ey + hr * 0.3], [ex - hr * 0.7, ey - hr * 0.7]]), C.fur, 6.5, { dark: 1 }); }
  if (o.ear === 'flop') add(cap(ex + hr * 0.1, ey + hr * 0.3, ex - hr * 0.25, ey + hr * 1.5, hr * 0.42, hr * 0.3), C.dark, 7.1);
  if (o.ear === 'small') { add(poly([[ex - hr * 0.3, ey + hr * 0.3], [ex + hr * 0.3, ey + hr * 0.25], [ex + hr * 0.05, ey - hr * 0.55]]), C.fur, 7.1); }
  if (o.ear === 'leaf') { add(cap(ex, ey + hr * 0.3, ex - hr * 0.9, ey - hr * 0.5, hr * 0.3, hr * 0.14), C.fur, 7.1); }
  if (o.antler) for (const [bx, k] of [[ex + hr * 0.5, 1], [ex + hr * 0.15, 0.85]]) {
    const top = ey - hr * 2.6 * k;
    add(cap(bx, ey + hr * 0.2, bx - hr * 0.3, top, hr * 0.13, hr * 0.07), C.accent, k === 1 ? 7.05 : 6.4, k === 1 ? {} : { dark: 1 });
    add(cap(bx - hr * 0.12, lerp(ey, top, 0.45), bx + hr * 0.7 * k, lerp(ey, top, 0.8), hr * 0.09, hr * 0.05), C.accent, k === 1 ? 7.05 : 6.4, k === 1 ? {} : { dark: 1 });
    add(cap(bx - hr * 0.2, lerp(ey, top, 0.7), bx - hr * 0.9 * k, lerp(ey, top, 1.05), hr * 0.08, hr * 0.045), C.accent, k === 1 ? 7.05 : 6.4, k === 1 ? {} : { dark: 1 });
  }
  if (o.mane) add(cap(nx0 - rs * 0.55, ny0 + rs * 0.05, nx1 - o.neckW * 0.95, ny1 - o.neckW * 0.2, o.neckW * 0.5, o.neckW * 0.35), C.dark, 5.4); // 首のうしろ側に
  // しっぽ
  const tx = hipX - rh * 0.55, ty = midY - rh * 0.45;
  if (o.tail === 'bushy') add(cap(tx, ty, tx - o.bodyLen * 0.26, ty + o.bodyH * 0.75, rh * 0.3, rh * 0.42), C.fur, 4);
  if (o.tail === 'up') add(cap(tx, ty, tx - o.bodyLen * 0.14, ty - o.bodyH * 0.7, rh * 0.26, rh * 0.14), C.fur, 4);
  if (o.tail === 'long') { add(cap(tx, ty, tx - o.bodyLen * 0.26, ty + o.bodyH * 0.5, rh * 0.2, rh * 0.16), C.fur, 4); add(cap(tx - o.bodyLen * 0.26, ty + o.bodyH * 0.5, tx - o.bodyLen * 0.4, ty + o.bodyH * 0.1, rh * 0.16, rh * 0.13), C.fur, 4); }
  if (o.tail === 'horse') add(cap(tx, ty, tx - o.bodyLen * 0.14, ty + o.bodyH * 1.6, rh * 0.22, rh * 0.36), C.dark, 4);
  if (o.tail === 'stub') add(ell(tx - rh * 0.1, ty, rh * 0.3, rh * 0.24), C.accent, 4);
  const xs = [tx - o.bodyLen * 0.42, sx + hr * 0.6], top = Math.min(ny1 - hr * (o.antler ? 3.8 : 2.2), backY - 0.02);
  return { parts: P, fit: { x0: xs[0], x1: xs[1], y0: top, y1: 0 } };
}
export function paintQuad(opts, size = 128, ro) {
  const { parts, fit } = quadParts(quadOptions(opts));
  return rasterize(parts, fit, size, ro);
}
