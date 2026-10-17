// APNG(動く PNG)エンコーダ(外部ライブラリなし)。半透明もそのまま出せる(GIF は 256色・透明は2値)
//   const enc = apngEncoder(w, h); await enc.add(imageData, 時間ms); …; const bytes = await enc.finish({ loop, trim })
//   ・フレームごとに「絵のある範囲」だけを入れる(透明な所は入れない)ので軽い
//   ・前のフレームと同じ絵なら、時間を足すだけ
//   ・trim: 全フレームを通して透明な余白を切り取る
//   圧縮は CompressionStream('deflate')(zlib 形式)。フィルターは行ごとに Sub(左との差)

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = new Uint8Array(12 + data.length), v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
async function deflate(u8) {
  const cs = new CompressionStream('deflate');
  const w = cs.writable.getWriter();
  w.write(u8); w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

// 絵のある範囲(アルファ > 0)。なければ null
export function alphaBounds(img) {
  const { width: W, height: H, data: d } = img;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    const row = y * W * 4;
    let l = -1, r = -1;
    for (let x = 0; x < W; x++) if (d[row + x * 4 + 3]) { l = x; break; }
    if (l < 0) continue;
    for (let x = W - 1; x >= l; x--) if (d[row + x * 4 + 3]) { r = x; break; }
    if (l < x0) x0 = l;
    if (r > x1) x1 = r;
    if (y < y0) y0 = y;
    y1 = y;
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// 範囲を PNG の走査線(行頭にフィルター番号 1 = Sub)にして圧縮
function packRegion(img, r) {
  const W = img.width, d = img.data, stride = r.w * 4;
  const raw = new Uint8Array((stride + 1) * r.h);
  for (let y = 0; y < r.h; y++) {
    const src = ((r.y + y) * W + r.x) * 4, dst = y * (stride + 1);
    raw[dst] = 1;
    for (let i = 0; i < stride; i++) raw[dst + 1 + i] = (d[src + i] - (i >= 4 ? d[src + i - 4] : 0)) & 0xff;
  }
  return deflate(raw);
}

function sameRegion(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function apngEncoder(W, H) {
  let first = null; // 最初のフレームは最後に(切り取る範囲が決まってから)圧縮する
  const frames = []; // { r, data, delay }
  let lastZ = null, lastR = null, union = null;
  const grow = (r) => {
    if (!r) return;
    if (!union) { union = { ...r }; return; }
    const x1 = Math.max(union.x + union.w, r.x + r.w), y1 = Math.max(union.y + union.h, r.y + r.h);
    union.x = Math.min(union.x, r.x); union.y = Math.min(union.y, r.y); union.w = x1 - union.x; union.h = y1 - union.y;
  };
  return {
    get count() { return frames.length; },
    async add(img, delay) {
      if (img.width !== W || img.height !== H) throw new Error('フレームの大きさがそろっていません');
      const b = alphaBounds(img);
      grow(b);
      if (!first) {
        first = new ImageData(new Uint8ClampedArray(img.data), W, H);
        frames.push({ r: b, data: null, delay });
        lastZ = null; lastR = b;
        return;
      }
      const z = b ? await packRegion(img, b) : new Uint8Array(0);
      const prev = frames[frames.length - 1];
      // 前と同じ絵 → 時間を足すだけ(最初のフレームとは比べない)
      if (frames.length > 1 && lastZ && ((!b && !lastR) || (b && lastR && b.x === lastR.x && b.y === lastR.y && b.w === lastR.w && b.h === lastR.h && sameRegion(z, lastZ)))) { prev.delay += delay; return; }
      frames.push({ r: b, data: z, delay });
      lastZ = z; lastR = b;
    },
    // loop: 0 = ずっと、n = n 回
    async finish({ loop = 0, trim = false } = {}) {
      if (!first) throw new Error('フレームがありません');
      const area = trim && union ? union : { x: 0, y: 0, w: W, h: H };
      const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])];
      const ihdr = new Uint8Array(13), iv = new DataView(ihdr.buffer);
      iv.setUint32(0, area.w); iv.setUint32(4, area.h); ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
      parts.push(chunk('IHDR', ihdr));
      const actl = new Uint8Array(8), av = new DataView(actl.buffer);
      av.setUint32(0, frames.length); av.setUint32(4, loop);
      parts.push(chunk('acTL', actl));
      let seq = 0;
      const empty = await deflate(new Uint8Array([0, 0, 0, 0, 0])); // 透明な 1×1(フィルター 0)
      for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        // 最初のフレームは画像全体(決まり)。ほかは絵のある範囲だけ。空なら左上の 1×1
        const r = i === 0 ? area : f.r || { x: area.x, y: area.y, w: 1, h: 1 };
        const data = i === 0 ? await packRegion(first, area) : f.r ? f.data : empty;
        const fc = new Uint8Array(26), fv = new DataView(fc.buffer);
        fv.setUint32(0, seq++); fv.setUint32(4, r.w); fv.setUint32(8, r.h); fv.setUint32(12, r.x - area.x); fv.setUint32(16, r.y - area.y);
        fv.setUint16(20, Math.max(1, Math.round(f.delay))); fv.setUint16(22, 1000);
        fc[24] = 1; fc[25] = 0; // 次の前に透明に戻す / 上書き
        parts.push(chunk('fcTL', fc));
        if (i === 0) parts.push(chunk('IDAT', data));
        else {
          const fd = new Uint8Array(4 + data.length);
          new DataView(fd.buffer).setUint32(0, seq++);
          fd.set(data, 4);
          parts.push(chunk('fdAT', fd));
        }
      }
      parts.push(chunk('IEND', new Uint8Array(0)));
      const total = parts.reduce((a, p) => a + p.length, 0);
      const out = new Uint8Array(total);
      let o = 0;
      for (const p of parts) { out.set(p, o); o += p.length; }
      return { bytes: out, width: area.w, height: area.h, frames: frames.length };
    },
  };
}
