// 上のバーと左のツールバーに置けるものの一覧(レイアウトで自由に並べる。barlayout.js)。
//   ツール(icons.js の TOOL_DEFS。矢印ボタンの中のダイレクト選択は、矢印といっしょ)+ ボタン(id は app.js のアクション名)+ 区切りの線。
//   text = ボタンの文字、label = 箱に出す名前(なければ text)、hint = 説明、id = 前からあるボタンの id(ほかの所がこの名前で探す)
// 並びは prefs.topbar / prefs.toolbar(このPCに保存)。**新しいボタンを足すときは、ここに入れれば、レイアウトの箱に出る**
import { TOOL_DEFS } from './icons.js';

const TOOLS = Object.fromEntries(TOOL_DEFS.filter((t) => !t.group).map((t) => [t.id, { tool: true, label: t.label.replace(/\s*[(（].*$/, ''), hint: t.label, key: t.key }]));

const BUTTONS = {
  new: { text: '新規', hint: '新規作成 (Ctrl+N)' },
  open: { text: '開く', hint: '開く (Ctrl+O)' },
  save: { text: '保存', hint: '保存 (Ctrl+S)' },
  importImage: { text: '画像読込', hint: '画像を読み込む (Ctrl+I) — ウィンドウへのドラッグ&ドロップでも可' },
  makeMenu: { text: '作る ▾', label: '作る(メニュー)', id: 'btn-make', hint: 'キャラ・テクスチャ・テロップ(文字のアニメーション)などを作る' },
  fontMode: { text: 'フォント作成', hint: '自分でフォントを作るモード(今の絵は取っておきます)' },
  export: { text: 'PNG書き出し', hint: 'PNG書き出し (Ctrl+Shift+E)' },
  docSettings: { text: '設定', hint: 'アートボードのサイズ・背景色・操作の設定' },
  undo: { text: '↶', label: '元に戻す', id: 'btn-undo', cls: 'icon-text', hint: '元に戻す (Ctrl+Z)' },
  redo: { text: '↷', label: 'やり直し', id: 'btn-redo', cls: 'icon-text', hint: 'やり直し (Ctrl+Y)' },
  // ここから下は、はじめは並んでいない(レイアウトで足せる)
  saveAs: { text: '別名で保存', hint: '名前を付けて保存 (Ctrl+Shift+S)' },
  trace: { text: 'トレース', hint: '今のレイヤーの画像の色の境目をなぞって、線のパスにする' },
  exportGif: { text: 'GIF書き出し', hint: 'アニメーションGIFとして書き出し' },
  exportSheet: { text: 'スプライトシート', hint: '全フレームを1枚に並べたPNG' },
  charPaint: { text: 'キャラ(面塗り)', hint: 'キャラを作る(面塗り・パス)' },
  character: { text: 'キャラ(64×64)', hint: 'かわいいドット絵キャラを作る' },
  texture: { text: 'テクスチャ', hint: '石畳・レンガ・草・木目などを作る(継ぎ目なし)' },
  library: { text: '素材ライブラリ', hint: '取り込んだ画像(テクスチャ・素材)を置く' },
  icons: { text: 'アイコン', hint: '歯車・ペン・スパナなどのアイコン(編集できるパス)を置く' },
  design: { text: '色とデザイン', hint: '画面の色合い・バーとパネルの色・素材・スライダーの形' },
  charm: { text: 'チャーム', hint: 'ボタンの絵を自分の画像に変える・スライダーのつまみの絵' },
  panels: { text: '右のパネル', label: '右のパネルの並び', hint: '右のパネルの並び順と、出す / 出さない' },
  telop: { text: 'テロップ', hint: '文字のアニメーション(APNG / GIF)を作る' },
  solid: { text: '立体にする', hint: '今の絵を荒いポリゴンの立体にする(.glb)' },
  effects: { text: '効果', label: 'エフェクト', hint: 'エフェクト(オーラ・炎など)を今のレイヤーに付ける' },
  claude: { text: 'Claude 連携', hint: 'Claude から Kodai を使う設定' },
  copy: { text: 'コピー', hint: 'コピー (Ctrl+C)' },
  cut: { text: 'カット', hint: 'カット (Ctrl+X)' },
  paste: { text: 'ペースト', hint: 'ペースト (Ctrl+V)' },
  pasteInPlace: { text: '同じ位置にペースト', hint: '同じ位置にペースト (Ctrl+Shift+V)' },
  selectAll: { text: 'すべて選択', hint: 'すべて選択 (Ctrl+A)' },
  group: { text: 'グループ化', hint: 'グループ化 (Ctrl+G)' },
  ungroup: { text: 'グループ解除', hint: 'グループ解除 (Ctrl+Shift+G)' },
  deleteSelection: { text: '図形を削除', hint: '選んだ図形を削除 (Delete)' },
  outlineStroke: { text: 'アウトライン化', hint: 'パスのアウトライン化(線 → 塗り) (Ctrl+Shift+O)' },
  makeBorder: { text: '縁取り', hint: '選んだ図形全体の外形に縁取りを作る (Ctrl+Shift+B)' },
  swapColors: { text: '色の入れ替え', hint: 'メイン / サブカラー入れ替え (X)' },
  addRaster: { text: '＋ラスター', hint: 'ラスターレイヤーを追加' },
  addVector: { text: '＋ベクター', hint: 'ベクターレイヤーを追加' },
  dupLayer: { text: 'レイヤー複製', hint: 'レイヤーを複製' },
  mergeDown: { text: 'レイヤー結合', hint: '下のレイヤーと結合' },
  pixelOutline: { text: 'ドットに輪郭', hint: 'ドット絵(ラスターレイヤー)に輪郭を付ける' },
  pixelShade: { text: 'ドットに陰影', hint: 'ドット絵(ラスターレイヤー)に陰影を付ける(左上から光)' },
  pixelMirror: { text: '左右対称', hint: 'ドット絵(ラスターレイヤー)を左右対称にする(左半分 → 右)' },
  zoom100: { text: '100%', label: '100% で表示', hint: '100% で表示 (Ctrl+1)' },
  togglePlay: { text: '▶ 再生', label: '再生 / 停止', hint: 'アニメーションの再生 / 停止 (Enter)' },
  repeat: { text: 'くり返し', label: '変形のくり返し', hint: '直前の移動・拡大縮小・回転・反転をもう一度 (Ctrl+D)。複製しながら動かしたあとなら、同じだけずらして複製' },
  bringFront: { text: '最前面へ', hint: '選んだ図形をいちばん上へ (Ctrl+Shift+])' },
  bringForward: { text: '前面へ', hint: '1つ上へ (Ctrl+])' },
  sendBackward: { text: '背面へ', hint: '1つ下へ (Ctrl+[)' },
  sendBack: { text: '最背面へ', hint: '選んだ図形をいちばん下へ (Ctrl+Shift+[)' },
  rulers: { text: '定規', label: '定規の表示', hint: '定規の表示 / 非表示 (Ctrl+R)。定規からドラッグでガイド' },
  guides: { text: 'ガイド', label: 'ガイドの表示', hint: 'ガイドの表示 / 非表示' },
};

export const ITEMS = { ...TOOLS, ...BUTTONS, sep: { sep: true, label: '区切りの線' } };

export const DEFAULT_TOPBAR = ['new', 'open', 'save', 'importImage', 'makeMenu', 'fontMode', 'export', 'docSettings', 'sep', 'undo', 'redo'];
export const DEFAULT_TOOLBAR = Object.keys(TOOLS);

// 保存してあった並びから、もうないものを除く(版が変わってボタンがなくなったときのため)
export const cleanBar = (list, def) => (Array.isArray(list) ? list.filter((id) => ITEMS[id]) : [...def]);
