// Progetti e elementi nuovi con valori di partenza sensati.

import { uid } from './format.js';
import { CURRENT_RULES, RULES_2026 } from '../engine/rules.js';

export const DEFAULT_SEASON = 2027;

export function emptyProject(season = DEFAULT_SEASON) {
  return {
    schema: 'dollaroni/1', name: 'Nuova barca', team: 'SFT', season, stage: 'S1', concept: 'NEW', rules: CURRENT_RULES,
    catalogExtras: [], parts: [], lines: [],
  };
}

/**
 * Nuova barca partendo dalla struttura della stima S1 2026: stessi pezzi (con voci di costo
 * generate in automatico) e stesse voci non legate ai laminati (stampo, consumabili, rig…).
 */
export function projectFrom2026(s1) {
  const p = toRules2027(s1);
  Object.assign(p, { name: 'Nuova barca', season: DEFAULT_SEASON, stage: 'S1', concept: 'NEW', description: 'Partita dalla struttura di Meravijosa S1 2026: da aggiornare con il nuovo progetto.' });
  delete p.savedAt;
  for (const part of p.parts) {
    part.autoLines = true;
    delete part.note;
  }
  // Le righe fibra/resina/anima ora le generano i pezzi; resta solo l'eventuale lavorazione.
  p.lines = p.lines.flatMap((l) => {
    if (!l.material?.check) return [l];
    if (!l.process) return [];
    const { material, ...rest } = l;
    return [{ ...rest, name: l.process.label || 'Process' }];
  });
  return p;
}

/**
 * Porta un progetto dalle regole 2026 alle 2027. Cambia solo quello che il regolamento nuovo tratta
 * in modo diverso: le parti usate perdono il costo fisso della vecchia Tab. 3 e diventano voci a prezzo
 * (si parte dal costo 2026, da confermare su Agora: la fonte resta vuota e i controlli lo segnalano).
 * La baseline S1, se c'è, resta com'era: è la stima consegnata.
 */
export function toRules2027(project) {
  const p = structuredClone(project);
  p.rules = '2027';
  for (const l of p.lines || []) {
    if (!l.usedPart) continue;
    const old = RULES_2026.usedParts[l.usedPart.element];
    const { participationYear, ...u } = l.usedPart;
    l.usedPart = { ...u, commercial: u.commercial ?? true };
    if (!l.material) l.material = { name: old?.en || l.name, unit: 'pc', qty: 1, price: old?.cost ?? null, priceSource: '' };
  }
  return p;
}

/**
 * Passaggio S1 -> S2. L'S1 così com'è viene congelato e salvato DENTRO il progetto S2 (baseline),
 * così il confronto richiesto dalla 2.3 dell'S2 è sempre disponibile. L'S2 parte dagli stessi pezzi
 * e voci (stessi id, per poterli confrontare uno a uno), tutti segnati "stimata" finché non vengono
 * aggiornati con i valori reali.
 */
export function freezeToS2(project, now = new Date().toISOString()) {
  if (project.stage === 'S2') throw new Error('Il progetto è già in S2');
  const frozen = structuredClone(project);
  delete frozen.baseline;
  delete frozen.savedAt;
  frozen.frozenAt = now;
  const s2 = structuredClone(frozen);
  delete s2.frozenAt;
  s2.stage = 'S2';
  s2.baseline = { stage: 'S1', frozenAt: now, project: frozen };
  for (const l of s2.lines) l.status = 'estimated';
  for (const p of s2.parts) p.status = 'estimated';
  return { s2, frozen };
}

export const DEFAULT_GROUPS = {
  hull: { limitGroup: 'hull', massGroup: 'hull' },
  foils: { limitGroup: 'main_vertical', massGroup: 'vertical_foils' },
  mechanical_control: { limitGroup: 'other', massGroup: 'other' },
  gantry: { limitGroup: 'gantry', massGroup: 'other' },
  wingbars: { limitGroup: 'wingbars', massGroup: 'wings' },
  rig: { limitGroup: 'rig', massGroup: 'other' },
  electronics: { limitGroup: 'other', massGroup: 'other' },
};

