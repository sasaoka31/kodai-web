// 操作の設定(このPCに保存。ファイルには入らない)。上の「設定」の「操作」で変える
//   selectNew     : 図形を作ったらその図形を選ぶ(四角・楕円・直線・多角形・パス。ペンの線は選ばない)
//   pasteDx/Dy    : Ctrl+V で貼るときにずらす量(px)。0,0 = コピーした図形と同じ位置
//   outlineDetail : ドット化した図形のアウトライン化の細かさ 'exact'(正確)| 'rough'(ざっくり: アンカーポイントを少なく)
//   showColorPair : カラーパネルにメイン / サブの色(2色の四角)を出す(既定は出さない)
//   topbar / toolbar : 上のバー・左のツールバーに並べるもの(baritems.js の ITEMS の id。レイアウトで変える。barlayout.js)
//   barKnown      : 並びを保存したときにあったものの id(あとの版で増えたツールを、足すため)
import { ITEMS, DEFAULT_TOPBAR, DEFAULT_TOOLBAR, cleanBar } from './baritems.js';

const KEY = 'pixelrig.prefs';
const DEFAULTS = { selectNew: true, pasteDx: 0, pasteDy: 0, outlineDetail: 'exact', showColorPair: false, topbar: null, toolbar: null, barKnown: null };

export const prefs = { ...DEFAULTS };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(KEY)) || {}); } catch { /* 保存なし */ }
prefs.topbar = cleanBar(prefs.topbar, DEFAULT_TOPBAR);
prefs.toolbar = cleanBar(prefs.toolbar, DEFAULT_TOOLBAR);
// 並びを保存したあとの版で増えたツールは、ツールバーのうしろへ足す(箱に入ったままで、気づかれないのを防ぐ)
if (Array.isArray(prefs.barKnown)) {
  for (const id of DEFAULT_TOOLBAR) if (!prefs.barKnown.includes(id) && !prefs.toolbar.includes(id) && !prefs.topbar.includes(id)) prefs.toolbar.push(id);
}

export function savePrefs(patch) {
  Object.assign(prefs, patch);
  if (patch.topbar || patch.toolbar) prefs.barKnown = Object.keys(ITEMS);
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* 保存できなくても動く */ }
}
