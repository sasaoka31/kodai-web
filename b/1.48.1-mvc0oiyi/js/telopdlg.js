// 「テロップを作る」ダイアログ(上の「作る ▾」→ テロップ / ファイル → テロップを作る…)と書き出し
//   左 = 設定(お手本・テキスト・フォント・動き・装飾・背景と配置)、右 = プレビュー(再生・時間の位置)と書き出し。
//   書き出し: APNG(半透明そのまま)/ GIF / PNG(完成した状態の静止画)/ Kodai の新しい絵(1コマ = 1フレーム)
import { toast } from './state.js';
import { openModal, escapeHtml } from './modal.js';
import { newDocument, RasterLayer, RasterCel, createCanvas } from './document.js';
import { saveBinary } from './io.js';
import { encodeGif } from './gif.js';
import { apngEncoder } from './apng.js';
import { fontLists, ensureFamily } from './fonts.js';
import {
  TELOP_STYLES, TELOP_ENTER, TELOP_EXIT, TELOP_HOLD, TELOP_ORDER, TELOP_EASE, TELOP_FRAMES, TELOP_FRAME_ANIM, TELOP_BG, TELOP_SIZES, TELOP_TEMPLATES,
  telopOptions, styleValues, telopTimes, drawTelop, telopFrameCount, renderTelopFrame, telopFamilies, telopFontsChanged,
} from './telop.js';

const KEY = 'pixelrig.telop';
const tick = () => new Promise((r) => setTimeout(r, 0));

// ---- 書き出し(ダイアログと Claude 連携の両方から)----

// 使うフォントを用意する(Kodai のフォントは初回ダウンロード)
export async function prepareTelopFonts(o) {
  for (const f of telopFamilies(o)) await ensureFamily(f);
  await Promise.all(telopFamilies(o).map((f) => document.fonts.load(`${o.weight} 40px "${f}"`, o.text + o.sub).catch(() => {})));
  telopFontsChanged();
}

// APNG。loop: 0 = ずっと、n = n 回。戻り値 { bytes, width, height, frames }
export async function telopApng(o, { fps = 24, loop = 1, trim = false, onProgress } = {}) {
  const n = telopFrameCount(o, fps), enc = apngEncoder(o.width, o.height);
  const cv = createCanvas(o.width, o.height);
  for (let i = 0; i < n; i++) {
    renderTelopFrame(o, i, fps, cv);
    await enc.add(cv.getContext('2d').getImageData(0, 0, o.width, o.height), 1000 / fps);
    if (i % 4 === 3) { onProgress?.(i + 1, n); await tick(); }
  }
  return enc.finish({ loop, trim });
}

// GIF(256色・半透明は2値になる)
export async function telopGif(o, { fps = 15, loop = true, onProgress } = {}) {
  const n = telopFrameCount(o, fps);
  if (o.width * o.height * n > 400e6) throw new Error('GIF が大きすぎます。画像サイズか FPS を下げてください');
  const cv = createCanvas(o.width, o.height), frames = [];
  for (let i = 0; i < n; i++) {
    renderTelopFrame(o, i, fps, cv);
    frames.push({ img: cv.getContext('2d').getImageData(0, 0, o.width, o.height), delay: Math.round(1000 / fps) });
    if (i % 4 === 3) { onProgress?.(i + 1, n); await tick(); }
  }
  return encodeGif(frames, { loop: loop ? 0 : 1 });
}

// 完成した状態の静止画(キャンバス)
export function telopStill(o) {
  const cv = createCanvas(o.width, o.height);
  drawTelop(cv.getContext('2d'), o, 0, { still: true });
  return cv;
}

