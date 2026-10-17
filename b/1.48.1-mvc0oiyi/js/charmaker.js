// キャラメーカー: 64×64 のドット絵キャラを、パーツの形 → 光の向きで陰影 → 輪郭線、の順に組み立てる(AI なし・毎回同じ結果)
//   renderCharacter(opts, view, frame) → ImageData(64×64)
//   view: front / side(右向き)/ back / left(右向きを反転)。アニメ: idle(待機 4コマ)/ walk(歩き 4コマ)
//   しくみ:
//     1) パーツ = 形(楕円・カプセル・多角形と、その組み合わせ)+ 素材(肌・髪・服…)+ 重なり順 z。画素の中心で形を判定して、いちばん手前のパーツを決める
//     2) 陰影: パーツの形から面の向き(法線)を出し、左上からの光との内積で 4段(ハイライト・ベース・影・濃い影)。手前のパーツの真下は影(髪の下の顔など)
//     3) 輪郭: 外側のふちは素材ごとの濃い色(色つき輪郭)、パーツどうしの境目は奥のパーツ側を少し暗く
//     4) 目・口などの小さな部分は、ドットの型を上から置く
export const CHAR_SIZE = 64;

export const CHAR_OPTIONS = {
  body: { chibi: 'ちび(2頭身)', normal: 'ふつう(4頭身)' },
  hair: { short: 'ショート', spiky: 'ツンツン', bob: 'ボブ', long: 'ロング', ponytail: 'ポニーテール', twintails: 'ツインテール', bald: 'なし' },
  eyes: { big: '大きい目', normal: 'ふつうの目', narrow: '細い目', closed: '閉じた目' },
  mouth: { smile: 'にっこり', neutral: 'ふつう', open: '開いた口' },
  top: { shirt: 'シャツ', jacket: '上着', robe: 'ローブ', armor: 'よろい' },
  bottom: { pants: 'ズボン', shorts: '半ズボン', skirt: 'スカート' },
  hat: { none: 'なし', wizard: 'とんがり帽子', cap: 'キャップ', headband: 'はちまき', crown: '王冠' },
  item: { none: 'なし', sword: '剣', staff: '杖', shield: '盾', swordShield: '剣と盾' },
  outline: { color: '色つき輪郭', black: '黒い輪郭', none: '輪郭なし' },
};
export const CHAR_VIEWS = { front: '正面', side: '右向き', left: '左向き', back: '後ろ' };
export const CHAR_ANIMS = { none: '止め絵', idle: '待機(4コマ)', walk: '歩き(4コマ)' };
const ANIM_FRAMES = { none: 1, idle: 4, walk: 4 };
export const animFrames = (a) => ANIM_FRAMES[a] || 1;

export const CHAR_COLORS = { skin: '肌', hair: '髪', eyes: '目', top: '上の服', bottom: '下の服', shoes: '靴', accent: '飾り・金属', hat: '帽子' };

export const CHAR_DEFAULTS = {
  body: 'chibi', hair: 'short', eyes: 'big', mouth: 'smile', top: 'shirt', bottom: 'pants', hat: 'none', item: 'none', outline: 'color', blush: false,
  colors: { skin: '#f2c29b', hair: '#6b3f22', eyes: '#2f5fbf', top: '#3b82c4', bottom: '#4a4a63', shoes: '#5a3a24', accent: '#c9ced6', hat: '#5b3fa8' },
};

export const CHAR_PRESETS = {
  hero: { label: '剣士', hair: 'spiky', top: 'jacket', bottom: 'pants', item: 'swordShield', hat: 'headband', colors: { hair: '#c0392b', top: '#2c6fbb', bottom: '#3d3d52', shoes: '#6b4226', accent: '#d8dde4', hat: '#e8e8e8', eyes: '#2e5aa8' } },
  mage: { label: '魔法使い', hair: 'long', top: 'robe', bottom: 'pants', item: 'staff', hat: 'wizard', colors: { hair: '#e8d9a8', top: '#5b3fa8', hat: '#4a3290', accent: '#f2c14e', eyes: '#3fa86b', shoes: '#3b2a4a' } },
  knight: { label: '騎士', hair: 'short', top: 'armor', bottom: 'pants', item: 'swordShield', colors: { hair: '#3a2a1e', top: '#8a2b2b', bottom: '#4a4a55', accent: '#c9ced6', shoes: '#55585f', eyes: '#3a3a3a' } },
  villager: { label: '村人', hair: 'bob', top: 'shirt', bottom: 'skirt', mouth: 'smile', blush: true, colors: { hair: '#8a5a2b', top: '#e2b04a', bottom: '#4f7f3a', shoes: '#6b4226', eyes: '#5a3a1a' } },
  princess: { label: 'お姫さま', hair: 'long', top: 'robe', hat: 'crown', blush: true, colors: { hair: '#f2d06b', top: '#e86fa5', accent: '#f2c14e', hat: '#f2c14e', eyes: '#3a7fd5', shoes: '#c94d86' } },
  ninja: { label: 'しのび', hair: 'ponytail', eyes: 'narrow', mouth: 'neutral', top: 'jacket', bottom: 'pants', hat: 'headband', item: 'sword', colors: { hair: '#2a2a35', top: '#2f3542', bottom: '#2f3542', hat: '#c0392b', accent: '#c9ced6', shoes: '#1e1e26', eyes: '#3a3a3a' } },
};

