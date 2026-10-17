// 「立体にする」ダイアログ(上の「作る ▾」→ 立体にする / ファイル → 立体にして書き出す…)
//   今の絵(正面)と、あれば真横・後ろの絵のレイヤーから、荒いポリゴンの立体を作る(solid.js)。
//   右のプレビューはドラッグで回せる(solidview.js)。Blender などで開ける .glb で書き出す
import { state, toast } from './state.js';
import { openModal, escapeHtml } from './modal.js';
import { timeline } from './document.js';
import { flattenLayers, celBounds } from './render.js';
import { saveBinary, fileName } from './io.js';
import { createCanvas } from './document.js';
import { encodeGif } from './gif.js';
import { apngEncoder } from './apng.js';
import { buildSolid, solidToGlb, SOLID_DEFAULTS, SOLID_RES } from './solid.js';
import { createSolidView } from './solidview.js';
import { buildRigged, riggedToGlb, skinPositions } from './solidrig.js';

const KEY = 'pixelrig.solid';

// 立体を、決めた向きから見た絵のコマにする(Kodai だけで完成させる用)。
//   target = { rigged }(パーツごと + ボーン。動きがあればそのコマ)か { solid }(1つの塊)
//   turn = ぐるっと一周まわす。戻り値 [{ canvas, delay(ms) }](背景は透明)
export function solidFrames({ rigged, solid }, { yaw = 0.5, pitch = 0.15, zoom = 1, size = 384, turn = false, shadow = true } = {}) {
  const base = rigged ? rigged.merged : solid;
  const gc = createCanvas(size, size);
  const v = createSolidView(gc);
  if (!v) throw new Error('この環境では 3D の表示(WebGL2)が使えません');
  v.bg = [0, 0, 0, 0]; v.zoom = zoom; v.pitch = pitch; v.shadow = shadow;
  // 元の形にしてから読み込む(プレビューの再生で位置が入れ替わっていることがある)
  const rest = rigged ? skinPositions(rigged, rigged.rest) : null;
  const put = (list) => { let o2 = 0; for (const p of list) { base.positions.set(p, o2); o2 += p.length; } };
  if (rest) put(rest);
  v.setSolid(base);
  const keys = rigged?.anim ? rigged.anim.keys.slice(0, -1) : null;
  const delays = keys ? keys.map((_, i) => Math.round((rigged.anim.times[i + 1] - rigged.anim.times[i]) * 1000)) : null;
  // 一周まわすときは、なめらかに見えるコマ数に(動きは何回かくり返す)
  const per = keys ? keys.length : 1;
  const total = turn ? per * Math.max(1, Math.ceil(24 / per)) : per;
  const out = [];
  for (let f = 0; f < total; f++) {
    if (keys) { put(skinPositions(rigged, keys[f % per])); v.setPositions(base.positions); }
    v.yaw = yaw + (turn ? (Math.PI * 2 * f) / total : 0);
    v.render();
    const c = createCanvas(size, size);
    c.getContext('2d').drawImage(gc, 0, 0);
    out.push({ canvas: c, delay: delays ? delays[f % per] : 70 });
  }
  if (rest) put(rest);
  v.dispose();
  return out;
}

// コマ → APNG / GIF / スプライトシート(横一列)のバイト列
export async function solidFramesTo(frames, format) {
  const S = frames[0].canvas.width;
  const img = (f) => f.canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, S, S);
  if (format === 'gif') return encodeGif(frames.map((f) => ({ img: img(f), delay: f.delay })), { loop: 0 });
  if (format === 'apng') { const enc = apngEncoder(S, S); for (const f of frames) await enc.add(img(f), f.delay); return (await enc.finish({ loop: 0 })).bytes; }
  const sheet = createCanvas(S * (format === 'png' ? 1 : frames.length), S), x = sheet.getContext('2d');
  (format === 'png' ? frames.slice(0, 1) : frames).forEach((f, i) => x.drawImage(f.canvas, i * S, 0));
  return new Uint8Array(await (await new Promise((r) => sheet.toBlob(r, 'image/png'))).arrayBuffer());
}

