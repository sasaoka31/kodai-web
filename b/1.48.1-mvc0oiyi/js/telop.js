// テロップ(文字のアニメーション)を作る。「戦闘開始」のカットイン・場所や時間の字幕・長めの文章など
//   drawTelop(ctx, o, t) で t 秒目の絵を描く(画面のプレビュー・書き出し・Claude 連携の全部がこれを使う)
//   しくみ: 1文字ずつ、装飾(光彩・影・縁取り・塗り)つきの小さな絵(スプライト)にしておき、
//          時間ごとに 位置・大きさ・回転・濃さ・ぼかし を変えて並べる。全体の動き(叩きつけ・ワイプなど)は並べた絵にかける
//   時間の流れ: 開始前の空白 → 登場 → 表示 → 退場(なしにもできる)→ 終了後の空白
import { createCanvas } from './document.js';
import { parseHex } from './color.js';

// ---- 選べるもの ----

// 文字の装飾(お手本)。fill2 があると上 → 下のグラデーション
export const TELOP_STYLES = {
  whiteBlack: { label: '白+黒縁', fill: '#ffffff', stroke: '#000000', strokeW: 0.09, shadow: '#000000', shadowA: 0.6, shadowBlur: 0.08, shadowY: 0.05 },
  gold: { label: '金', fill: '#fff6c0', fill2: '#d99a1c', stroke: '#5a3206', strokeW: 0.07, shadow: '#000000', shadowA: 0.6, shadowBlur: 0.08, shadowY: 0.05, glow: '#ffd866', glowA: 0.45, glowBlur: 0.2 },
  silver: { label: '銀', fill: '#ffffff', fill2: '#9aa6b8', stroke: '#2a3140', strokeW: 0.07, shadow: '#000000', shadowA: 0.6, shadowBlur: 0.08, shadowY: 0.05 },
  blood: { label: '血', fill: '#ff5a4a', fill2: '#8a0c12', stroke: '#1e0204', strokeW: 0.08, shadow: '#000000', shadowA: 0.7, shadowBlur: 0.1, shadowY: 0.06, glow: '#ff2020', glowA: 0.35, glowBlur: 0.25 },
  neon: { label: 'ネオン', fill: '#ffffff', stroke: '#37e0ff', strokeW: 0.04, glow: '#22c8ff', glowA: 0.9, glowBlur: 0.3 },
  purple: { label: '怪しい紫', fill: '#f0d8ff', fill2: '#9a4be0', stroke: '#22083a', strokeW: 0.07, glow: '#b060ff', glowA: 0.6, glowBlur: 0.3 },
  pop: { label: 'ポップ', fill: '#ffe84a', fill2: '#ff8a2a', stroke: '#ffffff', strokeW: 0.07, stroke2: '#e02a6a', stroke2W: 0.16, shadow: '#000000', shadowA: 0.35, shadowBlur: 0, shadowY: 0.08 },
  ghost: { label: 'ゴースト', fill: '#dff6ff', fillA: 0.75, glow: '#bfeaff', glowA: 0.8, glowBlur: 0.35 },
  ink: { label: '墨(明るい背景用)', fill: '#1a1a1a', shadow: '#000000', shadowA: 0.25, shadowBlur: 0.1, shadowY: 0.04 },
  hollow: { label: '白抜き', fill: '#ffffff', fillA: 0, stroke: '#ffffff', strokeW: 0.05, shadow: '#000000', shadowA: 0.5, shadowBlur: 0.08, shadowY: 0.04 },
};

// 登場・退場の動き。char = 1文字ずつ、whole = 全体
export const TELOP_ENTER = {
  fade: ['フェード', 'char'], rise: ['浮かび上がる', 'char'], drop: ['降りてくる', 'char'], merge: ['上下から合流', 'char'], slide: ['スライド', 'char'],
  track: ['字間が縮まる', 'char'], spread: ['中央から左右に広がる', 'char'], unblur: ['ぼかし解除', 'char'], pop: ['ポップ', 'char'], big: ['大きい所から', 'char'],
  spin: ['回転', 'char'], flip: ['めくれる', 'char'], bounce: ['落下バウンド', 'char'], gather: ['集合', 'char'], type: ['タイプライター', 'char'], flicker: ['明滅', 'char'],
  slam: ['叩きつけ', 'whole'], approach: ['迫ってくる', 'whole'], depth: ['奥から現れる', 'whole'], wipe: ['ワイプ', 'whole'], unfold: ['展開', 'whole'], glitch: ['グリッチ', 'whole'], flash: ['閃光', 'whole'],
};
export const TELOP_EXIT = {
  fade: ['フェード', 'char'], rise: ['上へ消える', 'char'], drop: ['下へ沈む', 'char'], merge: ['上下に分かれる', 'char'], slide: ['スライド', 'char'],
  track: ['字間が広がる', 'char'], unblur: ['ぼやける', 'char'], big: ['膨らんで消える', 'char'], pop: ['縮んで消える', 'char'], gather: ['飛び散る', 'char'],
  type: ['1文字ずつ消去', 'char'], flicker: ['明滅', 'char'],
  approach: ['迫って消える', 'whole'], depth: ['遠ざかる', 'whole'], wipe: ['ワイプ', 'whole'], unfold: ['閉じる', 'whole'], glitch: ['グリッチ', 'whole'],
};
export const TELOP_HOLD = { none: 'なし', float: 'ふわふわ', wave: '波打つ', beat: '鼓動', shake: '震え', glow: '発光の明滅', flicker: 'ちらつき', blink: '点滅', noise: '時々ノイズ' };
export const TELOP_ORDER = { left: '左から', right: '右から', center: '中央から', edge: '両端から', random: 'ばらばら' };
export const TELOP_EASE = { out: 'すっと止まる', inout: 'なめらか', back: '行きすぎて戻る', linear: '一定' };
export const TELOP_FRAMES = { none: 'なし', band: '帯', tape: '虎柄テープ', box: 'ボックス', lines: '上下ライン', under: '下線', side: 'サイドライン', corner: 'コーナー枠' };
export const TELOP_FRAME_ANIM = { grow: '伸びる', fade: 'フェード', none: 'なし' };
export const TELOP_BG = { none: 'なし(透明)', solid: '単色', vignette: 'ビネット', bottom: '下からグラデ', top: '上からグラデ' };
export const TELOP_SIZES = { '1280x720': [1280, 720], '1920x1080': [1920, 1080], '960x540': [960, 540], '640x360': [640, 360], '1280x320': [1280, 320], '512x512': [512, 512] };

