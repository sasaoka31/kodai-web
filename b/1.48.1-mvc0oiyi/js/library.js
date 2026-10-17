// 素材ライブラリ(画面側)
//   ユーザーが取り込んだ画像(テクスチャ・素材)を一覧し、大きさ・継ぎ目・ドット化を整えて、ラスターレイヤーに置く。
//   ファイルの置き場所と取り込みはメインプロセス(lib/library.js。<userData>/library)。ここは読む・加工する・置く
import { decodeImage } from './io.js';

const native = () => window.native?.library;
export const libraryAvailable = () => !!native();

let cache = null; // [{ id, group, name, size, mtime }]
export async function libraryList(refresh = false) {
  if (!native()) return [];
  if (!cache || refresh) cache = await native().list();
  return cache;
}
export const libraryChanged = () => { cache = null; bitmaps.clear(); };

// 名前から素材を探す: id そのまま / ファイル名(拡張子あり・なし)。同じ名前がいくつもあれば、全部返す
export async function libraryFind(name) {
  const list = await libraryList();
  const key = String(name || '').replace(/\\/g, '/');
  const exact = list.filter((a) => a.id === key);
  if (exact.length) return exact;
  const base = key.split('/').pop().toLowerCase();
  const byName = list.filter((a) => a.name.toLowerCase() === base || a.name.toLowerCase().replace(/\.[^.]+$/, '') === base);
  // "interior/wall" のように、後ろの方だけ書いたとき
  const tail = byName.filter((a) => a.id.toLowerCase().replace(/\.[^.]+$/, '').endsWith(key.toLowerCase().replace(/\.[^.]+$/, '')));
  return tail.length ? tail : byName;
}

const bitmaps = new Map(); // id → ImageBitmap(最近使った分だけ)
export async function libraryBitmap(id) {
  if (bitmaps.has(id)) return bitmaps.get(id);
  const bmp = await decodeImage(new Blob([await native().read(id)]));
  if (bitmaps.size > 4) bitmaps.delete(bitmaps.keys().next().value);
  bitmaps.set(id, bmp);
  return bmp;
}

// 小さい絵(一覧用)。長い辺 size px
export async function libraryThumb(id, size = 96) {
  // 一覧では何十枚も読むので、大きい絵を取っておかない(描いたら捨てる)
  const keep = bitmaps.get(id), bmp = keep || await decodeImage(new Blob([await native().read(id)]));
  const k = Math.min(1, size / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  const x = c.getContext('2d');
  x.imageSmoothingQuality = 'high';
  x.drawImage(bmp, 0, 0, c.width, c.height);
  if (!keep) bmp.close?.();
  return c;
}

// 加工の値をそろえる。width / height = 仕上がりの大きさ(片方だけなら縦横比を保つ)、scale = 倍率(width がないとき)
export function assetOptions(o = {}, bmp = null) {
  const num = (v, d) => (Number.isFinite(+v) && v !== null && v !== '' ? +v : d);
  const out = { scale: Math.min(8, Math.max(0.01, num(o.scale, 1))), seamless: !!o.seamless, blend: Math.min(0.5, Math.max(0.02, num(o.blend, 0.12))), pixel: Math.min(64, Math.max(1, Math.round(num(o.pixel, 1)))) };
  if (bmp) {
    let w = num(o.width, 0), h = num(o.height, 0);
    if (w > 0 && !(h > 0)) h = (bmp.height * w) / bmp.width;
    else if (h > 0 && !(w > 0)) w = (bmp.width * h) / bmp.height;
    else if (!(w > 0)) { w = bmp.width * out.scale; h = bmp.height * out.scale; }
    const k = Math.min(1, 4096 / Math.max(w, h));
    out.width = Math.max(1, Math.round(w * k));
    out.height = Math.max(1, Math.round(h * k));
  }
  return out;
}

// 継ぎ目をなじませる: 右と下のふち(blend の割合)を、反対側のふちに重ねて少しずつ混ぜる。仕上がりはその分だけ小さくなる
export function makeSeamless(img, blend = 0.12) {
  const W = img.width, H = img.height, d = img.data;
  const mx = Math.max(1, Math.min(W >> 1, Math.round(W * blend))), my = Math.max(1, Math.min(H >> 1, Math.round(H * blend)));
  const w = W - mx, h = H - my;
  if (w < 2 || h < 2) return img;
  // 横
  const a = new Uint8ClampedArray(w * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4, s = (y * W + x) * 4;
    if (x < mx) {
      const t = (x + 0.5) / mx, r = (y * W + x + w) * 4;
      for (let k = 0; k < 4; k++) a[o + k] = d[r + k] * (1 - t) + d[s + k] * t;
    } else for (let k = 0; k < 4; k++) a[o + k] = d[s + k];
  }
  // 縦
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4, s = (y * w + x) * 4;
    if (y < my) {
      const t = (y + 0.5) / my, r = ((y + h) * w + x) * 4;
      for (let k = 0; k < 4; k++) out[o + k] = a[r + k] * (1 - t) + a[s + k] * t;
    } else for (let k = 0; k < 4; k++) out[o + k] = a[s + k];
  }
  return new ImageData(out, w, h);
}

// 素材の絵 → 置く絵(ImageData)。大きさ → 継ぎ目 → ドット化 の順
export function processAsset(bmp, opts = {}) {
  const o = assetOptions(opts, bmp);
  const c = document.createElement('canvas');
  c.width = o.width; c.height = o.height;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingQuality = 'high';
  x.drawImage(bmp, 0, 0, o.width, o.height);
  let img = x.getImageData(0, 0, o.width, o.height);
  if (o.seamless) img = makeSeamless(img, o.blend);
  if (o.pixel > 1) {
    // ドット絵風: マスの真ん中の色で塗る(並べてもずれないように、マスの数は切り上げ)
    const W = img.width, H = img.height, P = o.pixel, src = img.data, out = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      const sy = Math.min(H - 1, Math.floor(y / P) * P + (P >> 1));
      for (let xx = 0; xx < W; xx++) {
        const sx = Math.min(W - 1, Math.floor(xx / P) * P + (P >> 1));
        out.set(src.subarray((sy * W + sx) * 4, (sy * W + sx) * 4 + 4), (y * W + xx) * 4);
      }
    }
    img = new ImageData(out, W, H);
  }
  return img;
}

// 取り込み(ダイアログから)。戻り値はメインの結果({ group, total, added, updated, same, big })/ やめたら null
export async function libraryPickFolder(group) { const r = await native().pickFolder(group); if (r) libraryChanged(); return r; }
export async function libraryPickFiles(group) { const r = await native().pickFiles(group); if (r) libraryChanged(); return r; }
// Claude 連携から(道具で許可したフォルダ)
export async function libraryImportFolder(folder, group) { const r = await native().importFolder(folder, group); libraryChanged(); return r; }
export async function libraryRemove(id) { await native().remove(id); libraryChanged(); }
export async function libraryRemoveGroup(group) { await native().removeGroup(group); libraryChanged(); }

export const importSummary = (r) => `「${r.group}」に取り込みました: 新しく ${r.added}枚、更新 ${r.updated}枚、変わりなし ${r.same}枚${r.big?.length ? `、大きすぎて入れなかった ${r.big.length}枚` : ''}${r.limit ? '(枚数の上限に達しました)' : ''}`;
