// 見た目(Kaiju と同じ考え方。このPCに保存。ファイルには入らない)
//   色とデザイン: 画面の色合い(標準 / 暗い / もっと暗い)、バー・パネル・キャンバスのまわりの色、敷く素材(画像)、スライダーの形(角丸 / 串団子)
//   チャーム: ボタン・ツールの絵を自分の画像に(look.icons = ITEMS の id → data URL)。スライダーのつまみの絵(look.knob)
//   右のパネルの並び: 並び順と、出す / 出さない(look.panels = { order: [id…], hidden: [id…] })
// 画面に入れるのは applyLook()。ボタンの絵は ui.js の makeItem / makeToolBtn が chargeIcon() を見る
import { emit, toast } from './state.js';
import { openModal, escapeHtml } from './modal.js';

const KEY = 'pixelrig.look';
const DEF = { theme: 'standard', bar: null, pop: null, canvas: null, barImg: null, popImg: null, barTone: null, popTone: null, slider: 'pill', knob: null, icons: {}, panels: { order: [], hidden: [] } };
export const look = structuredClone(DEF);
try { Object.assign(look, JSON.parse(localStorage.getItem(KEY)) || {}); } catch { /* 保存なし */ }

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(look)); } catch { toast('見た目を保存できませんでした(画像が大きすぎるかもしれません)'); }
}

// 右のパネル(フォントのパネルは、フォントのタブだけに出るので、ここでは動かさない)
export const PANELS = [['panel-color', 'カラー'], ['paint-panel', '線と塗り'], ['panel-info', '図形の情報'], ['panel-align', '整列'], ['panel-palette', 'パレット'], ['panel-layers', 'レイヤー']];
const panelOrder = () => {
  const ids = PANELS.map(([id]) => id);
  const o = (look.panels?.order || []).filter((id) => ids.includes(id));
  return [...o, ...ids.filter((id) => !o.includes(id))];
};

// ボタンの絵(チャーム)。なければ null
export function charmIcon(id, size = 22) {
  const url = look.icons?.[id];
  return url ? `<img class="charm-img" alt="" draggable="false" src="${url}" style="width:${size}px;height:${size}px">` : null;
}

// 画像を選んで、max px までに小さくした data URL と、だいたいの色(文字を読める色にするため)を返す
function pickImage(max, type) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files[0];
      if (!file) { resolve(null); return; }
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const one = document.createElement('canvas');
        one.width = one.height = 1;
        const o = one.getContext('2d');
        o.fillStyle = '#808080'; o.fillRect(0, 0, 1, 1);
        o.drawImage(c, 0, 0, 1, 1);
        const d = o.getImageData(0, 0, 1, 1).data;
        URL.revokeObjectURL(img.src);
        resolve({ url: c.toDataURL(type, 0.85), tone: '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('') });
      };
      img.onerror = () => { toast('画像を読めませんでした'); resolve(null); };
      img.src = URL.createObjectURL(file);
    };
    input.click();
  });
}

