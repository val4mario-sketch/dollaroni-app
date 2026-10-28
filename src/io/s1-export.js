// "Esporta S1": raccoglie tutto quello che serve per il report S1 e lo mette nei formati ufficiali.
//  - Layup Calculator/  un file xlsx per pezzo (template ufficiale compilato)
//  - Appendice/         immagini PNG delle tabelle di layup (come l'Appendice G 2026)
//  - Report S1/         documento Word/Google Docs con le tabelle SM$, riepilogo, limiti carbonio, masse
// Tutto anche in un unico zip.

import { exportAllLayups } from './layup-export.js';
import { layupTableSvg, svgToPng } from './layup-svg.js';
import { buildDocx, tableHtml } from './docx.js';
import { s1CostTable, massTable, fmtMoney, performanceRows, fmtPoints } from '../engine/reports.js';

const MIME = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  png: 'image/png',
  zip: 'application/zip',
};

const trim = (x) => (x === null || x === undefined || x === '' ? '' : String(Number(Number(x).toFixed(4))));
const kg3 = (x) => x.toFixed(3);

/** Le tabelle del report S1 già formattate (in inglese), riusate da docx, clipboard e anteprima. */
export function s1Tables(ev) {
  const cost = s1CostTable(ev);
  const costTable = {
    caption: 'Table: SuMoth Dollar breakdown',
    columns: [
      { title: 'COMPONENT', width: 14 }, { title: 'MATERIAL', width: 13 }, { title: 'QUANTITY', width: 9, align: 'right' },
      { title: 'UNIT', width: 6 }, { title: 'MATERIAL COST (SM$/UNIT)', width: 10, align: 'right' }, { title: 'PROCESS', width: 10 },
      { title: 'PROCESS TIME (h)', width: 8, align: 'right' }, { title: 'PROCESS COST (SM$/h)', width: 8, align: 'right' },
      { title: 'TOTAL SM$', width: 9, align: 'right' }, { title: 'Notes', width: 13 },
    ],
    headerSize: 6,
    rows: cost.rows.map((r) => [
      r.component, r.material, r.quantity === null ? '' : r.quantity.toFixed(2), r.unit, trim(r.materialCost),
      r.process, trim(r.processTime), trim(r.processCost), fmtMoney(r.total), r.notes,
    ]),
    totalRow: ['', '', '', '', '', '', '', 'TOTAL SM$', fmtMoney(cost.total), ''],
  };

  const byComponent = {
    caption: 'Table: SM$ by component',
    columns: [{ title: 'Component', width: 3 }, { title: 'Cost [SM$]', width: 2, align: 'right' }, { title: '% of budget', width: 2, align: 'right' }],
    rows: ev.components.map((c) => [c.en, fmtMoney(c.total), `${((c.total / ev.budget) * 100).toFixed(1)}%`]),
    totalRow: ['Total', fmtMoney(ev.total), `${((ev.total / ev.budget) * 100).toFixed(1)}%`],
  };

  const carbonRows = ev.carbon.filter((g) => g.hasCarbon).map((g) => {
    const get = (k) => g.checks.find((c) => c.key === k);
    const cf = get('cf');
    const cfrp = get('cfrp');
    const worst = Math.max(cf.ratio, cfrp.ratio);
    const status = cf.value > cf.limit + 1e-9 || cfrp.value > cfrp.limit + 1e-9 ? 'Over limit' : worst >= 0.95 ? 'Near limit' : 'OK';
    // margine in grammi: rende leggibili differenze che in kg a 3 decimali non si vedono (es. 1000,04 g su 1000 g)
    const margin = Math.min(cf.limit - cf.value, cfrp.limit - cfrp.value) * 1000;
    return [g.en, kg3(cf.value), cf.limit.toFixed(2), kg3(cfrp.value), cfrp.limit.toFixed(2), margin.toFixed(2), status];
  });
  const carbon = {
    caption: 'Table: Carbon fibre content vs. limits of Table 2 of the Rules (kg)',
    columns: [{ title: 'Component', width: 4 }, { title: 'CF (dry)', width: 2, align: 'right' }, { title: 'CF limit', width: 2, align: 'right' },
      { title: 'CFRP', width: 2, align: 'right' }, { title: 'CFRP limit', width: 2, align: 'right' },
      { title: 'Margin to limit (g)', width: 3, align: 'right' }, { title: 'Check', width: 2 }],
    rows: carbonRows,
  };

  const mass = {
    caption: 'Table: Estimated mass breakdown (kg)',
    columns: [{ title: 'Element', width: 4 }, { title: 'Fibre', width: 2, align: 'right' }, { title: 'Resin', width: 2, align: 'right' },
      { title: 'Core', width: 2, align: 'right' }, { title: 'Core resin uptake', width: 3, align: 'right' }, { title: 'Other', width: 2, align: 'right' },
      { title: 'Total', width: 2, align: 'right' }],
    rows: massTable(ev).map((m) => [m.group, m.fibre.toFixed(2), m.resin.toFixed(2), m.core.toFixed(2), m.resinUptake.toFixed(2), m.other.toFixed(2), m.total.toFixed(2)]),
  };

  const out = { costTable, byComponent, carbon, mass };
  const perf = performanceTable(ev);
  if (perf) out.performance = perf;
  return out;
}

