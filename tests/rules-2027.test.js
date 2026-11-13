// 2027 rulebook (2027 SMC Competition Rulebook v1.0, 7 September 2026).

import { suite, test, eq, ok, close, cents } from './lib.js';
import { loadContext } from './context.js';
import { evaluate } from '../src/engine/project.js';
import { runChecks } from '../src/engine/checks.js';
import { rulesFor, RULES_2026, RULES_2027 } from '../src/engine/rules.js';
import { s2ComponentTables } from '../src/engine/reports.js';
import { projectFrom2026, toRules2027, freezeToS2, newLine } from '../src/app/templates.js';
import { s1Tables } from '../src/io/s1-export.js';
import { s2Tables, buildS2Export } from '../src/io/s2-export.js';

const ctx27 = (c) => ({ ...c.agora, rules: RULES_2027 });
const ctx26 = (c) => ({ spec: c.spec, catalogEntries: c.catalogEntries, rules: RULES_2026 });
const codes = (ev) => runChecks(ev).map((x) => x.code);

/** Free-price item (hardware) that brings the total to the wanted value. */
function withTotal(p, ev, target) {
  const q = structuredClone(p);
  q.lines.push({ id: 'fill', component: 'electronics', name: 'Fill', material: { name: 'Fill', unit: 'pc', qty: 1, price: target - ev.total, priceSource: 'test' } });
  return q;
}

