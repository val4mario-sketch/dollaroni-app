// Calcolo del layup con le STESSE formule del foglio ufficiale
// "2026_SMC_Composite_Layup_Calculator" (foglio "Composite stacking calculation"):
//
//   I  (Vf)            = Vf del processo scelto (colonna W del template)
//   J  (Wf fibra)      = ρf·Vf / (ρf·Vf + ρm·(1−Vf))              [regola delle miscele]
//   K  (massa fibra g) = area ply [m²] × n. ply × grammatura [g/m²]
//   K+1(massa resina g)= (1−Wf) · massa fibra / Wf
//
// Così i numeri dell'app coincidono con quelli che la giuria ricalcola nel file ufficiale.

import { layupMaterialFor } from './rules-2026.js';

/** Risolve la fibra/matrice di un substack: voce di listino + materiale del calcolatore + densità. */
function resolveMaterial(spec, catalog, ref, role) {
  const entry = catalog.get(ref);
  if (!entry) return { ref, error: `Materiale "${ref}" non presente nel listino` };
  const map = layupMaterialFor(entry);
  const options = role === 'reinforcement' ? spec.reinforcements : spec.matrices;
  const opt = map.calc ? options.find((o) => o.name === map.calc) : null;
  const density = opt ? opt.density : map.density;
  if (!density) return { ref, entry, error: `Densità sconosciuta per "${entry.name}"` };
  return { ref, entry, calc: opt || null, density, carbon: map.carbon, inCalculator: Boolean(opt) };
}

export function computeSubstack(spec, catalog, s) {
  const errors = [];
  const reinforcement = resolveMaterial(spec, catalog, s.reinforcement, 'reinforcement');
  const matrix = resolveMaterial(spec, catalog, s.matrix, 'matrix');
  if (reinforcement.error) errors.push(reinforcement.error);
  if (matrix.error) errors.push(matrix.error);
  const process = spec.processes.find((p) => p.name === String(s.process).trim());
  if (!process) errors.push(`Processo "${s.process}" non previsto dal Layup Calculator`);

  const area = Number(s.plyArea) || 0;
  const plies = Number(s.plies) || 0;
  const gsm = Number(s.arealWeight) || 0;
  if (errors.length) return { input: s, reinforcement, matrix, process, errors, fibre: 0, resin: 0, total: 0 };

  const vf = process.vf;
  const rf = reinforcement.density;
  const rm = matrix.density;
  const wf = (rf * vf) / (rf * vf + rm * (1 - vf));
  const fibre = area * plies * gsm;
  const resin = fibre === 0 ? 0 : ((1 - wf) * fibre) / wf;
  return {
    input: s, reinforcement, matrix, process, errors,
    vf, wf, fibre, resin, total: fibre + resin,
    inCalculator: reinforcement.inCalculator && matrix.inCalculator,
  };
}

/**
 * Risultato di una parte laminata.
 * Masse in grammi, come nel calcolatore. carbon: masse di carbonio per fonte (virgin/recycled/upcycled).
 */
export function computePart(spec, catalog, part) {
  const substacks = (part.substacks || []).map((s) => computeSubstack(spec, catalog, s));
  const composite = substacks.reduce((a, r) => a + r.total, 0);
  const fibres = substacks.reduce((a, r) => a + r.fibre, 0);
  const resin = composite - fibres;
  for (const r of substacks) {
    r.shareFibre = composite ? r.fibre / composite : 0; // colonna L, riga fibra
    r.shareResin = composite ? r.resin / composite : 0; // colonna L, riga resina
    r.share = r.shareFibre + r.shareResin; //               colonna M
  }

  const carbon = {};
  for (const r of substacks) {
    if (!r.reinforcement?.carbon) continue;
    const src = r.input.carbonSource || (r.input.reinforcementSource === 'upcycled' ? 'upcycled' : 'virgin');
    const c = (carbon[src] ||= { cf: 0, cfrp: 0 });
    c.cf += r.fibre;
    c.cfrp += r.fibre + r.resin;
  }

  return {
    part, substacks,
    errors: substacks.flatMap((r) => r.errors),
    totals: {
      composite, fibres, resin,
      fibresPct: composite ? fibres / composite : 0,
      resinPct: composite ? resin / composite : 0,
    },
    carbon,
    inCalculator: substacks.every((r) => r.inCalculator),
  };
}

/** Somma per materiale (per le righe di costo): {`${role}|${ref}|${source}`: grammi}. */
export function partMaterialMasses(result) {
  const out = [];
  const add = (role, ref, source, grams) => {
    const hit = out.find((o) => o.role === role && o.ref === ref && o.source === source);
    if (hit) hit.grams += grams;
    else out.push({ role, ref, source, grams });
  };
  for (const r of result.substacks) {
    if (r.errors.length) continue;
    add('reinforcement', r.input.reinforcement, r.input.reinforcementSource || 'new', r.fibre);
    add('matrix', r.input.matrix, r.input.matrixSource || 'new', r.resin);
  }
  return out;
}
