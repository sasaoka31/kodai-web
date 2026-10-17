// 「図形の情報」パネル(右サイドバー。イラレの「変形」パネルに相当)
//   選んだ図形の種類・位置(X, Y)・大きさ(幅, 高さ)を表示し、数値を変えるとその形に変わる
//   基準点(3×3): X, Y がどこの位置か・大きさを変えるときにどこを固定するか / 縦横比リンク / 回転(入れた角度だけ回す)
//   種類ごと: 四角・パスの角丸、直線の長さ・角度、文字のサイズ、パスの点の数、グループの中の数
//   位置・大きさは線幅を含まない形の枠(四角なら x, y, w, h そのもの)
import { state, on } from './state.js';
import { selectedItems, modifySelection, scaleShape, rotateShape } from './select.js';
import { shapeBounds, translateShape, pathRings, canRound } from './vector.js';

const $ = (id) => document.getElementById(id);
const REF_KEY = 'pixelrig.infoRef';
const LINK_KEY = 'pixelrig.infoLink';

const TYPE_NAMES = { rect: '四角形', ellipse: '楕円', line: '直線', path: 'パス', group: 'グループ', text: '文字' };

function load(key, def) {
  try { const v = localStorage.getItem(key); return v === null ? def : JSON.parse(v); } catch { return def; }
}
function save(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 保存できなくても動く */ }
}

let ref = load(REF_KEY, [0, 0]); // 基準点 [u, v](0 = 左・上、0.5 = 中央、1 = 右・下)
let link = load(LINK_KEY, false); // 縦横比を保つ

const fmt = (v) => String(Math.round(v * 100) / 100);

function unionBounds(items) {
  let b = null;
  for (const it of items) {
    const r = shapeBounds(it.shape);
    b = b ? { x0: Math.min(b.x0, r.x0), y0: Math.min(b.y0, r.y0), x1: Math.max(b.x1, r.x1), y1: Math.max(b.y1, r.y1) } : r;
  }
  return b;
}

// 選んだ図形(ids)だけ fn で置き換える
function mapSelected(label, fn) {
  modifySelection(label, (items, layer) => {
    const ids = new Set(items.map((it) => it.shape.id));
    layer.shapes = layer.shapes.map((s) => (ids.has(s.id) ? fn(s) : s));
  });
}

// ---- 数値の変更 ----

export function setPosition(axis, value) {
  const items = selectedItems();
  const b = unionBounds(items);
  if (!b || !Number.isFinite(value)) return;
  const cur = axis === 'x' ? b.x0 + (b.x1 - b.x0) * ref[0] : b.y0 + (b.y1 - b.y0) * ref[1];
  const d = value - cur;
  if (Math.abs(d) < 1e-9) return;
  mapSelected('位置', (s) => translateShape(s, axis === 'x' ? d : 0, axis === 'y' ? d : 0));
}

export function setSize(axis, value) {
  const items = selectedItems();
  const b = unionBounds(items);
  if (!b || !Number.isFinite(value) || value <= 0) return;
  const w = b.x1 - b.x0, h = b.y1 - b.y0;
  const cur = axis === 'w' ? w : h;
  if (cur < 1e-6) return; // 幅(高さ)のない図形(水平・垂直の直線)は伸ばせない
  const k = value / cur;
  if (Math.abs(k - 1) < 1e-9) return;
  let sx = axis === 'w' ? k : 1, sy = axis === 'h' ? k : 1;
  if (link) { sx = k; sy = k; }
  const ax = b.x0 + w * ref[0], ay = b.y0 + h * ref[1];
  mapSelected('大きさ', (s) => scaleShape(s, ax, ay, sx, sy));
}

export function rotateBy(deg) {
  const b = unionBounds(selectedItems());
  if (!b || !Number.isFinite(deg) || !deg) return;
  const cx = b.x0 + (b.x1 - b.x0) * ref[0], cy = b.y0 + (b.y1 - b.y0) * ref[1];
  // 画面の上が y の小さい方なので、入れた角度(反時計回りが +)の逆向きに回す
  mapSelected('回転', (s) => rotateShape(s, cx, cy, (-deg * Math.PI) / 180));
}

// グループの中まで、test に合う図形の key を value に
function setProp(label, key, value, test) {
  const apply = (s) => (s.type === 'group' ? { ...s, children: s.children.map(apply) } : test(s) ? { ...s, [key]: value } : s);
  mapSelected(label, apply);
}

// 直線の長さ・角度(始点は動かさない。角度は右 = 0°、反時計回りが +)
function setLine(len, deg) {
  mapSelected('長さ・角度', (s) => {
    if (s.type !== 'line') return s;
    const a = (deg * Math.PI) / 180;
    return { ...s, x2: s.x1 + Math.cos(a) * len, y2: s.y1 - Math.sin(a) * len };
  });
}

// ---- 表示 ----

function numField(label, value, onSet, { title = '', min, step = 1, disabled = false } = {}) {
  const l = document.createElement('label');
  l.className = 'info-field';
  l.title = title;
  const s = document.createElement('span');
  s.textContent = label;
  const i = document.createElement('input');
  i.type = 'number';
  i.className = 'num';
  i.step = String(step);
  if (min !== undefined) i.min = String(min);
  i.value = fmt(value);
  i.disabled = disabled;
  i.onchange = () => { const v = Number(i.value); if (i.value !== '' && Number.isFinite(v)) onSet(v); render(true); };
  i.onkeydown = (e) => { if (e.key === 'Escape') { i.value = fmt(value); i.blur(); } };
  l.append(s, i);
  return l;
}

