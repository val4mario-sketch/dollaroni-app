// Brumoth, the Dollaroni assistant: answers questions about the project with the numbers calculated by the engine.
//
// How it works:
//  1. route()  works out what the question is about (keywords in English and Italian) and which parts and materials it names;
//  2. answer() prepares a "block of facts" for each topic with the engine numbers (evaluate, runChecks, layup);
//  3. the text of the blocks is already a complete answer: it is what you see if the local AI is off;
//  4. the local AI (src/ai/llm.js) receives the same blocks with buildMessages() and explains them in words.
//     It calculates nothing: verifyNumbers() flags the numbers in its answer that do not appear in the facts.
//
// Pure module (no DOM), tested in tests/assistant.test.js.

import { computeSubstack } from './layup.js';
import { compareStages } from './reports.js';
import { isCommand, isHowTo, parseCommand, howToBlock, previewAction } from './actions.js';

// ------------------------------------------------------------------ formats (Italian number format)
const nf = (x, min, max) => Number(x || 0).toLocaleString('it-IT', { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: 'always' });
const sm = (x) => `${nf(x, 2, 2)} SM$`;
const kg = (x, d = 2) => `${nf(x, d, d)} kg`;
const gr = (kgValue) => `${nf(Math.round(kgValue * 1000), 0, 0)} g`;
/** Grams with decimals only when needed (e.g. 0,04 g over the limit). */
const grFine = (kgValue) => `${nf(kgValue * 1000, 0, Math.abs(kgValue * 1000) < 10 ? 2 : 0)} g`;
/** Value close to the limit: with 2 decimals if the difference is under a gram (1.000,04 g of 1.000 g). */
const grNear = (value, limit) => `${nf(value * 1000, 0, Math.abs(value - limit) * 1000 < 1 ? 2 : 0)} g`;
const pc = (x, d = 1) => `${nf(x * 100, d, d)}%`;
const signed = (x) => `${x > 0.005 ? '+' : x < -0.005 ? '−' : ''}${nf(Math.abs(x), 2, 2)} SM$`;

const DEFAULT_PROCESS = 'HAND LAYUP + VAC';
const DEFAULT_MATRIX = 'std-epoxy/lamination-resin';

