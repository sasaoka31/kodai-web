// 「キャラを作る(面塗り)」ダイアログ(上の「作る ▾」→ キャラを作る(面塗り)…)。新しい画風のキャラメーカー
//   3つのタブ: 人(パス)= 顔や体を面(パス)の集まりで作る(charpoly.js。編集できるベクターのレイヤーになる)
//              人(ドット)・四つ足 = ドットで作る(charpaint.js。ラスターのレイヤーになる)
//   お手本・表情・顔のパーツの調整・服・色・陰影の強さ・大きさを変えると、右のプレビューがすぐ変わる。作ると、新しい絵か、今の絵の新しいレイヤーに置く
import { state, toast, requestRender } from './state.js';
import { openModal, escapeHtml } from './modal.js';
import { newDocument, RasterLayer, RasterCel, VectorLayer, VectorCel, createCanvas } from './document.js';
import { insertLayers } from './layers.js';
import { ensureIds } from './vector.js';
import {
  HUMAN_OPTIONS, HUMAN_COLORS, HUMAN_PRESETS, humanOptions, paintHuman,
  QUAD_OPTIONS, QUAD_COLORS, QUAD_PRESETS, quadOptions, paintQuad,
} from './charpaint.js';
import { polyToGlb, POLY_ANIMS } from './charpoly3d.js';
import { saveBinary } from './io.js';
import { POLY_OPTIONS, POLY_PRESETS, POLY_FACE, polyOptions, buildBust, drawPolys, polysToShape, faceDefault, randomPolyKeep, POLY_LOCKS } from './charpoly.js';

const KEY = 'pixelrig.charpaint';
export const PAINT_SIZES = [64, 96, 128, 192, 256, 384, 512];
const H_LABEL = { frame: '構図', face: '顔の形', expr: '表情', hair: '髪', hat: '帽子', beard: 'ひげ', top: '上の服', bottom: '下の服', shoes: 'くつ', pose: 'ポーズ', item: '持ち物' };
const P_LABEL = { frame: '構図', expr: '表情', face: '顔の形', eye: '目の形', iris: '瞳の形', hair: '髪', hat: '帽子', beard: 'ひげ', top: '上の服', bottom: '下の服', shoes: 'くつ', pose: 'ポーズ', item: '持ち物' };
const P_COLORS = { skin: '肌', hair: '髪・眉・ひげ', eyes: '瞳', top: '上の服', top2: '服の2色目', bottom: '下の服', shoes: 'くつ', hat: '帽子', accent: '小物・金具' };
const Q_LABEL = { ear: '耳', tail: 'しっぽ', paw: '足先' };
const Q_SLIDERS = [['bodyLen', '胴の長さ', 0.3, 0.75, 0.01], ['bodyH', '胴の太さ', 0.14, 0.4, 0.01], ['chest', '胸の厚み', 0.9, 1.4, 0.01], ['legLen', '脚の長さ', 0.15, 0.6, 0.01], ['legW', '脚の太さ', 0.025, 0.07, 0.001],
  ['neckLen', '首の長さ', 0.03, 0.4, 0.01], ['neckAng', '首の角度', 0, 80, 1], ['headH', '頭の大きさ', 0.06, 0.16, 0.005], ['snout', '鼻先の長さ', 0.05, 1, 0.01]];

// ドットの絵(ImageData)を作る。kind = human / quad、ro = { shade, facets }
export function paintCharacter(kind, opts, size, ro) {
  return kind === 'quad' ? paintQuad(opts, size, ro) : paintHuman(opts, size, ro);
}

// ドットの絵を置く: place = document(新しい絵)/ layer(今の絵に新しいレイヤー)
export function placePainted(img, { place = 'document', name = 'キャラ', loadDocument, x, y } = {}) {
  const layer = new RasterLayer(name);
  if (place === 'document') {
    const doc = newDocument({ width: img.width, height: img.height });
    doc.layers[0] = layer;
    doc.activeId = layer.id;
    layer.cels[0] = new RasterCel();
    layer.cels[0].tiles.putImageData(img, 0, 0);
    loadDocument(doc, null);
  } else {
    const a = state.doc.artboard;
    layer.putImageData(img, Math.round(x ?? a.x + (a.w - img.width) / 2), Math.round(y ?? a.y + (a.h - img.height) / 2));
    insertLayers('キャラを置く', [layer]);
    requestRender();
  }
  return layer;
}