// ---- 色(HSL で明るさ・色相をずらして 5段の色を作る)----

function hexToRgb(h) {
  const s = String(h).replace('#', '');
  const f = s.length === 3 ? s.split('').map((c) => c + c).join('') : s.slice(0, 6);
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
}
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hslToRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return s === 0 ? [l * 255, l * 255, l * 255].map(Math.round) : [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255));
}
const clamp01 = (v) => Math.min(1, Math.max(0, v));
// 影は青紫へ、ハイライトは黄色へ色相を少し回す(ドット絵の定番)
function shift(hsl, dl, toward, amt, ds = 0) {
  let [h, s, l] = hsl;
  let d = ((toward - h + 540) % 360) - 180;
  h += Math.sign(d) * Math.min(Math.abs(d), amt * (s > 0.08 ? 1 : 0));
  return hslToRgb([h, clamp01(s + ds), clamp01(l + dl)]);
}
export function ramp(hex) {
  const hsl = rgbToHsl(hexToRgb(hex));
  // 鮮やかな明るい色(肌など)は、影で彩度が上がりすぎないようにする
  const warm = hsl[1] > 0.45 && hsl[2] > 0.6;
  return {
    h: shift(hsl, 0.1, 55, 6, -0.05),
    b: hexToRgb(hex),
    s: shift(hsl, -0.11, 250, warm ? 6 : 10, warm ? -0.12 : 0),
    d: shift(hsl, -0.22, 250, warm ? 10 : 18, warm ? -0.15 : 0.02),
    o: shift(hsl, -Math.max(0.3, hsl[2] - 0.14), 250, 20, warm ? -0.2 : 0.05),
  };
}

// ---- 形 ----

const ell = (cx, cy, rx, ry) => ({
  test: (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1,
  normal: (x, y) => { const nx = (x - cx) / rx, ny = (y - cy) / ry; return [nx, ny, Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))]; },
});
function cap(ax, ay, bx, by, r) {
  const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1e-9;
  const near = (x, y) => { const t = Math.min(1, Math.max(0, ((x - ax) * vx + (y - ay) * vy) / L2)); return [x - (ax + vx * t), y - (ay + vy * t)]; };
  return {
    test: (x, y) => { const [dx, dy] = near(x, y); return dx * dx + dy * dy <= r * r; },
    normal: (x, y) => { const [dx, dy] = near(x, y); const nx = dx / r, ny = dy / r; return [nx, ny, Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))]; },
  };
}
function poly(pts) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const cx = (x0 + x1) / 2, hw = Math.max(1, (x1 - x0) / 2);
  return {
    test: (x, y) => {
      if (x < x0 || x > x1 || y < y0 || y > y1) return false;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    },
    // 縦の筒のように丸く見せる
    normal: (x, y) => { const nx = ((x - cx) / hw) * 0.85, ny = ((y - (y0 + y1) / 2) / Math.max(1, (y1 - y0) / 2)) * 0.25; return [nx, ny, Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))]; },
  };
}
const and = (a, f) => ({ test: (x, y) => a.test(x, y) && f(x, y), normal: a.normal });
const not = (a, b) => ({ test: (x, y) => a.test(x, y) && !b.test(x, y), normal: a.normal });
const or = (...list) => ({ test: (x, y) => list.some((s) => s.test(x, y)), normal: (x, y) => (list.find((s) => s.test(x, y)) || list[0]).normal(x, y) });
const flat = (s, n = [0, 0, 1]) => ({ test: s.test, normal: () => n });
// 棒(剣・杖): 根元 (x, y) から角度 a(度、0 = 上、時計回り)に長さ len・太さ w
function stick(x, y, a, len, w, tip = false) {
  const r = (a * Math.PI) / 180, dx = Math.sin(r), dy = -Math.cos(r), px = -dy * (w / 2), py = dx * (w / 2);
  const ex = x + dx * len, ey = y + dy * len;
  const pts = tip ? [[x + px, y + py], [ex + px, ey + py], [ex + dx * w, ey + dy * w], [ex - px, ey - py], [x - px, y - py]] : [[x + px, y + py], [ex + px, ey + py], [ex - px, ey - py], [x - px, y - py]];
  return poly(pts);
}

// ---- 体の寸法(64px)----

const BODY = {
  chibi: { head: [32, 21.5, 12.5, 12], torso: [32.5, 46], tw: [7.5, 8.5], shoulder: [7.2, 35.5], arm: 9.5, armR: 2.6, hand: 2.4, hip: [3.9, 46], leg: 10.5, legR: 3.1, foot: [3.8, 2.3] },
  normal: { head: [32, 11.5, 8, 8.5], torso: [19.5, 38.5], tw: [6.6, 6], shoulder: [6.6, 22.5], arm: 16.5, armR: 2.2, hand: 2, hip: [3.2, 38], leg: 19, legR: 2.8, foot: [3.4, 2] },
};

