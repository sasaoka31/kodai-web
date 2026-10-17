// 整列(右サイドバーの「整列」パネル)。下の段にパスファインダー(pathfinder.js)
//   選んだ図形を、左・左右中央・右・上・上下中央・下にそろえる / 等間隔に並べる(3つ以上)
//   基準: 選択範囲(選んだ図形全体の枠)/ アートボード。図形が1つだけのときは自動でアートボード基準。
//   等間隔は、選択範囲なら両端の図形の間で、アートボードならアートボードの端から端まで(1.47.0)
//   線幅も含めた見た目の枠でそろえる(イラレの「プレビュー境界」と同じ)
import { state, on } from './state.js';
import { selectedItems, modifySelection } from './select.js';
import { translateShape, visualBounds } from './vector.js';
import { pathfinder, PATHFINDER } from './pathfinder.js';

const $ = (id) => document.getElementById(id);
const TARGET_KEY = 'pixelrig.alignTarget';

const svg = (body) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">${body}</svg>`;
const ICONS = {
  left: svg('<path d="M4 3v18"/><rect x="6" y="6" width="12" height="4" fill="currentColor"/><rect x="6" y="14" width="7" height="4" fill="currentColor"/>'),
  hcenter: svg('<path d="M12 3v18"/><rect x="5" y="6" width="14" height="4" fill="currentColor" fill-opacity=".85"/><rect x="8" y="14" width="8" height="4" fill="currentColor" fill-opacity=".85"/>'),
  right: svg('<path d="M20 3v18"/><rect x="6" y="6" width="12" height="4" fill="currentColor"/><rect x="11" y="14" width="7" height="4" fill="currentColor"/>'),
  top: svg('<path d="M3 4h18"/><rect x="6" y="6" width="4" height="12" fill="currentColor"/><rect x="14" y="6" width="4" height="7" fill="currentColor"/>'),
  vcenter: svg('<path d="M3 12h18"/><rect x="6" y="5" width="4" height="14" fill="currentColor" fill-opacity=".85"/><rect x="14" y="8" width="4" height="8" fill="currentColor" fill-opacity=".85"/>'),
  bottom: svg('<path d="M3 20h18"/><rect x="6" y="6" width="4" height="12" fill="currentColor"/><rect x="14" y="11" width="4" height="7" fill="currentColor"/>'),
  distH: svg('<path d="M4 4v16M20 4v16"/><rect x="9" y="8" width="6" height="8" fill="currentColor"/>'),
  distV: svg('<path d="M4 4h16M4 20h16"/><rect x="8" y="9" width="8" height="6" fill="currentColor"/>'),
};
// パスファインダー: 2つの四角の組み合わせで結果を見せる
const PF_ICONS = {
  unite: svg('<path d="M4 4h10v6h6v10H10v-6H4z" fill="currentColor"/>'),
  minus: svg('<path d="M4 4h10v6h-4v4H4z" fill="currentColor"/><path d="M10 10h10v10H10z" stroke-dasharray="2 2"/>'),
  intersect: svg('<path d="M4 4h10v10H4zM10 10h10v10H10z" stroke-width="1"/><rect x="10" y="10" width="4" height="4" fill="currentColor"/>'),
  exclude: svg('<path d="M4 4h10v6h-4v4H4zM14 10h6v10H10v-6h4z" fill="currentColor"/><path d="M10 10h4v4h-4z" stroke-width="1"/>'),
};
const LABELS = {
  left: '左にそろえる', hcenter: '左右中央にそろえる', right: '右にそろえる',
  top: '上にそろえる', vcenter: '上下中央にそろえる', bottom: '下にそろえる',
  distH: '横に等間隔に並べる(3つ以上。基準がアートボードなら端から端まで)', distV: '縦に等間隔に並べる(3つ以上。基準がアートボードなら端から端まで)',
};

function getTarget() {
  try { return localStorage.getItem(TARGET_KEY) === 'artboard' ? 'artboard' : 'selection'; } catch { return 'selection'; }
}

function union(list) {
  return list.reduce((r, b) => (r ? { x0: Math.min(r.x0, b.x0), y0: Math.min(r.y0, b.y0), x1: Math.max(r.x1, b.x1), y1: Math.max(r.y1, b.y1) } : { ...b }), null);
}

