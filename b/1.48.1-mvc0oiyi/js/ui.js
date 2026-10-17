// 画面の各パネル(ツールバー・ツールオプション・カラー・パレット・レイヤー・ステータスバー)
import { applySwatch, getPaintTarget } from './paint.js';
import { prefs } from './prefs.js';
import { startPick, PICK_ICON } from './tools.js';
import { state, on, emit, requestRender, toast, isPixelMode, modeKey } from './state.js';
import { icons, TOOL_DEFS } from './icons.js';
import { toHex, toHex8, toCss, parseHex, isValidHex, clamp } from './color.js';
import {
  selectedItems, deleteSelection, reorderSelection, groupSelection, ungroupSelection,
  currentPixel, setPixelLive,
} from './select.js';
import { applyTransform, cancelTransform } from './transform.js';
import { flip, hasCustomPivot, resetPivot } from './reflect.js';
import { renderRigOptions } from './rigtool.js';
import { outlineSelection, borderDialog } from './outline.js';
import { setActiveLayer, toggleVisible, toggleLock, renameLayer, commitOpacity } from './layers.js';
import { escapeHtml } from './modal.js';
import { fileName } from './io.js';
import { initPaintPanel } from './paint.js';
import { initAlignPanel } from './align.js';
import { initShapeInfoPanel } from './shapeinfo.js';
import { renderTextOptions, hasTextSelection } from './texttool.js';
import { initLayout } from './layout.js';
import { initRecentPanel } from './recent.js';
import { PIXEL_STEPS, stepToPixel, pixelToStep, pixelLabel } from './pixelfx.js';
import { FX_TYPES } from './effects.js';
import { traceDialog } from './trace.js';
import { ITEMS } from './baritems.js';
import { initBarLayout } from './barlayout.js';
import { charmIcon, applyLook } from './look.js';
import { measureInfo } from './guides.js';

// ツールの絵(チャームで自分の画像にしてあれば、それ)
const toolPic = (id) => charmIcon(id, 22) || icons[id];

const $ = (id) => document.getElementById(id);

export function initUI(setTool) {
  pickTool = setTool;
  applyLook();
  drawBars();
  initBarLayout(drawBars);
  on('bars', drawBars); // チャームを変えたとき
  on('measure', showMeasure);
  initColorPanel();
  // カラーパネルのメイン / サブの色(2色の四角)は設定でオンのときだけ
  document.body.classList.toggle('show-color-pair', !!prefs.showColorPair);
  // カラーパネルのスポイト: 拾った色は、図形を選んでいれば「線と塗り」で選んでいる方、なければメイン色に
  const pick = document.getElementById('btn-pick');
  if (pick) { pick.innerHTML = PICK_ICON; pick.onclick = (e) => { e.preventDefault(); startPick(selectedItems().length ? getPaintTarget() : 'stroke'); }; }
  initPalette();
  initLayerPanel();
  initPaintPanel();
  initShapeInfoPanel();
  initAlignPanel();
  initRecentPanel();
  initLayout();

  on('tool', () => { updateToolbar(); renderToolOptions(); });
  on('colors', updateColors);
  on('palette', renderPalette);
  on('layers', renderLayers);
  on('selection', () => { if (['move', 'transform', 'reflect', 'rig', 'text'].includes(state.tool)) renderToolOptions(); });
  on('pixel', () => { if (state.tool === 'move' && !document.activeElement?.closest?.('#tool-options')) renderToolOptions(); });
  on('zoom', updateZoom);
  on('history', updateHistoryButtons);
  on('title', updateTitle);
  on('cursor', updateStatus);
  on('artboard', updateStatus);
  on('rig', () => { renderLayers(); requestRender(); });
  on('frame', () => { if (state.tool === 'rig') renderToolOptions(); });
  on('doc-settings', () => { updateStatus(); requestRender(); });
  on('toast', showToast);
  on('doc', () => {
    renderToolOptions();
    renderPalette();
    renderLayers();
    updateColors();
    updateZoom();
    updateTitle();
    updateHistoryButtons();
    updateStatus();
  });
}

