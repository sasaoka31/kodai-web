// キャラ(パス)を、立体のモデル(.glb。Blender などで開ける)にする
//   キャラ(パス)は、もともと奥行きつきの面(三角)の集まり(charpoly.js の modelTris)。それをそのまま 3D のメッシュにする。
//   polyMesh(opts) → { parts: [{ name, positions, normals, uvs }], palette: [色…], stats }
//   polyToGlb(opts, { name, height }) → Uint8Array(.glb)
//   しくみ:
//   ・色は、Kodai の絵と同じ「面ごとに1色」(光を当てた色を焼き込む)。色の一覧を小さな絵(パレット)にして、面の UV でその色を指す
//     光は上から + 「どの向きの面も、正面から見たときと同じ」(横・後ろから見ても暗くならない)。左右の差は少しだけ残す
//   ・顔や服の上にのせた面(目・眉・口・服の飾り)は、絵では描く順(bias)だけで手前にしている。立体では、下の面の表面まで動かして、少しだけ浮かせる
//   ・ボーン(bones: true): 人の骨組み(腰 → 背骨 → 胸 → 首 → 頭、腕・脚)を入れて、面をボーンに結び付ける(Blender でポーズを付けられる)
//     腕・脚の筒は、両端だけ隣のボーンと半々(ひじ・ひざを曲げても、つなぎ目が離れない)。胴は高さで 胸・背骨・腰 に分ける。頭・髪・帽子は頭、持ち物は手
//   ・動き(anims: ['walk', …]): ボーンの回転の動き(歩く・走る・待機・手を振る)。その場で動く(前へは進まない)。くり返してもつながる
//     ボーンは回転なしで入れてあるので、動き = 関節ごとの「世界の軸のまわりの回転」(x = 左右の軸: 前後に振る、y = 上下の軸: ひねる、z = 前後の軸: 横へ上げる)
//   ・向きは glTF に合わせる(+Y が上、+Z が正面)。足もとが y = 0、背の高さ = height(m)
import { polyOptions, modelTris, polyShader, POLY_LIGHT } from './charpoly.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v) => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const isDecal = (t) => t.bias >= 0.05 && t.bias <= 0.4 && !t.out;

