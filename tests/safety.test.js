// Silent errors in the accounts and data protection: checks, file validation, saving.

import { suite, test, eq, ok, close } from './lib.js';
import { loadContext } from './context.js';
import { RULES_2027 } from '../src/engine/rules.js';
import { evaluate } from '../src/engine/project.js';
import { runChecks } from '../src/engine/checks.js';
import { newLine, newPart, projectFrom2026, DEFAULT_GROUPS } from '../src/app/templates.js';
import { validateProject, saveProjectFile, hasUnsavedWork, saveRecoveryCopy, loadRecoveryCopy, clearRecoveryCopy, serialize } from '../src/app/store.js';

const CARBON = 'dry-fabric-carbon-fibers/std-modulus-cf';

async function base() {
  const c = await loadContext();
  const project = projectFrom2026(structuredClone(c.s1));
  const ctx = { ...c.agora, rules: RULES_2027 };
  return { project, ctx, run: (p) => { const ev = evaluate(p, ctx); return { ev, checks: runChecks(ev) }; } };
}

const has = (checks, code, target) => checks.some((x) => x.code === code && (target === undefined || x.target === target));

/** Fake file with the same interface as FileSystemFileHandle. */
function fakeHandle(lastModified) {
  const h = {
    name: 'prova.dollaroni.json', lastModified, text: 'originale',
    getFile: async () => ({ lastModified: h.lastModified }),
    createWritable: async () => ({ write: async (t) => { h.text = t; }, close: async () => { h.lastModified += 1000; } }),
  };
  return h;
}

