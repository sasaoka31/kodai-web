// リグツール(R)
//   ボーン作成: ドラッグでボーンを引く。ボーンの先端から引くとつながった子ボーン、
//              ボーンを選んだまま離れた所から引くと、つながっていない子ボーン(肩から腕など)
//   ポーズ   : ボーンをドラッグで回転 / ルートボーンの付け根をドラッグで移動 / 格子の点をドラッグで伸縮
//              変更は現在のフレームのキーになり、キーの間は自動で補間される
//   格子     : ドラッグで格子の範囲を作る・動かす・大きさを変える
import { state, emit, requestRender, toast, isPixelMode } from './state.js';
import { timeline, isEmptyCel } from './document.js';
import {
  ROLES, PRESETS, bumpRig, boneMatrices, posedBone, latticeGrid, evalPose, guessRole,
  presetPoses, rigActive,
} from './rig.js';
import { rectGrid } from './warp.js';
import { snapshotRig, rigEntry, snapshotFrames, framesEntry } from './history.js';
import { celBounds, unionRect } from './render.js';
import { framesOp } from './timeline.js';
import { selectionLayer, selectedItems, modifySelection } from './select.js';
import { hasRigBind } from './render.js';
import { autoRigAction } from './autorig.js';

const zoom = () => state.view.zoom;
const S = (p) => state.view.toScreen(p);
export const rigMode = () => state.opts.rigMode;

let seq = 0;

// ---- 履歴 ----

function rigChange(label, fn) {
  const doc = state.doc;
  const before = snapshotRig(doc);
  if (fn(doc.rig) === false) return;
  commitRig(label, before);
}

function commitRig(label, before) {
  const doc = state.doc;
  bumpRig(doc.rig);
  state.history.push(rigEntry(label, doc, before, snapshotRig(doc), bumpRig));
  emit('rig');
  requestRender();
}

// ---- 幾何 ----

function distSeg(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const l2 = vx * vx + vy * vy || 1e-9;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2));
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
}

const snapPt = (ev) => (isPixelMode() ? { x: ev.px + 0.5, y: ev.py + 0.5 } : { x: ev.x, y: ev.y });

function currentPose() {
  return evalPose(state.doc, timeline.frame);
}

// ボーンの頭・先端(posed=true ならポーズ後の位置)
function bonePositions(posed) {
  const rig = state.doc.rig;
  if (!posed) return new Map(rig.bones.map((b) => [b.id, { h: { x: b.hx, y: b.hy }, t: { x: b.tx, y: b.ty } }]));
  const mats = boneMatrices(rig, currentPose());
  return new Map(rig.bones.map((b) => [b.id, posedBone(b, mats)]));
}

function hitBone(ev, pos) {
  const s = { x: ev.sx, y: ev.sy };
  const bones = state.doc.rig.bones;
  let best = null, bd = Infinity;
  for (const b of bones) {
    const p = pos.get(b.id);
    const dh = Math.hypot(S(p.h).x - s.x, S(p.h).y - s.y), dt = Math.hypot(S(p.t).x - s.x, S(p.t).y - s.y);
    if (dt <= 7 && dt < bd) { best = { bone: b, part: 'tail' }; bd = dt; }
    if (dh <= 7 && dh < bd) { best = { bone: b, part: 'head' }; bd = dh; }
  }
  if (best) return best;
  for (let i = bones.length - 1; i >= 0; i--) {
    const p = pos.get(bones[i].id);
    if (distSeg(s, S(p.h), S(p.t)) <= 6) return { bone: bones[i], part: 'body' };
  }
  return null;
}

function descendants(rig, id) {
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const b of rig.bones) if (b.parent === out[i]) out.push(b.id);
  return out;
}

