// アプリ全体の状態と簡易イベントバス
import { History } from './history.js';

const listeners = {};

export function on(evt, fn) {
  (listeners[evt] ||= []).push(fn);
}

export function emit(evt, ...args) {
  for (const fn of listeners[evt] || []) fn(...args);
}

export const state = {
  doc: null,
  history: new History(),
  view: null,
  tool: 'pen',
  primary: { r: 0, g: 0, b: 0, a: 255 },
  secondary: { r: 255, g: 255, b: 255, a: 255 },
  opts: {
    size: {
      pen: { pixel: 1, illust: 6 },
      eraser: { pixel: 1, illust: 20 },
    },
    strokeWidth: { pixel: 1, illust: 4 },
    tolerance: 32, // バケツ: 色の許容
    fillGap: 10, // バケツの隙間閉じ(px。0 = なし)。線の切れ目がこれより狭ければ、そこからもれない
    fillExpand: 2, // バケツの「線へのはみ出し」(px)。塗る範囲をこれだけ広げて、線の下にもぐらせる
    fillRef: 'canvas', // バケツが境目にする絵: 'canvas'(見えている絵ぜんぶ)| 'layer'(今のレイヤーだけ)
    contiguous: true,
    shapeStroke: true,
    shapeFill: false,
    polygonSides: 3, // 多角形ツールの角の数
    sampleMerged: true,
    showGrid: true,
    loop: true,
    onion: { enabled: false, prev: 1, next: 1, opacity: 0.45 },
    rigMode: 'bone', // 'bone' | 'pose' | 'lattice'
  },
  playing: false,
  rigSel: null, // 選択中のボーン id
  rigDragging: false,
  filePath: null,
  dirty: false,
  preview: null, // 描画中のプレビュー(確定前のストロークなど)
  selection: null, // { layerId, index } ベクター図形の選択
  pathDraft: null, // パスツールで作成中のパス
  transform: null, // 自由変形ツールで変形中の対象
  cursor: null, // ドキュメント座標のマウス位置
  lastPoint: null, // Shift+クリックで直線を引くための前回終点
};

export function requestRender() {
  state.view?.requestRender();
}

export function toast(msg) {
  emit('toast', msg);
}

export const isPixelMode = () => state.doc?.mode === 'pixel';
export const modeKey = () => (isPixelMode() ? 'pixel' : 'illust');
