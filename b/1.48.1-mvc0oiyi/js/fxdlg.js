// 「エフェクト」ダイアログ(レイヤー → エフェクト… / レイヤーパネルの「効果」)
//   今のレイヤーに layer.fx(effects.js)を付ける。お手本・追加・並べ替え・オン/オフ・値を変えると、その場で表示が変わる。
//   OK で1つの履歴、キャンセルで元に戻す。動かすにはフレームが要るので「コマを増やす」「再生」もここから。
//   「絵にする」で効果を新しいラスターレイヤー(後ろ / 前)に焼き込む
import { state, requestRender, toast, emit } from './state.js';
import { openModal, escapeHtml } from './modal.js';
import { RasterLayer, RasterCel, createCanvas } from './document.js';
import { snapshotLayers, layersEntry, propEntry } from './history.js';
import { framesOp, togglePlay, stop } from './timeline.js';
import { FX_TYPES, FX_PRESETS, FX_DOT_MAX, newFxItem, hasFx, normalizeFx } from './effects.js';
import { layerEffects, hasRigBind } from './render.js';
import { rigActive, evalPose } from './rig.js';
import { rigContent } from './rigrender.js';

// 履歴つきでレイヤーのエフェクトを変える(Claude 連携からも使う)
export function setLayerFx(layer, fx, label = 'エフェクト') {
  const before = layer.fx ? structuredClone(layer.fx) : null;
  const after = normalizeFx(fx);
  layer.fx = after;
  state.history.push(propEntry(label, layer, 'fx', before, after ? structuredClone(after) : null));
  emit('layers');
  requestRender();
}

// フレームを n 個以上にする(足りない分は最後のフレームの絵を複製。リグで動くレイヤーは空のまま = 前の絵を使う)
export function ensureFrames(n) {
  const doc = state.doc;
  if (doc.frames.length >= n) return false;
  framesOp(`コマを ${n} に増やす`, (d) => {
    const last = d.frames.length - 1;
    while (d.frames.length < n) {
      d.frames.push({ duration: d.frames[last].duration });
      for (const l of d.layers) {
        const c = l.celAt(last);
        l.cels[d.frames.length - 1] = !l.rigged && c ? c.clone() : undefined;
      }
    }
  });
  return true;
}

// 効果を絵にする: フレームごとの「後ろ」「前」を新しいラスターレイヤーに描く。ゆらゆら(絵そのもの)は絵にできないので残す
export function bakeFx(layer) {
  const doc = state.doc;
  if (!hasFx(layer.fx)) return null;
  stop();
  const mk = (part) => {
    const out = new RasterLayer(`${layer.name} の効果(${part === 'back' ? '後ろ' : '前'})`);
    let any = false;
    for (let f = 0; f < doc.frames.length; f++) {
      const cel = layer.displayCelAt(f);
      if (!cel) continue;
      const pose = rigActive(doc) ? evalPose(doc, f) : null;
      const rc = pose && hasRigBind(layer, cel) ? rigContent(doc, layer, cel, pose) : null;
      const r = layerEffects(doc, layer, cel, rc, f);
      if (!r?.[part]) continue;
      const cv = createCanvas(r.w, r.h);
      const x = cv.getContext('2d');
      x.imageSmoothingEnabled = false;
      x.drawImage(r[part], 0, 0, r.w, r.h);
      const rc2 = new RasterCel();
      rc2.tiles.putImageData(x.getImageData(0, 0, r.w, r.h), r.x, r.y);
      out.cels[f] = rc2;
      any = true;
    }
    return any ? out : null;
  };
  const back = mk('back'), front = mk('front');
  const before = snapshotLayers(doc), fxBefore = structuredClone(layer.fx);
  const i = doc.layers.indexOf(layer);
  doc.layers.splice(i + 1, 0, ...(front ? [front] : []));
  doc.layers.splice(i, 0, ...(back ? [back] : []));
  const rest = layer.fx.items.filter((it) => it.type === 'wave');
  layer.fx = rest.length ? { ...layer.fx, items: rest } : null;
  const after = snapshotLayers(doc), fxAfter = layer.fx ? structuredClone(layer.fx) : null;
  const le = layersEntry('エフェクトを絵にする', doc, before, after);
  state.history.push({
    label: 'エフェクトを絵にする',
    undo: () => { le.undo(); layer.fx = structuredClone(fxBefore); },
    redo: () => { le.redo(); layer.fx = fxAfter ? structuredClone(fxAfter) : null; },
  });
  emit('layers');
  requestRender();
  return { back, front };
}

