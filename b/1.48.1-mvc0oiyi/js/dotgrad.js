// 「グラデーションでドット化」ダイアログ(右クリックメニューから)
//   選んだ図形(なければ今のレイヤー全体)に pixelGrad(ドットの粗さのグラデーション。pixelfx.js)を付ける。
//   ダイアログの値を動かすとその場で表示が変わる。キャンセルで元に戻す、「外す」でグラデーションをやめる
import { state, requestRender, toast, emit } from './state.js';
import { selectedItems, selectionLayer } from './select.js';
import { pushVector } from './tools.js';
import { propEntry } from './history.js';
import { openModal } from './modal.js';
import { stepToPixel, pixelToStep, pixelLabel, PIXEL_STEPS, gradAngle, hasPixelGrad } from './pixelfx.js';

let last = { from: 2, to: 24, angle: 0, style: 'square', dotFrom: 1, dotTo: 0.25 };
// 向きのボタン(矢印 = 粗くなる向き)
const ARROWS = [['→', 0], ['↘', 45], ['↓', 90], ['↙', 135], ['←', 180], ['↖', 225], ['↑', 270], ['↗', 315]];

export async function pixelGradDialog() {
  const items = selectedItems();
  const layer = items.length ? selectionLayer() : state.doc.activeLayer;
  if (!layer) return;
  if (layer.locked) { toast('レイヤーがロックされています'); return; }
  const onShapes = items.length > 0;
  const ids = new Set(items.map((it) => it.shape.id));
  const before = onShapes ? structuredClone(layer.shapes) : layer.pixelGrad ? { ...layer.pixelGrad } : null;
  const cur = onShapes ? items.find((it) => hasPixelGrad(it.shape.pixelGrad))?.shape.pixelGrad : layer.pixelGrad;
  const g = { ...last, ...(cur || {}) };

  const apply = (v) => {
    if (onShapes) {
      for (const s of layer.shapes) if (ids.has(s.id)) { if (v) s.pixelGrad = { ...v }; else delete s.pixelGrad; }
      layer.touch();
    } else {
      layer.pixelGrad = v ? { ...v } : null;
    }
    requestRender();
  };

  const body = document.createElement('div');
  body.className = 'form dotgrad';
  body.innerHTML = `
    <p class="note">${onShapes ? `選んだ図形(${items.length}個)` : `レイヤー「${layer.name}」全体`}を、場所によって粗さの変わるドットにします。元の形は残るので、あとで外せます。</p>
    <div class="seg"><label><input type="radio" name="dg-style" value="square">四角いドット(粗さが変わる)</label>
      <label><input type="radio" name="dg-style" value="dot">網点(丸いドット。粗さと丸の大きさが変わる)</label></div>
    <label>粗くなる向き <input type="range" class="dg-angle" min="0" max="359" step="1"><input type="number" class="num dg-anum" min="0" max="359" step="1"><em>°</em></label>
    <div class="dg-arrows">${ARROWS.map(([t, a]) => `<button type="button" data-a="${a}" title="${a}°">${t}</button>`).join('')}</div>
    <label>始めの粗さ <input type="range" class="dg-from" min="0" max="${PIXEL_STEPS}"><em class="dg-fv"></em></label>
    <label>終わりの粗さ <input type="range" class="dg-to" min="0" max="${PIXEL_STEPS}"><em class="dg-tv"></em></label>
    <label class="dg-dot">始めの丸の大きさ <input type="range" class="dg-df" min="5" max="100"><em class="dg-dfv"></em></label>
    <label class="dg-dot">終わりの丸の大きさ <input type="range" class="dg-dt" min="0" max="100"><em class="dg-dtv"></em></label>
    <p class="note">粗さを 0 にすると、その端はイラストのまま(そこから少しずつドットになる)。向きは 0° = 左 → 右、90° = 上 → 下。斜めにすると、ドットの並びごとその角度に回ります(網点なら斜めのトーン)。網点のドットは 3px より細かくなりません。丸の大きさ 100% = マスいっぱい。</p>`;
  const q = (s) => body.querySelector(s);
  q(`[name=dg-style][value=${g.style === 'dot' ? 'dot' : 'square'}]`).checked = true;
  q('.dg-angle').value = q('.dg-anum').value = Math.round(gradAngle(g));
  q('.dg-angle').addEventListener('input', () => { q('.dg-anum').value = q('.dg-angle').value; });
  q('.dg-anum').addEventListener('input', () => { q('.dg-angle').value = q('.dg-anum').value; });
  for (const b of body.querySelectorAll('.dg-arrows button')) {
    b.onclick = () => { q('.dg-angle').value = q('.dg-anum').value = b.dataset.a; update(); };
  }
  q('.dg-from').value = pixelToStep(g.from);
  q('.dg-to').value = pixelToStep(g.to);
  q('.dg-df').value = Math.round((g.dotFrom ?? 1) * 100);
  q('.dg-dt').value = Math.round((g.dotTo ?? 0.25) * 100);
  const read = () => ({
    style: q('[name=dg-style]:checked').value, angle: ((Math.round(Number(q('.dg-angle').value)) % 360) + 360) % 360,
    from: stepToPixel(Number(q('.dg-from').value)), to: stepToPixel(Number(q('.dg-to').value)),
    dotFrom: Number(q('.dg-df').value) / 100, dotTo: Number(q('.dg-dt').value) / 100,
  });
  const update = () => {
    const v = read();
    const lab = (px) => (px >= 1 ? pixelLabel(px) : 'イラストのまま');
    q('.dg-fv').textContent = lab(v.from);
    q('.dg-tv').textContent = lab(v.to);
    q('.dg-dfv').textContent = `${Math.round(v.dotFrom * 100)}%`;
    q('.dg-dtv').textContent = `${Math.round(v.dotTo * 100)}%`;
    for (const el of body.querySelectorAll('.dg-dot')) el.style.display = v.style === 'dot' ? '' : 'none';
    apply(v);
  };
  body.addEventListener('input', update);
  body.addEventListener('keydown', (e) => e.stopPropagation());
  update();
  const buttons = [{ label: '外す', value: 'remove' }, { label: 'キャンセル', value: null }, { label: 'OK', value: 'ok', primary: true }];
  if (!hasPixelGrad(cur)) buttons.shift();
  const { value } = await openModal({ title: 'グラデーションでドット化', body, width: 360, buttons, side: true });
  if (value === 'ok') last = read();
  const v = value === 'ok' ? read() : value === 'remove' ? null : 'cancel';
  // いったん元に戻してから、決めた値を1つの履歴として入れる
  if (onShapes) {
    layer.shapes = structuredClone(before);
    layer.touch();
    if (v !== 'cancel') { apply(v); pushVector(v ? 'グラデーションでドット化' : 'ドットのグラデーションを外す', layer, before); }
  } else {
    layer.pixelGrad = before;
    if (v !== 'cancel') {
      apply(v);
      state.history.push(propEntry(v ? 'レイヤーをグラデーションでドット化' : 'ドットのグラデーションを外す', layer, 'pixelGrad', before, layer.pixelGrad));
      emit('layers');
    }
  }
  requestRender();
}
