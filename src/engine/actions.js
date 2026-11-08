// Brumoth: project changes requested in words and instructions on how to use the app.
//
// Brumoth NEVER changes anything by itself: for each request it prepares an "action" with the list of what changes and
// a preview of the effect (total, margin, new problems); the chat shows "Apply" / "Cancel" and the
// change goes through the app update(), so Ctrl+Z undoes it like any other.
// If the request is too generic (the part, quantity, price… is missing) it says so and explains what is needed.
//
// Planned actions: add fibre to a part (new substack), add a cost item, create a laminated
// part, add a material to the team price list, change the fibre of a part, delete a part.
// Pure module (no DOM), tested in tests/actions.test.js.

import { evaluate } from './project.js';
import { runChecks } from './checks.js';
import { findMaterials, findParts, findComponents, normalize } from './assistant.js';

const nf = (x, min, max) => Number(x || 0).toLocaleString('it-IT', { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: 'always' });
const sm = (x) => `${nf(x, 2, 2)} SM$`;
const kg = (x) => `${nf(x, 2, 2)} kg`;
const uid = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

// Table 2 and mass breakdown groups by component (like templates.DEFAULT_GROUPS of the interface).
const GROUPS = {
  hull: { limitGroup: 'hull', massGroup: 'hull' },
  foils: { limitGroup: 'main_vertical', massGroup: 'vertical_foils' },
  mechanical_control: { limitGroup: 'other', massGroup: 'other' },
  gantry: { limitGroup: 'gantry', massGroup: 'other' },
  wingbars: { limitGroup: 'wingbars', massGroup: 'wings' },
  rig: { limitGroup: 'rig', massGroup: 'other' },
  electronics: { limitGroup: 'other', massGroup: 'other' },
};

/** Table 2 and mass groups of a new part: from the component, refined by the name (rudder, horizontal…). */
function groupsFor(comp, name) {
  const g = { ...(GROUPS[comp] || { limitGroup: 'other', massGroup: 'other' }) };
  if (comp === 'foils') {
    const horizontal = /orizzontal|horizontal|\bmh\b|\brh\b/.test(name);
    const rudder = /timon|rudder|\brv\b|\brh\b/.test(name);
    g.limitGroup = `${rudder ? 'rudder' : 'main'}_${horizontal ? 'horizontal' : 'vertical'}`;
    g.massGroup = horizontal ? 'horizontal_foils' : 'vertical_foils';
  }
  return g;
}

