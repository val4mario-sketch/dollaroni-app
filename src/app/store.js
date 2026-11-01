// Stato del progetto: modifiche con annulla/ripeti, salvataggio automatico nel browser,
// apertura/salvataggio del file .dollaroni.json.
// (Il salvataggio su Google Drive si aggancerà qui: stesse funzioni open/save.)

import { useState, useRef, useEffect, useCallback } from '../../vendor/preact-htm.js';

const AUTOSAVE_KEY = 'dollaroni.autosave.v1';
const RECOVERY_KEY = 'dollaroni.recovery.v1';
const HISTORY_LIMIT = 100;
const COALESCE_MS = 1200;

/**
 * Hook principale. update(fn, key): fn riceve una copia modificabile del progetto.
 * Modifiche consecutive con la stessa key (es. mentre scrivi in un campo) diventano un solo passo di annulla.
 */
export function useProject(initial) {
  const [state, setState] = useState({ past: [], present: initial, future: [] });
  const last = useRef({ key: null, at: 0 });

  const update = useCallback((fn, key = null) => {
    setState((s) => {
      if (!s.present) return s;
      const draft = structuredClone(s.present);
      const result = fn(draft);
      const next = result === undefined ? draft : result;
      const now = Date.now();
      const coalesce = key && last.current.key === key && now - last.current.at < COALESCE_MS;
      last.current = { key, at: now };
      const past = coalesce ? s.past : [...s.past, s.present].slice(-HISTORY_LIMIT);
      return { past, present: next, future: [] };
    });
  }, []);

  const replace = useCallback((project) => {
    last.current = { key: null, at: 0 };
    setState({ past: [], present: project, future: [] });
  }, []);

  const undo = useCallback(() => setState((s) => (s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] } : s)), []);
  const redo = useCallback(() => setState((s) => (s.future.length ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s)), []);

  return { project: state.present, update, replace, undo, redo, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}

// ---------------------------------------------------------------- salvataggio automatico
export function loadAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function useAutosave(project, meta) {
  useEffect(() => {
    if (!project) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ project, ...meta, autosavedAt: new Date().toISOString() }));
      } catch {
        /* spazio pieno o storage bloccato: il file resta la copia buona */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [project, meta.fileName, meta.savedJson, meta.pristineJson]);
}

/**
 * true se il progetto contiene lavoro che non è su nessun file: diverso sia dall'ultimo salvataggio
 * sia da com'era appena aperto (savedJson e pristineJson possono mancare).
 */
export function hasUnsavedWork(project, savedJson, pristineJson) {
  if (!project) return false;
  const json = serialize(project);
  return json !== savedJson && json !== pristineJson;
}

/** Copia di recupero del lavoro che sta per essere sostituito (una sola, l'ultima). Ritorna false se non riesce. */
export function saveRecoveryCopy({ project, fileName = null, savedJson = null, pristineJson = null }) {
  try {
    localStorage.setItem(RECOVERY_KEY, JSON.stringify({ project, fileName, savedJson, pristineJson, keptAt: new Date().toISOString() }));
    return true;
  } catch {
    return false;
  }
}

