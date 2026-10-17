// 「線と塗り」パネル(右サイドバー)
//   図形を選んでいるとき : 選んだ図形の線の色・塗りの色・線幅を表示し、その場で変更できる(グループの中まで)
//   選んでいないとき     : これから描く図形の設定(線 = メインカラー、塗り = サブカラー、線幅)
//   図形を選んでいるときは、塗り・線それぞれを 単色 / 線形 / 円形 のグラデーションにできる(色の点・角度・中心・大きさ)
//   塗り・線の行をクリックすると、その行が「パレット・最近使った色をクリックしたときに変わる方」になる(既定は塗り)
//   選んだ図形の色・線幅を変えると、次に作る図形もその色になる(adoptStyle: 線 = メイン色、塗り = サブ色、グラデーションも)
//   スポイトのボタン: キャンバスの色をクリックで拾う(tools.js の eyedropper。拡大鏡つき)
//   ボタン: 線と塗りの入れ替え / パスのアウトライン化 / 縁取りを作成
import { startPick, PICK_ICON } from './tools.js';
import { state, on, emit, requestRender, toast, modeKey } from './state.js';
import { toHex, toHex8, toCss, parseHex, clamp } from './color.js';
import { selectedItems, selectionLayer, eachLeaf, modifySelection } from './select.js';
import { pushVector } from './tools.js';
import { hasStroke } from './vector.js';
import { outlineSelection, borderDialog } from './outline.js';
import { useColor } from './recent.js';
import { GRAD_TYPES, defaultGradient, gradientCss, colorAt } from './gradient.js';

const $ = (id) => document.getElementById(id);
const MIXED = Symbol('mixed');

export function initPaintPanel() {
  for (const e of ['selection', 'colors', 'history', 'doc', 'tool', 'layers', 'frame']) on(e, renderPaint);
  // 確定イベントが来ないまま他の場所を触ったときの保険
  document.addEventListener('pointerdown', (e) => {
    if (e.target.closest?.('#paint-panel')) return;
    editing = false;
    if (live) commitLive();
  }, true);
}

// 選択中の図形(グループの中まで)の値。全部同じならその値、違えば MIXED
function leafValue(items, get, filter = () => true) {
  const vals = [];
  eachLeaf(items, (s) => { if (filter(s)) vals.push(get(s)); });
  if (!vals.length) return undefined;
  return vals.every((v) => v === vals[0]) ? vals[0] : MIXED;
}

function currentStyle() {
  const items = selectedItems();
  if (items.length) {
    return {
      items,
      stroke: leafValue(items, (s) => (hasStroke(s) ? s.stroke : null)),
      fill: leafValue(items, (s) => s.fill || null, (s) => s.type !== 'line'),
      width: leafValue(items, (s) => s.strokeWidth || 0, hasStroke),
    };
  }
  const o = state.opts;
  return {
    items,
    stroke: o.shapeStroke ? toHex8(state.primary) : null,
    fill: o.shapeFill ? toHex8(state.secondary) : null,
    width: o.strokeWidth[modeKey()],
  };
}

// ---- 選択中の図形への反映(ドラッグ中の色変更などは、確定時に1つの履歴にまとめる) ----

let live = null;
let editing = false; // 色・線幅をドラッグ中はパネルを作り直さない(カラーピッカーが閉じてしまうため)

function applyLive(label, fn) {
  const layer = selectionLayer();
  if (!layer) return;
  if (layer.locked) { toast('レイヤーがロックされています'); return; }
  if (!live || live.layer !== layer) live = { layer, label, before: structuredClone(layer.shapes) };
  eachLeaf(selectedItems(), fn);
  layer.touch();
  requestRender();
}

function commitLive() {
  if (!live) return;
  const { layer, label, before } = live;
  live = null;
  pushVector(label, layer, before);
  adoptStyle();
  emit('selection');
}