// アニメの1コマ: 体の上下(bob)、腕・脚の振り(-1〜1)、前から見た足の持ち上げ
function pose(anim, frame) {
  const f = frame % animFrames(anim);
  if (anim === 'walk') {
    const swing = [1, 0, -1, 0][f];
    return { bob: [0, -1, 0, -1][f], swing, liftL: [0, 0, 2, 0][f], liftR: [2, 0, 0, 0][f] };
  }
  if (anim === 'idle') return { bob: [0, 0, 1, 1][f], swing: 0, liftL: 0, liftR: 0, breathe: [0, 0, 1, 1][f] };
  return { bob: 0, swing: 0, liftL: 0, liftR: 0 };
}

// ---- パーツを組み立てる ----
// 戻り値: { parts: [{ shape, mat, z }], details: [{ x, y, rows, map, flipX }] }

function buildParts(o, view, frame) {
  const B = BODY[o.body] || BODY.chibi;
  const P = pose(o.anim, frame);
  const side = view === 'side', back = view === 'back';
  const parts = [];
  const add = (shape, mat, z) => parts.push({ shape, mat, z });
  const by = P.bob; // 体ごと上下
  const [hcx0, hcy0, hrx0, hry] = B.head;
  const hcx = hcx0 + (side ? 1 : 0), hcy = hcy0 + by, hrx = side ? hrx0 * 0.94 : hrx0;
  const [tTop, tBot] = [B.torso[0] + by, B.torso[1] + by];
  const tw = side ? [B.tw[0] * 0.72, B.tw[1] * 0.72] : B.tw;
  const cx = 32;
  const shY = B.shoulder[1] + by;
  const hipY = B.hip[1] + by;
  const ground = 61;

  // 腕: 前・後ろから見ると左右、横から見ると奥(far)と手前(near)
  const arms = [];
  if (side) {
    for (const [k, sgn, z] of [['far', -1, 2], ['near', 1, 24]]) {
      const a = sgn * P.swing * 0.55 + (o.item === 'staff' && k === 'near' ? -0.5 : 0);
      const sx = cx + (k === 'far' ? 1 : -0.5), sy = shY;
      arms.push({ k, sx, sy, ex: sx + Math.sin(a) * B.arm, ey: sy + Math.cos(a) * B.arm, z });
    }
  } else {
    for (const [k, sgn] of [['L', -1], ['R', 1]]) {
      const sw = (k === 'L' ? 1 : -1) * P.swing;
      const sx = cx + sgn * B.shoulder[0], sy = shY;
      const ex = sx + sgn * (o.body === 'chibi' ? 2.5 : 2) + (back ? 0 : 0), ey = sy + B.arm - Math.abs(sw) * 0.5 + (sw > 0 ? -0.5 : 0) + (P.breathe ? 0 : 0);
      arms.push({ k, sx, sy, ex: ex + sw * 0.6 * -sgn * 0, ey, z: 20 });
    }
  }
  // 脚
  const legs = [];
  if (side) {
    for (const [k, sgn, z] of [['far', 1, 3], ['near', -1, 12]]) {
      const a = sgn * P.swing * 0.5;
      const hx = cx + 0.5, hy = hipY;
      const L = ground - 2 - hy;
      legs.push({ k, hx, hy, ex: hx + Math.sin(a) * L, ey: Math.min(ground - 2, hy + Math.cos(a) * L), z });
    }
  } else {
    for (const [k, sgn] of [['L', -1], ['R', 1]]) {
      const lift = k === 'L' ? P.liftL : P.liftR;
      const hx = cx + sgn * B.hip[0], hy = hipY;
      legs.push({ k, hx, hy, ex: hx + sgn * 0.3, ey: ground - 2 - lift, z: 10 });
    }
  }

  // 脚・足
  for (const l of legs) {
    const legShape = cap(l.hx, l.hy, l.ex, l.ey, B.legR);
    const zl = l.z;
    if (o.top === 'robe') { /* ローブで隠れる(足先だけ) */ } else if (o.bottom === 'pants') add(legShape, 'bottom', zl);
    else if (o.bottom === 'shorts') {
      add(legShape, 'skin', zl);
      add(cap(l.hx, l.hy, l.hx + (l.ex - l.hx) * 0.45, l.hy + (l.ey - l.hy) * 0.45, B.legR + 0.5), 'bottom', zl + 0.5);
    } else add(legShape, 'skin', zl);
    const fwd = side ? 1.6 : 0;
    add(ell(l.ex + fwd, l.ey + 1.2, side ? B.foot[0] + 0.6 : B.foot[0], B.foot[1]), 'shoes', zl + 0.6);
  }

  // 胴
  const torso = poly([[cx - tw[0], tTop], [cx + tw[0], tTop], [cx + tw[1], tBot], [cx - tw[1], tBot]]);
  // 首(ふつうの体だけ見える)
  if (o.body === 'normal') add(cap(cx, hcy + hry - 2, cx, tTop + 1, 2), 'skin', 13);
  // 下の服(腰)
  if (o.top !== 'robe') {
    if (o.bottom === 'skirt') add(poly([[cx - tw[1] - 0.5, hipY - 2], [cx + tw[1] + 0.5, hipY - 2], [cx + tw[1] + 3.5, hipY + 7], [cx - tw[1] - 3.5, hipY + 7]]), 'bottom', 16);
    else add(poly([[cx - tw[1], hipY - 2], [cx + tw[1], hipY - 2], [cx + tw[1] + 0.3, hipY + 2.5], [cx - tw[1] - 0.3, hipY + 2.5]]), 'bottom', 14);
  }
  if (o.top === 'robe') {
    // 裾の広いローブ(足先まで)
    add(poly([[cx - tw[0], tTop], [cx + tw[0], tTop], [cx + tw[1] + (side ? 3 : 5), ground - 2.5], [cx - tw[1] - (side ? 3 : 5), ground - 2.5]]), 'top', 15);
    add(flat(poly([[cx - 1, tTop + 2], [cx + 1, tTop + 2], [cx + 1, ground - 3], [cx - 1, ground - 3]])), 'accent', back || side ? -99 : 15.5);
  } else {
    add(torso, o.top === 'armor' ? 'accent' : 'top', 15);
    if (o.top === 'jacket' && !back) add(flat(poly(side ? [[cx + tw[0] - 2, tTop + 1], [cx + tw[0], tTop + 1], [cx + tw[1], tBot], [cx + tw[1] - 2.2, tBot]] : [[cx - 1.4, tTop + 1], [cx + 1.4, tTop + 1], [cx + 1.6, tBot], [cx - 1.6, tBot]])), 'accent', 15.5);
    if (o.top === 'armor') add(poly([[cx - tw[1], tBot - 2.5], [cx + tw[1], tBot - 2.5], [cx + tw[1], tBot], [cx - tw[1], tBot]]), 'shoes', 15.6); // ベルト
  }
  if (o.bottom !== 'skirt' && o.top !== 'robe' && o.top !== 'armor') add(flat(poly([[cx - tw[1], tBot - 1.4], [cx + tw[1], tBot - 1.4], [cx + tw[1], tBot + 0.4], [cx - tw[1], tBot + 0.4]])), 'shoes', 15.7);

  // 腕・手・袖
  for (const a of arms) {
    const z = a.z;
    const sleeve = o.top === 'shirt' ? 'half' : 'full';
    const armShape = cap(a.sx, a.sy, a.ex, a.ey, B.armR);
    add(armShape, sleeve === 'full' ? 'top' : 'skin', z);
    if (sleeve === 'half') add(cap(a.sx, a.sy, a.sx + (a.ex - a.sx) * 0.45, a.sy + (a.ey - a.sy) * 0.45, B.armR + 0.4), 'top', z + 0.2);
    if (o.top === 'robe') add(cap(a.sx, a.sy, a.ex, a.ey - 0.8, B.armR + 0.9), 'top', z + 0.1); // 広い袖
    if (o.top === 'armor') add(ell(a.sx + (side ? 0 : Math.sign(a.sx - cx) * 0.8), a.sy - 0.2, B.armR + 1.6, B.armR + 0.9), 'accent', z + 0.3);
    add(ell(a.ex, a.ey + 0.5, B.hand, B.hand), 'skin', z + 0.4);
    a.hand = { x: a.ex, y: a.ey + 0.5 };
  }

  // 頭
  const head = ell(hcx, hcy, hrx, hry);
  add(head, 'skin', 30);
  if (side) add(ell(hcx + hrx - 0.6, hcy + hry * 0.25, 1.3, 1.3), 'skin', 30.1); // 鼻
  // 髪
  addHair(o, add, { cx: hcx, cy: hcy, rx: hrx, ry: hry, view, tTop, shY, B, body: o.body });
  // 帽子
  addHat(o, add, { cx: hcx, cy: hcy, rx: hrx, ry: hry, view });
  // 持ち物
  addItems(o, add, { arms, view, cx, tTop, tBot, B });

  // 顔
  const details = [];
  if (!back) addFace(o, details, { cx: hcx, cy: hcy, rx: hrx, ry: hry, side });
  return { parts, details };
}

