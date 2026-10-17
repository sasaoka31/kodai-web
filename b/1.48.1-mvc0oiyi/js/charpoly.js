// キャラメーカーの「面(パス)で作る」方式(試作): 顔や体を、小さな面(三角・四角のパス)の集まりにして、面ごとに1色で塗る
//   buildBust(opts) → { polys: [{ pts: [[x, y], …], color: '#rrggbb' }], w, h }(奥から手前の順。単位は「頭の高さ = 1」)
//   drawPolys(ctx, bust, size) … キャンバスに描く
//   しくみ: 頂点は奥行き z つきの 3D の点。面の向き(法線)と光(左上・手前)の向きで明るさを決めて、段に丸めて色にする。
//          表情は、眉・まぶた・口の点を動かして作る。目・眉・口は、顔の面の少し手前に置いた別の面
import { parseHex } from './color.js';

export const POLY_OPTIONS = {
  frame: { full: '全身', bust: '胸から上', face: '顔のアップ' },
  expr: { neutral: 'ふつう', smile: 'ほほえみ', grin: '笑う(歯)', angry: '怒り', sad: '悲しみ', surprised: '驚き', tired: '疲れ', smirk: 'にやり', fear: 'おびえ' },
  face: { oval: 'ふつう', round: '丸い', square: '角ばった', long: '面長', gaunt: 'こけた' },
  eye: { almond: 'アーモンド', round: '丸い', narrow: '切れ長', sharp: '鋭い', half: '半目(ジト目)', dot: '点' },
  iris: { hex: '六角', round: '丸', diamond: 'ひし形', square: '四角', slit: '縦長(猫の目)', star: '星' },
  hair: { short: '短髪(刈り上げ)', quiff: '立ち上げ', side: '横分け(流す)', swept: 'オールバック', messy: '無造作', spiky: 'ツンツン', afro: 'アフロ', buzz: '坊主', bob: 'ボブ(センター分け)', long: '長い(センター分け)', bald: 'なし(スキンヘッド)' },
  hat: { none: 'なし', beanie: 'ニット帽', cap: 'キャップ' },
  beard: { none: 'なし', stubble: '無精ひげ', full: 'あごひげ', mustache: '口ひげ' },
  top: { sweater: 'セーター', overalls: 'オーバーオール', jacket: '上着', coat: 'コート', shirt: 'シャツ', tshirt: '半そで' },
  bottom: { pants: 'ズボン', shorts: '半ズボン', skirt: 'スカート' },
  shoes: { boots: 'ブーツ', shoes: 'くつ' },
  pose: { stand: '立つ', hips: '腰に手', wave: '手を上げる', hold: '物を持つ' },
  item: { none: 'なし', rod: 'さお・棒', bat: 'バット', lantern: 'ランタン', bag: 'かばん' },
};
// 顔のパーツの調整(スライダー)。[名前, 最小, 最大, 刻み]。既定は 1(倍率)か 0(ずらす量)
export const POLY_FACE = {
  eyeSize: ['目の大きさ', 0.6, 1.7, 0.05], eyeGap: ['目の間隔', 0.8, 1.25, 0.01], eyeY: ['目の高さ', -0.04, 0.04, 0.005], eyeTilt: ['つり目 ↔ たれ目', -1, 1, 0.05], iris: ['瞳の大きさ', 0.6, 1.5, 0.05],
  browThick: ['眉の太さ', 0.4, 2.2, 0.05], browY: ['眉の高さ', -0.03, 0.03, 0.005],
  noseW: ['鼻の幅', 0.6, 1.7, 0.05], noseLen: ['鼻の長さ', 0.75, 1.22, 0.01], noseH: ['鼻の高さ(出っ張り)', 0.5, 1.6, 0.05],
  mouthW: ['口の幅', 0.6, 1.5, 0.05], mouthY: ['口の高さ', -0.03, 0.03, 0.005], lip: ['くちびるの厚み', 0.4, 2, 0.05],
  jawW: ['えらの幅', 0.8, 1.3, 0.01], chinLen: ['あごの長さ', 0.8, 1.3, 0.01], cheek: ['ほお骨', 0.85, 1.25, 0.01], headW: ['顔の幅', 0.85, 1.15, 0.01], earSize: ['耳の大きさ', 0.5, 1.8, 0.05],
};
const FACE_ZERO = new Set(['eyeY', 'eyeTilt', 'browY', 'mouthY']);
export const faceDefault = (k) => (FACE_ZERO.has(k) ? 0 : 1);

export const POLY_DEFAULTS = {
  frame: 'full', expr: 'neutral', face: 'oval', eye: 'almond', iris: 'hex', asym: 0.6, asymSeed: 1, detail: 2, detailHair: 1, detailBody: 1, relief: 1.3, hair: 'short', hat: 'none', beard: 'none', top: 'sweater', bottom: 'pants', shoes: 'boots', pose: 'stand', item: 'none',
  heads: 6.5, age: 0.3, build: 1, yaw: 0, shade: 0.7, steps: 7,
  colors: { skin: '#c9a084', hair: '#3b2e2a', eyes: '#3a4a52', top: '#7a8471', top2: '#27403f', bottom: '#3f4a52', shoes: '#3a2f2a', hat: '#7a2f28', accent: '#8a8f96' },
};
export const POLY_PRESETS = {
  fisher: { label: '漁師', face: 'square', expr: 'tired', hat: 'beanie', beard: 'stubble', top: 'overalls', shoes: 'boots', pose: 'hold', item: 'rod', heads: 6.3, age: 0.7, build: 1.1, colors: { skin: '#c2a08a', hair: '#3a2c26', top: '#7b7f66', top2: '#27403f', bottom: '#27403f', shoes: '#2c2a2a', hat: '#7a2f28' } },
  traveler: { label: '旅人', face: 'long', expr: 'smile', hair: 'long', top: 'coat', shoes: 'boots', pose: 'hold', item: 'lantern', heads: 6.6, age: 0.2, build: 0.95, colors: { skin: '#d6b396', hair: '#6a3f2c', top: '#6b5a7a', top2: '#3c3348', bottom: '#4a4038', shoes: '#3d2e26', eyes: '#4a5a3a', accent: '#e0b04e' } },
  worker: { label: '作業員', face: 'square', expr: 'angry', hair: 'short', beard: 'full', top: 'jacket', pose: 'hips', heads: 5.6, age: 0.5, build: 1.2, colors: { skin: '#b98d72', hair: '#2e2622', top: '#c58a2e', top2: '#7a5a22', bottom: '#4b5560', shoes: '#2f2a28' } },
  kid: { label: '若者', face: 'round', expr: 'surprised', hair: 'messy', top: 'tshirt', bottom: 'shorts', shoes: 'shoes', pose: 'wave', heads: 4.6, age: 0, build: 0.9, colors: { skin: '#e0b89b', hair: '#3f3a4a', top: '#4f8f8a', top2: '#e8e2d0', bottom: '#6a5a48', shoes: '#b0563e', eyes: '#3a3a44' } },
  elder: { label: '老人', face: 'gaunt', expr: 'smirk', hair: 'swept', beard: 'mustache', top: 'sweater', heads: 6, age: 1, build: 0.9, colors: { skin: '#cbb09a', hair: '#b9b6b0', top: '#5a4a44', bottom: '#3a3836', shoes: '#2a2624', eyes: '#4a5560' } },
  player: { label: '選手', face: 'oval', expr: 'grin', hat: 'cap', top: 'shirt', shoes: 'shoes', pose: 'hold', item: 'bat', heads: 6.8, age: 0.25, build: 1.05, colors: { skin: '#cfa98c', hair: '#5a4030', top: '#e9ece8', top2: '#3f86a8', bottom: '#dfe3df', shoes: '#3a3f47', hat: '#c4543a' } },
  rogue: { label: '色男', face: 'oval', expr: 'smirk', hair: 'quiff', top: 'jacket', shoes: 'shoes', pose: 'hips', heads: 7, age: 0.15, build: 1, colors: { skin: '#d2ab8e', hair: '#2a2226', top: '#3a3f4a', top2: '#8a2f2a', bottom: '#2c2e36', shoes: '#1f1d1f', eyes: '#3f6a7a' } },
  lady: { label: '町の人', face: 'oval', expr: 'smile', hair: 'bob', top: 'shirt', bottom: 'skirt', shoes: 'shoes', pose: 'hold', item: 'bag', heads: 6.4, age: 0.2, build: 0.88, colors: { skin: '#dcb79c', hair: '#4a3328', top: '#b9a58a', top2: '#7a5a3c', bottom: '#5f3f48', shoes: '#4a3a34', accent: '#7a5a3c' } },
};

export function polyOptions(o = {}) {
  const base = POLY_PRESETS[o.preset] || {};
  const r = { ...POLY_DEFAULTS, ...base, ...o, colors: { ...POLY_DEFAULTS.colors, ...(base.colors || {}), ...(o.colors || {}) } };
  for (const k of Object.keys(POLY_OPTIONS)) if (!(r[k] in POLY_OPTIONS[k])) r[k] = POLY_DEFAULTS[k];
  // 顔のパーツの調整(範囲に丸める)
  r.parts = { ...(base.parts || {}), ...(o.parts || {}) };
  for (const [k, [, min, max]] of Object.entries(POLY_FACE)) { const v = Number(r.parts[k]); r.parts[k] = Number.isFinite(v) && r.parts[k] !== undefined && r.parts[k] !== null ? Math.min(max, Math.max(min, v)) : faceDefault(k); }
  for (const k of ['heads', 'age', 'build', 'yaw', 'shade', 'steps', 'asym', 'asymSeed', 'detail', 'detailHair', 'detailBody', 'relief']) { const v = Number(r[k]); if (!Number.isFinite(v)) r[k] = POLY_DEFAULTS[k]; }
  r.asym = Math.min(3, Math.max(0, r.asym)); for (const k of ['detail', 'detailHair', 'detailBody']) r[k] = Math.min(3, Math.max(1, Math.round(r[k])));
  r.relief = Math.min(2, Math.max(0, r.relief)); r.asymSeed = Math.min(99, Math.max(1, Math.round(r.asymSeed)));
  r.heads = Math.min(8, Math.max(2.5, r.heads)); r.age = Math.min(1, Math.max(0, r.age)); r.build = Math.min(1.4, Math.max(0.75, r.build)); r.yaw = Math.min(180, Math.max(-180, r.yaw)); r.shade = Math.min(1, Math.max(0, r.shade)); r.steps = Math.min(16, Math.max(2, Math.round(r.steps)));
  delete r.label; delete r.preset;
  return r;
}

