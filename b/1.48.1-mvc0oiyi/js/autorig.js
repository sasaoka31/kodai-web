// ボーンを自動で入れる(パーツ分けした絵 = レイヤーごとに 頭・体・腕・脚 などが分かれている絵)
//   planAutoRig(doc) … レイヤーの名前と絵の位置から、どこにボーンを置いて、どのレイヤーをどのボーンにつなぐかを決める(変更はしない)
//   autoRig()        … それを今の絵に入れる(履歴つき。今あるボーンは置き換える)
//   分け方: まずレイヤーの名前(頭・顔 / 体・胴 / 腕・手 / 脚・足 / しっぽ、左・右)。名前で分からないレイヤーは位置から
//           (一番上 = 頭、下のほう = 脚、体の左右 = 腕、残りで一番大きい = 体)。髪・角・耳・目などは頭のボーンにつなぐ
//   置き方: 体 = 下 → 上、頭 = 首 → 頭の上、腕・脚・しっぽ = 絵の長い向きの両端のうち、体に近いほうが付け根
//   つなぎ方はどれも「ボーンに固定」(紙の人形のように、パーツの形は変えずに回す)
import { state, emit, requestRender, toast } from './state.js';
import { timeline, createCanvas, uid } from './document.js';
import { drawLayerWorld, celBounds } from './render.js';
import { bumpRig, ROLES } from './rig.js';
import { snapshotRig, rigEntry } from './history.js';

const RE = {
  tail: /しっぽ|尻尾|尾|tail/i,
  arm: /腕|うで|arm|手|hand|袖/i,
  leg: /脚|足|あし|leg|foot|feet|靴/i,
  head: /頭|顔|かお|あたま|head|face/i,
  onHead: /髪|かみ|hair|角|つの|horn|耳|みみ|ear|帽|hat|目|眉|口|鼻|eye|brow|mouth|nose/i,
  body: /体|胴|からだ|body|torso|胸|腰|服/i,
};
const sideOf = (name) => (/左|ひだり|left|(^|[^a-z])l($|[^a-z])/i.test(name) ? 'L' : /右|みぎ|right|(^|[^a-z])r($|[^a-z])/i.test(name) ? 'R' : null);

// レイヤーの絵の形: 枠(外れ値を除く)・重心・長い向きの両端
function measure(layer, cel) {
  const b = celBounds(layer, cel);
  if (!b || b.x1 <= b.x0 || b.y1 <= b.y0) return null;
  const w = b.x1 - b.x0, h = b.y1 - b.y0, k = Math.min(1, 160 / Math.max(w, h));
  const W = Math.max(1, Math.round(w * k)), H = Math.max(1, Math.round(h * k));
  const c = createCanvas(W, H), x = c.getContext('2d', { willReadFrequently: true });
  x.setTransform(k, 0, 0, k, -b.x0 * k, -b.y0 * k);
  drawLayerWorld(x, layer, cel, null, b);
  const d = x.getImageData(0, 0, W, H).data;
  const xs = [], ys = [];
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) if (d[(py * W + px) * 4 + 3] >= 128) { xs.push(b.x0 + (px + 0.5) / k); ys.push(b.y0 + (py + 0.5) / k); }
  const n = xs.length;
  if (n < 4) return null;
  const pct = (a, q) => { const s = Float64Array.from(a).sort(); return s[Math.min(n - 1, Math.max(0, Math.round(q * (n - 1))))]; };
  const cx = xs.reduce((a, v) => a + v, 0) / n, cy = ys.reduce((a, v) => a + v, 0) / n;
  // 長い向き(主成分)
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - cx, dy = ys[i] - cy; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(ang), uy = Math.sin(ang);
  const proj = xs.map((v, i) => (v - cx) * ux + (ys[i] - cy) * uy);
  const p0 = pct(proj, 0.03), p1 = pct(proj, 0.97);
  return {
    x0: pct(xs, 0.02), x1: pct(xs, 0.98), y0: pct(ys, 0.02), y1: pct(ys, 0.98), cx, cy, area: n / (k * k),
    ends: [[cx + ux * p0, cy + uy * p0], [cx + ux * p1, cy + uy * p1]],
  };
}

