// アニメーションGIFエンコーダ(外部ライブラリなし)
// GIF は 256 色・透明は1色(オン/オフ)のみ。アルファ 128 未満を透明として扱う。
import { medianCut } from './imageproc.js';

// frames: [{ img: ImageData, delay: ms }]、全フレーム同じサイズ
export function encodeGif(frames, { loop = 0 } = {}) {
  const W = frames[0].img.width, H = frames[0].img.height;
  const { palette, hasTransparent } = buildPalette(frames);
  const transIndex = hasTransparent ? 0 : -1;

  // パレットサイズは 2 の累乗(最低 4 色)
  let bits = 2;
  while (1 << bits < palette.length) bits++;
  const size = 1 << bits;

  const out = new ByteWriter();
  out.str('GIF89a');
  out.u16(W); out.u16(H);
  out.byte(0x80 | ((bits - 1) << 4) | (bits - 1)); // グローバルカラーテーブルあり
  out.byte(0); out.byte(0);
  for (let i = 0; i < size; i++) {
    const c = palette[i] || [0, 0, 0];
    out.byte(c[0]); out.byte(c[1]); out.byte(c[2]);
  }
  // ループ指定(NETSCAPE2.0 拡張)
  out.byte(0x21); out.byte(0xff); out.byte(11); out.str('NETSCAPE2.0');
  out.byte(3); out.byte(1); out.u16(loop); out.byte(0);

  const lookup = makeLookup(palette, hasTransparent);
  for (const f of frames) {
    // グラフィック制御拡張: 表示時間・透明色・前フレームを消す(disposal=2)
    out.byte(0x21); out.byte(0xf9); out.byte(4);
    out.byte((2 << 2) | (hasTransparent ? 1 : 0));
    out.u16(Math.max(2, Math.round(f.delay / 10)));
    out.byte(Math.max(0, transIndex)); out.byte(0);
    // イメージ記述子
    out.byte(0x2c); out.u16(0); out.u16(0); out.u16(W); out.u16(H); out.byte(0);
    const d = f.img.data;
    const idx = new Uint8Array(W * H);
    for (let p = 0, i = 0; p < idx.length; p++, i += 4) {
      idx[p] = d[i + 3] < 128 && hasTransparent ? 0 : lookup(d[i], d[i + 1], d[i + 2]);
    }
    lzw(out, idx, bits);
  }
  out.byte(0x3b);
  return out.bytes();
}

// 全フレームの色を集める。255色以内ならそのまま、超えたらメディアンカットで減色
function buildPalette(frames) {
  const colors = new Set();
  let hasTransparent = false;
  for (const f of frames) {
    const d = f.img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) { hasTransparent = true; continue; }
      if (colors.size <= 256) colors.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    }
  }
  const max = hasTransparent ? 255 : 256;
  let list;
  if (colors.size <= max) {
    list = [...colors].map((c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255]);
  } else {
    // 各フレームから間引いて集めた画素でメディアンカット
    const sample = [];
    for (const f of frames) {
      const d = f.img.data;
      const step = Math.max(1, Math.floor(d.length / 4 / (200000 / frames.length)));
      for (let p = 0; p < d.length / 4; p += step) {
        const i = p * 4;
        sample.push(d[i], d[i + 1], d[i + 2], d[i + 3]);
      }
    }
    list = medianCut({ data: sample }, max).map((c) => [c.r, c.g, c.b]);
  }
  if (!list.length) list.push([0, 0, 0]);
  return { palette: hasTransparent ? [[0, 0, 0], ...list] : list, hasTransparent };
}

function makeLookup(palette, hasTransparent) {
  const start = hasTransparent ? 1 : 0;
  const cache = new Map();
  return (r, g, b) => {
    const key = (r << 16) | (g << 8) | b;
    let v = cache.get(key);
    if (v !== undefined) return v;
    let bd = Infinity;
    for (let i = start; i < palette.length; i++) {
      const c = palette[i];
      const dr = c[0] - r, dg = c[1] - g, db = c[2] - b;
      const dist = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if (dist < bd) { bd = dist; v = i; }
    }
    cache.set(key, v);
    return v;
  };
}

// GIF 用 LZW 圧縮(可変長コード、最大 12bit)
function lzw(out, indices, minCodeSize) {
  out.byte(minCodeSize);
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let codeSize = minCodeSize + 1, next = eoi + 1;
  let table = new Map();
  const block = [];
  let cur = 0, shift = 0;
  const emit = (code) => {
    cur |= code << shift;
    shift += codeSize;
    while (shift >= 8) {
      block.push(cur & 255);
      cur >>>= 8;
      shift -= 8;
    }
  };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const code = table.get(key);
    if (code !== undefined) { prefix = code; continue; }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      next = eoi + 1;
      codeSize = minCodeSize + 1;
      table = new Map();
    } else {
      if (next >= 1 << codeSize) codeSize++;
      table.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (shift > 0) block.push(cur & 255);
  // 255バイトごとのサブブロックに分ける
  for (let i = 0; i < block.length; i += 255) {
    const n = Math.min(255, block.length - i);
    out.byte(n);
    for (let j = 0; j < n; j++) out.byte(block[i + j]);
  }
  out.byte(0);
}

class ByteWriter {
  constructor() {
    this.buf = new Uint8Array(1 << 16);
    this.len = 0;
  }
  byte(b) {
    if (this.len >= this.buf.length) {
      const n = new Uint8Array(this.buf.length * 2);
      n.set(this.buf);
      this.buf = n;
    }
    this.buf[this.len++] = b;
  }
  u16(v) { this.byte(v & 255); this.byte((v >> 8) & 255); }
  str(s) { for (const ch of s) this.byte(ch.charCodeAt(0)); }
  bytes() { return this.buf.slice(0, this.len); }
}
