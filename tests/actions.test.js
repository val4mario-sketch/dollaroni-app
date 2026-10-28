// Brumoth: modifiche al progetto con Applica/Annulla, richieste troppo generiche, istruzioni sull'app.

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
/** Applica l'azione a una copia del progetto e la valuta. */
async function applied(action) {
  const { project, base } = await setup();
  const d = structuredClone(project);
  action.apply(d);
  return { d, ev: evaluate(d, base) };
}

suite('Brumoth – modifiche con Applica/Annulla', () => {
  test('richiesta troppo generica: lo dice e non propone modifiche', async () => {
    const a = await ask('aggiungi carbonio');
    eq(a.actions.length, 0);
    ok(a.text.includes('troppo generica'), 'avviso');
    ok(a.text.includes('la quantità') && a.text.includes('in quale pezzo'), 'dice cosa manca');
    const b = await ask('aggiungi 15 kg di carbonio');
    eq(b.actions.length, 0);
    ok(b.text.includes('in quale pezzo'), 'manca solo il pezzo');
  });
  test('aggiungi 2 kg di carbonio allo scafo: nuovo substack, limiti Tab. 2 nell\'anteprima', async () => {
    const { ev } = await setup();
    const a = await ask('aggiungi 2 kg di carbonio allo scafo');
    eq(a.actions.length, 1);
    eq(a.actions[0].type, 'addFibre');
    eq(a.noLLM, true);
    const { ev: ev2 } = await applied(a.actions[0]);
    const fibre = (e) => e.parts.find((p) => p.part.id === 'hull').totals.fibres;
    close(fibre(ev2) - fibre(ev), 2000, 0.01, '+2000 g di fibra');
    close(a.actions[0].preview.after.total, ev2.total, 0.005, 'anteprima = progetto applicato');
    ok(a.actions[0].preview.problems.some((p) => p.message.includes('Hull') && p.level === 'error'), 'avvisa del limite di carbonio');
  });
  test('fai la deriva in basalto: stessa cifra della simulazione', async () => {
    const { ev } = await setup();
    const a = await ask('fai la deriva in basalto');
    eq(a.actions[0].type, 'swapFibre');
    close(a.actions[0].preview.after.total - ev.total, -71.06, 0.01);
    const w = await ask('e se facessi la deriva in basalto?');
    eq(w.actions.length, 1, 'anche la simulazione propone Applica');
  });
  test('materiale nuovo nel listino e nuovo pezzo', async () => {
    const m = await ask('aggiungi il materiale "Carbon/Innegra" a 160 SM$/kg con densità 1,3');
    eq(m.actions[0].type, 'addMaterial');
    const { d } = await applied(m.actions[0]);
    const x = d.catalogExtras.find((e) => e.name === 'Carbon/Innegra');
    ok(x, 'voce del team creata');
    eq(x.kind, 'reinforcement'); eq(x.price, 160); eq(x.density, 1.3); eq(x.unit, 'kg');
    const p = await ask('crea un pezzo chiamato Timone di riserva nei foil');
    eq(p.actions[0].type, 'addPart');
    const { d: d2 } = await applied(p.actions[0]);
    const part = d2.parts.find((q) => q.name === 'Timone di riserva');
    ok(part, 'pezzo creato');
    eq(part.component, 'foils'); eq(part.limitGroup, 'rudder_vertical'); eq(part.autoLines, true);
  });
  test('la domanda dell\'utente: istruzioni + pezzo Terrazze, e per il materiale chiede prezzo e densità', async () => {
    const a = await ask("voglio fare una sezione chiamata terrazze e aggiungere il carbo innegra che è un materiale che non c'è come faccio?");
    eq(a.intents[0], 'howto');
    ok(a.text.includes('Nuovo pezzo') && a.text.includes('Aggiungi voce'), 'passaggi con i nomi dei pulsanti');
    eq(a.actions.length, 1);
    eq(a.actions[0].type, 'addPart');
    ok(a.actions[0].title.includes('Terrazze'));
    ok(a.text.includes('carbo innegra') && a.text.includes('prezzo') && a.text.includes('densità'), 'chiede cosa manca');
  });
  test('eliminare un pezzo; le domande normali restano domande', async () => {
    const a = await ask('elimina il pezzo bulkheads');
    eq(a.actions[0].type, 'removePart');
    const { d } = await applied(a.actions[0]);
    ok(!d.parts.some((p) => p.id === 'bulkheads'));
    eq((await ask('fammi la classificazione dei costi')).intents[0], 'ranking');
    eq((await ask('quanto budget ci rimane?')).actions.length, 0);
    const h = await ask('come faccio a esportare il report?');
    eq(h.intents[0], 'howto');
    ok(h.text.includes('Esporta S1'));
  });
});
