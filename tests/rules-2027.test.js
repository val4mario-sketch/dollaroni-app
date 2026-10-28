// Regolamento 2027 (2027 SMC Competition Rulebook v1.0, 7 settembre 2026).

import { suite, test, eq, ok, close, cents } from './lib.js';
import { loadContext } from './context.js';
import { evaluate } from '../src/engine/project.js';
import { runChecks } from '../src/engine/checks.js';
import { rulesFor, RULES_2026, RULES_2027 } from '../src/engine/rules.js';
import { s2ComponentTables } from '../src/engine/reports.js';
import { projectFrom2026, toRules2027, freezeToS2, newLine } from '../src/app/templates.js';
import { s1Tables } from '../src/io/s1-export.js';
import { s2Tables, buildS2Export } from '../src/io/s2-export.js';

const ctx27 = (c) => ({ spec: c.spec, catalogEntries: c.catalogEntries, rules: RULES_2027 });
const ctx26 = (c) => ({ spec: c.spec, catalogEntries: c.catalogEntries, rules: RULES_2026 });
const codes = (ev) => runChecks(ev).map((x) => x.code);

/** Voce a prezzo libero (hardware) che porta il totale al valore voluto. */
function withTotal(p, ev, target) {
  const q = structuredClone(p);
  q.lines.push({ id: 'fill', component: 'electronics', name: 'Fill', material: { name: 'Fill', unit: 'pc', qty: 1, price: target - ev.total, priceSource: 'test' } });
  return q;
}

