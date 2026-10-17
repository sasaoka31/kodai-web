// フォント作成モード
//   上の「フォント作成」で、フォントのタブを開く(タイムラインは出さない)。絵のタブと行き来でき、絵でコピーした図形を字に貼れる。
//   「フォント作成を終わる」= そのタブを閉じる(開いたときにいた絵のタブへ戻る)。tabs.js
//   1文字 = 1フレーム(frames[i].glyph = { char, advance })。字形はベクターの図形(ペン・パス・四角…)で描く。
//   「ドット」フォントはマス目のドットペン(D)で描く。
//   書き出しは OTF(opentype.js)。字形は線・塗り・重なりを全部「塗り」の輪郭にしてから入れる(outline.js のトレース)
//   「アプリに追加」でそのまま文字ツールのフォントとして使える
//   画像から字を取り込む(fontimage.js・fontimagedlg.js): ロゴや手書きの字の画像を、字ごとに切り分けて字形の図形にする
//   漢字の自動作成(kanji.js): 筆の部品(横画・縦画・はね・払い・点)を描くと、骨組み(KanjiVG)のある字を自動で組み立てる。
//     部品は frames[i].brush = { key, head, tail } のフレーム(一覧には出さない)。自動の字は図形を持たず、表示・書き出しのたびに作る
import { state, on, emit, requestRender, toast } from './state.js';
import { Doc, VectorLayer, VectorCel, timeline, serialize, deserialize } from './document.js';
import { framesOp, setFrame } from './timeline.js';
import { setTimelineHidden } from './layout.js';
import { openDoc, closeTab } from './tabs.js';
import { drawShape, visualBounds } from './vector.js';
import { drawText } from './text.js';
import { traceDrawing, simplifyLoop, loopToNodes, depths } from './outline.js';
import { openModal, escapeHtml } from './modal.js';
import { installFont, ensureFamily, fontProjects, readFontProject, importedFontBytes, fontLists } from './fonts.js';
import { pushVector, editableLayer } from './tools.js';
import { bresenham } from './render.js';
import * as K from './kanji.js';

const UPM = 1000;
const $ = (id) => document.getElementById(id);
const REF_FAMILY = 'Noto Sans JP'; // 下書き(参考の文字)のフォント。1種類だけ
const prefs = { reference: true, preview: 'ABC あいう', sample: '永東必水風戈心女', kanjiOpen: true };
// 筆の部品を描いているときに下に並べるお手本の字(かな・英数字の部品はその字で)
const SAMPLES = { kana: 'あのをぱアネシヲ', latin: 'ARSagk28' };
let gridObserver = null;

export const isFontDoc = (doc = state.doc) => !!doc?.font;
const glyphAt = (i, doc = state.doc) => doc.frames[i]?.glyph;
const brushAt = (i, doc = state.doc) => doc.frames[i]?.brush;
const cellSize = (f) => f.upm / f.grid;

// ---- 新しいフォント ----

function defaultAdvance(font, ch) {
  // 自動で作る英数字は、骨組みの幅に合わせる(I は細く、W は広く)
  if (font.kanji?.on && K.skeletonReady() && K.hasSkeleton(ch)) { const w = K.latinAdvance(font, ch); if (w) return w; }
  const wide = ch.codePointAt(0) >= 0x2e80; // かな・漢字など全角
  const w = wide ? font.upm : font.upm * 0.6;
  return font.kind === 'dot' ? Math.round(w / cellSize(font)) * cellSize(font) : Math.round(w);
}

export function newFontDoc({ name = 'MyFont', kind = 'vector', grid = 16, chars = 'A' } = {}) {
  const font = { name, upm: UPM, kind, grid: kind === 'dot' ? grid : 0 };
  font.ascender = kind === 'dot' ? cellSize(font) * Math.round(grid * 0.85) : 800; // ドットは 8マスなら上7・下1
  font.descender = UPM - font.ascender;
  font.capHeight = Math.round(font.ascender * 0.875);
  font.xHeight = Math.round(font.ascender * 0.625);
  const doc = new Doc({ x: 0, y: 0, w: 600, h: UPM }, 'illust');
  const layer = new VectorLayer('字形');
  doc.layers.push(layer);
  doc.activeId = layer.id;
  doc.font = font;
  const list = [...new Set([...chars])];
  doc.frames = list.map((ch) => ({ duration: 100, glyph: { char: ch, advance: defaultAdvance(font, ch) } }));
  fitArtboard(doc, 0);
  return doc;
}

function fitArtboard(doc = state.doc, i = timeline.frame) {
  if (brushAt(i, doc)) { doc.artboard = { x: 0, y: 0, w: K.BRUSH_W, h: K.BRUSH_H }; return; }
  const g = glyphAt(i, doc);
  if (!g) return;
  doc.artboard = { x: 0, y: 0, w: Math.max(1, Math.round(g.advance)), h: doc.font.upm };
}

// ---- 文字の追加・削除・幅 ----

