// App installabile: registra il service worker (sw.js) e avvisa quando c'è una versione nuova.
// In locale (localhost / 127.0.0.1) non si registra, così durante lo sviluppo si vedono sempre i file
// appena modificati: lì gli aggiornamenti li gestisce il server locale (src/app/updates.js).
// Per provarlo in locale: tools/build_pwa.py + devserver con --root (vedi README).

import { offerUpdate } from './updates.js';

const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const CHECK_EVERY_MS = 30 * 60 * 1000;

export function setupPwa() {
  if (!('serviceWorker' in navigator)) return;
  if (LOCAL && !new URLSearchParams(location.search).has('pwa')) return;

  // al primo avvio il service worker prende il controllo senza bisogno di ricaricare la pagina
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
      console.warn('Service worker non registrato:', e);
      return;
    }
    const offer = async (worker) => {
      // solo se c'è già una versione in uso: al primo avvio non c'è niente da aggiornare
      if (!worker || !navigator.serviceWorker.controller) return;
      // version.json passa sempre dalla rete (vedi sw.js): sono le note della versione nuova
      const latest = await fetch('version.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
      offerUpdate({
        latest,
        apply: async (setMessage) => {
          setMessage('Attivo la nuova versione…');
          worker.postMessage('skipWaiting'); // poi "controllerchange" ricarica la pagina
        },
      });
    };
    offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed') offer(w); });
    });
    // controlla ogni tanto e quando si torna sulla finestra
    const check = () => reg.update().catch(() => {});
    setInterval(check, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  });
}
