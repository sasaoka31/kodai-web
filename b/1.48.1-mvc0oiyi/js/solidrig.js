// パーツ(レイヤー)ごとのカード + ボーン + 動き を、Blender で動く形(.glb)にする
//   「3D だけど 2D の動き」= 紙の人形。レイヤー1枚 = 厚みのあるカード1枚を前後に重ねて、Kodai のボーンで動かす
//   buildRigged(doc, opts) → { parts, atlas, merged(プレビュー用に1つにまとめた立体), bones, anim, stats }
//   riggedToGlb(r) → Uint8Array
//
//   Kodai のリグ → glTF:
//   ・ボーン = 関節(joint)。付け根の位置に置き、ローカルの +Y がボーンの向き(Blender のボーンと同じ)
//   ・重み = Kodai の自動バインドと同じ式(距離 ÷ 太さ の4乗に反比例)。頂点ごとに大きい順に4本まで
//   ・ポーズ = 関節の 移動(親の中での位置 + dx, dy)・回転(z 軸まわり)・拡大(+Y 方向に len)。
//     Kodai の行列 M = 親 · 移動 · 付け根まわりの回転 · ボーン方向の伸び と同じ結果になる(スキンは 関節の行列 × 逆バインド行列)
//   ・動き = フレームごとのポーズを、フレームの時間どおりのキーにする(最後に最初のポーズをもう一度置いて、くり返しでつながる)
//   格子(スクワッシュ&ストレッチ)と、コマごとに描き分けた絵は入らない(今のフレームの絵を使う)
import { createCanvas } from './document.js';
import { timeline } from './document.js';
import { drawLayerWorld, celBounds } from './render.js';
import { estimateRadii, evalPose } from './rig.js';
import { buildSolid, bboxOf, SOLID_DEFAULTS } from './solid.js';

export const RIG_DEFAULTS = { ...SOLID_DEFAULTS, shape: 'card', cardDepth: 0.03, gap: 1, anim: true };

// レイヤーの「リグで動かす前の絵」を、region(ワールド)を k 倍した大きさで
function restImage(layer, cel, region, k) {
  const W = Math.max(1, Math.round(region.w * k)), H = Math.max(1, Math.round(region.h * k));
  const c = createCanvas(W, H), x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingEnabled = k < 1;
  x.setTransform(k, 0, 0, k, -region.x * k, -region.y * k);
  drawLayerWorld(x, layer, cel, null, { x0: region.x, y0: region.y, x1: region.x + region.w, y1: region.y + region.h });
  return x.getImageData(0, 0, W, H);
}

// 重みの関数 (x, y: ワールド) → [[ボーンの番号, 重み], …](大きい順に4つまで、合計 1)。rig.js の makeDeformer と同じ式
function weightFn(rig, bind, radii) {
  const bones = rig.bones;
  const index = new Map(bones.map((b, i) => [b.id, i]));
  if (bind.mode === 'bone') { const i = index.get(bind.boneId); return i === undefined ? null : () => [[i, 1]]; }
  let use = bones;
  if (bind.mode === 'chain') {
    const ids = new Set([bind.boneId]);
    for (let grew = true; grew;) { grew = false; for (const b of bones) if (b.parent && ids.has(b.parent) && !ids.has(b.id)) { ids.add(b.id); grew = true; } }
    use = bones.filter((b) => ids.has(b.id));
    if (!use.length) use = bones;
  }
  const list = use.map((b) => ({ b, i: index.get(b.id), r: radii?.get(b.id) || 0 }));
  return (x, y) => {
    const ws = [];
    for (const { b, i, r } of list) {
      const vx = b.tx - b.hx, vy = b.ty - b.hy, l2 = vx * vx + vy * vy || 1e-9;
      const t = ((x - b.hx) * vx + (y - b.hy) * vy) / l2, tc = Math.max(0, Math.min(1, t));
      const dist = Math.hypot(x - (b.hx + vx * tc), y - (b.hy + vy * tc));
      let d;
      if (r) { d = Math.max(0.02, dist / r); if (t < 0 && b.parent) d *= 2.5; } else d = Math.max(0.5, dist);
      ws.push([i, 1 / (d * d * d * d)]);
    }
    ws.sort((p, q) => q[1] - p[1]);
    const top = ws.slice(0, 4), sum = top.reduce((a, w) => a + w[1], 0) || 1;
    return top.map(([i, w]) => [i, w / sum]);
  };
}

