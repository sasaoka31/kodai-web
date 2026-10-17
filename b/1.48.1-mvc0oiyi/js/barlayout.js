// レイアウト(Kaiju と同じ仕組み): 上のバーと左のツールバーに並ぶもの(ボタン・ツール・区切りの線)を、持って好きな所へ動かす。
//   右上の「レイアウト」(メニュー → 表示 →「レイアウト」でも)で始めて、「完了」で終える。
//   その間は、ボタンを押しても動かない(持って動かすだけ)。下の箱には、置いていないものが並ぶ。箱へ入れると、バーから外れる。
//   並びは prefs.topbar / prefs.toolbar(baritems.js の ITEMS の id の配列。このPCに保存)。
//   同じボタン・ツールを、いくつ置いてもよい(1.45.0。Kaiju と同じ。箱には、いつも全部出る)。同じ id のボタンが2つあると、前からの id(btn-undo など)も2つになる(getElementById は、はじめの1つ)
//   帯の「右のパネル…」「色とデザイン…」「チャーム…」は look.js のダイアログ(レイアウトの間も押せる。data-action)
import { toast } from './state.js';
import { prefs, savePrefs } from './prefs.js';
import { ITEMS, DEFAULT_TOPBAR, DEFAULT_TOOLBAR } from './baritems.js';
import { icons } from './icons.js';
import { escapeHtml } from './modal.js';

const $ = (id) => document.getElementById(id);
const ZONES = { topbar: 'topbar-actions', toolbar: 'toolbar' };
let active = false;
let redraw = () => {}; // バーを作り直す(ui.js の drawBars)
let D = null; // 持って動かしている最中: { id, from('topbar' | 'toolbar' | 'tray'), idx, el, ghost, mark, t }

export const isLayout = () => active;

function drawTray() {
  const tray = $('layout-tray');
  tray.textContent = '';
  const used = new Set([...prefs.topbar, ...prefs.toolbar]);
  for (const [id, a] of Object.entries(ITEMS)) {
    const b = document.createElement('button');
    b.className = 'chip' + (used.has(id) && !a.sep ? ' used' : ''); // 置いてあるもの(もう1つ置ける)は少し薄く
    b.dataset.tray = id;
    b.title = a.hint || a.label || a.text || '';
    b.innerHTML = `${a.sep ? '<i class="bar-sep"></i>' : a.tool ? icons[id] : ''}<span>${escapeHtml(a.label || a.text)}</span>`;
    tray.append(b);
  }
}

const save = () => savePrefs({ topbar: prefs.topbar, toolbar: prefs.toolbar });

export function toggleLayout(on = !active) {
  if (on === active) return;
  active = on;
  document.body.classList.toggle('layout-mode', on);
  $('layout-bar').hidden = !on;
  if (on) {
    for (const id of ['make-menu', 'tool-group', 'context-menu']) document.getElementById(id)?.remove();
    drawTray();
  }
  toast(on ? 'レイアウト: ボタンを持って、好きな所へ動かせます。終わったら「完了」' : 'レイアウトを保存しました');
}

export function resetLayout() {
  prefs.topbar = [...DEFAULT_TOPBAR];
  prefs.toolbar = [...DEFAULT_TOOLBAR];
  save();
  redraw();
  if (active) drawTray();
  toast('はじめの並びに戻しました');
}

// (x, y) の下にあるバー(か箱)と、そこでの入る位置
function target(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  if (el.closest('#layout-bar')) return { to: 'tray' };
  for (const [zone, boxId] of Object.entries(ZONES)) {
    // 上のバーは、バーの空いた所でもよい
    const box = $(boxId), hit = zone === 'topbar' ? el.closest('#topbar') : el.closest('#' + boxId);
    if (!hit) continue;
    const items = [...box.children].filter((c) => c.dataset.item !== undefined);
    let at = items.length;
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect();
      if (zone === 'topbar' ? x < r.left + r.width / 2 : y < r.top + r.height / 2) { at = i; break; }
    }
    // 並びの外のもの(Web 版のメニューのボタンなど)は、いつもうしろ
    const tail = [...box.children].find((c) => c.dataset.item === undefined && c !== D?.mark) || null;
    return { to: zone, at, before: items[at] || tail, box };
  }
  return null;
}

