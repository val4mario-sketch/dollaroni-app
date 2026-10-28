// "Esporta S1": pacchetto completo (Layup Calculator per pezzo, immagini, documento, zip).

import { suite, test, eq, ok } from './lib.js';
import { loadContext } from './context.js';
import { buildS1Export, s1Tables } from '../src/io/s1-export.js';
import { layupTableSvg } from '../src/io/layup-svg.js';
import { computePart } from '../src/engine/layup.js';
import { reportName } from '../src/engine/project.js';

suite('Esporta S1', () => {
  test('pacchetto S1 2026: 8 xlsx + 8 png + 1 docx, nessun errore', async () => {
    const c = await loadContext();
    const r = await buildS1Export({ project: c.s1, ev: c.evS1, spec: c.spec, catalog: c.evS1.catalog, templateBytes: c.templateBytes });
    eq(r.errors.length, 0, r.errors.join('; '));
    eq(r.files.filter((f) => f.name.endsWith('.xlsx')).length, 8);
    eq(r.files.filter((f) => f.name.endsWith('.png')).length, 8);
    const docx = r.files.find((f) => f.name.endsWith('.docx'));
    const zip = await globalThis.JSZip.loadAsync(docx.bytes);
    const xml = await zip.file('word/document.xml').async('string');
    ok(xml.includes('8,422.44'), 'totale nella tabella SuMoth Dollar breakdown');
    ok(xml.includes('Montserrat'), 'font Montserrat');
    eq(Object.values(zip.files).filter((f) => !f.dir && f.name.startsWith('word/media/')).length, 8, 'immagini in appendice');
    const all = await globalThis.JSZip.loadAsync(r.zip.bytes);
    eq(Object.values(all.files).filter((f) => !f.dir).length, 17, 'file nello zip');
  });

  test('tabella SM$: 31 righe come la Tabella 2, riga totale 8,422.44', async () => {
    const { evS1 } = await loadContext();
    const t = s1Tables(evS1);
    eq(t.costTable.rows.length, 31);
    eq(t.costTable.totalRow[8], '8,422.44');
    const mh = t.carbon.rows.find((r) => r[0] === 'Main Horizontal');
    eq(mh[5], '-0.04', 'margine in grammi sul limite CFRP');
    eq(mh[6], 'Over limit');
  });

  test("immagine dell'appendice con i numeri del calcolatore", async () => {
    const { s1, spec, evS1 } = await loadContext();
    const hull = s1.parts.find((p) => p.id === 'hull');
    const { svg } = layupTableSvg(computePart(spec, evS1.catalog, hull), hull.name);
    for (const s of ['HULL', '5,436', '4,003', '9,439', '57.6%', '3.997', 'HAND LAYUP + VAC']) ok(svg.includes(s), `manca "${s}"`);
  });

  test('nomi leggibili per le righe generate dai pezzi', async () => {
    const { evS1 } = await loadContext();
    const e = evS1.catalog.get('dry-fabric-basalt-fibers');
    eq(reportName(e), 'Basalt Fibers');
    eq(reportName(evS1.catalog.get('std-epoxy/lamination-resin'), 'out_of_shelf_life'), 'Std. Epoxy – Lamination Resin (out of shelf)');
  });
});
