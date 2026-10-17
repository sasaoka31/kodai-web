// 文字ツール(K)
//   クリック: その場所に文字を置いて入力 / 文字をクリック: 書き直す(矢印ツールでは文字をダブルクリック)
//   Esc・ほかの場所をクリック: 入力を終える(空なら消える)
//   入力中はキャンバスの上に透明な入力欄を重ね、文字そのものはキャンバスに描く(回転・拡大した文字でも同じ位置)
//   字ごとの調整(1.42.0): カーニング(カーソルの前後の字の間。字を選んでいれば、その字の字間)と、ベースラインの上げ下げ(選んだ字)。
//     Alt+←→ = カーニング、Alt+Shift+↑↓ = ベースライン(Ctrl も押すと 5倍)。上のオプション欄の数値でも変えられる。
//     入力欄は字ごとの調整を知らないので、カーソルと選択の色は自前で描く(text-overlay)
import { state, emit, on, requestRender, toast } from './state.js';
import { toHex8 } from './color.js';
import { textLayout, fontCss, textMatrix, DEFAULT_FAMILY, caretPos, rangeRects, retargetAdjust, adjustChars, hasCharAdjust } from './text.js';
import { hitShape, newShapeId } from './vector.js';
import { pushVector, shapeLayer } from './tools.js';
import { selectedItems, modifySelection, setSelection, eachLeaf, selectionLayer } from './select.js';
import { fontLists, importFontFiles, ensureFamily } from './fonts.js';
import { useColor } from './recent.js';

export const textDefaults = () => (state.opts.text ||= { family: DEFAULT_FAMILY, size: 48, lineHeight: 1.25, letterSpacing: 0, align: 'left' });

let editing = null; // { layer, shape, before, isNew, el }

export const isEditingText = () => !!editing;

function findText(layer, ev) {
  for (let i = layer.shapes.length - 1; i >= 0; i--) {
    const s = layer.shapes[i];
    if (s.type === 'text' && hitShape(s, ev.x, ev.y, 0)) return s;
  }
  return null;
}

export const textTool = {
  cursor: 'text',
  down(ev) {
    if (ev.button !== 0) return false;
    const wasEditing = editing;
    if (editing) commitTextEdit();
    const active = state.doc.activeLayer;
    const hit = active?.type === 'vector' && !active.locked ? findText(active, ev) : null;
    if (hit) { startTextEdit(active, hit); return false; }
    if (wasEditing) return false; // 入力を終えるだけのクリック
    const layer = shapeLayer();
    if (!layer) return false;
    const d = textDefaults();
    ensureFamily(d.family);
    const shape = {
      type: 'text', id: newShapeId(), text: '', family: d.family, size: d.size, lineHeight: d.lineHeight, letterSpacing: d.letterSpacing, align: d.align,
      m: [1, 0, 0, 1, ev.x, ev.y - d.size * d.lineHeight * 0.55], fill: toHex8(state.primary), stroke: null, strokeWidth: 0,
    };
    const before = structuredClone(layer.shapes);
    layer.shapes.push(shape);
    useColor(shape.fill);
    startTextEdit(layer, shape, before);
    return false;
  },
};