// ---- 乱数(同じ種なら同じ結果)----
function rng(seed) {
  let a = (Math.round(seed) | 0) ^ 0x9e3779b9;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ランダムなキャラ(種を決めれば毎回同じ)。構図・向き・陰影は変えない
const R_SKIN = ['#ecc9ad', '#e0b89b', '#d6b396', '#c9a084', '#b98d72', '#a2785a', '#86603f', '#6b4a33', '#52382a'];
const R_HAIR = ['#211c1f', '#2e2622', '#3b2e2a', '#4a3328', '#5a4030', '#6a3f2c', '#8a5a2b', '#a9792f', '#c9b98a', '#b9b6b0', '#8f8c88', '#7a2f28', '#3f3a4a', '#5a2f4a'];
const R_EYES = ['#3a4a52', '#4a5a3a', '#5a4030', '#3f6a7a', '#3a3a44', '#6a5a2a', '#2f5a6a', '#4a3a5a'];
const R_CLOTH = ['#7a8471', '#7b7f66', '#6b5a7a', '#c58a2e', '#4f8f8a', '#5a4a44', '#e9ece8', '#3a3f4a', '#b9a58a', '#8a3b2e', '#3f5a78', '#56704a', '#9a8a6a', '#4a4a56', '#b06a4a', '#2c2e36'];
const R_DARK = ['#27403f', '#3f4a52', '#4a4038', '#4b5560', '#3a3836', '#2c2e36', '#5f3f48', '#6a5a48', '#33413a', '#3a2f3f', '#dfe3df', '#5a4a3a'];
export function randomPoly(seed = Math.floor(Math.random() * 1e9)) {
  const r = rng(seed), pick = (a) => a[Math.floor(r() * a.length)], keys = (k) => Object.keys(POLY_OPTIONS[k]);
  const chance = (p) => r() < p;
  const o = {
    expr: pick(keys('expr')), face: pick(keys('face')), eye: pick(keys('eye').filter((k) => k !== 'dot' || chance(0.3))), iris: chance(0.6) ? 'hex' : pick(keys('iris')),
    hair: pick(keys('hair')), hat: chance(0.25) ? pick(keys('hat').filter((k) => k !== 'none')) : 'none', beard: chance(0.35) ? pick(keys('beard').filter((k) => k !== 'none')) : 'none',
    top: pick(keys('top')), bottom: chance(0.75) ? 'pants' : pick(keys('bottom')), shoes: pick(keys('shoes')), pose: pick(keys('pose')), item: chance(0.4) ? pick(keys('item').filter((k) => k !== 'none')) : 'none',
    heads: Math.round((5 + r() * 2.6) * 10) / 10, age: Math.round(r() * r() * 20) / 20, build: Math.round((0.85 + r() * 0.4) * 100) / 100, asym: Math.round((0.3 + r() * 1.2) * 20) / 20, asymSeed: 1 + Math.floor(r() * 99),
    colors: { skin: pick(R_SKIN), hair: pick(R_HAIR), eyes: pick(R_EYES), top: pick(R_CLOTH), top2: pick(R_DARK), bottom: pick(R_DARK), shoes: pick(['#2c2a2a', '#3a2f2a', '#3d2e26', '#4a3a34', '#3a3f47', '#1f1d1f', '#6a4a30']), hat: pick(R_CLOTH), accent: pick(['#8a8f96', '#b9a16b', '#e0b04e', '#7a5a3c', '#d8dde0']) },
    parts: {},
  };
  if (o.item !== 'none' && o.pose === 'stand') o.pose = 'hold';
  // 顔のパーツ: 真ん中寄りの範囲で、少しずつ変える
  for (const [k, [, min, max]] of Object.entries(POLY_FACE)) { const d = faceDefault(k), span = (max - min) * 0.5; o.parts[k] = Math.round(Math.min(max, Math.max(min, d + (r() - 0.5) * span)) * 1000) / 1000; }
  return o;
}

// ランダムのときに「固定」できるまとまり。keys = 値の名前、colors = 色の名前、parts = 顔のパーツの調整
export const POLY_LOCKS = {
  face: { label: '顔', keys: ['face', 'eye', 'iris', 'asym', 'asymSeed', 'age'], parts: true },
  expr: { label: '表情', keys: ['expr'] },
  hair: { label: '髪型', keys: ['hair'] },
  beard: { label: 'ひげ', keys: ['beard'] },
  hat: { label: '帽子', keys: ['hat'], colors: ['hat'] },
  clothes: { label: '服', keys: ['top', 'bottom', 'shoes'] },
  pose: { label: 'ポーズ・持ち物', keys: ['pose', 'item'], colors: ['accent'] },
  body: { label: '体つき', keys: ['heads', 'build'] },
  skinColor: { label: '肌・髪・瞳の色', colors: ['skin', 'hair', 'eyes'] },
  clothColor: { label: '服の色', colors: ['top', 'top2', 'bottom', 'shoes'] },
};
// ランダムなキャラのうち、固定したまとまり(locks = POLY_LOCKS の名前の列)だけ、今の値 cur のままにする
export function randomPolyKeep(cur, locks = [], seed) {
  const o = randomPoly(seed);
  const pose = locks.includes('pose');
  for (const name of locks) {
    const L = POLY_LOCKS[name];
    if (!L) continue;
    for (const k of L.keys || []) o[k] = cur[k];
    for (const k of L.colors || []) o.colors[k] = cur.colors[k];
    if (L.parts) o.parts = { ...cur.parts };
  }
  if (!pose && o.item !== 'none' && o.pose === 'stand') o.pose = 'hold';
  return o;
}

// ---- ベクトル・色 ----
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp = (a, b, t) => a + (b - a) * t;
const mixC = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const rgb = (hex) => { const c = parseHex(hex); return [c.r, c.g, c.b]; };
const toHex = (c) => '#' + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
const WARM = [255, 240, 214], COOL = [70, 86, 122], DEEP = [38, 44, 72];
// 素材の色 → 明るさ a(0〜1)ごとの色。shade = 陰影の強さ(0.7 がふつう)
function ramp(hex, shade) {
  const b = rgb(hex), f = shade / 0.7;
  const dk = (m) => m.map((v) => Math.max(40, 255 - (255 - v) * f));
  const mul = (a, m) => [(a[0] * m[0]) / 255, (a[1] * m[1]) / 255, (a[2] * m[2]) / 255];
  const stops = [mixC(mul(b, dk([135, 135, 160])), DEEP, Math.min(0.8, 0.5 * f)), mixC(mul(b, dk([200, 200, 212])), COOL, Math.min(0.6, 0.3 * f)), b, mixC(b, WARM, Math.min(0.6, 0.34 * f))];
  return (a) => { const t = Math.min(0.9999, Math.max(0, a)) * 3, i = Math.floor(t); return mixC(stops[i], stops[i + 1], t - i); };
}

// ---- 面を細かくする: 三角を4つに分け、分けた点を丸みに沿って少し動かす(頂点の法線に沿った面への投影 = フォン・テセレーション)----
//   分けるだけだと同じ向きの面が並ぶだけなので、動かして向きを少しずつ変える。同じ辺は同じ点になる(すき間ができない)
function subdivide(tris, levels, alpha = 0.55) {
  for (let lv = 0; lv < levels; lv++) {
    const key = (v) => `${Math.round(v[0] * 1e4)},${Math.round(v[1] * 1e4)},${Math.round(v[2] * 1e4)}`;
    const nmap = new Map();
    for (const t of tris) {
      let n = cross(sub(t.p[1], t.p[0]), sub(t.p[2], t.p[0]));
      if (n[2] < 0) n = n.map((v) => -v);
      for (const v of t.p) { const k = key(v), a = nmap.get(k) || [0, 0, 0]; nmap.set(k, [a[0] + n[0], a[1] + n[1], a[2] + n[2]]); }
    }
    const nrm = (v) => { const n = nmap.get(key(v)), l = Math.hypot(...n) || 1; return n.map((c) => c / l); };
    const mid = (a, b) => {
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      const pr = (p) => { const n = nrm(p), d = (m[0] - p[0]) * n[0] + (m[1] - p[1]) * n[1] + (m[2] - p[2]) * n[2]; return [m[0] - n[0] * d, m[1] - n[1] * d, m[2] - n[2] * d]; };
      const pa = pr(a), pb = pr(b);
      return [m[0] + ((pa[0] + pb[0]) / 2 - m[0]) * alpha, m[1] + ((pa[1] + pb[1]) / 2 - m[1]) * alpha, m[2] + ((pa[2] + pb[2]) / 2 - m[2]) * alpha];
    };
    const out = [];
    for (const t of tris) {
      const [a, b, c] = t.p, ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      for (const p of [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]]) out.push({ ...t, p });
    }
    tris = out;
  }
  return tris;
}

// ---- 面を集める ----
function makeMesh() {
  const tris = []; // { p: [v, v, v](3D), mat, bias(手前に出す量), flat(明るさを決め打ち), both(裏も描く) }
  // tag(札): これから作る面に付ける値(bone = 動かすボーン、prev・next = 筒の両端でつながるボーン)。立体のモデルにボーンを入れるときに使う
  let cur = {};
  const tag = (t = {}) => { cur = t; };
  const tri = (a, b, c, mat, extra = {}) => tris.push({ p: [a, b, c], mat, ...cur, ...extra });
  const quad = (a, b, c, d, mat, extra) => { tri(a, b, c, mat, extra); tri(a, c, d, mat, extra); };
  // 平らな多角形(扇形に分ける)
  const fan = (pts, mat, extra) => { for (let i = 1; i < pts.length - 1; i++) tri(pts[0], pts[i], pts[i + 1], mat, extra); };
  // 太さの変わる筒(n 角柱)。a → b
  const tube = (a, b, ra, rb, n, mat, extra, capB = false, capA = false) => {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], dl = Math.hypot(...d) || 1, ax = d.map((v) => v / dl);
    let u = [ax[1] * 1 - ax[2] * 0, ax[2] * 0 - ax[0] * 1, 0]; // 軸 × z
    let ul = Math.hypot(...u);
    if (ul < 1e-4) { u = [1, 0, 0]; ul = 1; }
    u = u.map((v) => v / ul);
    const w = [ax[1] * u[2] - ax[2] * u[1], ax[2] * u[0] - ax[0] * u[2], ax[0] * u[1] - ax[1] * u[0]];
    const ring = (c, r) => Array.from({ length: n }, (_, i) => { const t = (i / n) * Math.PI * 2 + Math.PI / n; const cu = Math.cos(t) * r, cw = Math.sin(t) * r * (extra?.wz ?? 0.85); return [c[0] + u[0] * cu + w[0] * cw, c[1] + u[1] * cu + w[1] * cw, c[2] + u[2] * cu + w[2] * cw]; });
    const A = ring(a, ra), B = ring(b, rb);
    const ex = { ...extra, ax: [a, b] }; // ax = 筒の軸(立体にするとき、面の外向きを決めるのに使う)
    for (let i = 0; i < n; i++) quad(A[i], A[(i + 1) % n], B[(i + 1) % n], B[i], mat, ex);
    if (capB) fan(B, mat, ex);
    if (capA) fan(A, mat, ex);
  };
  return { tris, tri, quad, fan, tube, tag };
}

