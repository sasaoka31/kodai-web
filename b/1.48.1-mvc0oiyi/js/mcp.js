// Claude 連携: 道具(MCP の tools)の中身を画面側で実行する。サーバーはメインプロセス(lib/claude.js)、道具の一覧は lib/claude-tools.js
//   変更はすべて Undo の履歴に積む(ユーザーがあとから元に戻せる)。ユーザーの保存していない絵は、discard_unsaved がないと捨てない
import { state, emit, requestRender, toast } from './state.js';
import { timeline, newDocument, RasterLayer, VectorLayer, serialize, uid, createCanvas } from './document.js';
import { flatten } from './render.js';
import { encodeGif } from './gif.js';
import { openProjectPath, decodeImage } from './io.js';
import { embeddedFonts, ensureFamily } from './fonts.js';
import * as layers from './layers.js';
import { framesOp, setFrame, setDuration } from './timeline.js';
import { recordTiles, snapshotRig, rigEntry, propEntry } from './history.js';
import { tileCoordsInRect } from './tiles.js';
import { pushAppend, pushVector } from './tools.js';
import {
  setSelection, clearSelection, groupSelection, ungroupSelection, scaleShape, rotateShape,
} from './select.js';
import { outlineSelection } from './outline.js';
import { pathfinder } from './pathfinder.js';
import { reflectShape } from './reflect.js';
import { shapeBounds, translateShape, ensureIds, newShapeId, polygonNodes } from './vector.js';
import { svgPathToShape } from './svgpath.js';
import { makeTexture } from './texture.js';
import { placeTexture } from './texturedlg.js';
import { placeCharacter } from './chardlg.js';
import { characterSheet, randomCharacter } from './charmaker.js';
import { applyToLayer, outlineImage, shadeImage, mirrorImage, reduceImage, toRows } from './pixelops.js';
import { parseHex, toHex8 } from './color.js';
import { isModalOpen } from './modal.js';
import { FX_TYPES, FX_PRESETS, newFxItem, normalizeFx } from './effects.js';
import { setLayerFx, ensureFrames, bakeFx } from './fxdlg.js';
import { solidFromDoc, solidFrames, solidFramesTo } from './soliddlg.js';
import { solidToGlb } from './solid.js';
import { autoRig } from './autorig.js';
import { buildRigged, riggedToGlb, skinPositions } from './solidrig.js';
import { renderSolidViews } from './solidview.js';
import { telopOptions, telopTimes, telopFrameCount, TELOP_TEMPLATES } from './telop.js';
import { prepareTelopFonts, telopApng, telopGif, telopStill, telopToDocument } from './telopdlg.js';
import { bumpRig, guessRole, PRESETS } from './rig.js';
import { applyPreset } from './rigtool.js';
import { DEFAULT_FAMILY } from './text.js';
import { tabsInfo, tabList, switchTab, closeTab, activeIndex } from './tabs.js';
import { copySelection, paste } from './clipboard.js';
import { findIcons, placeIcon, iconList } from './iconsdlg.js';
import { isFontDoc, newFontDoc, enterFontMode, exitFontMode, glyphShapes, isAutoGlyph, installFontDoc, editableFonts, fontDocOf } from './fontmode.js';
import { libraryList, libraryFind, libraryImportFolder, libraryRemove, libraryRemoveGroup, libraryBitmap, importSummary } from './library.js';
import { placeAsset } from './librarydlg.js';
import { imageDataOf, analyzeImage, autoJoins, lettersOf } from './fontimage.js';
import { importGlyphs, FILL_SETS, FILL_DEFAULT, FILL_WEIGHT } from './fontimagedlg.js';
import { drawShape } from './vector.js';

let deps = { loadDocument: null, settle: () => {} };

// ---- 返事 ----

const text = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v) }] });
class ToolError extends Error {}
const fail = (msg) => { throw new ToolError(msg); };

// ---- 共通 ----

const doc = () => state.doc;

function findLayer(ref, { type } = {}) {
  const d = doc();
  if (ref === undefined || ref === null || ref === '') return d.activeLayer;
  const l = d.layers.find((x) => x.id === ref) || d.layers.find((x) => x.name === ref);
  if (!l) fail(`レイヤー「${ref}」がありません(kodai_get_state で id を確認)`);
  if (type && l.type !== type) fail(`「${l.name}」は${l.type === 'vector' ? 'ベクター' : 'ラスター'}レイヤーです(${type === 'vector' ? '図形はベクター' : 'ドット・画像はラスター'}レイヤーに)`);
  return l;
}

// 種類の合うレイヤー。指定がなく今のレイヤーが合わなければ、新しく作る
function targetLayer(ref, type) {
  if (ref !== undefined && ref !== null && ref !== '') return editable(findLayer(ref, { type }));
  const cur = doc().activeLayer;
  if (cur?.type === type && !cur.locked) return cur;
  layers.addLayer(type);
  return doc().activeLayer;
}

function editable(l) {
  if (l.locked) fail(`レイヤー「${l.name}」はロックされています`);
  return l;
}

const finite = (v, what) => { const n = Number(v); if (!Number.isFinite(n)) fail(`${what} は数値で指定してください`); return n; };
const color = (c, def = null) => {
  if (c === undefined) return def;
  if (c === null || c === 'none' || c === '') return null;
  if (typeof c !== 'string' || !/^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c)) fail(`色「${c}」が読めません("#rrggbb" か "#rrggbbaa")`);
  return toHex8(parseHex(c));
};
const grad = (g) => (g ? { ...g, stops: (g.stops || []).map((s) => ({ o: Math.min(1, Math.max(0, Number(s.o) || 0)), c: color(s.c, '#000000ff') })) } : undefined);

const union = (list) => list.reduce((r, b) => (r ? { x0: Math.min(r.x0, b.x0), y0: Math.min(r.y0, b.y0), x1: Math.max(r.x1, b.x1), y1: Math.max(r.y1, b.y1) } : { ...b }), null);
const box = (b) => (b ? { x: +b.x0.toFixed(2), y: +b.y0.toFixed(2), w: +(b.x1 - b.x0).toFixed(2), h: +(b.y1 - b.y0).toFixed(2) } : null);