/** 2027 – Performance Rating (Tab. 3 del regolamento), riusata anche dall'export S2. */
export function performanceTable(ev) {
  const p = performanceRows(ev.performance);
  if (!p) return null;
  return {
    caption: 'Table: SuMoth Performance Rating (Table 3 of the Rules)',
    columns: [{ title: 'Component', width: 5 }, { title: 'Conditions met (Rule 11.1.3)', width: 4 }, { title: 'Points', width: 2, align: 'right' }],
    rows: p.rows.map((r) => [r.component, r.conditions, fmtPoints(r.points)]),
    totalRow: ['Performance Rating', '', fmtPoints(p.total)],
  };
}

/**
 * Esegue l'export. Ritorna {files: [{folder, name, bytes, mime}], zip: {name, bytes, mime}, errors: [...], tables}.
 * onProgress(testo) facoltativo per aggiornare l'interfaccia.
 */
export async function buildS1Export({ project, ev, spec, catalog, templateBytes, onProgress = () => {} }) {
  const prefix = `${project.team || 'Team'} S1 ${project.season || ''}`.trim();
  const files = [];
  const errors = [];

  onProgress('Compilo il Layup Calculator, un file per pezzo…');
  const layups = await exportAllLayups(templateBytes, spec, catalog, project.parts || [], prefix);
  const images = [];
  for (const l of layups) {
    if (l.error) {
      errors.push(l.error);
      continue;
    }
    files.push({ folder: 'Layup Calculator', name: l.fileName, bytes: l.bytes, mime: MIME.xlsx });
    onProgress(`Disegno la tabella di ${l.chunk.title}…`);
    const png = await svgToPng(layupTableSvg(l.result, l.chunk.title), 2);
    const name = l.fileName.replace(/\.xlsx$/, '.png');
    files.push({ folder: 'Appendice', name, bytes: png.bytes, mime: MIME.png });
    images.push({ title: l.chunk.title, ...png });
  }

  onProgress('Preparo il documento con le tabelle…');
  const t = s1Tables(ev);
  const blocks = [
    { type: 'heading', level: 1, text: `${project.name || 'SuMoth'} – S1 cost analysis (SM$)` },
    { type: 'paragraph', italic: true, size: 8, text: `Generated by Dollaroni from the team data on ${new Date().toISOString().slice(0, 10)}. Composite masses computed with the formulas of the SMC Composite Layup Calculator; ${ev.rules.labels.costBasis}` },
    { type: 'paragraph', italic: true, keepNext: true, text: t.costTable.caption },
    { type: 'table', ...t.costTable, size: 7 },
    { type: 'paragraph', italic: true, keepNext: true, text: t.byComponent.caption },
    { type: 'table', ...t.byComponent, size: 9 },
  ];
  if (t.carbon.rows.length) blocks.push({ type: 'paragraph', italic: true, keepNext: true, text: t.carbon.caption }, { type: 'table', ...t.carbon, size: 9 });
  if (t.mass.rows.length) blocks.push({ type: 'paragraph', italic: true, keepNext: true, text: t.mass.caption }, { type: 'table', ...t.mass, size: 9 });
  if (t.performance) blocks.push({ type: 'paragraph', italic: true, keepNext: true, text: t.performance.caption }, { type: 'table', ...t.performance, size: 9 });
  if (images.length) {
    blocks.push({ type: 'pageBreak' }, { type: 'heading', level: 1, text: 'Appendix – Breakdown of Composite Layup Calculations' });
    for (const img of images) {
      blocks.push({ type: 'heading', level: 2, text: img.title }, { type: 'image', png: img.bytes, width: img.width, height: img.height, scale: 2 });
    }
  }
  const docx = await buildDocx(blocks);
  files.push({ folder: 'Report S1', name: `${prefix} - Tabelle SM$.docx`, bytes: docx, mime: MIME.docx });

  onProgress('Creo lo zip…');
  const zip = new globalThis.JSZip();
  for (const f of files) zip.file(`${f.folder}/${f.name}`, f.bytes);
  const zipBytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const stamp = new Date().toISOString().slice(0, 10);

  return {
    files, errors, tables: t,
    html: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, tableHtml(v)])),
    zip: { name: `${prefix} - export ${stamp}.zip`, bytes: zipBytes, mime: MIME.zip },
  };
}

export { MIME };