export function planAutoRig(doc, frame = timeline.frame) {
  const parts = [];
  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    const cel = layer.displayCelAt(frame);
    const m = cel && measure(layer, cel);
    if (!m) continue;
    const name = layer.name;
    let kind = null;
    for (const k of ['tail', 'arm', 'leg', 'head', 'onHead', 'body']) if (RE[k].test(name)) { kind = k; break; }
    parts.push({ layer, m, kind, side: sideOf(name), named: !!kind });
  }
  if (parts.length < 2) throw new Error('パーツが分かれていません。頭・体・腕・脚などを別々のレイヤーにしてから使ってください(1枚絵は「画像読込 → パーツに分ける」)');

  // 名前で体が分からないときは、名前のないレイヤーを位置から決める
  const unnamed = () => parts.filter((p) => !p.kind);
  if (!parts.some((p) => p.kind === 'body') && unnamed().length) {
    const all = parts.map((p) => p.m);
    const top = Math.min(...all.map((m) => m.y0)), bottom = Math.max(...all.map((m) => m.y1)), H = bottom - top || 1;
    if (!parts.some((p) => p.kind === 'head')) { const u = unnamed().sort((a, b) => a.m.cy - b.m.cy)[0]; if (u && u.m.cy < top + H * 0.45 && unnamed().length > 1) u.kind = 'head'; }
    for (const u of unnamed()) if (u.m.cy > top + H * 0.78 && u.m.area < 0.25 * Math.max(...all.map((m) => m.area))) u.kind = 'leg';
    const rest = unnamed().sort((a, b) => b.m.area - a.m.area);
    if (rest[0]) rest[0].kind = 'body';
  }
  const body = parts.filter((p) => p.kind === 'body').sort((a, b) => b.m.area - a.m.area)[0];
  if (!body) throw new Error('体のレイヤーが分かりません。レイヤーの名前に「体」(または 胴・body)を入れてください');
  const B = body.m, bh = B.y1 - B.y0;
  // 体の左右にある、名前のないレイヤーは腕
  for (const u of unnamed()) if ((u.m.cx < B.x0 + (B.x1 - B.x0) * 0.15 || u.m.cx > B.x1 - (B.x1 - B.x0) * 0.15) && u.m.cy > B.y0 && u.m.cy < B.y1) u.kind = 'arm';
  // 左右: 名前になければ、体の中心より左にあるほうが「左」(見たままの左)
  for (const p of parts) if ((p.kind === 'arm' || p.kind === 'leg') && !p.side) p.side = p.m.cx < B.cx ? 'L' : 'R';

  const bones = [], binds = [];
  const add = (role, name, h, t, parent) => {
    // 短すぎるボーンは少し伸ばす
    let [hx, hy] = h, [tx, ty] = t;
    if (Math.hypot(tx - hx, ty - hy) < 4) { ty = hy - 4; tx = hx; }
    bones.push({ name, role, parent, hx: Math.round(hx * 10) / 10, hy: Math.round(hy * 10) / 10, tx: Math.round(tx * 10) / 10, ty: Math.round(ty * 10) / 10 });
    return name;
  };
  const bodyBone = add('body', ROLES.body, [B.cx, B.y1 - bh * 0.04], [B.cx, B.y0 + bh * 0.12], null);
  for (const p of parts.filter((q) => q.kind === 'body')) binds.push({ layer: p.layer, bone: bodyBone });
  // 頭
  let headBone = null, neckY = B.y0;
  const head = parts.filter((p) => p.kind === 'head').sort((a, b) => b.m.area - a.m.area)[0];
  if (head) {
    const M = head.m, hh = M.y1 - M.y0;
    neckY = M.y1 - hh * 0.06;
    headBone = add('head', ROLES.head, [(M.cx + B.cx) / 2, neckY], [M.cx, M.y0 + hh * 0.2], bodyBone);
    for (const p of parts.filter((q) => q.kind === 'head')) binds.push({ layer: p.layer, bone: headBone });
  }
  // 腕・脚・しっぽ: 同じ種類・同じ側のレイヤーはまとめて1本
  const limb = (kind, side, role, anchor) => {
    const group = parts.filter((p) => p.kind === kind && (side ? p.side === side : true));
    if (!group.length) return;
    // 全部のレイヤーの両端のうち、体の付け根に一番近い点が付け根、そこから一番遠い点が先端
    const pts = group.flatMap((p) => p.m.ends);
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const root = pts.slice().sort((a, b) => d(a, anchor) - d(b, anchor))[0];
    const tip = pts.slice().sort((a, b) => d(b, root) - d(a, root))[0];
    const name = add(role, ROLES[role], root, tip, bodyBone);
    for (const p of group) binds.push({ layer: p.layer, bone: name });
  };
  limb('arm', 'L', 'armL', [B.x0, B.y0 + bh * 0.15]);
  limb('arm', 'R', 'armR', [B.x1, B.y0 + bh * 0.15]);
  limb('leg', 'L', 'legL', [B.cx - (B.x1 - B.x0) * 0.2, B.y1 - bh * 0.1]);
  limb('leg', 'R', 'legR', [B.cx + (B.x1 - B.x0) * 0.2, B.y1 - bh * 0.1]);
  limb('tail', null, 'tail', [B.cx, B.y1 - bh * 0.2]);
  // 髪・角・耳・顔のパーツは頭に。残りは、首より上なら頭、それ以外は体に
  for (const p of parts) {
    if (binds.some((b) => b.layer === p.layer)) continue;
    const toHead = headBone && (p.kind === 'onHead' || p.m.cy < neckY);
    binds.push({ layer: p.layer, bone: toHead ? headBone : bodyBone });
  }
  return { bones, binds, guessed: parts.filter((p) => !p.named).map((p) => p.layer.name) };
}

// 今の絵に入れる。戻り値 { bones: [名前], binds: [[レイヤー名, ボーン名]], guessed }
export function autoRig() {
  const doc = state.doc;
  const plan = planAutoRig(doc);
  const before = snapshotRig(doc);
  const ids = new Map(plan.bones.map((b) => [b.name, uid('b')]));
  doc.rig.bones = plan.bones.map((b) => ({ id: ids.get(b.name), name: b.name, parent: b.parent ? ids.get(b.parent) : null, hx: b.hx, hy: b.hy, tx: b.tx, ty: b.ty, role: b.role }));
  for (const l of doc.layers) l.rigBind = null;
  for (const b of plan.binds) b.layer.rigBind = { mode: 'bone', boneId: ids.get(b.bone) };
  bumpRig(doc.rig);
  state.history.push(rigEntry('ボーンを自動で入れる', doc, before, snapshotRig(doc), bumpRig));
  emit('rig'); emit('layers');
  requestRender();
  return { bones: plan.bones.map((b) => b.name), binds: plan.binds.map((b) => [b.layer.name, b.bone]), guessed: plan.guessed };
}

// ボタンから: 入れて、結果を知らせる
export function autoRigAction() {
  try {
    const r = autoRig();
    toast(`ボーンを ${r.bones.length}本入れて、レイヤー ${r.binds.length}枚をつなぎました(${r.bones.join('・')})。「歩く」などの動きを押すと動きます`);
    return r;
  } catch (err) { toast(err.message); return null; }
}
