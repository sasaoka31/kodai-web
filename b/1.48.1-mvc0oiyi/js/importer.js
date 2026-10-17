// 画像の取り込みダイアログ
//   そのまま配置 / パーツに分ける(AI) / ドット絵に変換 / 線画を抽出 / 輪郭を抽出(線のパス。trace.js)
import { state, toast } from './state.js';
import { RasterLayer, VectorLayer, newDocument, createCanvas } from './document.js';
import { insertLayers } from './layers.js';
import { openModal } from './modal.js';
import { toHex, toHex8, clamp } from './color.js';
import { openPartsEditor, aiAvailable } from './parts.js';
import { bitmapToImageData, medianCut, paletteFromHex, quantize, extractLineArt } from './imageproc.js';
import { traceImage, detailTol, countNodes } from './trace.js';
import { drawShapes, translateShape } from './vector.js';

const MAX_SIDE = 8192;

// 1ドットを k×k px に拡大(ニアレストネイバー)
function upscale(img, k) {
  if (k <= 1) return img;
  const W = img.width, H = img.height;
  const out = new ImageData(W * k, H * k);
  const s = new Uint32Array(img.data.buffer), d = new Uint32Array(out.data.buffer);
  for (let y = 0; y < H * k; y++) {
    const row = ((y / k) | 0) * W;
    for (let x = 0; x < W * k; x++) d[y * W * k + x] = s[row + ((x / k) | 0)];
  }
  return out;
}

