// 「キャラを作る」ダイアログ(上の「作る ▾」 / ファイル → キャラを作る…)と、キャラを絵に置く処理(Claude 連携からも使う)
//   体型・髪・目・口・服・帽子・持ち物・輪郭・色を選ぶと、右のプレビュー(4方向・アニメ)がすぐ変わる。お手本(剣士など)・ランダム
//   置き方: 新しい絵(64×64。アニメはフレームに)/ 今の絵に新しいレイヤー / 4方向のスプライトシート(新しい絵)
import { state, toast, requestRender, emit } from './state.js';
import { openModal, escapeHtml } from './modal.js';
import { newDocument, RasterLayer, RasterCel } from './document.js';
import { insertLayers } from './layers.js';
import { framesOp } from './timeline.js';
import {
  CHAR_OPTIONS, CHAR_VIEWS, CHAR_ANIMS, CHAR_COLORS, CHAR_PRESETS, CHAR_SIZE,
  characterOptions, renderCharacter, characterSheet, randomCharacter, animFrames,
} from './charmaker.js';

const KEY = 'pixelrig.character';
const DURATION = { none: 100, idle: 260, walk: 150 };

// キャラを置く。place: 'document'(新しい絵)/ 'layer'(今の絵に新しいレイヤー)/ 'sheet'(4方向のシートを新しい絵に)
//   loadDocument は app.js から(新しい絵にするとき)。戻り値 { layer, frames }
export function placeCharacter(opts, { view = 'front', place = 'document', x, y, name, loadDocument } = {}) {
  const o = characterOptions(opts);
  const N = CHAR_SIZE, n = animFrames(o.anim);
  if (place === 'sheet') {
    const img = characterSheet(o);
    const doc = newDocument({ width: img.width, height: img.height });
    const l = new RasterLayer(name || 'キャラ(4方向)');
    doc.layers[0] = l;
    doc.activeId = l.id;
    l.cels[0] = new RasterCel();
    l.cels[0].tiles.putImageData(img, 0, 0);
    loadDocument(doc, null);
    return { layer: l, frames: 1, size: { w: img.width, h: img.height } };
  }
  const layer = new RasterLayer(name || `キャラ(${CHAR_VIEWS[view] || '正面'})`);
  if (place === 'document') {
    const doc = newDocument({ width: N, height: N });
    doc.layers[0] = layer;
    doc.activeId = layer.id;
    doc.frames = Array.from({ length: n }, () => ({ duration: DURATION[o.anim] }));
    for (let f = 0; f < n; f++) { layer.cels[f] = new RasterCel(); layer.cels[f].tiles.putImageData(renderCharacter(o, view, f), 0, 0); }
    loadDocument(doc, null);
    return { layer, frames: n, size: { w: N, h: N } };
  }
  // 今の絵に: アニメのコマ数までフレームを増やす
  const doc = state.doc, a = doc.artboard;
  const X = Math.round(x ?? a.x), Y = Math.round(y ?? a.y);
  if (doc.frames.length < n) framesOp('フレームを増やす', (d) => { while (d.frames.length < n) d.frames.push({ duration: DURATION[o.anim] }); });
  for (let f = 0; f < n; f++) { layer.cels[f] = new RasterCel(); layer.cels[f].tiles.putImageData(renderCharacter(o, view, f), X, Y); }
  insertLayers('キャラを置く', [layer]);
  emit('frames');
  requestRender();
  return { layer, frames: n, size: { w: N, h: N }, x: X, y: Y };
}

function loadLast() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