export const PRESETS = {
  upper: ['英大文字', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'],
  lower: ['英小文字', 'abcdefghijklmnopqrstuvwxyz'],
  digit: ['数字', '0123456789'],
  symbol: ['記号', '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'],
  hira: ['ひらがな', 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんがぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽぁぃぅぇぉっゃゅょー、。'],
  kata: ['カタカナ', 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポァィゥェォッャュョー'],
};

export function addGlyphs(chars, { select = true } = {}) {
  const doc = state.doc;
  const have = new Set(doc.frames.map((f) => f.glyph?.char));
  const add = [...new Set([...chars])].filter((c) => c.trim() && !have.has(c));
  if (!add.length) { toast('追加する文字がありません(もうあります)'); return 0; }
  framesOp(`文字を追加(${add.length})`, (d) => {
    for (const ch of add) d.frames.push({ duration: 100, glyph: { char: ch, advance: defaultAdvance(d.font, ch) } });
    if (select || !glyphAt(timeline.frame, d)) timeline.frame = d.frames.length - add.length;
  });
  fitArtboard();
  emit('font');
  return add.length;
}

export function deleteGlyph(i = timeline.frame) {
  const doc = state.doc;
  if (doc.frames.length <= 1) { toast('最後の文字は消せません'); return; }
  framesOp(`「${glyphAt(i).char}」を削除`, (d) => {
    d.frames.splice(i, 1);
    for (const l of d.layers) l.cels.splice(i, 1);
    timeline.frame = Math.min(i, d.frames.length - 1);
  });
  fitArtboard();
  emit('font');
}

// 字形をまとめて入れる(画像から字を取り込む)。list = [{ char, advance, shapes }]。もうある字は、形と幅を置き換える
export function setGlyphs(list, label = '画像から字を取り込む') {
  const doc = state.doc;
  const layer = doc.layers.find((l) => l.type === 'vector');
  if (!layer || !list.length) return;
  framesOp(label, (d) => {
    let first = -1;
    for (const g of list) {
      let i = d.frames.findIndex((fr) => fr.glyph?.char === g.char);
      if (i < 0) { d.frames.push({ duration: 100, glyph: { char: g.char, advance: g.advance } }); i = d.frames.length - 1; }
      else d.frames[i] = { ...d.frames[i], glyph: { ...d.frames[i].glyph, advance: g.advance } };
      for (const l of d.layers) if (l.type === 'vector') l.cels[i] = new VectorCel(l === layer ? g.shapes : []);
      if (first < 0) first = i;
    }
    timeline.frame = first;
  });
  fitArtboard();
  emit('artboard');
  emit('font');
  requestRender();
}

// 筆の部品をまとめて入れる(画像の字から取り出した筆)。list = [{ key, head, tail, shapes }]。もうある部品は置き換える
export function setBrushes(list, label = '筆の部品を入れる') {
  const doc = state.doc;
  const layer = doc.layers.find((l) => l.type === 'vector');
  if (!layer || !list.length) return;
  framesOp(label, (d) => {
    for (const b of list) {
      let i = d.frames.findIndex((fr) => fr.brush?.key === b.key);
      if (i < 0) { d.frames.push({ duration: 100, brush: { key: b.key, head: b.head, tail: b.tail } }); i = d.frames.length - 1; }
      else d.frames[i] = { ...d.frames[i], brush: { key: b.key, head: b.head, tail: b.tail } };
      for (const l of d.layers) if (l.type === 'vector') l.cels[i] = new VectorCel(l === layer ? structuredClone(b.shapes) : []);
    }
  });
  emit('font');
  requestRender();
}

export function setAdvance(w, i = timeline.frame) {
  const g = glyphAt(i);
  const v = Math.max(1, Math.round(w));
  if (!g || g.advance === v) return;
  framesOp('文字の幅を変更', (d) => { d.frames[i] = { ...d.frames[i], glyph: { ...g, advance: v } }; });
  fitArtboard();
  emit('font');
}

export function selectGlyph(i) {
  setFrame(i);
  fitArtboard();
  emit('artboard');
  emit('font');
  requestRender();
}

// ---- ドットペン(ドットのフォント)----
// マス目をクリック・ドラッグで塗る。塗ってあるマスから始めると消す(右ボタンは必ず消す)

export const dotTool = {
  cursor: 'crosshair',
  down(ev) {
    const doc = state.doc;
    if (!isFontDoc(doc) || doc.font.kind !== 'dot') { toast('ドットペンはドットのフォントで使えます'); return false; }
    const layer = editableLayer();
    if (!layer || layer.type !== 'vector') return false;
    const cs = cellSize(doc.font);
    const c = { x: Math.floor(ev.x / cs), y: Math.floor(ev.y / cs) };
    this.drag = { layer, cs, before: structuredClone(layer.shapes), erase: ev.button === 2 || !!this.find(layer, c, cs), last: c };
    this.apply(c);
    return true;
  },
  find(layer, c, cs) {
    return layer.shapes.find((s) => s.dot && Math.round(s.x / cs) === c.x && Math.round(s.y / cs) === c.y);
  },
  apply(c) {
    const { layer, cs, erase } = this.drag;
    const hit = this.find(layer, c, cs);
    if (erase && hit) layer.shapes.splice(layer.shapes.indexOf(hit), 1);
    else if (!erase && !hit) layer.shapes.push({ type: 'rect', dot: true, x: c.x * cs, y: c.y * cs, w: cs, h: cs, fill: '#000000ff', stroke: null, strokeWidth: 0 });
    else return;
    layer.touch();
    requestRender();
  },
  move(ev) {
    const d = this.drag;
    if (!d) return;
    const c = { x: Math.floor(ev.x / d.cs), y: Math.floor(ev.y / d.cs) };
    if (c.x === d.last.x && c.y === d.last.y) return;
    bresenham(d.last.x, d.last.y, c.x, c.y, (x, y) => this.apply({ x, y }));
    d.last = c;
  },
  up() {
    const d = this.drag;
    this.drag = null;
    if (d && JSON.stringify(d.before) !== JSON.stringify(d.layer.shapes)) pushVector('ドット', d.layer, d.before);
  },
};

// ---- 表示: 下書き(参考の文字)とガイド線 ----

export function drawFontUnderlay(c, view) {
  const doc = state.doc;
  if (!isFontDoc(doc)) return;
  const i = timeline.frame, g = glyphAt(i), f = doc.font;
  c.save();
  c.setTransform(view.dpr * view.zoom, 0, 0, view.dpr * view.zoom, view.dpr * view.ox, view.dpr * view.oy);
  if (g && prefs.reference) {
    c.font = `${f.upm}px "${REF_FAMILY}", sans-serif`;
    c.textBaseline = 'alphabetic';
    c.textAlign = 'center';
    c.fillStyle = 'rgba(59,130,246,0.16)';
    c.fillText(g.char, g.advance / 2, f.ascender);
  }
  // 自動で作った字(図形はないので、ここで描く)
  if (g && isAutoGlyph(doc, i)) for (const s of K.kanjiShapes(doc, g.char, g.advance)) drawShape(c, s);
  // 筆の部品のフレーム: 下にお手本の字を並べて、部品を直した結果をすぐ見せる
  if (brushAt(i) && K.skeletonReady()) {
    // 部品の幅に8字を1列。字面の枠(ベースラインの上 0.88・下 0.12)を白で
    const gap = 14, k = (K.BRUSH_W - gap * 7) / 8 / f.upm, top = f.ascender - f.upm * 0.88;
    [...(SAMPLES[brushAt(i).key] || prefs.sample)].filter((ch) => K.hasSkeleton(ch)).slice(0, 8).forEach((ch, n) => {
      c.save();
      c.translate(n * (f.upm * k + gap), K.BRUSH_H + 50);
      c.scale(k, k);
      c.translate(0, -top);
      c.fillStyle = '#fff';
      c.fillRect(0, top, f.upm, f.upm);
      for (const s of K.kanjiShapes(doc, ch, f.upm)) drawShape(c, s);
      c.restore();
    });
  }
  c.restore();
}

export function drawFontGuides(c, view) {
  const doc = state.doc;
  if (!isFontDoc(doc)) return;
  if (brushAt(timeline.frame)) { drawBrushGuides(c, view); return; }
  const f = doc.font, g = glyphAt(timeline.frame);
  if (!g) return;
  const S = (x, y) => view.toScreen({ x, y });
  const x0 = S(-f.upm * 0.3, 0).x, x1 = S(g.advance + f.upm * 0.3, 0).x;
  // ドットのマス目
  if (f.kind === 'dot') {
    const cs = cellSize(f);
    c.lineWidth = 1;
    c.strokeStyle = 'rgba(0,0,0,0.12)';
    c.beginPath();
    for (let x = 0; x <= g.advance + 1e-6; x += cs) { const p = S(x, 0), q = S(x, f.upm); c.moveTo(Math.round(p.x) + 0.5, p.y); c.lineTo(Math.round(q.x) + 0.5, q.y); }
    for (let y = 0; y <= f.upm + 1e-6; y += cs) { const p = S(0, y), q = S(g.advance, y); c.moveTo(p.x, Math.round(p.y) + 0.5); c.lineTo(q.x, Math.round(q.y) + 0.5); }
    c.stroke();
  }
  const lines = [
    [0, 'アセンダー', 'rgba(147,51,234,0.7)'], [f.ascender - f.capHeight, 'キャップハイト', 'rgba(234,88,12,0.7)'],
    [f.ascender - f.xHeight, 'xハイト', 'rgba(22,163,74,0.7)'], [f.ascender, 'ベースライン', 'rgba(220,38,38,0.95)'], [f.upm, 'ディセンダー', 'rgba(147,51,234,0.7)'],
  ];
  c.font = '11px "Yu Gothic UI", sans-serif';
  for (const [y, label, color] of lines) {
    const p = S(0, y);
    c.strokeStyle = color;
    c.lineWidth = label === 'ベースライン' ? 2 : 1;
    c.setLineDash(label === 'ベースライン' ? [] : [5, 4]);
    c.beginPath();
    c.moveTo(x0, Math.round(p.y) + 0.5);
    c.lineTo(x1, Math.round(p.y) + 0.5);
    c.stroke();
    c.fillStyle = color;
    c.fillText(label, x0 + 2, p.y - 3);
  }
  c.setLineDash([]);
  // 文字の幅(左右)
  c.strokeStyle = 'rgba(37,99,235,0.9)';
  c.lineWidth = 1.5;
  for (const x of [0, g.advance]) {
    const p = S(x, -f.upm * 0.05), q = S(x, f.upm * 1.05);
    c.beginPath(); c.moveTo(Math.round(p.x) + 0.5, p.y); c.lineTo(Math.round(q.x) + 0.5, q.y); c.stroke();
  }
  c.fillStyle = 'rgba(37,99,235,0.95)';
  const t = S(g.advance / 2, f.upm * 1.05);
  c.textAlign = 'center';
  c.fillText(`「${g.char}」 幅 ${Math.round(g.advance)}`, t.x, t.y + 14);
  c.textAlign = 'left';
}

// 画面に合わせるときの範囲(筆の部品のフレームは下のお手本の字まで)
export function fontFitBox(doc) {
  if (!isFontDoc(doc) || !brushAt(timeline.frame, doc)) return null;
  return { x: 0, y: 0, w: K.BRUSH_W, h: K.BRUSH_H + 50 + (K.BRUSH_W - 14 * 7) / 8 };
}

// 筆の部品のフレーム: 中心線と、入り・終わりの範囲
function drawBrushGuides(c, view) {
  const doc = state.doc, b = brushAt(timeline.frame);
  const S = (x, y) => view.toScreen({ x, y });
  const info = brushInfo(b.key);
  c.font = '11px "Yu Gothic UI", sans-serif';
  const p = S(0, K.BRUSH_CY), q = S(K.BRUSH_W, K.BRUSH_CY);
  c.strokeStyle = 'rgba(220,38,38,0.9)';
  c.lineWidth = 1.5;
  c.setLineDash([6, 4]);
  c.beginPath(); c.moveTo(p.x, Math.round(p.y) + 0.5); c.lineTo(q.x, Math.round(q.y) + 0.5); c.stroke();
  c.setLineDash([]);
  c.fillStyle = 'rgba(220,38,38,0.95)';
  const lt = S(8, 30);
  c.fillText('赤い点線 = 画の中心線(左 = 書き始め → 右 = 終わり)', lt.x, lt.y);
  // 描いた部品の左右の端から入り・終わりの長さ
  const shapes = glyphShapes(doc, timeline.frame);
  if (shapes.length && (b.head > 0 || b.tail > 0)) {
    let x0 = Infinity, x1 = -Infinity;
    for (const s of shapes) { const v = visualBounds(s); x0 = Math.min(x0, v.x0); x1 = Math.max(x1, v.x1); }
    c.strokeStyle = 'rgba(37,99,235,0.9)';
    c.fillStyle = 'rgba(37,99,235,0.95)';
    c.lineWidth = 1;
    c.setLineDash([4, 3]);
    for (const [x, label] of [[x0 + b.head, '入り|'], [x1 - b.tail, '|終わり']]) {
      const a = S(x, 20), e = S(x, K.BRUSH_H - 20);
      c.beginPath(); c.moveTo(Math.round(a.x) + 0.5, a.y); c.lineTo(Math.round(e.x) + 0.5, e.y); c.stroke();
      c.textAlign = label.startsWith('|') ? 'left' : 'right';
      c.fillText(label, a.x, a.y - 3);
    }
    c.setLineDash([]);
    c.textAlign = 'left';
  }
  const t = S(0, K.BRUSH_H + 30);
  c.textBaseline = 'alphabetic';
  c.fillStyle = 'rgba(37,99,235,0.95)';
  c.fillText(`筆の部品「${info.label}」: ${info.hint}`, t.x, t.y);
}

// ---- 字形 → 輪郭 → OTF ----

function ownShapes(doc, i) {
  const out = [];
  for (const l of doc.layers) {
    if (l.type !== 'vector' || !l.visible) continue;
    const cel = l.cels[i];
    if (cel) out.push(...cel.shapes);
  }
  return out;
}

// 自動で作る字か(文字の自動作成が ON・骨組みがある(漢字・かな・英数字)・自分で描いた図形がない)
export function isAutoGlyph(doc, i) {
  const g = glyphAt(i, doc);
  if (!g || !doc.font?.kanji?.on || !K.hasSkeleton(g.char)) return false;
  return !doc.layers.some((l) => l.type === 'vector' && l.cels[i]?.shapes.length);
}

export function glyphShapes(doc, i) {
  if (isAutoGlyph(doc, i)) { const g = glyphAt(i, doc); return K.kanjiShapes(doc, g.char, g.advance); }
  return ownShapes(doc, i);
}

// 色に関係なく、見えている所をすべて黒で描く
function drawInk(c, s) {
  if (s.type === 'group') { s.children.forEach((k) => drawInk(c, k)); return; }
  if (s.type === 'text') { drawText(c, s, { fill: s.fill ? '#000' : null, stroke: s.stroke ? '#000' : null }); return; }
  drawShape(c, { ...s, fill: s.fill ? '#000' : null, stroke: s.stroke ? '#000' : null });
}

const ringArea = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; } return a / 2; };

// 字形の輪郭(フォントの座標: y は上が +、ベースライン = 0)。外側は反時計回り、穴は時計回り
export function glyphContours(doc, i) {
  const shapes = glyphShapes(doc, i);
  if (!shapes.length) return [];
  let b = null;
  for (const s of shapes) {
    const v = visualBounds(s);
    b = b ? { x0: Math.min(b.x0, v.x0), y0: Math.min(b.y0, v.y0), x1: Math.max(b.x1, v.x1), y1: Math.max(b.y1, v.y1) } : v;
  }
  b = { x0: b.x0 - 2, y0: b.y0 - 2, x1: b.x1 + 2, y1: b.y1 + 2 };
  const { loops, scale } = traceDrawing(b, (c) => shapes.forEach((s) => drawInk(c, s)), 2);
  const minArea = 4 / (scale * scale);
  const list = loops.filter((l) => Math.abs(ringArea(l)) >= minArea);
  const dep = depths(list);
  const asc = doc.font.ascender;
  return list.map((l, k) => {
    let pts = simplifyLoop(l, Math.max(0.6 / scale, 0.5)).map((p) => ({ x: p.x, y: asc - p.y }));
    if (pts.length < 3) return null;
    const outer = dep[k] % 2 === 0;
    if ((ringArea(pts) > 0) !== outer) pts = pts.reverse();
    return loopToNodes(pts);
  }).filter(Boolean);
}

const glyphName = (ch) => { const u = ch.codePointAt(0); return u <= 0xffff ? `uni${u.toString(16).toUpperCase().padStart(4, '0')}` : `u${u.toString(16).toUpperCase()}`; };

export async function buildFont(doc = state.doc) {
  const OT = await import('../vendor/opentype.module.js');
  if (doc.font.kanji?.on) await K.loadSkeleton();
  const f = doc.font;
  const R = (v) => Math.round(v);
  const toPath = (rings) => {
    const p = new OT.Path();
    for (const n of rings) {
      p.moveTo(R(n[0].x), R(n[0].y));
      for (let k = 1; k <= n.length; k++) {
        const a = n[k - 1], q = n[k % n.length];
        if (a.hout || q.hin) {
          const c1 = a.hout || a, c2 = q.hin || q;
          p.curveTo(R(c1.x), R(c1.y), R(c2.x), R(c2.y), R(q.x), R(q.y));
        } else p.lineTo(R(q.x), R(q.y));
      }
      p.close();
    }
    return p;
  };
  // .notdef(ない文字の代わりに出る四角)
  const nd = new OT.Path();
  const w = R(f.upm * 0.5), t = R(f.upm * 0.06), top = R(f.ascender * 0.9);
  nd.moveTo(t, 0); nd.lineTo(w - t, 0); nd.lineTo(w - t, top); nd.lineTo(t, top); nd.close();
  nd.moveTo(2 * t, t); nd.lineTo(2 * t, top - t); nd.lineTo(w - 2 * t, top - t); nd.lineTo(w - 2 * t, t); nd.close();
  const glyphs = [new OT.Glyph({ name: '.notdef', advanceWidth: w, path: nd })];
  if (!doc.frames.some((fr) => fr.glyph?.char === ' ')) glyphs.push(new OT.Glyph({ name: 'space', unicode: 32, advanceWidth: R(f.upm * 0.3), path: new OT.Path() }));
  doc.frames.forEach((fr, i) => {
    const g = fr.glyph;
    if (!g) return;
    glyphs.push(new OT.Glyph({ name: glyphName(g.char), unicode: g.char.codePointAt(0), advanceWidth: R(g.advance), path: toPath(isAutoGlyph(doc, i) ? K.kanjiContours(doc, g.char, g.advance) : glyphContours(doc, i)) }));
  });
  // 骨組み(KanjiVG)から作った字があれば、フォントの情報にクレジットとライセンス(CC BY-SA 3.0)を書く
  const kvg = doc.frames.some((fr, i) => fr.glyph && isAutoGlyph(doc, i));
  const credit = kvg ? {
    copyright: 'Glyph skeletons: KanjiVG (C) Ulrich Apel (https://kanjivg.tagaini.net)',
    license: 'This font contains glyphs derived from KanjiVG, licensed under Creative Commons Attribution-Share Alike 3.0. This font is licensed under the same license.',
    licenseURL: 'https://creativecommons.org/licenses/by-sa/3.0/',
  } : {};
  const font = new OT.Font({ familyName: f.name || 'MyFont', styleName: 'Regular', unitsPerEm: f.upm, ascender: f.ascender, descender: -f.descender, glyphs, ...credit });
  return new Uint8Array(font.toArrayBuffer());
}

async function exportOtf() {
  const doc = state.doc;
  toast('フォントを作っています…');
  try {
    const bytes = await buildFont(doc);
    const name = `${doc.font.name || 'MyFont'}.otf`;
    if (window.native) {
      const p = await window.native.saveDialog({ title: 'フォントを書き出し', defaultPath: name, filters: [{ name: 'OpenType フォント', extensions: ['otf'] }] });
      if (!p) return;
      await window.native.writeBinary(p, bytes);
      toast(`書き出しました: ${p}`);
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([bytes], { type: 'font/otf' }));
      a.download = name;
      a.click();
    }
  } catch (err) {
    console.error(err);
    toast('書き出しに失敗しました: ' + err.message);
  }
}

