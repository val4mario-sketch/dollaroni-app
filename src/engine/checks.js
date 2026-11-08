// Automatic checks on the evaluated project. Messages for the internal view.

// level: 'error' (to fix before submitting) | 'warning' (to check) | 'info'.


import { weighedParts } from './compare.js';

const pct = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%`;
const kg = (x) => `${x.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`;
const sm = (x) => `${x.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' })} SM$`;
const num = (x) => x.toLocaleString('it-IT', { maximumFractionDigits: 3 });

const CARBON_RE = /carbon|\bcf\b|cfrp/i;

/** Carbon material on a manual item: the Table 2 limits are calculated only from the laminated parts. */
function isManualCarbon(l) {
  const m = l.material;
  if (!m || l.line.auto || l.usedPart || l.line.material.fromLayup || l.line.material.check) return false;
  if (m.entry && !m.entry.extra) return ['reinforcement', 'prepreg'].includes(m.entry.kind) && CARBON_RE.test(`${m.entry.group ?? ''} ${m.entry.type ?? ''}`);
  // free item: only material by weight, not ready-made pieces such as an upcycled mast (in "pc")

  return m.unit === 'kg' && CARBON_RE.test(`${m.label ?? ''} ${m.entry?.name ?? ''}`);
}

/** Values that cannot be negative, as [where, field, value, id]. */
function negativeValues(project) {
  const out = [];
  const scan = (where, id, obj, fields) => {
    for (const [f, label] of fields) {
      if (typeof obj?.[f] === 'number' && obj[f] < 0) out.push([where, label, obj[f], id]);
    }
  };
  for (const part of project?.parts || []) {
    (part.substacks || []).forEach((s, i) => scan(`${part.name}, substack ${i + 1}`, part.id, s, [['plyArea', 'area'], ['plies', 'strati'], ['arealWeight', 'grammatura']]));
    scan(`${part.name}, core`, part.id, part.core, [['mass', 'massa'], ['area', 'area'], ['thickness', 'spessore'], ['density', 'densità'], ['resinUptake', 'resin absorption']]);
    scan(part.name, part.id, part, [['measuredMass', 'weighed weight']]);
    for (const [ref, kgWaste] of Object.entries(part.waste || {})) {
      if (kgWaste < 0) out.push([part.name, `waste of ${ref}`, kgWaste, part.id]);
    }
  }
  for (const line of project?.lines || []) {
    scan(line.s2Label || line.name, line.id, line.material, [['qty', 'quantità'], ['price', 'prezzo'], ['waste', 'scarto']]);
    scan(line.s2Label || line.name, line.id, line.process, [['hours', 'ore'], ['rate', 'tariffa']]);
  }
  for (const extra of project?.catalogExtras || []) scan(extra.name, null, extra, [['price', 'prezzo'], ['density', 'densità']]);
  return out;
}

function duplicateIds(project) {
  const out = [];
  for (const [items, what] of [[project?.parts, 'pezzi'], [project?.lines, 'voci'], [project?.catalogExtras, 'team items']]) {
    const seen = new Set();
    const reported = new Set();
    for (const { id } of items || []) {
      if (seen.has(id) && !reported.has(id)) { out.push([what, id]); reported.add(id); }
      seen.add(id);
    }
  }
  return out;
}

export function runChecks(ev, { layupMaxSubstacks = 5, qtyTolerance = 0.02, weighTolerance = 0.1 } = {}) {
  const out = [];
  const add = (level, code, message, target = null) => out.push({ level, code, message, target });
  const rules = ev.rules || {};
  const refs = rules.refs || {};
  const help = rules.help || {};

  // 2027: the budget must be kept "under" 10,000 SM$ and exceeding it costs points

  const penalty = rules.budgetPenalty ? `: costs −${rules.budgetPenalty} points (${refs.budget})` : '';
  const over = ev.total - ev.budget; // comparison to the cent

  if (over > 0.005) add('error', 'budget', `Budget exceeded by ${sm(over)}${penalty}`);
  else if (rules.budgetStrict && over > -0.005) add('error', 'budget', `Budget exactly at the limit: must be kept under ${sm(ev.budget)}${penalty}`);
  else if (ev.margin < ev.budget * 0.02) add('warning', 'budget-margin', `Very small budget margin: ${sm(ev.margin)}`);

  for (const l of ev.unknownComponent) add('error', 'component', `"${l.name}": component "${l.component}" not valid`, l.id);

  for (const [where, label, value, id] of negativeValues(ev.project)) add('error', 'negative', `${where}: ${label} negative (${num(value)}), it would lower the accounts`, id);
  for (const [what, id] of duplicateIds(ev.project)) add('error', 'duplicate-id', `Two or more ${what} have the same id "${id}": the calculations and the S1→S2 comparison may confuse them`, id);

  for (const pr of ev.parts) {
    const p = pr.part;
    for (const e of pr.errors) add('error', 'part', `${p.name}: ${e}`, p.id);
    if (p.component === 'foils' && !p.limitGroup) add('warning', 'foil-group', `${p.name}: choose which foil it is (Table 2 carbon limits). Until you choose, the carbon goes into the "other" group and the limit checked is wrong`, p.id);
    const outside = pr.substacks.filter((r) => !r.errors.length && !r.inCalculator);
    if (outside.length) {
      const names = [...new Set(outside.flatMap((r) => [r.reinforcement, r.matrix].filter((m) => !m.inCalculator).map((m) => m.entry.name)))];
      add('warning', 'not-in-calculator', `${p.name}: ${names.join(', ')} does not exist in the official Layup Calculator: ${help.notInCalculator || 'document the calculation separately'}`, p.id);
    }
    const n = (p.substacks || []).length;
    if (n > layupMaxSubstacks) add('info', 'split', `${p.name}: ${n} substacks, in the official template it will be split into ${Math.ceil(n / layupMaxSubstacks)} file`, p.id);
    if (pr.core && !pr.core.uptake && rules.massBreakdownRequired !== false) add('info', 'uptake', `${p.name}: core resin absorption not estimated (required in the mass breakdown ${refs.mass})`, p.id);
  }

  for (const g of ev.carbon) {
    for (const c of g.checks) {
      if (!c.value) continue;
      const where = `${g.en} · ${c.label}`;
      if (c.value > c.limit + 1e-9) {
        const grams = (x) => `${(x * 1000).toLocaleString('it-IT', { maximumFractionDigits: 2 })} g`;
        add('error', 'carbon', `Carbon limit exceeded by ${grams(c.value - c.limit)} – ${where}: ${grams(c.value)} of ${grams(c.limit)} (Tab. 2)`, g.id);
      } else if (c.ratio >= 0.95) {
        const p = (c.ratio * 100).toLocaleString('it-IT', { maximumFractionDigits: 1 });
        const v = c.value.toLocaleString('it-IT', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
        add('warning', 'carbon-near', `Carbon at ${p}% of the limit – ${where}: ${v} kg of ${kg(c.limit)} (Tab. 2)`, g.id);
      }
    }
  }

  for (const l of ev.lines) {
    const name = l.line.s2Label || l.name;
    for (const e of l.errors) add('error', 'line', `${name}: ${e}`, l.id);
    const m = l.material;
    if (!l.line.auto && !l.errors.length) {
      // a 0 price in the official price list is legitimate (basalt, recycled PET…): only manually entered values are flagged

      const noPrice = m && m.basePrice === 0 && m.factor > 0 && (!m.entry || m.entry.extra || m.manualPrice);
      if (!m && !l.process && !l.usedPart) add('warning', 'zero-cost', `${name}: empty item, costs nothing`, l.id);
      else if (m && m.qty === 0) add('warning', 'zero-cost', `${name}: quantity 0, the item costs nothing`, l.id);
      else if (noPrice) add('warning', 'zero-cost', `${name}: price 0 SM$ entered by hand. If it is free state why, otherwise the price is missing`, l.id);
      if (l.process && l.process.cost === 0) add('warning', 'zero-cost', `${name}: process with 0 hours or rate, costs nothing`, l.id);
    }
    if (m && isManualCarbon(l) && m.qty > 0) {
      add('warning', 'manual-carbon', `${name}: ${num(m.qty)} ${m.unit} of carbon on a manual item do not count in the Table 2 limits. Enter it in a laminated part or check the limit separately`, l.id);
    }
    if (m) {
      if (m.layupKg !== null && l.line.material.qty !== undefined && m.layupKg > 0) {
        const d = (m.qty - m.layupKg) / m.layupKg;
        if (Math.abs(d) > qtyTolerance) {
          add('warning', 'qty-vs-layup', `${name}: declared ${kg(m.qty)}, the layup gives ${kg(m.layupKg)} (${pct(d)})`, l.id);
        }
      }
      // only price-list materials (PVC/SAN, PTFE…): a purchased piece can cost a lot without being "penalized"

      if (m.entry && !m.entry.extra && (m.basePrice ?? 0) >= 1000 && m.factor > 0) add('warning', 'penalty', `${name}: ${m.label} costs ${m.basePrice} SM$/${m.unit} (penalized material)`, l.id);
      if (m.source === 'upcycled' && !l.line.origin && !l.line.notes) add('warning', 'upcycled-origin', `${name}: for upcycled elements the origin and transformation must be stated (${refs.upcycled})`, l.id);
      const usedWithoutSource = l.usedPart && !l.usedPart.fixed && !m.priceSource;
      if (usedWithoutSource) {
        add('warning', 'used-price', `${name}: in 2027 used parts no longer have the fixed cost of the old Table 3. Take the price from SuMoth Agora and state the source`, l.id);
      } else if ((m.manualPrice || m.entry?.extra) && !m.priceSource && !m.entry?.priceSource && m.factor > 0 && m.unitPrice > 0) {
        add('info', 'price-source', `${name}: price entered by hand without a source (${help.priceSource || 'state where it comes from'})`, l.id);
      }
      if (m.waste > 0 && m.waste > m.qty + 1e-9) add('warning', 'waste-over', `${name}: the waste (${num(m.waste)}) is more than the quantity used (${num(m.qty)})`, l.id);
      // recovered upcycled element (free item, not a price-list material) in the hull

      if (rules.upcycledHullNonFoiling && l.component === 'hull' && m.source === 'upcycled' && !m.entry) {
        add('info', 'upcycled-hull', `${name}: if it is a recovered hull (or part of a hull), in 2027 it is allowed only if it originally came from a non-foiling boat (§6.2.1)`, l.id);
      }
    }
    if (l.usedPart?.doubled) add('info', 'foil-doubling', `${name}: handicap doubled (foil used after the first year of participation)`, l.id);
  }

  // 2027: the origin discounts of 2026 §3.3.B are no longer in the rulebook

  if (rules.sourcesToConfirm) {
    const discounted = ev.lines.filter((l) => l.material && l.material.factor !== 1);
    if (discounted.length) {
      const saving = discounted.reduce((a, l) => a + (l.material.basePrice ?? 0) * (1 - l.material.factor) * l.material.qty, 0);
      const noPrice = discounted.filter((l) => l.material.basePrice === null).length;
      const marginWithout = ev.margin - saving;
      const worstCase = marginWithout < 0 ? `you would exceed the budget by ${sm(-marginWithout)}` : `the margin would fall to ${sm(marginWithout)}`;
      add('warning', 'discount-unconfirmed',
        `${discounted.length} items use the 2026 origin discounts (surplus −25%, expired −50%, upcycled −100%), which the 2027 rulebook no longer mentions. ` +
        `Worth ${sm(saving)} of discount${noPrice ? ` plus ${noPrice} ${noPrice === 1 ? 'upcycled element' : 'upcycled elements'} without a price-list price` : ''}: to be confirmed on SuMoth Agora. ` +
        `Without discounts the total would be ${sm(ev.total + saving)} e ${worstCase}${noPrice ? ', not counting the elements without a price' : ''}`);
    }
  }

  // 2027: Performance Rating (Tab. 3)
  if (ev.performance) {
    for (const c of ev.performance.commercial) {
      if (c.points) add('info', 'commercial-2017', `${c.name}: ${c.year === null ? 'year of production not stated, so' : `produced in ${c.year},`} is worth ${c.points} Performance Rating points (§11.1.5)`, c.lineId);
    }
    const missing = ev.performance.components.length - ev.performance.declaredCount;
    if (missing > 0) add('info', 'performance-undeclared', `Performance Rating: ${missing} components of ${ev.performance.components.length} with no conditions ticked (they are worth 0). The components used in S2 and S3 must be declared on SuMoth Agora (§11.3)`);
  }

  // Checks of stage S2 (as-built)

  if (ev.project?.stage === 'S2') {
    if (!ev.project.baseline) add('info', 's2-baseline', "No reference S1: link the submitted S1 for the comparison required in section 2.3 of S2");
    const est = ev.lines.filter((l) => l.status !== 'measured');
    if (est.length) {
      const cost = est.reduce((a, l) => a + l.total, 0);
      const share = ev.total > 0 ? cost / ev.total : 0;
      add('warning', 's2-estimated', `${est.length} items still estimated (${sm(cost)}, ${(share * 100).toLocaleString('it-IT', { maximumFractionDigits: 1 })}% of the total): in S2 they must be updated to the real values and marked as measured`);
    }
    for (const w of weighedParts(ev)) {
      if (w.ratio !== null && Math.abs(w.ratio) > weighTolerance) {
        add('warning', 'weighed-mass', `${w.name}: weighed ${kg(w.weighed)}, from the calculation ${kg(w.computed)} (${pct(w.ratio)}). Useful to explain in the self-assessment (2.4)`, w.id);
      }
    }
    if (rules.wasteTracking && !ev.waste?.rows.length) {
      add('info', 'waste-none', 'No waste recorded: in 2027 material waste must also be tracked in S2 (§9.2.2). It is entered in the laminated parts and in the item details');
    }
  }

  const order = { error: 0, warning: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}