// ------------------------------------------------------------------ recognizing the requests
const HOWTO_RE = /\bhow (do|can|should) (i|we|you) (add|create|insert|put|change|replace|remove|delete|export|save(?! money)|open|share|update|use|record|fill)|\bhow to (add|create|insert|put|change|replace|remove|delete|export|save(?! money)|open|share|update|use|record|fill)|\bwhere (do|can|is|are)\b .{0,20}(find|add|put|enter)|\bcome (faccio|si fa|si fanno|posso|possiamo|devo|dobbiamo|aggiungo|creo|inserisco|metto|cambio|tolgo|elimino|esporto|salvo|apro|condivido|aggiorno|uso|registro|si aggiunge|si crea|si inserisce)|\bdove (trovo|si trova|si trovano|aggiungo|metto|inserisco|si)\b|istruzion|instructions?\b|explain how|spiegami come|mi spieghi come|\bguida\b|\btutorial\b|passaggi per/;
const WHATIF_RE = /\be se\b|what if|what happens if|what changes if|cosa succede se|cosa cambia se|che succede se|simula|ipotes|ipotizz/;
const VERB_RE = /\b(add|put|insert|create|make|remove|delete|replace|change|switch|aggiungi|aggiungimi|aggiungere|aggiungiamo|aggiungerei|metti|mettimi|mettere|mettiamo|inserisci|inserire|crea|creami|creare|creiamo|togli|togliere|rimuovi|rimuovere|elimina|eliminare|cancella|cancellare|sostituisci|sostituire|cambia|cambiare|passa|portami)\b|^(ok |dai |per favore |brumoth,? )?(fai|fammi|facciamo|fate) (un|una|il|lo|la|le|i|gli|l')\b/;

export const isHowTo = (q) => HOWTO_RE.test(q);
export const isCommand = (q) => !WHATIF_RE.test(q) && !HOWTO_RE.test(q) && VERB_RE.test(q);

/** Text between quotes in the original question («Wings», "Wings", 'Wings'). */
function quoted(question) {
  const m = String(question).match(/[«"“']([^»"”']{2,60})[»"”']/);
  return m ? m[1].trim() : null;
}

/** Name after "called/named", taken from the original question (keeps the capitals). */
function namedAs(question) {
  const q = quoted(question);
  if (q) return q;
  const m = String(question).match(/\b(?:called|named|chiamat[oaie]|di nome|nome|che si chiam[ai]|denominat[oa])\s+["«]?([^,.;:?!"»]+?)["»]?(?=\s+(?:and|with|in|into|at|for|to|on|that|where|e|ed|con|nel|nella|nello|nei|negli|nelle|tra|fra|sui|sul|per|a|al|che|dove|come)\b|[,.;:?!]|$)/i);
  return m ? m[1].trim() : null;
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function findAmount(q) {
  const m = q.match(/(\d+(?:[.,]\d+)?)\s*(kg|kilos?|kilograms?|chili|chilogrammi|g|grams?|grammi|gr)\b/);
  if (!m) return null;
  const v = Number(m[1].replace(',', '.'));
  return /^(g|gr|grams?|grammi)$/.test(m[2]) ? v / 1000 : v;
}

function findPrice(q) {
  const m = q.match(/(\d+(?:[.,]\d+)?)\s*(?:sm\$|sm|dollars?|dollari|smd)?\s*(?:\/|al |a |per |each )?\s*(kg|kilo|chilo|m2|mq|m|metre|meter|metro|piece|pezzo|pc|l|liter|litre|litro)\b/)
    || q.match(/(?:prezzo|price)\s*(?:di|da|a|of|at)?\s*(\d+(?:[.,]\d+)?)/)
    || q.match(/(\d+(?:[.,]\d+)?)\s*(?:sm\$|dollars?|dollari)\b/);
  if (!m) return null;
  return { price: Number(m[1].replace(',', '.')), unit: unitOf(m[2]) };
}
function unitOf(u) {
  if (!u) return null;
  if (/^(kg|kilo|chilo)/.test(u)) return 'kg';
  if (/^(m2|mq)/.test(u)) return 'm2';
  if (/^(m|metre|meter|metro)$/.test(u)) return 'm';
  if (/^(l|liter|litre|litro)$/.test(u)) return 'L';
  return 'pc';
}
function findDensity(q) {
  const m = q.match(/densit\w*\s*(?:di|da|of|=|:)?\s*(\d+(?:[.,]\d+)?)/);
  return m ? Number(m[1].replace(',', '.')) : null;
}

const partList = (ev) => ev.parts.map((pr) => pr.part.name).join(', ');
const componentList = (ev) => ev.components.map((c) => c.it).join(', ');

// ------------------------------------------------------------------ azioni
/**
 * Interprets a change request.
 * Returns {actions: [...], missing: [texts], notes: [texts]} or null if it is not a change request.
 * An action: {id, type, title, changes: [texts], apply(draftProject), target: {view, opts}}.
 */
export function parseCommand(question, { ev, spec } = {}) {
  const q = normalize(question);
  const out = { actions: [], missing: [], notes: [] };
  const mats = findMaterials(q);
  const parts = findParts(q, ev);
  const comps = findComponents(q, ev);
  const amount = findAmount(q);
  const removing = /\b(remove|delete|togli|togliere|rimuovi|rimuovere|elimina|eliminare|cancella|cancellare)\b/.test(q);
  const swapping = /\b(replace|change|switch|make|use|sostituisci|sostituire|sostituisco|sostituissi|cambia|cambiare|cambio|cambiassi|passa|passo|passassi|fai|fammi|facciamo|facessi|faccio|rifai|usa|uso|usassi|usiamo)\b/.test(q) && /\b(in|con|with|to)\s+(il |lo |la |l'|the )?(\w+)/.test(q);
  const wantsPart = /\b(parts?|sections?|laminated part|new laminate|pezz[oi]|sezion[ei]|part[ei] laminat|laminato nuovo|nuovo laminato)\b/.test(q);
  const wantsMaterial = /\b(materials?|in the price list|to the price list|new (fibre|fiber|fabric|resin)|team item|that does not exist|material[ei]|nel listino|al listino|nuov[oa] (fibra|tessuto|resina)|voce del team|che non c'e|che non ce|non esiste|non c'e)\b/.test(q);

  // --- new material in the team price list
  if (wantsMaterial && !removing) {
    const name = (wantsPart ? null : quoted(question)) || materialNameFrom(question) || (wantsPart ? null : namedAs(question));
    if (!name) out.missing.push('the name of the material (e.g. «add the material "Carbon/Innegra" at 150 SM$/kg with density 1.3»)');
    else {
      const known = [...ev.catalog.values()].find((e) => normalize(e.name) === normalize(name));
      if (known) out.notes.push(`«${name}» is already in the price list: ${nf(known.price ?? 0, 0, 2)} SM$/${known.unit}.`);
      else {
        const kind = kindOf(normalize(name));
        const price = findPrice(q);
        const density = findDensity(q);
        const miss = [];
        if (!price) miss.push(`the price in SM$ (e.g. «at 150 SM$/kg»: ${ev.rules.sourcesToConfirm ? 'in 2027 it must be taken from or proposed on SuMoth Agora' : 'it must be requested on the SuMoth Discord'})`);
        if (kind === 'reinforcement' && !density) miss.push('the fibre density in g/cm³ (e.g. «density 1.3»): needed to calculate the resin with the Layup Calculator formulas');
        if (miss.length) out.missing.push(...miss.map((m) => `for «${name}»: ${m}`));
        else {
          const unit = price.unit || (kind === 'hardware' ? 'pc' : 'kg');
          const id = uid('extra');
          out.actions.push({
            id, type: 'addMaterial', title: `New material in the price list: ${name}`,
            changes: [
              `Price list → Team items: «${name}», type ${KIND_IT[kind]}, ${nf(price.price, 0, 2)} SM$/${unit}${density ? `, density ${nf(density, 0, 3)} g/cm³` : ''}.`,
              'Price source: to complete in the Price list (e.g. Discord, Agora, MSRP).',
              ...(kind === 'reinforcement' ? ['It does not exist in the official Layup Calculator: parts using it cannot be exported to the official file.'] : []),
              ...(kind === 'reinforcement' && /carbon/.test(normalize(name)) ? ['Since it has "carbon" in the name, all its mass counts as carbon for Table 2 (a cautious estimate).'] : []),
            ],
            apply: (d) => {
              d.catalogExtras ||= [];
              d.catalogExtras.push({ id, kind, name, unit, price: price.price, priceSource: '', ...(density ? { density } : {}) });
            },
            target: { view: 'catalog' },
          });
        }
      }
    }
  }

  // --- new laminated part ("section")
  if (wantsPart && !removing && /\b(create|add|make|new|want|insert|put|crea|creami|creare|aggiungi|aggiungere|fai|fare|fammi|nuov[oa]|voglio|vorrei|inserisci|metti)\b/.test(q)) {
    const name = namedAs(question);
    const comp = comps[0] || (name ? findComponents(normalize(name), ev)[0] : null);
    if (!name) out.missing.push('the name of the part (e.g. «create a part called Wings»)');
    if (!comp) out.missing.push(`the component it goes in (${componentList(ev)})`);
    if (name && comp) {
      // the fibre is set only if stated for the part ("a carbon part"), not when creating a new material
      const fibre = wantsMaterial ? null : mats.find((m) => m.role === 'fibre');
      const id = uid('part');
      const groups = groupsFor(comp.id, normalize(name));
      const groupName = ev.rules.carbonGroups.find((g) => g.id === groups.limitGroup)?.en || groups.limitGroup;
      const sub = fibre ? { reinforcement: fibre.ref, matrix: 'std-epoxy/lamination-resin', plyArea: 1, plies: 1, arealWeight: 200, process: 'HAND LAYUP + VAC', reinforcementSource: 'new', matrixSource: 'new' } : null;
      out.actions.push({
        id, type: 'addPart', title: `New laminated part: ${cap(name)}`,
        changes: [
          `Laminated parts → «${cap(name)}», component ${comp.it} (${comp.en}).`,
          `Table 2 carbon limits: group ${groupName} (changed in the part, "Carbon limits (Table 2)"); fibre, resin and core items created automatically.`,
          sub ? `A starting substack: ${fibre.it}, 1 m², 1 ply of 200 g/m², HAND LAYUP + VAC (to correct with the real values).` : 'No substacks: you add them with "Add substack" (fibre, area, plies, areal weight, process).',
        ],
        apply: (d) => {
          d.parts.push({ id, name: cap(name), component: comp.id, ...groups, autoLines: true, substacks: sub ? [sub] : [] });
        },
        target: { view: 'parts', opts: { part: id } },
      });
      if (comp.id === 'wingbars' && /terrazz|\bwings?\b/.test(normalize(name))) out.notes.push('Note: the Wings component already exists and contains Wing panel and Wing frame; the new part is added to those.');
    }
  }

  if (out.actions.length || out.missing.length || out.notes.length) return out;

  // --- deleting a part
  if (removing) {
    if (parts.length === 1 && !amount) {
      const p = parts[0].part;
      out.actions.push({
        id: uid('del'), type: 'removePart', title: `Delete the part ${p.name}`,
        changes: [`Laminated parts: removing «${p.name}» with its ${p.substacks?.length || 0} substack${p.autoLines !== false ? ' and the cost items it generated' : ''}.`],
        apply: (d) => { d.parts = d.parts.filter((x) => x.id !== p.id); },
        target: { view: 'parts' },
      });
    } else if (!parts.length) out.missing.push(`which part to delete (${partList(ev)})`);
    else if (amount) out.notes.push('To remove material from a part, change its substacks (plies or area) in Laminated parts: more precise than removing kilos by hand.');
    else out.missing.push(`which part to delete, only one: I found ${parts.map((p) => p.part.name).join(' e ')}`);
    return out;
  }

  // --- changing the fibre of a part ("make the fin in basalt", "replace the carbon with glass in the hull")
  const fibres = mats.filter((m) => m.role === 'fibre');
  if (swapping && !amount && fibres.length) {
    let to = fibres[fibres.length - 1];
    let from = fibres.length > 1 ? fibres[0] : null;
    const instead = Math.max(q.indexOf('invece'), q.indexOf('al posto'), q.indexOf('instead of'));
    if (fibres.length > 1 && instead >= 0) {
      const after = fibres.filter((m) => m.index > instead);
      const before = fibres.filter((m) => m.index < instead);
      if (after.length && before.length) { from = after[0]; to = before[before.length - 1]; }
    }
    if (!parts.length) { out.missing.push(`which part to change the fibre in (${partList(ev)})`); return out; }
    for (const pr of parts) {
      const pick = (s) => {
        const e = ev.catalog.get(s.reinforcement);
        if (!from) return s.reinforcement !== to.ref;
        if (from.carbon) return /carbon/i.test(`${e?.group} ${e?.name}`);
        return s.reinforcement === from.ref;
      };
      const n = (pr.part.substacks || []).filter(pick).length;
      if (!n) { out.notes.push(`${pr.part.name}: no substack to change${from ? ` (does not use ${from.it})` : ''}.`); continue; }
      const pid = pr.part.id;
      out.actions.push({
        id: uid('swap'), type: 'swapFibre', title: `${pr.part.name}: fibre in ${to.it}`,
        changes: [
          `${pr.part.name}: ${n} substacks switch to ${to.it} (same areas, plies and areal weights; the resin is recalculated).`,
          'The stiffness changes: the sizing must be checked again.',
          ...(pr.part.autoLines === false ? [`The costs of ${pr.part.name} are in items written by hand: those must be updated too.`] : []),
        ],
        apply: (d) => {
          const p = d.parts.find((x) => x.id === pid);
          if (!p) return;
          for (const s of p.substacks) {
            if (!pick(s)) continue;
            s.reinforcement = to.ref;
            delete s.carbonSource;
            if (s.reinforcementSource === 'upcycled') s.reinforcementSource = 'new';
          }
        },
        target: { view: 'parts', opts: { part: pid } },
      });
    }
    return out;
  }

  // --- adding material ("add 2 kg of carbon to the hull", "put 20 kg of MDF in the hull")
  if (/\b(add|put|insert|aggiungi|aggiungimi|aggiungere|aggiungiamo|aggiungo|aggiungessi|metti|mettimi|mettere|mettiamo|metto|mettessi|inserisci|inserire)\b/.test(q)) {
    const m = mats[mats.length - 1];
    if (!m) {
      out.missing.push('what to add: a material with the quantity (e.g. «add 2 kg of carbon to the hull»), a laminated part or a new material in the price list');
      return out;
    }
    if (m.role === 'resin') {
      out.notes.push('The resin of laminated parts is not added by hand: Dollaroni calculates it from the process (Vf) with the Layup Calculator formulas. If you want more resin, change the process of the substack; for adhesives or extra resin use a cost item in "Cost items".');
      return out;
    }
    if (!amount) out.missing.push(`the quantity of ${m.it} (e.g. «2 kg»)`);
    if (m.role === 'fibre') {
      if (!parts.length) out.missing.push(`which laminated part (${partList(ev)})`);
      else if (parts.length > 1) out.missing.push(`only one part: I found ${parts.map((p) => p.part.name).join(' e ')}`);
      if (out.missing.length) return out;
      const pr = parts[0];
      const last = pr.part.substacks?.[pr.part.substacks.length - 1];
      const gsm = Number(last?.arealWeight) || 200;
      const process = last?.process || 'HAND LAYUP + VAC';
      const matrix = last?.matrix || 'std-epoxy/lamination-resin';
      const area = (amount * 1000) / gsm;
      const pid = pr.part.id;
      out.actions.push({
        id: uid('add'), type: 'addFibre', title: `${pr.part.name}: +${kg(amount)} of ${m.it}`,
        changes: [
          `${pr.part.name}: new substack of ${m.it}, 1 ply of ${nf(gsm, 0, 0)} g/m² on ${nf(area, 0, 2)} m² = ${kg(amount)} of fibre, ${process}.`,
          'The resin, the cost and the carbon limits are recalculated with the Layup Calculator formulas.',
          ...(pr.part.autoLines === false ? [`The costs of ${pr.part.name} are in items written by hand: the cost of the new substack is not added automatically.`] : []),
        ],
        apply: (d) => {
          const p = d.parts.find((x) => x.id === pid);
          if (p) p.substacks.push({ reinforcement: m.ref, matrix, plyArea: area, plies: 1, arealWeight: gsm, process, reinforcementSource: 'new', matrixSource: 'new' });
        },
        target: { view: 'parts', opts: { part: pid } },
      });
      if (m.key === 'carbon') out.notes.push('I used standard carbon (T700); for another type write «intermediate carbon» or «high modulus».');
      return out;
    }
    // other materials (MDF, PET, PVC…): a cost item in the given component
    const comp = parts[0] ? ev.components.find((c) => c.id === parts[0].part.component) : comps[0];
    if (!comp) out.missing.push(`which component the item goes in (${componentList(ev)})`);
    if (out.missing.length) return out;
    const entry = ev.catalog.get(m.ref);
    const id = uid('line');
    out.actions.push({
      id, type: 'addLine', title: `New item: ${nf(amount, 0, 3)} ${entry?.unit || 'kg'} of ${m.it} (${comp.it})`,
      changes: [`Cost items → ${comp.it}: «${comp.en} - ${m.it}», ${nf(amount, 0, 3)} ${entry?.unit || 'kg'} a ${nf(entry?.price ?? 0, 0, 2)} SM$/${entry?.unit || 'kg'}, new origin.`],
      apply: (d) => { d.lines.push({ id, component: comp.id, name: `${comp.en} - ${m.it}`, material: { ref: m.ref, qty: amount, source: 'new' } }); },
      target: { view: 'lines', opts: { line: id } },
    });
    return out;
  }

  out.generic = true;
  out.missing.push('what you want to change. I can add fibre to a part («add 2 kg of carbon to the hull»), add an item («put 20 kg of MDF in the hull»), create a part («create a part called Spare rudder in the foils»), add a material to the price list, change the fibre of a part («make the fin in basalt») and delete a part');
  return out;
}

const KIND_IT = { reinforcement: 'Reinforcements', matrix: 'Matrices and resins', core: 'Cores', consumable: 'Consumables', hardware: 'Team items (MSRP, Discord)', other: 'Other' };

function kindOf(n) {
  if (/carbon|carbo|innegra|basalt|vetro|glass|kevlar|aramid|lino|flax|fibr|fiber|fabric|tessut|diolen|dyneema/.test(n)) return 'reinforcement';
  if (/resin|epossid|epoxy|vinil|poliest/.test(n)) return 'matrix';
  if (/anima|core|schiuma|foam|balsa|pet|pvc|nido/.test(n)) return 'core';
  if (/peel|sacco|breather|nastro|tape|distaccante/.test(n)) return 'consumable';
  return 'hardware';
}

/** "add the carbo innegra that is a material…" -> "carbo innegra". */
function materialNameFrom(question) {
  const s = String(question);
  const m = s.match(/\b(?:add|insert|put|create|aggiung\w*|inserisc\w*|mett\w*|crea\w*)\s+(?:also\s+|anche\s+)?(?:the|a|an|il|lo|la|l'|un|uno|una|i|gli|le)?\s*(?:material|fabric|fibre|fiber|materiale|tessuto|fibra)?\s*([^,.;:?!]+?)\s+(?:that\s+(?:is|does)|to\s+the\s+price|in\s+the\s+price|at\s+\d|with\s+density|che\s+(?:è|e)\s+un|che\s+non|nel\s+listino|al\s+listino|a\s+\d|con\s+densit|,|$)/i);
  const name = m?.[1]?.trim().replace(/^["«“']|["»”']$/g, '');
  if (!name || /^(un|una|il|lo|la|nuovo|nuova|materiale)$/i.test(name)) return null;
  return name.replace(/^(materiale|tessuto|fibra)\s+/i, '');
}

/**
 * Effect of an action: project before/after with the same rules and the same price list.
 * evalCtx = {spec, catalogEntries, rules}. Returns {before, after, problems} or {error}.
 */
export function previewAction(action, project, evalCtx) {
  try {
    const draft = structuredClone(project);
    action.apply(draft);
    const evB = evaluate(project, evalCtx);
    const evA = evaluate(draft, evalCtx);
    // new problems: same check on the same element that was not there before
    const key = (c) => `${c.level}|${c.code}|${c.target}|${c.code === 'carbon' || c.code === 'carbon-near' ? (c.message.split('–')[1] || '').split(':')[0] : ''}`;
    const known = new Set(runChecks(evB).filter((c) => c.level !== 'info').map(key));
    const problems = runChecks(evA).filter((c) => c.level !== 'info' && !known.has(key(c))).map((c) => ({ level: c.level, message: c.message }));
    return { before: { total: evB.total, margin: evB.margin }, after: { total: evA.total, margin: evA.margin }, problems };
  } catch (e) {
    return { error: e.message };
  }
}

export const describeEffect = (p) => (p.error ? `Preview not available: ${p.error}` : `Total ${sm(p.before.total)} → ${sm(p.after.total)} · margin ${sm(p.after.margin)}`);

// ------------------------------------------------------------------ instructions ("how do I…")
/** Instruction topics: keywords and steps with the real button names of the app. */
export function howToTopics(rules, catalog) {
  const innegra = catalog?.get('dry-fabric-innegra');
  return [
    {
      id: 'part', re: /\bpart\b|section|pezz|sezion|laminat|substack|strat|ply|plies|scafo|\bhull\b|deriva|\bfin\b|timon|rudder|terrazz|\bwing/,
      title: 'Add a laminated part (a "section" with its plies)',
      steps: [
        'Left bar → **Laminated parts** → top right **New part**.',
        'Write the **Part name** and choose the **Component (S2 tables)**, for example Wings: the **Carbon limits (Table 2)** set themselves.',
        '**Add substack**: for each group of plies choose fibre, matrix, process, area (m²), number of plies and areal weight (g/m²), with the origin.',
        'With "Automatically create the fibre, resin and core cost items" on, costs and masses are calculated as you type; at the bottom is the Layup Calculator preview.',
      ],
    },
    {
      id: 'material', re: /material|listino|price list|non c'e|non ce|non esiste|missing|innegra|fibra nuova|nuova fibra|new fib|tessuto|fabric|prezzo|\bprice\b/,
      title: 'Add a material that is not in the price list',
      steps: [
        'Left bar → **Price list** → **Team items** box → **Add item**.',
        'Fill in **Name**, **Type** (for a fibre: **Reinforcements**), **Unit** (kg), **SM$/unit**, **Density g/cm³** (required for fibres: needed to calculate the resin) and **Price source**.',
        'From then on the material appears in the substack and item menus, in the team items group.',
        rules.sourcesToConfirm
          ? '2027 rules: the official price is on SuMoth Agora and new materials are proposed there with scientific evidence (§10.3).'
          : '2026 rules: the price of a missing material must be requested on the SuMoth Discord (§3.1).',
        'Warning: an added material does not exist in the official Layup Calculator, so parts using it cannot be exported to the official file (Dollaroni flags it in Checks).',
        ...(innegra ? [`Reference: the price list already has pure Innegra at ${nf(innegra.price, 0, 2)} SM$/kg; a carbon/Innegra hybrid is not there. If the name contains "carbon", Dollaroni counts all its mass as carbon for Table 2 (a cautious estimate).`] : []),
      ],
    },
    {
      id: 'line', re: /voc[ei]|\bitems?\b|cost[oi]|\bcosts?\b|hardware|bozzell|blocks?|cime|ropes?|stamp|mould|mold|consumabil|lavorazion|process|cnc|ore|hours?|upcycl|parte usata|used part/,
      title: 'Add a cost item (moulds, consumables, hardware, processes…)',
      steps: [
        'Left bar → **Cost items** → in the box of the right component click **Add**.',
        'Choose the type: Price list material, Hourly process, Hardware / priced item, Used part, Upcycled element.',
        'Fill in quantity or hours, and the source for manual prices; for upcycled items the origin. Grey rows come from the laminated parts and are edited there.',
      ],
    },
    {
      id: 'export', re: /esport|export|report|word|docx|xlsx|layup calculator|appendic|appendix|google docs/,
      title: 'Export the files for the reports',
      steps: [
        'Top right **Export S1** (or **Export S2**): completed Layup Calculator (one file per part), images for the appendix and a Word document with the tables.',
        'Download them one at a time or all in a zip; each table also has "Copy for Google Docs".',
      ],
    },
    {
      id: 's2', re: /\bs2\b|congel|freez|as.?built|misurat|measured|consuntiv/,
      title: 'Move from S1 to S2',
      steps: [
        '**Overview** → **Freeze S1 and create S2** (also at the bottom of Export): S1 stays inside the project as the reference.',
        'Update items and parts to the real values and mark them **✓ measured**; in the parts you can enter the real weighed weight.',
        '**S1→S2 comparison** shows the differences; **Export S2** prepares the tables.',
      ],
    },
    {
      id: 'save', re: /salv|\bsave\b|apri|aprire|\bopen\b|condivid|\bshare\b|file|backup|annull|\bundo\b|ctrl/,
      title: 'Save, open and share the project',
      steps: [
        '**Save** (Ctrl+S) writes the `.dollaroni.json` file: that is the one to share with the team.',
        '**New / open** → "Open a project file…" to open one; the browser still keeps an automatic copy ("Resume").',
        'Ctrl+Z undoes any change, including those made by me; Ctrl+Y redoes it.',
      ],
    },
    {
      id: 'waste', re: /scart|waste/,
      title: 'Record waste (S2, 2027 rules §9.2.2)',
      steps: ['In **Laminated parts** enter the material consumed in excess and thrown away; in the details of the **Cost items**, the "of which waste" field. The S2 export reports them in the "Material use and waste" table.'],
    },
    {
      id: 'performance', re: /performance|rating|condizion|condition/,
      title: 'Fill in the Performance Rating (2027)',
      steps: ['Left bar → **Performance Rating** → for each of the 15 components tick the true conditions a)–g). Commercial sails, masts and foils from 2017 count −100 by themselves, from the items with the used part.'],
    },
    {
      id: 'update', re: /aggiorn|updat|version|novit|what.s new/,
      title: 'Update Dollaroni',
      steps: ['When a new version comes out, "Dollaroni x.y.z is available" appears at the bottom: click **Update now**. At the bottom of the sidebar are the version, **What\'s new** and **Check**.'],
    },
  ];
}

/** Instructions for the question: the steps of the recognized topics (at most 3). */
export function howToBlock(question, ev) {
  const q = normalize(question);
  const topics = howToTopics(ev.rules, ev.catalog);
  let hits = topics.filter((t) => t.re.test(q)).slice(0, 3);
  if (!hits.length) {
    return {
      id: 'howto', title: 'How to',
      lines: ['I can explain how to: ' + topics.map((t) => t.title.charAt(0).toLowerCase() + t.title.slice(1)).join('; ') + '. Tell me which one you need.'],
      links: [],
    };
  }
  // "part" also fires for words like "hull": if there is a more precise topic, only that one is kept
  if (hits.length > 1 && hits[0].id === 'part' && !/\bpart\b|section|pezz|sezion|substack|strat|ply|plies/.test(q)) hits = hits.slice(1);
  const lines = [];
  for (const t of hits) {
    lines.push(`**${t.title}**`);
    t.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  }
  const links = hits.map((t) => ({ part: { label: 'Laminated parts', view: 'parts' }, material: { label: 'Price list', view: 'catalog' }, line: { label: 'Cost items', view: 'lines' }, export: { label: 'Export', view: 'export' }, s2: { label: 'Overview', view: 'overview' }, performance: { label: 'Performance Rating', view: 'performance' } }[t.id])).filter(Boolean);
  return { id: 'howto', title: 'How to', lines, links };
}