// フォントをアプリに入れる(作業ファイルも一緒に取っておく → あとで「作ったフォントを開いて直す」)。
// 同じ名前でもう一度入れると置き換わる。名前がほかのフォントとぶつかって番号が付いたら、フォントの名前もそれに合わせる
export async function installFontDoc(doc = state.doc) {
  const bytes = await buildFont(doc);
  const before = doc.font.name || 'MyFont';
  const family = await installFont(before, bytes, JSON.stringify(serialize(doc)));
  if (family !== before) { doc.font.name = family; await installFont(family, bytes, JSON.stringify(serialize(doc))); emit('font'); }
  return { family, bytes };
}

async function addToApp() {
  try {
    const { family } = await installFontDoc(state.doc);
    toast(`アプリに追加しました。文字ツールのフォント「${family}」で使えます(あとで「フォント作成」から開いて直せます)`);
  } catch (err) {
    toast('追加できませんでした: ' + err.message);
  }
}

// 開いて直せるフォントの一覧 { made: [作業ファイルのあるフォント], outline: [輪郭だけ読み込めるフォント(取り込んだファイル)] }
export async function editableFonts() {
  const made = (await fontProjects()).map((p) => p.family);
  return { made, outline: fontLists().imported.filter((f) => !made.includes(f)) };
}