function addHair(o, add, { cx, cy, rx, ry, view, shY, body }) {
  const side = view === 'side', back = view === 'back';
  const h = o.hair;
  if (h === 'bald') return;
  const shell = ell(cx - (side ? 1 : 0), cy - 0.6, rx + 1.3, ry + 1.3);
  // 後ろ髪(体の後ろ)
  const longBack = () => {
    const len = body === 'chibi' ? 15 : 20;
    if (back) return add(poly([[cx - rx - 1.5, cy], [cx + rx + 1.5, cy], [cx + rx - 0.5, cy + len], [cx - rx + 0.5, cy + len]]), 'hair', 32);
    add(poly(side ? [[cx - rx - 1.3, cy - 2], [cx + 1, cy - 2], [cx - 1, cy + len], [cx - rx - 2, cy + len - 1]] : [[cx - rx - 1.5, cy], [cx + rx + 1.5, cy], [cx + rx + 0.5, cy + len], [cx - rx - 0.5, cy + len]]), 'hair', side ? 1 : 1);
  };
  if (h === 'long') longBack();
  if (back) {
    add(and(shell, (x, y) => y < cy + ry * 0.62), 'hair', 31);
    if (h === 'ponytail') add(cap(cx, cy - ry * 0.2, cx, cy + ry * 1.3, 2.8), 'hair', 33);
    if (h === 'twintails') for (const s of [-1, 1]) add(cap(cx + s * (rx * 0.75), cy - ry * 0.3, cx + s * (rx + 3), cy + ry * 1.35, 3), 'hair', 33);
    if (h === 'spiky') spikes(add, cx, cy, rx, ry, view);
    if (h === 'bob') add(and(ell(cx, cy, rx + 1.8, ry + 1.3), (x, y) => y < cy + ry * 0.8), 'hair', 30.9);
    return;
  }
  if (side) {
    // 頭のてっぺんと後ろ半分、前髪は額の前に少し
    add(and(shell, (x, y) => y < cy - ry * 0.18 || (x < cx - rx * 0.15 && y < cy + ry * (h === 'short' || h === 'spiky' ? 0.45 : 0.75))), 'hair', 31);
    add(poly([[cx + rx * 0.2, cy - ry * 0.75], [cx + rx + 1.6, cy - ry * 0.45], [cx + rx + 0.4, cy - ry * 0.05], [cx + rx * 0.55, cy - ry * 0.12]]), 'hair', 31.2);
    if (h === 'bob') add(and(ell(cx - 1.5, cy, rx + 1.2, ry + 1.2), (x, y) => x < cx - rx * 0.05 && y < cy + ry * 0.85), 'hair', 31.1);
    if (h === 'ponytail') add(cap(cx - rx * 0.9, cy - ry * 0.25, cx - rx - 5, cy + ry * 1.0, 2.8), 'hair', 29);
    if (h === 'twintails') add(cap(cx - rx * 0.6, cy - ry * 0.25, cx - rx - 2, cy + ry * 1.35, 3), 'hair', 29);
    if (h === 'spiky') spikes(add, cx, cy, rx, ry, view);
    if (h === 'long') add(and(ell(cx - 1.5, cy, rx + 1.2, ry + 1.2), (x, y) => x < cx - rx * 0.1), 'hair', 31.1);
    return;
  }
  // 正面: 頭の上 + 前髪(ギザギザ)
  add(and(shell, (x, y) => y < cy - ry * 0.25), 'hair', 31);
  const n = 5, top = cy - ry * 0.3, xs = cx - rx - 1, xe = cx + rx + 1, w = (xe - xs) / n;
  const pts = [[xs, top - 1]];
  for (let i = 0; i <= n; i++) {
    const x = xs + i * w;
    const deep = h === 'spiky' ? 0.18 : h === 'bob' || h === 'long' ? 0.08 : 0.02;
    pts.push([x, cy - ry * (i % 2 ? 0.28 : -deep) + (i === 0 || i === n ? ry * 0.1 : 0)]);
  }
  pts.push([xe, top - 1]);
  add(poly(pts), 'hair', 31.2);
  if (h === 'bob' || h === 'long') for (const s of [-1, 1]) add(cap(cx + s * (rx - 0.3), cy - ry * 0.3, cx + s * (rx + 0.2), cy + ry * (h === 'long' ? 0.95 : 0.6), 2.4), 'hair', 31.1);
  if (h === 'twintails') for (const s of [-1, 1]) {
    add(cap(cx + s * (rx + 0.5), cy - ry * 0.45, cx + s * (rx + 3.2), cy + ry * 1.3, 3.1), 'hair', 2);
    add(flat(ell(cx + s * (rx + 0.8), cy - ry * 0.45, 1.7, 1.7)), 'accent', 31.5);
  }
  if (h === 'ponytail') add(ell(cx + rx * 0.8, cy - ry * 0.75, 3, 3), 'hair', 29);
  if (h === 'spiky') spikes(add, cx, cy, rx, ry, view);
  if (h === 'short' || h === 'spiky') for (const s of [-1, 1]) add(cap(cx + s * (rx - 0.2), cy - ry * 0.35, cx + s * (rx - 0.2), cy + ry * 0.05, 1.6), 'hair', 31.1); // もみあげ
}