export const PART_NAMES = { body: '体', head: '顔', hair: '髪・帽子' };
// 骨組み: [名前, 親]。.L = 本人の左、.R = 右(Blender の左右対称の名前の付け方)
export const POLY_BONES = [
  ['root', null], ['hips', 'root'], ['spine', 'hips'], ['chest', 'spine'], ['neck', 'chest'], ['head', 'neck'],
  ['upper_arm.L', 'chest'], ['forearm.L', 'upper_arm.L'], ['hand.L', 'forearm.L'], ['upper_arm.R', 'chest'], ['forearm.R', 'upper_arm.R'], ['hand.R', 'forearm.R'],
  ['thigh.L', 'hips'], ['shin.L', 'thigh.L'], ['foot.L', 'shin.L'], ['thigh.R', 'hips'], ['shin.R', 'thigh.R'], ['foot.R', 'shin.R'],
];
// 動き: 名前(Blender ではアクションの名前)と、1周の秒数
export const POLY_ANIMS = { walk: { label: '歩く', sec: 1 }, run: { label: '走る', sec: 0.625 }, idle: { label: '待機', sec: 2.5 }, wave: { label: '手を振る', sec: 1.5 } }; // 秒数は 1/24 秒の倍数(Blender のコマにぴったり合う)
const RAD = Math.PI / 180;
const qAxis = (ax, deg) => { const h = (deg * RAD) / 2, s = Math.sin(h); return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(h)]; };
const qMul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const QX = (deg) => qAxis([1, 0, 0], deg), QY = (deg) => qAxis([0, 1, 0], deg), QZ = (deg) => qAxis([0, 0, 1], deg);
// 1コマぶんの姿勢: { ボーンの名前: 回転(四元数), hipsY: 腰の上下(m) }。p = 位相(0〜2π)、leg = 脚の長さ(m)、free = 腕を振ってよいか { L, R }
//   x のまわりの回転: マイナス = 前へ振る(脚・腕)、プラス = 後ろへ(ひざを曲げる)。胴はプラスで前に傾く
function poseAt(kind, p, leg, free) {
  const s = Math.sin(p), c = Math.cos(p), pos = (v) => Math.max(0, v), out = {};
  if (kind === 'walk' || kind === 'run') {
    const run = kind === 'run', A = run ? 42 : 26, K = run ? 95 : 50, B = run ? 48 : 22, E = run ? 85 : 16;
    const thL = -A * s, thR = A * s, shL = 6 + K * pos(c) ** (run ? 1 : 1.3), shR = 6 + K * pos(-c) ** (run ? 1 : 1.3);
    out['thigh.L'] = QX(thL - (run ? 8 : 0)); out['thigh.R'] = QX(thR - (run ? 8 : 0));
    out['shin.L'] = QX(shL); out['shin.R'] = QX(shR);
    out['foot.L'] = QX(-(thL + shL) * 0.5); out['foot.R'] = QX(-(thR + shR) * 0.5);
    if (free.L) { out['upper_arm.L'] = QX(B * s); out['forearm.L'] = QX(-(E + (run ? 0 : 10) * pos(-s))); }
    if (free.R) { out['upper_arm.R'] = QX(-B * s); out['forearm.R'] = QX(-(E + (run ? 0 : 10) * pos(s))); }
    out.spine = qMul(QY((run ? 9 : 5) * s), QX(run ? 10 : 2)); out.chest = QY((run ? -14 : -8) * s); out.head = qMul(QY((run ? 5 : 3) * s), QX(run ? -6 : -1));
    // 腰の上下: 脚を開いたぶん下げる(足が地面から浮かないように)。走りは、けり出しで少し上がる
    out.hipsY = -leg * (1 - Math.cos(A * RAD * Math.abs(s))) * (run ? 0.55 : 1) + (run ? 0.03 * Math.abs(s) : 0);
  } else if (kind === 'idle') {
    // 待機: ゆっくり息をする。体がほんの少し上下して、腕と頭がゆれる
    out.chest = QX(-1.6 * s); out.spine = QX(0.8 * s); out.head = qMul(QX(1.2 * s), QY(2.5 * Math.sin(p / 1)));
    if (free.L) { out['upper_arm.L'] = QZ(2.5 + 1.5 * s); out['forearm.L'] = QX(-4 - 2 * c); }
    if (free.R) { out['upper_arm.R'] = QZ(-2.5 - 1.5 * s); out['forearm.R'] = QX(-4 - 2 * c); }
    out.hipsY = -0.004 * (1 - c);
  } else if (kind === 'wave') {
    // 手を振る: 片腕を横から上げて、前腕を左右に振る(1周で2往復)。空いている方の腕で
    const sd = free.L || !free.R ? 'L' : 'R', k = sd === 'L' ? 1 : -1;
    out['upper_arm.' + sd] = QZ(k * 118); out['forearm.' + sd] = QZ(k * (38 + 26 * Math.sin(p * 2)));
    out['hand.' + sd] = QZ(k * 8 * Math.sin(p * 2));
    out.head = qMul(QZ(-k * 4), QY(k * 6)); out.chest = QZ(-k * 2.5); out.spine = QX(0.8 * s);
    out.hipsY = -0.003 * (1 - c);
  }
  return out;
}
const BONE_IX = Object.fromEntries(POLY_BONES.map(([n], i) => [n, i]));
const sat = (v) => Math.min(1, Math.max(0, v));

