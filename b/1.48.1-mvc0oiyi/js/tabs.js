// タブ: 絵を何枚も同時に開いて、行き来する(フォント作成もタブの1つ)
//   state.doc / filePath / dirty / history は「今のタブ」のもの。切り替えるときに、今のタブの分を tab に書き戻してから、次のタブの分を state に入れる。
//   タブごとに持つもの: 絵・ファイルの場所・保存していない変更・元に戻す履歴・今のフレーム・表示(拡大率と位置)・選んでいる図形
//   コピー&ペーストの中身(clipboard.js の clip)はアプリ全体で1つなので、タブをまたいで貼れる(フォントの字にも)
import { state, emit, requestRender } from './state.js';
import { timeline } from './document.js';
import { History } from './history.js';
import * as tl from './timeline.js';

let tabs = [];   // { id, doc, filePath, dirty, history, frame, view: { zoom, ox, oy } | null, selection }
let active = -1;
let nextId = 1;
let hooks = { onHistory: null, settle: () => {}, confirmSave: async () => true };

export const tabList = () => tabs;
export const activeIndex = () => active;

// app.js から: onHistory(履歴の変更を受ける関数)、settle()(作業中の操作を確定)、confirmSave(保存するか聞く。続けてよければ true)、
//   blank()(最後のタブを閉じたときの、新しい「無題」)
export function initTabs(h) {
  hooks = { ...hooks, ...h };
}

function newHistory() {
  const h = new History();
  h.onChange = hooks.onHistory;
  return h;
}

// 何も描いていない「無題」のタブ(新しく開く絵で置き換えてよい)
function isBlank(t) {
  if (t.filePath || t.dirty || t.history.canUndo || t.doc.font) return false;
  return t.doc.layers.every((l) => l.cels.every((c) => !c || (c.tiles ? c.tiles.size === 0 : !c.shapes?.length)));
}

// 今のタブの状態を tab に書き戻す
function stash() {
  const t = tabs[active];
  if (!t) return;
  t.doc = state.doc;
  t.filePath = state.filePath;
  t.dirty = state.dirty;
  t.history = state.history;
  t.frame = timeline.frame;
  t.view = { zoom: state.view.zoom, ox: state.view.ox, oy: state.view.oy };
  t.selection = state.selection;
}

// tab を画面に出す(fit: 全体が見えるように表示を合わせる)
function show(i, fit) {
  const t = tabs[i];
  active = i;
  tl.stop();
  timeline.frame = Math.min(t.frame || 0, t.doc.frames.length - 1);
  state.doc = t.doc;
  state.filePath = t.filePath;
  state.dirty = t.dirty;
  state.history = t.history;
  state.preview = null;
  state.selection = t.selection || null;
  state.pathDraft = null;
  state.transform = null;
  state.lastPoint = null;
  state.rigSel = null;
  state.rigDragging = false;
  emit('doc');
  const v = state.view;
  if (fit || !t.view) v.fit();
  else { v.zoom = t.view.zoom; v.ox = t.view.ox; v.oy = t.view.oy; emit('zoom'); }
  emit('frames');
  emit('frame');
  emit('history');
  emit('title');
  emit('tabs');
  requestRender();
}

// 絵をタブで開く。newTab: false なら今のタブを置き換える。今のタブが何も描いていない「無題」なら、そこを使う
export function openDoc(doc, path = null, { newTab = true } = {}) {
  // 同じファイルをもう開いているタブがあれば、そこへ切り替える(2つ開くと、どちらが新しいか分からなくなる)
  const same = path ? tabs.findIndex((t, i) => (i === active ? state.filePath : t.filePath)?.toLowerCase() === path.toLowerCase()) : -1;
  if (same >= 0) { switchTab(same); return tabs[same]; }
  if (active >= 0) hooks.settle();
  const t = { id: nextId++, doc, filePath: path, dirty: false, history: newHistory(), frame: 0, view: null, selection: null, from: tabs[active]?.id };
  if (active >= 0) stash();
  if (active < 0) { tabs.push(t); show(0, true); return t; }
  if (!newTab || isBlank(tabs[active])) { tabs[active] = t; show(active, true); return t; }
  tabs.splice(active + 1, 0, t);
  show(active + 1, true);
  return t;
}

export function switchTab(i) {
  if (i === active || !tabs[i]) return;
  hooks.settle();
  stash();
  show(i, false);
}

// タブを閉じる(保存していない変更があれば、そのタブを出して聞く)。閉じたら true
export async function closeTab(i = active, { force = false } = {}) {
  if (!tabs[i]) return false;
  if (i !== active) switchTab(i);
  if (!force && !(await hooks.confirmSave())) return false;
  hooks.settle();
  const at = active, from = tabs[at].from;
  tabs.splice(at, 1);
  active = -1;
  if (!tabs.length) { hooks.blank(); return true; } // 最後のタブ: 新しい「無題」を1枚
  // 開いたときにいたタブへ戻る(フォント作成を終わったら、元の絵へ)。なければ右どなり(右端なら左どなり)
  const back = tabs.findIndex((t) => t.id === from);
  show(back >= 0 ? back : Math.min(at, tabs.length - 1), false);
  return true;
}

