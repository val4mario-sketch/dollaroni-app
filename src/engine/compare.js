// Confronto tra la stima S1 congelata e il progetto S2 (as-built), e dati per l'autovalutazione (S2 §2.4).
// Le voci si abbinano per id: quando l'S2 nasce da "Congela S1 e crea S2" gli id restano gli stessi.

const G_PER_KG = 1000;

/** Voce per voce: [{id, name, component, kind: new|removed|changed|same, s1, s2, delta, qty1, qty2, unit}] ordinate per |Δ|. */
export function compareItems(evS1, evS2) {
  const a = new Map(evS1.lines.map((l) => [l.id, l]));
  const b = new Map(evS2.lines.map((l) => [l.id, l]));
  const ids = [...new Set([...a.keys(), ...b.keys()])];
  const qty = (l) => (l?.material ? l.material.qty : l?.process ? l.process.hours : l?.usedPart ? 1 : null);
  const unit = (l) => (l?.material ? l.material.unit : l?.process ? 'h' : l?.usedPart ? 'pc' : '');
  const rows = ids.map((id) => {
    const x = a.get(id);
    const y = b.get(id);
    const s1 = x ? x.total : null;
    const s2 = y ? y.total : null;
    const delta = (s2 ?? 0) - (s1 ?? 0);
    const q1 = qty(x);
    const q2 = qty(y);
    const changedQty = x && y && q1 !== null && q2 !== null && Math.abs(q1 - q2) > 1e-9;
    const kind = !x ? 'new' : !y ? 'removed' : Math.abs(delta) > 0.005 || changedQty ? 'changed' : 'same';
    const ref = y || x;
    return {
      id, kind, s1, s2, delta, qty1: q1, qty2: q2, unit: unit(ref),
      name: ref.line.s2Label || ref.name, component: ref.component, auto: Boolean(ref.line.auto),
    };
  });
  return rows.sort((p, q) => Math.abs(q.delta) - Math.abs(p.delta));
}

/** Pezzo per pezzo: massa calcolata in S1 e in S2. */
export function compareParts(evS1, evS2) {
  const a = new Map(evS1.parts.map((p) => [p.part.id, p]));
  const b = new Map(evS2.parts.map((p) => [p.part.id, p]));
  return [...new Set([...a.keys(), ...b.keys()])].map((id) => {
    const x = a.get(id);
    const y = b.get(id);
    return {
      id, name: (y || x).part.name,
      kind: !x ? 'new' : !y ? 'removed' : 'both',
      mass1: x ? x.computedMass : null, mass2: y ? y.computedMass : null,
      weighed: y ? y.measuredMass : null,
    };
  });
}

/** Quanta parte del costo è già misurata (as-built) e quanta ancora stimata, per componente. */
export function costingBasis(ev) {
  const rows = ev.components.map((c) => {
    let measured = 0;
    let estimated = 0;
    let nEst = 0;
    for (const l of c.lines) {
      if (l.status === 'measured') measured += l.total;
      else { estimated += l.total; nEst += 1; }
    }
    return { component: c.id, en: c.en, it: c.it, measured, estimated, total: c.total, estimatedCount: nEst, count: c.lines.length };
  });
  const measured = rows.reduce((s, r) => s + r.measured, 0);
  const estimated = rows.reduce((s, r) => s + r.estimated, 0);
  return {
    rows, measured, estimated,
    share: measured + estimated > 0 ? measured / (measured + estimated) : 0,
    estimatedCount: rows.reduce((s, r) => s + r.estimatedCount, 0),
    count: rows.reduce((s, r) => s + r.count, 0),
  };
}

/** Pezzi con peso reale inserito: massa calcolata dal Layup Calculator contro massa pesata. */
export function weighedParts(ev) {
  return ev.parts
    .filter((p) => p.measuredMass !== null)
    .map((p) => ({
      id: p.part.id, name: p.part.name, computed: p.computedMass, weighed: p.measuredMass,
      delta: p.measuredMass - p.computedMass,
      ratio: p.computedMass > 0 ? (p.measuredMass - p.computedMass) / p.computedMass : null,
    }));
}

export { G_PER_KG };