// ---- 次に作る図形の色(選んだ図形の色を引き継ぐ)----
export function adoptStyle() {
  let s = null;
  eachLeaf(selectedItems(), (x) => { if (!s && x.type !== 'text' && x.type !== 'group') s = x; });
  if (!s) return;
  const o = state.opts;
  const grad = {};
  if (s.type !== 'line') {
    o.shapeFill = !!s.fill;
    if (s.fill) { state.secondary = parseHex(s.fill); if (s.fillGrad) grad.fill = { grad: structuredClone(s.fillGrad), color: toHex8(state.secondary) }; }
  }
  const hasLine = !!s.stroke && s.strokeWidth > 0;
  if (s.type !== 'line') o.shapeStroke = hasLine;
  if (hasLine) {
    state.primary = parseHex(s.stroke);
    o.strokeWidth[modeKey()] = s.strokeWidth;
    if (s.strokeGrad) grad.stroke = { grad: structuredClone(s.strokeGrad), color: toHex8(state.primary) };
  }
  o.nextGrad = grad;
  emit('colors');
}

// パレット・最近使った色をクリックしたとき: 図形を選んでいれば、選んでいる行(塗り / 線)の色をすぐ変える。
// other = true(右クリック)なら反対の方。図形を選んでいなければ false(今までどおりメイン / サブの色)
let paintTarget = 'fill';
export const getPaintTarget = () => paintTarget;
export function applySwatch(hex, other = false) {
  if (!selectedItems().length) return false;
  const kind = other ? (paintTarget === 'fill' ? 'stroke' : 'fill') : paintTarget;
  setColor(kind, hex.slice(0, 7), true);
  return true;
}

// スポイトで拾った色を、選んでいる図形の塗り / 線に(図形がなければメイン / サブの色)
export function applyPicked(kind, hex6) {
  if (selectedItems().length) { setColor(kind, hex6, true); return; }
  const key = kind === 'fill' ? 'secondary' : 'primary';
  state[key] = { ...parseHex(hex6), a: state[key].a };
  emit('colors');
}

// 色の入力 → #rrggbbaa(今の不透明度を保つ)
function withAlpha(hex6, prev) {
  const a = prev && prev !== MIXED ? parseHex(prev).a : 255;
  return toHex8({ ...parseHex(hex6), a });
}

function setColor(kind, hex6, commit) {
  editing = !commit;
  if (commit) useColor(hex6);
  const st = currentStyle();
  if (st.items.length) {
    const prev = st[kind];
    applyLive(kind === 'fill' ? '塗りの色' : '線の色', (s) => {
      // 単色を選んだらグラデーションはやめる(イラレのスウォッチと同じ)
      if (kind === 'fill') {
        if (s.type !== 'line') { s.fill = withAlpha(hex6, s.fill || prev); delete s.fillGrad; }
      } else {
        s.stroke = withAlpha(hex6, s.stroke || prev);
        delete s.strokeGrad;
        if (!(s.strokeWidth > 0)) s.strokeWidth = state.opts.strokeWidth[modeKey()];
      }
    });
    if (commit) { commitLive(); renderPaint(); }
    return;
  }
  // 新しい図形の設定: 線 = メインカラー、塗り = サブカラー
  const key = kind === 'fill' ? 'secondary' : 'primary';
  state[key] = { ...parseHex(hex6), a: state[key].a };
  if (kind === 'fill') state.opts.shapeFill = true;
  else state.opts.shapeStroke = true;
  emit('colors');
  if (commit) { emit('tool'); renderPaint(); }
}

function setNone(kind) {
  const st = currentStyle();
  if (st.items.length) {
    modifySelection(kind === 'fill' ? '塗りなし' : '線なし', (its) => eachLeaf(its, (s) => {
      if (kind === 'fill') { s.fill = null; delete s.fillGrad; } else { s.stroke = null; delete s.strokeGrad; }
    }));
    adoptStyle();
    return;
  }
  if (kind === 'fill') state.opts.shapeFill = !state.opts.shapeFill;
  else state.opts.shapeStroke = !state.opts.shapeStroke;
  emit('tool');
  renderPaint();
}