export async function showImportDialog(bitmap, name, { loadDocument, confirmUnsaved }) {
  const doc = state.doc;
  const ab = doc.artboard;
  const iw = bitmap.width, ih = bitmap.height;
  const baseName = name.replace(/\.[^.]+$/, '');

  const body = document.createElement('div');
  body.className = 'import-dialog';
  body.innerHTML = `
    <div class="import-preview">
      <canvas width="420" height="320"></canvas>
      <div class="import-info"></div>
    </div>
    <div class="import-options form">
      <div class="seg" role="radiogroup">
        <label><input type="radio" name="im-mode" value="place" checked>そのまま配置</label>
        <label><input type="radio" name="im-mode" value="parts">パーツに分ける(AI)</label>
        <label><input type="radio" name="im-mode" value="pixel">ドット絵に変換</label>
        <label><input type="radio" name="im-mode" value="lineart">線画を抽出</label>
        <label><input type="radio" name="im-mode" value="edges">輪郭を抽出(パス)</label>
      </div>
      <p class="note" data-for="place">画像を新しいレイヤーとしてアートボードの中央に置きます。</p>
      <p class="note" data-for="parts">キャラの絵を、顔・前髪・腕などのパーツごとのレイヤーに分けて取り込みます。
      次の画面でパーツを選んで絵の上をクリックすると、AI がその部分を自動で切り抜きます(オフラインで動作。初回だけAIモデル約45MBをダウンロード)。</p>
      <p class="note" data-for="pixel">解像度を下げて色数を減らし、ドット絵にします。変換後はそのまま手直しできます。</p>
      <p class="note" data-for="lineart">スキャンした絵などから、暗い線だけを取り出して背景を透明にします。</p>
      <p class="note" data-for="edges">写真などの色の境目を、<b>線のパス</b>として取り出します(ベクターレイヤーになり、あとで1本ずつ直せます)。取り込んだあとの画像からも、画像のレイヤーを選ぶと上のバーに出る「トレース…」で作れます。</p>

      <label data-for="place parts lineart edges">サイズ
        <select id="im-size"><option value="fit">アートボードに合わせる</option><option value="original">原寸 (${iw}×${ih})</option></select>
      </label>

      <label data-for="pixel">幅 <input type="number" id="im-w" min="4" max="1024" value="${Math.min(iw, 64)}"> ドット <span id="im-h" class="muted"></span></label>
      <label data-for="pixel">色数 <input type="range" id="im-colors" min="2" max="64" value="16"><em id="im-colors-v"></em></label>
      <label data-for="pixel" class="check"><input type="checkbox" id="im-usepal">ドキュメントのパレットの色だけを使う</label>
      <label data-for="pixel">ディザリング
        <select id="im-dither"><option value="none">なし</option><option value="bayer">パターン(規則的)</option><option value="fs">誤差拡散(なめらか)</option></select>
      </label>
      <label data-for="pixel">出力先
        <select id="im-dest"><option value="layer">現在のドキュメントにレイヤー追加</option><option value="new">新しいドキュメント</option></select>
      </label>

      <label data-for="lineart">しきい値 <input type="range" id="im-thr" min="10" max="250" value="160"><em id="im-thr-v"></em></label>
      <label data-for="lineart">線の色
        <select id="im-linecolor"><option value="primary">メインカラー</option><option value="original">元の色のまま</option></select>
      </label>

      <label data-for="edges">感度 <input type="range" id="im-sens" min="0" max="100" value="50"><em id="im-sens-v"></em></label>
      <label data-for="edges">ぼかし <input type="range" id="im-blur" min="0" max="4" value="1"><em id="im-blur-v"></em></label>
      <label data-for="edges" title="大きいほど、点が少なくなめらかな線になります">なめらかさ <input type="range" id="im-smooth" min="1" max="10" value="4"><em id="im-smooth-v"></em></label>
      <label data-for="edges" title="これより短い線(px)は作りません">短い線を省く <input type="range" id="im-min" min="0" max="80" value="10"><em id="im-min-v"></em></label>
      <label data-for="edges">線の太さ <input type="range" id="im-thick" min="1" max="20" value="2"><em id="im-thick-v"></em></label>

      <label data-for="lineart edges" class="check"><input type="checkbox" id="im-keep" checked>元の画像も下に配置する(半透明)</label>
    </div>`;

  const $ = (s) => body.querySelector(s);
  const preview = $('canvas');
  const info = $('.import-info');
  const mode = () => body.querySelector('[name=im-mode]:checked').value;

  // 配置サイズ(ドット絵変換以外)
  function placedSize() {
    let s = $('#im-size').value === 'fit' ? Math.min(ab.w / iw, ab.h / ih) : 1;
    s = Math.min(s, MAX_SIDE / iw, MAX_SIDE / ih);
    return { w: Math.max(1, Math.round(iw * s)), h: Math.max(1, Math.round(ih * s)) };
  }

  const srcCache = new Map();
  function source(w, h, box) {
    const k = `${w}x${h}${box ? 'b' : ''}`;
    if (!srcCache.has(k)) srcCache.set(k, bitmapToImageData(bitmap, w, h, { box }));
    return srcCache.get(k);
  }

  let result = null; // { img, original?, palette? }。輪郭は { shapes(絵の左上を 0,0 とした線のパス), w, h, original }

  function compute() {
    const m = mode();
    if (m === 'pixel') {
      const w = clamp(Math.round(Number($('#im-w').value)) || 64, 4, 1024);
      const h = Math.max(1, Math.round((ih * w) / iw));
      $('#im-h').textContent = `× ${h} px`;
      const src = source(w, h, true);
      const pal = $('#im-usepal').checked ? paletteFromHex(doc.palette) : medianCut(src, Number($('#im-colors').value));
      return { img: quantize(src, pal, $('#im-dither').value), palette: pal };
    }
    const { w, h } = placedSize();
    const smooth = doc.mode === 'illust';
    const src = source(w, h, !smooth);
    if (m === 'place' || m === 'parts') return { img: src };
    const color = { r: state.primary.r, g: state.primary.g, b: state.primary.b };
    if (m === 'lineart') {
      const c = $('#im-linecolor').value === 'primary' ? color : null;
      return { img: extractLineArt(src, { threshold: Number($('#im-thr').value), color: c, soft: smooth }), original: src };
    }
    // 大きい絵は、縮めてなぞる(線は置く大きさに合わせる)
    const k = Math.max(1, Math.max(w, h) / 1200);
    const small = k > 1 ? source(Math.max(1, Math.round(w / k)), Math.max(1, Math.round(h / k)), false) : src;
    const shapes = traceImage(small, {
      sensitivity: Number($('#im-sens').value), blur: Number($('#im-blur').value), detail: detailTol(Number($('#im-smooth').value)),
      minLen: Number($('#im-min').value) / (w / small.width), width: Number($('#im-thick').value),
      color: toHex8({ ...color, a: 255 }), scale: w / small.width,
    });
    return { shapes, w, h, original: src };
  }

  function drawPreview() {
    const ctx = preview.getContext('2d');
    const PW = preview.width, PH = preview.height;
    ctx.clearRect(0, 0, PW, PH);
    const { img, original, shapes } = result;
    const iw2 = img ? img.width : result.w, ih2 = img ? img.height : result.h;
    const s = Math.min(PW / iw2, PH / ih2);
    const w = iw2 * s, h = ih2 * s, x = (PW - w) / 2, y = (PH - h) / 2;
    ctx.fillStyle = '#fff';
    ctx.fillRect(x, y, w, h);
    ctx.imageSmoothingEnabled = s < 1;
    const toCanvas = (im) => {
      const c = createCanvas(im.width, im.height);
      c.getContext('2d').putImageData(im, 0, 0);
      return c;
    };
    if (original && $('#im-keep').checked) {
      ctx.globalAlpha = 0.3;
      ctx.drawImage(toCanvas(original), x, y, w, h);
      ctx.globalAlpha = 1;
    }
    if (shapes) {
      ctx.save();
      ctx.setTransform(s, 0, 0, s, x, y);
      drawShapes(ctx, shapes);
      ctx.restore();
      info.textContent = shapes.length ? `出力: ${iw2} × ${ih2} px / 線のパス ${shapes.length}本・点 ${countNodes(shapes)}個` : '線が見つかりません(感度を上げてください)';
      return;
    }
    ctx.drawImage(toCanvas(img), x, y, w, h);
    const extra = result.palette ? ` / ${result.palette.length}色` : '';
    info.textContent = `出力: ${img.width} × ${img.height} px${extra}`;
  }

  function syncVisibility() {
    const m = mode();
    for (const el of body.querySelectorAll('[data-for]')) el.hidden = !el.dataset.for.split(' ').includes(m);
    $('#im-colors').disabled = $('#im-usepal').checked;
    $('#im-colors-v').textContent = $('#im-colors').value;
    $('#im-thr-v').textContent = $('#im-thr').value;
    $('#im-sens-v').textContent = $('#im-sens').value;
    $('#im-blur-v').textContent = $('#im-blur').value;
    $('#im-thick-v').textContent = $('#im-thick').value;
    $('#im-smooth-v').textContent = $('#im-smooth').value;
    $('#im-min-v').textContent = $('#im-min').value;
  }

  let timer = null;
  function schedule() {
    syncVisibility();
    clearTimeout(timer);
    info.textContent = '処理中…';
    timer = setTimeout(() => {
      try {
        result = compute();
        drawPreview();
      } catch (err) {
        console.error(err);
        info.textContent = 'エラー: ' + err.message;
      }
    }, 80);
  }
  body.addEventListener('input', schedule);
  body.addEventListener('change', schedule);
  // 小さく配置するときはぼかすと線が消えるので初期値を 0 に
  if (Math.max(placedSize().w, placedSize().h) < 200) $('#im-blur').value = 0;
  schedule();

  const { value } = await openModal({
    title: `画像の取り込み — ${name}`,
    body,
    width: 820,
    buttons: [{ label: 'キャンセル', value: null }, { label: '取り込む', value: 'ok', primary: true }],
  });
  clearTimeout(timer);
  if (value !== 'ok') return;
  result = compute();
  const m = mode();

  // パーツに分ける: 専用の画面で切り抜いてからレイヤーにする
  if (m === 'parts') {
    if (!aiAvailable()) { toast('パーツ分けはアプリ版(exe)だけで使えます'); return; }
    const { w, h } = placedSize();
    const x = ab.x + Math.round((ab.w - w) / 2), y = ab.y + Math.round((ab.h - h) / 2);
    await openPartsEditor(bitmap, baseName, { x, y, w, h });
    return;
  }

  // ドット絵変換: 1ドットを k px に拡大して置く(ぼかさない)
  if (m === 'pixel') {
    const pw = result.img.width, ph = result.img.height;
    if ($('#im-dest').value === 'new') {
      if (!(await confirmUnsaved())) return;
      const k = Math.max(1, Math.floor(768 / Math.max(pw, ph)));
      const nd = newDocument({ width: pw * k, height: ph * k });
      nd.layers[0].name = baseName;
      nd.layers[0].putImageData(upscale(result.img, k), 0, 0);
      nd.palette = result.palette.map((c) => toHex({ ...c, a: 255 }));
      loadDocument(nd, null);
      toast(`ドット絵に変換しました(1ドット = ${k}px)`);
      return;
    }
    const k = Math.max(1, Math.floor(Math.min(ab.w / pw, ab.h / ph)));
    result.img = upscale(result.img, k);
  }

  const w = result.img ? result.img.width : result.w, h = result.img ? result.img.height : result.h;
  const x = ab.x + Math.round((ab.w - w) / 2), y = ab.y + Math.round((ab.h - h) / 2);
  const layers = [];
  if (result.original && $('#im-keep').checked) {
    const orig = new RasterLayer(`${baseName}(元画像)`);
    orig.putImageData(result.original, x, y);
    orig.opacity = 0.4;
    layers.push(orig);
  }
  const label = { place: baseName, pixel: `${baseName}(ドット絵)`, lineart: `${baseName}(線画)`, edges: `${baseName}(輪郭)` }[m];
  if (m === 'edges') {
    // 輪郭: 線のパスのベクターレイヤー
    if (!result.shapes.length) { toast('線が見つかりませんでした(感度を上げてください)'); return; }
    const main = new VectorLayer(label);
    main.shapes = result.shapes.map((sh) => translateShape(sh, x, y));
    layers.push(main);
  } else {
    const main = new RasterLayer(label);
    main.putImageData(result.img, x, y);
    layers.push(main);
  }
  insertLayers('画像を取り込み', layers);
  toast(m === 'edges' ? `画像の輪郭を、線のパス ${result.shapes.length}本 として取り込みました` : '画像を取り込みました');
}
