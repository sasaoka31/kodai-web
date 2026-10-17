// 変形のくり返し(Ctrl+D。イラレと同じ): 直前の 移動・拡大縮小・回転・反転 を、今選んでいる図形にもう一度。
//   直前が「複製しながら」(Ctrl+ドラッグ・反転のコピー)なら、複製しながらくり返す = 同じだけずらしたコピーが並ぶ(等間隔に並べるのに使う)
//   記録するのは select.js(ドラッグ・矢印キー)と reflect.js(反転のボタン)。t = { kind: 'move', dx, dy } | { kind: 'scale', sx, sy, u, v }(u, v = 枠の中の基準点の割合)
//     | { kind: 'rotate', a }(枠の真ん中で)| { kind: 'flip', axis }。どれも copy(複製しながら)を持つ
import { state, toast, emit } from './state.js';

let last = null;
export const recordTransform = (t) => { last = t; };
export const lastTransform = () => last;

export async function repeatTransform() {
  if (!last) { toast('くり返す変形がありません(移動・拡大縮小・回転・反転のあとに Ctrl+D)'); return false; }
  const S = await import('./select.js');
  const items = S.selectedItems();
  if (!items.length) { toast('図形を選んでください'); return false; }
  const t = last;
  const layer = S.selectionLayer();
  if (layer.locked) { toast('レイヤーがロックされています'); return false; }
  if (t.kind === 'flip') {
    (await import('./reflect.js')).flip(t.axis, { usePivot: false, copy: !!t.copy, record: false });
    return true;
  }
  const { translateShape } = await import('./vector.js');
  const { withNewIds } = await import('./clipboard.js');
  const b = S.selectionBounds(items);
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const fn = t.kind === 'move' ? (s) => translateShape(s, t.dx, t.dy)
    : t.kind === 'rotate' ? (s) => S.rotateShape(s, cx, cy, t.a)
    : (s) => S.scaleShape(s, b.x0 + (b.x1 - b.x0) * t.u, b.y0 + (b.y1 - b.y0) * t.v, t.sx, t.sy);
  const label = `くり返し(${{ move: '移動', rotate: '回転', scale: '拡大縮小' }[t.kind]}${t.copy ? 'して複製' : ''})`;
  S.modifySelection(label, (its, l) => {
    const ids = new Set(its.map((it) => it.shape.id));
    if (t.copy) {
      // 選んでいる図形のすぐ上に、変形したコピーを置いて、コピーを選ぶ
      const copies = [];
      const out = [];
      for (const s of l.shapes) {
        out.push(s);
        if (ids.has(s.id)) { const c = fn(withNewIds(s)); copies.push(c); }
      }
      l.shapes = [...out, ...copies];
      state.selection = { layerId: l.id, ids: copies.map((c) => c.id) };
    } else {
      l.shapes = l.shapes.map((s) => (ids.has(s.id) ? fn(s) : s));
    }
  });
  emit('selection');
  return true;
}