suite('Silent errors in the accounts', () => {
  test('carbon on a manual item is flagged because it stays outside Table 2', async () => {
    const { project: p, run } = await base();
    const before = run(p).ev.carbon.reduce((a, g) => a + g.checks[0].value, 0);
    eq(has(run(p).checks, 'manual-carbon'), false, 'Meravijosa has no manual carbon');
    p.lines.push({ id: 't1', component: 'foils', name: 'Carbonio a mano', material: { ref: CARBON, qty: 50, source: 'new' } });
    const r = run(p);
    ok(has(r.checks, 'manual-carbon', 't1'), 'manual-carbon warning missing');
    close(r.ev.carbon.reduce((a, g) => a + g.checks[0].value, 0), before, 1e-9, 'the limits stay calculated only from the parts');
  });
  test('carbon on a free item yes, carbon linked to the layup no', async () => {
    const { project: p, run } = await base();
    p.lines.push({ id: 't2', component: 'rig', name: 'Tubo', material: { name: 'Carbon scrap', unit: 'kg', qty: 1, price: 40, priceSource: 'x' } });
    p.lines.push({ id: 't3', component: 'hull', name: 'Dal layup', material: { ref: CARBON, source: 'new', fromLayup: { parts: ['hull'], kind: 'fibre' } } });
    const c = run(p).checks;
    ok(has(c, 'manual-carbon', 't2'), 'free item');
    eq(has(c, 'manual-carbon', 't3'), false, 'item linked to the layup');
    eq(has(c, 'manual-carbon', 'mast'), false, 'upcycled mast already made, in pc');
  });
  test('forgotten zero-cost items, but not the 0 prices of the price list or the upcycled items', async () => {
    const { project: p, run } = await base();
    const add = (type, id, patch = {}) => { const l = newLine(type, 'rig', RULES_2027); l.id = id; if (patch.material) Object.assign(l.material, patch.material); p.lines.push(l); };
    add('hardware', 'hw0');
    add('process', 'proc0');
    add('material', 'qty0');
    add('upcycled', 'upc', { material: { name: 'Vecchio albero' } });
    p.lines.push({ id: 'pet', component: 'rig', name: 'PET riciclato', material: { ref: 'pet/recycled', qty: 2, source: 'new' } });
    const c = run(p).checks;
    for (const id of ['hw0', 'proc0', 'qty0']) ok(has(c, 'zero-cost', id), `zero-cost missing on ${id}`);
    eq(has(c, 'zero-cost', 'upc'), false, 'upcycled at 0 SM$ is expected');
    eq(has(c, 'zero-cost', 'pet'), false, 'recycled PET costs 0 in the price list');
  });
  test('negative values are errors', async () => {
    const { project: p, run } = await base();
    p.lines.push({ id: 'neg', component: 'rig', name: 'Neg', material: { ref: CARBON, qty: -10, source: 'new' } });
    p.lines.push({ id: 'negh', component: 'rig', name: 'NegH', process: { ref: 'machining', hours: -2 } });
    p.parts[0].substacks[0].plies = -4;
    const c = run(p).checks;
    ok(c.some((x) => x.level === 'error' && x.code === 'negative' && x.target === 'neg'), 'quantità');
    ok(c.some((x) => x.level === 'error' && x.code === 'negative' && x.target === 'negh'), 'ore');
    ok(c.some((x) => x.level === 'error' && x.code === 'negative' && x.target === p.parts[0].id), 'strati');
    eq(has(c, 'waste-over', 'neg'), false, 'no misleading waste warning');
  });
  test('duplicate ids are errors', async () => {
    const { project: p, run } = await base();
    eq(has(run(p).checks, 'duplicate-id'), false, 'no duplicates in the good data');
    p.lines.push({ ...p.lines[0] });
    p.parts.push({ ...p.parts[0] });
    const c = run(p).checks;
    ok(c.some((x) => x.level === 'error' && x.code === 'duplicate-id' && x.target === p.lines[0].id), 'voce');
    ok(c.some((x) => x.level === 'error' && x.code === 'duplicate-id' && x.target === p.parts[0].id), 'pezzo');
  });
  test('a new foil asks which Table 2 group to use', async () => {
    const { project: p, run } = await base();
    eq(DEFAULT_GROUPS.foils.limitGroup, null);
    const foil = newPart('foils');
    p.parts.push(foil);
    ok(has(run(p).checks, 'foil-group', foil.id), 'warning missing');
    foil.limitGroup = 'main_horizontal';
    eq(has(run(p).checks, 'foil-group', foil.id), false, 'group chosen, no warning');
  });
  test('discounts to be confirmed: total and margin without discounts', async () => {
    const { project: p, ctx } = await base();
    // Agora applies the discounts; the check stays for rules that leave them unconfirmed
    const run = (q) => runChecks(evaluate(q, { ...ctx, rules: { ...RULES_2027, sourcesToConfirm: true } }));
    ok(!runChecks(evaluate(p, ctx)).some((x) => x.code === 'discount-unconfirmed'), 'not with the Agora rules');
    const w = run(p).find((x) => x.code === 'discount-unconfirmed');
    ok(w.message.includes('8.727,35 SM$'), 'total without discounts: ' + w.message); // 8.405,57 + 321,77
    ok(w.message.includes('the margin would fall to 1.272,65 SM$'), w.message);
    p.lines.push({ id: 'caro', component: 'rig', name: 'Caro', material: { name: 'Caro', unit: 'pc', qty: 1, price: 1400, priceSource: 'x' } });
    ok(run(p).find((x) => x.code === 'discount-unconfirmed').message.includes('you would exceed the budget by 127,35 SM$'), 'worst case over budget');
  });
  test('the 2026 data stays free of new errors and with the golden totals', async () => {
    const { evS1, evS2 } = await loadContext();
    close(evS1.total, 8422.44, 0.01, 'S1');
    close(evS2.total, 9955.88, 0.01, 'S2');
    eq(runChecks(evS2).filter((x) => x.level === 'error').length, 0, 'errori S2');
    eq(runChecks(evS1).filter((x) => ['negative', 'duplicate-id', 'foil-group'].includes(x.code)).length, 0, 'errori S1');
  });
});

