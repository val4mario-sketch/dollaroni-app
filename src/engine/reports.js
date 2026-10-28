// Tabelle nel formato dei report ufficiali (in inglese), costruite dal progetto valutato.
// Qui ci sono solo i dati; la resa grafica (docx, Google Doc, immagini) sta in src/io.

const UNIT_LABEL = { kg: 'kg', m2: 'sqm', m: 'm', L: 'l', roll15: '15m roll', pc: 'pc', h: 'h' };
export const unitLabel = (u) => UNIT_LABEL[u] || u || '';

const SUPERSCRIPT = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
const sup = (n) => '⁽' + String(n).split('').map((d) => SUPERSCRIPT[d]).join('') + '⁾';

export const fmtMoney = (x) => x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MINUS = '−';
/** +1,533.44 / −2,267.77 come nel docx S2. */
export const fmtSigned = (x) => (Math.abs(x) < 0.005 ? '' : x < 0 ? MINUS : '+') + fmtMoney(Math.abs(x));
/** Variazione percentuale: +18.2%, −38.0%, +1,765% (oltre il 1000% senza decimali). */
export function fmtVariation(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const a = Math.abs(v) * 100;
  const s = a >= 1000 ? Math.round(a).toLocaleString('en-US') : a.toFixed(1);
  if (s === '0.0') return '0.0%';
  return `${v < 0 ? MINUS : '+'}${s}%`;
}

/** "Hull - reinforcement" -> "hull reinforcement", per le etichette "Materiale (uso)" delle tabelle S2. */
const purpose = (name) => String(name || '').replace(/\s+-\s+/g, ' ').toLowerCase();

export function fmtQty(q, unit) {
  if (unit === 'roll15') return `${trim(q)} × 15 m roll`;
  const s = unit === 'kg' ? q.toFixed(2) : trim(q);
  return `${s} ${unitLabel(unit)}`.trim();
}
function trim(q) {
  return Number.isInteger(q) ? String(q) : String(Number(q.toFixed(3)));
}

/** S1 §2 – "SuMoth Dollar breakdown" (stesse colonne della tabella consegnata nel 2026). */
export function s1CostTable(ev) {
  const rows = ev.lines.map((l) => ({
    component: l.name,
    material: l.material?.label ?? (l.usedPart ? l.usedPart.def.en : ''),
    quantity: l.material ? l.material.qty : l.usedPart ? 1 : null,
    unit: l.material ? unitLabel(l.material.unit) : l.usedPart ? 'pc' : '',
    materialCost: l.material ? l.material.unitPrice : l.usedPart ? l.usedPart.cost : null,
    process: l.process?.label ?? '',
    processTime: l.process?.hours ?? null,
    processCost: l.process?.rate ?? null,
    total: l.total,
    notes: l.line.notes || '',
    componentGroup: l.component,
  }));
  return {
    columns: ['COMPONENT', 'MATERIAL', 'QUANTITY', 'UNIT', 'MATERIAL COST (SM$/UNIT)', 'PROCESS', 'PROCESS TIME (h)', 'PROCESS COST (SM$/h)', 'TOTAL SM$', 'Notes'],
    rows,
    total: ev.total,
  };
}