// 色の明るさを見て、文字・線の色を読めるように作る(明るい色なら、暗い文字)
function tones(hex) {
  const n = parseInt(hex.slice(1, 7), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const dark = (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.55;
  const mix = (k, to) => '#' + [r, g, b].map((v) => Math.round(v + (to - v) * k).toString(16).padStart(2, '0')).join('');
  return dark
    ? { text: '#e3e6ea', muted: '#9aa1ab', p2: mix(0.12, 255), border: mix(0.22, 255), bg: mix(0.28, 0) }
    : { text: '#1b1c1f', muted: '#565b63', p2: mix(0.1, 0), border: mix(0.28, 0), bg: mix(0.4, 255) };
}
function scopeCss(sel, color, img, tone) {
  const t = tones(tone || color || '#25282e');
  return `${sel}{${color ? `--panel:${color};background-color:${color};` : ''}--text:${t.text};--muted:${t.muted};--panel-2:${t.p2};--border:${t.border};--bg:${t.bg};color:${t.text};`
    + `${img ? `background-image:url("${img}") !important;` : ''}}\n`;
}

const BAR_SEL = '#topbar,#tool-options,#toolbar,#tabbar,#timeline,#statusbar,#layout-bar';
const POP_SEL = '#sidebar';

export function applyLook() {
  const root = document.documentElement, k = look;
  root.dataset.theme = k.theme || 'standard';
  root.dataset.slider = k.slider || 'pill';
  root.dataset.knob = k.knob ? '1' : '';
  root.style.setProperty('--knob', k.knob ? `url("${k.knob}")` : 'none');
  let css = '';
  if (k.bar || k.barImg) css += scopeCss(BAR_SEL, k.bar, k.barImg, k.barImg ? k.barTone : null);
  const popColor = k.pop || k.bar, popImg = k.popImg || (k.pop ? null : k.barImg);
  if (popColor || popImg) css += scopeCss(POP_SEL, popColor, popImg, popImg ? (k.popImg ? k.popTone : k.barTone) : null);
  if (k.canvas) css += `#canvas-area{background:${k.canvas}}\n`;
  // 右のパネルの並び(CSS の order)と、出さないパネル
  panelOrder().forEach((id, i) => { css += `#${id}{order:${i + 1}}\n`; });
  for (const id of look.panels?.hidden || []) css += `#${id}{display:none !important}\n`;
  let st = document.getElementById('look-style');
  if (!st) { st = document.createElement('style'); st.id = 'look-style'; document.head.append(st); }
  st.textContent = css;
  emit('look');
}

// ---- 色とデザイン ----
export async function designDialog() {
  const k = structuredClone(look);
  const opt = (list, cur) => list.map(([id, label]) => `<option value="${id}"${id === cur ? ' selected' : ''}>${label}</option>`).join('');
  const body = document.createElement('div');
  body.className = 'form look-dialog';
  body.innerHTML = `
    <label>画面の色合い <select id="lk-theme">${opt([['standard', '標準'], ['dark', '暗い'], ['black', 'もっと暗い(黒)']], k.theme)}</select></label>
    <p class="note">バー(上・左・タブ・タイムライン)と、右のパネルの色を変えられます。パネルは、決めなければバーと同じ色・同じ素材になります。素材は、選んだ画像を敷きつめます(小さな柄の画像が向いています)。文字の色は、明るさに合わせて読める色にします。</p>
    <div class="look-rows"></div>
    <label>スライダーの形 <select id="lk-slider">${opt([['pill', 'ふつう'], ['dango', '串団子(細い棒に、丸い玉)']], k.slider)}</select></label>
    <div class="look-row">つまみの絵(チャーム) <button type="button" id="lk-knob">画像を選ぶ</button><button type="button" id="lk-knob-off">外す</button><i class="charm-view" id="lk-knob-view"></i></div>`;
  const rows = body.querySelector('.look-rows');
  const drawRows = () => {
    rows.textContent = '';
    const colorRow = (key, label, base) => {
      const r = document.createElement('div');
      r.className = 'look-row';
      r.innerHTML = `<label class="check"><input type="checkbox"${k[key] ? ' checked' : ''}>${label}</label><input type="color" value="${k[key] || base}"${k[key] ? '' : ' disabled'}>`;
      const [cb, col] = r.querySelectorAll('input');
      cb.onchange = () => { k[key] = cb.checked ? col.value : null; col.disabled = !cb.checked; };
      col.oninput = () => { k[key] = col.value; };
      rows.append(r);
    };
    const imgRow = (key, label) => {
      const r = document.createElement('div');
      r.className = 'look-row';
      r.innerHTML = `${label} <button type="button">画像を選ぶ</button><button type="button">外す</button><i class="charm-view"></i>`;
      const [pick, off] = r.querySelectorAll('button');
      r.querySelector('i').style.backgroundImage = k[key] ? `url("${k[key]}")` : 'none';
      pick.onclick = async () => { const im = await pickImage(512, 'image/jpeg'); if (im) { k[key] = im.url; k[key === 'barImg' ? 'barTone' : 'popTone'] = im.tone; drawRows(); } };
      off.onclick = () => { k[key] = null; drawRows(); };
      rows.append(r);
    };
    colorRow('bar', '全体(バーとパネル)の色を決める', '#25282e');
    colorRow('pop', '右のパネルだけ、別の色にする', '#2e3239');
    colorRow('canvas', 'キャンバスのまわりの色を決める', '#1d1f24');
    imgRow('barImg', '素材(バー)');
    imgRow('popImg', '素材(右のパネルだけ)');
  };
  drawRows();
  const view = body.querySelector('#lk-knob-view');
  const showKnob = () => { view.style.backgroundImage = k.knob ? `url("${k.knob}")` : 'none'; };
  showKnob();
  body.querySelector('#lk-knob').onclick = async () => { const im = await pickImage(128, 'image/png'); if (im) { k.knob = im.url; showKnob(); } };
  body.querySelector('#lk-knob-off').onclick = () => { k.knob = null; showKnob(); };
  const { value } = await openModal({ title: '色とデザイン', body, width: 520, buttons: [{ label: 'はじめに戻す', value: 'reset' }, { label: 'キャンセル', value: null }, { label: 'OK', value: 'ok', primary: true }] });
  if (value === 'reset') {
    for (const key of ['theme', 'bar', 'pop', 'canvas', 'barImg', 'popImg', 'barTone', 'popTone', 'slider', 'knob']) look[key] = DEF[key];
  } else if (value === 'ok') {
    Object.assign(look, k, { theme: body.querySelector('#lk-theme').value, slider: body.querySelector('#lk-slider').value, icons: look.icons, panels: look.panels });
  } else return;
  save();
  applyLook();
}

// ---- チャーム(ボタンの絵) ----
export async function charmDialog() {
  const { ITEMS } = await import('./baritems.js');
  const { icons } = await import('./icons.js');
  const k = { icons: { ...look.icons }, knob: look.knob };
  const body = document.createElement('div');
  body.className = 'form look-dialog';
  body.innerHTML = `
    <p class="note">「画像を選ぶ」で、そのボタン・ツールの絵を、用意した画像に変えられます(まわりが透明な PNG が向いています)。「戻す」で、はじめの絵に戻ります。絵は小さくして(96 px まで)、このPCに覚えます。</p>
    <div class="charm-list"></div>
    <div class="look-row">スライダーのつまみの絵 <button type="button" id="ch-knob">画像を選ぶ</button><button type="button" id="ch-knob-off">戻す</button><i class="charm-view" id="ch-knob-view"></i></div>`;
  const list = body.querySelector('.charm-list');
  const draw = () => {
    list.textContent = '';
    for (const [id, a] of Object.entries(ITEMS)) {
      if (a.sep) continue;
      const row = document.createElement('div');
      row.className = 'charm-row';
      row.dataset.charm = id;
      const pic = k.icons[id] ? `<img class="charm-img" src="${k.icons[id]}" style="width:22px;height:22px">` : a.tool ? icons[id] : `<b>${escapeHtml(a.text || '')}</b>`;
      row.innerHTML = `<i class="ci">${pic}</i><span>${escapeHtml(a.label || a.text)}</span><button type="button">画像を選ぶ</button><button type="button"${k.icons[id] ? '' : ' disabled'}>戻す</button>`;
      const [pick, off] = row.querySelectorAll('button');
      pick.onclick = async () => { const im = await pickImage(96, 'image/png'); if (im) { k.icons[id] = im.url; draw(); } };
      off.onclick = () => { delete k.icons[id]; draw(); };
      list.append(row);
    }
  };
  draw();
  const view = body.querySelector('#ch-knob-view');
  const showKnob = () => { view.style.backgroundImage = k.knob ? `url("${k.knob}")` : 'none'; };
  showKnob();
  body.querySelector('#ch-knob').onclick = async () => { const im = await pickImage(128, 'image/png'); if (im) { k.knob = im.url; showKnob(); } };
  body.querySelector('#ch-knob-off').onclick = () => { k.knob = null; showKnob(); };
  const { value } = await openModal({ title: 'チャーム(ボタンの絵)', body, width: 640, buttons: [{ label: 'キャンセル', value: null }, { label: 'OK', value: 'ok', primary: true }] });
  if (value !== 'ok') return;
  look.icons = k.icons;
  look.knob = k.knob;
  save();
  applyLook();
  emit('bars'); // ボタンを作り直す(ui.js の drawBars)
}

// ---- 右のパネルの並び ----
export async function panelsDialog() {
  let order = panelOrder();
  const hidden = new Set(look.panels?.hidden || []);
  const body = document.createElement('div');
  body.className = 'form look-dialog';
  body.innerHTML = '<p class="note">右のパネルの並び順と、出す / 出さないを変えられます(▲▼ で動かす。チェックを外すと出しません)。</p><div class="panel-order"></div>';
  const box = body.querySelector('.panel-order');
  const name = Object.fromEntries(PANELS);
  const draw = () => {
    box.textContent = '';
    order.forEach((id, i) => {
      const r = document.createElement('div');
      r.className = 'panel-order-row';
      r.dataset.panel = id;
      r.innerHTML = `<label class="check"><input type="checkbox"${hidden.has(id) ? '' : ' checked'}>${escapeHtml(name[id])}</label><button type="button" class="icon-text"${i ? '' : ' disabled'}>▲</button><button type="button" class="icon-text"${i < order.length - 1 ? '' : ' disabled'}>▼</button>`;
      const [cb] = r.querySelectorAll('input');
      const [up, down] = r.querySelectorAll('button');
      cb.onchange = () => { if (cb.checked) hidden.delete(id); else hidden.add(id); };
      const swap = (j) => { [order[i], order[j]] = [order[j], order[i]]; draw(); };
      up.onclick = () => swap(i - 1);
      down.onclick = () => swap(i + 1);
      box.append(r);
    });
  };
  draw();
  const { value } = await openModal({ title: '右のパネルの並び', body, width: 380, buttons: [{ label: 'はじめに戻す', value: 'reset' }, { label: 'キャンセル', value: null }, { label: 'OK', value: 'ok', primary: true }] });
  if (value === 'reset') look.panels = { order: [], hidden: [] };
  else if (value === 'ok') look.panels = { order, hidden: [...hidden] };
  else return;
  save();
  applyLook();
}
