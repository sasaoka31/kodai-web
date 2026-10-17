// 文字(テキスト図形)の配置と描画
//   text { text, family, size, lineHeight(倍率), letterSpacing(px), align:'left'|'center'|'right',
//          m:[a,b,c,d,e,f](文字の座標 → ワールド座標。e,f = 1行目の左上), fill, stroke, strokeWidth,
//          kern?: [数値…](字ごとの「この字と次の字の間」。単位は文字の大きさの 1/1000。カーニング・一部の字だけの字間),
//          rise?: [数値…](字ごとのベースラインの上げ下げ。単位は同じ。+ で上) }
//   kern / rise の番号は、text を1字ずつ(Array.from。改行もふくむ)に分けたときの順番。どちらも無ければ、今までどおり1行ずつ描く。
//   あるときは1字ずつ描く(字の位置は「行の先頭からその字までの幅」で測るので、フォントが持つ字と字の詰めはそのまま)
//   移動・拡大縮小・回転・自由変形・リグは m を変えるだけ(文字の形はフォントのまま)
//   図形にしたいとき(リグで曲げる・点を編集する)は「アウトライン化」でパスにする
const mctx = document.createElement('canvas').getContext('2d');

export const DEFAULT_FAMILY = 'Noto Sans JP'; // Kodai のフォント(商用利用できる Google Fonts)

export function fontCss(s) {
  return `${Math.max(1, s.size)}px "${String(s.family || DEFAULT_FAMILY).replace(/"/g, '')}", sans-serif`;
}

const cache = new Map();
let fontEpoch = 0;
// フォントの読み込みが終わったら測り直す
export function fontsChanged() { fontEpoch++; cache.clear(); }

const hasAdjust = (a) => Array.isArray(a) && a.some((v) => v);
// 字ごとの調整(カーニング・ベースライン)があるか
export const hasCharAdjust = (s) => hasAdjust(s.kern) || hasAdjust(s.rise);
const em = (s, v) => ((Number(v) || 0) * s.size) / 1000;

// 行ごとの幅とベースライン。{ lines:[{text, w, base, start(この行の最初の字の番号), count, glyphs?:[{ch, x, dy}]}], w, h, lineH }
//   glyphs は字ごとの調整があるときだけ(x = 行の左からの位置、dy = 上へずらす量)
export function textLayout(s) {
  const adj = hasCharAdjust(s);
  const key = `${fontEpoch}|${fontCss(s)}|${s.lineHeight}|${s.letterSpacing}|${adj ? JSON.stringify([s.kern, s.rise]) : ''}|${s.text}`;
  let r = cache.get(key);
  if (r) return r;
  mctx.font = fontCss(s);
  mctx.letterSpacing = `${s.letterSpacing || 0}px`;
  const lineH = s.size * (s.lineHeight || 1.25);
  const probe = mctx.measureText('あAgjy|');
  const asc = probe.fontBoundingBoxAscent ?? s.size * 0.88, desc = probe.fontBoundingBoxDescent ?? s.size * 0.12;
  let start = 0;
  const lines = String(s.text ?? '').split('\n').map((t, i) => {
    const chars = Array.from(t);
    const line = { text: t, w: mctx.measureText(t).width, base: i * lineH + (lineH - (asc + desc)) / 2 + asc, start, count: chars.length };
    if (adj) {
      let extra = 0, prefix = '';
      line.glyphs = chars.map((ch, k) => {
        const g = { ch, x: mctx.measureText(prefix).width + extra, dy: em(s, s.rise?.[start + k]) };
        prefix += ch;
        extra += em(s, s.kern?.[start + k]);
        return g;
      });
      // 行の最後の字のうしろの分は、幅に入れない
      line.w += extra - (chars.length ? em(s, s.kern?.[start + chars.length - 1]) : 0);
    }
    start += chars.length + 1; // 改行も1字
    return line;
  });
  const w = Math.max(1, ...lines.map((l) => l.w));
  r = { lines, w, h: Math.max(lineH, lines.length * lineH), lineH };
  if (cache.size > 500) cache.clear();
  cache.set(key, r);
  return r;
}

const alignX = (s, L, l) => (s.align === 'center' ? (L.w - l.w) / 2 : s.align === 'right' ? L.w - l.w : 0);

// 字の番号(0 = 先頭の字の前。text を1字ずつに分けた順)→ 入力の位置 { x, y, h, line }(文字の座標)
export function caretPos(s, index) {
  const L = textLayout(s);
  let li = L.lines.length - 1;
  for (let i = 0; i < L.lines.length; i++) if (index <= L.lines[i].start + L.lines[i].count) { li = i; break; }
  const l = L.lines[li], col = Math.min(l.count, Math.max(0, index - l.start));
  let x;
  if (l.glyphs) x = col < l.count ? l.glyphs[col].x : l.w;
  else {
    mctx.font = fontCss(s);
    mctx.letterSpacing = `${s.letterSpacing || 0}px`;
    x = mctx.measureText(Array.from(l.text).slice(0, col).join('')).width;
  }
  return { x: x + alignX(s, L, l), y: li * L.lineH, h: L.lineH, line: li };
}