// フォントの名前 → フォント作成モードの絵。作業ファイルがあればそれ(筆の部品・自動の字もそのまま)、なければフォントの輪郭を読み込む
export async function fontDocOf(family) {
  const { made } = await editableFonts();
  if (made.includes(family)) {
    const doc = await deserialize(JSON.parse(await readFontProject(family)));
    if (!doc.font) throw new Error('フォントの作業ファイルではありません');
    doc.font.name = family;
    return { doc, from: 'project' };
  }
  return { doc: await fontDocFromOtf(await importedFontBytes(family), family), from: 'outline' };
}

// フォントのファイル(OTF / TTF)の輪郭 → フォント作成モードの絵(1字 = パスの図形)。字が多いフォントは先頭の limit 字まで
export async function fontDocFromOtf(bytes, name, limit = 3000) {
  const OT = await import('../vendor/opentype.module.js');
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const f = OT.parse(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
  const k = UPM / (f.unitsPerEm || 1000);
  let asc = Math.round((f.tables?.os2?.sTypoAscender || f.ascender || 800) * k);
  if (!(asc >= 500 && asc <= 950)) asc = 800;
  const list = [];
  for (let i = 0; i < f.glyphs.length && list.length < limit; i++) {
    const g = f.glyphs.get(i);
    if (g.unicode === undefined || g.unicode < 0x21) continue;
    const ch = String.fromCodePoint(g.unicode);
    if (!ch.trim() || list.some((x) => x.ch === ch)) continue;
    const P = (x, y) => ({ x: x * k, y: asc - y * k });
    const contours = [];
    let cur = null;
    const close = () => {
      if (!cur) return;
      const a = cur[0], b = cur[cur.length - 1];
      if (cur.length > 1 && Math.hypot(a.x - b.x, a.y - b.y) < 0.01) { if (b.hin) a.hin = b.hin; cur.pop(); }
      if (cur.length >= 2) contours.push(cur);
      cur = null;
    };
    for (const c of g.path?.commands || []) {
      if (c.type === 'M') { close(); cur = [P(c.x, c.y)]; }
      else if (!cur) continue;
      else if (c.type === 'L') cur.push(P(c.x, c.y));
      else if (c.type === 'C') { cur[cur.length - 1].hout = P(c.x1, c.y1); cur.push({ ...P(c.x, c.y), hin: P(c.x2, c.y2) }); }
      else if (c.type === 'Q') {
        // 2次の曲線 → 3次の曲線
        const p0 = cur[cur.length - 1], q = P(c.x1, c.y1), p = P(c.x, c.y);
        p0.hout = { x: p0.x + ((q.x - p0.x) * 2) / 3, y: p0.y + ((q.y - p0.y) * 2) / 3 };
        cur.push({ ...p, hin: { x: p.x + ((q.x - p.x) * 2) / 3, y: p.y + ((q.y - p.y) * 2) / 3 } });
      } else if (c.type === 'Z') close();
    }
    close();
    list.push({ ch, advance: Math.max(1, Math.round((g.advanceWidth || f.unitsPerEm) * k)), contours });
  }
  if (!list.length) throw new Error('このフォントには、読み込める字がありません');
  const doc = newFontDoc({ name, kind: 'vector', chars: list.map((x) => x.ch).join('') });
  doc.font.ascender = asc;
  doc.font.descender = UPM - asc;
  const cap = Math.round((f.tables?.os2?.sCapHeight || 0) * k), xh = Math.round((f.tables?.os2?.sxHeight || 0) * k);
  if (cap > 100 && cap <= asc) doc.font.capHeight = cap;
  if (xh > 50 && xh <= asc) doc.font.xHeight = xh;
  const layer = doc.layers.find((l) => l.type === 'vector');
  const at = new Map(doc.frames.map((fr, i) => [fr.glyph.char, i]));
  for (const g of list) {
    const i = at.get(g.ch);
    doc.frames[i].glyph.advance = g.advance;
    if (!g.contours.length) continue;
    layer.cels[i] = new VectorCel([{ type: 'path', closed: true, nodes: g.contours[0], ...(g.contours.length > 1 ? { subpaths: g.contours.slice(1).map((n) => ({ nodes: n, closed: true })) } : {}), fill: '#000000ff', stroke: null, strokeWidth: 0 }]);
  }
  fitArtboard(doc, 0);
  return doc;
}

// ---- 文字の小さな絵(一覧・試し書き用) ----

const thumbCache = new Map(); // `${i}|${version}|${size}` → canvas

function glyphCanvas(doc, i, h) {
  const layer = doc.layers.find((l) => l.type === 'vector');
  const cel = layer?.cels[i];
  const g = glyphAt(i, doc);
  const auto = isAutoGlyph(doc, i) ? K.kanjiKey(doc) : '';
  const key = `${g.char}|${cel?.version ?? 0}|${cel?.shapes.length ?? 0}|${g.advance}|${h}|${auto}`;
  if (thumbCache.has(key)) return thumbCache.get(key);
  const k = h / doc.font.upm;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(g.advance * k));
  c.height = h;
  const x = c.getContext('2d');
  x.scale(k, k);
  for (const s of glyphShapes(doc, i)) drawInk(x, s);
  if (thumbCache.size > 800) thumbCache.clear();
  thumbCache.set(key, c);
  return c;
}