export async function characterDialog({ loadDocument, confirmUnsaved }) {
  const saved = loadLast();
  let o = characterOptions(saved.opts || {});
  o.anim = saved.opts?.anim || 'walk';
  let view = saved.view || 'front';
  const body = document.createElement('div');
  body.className = 'form char-dialog';
  const sel = (key, labels) => `<label class="ch-f"><span>${escapeHtml(labels.title)}</span><select data-k="${key}">${Object.entries(labels.list).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`).join('')}</select></label>`;
  const T = { body: '体型', hair: '髪型', eyes: '目', mouth: '口', top: '上の服', bottom: '下の服', hat: '帽子', item: '持ち物', outline: '輪郭' };
  body.innerHTML = `
    <div class="ch-presets"><span>お手本</span>${Object.entries(CHAR_PRESETS).map(([k, p]) => `<button type="button" data-preset="${k}">${escapeHtml(p.label)}</button>`).join('')}<button type="button" class="ch-random">🎲 ランダム</button></div>
    <div class="ch-cols">
      <div class="ch-left">
        <div class="ch-grid">${Object.keys(T).map((k) => sel(k, { title: T[k], list: CHAR_OPTIONS[k] })).join('')}
          <label class="ch-f check"><input type="checkbox" class="ch-blush">ほっぺ</label></div>
        <div class="ch-colors">${Object.entries(CHAR_COLORS).map(([k, v]) => `<label class="ch-c"><input type="color" data-c="${k}"><span>${escapeHtml(v)}</span></label>`).join('')}</div>
        <div class="row">
          <label>アニメ <select class="ch-anim">${Object.entries(CHAR_ANIMS).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`).join('')}</select></label>
          <label>向き <select class="ch-view">${Object.entries(CHAR_VIEWS).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`).join('')}</select></label>
        </div>
        <label>置き方 <select class="ch-place">
          <option value="document">新しい絵(64×64・アニメはフレームに)</option>
          <option value="layer">今の絵に新しいレイヤー</option>
          <option value="sheet">4方向 × コマのスプライトシート(新しい絵)</option></select></label>
      </div>
      <div class="ch-right">
        <canvas class="ch-big" width="256" height="256"></canvas>
        <canvas class="ch-views" width="256" height="64"></canvas>
        <p class="note">上 = 選んだ向き(アニメ)、下 = 正面・左・右・後ろ。64×64 ドット</p>
      </div>
    </div>`;
  const q = (c) => body.querySelector(c);
  const sync = () => {
    for (const s of body.querySelectorAll('select[data-k]')) s.value = o[s.dataset.k];
    for (const c of body.querySelectorAll('input[data-c]')) c.value = String(o.colors[c.dataset.c]).slice(0, 7);
    q('.ch-blush').checked = o.blush;
    q('.ch-anim').value = o.anim;
    q('.ch-view').value = view;
    draw();
  };
  const toCanvas = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').putImageData(img, 0, 0); return c; };
  let frame = 0;
  const draw = () => {
    const big = q('.ch-big').getContext('2d');
    big.imageSmoothingEnabled = false;
    big.clearRect(0, 0, 256, 256);
    big.drawImage(toCanvas(renderCharacter(o, view, frame % animFrames(o.anim))), 0, 0, 256, 256);
    const sm = q('.ch-views').getContext('2d');
    sm.imageSmoothingEnabled = false;
    sm.clearRect(0, 0, 256, 64);
    ['front', 'left', 'side', 'back'].forEach((v, i) => sm.drawImage(toCanvas(renderCharacter(o, v, 0)), i * 64, 0));
  };
  for (const s of body.querySelectorAll('select[data-k]')) s.onchange = () => { o = characterOptions({ ...o, [s.dataset.k]: s.value }); draw(); };
  for (const c of body.querySelectorAll('input[data-c]')) c.oninput = () => { o.colors[c.dataset.c] = c.value; draw(); };
  q('.ch-blush').onchange = (e) => { o.blush = e.target.checked; draw(); };
  q('.ch-anim').onchange = (e) => { o.anim = e.target.value; frame = 0; draw(); };
  q('.ch-view').onchange = (e) => { view = e.target.value; draw(); };
  for (const b of body.querySelectorAll('[data-preset]')) b.onclick = () => { o = characterOptions({ preset: b.dataset.preset, anim: o.anim }); sync(); };
  q('.ch-random').onclick = () => { o = characterOptions({ ...randomCharacter(), anim: o.anim }); sync(); };
  q('.ch-place').value = saved.place || 'document';
  sync();
  const timer = setInterval(() => { if (animFrames(o.anim) > 1) { frame++; draw(); } }, o.anim === 'walk' ? 160 : 260);
  const { value } = await openModal({
    title: 'キャラを作る(64×64 ドット)',
    body,
    width: 760,
    buttons: [{ label: 'キャンセル', value: null }, { label: '作る', value: 'ok', primary: true }],
  });
  clearInterval(timer);
  if (value !== 'ok') return null;
  const place = q('.ch-place').value;
  try { localStorage.setItem(KEY, JSON.stringify({ opts: o, view, place })); } catch { /* 保存できなくても動く */ }
  if (place !== 'layer' && !(await confirmUnsaved())) return null;
  const r = placeCharacter(o, { view, place, loadDocument });
  toast(r.frames > 1 ? `キャラを作りました(${r.frames}コマ。Enter で再生)` : 'キャラを作りました');
  return r;
}

