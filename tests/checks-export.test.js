// Controlli automatici ed export nel template ufficiale del Layup Calculator.

import { suite, test, eq, ok, close, g } from './lib.js';
import { loadContext } from './context.js';
import { runChecks } from '../src/engine/checks.js';
import { exportAllLayups, chunkPart } from '../src/io/layup-export.js';
import { openXlsx, NS, parseXml } from '../src/io/xlsx.js';

suite('Controlli automatici', () => {
  test('S1 2026: main horizontal oltre il limite CFRP, main vertical vicino al limite', async () => {
    const { evS1 } = await loadContext();
    const c = runChecks(evS1);
    ok(c.some((x) => x.level === 'error' && x.code === 'carbon' && x.target === 'main_horizontal'), 'errore carbonio main horizontal');
    ok(c.some((x) => x.level === 'warning' && x.code === 'carbon-near' && x.target === 'main_vertical'), 'avviso main vertical');
    ok(!c.some((x) => x.code === 'qty-vs-layup'), 'in S1 le quantità coincidono col layup (entro 2%)');
  });
  test('S2 2026: resina dello scafo dichiarata 1.44 kg contro 2.36 kg del calcolatore', async () => {
    const { evS2 } = await loadContext();
    const c = runChecks(evS2);
    const w = c.find((x) => x.code === 'qty-vs-layup' && x.target === 'hull-matrix');
    ok(w, 'manca avviso resina scafo');
    const line = evS2.lines.find((l) => l.id === 'hull-matrix');
    close(line.material.layupKg, 2.355, 0.001);
    ok(c.some((x) => x.code === 'budget-margin'), 'avviso margine ridotto');
    ok(!c.some((x) => x.level === 'error'), 'nessun errore bloccante: ' + JSON.stringify(c.filter((x) => x.level === 'error')));
  });
});

suite('Export Layup Calculator (un file per pezzo)', () => {
  test('8 file per gli 8 pezzi S1, nessun errore', async () => {
    const { templateBytes, spec, s1, catalogFor } = await loadContext();
    const files = await exportAllLayups(templateBytes, spec, catalogFor(s1), s1.parts, 'SFT S1 2026');
    eq(files.length, 8);
    eq(files.filter((f) => f.error).length, 0, 'errori: ' + files.filter((f) => f.error).map((f) => f.error).join('; '));
    // salva i file in out/ per il controllo con LibreOffice (solo col dev server)
    for (const f of files) {
      await fetch('/out/layup-s1/' + encodeURIComponent(f.fileName), { method: 'PUT', body: f.bytes });
    }
  });

  test('il file dello scafo contiene gli input giusti, righe inutili nascoste e valori in cache', async () => {
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
    eq(cells.get('K12').formula, 'E12*F12*G12', 'formula ufficiale intatta');
    eq(v('F15'), 0, 'substack B azzerato');
    const doc = parseXml(await x.zip.file(x.sheets[0].path).async('string'));
    const hidden = [...doc.getElementsByTagNameNS(NS, 'row')].filter((r) => r.getAttribute('hidden') === '1').map((r) => Number(r.getAttribute('r')));
    // 1-4 le nasconde già il template ufficiale; 15-26 sono i substack B-E non usati
    eq(JSON.stringify(hidden), JSON.stringify([1, 2, 3, 4, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26]));
    const wb = parseXml(await x.zip.file('xl/workbook.xml').async('string'));
    eq(wb.getElementsByTagNameNS(NS, 'calcPr')[0].getAttribute('fullCalcOnLoad'), '1');
    eq(x.sheets.find((s) => s.name === 'Supporting Data').state, 'hidden', 'foglio nascosto ufficiale conservato');
  });

  test('pezzo con 7 substack diviso in 2 file (5 + 2)', async () => {
    const { s1 } = await loadContext();
    const mv = s1.parts.find((p) => p.id === 'main-vertical');
    const big = { ...mv, substacks: [...mv.substacks, mv.substacks[0], mv.substacks[1]] };
    const chunks = chunkPart(big);
    eq(chunks.length, 2);
    eq(chunks[0].substacks.length, 5); eq(chunks[1].substacks.length, 2);
    eq(chunks[1].title, 'Main vertical (2/2)');
  });

  test('materiale fuori calcolatore (kevlar): export rifiutato con messaggio chiaro', async () => {
    const { templateBytes, spec, s1, catalogFor } = await loadContext();
    const part = { id: 'x', name: 'Wing panel kevlar', substacks: [{ reinforcement: 'dry-fabric-aramid-fibers/kevlar', matrix: 'std-epoxy/lamination-resin', plyArea: 1, plies: 1, arealWeight: 200, process: 'HAND LAYUP + VAC' }] };
    const [f] = await exportAllLayups(templateBytes, spec, catalogFor(s1), [part], 'T');
    ok(f.error && f.error.includes('non esiste nel Layup Calculator'), 'errore atteso, ottenuto: ' + f.error);
  });
});
