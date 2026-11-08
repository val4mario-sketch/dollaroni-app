// "Export S1": complete package (Layup Calculator per part, images, document, zip).

import { suite, test, eq, ok } from './lib.js';
import { loadContext } from './context.js';
import { buildS1Export, s1Tables } from '../src/io/s1-export.js';
import { layupTableSvg } from '../src/io/layup-svg.js';
import { computePart } from '../src/engine/layup.js';
import { reportName } from '../src/engine/project.js';

suite('Export S1', () => {
  test('S1 2026 package: 8 xlsx + 8 png + 1 docx, no errors', async () => {
    const c = await loadContext();
    const r = await buildS1Export({ project: c.s1, ev: c.evS1, spec: c.spec, catalog: c.evS1.catalog, templateBytes: c.templateBytes });
    eq(r.errors.length, 0, r.errors.join('; '));
    eq(r.files.filter((f) => f.name.endsWith('.xlsx')).length, 8);
    eq(r.files.filter((f) => f.name.endsWith('.png')).length, 8);
    const docx = r.files.find((f) => f.name.endsWith('.docx'));
    const zip = await globalThis.JSZip.loadAsync(docx.bytes);
    const xml = await zip.file('word/document.xml').async('string');
    ok(xml.includes('8,422.44'), 'total in the SuMoth Dollar breakdown table');
    ok(xml.includes('Montserrat'), 'font Montserrat');
    eq(Object.values(zip.files).filter((f) => !f.dir && f.name.startsWith('word/media/')).length, 8, 'images in the appendix');
    const all = await globalThis.JSZip.loadAsync(r.zip.bytes);
    eq(Object.values(all.files).filter((f) => !f.dir).length, 17, 'files in the zip');
  });

  test('SM$ table: 31 rows like Table 2, total row 8,422.44', async () => {
    const { evS1 } = await loadContext();
    const t = s1Tables(evS1);
    eq(t.costTable.rows.length, 31);
    eq(t.costTable.totalRow[8], '8,422.44');
    const mh = t.carbon.rows.find((r) => r[0] === 'Main Horizontal');
    eq(mh[5], '-0.04', 'margin in grams on the CFRP limit');
    eq(mh[6], 'Over limit');
  });

  test("appendix image with the calculator numbers", async () => {
    const { s1, spec, evS1 } = await loadContext();
    const hull = s1.parts.find((p) => p.id === 'hull');
    const { svg } = layupTableSvg(computePart(spec, evS1.catalog, hull), hull.name);
    for (const s of ['HULL', '5,436', '4,003', '9,439', '57.6%', '3.997', 'HAND LAYUP + VAC']) ok(svg.includes(s), `manca "${s}"`);
  });

  test('readable names for the rows generated from the parts', async () => {
    const { evS1 } = await loadContext();
    const e = evS1.catalog.get('dry-fabric-basalt-fibers');
    eq(reportName(e), 'Basalt Fibers');
    eq(reportName(evS1.catalog.get('std-epoxy/lamination-resin'), 'out_of_shelf_life'), 'Std. Epoxy – Lamination Resin (out of shelf)');
  });
});