export function loadRecoveryCopy() {
  try {
    const raw = localStorage.getItem(RECOVERY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearRecoveryCopy() {
  try {
    localStorage.removeItem(RECOVERY_KEY);
  } catch {
    /* storage bloccato: non c'è niente da togliere */
  }
}

// ---------------------------------------------------------------- file
const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/** I campi numerici possono mancare o essere null, ma non essere testo o altro. */
function checkNumbers(obj, fields, where) {
  if (!obj) return;
  for (const f of fields) {
    const v = obj[f];
    if (v !== undefined && v !== null && !Number.isFinite(v)) throw new Error(`${where}: "${f}" deve essere un numero (trovato ${JSON.stringify(v)})`);
  }
}

function checkList(p, key, what) {
  if (p[key] === undefined || p[key] === null) { p[key] = []; return; }
  if (!Array.isArray(p[key])) throw new Error(`"${key}" deve essere un elenco di ${what}`);
  p[key].forEach((x, i) => {
    if (!isObject(x)) throw new Error(`${what} n. ${i + 1} non valido (trovato ${JSON.stringify(x)})`);
  });
}

export function validateProject(p) {
  if (!isObject(p)) throw new Error('Il file non contiene un progetto');
  if (p.schema !== 'dollaroni/1') throw new Error(`Formato non riconosciuto (${p.schema ?? 'senza schema'}): serve un file di Dollaroni`);
  checkList(p, 'parts', 'pezzi');
  checkList(p, 'lines', 'voci');
  checkList(p, 'catalogExtras', 'voci del team');
  checkNumbers(p, ['budget'], 'Progetto');
  for (const part of p.parts) {
    const where = `Pezzo "${part.name ?? part.id}"`;
    if (part.substacks !== undefined && part.substacks !== null && !Array.isArray(part.substacks)) throw new Error(`${where}: "substacks" deve essere un elenco`);
    (part.substacks || []).forEach((s, i) => {
      if (!isObject(s)) throw new Error(`${where}: substack n. ${i + 1} non valido`);
      checkNumbers(s, ['plyArea', 'plies', 'arealWeight'], `${where}, substack n. ${i + 1}`);
    });
    checkNumbers(part.core, ['mass', 'area', 'thickness', 'density', 'resinUptake'], `${where}, anima`);
    checkNumbers(part, ['measuredMass'], where);
    if (isObject(part.waste)) checkNumbers(part.waste, Object.keys(part.waste), `${where}, scarti`);
  }
  for (const line of p.lines) {
    const where = `Voce "${line.name ?? line.id}"`;
    checkNumbers(line.material, ['qty', 'price', 'waste'], where);
    checkNumbers(line.process, ['hours', 'rate'], where);
  }
  for (const extra of p.catalogExtras) checkNumbers(extra, ['price', 'density'], `Voce del team "${extra.name ?? extra.id}"`);
  if (p.baseline?.project) validateProject(p.baseline.project);
  return p;
}

export const serialize = (p) => JSON.stringify(p, null, 2);

const PICKER_TYPES = [{ description: 'Progetto Dollaroni', accept: { 'application/json': ['.json'] } }];

/** Apre un progetto. Ritorna {project, handle, fileName, lastModified} oppure null se annullato. */
export async function openProjectFile() {
  if (window.showOpenFilePicker) {
    let handle;
    try {
      [handle] = await window.showOpenFilePicker({ types: PICKER_TYPES });
    } catch (e) {
      if (e.name === 'AbortError') return null;
      throw e;
    }
    const file = await handle.getFile();
    return { project: validateProject(JSON.parse(await file.text())), handle, fileName: file.name, lastModified: file.lastModified };
  }
  const file = await new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
    input.onchange = () => resolve(input.files[0] || null);
    input.click();
  });
  if (!file) return null;
  return { project: validateProject(JSON.parse(await file.text())), handle: null, fileName: file.name };
}

export function suggestedFileName(p) {
  const base = `${p.name || 'progetto'} ${p.season || ''} ${p.stage || ''}`.trim().replace(/[\\/:*?"<>|]+/g, '-');
  return `${base}.dollaroni.json`;
}

/**
 * Salva: sullo stesso file se possibile, altrimenti chiede dove (o scarica). Ritorna {handle, fileName, lastModified} o null.
 * Se il file è cambiato dopo l'apertura o l'ultimo salvataggio (knownModified), lo sovrascrive solo se confirmOverwrite(lastModified) dice sì.
 */
export async function saveProjectFile(project, handle, { saveAs = false, knownModified = null, confirmOverwrite = () => true } = {}) {
  const text = serialize({ ...project, savedAt: new Date().toISOString() });
  if (handle && !saveAs) {
    if (knownModified !== null) {
      const current = (await handle.getFile()).lastModified;
      if (current !== knownModified && !confirmOverwrite(current)) return null;
    }
    const w = await handle.createWritable();
    await w.write(text);
    await w.close();
    return { handle, fileName: handle.name, lastModified: (await handle.getFile()).lastModified };
  }
  if (window.showSaveFilePicker) {
    let h;
    try {
      h = await window.showSaveFilePicker({ suggestedName: suggestedFileName(project), types: PICKER_TYPES });
    } catch (e) {
      if (e.name === 'AbortError') return null;
      throw e;
    }
    const w = await h.createWritable();
    await w.write(text);
    await w.close();
    return { handle: h, fileName: h.name, lastModified: (await h.getFile()).lastModified };
  }
  const name = suggestedFileName(project);
  downloadBytes(new TextEncoder().encode(text), name, 'application/json');
  return { handle: null, fileName: name, lastModified: null };
}

export function downloadBytes(bytes, name, mime = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