// ---- パネル ----

function renderPanel() {
  const box = $('font-body');
  if (!box || !isFontDoc()) return;
  const doc = state.doc, f = doc.font, cur = timeline.frame, g = glyphAt(cur);
  $('font-title').textContent = f.kind === 'dot' ? `ドット ${f.grid}×${f.grid}` : 'ベクター';
  box.innerHTML = `
    <label class="font-row"><span>名前</span><input type="text" class="f-name" maxlength="40"></label>
    <div class="font-grid"></div><div class="f-count note"></div>
    <div class="font-row"><input type="text" class="f-add" placeholder="追加する文字を入力(例: ABC あいう)"><button class="f-add-btn">追加</button></div>
    <label class="font-row"><span>まとめて</span><select class="f-preset"><option value="">追加する文字の組…</option>${Object.entries(PRESETS).map(([k, [l, s]]) => `<option value="${k}">${l}(${[...s].length}文字)</option>`).join('')}</select></label>
    <div class="font-row"><button class="f-image" title="ロゴや手書きの字の画像を、字ごとに切り分けて字形にする">画像から字を取り込む…</button></div>
    <div class="font-row font-cur"${g ? '' : ' hidden'}><b class="f-char"></b><span class="f-code"></span>
      <label>幅 <input type="number" class="num f-adv" min="1" max="3000"></label><button class="f-del" title="この文字を削除">削除</button></div>
    <details class="font-kanji"${prefs.kanjiOpen ? ' open' : ''}><summary>文字の自動作成(漢字・かな・英数字)</summary><div class="k-body"></div></details>
    <label class="font-row check" title="参考の文字(${REF_FAMILY})を薄く表示"><input type="checkbox" class="f-ref">下書き(参考の文字を薄く表示)</label>
    <details class="font-metrics"><summary>高さの線(ベースラインなど)</summary>
      <label class="font-row"><span>アセンダー</span><input type="number" class="num f-m" data-k="ascender"></label>
      <label class="font-row"><span>キャップ</span><input type="number" class="num f-m" data-k="capHeight"></label>
      <label class="font-row"><span>x ハイト</span><input type="number" class="num f-m" data-k="xHeight"></label>
      <p class="note">1文字の高さは ${f.upm}(アセンダー + ディセンダー)。ベースラインは上から ${Math.round(f.ascender)}。</p></details>
    <div class="font-row"><input type="text" class="f-prev" placeholder="試し書き"></div>
    <canvas class="font-preview" height="56"></canvas>
    <div class="font-buttons"><button class="primary f-export">OTF で書き出し…</button><button class="f-install" title="作ったフォントをこのアプリに入れて、文字ツールで使えるようにする">アプリに追加</button></div>
    <button class="f-exit">フォント作成を終わる</button>`;
  const q = (s) => box.querySelector(s);
  q('.f-name').value = f.name;
  q('.f-name').onchange = (e) => { f.name = e.target.value.trim() || f.name; state.dirty = true; emit('title'); };
  // 文字の一覧
  const grid = q('.font-grid');
  // 字の絵は見えている所だけ作る(漢字をまとめて入れると数千字になるため)
  gridObserver?.disconnect();
  gridObserver = new IntersectionObserver((list) => {
    for (const e of list) {
      if (!e.isIntersecting || e.target.dataset.drawn) continue;
      e.target.dataset.drawn = '1';
      gridObserver.unobserve(e.target);
      fillCell(e.target, Number(e.target.dataset.i));
    }
  }, { root: grid, rootMargin: '80px' });
  const frag = document.createDocumentFragment();
  doc.frames.forEach((fr, i) => {
    if (!fr.glyph) return;
    const cell = document.createElement('button');
    cell.className = 'font-cell' + (i === cur ? ' on' : '');
    cell.dataset.i = i;
    cell.title = `「${fr.glyph.char}」U+${fr.glyph.char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}${isAutoGlyph(doc, i) ? '(自動)' : ''}`;
    const lab = document.createElement('span');
    lab.textContent = fr.glyph.char;
    cell.append(lab);
    cell.onclick = () => selectGlyph(i);
    frag.append(cell);
  });
  grid.append(frag);
  for (const cell of grid.children) gridObserver.observe(cell);
  q('.f-count').textContent = `${doc.frames.filter((fr) => fr.glyph).length}文字`;
  setTimeout(() => grid.querySelector('.on')?.scrollIntoView({ block: 'nearest' }));
  renderKanji(q('.font-kanji'));
  const addChars = () => { const v = q('.f-add').value; if (v) { addGlyphs(v); } };
  q('.f-add-btn').onclick = addChars;
  q('.f-add').onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') addChars(); };
  q('.f-preset').onchange = (e) => { const p = PRESETS[e.target.value]; if (p) addGlyphs(p[1]); };
  q('.f-image').onclick = async () => (await import('./fontimagedlg.js')).openFontImageDialog();
  q('.f-char').textContent = g?.char ?? '';
  q('.f-code').textContent = g ? `U+${g.char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}` : '';
  q('.f-adv').value = Math.round(g?.advance ?? 0);
  q('.f-adv').step = f.kind === 'dot' ? cellSize(f) : 1;
  q('.f-adv').onchange = (e) => setAdvance(Number(e.target.value) || g.advance);
  q('.f-adv').onkeydown = (e) => e.stopPropagation();
  q('.f-del').onclick = () => deleteGlyph();
  q('.f-ref').checked = prefs.reference;
  q('.f-ref').onchange = (e) => { prefs.reference = e.target.checked; requestRender(); };
  for (const m of box.querySelectorAll('.f-m')) {
    m.value = Math.round(f[m.dataset.k]);
    m.onkeydown = (e) => e.stopPropagation();
    m.onchange = () => {
      const v = Math.max(0, Math.min(f.upm, Math.round(Number(m.value) || 0)));
      f[m.dataset.k] = v;
      if (m.dataset.k === 'ascender') f.descender = f.upm - v;
      state.dirty = true;
      emit('title');
      renderPanel();
      requestRender();
    };
  }
  const prev = q('.f-prev');
  prev.value = prefs.preview;
  prev.oninput = () => { prefs.preview = prev.value; drawPreview(q('.font-preview')); };
  prev.onkeydown = (e) => e.stopPropagation();
  drawPreview(q('.font-preview'));
  q('.f-export').onclick = exportOtf;
  q('.f-install').onclick = addToApp;
  q('.f-exit').onclick = exitFontMode;
}

