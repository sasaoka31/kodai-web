// 画像を「パーツ」に分けて取り込む(AI: MobileSAM。完全オフライン)
//   右のリストでパーツ(顔・前髪など)を選び、画像を左クリック = 含める点 / 右クリック = 除外する点。
//   点を足すたびに AI がその部分を切り抜く。「レイヤーを作成」でパーツ名のレイヤーとして追加する。
//   選び方は3つ: クリック(AI)/ 囲む(囲った形そのまま)/ 囲む(AI: 囲った枠の中の物を AI が切り抜き、囲った外は入れない)。
//   囲むときは左ドラッグ = 足す / 右ドラッグ = 削る。パーツの形 = AI の切り抜き(点から)に、囲んだ分を順に足し引きしたもの
//   リストの上にあるパーツほど前(上のレイヤー)。重なった所は前のパーツのものになる。
//   「隠れた部分を AI で埋める」がオンなら、前のパーツに隠れていた後ろのパーツの部分を LaMa で描き足す(inpaint.js)。
import { toast } from './state.js';
import { RasterLayer, createCanvas } from './document.js';
import { insertLayers } from './layers.js';
import { holdModal, escapeHtml } from './modal.js';
import { planFill, runFill } from './inpaint.js';

const WORK_MAX = 1024; // AI に渡す画像の長辺(ちょうどこの大きさにする)
const NAMES_KEY = 'pixelrig.partNames';
const FILL_KEY = 'pixelrig.fillHidden';
export const DEFAULT_PART_NAMES = ['前髪', '顔', '右腕', '左腕', '胴体', '右脚', '左脚', '後ろ髪'];
const COLORS = ['#f43f5e', '#f59e0b', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#eab308', '#14b8a6', '#6366f1', '#f97316'];

function loadNames() {
  try {
    const v = JSON.parse(localStorage.getItem(NAMES_KEY));
    if (Array.isArray(v) && v.length && v.every((s) => typeof s === 'string')) return v;
  } catch { /* 保存なし */ }
  return [...DEFAULT_PART_NAMES];
}

function saveNames(parts) {
  try { localStorage.setItem(NAMES_KEY, JSON.stringify(parts.map((p) => p.name))); } catch { /* 保存できなくても動く */ }
}

export const aiAvailable = () => !!window.native?.ai;

// AI モデルを用意する(初回だけダウンロード)。onStatus(文字列)
export async function ensureModels(names, onStatus) {
  const ai = window.native.ai;
  const st = await ai.status(names);
  if (Object.values(st).every((s) => s.ready)) return;
  const off = ai.onProgress((p) => onStatus(`AIモデルをダウンロード中(初回のみ)… ${(p.received / 1048576).toFixed(1)} / ${(p.total / 1048576).toFixed(1)} MB`));
  try {
    await ai.ensure(names);
  } finally {
    off();
  }
}

// bitmap: 元画像、placed: {x, y, w, h} レイヤーを置く位置と大きさ、baseName: 元のファイル名
export function openPartsEditor(bitmap, baseName, placed) {
  return new Promise((resolve) => {
    const release = holdModal();
    const ai = window.native.ai;
    // Segment Anything は「長辺がちょうど 1024px」の画像を前提にしている(小さい画像も拡大する)
    const k = WORK_MAX / Math.max(bitmap.width, bitmap.height);
    const W = Math.max(1, Math.round(bitmap.width * k)), H = Math.max(1, Math.round(bitmap.height * k));
    const work = createCanvas(W, H);
    const wctx = work.getContext('2d', { willReadFrequently: true });
    wctx.imageSmoothingQuality = 'high';
    wctx.drawImage(bitmap, 0, 0, W, H);

    const newPart = (name, color) => ({ name, color, points: [], aiMask: null, edits: [], actions: [], mask: null, tint: null });
    const parts = loadNames().map((name, i) => newPart(name, COLORS[i % COLORS.length]));
    let mode = 'click'; // 'click' | 'lasso'(囲んだ形そのまま)| 'lassoAI'(囲んだ中を AI で)
    let lasso = null; // 囲んでいる途中 { pts, add }
    let cur = 0;
    let imageId = null;
    let busy = true;
    let lastDecoded = -1; // 前回切り抜いたパーツ(続けて点を足すときは前回のマスクを手がかりにする)

    // ---- 画面 ----
    const back = document.createElement('div');
    back.className = 'modal-backdrop parts-backdrop';
    back.innerHTML = `
      <div class="modal parts-dialog">
        <h2>パーツに分けて取り込む — ${escapeHtml(baseName)}</h2>
        <div class="parts-main">
          <div class="parts-view"><canvas></canvas></div>
          <div class="parts-side">
            <div class="parts-status"></div>
            <div class="mini-seg parts-mode">
              <button data-mode="click" class="on" title="クリックした所の物を AI が切り抜く">クリック(AI)</button>
              <button data-mode="lasso" title="ペンで囲った形をそのままパーツにする">囲む</button>
              <button data-mode="lassoAI" title="囲った範囲の中の物を AI が輪郭に沿って切り抜く(囲った外は入らない)">囲む(AI)</button>
            </div>
            <p class="note parts-help"></p>
            <div class="parts-list"></div>
            <div class="parts-add"><input type="text" placeholder="パーツ名を追加" maxlength="30"><button>＋追加</button></div>
            <div class="parts-actions">
              <button data-act="undo" title="Ctrl+Z / Backspace">1つ戻す</button>
              <button data-act="clear">このパーツをやり直す</button>
              <button data-act="next" title="Enter">次のパーツへ ▼</button>
            </div>
            <label class="check"><input type="checkbox" class="parts-rest" checked>どのパーツにも入らない部分を「残り」レイヤーにする</label>
            <label class="check" title="腕の後ろに隠れていた胴体などを、AI(LaMa)が周りに合わせて描き足します。オフライン・CPU で動きます"><input type="checkbox" class="parts-fill">隠れた部分を AI で埋める <span class="parts-fill-state muted"></span></label>
          </div>
        </div>
        <div class="modal-foot">
          <button data-act="cancel">キャンセル</button>
          <button data-act="ok" class="primary">レイヤーを作成</button>
        </div>
      </div>`;
    document.getElementById('modal-root').append(back);
    const $ = (s) => back.querySelector(s);
    const view = $('.parts-view canvas');
    const vctx = view.getContext('2d');
    const status = $('.parts-status');
    const list = $('.parts-list');
    const setStatus = (t, kind = '') => { status.textContent = t; status.className = 'parts-status ' + kind; };

    // 表示の大きさ(画像を枠に収める)
    let scale = 1, ox = 0, oy = 0;
    function layout() {
      const box = $('.parts-view').getBoundingClientRect();
      view.width = Math.max(1, Math.floor(box.width));
      view.height = Math.max(1, Math.floor(box.height));
      scale = Math.min(view.width / W, view.height / H);
      ox = (view.width - W * scale) / 2;
      oy = (view.height - H * scale) / 2;
      draw();
    }

    function tintOf(p) {
      if (!p.mask) return null;
      if (p.tint) return p.tint;
      const c = createCanvas(W, H);
      const img = new ImageData(W, H);
      const n = parseInt(p.color.slice(1), 16);
      const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      for (let i = 0; i < W * H; i++) {
        if (!p.mask[i]) continue;
        img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
      }
      c.getContext('2d').putImageData(img, 0, 0);
      return (p.tint = c);
    }

    function draw() {
      vctx.clearRect(0, 0, view.width, view.height);
      const w = W * scale, h = H * scale;
      // 市松模様
      const cs = 10;
      for (let y = 0; y < h; y += cs) for (let x = 0; x < w; x += cs) {
        vctx.fillStyle = ((x / cs + y / cs) & 1) ? '#d4d4d8' : '#fff';
        vctx.fillRect(ox + x, oy + y, Math.min(cs, w - x), Math.min(cs, h - y));
      }
      vctx.imageSmoothingEnabled = true;
      vctx.drawImage(work, ox, oy, w, h);
      parts.forEach((p, i) => {
        const t = tintOf(p);
        if (!t) return;
        vctx.globalAlpha = i === cur ? 0.55 : 0.28;
        vctx.drawImage(t, ox, oy, w, h);
      });
      vctx.globalAlpha = 1;
      if (lasso && lasso.pts.length > 1) {
        vctx.beginPath();
        lasso.pts.forEach((q, i) => (i ? vctx.lineTo : vctx.moveTo).call(vctx, ox + q.x * scale, oy + q.y * scale));
        vctx.closePath();
        vctx.fillStyle = lasso.add ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.18)';
        vctx.fill();
        vctx.setLineDash([6, 4]);
        vctx.lineWidth = 2;
        vctx.strokeStyle = lasso.add ? '#22c55e' : '#ef4444';
        vctx.stroke();
        vctx.setLineDash([]);
      }
      for (const pt of parts[cur]?.points || []) {
        const x = ox + pt.x * scale, y = oy + pt.y * scale;
        vctx.beginPath();
        vctx.arc(x, y, 6, 0, Math.PI * 2);
        vctx.fillStyle = pt.label ? '#22c55e' : '#ef4444';
        vctx.fill();
        vctx.lineWidth = 2;
        vctx.strokeStyle = '#fff';
        vctx.stroke();
        vctx.fillStyle = '#fff';
        vctx.fillRect(x - 3, y - 0.75, 6, 1.5);
        if (pt.label) vctx.fillRect(x - 0.75, y - 3, 1.5, 6);
      }
    }

    function renderList() {
      list.innerHTML = '';
      parts.forEach((p, i) => {
        const row = document.createElement('div');
        row.className = 'parts-row' + (i === cur ? ' on' : '');
        row.innerHTML = `
          <span class="parts-color" style="background:${p.color}"></span>
          <input type="text" class="parts-name" maxlength="30">
          <span class="parts-state">${p.mask ? '✓' : ''}</span>
          <button class="parts-mini" data-a="up" title="前へ(上のレイヤー)">▲</button>
          <button class="parts-mini" data-a="down" title="後ろへ">▼</button>
          <button class="parts-mini" data-a="del" title="削除">✕</button>`;
        const name = row.querySelector('.parts-name');
        name.value = p.name;
        name.onchange = () => { p.name = name.value.trim() || p.name; name.value = p.name; saveNames(parts); };
        name.onfocus = () => select(i);
        row.onclick = (e) => {
          const a = e.target.dataset?.a;
          if (a === 'up' && i > 0) { [parts[i - 1], parts[i]] = [parts[i], parts[i - 1]]; if (cur === i) cur--; else if (cur === i - 1) cur++; saveNames(parts); }
          else if (a === 'down' && i < parts.length - 1) { [parts[i + 1], parts[i]] = [parts[i], parts[i + 1]]; if (cur === i) cur++; else if (cur === i + 1) cur--; saveNames(parts); }
          else if (a === 'del') {
            if (p.mask && !confirm(`「${p.name}」の切り抜きを消しますか?`)) return;
            parts.splice(i, 1);
            if (!parts.length) parts.push(newPart('パーツ1', COLORS[0]));
            cur = Math.min(cur, parts.length - 1);
            saveNames(parts);
          } else if (!a) { select(i); return; }
          renderList();
          draw();
        };
        list.append(row);
      });
    }

    function select(i) {
      if (i === cur) return;
      cur = i;
      renderList();
      draw();
    }

    // 点が変わったら切り抜き直す
    let pending = Promise.resolve();
    function redecode(refine) {
      const p = parts[cur], idx = cur;
      pending = pending.then(async () => {
        if (!p.points.length) { p.aiMask = null; compose(p); lastDecoded = -1; renderList(); draw(); return; }
        setStatus('切り抜き中…', 'busy');
        const t0 = performance.now();
        try {
          if (!refine || lastDecoded !== idx) await ai.samReset(imageId);
          const r = await ai.samDecode(imageId, p.points, refine && lastDecoded === idx);
          p.aiMask = r.mask;
          compose(p);
          lastDecoded = idx;
          setStatus(`「${p.name}」を切り抜きました(${Math.round(performance.now() - t0)}ms)。点を足して調整できます`);
        } catch (err) {
          setStatus('切り抜きに失敗しました: ' + err.message, 'error');
        }
        renderList();
        draw();
      });
    }

    // パーツの形 = AI の切り抜き + 囲んだ分(順に足す・削る)
    function compose(p) {
      const m = p.aiMask ? Uint8Array.from(p.aiMask) : new Uint8Array(W * H);
      for (const ed of p.edits) {
        const v = ed.add ? 255 : 0;
        for (let i = 0; i < m.length; i++) if (ed.mask[i]) m[i] = v;
      }
      p.mask = m.some((v) => v) ? m : null;
      p.tint = null;
    }

    // 囲んだ線(作業解像度の点)の内側
    function polyMask(pts) {
      const c = createCanvas(W, H);
      const x = c.getContext('2d', { willReadFrequently: true });
      x.beginPath();
      pts.forEach((q, i) => (i ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y)));
      x.closePath();
      x.fill();
      const d = x.getImageData(0, 0, W, H).data;
      const m = new Uint8Array(W * H);
      for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] >= 128 ? 1 : 0;
      return m;
    }

    // 囲み終わり: そのまま / AI(囲んだ枠を手がかりに切り抜いて、囲んだ外は捨てる)
    function applyLasso(pts, add, useAI) {
      const p = parts[cur];
      const inside = polyMask(pts);
      if (!inside.some((v) => v)) return pending;
      if (!useAI) {
        p.edits.push({ add, mask: inside });
        p.actions.push('lasso');
        compose(p);
        renderList();
        draw();
        return pending;
      }
      const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
      const box = { x0: Math.max(0, Math.min(...xs)), y0: Math.max(0, Math.min(...ys)), x1: Math.min(W, Math.max(...xs)), y1: Math.min(H, Math.max(...ys)) };
      pending = pending.then(async () => {
        setStatus('囲んだ中を切り抜き中…', 'busy');
        try {
          const r = await ai.samDecode(imageId, [], false, box);
          lastDecoded = -1; // 点で調整するときの手がかり(前回のマスク)は使わない
          const m = new Uint8Array(W * H);
          let any = false;
          for (let i = 0; i < m.length; i++) if (inside[i] && r.mask[i]) { m[i] = 1; any = true; }
          if (!any) { setStatus('囲んだ中に物が見つかりませんでした。「囲む」(そのまま)も使えます', 'error'); return; }
          p.edits.push({ add, mask: m });
          p.actions.push('lasso');
          compose(p);
          setStatus(`「${p.name}」に${add ? '足しました' : 'から削りました'}。続けて囲む・クリックで調整できます`);
        } catch (err) {
          setStatus('切り抜きに失敗しました: ' + err.message, 'error');
        }
        renderList();
        draw();
      });
      return pending;
    }

    const toWork = (e) => { const r = view.getBoundingClientRect(); return { x: (e.clientX - r.left - ox) / scale, y: (e.clientY - r.top - oy) / scale }; };
    view.addEventListener('contextmenu', (e) => e.preventDefault());
    view.addEventListener('pointerdown', (e) => {
      if (busy || (e.button !== 0 && e.button !== 2)) return;
      const { x, y } = toWork(e);
      if (mode !== 'click') {
        view.setPointerCapture(e.pointerId);
        lasso = { pts: [{ x, y }], add: e.button === 0 };
        draw();
        return;
      }
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      parts[cur].points.push({ x, y, label: e.button === 0 ? 1 : 0 });
      parts[cur].actions.push('point');
      draw();
      redecode(true);
    });
    view.addEventListener('pointermove', (e) => {
      if (!lasso) return;
      const q = toWork(e), l = lasso.pts[lasso.pts.length - 1];
      if (Math.hypot(q.x - l.x, q.y - l.y) * scale < 3) return;
      lasso.pts.push(q);
      draw();
    });
    const endLasso = () => {
      if (!lasso) return;
      const l = lasso;
      lasso = null;
      draw();
      if (l.pts.length >= 3) applyLasso(l.pts, l.add, mode === 'lassoAI');
    };
    view.addEventListener('pointerup', endLasso);
    view.addEventListener('pointercancel', endLasso);

    const HELP = {
      click: 'パーツを選んで、画像の上を<b>左クリック = 含める</b> / <b>右クリック = 除外</b>。',
      lasso: 'ペンで囲むように<b>左ドラッグ = 足す</b> / <b>右ドラッグ = 削る</b>。囲んだ形そのままになります。',
      lassoAI: '物のまわりを<b>左ドラッグで囲む</b>と、中の物を AI が輪郭に沿って切り抜きます(囲んだ外は入りません)。<b>右ドラッグ</b>で削る。',
    };
    function setMode(m) {
      mode = m;
      for (const b of back.querySelectorAll('.parts-mode button')) b.classList.toggle('on', b.dataset.mode === m);
      $('.parts-help').innerHTML = HELP[m] + ' クリックと囲むは組み合わせられます。リストの上ほど前(上のレイヤー)になります。';
      view.style.cursor = m === 'click' ? 'crosshair' : 'cell';
    }
    for (const b of back.querySelectorAll('.parts-mode button')) b.onclick = () => setMode(b.dataset.mode);
    setMode('click');

    // 最後の操作(点 / 囲み)を1つ戻す
    function undoPoint() {
      const p = parts[cur];
      const last = p.actions.pop();
      if (last === 'lasso') { p.edits.pop(); compose(p); renderList(); draw(); return; }
      if (!p.points.length) return;
      p.points.pop();
      lastDecoded = -1;
      redecode(false);
    }

    function nextPart() {
      const i = parts.findIndex((p, j) => j > cur && !p.mask);
      select(i >= 0 ? i : Math.min(cur + 1, parts.length - 1));
    }

    function addPart() {
      const input = $('.parts-add input');
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      parts.push(newPart(name, COLORS[parts.length % COLORS.length]));
      input.value = '';
      cur = parts.length - 1;
      saveNames(parts);
      renderList();
      draw();
    }
    $('.parts-add button').onclick = addPart;
    $('.parts-add input').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); addPart(); } };

    function close(result) {
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', layout);
      back.remove();
      release();
      resolve(result);
    }

    back.querySelector('.modal').addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'undo') undoPoint();
      else if (act === 'clear') { Object.assign(parts[cur], { points: [], edits: [], actions: [], aiMask: null }); lastDecoded = -1; redecode(false); }
      else if (act === 'next') nextPart();
      else if (act === 'cancel') {
        if (finishing) { finishing.cancelled = true; setStatus('穴埋めを止めています(今の1か所が終わるまでお待ちください)…', 'busy'); return; }
        ai.cancel();
        close(null);
      }
      else if (act === 'ok') finish();
    });

    function onKey(e) {
      const typing = e.target.tagName === 'INPUT' && e.target.type === 'text';
      if (finishing) { e.preventDefault(); e.stopPropagation(); if (e.key === 'Escape') finishing.cancelled = true; return; }
      if (e.key === 'Escape') { e.preventDefault(); ai.cancel(); close(null); }
      else if (typing) return;
      else if (e.key === 'Enter') { e.preventDefault(); nextPart(); }
      else if (e.key === 'Backspace' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z')) { e.preventDefault(); undoPoint(); }
      e.stopPropagation();
    }
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', layout);

    // ---- レイヤーを作る ----
    let finishing = null; // { cancelled }
    async function finish() {
      if (finishing) return;
      await pending;
      if (!parts.some((p) => p.mask)) { setStatus('まだどのパーツも切り抜いていません', 'error'); return; }
      finishing = { cancelled: false };
      back.classList.add('finishing');
      const split = splitParts(bitmap, W, H, parts, placed);
      let filled = 0, skipped = false;
      if (fillBox.checked) {
        const jobs = planFill(split);
        for (let j = 0; j < jobs.length; j++) {
          if (finishing.cancelled) { skipped = true; break; }
          setStatus(`隠れた部分を埋めています… ${j + 1} / ${jobs.length}(「${jobs[j].name}」、1か所 数秒〜10秒)。キャンセルで穴埋めだけ止めます`, 'busy');
          try {
            await lamaReady();
            filled += await runFill(split, jobs[j], async (rgb, mask) => (await ai.lamaInpaint(rgb, mask)).rgb);
          } catch (err) {
            setStatus('穴埋めに失敗しました(穴埋めなしで作ります): ' + err.message, 'error');
            skipped = true;
            break;
          }
        }
      }
      const layers = makeLayers(split, placed, baseName, $('.parts-rest').checked);
      insertLayers('パーツに分けて取り込み', layers);
      const note = !fillBox.checked ? '' : skipped ? '(穴埋めは途中で止めました)' : filled ? '(隠れた部分も埋めました)' : '';
      toast(`${split.used.length}個のパーツをレイヤーにしました${note}`);
      close(layers);
    }

    // 穴埋めの AI(LaMa)は大きいので、切り抜いている間に裏で用意しておく
    let lamaPromise = null;
    function lamaReady() {
      lamaPromise ||= (async () => {
        const st = await ai.status(['lama']);
        if (!st.lama.ready) {
          const off = ai.onProgress((p) => { if (p.name === 'lama') setFillState(`ダウンロード中(初回のみ)… ${(p.received / 1048576).toFixed(0)} / ${(p.total / 1048576).toFixed(0)} MB`); });
          try { await ai.ensure(['lama']); } finally { off(); }
        }
        setFillState('読み込み中…(十数秒)');
        await ai.lamaPreload();
        setFillState('準備OK');
      })().catch((err) => { lamaPromise = null; setFillState('準備に失敗: ' + err.message); throw err; });
      return lamaPromise;
    }
    const fillBox = $('.parts-fill');
    const setFillState = (t) => { $('.parts-fill-state').textContent = t; };
    try { fillBox.checked = localStorage.getItem(FILL_KEY) !== '0'; } catch { fillBox.checked = true; }
    fillBox.onchange = () => {
      try { localStorage.setItem(FILL_KEY, fillBox.checked ? '1' : '0'); } catch { /* 保存できなくても動く */ }
      if (fillBox.checked && !busy) lamaReady().catch(() => {});
      if (!fillBox.checked) setFillState('');
    };

    // ---- 開始: モデルの用意 → 画像の解析 ----
    renderList();
    requestAnimationFrame(layout);
    (async () => {
      try {
        setStatus('AIモデルを準備中…', 'busy');
        await ensureModels(['sam-encoder', 'sam-decoder'], (t) => setStatus(t, 'busy'));
        setStatus('画像を解析中…(数秒かかります)', 'busy');
        const rgba = new Uint8Array(wctx.getImageData(0, 0, W, H).data.buffer);
        const r = await ai.samEncode(rgba, W, H);
        imageId = r.id;
        busy = false;
        setStatus(`準備できました(解析 ${(r.ms / 1000).toFixed(1)} 秒)。「${parts[cur].name}」の部分をクリックしてください`);
        if (fillBox.checked) lamaReady().catch(() => {});
      } catch (err) {
        if (!back.isConnected) return;
        setStatus('AIの準備に失敗しました: ' + err.message, 'error');
      }
    })();

    // シナリオ(動作確認)用
    openPartsEditor.debug = {
      get ready() { return !busy; }, parts, get cur() { return cur; }, select, undoPoint,
      click: (x, y, label = 1) => { parts[cur].points.push({ x, y, label }); parts[cur].actions.push('point'); redecode(true); return pending; },
      lasso: (pts, add = true, useAI = false) => applyLasso(pts, add, useAI), setMode,
      finish, close, W, H, fillBox, lamaReady,
    };
  });
}

