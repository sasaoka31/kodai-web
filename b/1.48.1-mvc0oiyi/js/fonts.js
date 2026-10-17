// フォントの一覧と読み込み(画面側)
//   ・Kodai のフォント: 商用利用できる Google Fonts(OFL)。使うときに初めてダウンロード(lib/fonts.js)
//   ・取り込んだフォント: 自分で追加したファイル・フォント作成で作ったフォント(アプリに保存)
//   このPCにインストールされたフォントは一覧に出さない(商用利用できるか分からないため)
//   ファイルに埋め込まれたフォント(取り込んだフォントを使って保存したもの)も開くときに登録する
import { state, emit, requestRender, toast } from './state.js';
import { fontsChanged, DEFAULT_FAMILY } from './text.js';

const bytesOf = new Map(); // family → Uint8Array(取り込んだ・埋め込まれたフォント。保存時に埋め込む)
const loaded = new Set(); // 登録済みの family
let imported = []; // [{ id, family }]
let builtin = []; // [{ id, family, label, size, ready }]
const pending = new Map(); // family → Promise(ダウンロード中)

const native = () => window.native?.fonts;

// 太さを変えられるフォント(可変フォント)。太さの範囲つきで登録すると、100〜900 がそのまま効く(テロップの「太さ」)
const VARIABLE = new Set(['Noto Sans JP', 'Noto Serif JP']);

const faces = new Map(); // family → FontFace(作り直したフォントを入れ替えるときに外す)
async function registerBytes(family, bytes, embed = true) {
  if (loaded.has(family)) return;
  const face = new FontFace(family, bytes, VARIABLE.has(family) ? { weight: '100 900' } : {});
  await face.load();
  document.fonts.add(face);
  faces.set(family, face);
  loaded.add(family);
  if (embed) bytesOf.set(family, new Uint8Array(bytes));
}

function afterFontsChange() {
  fontsChanged();
  // 文字のあるレイヤーのキャッシュを作り直す
  for (const l of state.doc?.layers || []) if (l.type === 'vector') for (const c of l.cels) if (c) c.version++;
  requestRender();
  emit('fonts');
}

export async function initFonts() {
  document.fonts.addEventListener('loadingdone', afterFontsChange);
  const n = native();
  if (n) {
    try {
      builtin = await n.builtin();
      for (const f of builtin) if (f.ready) await registerBytes(f.family, await n.builtinRead(f.id), false).catch(() => {});
      imported = await n.list();
      for (const f of imported) await registerBytes(f.family, await n.read(f.id)).catch(() => {});
    } catch (err) { console.warn(err); }
  }
  afterFontsChange();
}

export const fontLists = () => ({
  builtin: builtin.map((f) => ({ family: f.family, label: f.label, ready: f.ready })),
  imported: imported.map((f) => f.family),
});
export const isImported = (family) => bytesOf.has(family);
export const isLoaded = (family) => loaded.has(family);

// Kodai のフォントなら、まだなければダウンロードして使えるようにする
export function ensureFamily(family) {
  if (loaded.has(family)) return Promise.resolve(true);
  const f = builtin.find((x) => x.family === family);
  const n = native();
  if (!f || !n) return Promise.resolve(false);
  if (pending.has(family)) return pending.get(family);
  const p = (async () => {
    if (!f.ready) {
      toast(`フォント「${f.family}」をダウンロードしています(初回のみ・${(f.size / 1048576).toFixed(1)}MB)…`);
      const off = n.onProgress((q) => { if (q.id === f.id && q.got < q.total) toast(`フォント「${f.family}」をダウンロード中… ${Math.round((q.got / q.total) * 100)}%`); });
      try { await n.builtinEnsure(f.id); } finally { off(); }
      f.ready = true;
    }
    await registerBytes(f.family, await n.builtinRead(f.id), false);
    afterFontsChange();
    return true;
  })().catch((err) => { toast(err.message); return false; }).finally(() => pending.delete(family));
  pending.set(family, p);
  return p;
}

export async function importFontFiles() {
  const n = native();
  if (!n) { toast('フォントの追加はアプリ版(exe)だけで使えます'); return []; }
  const added = await n.import();
  for (const f of added) await registerBytes(f.family, await n.read(f.id));
  imported = await n.list();
  if (added.length) toast(`フォントを追加しました: ${added.map((f) => f.family).join('、')}(商用利用できるか配布元の条件を確認してください)`);
  afterFontsChange();
  return added;
}

// 作ったフォント(OTF のバイト列)をアプリに入れて、すぐ文字ツールで使えるようにする
// project = フォント作成モードの作業ファイル(JSON の文字列)。渡すと、あとで「作ったフォントを開いて直す」ができ、
// 同じ名前でもう一度入れたときは、番号の付いた別のフォントにならずに置き換わる
export async function installFont(name, bytes, project = null) {
  const n = native();
  const f = n ? await n.install(name, bytes, '.otf', project) : { family: name };
  if (faces.has(f.family)) { document.fonts.delete(faces.get(f.family)); faces.delete(f.family); }
  loaded.delete(f.family);
  bytesOf.delete(f.family);
  await registerBytes(f.family, bytes);
  if (n) imported = await n.list();
  afterFontsChange();
  return f.family;
}

// 作ったフォントの作業ファイル(アプリに追加したときに一緒に取ってあるもの)
export async function fontProjects() { const n = native(); return n?.projects ? n.projects() : []; }
export async function readFontProject(family) { return native().projectRead(family); }
// 取り込んだフォントのバイト列(輪郭を読み込んで直すとき)
export async function importedFontBytes(family) {
  if (bytesOf.has(family)) return bytesOf.get(family);
  const f = imported.find((x) => x.family === family);
  if (!f) throw new Error(`フォント「${family}」が見つかりません`);
  return new Uint8Array(await native().read(f.id));
}

// ---- ファイルへの埋め込み ----

function usedFamilies(doc) {
  const out = new Set();
  const walk = (s) => { if (s.type === 'group') s.children.forEach(walk); else if (s.type === 'text') out.add(s.family); };
  for (const l of doc.layers) if (l.type === 'vector') for (const c of l.cels) if (c) c.shapes.forEach(walk);
  return out;
}

const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (str) => Uint8Array.from(atob(str), (ch) => ch.charCodeAt(0));

// 保存するとき: 使っている取り込みフォントを入れる(別のPCでも同じ見た目で開けるように)。
// Kodai のフォントは入れない(どの Kodai でもダウンロードできるため)
export function embeddedFonts(doc) {
  return [...usedFamilies(doc)].filter((f) => bytesOf.has(f)).map((family) => ({ family, data: b64(bytesOf.get(family)) }));
}

// 開くとき: 埋め込まれたフォントを登録し、使っている Kodai のフォントを用意する
export async function registerEmbedded(list, doc = null) {
  if (Array.isArray(list)) {
    for (const f of list) {
      if (typeof f?.family !== 'string' || typeof f.data !== 'string') continue;
      await registerBytes(f.family, unb64(f.data)).catch(() => {});
    }
  }
  afterFontsChange();
  if (doc) for (const fam of usedFamilies(doc)) ensureFamily(fam);
}
