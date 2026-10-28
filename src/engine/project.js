// Valutazione di un progetto Dollaroni: dai dati inseriti (parti laminate + voci)
// a costi SM$, totali per componente, limiti carbonio, masse e handicap.
//
// Struttura dati (file .json del progetto): vedi README.md, sezione "Formato del progetto".

import { computePart, partMaterialMasses } from './layup.js';
import { performanceRating } from './performance.js';

/** Catalogo = voci del listino ufficiale + voci del team (hardware MSRP, prezzi dati su Discord…). */
export function makeCatalog(entries, extras = []) {
  const map = new Map();
  for (const e of entries) map.set(e.id, e);
  for (const e of extras) map.set(e.id, { kind: 'hardware', ...e, extra: true });
  return map;
}

const G_PER_KG = 1000;

const SOURCE_SUFFIX = { out_of_shelf_life: ' (out of shelf)', industrial_excess: ' (industrial excess)', upcycled: ' (upcycled)' };

/** Nome leggibile per le tabelle dei report: "Dry fabric Basalt Fibers" -> "Basalt Fibers". */
export function reportName(entry, source = 'new') {
  if (!entry) return '';
  const group = String(entry.group || entry.name || '').replace(/^Dry fabric\s+/i, '');
  const type = entry.type && !/^all$/i.test(entry.type) ? ` – ${entry.type}` : '';
  const base = entry.extra ? entry.name : group.charAt(0).toUpperCase() + group.slice(1) + type;
  return base + (SOURCE_SUFFIX[source] || '');
}

function layupKg(partResults, link) {
  let grams = 0;
  for (const pid of link.parts) {
    const pr = partResults.get(pid);
    if (!pr) continue;
    for (const r of pr.substacks) {
      if (r.errors.length) continue;
      if (link.kind === 'fibre' && (!link.material || r.input.reinforcement === link.material)) grams += r.fibre;
      if (link.kind === 'resin' && (!link.material || r.input.matrix === link.material)) grams += r.resin;
    }
    if (link.kind === 'core' && pr.core) grams += pr.core.mass * G_PER_KG;
    if (link.kind === 'resin' && pr.core) grams += pr.core.uptake * G_PER_KG;
  }
  return grams / G_PER_KG;
}

function coreOf(part) {
  const c = part.core;
  if (!c) return null;
  const mass = c.mass ?? (c.area && c.thickness && c.density ? c.area * (c.thickness / 1000) * c.density : 0);
  const uptake = c.resinUptake && c.area ? (c.resinUptake * c.area) / G_PER_KG : 0; // g/m² × m² -> kg
  return { ...c, mass, uptake, source: c.source || 'new' };
}

/**
 * Righe generate in automatico da una parte (per i progetti nuovi): fibra, resina, anima.
 * part.waste = {<id listino>: kg} è il materiale consumato in più e buttato (S2, §9.2.2 2027):
 * si somma alla quantità (e quindi al costo) delle righe con quel materiale, in proporzione alla massa.
 */
function autoLinesFor(part, pr, catalog) {
  const lines = [];
  const masses = partMaterialMasses(pr);
  const reinfRefs = new Set(masses.filter((m) => m.role === 'reinforcement').map((m) => m.ref));
  const core = pr.core;
  if (core?.uptake) {
    const firstMatrix = masses.find((m) => m.role === 'matrix');
    if (firstMatrix) firstMatrix.grams += core.uptake * G_PER_KG;
  }
  const waste = part.waste || {};
  const gramsByRef = {};
  for (const m of masses) gramsByRef[m.ref] = (gramsByRef[m.ref] || 0) + m.grams;
  const wasteShare = (ref, grams) => (waste[ref] > 0 && gramsByRef[ref] > 0 ? (waste[ref] * grams) / gramsByRef[ref] : 0);
  for (const m of masses) {
    const entry = catalog.get(m.ref);
    const role = m.role === 'reinforcement' ? 'reinforcement' : 'matrix';
    const suffix = role === 'reinforcement' && reinfRefs.size > 1 ? ` (${entry?.group || m.ref})` : '';
    const w = wasteShare(m.ref, m.grams);
    lines.push({
      id: `${part.id}:${role}:${m.ref}:${m.source}`,
      auto: true, component: part.component, status: part.status,
      name: `${part.name} - ${role}${suffix}`,
      material: { ref: m.ref, qty: m.grams / G_PER_KG + w, source: m.source, label: reportName(entry, m.source), labelBase: reportName(entry), ...(w ? { waste: w } : {}) },
    });
  }
  if (core && core.ref) {
    const coreEntry = catalog.get(core.ref);
    const w = waste[core.ref] > 0 ? waste[core.ref] : 0;
    lines.push({
      id: `${part.id}:core`, auto: true, component: part.component, status: part.status,
      name: `${part.name} - core`,
      material: { ref: core.ref, qty: core.mass + w, source: core.source, label: reportName(coreEntry, core.source), labelBase: reportName(coreEntry), ...(w ? { waste: w } : {}) },
    });
  }
  return lines;
}