export function buildRigged(doc, options = {}) {
  const o = { ...RIG_DEFAULTS, ...options };
  const frame = o.frame ?? timeline.frame;
  const rig = doc.rig, bones = rig?.bones || [];
  // 使うレイヤー(下から順)。絵のないものは除く
  const src = (o.layers || doc.layers.filter((l) => l.visible)).map((l) => ({ layer: l, cel: l.displayCelAt(frame) })).filter((p) => p.cel && celBounds(p.layer, p.cel));
  if (!src.length) throw new Error('絵のあるレイヤーがありません');
  // 全部のレイヤーが入る範囲
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of src) { const b = celBounds(p.layer, p.cel); x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); }
  const region = { x: Math.floor(x0), y: Math.floor(y0), w: Math.ceil(x1) - Math.floor(x0), h: Math.ceil(y1) - Math.floor(y0) };
  const k = Math.min(1, 1024 / Math.max(region.w, region.h));
  let top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity;
  for (const p of src) {
    p.img = restImage(p.layer, p.cel, region, k);
    p.box = bboxOf(p.img);
    if (!p.box) continue;
    top = Math.min(top, p.box.y); bottom = Math.max(bottom, p.box.y + p.box.h); left = Math.min(left, p.box.x); right = Math.max(right, p.box.x + p.box.w);
  }
  const use = src.filter((p) => p.box);
  if (!use.length) throw new Error('絵のあるレイヤーがありません');
  const unionH = bottom - top;
  const scale = o.height / unionH; // 絵(k 倍)の px → m
  const fr = { cx: (left + right) / 2, footY: bottom, scale };
  const cell = unionH / Math.round(Math.min(96, Math.max(12, o.res)));
  const depth = o.height * o.cardDepth * o.thick; // カード1枚の厚み(m)
  const step = depth * o.gap; // 重ねる間隔
  // ワールド → m
  const toM = (wx, wy) => [((wx - region.x) * k - fr.cx) * scale, (fr.footY - (wy - region.y) * k) * scale];

  // パーツごとのカード
  const parts = use.map((p, i) => {
    const solid = buildSolid({ front: p.img }, { ...o, shape: 'card', removeBg: 'off', cell, cardDepthPx: depth / scale, frame: fr, z0: (i - (use.length - 1) / 2) * step });
    // 重み: リグにつないであるレイヤーだけ(図形ごとのバインドは、レイヤーの自動バインドとして扱う)
    let bind = p.layer.rigBind;
    if (!bind && p.layer.rigged) bind = { mode: 'auto' };
    let joints = null, weights = null;
    if (bones.length && bind) {
      const d = p.img.data, W = p.img.width, H = p.img.height;
      const inside = (wx, wy) => { const x = Math.round((wx - region.x) * k), y = Math.round((wy - region.y) * k); return x >= 0 && y >= 0 && x < W && y < H && d[(y * W + x) * 4 + 3] >= 128; };
      const wf = weightFn(rig, bind, bind.mode === 'bone' ? null : estimateRadii(rig, inside));
      if (wf) {
        const n = solid.positions.length / 3;
        joints = new Uint16Array(n * 4); weights = new Float32Array(n * 4);
        for (let v = 0; v < n; v++) {
          const ws = wf(solid.restXY[v * 2] / k + region.x, solid.restXY[v * 2 + 1] / k + region.y);
          ws.forEach(([bi, w], e) => { joints[v * 4 + e] = bi; weights[v * 4 + e] = w; });
        }
      }
    }
    return { name: p.layer.name, layer: p.layer, solid, joints, weights };
  });

  // 貼る絵を1枚にまとめる(縦に並べる)。UV の v を詰め直す
  const AW = Math.max(...parts.map((p) => p.solid.atlas.width)), AH = parts.reduce((a, p) => a + p.solid.atlas.height, 0);
  const atlas = createCanvas(AW, AH), ax = atlas.getContext('2d');
  let ay = 0;
  for (const p of parts) {
    const a = p.solid.atlas, uv = p.solid.uvs;
    ax.drawImage(a, 0, ay);
    // 余った右側は、端の色を伸ばしておく
    if (a.width < AW) ax.drawImage(a, a.width - 1, 0, 1, a.height, a.width, ay, AW - a.width, a.height);
    for (let i = 0; i < uv.length; i += 2) { uv[i] = (uv[i] * a.width) / AW; uv[i + 1] = (ay + uv[i + 1] * a.height) / AH; }
    ay += a.height;
  }

  // プレビュー用に1つにまとめる
  const nV = parts.reduce((a, p) => a + p.solid.positions.length / 3, 0), nI = parts.reduce((a, p) => a + p.solid.indices.length, 0);
  const mp = new Float32Array(nV * 3), mu = new Float32Array(nV * 2), mn = new Float32Array(nV * 3), mi = new Uint32Array(nI);
  let vo = 0, io = 0;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    const s = p.solid;
    mp.set(s.positions, vo * 3); mu.set(s.uvs, vo * 2); mn.set(s.normals, vo * 3);
    for (let i = 0; i < s.indices.length; i++) mi[io + i] = s.indices[i] + vo;
    for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c], s.stats.min[c]); max[c] = Math.max(max[c], s.stats.max[c]); }
    vo += s.positions.length / 3; io += s.indices.length;
  }
  const merged = { positions: mp, uvs: mu, normals: mn, indices: mi, atlas, options: o, stats: { min, max } };

  // ボーン(関節)。θ = ローカルの +Y をボーンの向きに合わせる回転(z 軸まわり)
  const index = new Map(bones.map((b, i) => [b.id, i]));
  const J = bones.map((b) => {
    const [hx, hy] = toM(b.hx, b.hy), [tx, ty] = toM(b.tx, b.ty);
    return { id: b.id, name: b.name || b.id, parent: b.parent && index.has(b.parent) ? index.get(b.parent) : -1, h: [hx, hy], theta: Math.atan2(ty - hy, tx - hx) - Math.PI / 2, length: Math.hypot(tx - hx, ty - hy) };
  });
  // ポーズ → 関節のローカルの 移動・回転(角度)・拡大
  const sm = k * scale; // ワールドの長さ → m
  const localOf = (pose) => J.map((j) => {
    const p = pose?.bones?.[j.id] || {};
    const par = j.parent >= 0 ? J[j.parent] : null;
    // 親の中での位置(m)。dy は絵の下向きなので符号を逆に。回転も、y が上向きになるので逆
    let dx = j.h[0] - (par ? par.h[0] : 0) + (p.dx || 0) * sm, dy = j.h[1] - (par ? par.h[1] : 0) - (p.dy || 0) * sm;
    if (par) { const c = Math.cos(-par.theta), s = Math.sin(-par.theta); [dx, dy] = [dx * c - dy * s, dx * s + dy * c]; }
    return { t: [dx, dy, 0], angle: -(p.rot || 0) + j.theta - (par ? par.theta : 0), s: [1, p.len ?? 1, 1] };
  });
  const rest = localOf(null);
  // 動き: フレームごと。最後に最初のポーズ
  let anim = null;
  const hasPose = doc.frames.some((f) => f.pose);
  if (o.anim && bones.length && doc.frames.length > 1 && hasPose) {
    const times = [], keys = [];
    let t = 0;
    doc.frames.forEach((f, i) => { times.push(t / 1000); keys.push(localOf(evalPose(doc, i))); t += f.duration; });
    times.push(t / 1000); keys.push(keys[0]);
    anim = { times, keys };
  }
  return {
    parts, atlas, merged, bones: J, rest, anim, options: o,
    stats: { parts: parts.length, bones: J.length, skinned: parts.filter((p) => p.joints).length, frames: anim ? anim.times.length - 1 : 0, seconds: anim ? anim.times[anim.times.length - 1] : 0,
      vertices: nV, triangles: nI / 3, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]], min, max, texture: [AW, AH] },
  };
}

