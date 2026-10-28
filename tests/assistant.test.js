// Assistente: argomenti riconosciuti, numeri delle risposte (presi dal motore) e controllo dei numeri dell'IA.

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
  const base = { spec: c.spec, catalogEntries: c.catalogEntries, rules: RULES_2027 };
  const ev = evaluate(project, base);
  cache = { c, project, base, ev, ctx: { ev, checks: runChecks(ev), spec: c.spec } };
  return cache;
}
const ask = async (q, extra = {}) => {
  const { ctx } = await ctx2027();
  return answer(q, { ...ctx, ...extra });
};

suite('Assistente – argomenti e numeri', () => {
  test('capisce di cosa parla la domanda', async () => {
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
  test('domanda di seguito: "e lo scafo?" riusa l\'argomento precedente', async () => {
    const { ev } = await ctx2027();
    const prev = route('quanto pesa la deriva?', { ev });
    eq(prev.intents[0].id, 'parts');
    const r = route('e lo scafo?', { ev, previous: prev });
    eq(r.intents[0].id, 'parts');
    eq(r.entities.parts[0].part.name, 'Hull');
  });
  test('budget: totale e margine del motore (Meravijosa portata al 2027)', async () => {
    const a = await ask('quanto budget rimane?');
    ok(a.text.includes('8.422,36 SM$'), 'totale');
    ok(a.text.includes('Restano 1.577,64 SM$'), 'margine');
    ok(a.text.includes('−500 punti'), 'penalità 2027');
    ok(a.text.includes('338,56 SM$ di sconti'), 'sconti da confermare');
  });
  test('capienza: carbonio comprabile col margine e limiti Tab. 2', async () => {
    const a = await ask('quanto carbonio serve per finire il budget? dove ce ne è troppo?');
    eq(a.intents.join(), 'capacity,carbon');
    ok(a.text.includes('circa 10,52 kg'), 'carbonio secco 1577,64/150');
    ok(a.text.includes('1,21 kg di resina'), 'resina per kg di fibra a Vf 35%');
    ok(a.text.includes('9,15 kg di CFRP'), 'spazio CFRP rimasto');
    ok(a.text.includes('i limiti fermano prima'), 'il limite arriva prima del budget');
    ok(a.text.includes('Main Horizontal (CFRP, 0,04 g oltre il limite)'), 'main horizontal oltre di 0,04 g');
  });
  test('simulazione: la deriva in basalto, uguale al ricalcolo completo del progetto', async () => {
    const { ev, project, base, c } = await ctx2027();
    const a = await ask('e se facessi la deriva in basalto?');
    ok(a.text.includes('Main vertical'), 'pezzo');
    const sims = simulateSwap(ev, { spec: c.spec }, ev.parts.filter((p) => p.part.id === 'main-vertical'), findMaterials('carbonio')[0], findMaterials('basalto')[0]);
    eq(sims.length, 1);
    const p2 = structuredClone(project);
    for (const s of p2.parts.find((p) => p.id === 'main-vertical').substacks) { s.reinforcement = 'dry-fabric-basalt-fibers'; delete s.carbonSource; }
    const ev2 = evaluate(p2, base);
    close(sims[0].delta, ev2.total - ev.total, 0.005, 'Δ simulato = Δ del progetto ricalcolato');
    ok(sims[0].delta < 0, 'il basalto costa meno');
  });
  test('idee di risparmio: MDF riciclato e carbonio -> basalto', async () => {
    const { ev, c } = await ctx2027();
    const ideas = savingIdeas(ev, { spec: c.spec });
    const mdf = ideas.find((x) => x.kind === 'recycled' && x.target === 'hull-mould');
    ok(mdf, 'manca MDF riciclato');
    close(mdf.saving, 1900, 0.005, '190 kg × (20 − 10)');
    ok(ideas.some((x) => x.kind === 'basalt'), 'manca carbonio -> basalto');
    ok(ideas.every((x, i) => i === 0 || ideas[i - 1].saving >= x.saving), 'ordinate dalla più grande');
  });
  test('confronto S1 → S2 2026 (Tab. 2.10)', async () => {
    const c = await loadContext();
    const a = answer("cosa è cambiato rispetto all'S1?", { ev: c.evS2, checks: runChecks(c.evS2), spec: c.spec, evBase: c.evS1 });
    ok(a.text.includes('+1.533,44 SM$'), 'Δ totale');
    ok(a.text.includes('da 214,51 SM$ a 4.000,00 SM$'), 'foils');
  });
  test('domanda non riconosciuta: riepilogo generale', async () => {
    const a = await ask('di che colore è la vela?');
    eq(a.understood, false);
    eq(a.blocks[0].id, 'summary');
  });
  test('saluto: Brumoth si presenta', async () => {
    const a = await ask('ciao Brumoth!');
    eq(a.blocks[0].id, 'help');
    ok(a.text.includes('Sono Brumoth'), 'presentazione');
    ok(buildMessages(a)[0].content.includes('Sei Brumoth'), 'nome nel prompt di sistema');
  });
});

suite('Assistente – IA locale', () => {
  test('controllo dei numeri: accetta quelli dei dati (anche arrotondati), segnala gli inventati', async () => {
    const a = await ask('quanto budget rimane?');
    eq(verifyNumbers('Restano 1.577,64 SM$ (circa 1578), il 84,2% è usato. Nel 2027 sotto i 10.000 SM$.', a.facts).length, 0);
    eq(verifyNumbers('Restano 1577.64 SM$ di margine.', a.facts).length, 0);
    eq(verifyNumbers('Restano circa 1.600 SM$ e lo scafo costa 4.200 SM$.', a.facts).join(), '1.600,4.200');
    eq(verifyNumbers('Vedi §10.1 e la Tab. 2, ci sono 3 voci.', a.facts).length, 0);
  });
  test('messaggi per il modello: istruzioni, dati e domanda', async () => {
    const a = await ask('quanto budget rimane?');
    const m = buildMessages(a, [{ question: 'ciao', reply: 'Ciao!' }]);
    eq(m[0].role, 'system');
    eq(m.length, 4);
    ok(m[3].content.startsWith('DATI'), 'dati prima della domanda');
    ok(m[3].content.includes('DOMANDA: quanto budget rimane?'));
  });
});
