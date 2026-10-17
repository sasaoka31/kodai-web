// タイムライン: フレーム操作・再生・フレーム一覧(サムネイル)
import { state, on, emit, requestRender, toast } from './state.js';
import { timeline, createCanvas, DEFAULT_DURATION } from './document.js';
import { snapshotFrames, framesEntry, propEntry } from './history.js';
import { flatten } from './render.js';
import { finishPath } from './tools.js';
import { applyTransform } from './transform.js';
import { clamp } from './color.js';

const $ = (id) => document.getElementById(id);

// ---- フレーム移動 ----

export function setFrame(i) {
  const doc = state.doc;
  i = clamp(i, 0, doc.frames.length - 1);
  if (i === timeline.frame) return;
  if (state.pathDraft) finishPath();
  if (state.transform) applyTransform();
  state.preview = null;
  state.selection = null;
  timeline.frame = i;
  emit('frame');
  requestRender();
}

export function stepFrame(dir) {
  const n = state.doc.frames.length;
  let i = timeline.frame + dir;
  if (state.opts.loop) i = (i + n) % n;
  setFrame(i);
}

// ---- フレーム構成の変更(Undo 可能) ----

export function framesOp(label, fn) {
  if (state.playing) stop();
  if (state.pathDraft) finishPath();
  if (state.transform) applyTransform();
  const doc = state.doc;
  const before = snapshotFrames(doc, timeline);
  if (fn(doc) === false) return;
  state.history.push(framesEntry(label, doc, timeline, before, snapshotFrames(doc, timeline)));
  state.preview = null;
  state.selection = null;
  emit('frames');
  requestRender();
}

export function addFrame(duplicate = false) {
  framesOp(duplicate ? 'フレームを複製' : 'フレームを追加', (doc) => {
    const i = timeline.frame;
    doc.frames.splice(i + 1, 0, { duration: doc.frames[i].duration });
    for (const l of doc.layers) {
      const c = l.celAt(i);
      l.cels.splice(i + 1, 0, duplicate && c ? c.clone() : undefined);
    }
    timeline.frame = i + 1;
  });
}

export function deleteFrame() {
  if (state.doc.frames.length <= 1) { toast('最後のフレームは削除できません'); return; }
  framesOp('フレームを削除', (doc) => {
    const i = timeline.frame;
    doc.frames.splice(i, 1);
    for (const l of doc.layers) l.cels.splice(i, 1);
    timeline.frame = Math.min(i, doc.frames.length - 1);
  });
}

export function moveFrame(dir) {
  const doc = state.doc;
  const i = timeline.frame, j = i + dir;
  if (j < 0 || j >= doc.frames.length) return;
  framesOp('フレームを移動', (d) => {
    [d.frames[i], d.frames[j]] = [d.frames[j], d.frames[i]];
    for (const l of d.layers) {
      const a = l.cels[i], b = l.cels[j];
      l.cels[i] = b;
      l.cels[j] = a;
    }
    timeline.frame = j;
  });
}

export function setDuration(ms, all = false) {
  ms = clamp(Math.round(ms) || DEFAULT_DURATION, 10, 10000);
  const doc = state.doc;
  if (all) {
    framesOp('全フレームの時間を変更', (d) => { for (const f of d.frames) f.duration = ms; });
    return;
  }
  const f = doc.frames[timeline.frame];
  if (f.duration === ms) return;
  state.history.push(propEntry('フレーム時間を変更', f, 'duration', f.duration, ms));
  f.duration = ms;
  emit('frames');
}

// ---- 再生 ----

let timer = 0;

export function play() {
  const doc = state.doc;
  if (doc.frames.length < 2) { toast('フレームが2つ以上必要です'); return; }
  if (state.pathDraft) finishPath();
  if (state.transform) applyTransform();
  state.preview = null;
  state.playing = true;
  // ループなしで最後のフレームにいるときは最初から
  if (!state.opts.loop && timeline.frame === doc.frames.length - 1) timeline.frame = 0;
  // 各フレームの表示時間どおりに進める(タイマーの遅れは次のフレームで取り戻す)
  let due = performance.now() + doc.frames[timeline.frame].duration;
  const tick = () => {
    if (!state.playing) return;
    const now = performance.now();
    while (now >= due) {
      if (timeline.frame + 1 >= doc.frames.length) {
        if (!state.opts.loop) { stop(); emit('frame'); return; }
        timeline.frame = 0;
      } else timeline.frame++;
      due += doc.frames[timeline.frame].duration;
    }
    emit('frame');
    requestRender();
    timer = setTimeout(tick, Math.max(1, due - performance.now()));
  };
  timer = setTimeout(tick, Math.max(1, due - performance.now()));
  emit('playing');
  emit('frame');
}