// ---- .glb ----

const quatZ = (a) => [0, 0, Math.sin(a / 2), Math.cos(a / 2)];

export async function riggedToGlb(r, { name = 'Kodai' } = {}) {
  const o = r.options;
  const png = new Uint8Array(await (await new Promise((res) => r.atlas.toBlob(res, 'image/png'))).arrayBuffer());
  const chunks = [], views = [], accessors = [];
  let off = 0;
  const view = (u8, target) => {
    const bytes = new Uint8Array(u8.buffer, u8.byteOffset, u8.byteLength), padLen = (4 - (bytes.length % 4)) % 4;
    views.push({ buffer: 0, byteOffset: off, byteLength: bytes.length, ...(target ? { target } : {}) });
    chunks.push(bytes); if (padLen) chunks.push(new Uint8Array(padLen));
    off += bytes.length + padLen;
    return views.length - 1;
  };
  const acc = (arr, type, componentType, extra = {}, target) => {
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
    accessors.push({ bufferView: view(arr, target), componentType, count: arr.length / n, type, ...extra });
    return accessors.length - 1;
  };
  const nodes = [], meshes = [];
  // 関節の節(node)
  const jointNode = r.bones.map((j, i) => {
    nodes.push({ name: j.name, translation: r.rest[i].t, rotation: quatZ(r.rest[i].angle), scale: [1, 1, 1] });
    return nodes.length - 1;
  });
  r.bones.forEach((j, i) => { if (j.parent >= 0) (nodes[jointNode[j.parent]].children ||= []).push(jointNode[i]); });
  const roots = r.bones.map((j, i) => (j.parent < 0 ? jointNode[i] : -1)).filter((n) => n >= 0);
  const scene = [];
  let skins;
  if (r.bones.length) {
    // 逆バインド行列 = (移動(付け根) · 回転(θ)) の逆 = 回転(−θ) · 移動(−付け根)。列優先
    const ibm = new Float32Array(r.bones.length * 16);
    r.bones.forEach((j, i) => {
      const c = Math.cos(-j.theta), s = Math.sin(-j.theta), tx = -(c * j.h[0] - s * j.h[1]), ty = -(s * j.h[0] + c * j.h[1]);
      ibm.set([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, tx, ty, 0, 1], i * 16);
    });
    // 関節をまとめる親(Blender ではアーマチュアになる)
    nodes.push({ name: name + '_rig', children: roots });
    scene.push(nodes.length - 1);
    skins = [{ name: name + '_skin', joints: jointNode, inverseBindMatrices: acc(ibm, 'MAT4', 5126) }];
  }
  for (const p of r.parts) {
    const s = p.solid, nVert = s.positions.length / 3;
    const idx = nVert > 65535 ? s.indices : new Uint16Array(s.indices);
    const attributes = { POSITION: acc(s.positions, 'VEC3', 5126, { min: s.stats.min, max: s.stats.max }, 34962), TEXCOORD_0: acc(s.uvs, 'VEC2', 5126, {}, 34962) };
    if (!o.flat) attributes.NORMAL = acc(s.normals, 'VEC3', 5126, {}, 34962);
    if (p.joints && skins) { attributes.JOINTS_0 = acc(p.joints, 'VEC4', 5123, {}, 34962); attributes.WEIGHTS_0 = acc(p.weights, 'VEC4', 5126, {}, 34962); }
    meshes.push({ name: p.name, primitives: [{ attributes, indices: acc(idx, 'SCALAR', idx instanceof Uint16Array ? 5123 : 5125, {}, 34963), material: 0 }] });
    nodes.push({ name: p.name, mesh: meshes.length - 1, ...(p.joints && skins ? { skin: 0 } : {}) });
    scene.push(nodes.length - 1);
  }
  let animations;
  if (r.anim && r.bones.length) {
    const { times, keys } = r.anim;
    const tAcc = acc(new Float32Array(times), 'SCALAR', 5126, { min: [times[0]], max: [times[times.length - 1]] });
    const samplers = [], channels = [];
    r.bones.forEach((j, i) => {
      const T = new Float32Array(times.length * 3), Q = new Float32Array(times.length * 4), S = new Float32Array(times.length * 3);
      keys.forEach((kf, f) => { T.set(kf[i].t, f * 3); Q.set(quatZ(kf[i].angle), f * 4); S.set(kf[i].s, f * 3); });
      for (const [path, arr, type] of [['translation', T, 'VEC3'], ['rotation', Q, 'VEC4'], ['scale', S, 'VEC3']]) {
        samplers.push({ input: tAcc, output: acc(arr, type, 5126), interpolation: 'LINEAR' });
        channels.push({ sampler: samplers.length - 1, target: { node: jointNode[i], path } });
      }
    });
    animations = [{ name: name + '_anim', samplers, channels }];
  }
  const vImg = view(png);
  const json = {
    asset: { version: '2.0', generator: 'Kodai' },
    scene: 0, scenes: [{ nodes: scene }], nodes, meshes,
    materials: [{ name: name + '_mat', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 } }],
    textures: [{ sampler: 0, source: 0 }],
    samplers: [{ magFilter: o.nearest ? 9728 : 9729, minFilter: o.nearest ? 9728 : 9987, wrapS: 33071, wrapT: 33071 }],
    images: [{ bufferView: vImg, mimeType: 'image/png', name: name + '_tex' }],
    accessors, bufferViews: views, buffers: [{ byteLength: off }],
    ...(skins ? { skins } : {}), ...(animations ? { animations } : {}),
  };
  let js = new TextEncoder().encode(JSON.stringify(json));
  const jpad = (4 - (js.length % 4)) % 4;
  if (jpad) { const t = new Uint8Array(js.length + jpad).fill(0x20); t.set(js); js = t; }
  const total = 12 + 8 + js.length + 8 + off;
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, js.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(js, 20);
  let p = 20 + js.length;
  dv.setUint32(p, off, true); dv.setUint32(p + 4, 0x004e4942, true); p += 8;
  for (const c of chunks) { out.set(c, p); p += c.byteLength; }
  return out;
}