// ---- 上のバーとツールバー(prefs.topbar / prefs.toolbar の並びで作る。並びは、レイアウト(barlayout.js)で自由に変えられる) ----
// 置けるものは baritems.js の ITEMS(ツール・ボタン・区切りの線)

let pickTool = () => {};
const BARS = { topbar: 'topbar-actions', toolbar: 'toolbar' };

function makeItem(id) {
  const a = ITEMS[id];
  if (!a) return null;
  if (a.sep) { const s = document.createElement('span'); s.className = 'bar-sep'; return s; }
  if (a.tool) return makeToolBtn(TOOL_DEFS.find((t) => t.id === id), pickTool);
  const b = document.createElement('button');
  b.className = 'bar-btn' + (a.cls ? ' ' + a.cls : '');
  b.dataset.action = id; // 押したときの中身は app.js(data-action のボタンをまとめて受けている)
  if (a.id) b.id = a.id;
  b.title = a.hint || a.label || a.text;
  const charm = charmIcon(id, 22);
  if (charm) { b.innerHTML = charm; b.classList.add('has-charm'); b.title = (a.label || a.text) + ' — ' + b.title; } // チャーム(自分の画像)
  else b.textContent = id === 'fontMode' && document.body.classList.contains('font-mode') ? 'フォント作成を終わる' : a.text;
  return b;
}

export function drawBars() {
  for (const [zone, boxId] of Object.entries(BARS)) {
    const box = $(boxId);
    for (const el of [...box.children]) if (el.dataset.item !== undefined) el.remove();
    const tail = box.firstElementChild; // 並びの外のもの(Web 版のメニューのボタンなど)は、うしろに残す
    prefs[zone].forEach((id, i) => {
      const el = makeItem(id);
      if (!el) return;
      el.dataset.item = id;
      el.dataset.idx = i;
      box.insertBefore(el, tail);
    });
  }
  updateToolbar();
  updateHistoryButtons();
}

function makeToolBtn(t, setTool) {
  const b = document.createElement('button');
  b.className = 'tool-btn';
  b.dataset.tool = t.id;
  b.title = `${t.label} (${t.key})`;
  b.innerHTML = toolPic(t.id);
  b.onclick = () => { if (!b.dataset.held) setTool(b.dataset.tool); delete b.dataset.held; };
  const members = TOOL_DEFS.filter((x) => x.group === t.id);
  if (members.length) {
    // 長押し(または右クリック)で、同じ仲間のツールを選ぶタブを出す(イラレと同じ)
    b.classList.add('has-group');
    let timer = 0;
    const open = () => { b.dataset.held = '1'; openToolGroup(b, [t, ...members], setTool); };
    b.addEventListener('pointerdown', (e) => { if (e.button === 0) timer = setTimeout(open, 350); });
    for (const ev of ['pointerup', 'pointerleave']) b.addEventListener(ev, () => clearTimeout(timer));
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); open(); });
  }
  return b;
}

function openToolGroup(btn, defs, setTool) {
  document.getElementById('tool-group')?.remove();
  const box = document.createElement('div');
  box.id = 'tool-group';
  for (const t of defs) {
    const item = document.createElement('button');
    item.className = 'tool-group-item' + (state.tool === t.id ? ' on' : '');
    item.innerHTML = `${icons[t.id]}<span>${escapeHtml(t.label.replace(/\s*[(（].*$/, ''))}</span>`;
    item.title = t.label;
    item.onclick = () => { close(); btn.dataset.tool = t.id; btn.innerHTML = icons[t.id]; btn.title = `${t.label} (${t.key})`; delete btn.dataset.held; setTool(t.id); };
    box.append(item);
  }
  document.body.append(box);
  const r = btn.getBoundingClientRect();
  box.style.left = `${r.right + 4}px`;
  box.style.top = `${r.top}px`;
  const close = () => { box.remove(); document.removeEventListener('pointerdown', outside, true); };
  const outside = (e) => { if (!box.contains(e.target)) { close(); setTimeout(() => delete btn.dataset.held); } };
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
}

