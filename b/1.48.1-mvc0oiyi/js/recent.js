// 色の使用履歴(カラーパネルの「最近使った色」)
//   描いた・塗った・線と塗りで変えた色を新しい順に残す(同じ色は先頭へ)。次回も使える
import { applySwatch } from './paint.js';
import { state, on, emit } from './state.js';
import { parseHex, toHex, toHex8, toCss } from './color.js';

const KEY = 'pixelrig.recentColors';
const MAX = 24;
let list = [];
try { const v = JSON.parse(localStorage.getItem(KEY)); if (Array.isArray(v)) list = v.filter((x) => typeof x === 'string').slice(0, MAX); } catch { /* なし */ }

// c: {r,g,b,a} か '#rrggbb[aa]'
export function useColor(c) {
  if (!c) return;
  const hex = typeof c === 'string' ? toHex8(parseHex(c)) : toHex8(c);
  if (list[0] === hex) return;
  list = [hex, ...list.filter((x) => x !== hex)].slice(0, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* 保存できなくても動く */ }
  emit('recent');
}

export const recentColors = () => [...list];

export function initRecentPanel() {
  const box = document.getElementById('recent-colors');
  if (!box) return;
  const render = () => {
    box.innerHTML = '';
    if (!list.length) {
      box.innerHTML = '<span class="recent-empty">使った色がここに並びます</span>';
      return;
    }
    for (const hex of list) {
      const c = parseHex(hex);
      const b = document.createElement('button');
      b.className = 'pal-swatch recent-swatch';
      b.style.setProperty('--c', toCss(c));
      b.title = `${c.a === 255 ? toHex(c) : hex}\nクリック: 選んでいる図形の塗り(線と塗りパネルで選んだ方)/ 図形がなければメイン\n右クリック: 反対の方 / 図形がなければサブ`;
      // 図形を選んでいれば、その図形の色をすぐ変える(線と塗りパネルで選んでいる方)
      b.onclick = () => { if (!applySwatch(toHex(c))) { state.primary = c; emit('colors'); } };
      b.oncontextmenu = (e) => { e.preventDefault(); if (!applySwatch(toHex(c), true)) { state.secondary = c; emit('colors'); } };
      box.append(b);
    }
  };
  on('recent', render);
  render();
}