function spikes(add, cx, cy, rx, ry, view) {
  const side = view === 'side';
  const list = side
    ? [[-0.9, -0.6, -1.6, -0.9], [-0.4, -0.95, -0.7, -1.45], [0.2, -1.0, 0.4, -1.5], [-1.0, -0.1, -1.7, 0.1]]
    : [[-0.85, -0.55, -1.35, -0.95], [-0.4, -0.95, -0.55, -1.5], [0.1, -1.0, 0.15, -1.6], [0.55, -0.9, 0.75, -1.45], [0.9, -0.5, 1.4, -0.85]];
  for (const [ax, ay, bx, by] of list) {
    const x0 = cx + ax * rx, y0 = cy + ay * ry, x1 = cx + bx * rx, y1 = cy + by * ry;
    const nx = -(y1 - y0), ny = x1 - x0, l = Math.hypot(nx, ny) || 1;
    const k = 3 / l;
    add(poly([[x0 + nx * k, y0 + ny * k], [x1, y1], [x0 - nx * k, y0 - ny * k]]), 'hair', 31.3);
  }
}

function addHat(o, add, { cx, cy, rx, ry, view }) {
  const side = view === 'side';
  if (o.hat === 'wizard') {
    add(ell(cx, cy - ry * 0.55, rx + 5, 2.8), 'hat', 34);
    add(poly(side ? [[cx - rx * 0.8, cy - ry * 0.55], [cx + rx * 0.8, cy - ry * 0.55], [cx - rx * 0.9, cy - ry * 1.9]] : [[cx - rx * 0.8, cy - ry * 0.55], [cx + rx * 0.8, cy - ry * 0.55], [cx + rx * 0.5, cy - ry * 1.95]]), 'hat', 34.2);
    add(flat(poly([[cx - rx * 0.78, cy - ry * 0.8], [cx + rx * 0.78, cy - ry * 0.8], [cx + rx * 0.74, cy - ry * 0.62], [cx - rx * 0.74, cy - ry * 0.62]])), 'accent', 34.3);
  } else if (o.hat === 'cap') {
    add(and(ell(cx, cy - 0.4, rx + 1.5, ry + 1.5), (x, y) => y < cy - ry * 0.35), 'hat', 34);
    if (view !== 'back') add(ell(side ? cx + rx * 0.8 : cx, cy - ry * 0.35, side ? 5 : rx * 0.75, 1.5), 'hat', 34.1);
  } else if (o.hat === 'headband') {
    add(flat(and(ell(cx, cy, rx + 1.6, ry + 1.6), (x, y) => y > cy - ry * 0.62 && y < cy - ry * 0.42)), 'hat', 34);
    if (view === 'back' || side) add(cap(cx - (side ? rx : 0), cy - ry * 0.5, cx - (side ? rx + 5 : -2), cy + ry * 0.1, 1.2), 'hat', view === 'back' ? 34.1 : 29);
  } else if (o.hat === 'crown') {
    // 頭の上に突き出す王冠 + 赤い宝石
    const y0 = cy - ry * 1.02, w = rx * 0.62;
    add(poly([[cx - w, y0 + 3], [cx - w, y0 - 4], [cx - w / 2, y0 - 1], [cx, y0 - 5.5], [cx + w / 2, y0 - 1], [cx + w, y0 - 4], [cx + w, y0 + 3]]), 'accent', 34);
    if (view !== 'back') add(flat(ell(cx + (side ? 2 : 0), y0 + 0.8, 1.3, 1.3)), 'gem', 34.1);
  }
}