export function startTextEdit(layer, shape, before = null) {
  if (editing) commitTextEdit();
  const el = document.createElement('textarea');
  el.className = 'text-editor';
  el.spellcheck = false;
  el.value = shape.text;
  document.getElementById('canvas-area').append(el);
  const ov = document.createElement('div');
  ov.className = 'text-overlay';
  document.getElementById('canvas-area').append(ov);
  editing = { layer, shape, before: before || structuredClone(layer.shapes), isNew: !!before, el, ov, raf: 0, sel: [0, 0], selKey: '' };
  el.addEventListener('input', () => {
    const old = shape.text;
    shape.text = el.value;
    retargetAdjust(shape, old, el.value);
    layer.touch();
    syncEditor();
    requestRender();
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); commitTextEdit(); }
    else if (e.altKey && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); nudgeAdjust('rise', (e.key === 'ArrowUp' ? 1 : -1) * (e.ctrlKey ? 100 : 20)); }
    else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); nudgeAdjust('kern', (e.key === 'ArrowRight' ? 1 : -1) * (e.ctrlKey ? 100 : 20)); }
    e.stopPropagation();
  });
  // 上のオプション欄(字間・カーニングなどの数値)を触っている間は、入力を終えない
  const inOptions = () => !!document.activeElement?.closest?.('#tool-options');
  const leave = () => setTimeout(() => { if (editing?.el === el && document.activeElement !== el && !inOptions()) commitTextEdit(); }, 0);
  el.addEventListener('blur', leave);
  editing.leave = leave;
  document.getElementById('tool-options')?.addEventListener('focusout', leave);
  const loop = () => { if (editing?.el !== el) return; syncEditor(); editing.raf = requestAnimationFrame(loop); };
  loop();
  el.focus();
  el.select();
  // 念のため: クリックの処理が終わったあとにもう一度入力欄にフォーカス
  setTimeout(() => { if (editing?.el === el && document.activeElement !== el) el.focus(); }, 0);
  setSelection(layer, [shape.id]);
  // オプション欄に、字ごとの調整の入力を出す
  emit('tool');
}
// 入力欄の選択(字の番号。Array.from で分けた順)。入力欄にフォーカスがある間だけ読み直す
function editSel() {
  const { el } = editing;
  if (document.activeElement === el) {
    const cp = (n) => Array.from(el.value.slice(0, n)).length;
    editing.sel = [cp(el.selectionStart), cp(el.selectionEnd)];
  }
  return editing.sel;
}
// 調整する字の範囲: 選んでいればその字、カーソルだけなら その前の字(カーニング = 前の字と次の字の間)
function adjustRange() {
  const [a, b] = editSel();
  if (a !== b) return [Math.min(a, b), Math.max(a, b)];
  return a > 0 ? [a - 1, a] : [0, 1];
}
function nudgeAdjust(key, d) {
  const { shape, layer } = editing;
  if (!Array.from(shape.text).length) return;
  const [a, b] = adjustRange();
  adjustChars(shape, key, a, b, (v) => v + d);
  layer.touch();
  syncEditor();
  requestRender();
  refreshAdjustInputs();
}
// 今の範囲の値(px)。範囲の最初の字の値
const adjustPx = (key) => { const { shape } = editing; const [a] = adjustRange(); return Math.round((((Number(shape[key]?.[a]) || 0) * shape.size) / 1000) * 10) / 10; };
let adjustInputs = null; // { kern, rise }(オプション欄の入力。入力中だけ)
function refreshAdjustInputs() {
  if (!editing || !adjustInputs) return;
  for (const k of ['kern', 'rise']) if (adjustInputs[k] && document.activeElement !== adjustInputs[k]) adjustInputs[k].value = adjustPx(k);
}

