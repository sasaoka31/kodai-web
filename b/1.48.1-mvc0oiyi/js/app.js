// エントリポイント: 初期化・ポインター/キーボード入力・メニューアクション
import { cancelPick } from './tools.js';
import { directTool, bendTool, addAnchorAt, deleteAnchors, hasDirectPoints, hasJoinPick, cancelJoinPick } from './direct.js';
import { prefs, savePrefs } from './prefs.js';
import { state, on, emit, requestRender, toast } from './state.js';
import { newDocument, MAX_ARTBOARD, timeline } from './document.js';
import * as tl from './timeline.js';
import { rigTool, deleteSelectedBone, rigMode } from './rigtool.js';
import { Viewport } from './viewport.js';
import { tools, finishPath, cancelPath } from './tools.js';
import {
  selectTool, deleteSelection, clearSelection, selectAll, groupSelection, ungroupSelection, nudgeSelection,
  stepPixelSelection, openContextMenu, closeContextMenu, selectedItems, reorderSelection,
} from './select.js';
import { transformTool, applyTransform, cancelTransform, transformCursor } from './transform.js';
import { reflectTool, hasCustomPivot, resetPivot } from './reflect.js';
import { textureDialog } from './texturedlg.js';
import { libraryDialog } from './librarydlg.js';
import { iconDialog } from './iconsdlg.js';
import { designDialog, charmDialog, panelsDialog } from './look.js';
import { characterDialog } from './chardlg.js';
import { fxDialog } from './fxdlg.js';
import { telopDialog } from './telopdlg.js';
import { solidDialog } from './soliddlg.js';
import { charPaintDialog } from './charpaintdlg.js';
import { pixelMenu } from './pixelops.js';
import { claudeDialog, initClaudeStatus } from './claudedlg.js';
import { initMcp } from './mcp.js';
import * as layers from './layers.js';
import { initUI, swapColors } from './ui.js';
import {
  saveProject, openProject, openProjectPath, exportPng, pickImage, decodeImage, MAX_CANVAS_AREA, exportGif, exportSpriteSheet,
} from './io.js';
import { showImportDialog } from './importer.js';
import { openModal, isModalOpen, alertModal } from './modal.js';
import { clamp, isValidHex, toHex, parseHex } from './color.js';
import { docPropsEntry } from './history.js';
import { outlineSelection, borderDialog } from './outline.js';
import { textTool, commitTextEdit, isEditingText, startTextEdit } from './texttool.js';
import { initFonts } from './fonts.js';
import { copySelection, cutSelection, paste } from './clipboard.js';
import { initFontMode, toggleFontMode, dotTool, isFontDoc, FONT_BLOCKED_ACTIONS, FONT_BLOCKED_TOOLS } from './fontmode.js';
import { traceDialog } from './trace.js';
import { toggleLayout, resetLayout, isLayout } from './barlayout.js';
import { initGuides, measureTool, toggleRulers, toggleGuides, toggleGuideLock, toggleSnap, toggleSmart, clearGuides } from './guides.js';
import { repeatTransform } from './repeat.js';
import { initTabs, initTabBar, renderTabBar, openDoc, closeTab, switchTab, activeIndex, tabList, confirmAll, anyDirty, tabName } from './tabs.js';

tools.move = selectTool;
tools.direct = directTool;
tools.transform = transformTool;
tools.reflect = reflectTool;
tools.rig = rigTool;
tools.text = textTool;
tools.dot = dotTool;
tools.measure = measureTool;
tools.bend = bendTool;

const canvas = document.getElementById('view');
const view = (state.view = new Viewport(canvas));

// 元に戻す履歴の変更(タブごとに History があり、どれもこれを呼ぶ。動くのは今のタブの履歴だけ)
const historyChanged = (kind, entry) => {
  if (kind !== 'clear') state.dirty = true;
  if (kind === 'undo' || kind === 'redo') {
    state.selection = null;
    if (entry.rig) emit('rig');
    if (entry.cel && !entry.layer.rigged) {
      // 別のフレームでの変更なら、そのフレームへ移動して見せる
      const f = entry.layer.cels.indexOf(entry.cel);
      if (f >= 0 && f !== timeline.frame) tl.setFrame(f);
    }
    emit('frames');
    emit('layers');
  }
  emit('history');
  emit('title');
  requestRender();
};
state.history.onChange = historyChanged;

// ---- ドキュメント ----

// 絵を新しいタブで開く(今のタブが何も描いていない「無題」なら、そこに)。今の絵は、そのまま別のタブに残る
function loadDocument(doc, path = null) {
  openDoc(doc, path);
}
// 新しい絵はタブで開くので、今の絵の「保存していない変更」を聞く必要はない(作るダイアログに渡す)
const noConfirm = async () => true;

// 作業中の操作(描きかけのパス・自由変形・文字入力)を確定する(タブを切り替える前・Claude 連携の操作の前)
function settle() {
  if (state.pathDraft) finishPath();
  if (state.transform) applyTransform();
  if (isEditingText()) commitTextEdit();
}

function stepTab(dir) {
  const n = tabList().length;
  if (n > 1) switchTab((activeIndex() + dir + n) % n);
}

// 未保存の変更があれば確認。続行してよければ true
async function confirmUnsaved() {
  if (!state.dirty) return true;
  const { value } = await openModal({
    title: '保存されていない変更があります',
    body: `「${tabName(tabList()[activeIndex()] || {})}」への変更を保存しますか?`,
    buttons: [
      { label: 'キャンセル', value: null },
      { label: '保存しない', value: 'discard' },
      { label: '保存', value: 'save', primary: true },
    ],
  });
  if (value === 'save') return await safe(() => saveProject());
  return value === 'discard';
}