let lastPreset = 'ki';

export async function fxDialog() {
  const doc = state.doc;
  const layer = doc?.activeLayer;
  if (!layer) return;
  if (layer.locked) { toast('レイヤーがロックされています'); return; }
  const before = layer.fx ? structuredClone(layer.fx) : null;
  let fx = before ? structuredClone(before) : { dot: 1, items: [] };
  const apply = () => { layer.fx = fx.items.length ? structuredClone(fx) : null; emit('layers'); requestRender(); }; // layers: 印・フレームの小さな絵も更新

  const body = document.createElement('div');
  body.className = 'form fx-dialog';
  const typeOpts = Object.entries(FX_TYPES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  const presetOpts = Object.entries(FX_PRESETS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  body.innerHTML = `
    <p class="note">レイヤー「${escapeHtml(layer.name)}」の絵の形に合わせて効果を付けます。元の絵はそのままで、あとで外せます。
      効果はフレームごとに動き、最後のフレームで最初につながります(GIF・スプライトシートにもそのまま出ます)。</p>
    <div class="fx-row"><label>お手本 <select class="fx-preset">${presetOpts}</select></label><button type="button" class="fx-use">使う</button></div>
    <div class="fx-list"></div>
    <div class="fx-row"><label>効果を足す <select class="fx-type">${typeOpts}</select></label><button type="button" class="fx-add">＋ 追加</button></div>
    <label>ドットの大きさ <input type="range" class="fx-dot" min="1" max="${FX_DOT_MAX}" step="1"><em class="fx-dotv"></em></label>
    <h3 class="form-sec">動き</h3>
    <p class="note fx-frames"></p>
    <div class="fx-row"><select class="fx-n">${[4, 6, 8, 12, 16].map((n) => `<option value="${n}"${n === 8 ? ' selected' : ''}>${n} コマ</option>`).join('')}</select>
      <button type="button" class="fx-more">コマを増やす</button><button type="button" class="fx-play">▶ 再生 / ■ 停止</button></div>`;
  const q = (s) => body.querySelector(s);
  q('.fx-preset').value = lastPreset;
  const list = q('.fx-list');

  const showFrames = () => {
    const n = doc.frames.length;
    q('.fx-frames').textContent = n > 1
      ? `今のフレーム数は ${n}。効果は ${n} コマで一周します(速さ = 一周の間に何回動くか)。`
      : '今はフレームが 1つなので、効果は止まった絵です。動かすには「コマを増やす」でフレームを足してください(今の絵を複製します)。';
  };

  const field = (it, i, p) => {
    const [k, label, min, max, step] = p;
    const id = `fx-${i}-${k}`;
    if (k === 'color') return `<label>${label} <input type="color" data-i="${i}" data-k="${k}" value="${it[k]}"></label>`;
    if (Array.isArray(min)) {
      return `<label>${label} <select data-i="${i}" data-k="${k}">${min.map(([v, t]) => `<option value="${v}"${it[k] === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>`;
    }
    return `<label>${label} <input type="range" id="${id}" data-i="${i}" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${it[k]}"><em>${fmt(it[k], step)}</em></label>`;
  };
  const fmt = (v, step) => (step < 1 ? String(Math.round(v * 100) / 100) : String(v));

  const renderList = () => {
    list.innerHTML = fx.items.length ? '' : '<p class="note">効果はまだありません。お手本を使うか、下で追加してください。</p>';
    fx.items.forEach((it, i) => {
      const t = FX_TYPES[it.type];
      const card = document.createElement('div');
      card.className = 'fx-card' + (it.on === false ? ' off' : '');
      card.innerHTML = `
        <div class="fx-head"><label class="check"><input type="checkbox" data-i="${i}" data-k="on"${it.on === false ? '' : ' checked'}><b>${t.label}</b></label>
          <span class="fx-btns"><button type="button" data-up="${i}" title="上へ(先に描く)">▲</button><button type="button" data-down="${i}" title="下へ(あとに描く)">▼</button>
          <button type="button" data-del="${i}" class="danger" title="外す">×</button></span></div>
        <p class="note">${t.note}</p>
        ${t.params.map((p) => field(it, i, p)).join('')}
        ${'front' in t.defaults ? `<label class="check"><input type="checkbox" data-i="${i}" data-k="front"${it.front === false ? '' : ' checked'}>体の前にも描く</label>` : ''}`;
      list.append(card);
    });
  };

  list.addEventListener('input', (e) => {
    const el = e.target, i = Number(el.dataset.i), k = el.dataset.k;
    if (!k || !fx.items[i]) return;
    const it = fx.items[i];
    if (el.type === 'checkbox') it[k] = el.checked;
    else if (el.type === 'range') { it[k] = Number(el.value); el.nextElementSibling.textContent = fmt(it[k], Number(el.step)); }
    else it[k] = el.value;
    if (k === 'on') el.closest('.fx-card').classList.toggle('off', !el.checked);
    apply();
  });
  list.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.del != null) fx.items.splice(Number(d.del), 1);
    else if (d.up != null && Number(d.up) > 0) { const i = Number(d.up); [fx.items[i - 1], fx.items[i]] = [fx.items[i], fx.items[i - 1]]; }
    else if (d.down != null && Number(d.down) < fx.items.length - 1) { const i = Number(d.down); [fx.items[i + 1], fx.items[i]] = [fx.items[i], fx.items[i + 1]]; }
    else return;
    renderList();
    apply();
  });
  q('.fx-use').onclick = () => {
    lastPreset = q('.fx-preset').value;
    fx.items = FX_PRESETS[lastPreset].items.map(({ type, ...o }) => newFxItem(type, o));
    renderList();
    apply();
  };
  q('.fx-add').onclick = () => {
    fx.items.push(newFxItem(q('.fx-type').value));
    renderList();
    apply();
  };
  q('.fx-dot').value = fx.dot || 1;
  const showDot = () => { q('.fx-dotv').textContent = `${fx.dot} px`; };
  q('.fx-dot').addEventListener('input', () => { fx.dot = Number(q('.fx-dot').value); showDot(); apply(); });
  q('.fx-more').onclick = () => { if (!ensureFrames(Number(q('.fx-n').value))) toast('もうそのくらいのフレームがあります'); showFrames(); requestRender(); };
  q('.fx-play').onclick = () => togglePlay();
  body.addEventListener('keydown', (e) => e.stopPropagation());
  renderList();
  showDot();
  showFrames();
  if (!fx.items.length) q('.fx-use').click(); // はじめはお手本を1つ入れて、何が起きるか見えるように

  const buttons = [{ label: '絵にする', value: 'bake' }, { label: 'すべて外す', value: 'remove' }, { label: 'キャンセル', value: null }, { label: 'OK', value: 'ok', primary: true }];
  const { value } = await openModal({ title: 'エフェクト', body, width: 380, buttons, side: true });
  stop();
  // いったん元に戻してから、決めた値を1つの履歴として入れる
  layer.fx = before ? structuredClone(before) : null;
  if (value === 'ok' || value === 'bake') setLayerFx(layer, fx.items.length ? fx : null, fx.items.length ? 'エフェクト' : 'エフェクトを外す');
  else if (value === 'remove' && before) setLayerFx(layer, null, 'エフェクトを外す');
  if (value === 'bake' && hasFx(layer.fx)) {
    const r = bakeFx(layer);
    toast(r && (r.back || r.front) ? '効果を新しいレイヤーにしました' : '絵にできる効果がありませんでした');
  }
  requestRender();
}