function setWidth(v, commit) {
  editing = !commit;
  const st = currentStyle();
  if (st.items.length) {
    applyLive('線幅', (s) => { if (s.stroke) s.strokeWidth = v; });
    if (commit) { commitLive(); renderPaint(); }
    return;
  }
  state.opts.strokeWidth[modeKey()] = v;
  if (commit) { emit('tool'); renderPaint(); }
}

export function swapStrokeFill() {
  const items = selectedItems();
  if (!items.length) {
    [state.primary, state.secondary] = [state.secondary, state.primary];
    emit('colors');
    return;
  }
  modifySelection('線と塗りを入れ替え', (its) => eachLeaf(its, (s) => {
    if (s.type === 'line') return;
    [s.stroke, s.fill] = [s.fill || null, s.stroke || null];
    const fg = s.fillGrad, sg = s.strokeGrad;
    delete s.fillGrad; delete s.strokeGrad;
    if (fg && s.stroke) s.strokeGrad = fg;
    if (sg && s.fill) s.fillGrad = sg;
    if (s.stroke && !(s.strokeWidth > 0)) s.strokeWidth = state.opts.strokeWidth[modeKey()];
  }));
  adoptStyle();
}

// ---- グラデーション(選んだ図形の塗り・線)----

const gradKey = (kind) => (kind === 'fill' ? 'fillGrad' : 'strokeGrad');
const gradTarget = (kind) => (kind === 'fill' ? (s) => s.type !== 'line' && s.type !== 'text' : (s) => hasStroke(s) && s.type !== 'text');
const selStop = { fill: 0, stroke: 0 };

// 選んだ図形のうち、最初に見つかったグラデーション(なければ null)
function firstGrad(items, kind) {
  let g = null;
  eachLeaf(items, (s) => { if (!g && gradTarget(kind)(s) && s[gradKey(kind)]) g = s[gradKey(kind)]; });
  return g;
}

// g を選んだ図形の塗り(線)に入れる。null で単色に戻す
function applyGrad(kind, g, commit, label = 'グラデーション') {
  editing = !commit;
  const key = gradKey(kind), ok = gradTarget(kind);
  applyLive(label, (s) => {
    if (!ok(s)) return;
    if (!g) { delete s[key]; return; }
    s[key] = structuredClone(g);
    s[kind] = [...g.stops].sort((a, b) => a.o - b.o)[0].c; // 単色として扱う処理のための代わりの色
    if (kind === 'stroke' && !(s.strokeWidth > 0)) s.strokeWidth = state.opts.strokeWidth[modeKey()];
  });
  if (commit) { commitLive(); renderPaint(); }
}

function setGradType(kind, type, items) {
  const cur = firstGrad(items, kind);
  if (type === 'solid') { if (cur) applyGrad(kind, null, true, '単色に戻す'); return; }
  let color = null;
  eachLeaf(items, (s) => { if (!color && gradTarget(kind)(s) && s[kind]) color = s[kind]; });
  const g = cur ? { ...structuredClone(cur), type } : defaultGradient(type, color || '#000000ff');
  if (type === 'radial') { g.cx ??= 0.5; g.cy ??= 0.5; g.r ??= 1; } else g.angle ??= 90;
  applyGrad(kind, g, true, type === 'linear' ? '線形グラデーション' : '円形グラデーション');
}