// ------------------------------------------------------------------ testo
/** Lowercase, no accents, simplified punctuation: "What's the budget?" -> "what's the budget". */
export function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’`´]/g, "'")
    .replace(/[^a-z0-9$§%.,'+\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ------------------------------------------------------------------ argomenti
// Each topic has keywords (regexes on the normalized text) with a weight.
export const INTENTS = {
  budget: {
    it: 'Budget and margin',
    desc: 'how much has been spent, how much is left, budget margin, overruns',
    keys: [
      [/\bbudget\b/, 2], [/\bmargin[ei]\b/, 2], [/\brimast[oaie]\b|\brimane\b|\brimangono\b|\bresta(no)?\b|\bavanza\b|\bleft\b|\bremain/, 1],
      [/\bspes[aeo]\b|\bspeso\b|\bspendiamo\b|\bspendere\b|\bspeso\b|\bspen[dt]\b|\bspending\b/, 1], [/\btotale\b|\btotal\b/, 1], [/\bsforat|\bsforiamo|\bsforare\b|\bexceed|\bover budget\b|\boverrun/, 2],
      [/\bsoldi\b|\bmoney\b|\bdollar|\bsm\$|\bsmd?\b/, 1], [/quanto (abbiamo|ho|hai|avete) (gia )?(speso|usato)|how much (have )?(we|i|you) (already )?(spent|used)|how much .{0,12}budget/, 2],
    ],
  },
  capacity: {
    it: 'What can still be bought',
    desc: 'how much material (e.g. carbon) can still be bought or added with the remaining budget',
    keys: [
      [/(finire|esaurire|consumare|riempire|spendere tutto|usare tutto|chiudere|arrivare a)( tutto)?( il| l'| al)? ?(budget|margine|10[.]?000)/, 3],
      [/(posso|possiamo|potrei|potremmo|riesco|riusciamo|si puo|si possono) (ancora )?(comprare|aggiungere|mettere|permetter|usare|prendere|spendere)/, 3],
      [/quant[oaie]? .{0,40}(serv|ci vuole|ci vogliono|ne serve|ne servono|ce ne sta|ce ne stanno|ne posso).{0,40}(finire|esaurire|budget|margine)/, 3],
      [/con (quello|quel|cio) che (resta|rimane|avanza)|con il (margine|budget) (rimast|che rest|che riman|residu)/, 3],
      [/fino a (finire|esaurire)/, 2],
      [/(use up|finish|exhaust|fill|spend all)( all)?( of)?( the| our)? ?(budget|margin|10[.,]?000)/, 3],
      [/(can|could) (we|i) (still )?(buy|add|afford|use|get|spend)|how much .{0,40}(can (we|i)|could (we|i)|needed|need).{0,40}(budget|margin|use|buy|add)?/, 3],
      [/with (what|the) (is )?(left|remaining|margin|budget left)/, 3],
    ],
  },
  ranking: {
    it: 'Cost ranking',
    desc: 'ranking of the most expensive components and items, where the money goes',
    keys: [
      [/classific|ranking|graduatoria|\bordin(e|a|ati?) per\b|\brank\b|\bsorted by\b/, 3], [/piu (car[oaie]|costos[oaie])|costano di piu|costa di piu|spendiamo di piu|maggior[ei] (cost|spes)|most expensive|costs? the most|spend the most|biggest (cost|expense)|highest cost/, 3],
      [/dove (vanno|finiscono|spendiamo|se ne vanno|si spende|va il)|where (do|does|did|is|are) .{0,20}(go|spend|spent|going)/, 3], [/ripartizion|suddivision|per componente|breakdown|distribuzion|by component/, 2],
      [/\btop\b|principal[ei] (voci|cost)|voci principali|pesa di piu|pesano di piu|main (items|costs)/, 2],
    ],
  },
  carbon: {
    it: 'Carbon and Table 2 limits',
    desc: 'how much carbon there is, Table 2 limits, where there is too much',
    keys: [[/carbon/, 3], [/\bcfrp\b|\bcf\b/, 3], [/tab(ella|\.)? ?2\b/, 2], [/limit[ei]? (di |del )?carbon|table 2|carbon limit/, 2]],
  },
  issues: {
    it: 'Errors and things to fix',
    desc: 'errors, warnings and checks to fix before submitting',
    keys: [
      [/error|sbagliat|problem|\bcontroll|avvis|warning|\bcheck|\bissues?\b|\bwrong\b/, 3], [/sistemar|correggere|da fare|cosa (manca|non va|devo fare|dobbiamo fare)|\bfix\b|\bto do\b|what(.s| is) missing|need to do/, 3],
      [/va bene\b|tutto (ok|a posto|in regola|giusto)|conform|in regola|e corretto|e giusto|all good|is (it )?(ok|right|correct)|complian/, 2],
    ],
  },
  parts: {
    it: 'Laminated parts and masses',
    desc: 'laminated parts, masses, weights, fibre and resin of each part',
    keys: [[/\bpezz[oi]\b|\bparts?\b|laminat|substack|\bply\b|\bplies\b|\bstrat[oi]\b/, 2], [/\bmass[ae]?\b|\bmasses\b|\bpes[oai]\b|quanto pesa|pesano|\bgramm|\bweigh|\bgrams?\b/, 2]],
  },
  materials: {
    it: 'Materials and prices',
    desc: 'materials used, quantities, price-list prices',
    keys: [
      [/material[ei]?s?|\bfibr[ae]s?\b|\bfibers?\b|\bresin[ae]?s?\b|epossidic|epoxy|\banim[ae]\b|\bcores?\b|consumabil/, 2],
      [/listino|price list|prezz[oi]|\bprices?\b|quanto costa|how much (does|is)|costa al (kg|chilo)|al chilo|al kg|per (kg|kilo)/, 3],
    ],
  },
  savings: {
    it: 'How to save money',
    desc: 'ideas for reducing costs in SM$',
    keys: [[/risparmi|\bsav(e|ing)|ridurre|\breduce\b|abbassare|\blower\b|tagliare|\bcut\b|limare|ottimizz|optimi[sz]|scendere|meno (soldi|costi|spes)|\bless (money|cost)|economic|conveni|cheaper/, 3], [/consigl|suggeriment|idee|alternativ|advice|suggest|ideas?\b/, 2]],
  },
  whatif: {
    it: '"What if…" simulation',
    desc: 'simulate a change: change the material of a part or add material',
    keys: [
      [/\be se\b|cosa succede se|cosa cambia se|che succede se|simula|ipotesi|ipotizz|what if|what happens if|what changes if|suppose/, 3],
      [/\bse (sostitu|cambi|usass|usiamo|uso|faccio|facess|facciamo|mettess|mettiamo|metto|aggiung|toglie|togli|passass|passiamo)/, 3],
      [/al posto d|invece d|instead of|(sostituire|sostituendo|cambiare|cambiando|rifare|replac\w*|chang\w*|swap\w*) .{0,30}(con|in|with) /, 2],
    ],
  },
  rules: {
    it: 'Rules',
    desc: 'SuMoth rules: budget, discounts, limits, Performance Rating, waste, used parts',
    keys: [
      [/regol|regolament|\brules?\b|rulebook|\bnorm[ae]\b|ammess|consentit|\ballowed\b|vietat|forbidden|obbligator|mandatory|required|\bsi puo\b/, 2], [/penal|\bpunt[oi]\b|\bpoints?\b/, 2],
      [/scont|\bdiscounts?\b|scadut|expired|shelf|eccedenz|surplus|upcycl/, 2], [/agora|§|tab(ella|\.|le)? ?[34]\b|scart[oi]|\bwaste\b|parti usate|used parts?|usat[oie] /, 2],
    ],
  },
  compare: {
    it: 'S1 → S2 comparison',
    desc: 'differences between the S1 estimate and the S2 final accounts',
    keys: [[/confront|compar|rispetto (all'? ?|a ?)s1|differenz|differenc|variazion|cambiat[oaie]? rispetto|changed (compared|since|from)|stima vs|as.?built/, 3], [/\bs1\b|\bs2\b/, 1]],
  },
  performance: {
    it: 'Performance Rating',
    desc: '2027 Performance Rating points (Table 3)',
    keys: [[/performance|rating/, 3], [/condizion[ei] (a|b|c|d|e|f|g)\b|commercial/, 2]],
  },
  help: {
    it: 'What I can do',
    desc: "what the assistant can do",
    keys: [[/\baiuto\b|\bhelp\b|cosa (sai|puoi) fare|what can you do|come funzion|how do you work|chi sei|who are you|che domande|what (can i|to) ask|cosa ti posso chiedere|chi e brumoth|who is brumoth/, 4]],
  },
};

// ------------------------------------------------------------------ named materials and parts
// From the most specific to the most generic: a recognized part of the text is not reread by the following ones.
const MATERIALS = [
  { key: 'carbon-hm', it: 'high modulus carbon (M40)', re: /carbon\w* (ad )?alto modulo|high.?modulus( carbon)?|\bm40\b/, ref: 'dry-fabric-carbon-fibers/high-modulus-cf', role: 'fibre', carbon: true },
  { key: 'carbon-im', it: 'intermediate modulus carbon (T800)', re: /carbon\w* (a |di )?modulo intermedio|intermediate( modulus)?( carbon)?|carbon\w* im\b|\bt800\b/, ref: 'dry-fabric-carbon-fibers/int-modulus-cf', role: 'fibre', carbon: true },
  { key: 'carbon', it: 'standard carbon (T700)', re: /carbon\w*|\bt700\b|\bcfrp\b|\bcf\b/, ref: 'dry-fabric-carbon-fibers/std-modulus-cf', role: 'fibre', carbon: true },
  { key: 'basalt', it: 'basalt', re: /basalt\w*/, ref: 'dry-fabric-basalt-fibers', role: 'fibre' },
  { key: 'sglass', it: 'S glass', re: /vetro s\b|s.?glass/, ref: 'dry-fabric-glass-fibers/s-glass', role: 'fibre' },
  { key: 'glass', it: 'E glass', re: /vetro\w*|glass|vetroresina/, ref: 'dry-fabric-glass-fibers/e-glass', role: 'fibre' },
  { key: 'flax', it: 'flax', re: /\blino\b|flax/, ref: 'dry-fabric-flax', role: 'fibre' },
  { key: 'kevlar', it: 'kevlar (aramid)', re: /kevlar|aramid\w*/, ref: 'dry-fabric-aramid-fibers/kevlar', role: 'fibre' },
  { key: 'innegra', it: 'Innegra', re: /innegra/, ref: 'dry-fabric-innegra', role: 'fibre' },
  { key: 'bioepoxy', it: 'bio-based epoxy', re: /(epossidic\w*|resin\w*) bio\w*|bio.?based/, ref: 'bio-based-epoxy/lamination', role: 'resin' },
  { key: 'epoxy', it: 'epoxy resin', re: /resin\w*|epossidic\w*|epoxy/, ref: DEFAULT_MATRIX, role: 'resin' },
  { key: 'pet-rec', it: 'recycled PET', re: /pet riciclat\w*|\brpet\b|pet recycled|recycled pet/, ref: 'pet/recycled', role: 'core' },
  { key: 'pet', it: 'PET', re: /\bpet\b/, ref: 'pet/standard', role: 'core' },
  { key: 'pvc', it: 'PVC/SAN', re: /\bpvc\b/, ref: 'pvc-san', role: 'core' },
  { key: 'balsa', it: 'balsa', re: /\bbalsa\b/, ref: 'wood/balsa', role: 'core' },
  { key: 'mdf', it: 'MDF', re: /\bmdf\b|\bhdf\b/, ref: 'mdf-hdf-wood', role: 'other' },
];

/** Named materials, in the order they appear in the question. */
export function findMaterials(q) {
  let text = q;
  const found = [];
  for (const m of MATERIALS) {
    const match = text.match(m.re);
    if (!match) continue;
    found.push({ ...m, index: match.index });
    text = text.slice(0, match.index) + ' '.repeat(match[0].length) + text.slice(match.index + match[0].length);
  }
  return found.sort((a, b) => a.index - b.index);
}

// Part names (normalized part name -> alias) and Table 2 groups.
const PART_ALIASES = {
  hull: ['scafo', 'carena', '\\bhull\\b'],
  bulkheads: ['paratie', 'paratia', 'bulkhead'],
  'wing panel': ['pannell[oi] (delle |della )?terrazz\\w*', 'wing panels?', 'trampolin\\w*', 'tramp'],
  'wing frame': ['telai\\w* (delle |della )?terrazz\\w*', 'struttura (delle |della )?terrazz\\w*', 'wing frames?'],
  'main vertical': ['deriva', '\\bfin\\b', 'main vertical'],
};
const GROUP_ALIASES = {
  wingbars: ['terrazz\\w*', 'hiking rack\\w*', '\\bwing\\w*'],
  main_vertical: ['\\bmv\\b'],
  main_horizontal: ['\\bmh\\b', 'orizzontale (della |di )?deriva', 'ala (della |di )?deriva', 'main horizontal'],
  rudder_vertical: ['timone verticale', '\\brv\\b', 'pala (del )?timone', 'rudder vertical', 'vertical rudder', 'rudder blade'],
  rudder_horizontal: ['timone orizzontale', '\\brh\\b', 'orizzontale (del )?timone', 'rudder horizontal', 'horizontal rudder'],
};
const GENERIC_ALIASES = {
  rudder_vertical: ['timon\\w*', 'rudder\\w*'], rudder_horizontal: ['timon\\w*', 'rudder\\w*'],
  main_vertical: ['\\bfoil\\b', '\\bfoils\\b'], main_horizontal: ['\\bfoil\\b', '\\bfoils\\b'],
};
const COMPONENT_ALIASES = {
  hull: ['scafo', 'carena', 'hull'], foils: ['\\bfoil', 'deriva', '\\bfin\\b', 'timon', 'rudder'], mechanical_control: ['controllo meccanico', 'mechanical control', 'wand', 'meccanic', 'mechanic'],
  gantry: ['gantry'], wingbars: ['terrazz', 'wing', 'hiking'], rig: ['\\brig\\b', 'albero', '\\bmast\\b', '\\bvela\\b', '\\bsail\\b', 'boma', '\\bboom\\b', 'cime', 'ropes?', 'bozzell', 'blocks?'],
  electronics: ['elettronic', 'electronic'],
};

const has = (q, src) => new RegExp(src).test(q);

/** Laminated parts named in the question (exact name > part alias > Table 2 group alias > generic). */
export function findParts(q, ev) {
  const scored = (ev?.parts || []).map((pr) => {
    const p = pr.part;
    const name = normalize(p.name);
    let score = 0;
    if (name && q.includes(name)) score = 4;
    else if ((PART_ALIASES[name] || []).some((a) => has(q, a))) score = 3;
    else if ((GROUP_ALIASES[p.limitGroup] || []).some((a) => has(q, a))) score = 2;
    else if ((GENERIC_ALIASES[p.limitGroup] || []).some((a) => has(q, a))) score = 1;
    return { pr, score };
  });
  const best = Math.max(0, ...scored.map((s) => s.score));
  return best ? scored.filter((s) => s.score === best).map((s) => s.pr) : [];
}

/** Components (the 7 report categories) named in the question. */
export function findComponents(q, ev) {
  return (ev?.components || []).filter((c) => (COMPONENT_ALIASES[c.id] || []).some((a) => has(q, a)));
}

/** Quantities such as "2 kg", "500 g", "1,5 kg". */
function findAmount(q) {
  const m = q.match(/(\d+(?:[.,]\d+)?)\s*(kg|kilos?|kilograms?|chili|chilogrammi|g|grams?|grammi|gr)\b/);
  if (!m) return null;
  const v = Number(m[1].replace(',', '.'));
  return /^g/.test(m[2]) ? v / 1000 : v;
}

// ------------------------------------------------------------------ instradamento
/**
 * Topics of the question with their score, plus the named entities.
 * previous = {intents, entities} of the previous question, for follow-up questions ("and the hull?").
 */
export function route(question, { ev, previous } = {}) {
  const q = normalize(question);
  const scores = {};
  for (const [id, def] of Object.entries(INTENTS)) {
    let s = 0;
    for (const [re, w] of def.keys) if (re.test(q)) s += w;
    if (s) scores[id] = s;
  }
  const materials = findMaterials(q);
  const parts = findParts(q, ev);
  const components = findComponents(q, ev);
  const amount = findAmount(q);
  const entities = { materials, parts, components, amount, wantsWhere: /\bdove\b|\bwhere\b|troppo|too much|eccess|excess|sfor|sopra|classific|\bover\b/.test(q) };

  // the entities strengthen the related topics
  if (parts.length && !scores.whatif) scores.parts = (scores.parts || 0) + 1;
  if (materials.some((m) => m.carbon)) scores.carbon = (scores.carbon || 0) + 1;
  if (materials.length && !materials.some((m) => m.carbon)) scores.materials = (scores.materials || 0) + 1;
  if (scores.capacity) delete scores.budget; // "with the remaining budget…" asks what to buy, not the balance
  if (scores.whatif && (materials.length || amount)) scores.whatif += 2;

  let intents = Object.entries(scores).sort((a, b) => b[1] - a[1]).map(([id, score]) => ({ id, score }));
  const best = intents[0]?.score || 0;
  intents = intents.filter((x) => x.score >= Math.max(2, best * 0.6)).slice(0, 3);

  // follow-up question with no topic ("and for the hull?"): the previous topic is reused
  const followUp = !intents.length && previous?.intents?.length && (parts.length || materials.length || components.length || /^(e|ed|mentre|invece|anche|and|what about|also)\b/.test(q));
  if (followUp) intents = previous.intents.slice(0, 2).map((x) => ({ id: x.id, score: 1, followUp: true }));

  return { q, intents, entities, confident: best >= 2 || Boolean(followUp) };
}

// ------------------------------------------------------------------ supporting calculations
const sumBy = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
const factorOf = (rules, source) => rules.sources?.[source || 'new']?.factor ?? 1;
const priceOf = (ev, ref) => ev.catalog.get(ref)?.price ?? null;
const entryName = (e) => (e ? String(e.name || e.id).replace(/^Dry fabric\s+/i, '') : '');

/** Most used process and matrix in the project parts (for "laminate" estimates). */
function mainLayup(ev) {
  const byProc = {};
  const byMatrix = {};
  for (const pr of ev.parts) {
    for (const r of pr.substacks) {
      if (r.errors.length) continue;
      byProc[r.process.name] = (byProc[r.process.name] || 0) + r.fibre;
      byMatrix[r.input.matrix] = (byMatrix[r.input.matrix] || 0) + r.fibre;
    }
  }
  const top = (o, d) => Object.entries(o).sort((a, b) => b[1] - a[1])[0]?.[0] || d;
  return { process: top(byProc, DEFAULT_PROCESS), matrix: top(byMatrix, DEFAULT_MATRIX) };
}

/** kg of resin per kg of fibre with the Layup Calculator formulas (null if it cannot be calculated). */
function resinRatio(ctx, ev, fibreRef, matrixRef, process) {
  if (!ctx.spec) return null;
  const r = computeSubstack(ctx.spec, ev.catalog, { reinforcement: fibreRef, matrix: matrixRef, plyArea: 1, plies: 1, arealWeight: 1000, process });
  return r.errors.length || !r.fibre ? null : { ratio: r.resin / r.fibre, vf: r.vf };
}

/** Carbon room left per Table 2 group (virgin carbon only). */
function carbonRoom(ev) {
  return ev.carbon.map((g) => {
    const cf = g.checks.find((c) => c.key === 'cf');
    const cfrp = g.checks.find((c) => c.key === 'cfrp');
    return { id: g.id, en: g.en, cf: Math.max(0, cf.limit - cf.value), cfrp: Math.max(0, cfrp.limit - cfrp.value) };
  });
}

/** Cost of the laminate (fibre + resin) of a list of substack results, with prices and discounts. */
function layupCost(ev, results) {
  let cost = 0;
  for (const r of results) {
    if (r.errors.length) continue;
    cost += (r.fibre / 1000) * (priceOf(ev, r.input.reinforcement) ?? 0) * factorOf(ev.rules, r.input.reinforcementSource);
    cost += (r.resin / 1000) * (priceOf(ev, r.input.matrix) ?? 0) * factorOf(ev.rules, r.input.matrixSource);
  }
  return cost;
}

/** Cost of a part in the items: automatic rows of the part + items linked only to that part. */
function partCost(ev, part) {
  return sumBy(ev.lines.filter((l) => {
    if (l.line.auto) return l.id.startsWith(`${part.id}:`);
    const link = l.line.material?.check || l.line.material?.fromLayup;
    return link?.parts?.length === 1 && link.parts[0] === part.id;
  }), (l) => l.total);
}

const carbonOf = (pr) => {
  let cf = 0;
  let cfrp = 0;
  for (const v of Object.values(pr.carbon || {})) { cf += v.cf / 1000; cfrp += v.cfrp / 1000; }
  return { cf, cfrp };
};

// ------------------------------------------------------------------ blocks of facts
// Each block: {id, title, lines: [text], links: [{label, view, opts}]}

function budgetBlock(ev, ctx) {
  const r = ev.rules;
  const lines = [`Spent: ${sm(ev.total)} on a budget of ${sm(ev.budget)} (${pc(ev.total / ev.budget)} used).`];
  if (ev.margin > 0.005) {
    lines.push(`Remaining ${sm(ev.margin)} of margin.`);
    if (r.budgetStrict) lines.push(`The ${r.id} rules ask to stay under ${sm(ev.budget)}: exceeding it costs −${r.budgetPenalty} points (${r.refs.budget}).`);
  } else if (ev.margin < -0.005) {
    lines.push(`Budget exceeded by ${sm(-ev.margin)}${r.budgetPenalty ? `: costs −${r.budgetPenalty} points (${r.refs.budget})` : ''}.`);
  } else {
    lines.push(`The total is exactly at the budget limit${r.budgetStrict ? `: in ${r.id} must be kept below it, otherwise −${r.budgetPenalty} points` : ''}.`);
  }
  const top = [...ev.components].sort((a, b) => b.total - a.total)[0];
  if (top && ev.total > 0) lines.push(`The most expensive component is ${top.it} (${top.en}) with ${sm(top.total)}, ${pc(top.total / ev.total)} of the spending.`);
  if (r.sourcesToConfirm) {
    const disc = ev.lines.filter((l) => l.material && l.material.factor !== 1 && l.material.basePrice !== null);
    const saving = sumBy(disc, (l) => l.material.basePrice * (1 - l.material.factor) * l.material.qty);
    if (saving > 0.005) lines.push(`Warning: the total counts ${sm(saving)} of 2026 origin discounts (expired, surplus, upcycled) that the ${r.id} rules no longer mention. Without those discounts the total would be ${sm(ev.total + saving)}.`);
  }
  if (r.official?.provisional) lines.push(`The prices are from the 2026 price list, provisional until the ${r.id} price list on SuMoth Agora is available.`);
  if (ctx.evBase) lines.push(`In the S1 estimate the total was ${sm(ctx.evBase.total)} (difference ${signed(ev.total - ctx.evBase.total)}).`);
  return { id: 'budget', title: 'Budget', lines, links: [{ label: 'Overview', view: 'overview' }] };
}

function rankingBlock(ev) {
  const comps = [...ev.components].filter((c) => c.total > 0.005).sort((a, b) => b.total - a.total);
  const lines = ['Components from the most expensive:'];
  comps.forEach((c, i) => lines.push(`${i + 1}. ${c.it} (${c.en}): ${sm(c.total)}, ${pc(ev.total ? c.total / ev.total : 0)} of the spending`));
  if (!comps.length) lines.push('No item with a cost: the project is still empty.');
  const top = [...ev.lines].filter((l) => l.total > 0.005).sort((a, b) => b.total - a.total).slice(0, 5);
  if (top.length) {
    lines.push('The most expensive items:');
    top.forEach((l, i) => {
      const what = [l.material?.label, l.process?.label].filter(Boolean).join(' + ');
      lines.push(`${i + 1}. ${l.line.s2Label || l.name}${what ? ` (${what})` : ''}: ${sm(l.total)}`);
    });
  }
  return { id: 'ranking', title: 'Where the SM$ go', lines, links: [{ label: 'Cost items', view: 'lines' }] };
}

function carbonBlock(ev, entities = {}) {
  const lines = [];
  const groups = ev.carbon.filter((g) => g.hasCarbon).map((g) => {
    const active = g.checks.filter((c) => c.value > 0);
    return { g, active, worst: Math.max(...active.map((c) => c.ratio)) };
  }).sort((a, b) => b.worst - a.worst);
  const parts = ev.parts.map((pr) => ({ pr, ...carbonOf(pr) })).filter((x) => x.cfrp > 0).sort((a, b) => b.cfrp - a.cfrp);
  if (!groups.length) {
    const hull = ev.carbon.find((g) => g.id === 'hull');
    lines.push('No part contains carbon: all Table 2 limits are free.');
    if (hull) lines.push(`For example, the hull is allowed up to ${kg(hull.checks.find((c) => c.key === 'cfrp').limit)} of CFRP and ${kg(hull.checks.find((c) => c.key === 'cf').limit)} of dry carbon.`);
    return { id: 'carbon', title: 'Carbon (Table 2)', lines, links: [{ label: 'Overview', view: 'overview' }] };
  }
  const totCf = sumBy(parts, (x) => x.cf);
  const totCfrp = sumBy(parts, (x) => x.cfrp);
  lines.push(`The whole boat has ${gr(totCf)} of dry carbon (CF), that is ${gr(totCfrp)} of carbon laminate (CFRP, fibre + resin).`);
  lines.push('Table 2 groups from the closest to the limit:');
  for (const { g, active } of groups) {
    const parts2 = active.map((c) => `${c.label} ${grNear(c.value, c.limit)} of ${gr(c.limit)} (${pc(c.ratio)})`).join(', ');
    lines.push(`- ${g.en}: ${parts2}`);
  }
  const over = groups.flatMap(({ g, active }) => active.filter((c) => c.value > c.limit + 1e-9).map((c) => `${g.en} (${c.label}, ${grFine(c.value - c.limit)} over the limit)`));
  const near = groups.flatMap(({ g, active }) => active.filter((c) => c.value <= c.limit + 1e-9 && c.ratio >= 0.95).map((c) => `${g.en} (${c.label} at ${pc(c.ratio)})`));
  if (over.length) lines.push(`Too much carbon, over the limit: ${over.join('; ')}.`);
  if (near.length) lines.push(`Almost at the limit (95% or more): ${near.join('; ')}.`);
  if (!over.length && !near.length) lines.push('No group is over the limit or above 95%.');
  if (parts.length) lines.push(`Parts with the most carbon: ${parts.slice(0, 5).map((x) => `${x.pr.part.name} ${gr(x.cfrp)} of CFRP`).join(', ')}.`);
  return { id: 'carbon', title: 'Carbon (Table 2)', lines, links: [{ label: 'Overview', view: 'overview' }] };
}

function capacityBlock(ev, ctx, entities) {
  const lines = [];
  const M = ev.margin;
  if (M <= 0.005) {
    lines.push(M < -0.005 ? `No margin left: the budget is already exceeded by ${sm(-M)}.` : 'No margin left: the total is already at the budget limit.');
    return { id: 'capacity', title: 'What can still be bought', lines, links: [] };
  }
  const { process, matrix } = mainLayup(ev);
  const pm = priceOf(ev, matrix) ?? 25;
  const matrixName = entryName(ev.catalog.get(matrix)) || 'epoxy resin';
  let mats = entities.materials?.length ? entities.materials : [MATERIALS.find((m) => m.key === 'carbon')];
  if (!entities.materials?.length) mats = [MATERIALS.find((m) => m.key === 'carbon'), MATERIALS.find((m) => m.key === 'carbon-im')];
  lines.push(`Available margin: ${sm(M)}.`);
  for (const m of mats.slice(0, 3)) {
    const entry = ev.catalog.get(m.ref);
    const p = entry?.price;
    if (p === null || p === undefined) { lines.push(`${m.it}: price not in the price list.`); continue; }
    if (m.role === 'fibre') {
      const rr = resinRatio(ctx, ev, m.ref, matrix, process);
      if (p > 0) lines.push(`${m.it} (${nf(p, 0, 2)} SM$/kg): dry fibre only, about ${kg(M / p)}.`);
      else lines.push(`${m.it} costs 0 SM$/kg in the price list: only the resin is paid for.`);
      if (rr) {
        const perKg = p + rr.ratio * pm;
        const kgF = M / perKg;
        lines.push(`${m.it} laminated with ${matrixName} (${nf(pm, 0, 2)} SM$/kg, ${process}, Vf ${pc(rr.vf, 0)}): each kg of fibre brings ${kg(rr.ratio)} of resin, so the margin is enough for about ${kg(kgF)} of fibre, that is ${kg(kgF * (1 + rr.ratio))} of laminate.`);
        if (m.carbon) {
          const room = carbonRoom(ev);
          const roomCf = sumBy(room, (x) => x.cf);
          const roomCfrp = sumBy(room, (x) => x.cfrp);
          const allowedF = Math.min(roomCf, roomCfrp / (1 + rr.ratio));
          lines.push(`Table 2 limits: adding up all the groups, the rules still allow ${kg(roomCfrp)} of CFRP and ${kg(roomCf)} of dry carbon.`);
          if (kgF > allowedF + 1e-9) {
            lines.push(`So the budget cannot be used up with carbon alone: the limits stop you first, at about ${kg(allowedF)} of fibre (${kg(allowedF * (1 + rr.ratio))} of CFRP), which would cost ${sm(allowedF * perKg)}. Leftover: ${sm(M - allowedF * perKg)}.`);
          } else {
            lines.push('The margin runs out before reaching the Table 2 limits.');
          }
          const free = room.filter((x) => x.cfrp > 0.0005).sort((a, b) => b.cfrp - a.cfrp).slice(0, 4);
          if (free.length) lines.push(`Where there is most room: ${free.map((x) => `${x.en} ${kg(x.cfrp)} of CFRP`).join(', ')}. Each group has its own limit: they cannot be moved between groups.`);
        }
      }
    } else {
      lines.push(`${m.it} (${nf(p, 0, 2)} SM$/${entry.unit}): about ${nf(M / p, 2, 2)} ${entry.unit}.`);
    }
  }
  return { id: 'capacity', title: 'What can still be bought', lines, links: [{ label: 'Overview', view: 'overview' }] };
}

function issuesBlock(checks) {
  const errors = checks.filter((c) => c.level === 'error');
  const warnings = checks.filter((c) => c.level === 'warning');
  const infos = checks.filter((c) => c.level === 'info');
  const lines = [`Checks: ${errors.length} ${errors.length === 1 ? 'error' : 'errors'}, ${warnings.length} to check, ${infos.length} reminders.`];
  if (errors.length) { lines.push('Errors to fix:'); errors.slice(0, 8).forEach((c) => lines.push(`- ${c.message}`)); }
  if (warnings.length) { lines.push('To check:'); warnings.slice(0, 6).forEach((c) => lines.push(`- ${c.message}`)); }
  if (!errors.length && !warnings.length) lines.push('No errors and nothing to check.');
  return { id: 'issues', title: 'Checks', lines, links: [{ label: 'Open the checks', view: 'checks' }] };
}

function partsBlock(ev, entities) {
  const lines = [];
  const named = entities.parts || [];
  const list = named.length ? named : ev.parts;
  if (!list.length) return { id: 'parts', title: 'Laminated parts', lines: ['There are no laminated parts in the project.'], links: [{ label: 'Laminated parts', view: 'parts' }] };
  if (named.length) {
    for (const pr of named) {
      const p = pr.part;
      const c = carbonOf(pr);
      const fibres = [...new Set(pr.substacks.filter((r) => !r.errors.length).map((r) => entryName(r.reinforcement.entry)))].join(', ');
      lines.push(`${p.name}: ${pr.substacks.length} substack (${fibres || 'no fibre'}), fibre ${gr(pr.totals.fibres / 1000)}, resin ${gr(pr.totals.resin / 1000)}, calculated mass ${kg(pr.computedMass)}${pr.core ? ` (core ${kg(pr.core.mass)})` : ''}.`);
      if (c.cfrp > 0) lines.push(`  Carbon: ${gr(c.cf)} of dry CF, ${gr(c.cfrp)} of CFRP.`);
      const cost = partCost(ev, p);
      if (cost > 0.005) lines.push(`  Cost in the items: ${sm(cost)}.`);
      else if (p.autoLines === false) lines.push('  The costs of this part are in items written by hand together with other parts.');
      if (pr.measuredMass !== null) lines.push(`  Real weighed weight: ${kg(pr.measuredMass)}.`);
    }
  } else {
    const rows = [...ev.parts].sort((a, b) => b.computedMass - a.computedMass);
    lines.push(`${rows.length} laminated parts, total calculated mass ${kg(sumBy(rows, (r) => r.computedMass))}:`);
    for (const pr of rows) lines.push(`- ${pr.part.name}: ${kg(pr.computedMass)} (fibre ${gr(pr.totals.fibres / 1000)}, resin ${gr(pr.totals.resin / 1000)})`);
  }
  return { id: 'parts', title: 'Laminated parts', lines, links: named.length === 1 ? [{ label: `Open ${named[0].part.name}`, view: 'parts', opts: { part: named[0].part.id } }] : [{ label: 'Laminated parts', view: 'parts' }] };
}

function materialsBlock(ev, entities) {
  const lines = [];
  const agg = new Map();
  for (const l of ev.lines) {
    if (!l.material) continue;
    const key = `${l.material.entry?.id || l.material.labelBase}|${l.material.unit}`;
    const a = agg.get(key) || { label: l.material.labelBase || l.material.label, unit: l.material.unit, ref: l.material.entry?.id, qty: 0, cost: 0 };
    a.qty += l.material.qty;
    a.cost += l.material.cost;
    agg.set(key, a);
  }
  const named = entities.materials || [];
  for (const m of named.slice(0, 3)) {
    const e = ev.catalog.get(m.ref);
    if (!e) continue;
    lines.push(`Price list: ${entryName(e)} costs ${e.price === null ? 'a price to request' : `${nf(e.price, 0, 2)} SM$/${e.unit}`}.`);
    const used = [...agg.values()].filter((a) => a.ref === m.ref);
    if (used.length) used.forEach((a) => lines.push(`In the project: ${nf(a.qty, 0, 3)} ${a.unit} of ${a.label}, ${sm(a.cost)}.`));
    else lines.push(`The project does not have ${m.it}.`);
  }
  const top = [...agg.values()].filter((a) => a.cost > 0.005 || a.qty > 0).sort((a, b) => b.cost - a.cost).slice(0, named.length ? 4 : 8);
  if (top.length) {
    lines.push('Project materials from the most expensive:');
    top.forEach((a) => lines.push(`- ${a.label}: ${nf(a.qty, 0, 3)} ${a.unit}, ${sm(a.cost)}`));
  }
  if (ev.rules.official?.provisional) lines.push(`Prices from the 2026 price list (provisional for ${ev.rules.id}).`);
  return { id: 'materials', title: 'Materials', lines, links: [{ label: 'Price list', view: 'catalog' }] };
}

/** Simulates changing the fibre in the given parts (same areas, plies and areal weights). */
export function simulateSwap(ev, ctx, parts, from, to) {
  const out = [];
  for (const pr of parts) {
    const subs = pr.part.substacks || [];
    const pick = (s) => {
      const e = ev.catalog.get(s.reinforcement);
      if (!from) return s.reinforcement !== to.ref;
      if (from.carbon) return /carbon/i.test(`${e?.group} ${e?.name}`);
      return s.reinforcement === from.ref;
    };
    const changed = subs.filter(pick);
    if (!changed.length) continue;
    const newSubs = subs.map((s) => (pick(s) ? { ...s, reinforcement: to.ref, carbonSource: undefined, reinforcementSource: s.reinforcementSource === 'upcycled' ? 'new' : s.reinforcementSource } : s));
    const after = newSubs.map((s) => computeSubstack(ctx.spec, ev.catalog, s));
    const costBefore = layupCost(ev, pr.substacks);
    const costAfter = layupCost(ev, after);
    const massBefore = sumBy(pr.substacks, (r) => r.total) / 1000;
    const massAfter = sumBy(after, (r) => r.total) / 1000;
    const carbonBefore = carbonOf(pr);
    let cfrpAfter = 0;
    for (const r of after) if (!r.errors.length && r.reinforcement?.carbon) cfrpAfter += (r.fibre + r.resin) / 1000;
    out.push({
      part: pr.part, changed: changed.length, costBefore, costAfter, delta: costAfter - costBefore,
      massBefore, massAfter, cfrpBefore: carbonBefore.cfrp, cfrpAfter,
      errors: after.flatMap((r) => r.errors), inCalculator: after.every((r) => r.errors.length || r.inCalculator),
    });
  }
  return out;
}

function whatIfBlock(ev, ctx, entities) {
  const lines = [];
  const mats = entities.materials || [];
  const parts = entities.parts || [];
  const title = 'Simulation';
  // "what if I add 2 kg of carbon (in the hull)?"
  if (entities.amount && mats.length) {
    const m = mats[mats.length - 1];
    const e = ev.catalog.get(m.ref);
    if (e?.price !== null && e?.price !== undefined) {
      const qty = entities.amount;
      let cost = qty * e.price;
      let resinNote = '';
      if (m.role === 'fibre') {
        const { process, matrix } = mainLayup(ev);
        const rr = resinRatio(ctx, ev, m.ref, matrix, process);
        if (rr) {
          const resinKg = qty * rr.ratio;
          cost += resinKg * (priceOf(ev, matrix) ?? 0);
          resinNote = ` plus ${kg(resinKg)} of resin to laminate it (${process})`;
        }
      }
      lines.push(`Adding ${kg(qty)} of ${m.it}${resinNote} costs ${sm(cost)}.`);
      lines.push(`The total would go from ${sm(ev.total)} a ${sm(ev.total + cost)}; the margin from ${sm(ev.margin)} a ${sm(ev.margin - cost)}${ev.margin - cost < 0 ? ', that is budget exceeded' : ''}.`);
      if (m.carbon) {
        const rr = resinRatio(ctx, ev, m.ref, mainLayup(ev).matrix, mainLayup(ev).process);
        const groups = parts.length ? [...new Set(parts.map((p) => p.part.limitGroup || 'other'))] : [];
        for (const gid of groups) {
          const room = carbonRoom(ev).find((x) => x.id === gid);
          if (!room) continue;
          const cfrp = qty * (1 + (rr?.ratio || 0));
          lines.push(`${room.en}: remaining ${kg(room.cf)} of CF and ${kg(room.cfrp)} of CFRP; with this addition ${qty > room.cf + 1e-9 || cfrp > room.cfrp + 1e-9 ? 'the Table 2 limit would be exceeded' : 'it stays within the Table 2 limits'}.`);
        }
        if (!groups.length) lines.push('Tell me which part it goes in (e.g. hull, fin, wings) to check the Table 2 limit of that group.');
      }
      return { id: 'whatif', title, lines, links: [] };
    }
  }
  // "what if I made the fin in basalt?" / "if I replace the carbon with glass"
  if (!ctx.spec) return { id: 'whatif', title, lines: ['Simulation not available: the Layup Calculator is missing.'], links: [] };
  let to = mats.length ? mats[mats.length - 1] : null;
  let from = mats.length > 1 ? mats[0] : null;
  if (to && from && to.key === from.key) from = null;
  // "instead of carbon": the material named after "instead of" is the one to remove
  const q = entities.q || '';
  const insteadIdx = Math.max(q.indexOf('invece'), q.indexOf('al posto'), q.indexOf('instead of'));
  if (mats.length > 1 && insteadIdx >= 0) {
    const afterInstead = mats.filter((m) => m.index > insteadIdx);
    const beforeInstead = mats.filter((m) => m.index < insteadIdx);
    if (afterInstead.length && beforeInstead.length) { from = afterInstead[0]; to = beforeInstead[beforeInstead.length - 1]; }
  }
  if (to && to.role !== 'fibre') to = null;
  if (!to && mats.length === 1 && mats[0].carbon) { from = mats[0]; to = MATERIALS.find((m) => m.key === 'basalt'); lines.push('You did not say what to replace the carbon with: trying with basalt.'); }
  if (!to) return { id: 'whatif', title, lines: ['To simulate, tell me which fibre to use and in which part, for example: "what if I made the fin in basalt?" or "what if I add 2 kg of carbon in the hull?".'], links: [] };
  const targets = parts.length ? parts : ev.parts.filter((pr) => pr.substacks.some((r) => (from ? (from.carbon ? r.reinforcement?.carbon : r.input.reinforcement === from.ref) : r.input.reinforcement !== to.ref)));
  const sims = simulateSwap(ev, ctx, targets, from, to);
  if (!sims.length) return { id: 'whatif', title, lines: [`No substack to change: ${parts.length ? 'the given parts' : 'no part'} ${from ? `uses ${from.it}` : `uses a fibre other than ${to.it}`}.`], links: [] };
  const toName = to.it;
  lines.push(`Assumption: fibre replaced with ${toName} with the same areas, plies and areal weights (${kg(1)} of fibre stays ${kg(1)}); the resin is recalculated with the Layup Calculator formulas.`);
  for (const s of sims) {
    lines.push(`- ${s.part.name} (${s.changed} substacks): laminate from ${sm(s.costBefore)} a ${sm(s.costAfter)} (${signed(s.delta)}); laminate mass from ${kg(s.massBefore)} a ${kg(s.massAfter)}${s.cfrpBefore > 0 ? `; CFRP from ${gr(s.cfrpBefore)} a ${gr(s.cfrpAfter)}` : ''}.`);
    if (s.part.autoLines === false) lines.push(`  Note: in this project the costs of ${s.part.name} are in items written by hand, to be updated separately.`);
    if (s.errors.length) lines.push(`  Problem: ${s.errors[0]}.`);
    else if (!s.inCalculator) lines.push(`  ${toName} does not exist in the official Layup Calculator: it cannot be entered in the official file.`);
  }
  const delta = sumBy(sims, (s) => s.delta);
  lines.push(`In total: ${signed(delta)}. The total would go from ${sm(ev.total)} a ${sm(ev.total + delta)}, the margin to ${sm(ev.margin - delta)}.`);
  lines.push('Warning: with the same plies the stiffness changes a lot (carbon is much stiffer than basalt, glass and flax): the sizing must be redone before deciding.');
  return { id: 'whatif', title, lines, links: sims.length === 1 ? [{ label: `Open ${sims[0].part.name}`, view: 'parts', opts: { part: sims[0].part.id } }] : [] };
}

/** Calculated savings ideas, from the largest. */
export function savingIdeas(ev, ctx) {
  const ideas = [];
  // equivalent recycled material in the price list (PET, EPS, XPS, MDF…)
  for (const l of ev.lines) {
    const m = l.material;
    if (!m?.entry || m.entry.extra || !(m.qty > 0) || !(m.unitPrice > 0)) continue;
    const id = m.entry.id;
    const prefix = id.includes('/') ? id.split('/')[0] : id.split('-').slice(0, 2).join('-');
    const alt = [...ev.catalog.values()].find((e) => e.id !== id && !e.extra && e.kind === m.entry.kind && e.id.startsWith(prefix) && /recycl/i.test(`${e.type} ${e.id}`) && e.price !== null && e.price < m.basePrice);
    if (!alt) continue;
    const saving = m.cost - m.qty * alt.price * m.factor;
    if (saving > 0.005) ideas.push({ kind: 'recycled', saving, text: `${l.line.s2Label || l.name}: use ${entryName(alt)} (${nf(alt.price, 0, 2)} SM$/${alt.unit}) instead of ${entryName(m.entry)} saves ${sm(saving)}.`, target: l.id });
  }
  // carbon -> basalt, part by part
  if (ctx.spec) {
    const basalt = MATERIALS.find((m) => m.key === 'basalt');
    const carbon = MATERIALS.find((m) => m.key === 'carbon');
    for (const s of simulateSwap(ev, ctx, ev.parts.filter((pr) => carbonOf(pr).cfrp > 0), carbon, basalt)) {
      if (s.delta < -0.005) ideas.push({ kind: 'basalt', saving: -s.delta, text: `${s.part.name}: carbon to basalt would save ${sm(-s.delta)} of laminate (mass from ${kg(s.massBefore)} a ${kg(s.massAfter)}, stiffness to be rechecked).`, target: s.part.id });
    }
  }
  // hourly processes
  for (const l of ev.lines) {
    if (l.process && l.process.cost >= 100 && l.process.rate > 0) {
      ideas.push({ kind: 'hours', saving: l.process.rate * Math.min(5, l.process.hours), text: `${l.line.s2Label || l.name}: ${nf(l.process.hours, 0, 1)} h of ${l.process.label} cost ${sm(l.process.cost)}; each hour less is worth ${sm(l.process.rate)}.`, target: l.id });
    }
  }
  // industrial surplus (−25%) on the most expensive material paid at full price
  const full = ev.lines.filter((l) => l.material && l.material.factor === 1 && l.material.cost > 50 && !l.usedPart).sort((a, b) => b.material.cost - a.material.cost)[0];
  if (full && ev.rules.sources.industrial_excess) {
    const saving = full.material.cost * (1 - ev.rules.sources.industrial_excess.factor);
    ideas.push({ kind: 'excess', saving, text: `${full.line.s2Label || full.name}: if ${full.material.label} came from industrial surplus (−25%) it would save ${sm(saving)}${ev.rules.sourcesToConfirm ? ' (discount to be confirmed on SuMoth Agora for the ' + ev.rules.id + ')' : ''}.`, target: full.id });
  }
  return ideas.sort((a, b) => b.saving - a.saving);
}

function savingsBlock(ev, ctx) {
  const ideas = savingIdeas(ev, ctx).slice(0, 6);
  const top = [...ev.lines].filter((l) => l.total > 0.005).sort((a, b) => b.total - a.total).slice(0, 3);
  const lines = [];
  if (top.length) lines.push(`The 3 heaviest items: ${top.map((l) => `${l.line.s2Label || l.name} ${sm(l.total)}`).join('; ')}.`);
  if (ideas.length) { lines.push('Savings ideas calculated on the project:'); ideas.forEach((x) => lines.push(`- ${x.text}`)); }
  else lines.push('I find no obvious savings with the price list: the most expensive materials are already discounted or have no recycled alternatives.');
  return { id: 'savings', title: 'How to save money', lines, links: [{ label: 'Cost items', view: 'lines' }] };
}

function rulesBlock(ev, q) {
  const r = ev.rules;
  const lines = [`Rulebook in use: ${r.title}.`];
  const all = !/(budget|scont|discount|scadut|expired|shelf|eccedenz|surplus|upcycl|carbon|cfrp|tab(ella|\.|le)? ?[234]|performance|punt|point|scart|waste|usat|used|agora|listino|price list|penal)/.test(q);
  if (all || /budget|penal/.test(q)) lines.push(`Budget: ${sm(r.budget)}${r.budgetStrict ? `, to keep under; exceeding it costs −${r.budgetPenalty} points` : ', limit included'} (${r.refs.budget}).`);
  if (all || /scont|discount|scadut|expired|shelf|eccedenz|surplus|upcycl/.test(q)) {
    const s = r.sources;
    lines.push(`Origin discounts: industrial surplus −${pc(1 - s.industrial_excess.factor, 0)}, out of shelf life −${pc(1 - s.out_of_shelf_life.factor, 0)}, upcycled −${pc(1 - s.upcycled.factor, 0)} (${r.refs.sources}).${r.sourcesToConfirm ? ` The ${r.id} rules no longer mention them: to be confirmed on SuMoth Agora.` : ''}`);
    lines.push(`Upcycled elements must be described with origin and transformation (${r.refs.upcycled}).${r.upcycledHullNonFoiling ? ' In 2027 an upcycled hull is allowed only if it originally came from a non-foiling boat (§6.2.1).' : ''}`);
  }
  if (all || /carbon|cfrp|tab(ella|\.|le)? ?2/.test(q)) {
    const i = r.carbonGroups.findIndex((g) => g.id === 'hull');
    lines.push(`Table 2: carbon limits by group (hull, wings, each of the 4 foils, gantry, rig, other). For the hull: ${kg(r.carbonLimits.cfrp[i])} of CFRP, ${kg(r.carbonLimits.cf[i])} of dry carbon; recycled or upcycled carbon has higher limits.`);
  }
  if ((all && r.performance) || /performance|punt|point|tab(ella|\.|le)? ?3/.test(q)) {
    if (r.performance) lines.push(`Performance Rating (Table 3, §11): for 15 components the points of conditions a)–g) add up (e.g. c) recycled materials, b) built by outsiders); commercial sails, masts and foils produced from ${r.performance.commercial.fromYear} are worth ${r.performance.commercial.points} points each barring damage (§11.1.5).`);
    else lines.push('The 2026 rulebook has no Performance Rating: it had Table 3 of used parts at a fixed cost.');
  }
  if (/scart|waste/.test(q) || (all && r.wasteTracking)) lines.push(r.wasteTracking ? 'Waste: in S2 material waste must also be tracked (§9.2.2); in Dollaroni it is entered in the parts and in the item details.' : 'In the 2026 rulebook waste does not have to be declared.');
  if (/usat|used|agora|listino|price list/.test(q)) {
    if (r.usedPartYearIndex) lines.push('Used parts (2026 Table 3): fixed cost (1,500 SM$ for vertical foils, 500 for horizontal ones, 0 for sail and mast) plus a handicap depending on the year of production.');
    else lines.push('Used parts: in 2027 there is no fixed cost, they are paid at the stated price (from SuMoth Agora) with the year of production.');
    if (r.official?.provisional) lines.push('Price list: in 2027 it is on SuMoth Agora, open to admitted teams; until it can be seen the 2026 one is used, marked provisional.');
  }
  return { id: 'rules', title: 'Rules', lines, links: [] };
}

function compareBlock(ev, ctx) {
  if (!ctx.evBase) {
    return { id: 'compare', title: 'S1 → S2 comparison', lines: [ev.project?.stage === 'S2' ? "No reference S1 is linked: link it from \"S1→S2 comparison\"." : 'The comparison is done in S2: from Overview, "Freeze S1 and create S2".'], links: [{ label: 'Comparison', view: 'compare' }] };
  }
  const c = compareStages(ctx.evBase, ev);
  const lines = [`S1 total ${sm(c.total.s1)}, S2 ${sm(c.total.s2)}: ${signed(c.total.delta)} (${pc(c.total.variation)}).`];
  const rows = c.rows.filter((r) => r.delta === null || Math.abs(r.delta) > 0.005).sort((a, b) => Math.abs(b.delta ?? b.s2) - Math.abs(a.delta ?? a.s2));
  rows.forEach((r) => lines.push(`- ${r.component}: ${r.isNew ? `new in S2, ${sm(r.s2)}` : `from ${sm(r.s1)} to ${sm(r.s2)} (${signed(r.delta)})`}`));
  return { id: 'compare', title: 'S1 → S2 comparison', lines, links: [{ label: 'Comparison', view: 'compare' }] };
}

function performanceBlock(ev) {
  const p = ev.performance;
  if (!p) return { id: 'performance', title: 'Performance Rating', lines: [`The ${ev.rules.id} rulebook of the project has no Performance Rating (it exists from 2027).`], links: [] };
  const lines = [`Performance Rating: ${p.total > 0 ? '+' : ''}${p.total} points (components ${p.componentsPoints}, commercial parts ${p.commercialPoints}). Components declared: ${p.declaredCount} of ${p.components.length}.`];
  p.components.filter((c) => c.points).forEach((c) => lines.push(`- ${c.it}: ${c.points > 0 ? '+' : ''}${c.points} (conditions ${c.met.join(', ')})`));
  p.commercial.filter((c) => c.points).forEach((c) => lines.push(`- ${c.name}: ${c.points} (commercial${c.year === null ? ', year not stated' : ` from ${c.year}`})`));
  return { id: 'performance', title: 'Performance Rating', lines, links: [{ label: 'Performance Rating', view: 'performance' }] };
}

function helpBlock() {
  return {
    id: 'help', title: 'Brumoth',
    lines: [
      'I am Brumoth, the Dollaroni assistant: I answer with the numbers calculated on the open project. For example you can ask me:',
      '- how much budget is left and how much we have spent;',
      '- where the SM$ go (ranking of components and items);',
      '- how the carbon stands against the Table 2 limits and where there is too much;',
      '- how much carbon (or basalt, resin…) can still be bought with the margin;',
      '- what to fix before submitting;',
      '- simulations: "what if I made the fin in basalt?", "what if I add 2 kg of carbon in the hull?";',
      '- savings ideas, rulebook rules, S1→S2 comparison;',
      '- changes to the project, always with **Apply** / **Cancel**: "add 2 kg of carbon to the hull", "create a part called Spare rudder in the foils", "make the fin in basalt", "add the material Carbon/Innegra at 160 SM$/kg with density 1.3";',
      '- instructions on the app: "how do I add a material that is missing?", "how do I export the report?".',
    ],
    links: [],
  };
}

function summaryBlock(ev, checks) {
  const errors = checks.filter((c) => c.level === 'error').length;
  const top = [...ev.components].sort((a, b) => b.total - a.total)[0];
  const worst = ev.carbon.flatMap((g) => g.checks.filter((c) => c.value > 0).map((c) => ({ g, c }))).sort((a, b) => b.c.ratio - a.c.ratio)[0];
  const lines = [
    `Project "${ev.project?.name || ''}" ${ev.project?.season || ''} ${ev.project?.stage || ''}, rules ${ev.rules.id}.`,
    `Total ${sm(ev.total)} of ${sm(ev.budget)}, margin ${sm(ev.margin)}.`,
  ];
  if (top && top.total > 0) lines.push(`Most expensive component: ${top.it} with ${sm(top.total)}.`);
  if (worst) lines.push(`Carbon closest to the limit: ${worst.g.en}, ${worst.c.label} at ${pc(worst.c.ratio)}.`);
  lines.push(errors ? (errors === 1 ? "There is 1 error in the checks." : `There are ${errors} errors in the checks.`) : 'No errors in the checks.');
  return { id: 'summary', title: 'In short', lines, links: [] };
}

// ------------------------------------------------------------------ risposta
const BUILDERS = {
  budget: (ev, ctx) => budgetBlock(ev, ctx),
  capacity: (ev, ctx, e) => capacityBlock(ev, ctx, e),
  ranking: (ev) => rankingBlock(ev),
  carbon: (ev, ctx, e) => carbonBlock(ev, e),
  issues: (ev, ctx) => issuesBlock(ctx.checks || []),
  parts: (ev, ctx, e) => partsBlock(ev, e),
  materials: (ev, ctx, e) => materialsBlock(ev, e),
  savings: (ev, ctx) => savingsBlock(ev, ctx),
  whatif: (ev, ctx, e) => whatIfBlock(ev, ctx, e),
  rules: (ev, ctx, e) => rulesBlock(ev, e.q),
  compare: (ev, ctx) => compareBlock(ev, ctx),
  performance: (ev) => performanceBlock(ev),
  help: () => helpBlock(),
};

/**
 * Answers a question.
 * ctx = {ev, checks, spec (Layup Calculator), evBase (frozen S1, if any), previous (previous route), intents (forced)}
 * Returns {question, route, blocks, text, facts, understood}.
 */
/** Block for a change request: proposed actions, what is missing, notes. */
function commandBlock(cmd, howto) {
  const lines = [];
  if (cmd.actions.length) {
    lines.push(howto
      ? 'If you want, I can do it: check the change below and press **Apply**, or **Cancel**.'
      : 'Here is what I would change. Check the preview and press **Apply**, or **Cancel**: I change nothing without your OK.');
  }
  if (cmd.missing.length) {
    if (howto || cmd.actions.length) lines.push(`To do the rest I need: ${cmd.missing.join('; ')}.`);
    else lines.push(`The request is too generic: I need ${cmd.missing.join('; ')}.`);
  }
  lines.push(...cmd.notes);
  const title = cmd.actions.length ? (howto ? 'I can do it' : 'Proposed change') : howto ? 'I can do it' : 'I need some details';
  return { id: 'command', title, lines, links: [] };
}

/** Preview (total, margin, new problems) of each proposed action. */
function withPreview(actions, ctx) {
  const evalCtx = ctx.catalogEntries ? { spec: ctx.spec, catalogEntries: ctx.catalogEntries, rules: ctx.ev.rules } : null;
  return actions.map((a) => ({ ...a, preview: evalCtx && ctx.ev.project ? previewAction(a, ctx.ev.project, evalCtx) : null }));
}

export function answer(question, ctx) {
  const { ev } = ctx;
  const r = route(question, { ev, previous: ctx.previous });
  r.entities.q = r.q;

  // change requests ("add…", "create…") and instructions ("how do I…"): answer without AI, with Apply/Cancel
  if (!ctx.intents?.length && (isHowTo(r.q) || isCommand(r.q))) {
    const howto = isHowTo(r.q);
    const cmd = parseCommand(question, ctx);
    if (howto || (cmd && !(cmd.generic && r.intents.length))) {
      const blocks = [];
      if (howto) blocks.push(howToBlock(question, ev));
      if (cmd && (cmd.actions.length || cmd.notes.length || (!howto && cmd.missing.length) || (howto && cmd.missing.length && !cmd.generic))) blocks.push(commandBlock(cmd, howto));
      const text = blocks.map((b) => `**${b.title}**\n${b.lines.join('\n')}`).join('\n\n');
      return {
        question, route: r, intents: [howto ? 'howto' : 'command'], blocks, text, facts: blocks.map((b) => `[${b.title}]\n${b.lines.join('\n')}`).join('\n\n'),
        understood: true, noLLM: true, actions: withPreview(cmd?.actions || [], ctx),
      };
    }
  }
  let ids = ctx.intents?.length ? ctx.intents : r.intents.map((x) => x.id);
  // carbon capacity: the limits situation is added ("where there is too much")
  if (ids.includes('capacity') && (!r.entities.materials.length || r.entities.materials.some((m) => m.carbon)) && !ids.includes('carbon') && r.entities.wantsWhere) ids = [...ids, 'carbon'];
  if (ids.includes('capacity') && r.entities.wantsWhere && /classific|\brank/.test(r.q) && !ids.includes('ranking')) ids = [...ids, 'ranking'];
  // a greeting ("hi Brumoth") gets the introduction
  if (!ids.length && /^(ciao|salve|buongiorno|buonasera|hey|ehi|hola|hi|hello|good (morning|evening))\b/.test(r.q) && r.q.split(' ').length <= 4) ids = ['help'];
  const understood = ids.length > 0;
  if (!understood) ids = ['summary'];
  const blocks = ids.map((id) => (id === 'summary' ? summaryBlock(ev, ctx.checks || []) : BUILDERS[id](ev, ctx, r.entities))).filter(Boolean);
  const text = blocks.map((b) => `**${b.title}**\n${b.lines.join('\n')}`).join('\n\n');
  const facts = blocks.map((b) => `[${b.title}]\n${b.lines.join('\n')}`).join('\n\n');
  // a simulation that can really be applied ("what if I made the fin in basalt?") also offers Apply/Cancel
  let actions = [];
  if (ids.includes('whatif')) actions = withPreview(parseCommand(question, ctx)?.actions || [], ctx);
  return { question, route: r, intents: ids, blocks, text, facts, understood, actions };
}

// ------------------------------------------------------------------ local AI: messages and checks
export const SYSTEM_PROMPT = `You are Brumoth, the assistant of "Dollaroni", the Sapienza Foiling Team app that calculates the boat's SuMoth Dollars (SM$) for the SuMoth Challenge. If asked who you are, answer that you are Brumoth.
Rules:
- Answer in English, briefly and directly: at most 6 sentences or a short bulleted list.
- Use ONLY the information in the DATA. The DATA is calculated by the app and is exact.
- Do not invent numbers and do not make new calculations: report the numbers in the DATA with their units (SM$, kg, g, %).
- Answer the question first; add a suggestion only if it is in the DATA.
- If what is needed is missing from the DATA, say so and indicate which section of the app to look at.
- If the question is not about the boat, the costs or the SuMoth rules, answer that you can only help with that.`;

/** Messages for the local AI. history = [{question, reply}] of the previous questions (only the last is used). */
export function buildMessages(ans, history = []) {
  const msgs = [{ role: 'system', content: SYSTEM_PROMPT }];
  const last = history[history.length - 1];
  if (last?.reply) {
    msgs.push({ role: 'user', content: last.question });
    msgs.push({ role: 'assistant', content: String(last.reply).slice(0, 500) });
  }
  const note = ans.understood ? '' : '\n(The question does not match a precise topic: this is the general data of the project.)';
  msgs.push({ role: 'user', content: `DATA (calculated by Dollaroni):\n${ans.facts}${note}\n\nQUESTION: ${ans.question}` });
  return msgs;
}

/** For questions the keywords do not recognize: the AI chooses the topic with one word. */
export function routerMessages(question) {
  const list = Object.entries(INTENTS).map(([id, d]) => `${id} = ${d.desc}`).join('\n');
  return [
    { role: 'system', content: `You classify questions asked to an app that calculates the costs (SuMoth Dollars) of a racing boat. Topics:\n${list}\naltro = none of the above\nAnswer with ONE word only: the name of the topic.` },
    { role: 'user', content: question },
  ];
}
/** Topic read from the model's answer (null if it is not one of those expected). */
export function parseRouterReply(text) {
  const t = normalize(text);
  return Object.keys(INTENTS).find((id) => new RegExp(`\\b${id}\\b`).test(t)) || null;
}

// Numeri: "1.577,64", "1577,64", "1,577.64", "15,8", "3".
const NUM_RE = /\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?/g;

/** Possible values of a number written in Italian or English. */
function readings(s) {
  const out = new Set();
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) out.add(Number(s.replace(/\./g, '').replace(',', '.')));
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) out.add(Number(s.replace(/,/g, '')));
  if (/^\d+,\d+$/.test(s)) out.add(Number(s.replace(',', '.')));
  if (/^\d+\.\d+$/.test(s)) out.add(Number(s));
  if (/^\d+$/.test(s)) out.add(Number(s));
  if (/^\d{1,3}\.\d{3}$/.test(s)) out.add(Number(s)); // "1.000" can also be 1.0 in English
  return [...out].filter(Number.isFinite);
}

/**
 * Numbers in the AI answer that do not appear in the facts (not even rounded).
 * Small integers (lists, counts), years and references to the rulebook (§10.1, Table 2) are ignored.
 */
export function verifyNumbers(reply, facts) {
  const factVals = [];
  for (const m of String(facts).matchAll(NUM_RE)) factVals.push(...readings(m[0]));
  const out = [];
  const text = String(reply);
  for (const m of text.matchAll(NUM_RE)) {
    const s = m[0];
    const before = text.slice(Math.max(0, m.index - 6), m.index);
    if (/(§|tab\.?\s?|tabella\s|table\s|sezione\s|section\s|regola\s|rule\s)$/i.test(before)) continue;
    const vals = readings(s);
    if (!vals.length) continue;
    if (vals.every((v) => Number.isInteger(v) && (v <= 12 || (v >= 2010 && v <= 2035)))) continue;
    const dec = (s.match(/[.,](\d+)$/)?.[1] || '').length;
    const ok = vals.some((v) => factVals.some((f) => {
      if (Math.abs(f - v) <= 1e-6 * Math.max(1, Math.abs(f))) return true;
      // rounding to fewer decimals (1,58 -> 1,6) or to integers (1.577,64 -> 1.578)
      for (let d = 0; d <= Math.max(dec, 2); d += 1) if (Math.abs(Number(f.toFixed(d)) - v) < 1e-9) return true;
      return false;
    }));
    if (!ok) out.push(s);
  }
  return [...new Set(out)];
}

/** Suggested questions based on the open project. */
export function suggestedQuestions(ev, checks = []) {
  const out = ['How much budget do we have left?', 'Where do we spend the most?'];
  const hasCarbon = ev.carbon.some((g) => g.hasCarbon);
  out.push(hasCarbon ? "Where is there too much carbon?" : 'How much carbon can we use?');
  out.push('How much carbon is needed to use up the budget?');
  if (checks.some((c) => c.level === 'error' || c.level === 'warning')) out.push('What do we need to fix?');
  const withCarbon = ev.parts.find((pr) => carbonOf(pr).cfrp > 0);
  if (withCarbon) out.push(`What if I made ${withCarbon.part.name} in basalt?`);
  out.push('How can we save money?');
  out.push("How do I add a material that is missing?");
  if (ev.project?.stage === 'S2' && ev.project?.baseline) out.push("What changed compared with S1?");
  return out.slice(0, 8);
}
