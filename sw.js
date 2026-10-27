const CACHE_NAME = 'su-viewer-v4';

const APP_SHELL = [
  './index.html',
  './manifest.json',
  './icon.svg'
];

const PRELOAD = [
  'https://unpkg.com/three@0.160.0/build/three.module.js',
  'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js',
  'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js',
  'https://unpkg.com/three@0.160.0/examples/jsm/renderers/CSS2DRenderer.js'
];

/* ---------------- install ---------------- */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // 逐个 add，任一失败不阻断整个安装
    await Promise.allSettled(
      APP_SHELL.map(async (u) => {
        try {
          const res = await fetch(new Request(u, { cache: 'reload' }));
          if (res.ok) await cache.put(u, res);
        } catch (e) {
          console.warn('[SW] 预缓存失败:', u, e);
        }
      })
    );

    // 预拉 CDN 脚本（首次离线启动也可用）
    await Promise.allSettled(
      PRELOAD.map(async (url) => {
        try {
          const res = await fetch(url, { mode: 'cors' });
          if (res.ok) await cache.put(url, res);
        } catch (e) {
          // 静默忽略，运行时 fetch 命中再回填
        }
      })
    );

    self.skipWaiting();
  })());
});

/* ---------------- activate ---------------- */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

/* ---------------- fetch ---------------- */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isCDN = url.hostname === 'unpkg.com';
  if (!isSameOrigin && !isCDN) return;

  // 同源页面导航请求：network-first，离线回退缓存
  if (isSameOrigin && request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const res = await fetch(request);
        if (res.ok) event.waitUntil(cache.put(request, res.clone()).catch(() => {}));
        return res;
      } catch (e) {
        const cached = await cache.match(request, { ignoreSearch: true });
        if (cached) return cached;
        const fallback = await cache.match('./index.html');
        if (fallback) return fallback;
        throw e;
      }
    })());
    return;
  }

  // 其余（CDN 脚本、图标、manifest 等）：cache-first
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;

    try {
      const res = await fetch(request);
      if (res.ok) {
        event.waitUntil(cache.put(request, res.clone()).catch(() => {}));
      }
      return res;
    } catch (e) {
      throw e;
    }
  })());
});