function move(e) {
  if (!D) return;
  e.preventDefault();
  D.ghost.style.transform = `translate3d(${e.clientX - D.gx}px, ${e.clientY - D.gy}px, 0)`;
  D.mark.remove();
  const t = target(e.clientX, e.clientY);
  D.t = t;
  $('layout-bar').classList.toggle('drop', t?.to === 'tray' && D.from !== 'tray');
  if (t && t.to !== 'tray') {
    D.mark.className = 'layout-mark ' + t.to;
    t.box.insertBefore(D.mark, t.before);
  }
}

function end(e) {
  if (!D) return;
  const d = D;
  D = null;
  d.ghost.remove();
  d.mark.remove();
  d.el.classList.remove('lifted');
  $('layout-bar').classList.remove('drop');
  document.removeEventListener('pointermove', move, true);
  for (const type of ['pointerup', 'pointercancel']) document.removeEventListener(type, end, true);
  const t = e.type === 'pointerup' ? d.t : null;
  if (!t || (t.to === 'tray' && d.from === 'tray')) return;
  let at = t.at;
  if (d.from !== 'tray') {
    prefs[d.from].splice(d.idx, 1);
    if (d.from === t.to && d.idx < at) at--;
  }
  if (t.to !== 'tray') prefs[t.to].splice(at, 0, d.id);
  save();
  redraw();
  drawTray();
}

function begin(e, el, id, from) {
  const r = el.getBoundingClientRect();
  const ghost = el.cloneNode(true);
  ghost.removeAttribute('id');
  ghost.classList.add('layout-ghost');
  ghost.style.width = r.width + 'px';
  ghost.style.height = r.height + 'px';
  document.body.append(ghost);
  el.classList.add('lifted');
  D = { id, from, idx: Number(el.dataset.idx), el, ghost, mark: document.createElement('span'), gx: e.clientX - r.left, gy: e.clientY - r.top, t: null };
  ghost.style.transform = `translate3d(${r.left}px, ${r.top}px, 0)`;
  document.addEventListener('pointermove', move, true);
  for (const type of ['pointerup', 'pointercancel']) document.addEventListener(type, end, true);
}

export function initBarLayout(drawBars) {
  redraw = drawBars;
  // レイアウトを変えている間は、ふつうの操作(押す・描く)を止めて、持って動かすだけにする
  document.addEventListener('pointerdown', (e) => {
    if (!active) return;
    if (e.target.closest?.('.lb-btn, .modal-backdrop')) return;
    e.stopPropagation();
    e.preventDefault();
    if (D || e.button > 0) return;
    const chip = e.target.closest?.('[data-tray]');
    if (chip) { begin(e, chip, chip.dataset.tray, 'tray'); return; }
    const el = e.target.closest?.('[data-item]');
    const zone = el && Object.keys(ZONES).find((z) => el.parentElement === $(ZONES[z]));
    if (zone) begin(e, el, el.dataset.item, zone);
  }, true);
  for (const type of ['click', 'dblclick', 'contextmenu', 'wheel']) {
    document.addEventListener(type, (e) => {
      if (!active || e.target.closest?.('.lb-btn, .modal-backdrop, #layout-tray')) return;
      e.stopPropagation();
      if (type !== 'wheel') e.preventDefault();
    }, true);
  }
  // キーも止める(ツールの切り替えなどが、裏で動かないように)。Esc で終える
  window.addEventListener('keydown', (e) => {
    if (!active) return;
    e.stopPropagation();
    if (e.key === 'Escape') toggleLayout(false);
  }, true);
  $('layout-done').onclick = () => toggleLayout(false);
  $('layout-reset').onclick = resetLayout;
}
