// 「テクスチャを作る」ダイアログ(ファイル → テクスチャを作る… / 上の「作る ▾」)
//   種類・大きさ・種(シード)・模様の大きさ・色・目地の色・継ぎ目なし・色の段数・ドットの大きさを選ぶと、右のプレビューがすぐ変わる。
//   プレビューは 2×2 に並べて見せる(継ぎ目の確認用)。作ると新しいラスターレイヤーに置く(1枚 / アートボードに敷き詰め)
import { state, toast, requestRender } from './state.js';
import { openModal } from './modal.js';
import { RasterLayer } from './document.js';
import { insertLayers } from './layers.js';
import { TEXTURE_TYPES, makeTexture, textureOptions, tileImage } from './texture.js';
import { toHex, parseHex } from './color.js';

const KEY = 'pixelrig.texture';
let last = null;
function loadLast() {
  if (last) return last;
  try { last = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { last = {}; }
  return last;
}

// テクスチャを新しいラスターレイヤーに置く。fill = アートボード全体に敷き詰め。戻り値は作ったレイヤー
export function placeTexture(img, { fill = false, name, x, y } = {}) {
  const doc = state.doc, a = doc.artboard;
  const layer = new RasterLayer(name || `テクスチャ ${doc.nextLayerName().replace(/\D+/g, '')}`.trim());
  if (fill) layer.putImageData(tileImage(img, a.w, a.h), a.x, a.y);
  else layer.putImageData(img, Math.round(x ?? a.x), Math.round(y ?? a.y));
  insertLayers('テクスチャを作る', [layer]);
  requestRender();
  return layer;
}

export async function textureDialog() {
  const saved = loadLast();
  let o = textureOptions({ ...saved, colors: saved.type && saved.colors ? saved.colors : undefined });
  const body = document.createElement('div');
  body.className = 'form tex-dialog';
  body.innerHTML = `
    <div class="tex-cols">
      <div class="tex-left">
        <label>種類 <select class="t-type">${Object.entries(TEXTURE_TYPES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></label>
        <div class="row">
          <label>幅 <input type="number" class="t-w num" min="1" max="4096"> px</label>
          <label>高さ <input type="number" class="t-h num" min="1" max="4096"> px</label>
        </div>
        <div class="tex-sizes"></div>
        <label>種 <input type="number" class="t-seed num" min="0"><button type="button" class="t-dice" title="別の模様にする">🎲 ほかの模様</button></label>
        <label>模様の大きさ <input type="range" class="t-scale" min="0.25" max="16" step="0.05"><em class="t-scale-v"></em></label>
        <div class="tex-colors-row"><span>色(暗い → 明るい)</span><div class="t-colors"></div>
          <button type="button" class="t-add" title="色を足す">+</button><button type="button" class="t-del" title="最後の色を消す">−</button>
          <button type="button" class="t-reset" title="この種類のはじめの色に戻す">元の色</button></div>
        <label class="t-mortar-row">目地の色 <input type="color" class="t-mortar"></label>
        <label class="check"><input type="checkbox" class="t-seamless">継ぎ目なし(並べてもつながる)</label>
        <label>色の段数 <input type="number" class="t-levels num" min="0" max="32"> <span class="note">0 = なめらか / 4 など = ドット絵向けにくっきり</span></label>
        <label>ドットの大きさ <input type="number" class="t-pixel num" min="1" max="64"> px <span class="note">1 = そのまま / 2 以上 = ドット絵風</span></label>
        <label>置き方 <select class="t-place"><option value="one">1枚(アートボードの左上)</option><option value="fill">アートボード全体に敷き詰める</option></select></label>
      </div>
      <div class="tex-right">
        <canvas class="t-preview" width="256" height="256"></canvas>
        <p class="note">2×2 に並べて表示しています(継ぎ目の確認用)</p>
      </div>
    </div>`;
  const q = (c) => body.querySelector(c);
  const sizes = q('.tex-sizes');
  for (const n of [16, 32, 64, 128, 256, 512]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${n}`;
    b.onclick = () => { o.width = n; o.height = n; sync(); };
    sizes.append(b);
  }
  const colorsBox = q('.t-colors');
  const drawColors = () => {
    colorsBox.innerHTML = '';
    o.colors.forEach((c, i) => {
      const inp = document.createElement('input');
      inp.type = 'color';
      inp.value = toHex(parseHex(c));
      inp.oninput = () => { o.colors[i] = inp.value; update(); };
      colorsBox.append(inp);
    });
  };
  const sync = () => {
    q('.t-type').value = o.type;
    q('.t-w').value = o.width; q('.t-h').value = o.height;
    q('.t-seed').value = o.seed;
    q('.t-scale').value = o.scale; q('.t-scale-v').textContent = `×${Number(o.scale).toFixed(2)}`;
    q('.t-mortar').value = toHex(parseHex(o.mortar));
    q('.t-mortar-row').hidden = !TEXTURE_TYPES[o.type].mortar;
    q('.t-seamless').checked = o.seamless;
    q('.t-levels').value = o.levels;
    q('.t-pixel').value = o.pixel;
    drawColors();
    update();
  };
  let img = null;
  const update = () => {
    o = textureOptions(o);
    // 大きいテクスチャは、プレビューだけ縮めて作る(形は同じ)
    const k = Math.min(1, 256 / Math.max(o.width, o.height));
    img = makeTexture(k < 1 ? { ...o, width: Math.max(1, Math.round(o.width * k)), height: Math.max(1, Math.round(o.height * k)), pixel: Math.max(1, Math.round(o.pixel * k)) } : o);
    const c = q('.t-preview'), ctx = c.getContext('2d');
    const tmp = document.createElement('canvas');
    tmp.width = img.width; tmp.height = img.height;
    tmp.getContext('2d').putImageData(img, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.imageSmoothingEnabled = false;
    const cell = c.width / 2;
    const s = Math.min(cell / img.width, cell / img.height);
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) ctx.drawImage(tmp, (cell - img.width * s) + i * img.width * s, (cell - img.height * s) + j * img.height * s, img.width * s, img.height * s);
  };
  q('.t-type').onchange = (e) => { o.type = e.target.value; o.colors = [...TEXTURE_TYPES[o.type].colors]; o.mortar = TEXTURE_TYPES[o.type].mortar || o.mortar; sync(); };
  q('.t-w').onchange = (e) => { o.width = +e.target.value; sync(); };
  q('.t-h').onchange = (e) => { o.height = +e.target.value; sync(); };
  q('.t-seed').onchange = (e) => { o.seed = +e.target.value; sync(); };
  q('.t-dice').onclick = () => { o.seed = Math.floor(Math.random() * 100000); sync(); };
  q('.t-scale').oninput = (e) => { o.scale = +e.target.value; q('.t-scale-v').textContent = `×${o.scale.toFixed(2)}`; update(); };
  q('.t-mortar').oninput = (e) => { o.mortar = e.target.value; update(); };
  q('.t-seamless').onchange = (e) => { o.seamless = e.target.checked; update(); };
  q('.t-levels').onchange = (e) => { o.levels = +e.target.value; sync(); };
  q('.t-pixel').onchange = (e) => { o.pixel = +e.target.value; sync(); };
  q('.t-add').onclick = () => { if (o.colors.length < 16) { o.colors.push(o.colors[o.colors.length - 1]); sync(); } };
  q('.t-del').onclick = () => { if (o.colors.length > 1) { o.colors.pop(); sync(); } };
  q('.t-reset').onclick = () => { o.colors = [...TEXTURE_TYPES[o.type].colors]; o.mortar = TEXTURE_TYPES[o.type].mortar || o.mortar; sync(); };
  q('.t-place').value = saved.place === 'fill' ? 'fill' : 'one';
  sync();
  const { value } = await openModal({
    title: 'テクスチャを作る',
    body,
    width: 720,
    buttons: [{ label: 'キャンセル', value: null }, { label: '作る', value: 'ok', primary: true }],
  });
  if (value !== 'ok') return null;
  const place = q('.t-place').value;
  last = { ...o, place };
  try { localStorage.setItem(KEY, JSON.stringify(last)); } catch { /* 保存できなくても動く */ }
  const full = makeTexture(o);
  const layer = placeTexture(full, { fill: place === 'fill', name: `テクスチャ(${TEXTURE_TYPES[o.type].label})` });
  toast(`テクスチャを「${layer.name}」に置きました`);
  return layer;
}