function updateToolbar() {
  for (const b of document.querySelectorAll('.tool-btn')) {
    // 仲間のツール(ダイレクト選択など)を使っているときは、そのボタンの絵を切り替える
    const def = TOOL_DEFS.find((t) => t.id === state.tool);
    if (def?.group && b.dataset.tool !== state.tool && TOOL_DEFS.find((t) => t.id === b.dataset.tool)?.id === def.group) {
      b.dataset.tool = def.id; b.innerHTML = toolPic(def.id); b.title = `${def.label} (${def.key})`;
    } else if (state.tool === 'move' && b.dataset.tool === 'direct') {
      const m = TOOL_DEFS.find((t) => t.id === 'move');
      b.dataset.tool = 'move'; b.innerHTML = toolPic('move'); b.title = `${m.label} (${m.key})`;
    }
    b.classList.toggle('active', b.dataset.tool === state.tool);
  }
}

// ---- ツールオプション ----

// commitOnly: スライダー操作中は反映せず、離したときだけ onChange(Undo履歴を積む操作用)
function numberField(label, value, min, max, onChange, commitOnly = false) {
  const step = 1;
  const wrap = document.createElement('label');
  wrap.className = 'opt';
  wrap.innerHTML = `<span>${label}</span>`;
  const range = document.createElement('input');
  range.type = 'range';
  Object.assign(range, { min, max, step, value });
  const num = document.createElement('input');
  num.type = 'number';
  Object.assign(num, { min, max, step, value });
  num.className = 'num';
  const set = (v) => {
    v = clamp(Number(v) || min, min, max);
    range.value = num.value = v;
    onChange(v);
  };
  if (commitOnly) {
    range.oninput = () => { num.value = range.value; };
    range.onchange = () => set(range.value);
  } else {
    range.oninput = () => set(range.value);
  }
  num.onchange = () => set(num.value);
  wrap.append(range, num);
  return wrap;
}

// ドット化の粗さ: 0〜192 段階(1段階目は 1px のほとんど分からないギザギザ、192 段階で 64px)
function pixelSlider(label) {
  const wrap = document.createElement('label');
  wrap.className = 'opt';
  wrap.title = '左端 = なし。少しずつ右へ動かすと、ほとんど分からない細かいギザギザから粗いドットになります(192段階)。Alt+ホイール・右クリックメニューでも変えられます';
  wrap.innerHTML = `<span>${label}</span>`;
  const range = document.createElement('input');
  range.type = 'range';
  Object.assign(range, { min: 0, max: PIXEL_STEPS, step: 1, value: pixelToStep(currentPixel()) });
  range.className = 'pixel-range';
  const em = document.createElement('em');
  em.className = 'pixel-val';
  const show = () => { em.textContent = pixelLabel(stepToPixel(Number(range.value))); };
  show();
  range.oninput = () => { setPixelLive(stepToPixel(Number(range.value))); show(); };
  wrap.append(range, em);
  return wrap;
}

function checkField(label, checked, onChange) {
  const wrap = document.createElement('label');
  wrap.className = 'opt check';
  const c = document.createElement('input');
  c.type = 'checkbox';
  c.checked = checked;
  c.onchange = () => onChange(c.checked);
  wrap.append(c, document.createTextNode(label));
  return wrap;
}

function button(label, onClick, title) {
  const b = document.createElement('button');
  b.textContent = label;
  if (title) b.title = title;
  if (onClick) b.onclick = () => onClick();
  return b;
}

function hint(text) {
  const s = document.createElement('span');
  s.className = 'opt-hint';
  s.textContent = text;
  return s;
}

// 画像(ラスター)のレイヤーを選んでいるとき: 「トレース…」(色の境目を線のパスに。trace.js)
const canTrace = (layer) => layer?.type === 'raster' && layer.tiles.size > 0;
function traceButton() {
  const b = button('トレース…', traceDialog, 'この画像の色の境目をなぞって、線のパス(ベクターレイヤー)にする');
  b.classList.add('trace-btn');
  return b;
}

// ものさしで測った値(距離・角度・幅・高さ)
function showMeasure() {
  const el = $('measure-info'), m = measureInfo();
  if (!el || !m) return;
  el.textContent = `距離 ${m.dist.toFixed(1)} px ・ 角度 ${m.ang.toFixed(1)}° ・ 幅 ${m.dx.toFixed(1)} ・ 高さ ${m.dy.toFixed(1)} ・ 始まり (${Math.round(m.x)}, ${Math.round(m.y)})`;
}