// パスのキャラを置く(ベクターのレイヤー。面は1つのグループにまとめる)。opts = charpoly の値、size = 絵の大きさ px
export function placePoly(opts, size, { place = 'document', name = 'キャラ(パス)', loadDocument, x, y } = {}) {
  const bust = buildBust(opts);
  const layer = new VectorLayer(name);
  let ox = 0, oy = 0;
  if (place !== 'document') { const a = state.doc.artboard; ox = Math.round(x ?? a.x + (a.w - size) / 2); oy = Math.round(y ?? a.y + (a.h - size) / 2); }
  layer.cels[0] = new VectorCel(ensureIds([polysToShape(bust, size, { x: ox, y: oy, name })]));
  if (place === 'document') {
    const doc = newDocument({ width: size, height: size });
    doc.layers[0] = layer;
    doc.activeId = layer.id;
    loadDocument(doc, null);
  } else {
    insertLayers('キャラを置く', [layer]);
    requestRender();
  }
  return layer;
}

export async function charPaintDialog({ loadDocument, confirmUnsaved }) {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* なし */ }
  let kind = ['poly', 'human', 'quad'].includes(saved.kind) ? saved.kind : 'poly';
  let P = polyOptions(saved.poly || { preset: 'fisher' }), H = humanOptions(saved.human || { preset: 'fisher' }), Q = quadOptions(saved.quad || { preset: 'wolf' });
  const R = { size: 256, shade: 0.7, facets: true, bg: '#b9cfc4', ...(saved.render || {}) };
  const sel = (k, label, table, cls) => `<label class="tp-s"><span>${label}</span><select data-${cls}="${k}">${Object.entries(table).map(([v, t]) => `<option value="${v}">${escapeHtml(t)}</option>`).join('')}</select></label>`;
  const rng = (k, label, min, max, step, cls) => `<label class="tp-r"><span>${label}</span><input type="range" data-${cls}="${k}" min="${min}" max="${max}" step="${step}"><em data-v="${cls}-${k}"></em></label>`;
  const cols = (table, cls) => `<div class="cp-colors">${Object.entries(table).map(([k, t]) => `<label class="ch-c"><input type="color" data-${cls}c="${k}"><span>${escapeHtml(t)}</span></label>`).join('')}</div>`;
  const body = document.createElement('div');
  body.className = 'form cp-dialog';
  body.innerHTML = `
    <div class="tp-cols">
      <div class="cp-left">
        <div class="tp-tabs"><button type="button" data-kind="poly">人(パス)</button><button type="button" data-kind="human">人(ドット)</button><button type="button" data-kind="quad">四つ足(ドット)</button></div>
        <div class="cp-page" data-page="poly">
          <div class="tp-styles">${Object.entries(POLY_PRESETS).map(([k, v]) => `<button type="button" data-pp="${k}">${escapeHtml(v.label)}</button>`).join('')}<button type="button" class="cp-random" title="顔・髪・服・色・体つきを、まとめてランダムに(構図と大きさはそのまま)">🎲 ランダム</button></div>
          <div class="cp-locks" title="チェックを入れた所は、ランダムにしても今のまま変わりません"><span>ランダムで固定</span>${Object.entries(POLY_LOCKS).map(([k, v]) => `<label class="check"><input type="checkbox" data-lock="${k}">${escapeHtml(v.label)}</label>`).join('')}</div>
          <div class="cp-grid">${Object.keys(POLY_OPTIONS).map((k) => sel(k, P_LABEL[k], POLY_OPTIONS[k], 'p')).join('')}</div>
          ${rng('heads', '頭身', 2.5, 8, 0.1, 'p')}${rng('age', '年齢(しわ・たるみ)', 0, 1, 0.05, 'p')}${rng('build', '体格', 0.75, 1.4, 0.01, 'p')}<div class="tp-bgs cp-yaws"><span>向き</span>${[[0, '正面'], [35, 'ななめ'], [90, '横'], [-90, '横(逆)'], [135, 'ななめ後ろ'], [180, '後ろ']].map(([v, t]) => `<button type="button" data-yaw="${v}">${t}</button>`).join('')}</div>
          ${rng('yaw', '向き(回す角度)', -180, 180, 1, 'p')}${rng('asym', '左右の非対称', 0, 3, 0.05, 'p')}${rng('asymSeed', '非対称の出方(種)', 1, 99, 1, 'p')}${rng('steps', '色の段数', 2, 16, 1, 'p')}${rng('relief', '彫りの深さ(顔の凹凸)', 0, 2, 0.05, 'p')}${rng('detail', '顔の面の細かさ', 1, 3, 1, 'p')}${rng('detailHair', '髪の面の細かさ', 1, 3, 1, 'p')}${rng('detailBody', '体の面の細かさ', 1, 3, 1, 'p')}
          <h3 class="form-sec">顔のパーツを調整 <button type="button" class="cp-reset">元に戻す</button></h3>
          ${Object.entries(POLY_FACE).map(([k, [l, a, b, st]]) => rng(k, l, a, b, st, 'f')).join('')}
          ${cols(P_COLORS, 'p')}
        </div>
        <div class="cp-page" data-page="human">
          <div class="tp-styles">${Object.entries(HUMAN_PRESETS).map(([k, v]) => `<button type="button" data-hp="${k}">${escapeHtml(v.label)}</button>`).join('')}</div>
          ${rng('heads', '頭身', 2, 8, 0.1, 'h')}${rng('build', '体格', 0.7, 1.5, 0.01, 'h')}
          <div class="cp-grid">${Object.keys(HUMAN_OPTIONS).map((k) => sel(k, H_LABEL[k], HUMAN_OPTIONS[k], 'h')).join('')}</div>
          ${cols(HUMAN_COLORS, 'h')}
        </div>
        <div class="cp-page" data-page="quad">
          <div class="tp-styles">${Object.entries(QUAD_PRESETS).map(([k, v]) => `<button type="button" data-qp="${k}">${escapeHtml(v.label)}</button>`).join('')}</div>
          ${Q_SLIDERS.map(([k, l, a, b, s]) => rng(k, l, a, b, s, 'q')).join('')}
          <div class="cp-grid">${Object.keys(QUAD_OPTIONS).map((k) => sel(k, Q_LABEL[k], QUAD_OPTIONS[k], 'q')).join('')}
            <label class="check"><input type="checkbox" data-q="mane">たてがみ</label><label class="check"><input type="checkbox" data-q="antler">角(つの)</label></div>
          ${cols(QUAD_COLORS, 'q')}
        </div>
      </div>
      <div class="tp-right">
        <div class="cp-stage"><canvas class="cp-canvas" width="384" height="384"></canvas></div>
        ${rng('shade', '陰影の強さ', 0, 1, 0.05, 'r')}
        <div class="row">
          <label class="tp-s"><span>大きさ</span><select data-r="size">${PAINT_SIZES.map((n) => `<option value="${n}">${n} × ${n}</option>`).join('')}</select></label>
          <label class="check cp-dotonly"><input type="checkbox" data-r="facets">面をカクッと分ける</label>
          <label class="tp-c"><span>プレビューの背景</span><input type="color" data-r="bg"></label>
        </div>
        <label class="tp-s"><span>置き方</span><select class="cp-place"><option value="document">新しい絵(この大きさ)</option><option value="layer">今の絵に新しいレイヤー</option></select></label>
        <p class="note cp-note"></p>
        <div class="cp-3d">
          <h3 class="form-sec">立体(3D)にする</h3>
          <div class="row"><button type="button" class="cp-blender">Blender で開く</button><button type="button" class="cp-glb">3D で書き出す(.glb)</button><label class="check"><input type="checkbox" class="cp-bones" checked>ボーン(骨)を入れる</label></div>
          <label class="tp-s"><span>動き</span><select class="cp-anim">${Object.entries(POLY_ANIMS).map(([k, v]) => `<option value="${k}">${escapeHtml(v.label)}</option>`).join('')}<option value="all">全部(4つ)</option><option value="none">なし(ポーズだけ)</option></select></label>
          <p class="note">今のキャラを、そのまま立体のモデルにします(顔・髪・体が別々の物。色は絵と同じ)。「Blender で開く」は、このPCの Blender を起動して読み込みます。ボーンを入れると、Blender で腕・脚・首などを曲げてポーズを付けられます。動きを選ぶと、Blender を開いたときにその動きが再生されます(その場で歩く・走る。くり返し)。構図に関係なく、いつも全身です。</p>
        </div>
      </div>
    </div>`;
  const q = (s) => body.querySelector(s);
  const qa = (s) => [...body.querySelectorAll(s)];
  const canvas = q('.cp-canvas'), ctx = canvas.getContext('2d');
  const polyOpts = () => ({ ...P, shade: R.shade });
  const currentImg = () => paintCharacter(kind, kind === 'quad' ? Q : H, Math.min(256, R.size), { shade: R.shade, facets: R.facets });
  const draw = () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = R.bg; ctx.fillRect(0, 0, 384, 384);
    if (kind === 'poly') { ctx.imageSmoothingEnabled = true; drawPolys(ctx, buildBust(polyOpts()), 384); return; }
    const img = currentImg(), t = createCanvas(img.width, img.height);
    t.getContext('2d').putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(t, 0, 0, 384, 384);
  };
  const fmt = (v) => (Number.isInteger(v) ? String(v) : (Math.round(v * 1000) / 1000).toString());
  const sync = () => {
    for (const el of qa('[data-p]')) el.value = P[el.dataset.p];
    for (const el of qa('[data-f]')) el.value = P.parts[el.dataset.f];
    for (const el of qa('[data-h]')) el.value = H[el.dataset.h];
    for (const el of qa('[data-q]')) { if (el.type === 'checkbox') el.checked = !!Q[el.dataset.q]; else el.value = Q[el.dataset.q]; }
    for (const el of qa('[data-r]')) { if (el.type === 'checkbox') el.checked = !!R[el.dataset.r]; else el.value = R[el.dataset.r]; }
    for (const el of qa('[data-pc]')) el.value = String(P.colors[el.dataset.pc]).slice(0, 7);
    for (const el of qa('[data-hc]')) el.value = String(H.colors[el.dataset.hc]).slice(0, 7);
    for (const el of qa('[data-qc]')) el.value = String(Q.colors[el.dataset.qc]).slice(0, 7);
    for (const em of qa('em[data-v]')) { const [c, k] = em.dataset.v.split('-'); em.textContent = fmt({ p: P, f: P.parts, h: H, q: Q, r: R }[c][k]); }
    for (const p of qa('.cp-page')) p.hidden = p.dataset.page !== kind;
    for (const b of qa('[data-kind]')) b.classList.toggle('on', b.dataset.kind === kind);
    q('.cp-dotonly').hidden = kind === 'poly';
    q('.cp-3d').hidden = kind !== 'poly';
    q('.cp-note').textContent = kind === 'poly'
      ? '顔や体を「面(パス)」の集まりで作ります。面ごとに1色なので、角ばった塗りになります。できたものは編集できるベクターのレイヤーで、どれだけ拡大してもくっきりです(ドット絵にしたいときは、あとで「ドット化」)。'
      : '輪郭線を使わず、面と色で見せるドット絵です。顔の細かい表現は、構図を「胸から上」にするか、大きさを上げると出ます(ドットは 256px まで)。';
    draw();
  };
  body.addEventListener('input', (e) => {
    const el = e.target, d = el.dataset;
    const val = el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value;
    if (d.p) P[d.p] = val; else if (d.f) P.parts[d.f] = val; else if (d.h) H[d.h] = val; else if (d.q) Q[d.q] = val;
    else if (d.r) R[d.r] = d.r === 'size' ? Number(val) : val;
    else if (d.pc) P.colors[d.pc] = val; else if (d.hc) H.colors[d.hc] = val; else if (d.qc) Q.colors[d.qc] = val; else return;
    sync();
  });
  body.addEventListener('keydown', (e) => e.stopPropagation());
  for (const b of qa('[data-kind]')) b.onclick = () => { kind = b.dataset.kind; sync(); };
  for (const b of qa('[data-pp]')) b.onclick = () => { P = polyOptions({ preset: b.dataset.pp, frame: P.frame, parts: P.parts, yaw: P.yaw, steps: P.steps, detail: P.detail, detailHair: P.detailHair, detailBody: P.detailBody, relief: P.relief, asym: P.asym, asymSeed: P.asymSeed }); sync(); };
  for (const b of qa('[data-hp]')) b.onclick = () => { H = humanOptions({ preset: b.dataset.hp, frame: H.frame }); sync(); };
  for (const b of qa('[data-qp]')) b.onclick = () => { Q = quadOptions({ preset: b.dataset.qp }); sync(); };
  for (const b of qa('[data-yaw]')) b.onclick = () => { P.yaw = Number(b.dataset.yaw); sync(); };
  // ランダム: 「ランダムで固定」にチェックを入れたまとまりは、今の値のまま
  const locks = () => qa('[data-lock]').filter((el) => el.checked).map((el) => el.dataset.lock);
  for (const el of qa('[data-lock]')) el.checked = (saved.locks || []).includes(el.dataset.lock);

  q('.cp-random').onclick = () => { P = polyOptions({ ...randomPolyKeep(P, locks()), frame: P.frame, yaw: P.yaw, steps: P.steps, detail: P.detail, detailHair: P.detailHair, detailBody: P.detailBody, relief: P.relief }); sync(); };
  // 立体にする: .glb に書き出す / Blender で開く(ダイアログは閉じない)
  const BKEY = 'kodai.blender';
  const glbOpts = () => { const bones = q('.cp-bones').checked, a = q('.cp-anim').value; return { name: 'キャラ', bones, anims: !bones || a === 'none' ? [] : a === 'all' ? Object.keys(POLY_ANIMS) : [a] }; };
  q('.cp-anim').value = saved.anim && (saved.anim in POLY_ANIMS || ['all', 'none'].includes(saved.anim)) ? saved.anim : 'walk';
  const syncAnim = () => { q('.cp-anim').disabled = !q('.cp-bones').checked; };
  q('.cp-bones').checked = saved.bones !== false;
  q('.cp-bones').addEventListener('change', syncAnim);
  syncAnim();
  q('.cp-glb').onclick = async () => {
    const { glb, stats } = polyToGlb(polyOpts(), glbOpts());
    if (await saveBinary('3D で書き出す', 'キャラ.glb', 'glb', 'glTF バイナリ(.glb)', new Blob([glb], { type: 'model/gltf-binary' }))) toast(`立体のモデルを書き出しました(面 ${stats.triangles} 枚${stats.bones ? '・ボーン ' + stats.bones + ' 本' : ''}${stats.animations.length ? '・動き: ' + stats.animations.join(' / ') : ''})`);
  };
  q('.cp-blender').onclick = async () => {
    const nat = window.native && window.native.blender;
    if (!nat) { toast('Blender で開くのは、アプリ版だけです(.glb に書き出して、Blender で読み込んでください)'); return; }
    const { glb } = polyToGlb(polyOpts(), glbOpts());
    let exe = null;
    try { exe = localStorage.getItem(BKEY); } catch { /* なし */ }
    let r = await nat.open(glb, 'キャラ', exe);
    if (r && r.error === 'notfound') {
      // 見つからないときは、blender.exe の場所を選んでもらう(次からは覚えている)
      toast('Blender が見つかりません。blender.exe の場所を選んでください');
      exe = await window.native.openDialog({ title: 'blender.exe を選ぶ', filters: [{ name: 'Blender', extensions: ['exe'] }] });
      if (!exe) return;
      r = await nat.open(glb, 'キャラ', exe);
      if (r && r.ok) { try { localStorage.setItem(BKEY, exe); } catch { /* 保存できなくても動く */ } }
    }
    toast(r && r.ok ? 'Blender を起動しました(読み込みまで少し待ちます)' : 'Blender を開けませんでした' + (r && r.error && r.error !== 'notfound' ? ': ' + r.error : ''));
  };
  q('.cp-reset').onclick = () => { for (const k of Object.keys(POLY_FACE)) P.parts[k] = faceDefault(k); sync(); };
  q('.cp-place').value = saved.place === 'layer' ? 'layer' : 'document';
  sync();
  const { value } = await openModal({ title: 'キャラを作る(面塗り)', body, width: 1020, buttons: [{ label: 'キャンセル', value: null }, { label: '作る', value: 'ok', primary: true }] });
  const place = q('.cp-place').value;
  try { localStorage.setItem(KEY, JSON.stringify({ kind, poly: P, human: H, quad: Q, render: R, place, locks: locks(), bones: q('.cp-bones').checked, anim: q('.cp-anim').value })); } catch { /* 保存できなくても動く */ }
  if (value !== 'ok') return null;
  if (place === 'document' && !(await confirmUnsaved())) return null;
  const layer = kind === 'poly' ? placePoly(polyOpts(), R.size, { place, loadDocument }) : placePainted(currentImg(), { place, name: kind === 'quad' ? '四つ足' : 'キャラ', loadDocument });
  toast(kind === 'poly' ? 'キャラを作りました(パスのグループ。ダイレクト選択ツールで、面を1枚ずつ選んで色や形を変えられます)' : 'キャラを作りました');
  return layer;
}