// 入力欄をキャンバス上の文字に重ねる
function syncEditor() {
  const { shape: s, el, ov } = editing;
  const v = state.view, z = v.zoom;
  const L = textLayout(s);
  const m = textMatrix(s);
  el.style.font = fontCss(s);
  el.style.lineHeight = `${L.lineH}px`;
  el.style.letterSpacing = `${s.letterSpacing || 0}px`;
  el.style.textAlign = s.align || 'left';
  el.style.width = `${L.w + s.size * 0.6}px`;
  el.style.height = `${L.h}px`;
  el.style.transform = `matrix(${m[0] * z},${m[1] * z},${m[2] * z},${m[3] * z},${v.ox + m[4] * z},${v.oy + m[5] * z})`;
  // カーソルと選択の色(字ごとの調整をふくめた位置に描く)
  ov.style.transform = el.style.transform;
  const [a, b] = editSel();
  const key = `${a},${b},${s.text.length},${JSON.stringify([s.kern, s.rise])},${s.size},${s.letterSpacing},${s.lineHeight},${s.align},${s.family},${z}`;
  if (key !== editing.selKey) {
    editing.selKey = key;
    ov.innerHTML = '';
    if (a === b) {
      const c = caretPos(s, a), d = document.createElement('i');
      d.className = 'text-caret';
      d.style.cssText = `left:${c.x}px;top:${c.y + c.h * 0.1}px;height:${c.h * 0.8}px;width:${Math.max(1, 1.5 / z)}px`;
      ov.append(d);
    } else {
      for (const r of rangeRects(s, Math.min(a, b), Math.max(a, b))) {
        const d = document.createElement('i');
        d.className = 'text-sel';
        d.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`;
        ov.append(d);
      }
    }
    refreshAdjustInputs();
  }
}

export function commitTextEdit() {
  if (!editing) return;
  const { layer, shape, before, el, ov, leave } = editing;
  cancelAnimationFrame(editing.raf);
  document.getElementById('tool-options')?.removeEventListener('focusout', leave);
  editing = null;
  adjustInputs = null;
  el.remove();
  ov.remove();
  emit('tool');
  if (!shape.text.trim()) {
    layer.shapes = layer.shapes.filter((s) => s !== shape);
    layer.touch();
    if (JSON.stringify(before) !== JSON.stringify(layer.shapes)) pushVector('文字を削除', layer, before);
    setSelection(null, []);
  } else if (JSON.stringify(before) !== JSON.stringify(layer.shapes)) {
    pushVector('文字', layer, before);
    setSelection(layer, [shape.id]);
  }
  requestRender();
  emit('selection');
}

// ---- ツールオプション(文字ツール / 矢印ツールで文字を選んでいるとき) ----

function textTargets() {
  if (editing) return [editing.shape];
  const out = [];
  eachLeaf(selectedItems(), (s) => { if (s.type === 'text') out.push(s); });
  return out;
}

function applyText(label, patch) {
  Object.assign(textDefaults(), patch);
  if (editing) {
    Object.assign(editing.shape, patch);
    editing.layer.touch();
    syncEditor();
    requestRender();
    return;
  }
  if (!textTargets().length) return;
  modifySelection(label, (its) => eachLeaf(its, (s) => { if (s.type === 'text') Object.assign(s, patch); }));
}

export function renderTextOptions(box) {
  const targets = textTargets();
  const cur = targets[0] || textDefaults();
  const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
  const { imported, builtin } = fontLists();
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const opt = (f, label = f) => `<option value="${esc(f)}">${esc(label)}</option>`;
  const fam = el(`<label class="opt" title="Kodai のフォントは、すべて商用利用できる Google Fonts(SIL Open Font License)です"><span>フォント</span><select class="text-family">
    <optgroup label="Kodai のフォント(商用利用OK)">${builtin.map((f) => opt(f.family, f.label + (f.ready ? '' : ' — 初回ダウンロード'))).join('')}</optgroup>
    ${imported.length ? `<optgroup label="取り込んだ・作ったフォント">${imported.map((f) => opt(f)).join('')}</optgroup>` : ''}</select></label>`);
  const sel = fam.querySelector('select');
  if (![...sel.options].some((o) => o.value === cur.family)) sel.prepend(new Option(`${cur.family}(一覧にないフォント)`, cur.family));
  sel.value = cur.family;
  sel.onchange = () => { ensureFamily(sel.value); applyText('フォントを変更', { family: sel.value }); };
  const add = el('<button title="TTF・OTF・WOFF のフォントファイルを取り込む(次回からも使えます)。商用利用できるかは配布元の条件を確認してください">＋フォント</button>');
  add.onclick = async () => { const a = await importFontFiles(); if (a.length) applyText('フォントを変更', { family: a[0].family }); emit('tool'); };
  const num = (label, value, min, max, step, key, title) => {
    const w = el(`<label class="opt" title="${title}"><span>${label}</span><input type="number" class="num" min="${min}" max="${max}" step="${step}"></label>`);
    const i = w.querySelector('input');
    i.value = value;
    i.onchange = () => { const v = Math.min(max, Math.max(min, Number(i.value) || value)); i.value = v; applyText(`${label}を変更`, { [key]: v }); };
    i.onkeydown = (e) => e.stopPropagation();
    return w;
  };
  const alignSeg = el('<div class="mini-seg" title="行のそろえ方"></div>');
  for (const [k, t] of [['left', '左'], ['center', '中央'], ['right', '右']]) {
    const b = el(`<button class="${(cur.align || 'left') === k ? 'on' : ''}">${t}</button>`);
    b.onclick = () => { applyText('行のそろえ方', { align: k }); emit('tool'); };
    alignSeg.append(b);
  }
  box.append(fam, add,
    num('サイズ', cur.size, 1, 2000, 1, 'size', '文字の大きさ(px)'),
    num('行間', cur.lineHeight, 0.5, 5, 0.05, 'lineHeight', '行の高さ(文字の大きさの何倍か)'),
    num('字間', cur.letterSpacing || 0, -200, 500, 1, 'letterSpacing', '全部の字の、文字と文字の間(px)'),
    alignSeg);
  // 字ごとの調整(入力中だけ): カーニングとベースライン。選んだ字(カーソルだけなら その前の字)に効く
  adjustInputs = null;
  if (editing) {
    const adj = (label, key, title) => {
      const w = el(`<label class="opt" title="${title}"><span>${label}</span><input type="number" class="num" step="0.5" min="-500" max="1000"></label>`);
      const i = w.querySelector('input');
      i.value = adjustPx(key);
      i.onchange = () => {
        if (!editing) return;
        const { shape, layer } = editing, [a, b] = adjustRange();
        const v = ((Number(i.value) || 0) * 1000) / shape.size;
        adjustChars(shape, key, a, b, () => v);
        layer.touch();
        editing.selKey = '';
        syncEditor();
        requestRender();
      };
      i.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); editing?.el.focus(); } };
      return [w, i];
    };
    const [kw, ki] = adj('カーニング', 'kern', 'カーソルの前後の字の間(px)。字を選んでいるときは、選んだ字の字間。入力中に Alt+←→ でも変えられます(Ctrl も押すと 5倍)');
    const [rw, ri] = adj('ベースライン', 'rise', '選んだ字を上下にずらす(px。+ で上)。カーソルだけのときは、その前の字。入力中に Alt+Shift+↑↓ でも変えられます');
    adjustInputs = { kern: ki, rise: ri };
    box.append(kw, rw);
  }
  if (targets.some((s) => hasCharAdjust(s))) {
    const reset = el('<button title="カーニングとベースラインの調整を消す(入力中に字を選んでいれば、その字だけ)">字ごとの調整を消す</button>');
    reset.onclick = () => {
      if (editing) {
        const { shape, layer } = editing, [a, b] = editSel();
        const n = Array.from(shape.text).length, lo = a === b ? 0 : Math.min(a, b), hi = a === b ? n : Math.max(a, b);
        for (const k of ['kern', 'rise']) adjustChars(shape, k, lo, hi, () => 0);
        layer.touch();
        editing.selKey = '';
        syncEditor();
        requestRender();
        editing.el.focus();
      } else {
        modifySelection('字ごとの調整を消す', (its) => eachLeaf(its, (s) => { if (s.type === 'text') { delete s.kern; delete s.rise; } }));
      }
      emit('tool');
    };
    box.append(reset);
  }
}

export function hasTextSelection() {
  return textTargets().length > 0;
}

on('doc', () => { if (editing) commitTextEdit(); });
on('fonts', () => { if (state.tool === 'text' || hasTextSelection()) emit('tool'); });