suite('Project file and saving', () => {
  const minimal = (extra) => ({ schema: 'dollaroni/1', ...extra });
  const rejects = (project, text) => {
    try {
      validateProject(project);
    } catch (e) {
      ok(e.message.includes(text), `unexpected message: ${e.message}`);
      return;
    }
    throw new Error(`the file should have been rejected (${text})`);
  };

  test('validateProject accepts the examples and fills in the missing lists', async () => {
    const { s1, s2 } = await loadContext();
    validateProject(structuredClone(s1));
    validateProject(structuredClone(s2));
    const p = validateProject(minimal());
    eq(p.parts.length + p.lines.length + p.catalogExtras.length, 0);
  });
  test('validateProject rejects null rows and wrong types with a clear message', () => {
    rejects(minimal({ lines: [null] }), 'items n. 1');
    rejects(minimal({ lines: 'no' }), 'list');
    rejects(minimal({ lines: [{ id: 'a', name: 'Bozzelli', material: { qty: '3' } }] }), 'Item "Bozzelli": "qty"');
    rejects(minimal({ lines: [{ id: 'a', process: { hours: 'tante' } }] }), '"hours"');
    rejects(minimal({ parts: [{ id: 'a', name: 'Hull', substacks: [{ plies: '4' }] }] }), 'Part "Hull", substack n. 1');
    rejects(minimal({ parts: [{ id: 'a', name: 'Hull', substacks: 3 }] }), 'substacks');
    rejects(minimal({ baseline: { project: minimal({ lines: [null] }) } }), 'items n. 1');
    rejects(minimal({ budget: '10000' }), '"budget"');
  });
  test('saving does not overwrite a changed file without confirmation', async () => {
    const h = fakeHandle(2000);
    let asked = 0;
    const no = await saveProjectFile(minimal(), h, { knownModified: 1000, confirmOverwrite: () => { asked += 1; return false; } });
    eq(no, null, 'rifiutato');
    eq(asked, 1);
    eq(h.text, 'originale', 'file intact');
    const yes = await saveProjectFile(minimal(), h, { knownModified: 1000, confirmOverwrite: () => true });
    ok(h.text.includes('dollaroni/1'), 'written after confirmation');
    eq(yes.lastModified, 3000, 'date updated after saving');
  });
  test('saving asks nothing if the file has not changed', async () => {
    const h = fakeHandle(1000);
    const r = await saveProjectFile(minimal(), h, { knownModified: 1000, confirmOverwrite: () => { throw new Error('it should not have asked'); } });
    ok(r && h.text.includes('dollaroni/1'));
    const second = await saveProjectFile(minimal(), h, { knownModified: r.lastModified, confirmOverwrite: () => { throw new Error('second save'); } });
    ok(second, 'our own save does not count as a change by others');
  });
  test('unsaved work: neither equal to the file nor just opened', () => {
    const p = minimal({ name: 'A' });
    const json = serialize(p);
    eq(hasUnsavedWork(null, null, null), false, 'no project');
    eq(hasUnsavedWork(p, json, null), false, 'equal to the file');
    eq(hasUnsavedWork(p, null, json), false, 'example just opened');
    eq(hasUnsavedWork({ ...p, name: 'B' }, json, json), true, 'modificato');
    eq(hasUnsavedWork(p, null, null), true, 'old autosave with no information: protected');
  });
  test('the recovery copy keeps the project', () => {
    const previous = localStorage.getItem('dollaroni.recovery.v1');
    try {
      ok(saveRecoveryCopy({ project: minimal({ name: 'Da salvare' }), fileName: 'x.json' }));
      const r = loadRecoveryCopy();
      eq(r.project.name, 'Da salvare');
      eq(r.fileName, 'x.json');
      ok(r.keptAt, 'date of the copy');
      clearRecoveryCopy();
      eq(loadRecoveryCopy(), null);
    } finally {
      if (previous) localStorage.setItem('dollaroni.recovery.v1', previous);
    }
  });
});