export function renderToolOptions() {
  const box = $('tool-options');
  box.innerHTML = '';
  if (!state.doc) return;
  const o = state.opts;
  const mk = modeKey();
  const maxSize = isPixelMode() ? 32 : 200;
  const t = state.tool;
  const layer = state.doc.activeLayer;
  const isVec = layer?.type === 'vector';

  if (t === 'pen' || t === 'eraser') {
    box.append(numberField('サイズ', o.size[t][mk], 1, maxSize, (v) => { o.size[t][mk] = v; requestRender(); }));
    if (isVec) box.append(hint(t === 'pen' ? 'ベクター: フリーハンドの線を図形として追加' : 'ベクター: 触れた図形を削除'));
    else box.append(hint('Shift+クリックで前回の点から直線 / 右クリックでサブカラー'));
  } else if (t === 'fill') {
    // あいまいな塗り(Kaiju のバケツと同じ): 隙間閉じ・線へのはみ出し・色の許容
    const f = (label, key, max, title) => { const el = numberField(label, o[key], 0, max, (v) => { o[key] = v; }); el.title = title; el.classList.add('narrow'); return el; };
    box.append(
      f('隙間閉じ', 'fillGap', 100, '線が完全にくっついていなくても、切れ目がこの幅(px)より狭ければ、そこからもれずに塗れる。0 = なし'),
      f('線へのはみ出し', 'fillExpand', 20, '塗る範囲をこれだけ(px)広げて、線の下にもぐらせる(線とのあいだにすき間が残らない)'),
      f('色の許容', 'tolerance', 255, '大きいほど、似た色まで広く塗る'),
    );
    const ref = checkField('見えている絵ぜんぶを境目に', o.fillRef !== 'layer', (v) => { o.fillRef = v ? 'canvas' : 'layer'; });
    ref.title = 'オン: ほかのレイヤーの線も境目にする / オフ: 今のレイヤーの絵だけを境目にする';
    box.append(ref);
    if (!isVec) box.append(checkField('隣接ピクセルのみ', o.contiguous, (v) => { o.contiguous = v; }));
    const tip = hint(isVec ? '図形か、線で囲まれた所をクリック / Shift: 線の色' : '右クリックでサブカラー');
    tip.title = 'ベクター: 図形をクリックすると、その図形の塗りの色を変えます(塗りなしの形・グループの中も可)。図形のない所・ペンの線で囲んだ所をクリックすると、囲まれた所を塗りのパスとして作り、線の下に置きます';
    box.append(tip);
  } else if (t === 'bend') {
    box.append(hint('パスの線の上をドラッグして曲げる / Shift: ぴったりの円弧(半円など) / Alt+クリック: まっすぐに戻す / 2つの図形の辺を1本ずつクリック: なめらかにつないで1つに(Esc でやめる)'));
  } else if (t === 'measure') {
    // ものさし(guides.js): 測った値をここに出す
    const info = hint('2点をドラッグして測る / Shift: 45°ずつ');
    info.id = 'measure-info';
    box.append(info);
    showMeasure();
  } else if (t === 'eyedropper') {
    box.append(checkField('全レイヤーから取得', o.sampleMerged, (v) => { o.sampleMerged = v; }));
    box.append(hint('右クリックでサブカラーに取得 / 描画ツール中は Alt+クリック'));
  } else if (['line', 'rect', 'ellipse', 'polygon', 'path'].includes(t)) {
    if (t !== 'line') {
      box.append(checkField('線(メイン色)', o.shapeStroke, (v) => { o.shapeStroke = v; requestRender(); }));
      box.append(checkField('塗り(サブ色)', o.shapeFill, (v) => { o.shapeFill = v; requestRender(); }));
    }
    box.append(numberField('線幅', o.strokeWidth[mk], 1, isPixelMode() ? 16 : 100, (v) => { o.strokeWidth[mk] = v; requestRender(); }));
    if (t === 'polygon') {
      box.append(numberField('角の数', o.polygonSides, 3, 20, (v) => { o.polygonSides = v; }));
      box.append(hint('中心からドラッグ / ドラッグ中に ↑↓ キー・ホイールで角の数 / Shift: 上向きにそろえる'));
    } else if (t === 'path') box.append(hint('クリック: 角 / ドラッグ: 曲線 / 始点クリック: 閉じる / Enter: 確定 / Esc: 取消'));
    else box.append(hint(t === 'line' ? 'Shift: 45°単位' : 'Shift: 正方形・正円 / Alt: 中心から'));
  } else if (t === 'text') {
    renderTextOptions(box);
    box.append(hint('クリックで入力 / 文字をクリックで書き直し / Esc で終わる。色は右の「線と塗り」'));
  } else if (t === 'move') {
    const items = selectedItems();
    // ドット化の粗さ(選択中の図形、なければアクティブレイヤー)
    const pixelField = pixelSlider(items.length ? 'ドット化' : 'レイヤーのドット化');
    if (items.length) {
      box.append(
        hint(`${items.length}個 選択中(色・線幅は右の「線と塗り」)`),
        pixelField,
        button('グループ化', groupSelection, 'Ctrl+G'),
        button('解除', ungroupSelection, 'Ctrl+Shift+G'),
        button('左右反転', () => flip('h'), '選んだ図形を左右に反転(中心で)'),
        button('上下反転', () => flip('v'), '選んだ図形を上下に反転(中心で)'),
        button('アウトライン化', outlineSelection, '線を塗りの図形に変換 (Ctrl+Shift+O)'),
        button('縁取り…', borderDialog, '選んだ図形全体の外形に縁取りを作る (Ctrl+Shift+B)'),
        button('最前面へ', () => reorderSelection('front'), 'いちばん上へ (Ctrl+Shift+])'),
        button('前面へ', () => reorderSelection(1), '1つ上へ (Ctrl+])'),
        button('背面へ', () => reorderSelection(-1), '1つ下へ (Ctrl+[)'),
        button('最背面へ', () => reorderSelection('back'), 'いちばん下へ (Ctrl+Shift+[)'),
        button('削除', () => deleteSelection(), 'Delete'),
      );
      if (hasTextSelection()) renderTextOptions(box);
    } else {
      box.append(
        hint(isVec
          ? 'クリックで選択 / Shift+クリックで追加 / ドラッグで範囲選択 / Alt+ホイール・右クリックでドット化'
          : '図形をクリックで選択 / 何もない所のドラッグでレイヤー全体を移動'),
        pixelField,
      );
      if (canTrace(layer)) box.append(traceButton());
    }
  } else if (t === 'transform') {
    if (state.transform) {
      box.append(
        button('確定 (Enter)', applyTransform),
        button('取り消し (Esc)', cancelTransform),
        hint('角: その角だけ / 辺の真ん中: 辺ごと(平行四辺形) / 枠の外: 回転 / Shift: 真横・縦だけ / Ctrl: 中心から / Alt+角: 拡大縮小 / Alt+辺: 伸縮'),
      );
    } else {
      box.append(hint(isVec ? '変形する図形をクリック' : 'クリックでこのレイヤーの絵全体を変形'));
      if (canTrace(layer)) box.append(traceButton());
    }
  } else if (t === 'reflect') {
    const target = isVec ? `${selectedItems().length}個 選択中` : 'レイヤー全体の絵';
    box.append(
      button('左右反転', () => flip('h'), '縦の軸で反転(基準点で)'),
      button('上下反転', () => flip('v'), '横の軸で反転(基準点で)'),
      button('コピーを左右反転', () => flip('h', { copy: true }), '反転したコピーを作る'),
      button('コピーを上下反転', () => flip('v', { copy: true }), '反転したコピーを作る'),
    );
    if (hasCustomPivot()) box.append(button('基準点を中心に戻す', resetPivot, 'Esc'));
    box.append(hint(isVec && !selectedItems().length
      ? '反転する図形をクリック(Shift で追加)'
      : `${target} / ドラッグ: 軸を決めて反転(Shift で45°単位、Alt でコピー)/ クリック: 基準点を置く`));
  } else if (t === 'rig') {
    renderRigOptions(box);
  } else if (t === 'artboard') {
    const ds = button('ドキュメント設定...', null);
    ds.dataset.action = 'docSettings';
    box.append(hint('内側ドラッグ: アートボードを移動 / 辺・角: サイズ変更(絵は動きません)'), ds);
  } else if (t === 'hand') {
    box.append(hint('ドラッグで表示位置を移動(Space+ドラッグ / 中ボタンでも可)'));
  }
}