export function polyMesh(opts, { height = 1.7, bones = false, anims = [] } = {}) {
  const o = polyOptions(opts), { tris, H, shY, crY, waY, joints } = modelTris(o);
  // 頂点 v(もとの位置)のボーンの重み: [[ボーンの番号, 重み], …]
  const chY = joints.chest[1];
  const weightsOf = (t, v) => {
    const bone = t.bone || 'head';
    if (bone === 'torso') {
      const hip = sat((v[1] - (waY - 0.1)) / 0.2), ch = 1 - sat((v[1] - (chY - 0.12)) / 0.24);
      return [[BONE_IX.chest, ch], [BONE_IX.hips, hip], [BONE_IX.spine, Math.max(0, 1 - ch - hip)]].filter((w) => w[1] > 0.001);
    }
    if (t.hem && t.ax) {
      // すそ: 下ほど太ももに付く(真ん中の点は左右半々)。脚を上げると、すそも一緒に持ち上がる
      const [a, b] = t.ax, ab = sub(b, a), tt = sat(dot(sub(v, a), ab) / (dot(ab, ab) || 1)), wt = 0.85 * tt, l = v[0] > 0.03 ? 1 : v[0] < -0.03 ? 0 : 0.5;
      return [[BONE_IX.hips, 1 - wt], [BONE_IX['thigh.L'], wt * l], [BONE_IX['thigh.R'], wt * (1 - l)]].filter((w) => w[1] > 0.001);
    }
    if (t.ax && (t.prev || t.next)) {
      const [a, b] = t.ax, ab = sub(b, a), tt = sat(dot(sub(v, a), ab) / (dot(ab, ab) || 1));
      const wp = t.prev ? 0.5 * sat((0.3 - tt) / 0.3) : 0, wn = t.next ? 0.5 * sat((tt - 0.7) / 0.3) : 0;
      return [[BONE_IX[bone], 1 - wp - wn], [BONE_IX[t.prev], wp], [BONE_IX[t.next], wn]].filter((w) => w[1] > 0.001);
    }
    return [[BONE_IX[bone] ?? BONE_IX.head, 1]];
  };
  // ---- のせた面を、下の面の表面へ(正面から見た位置 x, y はそのまま。奥行きだけ動かす)----
  const base = tris.filter((t) => !(t.bias > 0)).map((t) => {
    const [a, b, c] = t.p, d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    return { a, b, c, d, x0: Math.min(a[0], b[0], c[0]), x1: Math.max(a[0], b[0], c[0]), y0: Math.min(a[1], b[1], c[1]), y1: Math.max(a[1], b[1], c[1]) };
  }).filter((t) => Math.abs(t.d) > 1e-9);
  const surfZ = (x, y, z0) => {
    let best = null;
    for (const t of base) {
      if (x < t.x0 || x > t.x1 || y < t.y0 || y > t.y1) continue;
      const u = ((t.b[1] - t.c[1]) * (x - t.c[0]) + (t.c[0] - t.b[0]) * (y - t.c[1])) / t.d, v = ((t.c[1] - t.a[1]) * (x - t.c[0]) + (t.a[0] - t.c[0]) * (y - t.c[1])) / t.d, w = 1 - u - v;
      if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
      const z = u * t.a[2] + v * t.b[2] + w * t.c[2];
      if (Math.abs(z - z0) < 0.12 && (best === null || z > best)) best = z; // 近くの面だけ(手前に出した腕などは拾わない)
    }
    return best;
  };
  const memo = new Map();
  const lift = (v, layer) => {
    const k = `${v[0]},${v[1]},${v[2]}`;
    if (!memo.has(k)) memo.set(k, surfZ(v[0], v[1], v[2]));
    const s = memo.get(k);
    return [v[0], v[1], (s === null ? v[2] : s) + 0.005 * layer];
  };

  // ---- 面ごとに: 外向きを決める → 色 → glTF の向きへ ----
  const shader = polyShader(o), k = height / H, palette = [], colorIx = new Map();
  const out = { body: [], head: [], hair: [] };
  let count = 0;
  // のせた面は、大きいものを先に小さく分ける(下の面のふくらみに沿わせる。分けないと、眉などが顔の面に埋まる)
  const split = (t, lv) => {
    const [a, b, c] = t.p, big = Math.max(Math.hypot(a[0] - b[0], a[1] - b[1]), Math.hypot(b[0] - c[0], b[1] - c[1]), Math.hypot(c[0] - a[0], c[1] - a[1]));
    if (lv >= 2 || big < 0.05) return [t];
    const m = (u, v) => [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2, (u[2] + v[2]) / 2], ab = m(a, b), bc = m(b, c), ca = m(c, a);
    return [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]].flatMap((p) => split({ ...t, p }, lv + 1));
  };
  const toGl = (v) => [v[0] * k, (H - v[1]) * k, v[2] * k];
  for (const t of tris.flatMap((t) => (isDecal(t) ? split(t, 0) : [t]))) {
    const decal = isDecal(t);
    const p = decal ? t.p.map((v) => lift(v, Math.max(1, Math.round(t.bias / 0.06)))) : t.p;
    let n = cross(sub(p[1], p[0]), sub(p[2], p[0]));
    if (Math.hypot(...n) < 1e-10) continue; // つぶれた面は入れない
    n = unit(n);
    const c = [(p[0][0] + p[1][0] + p[2][0]) / 3, (p[0][1] + p[1][1] + p[2][1]) / 3, (p[0][2] + p[1][2] + p[2][2]) / 3];
    // 外向き: のせた面は手前(か t.out)、筒は軸から外、ほかは頭・胴の中心から外
    let dir;
    if (t.out) dir = t.out;
    else if (decal) dir = [0, 0, 1];
    else if (t.ax) {
      const [a, b] = t.ax, ab = sub(b, a), tt = Math.min(1, Math.max(0, dot(sub(c, a), ab) / (dot(ab, ab) || 1)));
      dir = sub(c, [a[0] + ab[0] * tt, a[1] + ab[1] * tt, a[2] + ab[2] * tt]);
      if (Math.abs(dot(unit(dir), n)) < 0.2) dir = tt < 0.5 ? ab.map((x) => -x) : ab; // 筒のふた(始まり側は逆向き)
    } else if (t.c) dir = sub(c, t.c);
    else if (t.part === 'body') dir = sub(c, [0, Math.min(Math.max(c[1], shY + 0.35), crY - 0.2), 0.03]);
    else dir = sub(c, [0, c[1] < 0.9 ? 0.45 : c[1], 0.04]);
    if (dot(n, dir) < 0) n = n.map((v) => -v);
    const hex = shader(t, n[0] * POLY_LIGHT[0] * 0.35 + n[1] * POLY_LIGHT[1] + Math.hypot(n[0], n[2]) * POLY_LIGHT[2]);
    if (!colorIx.has(hex)) { colorIx.set(hex, palette.length); palette.push(hex); }
    // glTF: x はそのまま、y は上向き(足もと = 0)、z は手前。上下を返すので、面の回る向きを外向きに合わせ直す
    const g = p.map(toGl), gn = [n[0], -n[1], n[2]], w = bones ? t.p.map((v) => weightsOf(t, v)) : null;
    if (dot(cross(sub(g[1], g[0]), sub(g[2], g[0])), gn) < 0) { let tmp = g[1]; g[1] = g[2]; g[2] = tmp; if (w) { tmp = w[1]; w[1] = w[2]; w[2] = tmp; } }
    out[t.part || 'body'].push({ g, gn, ci: colorIx.get(hex), w });
    count++;
  }
  // パレット: 色を G × G のマスに並べる。UV はマスの真ん中
  const G = Math.max(2, Math.ceil(Math.sqrt(palette.length)));
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const parts = Object.entries(out).filter(([, list]) => list.length).map(([name, list]) => {
    const positions = new Float32Array(list.length * 9), normals = new Float32Array(list.length * 9), uvs = new Float32Array(list.length * 6);
    list.forEach((f, i) => {
      for (let j = 0; j < 3; j++) {
        positions.set(f.g[j], i * 9 + j * 3); normals.set(f.gn, i * 9 + j * 3);
        uvs[i * 6 + j * 2] = ((f.ci % G) + 0.5) / G; uvs[i * 6 + j * 2 + 1] = (Math.floor(f.ci / G) + 0.5) / G;
        for (let a = 0; a < 3; a++) { if (f.g[j][a] < min[a]) min[a] = f.g[j][a]; if (f.g[j][a] > max[a]) max[a] = f.g[j][a]; }
      }
    });
    const part = { name, positions, normals, uvs, triangles: list.length };
    if (bones) {
      part.joints = new Uint16Array(list.length * 12); part.weights = new Float32Array(list.length * 12);
      list.forEach((f, i) => f.w.forEach((ws, j) => { const sum = ws.reduce((a, x) => a + x[1], 0) || 1; ws.forEach(([b, wt], q) => { part.joints[(i * 3 + j) * 4 + q] = b; part.weights[(i * 3 + j) * 4 + q] = wt / sum; }); }));
    }
    return part;
  });
  // ボーン: 関節の位置(glTF の向き)と、親からの移動
  const skeleton = bones ? POLY_BONES.map(([bn, parent]) => { const at = toGl(joints[bn]), pa = parent ? toGl(joints[parent]) : [0, 0, 0]; return { name: bn, parent: parent ? BONE_IX[parent] : -1, at, t: sub(at, pa) }; }) : null;
  // 動き: 1周を N コマに分けて、最後に最初のコマをもう一度(くり返しがつながる)
  const animations = [];
  if (skeleton) {
    const hold = o.pose === 'hold' || (o.pose === 'stand' && o.item !== 'none');
    const free = { L: o.pose === 'stand' && !hold, R: o.pose !== 'hips' }; // ポーズで使っている腕(物を持つ・腰に手・上げた手)は振らない
    const leg = (joints['foot.L'][1] - joints['thigh.L'][1]) * k;
    for (const kind of anims) {
      const A = POLY_ANIMS[kind];
      if (!A) continue;
      const N = Math.max(12, Math.round(A.sec * 24)), times = new Float32Array(N + 1), frames = [];
      for (let i = 0; i <= N; i++) { times[i] = (i / N) * A.sec; frames.push(poseAt(kind, ((i % N) / N) * Math.PI * 2, leg, free)); }
      const channels = Object.keys(frames[0]).filter((n) => n !== 'hipsY').map((n) => ({ joint: BONE_IX[n], path: 'rotation', values: Float32Array.from(frames.flatMap((f) => f[n])) }));
      const hip = skeleton[BONE_IX.hips].t;
      channels.push({ joint: BONE_IX.hips, path: 'translation', values: Float32Array.from(frames.flatMap((f) => [hip[0], hip[1] + f.hipsY, hip[2]])) });
      animations.push({ name: A.label, kind, times, channels });
    }
  }
  return { parts, palette, grid: G, options: o, skeleton, animations, stats: { bones: skeleton ? skeleton.length : 0, animations: animations.map((a) => a.name), triangles: count, colors: palette.length, min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]], height } };
}