/** S2 §2.2 – una tabella Item / Quantity / Cost per componente, con note sugli sconti. */
export function s2ComponentTables(ev, rules) {
  return ev.components.map((c) => {
    const footnotes = [];
    const mark = (text) => {
      if (!text) return '';
      let i = footnotes.indexOf(text);
      if (i < 0) { footnotes.push(text); i = footnotes.length - 1; }
      return ' ' + sup(i + 1);
    };
    const rows = [];
    const handicaps = [];
    for (const l of c.lines) {
      const line = l.line;
      // parte usata a costo fisso (Tab. 3 2026); nel 2027 il costo sta nella riga del materiale
      if (l.usedPart?.fixed) {
        const y = l.usedPart.year < 2015 ? 'pre-2015' : String(l.usedPart.year);
        // una sola nota per tutte le parti usate dello stesso anno
        const note = `Used part (Section 3.4.A of the Rules), production year ${y}: fixed SM$ cost from Table 3, not subject to further reductions`;
        rows.push({ item: (line.s2Label || `${l.usedPart.def.en} (${y}, used)`) + mark(line.footnote || note), quantity: '1 pc', cost: l.usedPart.cost, lineId: l.id });
        if (l.usedPart.handicap) handicaps.push(`${l.usedPart.def.en} ${String(l.usedPart.handicap).replace('-', MINUS)}`);
      }
      if (l.material) {
        const src = rules.sources[l.material.source];
        const tag = src?.en && !line.s2Label?.includes(src.en) ? ` – ${src.en}` : '';
        const base = l.material.basePrice;
        const auto = src?.footnote && base ? `${src.footnote} (${fmtMoney(base)} → ${fmtMoney(l.material.unitPrice)} SM$/${unitLabel(l.material.unit)})` : src?.footnote;
        const label = (line.s2Label || `${l.material.labelBase || l.material.label} (${purpose(line.name)})`) + tag;
        rows.push({ item: label + mark(line.footnote || (l.material.factor !== 1 ? auto : null)), quantity: fmtQty(l.material.qty, l.material.unit), cost: l.material.cost, lineId: l.id });
      }
      if (l.process) {
        rows.push({ item: line.process.s2Label || `${l.process.label} (${purpose(line.name)})`, quantity: `${trim(l.process.hours)} h`, cost: l.process.cost, lineId: l.id });
      }
    }
    const notes = handicaps.length
      ? [`Handicap points of the used parts (Table 3 of the Rules): ${handicaps.join(', ')}; applied individually at stages S2 and S3. They do not affect the SM$ budget.`]
      : [];
    return { component: c.id, title: c.en, rows, total: c.total, footnotes: [...footnotes.map((t, i) => `${sup(i + 1)} ${t}.`), ...notes] };
  });
}

/** S2 §2.2 riepilogo e §2.3 total cost breakdown. */
export function s2Summary(ev) {
  return {
    rows: ev.components.map((c) => ({ component: c.en, total: c.total, share: c.total / ev.budget })),
    total: ev.total, share: ev.total / ev.budget, budget: ev.budget, margin: ev.margin,
  };
}

/** S2 §2.3 – confronto con le stime S1. */
export function compareStages(evS1, evS2) {
  const rows = evS2.components.map((c) => {
    const s1c = evS1.components.find((x) => x.id === c.id);
    // "nuova" solo se in S2 c'è qualcosa che in S1 non c'era; se è vuota in entrambi vale 0
    const s1 = s1c && s1c.lines.length ? s1c.total : c.lines.length ? null : 0;
    const delta = s1 === null ? null : c.total - s1;
    return { component: c.en, s1, s2: c.total, delta, variation: s1 ? delta / s1 : null, isNew: s1 === null };
  });
  const delta = evS2.total - evS1.total;
  return { rows, total: { s1: evS1.total, s2: evS2.total, delta, variation: delta / evS1.total } };
}

/** 2027 – Performance Rating (Tab. 3, §11): condizioni vere per componente e parti commerciali (§11.1.5). */
export function performanceRows(perf) {
  if (!perf) return null;
  const letters = (ids) => (ids.length ? ids.map((x) => `${x})`).join(', ') : '—');
  const rows = perf.components.map((c) => ({ component: c.en, conditions: letters(c.met), points: c.points }));
  const commercial = perf.commercial.filter((c) => c.points).map((c) => ({
    component: `${c.name} (commercial, ${c.year === null ? 'production year not documented' : `made in ${c.year}`})`,
    conditions: 'Rule 11.1.5', points: c.points,
  }));
  return { rows: [...rows, ...commercial], total: perf.total };
}

/** Punti con segno: +50, −150, 0. */
export const fmtPoints = (x) => (x > 0 ? `+${x}` : x < 0 ? `${MINUS}${Math.abs(x)}` : '0');

/** 2027 §9.2.2 – materiale usato e scarti registrati. */
export function wasteRows(ev) {
  return ev.waste.rows.map((w) => ({
    item: `${w.label} (${purpose(w.name)})`, used: fmtQty(w.used, w.unit), waste: fmtQty(w.waste, w.unit),
    share: w.share, cost: w.cost,
  }));
}

/** §2.5 – as-built (o stimato) mass breakdown. */
export function massTable(ev) {
  return ev.mass.filter((m) => m.total > 0).map((m) => ({
    group: m.en, fibre: m.fibre, resin: m.resin, core: m.core, resinUptake: m.uptake, other: m.other, total: m.total,
  }));
}
