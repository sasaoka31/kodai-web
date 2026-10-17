// リグ(コントロールポイント)システムの計算部分
//
//   ボーン   : 関節の回転(腕・脚・首など)。親子関係があり、親が回ると子もついてくる
//   格子     : キャラ全体にかぶせる制御点の格子。点を動かして伸縮(スクワッシュ&ストレッチ)
//   バインド : レイヤーをリグに紐付ける。auto=ボーンからの距離で重み付け / bone=1本のボーンに固定
//   ポーズ   : フレームごとのキー(doc.frames[i].pose)。キーの間のフレームは補間する
//
// 変形は「元の位置 → ボーンで動かす → 格子で伸縮」の順に、点ごとの関数として計算する。
// ラスターは細かい格子の頂点をこの関数で動かして warp.js で描き、ベクターは節点を直接動かす。
import { rectGrid, mapPoint } from './warp.js';

export const ROLES = {
  body: '体', head: '頭', armL: '左腕', armR: '右腕', legL: '左脚', legR: '右脚', tail: 'しっぽ', other: 'その他',
};

let rigVersion = 0;

export function newRig() {
  return {
    bones: [], // { id, name, parent, hx, hy, tx, ty, role }  (レストポーズでの頭と先端のワールド座標)
    lattice: { enabled: false, rect: null, cols: 2, rows: 2 },
    interp: 'smooth',
    facing: 1, // プリセットの向き 1=右向き / -1=左向き
    version: ++rigVersion,
  };
}

// リグの設定が変わったら呼ぶ(変形結果のキャッシュを無効にする)
export function bumpRig(rig) {
  rig.version = ++rigVersion;
}

export const REST = Object.freeze({ bones: {} });

export function rigActive(doc) {
  const r = doc.rig;
  return !!r && (r.bones.length > 0 || (r.lattice.enabled && !!r.lattice.rect));
}

// ---- 2D アフィン行列 [a,b,c,d,e,f]: x' = a x + c y + e, y' = b x + d y + f ----

const I = [1, 0, 0, 1, 0, 0];

function mul(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export const apply = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

function rotAbout(x, y, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, s, -s, c, x - c * x + s * y, y - s * x - c * y];
}

// ボーンの付け根を固定して、ボーンの向きにだけ k 倍する行列
function stretchAlong(b, k) {
  const vx = b.tx - b.hx, vy = b.ty - b.hy;
  const l = Math.hypot(vx, vy) || 1;
  const ux = vx / l, uy = vy / l, d = k - 1;
  const a = 1 + d * ux * ux, bb = d * ux * uy, dd = 1 + d * uy * uy;
  return [a, bb, bb, dd, b.hx - (a * b.hx + bb * b.hy), b.hy - (bb * b.hx + dd * b.hy)];
}

// 各ボーンの「レスト位置 → ポーズ後の位置」への変換行列
export function boneMatrices(rig, pose) {
  const byId = new Map(rig.bones.map((b) => [b.id, b]));
  const mats = new Map();
  const get = (b, depth = 0) => {
    if (mats.has(b.id)) return mats.get(b.id);
    const p = pose?.bones?.[b.id] || {};
    let m = rotAbout(b.hx, b.hy, p.rot || 0);
    // len: ボーンの向きに伸び縮み(1=そのまま)。足を上げる・腕を伸ばすなどに使う
    if (p.len !== undefined && p.len !== 1) m = mul(m, stretchAlong(b, p.len));
    if (p.dx || p.dy) m = mul([1, 0, 0, 1, p.dx || 0, p.dy || 0], m);
    const parent = b.parent && byId.get(b.parent);
    if (parent && depth < 64) m = mul(get(parent, depth + 1), m);
    mats.set(b.id, m);
    return m;
  };
  for (const b of rig.bones) get(b);
  return mats;
}

export function posedBone(b, mats) {
  const m = mats.get(b.id) || I;
  return { h: apply(m, b.hx, b.hy), t: apply(m, b.tx, b.ty) };
}

export const rootBone = (rig) => rig.bones.find((b) => !b.parent) || null;

