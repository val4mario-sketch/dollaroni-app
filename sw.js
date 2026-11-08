// Dollaroni service worker: the app also works offline and updates itself.
//
// VERSION and PRECACHE are rewritten by tools/build_pwa.py when publishing (GitHub Pages):
// each file change alters VERSION, so the browser installs the new service worker,
// downloads the new files and the app shows "Dollaroni x.y.z is available" (src/app/pwa.js and updates.js).
// Locally (python tools/devserver.py) the service worker is not registered.

const VERSION = 'dev';
const PRECACHE = [];
const CACHE = `dollaroni-${VERSION}`;

// Heavy libraries with the version in the folder name (the AI engine, ~9 MB): downloaded
// on first request and kept between updates. If you change the wllama version,
// update the folder name here.
const STATIC = 'dollaroni-static';
const STATIC_DIRS = ['vendor/wllama-3.8.1/'];

// Always from the network (if available): used to find out whether a new version exists.
const NETWORK_FIRST = ['version.json', 'dollaroni.config.json'];

// "Cross-origin isolation": on GitHub Pages server headers cannot be set, so the
// service worker adds them. The local AI needs them to use all the cores (SharedArrayBuffer).
function isolate(res) {
  if (!res || res.status === 0 || res.type === 'opaque') return res;
  const headers = new Headers(res.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

self.addEventListener('install', (event) => {
  // does not activate by itself if a version is already open: waits for the click on "Update"
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('dollaroni-') && key !== CACHE && key !== STATIC) await caches.delete(key);
    }
    // only the versions in use stay in the library cache
    const st = await caches.open(STATIC);
    for (const req of await st.keys()) {
      if (!STATIC_DIRS.some((d) => req.url.includes(`/${d}`))) await st.delete(req);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const path = url.pathname.slice(new URL(self.registration.scope).pathname.length);

  if (NETWORK_FIRST.includes(path)) {
    event.respondWith((async () => {
      try {
        return isolate(await fetch(req, { cache: 'no-store' }));
      } catch (e) {
        const hit = await caches.match(req, { ignoreSearch: true });
        if (hit) return isolate(hit);
        throw e;
      }
    })());
    return;
  }

  if (STATIC_DIRS.some((d) => path.startsWith(d))) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC);
      const hit = await cache.match(req);
      if (hit) return isolate(hit);
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return isolate(res);
    })());
    return;
  }

  // The saved copy first (fast and offline), otherwise the network. New files arrive with the new version.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = req.mode === 'navigate' ? new URL('./', self.registration.scope).href : req;
    const hit = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return isolate(hit);
    try {
      const res = await fetch(req);
      // also keeps files not on the list (e.g. test pages) for offline use
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return isolate(res);
    } catch (e) {
      const fallback = req.mode === 'navigate' ? await cache.match(new URL('./', self.registration.scope).href) : null;
      if (fallback) return isolate(fallback);
      throw e;
    }
  })());
});