// Claude の書き方 → Kodai の図形
async function toShape(s, where = 'shapes') {
  if (!s || typeof s !== 'object') fail(`${where}: 図形はオブジェクトで`);
  const type = s.type;
  const fillGrad = grad(s.fillGrad), strokeGrad = grad(s.strokeGrad);
  const out = { id: newShapeId() };
  const stroke = color(s.stroke, strokeGrad ? strokeGrad.stops[0]?.c : null);
  const fill = color(s.fill, fillGrad ? fillGrad.stops[0]?.c : stroke && s.fill === undefined && type !== 'text' ? null : '#000000ff');
  Object.assign(out, { fill, stroke, strokeWidth: s.strokeWidth !== undefined ? finite(s.strokeWidth, `${where}.strokeWidth`) : stroke ? 2 : 0 });
  if (fillGrad) out.fillGrad = fillGrad;
  if (strokeGrad) out.strokeGrad = strokeGrad;
  if (s.pixel !== undefined) out.pixel = finite(s.pixel, `${where}.pixel`);
  if (s.pixelGrad) out.pixelGrad = s.pixelGrad;
  if (s.round !== undefined) out.round = finite(s.round, `${where}.round`);
  const n = (k) => finite(s[k], `${where}.${k}`);
  switch (type) {
    case 'rect': {
      const x = n('x'), y = n('y'), w = n('w'), h = n('h');
      return { ...out, type, x: Math.min(x, x + w), y: Math.min(y, y + h), w: Math.abs(w), h: Math.abs(h) };
    }
    case 'ellipse': return { ...out, type, cx: n('cx'), cy: n('cy'), rx: Math.abs(n('rx')), ry: Math.abs(n('ry')) };
    case 'circle': return { ...out, type: 'ellipse', cx: n('cx'), cy: n('cy'), rx: Math.abs(n('r')), ry: Math.abs(n('r')) };
    case 'line':
      return { ...out, type, fill: null, stroke: stroke || '#000000ff', strokeWidth: s.strokeWidth !== undefined ? out.strokeWidth : 2, x1: n('x1'), y1: n('y1'), x2: n('x2'), y2: n('y2') };
    case 'polygon': {
      const sides = Math.min(20, Math.max(3, Math.round(s.sides ?? 6)));
      const a = s.angle !== undefined ? (finite(s.angle, `${where}.angle`) * Math.PI) / 180 : -Math.PI / 2;
      return { ...out, type: 'path', closed: true, nodes: polygonNodes(n('cx'), n('cy'), Math.abs(n('r')), sides, a) };
    }
    case 'path': {
      let geo;
      if (s.d) {
        try { geo = svgPathToShape(s.d); } catch (err) { fail(`${where}.d: ${err.message}`); }
      } else {
        if (!Array.isArray(s.nodes) || s.nodes.length < 2) fail(`${where}: path は d(SVG のパス)か nodes(2点以上)が必要です`);
        const pt = (p, k) => (p ? { x: finite(p.x, `${where}.${k}.x`), y: finite(p.y, `${where}.${k}.y`) } : undefined);
        geo = { nodes: s.nodes.map((p, i) => { const o = pt(p, `nodes[${i}]`); if (p.hin) o.hin = pt(p.hin, 'hin'); if (p.hout) o.hout = pt(p.hout, 'hout'); return o; }), closed: s.closed !== false };
      }
      return { ...out, type: 'path', ...geo };
    }
    case 'text': {
      const family = s.family || DEFAULT_FAMILY;
      await ensureFamily(family);
      return {
        ...out, type: 'text', text: String(s.text ?? ''), family, size: s.size !== undefined ? Math.max(1, n('size')) : 32,
        lineHeight: s.lineHeight ?? 1.2, letterSpacing: s.letterSpacing ?? 0, align: ['left', 'center', 'right'].includes(s.align) ? s.align : 'left',
        fill: color(s.fill, '#000000ff'), m: [1, 0, 0, 1, n('x'), n('y')],
        // 字ごとの調整(1/1000 em。kern = この字と次の字の間、rise = ベースラインを上へ)
        ...(Array.isArray(s.kern) && s.kern.some((v) => Number(v)) ? { kern: s.kern.slice(0, 2000).map((v) => Math.round(Number(v)) || 0) } : {}),
        ...(Array.isArray(s.rise) && s.rise.some((v) => Number(v)) ? { rise: s.rise.slice(0, 2000).map((v) => Math.round(Number(v)) || 0) } : {}),
      };
    }
    case 'group': {
      if (!Array.isArray(s.children) || !s.children.length) fail(`${where}: group には children が必要です`);
      const children = [];
      for (let i = 0; i < s.children.length; i++) children.push(await toShape(s.children[i], `${where}.children[${i}]`));
      const g = { id: out.id, type: 'group', children };
      if (out.pixel !== undefined) g.pixel = out.pixel;
      return g;
    }
    default:
      return fail(`${where}: 図形の種類「${type}」は使えません(rect / ellipse / circle / line / polygon / path / text / group)`);
  }
}

function layerInfo(l, withShapes) {
  const info = { id: l.id, name: l.name, type: l.type, visible: l.visible, opacity: l.opacity, locked: l.locked };
  if (l.pixel) info.pixel = l.pixel;
  if (l.rigBind) info.rigBind = l.rigBind.mode;
  if (l.fx) info.effects = l.fx.items.map((it) => it.type);
  if (l.type === 'vector') {
    info.shapes = l.shapes.length;
    info.bounds = box(union(l.shapes.map(shapeBounds)));
    if (withShapes) {
      info.items = l.shapes.map((s) => {
        const it = { id: s.id, type: s.type, bounds: box(shapeBounds(s)) };
        if (s.fill) it.fill = s.fill;
        if (s.stroke) it.stroke = s.stroke;
        if (s.pixel) it.pixel = s.pixel;
        if (s.type === 'text') it.text = s.text;
        if (s.type === 'group') it.children = s.children.length;
        return it;
      });
    }
  } else info.bounds = box(l.bounds());
  return info;
}

// ---- 画像 ----

const canvasOf = (img) => { const c = createCanvas(img.width, img.height); c.getContext('2d').putImageData(img, 0, 0); return c; };
const pngBytes = async (canvas) => new Uint8Array(await (await new Promise((r) => canvas.toBlob(r, 'image/png'))).arrayBuffer());
const base64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };

// フォント作成モードの字を1字ずつ並べた絵(確認用)。赤い下線 = 自分の図形を持つ字(画像から取り込んだ・描いた字)、ほかは筆から作った自動の字
function fontSheet(d) {
  const f = d.font;
  // 作った字を1字ずつ並べた絵(確認用)。赤い下線 = 画像から取り込んだ字、ほかは筆から作った字
  const gl = d.frames.map((fr, i) => ({ fr, i })).filter((g) => g.fr.glyph).slice(0, 90);
  const k = 0.06, cellH = Math.round(f.upm * 1.5 * k), maxW = 1180;
  const cells = [];
  let cx0 = 8, cy0 = 8;
  for (const g of gl) {
    const cw = Math.round(Math.max(g.fr.glyph.advance, f.upm * 0.45) * k) + 18;
    if (cx0 + cw > maxW) { cx0 = 8; cy0 += cellH + 6; }
    cells.push({ ...g, x: cx0, y: cy0, w: cw });
    cx0 += cw + 4;
  }
  const c = createCanvas(maxW + 8, cy0 + cellH + 8), x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height);
  for (const g of cells) {
    x.fillStyle = '#f3f4f6'; x.fillRect(g.x, g.y, g.w, cellH);
    x.save();
    x.beginPath(); x.rect(g.x, g.y, g.w, cellH); x.clip();
    x.translate(g.x + 9, g.y + f.upm * 0.25 * k); x.scale(k, k);
    for (const sh of glyphShapes(d, g.i)) drawShape(x, sh);
    x.restore();
    if (!isAutoGlyph(d, g.i)) { x.fillStyle = '#dc2626'; x.fillRect(g.x, g.y + cellH - 3, g.w, 3); }
    x.fillStyle = '#6b7280'; x.font = '10px sans-serif'; x.textBaseline = 'top'; x.fillText(g.fr.glyph.char, g.x + 2, g.y + 1);
  }
  return c;
}

function checker(ctx, w, h, size = 8) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#d4d4d8';
  for (let y = 0; y < h; y += size) for (let x = (y / size) % 2 ? size : 0; x < w; x += size * 2) ctx.fillRect(x, y, size, size);
}

async function writeFile(p, bytes) {
  if (!window.native) fail('ファイルに書くには Kodai のアプリ版が必要です');
  await window.native.writeBinary(p, bytes);
}

// ---- 道具 ----