// 全部のタブの保存していない変更を、順に確かめる(アプリを閉じるとき)。全部よければ true
export async function confirmAll() {
  stash();
  for (let i = 0; i < tabs.length; i++) {
    if (!tabs[i].dirty) continue;
    switchTab(i);
    if (!(await hooks.confirmSave())) return false;
  }
  return true;
}

export const anyDirty = () => { stash(); return tabs.some((t) => t.dirty); };

// タブの名前(ファイル名・フォントの名前・無題 n)
export function tabName(t) {
  // 今のタブは、state の方が新しい(保存したばかりのファイル名など)
  const doc = t === tabs[active] ? state.doc : t.doc, file = t === tabs[active] ? state.filePath : t.filePath;
  if (doc.font) return doc.font.name || 'フォント';
  if (file) return file.split(/[\\/]/).pop();
  if (!t.untitled) {
    // 開いているタブで使っていない、いちばん小さい番号(無題・無題 2・無題 3 …)
    const used = new Set(tabs.filter((x) => x !== t && !x.filePath && !x.doc.font).map((x) => x.untitled).filter(Boolean));
    let n = 1;
    while (used.has(n === 1 ? '無題' : `無題 ${n}`)) n++;
    t.untitled = n === 1 ? '無題' : `無題 ${n}`;
  }
  return t.untitled;
}

// ---- タブの並び(キャンバスの上) ----
// クリック = 切り替え、× / 中ボタン = 閉じる、+ = 新しいタブ、ドラッグ = 並べ替え

export function renderTabBar() {
  const bar = document.getElementById('tabbar');
  if (!bar) return;
  bar.innerHTML = '';
  tabs.forEach((t, i) => {
    const on = i === active;
    const dirty = on ? state.dirty : t.dirty;
    const el = document.createElement('div');
    el.className = 'tab' + (on ? ' on' : '');
    el.dataset.tab = i;
    el.title = t.filePath || tabName(t);
    if (t.doc.font) el.innerHTML = '<span class="tab-kind">フォント</span>';
    const name = document.createElement('span');
    name.className = 'tab-name';
    name.textContent = tabName(t);
    el.append(name);
    if (dirty) el.insertAdjacentHTML('beforeend', '<span class="tab-dirty" title="保存していない変更があります">●</span>');
    const x = document.createElement('button');
    x.className = 'tab-x';
    x.textContent = '×';
    x.title = t.doc.font ? 'フォント作成を終わる(このタブを閉じる)' : 'このタブを閉じる';
    el.append(x);
    bar.append(el);
  });
  const plus = document.createElement('button');
  plus.className = 'tab-plus';
  plus.dataset.action = 'new';
  plus.textContent = '＋';
  plus.title = '新しいタブ (Ctrl+N)';
  bar.append(plus);
}

export function initTabBar() {
  const bar = document.getElementById('tabbar');
  if (!bar) return;
  let drag = null; // 並べ替え: { from, x }
  bar.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.tab');
    if (!el || e.target.closest('.tab-x')) return;
    const i = Number(el.dataset.tab);
    if (e.button === 1) { e.preventDefault(); closeTab(i); return; }
    if (e.button !== 0) return;
    switchTab(i);
    drag = { from: active, x: e.clientX, moved: false };
    bar.setPointerCapture(e.pointerId);
  });
  bar.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved && Math.abs(e.clientX - drag.x) < 6) return;
    drag.moved = true;
    // 指している所のタブと入れ替える
    const over = [...bar.querySelectorAll('.tab')].find((el) => { const r = el.getBoundingClientRect(); return e.clientX >= r.left && e.clientX < r.right; });
    const to = over ? Number(over.dataset.tab) : -1;
    if (to < 0 || to === active) return;
    const [t] = tabs.splice(active, 1);
    tabs.splice(to, 0, t);
    active = to;
    renderTabBar();
  });
  const end = () => { drag = null; };
  bar.addEventListener('pointerup', end);
  bar.addEventListener('pointercancel', end);
  bar.addEventListener('click', (e) => {
    const x = e.target.closest('.tab-x');
    if (x) closeTab(Number(x.closest('.tab').dataset.tab));
  });
  // 中ボタンで自動スクロールにならないように
  bar.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
}

// タブの一覧(Claude 連携など)
export function tabsInfo() {
  stash();
  return tabs.map((t, i) => ({ index: i, name: tabName(t), active: i === active, unsaved: t.dirty, font: !!t.doc.font, file: t.filePath || null }));
}
