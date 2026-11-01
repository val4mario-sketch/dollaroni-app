// Errori silenziosi nei conti e protezione dei dati: controlli, validazione dei file, salvataggio.

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
  const ctx = { spec: c.spec, catalogEntries: c.catalogEntries, rules: RULES_2027 };
  return { project, ctx, run: (p) => { const ev = evaluate(p, ctx); return { ev, checks: runChecks(ev) }; } };
}

const has = (checks, code, target) => checks.some((x) => x.code === code && (target === undefined || x.target === target));

/** File finto con la stessa interfaccia di FileSystemFileHandle. */
function fakeHandle(lastModified) {
  const h = {
    name: 'prova.dollaroni.json', lastModified, text: 'originale',
    getFile: async () => ({ lastModified: h.lastModified }),
    createWritable: async () => ({ write: async (t) => { h.text = t; }, close: async () => { h.lastModified += 1000; } }),
  };
  return h;
}

suite('Errori silenziosi nei conti', () => {
  test('il carbonio su una voce a mano viene segnalato perché resta fuori dalla Tab. 2', async () => {
    const { project: p, run } = await base();
    const before = run(p).ev.carbon.reduce((a, g) => a + g.checks[0].value, 0);
    eq(has(run(p).checks, 'manual-carbon'), false, 'Meravijosa non ha carbonio a mano');
    p.lines.push({ id: 't1', component: 'foils', name: 'Carbonio a mano', material: { ref: CARBON, qty: 50, source: 'new' } });
    const r = run(p);
    ok(has(r.checks, 'manual-carbon', 't1'), 'manca avviso manual-carbon');
    close(r.ev.carbon.reduce((a, g) => a + g.checks[0].value, 0), before, 1e-9, 'i limiti restano calcolati solo dai pezzi');
  });
  test('carbonio su voce libera sì, carbonio collegato al layup no', async () => {
    const { project: p, run } = await base();
    p.lines.push({ id: 't2', component: 'rig', name: 'Tubo', material: { name: 'Carbon scrap', unit: 'kg', qty: 1, price: 40, priceSource: 'x' } });
    p.lines.push({ id: 't3', component: 'hull', name: 'Dal layup', material: { ref: CARBON, source: 'new', fromLayup: { parts: ['hull'], kind: 'fibre' } } });
    const c = run(p).checks;
    ok(has(c, 'manual-carbon', 't2'), 'voce libera');
    eq(has(c, 'manual-carbon', 't3'), false, 'voce collegata al layup');
    eq(has(c, 'manual-carbon', 'mast'), false, 'albero upcycled già fatto, in pc');
  });
  test('voci a costo zero dimenticate, ma non i prezzi 0 del listino né gli upcycled', async () => {
    const { project: p, run } = await base();
    const add = (type, id, patch = {}) => { const l = newLine(type, 'rig', RULES_2027); l.id = id; if (patch.material) Object.assign(l.material, patch.material); p.lines.push(l); };
    add('hardware', 'hw0');
    add('process', 'proc0');
    add('material', 'qty0');
    add('upcycled', 'upc', { material: { name: 'Vecchio albero' } });
    p.lines.push({ id: 'pet', component: 'rig', name: 'PET riciclato', material: { ref: 'pet/recycled', qty: 2, source: 'new' } });
    const c = run(p).checks;
    for (const id of ['hw0', 'proc0', 'qty0']) ok(has(c, 'zero-cost', id), `manca zero-cost su ${id}`);
    eq(has(c, 'zero-cost', 'upc'), false, 'upcycled a 0 SM$ è previsto');
    eq(has(c, 'zero-cost', 'pet'), false, 'il PET riciclato costa 0 da listino');
  });
  test('i valori negativi sono errori', async () => {
    const { project: p, run } = await base();
    p.lines.push({ id: 'neg', component: 'rig', name: 'Neg', material: { ref: CARBON, qty: -10, source: 'new' } });
    p.lines.push({ id: 'negh', component: 'rig', name: 'NegH', process: { ref: 'machining', hours: -2 } });
    p.parts[0].substacks[0].plies = -4;
    const c = run(p).checks;
    ok(c.some((x) => x.level === 'error' && x.code === 'negative' && x.target === 'neg'), 'quantità');
    ok(c.some((x) => x.level === 'error' && x.code === 'negative' && x.target === 'negh'), 'ore');
    ok(c.some((x) => x.level === 'error' && x.code === 'negative' && x.target === p.parts[0].id), 'strati');
    eq(has(c, 'waste-over', 'neg'), false, 'niente avviso scarti fuorviante');
  });
  test('gli id duplicati sono errori', async () => {
    const { project: p, run } = await base();
    eq(has(run(p).checks, 'duplicate-id'), false, 'nessun duplicato nei dati buoni');
    p.lines.push({ ...p.lines[0] });
    p.parts.push({ ...p.parts[0] });
    const c = run(p).checks;
    ok(c.some((x) => x.level === 'error' && x.code === 'duplicate-id' && x.target === p.lines[0].id), 'voce');
    ok(c.some((x) => x.level === 'error' && x.code === 'duplicate-id' && x.target === p.parts[0].id), 'pezzo');
  });
  test('un foil nuovo chiede quale gruppo della Tab. 2 usare', async () => {
    const { project: p, run } = await base();
    eq(DEFAULT_GROUPS.foils.limitGroup, null);
    const foil = newPart('foils');
    p.parts.push(foil);
    ok(has(run(p).checks, 'foil-group', foil.id), 'manca avviso');
    foil.limitGroup = 'main_horizontal';
    eq(has(run(p).checks, 'foil-group', foil.id), false, 'scelto il gruppo, niente avviso');
  });
  test('sconti da confermare: totale e margine senza sconti', async () => {
    const { project: p, run } = await base();
    const w = run(p).checks.find((x) => x.code === 'discount-unconfirmed');
    ok(w.message.includes('8.760,92 SM$'), 'totale senza sconti: ' + w.message); // 8.422,36 + 338,56
    ok(w.message.includes('il margine scenderebbe a 1.239,08 SM$'), w.message);
    p.lines.push({ id: 'caro', component: 'rig', name: 'Caro', material: { name: 'Caro', unit: 'pc', qty: 1, price: 1400, priceSource: 'x' } });
    ok(run(p).checks.find((x) => x.code === 'discount-unconfirmed').message.includes('sforeresti il budget di 160,92 SM$'), 'caso peggiore oltre budget');
  });
  test('i dati 2026 restano senza errori nuovi e con i totali golden', async () => {
    const { evS1, evS2 } = await loadContext();
    close(evS1.total, 8422.44, 0.01, 'S1');
    close(evS2.total, 9955.88, 0.01, 'S2');
    eq(runChecks(evS2).filter((x) => x.level === 'error').length, 0, 'errori S2');
    eq(runChecks(evS1).filter((x) => ['negative', 'duplicate-id', 'foil-group'].includes(x.code)).length, 0, 'errori S1');
  });
});