function addItems(o, add, { arms, view, cx, tTop, tBot, B }) {
  const side = view === 'side', back = view === 'back';
  const sword = o.item === 'sword' || o.item === 'swordShield';
  const shield = o.item === 'shield' || o.item === 'swordShield';
  // 剣・杖を持つ手: 正面 = 画面の左(キャラの右手)、横 = 手前の手、後ろ = 画面の右
  const handArm = side ? arms.find((a) => a.k === 'near') : back ? arms.find((a) => a.k === 'R') : arms.find((a) => a.k === 'L');
  const otherArm = side ? arms.find((a) => a.k === 'far') : back ? arms.find((a) => a.k === 'L') : arms.find((a) => a.k === 'R');
  const zFront = back ? 1 : 26;
  if (sword && handArm) {
    const { x, y } = handArm.hand;
    const a = side ? 40 : back ? 25 : -25;
    add(stick(x, y + 2, a + 180, 3.5, 2), 'wood', zFront);
    add(stick(x, y - 0.5, a + 90, 4, 1.6), 'accent', zFront + 0.1);
    add(stick(x - Math.sin((a * Math.PI) / 180) * 0, y - 0.5, a + 270, 4, 1.6), 'accent', zFront + 0.1);
    add(stick(x, y - 1, a, B === BODY.normal ? 16 : 14, 3, true), 'metal', zFront + 0.2);
  }
  if (o.item === 'staff' && handArm) {
    const { x, y } = handArm.hand;
    add(stick(x, y + 7, side ? 8 : 0, 32, 2), 'wood', zFront);
    const tx = x + (side ? Math.sin((8 * Math.PI) / 180) * 25 : 0), ty = y + 7 - 25;
    add(ell(tx, ty - 1, 3.2, 3.2), 'accent', zFront + 0.2);
  }
  if (shield && otherArm) {
    const { x, y } = otherArm.hand;
    if (side) add(ell(x + 1, y - 3, 2.2, 6.5), 'shield', 2.5);
    else if (back) add(ell(x - 2, y - 3, 6, 7), 'shield', 0.5);
    else {
      // 盾: 金属のふち + 木の面 + 十字の飾り
      const sh = [[x - 6, y - 11], [x + 7, y - 11], [x + 7, y - 1], [x + 0.5, y + 5], [x - 6, y - 1]];
      add(poly(sh), 'accent', 27);
      add(poly([[x - 4.5, y - 9.5], [x + 5.5, y - 9.5], [x + 5.5, y - 1.5], [x + 0.5, y + 3], [x - 4.5, y - 1.5]]), 'shield', 27.1);
      add(flat(poly([[x - 0.3, y - 9], [x + 1.3, y - 9], [x + 1.3, y + 2], [x - 0.3, y + 2]])), 'accent', 27.2);
      add(flat(poly([[x - 4, y - 5.5], [x + 5, y - 5.5], [x + 5, y - 4], [x - 4, y - 4]])), 'accent', 27.2);
    }
  }
}