function uniqueName(rig, role, self) {
  const base = role === 'other' ? 'ボーン' : ROLES[role];
  const taken = new Set(rig.bones.filter((b) => b !== self).map((b) => b.name));
  if (role !== 'other' && !taken.has(base)) return base;
  let n = 1;
  while (taken.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

// バインドしたレイヤー(無ければアクティブレイヤー)の絵の範囲
function fitRect() {
  const doc = state.doc;
  const targets = doc.layers.filter((l) => hasRigBind(l, l.displayCelAt(timeline.frame)));
  let r = null;
  for (const l of targets.length ? targets : [doc.activeLayer]) {
    const cel = l.displayCelAt(timeline.frame);
    if (cel) r = unionRect(r, celBounds(l, cel));
  }
  if (!r) return null;
  return { x: r.x0 - 1, y: r.y0 - 1, w: r.x1 - r.x0 + 2, h: r.y1 - r.y0 + 2 };
}

// ---- ツール本体 ----

export const rigTool = {
  cursor: 'crosshair',

  down(ev) {
    this.drag = null;
    const m = rigMode();
    if (m === 'bone') return this.boneDown(ev);
    if (m === 'pose') return this.poseDown(ev);
    return this.latticeDown(ev);
  },

  move(ev) {
    const d = this.drag;
    if (!d) return;
    if (d.kind.startsWith('pose')) this.poseMove(ev);
    else if (d.kind.startsWith('lat')) this.latticeMove(ev);
    else this.boneMove(ev);
    requestRender();
  },

  up() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const doc = state.doc;
    if (d.kind.startsWith('pose')) {
      state.rigDragging = false;
      state.history.push(framesEntry('ポーズを変更', doc, timeline, d.framesBefore, snapshotFrames(doc, timeline)));
      emit('frames');
      requestRender();
      return;
    }
    if (d.kind === 'create') {
      const b = d.bone;
      if (Math.hypot(b.tx - b.hx, b.ty - b.hy) * zoom() < 6) {
        doc.rig.bones.splice(doc.rig.bones.indexOf(b), 1);
        state.rigSel = b.parent;
        emit('rig');
        requestRender();
        return;
      }
      b.role = guessRole(doc.rig, b);
      b.name = uniqueName(doc.rig, b.role, b);
      commitRig('ボーンを追加', d.before);
      return;
    }
    // 位置が変わっていなければ(クリックして選んだだけなら)履歴に積まない
    if (JSON.stringify(d.before.rig) === JSON.stringify(doc.rig)) { emit('rig'); return; }
    commitRig(d.kind.startsWith('lat') ? '格子を変更' : 'ボーンを編集', d.before);
  },

  // -- ボーン作成モード --
  boneDown(ev) {
    const rig = state.doc.rig;
    const before = snapshotRig(state.doc);
    const pt = snapPt(ev);
    let h = hitBone(ev, bonePositions(false));
    // 先端からのドラッグは子ボーンの作成(先端そのものを動かすのは Shift+ドラッグ)
    if (h?.part === 'tail' && !ev.shift) h = null;
    // Alt+ドラッグは既存のボーンの上でも必ず新規作成(横向きキャラの手前/奥の手足を同じ位置に置くとき)
    if (ev.alt) h = null;
    if (h) {
      state.rigSel = h.bone.id;
      emit('rig');
      if (h.part === 'body') {
        const ids = new Set(descendants(rig, h.bone.id));
        const bones = rig.bones.filter((b) => ids.has(b.id));
        this.drag = { kind: 'moveBone', before, start: pt, bones, orig: bones.map((b) => ({ ...b })) };
      } else {
        const b = h.bone;
        // 先端を動かすときは、そこにつながっている子の付け根も一緒に動かす
        const kids = h.part === 'tail' ? rig.bones.filter((c) => c.parent === b.id && Math.hypot(c.hx - b.tx, c.hy - b.ty) < 0.01) : [];
        this.drag = { kind: h.part, before, bone: b, kids };
      }
      requestRender();
      return true;
    }
    // 新しいボーン
    const tol = 8 / zoom();
    let parent = null, head = pt;
    const near = [...rig.bones].reverse().find((b) => Math.hypot(b.tx - pt.x, b.ty - pt.y) <= tol);
    if (near) { parent = near.id; head = { x: near.tx, y: near.ty }; }
    else if (state.rigSel && rig.bones.some((b) => b.id === state.rigSel)) parent = state.rigSel;
    const b = {
      id: `b${Date.now().toString(36)}${++seq}`, name: '', parent,
      hx: head.x, hy: head.y, tx: head.x, ty: head.y, role: 'other',
    };
    rig.bones.push(b);
    state.rigSel = b.id;
    this.drag = { kind: 'create', before, bone: b };
    return true;
  },

  boneMove(ev) {
    const d = this.drag;
    const pt = snapPt(ev);
    if (d.kind === 'create' || d.kind === 'tail') {
      d.bone.tx = pt.x;
      d.bone.ty = pt.y;
      for (const c of d.kids || []) { c.hx = pt.x; c.hy = pt.y; }
    } else if (d.kind === 'head') {
      d.bone.hx = pt.x;
      d.bone.hy = pt.y;
    } else if (d.kind === 'moveBone') {
      const dx = pt.x - d.start.x, dy = pt.y - d.start.y;
      d.bones.forEach((b, i) => {
        const o = d.orig[i];
        b.hx = o.hx + dx; b.hy = o.hy + dy; b.tx = o.tx + dx; b.ty = o.ty + dy;
      });
    }
    bumpRig(state.doc.rig);
  },

  // -- ポーズモード --
  poseDown(ev) {
    const doc = state.doc, rig = doc.rig;
    if (!rigActive(doc)) { toast('先に「ボーン作成」でボーンを作るか、「格子」を有効にしてください'); return false; }
    if (!doc.layers.some((l) => hasRigBind(l, l.displayCelAt(timeline.frame)))) toast('リグにバインドしたレイヤー・図形がありません(ツールオプションの「バインド」で設定)');
    const pose0 = currentPose();
    const framesBefore = snapshotFrames(doc, timeline);
    const s = { x: ev.sx, y: ev.sy };
    const lat = latticeGrid(rig, pose0);
    if (lat) {
      const idx = lat.grid.pts.findIndex((p) => Math.hypot(S(p).x - s.x, S(p).y - s.y) <= 7);
      if (idx >= 0) {
        this.drag = { kind: 'poseLat', idx, start: { x: ev.x, y: ev.y }, pose0, n: lat.grid.pts.length, framesBefore };
        state.rigDragging = true;
        return true;
      }
    }
    const h = hitBone(ev, bonePositions(true));
    if (!h) return false;
    state.rigSel = h.bone.id;
    emit('rig');
    const cur = pose0.bones?.[h.bone.id] || {};
    const H = bonePositions(true).get(h.bone.id).h;
    state.rigDragging = true;
    if (ev.alt) {
      // Alt+ドラッグ: ボーンの向きに伸び縮み(付け根からの距離の比で)
      const d0 = Math.max(1e-3, Math.hypot(ev.x - H.x, ev.y - H.y));
      this.drag = { kind: 'poseLen', bone: h.bone, H, d0, len0: cur.len ?? 1, pose0, cur, framesBefore };
    } else if (!h.bone.parent && h.part === 'head') {
      this.drag = { kind: 'poseMove', bone: h.bone, start: { x: ev.x, y: ev.y }, pose0, cur, framesBefore };
    } else {
      this.drag = {
        kind: 'poseRot', bone: h.bone, H, a0: Math.atan2(ev.y - H.y, ev.x - H.x), rot0: cur.rot || 0, pose0, cur, framesBefore,
      };
    }
    return true;
  },

  poseMove(ev) {
    const d = this.drag;
    const doc = state.doc;
    const pose = structuredClone(d.pose0);
    pose.bones ||= {};
    if (d.kind === 'poseLat') {
      if (!pose.lattice || pose.lattice.length !== d.n) pose.lattice = Array.from({ length: d.n }, () => ({ x: 0, y: 0 }));
      let dx = ev.x - d.start.x, dy = ev.y - d.start.y;
      if (isPixelMode()) { dx = Math.round(dx); dy = Math.round(dy); }
      const o = d.pose0.lattice?.[d.idx] || { x: 0, y: 0 };
      pose.lattice[d.idx] = { x: o.x + dx, y: o.y + dy };
    } else if (d.kind === 'poseMove') {
      let dx = ev.x - d.start.x, dy = ev.y - d.start.y;
      if (isPixelMode()) { dx = Math.round(dx); dy = Math.round(dy); }
      pose.bones[d.bone.id] = { ...d.cur, rot: d.cur.rot || 0, dx: (d.cur.dx || 0) + dx, dy: (d.cur.dy || 0) + dy };
    } else if (d.kind === 'poseLen') {
      const len = Math.max(0.1, Math.min(4, d.len0 * Math.hypot(ev.x - d.H.x, ev.y - d.H.y) / d.d0));
      pose.bones[d.bone.id] = { rot: 0, dx: 0, dy: 0, ...d.cur, len };
    } else {
      // 少しずつ足していく(±180°をまたいでも値が飛ばないように)
      const a = Math.atan2(ev.y - d.H.y, ev.x - d.H.x);
      const da = a - (d.last ?? d.a0);
      d.total = (d.total || 0) + Math.atan2(Math.sin(da), Math.cos(da));
      d.last = a;
      let rot = d.rot0 + d.total;
      if (ev.shift) rot = Math.round(rot / (Math.PI / 12)) * (Math.PI / 12);
      pose.bones[d.bone.id] = { ...d.cur, rot, dx: d.cur.dx || 0, dy: d.cur.dy || 0 };
    }
    doc.frames[timeline.frame].pose = pose;
  },

  // -- 格子モード --
  latticeHandle(ev) {
    const L = state.doc.rig.lattice;
    if (!L.rect) return null;
    const r = L.rect, tol = 7 / zoom();
    const nl = Math.abs(ev.x - r.x) <= tol, nr = Math.abs(ev.x - (r.x + r.w)) <= tol;
    const nt = Math.abs(ev.y - r.y) <= tol, nb = Math.abs(ev.y - (r.y + r.h)) <= tol;
    const inX = ev.x > r.x - tol && ev.x < r.x + r.w + tol, inY = ev.y > r.y - tol && ev.y < r.y + r.h + tol;
    const h = { l: nl && inY, r: nr && inY, t: nt && inX, b: nb && inX };
    if (h.l || h.r || h.t || h.b) return h;
    if (ev.x > r.x && ev.x < r.x + r.w && ev.y > r.y && ev.y < r.y + r.h) return 'move';
    return null;
  },

  latticeDown(ev) {
    const doc = state.doc, L = doc.rig.lattice;
    const before = snapshotRig(doc);
    const h = this.latticeHandle(ev);
    const pt = snapPt(ev);
    if (h) {
      this.drag = { kind: 'latEdit', before, h, start: pt, orig: { ...L.rect } };
    } else {
      L.enabled = true;
      L.rect = { x: pt.x, y: pt.y, w: 1, h: 1 };
      this.drag = { kind: 'latEdit', before, h: { r: true, b: true }, start: pt, orig: { ...L.rect } };
    }
    return true;
  },

  latticeMove(ev) {
    const d = this.drag, L = state.doc.rig.lattice;
    const pt = snapPt(ev);
    const dx = pt.x - d.start.x, dy = pt.y - d.start.y;
    const o = d.orig;
    let { x, y, w, h } = o;
    if (d.h === 'move') { x += dx; y += dy; }
    else {
      if (d.h.l) { x = Math.min(o.x + o.w - 1, o.x + dx); w = o.x + o.w - x; }
      if (d.h.r) w = Math.max(1, o.w + dx);
      if (d.h.t) { y = Math.min(o.y + o.h - 1, o.y + dy); h = o.y + o.h - y; }
      if (d.h.b) h = Math.max(1, o.h + dy);
    }
    L.rect = { x, y, w, h };
    bumpRig(state.doc.rig);
  },
};

// ---- 操作 ----

export function deleteSelectedBone() {
  const id = state.rigSel;
  if (!id) return false;
  rigChange('ボーンを削除', (rig) => {
    const b = rig.bones.find((x) => x.id === id);
    if (!b) return false;
    for (const c of rig.bones) if (c.parent === id) c.parent = b.parent;
    rig.bones.splice(rig.bones.indexOf(b), 1);
    for (const l of state.doc.layers) {
      if (l.rigBind?.boneId !== id) continue;
      // 「○○から先」は親から先に付け替え、固定や親のないボーンは自動にする
      l.rigBind = l.rigBind.mode === 'chain' && b.parent ? { mode: 'chain', boneId: b.parent } : { mode: 'auto' };
    }
  });
  state.rigSel = null;
  emit('rig');
  return true;
}

function setKey(label, fn) {
  framesOp(label, (doc) => fn(doc.frames[timeline.frame]));
}

export function applyPreset(kind) {
  const doc = state.doc, rig = doc.rig;
  const P = PRESETS[kind];
  const needLattice = kind === 'bounce' || kind === 'idle';
  if (!needLattice && !rig.bones.some((b) => b.role === 'legL' || b.role === 'legR')) {
    toast(`「${P.label}」には役割が「左脚」か「右脚」のボーンが必要です`);
    return;
  }
  // 準備: バインドと格子
  const before = snapshotRig(doc);
  let changed = false;
  if (!doc.layers.some((l) => hasRigBind(l, l.displayCelAt(timeline.frame)))) {
    doc.activeLayer.rigBind = { mode: 'auto' };
    changed = true;
    toast(`「${doc.activeLayer.name}」をリグにバインドしました`);
  }
  if (needLattice && (!rig.lattice.enabled || !rig.lattice.rect)) {
    const r = fitRect();
    if (!r) {
      if (changed) { doc.activeLayer.rigBind = null; }
      toast('バインドしたレイヤーに絵がありません');
      return;
    }
    rig.lattice = { ...rig.lattice, enabled: true, rect: r };
    changed = true;
  }
  if (changed) commitRig('リグを準備', before);
  const res = presetPoses(rig, kind);
  if (res.error) { toast(res.error); return; }
  const n = res.poses.length;
  framesOp(`プリセット「${P.label}」`, (d) => {
    while (d.frames.length < n) d.frames.push({ duration: P.duration });
    // 余ったフレームに絵がなければ削除して、ちょうど1周のループにする
    const extraHasArt = d.layers.some((l) => l.cels.slice(n).some((c) => !isEmptyCel(c)));
    if (d.frames.length > n && !extraHasArt) {
      d.frames.splice(n);
      for (const l of d.layers) if (l.cels.length > n) l.cels.length = n;
      timeline.frame = Math.min(timeline.frame, n - 1);
    }
    d.frames.forEach((f, i) => {
      f.duration = P.duration;
      f.pose = res.poses[i % n];
    });
  });
  toast(`「${P.label}」を ${doc.frames.length} フレームに適用しました(Enter で再生)`);
}

// ---- ツールオプション ----

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) e[k] = v;
    else if (k === 'className') e.className = v;
    else e.setAttribute(k, v);
  }
  e.append(...kids);
  return e;
}

