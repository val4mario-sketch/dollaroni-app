// Aggiornamenti "come nelle app vere": all'avvio, ogni 30 minuti e quando si torna sulla finestra
// si controlla se su GitHub c'è una versione più nuova; se c'è compare un avviso con le novità
// (e, se l'utente le ha permesse, anche una notifica di Windows).
//
// Due modi di usare Dollaroni, un solo avviso:
//  - sito pubblicato (GitHub Pages, app installata): il service worker scarica la versione nuova
//    e "Aggiorna ora" la attiva (src/app/pwa.js chiama offerUpdate);
//  - in locale con "Avvia Dollaroni.bat": il server locale (tools/devserver.py) sa da quale repository
//    aggiornarsi; qui si confronta version.json con quello su GitHub e "Aggiorna ora" chiede al server
//    di scaricare e sostituire i file dell'app (i progetti .dollaroni.json non si toccano).
//
// version.json: {version, date, notes[]}. Per pubblicare una versione: python tools/release.py (vedi README).

const LAST_SEEN = 'dollaroni.lastSeenVersion';
const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* niente */ } },
};

/** -1, 0, 1 confrontando "0.5.0" con "0.10.1". */
export function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '0').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  }
  return 0;
}

async function getJson(url, opts = {}) {
  const r = await fetch(url, { cache: 'no-store', ...opts });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

/** Versione in uso (version.json servito insieme all'app). */
export const installedVersion = () => getJson('version.json').catch(() => null);

/** Info del server locale (solo con Avvia Dollaroni.bat); null altrove. */
async function serverInfo() {
  if (!LOCAL) return null;
  try {
    const i = await getJson('/__dollaroni/info');
    return i?.app === 'dollaroni' ? i : null;
  } catch {
    return null;
  }
}

/** Stato condiviso per la barra laterale: {installed, latest, mode, repository, available, checkedAt, error}. */
const state = { installed: null, latest: null, mode: null, repository: null, available: false, checkedAt: null, error: null };
const listeners = new Set();
export function subscribeUpdates(fn) {
  listeners.add(fn);
  fn({ ...state });
  return () => listeners.delete(fn);
}
const emit = (patch) => { Object.assign(state, patch); for (const fn of listeners) fn({ ...state }); };

let server = null;
let timer = null;

/** Avvio: versione installata, "Novità" dopo un aggiornamento, controlli periodici in locale. */
export async function startUpdates() {
  const installed = await installedVersion();
  emit({ installed });
  // dopo un aggiornamento: mostra una volta le novità della versione
  const seen = store.get(LAST_SEEN);
  if (installed?.version) {
    if (seen && compareVersions(installed.version, seen) > 0) showNews(installed, { updated: true });
    store.set(LAST_SEEN, installed.version);
  }
  server = await serverInfo();
  if (server) {
    emit({ mode: 'local', repository: server.repository || server.versionUrl });
    if (!server.canUpdate) return;
    const every = Math.max(5, Number((await getJson('dollaroni.config.json').catch(() => ({})))?.updates?.checkEveryMinutes) || 30);
    checkNow();
    clearInterval(timer);
    timer = setInterval(checkNow, every * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkNow(); });
  } else if ('serviceWorker' in navigator && !LOCAL) {
    emit({ mode: 'pwa' });
  }
}

/** In locale: confronta con version.json del branch su GitHub. */
export async function checkNow() {
  if (!server?.canUpdate) return null;
  try {
    const url = server.versionUrl || `https://raw.githubusercontent.com/${server.repository}/${server.branch || 'main'}/version.json?t=${Date.now()}`;
    const latest = await getJson(url, { mode: 'cors' });
    const available = compareVersions(latest.version, state.installed?.version) > 0;
    emit({ latest, available, checkedAt: new Date(), error: null });
    if (available) offerUpdate({ latest, apply: applyLocalUpdate });
    return latest;
  } catch (e) {
    emit({ error: e.message, checkedAt: new Date() });
    return null;
  }
}

/** In locale: il server scarica la versione nuova e sostituisce i file; poi si ricarica la pagina. */
async function applyLocalUpdate(setMessage) {
  setMessage('Scarico e installo la nuova versione…');
  const r = await fetch('/__dollaroni/update', { method: 'POST', headers: { 'X-Dollaroni': 'update' } });
  const res = await r.json().catch(() => ({ ok: false, error: `risposta non valida (${r.status})` }));
  if (!res.ok) throw new Error(res.error || 'aggiornamento non riuscito');
  if (res.restartNeeded) {
    setMessage(`Aggiornato alla ${res.to}. È cambiato anche il server: chiudi la finestra nera di Dollaroni e riapri "Avvia Dollaroni.bat".`, true);
    return;
  }
  setMessage(`Aggiornato alla ${res.to}: ricarico…`);
  setTimeout(() => location.reload(), 700);
}