suite('2027 rules', () => {
  test('Table 2 same as 2026 ("Hiking racks"), rules chosen by the project', async () => {
    eq(JSON.stringify(RULES_2027.carbonLimits), JSON.stringify(RULES_2026.carbonLimits), 'carbon limits');
    eq(RULES_2027.carbonGroups.find((g) => g.id === 'wingbars').en, 'Hiking racks');
    eq(RULES_2027.components.find((g) => g.id === 'wingbars').en, 'Hiking racks');
    eq(rulesFor({}), RULES_2026, 'file with no rules field = 2026');
    eq(rulesFor({ rules: '2027' }), RULES_2027);
    eq(rulesFor({ rules: '2030' }), null);
    eq(RULES_2027.performance.components.length, 15);
  });

  test('new boat from Meravijosa: 2027 rules, Agora resin fractions, discounts applied as on Agora', async () => {
    const c = await loadContext();
    const p = projectFrom2026(c.s1);
    eq(p.rules, '2027');
    const ev = evaluate(p, ctx27(c));
    eq(cents(ev.total), 8405.57, '8422.36 with the 2026 Vf: less resin (basalt/carbon by hand + vacuum 40%/50% of the mass), −16.78 SM$ checked by hand');
    const k = codes(ev);
    ok(!k.includes('discount-unconfirmed'), 'Agora applies the origin discounts');
    ok(!k.includes('uptake'), 'the §2.5 mass breakdown is no longer required');
    const mh = ev.carbon.find((g) => g.id === 'main_horizontal').checks.find((x) => x.key === 'cfrp');
    close(mh.value / mh.limit, 0.906, 0.001, 'main horizontal no longer over: CFRP = 2 × CF with 50% resin');
    ok(!codes(evaluate(c.s1, ctx26(c))).includes('discount-unconfirmed'), 'in 2026 no warning on discounts');
  });

  test('2027 budget: exceeding it costs 500 points, exactly at the limit is already an error', async () => {
    const c = await loadContext();
    const p = projectFrom2026(c.s1);
    const ev = evaluate(p, ctx27(c));
    const over = runChecks(evaluate(withTotal(p, ev, 10100), ctx27(c))).find((x) => x.code === 'budget');
    ok(over && over.level === 'error' && over.message.includes('500 points'), 'budget error with penalty: ' + over?.message);
    ok(codes(evaluate(withTotal(p, ev, 10000), ctx27(c))).includes('budget'), 'exactly 10,000: must be kept under');
    ok(!codes(evaluate(withTotal(c.s1, c.evS1, 10000), ctx26(c))).includes('budget'), 'in 2026 exactly 10,000 is allowed');
  });

  test('2027 used parts: item price, no fixed cost or handicap', async () => {
    const c = await loadContext();
    const s2 = toRules2027(c.s2);
    const ev = evaluate(s2, ctx27(c));
    eq(cents(ev.total), 9955.88, 'starts from the 2026 cost as the price');
    eq(ev.handicap, 0, 'no handicap of the old Table 3');
    const used = ev.lines.filter((l) => l.usedPart);
    eq(used.length, 8);
    ok(used.every((l) => !l.usedPart.fixed && l.material), 'priced items');
    eq(runChecks(ev).filter((x) => x.code === 'used-price').length, 8, 'price source to state');
    const foils = (e, r) => s2ComponentTables(e, r).find((t) => t.component === 'foils');
    eq(foils(ev, RULES_2027).rows.length, foils(c.evS2, RULES_2026).rows.length, 'one row per part, not two');
    eq(cents(foils(ev, RULES_2027).total), 4000);
    // new item: without a price it is an error
    const p = projectFrom2026(c.s1);
    p.lines.push(newLine('used', 'foils', RULES_2027));
    const e2 = evaluate(p, ctx27(c));
    const l = e2.lines[e2.lines.length - 1];
    ok(l.errors.some((x) => x.includes('Price missing')), 'price missing: ' + l.errors.join('; '));
    eq(l.usedPart.year, null);
  });

  test('Performance Rating: conditions by component and commercial parts (§11.1.5)', async () => {
    const c = await loadContext();
    const p = projectFrom2026(c.s1);
    p.performance = { conditions: { hull_shell: ['c', 'd'], main_vertical: ['a'], hull_internal: ['a'] } }; // a) is N/A on the internal structure
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
    eq(perf.components.find((x) => x.id === 'hull_internal').points, 0, 'N/A condition ignored');
    eq(perf.componentsPoints, -50);
    const pts = Object.fromEntries(perf.commercial.map((x) => [x.lineId, x.points]));
    eq(pts['mast-2018'], -100); eq(pts['sail-2019-damaged'], 0); eq(pts['mh-unknown'], -100, 'year not documented: penalty (§11.1.5.1)');
    eq(pts['rv-2016'], 0); eq(pts['mv-student'], 0); eq(pts['boom-2020'], undefined, 'the boom is not covered by §11.1.5');
    eq(perf.total, -250);
    eq(perf.declaredCount, 2);
    eq(runChecks(evaluate(p, ctx27(c))).filter((x) => x.code === 'commercial-2017').length, 2);
    eq(evaluate(c.s1, ctx26(c)).performance, null, 'not in 2026');
    const t = s1Tables(evaluate(p, ctx27(c))).performance;
    eq(t.totalRow[2], '−250');
    ok(t.rows.some((r) => r[0] === 'Hull shell' && r[1] === 'c), d)' && r[2] === '+100'), 'hull shell row');
  });

  test('S2 waste (§9.2.2): adds to quantity and cost, not to the masses', async () => {
    const c = await loadContext();
    const { s2 } = freezeToS2(projectFrom2026(c.s1));
    const e0 = evaluate(s2, ctx27(c));
    ok(codes(e0).includes('waste-none'), 'reminder: no waste recorded');
    const hull = s2.parts.find((p) => p.id === 'hull');
    hull.waste = { 'dry-fabric-basalt-fibers': 0.5, 'std-epoxy/lamination-resin': 1, 'pet/standard': 0.2 };
    s2.lines.find((l) => l.id === 'hull-mould').material.waste = 60;
    const e1 = evaluate(s2, ctx27(c));
    const line = (e, id) => e.lines.find((l) => l.id === id);
    close(line(e1, 'hull:reinforcement:dry-fabric-basalt-fibers:new').material.qty - line(e0, 'hull:reinforcement:dry-fabric-basalt-fibers:new').material.qty, 0.5, 1e-9);
    close(line(e1, 'hull:matrix:std-epoxy/lamination-resin:out_of_shelf_life').material.waste, 1, 1e-9);
    close(e1.total - e0.total, 1 * 12.5 + 0.2 * 20, 1e-9, 'expired resin 12.5 + PET 20 SM$/kg');
    close(e1.parts.find((p) => p.part.id === 'hull').computedMass, e0.parts.find((p) => p.part.id === 'hull').computedMass, 1e-12, 'mass of the part unchanged');
    eq(e1.waste.rows.length, 4);
    close(e1.waste.wasteKg, 61.7, 1e-9);
    ok(!codes(e1).includes('waste-none'));
    s2.lines.find((l) => l.id === 'hull-mould').material.waste = 500;
    ok(codes(evaluate(s2, ctx27(c))).includes('waste-over'), 'waste greater than the quantity');
  });

  test('2027 S2 export: no 2026 numbering, waste and Performance Rating tables', async () => {
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
    const r = await buildS2Export({ project: s2, ev, evS1, rules: RULES_2027, spec: c.agora.spec, catalog: ev.catalog, templateBytes: null });
    eq(r.errors.length, 0, r.errors.join('; '));
    const docx = r.files.find((f) => f.name.endsWith('.docx'));
    const xml = await (await globalThis.JSZip.loadAsync(docx.bytes)).file('word/document.xml').async('string');
    for (const s of ['MEASURED MANUFACTURING COST', 'Material use and waste', 'SuMoth Performance Rating', 'Hiking racks cost breakdown', 'as applied by the SuMoth Agora Platform', 'resin fractions of the SuMoth Agora library']) ok(xml.includes(s), `manca "${s}"`);
    ok(!xml.includes('2.2. Components Build'), 'no numbering of the 2026 template');
    ok(!r.files.some((f) => f.name.endsWith('.xlsx')), 'no Layup Calculator file in 2027');
    ok(r.files.some((f) => f.folder === 'Appendix'), 'layup tables as images');
    for (const f of r.files) await fetch('/out/export-s2-2027/' + encodeURIComponent(f.folder) + '/' + encodeURIComponent(f.name), { method: 'PUT', body: f.bytes });
  });

  test('SuMoth Agora library: 2026 ids kept, resin fraction by process × family, prepreg and core grades', async () => {
    const c = await loadContext();
    const cat = new Map(c.agora.catalogEntries.map((e) => [e.id, e]));
    for (const proj of [c.s1, c.s2]) {
      const refs = [...proj.parts.flatMap((pt) => pt.substacks.flatMap((x) => [x.reinforcement, x.matrix])), ...proj.lines.map((l) => l.material?.ref || l.process?.ref)];
      for (const r of refs) ok(!r || r.startsWith('hw-') || cat.has(r), `"${r}" missing from the Agora catalogue`);
    }
    eq(cat.get('dry-fabric-carbon-fibers/ultra-high-modulus-cf').price, 450, 'UHM 450 on Agora (250 in 2026)');
    eq(cat.get('mma/bonding').price, 15);
    eq(c.agoraWarnings.length, 2, 'Cork and Balsa without price');
    const IM = 'dry-fabric-carbon-fibers/int-modulus-cf';
    const part = (sub, core) => ({ id: 'x', name: 'X', component: 'hull', autoLines: true, substacks: [{ plyArea: 1, plies: 1, arealWeight: 200, matrix: 'std-epoxy/lamination-resin', ...sub }], ...(core ? { core } : {}) });
    const run = (pt) => evaluate({ rules: '2027', parts: [pt], lines: [] }, ctx27(c));
    // infusion of IM carbon: r = 0.45 -> resin = 200 · 0.45/0.55; Vf = (0.55/1.77) / (0.55/1.77 + 0.45/1.15)
    const inf = run(part({ reinforcement: IM, process: 'INFUSION' })).parts[0].substacks[0];
    close(inf.resin, 163.636, 0.001);
    close(inf.vf, 0.4426, 0.0001);
    // IM prepreg in OoA: r = 0.37, fibre and resin at 400 SM$/kg
    const pp = run(part({ reinforcement: 'cf-epoxy-prepreg/epoxy-int-modulus-cf', process: 'OOA CURING' }));
    close(pp.total, (200 + 200 * 0.37 / 0.63) / 1000 * 400, 1e-9);
    ok(pp.lines.every((l) => l.material.entry.kind === 'prepreg'), 'resin on the prepreg item');
    // recycled PET 100 kg/m³: 1040 g/m² of absorbed resin on Agora
    const core = run(part({ reinforcement: IM, process: 'INFUSION' }, { ref: 'pet/recycled', area: 2, thickness: 10, density: 100 })).parts[0].core;
    close(core.mass, 2, 1e-9);
    close(core.uptake, 2.08, 1e-9);
  });

  test('upcycled hull (§6.2.1): reminder only with the 2027 rules', async () => {
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