// 切り抜いたマスク(作業解像度)を配置サイズに拡大して、画素ごとの持ち主(パーツ)を決める。
// 1つの画素は1つのパーツだけのもの(リストの上 = 前のパーツ優先)にするので、全レイヤーを重ねると元の画像とぴったり同じになる
// (境目を半透明で分けると、重ねたときにすき間が薄く見えるため)
// 戻り値 { img, owner(used の番号 / -1 = 残り), used:[{name, pix}](前から順), PW, PH }
export function splitParts(bitmap, W, H, parts, placed) {
  const PW = placed.w, PH = placed.h;
  const src = createCanvas(PW, PH);
  const sctx = src.getContext('2d', { willReadFrequently: true });
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(bitmap, 0, 0, PW, PH);
  const img = sctx.getImageData(0, 0, PW, PH).data;
  const owner = new Int16Array(PW * PH).fill(-1);
  const up = createCanvas(PW, PH);
  const uctx = up.getContext('2d', { willReadFrequently: true });
  const small = createCanvas(W, H);
  const used = [];
  for (const p of parts) {
    if (!p.mask) continue;
    const m = new ImageData(W, H);
    for (let i = 0; i < W * H; i++) m.data[i * 4 + 3] = p.mask[i];
    small.getContext('2d').putImageData(m, 0, 0);
    uctx.clearRect(0, 0, PW, PH);
    uctx.imageSmoothingEnabled = true;
    uctx.imageSmoothingQuality = 'high';
    uctx.drawImage(small, 0, 0, PW, PH);
    const soft = uctx.getImageData(0, 0, PW, PH).data;
    const k = used.length;
    const pix = new ImageData(PW, PH);
    let any = false;
    for (let i = 0; i < PW * PH; i++) {
      if (owner[i] !== -1 || soft[i * 4 + 3] < 128 || !img[i * 4 + 3]) continue;
      owner[i] = k;
      pix.data.set(img.subarray(i * 4, i * 4 + 4), i * 4);
      any = true;
    }
    if (any) used.push({ name: p.name, pix });
  }
  return { img, owner, used, PW, PH };
}

// 分けた結果からレイヤーを作る(下から順: 残り → 後ろのパーツ → 前のパーツ)
export function makeLayers(split, placed, baseName, withRest) {
  const { img, owner, used, PW, PH } = split;
  const layers = [];
  if (withRest) {
    const pix = new ImageData(PW, PH);
    let any = false;
    for (let i = 0; i < PW * PH; i++) {
      if (owner[i] !== -1 || !img[i * 4 + 3]) continue;
      pix.data.set(img.subarray(i * 4, i * 4 + 4), i * 4);
      any = true;
    }
    if (any) {
      const l = new RasterLayer(`${baseName}(残り)`);
      l.putImageData(pix, placed.x, placed.y);
      layers.push(l);
    }
  }
  for (const o of [...used].reverse()) {
    const l = new RasterLayer(o.name);
    l.putImageData(o.pix, placed.x, placed.y);
    layers.push(l);
  }
  return layers;
}