// ---- カラー ----

function initColorPanel() {
  $('in-color').addEventListener('input', (e) => {
    const c = parseHex(e.target.value);
    state.primary = { ...c, a: state.primary.a };
    emit('colors');
  });
  $('in-alpha').addEventListener('input', (e) => {
    state.primary = { ...state.primary, a: Number(e.target.value) };
    emit('colors');
  });
  $('in-hex').addEventListener('change', (e) => {
    const v = e.target.value;
    if (!isValidHex(v)) { toast('HEXの形式が正しくありません(例: #ff8800 / #ff880080)'); updateColors(); return; }
    state.primary = parseHex(v);
    emit('colors');
  });
  $('btn-swap').onclick = () => swapColors();
  $('sw-secondary').onclick = () => swapColors();
}

export function swapColors() {
  [state.primary, state.secondary] = [state.secondary, state.primary];
  emit('colors');
}

function updateColors() {
  const p = state.primary, s = state.secondary;
  $('sw-primary').style.setProperty('--c', toCss(p));
  $('sw-secondary').style.setProperty('--c', toCss(s));
  $('in-color').value = toHex(p);
  $('in-alpha').value = p.a;
  $('alpha-val').textContent = Math.round((p.a / 255) * 100) + '%';
  if (document.activeElement !== $('in-hex')) $('in-hex').value = p.a === 255 ? toHex(p) : toHex8(p);
}

