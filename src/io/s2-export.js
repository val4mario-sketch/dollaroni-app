// "Esporta S2": sezione 2 "Final cost analysis" del template S2.
//  2.2 Components Build   – una tabella Item / Quantity / Cost per componente, note sugli sconti, riepilogo
//  2.3 Cost Summary       – total cost breakdown e confronto con la stima S1 (Δ e variazione)
//  2.4 Self-Assessment    – dati di supporto: quanto è misurato/stimato, differenze maggiori, pesato vs calcolato
//  + mass breakdown as-built (§2.5 del regolamento), Layup Calculator dei pezzi as-built e immagini.

import { exportAllLayups } from './layup-export.js';
import { layupTableSvg, svgToPng } from './layup-svg.js';
import { buildDocx, tableHtml } from './docx.js';
import { s2ComponentTables, s2Summary, compareStages, massTable, wasteRows, fmtMoney, fmtSigned, fmtVariation } from '../engine/reports.js';
import { compareItems, costingBasis, weighedParts } from '../engine/compare.js';
import { MIME, performanceTable } from './s1-export.js';

const pct1 = (x) => `${(x * 100).toFixed(1)}%`;
const ITEM_COLS = [{ title: 'Item', width: 6 }, { title: 'Quantity', width: 2, align: 'right' }, { title: 'Cost [SM$]', width: 2, align: 'right' }];