const H = {
  kodai_get_state({ shapes = false } = {}) {
    const d = doc();
    const byId = new Map(d.rig.bones.map((b) => [b.id, b]));
    return text({
      file: state.filePath, unsaved: state.dirty, tabs: tabsInfo(), artboard: d.artboard, background: d.background,
      frames: d.frames.length, frame: timeline.frame, activeLayer: d.activeLayer?.id,
      layers: d.layers.map((l) => layerInfo(l, shapes)).reverse(), // 上のレイヤーから
      selection: state.selection ? { layer: state.selection.layerId, ids: state.selection.ids } : null,
      bones: d.rig.bones.map((b) => ({ name: b.name, role: b.role, parent: byId.get(b.parent)?.name || null, head: [b.hx, b.hy], tail: [b.tx, b.ty] })),
    });
  },

  // 新しいタブで開く(今の絵は別のタブに残るので、保存していない変更があっても断らない)
  kodai_new_document({ width, height, background = null, layer = 'vector' }) {
    const w = Math.round(finite(width, 'width')), h = Math.round(finite(height, 'height'));
    if (w < 1 || h < 1 || w > 8192 || h > 8192) fail('大きさは 1〜8192px にしてください');
    const d = newDocument({ width: w, height: h, background: color(background, null) });
    if (layer === 'raster') {
      const l = new RasterLayer('レイヤー 1');
      d.layers[0] = l;
      d.activeId = l.id;
    }
    deps.loadDocument(d, null);
    return text({ ok: true, artboard: d.artboard, layer: d.activeLayer.id });
  },

  async kodai_open({ path }) {
    const r = await openProjectPath(path);
    deps.loadDocument(r.doc, r.path);
    return H.kodai_get_state({});
  },

  async kodai_save({ path } = {}) {
    const p = path || state.filePath;
    if (!p || !/[\\/]/.test(p)) fail('保存先(path: .kodai の絶対パス)を指定してください');
    if (!window.native) fail('保存には Kodai のアプリ版が必要です');
    const o = serialize(doc());
    const fonts = embeddedFonts(doc());
    if (fonts.length) o.fonts = fonts;
    await window.native.writeText(p, JSON.stringify(o));
    state.filePath = p;
    state.dirty = false;
    emit('title');
    return text({ ok: true, path: p });
  },

  async kodai_export({ path, format, scale = 1, frame, columns = 0, loop = true }) {
    const d = doc(), a = d.artboard;
    const fmt = format || (path.toLowerCase().endsWith('.gif') ? 'gif' : 'png');
    const k = Math.min(32, Math.max(1, Math.round(scale)));
    if (Math.max(a.w, a.h) * k > 16384) fail('書き出しが大きすぎます。scale を下げてください');
    if (fmt === 'png') {
      const f = frame !== undefined ? Math.min(d.frames.length - 1, Math.max(0, frame)) : timeline.frame;
      await writeFile(path, await pngBytes(flatten(d, k, a, f)));
    } else if (fmt === 'gif') {
      if (!path.toLowerCase().endsWith('.gif')) fail('gif は .gif のパスにしてください');
      const frames = d.frames.map((fr, i) => { const c = flatten(d, k, a, i); return { img: c.getContext('2d').getImageData(0, 0, c.width, c.height), delay: fr.duration }; });
      await writeFile(path, encodeGif(frames, { loop: loop ? 0 : 1 }));
    } else {
      const n = d.frames.length, cols = columns > 0 ? Math.min(columns, n) : n, rows = Math.ceil(n / cols);
      const fw = a.w * k, fh = a.h * k;
      const sheet = createCanvas(fw * cols, fh * rows), ctx = sheet.getContext('2d');
      const meta = { frames: [], meta: { app: 'Kodai', size: { w: fw * cols, h: fh * rows }, frameSize: { w: fw, h: fh }, scale: k } };
      d.frames.forEach((fr, i) => {
        const x = (i % cols) * fw, y = Math.floor(i / cols) * fh;
        ctx.drawImage(flatten(d, k, a, i), x, y);
        meta.frames.push({ index: i, x, y, w: fw, h: fh, duration: fr.duration });
      });
      await writeFile(path, await pngBytes(sheet));
      if (window.native) {
        const jp = path.replace(/\.png$/i, '.json');
        if (jp !== path) await window.native.writeText(jp, JSON.stringify(meta, null, 2)).catch(() => {});
      }
    }
    return text({ ok: true, path, format: fmt, size: { w: a.w * k, h: a.h * k }, frames: fmt === 'png' ? 1 : d.frames.length });
  },

  async kodai_view({ frame, max_size = 768, region, tile = false, grid = false } = {}) {
    const d = doc();
    const r = region ? { x: finite(region.x, 'region.x'), y: finite(region.y, 'region.y'), w: Math.max(1, finite(region.w, 'region.w')), h: Math.max(1, finite(region.h, 'region.h')) } : d.artboard;
    const f = frame !== undefined ? Math.min(d.frames.length - 1, Math.max(0, frame)) : timeline.frame;
    const max = Math.min(1600, Math.max(64, max_size));
    const reps = tile ? 2 : 1;
    const longest = Math.max(r.w, r.h) * reps;
    // 小さい絵(ドット絵)は整数倍で拡大してぼかさない
    const k = longest <= max ? Math.max(1, Math.floor(max / longest)) : max / longest;
    const src = flatten(d, k >= 1 ? k : 1, r, f);
    const W = Math.max(1, Math.round(r.w * k)), Hh = Math.max(1, Math.round(r.h * k));
    const out = createCanvas(W * reps, Hh * reps), ctx = out.getContext('2d');
    if (!d.background) checker(ctx, out.width, out.height, Math.max(4, Math.round(8 * Math.min(1, k))));
    ctx.imageSmoothingEnabled = k < 1;
    for (let j = 0; j < reps; j++) for (let i = 0; i < reps; i++) ctx.drawImage(src, i * W, j * Hh, W, Hh);
    let shown = out;
    // マス目と座標: 1ドットごとの細い線、8ドットごとの太い線と数字(ワールド座標)
    if (grid && k >= 4 && !tile) {
      const M = 22, g = createCanvas(out.width + M, out.height + M), gx = g.getContext('2d');
      gx.fillStyle = '#1f2937'; gx.fillRect(0, 0, g.width, g.height);
      gx.drawImage(out, M, M);
      gx.font = '11px monospace'; gx.textBaseline = 'middle';
      for (let i = 0; i <= r.w; i++) {
        const X = M + i * k + 0.5, wx = r.x + i, major = wx % 8 === 0;
        gx.strokeStyle = major ? 'rgba(239,68,68,0.55)' : 'rgba(0,0,0,0.18)';
        gx.beginPath(); gx.moveTo(X, M); gx.lineTo(X, M + Hh); gx.stroke();
        if (major && i < r.w) { gx.fillStyle = '#fca5a5'; gx.fillText(String(wx), X + 1, M / 2); }
      }
      for (let j = 0; j <= r.h; j++) {
        const Y = M + j * k + 0.5, wy = r.y + j, major = wy % 8 === 0;
        gx.strokeStyle = major ? 'rgba(239,68,68,0.55)' : 'rgba(0,0,0,0.18)';
        gx.beginPath(); gx.moveTo(M, Y); gx.lineTo(M + W, Y); gx.stroke();
        if (major && j < r.h) { gx.fillStyle = '#fca5a5'; gx.fillText(String(wy), 1, Y + Math.min(8, k / 2)); }
      }
      shown = g;
    }
    const note = `${r.w}×${r.h}px を ${k >= 1 ? `${k}倍` : `${Math.round(k * 100)}%`} で表示${tile ? '(2×2 に並べて)' : ''}${shown !== out ? '。マス目つき: 赤い線と数字 = 8ドットごとのワールド座標' : ''}。フレーム ${f + 1}/${d.frames.length}`;
    return { content: [{ type: 'image', data: base64(await pngBytes(shown)), mimeType: 'image/png' }, { type: 'text', text: note }] };
  },

  kodai_add_layer({ type, name }) {
    if (!['vector', 'raster'].includes(type)) fail('type は vector か raster');
    layers.addLayer(type);
    const l = doc().activeLayer;
    if (name) { l.name = String(name); emit('layers'); }
    return text({ ok: true, id: l.id, name: l.name, type: l.type });
  },

  kodai_layer({ id, name, visible, opacity, locked, pixel, active, move, clear, delete: del }) {
    const l = findLayer(id);
    const d = doc();
    if (del) {
      if (d.layers.length <= 1) fail('最後のレイヤーは消せません');
      layers.setActiveLayer(l.id);
      layers.deleteLayer();
      return text({ ok: true, deleted: l.id });
    }
    const prop = (key, val, label) => {
      if (val === undefined || l[key] === val) return;
      state.history.push(propEntry(label, l, key, l[key], val));
      l[key] = val;
      l.touch?.();
    };
    if (name !== undefined) prop('name', String(name), 'レイヤー名を変更');
    if (visible !== undefined) prop('visible', !!visible, '表示を切り替え');
    if (opacity !== undefined) prop('opacity', Math.min(1, Math.max(0, finite(opacity, 'opacity'))), '不透明度を変更');
    if (locked !== undefined) prop('locked', !!locked, 'ロックを切り替え');
    if (pixel !== undefined) prop('pixel', Math.max(0, finite(pixel, 'pixel')), 'ドット化');
    if (active || move) layers.setActiveLayer(l.id);
    if (move) {
      const steps = move === 'up' ? 1 : move === 'down' ? -1 : 0;
      if (steps) layers.moveLayer(steps);
      else for (let i = 0; i < d.layers.length; i++) layers.moveLayer(move === 'top' ? 1 : -1);
    }
    if (clear) {
      editable(l);
      if (l.type === 'vector') {
        const before = structuredClone(l.shapes);
        l.shapes = [];
        pushVector('レイヤーを空にする', l, before);
      } else {
        const coords = [...l.tiles.values()].map((t) => [t.tx, t.ty]);
        recordTiles(state.history, 'レイヤーを空にする', l, coords, () => l.tiles.clear());
      }
    }
    emit('layers');
    requestRender();
    return text({ ok: true, layer: layerInfo(l) });
  },

  async kodai_add_shapes({ layer, shapes }) {
    if (!Array.isArray(shapes) || !shapes.length) fail('shapes に図形を1つ以上');
    const list = [];
    for (let i = 0; i < shapes.length; i++) list.push(await toShape(shapes[i], `shapes[${i}]`));
    const l = targetLayer(layer, 'vector');
    pushAppend('Claude: 図形を描く', l, list);
    clearSelection();
    return text({ ok: true, layer: l.id, ids: list.map((s) => s.id), bounds: box(union(list.map(shapeBounds))) });
  },

  kodai_edit_shapes({ layer, ids, set, translate, scale, rotate, flip, order, delete: del }) {
    const l = editable(findLayer(layer, { type: 'vector' }));
    ensureIds(l.shapes);
    const pick = ids?.length ? new Set(ids) : new Set(l.shapes.map((s) => s.id));
    const missing = ids?.filter((id) => !l.shapes.some((s) => s.id === id)) || [];
    if (missing.length) fail(`図形がありません: ${missing.join(', ')}(kodai_get_state の shapes: true で確認)`);
    const before = structuredClone(l.shapes);
    const sel = () => l.shapes.filter((s) => pick.has(s.id));
    const b = () => union(sel().map(shapeBounds));
    const map = (fn) => { l.shapes = l.shapes.map((s) => (pick.has(s.id) ? fn(s) : s)); };
    if (del) l.shapes = l.shapes.filter((s) => !pick.has(s.id));
    else {
      if (set) {
        const patch = { ...set };
        delete patch.id; delete patch.type;
        for (const k of ['fill', 'stroke']) if (k in patch) patch[k] = color(patch[k]);
        for (const k of ['fillGrad', 'strokeGrad']) if (patch[k]) patch[k] = grad(patch[k]);
        map((s) => (s.type === 'group' && ('fill' in patch || 'stroke' in patch)
          ? { ...s, ...('pixel' in patch ? { pixel: patch.pixel } : {}), children: s.children.map((c) => ({ ...c, ...patch })) }
          : { ...s, ...patch }));
      }
      if (translate) { const dx = Number(translate.dx) || 0, dy = Number(translate.dy) || 0; map((s) => translateShape(s, dx, dy)); }
      if (scale) {
        const r = b(), cx = scale.cx ?? (r.x0 + r.x1) / 2, cy = scale.cy ?? (r.y0 + r.y1) / 2;
        const sx = finite(scale.sx ?? scale.sy, 'scale.sx'), sy = finite(scale.sy ?? scale.sx, 'scale.sy');
        map((s) => scaleShape(s, cx, cy, sx, sy));
      }
      if (rotate) {
        const r = b(), cx = rotate.cx ?? (r.x0 + r.x1) / 2, cy = rotate.cy ?? (r.y0 + r.y1) / 2;
        const a = (finite(rotate.deg, 'rotate.deg') * Math.PI) / 180;
        map((s) => rotateShape(s, cx, cy, a));
      }
      if (flip) {
        const r = b(), cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
        map((s) => reflectShape(s, cx, cy, flip === 'v' ? 0 : 90));
      }
      if (order === 'front' || order === 'back') {
        const moving = l.shapes.filter((s) => pick.has(s.id)), rest = l.shapes.filter((s) => !pick.has(s.id));
        l.shapes = order === 'front' ? [...rest, ...moving] : [...moving, ...rest];
      }
    }
    pushVector('Claude: 図形を直す', l, before);
    clearSelection();
    return text({ ok: true, ids: del ? [] : sel().map((s) => s.id), bounds: del ? null : box(b()) });
  },

  async kodai_shape_ops({ op, layer, ids }) {
    const l = editable(findLayer(layer, { type: 'vector' }));
    const missing = (ids || []).filter((id) => !l.shapes.some((s) => s.id === id));
    if (!ids?.length || missing.length) fail(missing.length ? `図形がありません: ${missing.join(', ')}` : 'ids を指定してください');
    if (['unite', 'minus', 'intersect', 'exclude'].includes(op) && ids.length < 2) fail('パスファインダーは図形を2つ以上');
    layers.setActiveLayer(l.id);
    setSelection(l, ids);
    const n = state.history.undoStack.length;
    if (op === 'group') groupSelection();
    else if (op === 'ungroup') ungroupSelection();
    else if (op === 'outline') await outlineSelection();
    else if (['unite', 'minus', 'intersect', 'exclude'].includes(op)) await pathfinder(op);
    else fail('op が読めません');
    const changed = state.history.undoStack.length > n;
    const out = state.selection?.ids || [];
    clearSelection();
    if (!changed) fail('変更できませんでした(図形の種類を確かめてください)');
    return text({ ok: true, ids: out });
  },

  kodai_put_pixels({ layer, x = 0, y = 0, rows, palette, scale = 1, erase = false }) {
    if (!Array.isArray(rows) || !rows.length) fail('rows に1行以上');
    const k = Math.min(64, Math.max(1, Math.round(scale)));
    const pal = new Map();
    for (const [ch, c] of Object.entries(palette || {})) {
      if ([...ch].length !== 1) fail(`palette のキーは1文字: 「${ch}」`);
      const p = parseHex(color(c, '#000000ff'));
      pal.set(ch, [p.r, p.g, p.b, p.a]);
    }
    const unknown = new Set();
    for (const r of rows) for (const ch of [...String(r)]) if (ch !== '.' && ch !== ' ' && !pal.has(ch)) unknown.add(ch);
    if (unknown.size) fail(`palette にない文字: ${[...unknown].join(' ')}`);
    const l = targetLayer(layer, 'raster');
    const X = Math.round(finite(x, 'x')), Y = Math.round(finite(y, 'y'));
    const W = Math.max(...rows.map((r) => [...String(r)].length)) * k, Hh = rows.length * k;
    let count = 0;
    recordTiles(state.history, 'Claude: ドットを置く', l, tileCoordsInRect(X, Y, X + W, Y + Hh), () => {
      const img = l.getImageData(X, Y, W, Hh);
      rows.forEach((r, j) => [...String(r)].forEach((ch, i) => {
        const c = pal.get(ch);
        if (!c) return;
        count++;
        for (let yy = 0; yy < k; yy++) for (let xx = 0; xx < k; xx++) {
          const o = ((j * k + yy) * W + i * k + xx) * 4;
          if (erase) img.data.fill(0, o, o + 4);
          else img.data.set(c, o);
        }
      }));
      l.putImageData(img, X, Y);
    });
    requestRender();
    return text({ ok: true, layer: l.id, pixels: count, area: { x: X, y: Y, w: W, h: Hh } });
  },

  async kodai_texture(o) {
    const img = makeTexture(o);
    const res = { ok: true, width: img.width, height: img.height };
    const place = o.place || 'layer';
    if (place !== 'none') {
      const l = placeTexture(img, { fill: place === 'fill', name: o.name || `テクスチャ(${o.type})`, x: o.x, y: o.y });
      res.layer = l.id;
    }
    if (o.save_path) { await writeFile(o.save_path, await pngBytes(canvasOf(img))); res.saved = o.save_path; }
    return text(res);
  },

  async kodai_character(a) {
    const opts = { ...(a.random !== undefined ? randomCharacter(a.random) : {}) };
    if (a.preset) opts.preset = a.preset;
    for (const k of ['body', 'hair', 'eyes', 'mouth', 'top', 'bottom', 'hat', 'item', 'outline', 'blush', 'anim']) if (a[k] !== undefined) opts[k] = a[k];
    if (a.random !== undefined || a.colors) {
      opts.colors = { ...(opts.colors || {}) };
      for (const [k, v] of Object.entries(a.colors || {})) if (v) opts.colors[k] = color(v).slice(0, 7);
    }
    const place = a.place || 'document';
    if ((place === 'document' || place === 'sheet') && state.dirty && !a.discard_unsaved) fail('保存していない変更があります。ユーザーに確認してから discard_unsaved: true で呼ぶか、place: "layer" で今の絵に置いてください');
    const res = { ok: true };
    if (place !== 'none') {
      const r = placeCharacter(opts, { view: a.view || 'front', place, x: a.x, y: a.y, name: a.name, loadDocument: deps.loadDocument });
      Object.assign(res, { layer: r.layer.id, frames: r.frames, size: r.size });
    }
    if (a.save_path) { await writeFile(a.save_path, await pngBytes(canvasOf(characterSheet(opts)))); res.saved = a.save_path; res.sheet = '行 = 正面・左・右・後ろ、列 = コマ'; }
    return text(res);
  },

  kodai_pixel_ops({ op, layer, color: col, diagonal, depth, highlight, from, center, colors, region }) {
    const l = findLayer(layer, { type: 'raster' });
    let reg = region ? { x: Math.round(region.x), y: Math.round(region.y), w: Math.max(1, Math.round(region.w)), h: Math.max(1, Math.round(region.h)) } : undefined;
    if (op === 'mirror' && !reg) { const a = doc().artboard; reg = { x: a.x, y: a.y, w: a.w, h: a.h }; }
    const vertical = from === 'top' || from === 'bottom';
    const fns = {
      outline: (img) => outlineImage(img, { color: col ? color(col).slice(0, 7) : 'auto', diagonal: !!diagonal }),
      shade: (img) => shadeImage(img, { depth: Math.min(6, Math.max(1, depth ?? 2)), highlight: highlight !== false }),
      mirror: (img) => mirrorImage(img, { from: from || 'left', center: center !== undefined ? center - (vertical ? reg.y : reg.x) : undefined }),
      reduce: (img) => reduceImage(img, { colors: Math.min(64, Math.max(2, colors ?? 8)) }),
    };
    if (!fns[op]) fail('op は outline / shade / mirror / reduce');
    let res;
    try { res = applyToLayer(editable(l), 'Claude: ' + op, fns[op], reg); } catch (err) { fail(err.message); }
    return text({ ok: true, op, changed: res.changed, palette: res.palette });
  },

  async kodai_to_3d({ path, render_path, yaw, pitch, zoom, size, turn, shadow, rig, gap, shape, front, side, back, res: r, thick, flat, nearest, round, side_left, height, wire }) {
    // この向きで書き出す(.png = APNG、.gif = GIF)。yaw・pitch は度
    const renderOut = async (target) => {
      const frames = solidFrames(target, { yaw: ((yaw ?? 30) * Math.PI) / 180, pitch: ((pitch ?? 10) * Math.PI) / 180, zoom: zoom ?? 1, size: Math.min(1024, Math.max(64, Math.round(size ?? 384))), turn: !!turn, shadow: shadow !== false });
      await writeFile(render_path, await solidFramesTo(frames, /\.gif$/i.test(render_path) ? 'gif' : frames.length > 1 ? 'apng' : 'png'));
      return { rendered: render_path, rendered_frames: frames.length };
    };
    if (rig) {
      // パーツ(レイヤー)ごとのカード + ボーン + 動き
      let rg;
      try { rg = buildRigged(doc(), Object.fromEntries(Object.entries({ res: r, thick, gap, flat, nearest, height }).filter(([, v]) => v !== undefined))); } catch (err) { fail(err.message); }
      const s = rg.stats;
      const info = { ok: true, mode: 'パーツごとのカード + ボーン', parts: s.parts, bones: s.bones, skinned_parts: s.skinned, animation_frames: s.frames, seconds: +s.seconds.toFixed(2), triangles: s.triangles, size_m: s.size.map((v) => +v.toFixed(3)) };
      if (!s.bones) info.note = 'ボーンがないので動きません。kodai_rig でボーンを入れてレイヤーをつないでください';
      if (path) { const bytes = await riggedToGlb(rg, { name: 'Kodai' }); await writeFile(path, bytes); info.saved = path; info.bytes = bytes.length; }
      if (render_path) Object.assign(info, await renderOut({ rigged: rg }));
      // 確認用: 元の形(正面・ななめ)と、動きの途中2つ(正面)
      const shot = (key, views) => {
        if (key) { let o2 = 0; for (const p of skinPositions(rg, key)) { rg.merged.positions.set(p, o2); o2 += p.length; } }
        return renderSolidViews(rg.merged, views, 256, { wire: !!wire });
      };
      const a = shot(null, [[0, 0.1], [0.7, 0.2]]);
      const cv = createCanvas(256 * 4, 256), cx = cv.getContext('2d');
      cx.drawImage(a, 0, 0);
      if (rg.anim) { const n = rg.anim.keys.length - 1; cx.drawImage(shot(rg.anim.keys[Math.floor(n / 4)], [[0, 0.1]]), 512, 0); cx.drawImage(shot(rg.anim.keys[Math.floor((n * 3) / 4)], [[0, 0.1]]), 768, 0); }
      return { content: [{ type: 'image', data: base64(await pngBytes(cv)), mimeType: 'image/png' }, { type: 'text', text: JSON.stringify(info) + ' / 画像は左から 正面・ななめ・動きの途中 2つ' }] };
    }
    const opt = {};
    for (const [k, v] of Object.entries({ shape, res: r, thick, flat, nearest, round, sideLeft: side_left, height })) if (v !== undefined) opt[k] = v;
    let solid;
    try { solid = solidFromDoc({ front: front ? findLayer(front) : 'all', side: side ? findLayer(side) : null, back: back ? findLayer(back) : null }, opt); } catch (err) { fail(err.message); }
    const s = solid.stats;
    const info = { ok: true, mode: { hull: '型抜き(正面 + 真横)', inflate: 'ふくらませる(正面だけ)', card: 'カード(同じ厚みの板)' }[s.mode], vertices: s.vertices, triangles: s.triangles, size_m: s.size.map((v) => +v.toFixed(3)), texture: s.texture };
    if (path) { const bytes = await solidToGlb(solid, { name: 'Kodai' }); await writeFile(path, bytes); info.saved = path; info.bytes = bytes.length; }
    if (render_path) Object.assign(info, await renderOut({ solid }));
    const img = renderSolidViews(solid, undefined, 256, { wire: !!wire });
    return { content: [{ type: 'image', data: base64(await pngBytes(img)), mimeType: 'image/png' }, { type: 'text', text: JSON.stringify(info) + ' / 画像は左から 正面・ななめ・横・後ろ' }] };
  },

  async kodai_telop({ path, fps, loop, trim, still, to_document, discard_unsaved, preview = true, ...a }) {
    if (a.template !== undefined && !TELOP_TEMPLATES[a.template]) fail(`template は ${Object.keys(TELOP_TEMPLATES).join(' / ')}`);
    if (!a.template && a.text === undefined) fail('text(メインの文字)か template が必要です');
    const o = telopOptions(a);
    await prepareTelopFonts(o);
    const T = telopTimes(o);
    const res = { ok: true, size: { w: o.width, h: o.height }, seconds: +T.total.toFixed(2) };
    if (path) {
      const gif = /\.gif$/i.test(path);
      if (still) { await writeFile(path, await pngBytes(telopStill(o))); res.format = 'png(静止画)'; }
      else if (gif) { const f = Math.min(30, Math.max(5, fps ?? 15)); await writeFile(path, await telopGif(o, { fps: f, loop: loop !== false })); res.format = 'gif'; res.frames = telopFrameCount(o, f); }
      else {
        const f = Math.min(60, Math.max(5, fps ?? 24));
        const r = await telopApng(o, { fps: f, loop: loop ? 0 : 1, trim: !!trim });
        await writeFile(path, r.bytes);
        Object.assign(res, { format: 'apng', frames: r.frames, size: { w: r.width, h: r.height }, bytes: r.bytes.length });
      }
      res.saved = path;
    }
    if (to_document) {
      if (state.dirty && !discard_unsaved) fail('保存していない変更があります。ユーザーに確認してから discard_unsaved: true で呼んでください');
      const r = await telopToDocument(o, { fps: Math.min(24, Math.max(5, fps ?? 12)), loadDocument: deps.loadDocument });
      res.document = { layer: r.layer.id, frames: r.frames };
    }
    const content = [{ type: 'text', text: JSON.stringify(res) }];
    if (preview) {
      // 完成した状態を小さくして返す(確認用)
      const full = telopStill(o), k = Math.min(1, 640 / o.width);
      const sm = createCanvas(Math.round(o.width * k), Math.round(o.height * k)), sx = sm.getContext('2d');
      sx.fillStyle = '#30333c'; sx.fillRect(0, 0, sm.width, sm.height);
      sx.drawImage(full, 0, 0, sm.width, sm.height);
      content.unshift({ type: 'image', data: base64(await pngBytes(sm)), mimeType: 'image/png' });
    }
    return { content };
  },

  kodai_effects({ layer, preset, items, add, dot, clear, frames, bake }) {
    const l = editable(findLayer(layer));
    if (frames !== undefined) ensureFrames(Math.min(64, Math.max(1, Math.round(frames))));
    let list = clear ? [] : (l.fx?.items || []).map((it) => ({ ...it }));
    if (preset !== undefined) {
      if (!FX_PRESETS[preset]) fail(`preset は ${Object.keys(FX_PRESETS).join(' / ')}`);
      list = FX_PRESETS[preset].items.map(({ type, ...o }) => newFxItem(type, o));
    }
    const mk = (it) => {
      if (!FX_TYPES[it?.type]) fail(`type は ${Object.keys(FX_TYPES).join(' / ')}`);
      const { type, ...o } = it;
      return newFxItem(type, o);
    };
    if (items) list = items.map(mk);
    if (add) list.push(...add.map(mk));
    const fx = list.length ? normalizeFx({ dot: dot ?? l.fx?.dot ?? 1, items: list }) : null;
    setLayerFx(l, fx, fx ? 'Claude: エフェクト' : 'Claude: エフェクトを外す');
    const res = { ok: true, layer: l.id, frames: doc().frames.length, effects: l.fx?.items || [] };
    if (bake && l.fx) {
      const r = bakeFx(l);
      res.baked = { back: r?.back?.id || null, front: r?.front?.id || null };
      res.effects = l.fx?.items || [];
    }
    if (res.frames < 2 && l.fx) res.note = 'フレームが1つなので止まった絵です。動かすには frames: 8 など';
    return text(res);
  },

  kodai_get_pixels({ layer, x, y, w, h }) {
    const l = findLayer(layer, { type: 'raster' });
    const W = Math.round(finite(w, 'w')), Hh = Math.round(finite(h, 'h'));
    if (W < 1 || Hh < 1 || W > 128 || Hh > 128) fail('w・h は 1〜128');
    const r = toRows(l.getImageData(Math.round(finite(x, 'x')), Math.round(finite(y, 'y')), W, Hh));
    if (r.error) fail(r.error);
    return text({ x: Math.round(x), y: Math.round(y), ...r });
  },

  async kodai_import_image({ path, x, y, name }) {
    if (!window.native) fail('Kodai のアプリ版が必要です');
    const bmp = await decodeImage(new Blob([await window.native.readBinary(path)]));
    const c = createCanvas(bmp.width, bmp.height), ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const a = doc().artboard;
    const l = new RasterLayer(name || path.split(/[\\/]/).pop().replace(/\.[^.]+$/, ''));
    const X = Math.round(x ?? a.x + (a.w - bmp.width) / 2), Y = Math.round(y ?? a.y + (a.h - bmp.height) / 2);
    l.putImageData(ctx.getImageData(0, 0, bmp.width, bmp.height), X, Y);
    layers.insertLayers('Claude: 画像を置く', [l]);
    return text({ ok: true, layer: l.id, x: X, y: Y, w: bmp.width, h: bmp.height });
  },

  async kodai_font_from_image({ path, chars, name, kind = 'vector', grid = 16, polarity = 'auto', threshold, top, base, install = true, otf_path, fill = true, sets, weight, stem, new_font = false }) {
    if (!window.native) fail('Kodai のアプリ版が必要です');
    const list = [...String(chars ?? '')].filter((c) => c.trim());
    if (!list.length) fail('chars(画像の字を左上から順に)が必要です');
    const bmp = await decodeImage(new Blob([await window.native.readBinary(path)]));
    const an = analyzeImage(imageDataOf(bmp), { polarity, threshold: threshold === undefined ? null : Math.min(240, Math.max(16, finite(threshold, 'threshold'))) });
    const letters = lettersOf(an, autoJoins(an, list.length));
    if (!letters.length) fail('字が見つかりません。polarity(light / dark)か threshold を変えてください');
    const bands = an.bands.map((b) => ({ ...b }));
    if (top !== undefined) bands[0].top = finite(top, 'top');
    if (base !== undefined) bands[0].base = finite(base, 'base');
    if (bands[0].base <= bands[0].top) fail('base は top より下(大きい値)にしてください');
    let fresh = false, opened = null;
    // 前に作ったフォント(作業ファイルがある)と同じ名前なら、それを開いて字を足す・入れ替える
    if (!isFontDoc() && name && !new_font && (await editableFonts()).made.includes(name)) {
      await enterFontMode({ doc: (await fontDocOf(name)).doc });
      opened = name;
    }
    if (!isFontDoc()) {
      await enterFontMode({ doc: newFontDoc({ name: name || 'MyFont', kind: kind === 'dot' ? 'dot' : 'vector', grid: Math.min(64, Math.max(4, Math.round(grid))), chars: 'A' }) });
      fresh = true;
    } else if (name) state.doc.font.name = name;
    const fillSets = Array.isArray(sets) ? sets.filter((k) => FILL_SETS[k]) : FILL_DEFAULT;
    if (Array.isArray(sets) && sets.some((k) => !FILL_SETS[k])) fail(`sets は ${Object.keys(FILL_SETS).join(' / ')} から選んでください`);
    const r = await importGlyphs(an, letters, list.join(''), bands, { fresh, fill: fill && fillSets.length ? { sets: fillSets, weight: weight === undefined ? FILL_WEIGHT : finite(weight, 'weight'), stem: stem === undefined ? 0 : finite(stem, 'stem') } : null });
    const n = r.glyphs;
    if (!n) fail('字形を作れませんでした');
    const d = doc(), f = d.font;
    const res = { ok: true, font: f.name, found: letters.length, chars: list.length, glyphs: n, filled: r.filled, ...(r.thick ? { brushThick: r.thick } : {}), ...(r.fillError ? { fillError: r.fillError } : {}), rows: an.rows.length, threshold: an.th, polarity: an.polarity, band: bands[0], image: { w: an.w, h: an.h }, fontMode: true, ...(opened ? { opened } : {}) };
    if (letters.length !== list.length) res.warning = `見つけた字(${letters.length})と chars の数(${list.length})が違います。左から順に当てたので、ずれていないか画像で確かめてください(threshold・polarity を変えるか、Kodai のダイアログでつなぎ直す)`;
    if (install || otf_path) {
      const r2 = install ? await installFontDoc(d) : { bytes: await (await import('./fontmode.js')).buildFont(d) };
      if (install) res.family = r2.family;
      if (otf_path) { await writeFile(otf_path, r2.bytes); res.otf = otf_path; }
    }
    const c = fontSheet(d);
    return { content: [{ type: 'image', data: base64(await pngBytes(c)), mimeType: 'image/png' }, { type: 'text', text: JSON.stringify(res) }] };
  },

  // アイコン集: 探す / 置く(編集できるパス)
  kodai_icon({ action = 'list', query = '', name, size = 96, color: c, fill = false, x, y }) {
    if (action === 'list') {
      const list = findIcons(query);
      return text({ ok: true, count: list.length, total: iconList().length, icons: list.map((ic) => ({ id: ic.id, name: ic.name })) });
    }
    if (action !== 'place') fail('action は list / place');
    if (!name) fail('name(アイコンの id か名前。action: "list" で一覧)が必要です');
    const ic = iconList().find((i) => i.id === name || i.name === name) || findIcons(name)[0];
    if (!ic) fail(`「${name}」というアイコンはありません(action: "list" と query で探す)`);
    const sz = finite(size, 'size');
    if (sz < 4 || sz > 4096) fail('size は 4〜4096 px にしてください');
    const s = placeIcon(ic, { size: sz, color: c === undefined ? undefined : color(c, null) || undefined, fill: !!fill, x: x === undefined ? undefined : finite(x, 'x'), y: y === undefined ? undefined : finite(y, 'y') });
    if (!s) fail('置けませんでした(ロックしていないベクターレイヤーが要ります)');
    return text({ ok: true, icon: ic.id, name: ic.name, layer: doc().activeLayer.id, ids: state.selection?.ids || [], fill: !!fill });
  },

  // タブ: 一覧 / 切り替え / 閉じる
  async kodai_tabs({ action = 'list', index, layer, shape_ids, discard_unsaved = false }) {
    if (action !== 'list') {
      const list = tabList();
      const i = Math.round(Number(index));
      if (!Number.isFinite(i) || !list[i]) fail(`index は 0〜${list.length - 1} のタブの番号にしてください(action: "list" で一覧)`);
      if (action === 'switch') switchTab(i);
      else if (action === 'copy') {
        // 今のタブの図形を、index のタブに貼る(貼ったあとは、そのタブが今のタブ)
        if (i === activeIndex()) fail('index には、貼る先のほかのタブを');
        const l = layer ? findLayer(layer) : doc().activeLayer;
        if (!l || l.type !== 'vector') fail('図形のあるベクターのレイヤーを layer で指定してください');
        const ids = Array.isArray(shape_ids) && shape_ids.length ? shape_ids : l.shapes.map((s) => s.id);
        if (!ids.length) fail('コピーする図形がありません');
        setSelection(l, ids);
        if (!(await copySelection())) fail('コピーできませんでした');
        switchTab(i);
        if (!(await paste(false))) fail('貼り付けられませんでした');
      }
      else if (action === 'close') {
        const t = tabsInfo()[i];
        if (t.unsaved && !discard_unsaved) fail(`「${t.name}」に保存していない変更があります。kodai_save で保存するか、ユーザーに確認してから discard_unsaved: true で呼んでください`);
        await closeTab(i, { force: true });
      } else if (action !== 'copy') fail('action は list / switch / copy / close');
    }
    return text({ ok: true, tabs: tabsInfo() });
  },

  // 作ったフォント: 一覧 / 開く(フォントのタブを開く)/ アプリに入れ直す / フォント作成を終わる(タブを閉じる)
  async kodai_font({ action = 'list', name, otf_path, discard_unsaved }) {
    if (action === 'list') {
      const ed = await editableFonts();
      return text({ ok: true, made: ed.made, outline_only: ed.outline, editing: isFontDoc() ? doc().font.name : null });
    }
    if (action === 'open') {
      if (!name) fail('name(フォントの名前)が必要です');
      const ed = await editableFonts();
      if (![...ed.made, ...ed.outline].includes(name)) fail(`「${name}」は見つかりません。開けるフォント: ${[...ed.made, ...ed.outline].join('、') || 'なし'}`);
      const r = await fontDocOf(name);
      await enterFontMode({ doc: r.doc });
      // 開いただけでは「保存していない変更」にしない
      state.dirty = false;
      emit('title');
    } else if (action === 'install') {
      if (!isFontDoc()) fail('フォントを開いていません(action: "open" か kodai_font_from_image で)');
      const r = await installFontDoc(doc());
      if (otf_path) await writeFile(otf_path, r.bytes);
    } else if (action === 'close') {
      if (!isFontDoc()) return text({ ok: true, editing: null });
      if (state.dirty && !discard_unsaved) fail('フォントに保存していない変更があります。action: "install" でアプリに入れる・kodai_save で保存するか、ユーザーに確認してから discard_unsaved: true で呼んでください');
      state.dirty = false;
      await exitFontMode();
      return text({ ok: true, editing: null });
    } else fail('action は list / open / install / close');
    const d = doc(), glyphs = d.frames.filter((fr) => fr.glyph);
    const res = { ok: true, editing: d.font.name, glyphs: glyphs.length, auto: d.frames.filter((fr, i) => fr.glyph && isAutoGlyph(d, i)).length, kind: d.font.kind, chars: glyphs.slice(0, 200).map((fr) => fr.glyph.char).join('') };
    return { content: [{ type: 'image', data: base64(await pngBytes(fontSheet(d))), mimeType: 'image/png' }, { type: 'text', text: JSON.stringify(res) }] };
  },

  // 素材ライブラリ: 一覧 / フォルダを取り込む / 置く / 消す
  async kodai_library({ action = 'list', folder, group, name, place = 'layer', scale, width, height, seamless = false, pixel = 1, x, y, layer_name, save_path, query }) {
    if (!window.native?.library) fail('素材ライブラリは Kodai のアプリ版で使えます');
    if (action === 'import') {
      if (!folder) fail('folder(取り込むフォルダの絶対パス)が必要です');
      const r = await libraryImportFolder(folder, group);
      return text({ ok: true, ...r, big: r.big.slice(0, 20), message: importSummary(r) });
    }
    if (action === 'list') {
      const all = await libraryList(true);
      const key = String(query || '').toLowerCase();
      const list = all.filter((a) => (!group || a.group === group || a.group.startsWith(group + '/')) && (!key || a.id.toLowerCase().includes(key)));
      const groups = {};
      for (const a of all) groups[a.group] = (groups[a.group] || 0) + 1;
      return text({ ok: true, total: all.length, groups, shown: Math.min(list.length, 400), items: list.slice(0, 400).map((a) => a.id) });
    }
    if (action === 'remove') {
      if (name) { const f = await libraryFind(name); if (f.length !== 1) fail(f.length ? `「${name}」に当てはまる素材が ${f.length}つあります: ${f.slice(0, 10).map((a) => a.id).join('、')}` : `「${name}」は見つかりません`); await libraryRemove(f[0].id); return text({ ok: true, removed: f[0].id }); }
      if (group) { await libraryRemoveGroup(group); return text({ ok: true, removedGroup: group }); }
      fail('name(素材)か group(グループ)が必要です');
    }
    if (action !== 'place') fail('action は list / import / place / remove');
    if (!name) fail('name(素材の名前。action: "list" の items から)が必要です');
    const found = await libraryFind(name);
    if (!found.length) fail(`「${name}」は見つかりません(action: "list" で確かめてください)`);
    if (found.length > 1) fail(`「${name}」に当てはまる素材が ${found.length}つあります。グループから書いてください: ${found.slice(0, 10).map((a) => a.id).join('、')}`);
    const asset = found[0], opts = { scale, width, height, seamless, pixel };
    const res = { ok: true, asset: asset.id };
    let img;
    if (place !== 'none') {
      const r = await placeAsset(asset, opts, { fill: place === 'fill', x, y, name: layer_name });
      Object.assign(res, { layer: r.layer.id, width: r.width, height: r.height });
      img = r.img;
    } else {
      img = (await import('./library.js')).processAsset(await libraryBitmap(asset.id), opts);
      Object.assign(res, { width: img.width, height: img.height });
    }
    if (save_path) { await writeFile(save_path, await pngBytes(canvasOf(img))); res.saved = save_path; }
    // 確認用の小さい絵
    const k = Math.min(1, 320 / Math.max(img.width, img.height)), sm = createCanvas(Math.max(1, Math.round(img.width * k)), Math.max(1, Math.round(img.height * k)));
    sm.getContext('2d').drawImage(canvasOf(img), 0, 0, sm.width, sm.height);
    return { content: [{ type: 'image', data: base64(await pngBytes(sm)), mimeType: 'image/png' }, { type: 'text', text: JSON.stringify(res) }] };
  },

  kodai_frames({ count, copy = false, frame, duration }) {
    const d = doc();
    if (count !== undefined) {
      const n = Math.min(500, Math.max(1, Math.round(finite(count, 'count'))));
      const cur = timeline.frame;
      if (n !== d.frames.length) {
        framesOp('Claude: フレーム数', (dd) => {
          const last = dd.frames[dd.frames.length - 1];
          while (dd.frames.length < n) {
            const i = dd.frames.length;
            dd.frames.push({ duration: last.duration });
            if (copy) for (const l of dd.layers) { const c = l.cels[cur]; if (c) l.cels[i] = c.clone(); }
          }
          if (dd.frames.length > n) {
            dd.frames.splice(n);
            for (const l of dd.layers) if (l.cels.length > n) l.cels.length = n;
          }
        });
        if (timeline.frame >= n) setFrame(n - 1);
      }
    }
    if (duration !== undefined) setDuration(Math.max(10, finite(duration, 'duration')), true);
    if (frame !== undefined) setFrame(Math.min(d.frames.length - 1, Math.max(0, Math.round(finite(frame, 'frame')))));
    emit('frames');
    requestRender();
    return text({ ok: true, frames: d.frames.length, frame: timeline.frame, duration: d.frames[timeline.frame].duration });
  },

  kodai_rig({ auto, bones, bind, preset, facing }) {
    const d = doc(), rig = d.rig;
    let autoInfo;
    if (auto) { try { autoInfo = autoRig(); } catch (err) { fail(err.message); } }
    if (bones) {
      if (!Array.isArray(bones) || !bones.length) fail('bones に1本以上');
      const before = snapshotRig(d);
      const byName = new Map();
      const list = bones.map((b, i) => {
        const p = (v, k) => { if (!Array.isArray(v) || v.length < 2) fail(`bones[${i}].${k} は [x, y]`); return [finite(v[0], k), finite(v[1], k)]; };
        const [hx, hy] = p(b.head, 'head'), [tx, ty] = p(b.tail, 'tail');
        const bone = { id: uid('b'), name: String(b.name || `ボーン ${i + 1}`), parent: null, hx, hy, tx, ty, role: b.role || null, _parent: b.parent };
        byName.set(bone.name, bone);
        return bone;
      });
      for (const b of list) {
        if (b._parent) {
          const p = byName.get(b._parent);
          if (!p) fail(`親のボーン「${b._parent}」がありません`);
          b.parent = p.id;
        }
        delete b._parent;
      }
      rig.bones = list;
      for (const b of list) if (!b.role) b.role = guessRole(rig, b);
      bumpRig(rig);
      state.history.push(rigEntry('Claude: ボーン', d, before, snapshotRig(d), bumpRig));
      emit('rig');
    }
    if (facing === 1 || facing === -1) rig.facing = facing;
    if (bind) {
      const l = findLayer(bind.layer);
      const after = { mode: 'auto' };
      state.history.push(propEntry('Claude: バインド', l, 'rigBind', l.rigBind, after));
      l.rigBind = after;
      bumpRig(rig);
      layers.setActiveLayer(l.id);
      emit('rig');
    }
    if (preset) {
      if (!PRESETS[preset]) fail(`preset は ${Object.keys(PRESETS).join(' / ')}`);
      const n = d.frames.length;
      applyPreset(preset);
      if (d.frames.length === n && !d.frames.some((f) => f.pose)) fail('プリセットを付けられませんでした(歩く・走るは legL・legR のボーンが必要)');
    }
    requestRender();
    return text({ ok: true, bones: rig.bones.map((b) => ({ name: b.name, role: b.role })), frames: d.frames.length, ...(autoInfo ? { connected: autoInfo.binds, guessed_from_position: autoInfo.guessed } : {}) });
  },

  kodai_undo({ times = 1, redo = false } = {}) {
    const n = Math.min(100, Math.max(1, Math.round(times)));
    for (let i = 0; i < n; i++) (redo ? state.history.redo() : state.history.undo());
    requestRender();
    return text({ ok: true });
  },

  // kodai_run_script はメインプロセス(lib/claude.js)で実行する(画面の CSP が eval を禁止しているため)
};