function computeLine(line, ctx) {
  const { catalog, rules, partResults } = ctx;
  // status: 'estimated' (stima, tipico di S1) | 'measured' (valore reale as-built, S2)
  const out = { line, id: line.id, component: line.component, name: line.name, status: line.status || 'estimated', errors: [], warnings: [], material: null, process: null, usedPart: null };

  if (line.material) {
    const m = line.material;
    const entry = m.ref ? catalog.get(m.ref) : null;
    if (m.ref && !entry) out.errors.push(`Voce di listino "${m.ref}" inesistente`);
    const source = m.source || 'new';
    const src = rules.sources[source];
    if (!src) out.errors.push(`Provenienza "${source}" sconosciuta`);
    const basePrice = m.price ?? entry?.price ?? null;
    if (basePrice === null && (src?.factor ?? 1) !== 0) out.errors.push(`Prezzo mancante per "${m.label || entry?.name || m.name || line.name}"`);
    const derived = m.fromLayup ? layupKg(partResults, m.fromLayup) : m.check ? layupKg(partResults, m.check) : null;
    const qty = m.qty ?? (m.fromLayup ? derived : null);
    if (qty === null || qty === undefined) out.errors.push('Quantità mancante');
    const factor = src ? src.factor : 1;
    const unitPrice = basePrice === null ? 0 : basePrice * factor;
    const label = m.label || entry?.name || m.name || '';
    out.material = {
      entry, label, labelBase: m.labelBase || label, unit: m.unit || entry?.unit || '',
      qty: qty ?? 0, basePrice, factor, unitPrice, source,
      cost: (qty ?? 0) * unitPrice,
      layupKg: derived, manualPrice: m.price !== undefined, priceSource: m.priceSource || null,
      // di cui scarto (stessa unità della quantità), tracciato in S2 (§9.2.2 2027)
      waste: typeof m.waste === 'number' && m.waste > 0 ? m.waste : 0,
    };
  }

  if (line.process) {
    const p = line.process;
    const entry = catalog.get(p.ref);
    if (!entry) out.errors.push(`Lavorazione "${p.ref}" inesistente nel listino`);
    const rate = p.rate ?? entry?.price ?? 0;
    out.process = { entry, label: p.label || entry?.name || p.ref, hours: p.hours ?? 0, rate, cost: (p.hours ?? 0) * rate };
  }

  if (line.usedPart) {
    const u = line.usedPart;
    const def = rules.usedParts?.[u.element];
    if (!def) out.errors.push(`Elemento "${u.element}" non previsto dal regolamento ${rules.id}`);
    else if (def.cost === null) {
      // 2027: niente costo fisso né handicap per anno; la parte si paga al prezzo della voce (material)
      out.usedPart = { def, year: u.year ?? null, fixed: false, cost: 0, handicap: 0, doubled: false };
      if (!line.material) out.errors.push('Prezzo mancante: nel 2027 le parti usate non hanno più un costo fisso');
    } else {
      const col = rules.usedPartYearIndex(u.year);
      const doubling = def.kind === 'foil' && (u.participationYear || 1) > 1 ? 2 : 1;
      out.usedPart = { def, year: u.year, fixed: true, cost: def.cost, handicap: def.handicap[col] * doubling, doubled: doubling > 1 };
    }
  }

  out.total = (out.material?.cost || 0) + (out.process?.cost || 0) + (out.usedPart?.cost || 0);
  return out;
}

/**
 * Valuta il progetto.
 * ctx: {spec (Layup Calculator), catalogEntries (listino ufficiale), rules}
 */