function gradRows(kind, items) {
  const wrap = document.createElement('div');
  wrap.className = 'grad-box';
  const g = firstGrad(items, kind);
  const row = document.createElement('div');
  row.className = 'paint-row';
  const name = document.createElement('span');
  name.className = 'paint-label';
  const seg = document.createElement('div');
  seg.className = 'mini-seg grad-type';
  for (const [t, label] of Object.entries(GRAD_TYPES)) {
    const b = document.createElement('button');
    b.textContent = label;
    b.dataset.grad = t;
    b.className = (g ? g.type === t : t === 'solid') ? 'on' : '';
    b.onclick = () => setGradType(kind, t, items);
    seg.append(b);
  }
  row.append(name, seg);
  wrap.append(row);
  if (!g) return wrap;
  const stops = g.stops;
  if (selStop[kind] >= stops.length) selStop[kind] = 0;
  // 帯(クリックで色の点を足す、点をドラッグで動かす)
  const bar = document.createElement('div');
  bar.className = 'grad-bar';
  bar.title = 'クリックで色の点を追加 / 点をドラッグで移動';
  const paintBar = (gg) => {
    bar.style.background = `${gradientCss(gg)}, repeating-conic-gradient(#ccc 0 25%, #fff 0 50%) 0 0 / 10px 10px`;
    bar.querySelectorAll('.grad-stop').forEach((el, i) => { el.style.left = `${gg.stops[i].o * 100}%`; el.style.setProperty('--c', gg.stops[i].c.slice(0, 7)); });
  };
  stops.forEach((st, i) => {
    const h = document.createElement('div');
    h.className = 'grad-stop' + (i === selStop[kind] ? ' on' : '');
    h.onpointerdown = (e) => {
      e.stopPropagation();
      e.preventDefault();
      selStop[kind] = i;
      bar.querySelectorAll('.grad-stop').forEach((el, k) => el.classList.toggle('on', k === i));
      const r = bar.getBoundingClientRect();
      const gg = structuredClone(g);
      let moved = false;
      const mv = (ev) => {
        moved = true;
        gg.stops[i].o = clamp((ev.clientX - r.left) / r.width, 0, 1);
        paintBar(gg);
        applyGrad(kind, gg, false);
      };
      const up = () => {
        removeEventListener('pointermove', mv);
        removeEventListener('pointerup', up);
        if (moved) applyGrad(kind, gg, true, 'グラデーションの色の位置');
        else renderPaint();
      };
      addEventListener('pointermove', mv);
      addEventListener('pointerup', up);
    };
    bar.append(h);
  });
  bar.onpointerdown = (e) => {
    const r = bar.getBoundingClientRect();
    const o = clamp((e.clientX - r.left) / r.width, 0, 1);
    const gg = structuredClone(g);
    gg.stops.push({ o, c: colorAt(g, o) });
    selStop[kind] = gg.stops.length - 1;
    applyGrad(kind, gg, true, 'グラデーションの色を追加');
  };
  paintBar(g);
  wrap.append(bar);
  // 選んだ色の点: 色・不透明度・削除 / 反転
  const cur = stops[selStop[kind]];
  const r2 = document.createElement('div');
  r2.className = 'paint-row grad-stop-row';
  const sw = document.createElement('label');
  sw.className = 'paint-swatch';
  sw.style.setProperty('--c', toCss(parseHex(cur.c)));
  sw.title = '選んだ点の色';
  const ci = document.createElement('input');
  ci.type = 'color';
  ci.value = toHex(parseHex(cur.c));
  const setStopColor = (hex, commit) => {
    const gg = structuredClone(g);
    gg.stops[selStop[kind]].c = toHex8({ ...parseHex(hex), a: parseHex(cur.c).a });
    sw.style.setProperty('--c', hex);
    paintBar(gg);
    if (commit) useColor(hex);
    applyGrad(kind, gg, commit, 'グラデーションの色');
  };
  ci.oninput = () => setStopColor(ci.value, false);
  ci.onchange = () => setStopColor(ci.value, true);
  sw.append(ci);
  const op = document.createElement('input');
  op.type = 'number';
  op.className = 'num';
  Object.assign(op, { min: 0, max: 100, step: 1, value: Math.round(((parseHex(cur.c).a ?? 255) / 255) * 100), title: '選んだ点の不透明度(%)' });
  op.onkeydown = (e) => e.stopPropagation();
  op.onchange = () => {
    const gg = structuredClone(g);
    gg.stops[selStop[kind]].c = toHex8({ ...parseHex(cur.c), a: Math.round(clamp(Number(op.value) || 0, 0, 100) * 2.55) });
    applyGrad(kind, gg, true, 'グラデーションの不透明度');
  };
  const pct = document.createElement('span');
  pct.className = 'grad-unit';
  pct.textContent = '%';
  const del = document.createElement('button');
  del.textContent = '点を削除';
  del.disabled = stops.length <= 2;
  del.onclick = () => { const gg = structuredClone(g); gg.stops.splice(selStop[kind], 1); selStop[kind] = 0; applyGrad(kind, gg, true, 'グラデーションの色を削除'); };
  const rev = document.createElement('button');
  rev.textContent = '反転';
  rev.title = '色の並びを逆にする';
  rev.onclick = () => { const gg = structuredClone(g); gg.stops.forEach((s) => { s.o = 1 - s.o; }); applyGrad(kind, gg, true, 'グラデーションを反転'); };
  r2.append(sw, op, pct, del, rev);
  wrap.append(r2);
  // 向き(線形)/ 中心と大きさ(円形)
  const slider = (label, key, min, max, step, unit, conv = (v) => v, inv = (v) => v) => {
    const r = document.createElement('div');
    r.className = 'paint-row';
    const n = document.createElement('span');
    n.className = 'paint-label';
    n.textContent = label;
    const range = document.createElement('input');
    range.type = 'range';
    Object.assign(range, { min, max, step, value: inv(g[key] ?? 0) });
    const num = document.createElement('input');
    num.type = 'number';
    num.className = 'num';
    Object.assign(num, { min, max, step, value: Math.round(inv(g[key] ?? 0)) });
    const set = (v, commit) => { const gg = structuredClone(g); gg[key] = conv(clamp(Number(v) || 0, min, max)); applyGrad(kind, gg, commit, `グラデーションの${label}`); };
    range.oninput = () => { num.value = range.value; set(range.value, false); };
    range.onchange = () => set(range.value, true);
    num.onkeydown = (e) => e.stopPropagation();
    num.onchange = () => { range.value = num.value; set(num.value, true); };
    const u = document.createElement('span');
    u.className = 'grad-unit';
    u.textContent = unit;
    r.append(n, range, num, u);
    wrap.append(r);
  };
  if (g.type === 'linear') slider('角度', 'angle', -180, 180, 1, '°');
  else {
    const pc = (v) => v / 100, ip = (v) => v * 100;
    slider('中心 横', 'cx', 0, 100, 1, '%', pc, ip);
    slider('中心 縦', 'cy', 0, 100, 1, '%', pc, ip);
    slider('大きさ', 'r', 10, 300, 1, '%', pc, ip);
  }
  return wrap;
}

