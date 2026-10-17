// 「アイコン」ダイアログ(上の「作る ▾」→ アイコン… / ファイル → アイコン…)
//   いつでも使える、汎用のアイコン(歯車・ペン・スパナ…)を、編集できるパスとして置く。中身は iconset.js(24×24 の線の絵)
//   名前・言葉で探す → 大きさ・色・形(線のまま / 塗りの形にする)を選ぶ → クリックで、アートボードの真ん中に置く(置いた図形が選ばれる)
import { state, toast, emit, requestRender } from './state.js';
import { openModal, escapeHtml } from './modal.js';
import { ICONS } from './iconset.js';
import { svgPathToShape } from './svgpath.js';
import { scaleShape, setSelection } from './select.js';
import { translateShape } from './vector.js';
import { pushAppend, shapeLayer } from './tools.js';
import { outlineSelection } from './outline.js';
import { toHex } from './color.js';

const KEY = 'pixelrig.icons';
const loadLast = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };

export const iconList = () => ICONS;

// 言葉で探す(名前・言葉の一部。空白で区切ると、全部ふくむもの)
export function findIcons(q = '') {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return ICONS;
  return ICONS.filter((ic) => { const t = `${ic.id} ${ic.name} ${ic.tags}`.toLowerCase(); return words.every((w) => t.includes(w)); });
}

export const iconSvg = (ic, size = 28) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${ic.d}"/></svg>`;

// アイコンを今のベクターレイヤーに置く。size = 仕上がりの幅・高さ(px)。fill: true なら塗りの形(線をアウトライン化)。
// x, y = 左上(省略 = アートボードの真ん中)。戻り値は置いた図形
export function placeIcon(ic, { size = 96, color, fill = false, x, y } = {}) {
  const layer = shapeLayer();
  if (!layer || layer.locked) { toast('図形を置けるレイヤーがありません'); return null; }
  const k = size / 24;
  const a = state.doc.artboard;
  const left = x ?? a.x + (a.w - size) / 2, top = y ?? a.y + (a.h - size) / 2;
  const c = color || toHex(state.primary) + 'ff';
  let s = { type: 'path', ...svgPathToShape(ic.d), fill: null, stroke: c, strokeWidth: 2 * k, name: ic.name };
  s = translateShape(scaleShape(s, 0, 0, k, k), left, top);
  pushAppend(`アイコン「${ic.name}」`, layer, [s]);
  setSelection(layer, [s.id]);
  if (fill) outlineSelection(); // 線 → 塗りの形(色は線の色のまま)
  emit('request-tool', 'move');
  requestRender();
  return layer.shapes.find((x2) => x2.id === state.selection?.ids?.[0]) || s;
}

export async function iconDialog() {
  const last = loadLast();
  const body = document.createElement('div');
  body.className = 'form icon-dialog';
  body.innerHTML = `
    <div class="row">
      <input type="text" id="ic-q" placeholder="探す(歯車・ペン・矢印 など)">
      <span class="note" id="ic-count"></span>
    </div>
    <div class="icon-grid" id="ic-grid"></div>
    <div class="row">
      <label>大きさ <input type="number" id="ic-size" class="num" min="8" max="2048" value="${last.size || 96}"> px</label>
      <label>形 <select id="ic-kind"><option value="line">線のまま(太さを変えられる)</option><option value="fill"${last.fill ? ' selected' : ''}>塗りの形にする</option></select></label>
      <label>色 <input type="color" id="ic-color" value="${toHex(state.primary)}"></label>
    </div>
    <p class="note">アイコンをクリックすると、アートボードの真ん中に置きます(続けていくつでも)。置いたものは編集できるパスです(矢印ツールで動かす・大きさを変える、ダイレクト選択で形を直す)。</p>`;
  const q = body.querySelector('#ic-q'), grid = body.querySelector('#ic-grid'), count = body.querySelector('#ic-count');
  const opts = () => ({ size: Math.max(8, Math.min(2048, Math.round(Number(body.querySelector('#ic-size').value)) || 96)), fill: body.querySelector('#ic-kind').value === 'fill', color: body.querySelector('#ic-color').value + 'ff' });
  const draw = () => {
    const list = findIcons(q.value);
    count.textContent = `${list.length} / ${ICONS.length} 個`;
    grid.innerHTML = list.map((ic) => `<button type="button" class="icon-cell" data-icon="${ic.id}" title="${escapeHtml(ic.name)}">${iconSvg(ic, 30)}<span>${escapeHtml(ic.name)}</span></button>`).join('') || '<p class="note">見つかりません</p>';
  };
  q.oninput = draw;
  grid.onclick = (e) => {
    const b = e.target.closest('[data-icon]');
    if (!b) return;
    const ic = ICONS.find((x) => x.id === b.dataset.icon);
    const o = opts();
    if (placeIcon(ic, o)) toast(`「${ic.name}」を置きました`);
    try { localStorage.setItem(KEY, JSON.stringify({ size: o.size, fill: o.fill })); } catch { /* 覚えられなくても置ける */ }
  };
  draw();
  setTimeout(() => q.focus());
  await openModal({ title: `アイコン(${ICONS.length}個)`, body, width: 640, buttons: [{ label: '閉じる', value: null, primary: true }] });
}
