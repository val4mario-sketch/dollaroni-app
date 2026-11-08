// Brumoth: project changes with Apply/Cancel, requests that are too generic, instructions on the app.

import { suite, test, eq, close, ok } from './lib.js';
import { loadContext } from './context.js';
import { evaluate } from '../src/engine/project.js';
import { runChecks } from '../src/engine/checks.js';
import { RULES_2027 } from '../src/engine/rules-2027.js';
import { projectFrom2026 } from '../src/app/templates.js';
import { answer } from '../src/engine/assistant.js';

let cache = null;
async function setup() {
  if (cache) return cache;
  const c = await loadContext();
  const project = projectFrom2026(structuredClone(c.s1));
  const base = { spec: c.spec, catalogEntries: c.catalogEntries, rules: RULES_2027 };
  const ev = evaluate(project, base);
  cache = { project, base, ev, ctx: { ev, checks: runChecks(ev), spec: c.spec, catalogEntries: c.catalogEntries } };
  return cache;
}
const ask = async (q) => answer(q, (await setup()).ctx);
/** Applies the action to a copy of the project and evaluates it. */
async function applied(action) {
  const { project, base } = await setup();
  const d = structuredClone(project);
  action.apply(d);
  return { d, ev: evaluate(d, base) };
}

suite('Brumoth – changes with Apply/Cancel', () => {
  test('request too generic: says so and proposes no changes', async () => {
    const a = await ask('aggiungi carbonio');
    eq(a.actions.length, 0);
    ok(a.text.includes('too generic'), 'avviso');
    ok(a.text.includes('the quantity') && a.text.includes('which laminated part'), 'says what is missing');
    const b = await ask('aggiungi 15 kg di carbonio');
    eq(b.actions.length, 0);
    ok(b.text.includes('which laminated part'), 'only the part is missing');
  });
  test('add 2 kg of carbon to the hull: new substack, Table 2 limits in the preview', async () => {
    const { ev } = await setup();
    const a = await ask('aggiungi 2 kg di carbonio allo scafo');
    eq(a.actions.length, 1);
    eq(a.actions[0].type, 'addFibre');
    eq(a.noLLM, true);
    const { ev: ev2 } = await applied(a.actions[0]);
    const fibre = (e) => e.parts.find((p) => p.part.id === 'hull').totals.fibres;
    close(fibre(ev2) - fibre(ev), 2000, 0.01, '+2000 g of fibre');
    close(a.actions[0].preview.after.total, ev2.total, 0.005, 'preview = project applied');
    ok(a.actions[0].preview.problems.some((p) => p.message.includes('Hull') && p.level === 'error'), 'warns about the carbon limit');
  });
  test('make the fin in basalt: same figure as the simulation', async () => {
    const { ev } = await setup();
    const a = await ask('fai la deriva in basalto');
    eq(a.actions[0].type, 'swapFibre');
    close(a.actions[0].preview.after.total - ev.total, -71.06, 0.01);
    const w = await ask('e se facessi la deriva in basalto?');
    eq(w.actions.length, 1, 'the simulation also offers Apply');
  });
  test('new material in the price list and new part', async () => {
    const m = await ask('aggiungi il materiale "Carbon/Innegra" a 160 SM$/kg con densità 1,3');
    eq(m.actions[0].type, 'addMaterial');
    const { d } = await applied(m.actions[0]);
    const x = d.catalogExtras.find((e) => e.name === 'Carbon/Innegra');
    ok(x, 'team item created');
    eq(x.kind, 'reinforcement'); eq(x.price, 160); eq(x.density, 1.3); eq(x.unit, 'kg');
    const p = await ask('crea un pezzo chiamato Timone di riserva nei foil');
    eq(p.actions[0].type, 'addPart');
    const { d: d2 } = await applied(p.actions[0]);
    const part = d2.parts.find((q) => q.name === 'Timone di riserva');
    ok(part, 'part created');
    eq(part.component, 'foils'); eq(part.limitGroup, 'rudder_vertical'); eq(part.autoLines, true);
  });
  test('the user question: instructions + Wings part, and for the material it asks for price and density', async () => {
    const a = await ask("voglio fare una sezione chiamata terrazze e aggiungere il carbo innegra che è un materiale che non c'è come faccio?");
    eq(a.intents[0], 'howto');
    ok(a.text.includes('New part') && a.text.includes('Add item'), 'steps with the button names');
    eq(a.actions.length, 1);
    eq(a.actions[0].type, 'addPart');
    ok(a.actions[0].title.includes('Terrazze'));
    ok(a.text.includes('carbo innegra') && a.text.includes('price') && a.text.includes('density'), 'asks what is missing');
  });
  test('deleting a part; normal questions stay questions', async () => {
    const a = await ask('elimina il pezzo bulkheads');
    eq(a.actions[0].type, 'removePart');
    const { d } = await applied(a.actions[0]);
    ok(!d.parts.some((p) => p.id === 'bulkheads'));
    eq((await ask('fammi la classificazione dei costi')).intents[0], 'ranking');
    eq((await ask('quanto budget ci rimane?')).actions.length, 0);
    const h = await ask('come faccio a esportare il report?');
    eq(h.intents[0], 'howto');
    ok(h.text.includes('Export S1'));
  });
});

suite('Brumoth in English', () => {
  test('topics are recognized from English questions', async () => {
    eq((await ask('how much budget do we have left?')).intents[0], 'budget');
    eq((await ask('where do we spend the most?')).intents[0], 'ranking');
    eq((await ask('what do we need to fix?')).intents[0], 'issues');
    eq((await ask('how can we save money?')).intents[0], 'savings');
    eq((await ask('what if I made the fin in basalt?')).intents[0], 'whatif');
  });
  test('change requests work in English, always with a preview', async () => {
    const a = await ask('add 2 kg of carbon to the hull');
    eq(a.actions.length, 1);
    eq(a.actions[0].type, 'addFibre');
    const m = await ask('put 20 kg of MDF in the hull');
    eq(m.actions[0].type, 'addLine');
    const d = await ask('delete the part bulkheads');
    eq(d.actions[0].type, 'removePart');
    const s = await ask('make the fin in basalt');
    eq(s.actions[0].type, 'swapFibre');
  });
  test('a generic English request asks for what is missing', async () => {
    const a = await ask('add carbon');
    eq(a.actions.length, 0);
    ok(a.text.includes('too generic'));
  });
  test('how-to questions in English get the steps', async () => {
    const h = await ask('how do I export the report?');
    eq(h.intents[0], 'howto');
    ok(h.text.includes('Export S1'));
  });
});