// レイヤーの絵(エフェクトなし)。ref = レイヤー / 'all'(表示中のレイヤー全部。exclude は除く)
export function solidImage(ref, exclude = []) {
  const doc = state.doc, frame = timeline.frame;
  let layers, region;
  if (ref === 'all') {
    layers = doc.layers.filter((l) => l.visible && !exclude.includes(l));
    region = doc.artboard;
  } else {
    const cel = ref.displayCelAt(frame);
    const b = cel && celBounds(ref, cel);
    if (!b) return null;
    layers = [ref];
    region = { x: Math.floor(b.x0), y: Math.floor(b.y0), w: Math.ceil(b.x1) - Math.floor(b.x0), h: Math.ceil(b.y1) - Math.floor(b.y0) };
  }
  if (!layers.length || region.w < 1 || region.h < 1) return null;
  // 大きな絵は 1024px までに縮める(計算と貼る絵を軽く)
  const k = Math.min(1, 1024 / Math.max(region.w, region.h));
  const c = flattenLayers(doc, layers, k, region, { frame, effects: false });
  return c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
}

// 今の絵から立体を作る(ダイアログと Claude 連携の両方から)。front / side / back = レイヤー・'all'・null
export function solidFromDoc({ front = 'all', side = null, back = null } = {}, options = {}) {
  const ex = [side, back].filter((l) => l && l !== 'all');
  const f = solidImage(front, ex);
  if (!f) throw new Error('正面の絵がありません');
  return buildSolid({ front: f, side: side ? solidImage(side) : null, back: back ? solidImage(back) : null }, options);
}