// ---- パレット ----

function initPalette() {
  $('btn-pal-add').onclick = () => {
    const hex = state.primary.a === 255 ? toHex(state.primary) : toHex8(state.primary);
    if (state.doc.palette.includes(hex)) { toast('既にパレットにあります'); return; }
    state.doc.palette.push(hex);
    state.dirty = true;
    emit('title');
    renderPalette();
  };
}

function renderPalette() {
  const box = $('palette');
  box.innerHTML = '';
  if (!state.doc) return;
  state.doc.palette.forEach((hex, i) => {
    const sw = document.createElement('button');
    sw.className = 'pal-swatch';
    sw.style.setProperty('--c', hex);
    sw.title = `${hex}\nクリック: 選んでいる図形の塗り(線と塗りパネルで選んだ方)/ 図形がなければメイン\n右クリック: 反対の方 / 図形がなければサブ / Shift+クリック: 削除`;
    sw.onclick = (e) => {
      if (e.shiftKey) {
        state.doc.palette.splice(i, 1);
        state.dirty = true;
        emit('title');
        renderPalette();
        return;
      }
      if (applySwatch(hex)) return; // 図形を選んでいれば、その色をすぐ変える
      state.primary = parseHex(hex);
      emit('colors');
    };
    sw.oncontextmenu = (e) => {
      e.preventDefault();
      if (applySwatch(hex, true)) return;
      state.secondary = parseHex(hex);
      emit('colors');
    };
    box.append(sw);
  });
}

// ---- レイヤー ----

let opacityStart = null;

function initLayerPanel() {
  const r = $('in-opacity');
  r.addEventListener('input', () => {
    const l = state.doc.activeLayer;
    if (opacityStart === null) opacityStart = l.opacity;
    l.opacity = Number(r.value) / 100;
    $('opacity-val').textContent = r.value + '%';
    requestRender();
  });
  r.addEventListener('change', () => {
    const l = state.doc.activeLayer;
    if (opacityStart !== null) commitOpacity(l, opacityStart);
    opacityStart = null;
  });
}

