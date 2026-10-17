// ファイル入出力。Electron では preload の window.native を使い、
// ブラウザで開いた場合はダウンロード/ファイル選択で代用する。
import { state, emit, toast } from './state.js';
import { serialize, deserialize, createCanvas } from './document.js';
import { embeddedFonts, registerEmbedded } from './fonts.js';
import { flatten } from './render.js';
import { encodeGif } from './gif.js';

const native = window.native || null;
// Kodai のプロジェクトは .kodai(昔の Koneru の .koneru、PixelRig の .prig も開ける)
const PROJECT_FILTER = [{ name: 'Kodai プロジェクト', extensions: ['kodai', 'koneru', 'prig'] }];

export function fileName() {
  return state.filePath ? state.filePath.split(/[\\/]/).pop() : '無題';
}

function baseName() {
  return state.filePath ? fileName().replace(/\.[^.]+$/, '') : 'untitled';
}

// 新しい絵を画面を出さずに保存するときの名前: フォントはフォントの名前、絵は「無題_日付-時刻」
function autoName() {
  if (state.doc?.font?.name) return state.doc.font.name;
  const d = new Date(), z = (n) => String(n).padStart(2, '0');
  return `無題_${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}

function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files[0] || null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export async function saveProject(saveAs = false) {
  const obj = serialize(state.doc);
  const fonts = embeddedFonts(state.doc);
  if (fonts.length) obj.fonts = fonts; // 取り込んだフォントを埋め込む(別のPCでも同じ見た目に)
  const text = JSON.stringify(obj);
  let p = state.filePath, auto = false;
  if (native) {
    // 新しい絵の「保存」: 画面を出さずに、保存のフォルダ(設定で変えられる。lib/savedir.js)へ
    if (!p && !saveAs && native.saveDir) { p = await native.saveDir.autoPath(autoName(), 'kodai'); auto = true; }
    if (!p || saveAs) {
      p = await native.saveDialog({ title: 'プロジェクトを保存', defaultPath: baseName() + '.kodai', filters: [{ name: 'Kodai プロジェクト', extensions: ['kodai'] }] });
      if (!p) return false;
    }
    await native.writeText(p, text);
    state.filePath = p;
  } else {
    const name = baseName() + '.kodai';
    download(name, new Blob([text], { type: 'application/json' }));
    state.filePath = name;
  }
  state.dirty = false;
  emit('title');
  toast(auto ? `保存しました: ${p}` : '保存しました');
  return true;
}

// 読み込んだドキュメントとパスを返す(キャンセル時は null)
export async function openProject() {
  let text, path;
  if (native) {
    path = await native.openDialog({ title: 'プロジェクトを開く', filters: PROJECT_FILTER });
    if (!path) return null;
    text = await native.readText(path);
  } else {
    const file = await pickFile('.kodai,.koneru,.prig,application/json');
    if (!file) return null;
    text = await file.text();
    path = file.name;
  }
  return parseProject(text, path);
}

// パスを指定して開く(ファイルをダブルクリックしたとき)
export async function openProjectPath(path) {
  return parseProject(await native.readText(path), path);
}

async function parseProject(text, path) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('ファイルが壊れているか、形式が正しくありません');
  }
  const doc = await deserialize(obj);
  await registerEmbedded(obj.fonts, doc);
  return { doc, path };
}

// 画像ファイルを選んで ImageBitmap として読み込む → { bitmap, name } / null
export async function pickImage() {
  if (native) {
    const p = await native.openDialog({
      title: '画像を読み込む',
      filters: [{ name: '画像', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] }],
    });
    if (!p) return null;
    const bytes = await native.readBinary(p);
    return { bitmap: await decodeImage(new Blob([bytes])), name: p.split(/[\\/]/).pop() };
  }
  const file = await pickFile('image/*');
  if (!file) return null;
  return { bitmap: await decodeImage(file), name: file.name };
}

export async function decodeImage(blob) {
  try {
    return await createImageBitmap(blob);
  } catch {
    throw new Error('画像を読み込めませんでした(対応形式: PNG / JPEG / GIF / BMP / WebP)');
  }
}

// ブラウザのキャンバスの上限(1辺 32767px・約2.68億ピクセル)
export const MAX_CANVAS_AREA = 268e6;

export async function exportPng(scale) {
  const a = state.doc.artboard;
  if (a.w * a.h * scale * scale > MAX_CANVAS_AREA || Math.max(a.w, a.h) * scale > 32767) {
    throw new Error('書き出しサイズが大きすぎます。倍率を下げてください');
  }
  const canvas = flatten(state.doc, scale);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  const name = baseName() + (scale > 1 ? `@${scale}x` : '') + '.png';
  if (native) {
    const p = await native.saveDialog({ title: 'PNG書き出し', defaultPath: name, filters: [{ name: 'PNG画像', extensions: ['png'] }] });
    if (!p) return false;
    await native.writeBinary(p, new Uint8Array(await blob.arrayBuffer()));
  } else {
    download(name, blob);
  }
  toast('PNGを書き出しました');
  return true;
}

// バイナリを保存(Electron はダイアログ、ブラウザはダウンロード)。キャンセルなら false
export async function saveBinary(title, name, ext, label, blob) {
  if (native) {
    const p = await native.saveDialog({ title, defaultPath: name, filters: [{ name: label, extensions: [ext] }] });
    if (!p) return false;
    await native.writeBinary(p, new Uint8Array(await blob.arrayBuffer()));
  } else {
    download(name, blob);
  }
  return true;
}

// ---- アニメーション書き出し ----

export async function exportGif(scale, loop) {
  const doc = state.doc;
  const a = doc.artboard;
  if (a.w * a.h * scale * scale * doc.frames.length > 400e6) {
    throw new Error('GIFが大きすぎます。倍率を下げるかフレーム数を減らしてください');
  }
  toast('GIFを作成中…');
  await new Promise((r) => setTimeout(r, 30)); // トーストを表示させる
  const frames = doc.frames.map((f, i) => {
    const c = flatten(doc, scale, a, i);
    return { img: c.getContext('2d').getImageData(0, 0, c.width, c.height), delay: f.duration };
  });
  const bytes = encodeGif(frames, { loop: loop ? 0 : 1 });
  const ok = await saveBinary('GIF書き出し', baseName() + (scale > 1 ? `@${scale}x` : '') + '.gif', 'gif', 'GIF画像', new Blob([bytes], { type: 'image/gif' }));
  if (ok) toast('GIFを書き出しました');
  return ok;
}

// 全フレームを格子状に並べた PNG。columns=0 なら横一列。json=true なら位置と時間の JSON も保存
export async function exportSpriteSheet(scale, columns, json) {
  const doc = state.doc;
  const a = doc.artboard;
  const n = doc.frames.length;
  const cols = columns > 0 ? Math.min(columns, n) : n;
  const rows = Math.ceil(n / cols);
  const fw = Math.round(a.w * scale), fh = Math.round(a.h * scale);
  const W = fw * cols, H = fh * rows;
  if (W * H > MAX_CANVAS_AREA || W > 32767 || H > 32767) {
    throw new Error('スプライトシートが大きすぎます。倍率か列数を調整してください');
  }
  const sheet = createCanvas(W, H);
  const ctx = sheet.getContext('2d');
  const meta = { frames: [], meta: { app: 'Kodai', size: { w: W, h: H }, frameSize: { w: fw, h: fh }, scale } };
  doc.frames.forEach((f, i) => {
    const x = (i % cols) * fw, y = Math.floor(i / cols) * fh;
    ctx.drawImage(flatten(doc, scale, a, i), x, y);
    meta.frames.push({ index: i, x, y, w: fw, h: fh, duration: f.duration });
  });
  const blob = await new Promise((r) => sheet.toBlob(r, 'image/png'));
  const name = baseName() + '_sheet' + (scale > 1 ? `@${scale}x` : '');
  if (!(await saveBinary('スプライトシート書き出し', name + '.png', 'png', 'PNG画像', blob))) return false;
  if (json) {
    const jb = new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' });
    await saveBinary('スプライトシートの情報(JSON)', name + '.json', 'json', 'JSON', jb);
  }
  toast('スプライトシートを書き出しました');
  return true;
}