function refGrid() {
  const g = document.createElement('div');
  g.className = 'info-ref';
  g.title = '基準点: X・Y の位置 / 大きさを変える・回すときに動かない点';
  for (const v of [0, 0.5, 1]) {
    for (const u of [0, 0.5, 1]) {
      const b = document.createElement('button');
      b.className = 'info-ref-dot' + (ref[0] === u && ref[1] === v ? ' on' : '');
      b.dataset.ref = `${u},${v}`;
      b.onclick = () => { ref = [u, v]; save(REF_KEY, ref); render(true); };
      g.append(b);
    }
  }
  return g;
}

function countNodes(s) {
  if (s.type === 'group') return s.children.reduce((n, c) => n + countNodes(c), 0);
  if (s.type === 'path') return pathRings(s).reduce((n, r) => n + r.nodes.length, 0);
  return 0;
}

function leaves(items) {
  const out = [];
  const walk = (s) => (s.type === 'group' ? s.children.forEach(walk) : out.push(s));
  items.forEach((it) => walk(it.shape));
  return out;
}

// みんな同じ値ならその値、違えば null
const same = (list, f) => { const v = list.map(f); return v.every((x) => x === v[0]) ? v[0] : null; };

function render(force = false) {
  const body = $('info-body');
  if (!body) return;
  if (!force && body.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return; // 入力中は書き換えない
  body.innerHTML = '';
  const items = state.doc ? selectedItems() : [];
  const note = $('info-note');
  if (!items.length) {
    note.textContent = '';
    const p = document.createElement('div');
    p.className = 'info-empty';
    p.textContent = '図形を選ぶと、位置・大きさを数値で見て変えられます';
    body.append(p);
    return;
  }
  const one = items.length === 1 ? items[0].shape : null;
  note.textContent = one ? TYPE_NAMES[one.type] || one.type : `${items.length}個`;
  const b = unionBounds(items);
  const w = b.x1 - b.x0, h = b.y1 - b.y0;

  // 位置・大きさ
  const grid = document.createElement('div');
  grid.className = 'info-grid';
  const lk = document.createElement('button');
  lk.className = 'info-link' + (link ? ' on' : '');
  lk.title = link ? '縦横比を保つ(オン)' : '縦横比を保つ(オフ)';
  lk.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>';
  lk.onclick = () => { link = !link; save(LINK_KEY, link); render(true); };
  grid.append(
    refGrid(),
    numField('X', b.x0 + w * ref[0], (v) => setPosition('x', v), { title: '基準点の横の位置(px)' }),
    numField('Y', b.y0 + h * ref[1], (v) => setPosition('y', v), { title: '基準点の縦の位置(px)' }),
    numField('幅', w, (v) => setSize('w', v), { min: 0.01, title: '線幅を含まない幅(px)', disabled: w < 1e-6 }),
    lk,
    numField('高さ', h, (v) => setSize('h', v), { min: 0.01, title: '線幅を含まない高さ(px)', disabled: h < 1e-6 }),
  );
  body.append(grid);

  const row = document.createElement('div');
  row.className = 'info-row';
  const rot = numField('回転', 0, (v) => rotateBy(v), { title: '入れた角度だけ回す(°、反時計回りが +)。四角・楕円はパスになります' });
  rot.querySelector('input').value = '0';
  rot.append(document.createTextNode('°'));
  row.append(rot);
  body.append(row);

  // 種類ごとの情報(回転と同じ行に並べる)
  const extra = row;
  const ls = leaves(items);
  if (one?.type === 'line') {
    const dx = one.x2 - one.x1, dy = one.y2 - one.y1;
    const len = Math.hypot(dx, dy), deg = (Math.atan2(-dy, dx) * 180) / Math.PI;
    extra.append(
      numField('長さ', len, (v) => setLine(Math.max(0, v), deg), { min: 0, title: '始点からの長さ(px)' }),
      numField('角度', deg, (v) => setLine(len, v), { title: '右 = 0°、反時計回りが +' }),
    );
  }
  const roundable = ls.filter(canRound);
  if (roundable.length) {
    const r = same(roundable, (s) => s.round || 0);
    extra.append(numField('角丸', r ?? 0, (v) => setProp('角丸', 'round', Math.max(0, v), canRound), { min: 0, step: 0.5, title: '角の丸さ(px、0 で角のまま)' }));
  }
  const texts = ls.filter((s) => s.type === 'text');
  if (texts.length) {
    const sz = same(texts, (s) => s.size);
    extra.append(numField('文字', sz ?? texts[0].size, (v) => setProp('文字のサイズ', 'size', Math.max(1, v), (s) => s.type === 'text'), { min: 1, title: '文字のサイズ(px)' }));
  }

  const facts = [];
  const nodes = countNodes({ type: 'group', children: items.map((it) => it.shape) });
  if (nodes) facts.push(`点 ${nodes}個`);
  if (one?.type === 'path') facts.push(one.closed ? '閉じた形' : '開いた線');
  if (one?.type === 'group') facts.push(`中の図形 ${ls.length}個`);
  if (one?.type === 'ellipse') facts.push(Math.abs(Math.abs(one.rx) - Math.abs(one.ry)) < 1e-6 ? '正円' : '楕円');
  if (one?.type === 'rect' && Math.abs(one.w - one.h) < 1e-6) facts.push('正方形');
  if (facts.length) {
    const f = document.createElement('div');
    f.className = 'info-facts';
    f.textContent = facts.join(' / ');
    body.append(f);
  }
}

export function initShapeInfoPanel() {
  if (!$('info-body')) return;
  for (const e of ['selection', 'doc', 'layers', 'history', 'frame']) on(e, () => render());
  render();
}
