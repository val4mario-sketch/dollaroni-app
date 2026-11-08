// Project state: undo/redo changes, automatic save in the browser,
// opening/saving the .dollaroni.json file.
// (Saving to Google Drive will hook in here: same open/save functions.)

import { useState, useRef, useEffect, useCallback } from '../../vendor/preact-htm.js';

const AUTOSAVE_KEY = 'dollaroni.autosave.v1';
const RECOVERY_KEY = 'dollaroni.recovery.v1';
const HISTORY_LIMIT = 100;
const COALESCE_MS = 1200;

/**
 * Main hook. update(fn, key): fn receives an editable copy of the project.
 * Consecutive changes with the same key (e.g. while typing in a field) become a single undo step.
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

// ---------------------------------------------------------------- automatic save
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
        /* storage full or blocked: the file stays the good copy */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [project, meta.fileName, meta.savedJson, meta.pristineJson]);
}

/**
 * true if the project contains work that is on no file: different both from the last save
 * and from how it was when just opened (savedJson and pristineJson may be missing).
 */
export function hasUnsavedWork(project, savedJson, pristineJson) {
  if (!project) return false;
  const json = serialize(project);
  return json !== savedJson && json !== pristineJson;
}

/** Recovery copy of the work about to be replaced (only one, the latest). Returns false if it fails. */
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
    /* storage blocked: there is nothing to remove */
  }
}

// ---------------------------------------------------------------- file
const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/** Numeric fields may be missing or null, but not text or anything else. */
function checkNumbers(obj, fields, where) {
  if (!obj) return;
  for (const f of fields) {
    const v = obj[f];
    if (v !== undefined && v !== null && !Number.isFinite(v)) throw new Error(`${where}: "${f}" must be a number (found ${JSON.stringify(v)})`);
  }
}

function checkList(p, key, what) {
  if (p[key] === undefined || p[key] === null) { p[key] = []; return; }
  if (!Array.isArray(p[key])) throw new Error(`"${key}" must be a list of ${what}`);
  p[key].forEach((x, i) => {
    if (!isObject(x)) throw new Error(`${what} n. ${i + 1} not valid (found ${JSON.stringify(x)})`);
  });
}

export function validateProject(p) {
  if (!isObject(p)) throw new Error('The file does not contain a project');
  if (p.schema !== 'dollaroni/1') throw new Error(`Format not recognized (${p.schema ?? 'no schema'}): a Dollaroni file is needed`);
  checkList(p, 'parts', 'pezzi');
  checkList(p, 'lines', 'items');
  checkList(p, 'catalogExtras', 'team items');
  checkNumbers(p, ['budget'], 'Project');
  for (const part of p.parts) {
    const where = `Part "${part.name ?? part.id}"`;
    if (part.substacks !== undefined && part.substacks !== null && !Array.isArray(part.substacks)) throw new Error(`${where}: "substacks" must be a list`);
    (part.substacks || []).forEach((s, i) => {
      if (!isObject(s)) throw new Error(`${where}: substack n. ${i + 1} not valid`);
      checkNumbers(s, ['plyArea', 'plies', 'arealWeight'], `${where}, substack n. ${i + 1}`);
    });
    checkNumbers(part.core, ['mass', 'area', 'thickness', 'density', 'resinUptake'], `${where}, core`);
    checkNumbers(part, ['measuredMass'], where);
    if (isObject(part.waste)) checkNumbers(part.waste, Object.keys(part.waste), `${where}, waste`);
  }
  for (const line of p.lines) {
    const where = `Item "${line.name ?? line.id}"`;
    checkNumbers(line.material, ['qty', 'price', 'waste'], where);
    checkNumbers(line.process, ['hours', 'rate'], where);
  }
  for (const extra of p.catalogExtras) checkNumbers(extra, ['price', 'density'], `Team item "${extra.name ?? extra.id}"`);
  if (p.baseline?.project) validateProject(p.baseline.project);
  return p;
}

export const serialize = (p) => JSON.stringify(p, null, 2);

const PICKER_TYPES = [{ description: 'Dollaroni project', accept: { 'application/json': ['.json'] } }];

/** Opens a project. Returns {project, handle, fileName, lastModified} or null if cancelled. */
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
 * Saves: to the same file if possible, otherwise asks where (or downloads). Returns {handle, fileName, lastModified} or null.
 * If the file changed after opening or the last save (knownModified), overwrites it only if confirmOverwrite(lastModified) says yes.
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