// ---- 顔の点(右半分。x >= 0。y は下向き、z は手前)----
function facePoints(o) {
  const X = {
    neutral: {}, smile: { mcY: -0.022, mcX: 0.022, cheek: 0.012, lid: 0.85, browOut: -0.004 }, grin: { mcY: -0.028, mcX: 0.035, cheek: 0.016, lid: 0.75, open: 0.035, teeth: true },
    angry: { browIn: 0.03, browOut: -0.012, lid: 0.8, mcY: 0.018, nose: 0.01 }, sad: { browIn: -0.028, browOut: 0.016, lid: 0.85, mcY: 0.022 },
    surprised: { browIn: -0.03, browOut: -0.028, lid: 1.5, open: 0.07, mcX: -0.03 }, tired: { browIn: 0.004, lid: 0.5, mcY: 0.006, bags: true },
    smirk: { mcY: -0.02, mcX: 0.02, lid: 0.8, browIn: 0.01, oneSide: true }, fear: { browIn: -0.034, browOut: 0.0, lid: 1.35, open: 0.03, mcY: 0.012, mcX: 0.01 },
  }[o.expr] || {};
  const F = { oval: { w: 1, jaw: 1, chin: 1, ck: 1 }, round: { w: 1.08, jaw: 1.14, chin: 1.25, ck: 1.06 }, square: { w: 1.05, jaw: 1.2, chin: 1.45, ck: 1.02 }, long: { w: 0.92, jaw: 0.95, chin: 0.9, ck: 0.96 }, gaunt: { w: 0.97, jaw: 0.96, chin: 0.95, ck: 1.08, hollow: 0.05 } }[o.face] || { w: 1, jaw: 1, chin: 1, ck: 1 };
  const age = o.age, A = o.parts;
  // 目の中心と大きさ(くぼみの点も、目に合わせて動かす)
  const ES = A.eyeSize, ecx = Math.max(0.135, 0.19 * A.eyeGap), ecy = 0.44 + A.eyeY, by = A.browY + A.eyeY * 0.6;
  const P = {
    T: [0, 0, 0.1], T1: [0.2, 0.03, 0.05], T2: [0.34, 0.12, 0], S1: [0.41, 0.28, 0], S2: [0.41, 0.46, 0.02], S3: [0.385, 0.64, 0.02],
    JW: [0.31 * F.jaw * A.jawW, 0.84, 0.1], CS: [0.13 * F.chin, 0.985, 0.34], CB: [0, 1, 0.4],
    F0: [0, 0.1, 0.36], F1: [0.22, 0.12, 0.28], F2: [0, 0.27, 0.46], F3: [0.24, 0.27, 0.38], F4: [0.36, 0.3, 0.2],
    BC: [0, 0.37 + by + (X.browIn || 0) * 0.6, 0.5], B1: [0.17, 0.355 + by + (X.browIn || 0) * 0.4 + (X.browOut || 0) * 0.5, 0.495], B2: [0.32, 0.385 + by + (X.browOut || 0), 0.38],
    EI: [Math.max(0.05, ecx - 0.118 * ES), ecy - 0.004, 0.42], EO: [Math.min(0.37, ecx + 0.115 * ES), ecy, 0.36], EU: [ecx, ecy - 0.034 * ES, 0.44], EL: [ecx, ecy + 0.034 * ES, 0.43],
    NB: [0, 0.43, 0.49], NS: [0.045 * Math.sqrt(A.noseW), 0.475, 0.455], NT: [0, 0.615, 0.5 + (0.1 + age * 0.015) * A.noseH], NW: [(0.085 + (X.nose || 0)) * A.noseW, 0.635, 0.5], NU: [0, 0.655, 0.53],
    CK: [0.3 * F.ck * A.cheek, 0.56 - (X.cheek || 0), 0.33 + (X.cheek || 0) + (A.cheek - 1) * 0.12], CF: [0.16, 0.56 - (X.cheek || 0), 0.44 + (X.cheek || 0) * 0.6],
    CL: [0.25 * F.jaw * A.jawW, 0.72, 0.3 - (F.hollow || 0) - age * 0.02],
    UL: [0, 0.755 - 0.03 * A.lip, 0.545], MC: [(0.125 + (X.mcX || 0)) * A.mouthW, 0.765 + (X.mcY || 0), 0.47], MU: [0, 0.755, 0.55], ML: [0, 0.755 + 0.045 * A.lip + (X.open || 0), 0.54], LL: [0.07 * Math.sqrt(A.mouthW), 0.753 + 0.045 * A.lip + (X.open || 0) * 0.8, 0.5],
    CT: [0, 0.87 + (X.open || 0) * 0.5, 0.5], CH: [0, 0.94 + (X.open || 0) * 0.3, 0.52], CQ: [0.12 * F.chin, 0.9 + (X.open || 0) * 0.3, 0.44],
  };
  // 彫りの深さ(relief。0 = 前の平たい顔、1 = ふつう、2 = とても深い): 出る所(眉の出っ張り・鼻・ほお骨・あご)を前へ、くぼむ所(目のまわり・ほおのこけ・唇の下・こめかみ)を奥へ
  const RELIEF = { BC: 0.03, B1: 0.045, B2: 0.03, EI: -0.05, EO: -0.035, EU: -0.03, EL: -0.035, NB: -0.012, NS: 0.01, NT: 0.03, NW: 0.012, NU: -0.01,
    CK: 0.055, CF: 0.012, CL: -0.06, F4: -0.03, S2: -0.01, UL: 0.012, MU: 0.02, ML: 0.012, LL: 0.006, CT: -0.03, CH: 0.045, CQ: 0.015, JW: 0.03, F2: 0.012, F3: 0.006 };
  for (const [k, d] of Object.entries(RELIEF)) P[k][2] += d * o.relief;
  // 鼻の長さ(鼻の付け根から下を伸ばす)、口の高さ、あごの長さ(口より下を伸ばす)、顔の幅
  for (const k of ['NS', 'NT', 'NW', 'NU']) P[k][1] = 0.43 + (P[k][1] - 0.43) * A.noseLen;
  for (const k of ['UL', 'MC', 'MU', 'ML', 'LL']) P[k][1] += A.mouthY;
  for (const k of ['CT', 'CH', 'CQ', 'CS', 'CB', 'JW']) P[k][1] = 0.8 + (P[k][1] - 0.8) * A.chinLen + (k === 'JW' ? 0 : A.mouthY * 0.5);
  for (const k of Object.keys(P)) P[k][0] *= F.w * A.headW;
  // 左右非対称: 種から決めた小さなずれ。真ん中の点(鼻先・あご)は横へ、左半分の点は、目・眉・ほお・口角・えらのまとまりごとに
  const center = new Set(Object.keys(P).filter((k) => P[k][0] === 0));
  const rr = rng(o.asymSeed * 7919 + 13), jit = (amp) => (rr() - 0.5) * 2 * amp * o.asym;
  P.NT[0] = jit(0.012); P.NU[0] = P.NT[0] * 0.5; P.CH[0] = jit(0.012); P.CB[0] = P.CH[0] * 0.8; P.CT[0] = P.CH[0] * 0.5;
  const grp = { eye: [jit(0.006), jit(0.012)], brow: [jit(0.006), jit(0.014)], cheek: [jit(0.012), jit(0.01)], mouth: [jit(0.01), jit(0.014)], jaw: [jit(0.016), jit(0.012)], nose: [jit(0.008), 0] };
  const gOf = { EI: 'eye', EO: 'eye', EU: 'eye', EL: 'eye', B1: 'brow', B2: 'brow', CK: 'cheek', CF: 'cheek', MC: 'mouth', LL: 'mouth', JW: 'jaw', CL: 'jaw', CQ: 'jaw', CS: 'jaw', NW: 'nose', NS: 'nose' };
  // 左半分の点
  const L = (k) => { if (center.has(k)) return P[k]; const d = grp[gOf[k]] || [0, 0]; return [-P[k][0] + d[0], P[k][1] + d[1], P[k][2]]; };
  const eyeSizeL = 1 + jit(0.07);
  return { P, L, X, F, asym: { grp, eyeSizeL }, eye: { cx: ecx * F.w * A.headW, cy: ecy, s: ES } };
}
// 右半分の面(名前の3つ組)
const FACE_TRIS = [
  'T T1 F0', 'T1 F1 F0', 'T1 T2 F1', 'T2 S1 F4', 'T2 F4 F1', 'F1 F4 F3', 'F0 F1 F3', 'F0 F3 F2', 'S1 S2 F4',
  'F2 F3 B1', 'F2 B1 BC', 'F3 B2 B1', 'F3 F4 B2', 'F4 S2 B2',
  'BC EI NB', 'BC B1 EI', 'B1 EU EI', 'B1 B2 EU', 'B2 EO EU', 'EI EU EL', 'EU EO EL',
  'EI EL CF', 'EL EO CK', 'EL CK CF', 'EI CF NS', 'NB EI NS', 'B2 S2 EO', 'EO S2 CK', 'S2 S3 CK',
  'NB NT NS', 'NS NT NW', 'NS NW CF', 'NT NU NW',
  'CF NW MC', 'CF MC CL', 'CF CL CK', 'CK CL S3', 'S3 CL JW',
  'NU NW UL', 'NW MC UL', 'UL MC MU', 'MU MC LL', 'MU LL ML',
  'MC CL CQ', 'MC CQ LL', 'LL CQ CT', 'LL CT ML', 'CT CQ CH', 'CQ CS CH', 'CH CS CB', 'CL JW CQ', 'CQ JW CS',
].map((s) => s.split(' '));