export function renderRigOptions(box) {
  const doc = state.doc, rig = doc.rig;
  const mode = rigMode();

  const seg = el('div', { className: 'mini-seg' });
  for (const [m, label] of [['bone', 'ボーン作成'], ['pose', 'ポーズ'], ['lattice', '格子']]) {
    seg.append(el('button', {
      className: mode === m ? 'on' : '',
      onclick: () => { state.opts.rigMode = m; emit('rig'); requestRender(); },
    }, label));
  }
  box.append(seg);
  // パーツ分けした絵(レイヤーごとに 頭・体・腕・脚)に、ボーンを自動で入れてつなぐ(autorig.js)
  box.append(el('button', {
    className: 'auto-rig',
    title: 'レイヤーの名前(頭・体・腕・脚など)と絵の位置から、ボーンを置いて各レイヤーをつなぎます。今あるボーンは置き換えます(Ctrl+Z で戻せます)',
    onclick: () => { if (autoRigAction()) { state.opts.rigMode = 'pose'; emit('rig'); requestRender(); } },
  }, rig.bones.length ? 'ボーンを自動で入れ直す' : 'ボーンを自動で入れる'));

  // バインド: 図形を選んでいればその図形だけ、なければレイヤー全体
  const layer = doc.activeLayer;
  const items = selectionLayer() === layer ? selectedItems() : [];
  const parse = (v) => {
    if (v === 'none') return null;
    if (v === 'auto') return { mode: 'auto' };
    const [mode, boneId] = v.split(':');
    return { mode, boneId };
  };
  const sel = el('select', {
    onchange: (e) => {
      const bind = parse(e.target.value);
      if (items.length) {
        modifySelection('図形のバインドを変更', (its) => {
          for (const it of its) {
            if (bind) it.shape.rigBind = { ...bind };
            else delete it.shape.rigBind;
          }
        });
      } else {
        rigChange('バインドを変更', () => { layer.rigBind = bind; });
      }
    },
  });
  sel.append(el('option', { value: 'none' }, 'なし'), el('option', { value: 'auto' }, '自動(全部のボーンの近さで変形)'));
  const chainGroup = el('optgroup', { label: 'このボーンから先だけで自動(手足をレイヤーで分けたとき)' });
  const fixGroup = el('optgroup', { label: 'このボーンに固定(曲がらない)' });
  for (const b of rig.bones) {
    chainGroup.append(el('option', { value: `chain:${b.id}` }, `「${b.name}」から先`));
    fixGroup.append(el('option', { value: `bone:${b.id}` }, `「${b.name}」に固定`));
  }
  if (rig.bones.length) sel.append(chainGroup, fixGroup);
  const bd = items.length ? items[0].shape.rigBind : layer.rigBind;
  sel.value = !bd ? 'none' : bd.mode === 'auto' ? 'auto' : `${bd.mode}:${bd.boneId}`;
  const target = items.length ? `選択中の図形 ${items.length}個` : `レイヤー「${layer.name}」`;
  box.append(el('label', { className: 'opt', title: '矢印ツールで図形を選んでおくと、その図形だけに設定できます' }, el('span', {}, `バインド(${target})`), sel));

  if (mode === 'bone') {
    const b = rig.bones.find((x) => x.id === state.rigSel);
    if (b) {
      const name = el('input', { type: 'text', value: b.name, className: 'name-input' });
      name.onchange = () => rigChange('ボーン名を変更', () => { b.name = name.value.trim() || b.name; });
      name.onkeydown = (e) => e.stopPropagation();
      const role = el('select', { onchange: (e) => rigChange('役割を変更', () => { b.role = e.target.value; }) });
      for (const [k, v] of Object.entries(ROLES)) role.append(el('option', { value: k }, v));
      role.value = b.role;
      box.append(
        el('label', { className: 'opt' }, el('span', {}, '名前'), name),
        el('label', { className: 'opt' }, el('span', {}, '役割'), role),
        el('button', { onclick: deleteSelectedBone, title: 'Delete' }, '削除'),
      );
    }
    box.append(el('span', { className: 'opt-hint' }, 'ドラッグでボーン作成 / 先端から引くとつながった子 / ボーンを選んで離れた所から引くと離れた子(肩→腕など)/ 付け根・胴体ドラッグで移動、Shift+先端で長さ変更 / Alt+ドラッグで重ねて作成'));
  } else if (mode === 'pose') {
    const presets = el('div', { className: 'group-inline', title: '「歩く」「走る」は横向きのキャラ向け。「弾む」「待機」は向きを問いません' },
      el('span', { className: 'opt-label' }, 'プリセット'));
    for (const [k, p] of Object.entries(PRESETS)) presets.append(el('button', { onclick: () => applyPreset(k) }, p.label));
    const facing = el('select', { onchange: (e) => rigChange('向きを変更', () => { rig.facing = Number(e.target.value); }) },
      el('option', { value: '1' }, '右向き'), el('option', { value: '-1' }, '左向き'));
    facing.value = String(rig.facing);
    presets.append(facing);
    const interp = el('select', { onchange: (e) => rigChange('補間を変更', () => { rig.interp = e.target.value; }) },
      el('option', { value: 'smooth' }, 'なめらか'), el('option', { value: 'linear' }, '一定の速さ'));
    interp.value = rig.interp;
    const hasKey = !!doc.frames[timeline.frame]?.pose;
    box.append(
      presets,
      el('label', { className: 'opt' }, el('span', {}, '補間'), interp),
      el('button', { onclick: () => setKey('キーを削除', (f) => { delete f.pose; }), title: 'このフレームのキーを削除' }, hasKey ? 'キー削除' : 'キーなし'),
      el('button', { onclick: () => setKey('ポーズをリセット', (f) => { f.pose = { bones: {} }; }) }, 'リセット'),
      el('span', { className: 'opt-hint' }, 'ボーンをドラッグで回転(Shift: 15°)/ Alt+ドラッグで伸び縮み / ルートの付け根で移動 / 格子の点で伸縮'),
    );
  } else {
    const L = rig.lattice;
    const num = (v, on) => {
      const i = el('input', { type: 'number', min: '1', max: '6', value: String(v), className: 'num' });
      i.onchange = () => on(Math.max(1, Math.min(6, Math.round(Number(i.value)) || 1)));
      return i;
    };
    const enabled = el('input', { type: 'checkbox' });
    enabled.checked = L.enabled;
    enabled.onchange = () => {
      const rect = L.rect || fitRect();
      if (enabled.checked && !rect) { toast('絵がありません'); enabled.checked = false; return; }
      rigChange(enabled.checked ? '格子を有効化' : '格子を無効化', (r) => {
        r.lattice.enabled = enabled.checked;
        r.lattice.rect = rect;
      });
    };
    box.append(
      el('label', { className: 'opt check' }, enabled, '格子を使う'),
      el('label', { className: 'opt' }, el('span', {}, '分割 横'), num(L.cols, (v) => rigChange('格子の分割を変更', (r) => { r.lattice.cols = v; })),
        el('span', {}, '縦'), num(L.rows, (v) => rigChange('格子の分割を変更', (r) => { r.lattice.rows = v; }))),
      el('button', {
        onclick: () => {
          const r = fitRect();
          if (!r) { toast('絵がありません'); return; }
          rigChange('格子を絵に合わせる', (rg) => { rg.lattice.rect = r; rg.lattice.enabled = true; });
        },
      }, '絵に合わせる'),
      el('span', { className: 'opt-hint' }, 'ドラッグで範囲を作成・移動・サイズ変更。点の移動は「ポーズ」モードで'),
    );
  }
}

