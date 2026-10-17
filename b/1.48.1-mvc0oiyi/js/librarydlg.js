// 「素材ライブラリ」ダイアログ(ファイル → 素材ライブラリ… / 上の「作る ▾」)
//   左: フォルダの取り込み・グループ・一覧(小さい絵)。右: 選んだ素材の確認(2×2 に並べる)と、大きさ・継ぎ目・ドット化・置き方。
//   「置く」で新しいラスターレイヤーに置く(1枚 / アートボードに敷き詰め)。中身は library.js
import { state, toast } from './state.js';
import { openModal, escapeHtml } from './modal.js';
import { placeTexture } from './texturedlg.js';
import { tileImage } from './texture.js';
import {
  libraryAvailable, libraryList, libraryBitmap, libraryThumb, processAsset, assetOptions,
  libraryPickFolder, libraryPickFiles, libraryRemove, libraryRemoveGroup, importSummary,
} from './library.js';

const KEY = 'pixelrig.library';
let last = null;
const loadLast = () => { if (!last) { try { last = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { last = {}; } } return last; };

// 素材を新しいラスターレイヤーに置く(ダイアログと Claude 連携の両方から)。戻り値は { layer, width, height }
export async function placeAsset(asset, opts = {}, { fill = false, x, y, name } = {}) {
  const img = processAsset(await libraryBitmap(asset.id), opts);
  const layer = placeTexture(img, { fill, x, y, name: name || `素材(${asset.name.replace(/\.[^.]+$/, '')})` });
  return { layer, width: img.width, height: img.height, img };
}

export async function libraryDialog() {
  if (!libraryAvailable()) { toast('素材ライブラリはアプリ版(exe)で使えます'); return null; }
  const saved = loadLast();
  const body = document.createElement('div');
  body.className = 'form lib-dialog';
  body.innerHTML = `
    <div class="lib-cols">
      <div class="lib-left">
        <div class="lib-row"><button class="lb-folder primary" title="フォルダの中の画像を、下のフォルダもふくめて全部取り込む。もう一度取り込むと、変わった画像だけ入れ直す">フォルダを取り込む…</button><button class="lb-files">画像を足す…</button></div>
        <div class="lib-row"><select class="lb-group"></select><input type="text" class="lb-search" placeholder="名前で探す"></div>
        <div class="lib-grid"></div>
        <div class="lib-row"><span class="note lb-count"></span><button class="lb-del-group" title="表示しているグループを、ライブラリから消す(元のフォルダの画像は消えません)">このグループを消す</button></div>
      </div>
      <div class="lib-right">
        <canvas class="lb-preview" width="256" height="256"></canvas>
        <p class="note lb-info">素材を選ぶと、2×2 に並べて表示します</p>
        <label>大きさ <input type="range" class="lb-scale" min="0.05" max="2" step="0.05"><em class="lb-scale-v"></em></label>
        <label class="check"><input type="checkbox" class="lb-seamless">継ぎ目をなじませる(並べてもつながる)</label>
        <label>ドットの大きさ <input type="number" class="lb-pixel num" min="1" max="64"> px</label>
        <label>置き方 <select class="lb-place"><option value="one">1枚(アートボードの左上)</option><option value="fill">アートボード全体に敷き詰める</option></select></label>
        <button class="lb-del" title="この素材を、ライブラリから消す(元の画像は消えません)">この素材を消す</button>
      </div>
    </div>
    <p class="note">取り込んだ画像は Kodai の中に写して取っておくので、元のフォルダがなくなっても使えます。画像はそのまま使います(色や模様を計算で作り直す「テクスチャを作る」とは別です)。</p>`;
  const q = (c) => body.querySelector(c);
  const S = { list: [], group: saved.group ?? '', cur: null, o: { scale: saved.scale ?? 1, seamless: !!saved.seamless, pixel: saved.pixel ?? 1 }, token: 0 };
  let observer = null;

  const groupsOf = (list) => [...new Set(list.map((a) => a.group))].sort((a, b) => a.localeCompare(b, 'ja'));
  const shown = () => {
    const key = q('.lb-search').value.trim().toLowerCase();
    return S.list.filter((a) => (S.group === '' || a.group === S.group || a.group.startsWith(S.group + '/')) && (!key || a.id.toLowerCase().includes(key)));
  };
  const drawPreview = async () => {
    const c = q('.lb-preview'), x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    q('.lb-del').disabled = !S.cur;
    if (!S.cur) { q('.lb-info').textContent = S.list.length ? '素材を選ぶと、2×2 に並べて表示します' : 'まだ素材がありません。「フォルダを取り込む…」で画像のフォルダを選んでください'; return; }
    const token = ++S.token, asset = S.cur;
    let bmp;
    try { bmp = await libraryBitmap(asset.id); } catch (err) { q('.lb-info').textContent = '読めませんでした: ' + err.message; return; }
    if (token !== S.token) return;
    const full = assetOptions(S.o, bmp);
    // 確認用は小さく作る(形は同じ)
    const k = Math.min(1, 256 / Math.max(full.width, full.height));
    const img = processAsset(bmp, { ...S.o, scale: undefined, width: Math.max(1, Math.round(full.width * k)), height: Math.max(1, Math.round(full.height * k)), pixel: Math.max(1, Math.round(S.o.pixel * k)) });
    const tile = tileImage(img, img.width * 2, img.height * 2);
    const tmp = document.createElement('canvas');
    tmp.width = tile.width; tmp.height = tile.height;
    tmp.getContext('2d').putImageData(tile, 0, 0);
    const s = Math.min(c.width / tile.width, c.height / tile.height);
    x.imageSmoothingEnabled = S.o.pixel <= 1;
    x.drawImage(tmp, (c.width - tile.width * s) / 2, (c.height - tile.height * s) / 2, tile.width * s, tile.height * s);
    const out = S.o.seamless ? processAsset(bmp, { ...S.o, pixel: 1, width: Math.min(64, full.width), height: undefined }) : null;
    const ratio = out ? out.width / Math.min(64, full.width) : 1;
    q('.lb-info').textContent = `${asset.id}(元 ${bmp.width}×${bmp.height} → 置く大きさ 約 ${Math.round(full.width * ratio)}×${Math.round(full.height * ratio)})`;
  };
  const drawGrid = () => {
    const grid = q('.lib-grid');
    observer?.disconnect();
    grid.innerHTML = '';
    const list = shown();
    observer = new IntersectionObserver((es) => {
      for (const e of es) {
        if (!e.isIntersecting || e.target.dataset.drawn) continue;
        e.target.dataset.drawn = '1';
        observer.unobserve(e.target);
        libraryThumb(e.target.dataset.id, 88).then((cv) => e.target.prepend(cv)).catch(() => {});
      }
    }, { root: grid, rootMargin: '120px' });
    const frag = document.createDocumentFragment();
    for (const a of list.slice(0, 1500)) {
      const b = document.createElement('button');
      b.className = 'lib-cell' + (S.cur?.id === a.id ? ' on' : '');
      b.dataset.id = a.id;
      b.title = a.id;
      const lab = document.createElement('span');
      lab.textContent = a.name.replace(/\.[^.]+$/, '');
      b.append(lab);
      b.onclick = () => { S.cur = a; for (const el of grid.children) el.classList.toggle('on', el === b); drawPreview(); };
      frag.append(b);
    }
    grid.append(frag);
    for (const el of grid.children) observer.observe(el);
    q('.lb-count').textContent = `${list.length}枚${list.length > 1500 ? '(先頭の 1500枚を表示)' : ''} / 全部で ${S.list.length}枚`;
    q('.lb-del-group').disabled = S.group === '';
  };
  const refresh = async (keepGroup = true) => {
    S.list = await libraryList(true);
    const groups = groupsOf(S.list);
    if (!keepGroup || (S.group !== '' && !groups.some((g) => g === S.group || g.startsWith(S.group + '/')))) S.group = '';
    // 上のフォルダも選べるように("textures" を選ぶと "textures/interior" もふくむ)
    const all = new Set();
    for (const g of groups) { const parts = g.split('/'); for (let i = 1; i <= parts.length; i++) all.add(parts.slice(0, i).join('/')); }
    q('.lb-group').innerHTML = `<option value="">すべてのグループ</option>${[...all].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ja')).map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('')}`;
    q('.lb-group').value = S.group;
    if (S.cur && !S.list.some((a) => a.id === S.cur.id)) S.cur = null;
    drawGrid();
    drawPreview();
  };
  const sync = () => {
    q('.lb-scale').value = S.o.scale; q('.lb-scale-v').textContent = `${Math.round(S.o.scale * 100)}%`;
    q('.lb-seamless').checked = S.o.seamless;
    q('.lb-pixel').value = S.o.pixel;
  };
  const importDone = (r) => { if (!r) return; toast(importSummary(r)); S.group = r.group; refresh(); };
  q('.lb-folder').onclick = async () => { try { importDone(await libraryPickFolder()); } catch (err) { toast('取り込めませんでした: ' + err.message); } };
  q('.lb-files').onclick = async () => { try { importDone(await libraryPickFiles(S.group || undefined)); } catch (err) { toast('取り込めませんでした: ' + err.message); } };
  q('.lb-group').onchange = (e) => { S.group = e.target.value; drawGrid(); };
  q('.lb-search').oninput = () => drawGrid();
  q('.lb-scale').oninput = (e) => { S.o.scale = +e.target.value; q('.lb-scale-v').textContent = `${Math.round(S.o.scale * 100)}%`; drawPreview(); };
  q('.lb-seamless').onchange = (e) => { S.o.seamless = e.target.checked; drawPreview(); };
  q('.lb-pixel').onchange = (e) => { S.o.pixel = Math.min(64, Math.max(1, Math.round(+e.target.value) || 1)); sync(); drawPreview(); };
  q('.lb-del').onclick = async () => { if (!S.cur) return; const id = S.cur.id; S.cur = null; await libraryRemove(id); toast(`ライブラリから消しました: ${id}`); refresh(); };
  q('.lb-del-group').onclick = async () => {
    if (!S.group) return;
    const n = shown().length, g = S.group;
    if (q('.lb-del-group').dataset.sure !== g) { q('.lb-del-group').dataset.sure = g; q('.lb-del-group').textContent = `「${g}」の ${n}枚を消す(もう一度押す)`; return; }
    q('.lb-del-group').dataset.sure = ''; q('.lb-del-group').textContent = 'このグループを消す';
    await libraryRemoveGroup(g);
    toast(`ライブラリから「${g}」を消しました`);
    S.group = '';
    refresh(false);
  };
  q('.lb-place').value = saved.place === 'fill' ? 'fill' : 'one';
  sync();
  refresh();

  const { value } = await openModal({ title: '素材ライブラリ', body, width: 860, buttons: [{ label: '閉じる', value: null }, { label: '置く', value: 'ok', primary: true }] });
  observer?.disconnect();
  last = { ...S.o, group: S.group, place: q('.lb-place').value };
  try { localStorage.setItem(KEY, JSON.stringify(last)); } catch { /* 保存できなくても動く */ }
  if (value !== 'ok') return null;
  if (!S.cur) { toast('素材が選ばれていないので、置きませんでした'); return null; }
  if (!state.doc) return null;
  const r = await placeAsset(S.cur, S.o, { fill: last.place === 'fill' });
  toast(`素材を「${r.layer.name}」に置きました(${r.width}×${r.height})`);
  return r.layer;
}
