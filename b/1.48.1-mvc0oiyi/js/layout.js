// 画面の比率を変える: キャンバスとタイムラインの境目・キャンバスとサイドバーの境目をドラッグ
//   境目のダブルクリックでたたむ / 元に戻す。右のパネルは見出しのクリックでたたむ。大きさは次回も使う
import { state } from './state.js';

const KEY = 'pixelrig.layout';
const app = () => document.getElementById('app');

const DEF = { tl: null, side: 272, collapsed: [] }; // tl: タイムラインの高さ(null = 中身に合わせる)
let L = { ...DEF };

function load() {
  try { L = { ...DEF, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { L = { ...DEF }; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(L)); } catch { /* 保存できなくても動く */ }
}

function apply() {
  const a = app();
  a.style.setProperty('--side-w', `${L.side}px`);
  if (L.tl === null) a.style.removeProperty('--tl-h');
  else a.style.setProperty('--tl-h', `${L.tl}px`);
  a.classList.toggle('tl-collapsed', L.tl === 0);
  for (const p of document.querySelectorAll('#sidebar .panel[id]')) p.classList.toggle('collapsed', L.collapsed.includes(p.id));
  fitView();
}

// キャンバスの大きさをすぐ合わせる(ResizeObserver の通知は画面の更新が止まっていると遅れる・来ないことがあるため)
function fitView() {
  const v = state.view;
  if (!v) return;
  const r = document.getElementById('canvas-area')?.getBoundingClientRect();
  if (r && (Math.abs(r.width - v.w) > 0.5 || Math.abs(r.height - v.h) > 0.5)) v.resize();
}

function drag(el, onMove) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* つかめなくてもドラッグはできる */ }
    el.classList.add('dragging');
    const move = (ev) => onMove(ev);
    const up = () => {
      el.classList.remove('dragging');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      save();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
}

// モード(フォント作成など)でタイムラインを隠すとき用
export function setTimelineHidden(hidden) {
  app().classList.toggle('tl-hidden', hidden);
  fitView();
}

export function initLayout() {
  load();
  const h = document.getElementById('split-timeline');
  const v = document.getElementById('split-side');
  const tl = document.getElementById('timeline');
  let lastTl = L.tl || 150;
  drag(h, (e) => {
    // タイムラインの上端 = マウスの位置。キャンバスは最低 160px 残す
    const bottom = document.getElementById('statusbar').getBoundingClientRect().top;
    const top = document.getElementById('topbar').getBoundingClientRect().bottom;
    const hgt = Math.round(bottom - e.clientY - h.offsetHeight / 2);
    L.tl = Math.max(0, Math.min(bottom - top - 160, hgt));
    if (L.tl < 30) L.tl = 0; // 小さくしすぎたら、たたむ
    if (L.tl) lastTl = L.tl;
    apply();
  });
  h.addEventListener('dblclick', () => {
    L.tl = L.tl === 0 ? lastTl || tl.scrollHeight : 0;
    apply();
    save();
  });
  drag(v, (e) => {
    L.side = Math.max(200, Math.min(560, Math.round(window.innerWidth - e.clientX - v.offsetWidth / 2)));
    apply();
  });
  v.addEventListener('dblclick', () => { L.side = DEF.side; apply(); save(); });
  // パネルの見出しクリックでたたむ
  for (const p of document.querySelectorAll('#sidebar .panel[id]')) {
    const head = p.querySelector('h3');
    head.classList.add('collapsible');
    head.title = 'クリックでたたむ / 開く';
    head.addEventListener('click', () => {
      L.collapsed = L.collapsed.includes(p.id) ? L.collapsed.filter((x) => x !== p.id) : [...L.collapsed, p.id];
      apply();
      save();
    });
  }
  apply();
}