// ---- 表示 ----

function colorRow(kind, label, value) {
  const row = document.createElement('div');
  row.className = 'paint-row paint-color-row' + (paintTarget === kind ? ' target' : '');
  row.title = `クリックで選ぶと、パレット・最近使った色のクリックで${kind === 'fill' ? '塗り' : '線'}の色が変わります`;
  // 行をクリック(色の四角・なし以外): パレットの色を入れる先にする
  row.addEventListener('pointerdown', () => {
    if (paintTarget === kind) return;
    paintTarget = kind;
    document.querySelectorAll('#paint-body .paint-color-row').forEach((r) => r.classList.toggle('target', r === row));
  });
  const name = document.createElement('span');
  name.className = 'paint-label';
  name.textContent = label;
  const sw = document.createElement('label');
  sw.className = 'paint-swatch' + (kind === 'stroke' ? ' stroke' : '') + (value === null ? ' none' : '') + (value === MIXED ? ' mixed' : '');
  if (value && value !== MIXED) sw.style.setProperty('--c', toCss(parseHex(value)));
  sw.title = kind === 'fill' ? 'クリックで塗りの色を選ぶ' : 'クリックで線の色を選ぶ';
  const input = document.createElement('input');
  input.type = 'color';
  input.value = value && value !== MIXED ? toHex(parseHex(value)) : '#000000';
  input.oninput = () => setColor(kind, input.value, false);
  input.onchange = () => setColor(kind, input.value, true);
  sw.append(input);
  const text = document.createElement('span');
  text.className = 'paint-value';
  text.textContent = value === undefined ? '—' : value === MIXED ? '(混在)' : value === null ? 'なし' : value.slice(0, 7);
  const none = document.createElement('button');
  none.className = 'paint-none' + (value === null ? ' on' : '');
  none.textContent = 'なし';
  none.title = kind === 'fill' ? '塗りをなしにする' : '線をなしにする';
  none.onclick = () => setNone(kind);
  const pick = document.createElement('button');
  pick.className = 'paint-pick';
  pick.innerHTML = PICK_ICON;
  pick.title = 'スポイト: キャンバスの色をクリックで拾う(Esc でやめる)';
  pick.onclick = () => startPick(kind);
  row.append(name, sw, text, pick, none);
  return row;
}

