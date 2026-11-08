// Installable app: registers the service worker (sw.js) and warns when there is a new version.
// Locally (localhost / 127.0.0.1) it does not register, so during development the files
// just changed are always visible: there updates are handled by the local server (src/app/updates.js).
// To try it locally: tools/build_pwa.py + devserver with --root (see README).

import { offerUpdate } from './updates.js';

const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const CHECK_EVERY_MS = 30 * 60 * 1000;

export function setupPwa() {
  if (!('serviceWorker' in navigator)) return;
  if (LOCAL && !new URLSearchParams(location.search).has('pwa')) return;

  // on first start the service worker takes control without reloading the page
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return;
    reloading = true;
    location.reload();
  });

  window.addEventListener('load', async () => {
    let reg;
    try {
      reg = await navigator.serviceWorker.register('sw.js');
    } catch (e) {
      console.warn('Service worker not registered:', e);
      return;
    }
    const offer = async (worker) => {
      // only if a version is already in use: on first start there is nothing to update
      if (!worker || !navigator.serviceWorker.controller) return;
      // version.json always comes from the network (see sw.js): these are the notes of the new version
      const latest = await fetch('version.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
      offerUpdate({
        latest,
        apply: async (setMessage) => {
          setMessage('Activating the new version…');
          worker.postMessage('skipWaiting'); // then "controllerchange" reloads the page
        },
      });
    };
    offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed') offer(w); });
    });
    // checks now and then and when you return to the window
    const check = () => reg.update().catch(() => {});
    setInterval(check, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  });
}
