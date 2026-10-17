// Web 版(iPad など、ブラウザで開く版)だけの部品。scripts/build-web.js が index.html に差し込む。
// Windows 版(Electron)では読み込まれない。メニューバーとキーボードの代わりを画面に出す
import { state, emit, toast } from './js/state.js';

const html = document.documentElement;
document.body.classList.add('web');
state.appVersion = html.dataset.version || '';
emit('title');

// Safari がページごと拡大・縮小するのを止める(キャンバスの2本指の操作は app.js が受ける)
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, (e) => e.preventDefault());

// ---- メニュー(Windows 版のメニューバーにあって、上のボタンにないもの) ----

const MENU = [
  ['タブ'],
  ['nextTab', '次のタブ'], ['prevTab', '前のタブ'], ['closeTab', 'このタブを閉じる'],
  ['編集'],
  ['copy', 'コピー'], ['cut', 'カット'], ['paste', 'ペースト'], ['pasteInPlace', '同じ位置にペースト'],
  ['selectAll', 'すべて選択'], ['group', 'グループ化'], ['ungroup', 'グループ解除'],
  ['outlineStroke', 'パスのアウトライン化(線 → 塗り)'], ['makeBorder', '縁取りを作成…'], ['swapColors', 'メイン / サブカラー入れ替え'],
  ['ドット絵(ラスターレイヤー)'],
  ['pixelOutline', '輪郭を付ける'], ['pixelShade', '陰影を付ける(左上から光)'], ['pixelMirror', '左右対称にする(左半分 → 右)'],
  ['pixelReduce8', '色を 8色に減らす'], ['pixelReduce16', '色を 16色に減らす'],
  ['表示'],
  ['zoom100', '100%'], ['onion', 'オニオンスキン'],
  ['作る・見た目'],
  ['icons', 'アイコン…'], ['layout', 'レイアウト(ボタンの位置)'], ['panels', '右のパネルの並び…'], ['design', '色とデザイン…'], ['charm', 'チャーム(ボタンの絵)…'],
  ['ヘルプ'],
  ['manual', '取扱説明書'],
];

const menuBtn = document.createElement('button');
menuBtn.id = 'btn-web-menu';
menuBtn.textContent = 'メニュー ▾';
document.querySelector('#topbar .group').append(menuBtn);

function closeMenu() {
  document.getElementById('web-menu')?.remove();
  document.removeEventListener('pointerdown', outside, true);
}
function outside(e) {
  if (!e.target.closest('#web-menu') && e.target !== menuBtn) closeMenu();
}
menuBtn.onclick = () => {
  if (document.getElementById('web-menu')) { closeMenu(); return; }
  const m = document.createElement('div');
  m.id = 'web-menu';
  for (const [action, label] of MENU) {
    if (label === undefined) {
      const h = document.createElement('div');
      h.className = 'wm-head';
      h.textContent = action;
      m.append(h);
      continue;
    }
    const b = document.createElement('button');
    if (action === 'manual') { b.onclick = () => window.open(new URL('manual.html', document.baseURI).href, '_blank'); b.textContent = label; m.append(b); continue; }
    b.dataset.action = action; // 押したときの中身は app.js(data-action のボタンをまとめて受けている)
    b.textContent = label;
    m.append(b);
  }
  const ver = document.createElement('div');
  ver.className = 'wm-ver';
  ver.textContent = `Kodai Web 版 v${html.dataset.version}(${html.dataset.build})`;
  m.append(ver);
  m.addEventListener('click', (e) => { if (e.target.closest('button')) setTimeout(closeMenu); });
  const r = menuBtn.getBoundingClientRect();
  m.style.left = `${r.left}px`;
  m.style.top = `${r.bottom + 4}px`;
  document.body.append(m);
  document.addEventListener('pointerdown', outside, true);
};

// ---- キーの代わり(パスの確定・自由変形の確定など、Enter / Esc / Delete で行う操作) ----

const keys = document.createElement('div');
keys.id = 'web-keys';
for (const [key, code, label, title] of [
  ['Enter', 'Enter', '確定', 'Enter: パス・自由変形を確定'],
  ['Escape', 'Escape', 'やめる', 'Esc: 作りかけをやめる・選択を外す'],
  ['Delete', 'Delete', '削除', 'Delete: 選んだ図形・点を削除'],
]) {
  const b = document.createElement('button');
  b.textContent = label;
  b.title = title;
  b.onclick = () => window.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true }));
  keys.append(b);
}
document.getElementById('canvas-area').append(keys);

// ---- オフライン対応(Kaiju と同じ。web/sw.js): 1回開くと、中身を端末に取っておく。次からは、ネットがなくても起動できる ----
if ('serviceWorker' in navigator && html.dataset.build) {
  navigator.serviceWorker.register(new URL('sw.js', location.href).href).then(() => navigator.serviceWorker.ready).then(() => {
    let told = null;
    try { told = localStorage.getItem('kodai.offline'); } catch { /* 覚えられなくても続ける */ }
    if (!told) { toast('この端末に取っておきました。次からは、ネットにつながっていなくても開けます'); try { localStorage.setItem('kodai.offline', '1'); } catch { /* 同上 */ } }
  }).catch(() => { /* 取っておけなくても、ネットがあれば使える */ });
}