/** Tabelle S2 già formattate (inglese). evS1 è la stima S1 congelata (può mancare). */
export function s2Tables(ev, evS1, rules) {
  // numerazione del template S2 2026 (Table 2.1…); nel 2027 i template non sono ancora noti
  const tab = (i) => (rules.reportNumbering ? `Table 2.${i}` : 'Table');
  const components = s2ComponentTables(ev, rules).map((t, i) => ({
    key: `comp-${t.component}`, component: t.component, title: t.title,
    caption: `${tab(i + 1)} – ${t.title} cost breakdown`,
    columns: ITEM_COLS,
    rows: t.rows.length ? t.rows.map((r) => [r.item, r.quantity, fmtMoney(r.cost)]) : [['No items built or procured in the current year', '', fmtMoney(0)]],
    totalRow: ['Total', '', fmtMoney(t.total)],
    footnotes: t.footnotes,
  }));
  const n = components.length;

  const sum = s2Summary(ev);
  const summary = {
    key: 'summary', caption: `${tab(n + 1)} – Components Build summary`,
    columns: [{ title: 'Component', width: 4 }, { title: 'Total [SM$]', width: 2, align: 'right' }, { title: '% of Budget', width: 2, align: 'right' }],
    rows: sum.rows.map((r) => [r.component, fmtMoney(r.total), pct1(r.share)]),
    totalRow: ['Total', fmtMoney(sum.total), pct1(sum.share)],
    note: `Budget cap: ${fmtMoney(sum.budget)} SM$. Remaining margin: ${fmtMoney(sum.margin)} SM$.`,
  };

  const total = {
    key: 'total', caption: `${tab(n + 2)} – Total cost breakdown`,
    columns: [{ title: 'Component', width: 4 }, { title: 'Cost [SM$]', width: 2, align: 'right' }],
    rows: ev.components.map((c) => [c.en, fmtMoney(c.total)]),
    totalRow: ['Total', fmtMoney(ev.total)],
  };

  let comparison = null;
  let changes = null;
  if (evS1) {
    const cmp = compareStages(evS1, ev);
    comparison = {
      key: 'comparison', caption: `${tab(n + 3)} – Comparison with S1 Report estimations`,
      columns: [{ title: 'Component', width: 4 }, { title: 'S1 [SM$]', width: 2, align: 'right' }, { title: 'S2 [SM$]', width: 2, align: 'right' },
        { title: 'Δ [SM$]', width: 2, align: 'right' }, { title: 'Variation', width: 2, align: 'right' }],
      rows: cmp.rows.map((r) => [r.component, r.s1 === null ? '—' : fmtMoney(r.s1), fmtMoney(r.s2), r.isNew ? 'new' : fmtSigned(r.delta), r.isNew ? '—' : fmtVariation(r.variation)]),
      totalRow: ['Total', fmtMoney(cmp.total.s1), fmtMoney(cmp.total.s2), fmtSigned(cmp.total.delta), fmtVariation(cmp.total.variation)],
    };
    const items = compareItems(evS1, ev).filter((x) => x.kind !== 'same' && Math.abs(x.delta) >= 0.005).slice(0, 15);
    const compName = Object.fromEntries(ev.components.map((c) => [c.id, c.en]));
    const KIND = { new: 'new', removed: 'removed', changed: 'changed' };
    changes = {
      key: 'changes', caption: 'Table – Largest cost differences with respect to the S1 estimations',
      columns: [{ title: 'Item', width: 5 }, { title: 'Component', width: 3 }, { title: 'Change', width: 2 },
        { title: 'S1 [SM$]', width: 2, align: 'right' }, { title: 'S2 [SM$]', width: 2, align: 'right' }, { title: 'Δ [SM$]', width: 2, align: 'right' }],
      rows: items.map((x) => [x.name, compName[x.component] || x.component, KIND[x.kind], x.s1 === null ? '—' : fmtMoney(x.s1), x.s2 === null ? '—' : fmtMoney(x.s2), fmtSigned(x.delta)]),
    };
  }

  const b = costingBasis(ev);
  const basis = {
    key: 'basis', caption: 'Table – Costing basis: as-built (measured) vs. estimated values',
    columns: [{ title: 'Component', width: 4 }, { title: 'Measured [SM$]', width: 2, align: 'right' }, { title: 'Estimated [SM$]', width: 2, align: 'right' }, { title: '% measured', width: 2, align: 'right' }],
    rows: b.rows.map((r) => [r.en, fmtMoney(r.measured), fmtMoney(r.estimated), r.total > 0 ? pct1(r.measured / r.total) : '—']),
    totalRow: ['Total', fmtMoney(b.measured), fmtMoney(b.estimated), pct1(b.share)],
  };

  const w = weighedParts(ev);
  const weighed = w.length ? {
    key: 'weighed', caption: 'Table – Calculated (Layup Calculator) vs. weighed mass of the parts',
    columns: [{ title: 'Part', width: 4 }, { title: 'Calculated [kg]', width: 2, align: 'right' }, { title: 'Weighed [kg]', width: 2, align: 'right' }, { title: 'Deviation', width: 2, align: 'right' }],
    rows: w.map((x) => [x.name, x.computed.toFixed(2), x.weighed.toFixed(2), fmtVariation(x.ratio)]),
  } : null;

  const mass = {
    key: 'mass', caption: 'Table – As-built mass breakdown (kg)',
    columns: [{ title: 'Element', width: 4 }, { title: 'Fibre', width: 2, align: 'right' }, { title: 'Resin', width: 2, align: 'right' },
      { title: 'Core', width: 2, align: 'right' }, { title: 'Core resin uptake', width: 3, align: 'right' }, { title: 'Other', width: 2, align: 'right' }, { title: 'Total', width: 2, align: 'right' }],
    rows: massTable(ev).map((m) => [m.group, m.fibre.toFixed(2), m.resin.toFixed(2), m.core.toFixed(2), m.resinUptake.toFixed(2), m.other.toFixed(2), m.total.toFixed(2)]),
  };

  // 2027 §9.2.2: materiale usato e scarti
  const w2 = rules.wasteTracking ? wasteRows(ev) : [];
  const waste = w2.length ? {
    key: 'waste', caption: 'Table – Material use and waste (Rule 9.2.2)',
    columns: [{ title: 'Item', width: 6 }, { title: 'Used', width: 2, align: 'right' }, { title: 'Of which waste', width: 2, align: 'right' },
      { title: 'Waste %', width: 2, align: 'right' }, { title: 'Waste cost [SM$]', width: 2, align: 'right' }],
    rows: w2.map((x) => [x.item, x.used, x.waste, x.share === null ? '—' : pct1(x.share), fmtMoney(x.cost)]),
    totalRow: ['Total', ev.waste.usedKg ? `${ev.waste.usedKg.toFixed(2)} kg` : '', ev.waste.wasteKg ? `${ev.waste.wasteKg.toFixed(2)} kg` : '',
      ev.waste.usedKg ? pct1(ev.waste.wasteKg / ev.waste.usedKg) : '', fmtMoney(ev.waste.cost)],
    note: 'Totals in kg include only the items measured in kg.',
  } : null;

  const performance = performanceTable(ev);
  if (performance) Object.assign(performance, { key: 'performance', caption: 'Table – SuMoth Performance Rating (Table 3 of the Rules)' });

  return { components, summary, total, comparison, changes, basis, weighed, mass, waste, performance };
}