async function safe(fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(err);
    await alertModal('エラー', err.message || String(err));
    return false;
  }
}

const SIZE_PRESETS = [[512, 512], [800, 600], [1080, 1080], [1280, 720], [1920, 1080], [2048, 2048], [3840, 2160]];

// 背景色の選択欄(なし / 色)
function backgroundField(current) {
  const c = current ? parseHex(current) : { r: 255, g: 255, b: 255, a: 255 };
  return `
    <label>背景
      <select class="bg-mode"><option value="none"${current ? '' : ' selected'}>なし(透明)</option><option value="color"${current ? ' selected' : ''}>色を指定</option></select>
      <input type="color" class="bg-color" value="${toHex(c)}"${current ? '' : ' hidden'}>
    </label>`;
}

function bindBackgroundField(root) {
  const mode = root.querySelector('.bg-mode'), color = root.querySelector('.bg-color');
  mode.onchange = () => { color.hidden = mode.value !== 'color'; };
  return () => (mode.value === 'color' ? color.value : null);
}

async function newDocumentDialog() {
  const body = document.createElement('div');
  body.className = 'form';
  body.innerHTML = `
    <div class="presets"></div>
    <div class="row">
      <label>幅 <input type="number" id="nd-w" min="1" value="1280"> px</label>
      <label>高さ <input type="number" id="nd-h" min="1" value="720"> px</label>
    </div>
    ${backgroundField(null)}
    <p class="note">アートボードの外(縦横20倍の範囲)にも描けます。書き出されるのはアートボード内だけです。<br>
    ドット絵風にしたいときは、矢印ツールで図形を選んで Alt+ホイール(または右クリック →「ドット化」)。</p>`;
  const getBackground = bindBackgroundField(body);
  const presetBox = body.querySelector('.presets');
  const w = body.querySelector('#nd-w'), h = body.querySelector('#nd-h');
  for (const [pw, ph] of SIZE_PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${pw}×${ph}`;
    b.onclick = () => { w.value = pw; h.value = ph; };
    presetBox.append(b);
  }
  const { value } = await openModal({
    title: '新規作成',
    body,
    width: 460,
    buttons: [{ label: 'キャンセル', value: null }, { label: '作成', value: 'ok', primary: true }],
  });
  if (value !== 'ok') return;
  const max = MAX_ARTBOARD.illust;
  const width = clamp(Math.round(Number(w.value)) || 1280, 1, max);
  const height = clamp(Math.round(Number(h.value)) || 720, 1, max);
  if (width !== Number(w.value) || height !== Number(h.value)) toast(`サイズは最大 ${max}px までです`);
  loadDocument(newDocument({ width, height, background: getBackground() }));
}

async function docSettingsDialog() {
  const doc = state.doc;
  const a = doc.artboard;
  const max = MAX_ARTBOARD[doc.mode];
  const body = document.createElement('div');
  body.className = 'form';
  body.innerHTML = `
    <div class="row">
      <label>幅 <input type="number" id="ds-w" min="1" max="${max}" value="${a.w}"> px</label>
      <label>高さ <input type="number" id="ds-h" min="1" max="${max}" value="${a.h}"> px</label>
    </div>
    <div class="row">
      <label>X <input type="number" id="ds-x" value="${a.x}"></label>
      <label>Y <input type="number" id="ds-y" value="${a.y}"></label>
    </div>
    ${backgroundField(doc.background)}
    <p class="note">アートボードは書き出す範囲です。サイズや位置を変えても描いた絵は動きません(アートボードツール A でもドラッグで調整できます)。</p>
    <h3 class="form-sec">操作(このPCに保存)</h3>
    <label class="check"><input type="checkbox" id="pf-select">図形を作ったら、その図形を選んだ状態にする</label>
    <label class="check"><input type="checkbox" id="pf-pair">カラーパネルにメイン / サブの色(2色の四角)を出す</label>
    <div class="row">
      <span>Ctrl+V で貼る位置</span>
      <label>横 <input type="number" id="pf-dx" class="num" step="1"> px</label>
      <label>縦 <input type="number" id="pf-dy" class="num" step="1"> px ずらす</label>
    </div>
    <p class="note">0, 0 = コピーした図形とまったく同じ位置に貼ります。</p>
    <label>ドットのアウトライン化の細かさ <select id="pf-outline">
      <option value="exact">正確(見た目どおり)</option>
      <option value="rough">ざっくり(アンカーポイントを少なく・軽い)</option></select></label>
    <div class="save-sec" hidden>
      <h3 class="form-sec">保存(このPCに保存)</h3>
      <div class="row"><span>保存のフォルダ</span><code id="sv-dir" class="sv-dir"></code></div>
      <div class="row"><button type="button" id="sv-pick">フォルダを変える…</button><button type="button" id="sv-reset">はじめのフォルダに戻す</button><button type="button" id="sv-open">フォルダを開く</button></div>
      <label>「開く」で、まず見る所 <select id="sv-open-from"><option value="saveDir">保存のフォルダ</option><option value="last">前に開いた所</option></select></label>
      <p class="note">新しい絵の「保存」(Ctrl+S)は、このフォルダに「無題_日付-時刻」の名前ですぐ保存します(名前を付けたいときは「名前を付けて保存」)。PNG・GIF などの書き出しの画面も、このフォルダから始まります。</p>
    </div>`;
  const getBackground = bindBackgroundField(body);
  // 保存のフォルダ(lib/savedir.js。アプリ版だけ)。フォルダを変える・戻すは、その場で決まる(OK を待たない)
  const sv = window.native?.saveDir;
  if (sv) {
    const sec = body.querySelector('.save-sec');
    const show = (c) => { if (!c) return; body.querySelector('#sv-dir').textContent = c.dir + (c.isDefault ? '(はじめのフォルダ)' : ''); body.querySelector('#sv-open-from').value = c.openFrom; };
    sv.get().then((c) => { show(c); sec.hidden = false; });
    body.querySelector('#sv-pick').onclick = async () => show(await sv.pick());
    body.querySelector('#sv-reset').onclick = async () => show(await sv.set({ resetDir: true }));
    body.querySelector('#sv-open').onclick = () => sv.reveal();
  }
  body.querySelector('#pf-select').checked = prefs.selectNew;
  body.querySelector('#pf-pair').checked = prefs.showColorPair;
  body.querySelector('#pf-dx').value = prefs.pasteDx;
  body.querySelector('#pf-dy').value = prefs.pasteDy;
  body.querySelector('#pf-outline').value = prefs.outlineDetail;
  const { value } = await openModal({
    title: '設定',
    body,
    buttons: [{ label: 'キャンセル', value: null }, { label: 'OK', value: 'ok', primary: true }],
  });
  if (value !== 'ok') return;
  if (sv) await sv.set({ openFrom: body.querySelector('#sv-open-from').value });
  savePrefs({
    showColorPair: body.querySelector('#pf-pair').checked,
    selectNew: body.querySelector('#pf-select').checked,
    pasteDx: Math.round(Number(body.querySelector('#pf-dx').value)) || 0,
    pasteDy: Math.round(Number(body.querySelector('#pf-dy').value)) || 0,
    outlineDetail: body.querySelector('#pf-outline').value === 'rough' ? 'rough' : 'exact',
  });
  document.body.classList.toggle('show-color-pair', prefs.showColorPair);
  const num = (id, def) => Math.round(Number(body.querySelector(id).value)) || def;
  const before = { artboard: { ...a }, background: doc.background };
  const after = {
    artboard: {
      x: num('#ds-x', 0), y: num('#ds-y', 0),
      w: clamp(num('#ds-w', a.w), 1, max), h: clamp(num('#ds-h', a.h), 1, max),
    },
    background: getBackground(),
  };
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  const entry = docPropsEntry('ドキュメント設定を変更', doc, before, after);
  entry.redo();
  state.history.push(entry);
  emit('doc-settings');
}

async function importImageFlow(file = null) {
  const r = await safe(async () => (file ? { bitmap: await decodeImage(file), name: file.name } : pickImage()));
  if (!r) return;
  await safe(() => showImportDialog(r.bitmap, r.name, { loadDocument, confirmUnsaved: noConfirm }));
}

async function openDialog() {
  const r = await safe(() => openProject());
  if (r) loadDocument(r.doc, r.path);
}

const EXPORT_SCALES = [0.5, 1, 2, 4, 8];

function scaleOptions(frames = 1, cols = 1) {
  const a = state.doc.artboard;
  return EXPORT_SCALES
    .filter((s) => s === 1 || (a.w * a.h * s * s * cols * Math.ceil(frames / cols) <= MAX_CANVAS_AREA && Math.max(a.w, a.h) * s <= 32767 && Math.min(a.w, a.h) * s >= 1))
    .map((s) => `<option value="${s}"${s === 1 ? ' selected' : ''}>${s}倍 (${Math.round(a.w * s)}×${Math.round(a.h * s)})</option>`).join('');
}

async function gifDialog() {
  const doc = state.doc;
  if (doc.frames.length < 2) toast('フレームが1つなので静止画のGIFになります');
  const body = document.createElement('div');
  body.className = 'form';
  body.innerHTML = `
    <label>倍率 <select id="gx-scale">${scaleOptions()}</select></label>
    <label class="check"><input type="checkbox" id="gx-loop" checked>くり返し再生(ループ)</label>
    <p class="note">${doc.frames.length}フレーム・合計 ${(doc.frames.reduce((s, f) => s + f.duration, 0) / 1000).toFixed(2)} 秒。
    GIFは最大256色で、半透明は「透明」か「不透明」のどちらかになります${doc.background ? '' : '(背景色を設定すると半透明部分もきれいに出ます)'}。</p>`;
  const { value } = await openModal({
    title: 'GIF書き出し',
    body,
    buttons: [{ label: 'キャンセル', value: null }, { label: '書き出し', value: 'ok', primary: true }],
  });
  if (value !== 'ok') return;
  await safe(() => exportGif(Number(body.querySelector('#gx-scale').value), body.querySelector('#gx-loop').checked));
}

async function sheetDialog() {
  const doc = state.doc;
  const n = doc.frames.length;
  const body = document.createElement('div');
  body.className = 'form';
  body.innerHTML = `
    <label>倍率 <select id="sx-scale">${scaleOptions()}</select></label>
    <label>並べ方 <select id="sx-cols">
      <option value="0">横一列 (${n}×1)</option>
      <option value="${Math.ceil(Math.sqrt(n))}">正方形に近い格子 (${Math.ceil(Math.sqrt(n))}列)</option>
      <option value="1">縦一列 (1×${n})</option>
    </select></label>
    <label class="check"><input type="checkbox" id="sx-json">各フレームの位置と時間を JSON でも保存</label>
    <p class="note">ゲームエンジンなどで使える、全フレームを1枚に並べたPNGを書き出します。</p>`;
  const { value } = await openModal({
    title: 'スプライトシート書き出し',
    body,
    buttons: [{ label: 'キャンセル', value: null }, { label: '書き出し', value: 'ok', primary: true }],
  });
  if (value !== 'ok') return;
  await safe(() => exportSpriteSheet(
    Number(body.querySelector('#sx-scale').value), Number(body.querySelector('#sx-cols').value), body.querySelector('#sx-json').checked,
  ));
}

async function exportDialog() {
  const doc = state.doc;
  const a = doc.artboard;
  const scales = EXPORT_SCALES
    .filter((s) => s === 1 || (a.w * a.h * s * s <= MAX_CANVAS_AREA && Math.max(a.w, a.h) * s <= 32767));
  const body = document.createElement('div');
  body.className = 'form';
  body.innerHTML = `
    <label>倍率 <select id="ex-scale">${scales.map((s) => `<option value="${s}"${s === 1 ? ' selected' : ''}>${s}倍 (${Math.round(a.w * s)}×${Math.round(a.h * s)})</option>`).join('')}</select></label>
    <p class="note">${doc.frames.length > 1 ? `現在のフレーム(${timeline.frame + 1})の、` : ''}アートボード内の表示中レイヤー${doc.background ? 'と背景色' : ''}を合成して書き出します。ドット化した部分は拡大してもぼけません。</p>`;
  const { value } = await openModal({
    title: 'PNG書き出し',
    body,
    buttons: [{ label: 'キャンセル', value: null }, { label: '書き出し', value: 'ok', primary: true }],
  });
  if (value !== 'ok') return;
  await safe(() => exportPng(Number(body.querySelector('#ex-scale').value)));
}

// ---- ツール ----

function setTool(id) {
  if (!tools[id] || drag) return;
  if (isFontDoc() && FONT_BLOCKED_TOOLS.has(id)) { toast('フォントのタブでは使えないツールです'); return; }
  if (state.pathDraft && id !== 'path') finishPath();
  if (state.transform && id !== 'transform') applyTransform();
  if (isEditingText() && id !== 'text') commitTextEdit();
  closeContextMenu();
  if (id !== 'eyedropper') state.pick = null; // スポイトのボタンから来て、ほかのツールに変えたらやめる
  state.tool = id;
  updateCursor();
  emit('tool');
  requestRender();
}

function updateCursor() {
  if (drag?.type === 'pan') canvas.style.cursor = 'grabbing';
  else if (spaceDown) canvas.style.cursor = 'grab';
  else canvas.style.cursor = tools[state.tool].cursor;
}

// ---- アクション(ボタン・メニュー・ショートカット共通) ----

const actions = {
  new: newDocumentDialog,
  open: openDialog,
  save: () => safe(() => saveProject(false)),
  saveAs: () => safe(() => saveProject(true)),
  export: exportDialog,
  importImage: () => importImageFlow(),
  fontMode: () => toggleFontMode(),
  docSettings: docSettingsDialog,
  texture: () => safe(() => textureDialog()),
  library: () => safe(() => libraryDialog()),
  icons: () => safe(() => iconDialog()),
  design: () => safe(() => designDialog()),
  charm: () => safe(() => charmDialog()),
  panels: () => safe(() => panelsDialog()),
  character: () => safe(() => characterDialog({ loadDocument, confirmUnsaved: noConfirm })),
  makeMenu: () => openMakeMenu(),
  effects: () => safe(() => fxDialog()),
  telop: () => safe(() => telopDialog({ loadDocument, confirmUnsaved: noConfirm })),
  solid: () => safe(() => solidDialog()),
  charPaint: () => safe(() => charPaintDialog({ loadDocument, confirmUnsaved: noConfirm })),
  pixelOutline: () => pixelMenu('outline'),
  pixelShade: () => pixelMenu('shade'),
  pixelMirror: () => pixelMenu('mirror'),
  pixelReduce8: () => pixelMenu('reduce8'),
  pixelReduce16: () => pixelMenu('reduce16'),
  claude: claudeDialog,
  closeTab: () => closeTab(),
  repeat: () => repeatTransform(),
  bringFront: () => reorderSelection('front'),
  bringForward: () => reorderSelection(1),
  sendBackward: () => reorderSelection(-1),
  sendBack: () => reorderSelection('back'),
  rulers: toggleRulers,
  guides: toggleGuides,
  guideLock: toggleGuideLock,
  guideSnap: toggleSnap,
  smartGuides: toggleSmart,
  guideClear: clearGuides,
  nextTab: () => stepTab(1),
  prevTab: () => stepTab(-1),
  undo: () => {
    if (state.pathDraft) cancelPath();
    else if (state.transform) cancelTransform();
    else state.history.undo();
  },
  redo: () => { if (!state.transform) state.history.redo(); },
  zoomIn: () => view.zoomStep(1),
  zoomOut: () => view.zoomStep(-1),
  fit: () => view.fit(),
  zoom100: () => view.setZoom(1),
  grid: () => { state.opts.showGrid = !state.opts.showGrid; emit('title'); requestRender(); },
  swapColors,
  deleteSelection,
  addRaster: () => layers.addLayer('raster'),
  addVector: () => layers.addLayer('vector'),
  dupLayer: layers.duplicateLayer,
  deleteLayer: layers.deleteLayer,
  layerUp: () => layers.moveLayer(1),
  layerDown: () => layers.moveLayer(-1),
  mergeDown: layers.mergeDown,
  group: groupSelection,
  ungroup: ungroupSelection,
  selectAll,
  copy: () => copySelection(),
  cut: () => cutSelection(),
  paste: () => paste(false),
  pasteInPlace: () => paste(true),
  outlineStroke: outlineSelection,
  trace: () => safe(() => traceDialog()),
  layout: () => toggleLayout(),
  layoutReset: resetLayout,
  makeBorder: borderDialog,
  togglePlay: tl.togglePlay,
  prevFrame: () => { tl.stop(); tl.stepFrame(-1); },
  nextFrame: () => { tl.stop(); tl.stepFrame(1); },
  firstFrame: () => { tl.stop(); tl.setFrame(0); },
  lastFrame: () => { tl.stop(); tl.setFrame(state.doc.frames.length - 1); },
  addFrame: () => tl.addFrame(false),
  dupFrame: () => tl.addFrame(true),
  deleteFrame: tl.deleteFrame,
  moveFrameLeft: () => tl.moveFrame(-1),
  moveFrameRight: () => tl.moveFrame(1),
  durationAll: () => tl.setDuration(Number(document.getElementById('tl-duration').value), true),
  onion: () => {
    const c = document.getElementById('tl-onion');
    c.checked = !c.checked;
    c.dispatchEvent(new Event('change'));
  },
  exportGif: gifDialog,
  exportSheet: sheetDialog,
};

// 上の「作る ▾」: キャラ・テクスチャを選ぶ小さなメニュー
function openMakeMenu() {
  document.getElementById('make-menu')?.remove();
  const btn = document.getElementById('btn-make');
  const m = document.createElement('div');
  m.id = 'make-menu';
  for (const [a, label, hint] of [['charPaint', 'キャラを作る(面塗り)…', '頭身自由・輪郭線なし・面で塗る画風。人と四つ足、表情・ポーズ・持ち物'], ['character', 'キャラを作る(64×64)…', 'かわいいドット絵キャラ(4方向・歩きアニメ)'], ['texture', 'テクスチャを作る…', '石畳・レンガ・草・木目など(継ぎ目なし)'], ['library', '素材ライブラリ…', '取り込んだ画像(テクスチャ・素材)を置く。フォルダごと取り込める'], ['icons', 'アイコン…', '歯車・ペン・スパナなど 120個。編集できるパスとして置く'], ['telop', 'テロップを作る…', '文字のアニメーション(APNG / GIF)。戦闘開始・場所・時間など'], ['solid', '立体にする…', '今の絵を荒いポリゴンの立体にして、Blender 用(.glb)に書き出す']]) {
    const b = document.createElement('button');
    b.innerHTML = `<b>${label}</b><span>${hint}</span>`;
    b.onclick = () => { close(); runAction(a); };
    m.append(b);
  }
  const r = btn?.getBoundingClientRect() || { left: 60, bottom: 44, right: 60, top: 44 };
  // 左のツールバーに置いてあるときは、ボタンの右に出す
  const side = !!btn?.closest('#toolbar');
  m.style.left = `${side ? r.right + 4 : r.left}px`;
  m.style.top = `${side ? r.top : r.bottom + 4}px`;
  document.body.append(m);
  const close = () => { m.remove(); document.removeEventListener('pointerdown', outside, true); };
  const outside = (e) => { if (!m.contains(e.target) && e.target !== btn) close(); };
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
}

const LAYOUT_OK = new Set(['layout', 'layoutReset', 'design', 'charm', 'panels']);
function runAction(name) {
  if (isModalOpen() || !actions[name]) return;
  if (drag) return; // 描画中は無視
  if (isLayout() && !LAYOUT_OK.has(name)) return; // レイアウトを変えている間は、ほかの操作をしない(帯のボタンだけ)
  if (isFontDoc() && FONT_BLOCKED_ACTIONS.has(name)) { toast('フォントのタブでは使えません(絵のタブに切り替えてください)'); return; }
  actions[name]();
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-action]');
  if (b) runAction(b.dataset.action);
});

// ---- ポインター入力 ----

let drag = null; // { type: 'tool'|'pan', ... }
let spaceDown = false;

function localPos(e) {
  const r = canvas.getBoundingClientRect();
  return { sx: e.clientX - r.left, sy: e.clientY - r.top };
}

function makeEv(e, button) {
  const { sx, sy } = localPos(e);
  const p = view.screenToDoc(sx, sy);
  return {
    x: p.x, y: p.y, sx, sy,
    px: Math.floor(p.x), py: Math.floor(p.y),
    button,
    shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey,
    pressure: e.pressure, pointerType: e.pointerType,
  };
}

canvas.addEventListener('pointerdown', (e) => {
  if (!state.doc) return;
  if (e.pointerType === 'touch') { touchDown(e); return; }
  if (drag || gesture) return;
  cancelPendingTouch(); // ペンで描き始めたら、先に触れていた手は無視する
  canvas.setPointerCapture(e.pointerId);
  beginDrag(e);
});

function beginDrag(e) {
  if (state.playing && e.button !== 1 && !spaceDown && state.tool !== 'hand') tl.stop(); // 描き始めたら再生を止める
  if (e.button === 1 || spaceDown || state.tool === 'hand') {
    drag = { type: 'pan', sx: e.clientX, sy: e.clientY, ox: view.ox, oy: view.oy };
    view.panning = true;
    updateCursor();
    return;
  }
  if (e.button !== 0 && e.button !== 2) return;
  if (isModalOpen()) return; // 右側に出すダイアログ(グラデーションでドット化など)を開いている間は、見るだけ(中ボタン・Space で移動、ホイールでズームはできる)
  // ブラウザの「クリックでフォーカスを移す」動きは止めて(文字ツールの入力欄がすぐ閉じてしまうため)、
  // 入力中の欄(パネルの数値など)は自分で閉じる(確定の change が起きるように)
  e.preventDefault();
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  let tool = tools[state.tool];
  // 描画ツール中の Alt+クリックはスポイト
  if (e.altKey && ['pen', 'eraser', 'fill'].includes(state.tool)) tool = tools.eyedropper;
  const ev = makeEv(e, e.button);
  if (tool.down(ev)) drag = { type: 'tool', tool, button: e.button };
}

// ---- タッチ(iPad など) ----
// 1本指 = 今のツール / 2本指 = 移動と拡大・縮小 / 2本指でタップ = 元に戻す / 3本指でタップ = やり直し / 矢印ツールで長押し = 右クリックのメニュー
// マウスとペンは今までどおり(ここは pointerType が touch のときだけ通る)

const TOUCH_SLOP = 8;    // これより動いたら「なぞった」とみなす(px)
const TOUCH_WAIT = 140;  // 1本目の指は、この時間だけ描き始めるのを待つ(2本指の操作と見分けるため。ms)
const TAP_TIME = 350;    // 2本指・3本指のタップとみなす長さ(ms)
const LONG_PRESS = 600;  // 長押し(ms)
const touches = new Map(); // pointerId → { x, y }(今、画面に触れている指)
let pendingTouch = null;   // 描き始めるのを待っている1本目の指
let touchDragId = null;    // ツールを動かしている指(ペン・マウスのドラッグ中は null)
let gesture = null;        // 2本指の操作
let longPress = null;

function cancelPendingTouch() {
  if (!pendingTouch) return;
  clearTimeout(pendingTouch.timer);
  touches.delete(pendingTouch.e.pointerId);
  pendingTouch = null;
}

function clearLongPress() {
  if (longPress) clearTimeout(longPress.timer);
  longPress = null;
}

function touchDown(e) {
  e.preventDefault();
  if (drag && touchDragId === null) return; // ペンで描いている最中に手が触れても何もしない
  if (e.isPrimary && !drag) touches.clear(); // 離したのを取りこぼしていても、ここでやり直す
  try { canvas.setPointerCapture(e.pointerId); } catch { /* つかめなくても続ける */ }
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 1 && !gesture) {
    // イベントはあとで読むと値が変わることがあるので、要るものだけ写しておく
    const down = {
      pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY, button: 0, pressure: e.pressure, pointerType: 'touch',
      shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, preventDefault() {},
    };
    pendingTouch = { e: down, x: e.clientX, y: e.clientY, timer: setTimeout(startPendingTouch, TOUCH_WAIT) };
    return;
  }
  // 2本目からの指: 描きかけならそこまでで終えて、移動と拡大・縮小に切り替える
  if (pendingTouch) { clearTimeout(pendingTouch.timer); pendingTouch = null; }
  if (drag) finishTouchDrag();
  if (touches.size >= 2) startGesture();
}

function startPendingTouch() {
  const p = pendingTouch;
  if (!p) return;
  clearTimeout(p.timer);
  pendingTouch = null;
  if (drag) return;
  touchDragId = p.e.pointerId;
  beginDrag(p.e);
  if (!drag) { touchDragId = null; return; }
  if (drag.type === 'tool' && state.tool === 'move') {
    longPress = {
      x: p.x, y: p.y,
      timer: setTimeout(() => {
        longPress = null;
        const t = touches.get(touchDragId);
        if (!drag || !t || state.tool !== 'move') return;
        finishTouchDrag();
        openContextMenu(t.x, t.y);
      }, LONG_PRESS),
    };
  }
}

// 指でのドラッグを、その指が最後にいた位置で終える
function finishTouchDrag() {
  const t = touches.get(touchDragId);
  clearLongPress();
  touchDragId = null;
  if (t) endDrag({ clientX: t.x, clientY: t.y, pressure: 0, pointerType: 'touch' });
}

function gesturePoint() {
  const [a, b] = [...touches.values()];
  const r = canvas.getBoundingClientRect();
  return { sx: (a.x + b.x) / 2 - r.left, sy: (a.y + b.y) / 2 - r.top, d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
}

function startGesture() {
  const g = gesturePoint();
  const w = view.screenToDoc(g.sx, g.sy);
  gesture = {
    wx: w.x, wy: w.y, zoom: view.zoom, d: g.d, sx: g.sx, sy: g.sy,
    t0: gesture?.t0 ?? performance.now(), moved: gesture?.moved ?? false, fingers: Math.max(gesture?.fingers ?? 0, touches.size),
  };
  view.panning = true;
  state.cursor = null;
  closeContextMenu();
  requestRender();
}

function moveGesture() {
  if (touches.size < 2) return;
  const g = gesturePoint(), G = gesture;
  if (!G.moved && Math.hypot(g.sx - G.sx, g.sy - G.sy) < TOUCH_SLOP && Math.abs(g.d - G.d) < TOUCH_SLOP) return;
  G.moved = true;
  // 指の間にあった絵の点が、指の間にあり続けるように
  view.setZoom(G.zoom * g.d / G.d, g.sx, g.sy);
  view.pan(g.sx - G.wx * view.zoom, g.sy - G.wy * view.zoom);
}

function touchMove(e) {
  const t = touches.get(e.pointerId);
  if (!t) return false;
  t.x = e.clientX;
  t.y = e.clientY;
  if (gesture) { moveGesture(); return false; }
  if (pendingTouch) {
    if (Math.hypot(e.clientX - pendingTouch.x, e.clientY - pendingTouch.y) < TOUCH_SLOP) return false;
    startPendingTouch();
  }
  if (longPress && Math.hypot(e.clientX - longPress.x, e.clientY - longPress.y) >= TOUCH_SLOP) clearLongPress();
  return e.pointerId === touchDragId; // ツールを動かしている指だけ、下のふつうの処理へ
}

function touchUp(e) {
  if (!touches.has(e.pointerId)) return;
  if (pendingTouch?.e.pointerId === e.pointerId) startPendingTouch(); // 動かさずに離した = タップ
  touches.delete(e.pointerId);
  if (gesture) {
    if (touches.size) return;
    const G = gesture;
    gesture = null;
    view.panning = false;
    if (e.type !== 'pointercancel' && !G.moved && performance.now() - G.t0 < TAP_TIME) runAction(G.fingers >= 3 ? 'redo' : 'undo');
    requestRender();
    return;
  }
  if (e.pointerId !== touchDragId) return;
  clearLongPress();
  touchDragId = null;
  endDrag(e);
  state.cursor = null; // 指を離したら、ブラシの丸は消す
  emit('cursor');
}

canvas.addEventListener('pointermove', (e) => {
  if (!state.doc) return;
  if (e.pointerType === 'touch' && !touchMove(e)) return;
  if (drag?.type === 'pan') {
    view.pan(drag.ox + e.clientX - drag.sx, drag.oy + e.clientY - drag.sy);
    return;
  }
  const events = drag && e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ce of events.length ? events : [e]) {
    const ev = makeEv(ce, drag?.button ?? -1);
    state.cursor = { x: ev.x, y: ev.y };
    if (drag) drag.tool.move(ev);
    else if (!spaceDown) {
      // ハンドルの上ではカーソルを変える
      if (state.tool === 'artboard') canvas.style.cursor = tools.artboard.cursorFor(ev);
      else if (state.tool === 'transform') canvas.style.cursor = state.transform ? transformCursor(ev) : 'default';
      else if (state.tool === 'move') canvas.style.cursor = selectTool.cursorFor(ev);
    }
  }
  emit('cursor');
  requestRender();
});

function endDrag(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  view.panning = false;
  if (d.type === 'tool') d.tool.up(makeEv(e, d.button));
  updateCursor();
  requestRender();
}

function pointerEnd(e) {
  if (e.pointerType === 'touch') touchUp(e);
  else endDrag(e);
}
canvas.addEventListener('pointerup', pointerEnd);
canvas.addEventListener('pointercancel', pointerEnd);
canvas.addEventListener('pointerleave', () => {
  if (drag) return;
  state.cursor = null;
  emit('cursor');
  requestRender();
});
// 矢印ツールで文字をダブルクリック: 書き直す
canvas.addEventListener('dblclick', (e) => {
  // ダイレクト選択: パスの線の上をダブルクリックでアンカーポイントを足す
  if (state.tool === 'direct' && state.doc && !isModalOpen()) { addAnchorAt(makeEv(e, 0)); return; }
  if (state.tool !== 'move' || !state.doc) return;
  const items = selectedItems();
  if (items.length === 1 && items[0].shape.type === 'text') startTextEdit(state.doc.layerById(state.selection.layerId), items[0].shape);
});

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  // 矢印ツールの右クリック: ドット化などのメニュー(右クリックした図形は pointerdown で選択済み)
  if (state.tool === 'move' && state.doc && !drag) openContextMenu(e.clientX, e.clientY);
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (!state.doc) return;
  const { sx, sy } = localPos(e);
  // ドラッグ中のツールがホイールを使う(多角形の角の数など)
  if (drag?.type === 'tool' && drag.tool.wheel) {
    drag.tool.wheel(e.deltaY < 0 ? 1 : -1);
    return;
  }
  if (e.altKey) {
    if (isModalOpen()) return;
    // Alt+ホイール: 選択中の図形(なければレイヤー)のドット化を1段階ずつ
    if (state.tool === 'move' || selectedItems().length) stepPixelSelection(e.deltaY < 0 ? 1 : -1);
    return;
  }
  if (e.shiftKey) {
    view.pan(view.ox - e.deltaY, view.oy);
  } else {
    view.zoomStep(e.deltaY < 0 ? 1 : -1, sx, sy);
  }
}, { passive: false });

// ---- キーボード ----

const TOOL_KEYS = {
  b: 'pen', e: 'eraser', g: 'fill', i: 'eyedropper', l: 'line', u: 'rect', o: 'ellipse', y: 'polygon', p: 'path', k: 'text', d: 'dot',
  v: 'move', t: 'transform', f: 'reflect', r: 'rig', a: 'artboard', h: 'hand', m: 'measure', c: 'bend',
};

function isTextInput(el) {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'color', 'button'].includes(el.type);
}

function adjustBrush(dir) {
  const t = ['pen', 'eraser'].includes(state.tool) ? state.tool : null;
  if (!t) return;
  const mk = state.doc.mode === 'pixel' ? 'pixel' : 'illust';
  const cur = state.opts.size[t][mk];
  const step = mk === 'pixel' ? 1 : Math.max(1, Math.round(cur * 0.15));
  state.opts.size[t][mk] = clamp(cur + dir * step, 1, mk === 'pixel' ? 32 : 200);
  emit('tool');
  requestRender();
}

window.addEventListener('keydown', (e) => {
  if (isModalOpen() || isTextInput(e.target) || !state.doc) return;
  const k = e.key.toLowerCase();
  const ctrl = e.ctrlKey || e.metaKey;
  // ドラッグ中のツールが先にキーを使う(多角形の ↑↓ で角の数など)
  if (drag?.type === 'tool' && drag.tool.key?.(k)) { e.preventDefault(); return; }
  if (ctrl) {
    const map = {
      z: e.shiftKey ? 'redo' : 'undo',
      y: 'redo',
      s: e.shiftKey ? 'saveAs' : 'save',
      n: 'new',
      i: 'importImage',
      e: e.shiftKey ? 'export' : null,
      0: 'fit',
      1: 'zoom100',
      '=': 'zoomIn', '+': 'zoomIn', ';': 'zoomIn',
      '-': 'zoomOut',
      "'": 'grid',
      g: e.shiftKey ? 'ungroup' : 'group',
      a: 'selectAll',
      c: 'copy',
      x: 'cut',
      v: e.shiftKey ? 'pasteInPlace' : 'paste',
      o: e.shiftKey ? 'outlineStroke' : 'open',
      b: e.shiftKey ? 'makeBorder' : null,
      w: 'closeTab',
      d: 'repeat',
      r: 'rulers',
      ']': e.shiftKey ? 'bringFront' : 'bringForward', '}': 'bringFront',
      '[': e.shiftKey ? 'sendBack' : 'sendBackward', '{': 'sendBack',
      tab: e.shiftKey ? 'prevTab' : 'nextTab',
    };
    const a = map[k];
    if (a) { e.preventDefault(); runAction(a); }
    return;
  }
  if (e.code === 'Space') {
    e.preventDefault();
    if (!spaceDown) { spaceDown = true; updateCursor(); }
    return;
  }
  if (e.altKey) e.preventDefault(); // Alt 単押しでメニューにフォーカスが移るのを防ぐ
  if (drag) return;
  if (e.altKey) {
    const a = { n: 'addFrame', d: 'dupFrame', o: 'onion' }[k];
    if (a) runAction(a);
    return;
  }
  if (TOOL_KEYS[k]) { setTool(TOOL_KEYS[k]); return; }
  switch (k) {
    case ',': runAction('prevFrame'); break;
    case '.': runAction('nextFrame'); break;
    case 'home': runAction('firstFrame'); break;
    case 'end': runAction('lastFrame'); break;
    case 'x': swapColors(); break;
    case '[': adjustBrush(-1); break;
    case ']': adjustBrush(1); break;
    case '+': runAction('zoomIn'); break;
    case '-': runAction('zoomOut'); break;
    case 'arrowleft': case 'arrowright': case 'arrowup': case 'arrowdown': {
      if (!selectedItems().length) return;
      const d = e.shiftKey ? 10 : 1;
      nudgeSelection(k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0, k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0);
      break;
    }
    case 'delete':
    case 'backspace':
      if (state.tool === 'rig' && rigMode() === 'bone' && state.rigSel) deleteSelectedBone();
      else if (hasDirectPoints()) deleteAnchors();
      else if (state.selection) deleteSelection();
      break;
    case 'enter':
      if (state.pathDraft) finishPath();
      else if (state.transform) applyTransform();
      else runAction('togglePlay');
      break;
    case 'escape':
      if (state.pick) cancelPick();
      else if (hasJoinPick()) cancelJoinPick();
      else if (state.pathDraft) cancelPath();
      else if (state.transform) cancelTransform();
      else if (state.tool === 'reflect' && hasCustomPivot()) resetPivot();
      else if (state.selection) clearSelection();
      break;
    default: return;
  }
  e.preventDefault();
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') { spaceDown = false; updateCursor(); }
});

window.addEventListener('blur', () => { spaceDown = false; updateCursor(); });

// 画像ファイルのドラッグ&ドロップで取り込み
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
  if (file && !isModalOpen()) importImageFlow(file);
});

// ---- Electron 連携 ----

if (window.native) {
  window.native.getVersion().then((v) => { state.appVersion = v; emit('title'); });
  window.native.onMenu((action) => runAction(action));
  window.native.onRequestClose(async () => {
    if (isModalOpen()) return;
    if (await confirmAll()) window.native.confirmClose();
  });
  // .kodai / .koneru / .prig をダブルクリックして開いたとき(起動中なら今のウィンドウで開く)
  window.native.onOpenFile?.(async (p) => {
    if (isModalOpen()) return;
    const r = await safe(() => openProjectPath(p));
    if (r) loadDocument(r.doc, r.path);
  });
} else {
  window.addEventListener('beforeunload', (e) => {
    if (anyDirty()) e.preventDefault();
  });
}

// ---- 起動 ----

initUI(setTool);
initFonts();
initTabs({ onHistory: historyChanged, settle, confirmSave: confirmUnsaved, blank: () => openDoc(newDocument({ width: 1280, height: 720 })) });
initTabBar();
initGuides();
on('tabs', renderTabBar);
on('title', renderTabBar);
initFontMode();
// Claude 連携: 道具の中身は mcp.js。作業中の操作(描きかけのパス・自由変形・文字入力)は確定してから
initMcp({ loadDocument, settle });
initClaudeStatus();
on('request-tool', (id) => setTool(id));
tl.initTimeline();
loadDocument(newDocument({ width: 1280, height: 720 }));
setTool('move');
emit('colors');
