// オフライン対応(iPad など、ブラウザで開く版)。scripts/build-web.js が、下の2行を書き換えて dist-web/sw.js にする。
//   ・中身(b/<版>-<時刻>/ の中)は、1回開いたら端末に取っておく。名前が毎回ちがうので、古いものと混ざらない
//   ・入口の index.html は、ネットがあれば毎回取りに行く(= 更新ボタンで新しい版になる)。ネットがなければ、取っておいたものを使う
const BUILD = "1.48.1-mvc0oiyi";
const FILES = ["b/1.48.1-mvc0oiyi/docs/manual/img/01-overview.png","b/1.48.1-mvc0oiyi/docs/manual/img/02-tabs.png","b/1.48.1-mvc0oiyi/docs/manual/img/10-rig-bones.png","b/1.48.1-mvc0oiyi/docs/manual/img/11-rig-bind.png","b/1.48.1-mvc0oiyi/docs/manual/img/12-rig-pose.png","b/1.48.1-mvc0oiyi/docs/manual/img/13-rig-preset.png","b/1.48.1-mvc0oiyi/docs/manual/img/14-rig-lattice.png","b/1.48.1-mvc0oiyi/docs/manual/img/20-timeline.png","b/1.48.1-mvc0oiyi/docs/manual/img/21-onion.png","b/1.48.1-mvc0oiyi/docs/manual/img/22-gif.png","b/1.48.1-mvc0oiyi/docs/manual/img/30-paint-panel.png","b/1.48.1-mvc0oiyi/docs/manual/img/30g-gradient.png","b/1.48.1-mvc0oiyi/docs/manual/img/30i-info.png","b/1.48.1-mvc0oiyi/docs/manual/img/31-polygon-round.png","b/1.48.1-mvc0oiyi/docs/manual/img/31r-reflect.png","b/1.48.1-mvc0oiyi/docs/manual/img/32-outline.png","b/1.48.1-mvc0oiyi/docs/manual/img/33-border-dialog.png","b/1.48.1-mvc0oiyi/docs/manual/img/34-border-result.png","b/1.48.1-mvc0oiyi/docs/manual/img/35-align.png","b/1.48.1-mvc0oiyi/docs/manual/img/35p-pathfinder.png","b/1.48.1-mvc0oiyi/docs/manual/img/36-layout.png","b/1.48.1-mvc0oiyi/docs/manual/img/36b-barlayout.png","b/1.48.1-mvc0oiyi/docs/manual/img/36c-design.png","b/1.48.1-mvc0oiyi/docs/manual/img/36d-charm.png","b/1.48.1-mvc0oiyi/docs/manual/img/36e-rulers.png","b/1.48.1-mvc0oiyi/docs/manual/img/36f-bend-smart.png","b/1.48.1-mvc0oiyi/docs/manual/img/36g-join.png","b/1.48.1-mvc0oiyi/docs/manual/img/37-text.png","b/1.48.1-mvc0oiyi/docs/manual/img/38-dot.png","b/1.48.1-mvc0oiyi/docs/manual/img/38g-dotgrad.png","b/1.48.1-mvc0oiyi/docs/manual/img/39-bucket.png","b/1.48.1-mvc0oiyi/docs/manual/img/40-parts.png","b/1.48.1-mvc0oiyi/docs/manual/img/41-inpaint.png","b/1.48.1-mvc0oiyi/docs/manual/img/42-trace.png","b/1.48.1-mvc0oiyi/docs/manual/img/50-font-dot.png","b/1.48.1-mvc0oiyi/docs/manual/img/51-font-vector.png","b/1.48.1-mvc0oiyi/docs/manual/img/52-font-kanji.png","b/1.48.1-mvc0oiyi/docs/manual/img/53-font-kanji-mincho.png","b/1.48.1-mvc0oiyi/docs/manual/img/54-font-kana-latin.png","b/1.48.1-mvc0oiyi/docs/manual/img/55-font-image.png","b/1.48.1-mvc0oiyi/docs/manual/img/60-texture.png","b/1.48.1-mvc0oiyi/docs/manual/img/61-claude.png","b/1.48.1-mvc0oiyi/docs/manual/img/62-character.png","b/1.48.1-mvc0oiyi/docs/manual/img/63-effects.png","b/1.48.1-mvc0oiyi/docs/manual/img/64-telop.png","b/1.48.1-mvc0oiyi/docs/manual/img/65-solid.png","b/1.48.1-mvc0oiyi/docs/manual/img/66-charpaint.png","b/1.48.1-mvc0oiyi/docs/manual/img/67-icons.png","b/1.48.1-mvc0oiyi/icon.png","b/1.48.1-mvc0oiyi/js/align.js","b/1.48.1-mvc0oiyi/js/apng.js","b/1.48.1-mvc0oiyi/js/app.js","b/1.48.1-mvc0oiyi/js/autorig.js","b/1.48.1-mvc0oiyi/js/baritems.js","b/1.48.1-mvc0oiyi/js/barlayout.js","b/1.48.1-mvc0oiyi/js/chardlg.js","b/1.48.1-mvc0oiyi/js/charmaker.js","b/1.48.1-mvc0oiyi/js/charpaint.js","b/1.48.1-mvc0oiyi/js/charpaintdlg.js","b/1.48.1-mvc0oiyi/js/charpoly.js","b/1.48.1-mvc0oiyi/js/charpoly3d.js","b/1.48.1-mvc0oiyi/js/claudedlg.js","b/1.48.1-mvc0oiyi/js/clipboard.js","b/1.48.1-mvc0oiyi/js/color.js","b/1.48.1-mvc0oiyi/js/direct.js","b/1.48.1-mvc0oiyi/js/document.js","b/1.48.1-mvc0oiyi/js/dotgrad.js","b/1.48.1-mvc0oiyi/js/effects.js","b/1.48.1-mvc0oiyi/js/fill.js","b/1.48.1-mvc0oiyi/js/fitcurve.js","b/1.48.1-mvc0oiyi/js/fontimage.js","b/1.48.1-mvc0oiyi/js/fontimagedlg.js","b/1.48.1-mvc0oiyi/js/fontmode.js","b/1.48.1-mvc0oiyi/js/fonts.js","b/1.48.1-mvc0oiyi/js/fxdlg.js","b/1.48.1-mvc0oiyi/js/gdparticles-data.js","b/1.48.1-mvc0oiyi/js/gdparticles.js","b/1.48.1-mvc0oiyi/js/gif.js","b/1.48.1-mvc0oiyi/js/gradient.js","b/1.48.1-mvc0oiyi/js/guides.js","b/1.48.1-mvc0oiyi/js/history.js","b/1.48.1-mvc0oiyi/js/icons.js","b/1.48.1-mvc0oiyi/js/iconsdlg.js","b/1.48.1-mvc0oiyi/js/iconset.js","b/1.48.1-mvc0oiyi/js/imageproc.js","b/1.48.1-mvc0oiyi/js/importer.js","b/1.48.1-mvc0oiyi/js/inpaint.js","b/1.48.1-mvc0oiyi/js/io.js","b/1.48.1-mvc0oiyi/js/kanji.js","b/1.48.1-mvc0oiyi/js/layers.js","b/1.48.1-mvc0oiyi/js/layout.js","b/1.48.1-mvc0oiyi/js/library.js","b/1.48.1-mvc0oiyi/js/librarydlg.js","b/1.48.1-mvc0oiyi/js/look.js","b/1.48.1-mvc0oiyi/js/mcp.js","b/1.48.1-mvc0oiyi/js/modal.js","b/1.48.1-mvc0oiyi/js/outline.js","b/1.48.1-mvc0oiyi/js/paint.js","b/1.48.1-mvc0oiyi/js/parts.js","b/1.48.1-mvc0oiyi/js/pathfinder.js","b/1.48.1-mvc0oiyi/js/pixelfx.js","b/1.48.1-mvc0oiyi/js/pixelops.js","b/1.48.1-mvc0oiyi/js/prefs.js","b/1.48.1-mvc0oiyi/js/recent.js","b/1.48.1-mvc0oiyi/js/reflect.js","b/1.48.1-mvc0oiyi/js/render.js","b/1.48.1-mvc0oiyi/js/repeat.js","b/1.48.1-mvc0oiyi/js/rig.js","b/1.48.1-mvc0oiyi/js/rigrender.js","b/1.48.1-mvc0oiyi/js/rigtool.js","b/1.48.1-mvc0oiyi/js/select.js","b/1.48.1-mvc0oiyi/js/shapeinfo.js","b/1.48.1-mvc0oiyi/js/solid.js","b/1.48.1-mvc0oiyi/js/soliddlg.js","b/1.48.1-mvc0oiyi/js/solidrig.js","b/1.48.1-mvc0oiyi/js/solidview.js","b/1.48.1-mvc0oiyi/js/state.js","b/1.48.1-mvc0oiyi/js/svgpath.js","b/1.48.1-mvc0oiyi/js/tabs.js","b/1.48.1-mvc0oiyi/js/telop.js","b/1.48.1-mvc0oiyi/js/telopdlg.js","b/1.48.1-mvc0oiyi/js/text.js","b/1.48.1-mvc0oiyi/js/texttool.js","b/1.48.1-mvc0oiyi/js/texture.js","b/1.48.1-mvc0oiyi/js/texturedlg.js","b/1.48.1-mvc0oiyi/js/tiles.js","b/1.48.1-mvc0oiyi/js/timeline.js","b/1.48.1-mvc0oiyi/js/tools.js","b/1.48.1-mvc0oiyi/js/trace.js","b/1.48.1-mvc0oiyi/js/transform.js","b/1.48.1-mvc0oiyi/js/ui.js","b/1.48.1-mvc0oiyi/js/vector.js","b/1.48.1-mvc0oiyi/js/viewport.js","b/1.48.1-mvc0oiyi/js/warp.js","b/1.48.1-mvc0oiyi/manifest.webmanifest","b/1.48.1-mvc0oiyi/manual.html","b/1.48.1-mvc0oiyi/particles/blood1.png","b/1.48.1-mvc0oiyi/particles/blood2.png","b/1.48.1-mvc0oiyi/particles/blood3.png","b/1.48.1-mvc0oiyi/particles/bloodhand.png","b/1.48.1-mvc0oiyi/particles/CREDITS.txt","b/1.48.1-mvc0oiyi/particles/darkmagicsmoke.png","b/1.48.1-mvc0oiyi/particles/explosionfog_texture_2.png","b/1.48.1-mvc0oiyi/particles/explosiontexture1.png","b/1.48.1-mvc0oiyi/particles/explosiontexture_smoke_1.png","b/1.48.1-mvc0oiyi/particles/glow.png","b/1.48.1-mvc0oiyi/particles/lightning_texture_1.png","b/1.48.1-mvc0oiyi/particles/runes1.png","b/1.48.1-mvc0oiyi/particles/snowflake2.png","b/1.48.1-mvc0oiyi/particles/trail.png","b/1.48.1-mvc0oiyi/particles/water.png","b/1.48.1-mvc0oiyi/styles.css","b/1.48.1-mvc0oiyi/vendor/ICONS-LICENSE.txt","b/1.48.1-mvc0oiyi/vendor/opentype.LICENSE.txt","b/1.48.1-mvc0oiyi/vendor/opentype.module.js","b/1.48.1-mvc0oiyi/web.css","b/1.48.1-mvc0oiyi/web.js"];

const CACHE = 'kodai-' + BUILD;
const ROOT = new URL('./', self.location).href; // 入口(…/kodai-web/)

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 入口と、中身ぜんぶを取っておく(ネットから取り直す。途中で失敗したら、この版は入れない)
    await cache.addAll([new Request(ROOT, { cache: 'reload' }), ...FILES.map((f) => new Request(new URL(f, ROOT).href, { cache: 'reload' }))]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // 前の版の分は消す
    for (const k of await caches.keys()) if (k.startsWith('kodai-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(ROOT)) return;
  const isEntry = req.mode === 'navigate' || req.url === ROOT || req.url === ROOT + 'index.html';
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (isEntry) {
      // 入口: ネットが先(新しい版があれば、それになる)。つながらなければ、取っておいたもの
      try {
        const res = await fetch(new Request(ROOT, { cache: 'no-store' }));
        if (res.ok) { cache.put(ROOT, res.clone()); return res; }
      } catch { /* オフライン */ }
      return (await cache.match(ROOT)) || (await caches.match(ROOT)) || Response.error();
    }
    // 中身: 取っておいたものが先(名前が版ごとにちがうので、古くならない)。なければネットから取って、取っておく
    const hit = (await cache.match(req)) || (await caches.match(req));
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  })());
});