export function newSubstack(prev) {
  if (prev) return { ...structuredClone(prev) };
  return {
    reinforcement: 'dry-fabric-basalt-fibers', matrix: 'std-epoxy/lamination-resin',
    plyArea: 1, plies: 2, arealWeight: 300, process: 'HAND LAYUP + VAC',
    reinforcementSource: 'new', matrixSource: 'new',
  };
}

export function newPart(component = 'hull') {
  return {
    id: uid('part'), name: 'Nuovo pezzo', component, ...DEFAULT_GROUPS[component], autoLines: true,
    substacks: [newSubstack()],
  };
}

/** true se le parti usate hanno un costo fisso (Tab. 3 2026); nel 2027 si pagano al prezzo della voce. */
export const fixedUsedParts = (rules) => Object.values(rules.usedParts || {}).some((d) => d.cost !== null);

/** Tipi di voce che si possono aggiungere, con i suggerimenti del regolamento in uso. */
export function lineTypes(rules) {
  const fixed = fixedUsedParts(rules);
  const confirm = rules.sourcesToConfirm ? ' (da confermare su Agora)' : '';
  return [
    { id: 'material', label: 'Materiale del listino', hint: 'stampi, gelcoat, adesivi, consumabili, filamenti…' },
    { id: 'process', label: 'Lavorazione a ore', hint: 'CNC, stampa 3D, forno, autoclave…' },
    { id: 'hardware', label: 'Hardware / voce a prezzo', hint: fixed ? 'bozzelli, cime, elettronica (prezzo MSRP)' : 'bozzelli, cime, elettronica (prezzo da Agora o MSRP, con la fonte)' },
    fixed
      ? { id: 'used', label: 'Parte usata (Tab. 3)', hint: 'foil o rig usati: costo fisso e handicap' }
      : { id: 'used', label: 'Parte usata o commerciale', hint: 'foil, vele, alberi…: prezzo da Agora; −100 punti se commerciale dal 2017 (§11.1.5)' },
    { id: 'upcycled', label: 'Elemento upcycled', hint: `da artefatti obsoleti: 0 SM$${confirm}, va indicata l'origine` },
  ];
}

export function newLine(type, component, rules = RULES_2026) {
  const base = { id: uid('line'), component, name: '' };
  switch (type) {
    case 'material': return { ...base, name: 'Nuova voce', material: { ref: 'mdf-hdf-wood', qty: 0, source: 'new' } };
    case 'process': return { ...base, name: 'Lavorazione', process: { ref: 'machining', hours: 0 } };
    case 'hardware': return { ...base, name: 'Hardware', material: { name: '', unit: 'pc', qty: 1, price: 0, priceSource: '' } };
    case 'used':
      if (fixedUsedParts(rules)) return { ...base, name: 'Parte usata', usedPart: { element: 'main_vertical', year: 2014 }, origin: '' };
      // 2027: prezzo da inserire (niente costo fisso); anno da indicare per il §11.1.5
      return { ...base, name: 'Parte usata', material: { name: rules.usedParts.main_vertical.en, unit: 'pc', qty: 1, priceSource: '' }, usedPart: { element: 'main_vertical', year: null, commercial: true }, origin: '' };
    case 'upcycled': return { ...base, name: 'Elemento upcycled', material: { name: '', unit: 'pc', qty: 1, source: 'upcycled' }, origin: '' };
    default: throw new Error('Tipo voce sconosciuto: ' + type);
  }
}

export function lineType(l) {
  if (l.usedPart) return 'used';
  if (!l.material && l.process) return 'process';
  if (l.material && !l.material.ref) return l.material.source === 'upcycled' ? 'upcycled' : 'hardware';
  return 'material';
}