export async function solidDialog() {
  const doc = state.doc;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* なし */ }
  const o = { ...SOLID_DEFAULTS, gap: 1, ...saved };
  // ボーンがあってレイヤーをつないである絵は、はじめから「パーツごと + ボーン」に
  o.rigged = (doc.rig?.bones?.length || 0) > 0 && doc.layers.some((l) => l.rigged);
  const layerOpts = doc.layers.slice().reverse().map((l) => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('');
  const body = document.createElement('div');
  body.className = 'form solid-dialog';
  body.innerHTML = `
    <div class="tp-cols">
      <div class="sd-left">
        <p class="note">絵の輪郭から、荒いポリゴンの立体を作ります(AI は使いません)。カード = 絵をそのまま厚みのある板に。ふくらませる・型抜きは丸みのある立体(絵のない向きは粗くなります)。</p>
        <label class="check sd-rig-row"><input type="checkbox" data-k="rigged"><b>パーツごとのカードにして、ボーンと動きも入れる</b></label>
        <p class="note sd-rig-note">レイヤー1枚 = カード1枚を前後に重ねた「紙の人形」。Kodai のボーン(リグ)と動きが入り、Blender でそのまま再生・ポーズ付けができます。</p>
        <label class="tp-s sd-single"><span>正面の絵</span><select class="sd-front"><option value="all">表示中のレイヤー全部</option>${layerOpts}</select></label>
        <label class="tp-s sd-single"><span>形</span><select data-k="shape"><option value="card">カード(同じ厚みの板・紙の人形)</option><option value="inflate">ふくらませる(真ん中ほど厚い)</option><option value="auto">型抜き(真横の絵があるとき)</option></select></label>
        <label class="tp-s sd-single"><span>真横の絵</span><select class="sd-side"><option value="">なし</option>${layerOpts}</select></label>
        <label class="tp-s sd-single"><span>後ろの絵</span><select class="sd-back"><option value="">なし(正面の色を使う)</option>${layerOpts}</select></label>
        <label class="tp-r"><span>荒さ(マス目の数)</span><input type="range" data-k="res" min="${SOLID_RES[0]}" max="${SOLID_RES[1]}" step="1"><em data-v="res"></em></label>
        <label class="tp-r"><span>厚み</span><input type="range" data-k="thick" min="0.2" max="2" step="0.05"><em data-v="thick"></em></label>
        <label class="tp-r sd-rigonly"><span>重ねる間隔</span><input type="range" data-k="gap" min="0" max="3" step="0.1"><em data-v="gap"></em></label>
        <label class="check"><input type="checkbox" data-k="flat">面をカクカクに見せる(ローポリ風)</label>
        <label class="check"><input type="checkbox" data-k="nearest">絵をドットのまま貼る(ぼかさない)</label>
        <label class="check"><input type="checkbox" data-k="round">断面を丸くする(真横の絵があるとき)</label>
        <label class="check"><input type="checkbox" data-k="sideLeft">真横の絵は左向き</label>
        <label class="check"><input type="checkbox" data-k="backBlur">後ろはぼかして色だけにする(後ろの絵がないとき)</label>
        <div class="row">
          <label class="tp-s"><span>背景を抜く</span><select data-k="removeBg"><option value="auto">自動(透明な所がない絵だけ)</option><option value="on">する</option><option value="off">しない</option></select></label>
          <label class="tp-n"><span>高さ</span><input type="number" data-k="height" class="num" min="0.01" max="100" step="0.1">m</label>
        </div>
        <p class="note sd-stats"></p>
      </div>
      <div class="tp-right">
        <div class="tp-bgs"><span>見る向き</span><button type="button" data-view="0,0.1">正面</button><button type="button" data-view="0.7,0.2">ななめ</button><button type="button" data-view="1.5708,0.1">横</button>
          <button type="button" data-view="3.1416,0.1">後ろ</button><button type="button" data-view="0.6,1.2">上</button><label class="check"><input type="checkbox" class="sd-wire">面の線</label><button type="button" class="sd-play" hidden>▶ 動きを見る</button></div>
        <div class="sd-stage"><canvas class="sd-canvas" width="520" height="520"></canvas></div>
        <p class="note">ドラッグでぐるぐる回せます(動きの再生中も)。ホイールで拡大縮小。</p>
        <h3 class="form-sec">この向きで書き出す(Kodai だけで完成)</h3>
        <div class="row">
          <label class="tp-s"><span>大きさ</span><select class="sd-size">${[128, 256, 384, 512, 768, 1024].map((n) => `<option value="${n}"${n === 384 ? ' selected' : ''}>${n} × ${n}</option>`).join('')}</select></label>
          <label class="check"><input type="checkbox" class="sd-shadow" checked>地面の影</label>
          <label class="check"><input type="checkbox" class="sd-turn">ぐるっと一周まわす</label>
        </div>
        <div class="tp-out"><button type="button" data-out="apng">APNG</button><button type="button" data-out="gif">GIF</button><button type="button" data-out="sheet">スプライトシート</button><button type="button" data-out="png">PNG(1枚)</button></div>
        <p class="note">今プレビューで見ている向き・大きさのまま、背景は透明で書き出します。動きがあれば動きごと。Blender に持っていくときは、下の「Blender 用に書き出し」。</p>
      </div>
    </div>`;
  const q = (s) => body.querySelector(s);
  const qa = (s) => [...body.querySelectorAll(s)];
  const canvas = q('.sd-canvas');
  let view = null;
  try { view = createSolidView(canvas); } catch (err) { console.warn(err); }
  let solid = null, rigged = null, playTimer = 0;
  const stopPlay = () => { clearInterval(playTimer); playTimer = 0; q('.sd-play').textContent = '▶ 動きを見る'; };
  // ポーズをかけた位置で描く(f = 動きのキーの番号。null = 元の形)
  const showPose = (f) => {
    if (!rigged || !view) return;
    const pos = skinPositions(rigged, f === null ? rigged.rest : rigged.anim.keys[f]);
    let o2 = 0;
    for (const p of pos) { rigged.merged.positions.set(p, o2); o2 += p.length; }
    view.setPositions(rigged.merged.positions); view.render();
  };
  const layerOf = (v) => (v === 'all' ? 'all' : v ? doc.layerById(v) : null);
  const rebuild = () => {
    stopPlay();
    const rigMode = !!o.rigged;
    for (const el of qa('.sd-single')) el.hidden = rigMode;
    for (const el of qa('.sd-rigonly')) el.hidden = !rigMode;
    rigged = null;
    q('.sd-play').hidden = true;
    if (rigMode) {
      try {
        solid = null;
        rigged = buildRigged(doc, { ...o, shape: 'card', cardDepth: 0.03 });
        const s = rigged.stats;
        q('.sd-stats').textContent = `カード ${s.parts}枚 ・ ボーン ${s.bones}本(つないだカード ${s.skinned}枚)・ 動き ${s.frames ? `${s.frames}コマ / ${s.seconds.toFixed(2)}秒` : 'なし'} ・ 三角 ${s.triangles} ・ 大きさ ${s.size.map((v) => v.toFixed(2)).join(' × ')} m`
          + (s.bones ? '' : '(ボーンがないので、動かない重ねたカードになります。リグツール(R)でボーンを入れて、レイヤーをつないでください)');
        if (view) { const [mn, mx] = [rigged.stats.min, rigged.stats.max]; rigged.merged.stats = { min: mn, max: mx }; view.setSolid(rigged.merged); view.render(); }
        q('.sd-play').hidden = !rigged.anim;
        if (rigged.anim) q('.sd-play').click(); // 動きがあれば、はじめから再生(回しながら見られる)
      } catch (err) { rigged = null; q('.sd-stats').textContent = err.message; }
      return;
    }
    try {
      solid = solidFromDoc({ front: layerOf(q('.sd-front').value), side: layerOf(q('.sd-side').value), back: layerOf(q('.sd-back').value) }, o);
      const s = solid.stats;
      q('.sd-stats').textContent = `${{ hull: '型抜き(正面 + 真横)', inflate: 'ふくらませる(正面だけ)', card: 'カード(同じ厚みの板)' }[s.mode]} ・ 頂点 ${s.vertices} ・ 三角 ${s.triangles} ・ 大きさ ${s.size.map((v) => v.toFixed(2)).join(' × ')} m ・ 絵 ${s.texture[0]}×${s.texture[1]}px`;
      if (view) { view.setSolid(solid); view.render(); }
    } catch (err) {
      solid = null;
      q('.sd-stats').textContent = err.message;
    }
  };
  for (const el of qa('[data-k]')) {
    const k = el.dataset.k;
    if (el.type === 'checkbox') el.checked = !!o[k]; else el.value = o[k];
  }
  const showVals = () => { for (const em of qa('em[data-v]')) em.textContent = String(Math.round(o[em.dataset.v] * 100) / 100); };
  body.addEventListener('input', (e) => {
    const el = e.target, k = el.dataset.k;
    if (k) o[k] = el.type === 'checkbox' ? el.checked : el.type === 'range' || el.type === 'number' ? Number(el.value) : el.value;
    if (el.classList.contains('sd-wire')) { if (view) { view.wire = el.checked; view.render(); } return; }
    if (el.classList.contains('sd-shadow')) { if (view) { view.shadow = el.checked; view.render(); } return; }
    if (el.classList.contains('sd-turn') || el.classList.contains('sd-size')) return;
    if (k === 'height' && !(o.height > 0)) return;
    showVals();
    rebuild();
  });
  body.addEventListener('keydown', (e) => e.stopPropagation());
  q('.sd-play').onclick = () => {
    if (playTimer) { stopPlay(); showPose(null); return; }
    if (!rigged?.anim) return;
    q('.sd-play').textContent = '■ 止める';
    const t0 = performance.now(), { times } = rigged.anim, total = times[times.length - 1];
    playTimer = setInterval(() => {
      const t = ((performance.now() - t0) / 1000) % total;
      let f = 0;
      while (f < times.length - 2 && times[f + 1] <= t) f++;
      showPose(f);
    }, 50);
  };
  for (const b of qa('[data-view]')) b.onclick = () => { if (!view) return; [view.yaw, view.pitch] = b.dataset.view.split(',').map(Number); view.render(); };
  // ドラッグで回す・ホイールで拡大縮小
  let dragging = null;
  canvas.addEventListener('pointerdown', (e) => { dragging = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging || !view) return;
    view.yaw += (e.clientX - dragging.x) * 0.01; view.pitch = Math.max(-1.5, Math.min(1.5, view.pitch + (e.clientY - dragging.y) * 0.01));
    dragging = { x: e.clientX, y: e.clientY };
    view.render();
  });
  canvas.addEventListener('pointerup', () => { dragging = null; });
  canvas.addEventListener('wheel', (e) => { if (!view) return; e.preventDefault(); view.zoom = Math.max(0.3, Math.min(6, view.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); view.render(); }, { passive: false });
  // 選んでいるレイヤーが正面なら、ほかのレイヤーに「横」「後ろ」という名前があれば入れておく
  const guess = (re) => doc.layers.find((l) => re.test(l.name))?.id || '';
  q('.sd-side').value = guess(/横|side/i);
  q('.sd-back').value = guess(/後ろ|うしろ|back/i);
  if (q('.sd-side').value || q('.sd-back').value) { const f = doc.layers.find((l) => /正面|front/i.test(l.name)); if (f) q('.sd-front').value = f.id; }
  if (view) view.shadow = true;
  // この向きで書き出す
  let busy = false;
  for (const b of qa('[data-out]')) b.onclick = async () => {
    if (busy || (!solid && !rigged)) return;
    busy = true;
    const fmt = b.dataset.out, wasPlaying = !!playTimer;
    stopPlay();
    try {
      toast('書き出す絵を作っています…');
      await new Promise((r) => setTimeout(r, 30));
      const frames = solidFrames({ rigged, solid }, { yaw: view?.yaw ?? 0.5, pitch: view?.pitch ?? 0.15, zoom: view?.zoom ?? 1, size: Number(q('.sd-size').value), turn: q('.sd-turn').checked, shadow: q('.sd-shadow').checked });
      const bytes = await solidFramesTo(frames, fmt);
      const name = (fileName().replace(/\.[^.]+$/, '') || 'kodai') + '_3d';
      const [ext, label, mime] = fmt === 'gif' ? ['gif', 'GIF画像', 'image/gif'] : ['png', fmt === 'apng' ? 'APNG(動く PNG)' : 'PNG画像', 'image/png'];
      if (await saveBinary('この向きで書き出す', `${name}${fmt === 'sheet' ? '_sheet' : ''}.${ext}`, ext, label, new Blob([bytes], { type: mime }))) toast(`書き出しました(${frames.length}コマ・${(bytes.length / 1024).toFixed(0)}KB)`);
    } catch (err) { toast(err.message || String(err)); }
    if (rigged && view) { view.setSolid(rigged.merged); view.render(); }
    if (wasPlaying) q('.sd-play').click();
    busy = false;
  };
  showVals();
  rebuild();

  for (;;) {
    const { value } = await openModal({ title: '立体にする(Blender 用に書き出し)', body, width: 1000, buttons: [{ label: '閉じる', value: null }, { label: 'Blender 用に書き出し(.glb)', value: 'glb', primary: true }] });
    try { const { ...keep } = o; localStorage.setItem(KEY, JSON.stringify(keep)); } catch { /* 保存できなくても動く */ }
    if (value !== 'glb') break;
    if (!solid && !rigged) { toast('立体にできる絵がありません'); continue; }
    try {
      const name = fileName().replace(/\.[^.]+$/, '') || 'kodai';
      const bytes = rigged ? await riggedToGlb(rigged, { name: 'Kodai' }) : await solidToGlb(solid, { name });
      if (await saveBinary('Blender 用に書き出し', name + '.glb', 'glb', 'glTF バイナリ(.glb)', new Blob([bytes], { type: 'model/gltf-binary' }))) {
        toast(`立体を書き出しました(三角 ${(rigged || solid).stats.triangles}・${(bytes.length / 1024).toFixed(0)}KB)`);
        break;
      }
    } catch (err) { toast(err.message || String(err)); }
  }
  stopPlay();
  view?.dispose();
  return rigged || solid;
}