function renderLayers() {
  const list = $('layer-list');
  list.innerHTML = '';
  const doc = state.doc;
  if (!doc) return;
  const active = doc.activeLayer;
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i];
    const row = document.createElement('div');
    row.className = 'layer-item' + (l === active ? ' active' : '') + (l.visible ? '' : ' hidden');
    row.innerHTML = `
      <button class="icon vis" title="表示/非表示">${l.visible ? icons.eye : icons.eyeOff}</button>
      <span class="ltype" title="${l.type === 'raster' ? 'ラスターレイヤー' : 'ベクターレイヤー'}">${l.type === 'raster' ? icons.raster : icons.vector}</span>
      <span class="lname" title="ダブルクリックで名前を変更">${escapeHtml(l.name)}</span>
      ${l.rigBind ? '<span class="badge" title="リグにバインド済み">リグ</span>' : ''}
      ${l.pixelGrad ? `<span class="badge dot" title="レイヤー全体をグラデーションでドット化(${pixelLabel(l.pixelGrad.from)} → ${pixelLabel(l.pixelGrad.to)})">ドット↗</span>` : l.pixel >= 1 ? `<span class="badge dot" title="レイヤー全体をドット化(${pixelLabel(l.pixel)})">ドット${Math.round(l.pixel * 10) / 10}</span>` : ''}
      ${l.fx?.items?.some((it) => it.on !== false) ? `<span class="badge fx" title="エフェクト: ${escapeHtml(l.fx.items.filter((it) => it.on !== false).map((it) => FX_TYPES[it.type]?.label).join('・'))}">効果</span>` : ''}
      <span class="lop">${Math.round(l.opacity * 100)}%</span>
      <button class="icon lock ${l.locked ? 'on' : ''}" title="ロック">${l.locked ? icons.lock : icons.unlock}</button>`;
    row.onclick = () => setActiveLayer(l.id);
    row.querySelector('.vis').onclick = (e) => { e.stopPropagation(); toggleVisible(l); };
    row.querySelector('.lock').onclick = (e) => { e.stopPropagation(); toggleLock(l); };
    row.querySelector('.lname').ondblclick = (e) => {
      e.stopPropagation();
      const span = e.currentTarget;
      const input = document.createElement('input');
      input.className = 'rename';
      input.value = l.name;
      span.replaceWith(input);
      input.focus();
      input.select();
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        if (ok) renameLayer(l, input.value);
        renderLayers();
      };
      input.onkeydown = (ev) => {
        if (ev.key === 'Enter') finish(true);
        else if (ev.key === 'Escape') finish(false);
        ev.stopPropagation();
      };
      input.onblur = () => finish(true);
    };
    list.append(row);
  }
  if (active) {
    $('in-opacity').value = Math.round(active.opacity * 100);
    $('opacity-val').textContent = Math.round(active.opacity * 100) + '%';
  }
  renderToolOptions();
  updateStatus();
}

// ---- ステータス・タイトルなど ----

function updateZoom() {
  if (!state.view) return;
  $('zoom-label').textContent = Math.round(state.view.zoom * 100) + '%';
}

function updateHistoryButtons() {
  for (const b of document.querySelectorAll('[data-action="undo"]')) b.disabled = !state.history.canUndo;
  for (const b of document.querySelectorAll('[data-action="redo"]')) b.disabled = !state.history.canRedo;
}

function updateTitle() {
  document.title = `${state.dirty ? '● ' : ''}${fileName()} - Kodai${state.appVersion ? ' v' + state.appVersion : ''}`;
  $('btn-grid').classList.toggle('on', state.opts.showGrid);
  $('btn-grid').hidden = !isPixelMode();
}

export function updateStatus() {
  const doc = state.doc;
  if (!doc) return;
  const c = state.cursor;
  $('st-pos').textContent = c ? `X ${Math.floor(c.x)}, Y ${Math.floor(c.y)}` : '';
  const a = doc.artboard;
  $('st-size').textContent = `アートボード ${a.w} × ${a.h}` + (doc.background ? '' : '(背景なし)');
  $('st-mode').textContent = doc.mode === 'pixel' ? 'ドット絵モード' : 'イラストモード';
  const l = doc.activeLayer;
  $('st-layer').textContent = l ? `${l.name}(${l.type === 'raster' ? 'ラスター' : 'ベクター'})` : '';
}

let toastTimer = null;
function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