function widthRow(value, enabled) {
  const row = document.createElement('div');
  row.className = 'paint-row';
  const name = document.createElement('span');
  name.className = 'paint-label';
  name.textContent = '線幅';
  const v = value === MIXED || value === undefined ? '' : value;
  const range = document.createElement('input');
  range.type = 'range';
  Object.assign(range, { min: 0.5, max: 100, step: 0.5, value: v || 1 });
  const num = document.createElement('input');
  num.type = 'number';
  num.className = 'num';
  Object.assign(num, { min: 0.5, max: 500, step: 0.5, value: v, placeholder: value === MIXED ? '混在' : '' });
  range.disabled = num.disabled = !enabled;
  const get = (x) => clamp(Number(x) || 1, 0.5, 500);
  range.oninput = () => { num.value = range.value; setWidth(get(range.value), false); };
  range.onchange = () => setWidth(get(range.value), true);
  num.onchange = () => { range.value = num.value; setWidth(get(num.value), true); };
  num.onkeydown = (e) => e.stopPropagation();
  row.append(name, range, num);
  return row;
}

export function renderPaint() {
  const box = $('paint-body');
  if (!box || !state.doc) return;
  if (editing) return;
  const st = currentStyle();
  const n = st.items.length;
  $('paint-target').textContent = n ? `選択中の図形 ${n}個` : '新しい図形';
  box.innerHTML = '';
  box.append(colorRow('fill', '塗り', st.fill));
  if (n && st.fill !== undefined) box.append(gradRows('fill', st.items));
  box.append(colorRow('stroke', '線', st.stroke));
  if (n && st.stroke) box.append(gradRows('stroke', st.items));
  box.append(widthRow(st.width, n ? st.width !== undefined : true));
  const btns = document.createElement('div');
  btns.className = 'paint-buttons';
  const b = (label, fn, title, enabled = true) => {
    const x = document.createElement('button');
    x.textContent = label;
    x.title = title;
    x.disabled = !enabled;
    x.onclick = fn;
    btns.append(x);
  };
  b('⇄ 入れ替え', swapStrokeFill, n ? '選んだ図形の線と塗りの色を入れ替え' : 'メインとサブの色を入れ替え (X)');
  b('アウトライン化', outlineSelection, '選んだ図形の線を、同じ見た目の塗りの図形に変換 (Ctrl+Shift+O)', n > 0);
  b('縁取り…', borderDialog, '選んだ図形全体の外形をなぞった縁取りを作る (Ctrl+Shift+B)', n > 0);
  box.append(btns);
}