// Kodai の新しい絵にする(1コマ = 1フレーム、ラスターレイヤー)
export async function telopToDocument(o, { fps = 12, loadDocument, onProgress } = {}) {
  const n = telopFrameCount(o, fps);
  if (n > 240) throw new Error(`フレームが多すぎます(${n})。FPS を下げるか、時間を短くしてください`);
  const doc = newDocument({ width: o.width, height: o.height });
  const layer = new RasterLayer('テロップ');
  doc.layers[0] = layer;
  doc.activeId = layer.id;
  doc.frames = Array.from({ length: n }, () => ({ duration: Math.round(1000 / fps) }));
  const cv = createCanvas(o.width, o.height);
  for (let i = 0; i < n; i++) {
    renderTelopFrame(o, i, fps, cv);
    layer.cels[i] = new RasterCel();
    layer.cels[i].tiles.putImageData(cv.getContext('2d').getImageData(0, 0, o.width, o.height), 0, 0);
    if (i % 4 === 3) { onProgress?.(i + 1, n); await tick(); }
  }
  loadDocument(doc, null);
  return { layer, frames: n };
}

// ---- ダイアログ ----

function loadLast() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

const opts = (table, pick = (v) => v) => Object.entries(table).map(([k, v]) => `<option value="${k}">${escapeHtml(pick(v))}</option>`).join('');
const R = (k, label, min, max, step, unit = '') => `<label class="tp-r"><span>${label}</span><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}"><em data-v="${k}" data-u="${unit}"></em></label>`;
const S = (k, label, html) => `<label class="tp-s"><span>${label}</span><select data-k="${k}">${html}</select></label>`;
const C = (k, label, optional = false) => `<label class="tp-c"><span>${label}</span>${optional ? `<input type="checkbox" data-on="${k}">` : ''}<input type="color" data-k="${k}"></label>`;
const K = (k, label) => `<label class="check"><input type="checkbox" data-k="${k}">${label}</label>`;
const motionOpts = (table) => {
  const g = (kind, title) => `<optgroup label="${title}">${Object.entries(table).filter(([, v]) => v[1] === kind).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('')}</optgroup>`;
  return g('char', '1文字ずつ') + g('whole', '全体');
};

