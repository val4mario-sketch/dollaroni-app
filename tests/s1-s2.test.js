// S1 -> S2 transition: freezing, comparison, checks and S2 export.

import { suite, test, eq, ok, close, cents } from './lib.js';
import { loadContext } from './context.js';
import { evaluate } from '../src/engine/project.js';
import { runChecks } from '../src/engine/checks.js';
import { compareItems, costingBasis, weighedParts } from '../src/engine/compare.js';
import { compareStages } from '../src/engine/reports.js';
import { freezeToS2, projectFrom2026 } from '../src/app/templates.js';
import { buildS2Export, s2Tables } from '../src/io/s2-export.js';

const base = (c) => ({ spec: c.spec, catalogEntries: c.catalogEntries, rules: c.rules });

suite('Freeze S1 and create S2', () => {
  test("S2 starts equal to S1, with the frozen S1 inside and everything 'estimated'", async () => {
    const c = await loadContext();
    const s1 = projectFrom2026(c.s1);
    const { s2, frozen } = freezeToS2(s1, '2027-02-10T12:00:00.000Z');
    eq(s2.stage, 'S2');
    eq(s2.baseline.stage, 'S1');
    eq(s2.baseline.frozenAt, '2027-02-10T12:00:00.000Z');
    eq(frozen.stage, 'S1');
    eq(s2.baseline.project.baseline, undefined, 'no nested baselines');
    ok(s2.lines.every((l) => l.status === 'estimated') && s2.parts.every((p) => p.status === 'estimated'), 'all estimated');
    ok(s1.lines.every((l) => l.status === undefined), "the original S1 is not touched");
    const e1 = evaluate(s1, base(c));
    const e2 = evaluate(s2, base(c));
    eq(cents(e2.total), cents(e1.total));
    eq(compareItems(e1, e2).filter((x) => x.kind !== 'same').length, 0, 'no differences when just created');
    eq(costingBasis(e2).share, 0);
    ok(runChecks(e2).some((x) => x.code === 's2-estimated'), 'warning about items still estimated');
  });

  test('a change in S2 appears in the comparison item by item and by component', async () => {
    const c = await loadContext();
    const { s2 } = freezeToS2(projectFrom2026(c.s1));
    s2.parts.find((p) => p.id === 'hull').substacks[0].plies = 3; // 4 -> 3 plies as built
    const e1 = evaluate(s2.baseline.project, base(c));
    const e2 = evaluate(s2, base(c));
    const changed = compareItems(e1, e2).filter((x) => x.kind === 'changed');
    const matrix = changed.find((x) => x.id === 'hull:matrix:std-epoxy/lamination-resin:out_of_shelf_life');
    ok(matrix, 'hull resin changed');
    close(matrix.delta, -12.5103, 0.0001);
    close(matrix.qty2 / matrix.qty1, 0.75, 1e-9);
    const hull = compareStages(e1, e2).rows.find((r) => r.component === 'Hull');
    close(hull.delta, -12.5103, 0.0001);
  });

  test('real weight very different from the calculation: warning for 2.4', async () => {
    const c = await loadContext();
    const { s2 } = freezeToS2(projectFrom2026(c.s1));
    const e0 = evaluate(s2, base(c));
    const calc = e0.parts.find((p) => p.part.id === 'hull').computedMass;
    s2.parts.find((p) => p.id === 'hull').measuredMass = calc * 1.2;
    const e2 = evaluate(s2, base(c));
    const w = weighedParts(e2);
    eq(w.length, 1);
    close(w[0].ratio, 0.2, 1e-9);
    ok(runChecks(e2).some((x) => x.code === 'weighed-mass' && x.target === 'hull'));
  });
});

suite('Export S2 – 2026 data', () => {
  test('tables 2.2–2.3 as in the 2026 S2 docx, with S1 comparison', async () => {
    const c = await loadContext();
    const t = s2Tables(c.evS2, c.evS1, c.rules);
    eq(t.components.length, 7);
    const hull = t.components.find((x) => x.component === 'hull');
    eq(hull.rows.length, 17);
    eq(hull.totalRow[2], '3,697.99');
    ok(hull.footnotes.some((f) => f.includes('Out-of-shelf-life')) && hull.footnotes.some((f) => f.includes('industrial excess')) && hull.footnotes.some((f) => f.includes('gelcoat')), 'OOSL, surplus, gelcoat notes');
    eq(t.summary.totalRow[1], '9,955.88');
    eq(t.summary.note, 'Budget cap: 10,000.00 SM$. Remaining margin: 44.12 SM$.');
    const cmp = Object.fromEntries(t.comparison.rows.map((r) => [r[0], r]));
    eq(cmp.Hull[3], '−2,267.77'); eq(cmp.Hull[4], '−38.0%');
    eq(cmp.Foils[3], '+3,785.49'); eq(cmp.Foils[4], '+1,765%');
    eq(cmp.Gantry[3], 'new'); eq(cmp.Electronics[3], 'new');
    eq(t.comparison.totalRow[3], '+1,533.44'); eq(t.comparison.totalRow[4], '+18.2%');
    eq(t.basis.totalRow[3], '100.0%', '2026 example: all measured');
  });

  test('S2 package: Layup Calculator of the 2 as-built parts + images + document', async () => {
    const c = await loadContext();
    const r = await buildS2Export({ project: c.s2, ev: c.evS2, evS1: c.evS1, rules: c.rules, spec: c.spec, catalog: c.evS2.catalog, templateBytes: c.templateBytes });
    eq(r.errors.length, 0, r.errors.join('; '));
    eq(r.files.filter((f) => f.name.endsWith('.xlsx')).length, 2);
    eq(r.files.filter((f) => f.name.endsWith('.png')).length, 2);
    const docx = r.files.find((f) => f.name.endsWith('.docx'));
    const xml = await (await globalThis.JSZip.loadAsync(docx.bytes)).file('word/document.xml').async('string');
    for (const s of ['2.2. Components Build', 'Comparison with S1 Report estimations', '9,955.88', '+1,533.44', 'Costing basis', 'Epoxy resin (hull matrix) – OOSL']) ok(xml.includes(s), `manca "${s}"`);
    for (const f of r.files) await fetch('/out/export-s2/' + encodeURIComponent(f.folder) + '/' + encodeURIComponent(f.name), { method: 'PUT', body: f.bytes });
  });
});