export const TELOP_DEFAULTS = {
  text: '戦闘開始', sub: 'BATTLE START', subPos: 'below', vertical: false, align: 'center', fit: true,
  family: 'Noto Serif JP', size: 150, spacing: 0.08, lineHeight: 1.25, weight: 400, thick: 0,
  subFamily: '', subWeight: 400, subScale: 0.26, subSpacing: 0.5, subGap: 0.25, subColor: '',
  style: 'whiteBlack',
  // 装飾の値(style を選ぶと入る。あとから個別に変えられる)
  fill: '#ffffff', fill2: '', fillA: 1, stroke: '#000000', strokeW: 0.09, stroke2: '', stroke2W: 0,
  shadow: '#000000', shadowA: 0.6, shadowBlur: 0.08, shadowX: 0, shadowY: 0.05, glow: '', glowA: 0, glowBlur: 0.2,
  enter: 'fade', enterTime: 0.5, stagger: 0.08, order: 'left', enterEase: 'out', enterPower: 1,
  hold: 'none', holdTime: 2,
  exitOn: true, exit: 'fade', exitTime: 0.4, exitStagger: 0.04, exitEase: 'inout', exitPower: 1,
  pre: 0.1, post: 0.2,
  frame: 'none', frameFill: '#000000', frameLine: '#ffffff', frameAlpha: 0.6, frameW: 4, framePad: 0.4, frameAnim: 'grow', frameTime: 0.4,
  bg: 'none', bgColor: '#000000', bgAlpha: 0.6,
  width: 1280, height: 720, vpos: 'middle', dx: 0, dy: 0, margin: 0.06,
};

// お手本(動き・フォント・色をまとめて)
export const TELOP_TEMPLATES = {
  battle: { label: '戦闘開始(カットイン)', o: { text: '戦闘開始', sub: 'BATTLE START', style: 'whiteBlack', family: 'Noto Serif JP', size: 170, enter: 'slam', enterTime: 0.35, hold: 'none', holdTime: 1.6, exit: 'approach', exitTime: 0.35, frame: 'band', frameFill: '#000000', frameAlpha: 0.65, frameAnim: 'grow' } },
  victory: { label: '勝利・成功(金)', o: { text: '戦闘終了', sub: 'VICTORY', style: 'gold', size: 160, enter: 'big', enterTime: 0.45, stagger: 0.07, hold: 'glow', holdTime: 2, exit: 'fade', frame: 'lines', frameLine: '#ffd866' } },
  defeat: { label: '敗北・失敗(血)', o: { text: '敗北', sub: 'DEFEAT', style: 'blood', size: 190, enter: 'drop', enterTime: 0.9, stagger: 0.2, enterEase: 'inout', hold: 'shake', holdTime: 2, exit: 'drop', exitTime: 0.8, bg: 'vignette', bgAlpha: 0.7 } },
  critical: { label: 'クリティカル(ポップ)', o: { text: 'クリティカル!', sub: '', style: 'pop', family: 'Zen Maru Gothic', size: 140, enter: 'pop', enterTime: 0.35, stagger: 0.05, enterEase: 'back', hold: 'wave', holdTime: 1.8, exit: 'pop', exitTime: 0.25 } },
  fumble: { label: 'ファンブル(グリッチ)', o: { text: 'ファンブル', sub: 'FUMBLE', style: 'purple', size: 150, enter: 'glitch', enterTime: 0.5, hold: 'noise', holdTime: 2, exit: 'glitch', exitTime: 0.4 } },
  place: { label: '場所・時間(字幕)', o: { text: '旧校舎 三階', sub: '午後 11時 42分', subPos: 'below', style: 'whiteBlack', family: 'Noto Serif JP', size: 84, spacing: 0.2, subScale: 0.45, subSpacing: 0.3, enter: 'unblur', enterTime: 0.7, stagger: 0.06, hold: 'none', holdTime: 3, exit: 'fade', exitTime: 0.6, frame: 'side', frameLine: '#ffffff', vpos: 'bottom', align: 'left', bg: 'bottom', bgAlpha: 0.7 } },
  trailer: { label: 'トレイラー(長めの文章)', o: { text: 'その夜、\n街から音が消えた。', sub: '', style: 'whiteBlack', strokeW: 0, family: 'Noto Serif JP', size: 80, spacing: 0.15, lineHeight: 1.7, enter: 'fade', enterTime: 0.8, stagger: 0.12, hold: 'none', holdTime: 3, exit: 'unblur', exitTime: 0.8, exitStagger: 0, bg: 'solid', bgColor: '#000000', bgAlpha: 1 } },
  typing: { label: 'タイプライター', o: { text: 'SYSTEM ONLINE', sub: '接続を確立しました', style: 'neon', family: 'DotGothic16', size: 110, spacing: 0.1, enter: 'type', enterTime: 0.05, stagger: 0.09, hold: 'flicker', holdTime: 2.5, exit: 'type', exitTime: 0.05, exitStagger: 0.04 } },
  round: { label: 'ラウンド(迫ってくる)', o: { text: 'ラウンド 1', sub: 'ROUND 1', style: 'silver', size: 160, enter: 'approach', enterTime: 0.4, enterEase: 'back', hold: 'beat', holdTime: 1.6, exit: 'depth', exitTime: 0.35, frame: 'corner' } },
  ghost: { label: '怪異(ゴースト)', o: { text: 'うしろにいる', sub: '', style: 'ghost', family: 'Yomogi', size: 130, spacing: 0.25, enter: 'flicker', enterTime: 0.9, stagger: 0.15, order: 'random', hold: 'float', holdTime: 2.5, exit: 'gather', exitTime: 0.9, exitStagger: 0.05 } },
};