// ---- 小さな PNG(パレットの絵。圧縮なし。canvas を使わないので、どこでも同じ結果)----
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function palettePng(palette, G, cell = 4) {
  const W = G * cell, raw = new Uint8Array((W * 3 + 1) * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const hex = palette[Math.floor(y / cell) * G + Math.floor(x / cell)] || palette[palette.length - 1], q = y * (W * 3 + 1) + 1 + x * 3;
    raw[q] = parseInt(hex.slice(1, 3), 16); raw[q + 1] = parseInt(hex.slice(3, 5), 16); raw[q + 2] = parseInt(hex.slice(5, 7), 16);
  }
  // zlib(圧縮なしのブロック)
  const blocks = Math.ceil(raw.length / 65535), z = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  z[0] = 0x78; z[1] = 0x01;
  let q = 2, a = 1, b = 0;
  for (let i = 0; i < blocks; i++) {
    const part = raw.subarray(i * 65535, Math.min(raw.length, (i + 1) * 65535)), n = part.length;
    z[q++] = i === blocks - 1 ? 1 : 0; z[q++] = n & 255; z[q++] = n >>> 8; z[q++] = ~n & 255; z[q++] = (~n >>> 8) & 255;
    z.set(part, q); q += n;
  }
  for (let i = 0; i < raw.length; i++) { a = (a + raw[i]) % 65521; b = (b + a) % 65521; }
  z[q++] = b >>> 8; z[q++] = b & 255; z[q++] = a >>> 8; z[q++] = a & 255;
  const chunk = (type, data) => {
    const u = new Uint8Array(12 + data.length), dv = new DataView(u.buffer);
    dv.setUint32(0, data.length); for (let i = 0; i < 4; i++) u[4 + i] = type.charCodeAt(i); u.set(data, 8); dv.setUint32(8 + data.length, crc32(u.subarray(4, 8 + data.length)));
    return u;
  };
  const ihdr = new Uint8Array(13), hv = new DataView(ihdr.buffer);
  hv.setUint32(0, W); hv.setUint32(4, W); ihdr[8] = 8; ihdr[9] = 2;
  const sig = [137, 80, 78, 71, 13, 10, 26, 10], list = [new Uint8Array(sig), chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))];
  const png = new Uint8Array(list.reduce((s, u) => s + u.length, 0));
  let p = 0;
  for (const u of list) { png.set(u, p); p += u.length; }
  return png;
}