// ---- 画面への表示 ----

const ROLE_COLORS = {
  body: '#f59e0b', head: '#a78bfa', armL: '#34d399', armR: '#10b981',
  legL: '#60a5fa', legR: '#3b82f6', tail: '#f472b6', other: '#e5e7eb',
};

export function drawRigOverlay(ctx) {
  if (state.tool !== 'rig' || !state.doc) return;
  const doc = state.doc, rig = doc.rig;
  const mode = rigMode();
  const posed = mode === 'pose';
  const pose = currentPose();

  // 格子
  const L = rig.lattice;
  if (L.enabled && L.rect) {
    const lat = posed ? latticeGrid(rig, pose) : { base: L.rect, grid: rectGrid(L.rect, L.cols, L.rows) };
    if (lat) {
      const { grid } = lat, n = grid.cols + 1;
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(244,114,182,0.9)';
      ctx.beginPath();
      for (let j = 0; j <= grid.rows; j++) {
        for (let i = 0; i <= grid.cols; i++) {
          const p = S(grid.pts[j * n + i]);
          if (i < grid.cols) { const q = S(grid.pts[j * n + i + 1]); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); }
          if (j < grid.rows) { const q = S(grid.pts[(j + 1) * n + i]); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); }
        }
      }
      ctx.stroke();
      if (posed || mode === 'lattice') {
        for (const p0 of grid.pts) {
          const p = S(p0);
          ctx.fillStyle = '#fff';
          ctx.strokeStyle = '#db2777';
          ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
      }
    }
  }

  // ボーン
  const pos = bonePositions(posed);
  for (const b of rig.bones) {
    const p = pos.get(b.id);
    const h = S(p.h), t = S(p.t);
    const len = Math.hypot(t.x - h.x, t.y - h.y);
    const sel = b.id === state.rigSel;
    // 親の先端から離れた子は点線でつなぐ
    if (b.parent && !posed) {
      const pp = pos.get(b.parent);
      if (pp && Math.hypot(pp.t.x - p.h.x, pp.t.y - p.h.y) > 0.01) {
        const a = S(pp.t);
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(h.x, h.y); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    if (len > 0.5) {
      const ux = (t.x - h.x) / len, uy = (t.y - h.y) / len;
      const w = Math.min(8, len * 0.18);
      const mx = h.x + ux * len * 0.2, my = h.y + uy * len * 0.2;
      ctx.beginPath();
      ctx.moveTo(h.x, h.y);
      ctx.lineTo(mx - uy * w, my + ux * w);
      ctx.lineTo(t.x, t.y);
      ctx.lineTo(mx + uy * w, my - ux * w);
      ctx.closePath();
      ctx.fillStyle = hexA(ROLE_COLORS[b.role] || '#e5e7eb', sel ? 0.75 : 0.45);
      ctx.fill();
      ctx.lineWidth = sel ? 2 : 1;
      ctx.strokeStyle = sel ? '#fb923c' : 'rgba(0,0,0,0.8)';
      ctx.stroke();
    }
    ctx.fillStyle = !b.parent ? '#fbbf24' : '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(h.x, h.y, !b.parent ? 5 : 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (sel || mode === 'bone') {
      ctx.font = '11px "Segoe UI", "Yu Gothic UI", sans-serif';
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.lineWidth = 3;
      ctx.strokeText(b.name, t.x + 6, t.y - 4);
      ctx.fillText(b.name, t.x + 6, t.y - 4);
    }
  }
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// 表示に元の形(レストポーズ)を使うか
const DRAW_TOOLS = new Set(['pen', 'eraser', 'fill', 'line', 'rect', 'ellipse', 'polygon', 'path', 'text', 'dot', 'move', 'transform']);

export function restDisplay(layer) {
  if (state.tool === 'rig') return rigMode() !== 'pose';
  return DRAW_TOOLS.has(state.tool) && layer === state.doc.activeLayer;
}