export async function telopDialog({ loadDocument, confirmUnsaved }) {
  const saved = loadLast();
  let o = telopOptions(saved.o || { template: 'battle' });
  const ex = { fps: 24, loop: 'once', trim: false, ...(saved.ex || {}) };
  const { builtin, imported } = fontLists();
  const fontOpts = `<optgroup label="Kodai のフォント">${builtin.map((f) => `<option value="${escapeHtml(f.family)}">${escapeHtml(f.label || f.family)}</option>`).join('')}</optgroup>`
    + (imported.length ? `<optgroup label="取り込んだフォント">${imported.map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('')}</optgroup>` : '');

  const body = document.createElement('div');
  body.className = 'form telop-dialog';
  body.innerHTML = `
    <div class="tp-cols">
      <div class="tp-left">
        <div class="fx-row"><label>お手本 <select class="tp-template"><option value="">(選ぶと動き・フォント・色がまとめて入ります)</option>${opts(TELOP_TEMPLATES, (v) => v.label)}</select></label></div>
        <div class="tp-tabs">${['テキスト', 'フォント', '動き', '装飾', '背景・配置'].map((t, i) => `<button type="button" data-tab="${i}">${t}</button>`).join('')}</div>
        <div class="tp-page" data-page="0">
          <label class="tp-t"><span>メインテキスト(Enter で改行)</span><textarea data-k="text" rows="3"></textarea></label>
          <label class="tp-t"><span>サブテキスト(なくてもよい)</span><input type="text" data-k="sub"></label>
          <div class="row">${S('subPos', 'サブの位置', '<option value="above">上</option><option value="below">下</option>')}
            ${S('vertical', '向き', '<option value="">横書き</option><option value="1">縦書き</option>')}
            ${S('align', '揃え', '<option value="left">左(上)</option><option value="center">中央</option><option value="right">右(下)</option>')}</div>
          ${K('fit', 'はみ出すときは自動で小さくする')}
        </div>
        <div class="tp-page" data-page="1">
          ${S('family', 'フォント', fontOpts)}
          ${R('size', '文字サイズ', 16, 400, 2, 'px')}${R('spacing', '字間', -0.1, 1.5, 0.01)}${R('lineHeight', '行間', 0.8, 3, 0.05)}
          ${R('weight', '太さ(ウェイト)', 100, 900, 100)}${R('thick', '太らせる', 0, 0.12, 0.005)}
          <p class="note">太さ(ウェイト)は Noto Sans JP・Noto Serif JP なら 100(極細)〜 900(極太)で変わります。ほかのフォントは 600 以上で少し太くなるだけなので、「太らせる」を使ってください(どのフォントでも効きます)。</p>
          <h3 class="form-sec">サブテキスト</h3>
          ${S('subFamily', 'サブのフォント', '<option value="">メインと同じ</option>' + fontOpts)}
          ${R('subWeight', 'サブの太さ', 100, 900, 100)}
          ${R('subScale', 'サブの大きさ(メイン比)', 0.1, 1.2, 0.01)}${R('subSpacing', 'サブの字間', -0.1, 2, 0.01)}${R('subGap', 'メインとの間隔', 0, 1.5, 0.01)}
          ${C('subColor', 'サブを別の色にする', true)}
        </div>
        <div class="tp-page" data-page="2">
          <h3 class="form-sec first">登場</h3>
          ${S('enter', '動き', motionOpts(TELOP_ENTER))}
          ${R('enterTime', '時間', 0.05, 3, 0.05, '秒')}${R('stagger', '文字ごとのずらし', 0, 0.6, 0.01, '秒')}
          <div class="row">${S('order', '順番', opts(TELOP_ORDER))}${S('enterEase', '動きのカーブ', opts(TELOP_EASE))}</div>
          ${R('enterPower', '強さ', 0.2, 3, 0.1)}
          <h3 class="form-sec">表示中</h3>
          ${S('hold', '動き', opts(TELOP_HOLD))}${R('holdTime', '表示時間', 0, 15, 0.1, '秒')}
          <h3 class="form-sec">退場</h3>
          ${K('exitOn', '退場あり(なしなら最後の状態で止まる)')}
          ${S('exit', '動き', motionOpts(TELOP_EXIT))}
          ${R('exitTime', '時間', 0.05, 3, 0.05, '秒')}${R('exitStagger', '文字ごとのずらし', 0, 0.6, 0.01, '秒')}
          <div class="row">${S('exitEase', '動きのカーブ', opts(TELOP_EASE))}</div>
          ${R('exitPower', '強さ', 0.2, 3, 0.1)}
          <h3 class="form-sec">タイミング</h3>
          ${R('pre', '開始前の空白', 0, 3, 0.05, '秒')}${R('post', '終了後の空白', 0, 3, 0.05, '秒')}
        </div>
        <div class="tp-page" data-page="3">
          <div class="tp-styles">${Object.entries(TELOP_STYLES).map(([k, v]) => `<button type="button" data-style="${k}">${escapeHtml(v.label)}</button>`).join('')}</div>
          <h3 class="form-sec">文字の塗り</h3>
          <div class="row">${C('fill', '色')}${C('fill2', 'グラデーション(下の色)', true)}</div>
          ${R('fillA', '塗りの不透明度', 0, 1, 0.05)}
          <h3 class="form-sec">縁取り</h3>
          <div class="row">${C('stroke', '色', true)}${C('stroke2', '外側の縁取り', true)}</div>
          ${R('strokeW', '太さ', 0, 0.3, 0.005)}${R('stroke2W', '外側の太さ', 0, 0.4, 0.005)}
          <h3 class="form-sec">影</h3>
          ${C('shadow', '色', true)}${R('shadowA', '濃さ', 0, 1, 0.05)}${R('shadowBlur', 'ぼかし', 0, 0.5, 0.01)}${R('shadowX', '横のずれ', -0.3, 0.3, 0.01)}${R('shadowY', '縦のずれ', -0.3, 0.3, 0.01)}
          <h3 class="form-sec">光彩(グロー)</h3>
          ${C('glow', '色', true)}${R('glowA', '強さ', 0, 1, 0.05)}${R('glowBlur', '広がり', 0.02, 0.8, 0.01)}
        </div>
        <div class="tp-page" data-page="4">
          <h3 class="form-sec first">文字のまわりの飾り</h3>
          ${S('frame', '飾り', opts(TELOP_FRAMES))}
          <div class="row">${C('frameFill', '塗り')}${C('frameLine', '線')}</div>
          ${R('frameAlpha', '塗りの濃さ', 0, 1, 0.05)}${R('frameW', '線の太さ', 0, 24, 1, 'px')}${R('framePad', '文字との余白', 0, 1.5, 0.05)}
          <div class="row">${S('frameAnim', '飾りの出方', opts(TELOP_FRAME_ANIM))}</div>
          <h3 class="form-sec">背景(画像全体)</h3>
          <div class="row">${S('bg', '背景', opts(TELOP_BG))}${C('bgColor', '色')}</div>
          ${R('bgAlpha', '濃さ', 0, 1, 0.05)}
          <h3 class="form-sec">画像サイズ・配置</h3>
          <div class="row">${S('sizeKey', 'サイズ', opts(TELOP_SIZES, (v) => `${v[0]} × ${v[1]}`) + '<option value="custom">自由</option>')}
            <label class="tp-n"><input type="number" data-k="width" min="16" max="3840" class="num">×<input type="number" data-k="height" min="16" max="2160" class="num"></label></div>
          <div class="row">${S('vpos', '縦の位置', '<option value="top">上</option><option value="middle">中央</option><option value="bottom">下</option>')}</div>
          ${R('margin', '画面の端との余白', 0, 0.3, 0.01)}${R('dx', '横の微調整', -600, 600, 2, 'px')}${R('dy', '縦の微調整', -400, 400, 2, 'px')}
        </div>
      </div>
      <div class="tp-right">
        <div class="tp-bgs"><span>プレビューの背景</span>${[['checker', '透明'], ['#000000', '黒'], ['#ffffff', '白'], ['#808080', 'グレー']].map(([v, t]) => `<button type="button" data-pbg="${v}">${t}</button>`).join('')}</div>
        <div class="tp-stage"><canvas class="tp-canvas"></canvas></div>
        <div class="tp-ctl"><button type="button" class="tp-play">■ 停止</button><label class="check"><input type="checkbox" class="tp-loop" checked>ループ再生</label>
          <input type="range" class="tp-seek" min="0" max="1000" value="0"><em class="tp-time"></em></div>
        <div class="tp-bar"><i class="b-pre"></i><i class="b-in"></i><i class="b-hold"></i><i class="b-out"></i><i class="b-post"></i></div>
        <p class="note tp-legend"><b class="k-in">■</b> 登場 <b class="k-hold">■</b> 表示 <b class="k-out">■</b> 退場</p>
        <h3 class="form-sec">書き出し</h3>
        <p class="note tp-info"></p>
        <div class="row">
          <label class="tp-s"><span>FPS</span><select class="tp-fps">${[12, 15, 20, 24, 30, 60].map((f) => `<option>${f}</option>`).join('')}</select></label>
          <label class="tp-s"><span>ループ</span><select class="tp-exloop"><option value="once">1回再生(最後の状態で止まる)</option><option value="forever">ずっとループ</option></select></label>
        </div>
        <label class="check"><input type="checkbox" class="tp-trim">透明な余白を切り取る(APNG)</label>
        <div class="tp-out">
          <button type="button" class="primary" data-out="apng">APNG を書き出す</button>
          <button type="button" data-out="gif">GIF</button>
          <button type="button" data-out="png">PNG 静止画</button>
          <button type="button" data-out="doc">Kodai の絵にする</button>
        </div>
        <p class="note">APNG = 動く PNG(半透明もきれい。ココフォリアなどにそのまま置けます)。GIF は 256色で、半透明の所はギザギザになります。
          「Kodai の絵にする」は 1コマ = 1フレームの新しい絵(手直し・エフェクト用)。</p>
      </div>
    </div>`;
  const q = (s) => body.querySelector(s);
  const qa = (s) => [...body.querySelectorAll(s)];
  const canvas = q('.tp-canvas');
  const ctx = canvas.getContext('2d');

  // ---- 値 ⇔ 画面 ----
  const sizeKeyOf = () => Object.entries(TELOP_SIZES).find(([, v]) => v[0] === o.width && v[1] === o.height)?.[0] || 'custom';
  const showVals = () => {
    for (const em of qa('em[data-v]')) { const v = o[em.dataset.v]; em.textContent = (Math.abs(v) >= 10 || Number.isInteger(v) ? String(Math.round(v * 10) / 10) : v.toFixed(2)) + (em.dataset.u || ''); }
  };
  const sync = () => {
    for (const el of qa('[data-k]')) {
      const k = el.dataset.k;
      if (k === 'sizeKey') el.value = sizeKeyOf();
      else if (k === 'vertical') el.value = o.vertical ? '1' : '';
      else if (el.type === 'checkbox') el.checked = !!o[k];
      else if (el.type === 'color') el.value = /^#[0-9a-f]{6}/i.test(o[k] || '') ? o[k].slice(0, 7) : '#ffffff';
      else el.value = o[k];
    }
    for (const el of qa('[data-on]')) el.checked = !!o[el.dataset.on];
    for (const b of qa('[data-style]')) b.classList.toggle('on', b.dataset.style === o.style);
    showVals();
    refresh();
  };
  let start = performance.now(), playing = true, raf = 0;
  const refresh = () => {
    if (canvas.width !== o.width || canvas.height !== o.height) { canvas.width = o.width; canvas.height = o.height; }
    const T = telopTimes(o), tot = T.total || 1;
    const set = (c, a, b) => { q(c).style.left = `${(a / tot) * 100}%`; q(c).style.width = `${(Math.max(0, b - a) / tot) * 100}%`; };
    set('.b-pre', 0, T.t1); set('.b-in', T.t1, T.t2); set('.b-hold', T.t2, T.t3); set('.b-out', T.t3, T.t4); set('.b-post', T.t4, T.total);
    const fps = Number(q('.tp-fps').value);
    q('.tp-info').textContent = `${o.width} × ${o.height} ・ ${T.total.toFixed(2)}秒 ・ ${fps}FPS ・ ${telopFrameCount(o, fps)}フレーム`;
    if (!playing) paint(Number(q('.tp-seek').value) / 1000 * T.total);
  };
  const paint = (t) => {
    const T = telopTimes(o);
    drawTelop(ctx, o, t);
    q('.tp-time').textContent = `${t.toFixed(2)} / ${T.total.toFixed(2)} 秒`;
  };
  const loop = () => {
    raf = requestAnimationFrame(loop);
    if (!playing) return;
    const T = telopTimes(o);
    let t = (performance.now() - start) / 1000;
    if (t > T.total + 0.4) { if (q('.tp-loop').checked) { start = performance.now(); t = 0; } else t = T.total; }
    t = Math.min(t, T.total);
    q('.tp-seek').value = Math.round((t / (T.total || 1)) * 1000);
    paint(t);
  };
  const replay = () => { start = performance.now(); playing = true; q('.tp-play').textContent = '■ 停止'; };
  const fonts = () => prepareTelopFonts(o).then(() => refresh());

  body.addEventListener('input', (e) => {
    const el = e.target, k = el.dataset.k;
    if (el.dataset.on) { const key = el.dataset.on; o[key] = el.checked ? q(`[data-k="${key}"]`).value : ''; sync(); return; }
    if (!k) return;
    if (k === 'sizeKey') { if (TELOP_SIZES[el.value]) { [o.width, o.height] = TELOP_SIZES[el.value]; sync(); } return; }
    if (k === 'vertical') o.vertical = !!el.value;
    else if (el.type === 'checkbox') o[k] = el.checked;
    else if (el.type === 'range' || el.type === 'number') o[k] = Number(el.value);
    else o[k] = el.value;
    if (el.type === 'color') { const on = q(`[data-on="${k}"]`); if (on) on.checked = true; }
    if (k === 'width' || k === 'height') { if (el.value === '' || Number(el.value) < 16) return; o = telopOptions(o); q('[data-k="sizeKey"]').value = sizeKeyOf(); }
    if (k === 'family' || k === 'subFamily') fonts();
    showVals();
    refresh();
    if (['enter', 'exit', 'hold', 'order', 'enterEase', 'exitEase', 'frame', 'frameAnim', 'exitOn'].includes(k)) replay();
  });
  q('.tp-template').onchange = (e) => {
    if (!e.target.value) return;
    o = telopOptions({ template: e.target.value, width: o.width, height: o.height });
    sync(); fonts(); replay();
  };
  for (const b of qa('[data-style]')) b.onclick = () => { o = telopOptions({ ...o, ...styleValues(b.dataset.style), style: b.dataset.style }); sync(); };
  const showTab = (i) => { for (const p of qa('.tp-page')) p.hidden = p.dataset.page !== String(i); for (const b of qa('[data-tab]')) b.classList.toggle('on', b.dataset.tab === String(i)); };
  for (const b of qa('[data-tab]')) b.onclick = () => showTab(b.dataset.tab);
  for (const b of qa('[data-pbg]')) b.onclick = () => { const v = b.dataset.pbg; q('.tp-stage').className = 'tp-stage' + (v === 'checker' ? '' : ' flat'); q('.tp-stage').style.background = v === 'checker' ? '' : v; };
  q('.tp-play').onclick = () => { if (playing) { playing = false; q('.tp-play').textContent = '▶ 再生'; } else replay(); };
  q('.tp-seek').oninput = () => { playing = false; q('.tp-play').textContent = '▶ 再生'; paint((Number(q('.tp-seek').value) / 1000) * telopTimes(o).total); };
  q('.tp-fps').value = String(ex.fps);
  q('.tp-exloop').value = ex.loop;
  q('.tp-trim').checked = !!ex.trim;
  q('.tp-fps').onchange = refresh;

  // ---- 書き出し ----
  const remember = () => {
    try { localStorage.setItem(KEY, JSON.stringify({ o, ex: { fps: Number(q('.tp-fps').value), loop: q('.tp-exloop').value, trim: q('.tp-trim').checked } })); } catch { /* 保存できなくても動く */ }
  };
  const fileBase = () => (o.text.split('\n')[0].replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 24) || 'telop');
  let busy = false, closeModal = null;
  for (const b of qa('[data-out]')) b.onclick = async () => {
    if (busy) return;
    busy = true;
    const kind = b.dataset.out, fps = Number(q('.tp-fps').value), forever = q('.tp-exloop').value === 'forever';
    const prog = (i, n) => toast(`作成中… ${i} / ${n}`);
    try {
      remember();
      await prepareTelopFonts(o);
      if (kind === 'apng') {
        const r = await telopApng(o, { fps, loop: forever ? 0 : 1, trim: q('.tp-trim').checked, onProgress: prog });
        if (await saveBinary('APNG 書き出し', fileBase() + '.png', 'png', 'APNG(動く PNG)', new Blob([r.bytes], { type: 'image/apng' }))) toast(`APNG を書き出しました(${r.width}×${r.height}・${(r.bytes.length / 1024).toFixed(0)}KB)`);
      } else if (kind === 'gif') {
        const bytes = await telopGif(o, { fps: Math.min(fps, 30), loop: forever, onProgress: prog });
        if (await saveBinary('GIF 書き出し', fileBase() + '.gif', 'gif', 'GIF画像', new Blob([bytes], { type: 'image/gif' }))) toast('GIF を書き出しました');
      } else if (kind === 'png') {
        const blob = await new Promise((r) => telopStill(o).toBlob(r, 'image/png'));
        if (await saveBinary('PNG 書き出し', fileBase() + '_静止画.png', 'png', 'PNG画像', blob)) toast('PNG を書き出しました');
      } else if (kind === 'doc') {
        if (await confirmUnsaved()) {
          const r = await telopToDocument(o, { fps: Math.min(fps, 24), loadDocument, onProgress: prog });
          toast(`テロップを新しい絵にしました(${r.frames}コマ。Enter で再生)`);
          closeModal?.();
        }
      }
    } catch (err) { toast(err.message || String(err)); }
    busy = false;
  };

  showTab(0);
  sync();
  fonts();
  raf = requestAnimationFrame(loop);
  const p = openModal({ title: 'テロップを作る(文字のアニメーション)', body, width: 1060, buttons: [{ label: '閉じる', value: null }] }); // primary なし = Enter で閉じない(テキストの改行に使う)
  closeModal = () => document.querySelector('#modal-root .modal-foot button')?.click();
  await p;
  cancelAnimationFrame(raf);
  remember();
  return null;
}