// 立体の面を作る(光を当てる前)。o = polyOptions の値。tris = { p: [3D の点 × 3], mat, bias, flat, dim, both, out, part(head / hair / body), ax(筒の軸) }
export function modelTris(o) {
  const C = o.colors;
  const M = makeMesh();
  const { P, L, X, eye: EYE, asym: AS } = facePoints(o), A = o.parts;
  const mir = (v) => [-v[0], v[1], v[2]];
  const f = 0.06; // 顔の上にのせる面(目・眉・口など)を手前に出す1段ぶん(描く順を確実にする。位置は変えない)
  // ---- 顔 ----
  const lower = new Set(['CL', 'JW', 'CQ', 'CS', 'CH', 'CB', 'CT', 'MC', 'LL', 'ML', 'UL', 'NU', 'NW']);
  const faceTris = [];
  for (const [a, b, c] of FACE_TRIS) {
    // ひげ: 口のまわり〜あごの面を、ひげの色(無精ひげは肌を少し暗く)
    let mat = C.skin, extra = {};
    const low = [a, b, c].filter((k) => lower.has(k)).length;
    if (o.beard === 'full' && low === 3 && !(a === 'NU' || a === 'NW') && !['UL MC MU', 'MU MC LL', 'MU LL ML'].includes([a, b, c].join(' '))) mat = C.hair;
    if (o.beard === 'stubble' && low === 3) extra = { dim: 0.16 };
    faceTris.push({ p: [P[a], P[b], P[c]], mat, ...extra }, { p: [L(a), L(c), L(b)], mat, ...extra });
  }
  // 面の細かさ(detail 1 = そのまま、2 = 4倍、3 = 16倍)
  for (const t of subdivide(faceTris, o.detail - 1)) M.tris.push(t);
  // 耳
  const hx = P.S2[0], es = A.earSize;
  for (const s of [1, -1]) {
    M.fan([[(hx - 0.005) * s, 0.5 - 0.07 * es, 0.03], [(hx + 0.065 * es) * s, 0.5 - 0.055 * es, 0.0], [(hx + 0.06 * es) * s, 0.5 + 0.06 * es, 0.0], [(hx - 0.01) * s, 0.5 + 0.13 * es, 0.03]], C.skin, { bias: -0.02, both: true });
    M.fan([[(hx + 0.008) * s, 0.5 - 0.035 * es, 0.03], [(hx + 0.04 * es) * s, 0.5 - 0.025 * es, 0.01], [(hx + 0.035 * es) * s, 0.5 + 0.04 * es, 0.01], [(hx + 0.005) * s, 0.5 + 0.07 * es, 0.03]], C.skin, { flat: 0.3, bias: -0.015, both: true }); // 耳の中の影
  }
  // 耳を横から見た面(横向き・ななめのときに見える。out = 外向きの向き。向こう側の耳は描かない)
  for (const s of ['bob', 'long', 'afro'].includes(o.hair) ? [] : [1, -1]) {
    const ex = (hx + 0.05 * es) * s;
    M.fan([[ex, 0.5 - 0.075 * es, 0.05], [ex, 0.5 - 0.065 * es, -0.075 * es], [ex, 0.5 + 0.05 * es, -0.065 * es], [ex * 0.97, 0.5 + 0.135 * es, 0.02]], C.skin, { bias: 0.05, both: true, out: [s, 0, 0] });
    M.fan([[ex * 1.005, 0.5 - 0.04 * es, 0.03], [ex * 1.005, 0.5 - 0.035 * es, -0.04 * es], [ex * 1.005, 0.5 + 0.035 * es, -0.035 * es], [ex * 1.0, 0.5 + 0.08 * es, 0.015]], C.skin, { flat: 0.28, bias: 0.07, both: true, out: [s, 0, 0] });
  }
  // ---- 目 ----
  const lid = X.lid ?? 1, F0w = P.S2[0] / 0.41; // F0w: 顔の幅の倍率(眉・髪を合わせる)
  // 目の形: w・h = 幅・高さの倍率、u1・u2 = 上まぶたの2点の高さ(内側・外側)、inY・outY = 目頭・目じりの上げ下げ
  const EYES = { almond: { w: 1, h: 1, u1: 1, u2: 0.9, inY: 0, outY: 0 }, round: { w: 0.86, h: 1.45, u1: 1, u2: 1, inY: 0, outY: 0 }, narrow: { w: 1.16, h: 0.6, u1: 0.9, u2: 1, inY: 0.004, outY: -0.01 },
    sharp: { w: 1.08, h: 0.95, u1: 0.45, u2: 1.15, inY: 0.012, outY: -0.014 }, half: { w: 1.02, h: 0.95, u1: 0.25, u2: 0.25, inY: 0, outY: 0, heavy: true }, dot: { w: 1, h: 1, u1: 1, u2: 0.9, inY: 0, outY: 0, dot: true } }[o.eye];
  // 瞳の形: [角の数, 横の倍率, 縦の倍率, 回す角度(度)]。星は、出っ張りとへこみを交互に
  const IRIS = { hex: [6, 1, 1, 0], round: [14, 1, 1, 0], diamond: [4, 0.95, 1.25, 0], square: [4, 1.1, 1.1, 45], slit: [6, 0.42, 1.35, 90], star: [10, 1.15, 1.15, -90] }[o.iris];
  [1, -1].forEach((s) => {
    const k = X.oneSide && s < 0 ? 0.8 : 1; // にやり: 片目を細める
    const left = s < 0, ad = left ? AS.grp.eye : [0, 0], sz = EYE.s * (left ? AS.eyeSizeL : 1);
    const cx = EYE.cx * s + ad[0], cy = EYE.cy + ad[1], hw = 0.1 * sz * EYES.w, hh = 0.04 * sz * EYES.h * lid * k, z = P.EU[2] + 0.004, tl = A.eyeTilt * 0.02; // tl: 目じりを上げ下げ
    const eye = [[cx - hw * s, cy + 0.004 + tl + EYES.inY, z - 0.01], [cx - hw * 0.35 * s, cy - hh * EYES.u1 + tl * 0.4, z], [cx + hw * 0.5 * s, cy - hh * EYES.u2 - tl * 0.5, z - 0.005], [cx + hw * 1.05 * s, cy + 0.002 - tl + EYES.outY, z - 0.03], [cx + hw * 0.45 * s, cy + hh * 0.8 - tl * 0.4, z - 0.012], [cx - hw * 0.4 * s, cy + hh * 0.85 + tl * 0.3, z - 0.004]];
    eye[0][2] = P.EI[2] + 0.006; eye[3][2] = P.EO[2] + 0.006; // 目頭・目じりは、くぼみの奥行きに合わせる
    const ir = Math.min(0.05 * sz, hh * 1.2 + 0.012) * A.iris, ix = cx + 0.008;
    const tz = (px) => z - (px - cx) * s * 0.32; // 外側ほど奥へ(横から見たときに瞳が見えるように)
    const top = Math.min(eye[1][1], eye[2][1]), bot = cy + hh * 0.85;
    // 瞳の多角形(目の開きからはみ出さないように、上下を切りそろえる)
    const irisPoly = (r) => Array.from({ length: IRIS[0] }, (_, i) => {
      const a = (i / IRIS[0]) * Math.PI * 2 + (IRIS[3] * Math.PI) / 180, rr2 = o.iris === 'star' && i % 2 ? r * 0.5 : r;
      const yy = cy + Math.sin(a) * rr2 * IRIS[2];
      const px = ix + Math.cos(a) * rr2 * IRIS[1];
      return [px, EYES.dot ? yy : Math.max(top, Math.min(bot, yy)), tz(px)];
    });
    if (EYES.dot) {
      // 点の目: 白目なし。黒い瞳と小さな光だけ
      M.fan(irisPoly(Math.max(0.022, ir * 0.75)), '#1b1a20', { flat: 0.35, bias: f * 2, both: true });
    } else {
      M.fan(eye, '#e9e3d8', { flat: s > 0 ? 0.55 : 0.72, bias: f, both: true });
      M.fan(irisPoly(ir), C.eyes, { flat: 0.6, bias: f * 2, both: true });
      M.fan(Array.from({ length: 6 }, (_, i) => [ix + Math.cos((i / 6) * Math.PI * 2) * ir * (o.iris === 'slit' ? 0.2 : 0.5), Math.max(top, Math.min(bot, cy + Math.sin((i / 6) * Math.PI * 2) * ir * (o.iris === 'slit' ? 1.1 : 0.5))), tz(ix + Math.cos((i / 6) * Math.PI * 2) * ir * (o.iris === 'slit' ? 0.2 : 0.5))]), '#17161c', { flat: 0.3, bias: f * 3, both: true });
    }
    M.fan([[ix - ir * 0.55, cy - ir * 0.5, z], [ix - ir * 0.15, cy - ir * 0.62, z], [ix - ir * 0.3, cy - ir * 0.15, z]], '#f6f2ea', { flat: 1, bias: f * 4, both: true });
    // 上まぶたの影(まつ毛の線)
    if (!EYES.dot) { // 目のふちの上側に沿った、細い帯(目の上にはかぶせない)。半目は太く
      const lt = EYES.heavy ? 0.03 : 0.014, u1 = [eye[1][0], eye[1][1] - lt, z], u2 = [eye[2][0], eye[2][1] - lt, z], lidO = { flat: 0.08, bias: f * 5, both: true };
      M.tri(eye[0], eye[1], u1, C.skin, lidO); M.quad(eye[1], eye[2], u2, u1, C.skin, lidO); M.tri(eye[2], eye[3], u2, C.skin, lidO);
    }
    if (X.bags || o.age > 0.6) M.fan([[cx - hw * 0.8 * s, cy + hh + 0.012, z - 0.02], [cx + hw * 0.7 * s, cy + hh + 0.01, z - 0.03], [cx + hw * 0.3 * s, cy + hh + 0.034, z - 0.02], [cx - hw * 0.4 * s, cy + hh + 0.036, z - 0.015]], C.skin, { flat: 0.3, bias: f, both: true }); // 目の下のたるみ
    // 眉(髪の色。内側が太い、角ばった形)
    const bdy = left ? AS.grp.brow[1] : 0;
    const bi = P.BC[1] - 0.012 + (X.browIn || 0) * 0.5 + bdy * 0.5, bo = P.B2[1] - 0.012 + bdy, bt = A.browThick, bw = F0w;
    const kk = X.oneSide && s > 0 ? -0.02 : 0; // にやり: 片眉を上げる
    M.fan([[0.06 * bw * s, bi + 0.002 + 0.01 * bt + kk * 0.3, 0.51], [0.1 * bw * s, bi - 0.003 - 0.015 * bt + kk, 0.515], [0.24 * bw * s, lerp(bi, bo, 0.75) - 0.012 - 0.014 * bt + kk, 0.47], [0.335 * bw * s, bo + 0.004 + kk * 0.5, 0.4], [0.23 * bw * s, lerp(bi, bo, 0.75) - 0.01 + 0.012 * bt + kk, 0.47]], C.hair, { bias: f * 3, both: true, dim: -0.05 });
  });
  // ---- 鼻の穴の影・ほうれい線 ----
  for (const s of [1, -1]) M.fan([[0.02 * s, 0.642, 0.56], [0.07 * s, 0.632, 0.52], [0.06 * s, 0.655, 0.515]], C.skin, { flat: 0.05, bias: f * 2, both: true });
  if (o.age > 0.45 || o.expr === 'smile' || o.expr === 'grin') for (const s of [1, -1]) M.fan([[0.1 * s, 0.655, 0.5], [0.108 * s, 0.657, 0.495], [(P.MC[0] + 0.034) * s, P.MC[1] - 0.03, 0.47], [(P.MC[0] + 0.026) * s, P.MC[1] - 0.026, 0.47]], C.skin, { flat: 0.3, bias: f * 2, both: true }); // ほうれい線(細く)
  // ---- 口 ----
  const mcx = P.MC[0], mcy = P.MC[1], open = X.open || 0;
  if (open > 0) {
    const mouth = [[-mcx * 0.92, mcy + AS.grp.mouth[1], 0.48], [-mcx * 0.4, P.MU[1] - 0.004, 0.545], [mcx * 0.4, P.MU[1] - 0.004, 0.545], [mcx * 0.92, mcy, 0.48], [mcx * 0.45, P.ML[1] - 0.012, 0.52], [-mcx * 0.45, P.ML[1] - 0.012, 0.52]];
    M.fan(mouth, '#3c1f22', { flat: 0.45, bias: f * 2, both: true });
    if (X.teeth) M.fan([[-mcx * 0.8, mcy + 0.002, 0.49], [-mcx * 0.4, P.MU[1], 0.546], [mcx * 0.4, P.MU[1], 0.546], [mcx * 0.8, mcy + 0.002, 0.49], [mcx * 0.42, P.MU[1] + 0.022, 0.535], [-mcx * 0.42, P.MU[1] + 0.022, 0.535]], '#ede7da', { flat: 0.8, bias: f * 3, both: true });
  } else {
    const k = X.oneSide ? 0.012 : 0; // にやり: 片方の口角だけ上げる
    M.fan([[-mcx, mcy + k * 1.6 + AS.grp.mouth[1], 0.47], [-mcx * 0.4, P.MU[1] - 0.006, 0.55], [0, P.MU[1] - 0.002, 0.555], [mcx * 0.4, P.MU[1] - 0.006, 0.55], [mcx, mcy - k, 0.47], [mcx * 0.4, P.MU[1] + 0.008, 0.55], [0, P.MU[1] + 0.01, 0.553], [-mcx * 0.4, P.MU[1] + 0.008, 0.55]], C.skin, { flat: 0.05, bias: f * 2, both: true });
  }
  if (o.beard === 'mustache') for (const s of [1, -1]) M.fan([[0, 0.675, 0.56], [0.09 * s, 0.685, 0.52], [(mcx + 0.03) * s, mcy + 0.012, 0.47], [0.07 * s, 0.745, 0.53], [0, 0.735, 0.555]], C.hair, { bias: f * 4, both: true });
  // ---- 髪・帽子 ----
  // 頭をおおう面: 頭のてっぺんから、ふちの点へ。ふちは (x, y, z) の列(右 → 正面 → 左)
  const dome = (rim, mid, mat, top = [0, -0.06, 0.12], extra = {}) => {
    const n = rim.length;
    const md = rim.map((r) => [lerp(top[0], r[0], 0.78), lerp(top[1], r[1], mid * 0.5), lerp(top[2], r[2], 0.8) + 0.06]); // 途中の輪は外寄り・上寄りに(丸い頭に)
    for (let i = 0; i < n - 1; i++) { M.tri(top, md[i + 1], md[i], mat, { both: true, ...extra }); M.quad(md[i], md[i + 1], rim[i + 1], rim[i], mat, { both: true, ...extra }); }
  };
  // 髪: 頭より一回り大きい、角ばった「かたまり」。てっぺん → 上の輪 → 中の輪 → 生え際 を面でつなぐ。
  //   角度 a(真正面 = 0、右 = +、左 = −)ごとに点を置く。坊ちゃん刈りにならないように:
  //   ・生え際は額を見せる(M 字。こめかみを上げる)。横は頭に沿わせて細く、耳の上で終わる(刈り上げ風)
  //   ・上は、向き(立ち上げる・流す・後ろへ)をつけて持ち上げる。額にかかる束は、別の三角を左右非対称に足す
  const hairFrom = M.tris.length;
  const hatOn = o.hat !== 'none';
  const hw = F0w, DEG = [-180, -156, -132, -110, -88, -64, -46, -30, -14, 0, 14, 30, 46, 64, 88, 110, 132, 156, 180], ANG = DEG.map((d) => (d * Math.PI) / 180);
  // ふち・輪の点。横(|角度| > 55°)は半径を小さく(頭に沿わせる)
  const slim = (d) => (Math.abs(d) > 55 ? 0.94 : 1);
  // 前半分は顔に合わせた中心(z = 0.14)。後ろ半分は、後頭部と同じ中心(z = 0.02)のだ円で、頭より一回り外を回る
  //   (前の式は中心が前にずれていて、ななめ後ろで髪が頭の内側に入り、地肌が髪を突き抜けて見えた)
  const ringPt = (d, y, rx, rz, fwd = 0, sl = slim(d)) => { const a = (d * Math.PI) / 180, c = Math.cos(a); return [Math.sin(a) * rx * hw * sl, y, c >= 0 ? c * rz + 0.02 + fwd * c : c * (rz * 1.42 - 0.1) + 0.02]; };
  // 頭の形(高さ h ごとの、頭の中心からの半径。横・前・後ろ)。髪・帽子は、これに厚み t を足した所に置く(= 頭に沿う。浮かない)
  //   前は、髪のかたまりが頭の中心より前にずれた箱形で、横から見ると 額の前に張り出し、えり足で頭から離れて浮いていた(ユーザー指摘)
  const SK_X = [[0, 0.08], [0.03, 0.2], [0.12, 0.34], [0.28, 0.41], [0.46, 0.41], [0.64, 0.385], [0.82, 0.3], [0.96, 0.2]];
  const SK_B = [[0, 0.08], [0.03, 0.2], [0.12, 0.37], [0.28, 0.44], [0.46, 0.45], [0.64, 0.41], [0.82, 0.27], [0.96, 0.16]];
  const SK_F = [[0, 0.08], [0.1, 0.34], [0.27, 0.47], [0.4, 0.5], [0.96, 0.5]];
  const tab = (T, y) => { if (y <= T[0][0]) return T[0][1]; for (let i = 1; i < T.length; i++) if (y <= T[i][0]) return lerp(T[i - 1][1], T[i][1], (y - T[i - 1][0]) / (T[i][0] - T[i - 1][0])); return T[T.length - 1][1]; };
  // fit(角度, 頭の高さ h, 厚み t, 前へ出す量, 置く高さ): 頭の表面から t だけ外の点
  const fit = (d, h, t, fwd = 0, y = h) => { const a = (d * Math.PI) / 180, c = Math.cos(a); return [Math.sin(a) * (tab(SK_X, h) + t) * hw, y, (c >= 0 ? c * (tab(SK_F, h) + t) + fwd * c : c * (tab(SK_B, h) + t)) + 0.02]; };
  const ringAt = (i, y, rx, rz, fwd = 0) => ringPt(DEG[i], y, rx, rz, fwd);
  let scalpLine = null; // 髪の生え際の高さ(角度ごと)。これより上の後頭部は、髪の色にする
  // line(d) = 生え際の高さ、lift(d) = 上の持ち上げ(マイナスで上へ)、fwd(d) = 前へ出す量、jag = ギザギザ
  // vol = 上のふくらみ、thick = 髪の厚みの倍率(坊主は薄く)、nape = えり足の高さ
  // 輪は4つ: 頭のてっぺんの近く(r1)→ 上(r2)→ 生え際との間(r3)→ 生え際(rim)。どれも頭の表面 + 厚み
  const hairCap = (p0) => {
    // 帽子をかぶっているときは、上を低く・薄くして帽子の中に収める(横・前髪・下がる髪は帽子の下から見える)
    const { line: lineF, lift = () => 0, fwd = () => 0, jag = 0.008, vol = 1, thick = 1, nape = 0.74 } = hatOn ? { ...p0, lift: () => 0.02, fwd: () => 0, vol: 0.6, thick: Math.min(0.8, p0.thick ?? 1) } : p0;
    // 生え際: 横(100°)より後ろは、えり足(nape)の高さへ下げていく
    const line = (d) => { const a = Math.abs(d); return a <= 100 ? lineF(d) : lerp(lineF(d < 0 ? -100 : 100), nape, Math.min(1, (a - 100) / 45)); };
    scalpLine = line;
    const top = [0, -0.075 * vol + lift(0) * 0.6, 0.06 + fwd(0) * 0.5];
    const r1 = [], r2 = [], r3 = [], rim = [];
    DEG.forEach((d, i) => {
      const L = line(d), h2 = Math.min(0.12, L - 0.05), h3 = lerp(h2, L, 0.55);
      r1.push(fit(d, 0.03, 0.06 * vol * thick, fwd(d), 0.03 - 0.075 * vol + lift(d)));
      r2.push(fit(d, h2, 0.06 * Math.max(1, vol) * thick, fwd(d) * 0.8, h2 - 0.045 * vol + lift(d) * 0.7));
      r3.push(fit(d, h3, 0.045 * thick, fwd(d) * 0.4, h3 - 0.01));
      rim.push(fit(d, L, 0.03 * thick, 0, L + (i % 2 ? jag : -jag)));
    });
    const HO = { both: true, bias: 0.045 };
    for (let i = 0; i < DEG.length - 1; i++) {
      M.tri(top, r1[i + 1], r1[i], C.hair, HO);
      M.tri(r1[i], r1[i + 1], r2[i], C.hair, HO);
      M.tri(r1[i + 1], r2[i + 1], r2[i], C.hair, { ...HO, dim: i % 2 ? 0.05 : 0 });
      M.tri(r2[i], r2[i + 1], r3[i], C.hair, HO);
      M.tri(r2[i + 1], r3[i + 1], r3[i], C.hair, { ...HO, dim: i % 2 ? 0.04 : 0 });
      M.tri(r3[i], r3[i + 1], rim[i], C.hair, HO);
      M.tri(r3[i + 1], rim[i + 1], rim[i], C.hair, { ...HO, dim: i % 2 ? 0.08 : 0.02 });
    }
    return { rim, r1, r2, top };
  };
  // 額にかかる束: ふちの a0〜a1 度の間から、(度, 高さ) の先へ下がる三角
  const lock = (d0, d1, tipD, tipY, y0, dim = 0) => M.tri(fit(d0, y0, 0.04), fit(d1, y0, 0.04), fit(tipD, tipY, 0.05), C.hair, { both: true, bias: 0.049, dim });
  // 生え際: 真ん中 c、こめかみ(±32°)t、もみあげ(横)s。額を見せる M 字
  const mLine = (c, t, s) => (d) => { const a = Math.abs(d); return a < 32 ? lerp(c, t, a / 32) : a < 62 ? lerp(t, s, (a - 32) / 30) : s; };
  {
    const h = o.hair;
    if (h === 'short') { // 短髪: 横は刈り上げ、上は少し前へ立てる
      hairCap({ line: mLine(0.155, 0.11, 0.36), lift: (d) => (Math.abs(d) < 50 ? -0.035 : 0.02), fwd: (d) => (Math.abs(d) < 50 ? 0.03 : 0), jag: 0.007 });
      lock(-16, 2, -4, 0.2, 0.14, 0.04);
    }
    if (h === 'quiff') { // 立ち上げ: 前を高く持ち上げて後ろへ流す
      hairCap({ line: mLine(0.14, 0.1, 0.36), lift: (d) => (Math.abs(d) < 40 ? -0.13 : Math.abs(d) < 60 ? -0.05 : 0.02), fwd: (d) => (Math.abs(d) < 40 ? 0.07 : 0), jag: 0.004, vol: 1.2 });
    }
    if (h === 'side') { // 横分け: 左で分けて、右へ流す。右のこめかみに長い束
      hairCap({ line: (d) => (d < -28 ? mLine(0.16, 0.12, 0.38)(d) : d < 50 ? lerp(0.1, 0.2, (d + 28) / 78) : mLine(0.16, 0.2, 0.4)(d)), lift: (d) => (d > -30 && d < 70 ? -0.05 : 0.015), fwd: (d) => (d > -10 && d < 60 ? 0.04 : 0), jag: 0.005, vol: 1.08 });
      lock(4, 34, 36, 0.33, 0.15, 0.06); lock(-22, 6, 14, 0.25, 0.12);
    }
    if (h === 'buzz') hairCap({ line: mLine(0.15, 0.1, 0.33), jag: 0.002, vol: 0.45, thick: 0.4 }); // 坊主: 頭の形にぴったり(頭より内側には入れない)
    if (h === 'afro') { // アフロ: 大きな丸いかたまり(てっぺん → 3つの輪 → 生え際)。点を少しずつ出し入れして、もこもこに
      const line = (d) => { const a = Math.abs(d); return a < 40 ? 0.19 : a <= 100 ? lerp(0.24, 0.5, Math.min(1, (a - 40) / 40)) : lerp(0.5, 0.72, Math.min(1, (a - 100) / 45)); };
      if (hatOn) hairCap({ line, jag: 0.02 });
      else {
        scalpLine = line;
        const bump = (i, k) => (((i * 7 + k * 5) % 4) - 1.5) * 0.02;
        const rings = [[-0.47, 0.3], [-0.26, 0.58], [0.04, 0.69]].map(([y, r], k) => DEG.map((d, i) => ringAt(i, y + bump(i, k), r + bump(i + 1, k), (r + bump(i + 1, k)) * 0.82, 0.05)));
        // 下側は内へ巻き込む: 生え際の少し上で外に張り出し、生え際・もみあげは頭にぴったり付ける(浮いて見えないように)
        rings.push(DEG.map((d, i) => ringAt(i, line(d) - 0.07 + bump(i, 3) * 0.5, 0.6, 0.52, 0.02)));
        rings.push(DEG.map((d, i) => fit(d, line(d), 0.03, 0, line(d) + (i % 2 ? 0.015 : -0.005))));
        const top = [0, -0.58, 0.19];
        for (let i = 0; i < DEG.length - 1; i++) {
          M.tri(top, rings[0][i + 1], rings[0][i], C.hair, { both: true, bias: 0.045 });
          for (let k = 0; k < rings.length - 1; k++) {
            M.tri(rings[k][i], rings[k][i + 1], rings[k + 1][i], C.hair, { both: true, bias: 0.045, dim: (i + k) % 2 ? 0.04 : 0 });
            M.tri(rings[k][i + 1], rings[k + 1][i + 1], rings[k + 1][i], C.hair, { both: true, bias: 0.045, dim: (i + k) % 3 ? 0 : 0.07 });
          }
        }
      }
    }
    if (h === 'swept') hairCap({ line: mLine(0.165, 0.085, 0.36), lift: () => -0.01, fwd: (d) => (Math.abs(d) < 40 ? -0.03 : 0), jag: 0.003, vol: 1.1 }); // オールバック: 額を広く見せて、真ん中だけ少し下がる
    if (h === 'messy') { // 無造作: ふぞろいの束
      hairCap({ line: mLine(0.17, 0.14, 0.4), lift: (d) => -0.03 + ((d * 7 + 300) % 5) * 0.008, fwd: (d) => (Math.abs(d) < 50 ? 0.03 : 0), jag: 0.03, vol: 1.1 });
      lock(-30, -8, -22, 0.3, 0.16); lock(-10, 12, 6, 0.27, 0.15, 0.06); lock(14, 38, 30, 0.31, 0.16); lock(40, 58, 54, 0.4, 0.2, 0.08);
    }
    if (h === 'spiky') {
      const c = hairCap({ line: mLine(0.16, 0.11, 0.36), lift: () => -0.03, jag: 0.012 });
      for (let i = 2; !hatOn && i < DEG.length - 3; i++) {
        const a = (ANG[i] + ANG[i + 1]) / 2, tip = [Math.sin(a) * 0.52 * hw, -0.24 - (i % 2) * 0.08, Math.cos(a) * 0.34 + 0.06];
        M.tri(c.r1[i], c.r1[i + 1], tip, C.hair, { both: true, bias: 0.049 });
        M.tri(c.r2[i], c.r1[i], tip, C.hair, { both: true, bias: 0.049, dim: 0.08 });
        M.tri(c.r2[i + 1], c.r1[i + 1], tip, C.hair, { both: true, bias: 0.049, dim: 0.03 });
      }
      lock(-12, 6, -2, 0.22, 0.14);
    }
    if (h === 'bob' || h === 'long') { // センター分け: 真ん中で分けて、顔の両わきへ「のれん」のように下ろす
      //   角度ごとの列(顔のまわりは細かく)× 高さの段で、1枚の続いた面にする。前は、列ごとに下のふちの高さを変えて、顔のまわりをアーチ形に開ける
      //   (前の作り = 平らな板を顔の横に立てた形は、正面から見ると箱に見えた。面を細かくしても板のままなので、形から作り直した)
      const bob = h === 'bob', len = bob ? 0.86 : 1.34, NR = bob ? 5 : 7;
      const DB = [-180, -156, -132, -110, -88, -70, -58, -49, -45, -40, -32, -22, -10, 0, 10, 22, 32, 40, 45, 49, 58, 70, 88, 110, 132, 156, 180];
      // 顔のまわりの開き: [角度, 髪の下のふちの高さ]。額は見せて、目の外側からまっすぐ下ろす
      const ARCH = [[0, 0.1], [10, 0.115], [22, 0.17], [32, 0.27], [40, 0.42], [45, 0.62], [49, len]];
      const bottom = (d) => { const a = Math.abs(d); for (let i = 1; i < ARCH.length; i++) if (a <= ARCH[i][0]) return lerp(ARCH[i - 1][1], ARCH[i][1], (a - ARCH[i - 1][0]) / (ARCH[i][0] - ARCH[i - 1][0])); return len; };
      // 高さごとの太さ [高さ, 横, 前半分の奥行き, 後ろ半分の奥行き]。ボブ = ほおの高さで一番ふくらみ、毛先は内へ巻く。長い = まっすぐ下ろして、肩から下は体に沿わせる
      //   前半分の奥行きは下へ行くほど小さく(顔のわきの髪を後ろへ引く。大きいと、横から見たときに顔が髪に隠れる)
      const PROF = bob ? [[0.1, 0.435, 0.39, 0.39], [0.3, 0.49, 0.43, 0.44], [0.58, 0.535, 0.4, 0.47], [0.76, 0.525, 0.385, 0.46], [len, 0.465, 0.35, 0.415]]
        : [[0.1, 0.435, 0.39, 0.39], [0.3, 0.485, 0.43, 0.44], [0.6, 0.5, 0.39, 0.45], [1, 0.5, 0.36, 0.4], [len, 0.46, 0.32, 0.33]];
      const prof = (y) => { for (let i = 1; i < PROF.length; i++) if (y <= PROF[i][0]) { const t = Math.max(0, (y - PROF[i - 1][0]) / (PROF[i][0] - PROF[i - 1][0])); return PROF[i].map((v, j) => lerp(PROF[i - 1][j], v, t)); } return PROF[PROF.length - 1]; };
      const pt = (d, y, rx, rzF, rzB = rzF) => ringPt(d, y, rx, Math.abs(d) <= 90 ? rzF + 0.12 : rzB, 0, 1); // + 0.12 = 輪の中心を頭の中心に移したぶん(見た目は前と同じ)
      const part = (d) => Math.abs(d) < 5; // 分け目の列(少しへこませる)
      // 頭の上は丸く: てっぺん → 2つの輪 → 列(高さ 0.1 から下)
      const top = [0, -0.1, 0.08];
      const rA = DB.map((d) => pt(d, part(d) ? -0.035 : -0.06, 0.24, 0.25)), rB = DB.map((d) => pt(d, part(d) ? 0.03 : 0.01, 0.37, 0.36));
      const cols = DB.map((d, i) => {
        const yb = bottom(d) + (Math.abs(d) >= 49 && i % 2 ? 0.035 : 0), ya = Math.min(0.1, yb - 0.02); // 毛先はふぞろいに
        return Array.from({ length: NR + 1 }, (_, k) => {
          const y = lerp(ya, yb, k / NR), [, rx, rzF, rzB] = prof(y), w = part(d) ? 0.975 : k >= 2 ? (i % 2 ? 1.014 : 0.992) : 1; // 列を交互に出し入れ = 髪の束
          return pt(d, y, rx * w, rzF * w, rzB * w);
        });
      });
      const HO = { both: true, bias: 0.045 };
      for (let i = 0; i < DB.length - 1; i++) {
        M.tri(top, rA[i + 1], rA[i], C.hair, HO);
        M.quad(rA[i], rA[i + 1], rB[i + 1], rB[i], C.hair, HO);
        M.quad(rB[i], rB[i + 1], cols[i + 1][0], cols[i][0], C.hair, HO);
        for (let k = 0; k < NR; k++) M.quad(cols[i][k], cols[i + 1][k], cols[i + 1][k + 1], cols[i][k + 1], C.hair, { ...HO, dim: (i % 2 ? 0.05 : 0) + (k === NR - 1 ? 0.04 : 0) });
      }
      scalpLine = (d) => Math.min(bottom(d), 0.9);
    }
  }
  if (hatOn) {
    const HB = { both: true, bias: 0.5 }; // 帽子は髪より手前に描く
    // ふち: 前は額、横・後ろは少し下がる。輪は、頭の表面 + 厚み(髪より外)
    const rimY = (d) => lerp(0.235, 0.34, Math.min(1, Math.abs(d) / 110));
    const ring = (h, t, y) => DEG.map((d) => { const hh = typeof h === 'function' ? h(d) : h; return fit(d, hh, t, 0, y === undefined ? hh : y); });
    const dome = (top, rings, mat, extra = {}) => {
      for (let i = 0; i < DEG.length - 1; i++) {
        M.tri(top, rings[0][i + 1], rings[0][i], mat, { ...HB, ...extra });
        for (let k = 0; k < rings.length - 1; k++) M.quad(rings[k][i], rings[k][i + 1], rings[k + 1][i + 1], rings[k + 1][i], mat, { ...HB, ...extra });
      }
    };
    if (o.hat === 'beanie') {
      const rim = ring(rimY, 0.085), up = ring((d) => rimY(d) - 0.1, 0.07);
      dome([0, -0.15, 0.04], [ring(0.03, 0.1, -0.09), ring(0.1, 0.085, 0.01), up], C.hat);
      for (let i = 0; i < DEG.length - 1; i++) M.quad(up[i], up[i + 1], rim[i + 1], rim[i], C.hat, { both: true, dim: 0.14, bias: 0.52 }); // 折り返し
    } else {
      const edge = ring((d) => rimY(d) - 0.02, 0.07);
      dome([0, -0.12, 0.04], [ring(0.03, 0.09, -0.07), ring(0.1, 0.08, 0.02), edge], C.hat);
      const zb = fit(0, 0.22, 0.07)[2]; // つばの付け根(額の前)
      // つば(上の面と、少し下の裏の面。厚みがないと、横から見たときに線になる)
      const brim = (dy) => [[-0.34 * hw, 0.235 + dy, zb - 0.16], [-0.2 * hw, 0.225 + dy, zb - 0.05], [0, 0.22 + dy, zb], [0.2 * hw, 0.225 + dy, zb - 0.05], [0.34 * hw, 0.235 + dy, zb - 0.16], [0.3 * hw, 0.29 + dy * 0.4, zb + 0.22], [0, 0.3 + dy * 0.4, zb + 0.3], [-0.3 * hw, 0.29 + dy * 0.4, zb + 0.22]];
      M.fan(brim(0.04), C.hat, { both: true, dim: 0.22, bias: 0.51 });
      M.fan(brim(0), C.hat, { both: true, dim: 0.06, bias: 0.52 });
      { const a = brim(0), b = brim(0.04); for (const i of [4, 5, 6, 7]) { const j = i === 7 ? 0 : i + 1; M.quad(a[i], a[j], b[j], b[i], C.hat, { both: true, dim: 0.14, bias: 0.52 }); } } // つばのふち
    }
  }
  // 髪・帽子の細かさ
  if (o.detailHair > 1) M.tris.splice(hairFrom, M.tris.length - hairFrom, ...subdivide(M.tris.slice(hairFrom), o.detailHair - 1));
  const hairEnd = M.tris.length;
  // ---- 頭の後ろ側(後頭部)。横・後ろから見たときのため。角度 90°(右の横)〜 270°(左の横)の輪を、高さごとに ----
  //   髪の生え際より上は髪の色にする(髪の面と頭の面が近い所で、描く順が入れ替わっても地肌が見えない)
  {
    const F0 = P.S2[0] / 0.41, BDEG = [90, 112, 135, 158, 180, 202, 225, 248, 270], BD = BDEG.map((d) => (d * Math.PI) / 180);
    const rings = [[0.03, 0.2, 0.2], [0.12, 0.34, 0.37], [0.28, 0.41, 0.44], [0.46, 0.41, 0.45], [0.64, 0.385, 0.41], [0.82, 0.3, 0.27], [0.96, 0.2, 0.16]]
      .map(([y, rx, rz]) => BD.map((a) => [Math.sin(a) * rx * F0, y, Math.cos(a) * rz + 0.02]));
    const topB = [0, 0, 0.02];
    // 顔とのつなぎ目: 横(90°・270°)の列は、顔のふちの点そのものにする(すき間ができない。高さは輪と同じ)
    ['T1', 'T2', 'S1', 'S2', 'S3'].forEach((k, j) => { rings[j][0] = P[k]; rings[j][BD.length - 1] = L(k); });
    // えら〜あごの下: 顔のふち(S3 → JW → CS → CB)と、後頭部の下の輪・首の間をふさぐ(横から見たとき、ここに面がなくて穴があいていた)
    [[(k) => P[k], 0], [L, BD.length - 1]].forEach(([g, c]) => {
      const r82 = rings[5][c], r96 = rings[6][c], nc = [0, 1, 0.16], SK = { both: true };
      M.tri(g('S3'), g('JW'), r82, C.skin, SK); M.tri(g('JW'), r96, r82, C.skin, SK);
      M.tri(g('JW'), g('CS'), r96, C.skin, { both: true, dim: 0.06 }); M.tri(g('CS'), nc, r96, C.skin, { both: true, dim: 0.06 }); M.tri(g('CS'), g('CB'), nc, C.skin, { both: true, dim: 0.06 });
    });
    const HAIR = [C.hair, { both: true, dim: 0.1 }], SKIN = [C.skin, { both: true }], mixP = (a, b, t) => a.map((v, j) => lerp(v, b[j], t));
    for (let i = 0; i < BD.length - 1; i++) {
      const dm = (BDEG[i] + BDEG[i + 1]) / 2, yl = scalpLine ? scalpLine(dm > 180 ? dm - 360 : dm) : -1; // この列の生え際の高さ
      M.tri(P.T, rings[0][i], rings[0][i + 1], ...(yl > 0 ? HAIR : SKIN));
      M.tri(topB, rings[0][i], rings[0][i + 1], ...(yl > 0 ? HAIR : SKIN));
      for (let k = 0; k < rings.length - 1; k++) {
        const a = rings[k][i], b = rings[k][i + 1], c = rings[k + 1][i + 1], d = rings[k + 1][i], t = (yl - a[1]) / (d[1] - a[1]);
        if (t >= 0.98) M.quad(a, b, c, d, ...HAIR);
        else if (t <= 0.02) M.quad(a, b, c, d, ...SKIN);
        else { const m1 = mixP(a, d, t), m2 = mixP(b, c, t); M.quad(a, b, m2, m1, ...HAIR); M.quad(m1, m2, c, d, ...SKIN); } // 生え際をまたぐ面は、そこで2つに切る
      }
    }
  }
  const bodyFrom = M.tris.length;
  // ---- 首・胴・腕・脚(全身)。単位は頭の高さ = 1。全体の高さ = 頭身 H ----
  const B = o.build, H = o.heads, tt = Math.min(1, Math.max(0, (H - 2) / 5));
  const shY = lerp(1.05, 1.3, tt); // 肩の高さ
  const sw = lerp(0.56, 0.9, tt) * B; // 肩の半幅
  const crY = Math.max(shY + 0.6, lerp(0.72, 0.53, tt) * H); // 股
  const waY = shY + (crY - shY) * 0.6, footY = H - 0.06, knY = lerp(crY, footY, 0.5);
  const top = o.top, cTop = C.top;
  M.tag({ bone: 'neck', prev: 'head', next: 'chest' });
  M.tube([0, 0.86, 0.14], [0, shY - 0.03, 0.1], 0.17, 0.2 * B, 8, C.skin);
  M.tag({ bone: 'torso' }); // 胴: 高さで 胸・背骨・腰 に分ける
  const T = {
    NC: [0, shY - 0.05, 0.26], CL: [0.2 * B, shY - 0.1, 0.2], SN: [0.36 * B, shY - 0.09, 0.08], ST: [sw * 0.72, shY - 0.01, 0.04], SP: [sw, shY + 0.12, 0.0], AX: [sw * 0.98, shY + 0.5, 0.02],
    CH: [sw * 0.5, shY + 0.32, 0.34 * B], CC: [0, shY + 0.36, 0.3 * B], WF: [sw * 0.4, waY, 0.27 * B], WC: [0, waY, 0.25 * B], WS: [sw * 0.76, waY, 0.04],
    HF: [sw * 0.44, crY - 0.12, 0.26 * B], HS: [sw * 0.86, crY - 0.15, 0.03], HC: [0, crY - 0.02, 0.2 * B], HL: [sw * 0.5, crY + 0.02, 0.14],
  };
  const body = ['NC CL CH', 'NC CH CC', 'CL SN CH', 'SN ST CH', 'ST SP CH', 'SP AX CH', 'CH AX WS', 'CH WS WF', 'CH WF CC', 'CC WF WC', 'WF WS HS', 'WF HS HF', 'WF HF WC', 'WC HF HC', 'HF HS HL', 'HF HL HC'];
  const lowerMat = top === 'coat' ? cTop : C.bottom, LOW = new Set(['WF', 'WS', 'WC', 'HF', 'HS', 'HC', 'HL']); // 腰(ウエストより下)は下の服の色
  for (const t of body) {
    const [a, b, c] = t.split(' ');
    const mat = [a, b, c].every((k) => LOW.has(k)) ? (top === 'overalls' ? C.top2 : lowerMat) : cTop;
    M.tri(T[a], T[b], T[c], mat); M.tri(mir(T[a]), mir(T[c]), mir(T[b]), mat);
    // 背中側(前の面を、奥行きを 0.7 倍にして裏返す)
    const bk = (v) => [v[0], v[1], -v[2] * 0.7];
    M.tri(bk(T[a]), bk(T[c]), bk(T[b]), mat); M.tri(bk(mir(T[a])), bk(mir(T[b])), bk(mir(T[c])), mat);
  }
  // ベルト
  if (top !== 'coat' && top !== 'overalls' && o.bottom !== 'skirt') M.tube([0, waY - 0.02, 0.03 * B], [0, waY + 0.07, 0.03 * B], sw * 0.8, sw * 0.82, 8, C.shoes, { dim: 0.05, wz: 0.36 * B });
  // 脚(太もも → すね)と足
  const rL = sw * 0.37;
  // 関節の位置(立体のモデルのボーン)。名前の .L は本人の左(= 絵では右。x が +)
  const joints = { root: [0, H, 0.05], hips: [0, lerp(waY, crY, 0.6), 0.05], spine: [0, waY, 0.05], chest: [0, lerp(shY, waY, 0.45), 0.05], neck: [0, shY - 0.05, 0.08], head: [0, 0.9, 0.1] };
  for (const s of [1, -1]) {
    const hx = sw * 0.42 * s, fx = sw * 0.5 * s, bare = o.bottom === 'shorts' || o.bottom === 'skirt', sd = s > 0 ? 'L' : 'R';
    joints['thigh.' + sd] = [hx, crY - 0.12, 0.08]; joints['shin.' + sd] = [fx, knY, 0.1]; joints['foot.' + sd] = [fx, footY - 0.12, 0.06];
    if (o.bottom === 'skirt') {
      // スカート: 太ももの上のほう(スカートの中)はスカートの色にする。立体で脚を動かしたとき、スカートから突き抜けても肌が見えない
      const mid = [lerp(hx, fx, 0.78), lerp(crY - 0.12, knY, 0.78), lerp(0.08, 0.1, 0.78)];
      M.tag({ bone: 'thigh.' + sd, prev: 'hips' });
      M.tube([hx, crY - 0.12, 0.08], mid, rL, rL * 0.844, 7, C.bottom);
      M.tag({ bone: 'thigh.' + sd, next: 'shin.' + sd });
      M.tube(mid, [fx, knY, 0.1], rL * 0.844, rL * 0.8, 7, C.skin);
    } else {
      M.tag({ bone: 'thigh.' + sd, prev: 'hips', next: 'shin.' + sd });
      M.tube([hx, crY - 0.12, 0.08], [fx, knY, 0.1], rL, rL * 0.8, 7, C.bottom);
    }
    M.tag({ bone: 'shin.' + sd, prev: 'thigh.' + sd });
    M.tube([fx, knY, 0.1], [fx, footY - 0.12, 0.06], rL * 0.78, rL * 0.6, 7, bare ? C.skin : C.bottom);
    M.tag({ bone: 'shin.' + sd });
    if (o.shoes === 'boots') M.tube([fx, lerp(knY, footY, 0.4), 0.08], [fx, footY - 0.1, 0.06], rL * 0.86, rL * 0.74, 7, C.shoes);
    // 足(くつ): かかと → つま先へのびる、角ばったかたまり
    const y0 = footY - 0.14, y1 = footY + 0.06, w = rL * 0.75;
    const a = [fx - w, y0, -0.02], b = [fx + w, y0, -0.02], c = [fx + w * 1.1 + 0.03 * s, y0 + 0.07, 0.42], d = [fx - w * 1.1 + 0.03 * s, y0 + 0.07, 0.42];
    const e = [fx - w, y1, -0.04], g = [fx + w, y1, -0.04], hh2 = [fx + w * 1.15 + 0.03 * s, y1, 0.46], i2 = [fx - w * 1.15 + 0.03 * s, y1, 0.46];
    M.tag({ bone: 'foot.' + sd });
    const SH = { both: true, c: [fx, footY - 0.04, 0.2] }; // c = かたまりの中心(立体にするとき、面の外向きを決めるのに使う)
    M.quad(a, b, c, d, C.shoes, SH); M.quad(d, c, hh2, i2, C.shoes, SH); M.quad(a, d, i2, e, C.shoes, SH); M.quad(b, g, hh2, c, C.shoes, SH);
  }
  M.tag({ bone: 'hips', hem: true }); // hem = すそ(下へ行くほど、左右の太もものボーンにも付いていく)
  if (o.bottom === 'skirt') M.tube([0, waY, 0.04], [0, lerp(crY, knY, 0.75), 0.06], sw * 0.8, sw * 1.12, 9, C.bottom, { wz: 0.5 });
  if (top === 'coat') M.tube([0, waY - 0.05, 0.04], [0, lerp(crY, knY, 0.8), 0.05], sw * 0.84, sw * 1.05, 9, cTop, { dim: 0.03, wz: 0.48 });
  // 腕(ポーズ)。角度は「真下から外向き」の度。fz = 前へ出す量
  const armLen = (crY - shY) * 1.0, la = armLen * 0.5, rad = Math.PI / 180, rA = 0.19 * B * lerp(1.1, 1, tt);
  const hold = o.pose === 'hold' || (o.pose === 'stand' && o.item !== 'none');
  const ARM = { stand: [[5, 3, 0], [5, 3, 0]], hips: [[32, -38, 0.12], [32, -38, 0.12]], wave: [[5, 3, 0], [80, 172, 0.05]], hold: [[5, 3, 0], [14, 60, 0.3]] }[hold ? 'hold' : o.pose] || [[5, 3, 0], [5, 3, 0]];
  const short = top === 'tshirt';
  let hand = null;
  [-1, 1].forEach((s, k) => {
    const [U, F, fz] = ARM[k];
    const S = [sw * 0.98 * s, shY + 0.18, 0.0];
    const E = [S[0] + s * Math.sin(U * rad) * la, S[1] + Math.cos(U * rad) * la, 0.02];
    const fl = la * (fz > 0.2 ? 0.82 : 0.95);
    const W = [E[0] + s * Math.sin(F * rad) * fl, E[1] + Math.cos(F * rad) * fl, 0.02 + fz];
    const sd = s > 0 ? 'L' : 'R';
    joints['upper_arm.' + sd] = S; joints['forearm.' + sd] = E; joints['hand.' + sd] = W;
    M.tag({ bone: 'upper_arm.' + sd, prev: 'chest', next: 'forearm.' + sd });
    M.tube(S, E, rA * 1.05, rA * 0.9, 7, cTop);
    M.tag({ bone: 'forearm.' + sd, prev: 'upper_arm.' + sd, next: 'hand.' + sd });
    M.tube(E, W, rA * 0.88, rA * 0.72, 7, short ? C.skin : cTop);
    M.tag({ bone: 'hand.' + sd, prev: 'forearm.' + sd });
    // 手: 手首から先の、角ばったかたまり
    const dir = [W[0] - E[0], W[1] - E[1], W[2] - E[2]], dl = Math.hypot(...dir) || 1, hv = dir.map((v) => (v / dl) * rA * 1.5);
    const Hh = [W[0] + hv[0], W[1] + hv[1], W[2] + hv[2]];
    M.tube(W, Hh, rA * 0.8, rA * 0.6, 6, C.skin, {}, true);
    if (k === 1) hand = [W[0] + hv[0] * 0.5, W[1] + hv[1] * 0.5, W[2] + hv[2] * 0.5];
  });
  // 持ち物(右の手)
  M.tag({ bone: 'hand.L' });
  if (o.item !== 'none' && hand) {
    const [ix, iy, iz] = hand;
    if (o.item === 'rod') M.tube([ix - 0.05, iy + 0.9, iz + 0.02], [ix + 0.45, -0.7, iz + 0.05], 0.03, 0.016, 5, C.accent);
    if (o.item === 'bat') { M.tube([ix - 0.03, iy + 0.25, iz + 0.02], [ix + 0.2, iy - 0.95, iz + 0.04], 0.035, 0.05, 6, '#c9a063'); M.tube([ix + 0.2, iy - 0.95, iz + 0.04], [ix + 0.36, iy - 1.85, iz + 0.05], 0.06, 0.09, 6, '#c9a063', {}, true); }
    if (o.item === 'lantern') {
      M.tube([ix, iy, iz + 0.03], [ix, iy + 0.36, iz + 0.03], 0.012, 0.012, 4, '#3a3632');
      M.tube([ix, iy + 0.36, iz + 0.03], [ix, iy + 0.78, iz + 0.03], 0.15, 0.18, 6, '#3a3632', {}, true, true);
      M.tube([ix, iy + 0.44, iz + 0.035], [ix, iy + 0.7, iz + 0.035], 0.155, 0.175, 6, C.accent, { flat: 1 });
    }
    if (o.item === 'bag') { M.tube([ix, iy, iz + 0.03], [ix, iy + 0.22, iz + 0.03], 0.014, 0.014, 4, C.accent); M.tube([ix, iy + 0.22, iz + 0.03], [ix, iy + 0.8, iz + 0.03], 0.26, 0.3, 6, C.accent, {}, true, true); }
  }
  // 服の細部
  M.tag({ bone: 'torso' });
  const f2 = f;
  if (top === 'overalls') {
    M.fan([[-sw * 0.36, shY + 0.42, 0.36 * B], [sw * 0.36, shY + 0.42, 0.36 * B], [sw * 0.42, waY, 0.29 * B], [-sw * 0.42, waY, 0.29 * B]], C.top2, { bias: f2 * 2, both: true });
    for (const s of [1, -1]) { M.fan([[sw * 0.36 * s, shY + 0.42, 0.36 * B], [sw * 0.24 * s, shY + 0.42, 0.36 * B], [0.3 * B * s, shY - 0.085, 0.12], [0.38 * B * s, shY - 0.08, 0.08]], C.top2, { bias: f2 * 3, both: true, dim: s > 0 ? 0.12 : 0 }); M.fan([[sw * 0.34 * s, shY + 0.44, 0.37 * B], [sw * 0.26 * s, shY + 0.44, 0.37 * B], [sw * 0.26 * s, shY + 0.5, 0.37 * B], [sw * 0.34 * s, shY + 0.5, 0.37 * B]], C.accent, { flat: 0.9, bias: f2 * 4, both: true }); }
  }
  if (top === 'jacket' || top === 'coat') { for (const s of [1, -1]) M.fan([[0.03 * s, shY, 0.28], [0.22 * B * s, shY - 0.1, 0.22], [0.4 * B * s, shY - 0.04, 0.12], [0.16 * s, shY + 0.45, 0.34 * B]], C.top2, { bias: f2 * 2, both: true, dim: s > 0 ? 0.1 : -0.05 }); M.fan([[-0.02, shY, 0.29 * B], [0.02, shY, 0.29 * B], [0.02, top === 'coat' ? lerp(crY, knY, 0.8) : crY - 0.1, 0.3 * B], [-0.02, top === 'coat' ? lerp(crY, knY, 0.8) : crY - 0.1, 0.3 * B]], C.top2, { flat: 0.15, bias: f2 * 3, both: true }); }
  if (top === 'shirt' || top === 'tshirt') M.fan([[-0.22 * B, shY - 0.1, 0.2], [0, shY + 0.22, 0.31 * B], [0.22 * B, shY - 0.1, 0.2], [0, shY - 0.03, 0.26]], top === 'shirt' ? C.top2 : C.skin, { bias: f2 * 2, both: true });
  M.tag({ bone: 'chest' });
  if (top === 'sweater') M.tube([0, shY - 0.2, 0.13], [0, shY - 0.03, 0.12], 0.215 * B, 0.27 * B, 8, cTop, { dim: 0.08 }); // えり

  // 体・服・持ち物の細かさ(筒は丸く、胴はなだらかになる)
  if (o.detailBody > 1) M.tris.splice(bodyFrom, M.tris.length - bodyFrom, ...subdivide(M.tris.slice(bodyFrom), o.detailBody - 1));

  M.tris.forEach((t, i) => { t.part = i >= bodyFrom ? 'body' : i >= hairFrom && i < hairEnd ? 'hair' : 'head'; });
  return { tris: M.tris, H, sw, shY, crY, waY, joints };
}

