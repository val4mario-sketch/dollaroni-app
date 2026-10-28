// Import dei file ufficiali SuMoth:
//  - 20xx_SMC_Standardized_Costs.xlsx     -> catalogo prezzi SM$
//  - 20xx_SMC_Composite_Layup_Calculator  -> materiali, densità, processi e Vf del calcolatore
// Ogni anno basta caricare i file nuovi: il resto dell'app legge da qui.

import { openXlsx, toRows, splitRef } from './xlsx.js';

// ---------------------------------------------------------------- catalogo costi

const SHEET_KIND = {
  REINFORCEMENTS: 'reinforcement',
  MATRIX: 'matrix',
  PREPREGS: 'prepreg',
  'CORE MATERIALS': 'core',
  PROCESSES: 'process',
  CONSUMABLES: 'consumable',
  OTHER: 'other',
};

const UNIT_RULES = [
  [/hour/i, 'h'],
  [/15\s*m\s*roll/i, 'roll15'],
  [/sqm|m2|m²/i, 'm2'],
  [/linear\s*met/i, 'm'],
  [/brush/i, 'pc'],
  [/lit/i, 'L'],
  [/kg/i, 'kg'],
];

export function normUnit(text) {
  if (!text) return null;
  for (const [re, u] of UNIT_RULES) if (re.test(text)) return u;
  return String(text).trim();
}

export function slug(text) {
  return String(text)
    .replace(/\(.*$/, '') // "Std Modulus CF (i.e. T700)" -> "Std Modulus CF"
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parsePrice(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const m = /(-?\d+(?:[.,]\d+)?)/.exec(String(v)); // es. "SM$ 20"
  return m ? Number(m[1].replace(',', '.')) : null;
}

const clean = (v) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());

/**
 * Legge il listino ufficiale. Ritorna {entries, warnings}.
 * entry: {id, kind, sheet, group, type, name, unit, price, note}
 */
export async function importCostCatalog(bytes, JSZipLib) {
  const x = await openXlsx(bytes, JSZipLib);
  const entries = [];
  const warnings = [];
  const byId = new Map();

  for (const sheet of x.sheets) {
    const kindBase = SHEET_KIND[sheet.name.trim().toUpperCase()];
    if (!kindBase) {
      warnings.push(`Foglio "${sheet.name}" ignorato: non è una categoria nota del listino`);
      continue;
    }
    const rows = toRows(await x.cells(sheet.name));
    const header = rows[1] || [];
    const priceCol = header.findIndex((h) => /SM\$/i.test(clean(h)));
    if (priceCol < 0) {
      warnings.push(`Foglio "${sheet.name}": colonna prezzo non trovata`);
      continue;
    }
    const unitCol = header.findIndex((h) => /^unit$/i.test(clean(h)));
    const nameCols = [];
    for (let c = 1; c < priceCol; c++) if (c !== unitCol) nameCols.push(c);
    const noteCols = [];
    for (let c = priceCol + 1; c < header.length; c++) if (c !== unitCol && clean(header[c])) noteCols.push(c);
    const headerUnit = normUnit(clean(header[priceCol]).split('/')[1]);

    let group = '';
    for (let r = 2; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;
      const first = clean(row[nameCols[0]]);
      const second = nameCols.length > 1 ? clean(row[nameCols[1]]) : '';
      const price = parsePrice(row[priceCol]);
      if (!first && !second && price === null) continue;

      if (first) group = first;
      // Riga-titolo di sezione (es. "ADDITIVE MANUFACTURING"): tutto maiuscolo, senza tipo né prezzo.
      if (first && !second && price === null && first === first.toUpperCase() && /[A-Z]/.test(first)) continue;

      const type = nameCols.length > 1 ? second : '';
      const note = noteCols.map((c) => clean(row[c])).filter(Boolean).join(' · ');
      const unit = unitCol >= 0 ? normUnit(clean(row[unitCol])) : headerUnit;
      let kind = kindBase;
      if (kind === 'reinforcement' && /prepreg/i.test(group)) kind = 'prepreg';

      let id = slug(group) + (type && !/^all$/i.test(type) ? '/' + slug(type) : '');
      const entry = {
        id, kind, sheet: sheet.name, group, type,
        name: type && !/^all$/i.test(type) ? `${group} – ${type}` : group,
        unit, price, note,
      };
      const prev = byId.get(id);
      if (prev) {
        if (prev.price === price) continue; // stessa voce ripetuta in due fogli (es. prepreg)
        let n = 2;
        while (byId.has(`${id}~${n}`)) n++;
        entry.id = `${id}~${n}`;
        warnings.push(`"${entry.name}" compare più volte con prezzi diversi (${prev.price} e ${price} SM$): tenute entrambe (${prev.id}, ${entry.id})`);
      }
      if (price === null) warnings.push(`"${entry.name}" non ha prezzo nel listino ufficiale: va chiesto su Discord`);
      byId.set(entry.id, entry);
      entries.push(entry);
    }
  }
  return { entries, warnings };
}

// ---------------------------------------------------------------- Layup Calculator

/** Mappa delle celle del template 2026 (foglio unico, 5 substack da 3 righe). */
export const LAYUP_TEMPLATE_2026 = {
  sheet: 'Composite stacking calculation',
  partNameCell: 'D7',
  substackRows: [12, 15, 18, 21, 24],
  totals: { composite: 'K27', shareSum: 'M27', fibres: 'K28', fibresPct: 'K29', resin: 'K30', resinPct: 'K31' },
  options: { reinforcements: [3, 11], matrices: [12, 13], processes: [3, 13] }, // righe in colonne T/U e V/W
  checks: { A7: 'PART NAME:', B10: 'REINFORCEMENT', B11: 'MATRIX', A12: 'A', A15: 'B', A18: 'C', A21: 'D', A24: 'E', J27: 'Total Composite (g)' },
};

/**
 * Estrae dal template ufficiale le opzioni del calcolatore:
 * {reinforcements: [{name, exact, density}], matrices: [...], processes: [{name, exact, vf}]}
 * "exact" è il testo esatto da scrivere nella cella (es. "AUTOCLAVE " con lo spazio finale),
 * altrimenti le formule IF del template non lo riconoscono.
 */
export async function importLayupSpec(bytes, JSZipLib, layout = LAYUP_TEMPLATE_2026) {
  const x = await openXlsx(bytes, JSZipLib);
  const cells = await x.cells(layout.sheet);
  const val = (ref) => cells.get(ref)?.value ?? null;

  for (const [ref, expected] of Object.entries(layout.checks)) {
    if (clean(val(ref)) !== expected) {
      throw new Error(`Il template del Layup Calculator non ha la struttura attesa (cella ${ref}: "${val(ref)}" invece di "${expected}"). Va aggiornata la mappa delle celle.`);
    }
  }

  const list = (col, valueCol, [from, to]) => {
    const out = [];
    for (let r = from; r <= to; r++) {
      const exact = val(col + r);
      if (exact === null || clean(exact) === '') continue;
      out.push({ name: clean(exact), exact: String(exact), value: Number(val(valueCol + r)) });
    }
    return out;
  };
  const reinf = list('T', 'U', layout.options.reinforcements).map(({ name, exact, value }) => ({ name, exact, density: value }));
  const matrices = list('T', 'U', layout.options.matrices).map(({ name, exact, value }) => ({ name, exact, density: value }));
  const processes = list('V', 'W', layout.options.processes).map(({ name, exact, value }) => ({ name, exact, vf: value }));
  return { layout, reinforcements: reinf, matrices, processes };
}

export { splitRef };
