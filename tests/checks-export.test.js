// Automatic checks and export to the official Layup Calculator template.

import { suite, test, eq, ok, close, g } from './lib.js';
import { loadContext } from './context.js';
import { runChecks } from '../src/engine/checks.js';
import { exportAllLayups, chunkPart } from '../src/io/layup-export.js';
import { openXlsx, NS, parseXml } from '../src/io/xlsx.js';

suite('Automatic checks', () => {
  test('S1 2026: main horizontal over the CFRP limit, main vertical close to the limit', async () => {
    const { evS1 } = await loadContext();
    const c = runChecks(evS1);
    ok(c.some((x) => x.level === 'error' && x.code === 'carbon' && x.target === 'main_horizontal'), 'main horizontal carbon error');
    ok(c.some((x) => x.level === 'warning' && x.code === 'carbon-near' && x.target === 'main_vertical'), 'main vertical warning');
    ok(!c.some((x) => x.code === 'qty-vs-layup'), 'in S1 the quantities match the layup (within 2%)');
  });
  test('S2 2026: hull resin declared 1.44 kg against 2.36 kg of the calculator', async () => {
    const { evS2 } = await loadContext();
    const c = runChecks(evS2);
    const w = c.find((x) => x.code === 'qty-vs-layup' && x.target === 'hull-matrix');
    ok(w, 'hull resin warning missing');
    const line = evS2.lines.find((l) => l.id === 'hull-matrix');
    close(line.material.layupKg, 2.355, 0.001);
    ok(c.some((x) => x.code === 'budget-margin'), 'small margin warning');
    ok(!c.some((x) => x.level === 'error'), 'no blocking error: ' + JSON.stringify(c.filter((x) => x.level === 'error')));
  });
});

suite('Layup Calculator export (one file per part)', () => {
  test('8 files for the 8 S1 parts, no errors', async () => {
    const { templateBytes, spec, s1, catalogFor } = await loadContext();
    const files = await exportAllLayups(templateBytes, spec, catalogFor(s1), s1.parts, 'SFT S1 2026');
    eq(files.length, 8);
    eq(files.filter((f) => f.error).length, 0, 'errori: ' + files.filter((f) => f.error).map((f) => f.error).join('; '));
    // saves the files in out/ for the LibreOffice check (dev server only)
    for (const f of files) {
      await fetch('/out/layup-s1/' + encodeURIComponent(f.fileName), { method: 'PUT', body: f.bytes });
    }
  });

  test('the hull file contains the right inputs, unused rows hidden and cached values', async () => {
    const { templateBytes, spec, s1, catalogFor } = await loadContext();
    const hull = s1.parts.find((p) => p.id === 'hull');
    const [file] = await exportAllLayups(templateBytes, spec, catalogFor(s1), [hull], 'T');
    const x = await openXlsx(file.bytes);
    const cells = await x.cells('Composite stacking calculation');
    const v = (r) => cells.get(r)?.value;
    eq(v('D7'), 'HULL');
    eq(v('B12'), 'BASALT'); eq(v('B13'), 'EPOXY'); eq(v('H12'), 'HAND LAYUP + VAC');
    eq(v('E12'), 3.997); eq(v('F12'), 4); eq(v('G12'), 340);
    eq(g(v('K12')), 5436); eq(g(v('K13')), 4003); eq(g(v('K27')), 9439);
    eq(cells.get('K12').formula, 'E12*F12*G12', 'official formula intact');
    eq(v('F15'), 0, 'substack B zeroed');
    const doc = parseXml(await x.zip.file(x.sheets[0].path).async('string'));
    const hidden = [...doc.getElementsByTagNameNS(NS, 'row')].filter((r) => r.getAttribute('hidden') === '1').map((r) => Number(r.getAttribute('r')));
    // 1-4 are already hidden by the official template; 15-26 are the unused substacks B-E
    eq(JSON.stringify(hidden), JSON.stringify([1, 2, 3, 4, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26]));
    const wb = parseXml(await x.zip.file('xl/workbook.xml').async('string'));
    eq(wb.getElementsByTagNameNS(NS, 'calcPr')[0].getAttribute('fullCalcOnLoad'), '1');
    eq(x.sheets.find((s) => s.name === 'Supporting Data').state, 'hidden', 'official hidden sheet preserved');
  });

  test('part with 7 substacks split into 2 files (5 + 2)', async () => {
    const { s1 } = await loadContext();
    const mv = s1.parts.find((p) => p.id === 'main-vertical');
    const big = { ...mv, substacks: [...mv.substacks, mv.substacks[0], mv.substacks[1]] };
    const chunks = chunkPart(big);
    eq(chunks.length, 2);
    eq(chunks[0].substacks.length, 5); eq(chunks[1].substacks.length, 2);
    eq(chunks[1].title, 'Main vertical (2/2)');
  });

  test('material outside the calculator (kevlar): export refused with a clear message', async () => {
    const { templateBytes, spec, s1, catalogFor } = await loadContext();
    const part = { id: 'x', name: 'Wing panel kevlar', substacks: [{ reinforcement: 'dry-fabric-aramid-fibers/kevlar', matrix: 'std-epoxy/lamination-resin', plyArea: 1, plies: 1, arealWeight: 200, process: 'HAND LAYUP + VAC' }] };
    const [f] = await exportAllLayups(templateBytes, spec, catalogFor(s1), [part], 'T');
    ok(f.error && f.error.includes('does not exist in the official Layup Calculator'), 'expected error, got: ' + f.error);
  });
});