suite('Regole 2027', () => {
  test('Tab. 2 uguale al 2026 ("Hiking racks"), regole scelte dal progetto', async () => {
    eq(JSON.stringify(RULES_2027.carbonLimits), JSON.stringify(RULES_2026.carbonLimits), 'limiti di carbonio');
    eq(RULES_2027.carbonGroups.find((g) => g.id === 'wingbars').en, 'Hiking racks');
    eq(RULES_2027.components.find((g) => g.id === 'wingbars').en, 'Hiking racks');
    eq(rulesFor({}), RULES_2026, 'file senza campo rules = 2026');
    eq(rulesFor({ rules: '2027' }), RULES_2027);
    eq(rulesFor({ rules: '2030' }), null);
    eq(RULES_2027.performance.components.length, 15);
  });

  test('nuova barca da Meravijosa: regole 2027, stesso totale, sconti da confermare', async () => {
    const c = await loadContext();
    const p = projectFrom2026(c.s1);
    eq(p.rules, '2027');
    const ev = evaluate(p, ctx27(c));
    eq(cents(ev.total), 8422.36);
    const k = codes(ev);
    ok(k.includes('discount-unconfirmed'), 'avviso sconti 2026 da confermare');
    ok(!k.includes('uptake'), 'il mass breakdown del §2.5 non è più richiesto');
    ok(runChecks(ev).some((x) => x.code === 'carbon' && x.target === 'main_horizontal'), 'Tab. 2 invariata: main horizontal ancora oltre');
    ok(!codes(evaluate(c.s1, ctx26(c))).includes('discount-unconfirmed'), 'nel 2026 nessun avviso sugli sconti');
  });

  test('budget 2027: sforarlo costa 500 punti, al limite esatto è già errore', async () => {
    const c = await loadContext();
    const p = projectFrom2026(c.s1);
    const ev = evaluate(p, ctx27(c));
    const over = runChecks(evaluate(withTotal(p, ev, 10100), ctx27(c))).find((x) => x.code === 'budget');
    ok(over && over.level === 'error' && over.message.includes('500 punti'), 'errore budget con penalità: ' + over?.message);
    ok(codes(evaluate(withTotal(p, ev, 10000), ctx27(c))).includes('budget'), '10.000 esatti: va tenuto sotto');
    ok(!codes(evaluate(withTotal(c.s1, c.evS1, 10000), ctx26(c))).includes('budget'), 'nel 2026 10.000 esatti sono ammessi');
  });

  test('parti usate 2027: prezzo della voce, niente costo fisso né handicap', async () => {
    const c = await loadContext();
    const s2 = toRules2027(c.s2);
    const ev = evaluate(s2, ctx27(c));
    eq(cents(ev.total), 9955.88, 'si parte dal costo 2026 come prezzo');
    eq(ev.handicap, 0, 'niente handicap della vecchia Tab. 3');
    const used = ev.lines.filter((l) => l.usedPart);
    eq(used.length, 8);
    ok(used.every((l) => !l.usedPart.fixed && l.material), 'voci a prezzo');
    eq(runChecks(ev).filter((x) => x.code === 'used-price').length, 8, 'fonte del prezzo da indicare');
    const foils = (e, r) => s2ComponentTables(e, r).find((t) => t.component === 'foils');
    eq(foils(ev, RULES_2027).rows.length, foils(c.evS2, RULES_2026).rows.length, 'una riga per parte, non due');
    eq(cents(foils(ev, RULES_2027).total), 4000);
    // voce nuova: senza prezzo è un errore
    const p = projectFrom2026(c.s1);
    p.lines.push(newLine('used', 'foils', RULES_2027));
    const e2 = evaluate(p, ctx27(c));
    const l = e2.lines[e2.lines.length - 1];
    ok(l.errors.some((x) => x.includes('Prezzo mancante')), 'prezzo mancante: ' + l.errors.join('; '));
    eq(l.usedPart.year, null);
  });

  test('Performance Rating: condizioni per componente e parti commerciali (§11.1.5)', async () => {
    const c = await loadContext();
    const p = projectFrom2026(c.s1);
    p.performance = { conditions: { hull_shell: ['c', 'd'], main_vertical: ['a'], hull_internal: ['a'] } }; // a) è N/A sulla struttura interna
    const used = (id, element, year, extra = {}) => ({ id, component: element === 'mast' || element === 'sail' || element === 'boom' ? 'rig' : 'foils', name: id,
      material: { name: id, unit: 'pc', qty: 1, price: 0, priceSource: 'test' }, usedPart: { element, year, commercial: true, ...extra } });
    p.lines.push(
      used('mast-2018', 'mast', 2018),
      used('sail-2019-damaged', 'sail', 2019, { damaged: true }),
      used('mh-unknown', 'main_horizontal', null),
      used('boom-2020', 'boom', 2020),
      used('rv-2016', 'rudder_vertical', 2016),
      used('mv-student', 'main_vertical', 2020, { commercial: false }),
    );
    const perf = evaluate(p, ctx27(c)).performance;
    eq(perf.components.find((x) => x.id === 'hull_shell').points, 100);
    eq(perf.components.find((x) => x.id === 'main_vertical').points, -150);
    eq(perf.components.find((x) => x.id === 'hull_internal').points, 0, 'condizione N/A ignorata');
    eq(perf.componentsPoints, -50);
    const pts = Object.fromEntries(perf.commercial.map((x) => [x.lineId, x.points]));
    eq(pts['mast-2018'], -100); eq(pts['sail-2019-damaged'], 0); eq(pts['mh-unknown'], -100, 'anno non documentato: penalità (§11.1.5.1)');
    eq(pts['rv-2016'], 0); eq(pts['mv-student'], 0); eq(pts['boom-2020'], undefined, 'il boma non rientra nel §11.1.5');
    eq(perf.total, -250);
    eq(perf.declaredCount, 2);
    eq(runChecks(evaluate(p, ctx27(c))).filter((x) => x.code === 'commercial-2017').length, 2);
    eq(evaluate(c.s1, ctx26(c)).performance, null, 'nel 2026 non c\'è');
    const t = s1Tables(evaluate(p, ctx27(c))).performance;
    eq(t.totalRow[2], '−250');
    ok(t.rows.some((r) => r[0] === 'Hull shell' && r[1] === 'c), d)' && r[2] === '+100'), 'riga guscio scafo');
  });

  test('scarti in S2 (§9.2.2): si sommano a quantità e costo, non alle masse', async () => {
    const c = await loadContext();
    const { s2 } = freezeToS2(projectFrom2026(c.s1));
    const e0 = evaluate(s2, ctx27(c));
    ok(codes(e0).includes('waste-none'), 'promemoria: nessuno scarto registrato');
    const hull = s2.parts.find((p) => p.id === 'hull');
    hull.waste = { 'dry-fabric-basalt-fibers': 0.5, 'std-epoxy/lamination-resin': 1, 'pet/standard': 0.2 };
    s2.lines.find((l) => l.id === 'hull-mould').material.waste = 60;
    const e1 = evaluate(s2, ctx27(c));
    const line = (e, id) => e.lines.find((l) => l.id === id);
    close(line(e1, 'hull:reinforcement:dry-fabric-basalt-fibers:new').material.qty - line(e0, 'hull:reinforcement:dry-fabric-basalt-fibers:new').material.qty, 0.5, 1e-9);
    close(line(e1, 'hull:matrix:std-epoxy/lamination-resin:out_of_shelf_life').material.waste, 1, 1e-9);
    close(e1.total - e0.total, 1 * 12.5 + 0.2 * 20, 1e-9, 'resina scaduta 12,5 + PET 20 SM$/kg');
    close(e1.parts.find((p) => p.part.id === 'hull').computedMass, e0.parts.find((p) => p.part.id === 'hull').computedMass, 1e-12, 'massa del pezzo invariata');
    eq(e1.waste.rows.length, 4);
    close(e1.waste.wasteKg, 61.7, 1e-9);
    ok(!codes(e1).includes('waste-none'));
    s2.lines.find((l) => l.id === 'hull-mould').material.waste = 500;
    ok(codes(evaluate(s2, ctx27(c))).includes('waste-over'), 'scarto maggiore della quantità');
  });

  test('esporta S2 2027: niente numerazione 2026, tabelle scarti e Performance Rating', async () => {
    const c = await loadContext();
    const { s2 } = freezeToS2(projectFrom2026(c.s1));
    s2.parts.find((p) => p.id === 'hull').waste = { 'std-epoxy/lamination-resin': 1 };
    s2.performance = { conditions: { hull_shell: ['c'] } };
    const ev = evaluate(s2, ctx27(c));
    const evS1 = evaluate(s2.baseline.project, ctx27(c));
    const t = s2Tables(ev, evS1, RULES_2027);
    eq(t.components[0].caption, 'Table – Hull cost breakdown');
    ok(t.components.some((x) => x.title === 'Hiking racks'), 'terrazze = Hiking racks');
    eq(t.waste.rows.length, 1);
    eq(t.performance.totalRow[2], '+50');
    const r = await buildS2Export({ project: s2, ev, evS1, rules: RULES_2027, spec: c.spec, catalog: ev.catalog, templateBytes: c.templateBytes });
    eq(r.errors.length, 0, r.errors.join('; '));
    const docx = r.files.find((f) => f.name.endsWith('.docx'));
    const xml = await (await globalThis.JSZip.loadAsync(docx.bytes)).file('word/document.xml').async('string');
    for (const s of ['MEASURED MANUFACTURING COST', 'Material use and waste', 'SuMoth Performance Rating', 'Hiking racks cost breakdown', 'to be confirmed on the SuMoth Agora Platform']) ok(xml.includes(s), `manca "${s}"`);
    ok(!xml.includes('2.2. Components Build'), 'niente numerazione del template 2026');
    for (const f of r.files) await fetch('/out/export-s2-2027/' + encodeURIComponent(f.folder) + '/' + encodeURIComponent(f.name), { method: 'PUT', body: f.bytes });
  });

  test('scafo upcycled (§6.2.1): promemoria solo con le regole 2027', async () => {
    const c = await loadContext();
    const add = (p) => {
      const q = structuredClone(p);
      q.lines.push({ id: 'old-hull', component: 'hull', name: 'Scafo recuperato', origin: 'Laser dismesso', material: { name: 'Hull', unit: 'pc', qty: 1, source: 'upcycled' } });
      return q;
    };
    ok(codes(evaluate(add(projectFrom2026(c.s1)), ctx27(c))).includes('upcycled-hull'), '2027');
    ok(!codes(evaluate(add(c.s1), ctx26(c))).includes('upcycled-hull'), '2026');
  });
});
