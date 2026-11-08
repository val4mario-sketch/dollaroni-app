// "Real app" updates: at start-up, every 30 minutes and when you return to the window
// we check whether GitHub has a newer version; if so, a notice appears with the changes
// (and, if the user allowed it, a Windows notification too).
//
// Two ways of using Dollaroni, a single notice:
//  - published site (GitHub Pages, installed app): the service worker downloads the new version
//    and "Update now" activates it (src/app/pwa.js calls offerUpdate);
//  - locally with "Avvia Dollaroni.bat": the local server (tools/devserver.py) knows which repository
//    to update from; here version.json is compared with the one on GitHub and "Update now" asks the server
//    to download and replace the app files (the .dollaroni.json projects are not touched).
//
// version.json: {version, date, notes[]}. To publish a version: python tools/release.py (see README).

const LAST_SEEN = 'dollaroni.lastSeenVersion';
const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* niente */ } },
};

/** -1, 0, 1 comparing "0.5.0" with "0.10.1". */
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

/** Version in use (version.json served with the app). */
export const installedVersion = () => getJson('version.json').catch(() => null);

/** Local server info (only with Avvia Dollaroni.bat); null elsewhere. */
async function serverInfo() {
  if (!LOCAL) return null;
  try {
    const i = await getJson('/__dollaroni/info');
    return i?.app === 'dollaroni' ? i : null;
  } catch {
    return null;
  }
}

/** Shared state for the sidebar: {installed, latest, mode, repository, available, checkedAt, error}. */
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

/** Start-up: installed version, "What's new" after an update, periodic checks locally. */
export async function startUpdates() {
  const installed = await installedVersion();
  emit({ installed });
  // after an update: show the version's changes once
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

/** Locally: compares with version.json of the branch on GitHub. */
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

/** Locally: the server downloads the new version and replaces the files; then the page reloads. */
async function applyLocalUpdate(setMessage) {
  setMessage('Downloading and installing the new version…');
  const r = await fetch('/__dollaroni/update', { method: 'POST', headers: { 'X-Dollaroni': 'update' } });
  const res = await r.json().catch(() => ({ ok: false, error: `invalid answer (${r.status})` }));
  if (!res.ok) throw new Error(res.error || 'update failed');
  if (res.restartNeeded) {
    setMessage(`Updated to ${res.to}. The server changed too: close the black Dollaroni window and reopen "Avvia Dollaroni.bat".`, true);
    return;
  }
  setMessage(`Updated to ${res.to}: reloading…`);
  setTimeout(() => location.reload(), 700);
}

// ------------------------------------------------------------------ notice (plain DOM, outside Preact)
let shownFor = null;

/**
 * Shows "A new version is available". latest = new version.json (if known);
 * apply(setMessage) runs the update.
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
  title.textContent = latest?.version ? `Dollaroni is available: ${latest.version}` : 'A new version of Dollaroni is available';
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
  hint.textContent = "The open project is already saved in the browser: after the update choose \"Resume\".";
  text.append(hint);

  const later = Object.assign(document.createElement('button'), { className: 'btn btn-sm', textContent: 'Later' });
  const now = Object.assign(document.createElement('button'), { className: 'btn btn-sm btn-primary', textContent: 'Update now' });
  later.onclick = () => bar.remove();
  const setMessage = (msg, final = false) => {
    hint.textContent = msg;
    now.disabled = !final;
    if (final) { now.textContent = 'OK'; now.onclick = () => bar.remove(); }
  };
  now.onclick = async () => {
    now.disabled = true;
    now.textContent = 'Updating…';
    later.remove();
    try {
      await apply(setMessage);
    } catch (e) {
      hint.textContent = `Update failed: ${e.message}`;
      now.disabled = false;
      now.textContent = 'Retry';
    }
  };
  const actions = document.createElement('div');
  actions.className = 'update-actions';
  actions.append(later, now);
  if ('Notification' in window && Notification.permission === 'default') {
    const ask = Object.assign(document.createElement('button'), { className: 'link small', textContent: 'Also notify me with notifications' });
    ask.onclick = () => Notification.requestPermission().then(() => ask.remove());
    text.append(ask);
  }
  bar.append(text, actions);
  document.body.append(bar);
}

/** System notification if the window is not in the foreground and the user allowed it. */
function notifySystem(latest) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
    new Notification(latest?.version ? `Dollaroni ${latest.version} available` : 'New version of Dollaroni', {
      body: latest?.notes?.[0] || 'Open Dollaroni and click "Update now".', icon: 'icons/icon-192.png', tag: 'dollaroni-update',
    });
  } catch { /* some platforms do not allow new Notification */ }
}

/** "What's new" window: notes of the installed (or just installed) version. */
export function showNews(v, { updated = false } = {}) {
  if (!v) return;
  document.querySelector('.news-modal')?.remove();
  const wrap = document.createElement('div');
  wrap.className = 'news-modal';
  wrap.setAttribute('role', 'dialog');
  const box = document.createElement('div');
  box.className = 'news-box';
  const h = document.createElement('h3');
  h.textContent = updated ? `Dollaroni updated to ${v.version}` : `Dollaroni ${v.version}`;
  const date = document.createElement('p');
  date.className = 'muted small';
  date.textContent = v.date ? `Version of ${new Date(v.date).toLocaleDateString('it-IT')}` : '';
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
