// Import of the official SuMoth files:
//  - 20xx_SMC_Standardized_Costs.xlsx     -> SM$ price catalogue
//  - 20xx_SMC_Composite_Layup_Calculator  -> calculator materials, densities, processes and Vf
// Each year it is enough to load the new files: the rest of the app reads from here.

import { openXlsx, toRows, splitRef } from './xlsx.js';

// ---------------------------------------------------------------- cost catalogue

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
  const m = /(-?\d+(?:[.,]\d+)?)/.exec(String(v)); // e.g. "SM$ 20"
  return m ? Number(m[1].replace(',', '.')) : null;
}

const clean = (v) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());

/**
 * Reads the official price list. Returns {entries, warnings}.
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
      warnings.push(`Sheet "${sheet.name}" ignored: it is not a known price-list category`);
      continue;
    }
    const rows = toRows(await x.cells(sheet.name));
    const header = rows[1] || [];
    const priceCol = header.findIndex((h) => /SM\$/i.test(clean(h)));
    if (priceCol < 0) {
      warnings.push(`Sheet "${sheet.name}": price column not found`);
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
      // Section title row (e.g. "ADDITIVE MANUFACTURING"): all caps, no type or price.
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
        if (prev.price === price) continue; // same item repeated in two sheets (e.g. prepreg)
        let n = 2;
        while (byId.has(`${id}~${n}`)) n++;
        entry.id = `${id}~${n}`;
        warnings.push(`"${entry.name}" appears several times with different prices (${prev.price} e ${price} SM$): both kept (${prev.id}, ${entry.id})`);
      }
      if (price === null) warnings.push(`"${entry.name}" has no price in the official price list: it must be requested on Discord`);
      byId.set(entry.id, entry);
      entries.push(entry);
    }
  }
  return { entries, warnings };
}

// ---------------------------------------------------------------- Layup Calculator

/** Map of the cells of the 2026 template (single sheet, 5 substacks of 3 rows). */
export const LAYUP_TEMPLATE_2026 = {
  sheet: 'Composite stacking calculation',
  partNameCell: 'D7',
  substackRows: [12, 15, 18, 21, 24],
  totals: { composite: 'K27', shareSum: 'M27', fibres: 'K28', fibresPct: 'K29', resin: 'K30', resinPct: 'K31' },
  options: { reinforcements: [3, 11], matrices: [12, 13], processes: [3, 13] }, // rows in columns T/U and V/W
  checks: { A7: 'PART NAME:', B10: 'REINFORCEMENT', B11: 'MATRIX', A12: 'A', A15: 'B', A18: 'C', A21: 'D', A24: 'E', J27: 'Total Composite (g)' },
};

/**
 * Extracts the calculator options from the official template:
 * {reinforcements: [{name, exact, density}], matrices: [...], processes: [{name, exact, vf}]}
 * "exact" is the exact text to write in the cell (e.g. "AUTOCLAVE " with the final space),
 * otherwise the template IF formulas do not recognize it.
 */