// ポーズ後の格子 { base(レストの矩形・ルートの移動分ずらす), grid(動かした点) }
export function latticeGrid(rig, pose) {
  const L = rig.lattice;
  if (!L.enabled || !L.rect) return null;
  const r = rootBone(rig);
  const rp = r && pose?.bones?.[r.id];
  const base = { x: L.rect.x + (rp?.dx || 0), y: L.rect.y + (rp?.dy || 0), w: L.rect.w, h: L.rect.h };
  const grid = rectGrid(base, L.cols, L.rows);
  const offs = pose?.lattice;
  if (offs && offs.length === grid.pts.length) grid.pts = grid.pts.map((p, i) => ({ x: p.x + offs[i].x, y: p.y + offs[i].y }));
  return { base, grid };
}

export function poseIsRest(pose) {
  if (!pose) return true;
  for (const v of Object.values(pose.bones || {})) if (v.rot || v.dx || v.dy || (v.len !== undefined && v.len !== 1)) return false;
  if (pose.lattice && pose.lattice.some((o) => o.x || o.y)) return false;
  return true;
}

function segDist(px, py, b) {
  const vx = b.tx - b.hx, vy = b.ty - b.hy;
  const l2 = vx * vx + vy * vy || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - b.hx) * vx + (py - b.hy) * vy) / l2));
  return Math.hypot(px - (b.hx + vx * t), py - (b.hy + vy * t));
}

// 線分との距離と、線分上の位置 t(0=付け根, 1=先端, 0未満=付け根より後ろ)
function segDistT(px, py, b) {
  const vx = b.tx - b.hx, vy = b.ty - b.hy;
  const l2 = vx * vx + vy * vy || 1e-9;
  const t = ((px - b.hx) * vx + (py - b.hy) * vy) / l2;
  const tc = Math.max(0, Math.min(1, t));
  return { dist: Math.hypot(px - (b.hx + vx * tc), py - (b.hy + vy * tc)), t };
}

// 絵の中でのボーンの太さ(半径)を測る。inside(x,y) はその位置に絵があるか。
// ボーンの途中3か所から垂直方向に、絵が途切れるまでの距離を左右で平均する
export function estimateRadii(rig, inside) {
  const out = new Map();
  const vals = [];
  const median = (a) => a.slice().sort((p, q) => p - q)[a.length >> 1];
  for (const b of rig.bones) {
    const vx = b.tx - b.hx, vy = b.ty - b.hy;
    const len = Math.hypot(vx, vy) || 1;
    const nx = -vy / len, ny = vx / len;
    const samples = [];
    for (const t of [0.3, 0.5, 0.7]) {
      const px = b.hx + vx * t, py = b.hy + vy * t;
      if (!inside(px, py)) continue;
      let w = 0;
      for (const s of [1, -1]) {
        let k = 0;
        while (k < len * 2 && inside(px + nx * s * (k + 1), py + ny * s * (k + 1))) k++;
        w += k;
      }
      samples.push(w / 2 + 0.5);
    }
    if (samples.length) {
      const r = Math.max(1, median(samples));
      out.set(b.id, r);
      vals.push(r);
    }
  }
  // 絵の上にないボーンは、他のボーンの太さの中央値(無ければ長さの1/4)
  const fallback = vals.length ? median(vals) : null;
  for (const b of rig.bones) {
    if (!out.has(b.id)) out.set(b.id, fallback ?? Math.max(1, Math.hypot(b.tx - b.hx, b.ty - b.hy) / 4));
  }
  return out;
}