// 一覧のマスに字の絵を入れる
function fillCell(cell, i) {
  const doc = state.doc;
  if (!glyphAt(i, doc)) return;
  if (!glyphShapes(doc, i).length) return;
  const cv = glyphCanvas(doc, i, 30);
  const img = document.createElement('canvas');
  img.width = 34; img.height = 30;
  img.getContext('2d').drawImage(cv, (34 - cv.width) / 2, 0);
  const s = document.createElement('small');
  s.textContent = glyphAt(i, doc).char;
  cell.replaceChildren(img, s);
  if (isAutoGlyph(doc, i)) cell.classList.add('auto');
}

// ---- 漢字の自動作成(パネル)----

function brushInfo(key) {
  if (key.startsWith('type:')) {
    const t = key.slice(5), row = K.STROKE_TYPES.find(([c]) => c === t);
    const name = row ? row[1] : t;
    return { label: `${t} ${name.replace(/\(.*\)$/, '')}`, hint: `画の種類「${name}」だけに使う部品(横画・縦画・払いなどの代わり。はねの部分はそのまま)` };
  }
  return K.BRUSHES.find((b) => b.key === key) || { label: key, hint: '' };
}

// 部品のフレームを選ぶ(なければ copyFrom の部品を写して作る)
function openBrush(key, copyFrom) {
  const doc = state.doc;
  const i = K.brushFrames(doc).get(key);
  if (i !== undefined) {
    setFrame(i);
  } else {
    const baseKey = copyFrom ?? key;
    const base = K.BRUSHES.find((b) => b.key === baseKey) || K.BRUSHES[0];
    const src = K.brushFrames(doc).get(baseKey);
    const layer = doc.layers.find((l) => l.type === 'vector');
    framesOp(`筆の部品「${brushInfo(key).label}」`, (d) => {
      const shapes = src !== undefined ? structuredClone(ownShapes(d, src)).map((s) => ({ ...s, id: undefined })) : K.defaultBrushShapes(baseKey);
      const from = src !== undefined ? d.frames[src].brush : base;
      d.frames.push({ duration: 100, brush: { key, head: from.head ?? 0, tail: from.tail ?? 0 } });
      if (layer) layer.cels[d.frames.length - 1] = new VectorCel(shapes);
      timeline.frame = d.frames.length - 1;
    });
  }
  fitArtboard();
  emit('artboard');
  emit('font');
  requestRender();
}

function removeBrush(key) {
  const i = K.brushFrames(state.doc).get(key);
  if (i === undefined) return;
  framesOp(`筆の部品「${brushInfo(key).label}」をやめる`, (d) => {
    d.frames.splice(i, 1);
    for (const l of d.layers) l.cels.splice(i, 1);
    if (timeline.frame >= d.frames.length || !d.frames[timeline.frame]) timeline.frame = Math.max(0, d.frames.findIndex((fr) => fr.glyph));
    else if (timeline.frame > i) timeline.frame--;
  });
  fitArtboard();
  emit('artboard');
  emit('font');
}

function brushThumb(doc, key) {
  const c = document.createElement('canvas');
  c.width = 60; c.height = 24;
  const i = K.brushFrames(doc).get(key);
  const shapes = i !== undefined ? ownShapes(doc, i) : K.defaultBrushShapes(key);
  const x = c.getContext('2d');
  x.scale(60 / K.BRUSH_W, 24 / K.BRUSH_H);
  for (const s of shapes) drawInk(x, s);
  return c;
}

async function startKanji(btn) {
  const doc = state.doc;
  btn.disabled = true;
  try {
    const ok = await K.loadSkeleton({ download: true, onProgress: (p) => { btn.textContent = `骨組みのデータをダウンロード中… ${Math.round((p.got / p.total) * 100)}%`; } });
    if (!ok) { toast('骨組みのデータを読み込めませんでした(このアプリの exe / 開発版で使えます)'); return; }
    if (!doc.font.kanji) doc.font.kanji = { on: true, weight: 1, size: 1.1 };
    doc.font.kanji.on = true;
    state.dirty = true;
    emit('title');
    // 部品をまとめて用意(最初はゴシック風の形)
    if (!K.brushFrames(doc).size) {
      const layer = doc.layers.find((l) => l.type === 'vector');
      framesOp('文字の自動作成を始める', (d) => {
        for (const b of K.BRUSHES) {
          d.frames.push({ duration: 100, brush: { key: b.key, head: b.head, tail: b.tail } });
          if (layer) layer.cels[d.frames.length - 1] = new VectorCel(K.defaultBrushShapes(b.key));
        }
        timeline.frame = d.frames.length - K.BRUSHES.length;
      });
      fitArtboard();
      emit('artboard');
    }
    toast('筆の部品を描き直すと、骨組みのある字(漢字・かな・英数字)が全部その筆で作り直されます');
  } catch (err) {
    toast('始められませんでした: ' + err.message);
  } finally {
    btn.disabled = false;
    emit('font');
    requestRender();
  }
}