// ---- 確認用: ポーズをかけた頂点の位置(スキンの計算を JS でやる。Kodai の変形と同じになるかのテスト・プレビュー用)----

// keyLocal = 関節ごとの { t, angle, s }(r.rest や r.anim.keys[f])。戻り値 = パーツごとの Float32Array(位置)
export function skinPositions(r, keyLocal) {
  // 関節のワールド行列(2D アフィン [a, b, c, d, e, f]: x' = a x + c y + e)
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  const local = (l) => { const c = Math.cos(l.angle), s = Math.sin(l.angle); return [c * l.s[0], s * l.s[0], -s * l.s[1], c * l.s[1], l.t[0], l.t[1]]; };
  const G = [];
  const g = (i) => { if (G[i]) return G[i]; const j = r.bones[i]; const m = j.parent >= 0 ? mul(g(j.parent), local(keyLocal[i])) : local(keyLocal[i]); G[i] = m; return m; };
  r.bones.forEach((_, i) => g(i));
  const M = r.bones.map((j, i) => { const c = Math.cos(-j.theta), s = Math.sin(-j.theta); return mul(G[i], [c, s, -s, c, -(c * j.h[0] - s * j.h[1]), -(s * j.h[0] + c * j.h[1])]); });
  return r.parts.map((p) => {
    const src = p.solid.positions, out = new Float32Array(src);
    if (!p.joints) return out;
    for (let v = 0; v < src.length / 3; v++) {
      const x = src[v * 3], y = src[v * 3 + 1];
      let sx = 0, sy = 0;
      for (let e = 0; e < 4; e++) { const w = p.weights[v * 4 + e]; if (!w) continue; const m = M[p.joints[v * 4 + e]]; sx += (m[0] * x + m[2] * y + m[4]) * w; sy += (m[1] * x + m[3] * y + m[5]) * w; }
      out[v * 3] = sx; out[v * 3 + 1] = sy;
    }
    return out;
  });
}