// ---- .glb(glTF 2.0 バイナリ)。体・顔・髪を別のメッシュにして、1つの親の下に ----
export function meshToGlb(mesh, { name = 'Kodai' } = {}) {
  const chunks = [], views = [], accessors = [];
  let off = 0;
  const add = (u8, target) => {
    const bytes = new Uint8Array(u8.buffer, u8.byteOffset, u8.byteLength), padLen = (4 - (bytes.length % 4)) % 4;
    views.push({ buffer: 0, byteOffset: off, byteLength: bytes.length, ...(target ? { target } : {}) });
    chunks.push(bytes);
    if (padLen) chunks.push(new Uint8Array(padLen));
    off += bytes.length + padLen;
    return views.length - 1;
  };
  const acc = (a) => { accessors.push(a); return accessors.length - 1; };
  const meshes = [], nodes = [{ name, children: [] }], scene = [0];
  let skins, jointNode = [];
  if (mesh.skeleton) {
    // 関節の節。親は「名前_ボーン」(Blender ではアーマチュアになる)。ボーン入りのメッシュは、いちばん上に置く(glTF の決まり)
    const first = nodes.length, ibm = new Float32Array(mesh.skeleton.length * 16);
    mesh.skeleton.forEach((j, i) => {
      nodes.push({ name: j.name, translation: j.t });
      ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -j.at[0], -j.at[1], -j.at[2], 1], i * 16); // 逆バインド行列 = 関節の位置の逆の移動
    });
    mesh.skeleton.forEach((j, i) => { if (j.parent >= 0) (nodes[first + j.parent].children ||= []).push(first + i); });
    nodes[0] = { name: name + '_ボーン', children: mesh.skeleton.map((j, i) => (j.parent < 0 ? first + i : -1)).filter((n) => n >= 0) };
    jointNode = mesh.skeleton.map((_, i) => first + i);
    skins = [{ name: name + '_skin', joints: mesh.skeleton.map((_, i) => first + i), inverseBindMatrices: acc({ bufferView: add(ibm), componentType: 5126, count: mesh.skeleton.length, type: 'MAT4' }) }];
  }
  for (const part of mesh.parts) {
    const n = part.positions.length / 3, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < part.positions.length; i++) { const a = i % 3, v = part.positions[i]; if (v < min[a]) min[a] = v; if (v > max[a]) max[a] = v; }
    const idx = n > 65535 ? Uint32Array.from({ length: n }, (_, i) => i) : Uint16Array.from({ length: n }, (_, i) => i);
    const attributes = {
      POSITION: acc({ bufferView: add(part.positions, 34962), componentType: 5126, count: n, type: 'VEC3', min, max }),
      NORMAL: acc({ bufferView: add(part.normals, 34962), componentType: 5126, count: n, type: 'VEC3' }),
      TEXCOORD_0: acc({ bufferView: add(part.uvs, 34962), componentType: 5126, count: n, type: 'VEC2' }),
    };
    const indices = acc({ bufferView: add(idx, 34963), componentType: idx instanceof Uint16Array ? 5123 : 5125, count: n, type: 'SCALAR' });
    if (skins) {
      attributes.JOINTS_0 = acc({ bufferView: add(part.joints, 34962), componentType: 5123, count: n, type: 'VEC4' });
      attributes.WEIGHTS_0 = acc({ bufferView: add(part.weights, 34962), componentType: 5126, count: n, type: 'VEC4' });
    }
    const label = PART_NAMES[part.name] || part.name;
    meshes.push({ name: label, primitives: [{ attributes, indices, material: 0 }] });
    if (skins) scene.push(nodes.length); else nodes[0].children.push(nodes.length);
    nodes.push({ name: label, mesh: meshes.length - 1, ...(skins ? { skin: 0 } : {}) });
  }
  const animations = (mesh.animations || []).map((a) => {
    const input = acc({ bufferView: add(a.times), componentType: 5126, count: a.times.length, type: 'SCALAR', min: [0], max: [a.times[a.times.length - 1]] });
    const samplers = [], channels = [];
    for (const ch of a.channels) {
      const type = ch.path === 'rotation' ? 'VEC4' : 'VEC3';
      samplers.push({ input, output: acc({ bufferView: add(ch.values), componentType: 5126, count: a.times.length, type }), interpolation: 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node: jointNode[ch.joint], path: ch.path } });
    }
    return { name: a.name, samplers, channels };
  });
  const vImg = add(palettePng(mesh.palette, mesh.grid));
  const json = {
    asset: { version: '2.0', generator: 'Kodai' },
    scene: 0, scenes: [{ nodes: scene }], nodes, meshes, ...(skins ? { skins } : {}), ...(animations.length ? { animations } : {}),
    materials: [{ name: name + '_色', doubleSided: true, pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 } }],
    textures: [{ sampler: 0, source: 0 }],
    samplers: [{ magFilter: 9728, minFilter: 9728, wrapS: 33071, wrapT: 33071 }],
    images: [{ bufferView: vImg, mimeType: 'image/png', name: name + '_パレット' }],
    accessors, bufferViews: views, buffers: [{ byteLength: off }],
  };
  let js = new TextEncoder().encode(JSON.stringify(json));
  const jpad = (4 - (js.length % 4)) % 4;
  if (jpad) { const t = new Uint8Array(js.length + jpad).fill(0x20); t.set(js); js = t; }
  const total = 12 + 8 + js.length + 8 + off;
  const glb = new Uint8Array(total), dv = new DataView(glb.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, js.length, true); dv.setUint32(16, 0x4e4f534a, true); glb.set(js, 20);
  let p = 20 + js.length;
  dv.setUint32(p, off, true); dv.setUint32(p + 4, 0x004e4942, true); p += 8;
  for (const c of chunks) { glb.set(c, p); p += c.byteLength; }
  return glb;
}

export function polyToGlb(opts, { name = 'Kodai', height = 1.7, bones = false, anims = [] } = {}) {
  const mesh = polyMesh(opts, { height, bones, anims });
  return { glb: meshToGlb(mesh, { name }), stats: mesh.stats };
}
