// Golden test: il motore deve dare, al grammo, i numeri dell'Appendice G del report S1 2026
// (screenshot del Layup Calculator ufficiale compilato dal team).

import { suite, test, eq, close, g } from './lib.js';
import { loadContext } from './context.js';

// [fibra g, resina g] per substack e totali [composito, fibre, resina], letti dall'Appendice G.
const APPENDIX_G = {
  hull: { subs: [[5436, 4003]], totals: [9439, 5436, 4003], fibrePct: 0.5759 },
  'wing-panel': { subs: [[4625, 3406]], totals: [8031, 4625, 3406] },
  'wing-frame': { subs: [[2532, 1865]], totals: [4397, 2532, 1865] },
  bulkheads: { subs: [[488, 359], [366, 270]], totals: [1483, 854, 629] },
  'main-vertical': { subs: [[131, 158], [540, 652], [432, 318], [288, 212], [390, 287]], totals: [3409, 1781, 1627], fibrePct: 0.5226 },
  'rudder-horizontal': { subs: [[88, 106], [48, 58], [34, 41], [32, 39], [18, 22]], totals: [486, 220, 266] },
  'rudder-vertical': { subs: [[100, 121], [300, 362], [384, 186], [240, 116]], totals: [1809, 1024, 785] },
  'main-horizontal': { subs: [[75, 91], [144, 174], [99, 119], [84, 101], [51, 62]], totals: [1000, 453, 547] },
};

suite('Layup Calculator – Appendice G S1 2026', () => {
  for (const [id, exp] of Object.entries(APPENDIX_G)) {
    test(`${id}: masse per substack e totali al grammo`, async () => {
      const { evS1 } = await loadContext();
      const pr = evS1.parts.find((p) => p.part.id === id);
      eq(pr.errors.length, 0, 'errori nel pezzo');
      eq(pr.substacks.length, exp.subs.length, 'numero substack');
      exp.subs.forEach(([f, r], i) => {
        eq(g(pr.substacks[i].fibre), f, `substack ${'ABCDE'[i]} fibra`);
        eq(g(pr.substacks[i].resin), r, `substack ${'ABCDE'[i]} resina`);
      });
      eq(g(pr.totals.composite), exp.totals[0], 'Total Composite (g)');
      eq(g(pr.totals.fibres), exp.totals[1], 'Total Fibers (g)');
      eq(g(pr.totals.resin), exp.totals[2], 'Total Resin (g)');
      if (exp.fibrePct) close(pr.totals.fibresPct, exp.fibrePct, 0.00005, 'Total Fibers (%)');
    });
  }

  test('frazioni in peso come nel foglio: basalto 57.6%, carbonio 45.3%, basalto in infusione 67.4%', async () => {
    const { evS1 } = await loadContext();
    const wf = (id, i) => evS1.parts.find((p) => p.part.id === id).substacks[i].wf;
    close(wf('hull', 0), 0.576, 0.0005);
    close(wf('main-vertical', 0), 0.453, 0.0005);
    close(wf('rudder-vertical', 2), 0.674, 0.0005);
  });
});

suite('Limiti di carbonio (Tab. 2) sui foil S1 2026', () => {
  test('main vertical: CF secco 0.671 kg su 0.75, CFRP 1.481 kg su 1.50', async () => {
    const { evS1 } = await loadContext();
    const mv = evS1.carbon.find((c) => c.id === 'main_vertical').checks;
    close(mv.find((c) => c.key === 'cf').value, 0.6712, 0.0000001);
    close(mv.find((c) => c.key === 'cfrp').value, 1.4810822, 0.0000001);
  });
  test('main horizontal: CFRP 1000.04 g, sopra il limite di 1.00 kg per 0.04 g', async () => {
    const { evS1 } = await loadContext();
    const mh = evS1.carbon.find((c) => c.id === 'main_horizontal').checks.find((c) => c.key === 'cfrp');
    close(mh.value, 1.0000394, 0.0000001);
  });
});