// 点を変形する関数 (x, y) => {x, y} を作る。変形がなければ null
// radii: estimateRadii の結果(自動バインドの重み付けに使う。省略時は距離だけで決める)
export function makeDeformer(doc, bind, pose, radii = null) {
  const rig = doc.rig;
  if (!bind || !rig || poseIsRest(pose)) return null;
  const bones = rig.bones;
  const lat = latticeGrid(rig, pose);
  if (!bones.length && !lat) return null;
  let skin;
  if (!bones.length) {
    skin = (x, y) => ({ x, y });
  } else {
    const mats = boneMatrices(rig, pose);
    if (bind.mode === 'bone') {
      const m = mats.get(bind.boneId) || I;
      skin = (x, y) => apply(m, x, y);
    } else {
      // ボーンに近いほど強く従う(距離の4乗に反比例)。関節付近は両方の中間になって自然に曲がる。
      // radii(絵から測ったボーンの太さ)があれば距離を太さで割る: 太い胴体は広い範囲を、細い腕は腕の上だけを受け持つ。
      // さらに、親を持つボーンの付け根より後ろ側(肩の内側など)は受け持ちを弱める。
      // chain: 指定したボーンとその子孫だけで重み付け(手前の脚・奥の脚をレイヤーで分けたとき用)
      let use = bones;
      if (bind.mode === 'chain') {
        const ids = new Set([bind.boneId]);
        for (let grew = true; grew;) {
          grew = false;
          for (const b of bones) if (b.parent && ids.has(b.parent) && !ids.has(b.id)) { ids.add(b.id); grew = true; }
        }
        use = bones.filter((b) => ids.has(b.id));
        if (!use.length) use = bones;
      }
      const list = use.map((b) => ({ b, m: mats.get(b.id), r: radii?.get(b.id) || 0 }));
      skin = (x, y) => {
        let sx = 0, sy = 0, sw = 0;
        for (const { b, m, r } of list) {
          let d;
          if (r) {
            const { dist, t } = segDistT(x, y, b);
            d = Math.max(0.02, dist / r);
            if (t < 0 && b.parent) d *= 2.5;
          } else {
            d = Math.max(0.5, segDist(x, y, b));
          }
          const w = 1 / (d * d * d * d);
          sx += (m[0] * x + m[2] * y + m[4]) * w;
          sy += (m[1] * x + m[3] * y + m[5]) * w;
          sw += w;
        }
        return { x: sx / sw, y: sy / sw };
      };
    }
  }
  if (!lat) return skin;
  return (x, y) => {
    const p = skin(x, y);
    return mapPoint(lat.grid, lat.base, p.x, p.y);
  };
}

// ---- キーフレームの補間 ----

function lerpPose(a, b, t) {
  const bones = {};
  const ids = new Set([...Object.keys(a.bones || {}), ...Object.keys(b.bones || {})]);
  for (const id of ids) {
    const p = a.bones?.[id] || {}, q = b.bones?.[id] || {};
    bones[id] = {
      rot: (p.rot || 0) + ((q.rot || 0) - (p.rot || 0)) * t,
      dx: (p.dx || 0) + ((q.dx || 0) - (p.dx || 0)) * t,
      dy: (p.dy || 0) + ((q.dy || 0) - (p.dy || 0)) * t,
      len: (p.len ?? 1) + ((q.len ?? 1) - (p.len ?? 1)) * t,
    };
  }
  let lattice;
  const la = a.lattice, lb = b.lattice;
  if (la || lb) {
    const n = (la || lb).length;
    lattice = [];
    for (let i = 0; i < n; i++) {
      const p = la?.[i] || { x: 0, y: 0 }, q = lb?.[i] || { x: 0, y: 0 };
      lattice.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    }
  }
  return lattice ? { bones, lattice } : { bones };
}

// frame 番目のフレームのポーズ(前後のキーから補間)
export function evalPose(doc, frame) {
  const fr = doc.frames;
  let a = -1, b = -1;
  for (let i = frame; i >= 0; i--) if (fr[i]?.pose) { a = i; break; }
  for (let i = frame; i < fr.length; i++) if (fr[i]?.pose) { b = i; break; }
  if (a < 0 && b < 0) return REST;
  if (a < 0) return fr[b].pose;
  if (b < 0 || a === b) return fr[a].pose;
  let t = (frame - a) / (b - a);
  if (doc.rig.interp === 'smooth') t = t * t * (3 - 2 * t);
  return lerpPose(fr[a].pose, fr[b].pose, t);
}

// ---- ボーンの役割を位置から推定 ----