const NUM = ['weight', 'thick', 'subWeight', 'size', 'spacing', 'lineHeight', 'subScale', 'subSpacing', 'subGap', 'fillA', 'strokeW', 'stroke2W', 'shadowA', 'shadowBlur', 'shadowX', 'shadowY', 'glowA', 'glowBlur',
  'enterTime', 'stagger', 'enterPower', 'holdTime', 'exitTime', 'exitStagger', 'exitPower', 'pre', 'post', 'frameAlpha', 'frameW', 'framePad', 'frameTime', 'bgAlpha', 'width', 'height', 'dx', 'dy', 'margin'];
const STYLE_KEYS = ['fill', 'fill2', 'fillA', 'stroke', 'strokeW', 'stroke2', 'stroke2W', 'shadow', 'shadowA', 'shadowBlur', 'shadowX', 'shadowY', 'glow', 'glowA', 'glowBlur'];
const STYLE_BASE = { fill: '#ffffff', fill2: '', fillA: 1, stroke: '', strokeW: 0, stroke2: '', stroke2W: 0, shadow: '', shadowA: 0, shadowBlur: 0, shadowX: 0, shadowY: 0, glow: '', glowA: 0, glowBlur: 0.2 };

export const styleValues = (key) => ({ ...STYLE_BASE, ...Object.fromEntries(Object.entries(TELOP_STYLES[key] || {}).filter(([k]) => k !== 'label')) });

// 値をそろえる(お手本 template → 装飾 style → 個別の値 の順に重ねる)
export function telopOptions(src = {}) {
  const t = TELOP_TEMPLATES[src.template]?.o || {};
  const merged = { ...t, ...src };
  const styleKey = TELOP_STYLES[merged.style] ? merged.style : TELOP_DEFAULTS.style;
  // style を選んだときの値。お手本・引数に個別の値があればそちら
  const o = { ...TELOP_DEFAULTS, ...styleValues(styleKey), ...merged, style: styleKey };
  for (const k of NUM) { o[k] = Number(o[k]); if (!Number.isFinite(o[k])) o[k] = TELOP_DEFAULTS[k]; }
  const cl = (k, a, b) => { o[k] = Math.min(b, Math.max(a, o[k])); };
  cl('size', 8, 600); cl('width', 16, 3840); cl('height', 16, 2160); cl('enterTime', 0.02, 10); cl('exitTime', 0.02, 10); cl('holdTime', 0, 60);
  cl('stagger', 0, 2); cl('exitStagger', 0, 2); cl('pre', 0, 10); cl('post', 0, 10); cl('lineHeight', 0.8, 3); cl('subScale', 0.1, 1.5);
  cl('enterPower', 0.2, 3); cl('exitPower', 0.2, 3); cl('margin', 0, 0.4); cl('frameTime', 0.02, 5);
  o.width = Math.round(o.width); o.height = Math.round(o.height);
  o.text = String(o.text ?? '').replace(/\r/g, '');
  o.sub = String(o.sub ?? '').replace(/\r/g, '');
  if (!TELOP_ENTER[o.enter]) o.enter = 'fade';
  if (!TELOP_EXIT[o.exit]) o.exit = 'fade';
  if (!(o.hold in TELOP_HOLD)) o.hold = 'none';
  if (!(o.frame in TELOP_FRAMES)) o.frame = 'none';
  if (!(o.bg in TELOP_BG)) o.bg = 'none';
  if (!(o.order in TELOP_ORDER)) o.order = 'left';
  o.vertical = !!o.vertical; o.exitOn = o.exitOn !== false; o.fit = o.fit !== false;
  if (src.bold && src.weight === undefined) o.weight = 700; // 1.22.0 の「太字」
  delete o.bold;
  o.weight = Math.round(Math.min(900, Math.max(100, o.weight)) / 100) * 100; o.subWeight = Math.round(Math.min(900, Math.max(100, o.subWeight)) / 100) * 100;
  o.thick = Math.min(0.15, Math.max(0, o.thick));
  delete o.template;
  return o;
}