export function stop() {
  if (!state.playing) return;
  state.playing = false;
  clearTimeout(timer);
  emit('playing');
  requestRender();
}

export function togglePlay() {
  if (state.playing) stop();
  else play();
}

// ---- UI ----

const THUMB_H = 44;
let thumbTimer = null;

export function initTimeline() {
  $('tl-duration').addEventListener('change', (e) => setDuration(Number(e.target.value)));
  $('tl-loop').addEventListener('change', (e) => { state.opts.loop = e.target.checked; requestRender(); });
  $('tl-onion').addEventListener('change', (e) => { state.opts.onion.enabled = e.target.checked; requestRender(); });
  $('tl-onion-prev').addEventListener('change', (e) => { state.opts.onion.prev = clamp(Number(e.target.value) || 0, 0, 5); requestRender(); });
  $('tl-onion-next').addEventListener('change', (e) => { state.opts.onion.next = clamp(Number(e.target.value) || 0, 0, 5); requestRender(); });

  on('doc', () => { renderStrip(); scheduleThumbs(true); });
  on('frames', () => { renderStrip(); scheduleThumbs(true); });
  on('frame', updateActive);
  on('playing', updatePlayButton);
  on('history', () => scheduleThumbs(false));
  on('layers', () => scheduleThumbs(true));
}

function totalSeconds() {
  return state.doc.frames.reduce((s, f) => s + f.duration, 0) / 1000;
}

function renderStrip() {
  const strip = $('tl-strip');
  strip.innerHTML = '';
  const doc = state.doc;
  const a = doc.artboard;
  const tw = Math.max(20, Math.min(96, Math.round((THUMB_H * a.w) / a.h)));
  doc.frames.forEach((f, i) => {
    const cell = document.createElement('button');
    cell.className = 'frame-cell';
    cell.dataset.index = i;
    cell.title = `フレーム ${i + 1}(${f.duration}ms)`;
    const c = createCanvas(tw, THUMB_H);
    c.className = 'thumb';
    const label = document.createElement('span');
    label.textContent = f.pose ? `◆${i + 1}` : String(i + 1);
    if (f.pose) cell.title += ' / ポーズのキーあり';
    cell.append(c, label);
    cell.onclick = () => { stop(); setFrame(i); };
    strip.append(cell);
  });
  updateActive();
}

function updateActive() {
  const doc = state.doc;
  if (!doc) return;
  for (const el of document.querySelectorAll('.frame-cell')) {
    const on = Number(el.dataset.index) === timeline.frame;
    el.classList.toggle('active', on);
    if (on && state.playing) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  const f = doc.frames[timeline.frame];
  if (document.activeElement !== $('tl-duration')) $('tl-duration').value = f.duration;
  const fps = (1000 / f.duration).toFixed(1).replace(/\.0$/, '');
  $('tl-info').textContent = `${timeline.frame + 1} / ${doc.frames.length}  ·  ${fps} fps  ·  合計 ${totalSeconds().toFixed(2)} 秒`;
  // 再生中はサムネイル更新を止める
  if (!state.playing) scheduleThumbs(false);
}

function updatePlayButton() {
  const b = $('btn-play');
  b.textContent = state.playing ? '■' : '▶';
  b.title = state.playing ? '停止 (Enter)' : '再生 (Enter)';
  b.classList.toggle('on', state.playing);
}

// サムネイル更新は少し遅らせてまとめる(all=false なら現在のフレームだけ)
let pendingAll = false;
function scheduleThumbs(all) {
  pendingAll ||= all;
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(() => {
    const doAll = pendingAll;
    pendingAll = false;
    drawThumbs(doAll);
  }, 250);
}

function drawThumbs(all) {
  const doc = state.doc;
  if (!doc || state.playing) return;
  const a = doc.artboard;
  for (const el of document.querySelectorAll('.frame-cell')) {
    const i = Number(el.dataset.index);
    if (!all && i !== timeline.frame) continue;
    if (i >= doc.frames.length) continue;
    const c = el.querySelector('canvas');
    const s = Math.min(c.width / a.w, c.height / a.h);
    const img = flatten(doc, s, a, i);
    const x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    x.imageSmoothingEnabled = s < 1;
    x.drawImage(img, (c.width - img.width) / 2, (c.height - img.height) / 2);
  }
}