suite('File progetto e salvataggio', () => {
  const minimal = (extra) => ({ schema: 'dollaroni/1', ...extra });
  const rejects = (project, text) => {
    try {
      validateProject(project);
    } catch (e) {
      ok(e.message.includes(text), `messaggio inatteso: ${e.message}`);
      return;
    }
    throw new Error(`il file doveva essere rifiutato (${text})`);
  };

  test('validateProject accetta gli esempi e completa gli elenchi mancanti', async () => {
    const { s1, s2 } = await loadContext();
    validateProject(structuredClone(s1));
    validateProject(structuredClone(s2));
    const p = validateProject(minimal());
    eq(p.parts.length + p.lines.length + p.catalogExtras.length, 0);
  });
  test('validateProject rifiuta righe nulle e tipi errati con un messaggio chiaro', () => {
    rejects(minimal({ lines: [null] }), 'voci n. 1');
    rejects(minimal({ lines: 'no' }), 'elenco');
    rejects(minimal({ lines: [{ id: 'a', name: 'Bozzelli', material: { qty: '3' } }] }), 'Voce "Bozzelli": "qty"');
    rejects(minimal({ lines: [{ id: 'a', process: { hours: 'tante' } }] }), '"hours"');
    rejects(minimal({ parts: [{ id: 'a', name: 'Hull', substacks: [{ plies: '4' }] }] }), 'Pezzo "Hull", substack n. 1');
    rejects(minimal({ parts: [{ id: 'a', name: 'Hull', substacks: 3 }] }), 'substacks');
    rejects(minimal({ baseline: { project: minimal({ lines: [null] }) } }), 'voci n. 1');
    rejects(minimal({ budget: '10000' }), '"budget"');
  });
  test('il salvataggio non sovrascrive un file cambiato senza conferma', async () => {
    const h = fakeHandle(2000);
    let asked = 0;
    const no = await saveProjectFile(minimal(), h, { knownModified: 1000, confirmOverwrite: () => { asked += 1; return false; } });
    eq(no, null, 'rifiutato');
    eq(asked, 1);
    eq(h.text, 'originale', 'file intatto');
    const yes = await saveProjectFile(minimal(), h, { knownModified: 1000, confirmOverwrite: () => true });
    ok(h.text.includes('dollaroni/1'), 'scritto dopo la conferma');
    eq(yes.lastModified, 3000, 'data aggiornata dopo il salvataggio');
  });
  test('il salvataggio non chiede niente se il file non è cambiato', async () => {
    const h = fakeHandle(1000);
    const r = await saveProjectFile(minimal(), h, { knownModified: 1000, confirmOverwrite: () => { throw new Error('non doveva chiedere'); } });
    ok(r && h.text.includes('dollaroni/1'));
    const second = await saveProjectFile(minimal(), h, { knownModified: r.lastModified, confirmOverwrite: () => { throw new Error('secondo salvataggio'); } });
    ok(second, 'il nostro salvataggio non conta come modifica di altri');
  });
  test('lavoro non salvato: né uguale al file né appena aperto', () => {
    const p = minimal({ name: 'A' });
    const json = serialize(p);
    eq(hasUnsavedWork(null, null, null), false, 'nessun progetto');
    eq(hasUnsavedWork(p, json, null), false, 'uguale al file');
    eq(hasUnsavedWork(p, null, json), false, 'esempio appena aperto');
    eq(hasUnsavedWork({ ...p, name: 'B' }, json, json), true, 'modificato');
    eq(hasUnsavedWork(p, null, null), true, 'autosave vecchio senza informazioni: si protegge');
  });
  test('la copia di recupero conserva il progetto', () => {
    const previous = localStorage.getItem('dollaroni.recovery.v1');
    try {
      ok(saveRecoveryCopy({ project: minimal({ name: 'Da salvare' }), fileName: 'x.json' }));
      const r = loadRecoveryCopy();
      eq(r.project.name, 'Da salvare');
      eq(r.fileName, 'x.json');
      ok(r.keptAt, 'data della copia');
      clearRecoveryCopy();
      eq(loadRecoveryCopy(), null);
    } finally {
      if (previous) localStorage.setItem('dollaroni.recovery.v1', previous);
    }
  });
});