export function guessRole(rig, b) {
  if (!b.parent) return 'body';
  const byId = new Map(rig.bones.map((x) => [x.id, x]));
  const parent = byId.get(b.parent);
  if (parent && parent.role !== 'body') return 'other'; // 手足の先(ひじ・ひざから先)
  const vx = b.tx - b.hx, vy = b.ty - b.hy;
  if (vy < -Math.abs(vx) * 0.5) return 'head';
  const root = rootBone(rig) || parent;
  const cx = (root.hx + root.tx) / 2;
  const side = b.tx < cx ? 'L' : 'R';
  const top = Math.min(root.hy, root.ty), bottom = Math.max(root.hy, root.ty);
  const isLeg = b.hy >= top + (bottom - top) * 0.7;
  if (!isLeg && vx !== 0 && Math.abs(vx) > Math.abs(vy) * 2 && b.hy > bottom) return 'tail';
  const kind = isLeg ? 'leg' : 'arm';
  // 横向きのキャラは左右の手足が同じ位置に重なるので、片側が埋まっていれば反対側にする
  const taken = (r) => rig.bones.some((x) => x !== b && x.role === r);
  if (taken(kind + side) && !taken(kind + (side === 'L' ? 'R' : 'L'))) return kind + (side === 'L' ? 'R' : 'L');
  return kind + side;
}

// ---- プリセットモーション ----

export const PRESETS = {
  walk: { label: '歩く(横)', frames: 8, duration: 100 },
  run: { label: '走る(横)', frames: 6, duration: 70 },
  walkFront: { label: '歩く(正面)', frames: 8, duration: 110 },
  runFront: { label: '走る(正面)', frames: 6, duration: 75 },
  bounce: { label: '弾む', frames: 8, duration: 80 },
  idle: { label: '待機(呼吸)', frames: 8, duration: 120 },
};

// 格子のレスト点を、下端中央を支点に (sx, sy) 倍して dy 動かしたときのずれ
function latticeOffsets(rig, sx, sy, dy) {
  const L = rig.lattice;
  const g = rectGrid(L.rect, L.cols, L.rows);
  const ax = L.rect.x + L.rect.w / 2, ay = L.rect.y + L.rect.h;
  return g.pts.map((p) => ({ x: ax + (p.x - ax) * sx - p.x, y: ay + (p.y - ay) * sy - p.y + dy }));
}