const LABELS = {
  kodai_get_state: '様子を見ています', kodai_new_document: '新しい絵', kodai_open: '開く', kodai_save: '保存', kodai_export: '書き出し',
  kodai_view: '絵を見ています', kodai_add_layer: 'レイヤーを足す', kodai_layer: 'レイヤー', kodai_add_shapes: '図形を描く',
  kodai_edit_shapes: '図形を直す', kodai_shape_ops: '図形の加工', kodai_put_pixels: 'ドットを置く', kodai_texture: 'テクスチャ',
  kodai_import_image: '画像を置く', kodai_font_from_image: '画像からフォント', kodai_font: '作ったフォント', kodai_library: '素材ライブラリ', kodai_character: 'キャラを作る', kodai_pixel_ops: 'ドット絵の仕上げ', kodai_effects: 'エフェクト', kodai_telop: 'テロップ', kodai_to_3d: '立体にする', kodai_get_pixels: 'ドットを読む', kodai_frames: 'フレーム', kodai_rig: 'リグ', kodai_undo: '元に戻す', kodai_run_script: 'スクリプト', kodai_tabs: 'タブ', kodai_icon: 'アイコン',
};

export async function runTool(name, args = {}) {
  const fn = H[name];
  if (!fn) return { content: [{ type: 'text', text: '知らない道具: ' + name }], isError: true };
  if (isModalOpen()) return { content: [{ type: 'text', text: 'Kodai でダイアログが開いています。ユーザーに閉じてもらってからもう一度' }], isError: true };
  try {
    if (!['kodai_get_state', 'kodai_view'].includes(name)) deps.settle(); // 描きかけのパス・自由変形・文字入力を確定
    if (!['kodai_get_state', 'kodai_view', 'kodai_screenshot'].includes(name)) toast(`Claude: ${LABELS[name] || name}`);
    return await fn(args || {});
  } catch (err) {
    if (!(err instanceof ToolError)) console.error(err);
    return { content: [{ type: 'text', text: err.message || String(err) }], isError: true };
  }
}

// 起動時に app.js から。loadDocument(doc, path) と settle()(作業中の操作を確定)を受け取る
export function initMcp(d) {
  deps = { ...deps, ...d };
  window.native?.claude?.onCall(async ({ id, name, args }) => {
    const result = await runTool(name, args);
    window.native.claude.reply(id, result);
  });
}