// kind: left|hcenter|right|top|vcenter|bottom|distH|distV、target: 'selection'|'artboard'
export function alignSelection(kind, target = getTarget()) {
  const items = selectedItems();
  if (!items.length) return false;
  const boxes = new Map(items.map((it) => [it.shape.id, visualBounds(it.shape)]));
  const a = state.doc.artboard;
  const useArtboard = target === 'artboard' || items.length === 1;
  const ref = useArtboard ? { x0: a.x, y0: a.y, x1: a.x + a.w, y1: a.y + a.h } : union([...boxes.values()]);
  const move = new Map(); // id → [dx, dy]
  if (kind === 'distH' || kind === 'distV') {
    if (items.length < 3) return false;
    const h = kind === 'distH';
    const lo = h ? 'x0' : 'y0', hi = h ? 'x1' : 'y1';
    const sorted = [...items].sort((p, q) => (boxes.get(p.shape.id)[lo] + boxes.get(p.shape.id)[hi]) - (boxes.get(q.shape.id)[lo] + boxes.get(q.shape.id)[hi]));
    // 両端の図形は動かさず、間のすき間を同じにする
    const total = sorted.reduce((s, it) => s + boxes.get(it.shape.id)[hi] - boxes.get(it.shape.id)[lo], 0);
    const first = boxes.get(sorted[0].shape.id), last = boxes.get(sorted[sorted.length - 1].shape.id);
    // 基準がアートボードなら、アートボードの端から端まで(両端の図形もアートボードの端へ)。選択範囲なら両端の図形は動かさない
    const from = target === 'artboard' ? (h ? a.x : a.y) : first[lo], to = target === 'artboard' ? (h ? a.x + a.w : a.y + a.h) : last[hi];
    const gap = (to - from - total) / (sorted.length - 1);
    let pos = from;
    for (const it of sorted) {
      const b = boxes.get(it.shape.id);
      const d = pos - b[lo];
      move.set(it.shape.id, h ? [d, 0] : [0, d]);
      pos += b[hi] - b[lo] + gap;
    }
  } else {
    for (const it of items) {
      const b = boxes.get(it.shape.id);
      let dx = 0, dy = 0;
      if (kind === 'left') dx = ref.x0 - b.x0;
      else if (kind === 'right') dx = ref.x1 - b.x1;
      else if (kind === 'hcenter') dx = (ref.x0 + ref.x1) / 2 - (b.x0 + b.x1) / 2;
      else if (kind === 'top') dy = ref.y0 - b.y0;
      else if (kind === 'bottom') dy = ref.y1 - b.y1;
      else if (kind === 'vcenter') dy = (ref.y0 + ref.y1) / 2 - (b.y0 + b.y1) / 2;
      move.set(it.shape.id, [dx, dy]);
    }
  }
  if ([...move.values()].every(([dx, dy]) => Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9)) return false;
  modifySelection(LABELS[kind], (_its, layer) => {
    layer.shapes = layer.shapes.map((s) => {
      const m = move.get(s.id);
      return m ? translateShape(s, m[0], m[1]) : s;
    });
  });
  return true;
}

export function initAlignPanel() {
  const body = $('align-body');
  if (!body) return;
  const row = (keys) => {
    const r = document.createElement('div');
    r.className = 'align-row';
    for (const k of keys) {
      const b = document.createElement('button');
      b.className = 'align-btn';
      b.dataset.align = k;
      b.title = LABELS[k];
      b.innerHTML = ICONS[k];
      b.onclick = () => alignSelection(k);
      r.append(b);
    }
    return r;
  };
  const target = document.createElement('label');
  target.className = 'align-target';
  target.innerHTML = '基準 <select><option value="selection">選択範囲</option><option value="artboard">アートボード</option></select>';
  const sel = target.querySelector('select');
  sel.value = getTarget();
  sel.onchange = () => { try { localStorage.setItem(TARGET_KEY, sel.value); } catch { /* 保存できなくても動く */ } };
  const r2 = row(['top', 'vcenter', 'bottom', 'distH', 'distV']);
  // パスファインダー(2つ以上選んだとき)
  const pf = document.createElement('div');
  pf.className = 'align-row pf-row';
  const pfl = document.createElement('span');
  pfl.className = 'pf-label';
  pfl.textContent = 'パスファインダー';
  pf.append(pfl);
  for (const [k, v] of Object.entries(PATHFINDER)) {
    const b = document.createElement('button');
    b.className = 'align-btn pf-btn';
    b.dataset.pf = k;
    b.title = `${v.label}: ${v.hint}`;
    b.innerHTML = PF_ICONS[k];
    b.onclick = () => pathfinder(k);
    pf.append(b);
  }
  body.append(row(['left', 'hcenter', 'right']), r2, target, pf);
  const update = () => {
    const n = selectedItems().length;
    for (const b of body.querySelectorAll('.align-btn')) b.disabled = b.dataset.pf ? n < 2 : !n || (b.dataset.align.startsWith('dist') && n < 3);
    $('align-note').textContent = !n ? '図形を選ぶと使えます' : n === 1 ? '1つだけ → アートボードに' : `${n}個`;
  };
  for (const e of ['selection', 'doc', 'layers', 'history']) on(e, update);
  update();
}