// ------------------------------------------------------------------ avviso (DOM semplice, fuori da Preact)
let shownFor = null;

/**
 * Mostra "È disponibile una nuova versione". latest = version.json nuovo (se noto);
 * apply(setMessage) esegue l'aggiornamento.
 */
export function offerUpdate({ latest, apply }) {
  const key = latest?.version || 'sw';
  if (shownFor === key && document.querySelector('.update-banner')) return;
  document.querySelector('.update-banner')?.remove();
  shownFor = key;
  emit({ available: true, latest: latest || state.latest });
  notifySystem(latest);

  const bar = document.createElement('div');
  bar.className = 'update-banner';
  bar.setAttribute('role', 'status');
  const text = document.createElement('div');
  text.className = 'update-text';
  const title = document.createElement('strong');
  title.textContent = latest?.version ? `È disponibile Dollaroni ${latest.version}` : 'È disponibile una nuova versione di Dollaroni';
  text.append(title);
  if (latest?.notes?.length) {
    const ul = document.createElement('ul');
    for (const n of latest.notes.slice(0, 4)) {
      const li = document.createElement('li');
      li.textContent = n;
      ul.append(li);
    }
    text.append(ul);
  }
  const hint = document.createElement('span');
  hint.className = 'update-hint';
  hint.textContent = "Il progetto aperto è già salvato nel browser: dopo l'aggiornamento scegli \"Riprendi\".";
  text.append(hint);

  const later = Object.assign(document.createElement('button'), { className: 'btn btn-sm', textContent: 'Più tardi' });
  const now = Object.assign(document.createElement('button'), { className: 'btn btn-sm btn-primary', textContent: 'Aggiorna ora' });
  later.onclick = () => bar.remove();
  const setMessage = (msg, final = false) => {
    hint.textContent = msg;
    now.disabled = !final;
    if (final) { now.textContent = 'OK'; now.onclick = () => bar.remove(); }
  };
  now.onclick = async () => {
    now.disabled = true;
    now.textContent = 'Aggiorno…';
    later.remove();
    try {
      await apply(setMessage);
    } catch (e) {
      hint.textContent = `Aggiornamento non riuscito: ${e.message}`;
      now.disabled = false;
      now.textContent = 'Riprova';
    }
  };
  const actions = document.createElement('div');
  actions.className = 'update-actions';
  actions.append(later, now);
  if ('Notification' in window && Notification.permission === 'default') {
    const ask = Object.assign(document.createElement('button'), { className: 'link small', textContent: 'Avvisami anche con le notifiche' });
    ask.onclick = () => Notification.requestPermission().then(() => ask.remove());
    text.append(ask);
  }
  bar.append(text, actions);
  document.body.append(bar);
}

/** Notifica di sistema se la finestra non è in primo piano e l'utente le ha permesse. */
function notifySystem(latest) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
    new Notification(latest?.version ? `Dollaroni ${latest.version} disponibile` : 'Nuova versione di Dollaroni', {
      body: latest?.notes?.[0] || 'Apri Dollaroni e clicca "Aggiorna ora".', icon: 'icons/icon-192.png', tag: 'dollaroni-update',
    });
  } catch { /* alcune piattaforme non permettono new Notification */ }
}

/** Finestra "Novità": note della versione installata (o appena installata). */
export function showNews(v, { updated = false } = {}) {
  if (!v) return;
  document.querySelector('.news-modal')?.remove();
  const wrap = document.createElement('div');
  wrap.className = 'news-modal';
  wrap.setAttribute('role', 'dialog');
  const box = document.createElement('div');
  box.className = 'news-box';
  const h = document.createElement('h3');
  h.textContent = updated ? `Dollaroni aggiornato alla ${v.version}` : `Dollaroni ${v.version}`;
  const date = document.createElement('p');
  date.className = 'muted small';
  date.textContent = v.date ? `Versione del ${new Date(v.date).toLocaleDateString('it-IT')}` : '';
  const ul = document.createElement('ul');
  for (const n of v.notes || []) {
    const li = document.createElement('li');
    li.textContent = n;
    ul.append(li);
  }
  const ok = Object.assign(document.createElement('button'), { className: 'btn btn-primary btn-sm', textContent: 'OK' });
  const close = () => wrap.remove();
  ok.onclick = close;
  wrap.onclick = (e) => { if (e.target === wrap) close(); };
  box.append(h, date, ul, ok);
  wrap.append(box);
  document.body.append(wrap);
  ok.focus();
}