// ---- 小道具 ----

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const EASE = {
  linear: (t) => t,
  out: (t) => 1 - (1 - t) ** 3,
  inout: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  back: (t) => { const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; },
  bounce: (t) => { const n = 7.5625, d = 2.75; if (t < 1 / d) return n * t * t; if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75; if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375; return n * (t -= 2.625 / d) * t + 0.984375; },
};
function rnd(i, s = 0) {
  let h = Math.imul(i + 1, 374761393) + Math.imul(s + 1, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const rgba = (hex, a = 1) => { const c = parseHex(hex || '#000000'); return `rgba(${c.r},${c.g},${c.b},${a * (c.a / 255)})`; };
// weight = 100〜900(太さの変えられるフォント = Noto Sans JP / Noto Serif JP はそのまま効く。ほかは 600 以上でブラウザが太らせる)
const fontOf = (family, size, weight = 400) => `${weight} ${size}px "${family}", sans-serif`;
// 縦書きで横に倒す字
const ROTATE = /[ー〜～—―…‥\-–()()「」『』【】〈〉《》[\]{}<>=:;〔〕]/;

// ---- レイアウト(文字ごとの位置)とスプライト ----

let measureCtx = null;
const mctx = () => (measureCtx ||= createCanvas(8, 8).getContext('2d'));

// 1つの文章(複数行)を置く。戻り値 { chars: [{ ch, x, y(文字の中心。かたまりの中心が原点), w, rot }], w, h }
function layoutBlock(text, family, size, spacing, lineHeight, vertical, align, bold) {
  const c = mctx();
  c.font = fontOf(family, size, bold);
  const lines = text.split('\n');
  const sp = size * spacing, lh = size * lineHeight;
  const chars = [];
  if (!vertical) {
    const rows = lines.map((line) => {
      const cs = [...line].map((ch) => ({ ch, w: c.measureText(ch).width }));
      const w = cs.reduce((a, b) => a + b.w, 0) + sp * Math.max(0, cs.length - 1);
      return { cs, w };
    });
    const W = Math.max(1, ...rows.map((r) => r.w)), Ht = lh * (rows.length - 1) + size;
    rows.forEach((r, li) => {
      let x = align === 'left' ? -W / 2 : align === 'right' ? W / 2 - r.w : -r.w / 2;
      const y = -Ht / 2 + size / 2 + li * lh;
      for (const k of r.cs) { chars.push({ ch: k.ch, x: x + k.w / 2, y, w: k.w, rot: 0, line: li }); x += k.w + sp; }
    });
    return { chars, w: W, h: Ht };
  }
  // 縦書き: 行は右から左へ
  const cols = lines.map((line) => [...line]);
  const colH = (cs) => cs.length * size + sp * Math.max(0, cs.length - 1);
  const Ht = Math.max(1, ...cols.map(colH)), W = lh * (cols.length - 1) + size;
  cols.forEach((cs, li) => {
    const x = W / 2 - size / 2 - li * lh;
    let y = align === 'left' ? -Ht / 2 : align === 'right' ? Ht / 2 - colH(cs) : -colH(cs) / 2; // 左 = 上ぞろえ、右 = 下ぞろえ
    for (const ch of cs) { chars.push({ ch, x, y: y + size / 2, w: size, rot: ROTATE.test(ch) ? Math.PI / 2 : 0, line: li }); y += size + sp; }
  });
  return { chars, w: W, h: Ht };
}

// 1文字の絵(装飾つき)。中心が (pad + w/2, pad + size/2)
function makeSprite(ch, family, size, st, bold) {
  const c = mctx();
  c.font = fontOf(family, size, bold);
  const w = Math.max(1, c.measureText(ch).width);
  const thick = st.thick || 0; // 太らせる量(文字サイズ比)。塗りと同じ色で縁を足し、縁取りはその外に
  const pad = Math.ceil(size * (0.25 + thick + Math.max(st.strokeW, st.stroke2W) + Math.max(st.glow ? st.glowBlur * 1.6 : 0, st.shadow ? st.shadowBlur * 1.5 + Math.abs(st.shadowY) + Math.abs(st.shadowX) : 0)));
  const cv = createCanvas(Math.ceil(w + pad * 2), Math.ceil(size + pad * 2));
  const x = cv.getContext('2d');
  x.font = fontOf(family, size, bold);
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
  const cx = cv.width / 2, cy = cv.height / 2;
  // 文字の形(縁取りこみ)を先に作っておく → 光彩・影はその形から
  const body = createCanvas(cv.width, cv.height), b = body.getContext('2d');
  b.font = x.font; b.textAlign = 'center'; b.textBaseline = 'middle'; b.lineJoin = 'round';
  if (st.stroke2 && st.stroke2W > 0) { b.strokeStyle = rgba(st.stroke2); b.lineWidth = size * (st.stroke2W + thick) * 2; b.strokeText(ch, cx, cy); }
  if (st.stroke && st.strokeW > 0) { b.strokeStyle = rgba(st.stroke); b.lineWidth = size * (st.strokeW + thick) * 2; b.strokeText(ch, cx, cy); }
  if (st.fillA < 1) {
    // 半透明・白抜き: 縁取りが文字の中に透けないように、先に文字の中をくり抜く
    b.globalCompositeOperation = 'destination-out'; b.fillStyle = '#000'; b.strokeStyle = '#000'; b.fillText(ch, cx, cy);
    if (thick > 0) { b.lineWidth = size * thick * 2; b.strokeText(ch, cx, cy); }
    b.globalCompositeOperation = 'source-over';
  }
  if (st.fillA > 0) {
    if (st.fill2) {
      const g = b.createLinearGradient(0, cy - size * 0.45, 0, cy + size * 0.45);
      g.addColorStop(0, rgba(st.fill, st.fillA)); g.addColorStop(1, rgba(st.fill2, st.fillA));
      b.fillStyle = g;
    } else b.fillStyle = rgba(st.fill, st.fillA);
    if (thick > 0) {
      // 半透明でも重なりが濃くならないよう、太らせた形を別に作ってから塗りの色をのせる
      const g = createCanvas(cv.width, cv.height), gx = g.getContext('2d');
      gx.font = b.font; gx.textAlign = 'center'; gx.textBaseline = 'middle'; gx.lineJoin = 'round';
      gx.fillText(ch, cx, cy); gx.lineWidth = size * thick * 2; gx.strokeText(ch, cx, cy);
      gx.globalCompositeOperation = 'source-in'; gx.fillStyle = b.fillStyle; gx.fillRect(0, 0, g.width, g.height);
      b.drawImage(g, 0, 0);
    } else b.fillText(ch, cx, cy);
  }
  if (st.glow && st.glowA > 0) {
    x.save(); x.shadowColor = rgba(st.glow, 1); x.shadowBlur = size * st.glowBlur; x.globalAlpha = st.glowA;
    x.drawImage(body, 0, 0); x.drawImage(body, 0, 0); x.restore();
  }
  if (st.shadow && st.shadowA > 0) {
    x.save(); x.shadowColor = rgba(st.shadow, st.shadowA); x.shadowBlur = size * st.shadowBlur; x.shadowOffsetX = size * st.shadowX; x.shadowOffsetY = size * st.shadowY;
    x.drawImage(body, 0, 0); x.restore();
  }
  x.drawImage(body, 0, 0);
  return cv;
}

// レイアウトとスプライトは、関係する値が同じ間は使い回す
let cacheKey = '', cache = null;
function prepare(o) {
  const key = JSON.stringify([o.text, o.sub, o.subPos, o.vertical, o.align, o.fit, o.family, o.size, o.spacing, o.lineHeight, o.weight, o.thick, o.subWeight, o.subFamily, o.subScale, o.subSpacing, o.subGap, o.subColor,
    STYLE_KEYS.map((k) => o[k]), o.width, o.height, o.margin, o.vpos, o.dx, o.dy, fontEpoch]);
  if (key === cacheKey && cache) return cache;
  const st = Object.fromEntries(STYLE_KEYS.map((k) => [k, o[k]]));
  st.thick = o.thick;
  const availW = o.width * (1 - o.margin * 2), availH = o.height * (1 - o.margin * 2);
  let size = o.size, main, sub = null, subSize = 0, total;
  const build = () => {
    main = layoutBlock(o.text || ' ', o.family, size, o.spacing, o.lineHeight, o.vertical, o.align, o.weight);
    subSize = Math.max(6, size * o.subScale);
    sub = o.sub ? layoutBlock(o.sub, o.subFamily || o.family, subSize, o.subSpacing, 1.3, o.vertical, o.align, o.subWeight) : null;
    const gap = sub ? size * o.subGap : 0;
    total = o.vertical ? { w: main.w + (sub ? sub.w + gap : 0), h: Math.max(main.h, sub ? sub.h : 0) } : { w: Math.max(main.w, sub ? sub.w : 0), h: main.h + (sub ? sub.h + gap : 0) };
    return gap;
  };
  let gap = build();
  if (o.fit) {
    const k = Math.min(1, availW / total.w, availH / total.h);
    if (k < 1) { size = Math.max(6, Math.floor(size * k)); gap = build(); }
  }
  // かたまりの中心(画像の中での位置)
  const cx = (o.align === 'left' && !o.vertical ? o.width * o.margin + total.w / 2 : o.align === 'right' && !o.vertical ? o.width * (1 - o.margin) - total.w / 2 : o.width / 2) + o.dx;
  const cy = (o.vpos === 'top' ? o.height * o.margin + total.h / 2 : o.vpos === 'bottom' ? o.height * (1 - o.margin) - total.h / 2 : o.height / 2) + o.dy;
  // メインとサブの中心
  let mx = cx, my = cy, sx = cx, sy = cy;
  if (sub) {
    if (o.vertical) { // サブは「上」= 右、「下」= 左
      const first = o.subPos === 'above' ? sub : main, d = total.w / 2;
      if (first === sub) { sx = cx + d - sub.w / 2; mx = cx - d + main.w / 2; } else { mx = cx + d - main.w / 2; sx = cx - d + sub.w / 2; }
    } else {
      const d = total.h / 2;
      if (o.subPos === 'above') { sy = cy - d + sub.h / 2; my = cy + d - main.h / 2; } else { my = cy - d + main.h / 2; sy = cy + d - sub.h / 2; }
      const ax = (blk) => (o.align === 'left' ? cx - total.w / 2 + blk.w / 2 : o.align === 'right' ? cx + total.w / 2 - blk.w / 2 : cx);
      mx = ax(main); sx = ax(sub);
    }
  }
  const sprites = new Map();
  const spr = (ch, fam, sz, style, bold) => { const k = [ch, fam, sz, bold].join('|') + (style === st ? 'm' : 's'); if (!sprites.has(k)) sprites.set(k, makeSprite(ch, fam, sz, style, bold)); return sprites.get(k); };
  const subStyle = { ...st, thick: 0, ...(o.subColor ? { fill: o.subColor, fill2: '' } : {}) };
  const vis = main.chars.filter((c) => c.ch.trim());
  vis.forEach((c, i) => { c.i = i; c.sprite = spr(c.ch, o.family, size, st, o.weight); });
  const subChars = sub ? sub.chars.filter((c) => c.ch.trim()) : [];
  subChars.forEach((c) => { c.sprite = spr(c.ch, o.subFamily || o.family, subSize, subStyle, o.subWeight); });
  cacheKey = key;
  cache = { size, main, sub, chars: vis, subChars, mx, my, sx, sy, cx, cy, total, n: vis.length, gap };
  return cache;
}
let fontEpoch = 0;
export function telopFontsChanged() { fontEpoch++; }

// ---- 時間 ----

const isWhole = (table, k) => table[k]?.[1] === 'whole';
export function telopTimes(o) {
  const n = Math.max(1, [...o.text].filter((c) => c.trim()).length);
  const enter = isWhole(TELOP_ENTER, o.enter) ? o.enterTime : o.enterTime + o.stagger * (n - 1);
  const exit = !o.exitOn ? 0 : isWhole(TELOP_EXIT, o.exit) ? o.exitTime : o.exitTime + o.exitStagger * (n - 1);
  const t1 = o.pre, t2 = t1 + enter, t3 = t2 + o.holdTime, t4 = t3 + exit;
  return { n, enter, exit, t1, t2, t3, t4, total: t4 + o.post };
}

// 登場・退場の順番(文字 i が何番目に動くか 0〜n-1)
function orderOf(i, n, order) {
  switch (order) {
    case 'right': return n - 1 - i;
    case 'center': return Math.abs(i - (n - 1) / 2);
    case 'edge': return (n - 1) / 2 - Math.abs(i - (n - 1) / 2);
    case 'random': return Math.floor(rnd(i, 77) * n);
    default: return i;
  }
}

// ---- 動き: 1文字ずつ。h = 隠れ具合(1 = 見えない、0 = 元の位置)----

function charPose(kind, h, c, P, pw, exit) {
  const s = P.size, a = 1 - h;
  const p = { dx: 0, dy: 0, sx: 1, sy: 1, rot: 0, alpha: 1, blur: 0 };
  switch (kind) {
    case 'fade': p.alpha = a; break;
    case 'rise': p.dy = (exit ? -1 : 1) * s * 0.6 * pw * h; p.alpha = a; break;
    case 'drop': p.dy = (exit ? 1 : -1) * s * 0.6 * pw * h; p.alpha = a; break;
    case 'merge': p.dy = (c.i % 2 ? 1 : -1) * s * 0.8 * pw * h; p.alpha = a; break;
    case 'slide': p.dx = s * 1.2 * pw * h * (exit ? -1 : 1); p.alpha = a; break;
    case 'track': p.dx = c.x * 0.8 * pw * h; p.alpha = a; break;
    case 'spread': p.dx = -c.x * h; p.alpha = clamp01(a * 1.5); break;
    case 'unblur': p.blur = s * 0.25 * pw * h; p.alpha = a; break;
    case 'pop': p.sx = p.sy = Math.max(0, a); p.alpha = clamp01(a * 3); break;
    case 'big': p.sx = p.sy = 1 + 1.8 * pw * h; p.alpha = a; break;
    case 'spin': p.rot = -Math.PI * pw * h; p.sx = p.sy = Math.max(0.01, a); p.alpha = clamp01(a * 2); break;
    case 'flip': p.sx = Math.max(0.01, Math.cos((h * Math.PI) / 2)); p.alpha = clamp01(a * 2); break;
    case 'bounce': p.dy = -s * 2.5 * pw * h; p.alpha = clamp01(a * 4); break;
    case 'gather': {
      const ang = rnd(c.i, 3) * Math.PI * 2, d = s * (1.5 + rnd(c.i, 5) * 2.5) * pw;
      p.dx = Math.cos(ang) * d * h; p.dy = Math.sin(ang) * d * h; p.rot = (rnd(c.i, 9) - 0.5) * 3 * h; p.alpha = a; break;
    }
    case 'type': p.alpha = h < 0.5 ? 1 : 0; break;
    case 'flicker': p.alpha = h <= 0 ? 1 : h >= 1 ? 0 : (rnd(c.i, Math.floor(h * 14)) < a ? 1 : 0.15); break;
    default: p.alpha = a;
  }
  return p;
}

// ---- 動き: 全体。戻り値は text 全体へのかけ方 ----

function wholePose(kind, h, P, pw, t) {
  const a = 1 - h;
  const w = { scale: 1, sy: 1, alpha: 1, dx: 0, dy: 0, wipe: 1, glitch: 0, flash: 0 };
  switch (kind) {
    case 'slam': w.scale = 1 + 2.2 * pw * h; w.alpha = clamp01(a * 2.5); break; // 着地のゆれは drawTelop で
    case 'approach': // 登場 = 小さい所から迫ってくる、退場 = こちらへ迫って消える
      if (P.exitPhase) { w.scale = 1 + 1.6 * pw * h; w.alpha = a; } else { w.scale = Math.max(0.01, 1 - 0.75 * h); w.alpha = clamp01(a * 2); }
      break;
    case 'depth': w.scale = Math.max(0.01, 1 - (P.exitPhase ? 0.85 : 0.45) * h); w.alpha = a; break;
    case 'wipe': w.wipe = a; break;
    case 'unfold': w.sy = Math.max(0.001, a); break;
    case 'glitch': w.glitch = h * pw; w.alpha = h >= 1 ? 0 : (rnd(Math.floor(t * 30), 5) < a * 1.3 ? 1 : 0.2); break;
    case 'flash': w.flash = h; w.alpha = clamp01(a * 2); w.scale = 1 + 0.15 * h; break;
    default: w.alpha = a;
  }
  return w;
}

// ---- 背景・枠 ----

function drawBackground(ctx, o, alpha) {
  if (o.bg === 'none' || alpha <= 0) return;
  const { width: W, height: H } = o;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (o.bg === 'solid') { ctx.fillStyle = rgba(o.bgColor, o.bgAlpha); ctx.fillRect(0, 0, W, H); }
  else if (o.bg === 'vignette') {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.hypot(W, H) / 2);
    g.addColorStop(0, rgba(o.bgColor, 0)); g.addColorStop(1, rgba(o.bgColor, o.bgAlpha));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  } else {
    const g = o.bg === 'bottom' ? ctx.createLinearGradient(0, H, 0, H * 0.35) : ctx.createLinearGradient(0, 0, 0, H * 0.65);
    g.addColorStop(0, rgba(o.bgColor, o.bgAlpha)); g.addColorStop(1, rgba(o.bgColor, 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

// k = 出ている量 0〜1
function drawFrame(ctx, o, P, k) {
  if (o.frame === 'none' || k <= 0) return;
  const pad = P.size * o.framePad, lw = o.frameW;
  const bw = P.total.w + pad * 2, bh = P.total.h + pad * 2;
  const x0 = P.cx - bw / 2, y0 = P.cy - bh / 2;
  const grow = o.frameAnim === 'grow' ? k : 1;
  ctx.save();
  ctx.globalAlpha = o.frameAnim === 'fade' ? k : o.frameAnim === 'grow' ? clamp01(k * 3) : 1;
  const fill = rgba(o.frameFill, o.frameAlpha), line = rgba(o.frameLine);
  const W = o.width;
  switch (o.frame) {
    case 'band': {
      const w = W * grow;
      ctx.fillStyle = fill; ctx.fillRect(W / 2 - w / 2, y0, w, bh);
      if (lw > 0) { ctx.fillStyle = line; ctx.fillRect(W / 2 - w / 2, y0 - lw, w, lw); ctx.fillRect(W / 2 - w / 2, y0 + bh, w, lw); }
      break;
    }
    case 'tape': {
      const th = Math.max(8, P.size * 0.16), w = W * grow, xs = W / 2 - w / 2;
      ctx.fillStyle = fill; ctx.fillRect(xs, y0, w, bh);
      for (const ty of [y0 - th, y0 + bh]) {
        ctx.save(); ctx.beginPath(); ctx.rect(xs, ty, w, th); ctx.clip();
        ctx.fillStyle = '#f5c518'; ctx.fillRect(xs, ty, w, th);
        ctx.fillStyle = '#111111';
        for (let x = -th * 2; x < W + th * 2; x += th * 2) { ctx.beginPath(); ctx.moveTo(x, ty + th); ctx.lineTo(x + th, ty); ctx.lineTo(x + th * 2, ty); ctx.lineTo(x + th, ty + th); ctx.fill(); }
        ctx.restore();
      }
      break;
    }
    case 'box': {
      const w = bw * grow;
      ctx.fillStyle = fill; ctx.fillRect(P.cx - w / 2, y0, w, bh);
      if (lw > 0) { ctx.strokeStyle = line; ctx.lineWidth = lw; ctx.strokeRect(P.cx - w / 2, y0, w, bh); }
      break;
    }
    case 'lines': {
      const w = bw * grow;
      ctx.fillStyle = line;
      ctx.fillRect(P.cx - w / 2, y0, w, Math.max(1, lw)); ctx.fillRect(P.cx - w / 2, y0 + bh - Math.max(1, lw), w, Math.max(1, lw));
      break;
    }
    case 'under': {
      const w = bw * grow;
      ctx.fillStyle = line; ctx.fillRect(x0, y0 + bh - Math.max(1, lw), w, Math.max(1, lw));
      break;
    }
    case 'side': {
      const hh = bh * grow, w = Math.max(2, lw * 1.5);
      ctx.fillStyle = line; ctx.fillRect(x0 - w, P.cy - hh / 2, w, hh);
      break;
    }
    case 'corner': {
      const L = Math.min(bw, bh) * 0.3 * grow;
      ctx.strokeStyle = line; ctx.lineWidth = Math.max(1, lw); ctx.lineCap = 'square';
      ctx.beginPath();
      for (const [x, y, dx, dy] of [[x0, y0, 1, 1], [x0 + bw, y0, -1, 1], [x0, y0 + bh, 1, -1], [x0 + bw, y0 + bh, -1, -1]]) { ctx.moveTo(x + dx * L, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * L); }
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

// ---- 1フレーム描く ----

let scratch = null;
function scratchCanvas(w, h) {
  if (!scratch || scratch.width !== w || scratch.height !== h) scratch = createCanvas(w, h);
  const x = scratch.getContext('2d');
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.clearRect(0, 0, w, h);
  return x;
}

// t 秒目の絵を ctx(o.width × o.height)に描く。still = 完成した状態(動きなし)
export function drawTelop(ctx, o, t, { still = false, clear = true } = {}) {
  const P = prepare(o);
  const T = telopTimes(o);
  const { width: W, height: H } = o;
  if (clear) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H); }
  if (still) t = T.t2 + 0.0001;
  const entering = t < T.t2, exiting = o.exitOn && t >= T.t3;
  const eWhole = isWhole(TELOP_ENTER, o.enter), xWhole = isWhole(TELOP_EXIT, o.exit);
  // 全体の出ている量(背景・枠・サブ用)
  const inK = clamp01((t - T.t1) / Math.min(o.frameTime, Math.max(0.05, T.enter)));
  const outK = o.exitOn ? clamp01((T.t4 - t) / Math.min(o.frameTime, Math.max(0.05, T.exit))) : 1;
  const presence = still ? 1 : Math.min(inK, outK);
  drawBackground(ctx, o, still ? 1 : Math.min(clamp01((t - T.t1 * 0.5) / 0.3 + (T.t1 === 0 ? 1 : 0)), o.exitOn ? clamp01((T.total - t) / Math.max(0.05, o.post + T.exit * 0.5)) : 1));
  drawFrame(ctx, o, P, EASE.out(presence));

  // 文字を別のキャンバスに並べる
  const x = scratchCanvas(W, H);
  const holdT = t - T.t2;
  for (const c of P.chars) {
    let pose = { dx: 0, dy: 0, sx: 1, sy: 1, rot: 0, alpha: 1, blur: 0 };
    if (!still && entering && !eWhole) {
      const k = clamp01((t - T.t1 - orderOf(c.i, P.n, o.order) * o.stagger) / o.enterTime);
      const e = o.enter === 'bounce' ? EASE.bounce(k) : EASE[o.enterEase](k);
      pose = charPose(o.enter, 1 - e, c, P, o.enterPower, false);
      if (k <= 0) pose.alpha = 0;
    } else if (!still && exiting && !xWhole) {
      const k = clamp01((t - T.t3 - orderOf(c.i, P.n, o.order) * o.exitStagger) / o.exitTime);
      pose = charPose(o.exit, EASE[o.exitEase](k), c, P, o.exitPower, true);
      if (k >= 1) pose.alpha = 0;
    } else if (!still && t < T.t1) pose.alpha = 0;
    // 表示中の動き(登場しきってから退場まで。1文字ずつのもの)
    if (!still && !entering && !exiting) {
      if (o.hold === 'wave') pose.dy += Math.sin(holdT * 5 - c.i * 0.6) * P.size * 0.06;
      else if (o.hold === 'shake') { pose.dx += (rnd(c.i, Math.floor(t * 30)) - 0.5) * P.size * 0.05; pose.dy += (rnd(c.i + 99, Math.floor(t * 30)) - 0.5) * P.size * 0.05; }
      else if (o.hold === 'flicker') pose.alpha *= rnd(c.i, Math.floor(t * 18)) < 0.12 ? 0.45 : 1;
    }
    if (pose.alpha <= 0.003) continue;
    x.save();
    x.globalAlpha = clamp01(pose.alpha);
    if (pose.blur > 0.3) x.filter = `blur(${pose.blur.toFixed(1)}px)`;
    x.translate(P.mx + c.x + pose.dx, P.my + c.y + pose.dy);
    if (c.rot || pose.rot) x.rotate(c.rot + pose.rot);
    if (pose.sx !== 1 || pose.sy !== 1) x.scale(pose.sx, pose.sy);
    x.drawImage(c.sprite, -c.sprite.width / 2, -c.sprite.height / 2);
    x.restore();
  }
  // サブ: メインの登場の後半でフェードイン、退場の始めでフェードアウト
  if (P.subChars.length) {
    const sIn = still ? 1 : clamp01((t - (T.t1 + T.enter * 0.6)) / Math.max(0.15, T.enter * 0.4));
    const sOut = still || !o.exitOn ? 1 : clamp01((T.t3 + Math.max(0.15, T.exit * 0.5) - t) / Math.max(0.15, T.exit * 0.5));
    const a = Math.min(sIn, sOut);
    if (a > 0.003) {
      x.save(); x.globalAlpha = a;
      for (const c of P.subChars) {
        x.save(); x.translate(P.sx + c.x, P.sy + c.y + (1 - EASE.out(sIn)) * P.size * 0.1);
        if (c.rot) x.rotate(c.rot);
        x.drawImage(c.sprite, -c.sprite.width / 2, -c.sprite.height / 2);
        x.restore();
      }
      x.restore();
    }
  }

  // 全体の動きをかけて描く
  let w = { scale: 1, sy: 1, alpha: 1, dx: 0, dy: 0, wipe: 1, glitch: 0, flash: 0 };
  if (!still) {
    if (t < T.t1 && eWhole) w.alpha = 0;
    else if (entering && eWhole) {
      const k = clamp01((t - T.t1) / o.enterTime);
      w = wholePose(o.enter, 1 - EASE[o.enter === 'slam' ? 'linear' : o.enterEase](o.enter === 'slam' ? k * k : k), { ...P, exitPhase: false }, o.enterPower, t);
    } else if (exiting && xWhole) {
      const k = clamp01((t - T.t3) / o.exitTime);
      w = wholePose(o.exit, EASE[o.exitEase](k), { ...P, exitPhase: true }, o.exitPower, t);
      if (k >= 1) w.alpha = 0;
    } else if (!entering && !exiting) {
      // 叩きつけの着地のゆれ
      if (o.enter === 'slam' && holdT < 0.35) { const d = (1 - holdT / 0.35) * P.size * 0.08 * o.enterPower; w.dx = (rnd(1, Math.floor(t * 60)) - 0.5) * d; w.dy = (rnd(2, Math.floor(t * 60)) - 0.5) * d; w.flash = Math.max(0, 0.5 - holdT * 4); }
      if (o.hold === 'float') w.dy += Math.sin(holdT * 2.2) * P.size * 0.05;
      else if (o.hold === 'beat') { const b = (holdT * 1.4) % 1; w.scale = 1 + 0.06 * Math.max(0, Math.sin(b * Math.PI * 2) * Math.exp(-b * 4) * 2.2); }
      else if (o.hold === 'blink') w.alpha = Math.floor(holdT * 2.5) % 2 ? 0.25 : 1;
      else if (o.hold === 'glow') w.flash = 0.22 * (0.5 - 0.5 * Math.cos(holdT * 3.2));
      else if (o.hold === 'noise') { const seg = Math.floor(holdT * 12); if (rnd(seg, 21) < 0.14) w.glitch = 0.5 + rnd(seg, 22) * 0.5; }
    }
  }
  if (w.alpha <= 0.003) return;
  ctx.save();
  ctx.globalAlpha = clamp01(w.alpha);
  ctx.translate(P.cx + w.dx, P.cy + w.dy);
  ctx.scale(w.scale, w.scale * w.sy);
  ctx.translate(-P.cx, -P.cy);
  if (w.wipe < 1) {
    const pad = P.size, x0 = P.cx - P.total.w / 2 - pad, full = P.total.w + pad * 2;
    ctx.beginPath(); ctx.rect(x0, 0, full * w.wipe, H); ctx.clip();
  }
  if (w.glitch > 0.01) {
    // 横の帯ごとにずらす
    const bands = 9, seed = Math.floor(t * 24);
    for (let i = 0; i < bands; i++) {
      const y = Math.floor((H * i) / bands), hh = Math.ceil(H / bands);
      const off = (rnd(i, seed) - 0.5) * P.size * 1.2 * w.glitch * (rnd(i + 50, seed) < 0.6 ? 1 : 0);
      ctx.drawImage(scratch, 0, y, W, hh, off, y, W, hh);
    }
  } else ctx.drawImage(scratch, 0, 0);
  if (w.flash > 0.01) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp01(w.flash) * clamp01(w.alpha); ctx.drawImage(scratch, 0, 0); ctx.drawImage(scratch, 0, 0); }
  ctx.restore();
}

// 全フレームを順に作る。onFrame(canvas, i, count) を呼ぶ(canvas は使い回すので、その場で読み取ること)
export function telopFrameCount(o, fps) { return Math.max(1, Math.round(telopTimes(o).total * fps)); }
export function renderTelopFrame(o, i, fps, canvas) {
  const cv = canvas || createCanvas(o.width, o.height);
  if (cv.width !== o.width || cv.height !== o.height) { cv.width = o.width; cv.height = o.height; }
  drawTelop(cv.getContext('2d', { willReadFrequently: true }), o, (i + 0.5) / fps);
  return cv;
}

// 使うフォント(メイン・サブ)
export const telopFamilies = (o) => [...new Set([o.family, o.subFamily].filter(Boolean))];