// 字の番号 a〜b(b は入らない)の範囲の四角(行ごと。文字の座標)
export function rangeRects(s, a, b) {
  const L = textLayout(s), out = [];
  L.lines.forEach((l, i) => {
    const end = l.start + l.count; // この行の改行の番号
    const from = Math.max(a, l.start), to = Math.min(b, end);
    const withBreak = a <= end && b > end; // 改行も選んでいる
    if (to <= from && !withBreak) return;
    const x0 = caretPos(s, Math.min(Math.max(from, l.start), end)).x, x1 = to > from ? caretPos(s, to).x : x0;
    const tail = withBreak ? s.size * 0.25 : 0;
    if (x1 + tail > x0) out.push({ x: x0, y: i * L.lineH, w: x1 + tail - x0, h: L.lineH });
  });
  return out;
}

export const textMatrix = (s) => s.m || [1, 0, 0, 1, 0, 0];

export function applyM(m, x, y) {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

// 文字の枠の四隅(ワールド座標)。拡大 e は線幅の分
export function textCorners(s, e = 0) {
  const { w, h } = textLayout(s);
  const m = textMatrix(s);
  return [[-e, -e], [w + e, -e], [w + e, h + e], [-e, h + e]].map(([x, y]) => applyM(m, x, y));
}

export function textBoxPath(s) {
  const p = new Path2D();
  const c = textCorners(s);
  p.moveTo(c[0].x, c[0].y);
  for (let i = 1; i < 4; i++) p.lineTo(c[i].x, c[i].y);
  p.closePath();
  return p;
}

// fill / stroke を上書きして描ける(アウトライン化・縁取りで黒一色に描くとき用)
export function drawText(ctx, s, { fill = s.fill, stroke = s.stroke, strokeWidth = s.strokeWidth } = {}) {
  const L = textLayout(s);
  ctx.save();
  ctx.transform(...textMatrix(s));
  ctx.font = fontCss(s);
  ctx.letterSpacing = `${s.letterSpacing || 0}px`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const doStroke = stroke && strokeWidth > 0;
  if (doStroke) { ctx.strokeStyle = stroke; ctx.lineWidth = strokeWidth; ctx.lineJoin = 'round'; }
  if (fill) ctx.fillStyle = fill;
  for (const l of L.lines) {
    const x = alignX(s, L, l);
    if (l.glyphs) {
      // 字ごとの調整があるとき: 1字ずつ。字間は位置に入っているので、ここでは足さない
      ctx.letterSpacing = '0px';
      if (fill) for (const g of l.glyphs) ctx.fillText(g.ch, x + g.x, l.base - g.dy);
      if (doStroke) for (const g of l.glyphs) ctx.strokeText(g.ch, x + g.x, l.base - g.dy);
      continue;
    }
    if (fill) ctx.fillText(l.text, x, l.base);
    if (doStroke) ctx.strokeText(l.text, x, l.base);
  }
  ctx.restore();
}

// 文字を書き換えたとき、字ごとの調整(kern / rise)の番号を合わせ直す: 変わらなかった前と後ろはそのまま、間に入った字は 0
export function retargetAdjust(s, oldText, newText) {
  if (!Array.isArray(s.kern) && !Array.isArray(s.rise)) return;
  const a = Array.from(String(oldText ?? '')), b = Array.from(String(newText ?? ''));
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let q = 0;
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
  const removed = a.length - p - q, added = b.length - p - q;
  for (const k of ['kern', 'rise']) {
    if (!Array.isArray(s[k])) continue;
    const arr = Array.from({ length: a.length }, (_, i) => Number(s[k][i]) || 0);
    arr.splice(p, removed, ...new Array(added).fill(0));
    if (arr.some((v) => v)) s[k] = arr; else delete s[k];
  }
}

// 字の番号 a〜b(b は入らない)の kern / rise を変える。fn(今の値) → 新しい値。全部 0 になったら配列ごと消す
export function adjustChars(s, key, a, b, fn) {
  const n = Array.from(String(s.text ?? '')).length;
  const arr = Array.from({ length: n }, (_, i) => Number(s[key]?.[i]) || 0);
  for (let i = Math.max(0, a); i < Math.min(n, b); i++) arr[i] = Math.round(Math.min(5000, Math.max(-2000, fn(arr[i]))));
  if (arr.some((v) => v)) s[key] = arr; else delete s[key];
}

// 点の変形関数 f で文字を動かす(枠の3点から新しい行列を作る。リグ・自由変形用)
export function deformText(s, f) {
  const { w, h } = textLayout(s);
  const m = textMatrix(s);
  const o = f(...Object.values(applyM(m, 0, 0))), x = f(...Object.values(applyM(m, w, 0))), y = f(...Object.values(applyM(m, 0, h)));
  return { ...s, m: [(x.x - o.x) / w, (x.y - o.y) / w, (y.x - o.x) / h, (y.y - o.y) / h, o.x, o.y] };
}