// ---- 顔(ドットの型)----
// k = 目の輪郭、e = 目の色、w = 白い光、m = 口、p = ほほ
const EYES = {
  chibi: {
    big: ['.kk', 'kwe', 'kee', 'kee', '.kk'],
    normal: ['kk', 'we', 'ke'],
    narrow: ['kkk', '.ee'],
    closed: ['.k.', 'k.k'],
  },
  normal: {
    big: ['kk', 'we', 'ke'],
    normal: ['k', 'e'],
    narrow: ['kk'],
    closed: ['kk'],
  },
};
const MOUTHS = {
  smile: ['m..m', '.mm.'], neutral: ['mm'], open: ['mm', 'rr'],
};

function addFace(o, details, { cx, cy, rx, ry, side }) {
  const chibi = o.body !== 'normal';
  const eye = (EYES[chibi ? 'chibi' : 'normal'][o.eyes] || EYES.chibi.big);
  const ew = eye[0].length;
  const ey = Math.round(cy + ry * (chibi ? 0.02 : -0.05));
  if (side) {
    details.push({ x: Math.round(cx + rx * 0.42), y: ey, rows: eye, flipX: true });
  } else {
    const off = Math.round(rx * (chibi ? 0.42 : 0.4));
    details.push({ x: Math.round(cx - off - ew / 2), y: ey, rows: eye });
    details.push({ x: Math.round(cx + off - ew / 2), y: ey, rows: eye, flipX: true });
  }
  const mouth = MOUTHS[o.mouth] || MOUTHS.smile;
  const m = chibi ? mouth : [mouth[mouth.length > 1 && o.mouth === 'smile' ? 1 : 0].replace(/\./g, '').slice(0, 2)];
  const my = Math.round(cy + ry * (chibi ? 0.58 : 0.55));
  details.push({ x: Math.round(side ? cx + rx * 0.55 : cx - m[0].length / 2), y: my, rows: side ? [m[m.length - 1].replace(/\./g, '').slice(0, 2)] : m });
  if (o.blush && !side) {
    const by = ey + eye.length + (chibi ? 0 : 0);
    const off = Math.round(rx * 0.62);
    details.push({ x: Math.round(cx - off - 1), y: by, rows: ['pp'] });
    details.push({ x: Math.round(cx + off - 1), y: by, rows: ['pp'] });
  } else if (o.blush && side) details.push({ x: Math.round(cx + rx * 0.3), y: ey + eye.length, rows: ['pp'] });
}

// ---- 描く ----

const LIGHT = (() => { const v = [-0.42, -0.5, 0.76]; const l = Math.hypot(...v); return v.map((x) => x / l); })();
const FIXED = { wood: '#8a5a2e', metal: '#d4dae2', shield: '#9c5b2e', gem: '#d93a4a' };
const TONES = ['d', 's', 'b', 'h'];

