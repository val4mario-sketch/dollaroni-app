// Assistant: recognized topics, numbers in the answers (from the engine) and check of the AI numbers.

import { suite, test, eq, close, ok } from './lib.js';
import { loadContext } from './context.js';
import { evaluate } from '../src/engine/project.js';
import { runChecks } from '../src/engine/checks.js';
import { RULES_2027 } from '../src/engine/rules-2027.js';
import { projectFrom2026 } from '../src/app/templates.js';
import { answer, route, verifyNumbers, buildMessages, savingIdeas, simulateSwap, findMaterials, normalize } from '../src/engine/assistant.js';

let cache = null;
async function ctx2027() {
  if (cache) return cache;
  const c = await loadContext();
  const project = projectFrom2026(structuredClone(c.s1));
  const base = { ...c.agora, rules: RULES_2027 };
  const ev = evaluate(project, base);
  cache = { c, project, base, ev, ctx: { ev, checks: runChecks(ev), spec: c.agora.spec } };
  return cache;
}
const ask = async (q, extra = {}) => {
  const { ctx } = await ctx2027();
  return answer(q, { ...ctx, ...extra });
};

suite('Assistant – topics and numbers', () => {
  test('works out what the question is about', async () => {
    const { ev } = await ctx2027();
    const ids = (q) => route(q, { ev }).intents.map((x) => x.id);
    eq(ids('quanto budget ci rimane?')[0], 'budget');
    eq(ids('quanto carbonio serve per finire il budget?')[0], 'capacity');
    eq(ids('fammi la classificazione dei costi')[0], 'ranking');
    eq(ids('cosa dobbiamo sistemare prima della consegna?')[0], 'issues');
    eq(ids('come possiamo risparmiare?')[0], 'savings');
    eq(ids('e se facessi la deriva in basalto?')[0], 'whatif');
    eq(ids("dove c'è troppo carbonio?")[0], 'carbon');
    const r = route('e se facessi la deriva in basalto?', { ev });
    eq(r.entities.parts.map((p) => p.part.name).join(), 'Main vertical');
    eq(r.entities.materials.map((m) => m.key).join(), 'basalt');
    eq(findMaterials(normalize('carbonio alto modulo e carbonio')).map((m) => m.key).join(), 'carbon-hm,carbon');
  });
  test('follow-up question: "e lo scafo?" reuses the previous topic', async () => {
    const { ev } = await ctx2027();
    const prev = route('quanto pesa la deriva?', { ev });
    eq(prev.intents[0].id, 'parts');
    const r = route('e lo scafo?', { ev, previous: prev });
    eq(r.intents[0].id, 'parts');
    eq(r.entities.parts[0].part.name, 'Hull');
  });
  test('budget: engine total and margin (Meravijosa brought to 2027)', async () => {
    const a = await ask('quanto budget rimane?');
    ok(a.text.includes('8.405,57 SM$'), 'totale');
    ok(a.text.includes('Remaining 1.594,43 SM$'), 'margine');
    ok(a.text.includes('−500 points'), 'penalità 2027');
    ok(!a.text.includes('origin discounts'), 'Agora applies the discounts: nothing to confirm');
  });
  test('capacity: carbon that can be bought with the margin and Table 2 limits', async () => {
    const a = await ask('quanto carbonio serve per finire il budget? dove ce ne è troppo?');
    eq(a.intents.join(), 'capacity,carbon');
    ok(a.text.includes('about 10,63 kg'), 'dry carbon 1594,43/150');
    ok(a.text.includes('1,00 kg of resin'), 'resin per kg of fibre: 50% resin by mass on Agora');
    ok(a.text.includes('9,51 kg of CFRP'), 'CFRP room left');
    ok(a.text.includes('the limits stop you first'), 'the limit comes before the budget');
    ok(a.text.includes('No group is over the limit'), 'main horizontal at 90,6%');
  });
  test('simulation: the fin in basalt, equal to the full recalculation of the project', async () => {
    const { ev, project, base, c } = await ctx2027();
    const a = await ask('e se facessi la deriva in basalto?');
    ok(a.text.includes('Main vertical'), 'pezzo');
    const sims = simulateSwap(ev, { spec: c.agora.spec }, ev.parts.filter((p) => p.part.id === 'main-vertical'), findMaterials('carbonio')[0], findMaterials('basalto')[0]);
    eq(sims.length, 1);
    const p2 = structuredClone(project);
    for (const s of p2.parts.find((p) => p.id === 'main-vertical').substacks) { s.reinforcement = 'dry-fabric-basalt-fibers'; delete s.carbonSource; }
    const ev2 = evaluate(p2, base);
    close(sims[0].delta, ev2.total - ev.total, 0.005, 'simulated Δ = Δ of the recalculated project');
    ok(sims[0].delta < 0, 'basalt costs less');
  });
  test('savings ideas: recycled MDF and carbon -> basalt', async () => {
    const { ev, c } = await ctx2027();
    const ideas = savingIdeas(ev, { spec: c.agora.spec });
    const mdf = ideas.find((x) => x.kind === 'recycled' && x.target === 'hull-mould');
    ok(mdf, 'recycled MDF missing');
    close(mdf.saving, 1900, 0.005, '190 kg × (20 − 10)');
    ok(ideas.some((x) => x.kind === 'basalt'), 'carbon -> basalt missing');
    ok(ideas.every((x, i) => i === 0 || ideas[i - 1].saving >= x.saving), 'sorted from the largest');
  });
  test('S1 → S2 comparison 2026 (Table 2.10)', async () => {
    const c = await loadContext();
    const a = answer("cosa è cambiato rispetto all'S1?", { ev: c.evS2, checks: runChecks(c.evS2), spec: c.spec, evBase: c.evS1 });
    ok(a.text.includes('+1.533,44 SM$'), 'total Δ');
    ok(a.text.includes('from 214,51 SM$ to 4.000,00 SM$'), 'foils');
  });
  test('question not recognized: general summary', async () => {
    const a = await ask('di che colore è la vela?');
    eq(a.understood, false);
    eq(a.blocks[0].id, 'summary');
  });
  test('greeting: Brumoth introduces itself', async () => {
    const a = await ask('ciao Brumoth!');
    eq(a.blocks[0].id, 'help');
    ok(a.text.includes('I am Brumoth'), 'presentazione');
    ok(buildMessages(a)[0].content.includes('You are Brumoth'), 'name in the system prompt');
  });
});

suite('Assistant – local AI', () => {
  test('number check: accepts those in the data (also rounded), flags invented ones', async () => {
    const a = await ask('quanto budget rimane?');
    eq(verifyNumbers('Restano 1.594,43 SM$ (circa 1594), il 84,1% è usato. Nel 2027 sotto i 10.000 SM$.', a.facts).length, 0);
    eq(verifyNumbers('Restano 1594.43 SM$ di margine.', a.facts).length, 0);
    eq(verifyNumbers('Restano circa 1.600 SM$ e lo scafo costa 4.200 SM$.', a.facts).join(), '1.600,4.200');
    eq(verifyNumbers('Vedi §10.1 e la Tab. 2, ci sono 3 voci.', a.facts).length, 0);
  });
  test('messages for the model: instructions, data and question', async () => {
    const a = await ask('quanto budget rimane?');
    const m = buildMessages(a, [{ question: 'ciao', reply: 'Ciao!' }]);
    eq(m[0].role, 'system');
    eq(m.length, 4);
    ok(m[3].content.startsWith('DATA'), 'data before the question');
    ok(m[3].content.includes('QUESTION: quanto budget rimane?'));
  });
});
