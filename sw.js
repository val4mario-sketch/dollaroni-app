// Service worker di Dollaroni: l'app funziona anche offline e si aggiorna da sola.
//
// VERSION e PRECACHE vengono riscritti da tools/build_pwa.py quando si pubblica (GitHub Pages):
// ogni modifica ai file cambia VERSION, quindi il browser installa il service worker nuovo,
// scarica i file nuovi e l'app mostra "È disponibile Dollaroni x.y.z" (src/app/pwa.js e updates.js).
// In locale (python tools/devserver.py) il service worker non viene registrato.

const VERSION = 'dev';
const PRECACHE = [];
const CACHE = `dollaroni-${VERSION}`;

// Librerie pesanti con la versione nel nome della cartella (il motore dell'IA, ~9 MB): si scaricano
// alla prima richiesta e restano tra un aggiornamento e l'altro. Se si cambia versione di wllama,
// aggiornare qui il nome della cartella.
const STATIC = 'dollaroni-static';
const STATIC_DIRS = ['vendor/wllama-3.8.1/'];

// Sempre dalla rete (se c'è): servono a sapere se esiste una versione nuova.
const NETWORK_FIRST = ['version.json', 'dollaroni.config.json'];

// "Cross-origin isolation": su GitHub Pages non si possono impostare gli header del server, quindi li
// aggiunge il service worker. Servono all'IA locale per usare tutti i core (SharedArrayBuffer).
function isolate(res) {
  if (!res || res.status === 0 || res.type === 'opaque') return res;
  const headers = new Headers(res.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

self.addEventListener('install', (event) => {
  // non si attiva da solo se c'è già una versione aperta: aspetta il clic su "Aggiorna"
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('dollaroni-') && key !== CACHE && key !== STATIC) await caches.delete(key);
    }
    // nella cache delle librerie restano solo le versioni in uso
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

  // Prima la copia salvata (veloce e offline), altrimenti la rete. I file nuovi arrivano con la versione nuova.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = req.mode === 'navigate' ? new URL('./', self.registration.scope).href : req;
    const hit = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return isolate(hit);
    try {
      const res = await fetch(req);
      // tiene anche i file non in elenco (es. pagine dei test) per l'uso offline
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return isolate(res);
    } catch (e) {
      const fallback = req.mode === 'navigate' ? await cache.match(new URL('./', self.registration.scope).href) : null;
      if (fallback) return isolate(fallback);
      throw e;
    }
  })());
});