export async function importLayupSpec(bytes, JSZipLib, layout = LAYUP_TEMPLATE_2026) {
  const x = await openXlsx(bytes, JSZipLib);
  const cells = await x.cells(layout.sheet);
  const val = (ref) => cells.get(ref)?.value ?? null;

  for (const [ref, expected] of Object.entries(layout.checks)) {
    if (clean(val(ref)) !== expected) {
      throw new Error(`The Layup Calculator template does not have the expected structure (cell ${ref}: "${val(ref)}" instead of "${expected}"). The cell map must be updated.`);
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

// ---------------------------------------------------------------- SuMoth Agora library (2027)

// Agora name -> id of the same item in the 2026 price list, so 2027 projects made from 2026 ones keep working.
// Items without an entry get a new id from their name.
const AGORA_IDS = {
  fibers: {
    'Carbon Fiber STM': 'dry-fabric-carbon-fibers/std-modulus-cf', 'Carbon Fiber IM': 'dry-fabric-carbon-fibers/int-modulus-cf',
    'Carbon Fiber HM': 'dry-fabric-carbon-fibers/high-modulus-cf', 'Carbon Fiber UHM': 'dry-fabric-carbon-fibers/ultra-high-modulus-cf',
    'Glass Fiber S': 'dry-fabric-glass-fibers/s-glass', 'Glass Fiber E': 'dry-fabric-glass-fibers/e-glass',
    'Aramid Kevlar': 'dry-fabric-aramid-fibers/kevlar', 'Aramid BioBased': 'dry-fabric-aramid-fibers/biobased', 'Aramid Other': 'dry-fabric-aramid-fibers/others',
    Basalt: 'dry-fabric-basalt-fibers', Flax: 'dry-fabric-flax', Innegra: 'dry-fabric-innegra', Diolen: 'dry-fabric-diolen',
  },
  prepregs: {
    'Carbon Fiber STM': 'cf-epoxy-prepreg/epoxy-std-modulus-cf', 'Carbon Fiber IM': 'cf-epoxy-prepreg/epoxy-int-modulus-cf',
    'Carbon Fiber HM': 'cf-epoxy-prepreg/epoxy-high-modulus-cf', 'Carbon Fiber UHM': 'cf-epoxy-prepreg/epoxy-ultra-high-modulus-cf',
  },
  matrices: {
    Epoxy: 'std-epoxy/lamination-resin', 'Bio Epoxy': 'bio-based-epoxy/lamination', Polyester: 'polyester/lamination',
    'Vinyl-ester': 'vinyl-esther/lamination', 'PU Resin/Paint': 'pu-resin-paints/coating-core', PA12: 'pa12/reinforcement', PA11: 'pa11/reinforcement',
  },
  adhesives: { 'Methyl Methacrylate (MMA)': 'mma/bonding' },
  cores: {
    'Gurit Balsa': 'wood/balsa', Paulownia: 'wood/paulonia', 'PVC/SAN': 'pvc-san', ASA: 'asa', 'PET standard': 'pet/standard', 'Recycled PET': 'pet/recycled',
    'EPS standard': 'eps/standard', 'EPS recycled': 'eps/recycled', 'XPS standard': 'xps/standard', 'XPS recycled': 'xps/recycled',
    'Honeycomb Aluminium (industry waste only)': 'honeycomb/aluminum', 'Honeycomb Aramid (industry waste only)': 'honeycomb/aramid',
  },
  processes: { 'Machining (CNC)': 'machining', 'Additive Manufacturing': 'additive-manuf', 'Oven cure': 'oven-cure', 'Autoclave cure': 'autoclave-cure', 'Laser (CNC)': 'laser' },
  consumables: {
    'Tacky tape (15 m roll)': 'vacuum-bagging/tacky-tape', 'Vacuum bag': 'vacuum-bagging/vacuum-bag', 'PE vacuum hose': 'vacuum-bagging/pe-vacuum-hose',
    'PVC vacuum hose': 'vacuum-bagging/pvc-vacuum-hose', Breather: 'vacuum-bagging/breather', 'Peel ply': 'vacuum-bagging/peel-ply', Flowmesh: 'vacuum-bagging/flowmesh',
    Brushes: 'vacuum-bagging/brushes', 'Spiral tube (infusion)': 'vacuum-bagging/spiral-tube', 'Release agent water based': 'release-agent/water-based',
    'Release agent solvent based': 'release-agent/solvent-based', 'Release wax': 'release-agent/wax', PVA: 'release-agent/pva', 'Spray tack (VARI)': 'vari/spray-tack',
  },
  raw: {
    'Tooling board Epoxy (0.7 t/cm)': 'tooling-board/epoxy', 'Tooling board PU (0.7 t/cm)': 'tooling-board/pu', 'MDF/HDF wood': 'mdf-hdf-wood',
    'MDF/HDF recycled': 'mdf-hdf-recycled', Steel: 'steel', 'Stainless Steel': 'stainless-steel', Aluminium: 'aluminum', 'Teflon/PTFE (1 kg max from block)': 'teflon-ptfe/block-tape',
  },
  am: { 'PLA filament': 'pla/filament', 'ABS filament': 'abs/filament', 'PETG filament': 'petg/filament', 'Other filaments (co-polymer/reinforced)': 'other-filements/co-polymer-reinforced' },
};
const AGORA_UNITS = { 'm²': 'm2', brush: 'pc', 'lin. m': 'm', L: 'L', kg: 'kg', roll: 'roll15' };

/**
 * Reads the SuMoth Agora library.json (agora.sumoth.org/library.json).
 * Returns {entries, warnings, spec, version, updated}: entries as importCostCatalog, spec as importLayupSpec
 * but with model 'agora': each process has the resin MASS fraction by fibre family (rfrac) instead of a Vf.
 */
export function importAgoraLibrary(json) {
  if (json?.app !== 'sumoth-agora' || json.kind !== 'library' || !json.lib?.fibers) throw new Error('The file is not a SuMoth Agora library (library.json)');
  const L = json.lib;
  const entries = [];
  const warnings = [];
  // group = name: reports, checks and Brumoth read the material from group + type, as in the 2026 price list
  const add = (table, key, kind, name, price, unit, extra = {}) => {
    if (price === null || price === undefined) warnings.push(`"${name}" has no price on SuMoth Agora (!-!): not defined by the jury yet`);
    entries.push({ id: AGORA_IDS[table]?.[key] ?? `${slug(table)}/${slug(name)}`, kind, sheet: 'Agora', group: name, type: '', name, unit, price: price ?? null, note: '', ...extra });
  };
  for (const [name, f] of Object.entries(L.fibers)) {
    const layup = { layup: name, carbon: /carbon/i.test(name) };
    add('fibers', name, 'reinforcement', name, f.dry, 'kg', layup);
    add('prepregs', name, 'prepreg', `${name} prepreg`, f.preg, 'kg', layup);
  }
  for (const [name, m] of Object.entries(L.matrices)) add('matrices', name, 'matrix', name, m.p, 'kg', { layup: name });
  for (const [name, m] of Object.entries(L.adhesives || {})) add('adhesives', name, 'matrix', name, m.p, 'kg', { layup: name });
  for (const [name, c] of Object.entries(L.cores || {})) {
    if (c.custom) continue; // "Custom core…": the team adds its own core as a team item
    add('cores', name, 'core', name, c.p, 'kg', { grades: c.grades || {} });
  }
  for (const [name, p] of Object.entries(L.processes || {})) add('processes', name, 'process', name, p, 'h');
  for (const [name, c] of Object.entries(L.consumables || {})) add('consumables', name, 'consumable', name, c.p, AGORA_UNITS[c.u] ?? c.u);
  for (const [name, p] of Object.entries(L.raw || {})) add('raw', name, 'other', name, p, 'kg');
  for (const [name, p] of Object.entries(L.am || {})) add('am', name, 'other', name, p, 'kg');

  const spec = {
    model: 'agora',
    reinforcements: Object.entries(L.fibers).map(([name, f]) => ({ name, exact: name, density: f.d, family: f.rk })),
    matrices: [...Object.entries(L.matrices), ...Object.entries(L.adhesives || {})].map(([name, m]) => ({ name, exact: name, density: m.d })),
    // upper-case names = those of the 2026 Layup Calculator, already saved in the projects ("HAND LAYUP + VAC")
    processes: Object.entries(L.rfrac || {}).map(([name, rfrac]) => ({ name: name.toUpperCase(), exact: name, rfrac, preg: Boolean(L.tech?.[name]?.preg) })),
  };
  return { entries, warnings, spec, version: json.version, updated: json.updated };
}

export { splitRef };