export function evaluate(project, { spec, catalogEntries, rules }) {
  const catalog = makeCatalog(catalogEntries, project.catalogExtras || []);
  const budget = project.budget ?? rules.budget;

  const partResults = new Map();
  for (const part of project.parts || []) {
    const pr = computePart(spec, catalog, part);
    pr.core = coreOf(part);
    pr.status = part.status || 'estimated';
    // massa calcolata (laminato + anima + resina assorbita) e massa pesata as-built, se inserita
    pr.computedMass = pr.totals.composite / G_PER_KG + (pr.core?.mass || 0) + (pr.core?.uptake || 0);
    pr.measuredMass = typeof part.measuredMass === 'number' ? part.measuredMass : null;
    partResults.set(part.id, pr);
  }

  const ctx = { catalog, rules, partResults };
  const autoLines = (project.parts || [])
    .filter((p) => p.autoLines !== false)
    .flatMap((p) => autoLinesFor(p, partResults.get(p.id), catalog));
  const lines = [...autoLines, ...(project.lines || [])].map((l) => computeLine(l, ctx));

  const components = rules.components.map((c) => {
    const ls = lines.filter((l) => l.component === c.id);
    return { ...c, lines: ls, total: ls.reduce((a, l) => a + l.total, 0) };
  });
  const unknownComponent = lines.filter((l) => !rules.components.some((c) => c.id === l.component));
  const total = lines.reduce((a, l) => a + l.total, 0);

  // Limiti di carbonio (Tab. 2): somma per gruppo e fonte, confronto con i limiti.
  const carbon = rules.carbonGroups.map((g, i) => {
    const sums = { virgin: { cf: 0, cfrp: 0 }, recycled: { cf: 0, cfrp: 0 }, upcycled: { cf: 0, cfrp: 0 } };
    for (const pr of partResults.values()) {
      if ((pr.part.limitGroup || 'other') !== g.id) continue;
      for (const [src, v] of Object.entries(pr.carbon)) {
        sums[src].cf += v.cf / G_PER_KG;
        sums[src].cfrp += v.cfrp / G_PER_KG;
      }
    }
    const L = rules.carbonLimits;
    const checks = [
      { key: 'cf', label: 'CF secco', value: sums.virgin.cf, limit: L.cf[i] },
      { key: 'cfrp', label: 'CFRP', value: sums.virgin.cfrp, limit: L.cfrp[i] },
      { key: 'recycled_cf', label: 'CF riciclato', value: sums.recycled.cf, limit: L.recycled_cf[i] },
      { key: 'recycled_cfrp', label: 'CFRP riciclato', value: sums.recycled.cfrp, limit: L.recycled_cfrp[i] },
      { key: 'upcycled_cfrp', label: 'CFRP upcycled', value: sums.upcycled.cfrp, limit: L.upcycled_cfrp[i] },
    ].map((c) => ({ ...c, ratio: c.limit ? c.value / c.limit : 0 }));
    return { ...g, checks, hasCarbon: checks.some((c) => c.value > 0) };
  });

  // Mass breakdown (§2.5): fibra, resina, anima (+ assorbimento resina), altro.
  const mass = rules.massGroups.map((g) => ({ ...g, fibre: 0, resin: 0, core: 0, uptake: 0, other: 0 }));
  const massRow = (id) => mass.find((m) => m.id === id) || mass.find((m) => m.id === 'other');
  for (const pr of partResults.values()) {
    const row = massRow(pr.part.massGroup || 'other');
    row.fibre += pr.totals.fibres / G_PER_KG;
    row.resin += pr.totals.resin / G_PER_KG;
    if (pr.core) { row.core += pr.core.mass; row.uptake += pr.core.uptake; }
  }
  for (const l of lines) {
    if (l.line.mass && l.material && l.material.unit === 'kg') massRow(l.line.mass.group).other += l.material.qty;
  }
  for (const m of mass) m.total = m.fibre + m.resin + m.core + m.uptake + m.other;

  const handicap = lines.filter((l) => l.usedPart).reduce((a, l) => a + l.usedPart.handicap, 0);

  // Scarti registrati (S2): voci con "di cui scarto".
  const wasteRows = lines.filter((l) => l.material?.waste > 0).map((l) => ({
    id: l.id, name: l.name, component: l.component, label: l.material.label, unit: l.material.unit,
    used: l.material.qty, waste: l.material.waste, share: l.material.qty > 0 ? l.material.waste / l.material.qty : null,
    cost: l.material.waste * l.material.unitPrice,
  }));
  const kgRows = wasteRows.filter((w) => w.unit === 'kg');
  const waste = {
    rows: wasteRows,
    usedKg: kgRows.reduce((a, w) => a + w.used, 0),
    wasteKg: kgRows.reduce((a, w) => a + w.waste, 0),
    cost: wasteRows.reduce((a, w) => a + w.cost, 0),
  };

  return {
    project, rules, catalog, budget, parts: [...partResults.values()], lines, components, unknownComponent,
    total, margin: budget - total, carbon, mass, handicap, waste,
    performance: performanceRating(project, rules),
  };
}
