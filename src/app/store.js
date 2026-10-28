// Stato del progetto: modifiche con annulla/ripeti, salvataggio automatico nel browser,
// apertura/salvataggio del file .dollaroni.json.
// (Il salvataggio su Google Drive si aggancerà qui: stesse funzioni open/save.)

import { useState, useRef, useEffect, useCallback } from '../../vendor/preact-htm.js';

const AUTOSAVE_KEY = 'dollaroni.autosave.v1';
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
  }, [project, meta.fileName, meta.savedJson]);
}

// ---------------------------------------------------------------- file
export function validateProject(p) {
  if (!p || typeof p !== 'object') throw new Error('Il file non contiene un progetto');
  if (p.schema !== 'dollaroni/1') throw new Error(`Formato non riconosciuto (${p.schema ?? 'senza schema'}): serve un file di Dollaroni`);
  p.parts ||= [];
  p.lines ||= [];
  p.catalogExtras ||= [];
  return p;
}

export const serialize = (p) => JSON.stringify(p, null, 2);

const PICKER_TYPES = [{ description: 'Progetto Dollaroni', accept: { 'application/json': ['.json'] } }];

/** Apre un progetto. Ritorna {project, handle, fileName} oppure null se annullato. */
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
    return { project: validateProject(JSON.parse(await file.text())), handle, fileName: file.name };
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

/** Salva: sullo stesso file se possibile, altrimenti chiede dove (o scarica). Ritorna {handle, fileName} o null. */
export async function saveProjectFile(project, handle, { saveAs = false } = {}) {
  const text = serialize({ ...project, savedAt: new Date().toISOString() });
  if (handle && !saveAs) {
    const w = await handle.createWritable();
    await w.write(text);
    await w.close();
    return { handle, fileName: handle.name };
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
    return { handle: h, fileName: h.name };
  }
  const name = suggestedFileName(project);
  downloadBytes(new TextEncoder().encode(text), name, 'application/json');
  return { handle: null, fileName: name };
}

export function downloadBytes(bytes, name, mime = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