export function addKanjiSet(key) {
  const set = K.KANJI_SETS[key];
  if (!set) return 0;
  const all = [...set[1]()];
  const ok = all.filter((c) => K.hasSkeleton(c));
  const n = addGlyphs(ok.join(''), { select: false });
  const miss = all.length - ok.length;
  if (n) toast(`${n}文字を追加しました(自動で作ります)${miss ? `。骨組みのない ${miss}文字は入れていません` : ''}`);
  return n;
}

const LICENSE_NOTE = '<p class="note">骨組みのデータ: <b>KanjiVG</b>(© Ulrich Apel、CC BY-SA 3.0)。ゲームの中で文字を使うのは問題になりにくいですが、作ったフォントのファイルを配るときは「KanjiVG を使った」ことの表記と、同じライセンス(CC BY-SA 3.0)での配布が必要です。</p>';

function renderKanji(box) {
  if (!box) return;
  box.ontoggle = () => { prefs.kanjiOpen = box.open; };
  const body = box.querySelector('.k-body');
  const doc = state.doc, kj = doc.font.kanji, cur = timeline.frame;
  if (!kj?.on || !K.skeletonReady()) {
    body.innerHTML = kj?.on
      ? `<button class="primary k-start">骨組みのデータを読み込む</button>${LICENSE_NOTE}`
      : `<p class="note">筆の部品(漢字用の横画・縦画・はね・左払い・右払い・点と、かな用・英数字用の1本ずつ)を描くと、漢字・ひらがな・カタカナ・アルファベット・数字 約6700字をその筆で自動で組み立てます。部品を直すと全部の字がすぐ変わります。</p>
        <button class="primary k-start">文字の自動作成を始める(初回だけ約3.6MBダウンロード)</button>${LICENSE_NOTE}`;
    body.querySelector('.k-start').onclick = (e) => startKanji(e.target);
    return;
  }
  const bmap = K.brushFrames(doc);
  const overrides = [...bmap.keys()].filter((k) => k.startsWith('type:'));
  const b = brushAt(cur), g = glyphAt(cur);
  let state1 = '';
  if (g && isAutoGlyph(doc, cur)) {
    state1 = `<div class="font-row"><span class="k-state">「${escapeHtml(g.char)}」は自動</span><button class="k-edit" title="今の自動の形を図形にして、この字だけ手で直せるようにする">手で直す</button></div>`;
  } else if (g && K.hasSkeleton(g.char)) {
    state1 = `<div class="font-row"><span class="k-state">「${escapeHtml(g.char)}」は手描き</span><button class="k-reset" title="描いた図形を消して、自動で作る字に戻す">自動に戻す</button></div>`;
  }
  body.innerHTML = `
    <div class="k-label">筆の部品(クリックで描き直す)</div>
    <div class="k-brushes k-base"></div>
    ${b ? `<div class="font-row"><span>入り・終わり</span><input type="number" class="num k-head" min="0" max="500" title="書き始めの形を保つ長さ(0 と 0 なら部品全体を画の長さに伸ばす)"><input type="number" class="num k-tail" min="0" max="500" title="終わりの形を保つ長さ"></div>
      <p class="note">${escapeHtml(brushInfo(b.key).hint)}。横向きに描きます(赤い点線 = 画の中心線、左 = 書き始め)。入り・終わりの長さの所は形を保ち、間だけ画の長さに合わせて伸びます。下のお手本の字がすぐ変わります。</p>` : ''}
    <label class="font-row"><span>太さ</span><input type="range" class="k-weight" min="0.3" max="2.5" step="0.05"><em class="k-wv"></em></label>
    <label class="font-row"><span>字の大きさ</span><input type="range" class="k-size" min="0.8" max="1.3" step="0.01"><em class="k-sv"></em></label>
    <div class="k-label">画の種類ごとに部品を変える</div>
    <div class="font-row"><select class="k-type">${K.STROKE_TYPES.map(([t, l]) => `<option value="${t}"${bmap.has(`type:${t}`) ? ' disabled' : ''}>${t} ${escapeHtml(l)}</option>`).join('')}</select><button class="k-type-add">作る</button></div>
    ${overrides.length ? '<div class="k-brushes k-over"></div>' : ''}
    <div class="font-row"><select class="k-set"><option value="">まとめて追加(自動で作る字)…</option>${Object.entries(K.KANJI_SETS).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
    ${state1}
    ${LICENSE_NOTE}`;
  const q = (s) => body.querySelector(s);
  const addBrushButton = (wrap, key, removable) => {
    const btn = document.createElement('button');
    btn.className = 'k-brush' + (b?.key === key ? ' on' : '');
    btn.title = brushInfo(key).hint;
    const lab = document.createElement('span');
    lab.textContent = brushInfo(key).label;
    btn.append(brushThumb(doc, key), lab);
    btn.onclick = () => openBrush(key);
    if (removable) {
      const x = document.createElement('i');
      x.textContent = '×';
      x.title = 'この部品をやめる(元の部品に戻す)';
      x.onclick = (e) => { e.stopPropagation(); removeBrush(key); };
      btn.append(x);
    }
    wrap.append(btn);
  };
  for (const br of K.BRUSHES) addBrushButton(q('.k-base'), br.key, false);
  for (const k of overrides) addBrushButton(q('.k-over'), k, true);
  if (b) {
    for (const k of ['head', 'tail']) {
      const el = q(`.k-${k}`);
      el.value = b[k] ?? 0;
      el.onkeydown = (e) => e.stopPropagation();
      el.onchange = () => {
        const i = timeline.frame, v = Math.max(0, Math.round(Number(el.value)) || 0);
        framesOp('入り・終わりの長さ', (d) => { d.frames[i] = { ...d.frames[i], brush: { ...d.frames[i].brush, [k]: v } }; });
        emit('font');
      };
    }
  }
  const slider = (cls, label, key, def) => {
    const el = q(cls), out = q(label);
    el.value = kj[key] ?? def;
    out.textContent = `${Math.round((kj[key] ?? def) * 100)}%`;
    el.oninput = () => { kj[key] = Number(el.value); out.textContent = `${Math.round(kj[key] * 100)}%`; requestRender(); };
    el.onchange = () => { state.dirty = true; emit('title'); refreshSoon(); };
  };
  slider('.k-weight', '.k-wv', 'weight', 1);
  slider('.k-size', '.k-sv', 'size', 1.1);
  q('.k-type-add').onclick = () => { const t = q('.k-type').value; if (t && !bmap.has(`type:${t}`)) openBrush(`type:${t}`, K.typeBaseBrush(t)); };
  q('.k-set').onchange = (e) => { const v = e.target.value; e.target.value = ''; if (v) addKanjiSet(v); };
  q('.k-edit')?.addEventListener('click', () => {
    const layer = editableLayer();
    if (!layer || layer.type !== 'vector') return;
    const before = structuredClone(layer.shapes);
    layer.shapes.push(...K.kanjiEditableShapes(doc, g.char, g.advance));
    pushVector(`「${g.char}」を手で直す`, layer, before);
    emit('font');
  });
  q('.k-reset')?.addEventListener('click', () => {
    const layer = editableLayer();
    if (!layer || layer.type !== 'vector') return;
    const before = structuredClone(layer.shapes);
    layer.shapes.length = 0;
    pushVector(`「${g.char}」を自動に戻す`, layer, before);
    emit('font');
  });
}