// 面の色: 明るさ a(0〜1)を steps 段に丸めて、素材の色の ramp で色にする。flat の面は明るさを決め打ち
export function polyShader(o) {
  const ramps = new Map(), steps = Math.max(2, Math.round(o.steps));
  const rp = (hex) => { if (!ramps.has(hex)) ramps.set(hex, ramp(hex, o.shade)); return ramps.get(hex); };
  return (t, lit) => { let a = t.flat !== undefined ? t.flat : lit * 0.62 + 0.38; if (t.flat === undefined) { a = Math.round(a * steps) / steps; a -= t.dim || 0; } return toHex(rp(t.mat)(a)); };
}
export const POLY_LIGHT = [-0.42, -0.56, 0.71];

export function buildBust(opts) {
  const o = polyOptions(opts), { tris, H, sw, shY } = modelTris(o);
  // ---- 光を当てて、パスにする ----
  const yaw = (o.yaw * Math.PI) / 180, cy = Math.cos(yaw), sy = Math.sin(yaw), zc = 0.08; // 体の軸のまわりに回す
  const rot = (v) => { const x = v[0], z = v[2] - zc; return [x * cy + z * sy, v[1], -x * sy + z * cy + zc]; };
  const LIGHT = POLY_LIGHT, shader = polyShader(o);
  const out = [];
  for (const t of tris) {
    // 顔や服の上にのせた面(目・眉・口・耳の側面・服の飾り。bias 0.05〜0.4)は、のっている面が向こうを向いたら描かない
    if (t.bias >= 0.05 && t.bias <= 0.4) {
      let m = t.out;
      if (!m) { m = cross(sub(t.p[1], t.p[0]), sub(t.p[2], t.p[0])); const ml = Math.hypot(...m) || 1; m = m.map((v) => v / ml); if (m[2] < 0) m = m.map((v) => -v); }
      if (-m[0] * sy + m[2] * cy < 0.06) continue;
    }
    const p = t.p.map(rot);
    let n = cross(sub(p[1], p[0]), sub(p[2], p[0]));
    const len = Math.hypot(...n) || 1;
    n = n.map((v) => v / len);
    if (n[2] < 0) n = n.map((v) => -v); // どの面も手前向きとして光を当てる(裏側の面は、奥から順に描くので手前の面に隠れる)
    out.push({ pts: p.map((v) => [v[0], v[1]]), color: shader(t, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]), z: (p[0][2] + p[1][2] + p[2][2]) / 3 + (t.bias || 0) });
  }
  out.sort((a, b) => a.z - b.z);
  // 構図: full = 全身、bust = 胸から上、face = 顔のアップ
  const y0 = (o.item === 'rod' || o.item === 'bat') && o.frame === 'full' ? -0.85 : o.hat === 'none' ? ({ spiky: -0.36, quiff: -0.26, afro: -0.66 }[o.hair] ?? -0.19) : -0.24;
  let fit;
  if (o.frame === 'full') {
    const wide = o.pose !== 'stand' || o.item !== 'none', half = sw * (wide ? 2.3 : 1.6);
    fit = { x0: -half, x1: half, y0, y1: H + 0.08 };
  } else {
    const y1 = o.frame === 'face' ? 1.16 : shY + 0.42, half = Math.max((y1 - y0) / 2, o.frame === 'face' ? 0.6 + 0.1 * Math.abs(sy) : sw * 1.05);
    fit = { x0: -half, x1: half, y0, y1 };
  }
  return { polys: out, fit, count: out.length };
}