export function characterOptions(opts = {}) {
  const preset = CHAR_PRESETS[opts.preset] || {};
  const o = { ...CHAR_DEFAULTS, ...preset, ...opts, colors: { ...CHAR_DEFAULTS.colors, ...(preset.colors || {}), ...(opts.colors || {}) } };
  for (const k of Object.keys(CHAR_OPTIONS)) if (!(o[k] in CHAR_OPTIONS[k])) o[k] = CHAR_DEFAULTS[k];
  if (!(o.anim in CHAR_ANIMS)) o.anim = 'none';
  for (const [k, v] of Object.entries(o.colors)) if (!/^#?[0-9a-f]{6}([0-9a-f]{2})?$/i.test(String(v))) o.colors[k] = CHAR_DEFAULTS.colors[k] || '#888888';
  o.blush = !!o.blush;
  return o;
}

export function renderCharacter(opts, view = 'front', frame = 0) {
  const o = characterOptions(opts);
  const flipAll = view === 'left';
  const v = flipAll ? 'side' : CHAR_VIEWS[view] ? view : 'front';
  const { parts, details } = buildParts(o, v, frame);
  parts.sort((a, b) => a.z - b.z);
  const N = CHAR_SIZE;
  const owner = new Int16Array(N * N).fill(-1);
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].z <= -50) continue;
    const s = parts[i].shape;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (s.test(x + 0.5, y + 0.5)) owner[y * N + x] = i;
  }
  const colorOf = (mat) => o.colors[mat] || FIXED[mat] || '#ff00ff';
  const ramps = new Map();
  const R = (mat) => { if (!ramps.has(mat)) ramps.set(mat, ramp(colorOf(mat))); return ramps.get(mat); };
  const at = (x, y) => (x < 0 || y < 0 || x >= N || y >= N ? -1 : owner[y * N + x]);
  const img = new ImageData(N, N);
  const put = (x, y, c, a = 255) => { const i = (y * N + x) * 4; img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = a; };
  const shiny = { hair: true, metal: true, accent: true, skin: false, shield: true };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = at(x, y);
      if (i < 0) continue;
      const p = parts[i];
      const [nx, ny, nz] = p.shape.normal(x + 0.5, y + 0.5);
      const len = Math.hypot(nx, ny, nz) || 1;
      const d = (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / len;
      let t = d > 0.86 && shiny[p.mat] ? 3 : d > 0.3 ? 2 : d > -0.12 ? 1 : 0;
      // 手前のパーツ(素材が違う)の真下は影
      for (const k of p.mat === 'skin' ? [1, 2] : [1]) {
        const j = at(x, y - k);
        if (j >= 0 && j !== i && parts[j].z > p.z && parts[j].mat !== p.mat) { t = Math.min(t, 1); break; }
      }
      const rp = R(p.mat);
      let c = rp[TONES[t]];
      // 輪郭: 外側のふち
      const n4 = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)];
      if (o.outline !== 'none' && n4.some((j) => j < 0)) c = o.outline === 'black' ? [20, 16, 28] : rp.o;
      // パーツの境目: 手前のパーツとの境は、奥のこちら側を暗く
      else if (n4.some((j) => j >= 0 && j !== i && parts[j].z > p.z + 0.05 && parts[j].mat !== p.mat)) c = p.mat === 'skin' ? rp.s : rp.d;
      put(x, y, c);
    }
  }
  // 目・口
  const skin = R('skin');
  const map = { k: hexToRgb('#1d1424'), e: R('eyes').b, w: [255, 255, 255], m: skin.o, r: [176, 64, 76], p: [240, 128, 140] };
  if (o.outline === 'black') map.k = [20, 16, 28];
  for (const dt of details) {
    dt.rows.forEach((row, j) => [...row].forEach((ch, i) => {
      const c = map[ch];
      if (!c) return;
      const xx = dt.x + (dt.flipX ? row.length - 1 - i : i), yy = dt.y + j;
      if (xx >= 0 && yy >= 0 && xx < N && yy < N && at(xx, yy) >= 0) put(xx, yy, c);
    }));
  }
  if (!flipAll) return img;
  const out = new ImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) out.data.set(img.data.subarray((y * N + x) * 4, (y * N + x) * 4 + 4), (y * N + (N - 1 - x)) * 4);
  return out;
}

// すべての向き × コマを並べたスプライトシート(行 = 向き、列 = コマ)
export function characterSheet(opts, views = ['front', 'left', 'side', 'back']) {
  const o = characterOptions(opts);
  const n = animFrames(o.anim), N = CHAR_SIZE;
  const out = new ImageData(N * n, N * views.length);
  views.forEach((v, r) => {
    for (let f = 0; f < n; f++) {
      const img = renderCharacter(o, v, f);
      for (let y = 0; y < N; y++) out.data.set(img.data.subarray(y * N * 4, (y + 1) * N * 4), ((r * N + y) * N * n + f * N) * 4);
    }
  });
  return out;
}

// ランダムなキャラ(種を決めると同じキャラ)
export function randomCharacter(seed = Math.floor(Math.random() * 1e9)) {
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
  const pick = (obj, skip = []) => { const k = Object.keys(obj).filter((x) => !skip.includes(x)); return k[Math.floor(rnd() * k.length)]; };
  const pal = (list) => list[Math.floor(rnd() * list.length)];
  return {
    body: rnd() < 0.7 ? 'chibi' : 'normal',
    hair: pick(CHAR_OPTIONS.hair, rnd() < 0.85 ? ['bald'] : []), eyes: pick(CHAR_OPTIONS.eyes), mouth: pick(CHAR_OPTIONS.mouth),
    top: pick(CHAR_OPTIONS.top), bottom: pick(CHAR_OPTIONS.bottom), hat: rnd() < 0.5 ? 'none' : pick(CHAR_OPTIONS.hat), item: pick(CHAR_OPTIONS.item),
    outline: 'color', blush: rnd() < 0.3,
    colors: {
      skin: pal(['#f2c29b', '#f6d2b2', '#e0ac7e', '#c68a5c', '#8d5a3b', '#f9dcc4']),
      hair: pal(['#2a2230', '#6b3f22', '#a0522d', '#e8c56a', '#c0392b', '#3b6fd1', '#e86fa5', '#e8e8e8', '#3fa86b', '#7a4fb5']),
      eyes: pal(['#2f5fbf', '#3fa86b', '#8a4b2a', '#7a4fb5', '#c0392b', '#2a2a35']),
      top: pal(['#3b82c4', '#c0392b', '#2f9e5a', '#e2b04a', '#7a4fb5', '#e86fa5', '#2f3542', '#e8e8e8', '#d97b2b']),
      bottom: pal(['#4a4a63', '#2f3542', '#6b4a2b', '#3b5b8c', '#5b3f2b', '#2f6b4a']),
      shoes: pal(['#5a3a24', '#2a2230', '#6b4226', '#8a2b2b']),
      accent: pal(['#c9ced6', '#f2c14e', '#e8e8e8']),
      hat: pal(['#5b3fa8', '#c0392b', '#2c6fbb', '#e8e8e8', '#2f9e5a']),
    },
  };
}