export async function buildS2Export({ project, ev, evS1, rules, spec, catalog, templateBytes, onProgress = () => {} }) {
  const prefix = `${project.team || 'Team'} S2 ${project.season || ''}`.trim();
  const files = [];
  const errors = [];

  onProgress('Compilo il Layup Calculator dei pezzi as-built…');
  const layups = await exportAllLayups(templateBytes, spec, catalog, project.parts || [], prefix);
  const images = [];
  for (const l of layups) {
    if (l.error) { errors.push(l.error); continue; }
    files.push({ folder: 'Layup Calculator', name: l.fileName, bytes: l.bytes, mime: MIME.xlsx });
    onProgress(`Disegno la tabella di ${l.chunk.title}…`);
    const png = await svgToPng(layupTableSvg(l.result, l.chunk.title), 2);
    files.push({ folder: 'Appendice', name: l.fileName.replace(/\.xlsx$/, '.png'), bytes: png.bytes, mime: MIME.png });
    images.push({ title: l.chunk.title, ...png });
  }

  onProgress('Preparo il documento della sezione 2…');
  const t = s2Tables(ev, evS1, rules);
  const table = (x, size = 9) => [{ type: 'paragraph', italic: true, keepNext: true, text: x.caption }, { type: 'table', ...x, size }];
  const sec = (n, title) => (rules.reportNumbering ? `${n} ${title}` : title);
  const blocks = [
    { type: 'heading', level: 1, text: rules.labels.s2DocTitle },
    { type: 'paragraph', italic: true, size: 8, text: `Generated by Dollaroni on ${new Date().toISOString().slice(0, 10)}. Composite masses computed with the formulas of the SMC Composite Layup Calculator applied to the as-built layups; ${rules.labels.costBasis} ${rules.reportNumbering ? 'Texts of sections 2.1, 2.3 and 2.4 are written by the team.' : 'The 2027 cost is reported on the SuMoth Agora Platform (Rule 9.2); these tables support it.'}` },
    { type: 'heading', level: 2, text: sec('2.2.', 'Components Build') },
  ];
  for (const c of t.components) {
    blocks.push({ type: 'heading', level: 2, text: c.title }, ...table(c));
    for (const f of c.footnotes) blocks.push({ type: 'paragraph', size: 8, text: f });
  }
  blocks.push(...table(t.summary), { type: 'paragraph', size: 9, text: t.summary.note });
  blocks.push({ type: 'heading', level: 2, text: sec('2.3.', 'Cost Summary') }, ...table(t.total));
  if (t.comparison) blocks.push(...table(t.comparison));
  blocks.push({ type: 'heading', level: 2, text: sec('2.4.', 'Self-Assessment of Costing Accuracy – supporting data') }, ...table(t.basis));
  if (t.changes && t.changes.rows.length) blocks.push(...table(t.changes, 8));
  if (t.weighed) blocks.push(...table(t.weighed));
  if (t.waste) blocks.push({ type: 'heading', level: 2, text: 'Material use and waste' }, ...table(t.waste), { type: 'paragraph', size: 8, text: t.waste.note });
  if (t.mass.rows.length) blocks.push({ type: 'heading', level: 2, text: rules.refs.mass ? `As-built mass breakdown (Section ${rules.refs.mass.replace('§', '')} of the Rules)` : 'As-built mass breakdown' }, ...table(t.mass));
  if (t.performance) blocks.push({ type: 'heading', level: 2, text: 'SuMoth Performance Rating' }, ...table(t.performance));
  if (images.length) {
    blocks.push({ type: 'pageBreak' }, { type: 'heading', level: 1, text: 'Appendix – As-built Composite Layup Calculations' });
    for (const img of images) blocks.push({ type: 'heading', level: 2, text: img.title }, { type: 'image', png: img.bytes, width: img.width, height: img.height, scale: 2 });
  }
  const docx = await buildDocx(blocks);
  files.push({ folder: 'Report S2', name: `${prefix} - Sezione 2 tabelle.docx`, bytes: docx, mime: MIME.docx });

  onProgress('Creo lo zip…');
  const zip = new globalThis.JSZip();
  for (const f of files) zip.file(`${f.folder}/${f.name}`, f.bytes);
  const zipBytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const stamp = new Date().toISOString().slice(0, 10);
  return { files, errors, tables: t, zip: { name: `${prefix} - export ${stamp}.zip`, bytes: zipBytes, mime: MIME.zip } };
}

export { tableHtml };
