// 「画像から字を取り込む」ダイアログ(フォント作成モード)
//   画像を選ぶ → 字ごとに色分けして見せる → 字を左から順に入力 → 取り込む(字形の図形になる)。
//   1字が2つに分かれた・2字がくっついた所は、絵をクリックして「前の字とつなぐ / 分ける」を切り替える。
//   「残りの字も作る」: 画像の字の縦の画を筆の部品にして、画像にない字を文字の自動作成(kanji.js)で作る。中身は fontimage.js
import { state, toast } from './state.js';
import { openModal } from './modal.js';
import { pickImage } from './io.js';
import { drawShape } from './vector.js';
import * as K from './kanji.js';
import { imageDataOf, analyzeImage, autoJoins, lettersOf, buildGlyphs, tintCanvas, mainAt, stemCandidates, buildBrush, BRUSH_END } from './fontimage.js';
import { isFontDoc, setGlyphs, setBrushes, addGlyphs, deleteGlyph, selectGlyph } from './fontmode.js';

const VIEW_W = 760, VIEW_H = 230;

// 筆から作る字の組
export const FILL_SETS = {
  upper: ['英大文字', () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'],
  lower: ['英小文字', () => 'abcdefghijklmnopqrstuvwxyz'],
  digit: ['数字・記号', () => '0123456789!?,.:;'],
  hira: ['ひらがな', () => K.KANJI_SETS.hira[1]()],
  kata: ['カタカナ', () => K.KANJI_SETS.kata[1]()],
  kanji: ['漢字(JIS 第1水準)', () => K.KANJI_SETS.jis1[1]()],
};
export const FILL_DEFAULT = ['upper', 'lower', 'digit'];
export const FILL_WEIGHT = 1.1;

// bitmap を渡すと、画像を選ぶ手順を飛ばす(ドロップ・動作確認用)。fresh = 新しく作ったフォント(はじめの空の字を消す)
export async function openFontImageDialog({ bitmap = null, name = '', fresh = false } = {}) {
  if (!isFontDoc()) return 0;
  const font = state.doc.font;
  const body = document.createElement('div');
  body.className = 'form fontimg';
  body.innerHTML = `
    <div class="fi-row"><button class="fi-pick">画像を選ぶ…</button><span class="note fi-name">ロゴや手書きの字の画像(PNG・JPEG・WebP など)</span></div>
    <canvas class="fi-view" width="${VIEW_W}" height="${VIEW_H}"></canvas>
    <label>字(左から順に) <input type="text" class="fi-chars" placeholder="例: VOLKENO" maxlength="200"></label>
    <div class="fi-row">
      <label>字の色 <select class="fi-pol"><option value="auto">自動</option><option value="light">明るい字(暗い背景)</option><option value="dark">暗い字(明るい背景)</option></select></label>
      <label>濃さの境目 <input type="range" class="fi-th" min="16" max="240" step="1"><em class="fi-thv"></em></label>
      <button class="fi-auto" title="クリックで直した所を捨てて、字のまとめ方を自動に戻す">自動でまとめ直す</button>
    </div>
    <div class="fi-row fi-lines">
      <label>上の線 <input type="number" class="num fi-top"></label>
      <label>ベースライン <input type="number" class="num fi-base"></label>
      <span class="note">この2本の間を「大文字の高さ」に合わせます(1段目。画像の上からの画素)</span>
    </div>
    <p class="note fi-info">画像を選ぶと、字ごとに色分けして表示します。</p>
    <p class="note">1字が2色に分かれていたら、<b>右側のかたまりをクリック</b>すると前の字につながります(もう一度クリックで分ける)。同じ字が2回あるときは、最初のものを使います。灰色の所は取り込みません。</p>
    <div class="fi-fill">
      <label class="check"><input type="checkbox" class="fi-fillon"><b>画像にない字も作る</b>(画像の字の縦の画を「筆」にして、残りの字をまとめて作る)</label>
      <div class="fi-row fi-sets">${Object.entries(FILL_SETS).map(([k, [l]]) => `<label class="check"><input type="checkbox" class="fi-set" value="${k}"${FILL_DEFAULT.includes(k) ? ' checked' : ''}>${l}</label>`).join('')}</div>
      <div class="fi-row">
        <label>筆にする画 <select class="fi-stem"></select></label>
        <canvas class="fi-brush" width="240" height="60" title="取り出した筆(左 = 書き始め)"></canvas>
        <label>太さ <input type="range" class="fi-weight" min="0.5" max="2" step="0.05" value="${FILL_WEIGHT}"><em class="fi-wv"></em></label>
      </div>
      <p class="note">線の太さ・かすれ・端の形は画像の字に似ますが、字ごとの飾りは出ません。作った字は「文字の自動作成」の字なので、筆の部品「英数字」「かな」や太さをあとから直すと、まとめて変わります(初めてのときだけ、骨組みのデータ 約3.6MB をダウンロードします)。</p>
    </div>`;
  const q = (s) => body.querySelector(s);
  const view = q('.fi-view'), vx = view.getContext('2d');
  const S = { img: null, an: null, join: {}, manual: false, bands: null, letters: [], tint: null, k: 1, ox: 0, oy: 0, cands: [] };
  const charList = () => [...q('.fi-chars').value].filter((c) => c.trim());
  // 自分で筆を作っているフォントでは、はじめは外しておく(英数字・かなの部品を置き換えるので)
  q('.fi-fillon').checked = !font.kanji?.on;

  const drawBrush = () => {
    const c = q('.fi-brush'), x = c.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.fillStyle = '#fff';
    x.fillRect(0, 0, c.width, c.height);
    const cand = S.cands[Number(q('.fi-stem').value) || 0];
    const br = cand && S.an ? buildBrush(S.an, cand, S.bands[S.letters[cand.letter].row], font, { W: K.BRUSH_W, CY: K.BRUSH_CY }) : null;
    if (!br) return;
    x.scale(c.width / K.BRUSH_W, c.width / K.BRUSH_W);
    x.translate(0, (c.height * K.BRUSH_W) / c.width / 2 - K.BRUSH_CY);
    for (const s of br.shapes) drawShape(x, s);
  };
  const fillUi = () => {
    const on = q('.fi-fillon').checked;
    q('.fi-fill').classList.toggle('off', !on);
    q('.fi-wv').textContent = `${Math.round(Number(q('.fi-weight').value) * 100)}%`;
    const list = charList(), sel = q('.fi-stem'), keep = sel.value;
    S.cands = S.an ? stemCandidates(S.an, S.letters, S.bands) : [];
    sel.innerHTML = S.cands.length
      ? S.cands.map((c, i) => `<option value="${i}">${i === 0 ? '自動: ' : ''}${list[c.letter] ? `「${list[c.letter].replace(/[&<>"']/g, '')}」` : `${c.letter + 1}番目の字`}の縦の画(幅 ${c.width}px)</option>`).join('')
      : '<option value="">縦の画が見つかりません</option>';
    if (keep && Number(keep) < S.cands.length) sel.value = keep;
    drawBrush();
  };
  const regroup = () => {
    if (!S.an) return;
    if (!S.manual) S.join = autoJoins(S.an, charList().length);
    S.letters = lettersOf(S.an, S.join);
    S.tint = tintCanvas(S.an, S.letters);
    draw();
    fillUi();
  };
  const analyze = (keepTh) => {
    if (!S.img) return;
    S.an = analyzeImage(S.img, { polarity: q('.fi-pol').value, threshold: keepTh ? Number(q('.fi-th').value) : null });
    q('.fi-th').value = S.an.th;
    q('.fi-thv').textContent = S.an.th;
    S.bands = S.an.bands.map((b) => ({ ...b }));
    S.manual = false;
    if (S.bands[0]) { q('.fi-top').value = S.bands[0].top; q('.fi-base').value = S.bands[0].base; }
    regroup();
  };
  function draw() {
    vx.fillStyle = '#16181d';
    vx.fillRect(0, 0, VIEW_W, VIEW_H);
    const info = q('.fi-info');
    if (!S.an) return;
    const { w, h } = S.an;
    S.k = Math.min(VIEW_W / w, VIEW_H / h);
    S.ox = (VIEW_W - w * S.k) / 2; S.oy = (VIEW_H - h * S.k) / 2;
    vx.imageSmoothingQuality = 'high';
    vx.drawImage(S.tint, S.ox, S.oy, w * S.k, h * S.k);
    // 上の線・ベースライン
    vx.lineWidth = 1;
    S.bands.forEach((b) => {
      for (const [y, col] of [[b.top, '#60a5fa'], [b.base, '#f87171']]) {
        vx.strokeStyle = col;
        vx.beginPath();
        vx.moveTo(S.ox, Math.round(S.oy + y * S.k) + 0.5);
        vx.lineTo(S.ox + w * S.k, Math.round(S.oy + y * S.k) + 0.5);
        vx.stroke();
      }
    });
    // 字の番号と、割り当てた字
    const list = charList(), used = new Set();
    vx.font = '12px sans-serif';
    vx.textAlign = 'center';
    vx.textBaseline = 'bottom';
    S.letters.forEach((L, i) => {
      const ch = list[i], dup = ch && used.has(ch);
      if (ch) used.add(ch);
      const label = ch ? (dup ? `(${ch})` : ch) : '?';
      const cx = S.ox + ((L.mx0 + L.mx1) / 2) * S.k, y = Math.max(13, S.oy + L.y0 * S.k - 2);
      vx.fillStyle = 'rgba(0,0,0,0.7)';
      const tw = vx.measureText(label).width + 8;
      vx.fillRect(cx - tw / 2, y - 14, tw, 14);
      vx.fillStyle = !ch ? '#fbbf24' : dup ? '#9ca3af' : '#fff';
      vx.fillText(label, cx, y);
    });
    const n = S.letters.length, m = list.length;
    info.textContent = !n ? '字が見つかりません。「字の色」か「濃さの境目」を変えてみてください。'
      : `見つけた字: ${n} / 入力した字: ${m}${S.an.rows.length > 1 ? `(${S.an.rows.length}段)` : ''}。${m && n !== m ? '数が合っていません。分かれた字はクリックでつなぎ、足りない字は入力を直してください。' : m ? '「取り込む」で字形になります。' : '字を左から順に入力してください。'}`;
  }
  const load = (bmp, nm) => {
    S.img = imageDataOf(bmp);
    q('.fi-name').textContent = `${nm || '画像'}(${bmp.width}×${bmp.height})`;
    analyze(false);
  };

  q('.fi-pick').onclick = async () => {
    try { const r = await pickImage(); if (r) load(r.bitmap, r.name); } catch (err) { toast('画像を読み込めませんでした: ' + err.message); }
  };
  q('.fi-chars').oninput = () => regroup();
  q('.fi-pol').onchange = () => analyze(false);
  q('.fi-th').oninput = () => { q('.fi-thv').textContent = q('.fi-th').value; };
  q('.fi-th').onchange = () => analyze(true);
  q('.fi-auto').onclick = () => { S.manual = false; regroup(); };
  q('.fi-fillon').onchange = fillUi;
  q('.fi-stem').onchange = drawBrush;
  q('.fi-weight').oninput = () => { q('.fi-wv').textContent = `${Math.round(Number(q('.fi-weight').value) * 100)}%`; };
  for (const [cls, key] of [['.fi-top', 'top'], ['.fi-base', 'base']]) {
    q(cls).onchange = () => {
      const b = S.bands?.[0];
      if (!b) return;
      const v = Math.round(Number(q(cls).value));
      if (Number.isFinite(v)) b[key] = Math.min(S.an.h, Math.max(0, v));
      if (b.base <= b.top) b.base = b.top + 1;
      q('.fi-top').value = b.top; q('.fi-base').value = b.base;
      draw();
      fillUi();
    };
  }
  view.onclick = (e) => {
    if (!S.an) return;
    const r = view.getBoundingClientRect();
    const x = ((e.clientX - r.left) * (VIEW_W / r.width) - S.ox) / S.k, y = ((e.clientY - r.top) * (VIEW_H / r.height) - S.oy) / S.k;
    const id = mainAt(S.an, x, y, Math.ceil(5 / S.k));
    if (!id) return;
    const row = S.an.rows[S.an.pieces[id].row];
    if (row.ids[0] === id) { toast('段のいちばん左のかたまりは、前の字につなげません'); return; }
    S.manual = true;
    S.join = { ...S.join, [id]: !S.join[id] };
    regroup();
  };
  if (bitmap) load(bitmap, name);
  else { draw(); fillUi(); }

  const { value } = await openModal({ title: '画像から字を取り込む', body, width: VIEW_W + 48, buttons: [{ label: 'キャンセル', value: null }, { label: '取り込む', value: 'ok', primary: true }] });
  if (value !== 'ok') return 0;
  if (!S.an || !S.letters.length) { toast('取り込む字がありません'); return 0; }
  const chars = charList();
  if (!chars.length) { toast('字が入力されていないので、取り込みませんでした'); return 0; }
  const fill = q('.fi-fillon').checked
    ? { sets: [...body.querySelectorAll('.fi-set:checked')].map((el) => el.value), weight: Number(q('.fi-weight').value) || FILL_WEIGHT, stem: Number(q('.fi-stem').value) || 0 }
    : null;
  return (await importGlyphs(S.an, S.letters, chars.join(''), S.bands, { fresh, fill })).glyphs;
}

// 字形を作ってフォントに入れる(ダイアログと Claude 連携の両方から)→ { glyphs(取り込んだ字の数), filled(筆から作った字の数), thick(筆の太さ) }
//   fill = { sets: ['upper', 'lower', 'digit', 'hira', 'kata', 'kanji'], weight, stem(筆にする画の候補の番号) }: 画像にない字を、画像の字から取り出した筆で作る
export async function importGlyphs(an, letters, chars, bands = an.bands, { fresh = false, fill = null } = {}) {
  const doc = state.doc, res = { glyphs: 0, filled: 0, thick: 0 };
  const glyphs = buildGlyphs(an, letters, chars, doc.font, bands);
  if (!glyphs.length) { toast('字形を作れませんでした'); return res; }
  setGlyphs(glyphs);
  res.glyphs = glyphs.length;
  // 新しく作ったフォントの、はじめの空の字(A)は消す(このあと筆から作るなら、そのまま自動の字になる)
  const wantA = fill?.sets?.includes('upper');
  if (fresh && !wantA) {
    const i = doc.frames.findIndex((fr) => fr.glyph?.char === 'A');
    const empty = i >= 0 && !glyphs.some((g) => g.char === 'A') && !doc.layers.some((l) => l.type === 'vector' && l.cels[i]?.shapes.length);
    if (empty && doc.frames.filter((fr) => fr.glyph).length > 1) deleteGlyph(i);
  }
  if (fill?.sets?.length) {
    const cands = stemCandidates(an, letters, bands);
    const cand = cands[Math.min(cands.length - 1, Math.max(0, Math.round(fill.stem) || 0))];
    const br = cand ? buildBrush(an, cand, bands[letters[cand.letter].row], doc.font, { W: K.BRUSH_W, CY: K.BRUSH_CY }) : null;
    if (!br) res.fillError = '筆にできる縦の画が見つからなかったので、画像にない字は作りませんでした';
    else if (!(await K.loadSkeleton({ download: true }).catch(() => false))) res.fillError = '骨組みのデータを読み込めなかったので、画像にない字は作りませんでした';
    else {
      doc.font.kanji = { size: 1.1, ...(doc.font.kanji || {}), on: true, weight: Math.min(2.5, Math.max(0.3, Number(fill.weight) || FILL_WEIGHT)) };
      const keys = ['latin', ...(fill.sets.some((k) => k === 'hira' || k === 'kata') ? ['kana'] : [])];
      setBrushes(keys.map((key) => ({ key, head: BRUSH_END, tail: BRUSH_END, shapes: br.shapes })), '画像の字から筆を作る');
      const have = new Set(doc.frames.map((fr) => fr.glyph?.char));
      const want = [...new Set(fill.sets.flatMap((k) => (FILL_SETS[k] ? [...FILL_SETS[k][1]()] : [])))].filter((c) => K.hasSkeleton(c) && !have.has(c));
      if (want.length) res.filled = addGlyphs(want.join(''), { select: false });
      res.thick = Math.round(br.thick * doc.font.kanji.weight);
      state.dirty = true;
    }
    if (res.fillError) toast(res.fillError);
  }
  const first = doc.frames.findIndex((fr) => fr.glyph?.char === glyphs[0].char);
  if (first >= 0) selectGlyph(first);
  if (!res.fillError) toast(`${glyphs.length}字を取り込みました(${glyphs.map((g) => g.char).join('')})${res.filled ? `。画像にない ${res.filled}字を筆から作りました` : ''}`);
  return res;
}