// キャンバスに描く(面のすき間が見えないよう、同じ色の細い線も引く)
export function drawPolys(ctx, bust, size, { x = 0, y = 0 } = {}) {
  const f = bust.fit, pad = size * 0.04;
  const s = Math.min((size - pad * 2) / (f.x1 - f.x0), (size - pad * 2) / (f.y1 - f.y0));
  const ox = x + size / 2 - ((f.x0 + f.x1) / 2) * s, oy = y + size - pad - f.y1 * s;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, size, size); ctx.clip();
  ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(0.6, s * 0.004);
  for (const p of bust.polys) {
    ctx.beginPath();
    p.pts.forEach(([px, py], i) => (i ? ctx.lineTo(ox + px * s, oy + py * s) : ctx.moveTo(ox + px * s, oy + py * s)));
    ctx.closePath();
    ctx.fillStyle = ctx.strokeStyle = p.color;
    ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

// Kodai の図形(パスのグループ)にする。size × size の中に収め、左上が (x, y)。面どうしのすき間が見えないよう、同じ色の細い線も付ける
export function polysToShape(bust, size, { x = 0, y = 0, name = 'キャラ' } = {}) {
  const f = bust.fit, pad = size * 0.04;
  const s = Math.min((size - pad * 2) / (f.x1 - f.x0), (size - pad * 2) / (f.y1 - f.y0));
  const ox = x + size / 2 - ((f.x0 + f.x1) / 2) * s, oy = y + size - pad - f.y1 * s;
  const r = (v) => Math.round(v * 100) / 100;
  const sw = Math.max(0.4, Math.round(s * 0.004 * 100) / 100);
  // 絵の枠(size × size)からはみ出す面は、枠で切る(胸から下など)
  const cut = (pts, inside, cross) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], ia = inside(a), ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) out.push(cross(a, b));
    }
    return out;
  };
  const X0 = x, X1 = x + size, Y0 = y, Y1 = y + size;
  const atX = (X) => (a, b) => [X, a[1] + ((b[1] - a[1]) * (X - a[0])) / (b[0] - a[0])], atY = (Y) => (a, b) => [a[0] + ((b[0] - a[0]) * (Y - a[1])) / (b[1] - a[1]), Y];
  const children = [];
  for (const p of bust.polys) {
    let pts = p.pts.map(([px, py]) => [ox + px * s, oy + py * s]);
    pts = cut(pts, (v) => v[0] >= X0, atX(X0)); pts = cut(pts, (v) => v[0] <= X1, atX(X1)); pts = cut(pts, (v) => v[1] >= Y0, atY(Y0)); pts = cut(pts, (v) => v[1] <= Y1, atY(Y1));
    if (pts.length < 3) continue;
    children.push({ type: 'path', closed: true, nodes: pts.map(([px, py]) => ({ x: r(px), y: r(py) })), fill: p.color + 'ff', stroke: p.color + 'ff', strokeWidth: sw });
  }
  return { type: 'group', name, children };
}
