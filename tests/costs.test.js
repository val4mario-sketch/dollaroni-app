// Golden test sui SuMoth Dollars: Tabella 2 del report S1 e tabelle 2.1–2.10 del docx S2.

import { suite, test, eq, close, ok, cents } from './lib.js';
import { loadContext } from './context.js';
import { s1CostTable, s2ComponentTables, s2Summary, compareStages } from '../src/engine/reports.js';

suite('Listino ufficiale 2026', () => {
  test('prezzi chiave letti dal file Standardized Costs', async () => {
    const { catalogEntries: c } = await loadContext();
    const price = (id) => c.find((e) => e.id === id)?.price;
    eq(price('dry-fabric-carbon-fibers/int-modulus-cf'), 200);
    eq(price('dry-fabric-basalt-fibers'), 0);
    eq(price('std-epoxy/lamination-resin'), 25);
    eq(price('pet/recycled'), 0);
    eq(price('pvc-san'), 5000);
    eq(price('machining'), 40);
    eq(price('additive-manuf'), 10);
    eq(price('vari/spray-tack'), 20, 'prezzo scritto come testo "SM$ 20"');
  });
  test('segnala sughero senza prezzo e acciaio con due prezzi', async () => {
    const { catalogWarnings: w } = await loadContext();
    ok(w.some((x) => x.includes('Cork')), 'manca avviso Cork');
    ok(w.some((x) => x.includes('Steel')), 'manca avviso Steel');
  });
});

suite('S1 2026 – Tabella 2 "SuMoth Dollar breakdown"', () => {
  test('totale 8,422.44 SM$', async () => {
    const { evS1 } = await loadContext();
    eq(cents(evS1.total), 8422.44);
    eq(s1CostTable(evS1).rows.length, 31);
  });
  test('righe con sconti e lavorazioni come nel report', async () => {
    const { evS1 } = await loadContext();
    const row = (id) => evS1.lines.find((l) => l.id === id);
    eq(row('hull-mould').total, 5200, 'stampo MDF 190 kg + CNC 35 h');
    eq(row('hull-reinf').total, 400, 'oven cure 20 h');
    eq(row('hull-matrix').material.unitPrice, 12.5, 'epossidica scaduta −50%');
    eq(cents(row('foils-reinf-2').total), 174.2, 'carbonio IM scaduto 100 SM$/kg');
    eq(cents(row('foils-matrix').total), 40.31);
    eq(cents(row('rig-fittings').total), 180);
  });
  test('totali per componente usati nel confronto S2 (Tab. 2.10)', async () => {
    const { evS1 } = await loadContext();
    const t = Object.fromEntries(evS1.components.map((c) => [c.id, cents(c.total)]));
    eq(t.hull, 5965.76); eq(t.foils, 214.51); eq(t.mechanical_control, 180);
    eq(t.wingbars, 110.97); eq(t.rig, 1951.2); eq(t.gantry, 0); eq(t.electronics, 0);
  });
});

suite('S2 2026 – tabelle 2.1–2.9 del docx', () => {
  const expected = { hull: 3697.99, foils: 4000, mechanical_control: 237.5, gantry: 0, wingbars: 84.44, rig: 1842.95, electronics: 93 };
  for (const [id, v] of Object.entries(expected)) {
    test(`${id}: ${v} SM$`, async () => {
      const { evS2 } = await loadContext();
      eq(cents(evS2.components.find((c) => c.id === id).total), v);
    });
  }
  test('totale 9,955.88 SM$ e margine 44.12 SM$', async () => {
    const { evS2 } = await loadContext();
    eq(cents(evS2.total), 9955.88);
    eq(cents(evS2.margin), 44.12);
    close(s2Summary(evS2).share, 0.996, 0.0005);
  });
  test('handicap foil pre-2015: −600 punti', async () => {
    const { evS2 } = await loadContext();
    eq(evS2.handicap, -600);
  });
  test('tabella Hull: 17 righe (MDF e CNC separati) e note automatiche sugli sconti', async () => {
    const { evS2, rules } = await loadContext();
    const hull = s2ComponentTables(evS2, rules).find((t) => t.component === 'hull');
    eq(hull.rows.length, 17);
    eq(hull.rows[0].item, 'MDF (mould blocks)');
    eq(hull.rows[1].item, 'CNC Machining (mould milling)');
    eq(hull.rows[1].quantity, '30 h');
    ok(hull.rows.find((r) => r.item.startsWith('Epoxy resin (hull matrix) – OOSL ⁽')), 'etichetta OOSL con nota');
    ok(hull.footnotes.some((f) => f.includes('25.00 → 12.50 SM$/kg')), 'nota con prezzo scontato');
    eq(hull.rows.find((r) => r.item.startsWith('Tacky tape')).quantity, '3 × 15 m roll');
  });
});

suite('S2 2026 – confronto con S1 (Tab. 2.10)', () => {
  test('delta e variazioni come nel docx', async () => {
    const { evS1, evS2 } = await loadContext();
    const cmp = compareStages(evS1, evS2);
    const r = Object.fromEntries(cmp.rows.map((x) => [x.component, x]));
    eq(cents(r.Hull.delta), -2267.77); close(r.Hull.variation, -0.380, 0.0005);
    eq(cents(r.Foils.delta), 3785.49); close(r.Foils.variation, 17.647, 0.001);
    eq(cents(r['Mechanical Control System'].delta), 57.5); close(r['Mechanical Control System'].variation, 0.319, 0.0005);
    eq(cents(r.Wingbars.delta), -26.53); close(r.Wingbars.variation, -0.239, 0.0005);
    eq(cents(r.Rig.delta), -108.25); close(r.Rig.variation, -0.055, 0.0005);
    ok(r.Gantry.isNew && r.Electronics.isNew, 'Gantry ed Electronics nuove rispetto a S1');
    eq(cents(cmp.total.delta), 1533.44); close(cmp.total.variation, 0.182, 0.0005);
  });
});