function drawPreview(c) {
  const doc = state.doc;
  c.width = c.parentElement.clientWidth - 2;
  const x = c.getContext('2d');
  x.fillStyle = '#fff';
  x.fillRect(0, 0, c.width, c.height);
  const h = c.height - 12, k = h / doc.font.upm;
  const index = new Map(doc.frames.map((fr, i) => [fr.glyph?.char, i]));
  let px = 6;
  for (const ch of prefs.preview) {
    const i = index.get(ch);
    if (i === undefined) {
      if (ch === ' ') { px += doc.font.upm * 0.3 * k; continue; }
      x.strokeStyle = '#d4d4d8';
      x.strokeRect(px + 1, 6, doc.font.upm * 0.5 * k - 2, h * 0.8);
      px += doc.font.upm * 0.5 * k;
      continue;
    }
    const g = glyphCanvas(doc, i, Math.round(h));
    x.drawImage(g, Math.round(px), 6);
    px += glyphAt(i).advance * k;
  }
}

// ---- モードの切り替え ----

let refreshTimer = 0;
function refreshSoon() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(renderPanel, 150);
}

function applyMode() {
  const on = isFontDoc();
  document.body.classList.toggle('font-mode', on);
  document.body.classList.toggle('font-dot', on && state.doc.font.kind === 'dot');
  setTimelineHidden(on);
  const btn = document.querySelector('[data-action="fontMode"]');
  if (btn) btn.textContent = on ? 'フォント作成を終わる' : 'フォント作成';
  if (on) {
    fitArtboard();
    renderPanel();
    ensureFamily(REF_FAMILY).then(() => requestRender());
    // 漢字の自動作成を使っているファイルなら骨組みを読む(ダウンロード済みのときだけ)
    if (state.doc.font.kanji?.on && !K.skeletonReady()) K.loadSkeleton().then((ok) => { if (ok) { renderPanel(); requestRender(); } }).catch(() => {});
  }
}

export function initFontMode() {
  on('doc', applyMode);
  on('frame', () => { if (isFontDoc()) { fitArtboard(); emit('artboard'); refreshSoon(); } });
  on('frames', () => { if (isFontDoc()) { fitArtboard(); refreshSoon(); } });
  on('font', () => { if (isFontDoc()) renderPanel(); });
  on('history', () => { if (isFontDoc()) refreshSoon(); });
  on('fonts', () => { if (isFontDoc()) refreshSoon(); });
}

export async function toggleFontMode() {
  if (isFontDoc()) return exitFontMode();
  return enterFontMode();
}

export async function enterFontMode(opts) {
  if (isFontDoc() && !opts?.doc) return; // (ボタンからは、フォントのタブでは「終わる」になる。Claude 連携からは、別のフォントのタブも開ける)
  let doc, fromImage = false, opened = false;
  if (opts?.doc) doc = opts.doc;
  else {
    const ed = await editableFonts().catch(() => ({ made: [], outline: [] }));
    const body = document.createElement('div');
    body.className = 'form';
    body.innerHTML = `
      <label>もとにするフォント <select id="nf-open"><option value="">なし(新しく作る)</option>${ed.made.length ? `<optgroup label="作ったフォントを開いて直す">${ed.made.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('')}</optgroup>` : ''}${ed.outline.length ? `<optgroup label="入れてあるフォントの輪郭を読み込む">${ed.outline.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('')}</optgroup>` : ''}</select></label>
      <label>フォントの名前 <input type="text" id="nf-name" value="MyFont" maxlength="40"></label>
      <div class="seg">
        <label><input type="radio" name="nf-kind" value="vector" checked>ベクター(ペン・パス・図形で描く)</label>
        <label><input type="radio" name="nf-kind" value="dot">ドット(マス目を塗る)</label>
      </div>
      <label>ドットのマス目 <select id="nf-grid"><option>8</option><option>12</option><option selected>16</option><option>24</option><option>32</option></select> × 同じ数(1文字の高さ)</label>
      <label>はじめの文字 <select id="nf-chars"><option value="A">A だけ</option>${Object.entries(PRESETS).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
      <p class="note">「もとにするフォント」を選ぶと、前に作ってアプリに追加したフォントを開いて、字を足したり直したりできます(「画像から作る…」で、画像の字を足す・入れ替える)。</p>
      <p class="note">フォントは新しいタブで開きます。今の絵のタブとは上のタブで行き来でき、絵でコピー(Ctrl+C)した図形を、今の字に貼り付け(Ctrl+V)られます。作ったフォントは OTF で書き出したり、このアプリの文字ツールで使ったりできます。<br>作りかけのフォントは「保存」で .kodai ファイルとして保存でき、開くとこのモードになります。</p>`;
    const { value } = await openModal({ title: 'フォント作成', body, width: 500, buttons: [{ label: 'キャンセル', value: null }, { label: '画像から作る…', value: 'image' }, { label: '作る', value: 'ok', primary: true }] });
    if (value !== 'ok' && value !== 'image') return;
    fromImage = value === 'image';
    const q = (s) => body.querySelector(s);
    const preset = q('#nf-chars').value;
    // 作ったフォントを開いて直す(名前・種類・はじめの文字は、そのフォントのものを使う)
    const openName = q('#nf-open').value;
    if (openName) {
      try {
        const r = await fontDocOf(openName);
        doc = r.doc;
        opened = true;
        toast(r.from === 'project' ? `「${openName}」を開きました。直したら「アプリに追加」で置き換わります` : `「${openName}」の輪郭を読み込みました(${doc.frames.length}字)。「アプリに追加」で新しいフォントとして入ります`);
      } catch (err) { toast('開けませんでした: ' + err.message); return; }
    }
    if (!doc) doc = newFontDoc({
      name: q('#nf-name').value.trim() || 'MyFont', kind: q('[name=nf-kind]:checked').value,
      grid: Number(q('#nf-grid').value), chars: preset === 'A' ? 'A' : PRESETS[preset][1],
    });
  }
  // 新しいタブで開く(今の絵は、そのまま別のタブに残る)
  openDoc(doc, null);
  state.dirty = true;
  emit('title');
  if (doc.font.kind === 'dot') emit('request-tool', 'dot');
  // 「画像から作る」: 続けて、画像から字を取り込むダイアログを開く(はじめの空の字は、取り込んだら消す)
  if (fromImage) (await import('./fontimagedlg.js')).openFontImageDialog({ fresh: !opened });
}

// フォントのタブを閉じる(保存していない変更があれば聞く)。開いたときにいた絵のタブへ戻る
export async function exitFontMode() {
  if (!isFontDoc()) return;
  if (!(await closeTab())) return;
  emit('request-tool', 'move');
}

// フォント作成中は使わない操作(絵のための機能)
export const FONT_BLOCKED_ACTIONS = new Set(['importImage', 'export', 'docSettings', 'exportGif', 'exportSheet',
  'addRaster', 'addVector', 'dupLayer', 'deleteLayer', 'mergeDown', 'addFrame', 'dupFrame', 'deleteFrame', 'moveFrameLeft', 'moveFrameRight', 'togglePlay', 'onion']);
export const FONT_BLOCKED_TOOLS = new Set(['rig', 'artboard', 'text', 'eyedropper']);