// kind のプリセットを n フレーム分のポーズ配列にする。{ poses } か { error }
export function presetPoses(rig, kind) {
  const P = PRESETS[kind];
  const n = P.frames;
  const role = (r) => rig.bones.find((b) => b.role === r) || null;
  const child = (b) => (b ? rig.bones.find((x) => x.parent === b.id) || null : null);
  const len = (b) => (b ? Math.hypot(b.tx - b.hx, b.ty - b.hy) : 0);
  // ボーンを回したとき先端が「前」(向いている方向)へ動く回転の符号
  const fwd = (b) => rig.facing * (Math.sign(-(b.ty - b.hy)) || 1);
  const poses = [];

  if (kind === 'walk' || kind === 'run') {
    const legL = role('legL'), legR = role('legR');
    if (!legL && !legR) return { error: '「左脚」か「右脚」の役割のボーンが必要です(ボーン作成モードで役割を設定できます)' };
    const armL = role('armL'), armR = role('armR'), head = role('head'), root = rootBone(rig);
    const run = kind === 'run';
    const A = run ? 0.8 : 0.45, B = run ? 0.7 : 0.35, K = run ? 1.0 : 0.5;
    const bob = Math.max(1, (len(legL || legR) + len(child(legL || legR))) * (run ? 0.12 : 0.06));
    for (let i = 0; i < n; i++) {
      const t = (2 * Math.PI * i) / n, s = Math.sin(t);
      const bones = {};
      const set = (b, rot, dx = 0, dy = 0) => { if (b) bones[b.id] = { rot, dx, dy }; };
      set(legL, A * s * (legL ? fwd(legL) : 0));
      set(legR, -A * s * (legR ? fwd(legR) : 0));
      // 後ろに残った脚のひざを曲げる
      const kl = child(legL), kr = child(legR);
      set(kl, kl ? -K * Math.max(0, -s) * fwd(kl) : 0);
      set(kr, kr ? -K * Math.max(0, s) * fwd(kr) : 0);
      set(armL, armL ? -B * s * fwd(armL) : 0);
      set(armR, armR ? B * s * fwd(armR) : 0);
      if (run) {
        const el = child(armL), er = child(armR);
        set(el, el ? 0.9 * fwd(el) : 0);
        set(er, er ? 0.9 * fwd(er) : 0);
      }
      set(head, 0.05 * Math.sin(2 * t));
      if (root) {
        // 脚がそろう瞬間に体が一番高くなる
        const lean = run ? 0.1 * fwd(root) : 0; // 走るときは前傾
        bones[root.id] = { rot: lean + 0.02 * Math.sin(2 * t), dx: 0, dy: -bob * (1 - Math.abs(s)) };
      }
      poses.push({ bones });
    }
    return { poses };
  }

  if (kind === 'walkFront' || kind === 'runFront') {
    // 正面向き: 脚を交互に持ち上げる(ボーンを縮めて足を上げる)+ 体の上下と左右の揺れ + 腕を小さく振る
    const legL = role('legL'), legR = role('legR');
    if (!legL && !legR) return { error: '「左脚」か「右脚」の役割のボーンが必要です(ボーン作成モードで役割を設定できます)' };
    const armL = role('armL'), armR = role('armR'), head = role('head'), root = rootBone(rig);
    const run = kind === 'runFront';
    const lift = run ? 0.35 : 0.2; // 脚の縮み(持ち上げ量)
    const B = run ? 0.3 : 0.12; // 腕の振り
    const legLen = len(legL || legR) + len(child(legL || legR));
    const bob = Math.max(1, legLen * (run ? 0.1 : 0.05));
    // 画面の左側にある手足は +回転で外側へ、右側は -回転で外側へ開く(下向きのボーン)
    const out = (b) => (b ? (b.tx < (root ? (root.hx + root.tx) / 2 : b.hx) ? 1 : -1) * (Math.sign(b.ty - b.hy) || 1) : 0);
    for (let i = 0; i < n; i++) {
      const t = (2 * Math.PI * i) / n, s = Math.sin(t);
      const upL = Math.max(0, s), upR = Math.max(0, -s);
      const bones = {};
      const set = (b, v) => { if (b) bones[b.id] = { rot: 0, dx: 0, dy: 0, len: 1, ...v }; };
      set(legL, { len: 1 - lift * upL, rot: 0.08 * upL * out(legL) });
      set(legR, { len: 1 - lift * upR, rot: 0.08 * upR * out(legR) });
      set(armL, { rot: (B * s + (run ? 0.15 : 0.04)) * out(armL) });
      set(armR, { rot: (-B * s + (run ? 0.15 : 0.04)) * out(armR) });
      if (run) {
        const el = child(armL), er = child(armR);
        set(el, { rot: -0.5 * out(el) });
        set(er, { rot: -0.5 * out(er) });
      }
      set(head, { rot: -0.03 * s });
      // 片足が上がるたびに体が少し上がり、立っている足の側へ傾く
      if (root) bones[root.id] = { rot: 0.035 * s, dx: 0, dy: -bob * Math.abs(s), len: 1 };
      poses.push({ bones });
    }
    return { poses };
  }

  if (!rig.lattice.enabled || !rig.lattice.rect) return { error: '格子が必要です' };
  const H = rig.lattice.rect.h;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    let sx, sy, dy = 0;
    const bones = {};
    if (kind === 'bounce') {
      // 着地でつぶれ、飛び上がりで縦に伸びる
      const v = Math.cos(Math.PI * t);
      sy = i === 0 ? 0.78 : 1 + 0.12 * Math.abs(v);
      sx = 1 / sy;
      dy = -H * 0.35 * Math.sin(Math.PI * t);
    } else {
      const s = Math.sin(2 * Math.PI * t);
      sy = 1 + 0.035 * s;
      sx = 1 - 0.02 * s;
      const head = role('head');
      if (head) bones[head.id] = { rot: 0.04 * s, dx: 0, dy: 0 };
    }
    poses.push({ bones, lattice: latticeOffsets(rig, sx, sy, dy) });
  }
  return { poses };
}
