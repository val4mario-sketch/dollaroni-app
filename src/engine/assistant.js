// Brumoth, l'assistente di Dollaroni: risponde alle domande sul progetto con i numeri calcolati dal motore.
//
// Come funziona:
//  1. route()  capisce di cosa parla la domanda (parole chiave in italiano) e quali pezzi e materiali nomina;
//  2. answer() per ogni argomento prepara un "blocco di fatti" con i numeri del motore (evaluate, runChecks, layup);
//  3. il testo dei blocchi è già una risposta completa: è quella che si vede se l'IA locale è spenta;
//  4. l'IA locale (src/ai/llm.js) riceve gli stessi blocchi con buildMessages() e li spiega a parole.
//     Non calcola niente: verifyNumbers() segnala i numeri della sua risposta che non compaiono nei fatti.
//
// Modulo puro (niente DOM), testato in tests/assistant.test.js.

import { computeSubstack } from './layup.js';
import { compareStages } from './reports.js';
import { isCommand, isHowTo, parseCommand, howToBlock, previewAction } from './actions.js';

// ------------------------------------------------------------------ formati (italiano)
const nf = (x, min, max) => Number(x || 0).toLocaleString('it-IT', { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: 'always' });
const sm = (x) => `${nf(x, 2, 2)} SM$`;
const kg = (x, d = 2) => `${nf(x, d, d)} kg`;
const gr = (kgValue) => `${nf(Math.round(kgValue * 1000), 0, 0)} g`;
/** Grammi con i decimali solo quando servono (es. 0,04 g oltre il limite). */
const grFine = (kgValue) => `${nf(kgValue * 1000, 0, Math.abs(kgValue * 1000) < 10 ? 2 : 0)} g`;
/** Valore vicino al limite: con 2 decimali se la differenza è sotto il grammo (1.000,04 g su 1.000 g). */
const grNear = (value, limit) => `${nf(value * 1000, 0, Math.abs(value - limit) * 1000 < 1 ? 2 : 0)} g`;
const pc = (x, d = 1) => `${nf(x * 100, d, d)}%`;
const signed = (x) => `${x > 0.005 ? '+' : x < -0.005 ? '−' : ''}${nf(Math.abs(x), 2, 2)} SM$`;

const DEFAULT_PROCESS = 'HAND LAYUP + VAC';
const DEFAULT_MATRIX = 'std-epoxy/lamination-resin';

// ------------------------------------------------------------------ testo
/** Minuscolo, senza accenti, punteggiatura semplificata: "Quant'è il budget?" -> "quant'e il budget". */
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
// Ogni argomento ha parole chiave (regex sul testo normalizzato) con un peso.
export const INTENTS = {
  budget: {
    it: 'Budget e margine',
    desc: 'quanto si è speso, quanto resta, margine sul budget, sforamenti',
    keys: [
      [/\bbudget\b/, 2], [/\bmargin[ei]\b/, 2], [/\brimast[oaie]\b|\brimane\b|\brimangono\b|\bresta(no)?\b|\bavanza\b/, 1],
      [/\bspes[aeo]\b|\bspeso\b|\bspendiamo\b|\bspendere\b|\bspeso\b/, 1], [/\btotale\b/, 1], [/\bsforat|\bsforiamo|\bsforare\b/, 2],
      [/\bsoldi\b|\bdollar|\bsm\$|\bsmd?\b/, 1], [/quanto (abbiamo|ho|hai|avete) (gia )?(speso|usato)/, 2],
    ],
  },
  capacity: {
    it: 'Cosa si può ancora comprare',
    desc: 'quanto materiale (es. carbonio) si può ancora comprare o aggiungere con il budget che resta',
    keys: [
      [/(finire|esaurire|consumare|riempire|spendere tutto|usare tutto|chiudere|arrivare a)( tutto)?( il| l'| al)? ?(budget|margine|10[.]?000)/, 3],
      [/(posso|possiamo|potrei|potremmo|riesco|riusciamo|si puo|si possono) (ancora )?(comprare|aggiungere|mettere|permetter|usare|prendere|spendere)/, 3],
      [/quant[oaie]? .{0,40}(serv|ci vuole|ci vogliono|ne serve|ne servono|ce ne sta|ce ne stanno|ne posso).{0,40}(finire|esaurire|budget|margine)/, 3],
      [/con (quello|quel|cio) che (resta|rimane|avanza)|con il (margine|budget) (rimast|che rest|che riman|residu)/, 3],
      [/fino a (finire|esaurire)/, 2],
    ],
  },
  ranking: {
    it: 'Classifica dei costi',
    desc: 'classifica dei componenti e delle voci più costose, dove vanno i soldi',
    keys: [
      [/classific|ranking|graduatoria|\bordin(e|a|ati?) per\b/, 3], [/piu (car[oaie]|costos[oaie])|costano di piu|costa di piu|spendiamo di piu|maggior[ei] (cost|spes)/, 3],
      [/dove (vanno|finiscono|spendiamo|se ne vanno|si spende|va il)/, 3], [/ripartizion|suddivision|per componente|breakdown|distribuzion/, 2],
      [/\btop\b|principal[ei] (voci|cost)|voci principali|pesa di piu|pesano di piu/, 2],
    ],
  },
  carbon: {
    it: 'Carbonio e limiti Tab. 2',
    desc: 'quanto carbonio c\'è, limiti della Tabella 2, dove ce n\'è troppo',
    keys: [[/carbon/, 3], [/\bcfrp\b|\bcf\b/, 3], [/tab(ella|\.)? ?2\b/, 2], [/limit[ei]? (di |del )?carbon/, 2]],
  },
  issues: {
    it: 'Errori e cose da sistemare',
    desc: 'errori, avvisi e controlli da sistemare prima della consegna',
    keys: [
      [/error|sbagliat|problem|\bcontroll|avvis|warning|\bcheck/, 3], [/sistemar|correggere|da fare|cosa (manca|non va|devo fare|dobbiamo fare)/, 3],
      [/va bene\b|tutto (ok|a posto|in regola|giusto)|conform|in regola|e corretto|e giusto/, 2],
    ],
  },
  parts: {
    it: 'Pezzi laminati e masse',
    desc: 'pezzi laminati, masse, pesi, fibra e resina di ogni pezzo',
    keys: [[/\bpezz[oi]\b|laminat|substack|\bply\b|\bstrat[oi]\b/, 2], [/\bmass[ae]\b|\bpes[oai]\b|quanto pesa|pesano|\bgramm/, 2]],
  },
  materials: {
    it: 'Materiali e prezzi',
    desc: 'materiali usati, quantità, prezzi del listino',
    keys: [
      [/material[ei]|\bfibr[ae]\b|\bresin[ae]\b|epossidic|\banim[ae]\b|\bcore\b|consumabil/, 2],
      [/listino|prezz[oi]|quanto costa|costa al (kg|chilo)|al chilo|al kg/, 3],
    ],
  },
  savings: {
    it: 'Come risparmiare',
    desc: 'idee per ridurre i costi in SM$',
    keys: [[/risparmi|ridurre|abbassare|tagliare|limare|ottimizz|scendere|meno (soldi|costi|spes)|economic|conveni/, 3], [/consigl|suggeriment|idee|alternativ/, 2]],
  },
  whatif: {
    it: 'Simulazione "e se…"',
    desc: 'simulare una modifica: cambiare materiale a un pezzo o aggiungere materiale',
    keys: [
      [/\be se\b|cosa succede se|cosa cambia se|che succede se|simula|ipotesi|ipotizz/, 3],
      [/\bse (sostitu|cambi|usass|usiamo|uso|faccio|facess|facciamo|mettess|mettiamo|metto|aggiung|toglie|togli|passass|passiamo)/, 3],
      [/al posto d|invece d|(sostituire|sostituendo|cambiare|cambiando|rifare) .{0,30}(con|in) /, 2],
    ],
  },
  rules: {
    it: 'Regolamento',
    desc: 'regole SuMoth: budget, sconti, limiti, Performance Rating, scarti, parti usate',
    keys: [
      [/regol|regolament|\bnorm[ae]\b|ammess|consentit|vietat|obbligator|\bsi puo\b/, 2], [/penal|\bpunt[oi]\b/, 2],
      [/scont|scadut|shelf|eccedenz|upcycl/, 2], [/agora|§|tab(ella|\.)? ?[34]\b|scart[oi]|parti usate|usat[oie] /, 2],
    ],
  },
  compare: {
    it: 'Confronto S1 → S2',
    desc: 'differenze tra la stima S1 e il consuntivo S2',
    keys: [[/confront|rispetto (all'? ?|a ?)s1|differenz|variazion|cambiat[oaie]? rispetto|stima vs|as.?built/, 3], [/\bs1\b|\bs2\b/, 1]],
  },
  performance: {
    it: 'Performance Rating',
    desc: 'punti del Performance Rating 2027 (Tab. 3)',
    keys: [[/performance|rating/, 3], [/condizion[ei] (a|b|c|d|e|f|g)\b|commercial/, 2]],
  },
  help: {
    it: 'Cosa so fare',
    desc: "cosa può fare l'assistente",
    keys: [[/\baiuto\b|\bhelp\b|cosa (sai|puoi) fare|come funzion|chi sei|che domande|cosa ti posso chiedere|chi e brumoth/, 4]],
  },
};

// ------------------------------------------------------------------ materiali e pezzi nominati
// Dal più specifico al più generico: una parte di testo riconosciuta non viene riletta dai successivi.
const MATERIALS = [
  { key: 'carbon-hm', it: 'carbonio ad alto modulo (M40)', re: /carbon\w* (ad )?alto modulo|\bm40\b/, ref: 'dry-fabric-carbon-fibers/high-modulus-cf', role: 'fibre', carbon: true },
  { key: 'carbon-im', it: 'carbonio a modulo intermedio (T800)', re: /carbon\w* (a |di )?modulo intermedio|carbon\w* im\b|\bt800\b/, ref: 'dry-fabric-carbon-fibers/int-modulus-cf', role: 'fibre', carbon: true },
  { key: 'carbon', it: 'carbonio standard (T700)', re: /carbon\w*|\bt700\b|\bcfrp\b|\bcf\b/, ref: 'dry-fabric-carbon-fibers/std-modulus-cf', role: 'fibre', carbon: true },
  { key: 'basalt', it: 'basalto', re: /basalt\w*/, ref: 'dry-fabric-basalt-fibers', role: 'fibre' },
  { key: 'sglass', it: 'vetro S', re: /vetro s\b|s.?glass/, ref: 'dry-fabric-glass-fibers/s-glass', role: 'fibre' },
  { key: 'glass', it: 'vetro E', re: /vetro\w*|glass|vetroresina/, ref: 'dry-fabric-glass-fibers/e-glass', role: 'fibre' },
  { key: 'flax', it: 'lino', re: /\blino\b|flax/, ref: 'dry-fabric-flax', role: 'fibre' },
  { key: 'kevlar', it: 'kevlar (aramide)', re: /kevlar|aramid\w*/, ref: 'dry-fabric-aramid-fibers/kevlar', role: 'fibre' },
  { key: 'innegra', it: 'Innegra', re: /innegra/, ref: 'dry-fabric-innegra', role: 'fibre' },
  { key: 'bioepoxy', it: 'epossidica bio-based', re: /(epossidic\w*|resin\w*) bio\w*|bio.?based/, ref: 'bio-based-epoxy/lamination', role: 'resin' },
  { key: 'epoxy', it: 'resina epossidica', re: /resin\w*|epossidic\w*|epoxy/, ref: DEFAULT_MATRIX, role: 'resin' },
  { key: 'pet-rec', it: 'PET riciclato', re: /pet riciclat\w*|\brpet\b|pet recycled/, ref: 'pet/recycled', role: 'core' },
  { key: 'pet', it: 'PET', re: /\bpet\b/, ref: 'pet/standard', role: 'core' },
  { key: 'pvc', it: 'PVC/SAN', re: /\bpvc\b/, ref: 'pvc-san', role: 'core' },
  { key: 'balsa', it: 'balsa', re: /\bbalsa\b/, ref: 'wood/balsa', role: 'core' },
  { key: 'mdf', it: 'MDF', re: /\bmdf\b|\bhdf\b/, ref: 'mdf-hdf-wood', role: 'other' },
];

/** Materiali nominati, nell'ordine in cui compaiono nella domanda. */
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

// Nomi italiani dei pezzi (nome del pezzo normalizzato -> alias) e dei gruppi della Tab. 2.
const PART_ALIASES = {
  hull: ['scafo', 'carena'],
  bulkheads: ['paratie', 'paratia', 'bulkhead'],
  'wing panel': ['pannell[oi] (delle |della )?terrazz\\w*', 'trampolin\\w*', 'tramp'],
  'wing frame': ['telai\\w* (delle |della )?terrazz\\w*', 'struttura (delle |della )?terrazz\\w*'],
  'main vertical': ['deriva'],
};
const GROUP_ALIASES = {
  wingbars: ['terrazz\\w*', 'hiking rack\\w*', '\\bwing\\w*'],
  main_vertical: ['\\bmv\\b'],
  main_horizontal: ['\\bmh\\b', 'orizzontale (della |di )?deriva', 'ala (della |di )?deriva'],
  rudder_vertical: ['timone verticale', '\\brv\\b', 'pala (del )?timone'],
  rudder_horizontal: ['timone orizzontale', '\\brh\\b', 'orizzontale (del )?timone'],
};
const GENERIC_ALIASES = {
  rudder_vertical: ['timon\\w*'], rudder_horizontal: ['timon\\w*'],
  main_vertical: ['\\bfoil\\b', '\\bfoils\\b'], main_horizontal: ['\\bfoil\\b', '\\bfoils\\b'],
};
const COMPONENT_ALIASES = {
  hull: ['scafo', 'carena', 'hull'], foils: ['\\bfoil', 'deriva', 'timon'], mechanical_control: ['controllo meccanico', 'wand', 'meccanic'],
  gantry: ['gantry'], wingbars: ['terrazz', 'wing', 'hiking'], rig: ['\\brig\\b', 'albero', '\\bvela\\b', 'boma', 'cime', 'bozzell'],
  electronics: ['elettronic'],
};

const has = (q, src) => new RegExp(src).test(q);

/** Pezzi laminati nominati nella domanda (nome esatto > alias del pezzo > alias del gruppo Tab. 2 > generico). */
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

/** Componenti (le 7 categorie dei report) nominati nella domanda. */
export function findComponents(q, ev) {
  return (ev?.components || []).filter((c) => (COMPONENT_ALIASES[c.id] || []).some((a) => has(q, a)));
}

/** Quantità tipo "2 kg", "500 g", "1,5 kg". */
function findAmount(q) {
  const m = q.match(/(\d+(?:[.,]\d+)?)\s*(kg|chili|chilogrammi|g|grammi|gr)\b/);
  if (!m) return null;
  const v = Number(m[1].replace(',', '.'));
  return /^g|gr/.test(m[2]) && !/^ch/.test(m[2]) ? v / 1000 : v;
}

// ------------------------------------------------------------------ instradamento
/**
 * Argomenti della domanda con punteggio, più le entità nominate.
 * previous = {intents, entities} della domanda precedente, per le domande di seguito ("e lo scafo?").
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
  const entities = { materials, parts, components, amount, wantsWhere: /\bdove\b|troppo|eccess|sfor|sopra|classific/.test(q) };

  // le entità rafforzano gli argomenti collegati
  if (parts.length && !scores.whatif) scores.parts = (scores.parts || 0) + 1;
  if (materials.some((m) => m.carbon)) scores.carbon = (scores.carbon || 0) + 1;
  if (materials.length && !materials.some((m) => m.carbon)) scores.materials = (scores.materials || 0) + 1;
  if (scores.capacity) delete scores.budget; // "con il budget che resta…" chiede cosa comprare, non il saldo
  if (scores.whatif && (materials.length || amount)) scores.whatif += 2;

  let intents = Object.entries(scores).sort((a, b) => b[1] - a[1]).map(([id, score]) => ({ id, score }));
  const best = intents[0]?.score || 0;
  intents = intents.filter((x) => x.score >= Math.max(2, best * 0.6)).slice(0, 3);

  // domanda di seguito senza argomento ("e per lo scafo?"): si riusa l'argomento precedente
  const followUp = !intents.length && previous?.intents?.length && (parts.length || materials.length || components.length || /^(e|ed|mentre|invece|anche)\b/.test(q));
  if (followUp) intents = previous.intents.slice(0, 2).map((x) => ({ id: x.id, score: 1, followUp: true }));

  return { q, intents, entities, confident: best >= 2 || Boolean(followUp) };
}

// ------------------------------------------------------------------ calcoli di supporto
const sumBy = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
const factorOf = (rules, source) => rules.sources?.[source || 'new']?.factor ?? 1;
const priceOf = (ev, ref) => ev.catalog.get(ref)?.price ?? null;
const entryName = (e) => (e ? String(e.name || e.id).replace(/^Dry fabric\s+/i, '') : '');

/** Processo e matrice più usati nei pezzi del progetto (per le stime "a laminato"). */
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

/** kg di resina per kg di fibra con le formule del Layup Calculator (null se non calcolabile). */
function resinRatio(ctx, ev, fibreRef, matrixRef, process) {
  if (!ctx.spec) return null;
  const r = computeSubstack(ctx.spec, ev.catalog, { reinforcement: fibreRef, matrix: matrixRef, plyArea: 1, plies: 1, arealWeight: 1000, process });
  return r.errors.length || !r.fibre ? null : { ratio: r.resin / r.fibre, vf: r.vf };
}

/** Spazio di carbonio rimasto per gruppo della Tab. 2 (solo carbonio vergine). */
function carbonRoom(ev) {
  return ev.carbon.map((g) => {
    const cf = g.checks.find((c) => c.key === 'cf');
    const cfrp = g.checks.find((c) => c.key === 'cfrp');
    return { id: g.id, en: g.en, cf: Math.max(0, cf.limit - cf.value), cfrp: Math.max(0, cfrp.limit - cfrp.value) };
  });
}

/** Costo del laminato (fibra + resina) di una lista di risultati substack, con prezzi e sconti. */
function layupCost(ev, results) {
  let cost = 0;
  for (const r of results) {
    if (r.errors.length) continue;
    cost += (r.fibre / 1000) * (priceOf(ev, r.input.reinforcement) ?? 0) * factorOf(ev.rules, r.input.reinforcementSource);
    cost += (r.resin / 1000) * (priceOf(ev, r.input.matrix) ?? 0) * factorOf(ev.rules, r.input.matrixSource);
  }
  return cost;
}

/** Costo di un pezzo nelle voci: righe automatiche del pezzo + voci collegate solo a quel pezzo. */
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

// ------------------------------------------------------------------ blocchi di fatti
// Ogni blocco: {id, title, lines: [testo], links: [{label, view, opts}]}

function budgetBlock(ev, ctx) {
  const r = ev.rules;
  const lines = [`Speso: ${sm(ev.total)} su un budget di ${sm(ev.budget)} (${pc(ev.total / ev.budget)} usato).`];
  if (ev.margin > 0.005) {
    lines.push(`Restano ${sm(ev.margin)} di margine.`);
    if (r.budgetStrict) lines.push(`Il regolamento ${r.id} chiede di restare sotto i ${sm(ev.budget)}: sforare costa −${r.budgetPenalty} punti (${r.refs.budget}).`);
  } else if (ev.margin < -0.005) {
    lines.push(`Budget superato di ${sm(-ev.margin)}${r.budgetPenalty ? `: costa −${r.budgetPenalty} punti (${r.refs.budget})` : ''}.`);
  } else {
    lines.push(`Il totale è esattamente al limite del budget${r.budgetStrict ? `: nel ${r.id} va tenuto sotto, altrimenti −${r.budgetPenalty} punti` : ''}.`);
  }
  const top = [...ev.components].sort((a, b) => b.total - a.total)[0];
  if (top && ev.total > 0) lines.push(`Il componente che costa di più è ${top.it} (${top.en}) con ${sm(top.total)}, il ${pc(top.total / ev.total)} della spesa.`);
  if (r.sourcesToConfirm) {
    const disc = ev.lines.filter((l) => l.material && l.material.factor !== 1 && l.material.basePrice !== null);
    const saving = sumBy(disc, (l) => l.material.basePrice * (1 - l.material.factor) * l.material.qty);
    if (saving > 0.005) lines.push(`Attenzione: il totale conta ${sm(saving)} di sconti di provenienza del 2026 (scaduto, eccedenza, upcycled) che il regolamento ${r.id} non cita più. Senza quegli sconti il totale sarebbe ${sm(ev.total + saving)}.`);
  }
  if (r.official?.provisional) lines.push(`I prezzi sono quelli del listino 2026, provvisori finché non si vede il listino ${r.id} su SuMoth Agora.`);
  if (ctx.evBase) lines.push(`Nella stima S1 il totale era ${sm(ctx.evBase.total)} (differenza ${signed(ev.total - ctx.evBase.total)}).`);
  return { id: 'budget', title: 'Budget', lines, links: [{ label: 'Panoramica', view: 'overview' }] };
}

function rankingBlock(ev) {
  const comps = [...ev.components].filter((c) => c.total > 0.005).sort((a, b) => b.total - a.total);
  const lines = ['Componenti dal più costoso:'];
  comps.forEach((c, i) => lines.push(`${i + 1}. ${c.it} (${c.en}): ${sm(c.total)}, ${pc(ev.total ? c.total / ev.total : 0)} della spesa`));
  if (!comps.length) lines.push('Nessuna voce con un costo: il progetto è ancora vuoto.');
  const top = [...ev.lines].filter((l) => l.total > 0.005).sort((a, b) => b.total - a.total).slice(0, 5);
  if (top.length) {
    lines.push('Le voci più care:');
    top.forEach((l, i) => {
      const what = [l.material?.label, l.process?.label].filter(Boolean).join(' + ');
      lines.push(`${i + 1}. ${l.line.s2Label || l.name}${what ? ` (${what})` : ''}: ${sm(l.total)}`);
    });
  }
  return { id: 'ranking', title: 'Dove vanno i SM$', lines, links: [{ label: 'Voci di costo', view: 'lines' }] };
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
    lines.push('Nessun pezzo contiene carbonio: tutti i limiti della Tab. 2 sono liberi.');
    if (hull) lines.push(`Per esempio nello scafo sono ammessi fino a ${kg(hull.checks.find((c) => c.key === 'cfrp').limit)} di CFRP e ${kg(hull.checks.find((c) => c.key === 'cf').limit)} di carbonio secco.`);
    return { id: 'carbon', title: 'Carbonio (Tab. 2)', lines, links: [{ label: 'Panoramica', view: 'overview' }] };
  }
  const totCf = sumBy(parts, (x) => x.cf);
  const totCfrp = sumBy(parts, (x) => x.cfrp);
  lines.push(`In tutta la barca ci sono ${gr(totCf)} di carbonio secco (CF), cioè ${gr(totCfrp)} di laminato di carbonio (CFRP, fibra + resina).`);
  lines.push('Gruppi della Tab. 2 dal più vicino al limite:');
  for (const { g, active } of groups) {
    const parts2 = active.map((c) => `${c.label} ${grNear(c.value, c.limit)} su ${gr(c.limit)} (${pc(c.ratio)})`).join(', ');
    lines.push(`- ${g.en}: ${parts2}`);
  }
  const over = groups.flatMap(({ g, active }) => active.filter((c) => c.value > c.limit + 1e-9).map((c) => `${g.en} (${c.label}, ${grFine(c.value - c.limit)} oltre il limite)`));
  const near = groups.flatMap(({ g, active }) => active.filter((c) => c.value <= c.limit + 1e-9 && c.ratio >= 0.95).map((c) => `${g.en} (${c.label} al ${pc(c.ratio)})`));
  if (over.length) lines.push(`Troppo carbonio, oltre il limite: ${over.join('; ')}.`);
  if (near.length) lines.push(`Quasi al limite (95% o più): ${near.join('; ')}.`);
  if (!over.length && !near.length) lines.push('Nessun gruppo è oltre il limite o sopra il 95%.');
  if (parts.length) lines.push(`Pezzi con più carbonio: ${parts.slice(0, 5).map((x) => `${x.pr.part.name} ${gr(x.cfrp)} di CFRP`).join(', ')}.`);
  return { id: 'carbon', title: 'Carbonio (Tab. 2)', lines, links: [{ label: 'Panoramica', view: 'overview' }] };
}

function capacityBlock(ev, ctx, entities) {
  const lines = [];
  const M = ev.margin;
  if (M <= 0.005) {
    lines.push(M < -0.005 ? `Non resta margine: il budget è già superato di ${sm(-M)}.` : 'Non resta margine: il totale è già al limite del budget.');
    return { id: 'capacity', title: 'Cosa si può ancora comprare', lines, links: [] };
  }
  const { process, matrix } = mainLayup(ev);
  const pm = priceOf(ev, matrix) ?? 25;
  const matrixName = entryName(ev.catalog.get(matrix)) || 'resina epossidica';
  let mats = entities.materials?.length ? entities.materials : [MATERIALS.find((m) => m.key === 'carbon')];
  if (!entities.materials?.length) mats = [MATERIALS.find((m) => m.key === 'carbon'), MATERIALS.find((m) => m.key === 'carbon-im')];
  lines.push(`Margine disponibile: ${sm(M)}.`);
  for (const m of mats.slice(0, 3)) {
    const entry = ev.catalog.get(m.ref);
    const p = entry?.price;
    if (p === null || p === undefined) { lines.push(`${m.it}: prezzo non presente nel listino.`); continue; }
    if (m.role === 'fibre') {
      const rr = resinRatio(ctx, ev, m.ref, matrix, process);
      if (p > 0) lines.push(`${m.it} (${nf(p, 0, 2)} SM$/kg): solo fibra secca, circa ${kg(M / p)}.`);
      else lines.push(`${m.it} costa 0 SM$/kg nel listino: si paga solo la resina.`);
      if (rr) {
        const perKg = p + rr.ratio * pm;
        const kgF = M / perKg;
        lines.push(`${m.it} laminato con ${matrixName} (${nf(pm, 0, 2)} SM$/kg, ${process}, Vf ${pc(rr.vf, 0)}): ogni kg di fibra porta ${kg(rr.ratio)} di resina, quindi il margine basta per circa ${kg(kgF)} di fibra, cioè ${kg(kgF * (1 + rr.ratio))} di laminato.`);
        if (m.carbon) {
          const room = carbonRoom(ev);
          const roomCf = sumBy(room, (x) => x.cf);
          const roomCfrp = sumBy(room, (x) => x.cfrp);
          const allowedF = Math.min(roomCf, roomCfrp / (1 + rr.ratio));
          lines.push(`Limiti Tab. 2: sommando tutti i gruppi, il regolamento consente ancora ${kg(roomCfrp)} di CFRP e ${kg(roomCf)} di carbonio secco.`);
          if (kgF > allowedF + 1e-9) {
            lines.push(`Quindi il budget non si riesce a finire solo con il carbonio: i limiti fermano prima, a circa ${kg(allowedF)} di fibra (${kg(allowedF * (1 + rr.ratio))} di CFRP), che costerebbero ${sm(allowedF * perKg)}. Avanzerebbero ${sm(M - allowedF * perKg)}.`);
          } else {
            lines.push('Il margine finisce prima di arrivare ai limiti della Tab. 2.');
          }
          const free = room.filter((x) => x.cfrp > 0.0005).sort((a, b) => b.cfrp - a.cfrp).slice(0, 4);
          if (free.length) lines.push(`Dove c'è più spazio: ${free.map((x) => `${x.en} ${kg(x.cfrp)} di CFRP`).join(', ')}. Ogni gruppo ha il suo limite: non si possono spostare tra gruppi.`);
        }
      }
    } else {
      lines.push(`${m.it} (${nf(p, 0, 2)} SM$/${entry.unit}): circa ${nf(M / p, 2, 2)} ${entry.unit}.`);
    }
  }
  return { id: 'capacity', title: 'Cosa si può ancora comprare', lines, links: [{ label: 'Panoramica', view: 'overview' }] };
}

function issuesBlock(checks) {
  const errors = checks.filter((c) => c.level === 'error');
  const warnings = checks.filter((c) => c.level === 'warning');
  const infos = checks.filter((c) => c.level === 'info');
  const lines = [`Controlli: ${errors.length} ${errors.length === 1 ? 'errore' : 'errori'}, ${warnings.length} da verificare, ${infos.length} promemoria.`];
  if (errors.length) { lines.push('Errori da sistemare:'); errors.slice(0, 8).forEach((c) => lines.push(`- ${c.message}`)); }
  if (warnings.length) { lines.push('Da verificare:'); warnings.slice(0, 6).forEach((c) => lines.push(`- ${c.message}`)); }
  if (!errors.length && !warnings.length) lines.push('Nessun errore e niente da verificare.');
  return { id: 'issues', title: 'Controlli', lines, links: [{ label: 'Apri i controlli', view: 'checks' }] };
}

function partsBlock(ev, entities) {
  const lines = [];
  const named = entities.parts || [];
  const list = named.length ? named : ev.parts;
  if (!list.length) return { id: 'parts', title: 'Pezzi laminati', lines: ['Nel progetto non ci sono pezzi laminati.'], links: [{ label: 'Pezzi laminati', view: 'parts' }] };
  if (named.length) {
    for (const pr of named) {
      const p = pr.part;
      const c = carbonOf(pr);
      const fibres = [...new Set(pr.substacks.filter((r) => !r.errors.length).map((r) => entryName(r.reinforcement.entry)))].join(', ');
      lines.push(`${p.name}: ${pr.substacks.length} substack (${fibres || 'nessuna fibra'}), fibra ${gr(pr.totals.fibres / 1000)}, resina ${gr(pr.totals.resin / 1000)}, massa calcolata ${kg(pr.computedMass)}${pr.core ? ` (anima ${kg(pr.core.mass)})` : ''}.`);
      if (c.cfrp > 0) lines.push(`  Carbonio: ${gr(c.cf)} di CF secco, ${gr(c.cfrp)} di CFRP.`);
      const cost = partCost(ev, p);
      if (cost > 0.005) lines.push(`  Costo nelle voci: ${sm(cost)}.`);
      else if (p.autoLines === false) lines.push('  I costi di questo pezzo sono in voci scritte a mano insieme ad altri pezzi.');
      if (pr.measuredMass !== null) lines.push(`  Peso reale pesato: ${kg(pr.measuredMass)}.`);
    }
  } else {
    const rows = [...ev.parts].sort((a, b) => b.computedMass - a.computedMass);
    lines.push(`${rows.length} pezzi laminati, massa calcolata totale ${kg(sumBy(rows, (r) => r.computedMass))}:`);
    for (const pr of rows) lines.push(`- ${pr.part.name}: ${kg(pr.computedMass)} (fibra ${gr(pr.totals.fibres / 1000)}, resina ${gr(pr.totals.resin / 1000)})`);
  }
  return { id: 'parts', title: 'Pezzi laminati', lines, links: named.length === 1 ? [{ label: `Apri ${named[0].part.name}`, view: 'parts', opts: { part: named[0].part.id } }] : [{ label: 'Pezzi laminati', view: 'parts' }] };
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
    lines.push(`Listino: ${entryName(e)} costa ${e.price === null ? 'un prezzo da chiedere' : `${nf(e.price, 0, 2)} SM$/${e.unit}`}.`);
    const used = [...agg.values()].filter((a) => a.ref === m.ref);
    if (used.length) used.forEach((a) => lines.push(`Nel progetto: ${nf(a.qty, 0, 3)} ${a.unit} di ${a.label}, ${sm(a.cost)}.`));
    else lines.push(`Nel progetto non c'è ${m.it}.`);
  }
  const top = [...agg.values()].filter((a) => a.cost > 0.005 || a.qty > 0).sort((a, b) => b.cost - a.cost).slice(0, named.length ? 4 : 8);
  if (top.length) {
    lines.push('Materiali del progetto dal più costoso:');
    top.forEach((a) => lines.push(`- ${a.label}: ${nf(a.qty, 0, 3)} ${a.unit}, ${sm(a.cost)}`));
  }
  if (ev.rules.official?.provisional) lines.push(`Prezzi dal listino 2026 (provvisorio per il ${ev.rules.id}).`);
  return { id: 'materials', title: 'Materiali', lines, links: [{ label: 'Listino', view: 'catalog' }] };
}

/** Simula il cambio di fibra nei pezzi indicati (stesse aree, strati e grammature). */
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
  const title = 'Simulazione';
  // "e se aggiungo 2 kg di carbonio (nello scafo)?"
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
          resinNote = ` più ${kg(resinKg)} di resina per laminarlo (${process})`;
        }
      }
      lines.push(`Aggiungere ${kg(qty)} di ${m.it}${resinNote} costa ${sm(cost)}.`);
      lines.push(`Il totale passerebbe da ${sm(ev.total)} a ${sm(ev.total + cost)}; il margine da ${sm(ev.margin)} a ${sm(ev.margin - cost)}${ev.margin - cost < 0 ? ', cioè budget superato' : ''}.`);
      if (m.carbon) {
        const rr = resinRatio(ctx, ev, m.ref, mainLayup(ev).matrix, mainLayup(ev).process);
        const groups = parts.length ? [...new Set(parts.map((p) => p.part.limitGroup || 'other'))] : [];
        for (const gid of groups) {
          const room = carbonRoom(ev).find((x) => x.id === gid);
          if (!room) continue;
          const cfrp = qty * (1 + (rr?.ratio || 0));
          lines.push(`${room.en}: restano ${kg(room.cf)} di CF e ${kg(room.cfrp)} di CFRP; con questa aggiunta ${qty > room.cf + 1e-9 || cfrp > room.cfrp + 1e-9 ? 'si supererebbe il limite della Tab. 2' : 'si resta nei limiti della Tab. 2'}.`);
        }
        if (!groups.length) lines.push('Dimmi in quale pezzo va (es. scafo, deriva, terrazze) per controllare il limite della Tab. 2 di quel gruppo.');
      }
      return { id: 'whatif', title, lines, links: [] };
    }
  }
  // "e se facessi la deriva in basalto?" / "se sostituisco il carbonio con il vetro"
  if (!ctx.spec) return { id: 'whatif', title, lines: ['Simulazione non disponibile: manca il Layup Calculator.'], links: [] };
  let to = mats.length ? mats[mats.length - 1] : null;
  let from = mats.length > 1 ? mats[0] : null;
  if (to && from && to.key === from.key) from = null;
  // "invece del carbonio" / "al posto del carbonio": il materiale citato dopo "invece/al posto" è quello da togliere
  const q = entities.q || '';
  const insteadIdx = Math.max(q.indexOf('invece'), q.indexOf('al posto'));
  if (mats.length > 1 && insteadIdx >= 0) {
    const afterInstead = mats.filter((m) => m.index > insteadIdx);
    const beforeInstead = mats.filter((m) => m.index < insteadIdx);
    if (afterInstead.length && beforeInstead.length) { from = afterInstead[0]; to = beforeInstead[beforeInstead.length - 1]; }
  }
  if (to && to.role !== 'fibre') to = null;
  if (!to && mats.length === 1 && mats[0].carbon) { from = mats[0]; to = MATERIALS.find((m) => m.key === 'basalt'); lines.push('Non hai detto con cosa sostituire il carbonio: provo con il basalto.'); }
  if (!to) return { id: 'whatif', title, lines: ['Per simulare dimmi quale fibra mettere e in quale pezzo, per esempio: "e se facessi la deriva in basalto?" oppure "e se aggiungo 2 kg di carbonio nello scafo?".'], links: [] };
  const targets = parts.length ? parts : ev.parts.filter((pr) => pr.substacks.some((r) => (from ? (from.carbon ? r.reinforcement?.carbon : r.input.reinforcement === from.ref) : r.input.reinforcement !== to.ref)));
  const sims = simulateSwap(ev, ctx, targets, from, to);
  if (!sims.length) return { id: 'whatif', title, lines: [`Nessun substack da cambiare: ${parts.length ? 'i pezzi indicati' : 'nessun pezzo'} ${from ? `usa ${from.it}` : `usa una fibra diversa da ${to.it}`}.`], links: [] };
  const toName = to.it;
  lines.push(`Ipotesi: fibra sostituita con ${toName} a parità di aree, strati e grammature (${kg(1)} di fibra resta ${kg(1)}); la resina si ricalcola con le formule del Layup Calculator.`);
  for (const s of sims) {
    lines.push(`- ${s.part.name} (${s.changed} substack): laminato da ${sm(s.costBefore)} a ${sm(s.costAfter)} (${signed(s.delta)}); massa laminato da ${kg(s.massBefore)} a ${kg(s.massAfter)}${s.cfrpBefore > 0 ? `; CFRP da ${gr(s.cfrpBefore)} a ${gr(s.cfrpAfter)}` : ''}.`);
    if (s.part.autoLines === false) lines.push(`  Nota: in questo progetto i costi di ${s.part.name} sono in voci scritte a mano, da aggiornare a parte.`);
    if (s.errors.length) lines.push(`  Problema: ${s.errors[0]}.`);
    else if (!s.inCalculator) lines.push(`  ${toName} non esiste nel Layup Calculator ufficiale: nel file ufficiale non si può inserire.`);
  }
  const delta = sumBy(sims, (s) => s.delta);
  lines.push(`In totale: ${signed(delta)}. Il totale passerebbe da ${sm(ev.total)} a ${sm(ev.total + delta)}, il margine a ${sm(ev.margin - delta)}.`);
  lines.push('Attenzione: a parità di strati la rigidezza cambia molto (il carbonio è molto più rigido di basalto, vetro e lino): il dimensionamento va rifatto prima di decidere.');
  return { id: 'whatif', title, lines, links: sims.length === 1 ? [{ label: `Apri ${sims[0].part.name}`, view: 'parts', opts: { part: sims[0].part.id } }] : [] };
}

/** Idee di risparmio calcolate, dalla più grande. */
export function savingIdeas(ev, ctx) {
  const ideas = [];
  // materiale riciclato equivalente nel listino (PET, EPS, XPS, MDF…)
  for (const l of ev.lines) {
    const m = l.material;
    if (!m?.entry || m.entry.extra || !(m.qty > 0) || !(m.unitPrice > 0)) continue;
    const id = m.entry.id;
    const prefix = id.includes('/') ? id.split('/')[0] : id.split('-').slice(0, 2).join('-');
    const alt = [...ev.catalog.values()].find((e) => e.id !== id && !e.extra && e.kind === m.entry.kind && e.id.startsWith(prefix) && /recycl/i.test(`${e.type} ${e.id}`) && e.price !== null && e.price < m.basePrice);
    if (!alt) continue;
    const saving = m.cost - m.qty * alt.price * m.factor;
    if (saving > 0.005) ideas.push({ kind: 'recycled', saving, text: `${l.line.s2Label || l.name}: usare ${entryName(alt)} (${nf(alt.price, 0, 2)} SM$/${alt.unit}) invece di ${entryName(m.entry)} fa risparmiare ${sm(saving)}.`, target: l.id });
  }
  // carbonio -> basalto, pezzo per pezzo
  if (ctx.spec) {
    const basalt = MATERIALS.find((m) => m.key === 'basalt');
    const carbon = MATERIALS.find((m) => m.key === 'carbon');
    for (const s of simulateSwap(ev, ctx, ev.parts.filter((pr) => carbonOf(pr).cfrp > 0), carbon, basalt)) {
      if (s.delta < -0.005) ideas.push({ kind: 'basalt', saving: -s.delta, text: `${s.part.name}: il carbonio in basalto farebbe risparmiare ${sm(-s.delta)} di laminato (massa da ${kg(s.massBefore)} a ${kg(s.massAfter)}, rigidezza da riverificare).`, target: s.part.id });
    }
  }
  // lavorazioni a ore
  for (const l of ev.lines) {
    if (l.process && l.process.cost >= 100 && l.process.rate > 0) {
      ideas.push({ kind: 'hours', saving: l.process.rate * Math.min(5, l.process.hours), text: `${l.line.s2Label || l.name}: ${nf(l.process.hours, 0, 1)} h di ${l.process.label} costano ${sm(l.process.cost)}; ogni ora in meno vale ${sm(l.process.rate)}.`, target: l.id });
    }
  }
  // eccedenza industriale (−25%) sul materiale più caro pagato a prezzo pieno
  const full = ev.lines.filter((l) => l.material && l.material.factor === 1 && l.material.cost > 50 && !l.usedPart).sort((a, b) => b.material.cost - a.material.cost)[0];
  if (full && ev.rules.sources.industrial_excess) {
    const saving = full.material.cost * (1 - ev.rules.sources.industrial_excess.factor);
    ideas.push({ kind: 'excess', saving, text: `${full.line.s2Label || full.name}: se ${full.material.label} arrivasse da eccedenza industriale (−25%) si risparmierebbero ${sm(saving)}${ev.rules.sourcesToConfirm ? ' (sconto da confermare su SuMoth Agora per il ' + ev.rules.id + ')' : ''}.`, target: full.id });
  }
  return ideas.sort((a, b) => b.saving - a.saving);
}

function savingsBlock(ev, ctx) {
  const ideas = savingIdeas(ev, ctx).slice(0, 6);
  const top = [...ev.lines].filter((l) => l.total > 0.005).sort((a, b) => b.total - a.total).slice(0, 3);
  const lines = [];
  if (top.length) lines.push(`Le 3 voci che pesano di più: ${top.map((l) => `${l.line.s2Label || l.name} ${sm(l.total)}`).join('; ')}.`);
  if (ideas.length) { lines.push('Idee di risparmio calcolate sul progetto:'); ideas.forEach((x) => lines.push(`- ${x.text}`)); }
  else lines.push('Non trovo risparmi evidenti con il listino: i materiali più cari sono già scontati o senza alternative riciclate.');
  return { id: 'savings', title: 'Come risparmiare', lines, links: [{ label: 'Voci di costo', view: 'lines' }] };
}

function rulesBlock(ev, q) {
  const r = ev.rules;
  const lines = [`Regolamento in uso: ${r.title}.`];
  const all = !/(budget|scont|scadut|shelf|eccedenz|upcycl|carbon|cfrp|tab(ella|\.)? ?[234]|performance|punt|scart|usat|agora|listino|penal)/.test(q);
  if (all || /budget|penal/.test(q)) lines.push(`Budget: ${sm(r.budget)}${r.budgetStrict ? `, da tenere sotto; sforarlo costa −${r.budgetPenalty} punti` : ', limite compreso'} (${r.refs.budget}).`);
  if (all || /scont|scadut|shelf|eccedenz|upcycl/.test(q)) {
    const s = r.sources;
    lines.push(`Sconti di provenienza: eccedenza industriale −${pc(1 - s.industrial_excess.factor, 0)}, fuori shelf-life −${pc(1 - s.out_of_shelf_life.factor, 0)}, upcycled −${pc(1 - s.upcycled.factor, 0)} (${r.refs.sources}).${r.sourcesToConfirm ? ` Il regolamento ${r.id} non li cita più: da confermare su SuMoth Agora.` : ''}`);
    lines.push(`Gli elementi upcycled vanno descritti con origine e trasformazione (${r.refs.upcycled}).${r.upcycledHullNonFoiling ? ' Nel 2027 uno scafo upcycled è ammesso solo se in origine era di una barca non foiling (§6.2.1).' : ''}`);
  }
  if (all || /carbon|cfrp|tab(ella|\.)? ?2/.test(q)) {
    const i = r.carbonGroups.findIndex((g) => g.id === 'hull');
    lines.push(`Tab. 2: limiti di carbonio per gruppo (scafo, terrazze, ognuno dei 4 foil, gantry, rig, altro). Per lo scafo: ${kg(r.carbonLimits.cfrp[i])} di CFRP, ${kg(r.carbonLimits.cf[i])} di carbonio secco; il carbonio riciclato o upcycled ha limiti più alti.`);
  }
  if ((all && r.performance) || /performance|punt|tab(ella|\.)? ?3/.test(q)) {
    if (r.performance) lines.push(`Performance Rating (Tab. 3, §11): per 15 componenti si sommano i punti delle condizioni a)–g) (es. c) materiali riciclati, b) costruito da esterni); vele, alberi e foil commerciali prodotti dal ${r.performance.commercial.fromYear} valgono ${r.performance.commercial.points} punti ciascuno salvo danni (§11.1.5).`);
    else lines.push('Nel regolamento 2026 non c\'è il Performance Rating: c\'era la Tab. 3 delle parti usate a costo fisso.');
  }
  if (/scart/.test(q) || (all && r.wasteTracking)) lines.push(r.wasteTracking ? 'Scarti: in S2 vanno tracciati anche gli scarti di materiale (§9.2.2); in Dollaroni si inseriscono nei pezzi e nei dettagli delle voci.' : 'Nel regolamento 2026 gli scarti non vanno dichiarati.');
  if (/usat|agora|listino/.test(q)) {
    if (r.usedPartYearIndex) lines.push('Parti usate (Tab. 3 2026): costo fisso (1.500 SM$ per i foil verticali, 500 per gli orizzontali, 0 per vela e albero) più un handicap che dipende dall\'anno di produzione.');
    else lines.push('Parti usate: nel 2027 non c\'è più il costo fisso, si pagano al prezzo indicato (da SuMoth Agora) con anno di produzione.');
    if (r.official?.provisional) lines.push('Listino: nel 2027 sta su SuMoth Agora, aperta ai team ammessi; finché non si vede si usa quello 2026, segnato provvisorio.');
  }
  return { id: 'rules', title: 'Regolamento', lines, links: [] };
}

function compareBlock(ev, ctx) {
  if (!ctx.evBase) {
    return { id: 'compare', title: 'Confronto S1 → S2', lines: [ev.project?.stage === 'S2' ? "Non c'è un S1 di riferimento collegato: si collega da \"Confronto S1→S2\"." : 'Il confronto si fa in S2: da Panoramica, "Congela S1 e crea S2".'], links: [{ label: 'Confronto', view: 'compare' }] };
  }
  const c = compareStages(ctx.evBase, ev);
  const lines = [`Totale S1 ${sm(c.total.s1)}, S2 ${sm(c.total.s2)}: ${signed(c.total.delta)} (${pc(c.total.variation)}).`];
  const rows = c.rows.filter((r) => r.delta === null || Math.abs(r.delta) > 0.005).sort((a, b) => Math.abs(b.delta ?? b.s2) - Math.abs(a.delta ?? a.s2));
  rows.forEach((r) => lines.push(`- ${r.component}: ${r.isNew ? `nuovo in S2, ${sm(r.s2)}` : `da ${sm(r.s1)} a ${sm(r.s2)} (${signed(r.delta)})`}`));
  return { id: 'compare', title: 'Confronto S1 → S2', lines, links: [{ label: 'Confronto', view: 'compare' }] };
}

function performanceBlock(ev) {
  const p = ev.performance;
  if (!p) return { id: 'performance', title: 'Performance Rating', lines: [`Il regolamento ${ev.rules.id} del progetto non ha il Performance Rating (c'è dal 2027).`], links: [] };
  const lines = [`Performance Rating: ${p.total > 0 ? '+' : ''}${p.total} punti (componenti ${p.componentsPoints}, parti commerciali ${p.commercialPoints}). Componenti dichiarati: ${p.declaredCount} su ${p.components.length}.`];
  p.components.filter((c) => c.points).forEach((c) => lines.push(`- ${c.it}: ${c.points > 0 ? '+' : ''}${c.points} (condizioni ${c.met.join(', ')})`));
  p.commercial.filter((c) => c.points).forEach((c) => lines.push(`- ${c.name}: ${c.points} (commerciale${c.year === null ? ', anno non indicato' : ` del ${c.year}`})`));
  return { id: 'performance', title: 'Performance Rating', lines, links: [{ label: 'Performance Rating', view: 'performance' }] };
}

function helpBlock() {
  return {
    id: 'help', title: 'Brumoth',
    lines: [
      'Sono Brumoth, l\'assistente di Dollaroni: rispondo con i numeri calcolati sul progetto aperto. Puoi chiedermi per esempio:',
      '- quanto budget resta e quanto abbiamo speso;',
      '- dove vanno i SM$ (classifica di componenti e voci);',
      '- com\'è messo il carbonio rispetto ai limiti della Tab. 2 e dove ce n\'è troppo;',
      '- quanto carbonio (o basalto, resina…) si può ancora comprare con il margine;',
      '- cosa sistemare prima della consegna;',
      '- simulazioni: "e se facessi la deriva in basalto?", "e se aggiungo 2 kg di carbonio nello scafo?";',
      '- idee per risparmiare, regole del regolamento, confronto S1→S2;',
      '- modifiche al progetto, sempre con **Applica** / **Annulla**: "aggiungi 2 kg di carbonio allo scafo", "crea un pezzo chiamato Timone di riserva nei foil", "fai la deriva in basalto", "aggiungi il materiale Carbon/Innegra a 160 SM$/kg con densità 1,3";',
      '- istruzioni sull\'app: "come faccio ad aggiungere un materiale che non c\'è?", "come esporto il report?".',
    ],
    links: [],
  };
}

function summaryBlock(ev, checks) {
  const errors = checks.filter((c) => c.level === 'error').length;
  const top = [...ev.components].sort((a, b) => b.total - a.total)[0];
  const worst = ev.carbon.flatMap((g) => g.checks.filter((c) => c.value > 0).map((c) => ({ g, c }))).sort((a, b) => b.c.ratio - a.c.ratio)[0];
  const lines = [
    `Progetto "${ev.project?.name || ''}" ${ev.project?.season || ''} ${ev.project?.stage || ''}, regole ${ev.rules.id}.`,
    `Totale ${sm(ev.total)} su ${sm(ev.budget)}, margine ${sm(ev.margin)}.`,
  ];
  if (top && top.total > 0) lines.push(`Componente più costoso: ${top.it} con ${sm(top.total)}.`);
  if (worst) lines.push(`Carbonio più vicino al limite: ${worst.g.en}, ${worst.c.label} al ${pc(worst.c.ratio)}.`);
  lines.push(errors ? (errors === 1 ? "C'è 1 errore nei controlli." : `Ci sono ${errors} errori nei controlli.`) : 'Nessun errore nei controlli.');
  return { id: 'summary', title: 'In breve', lines, links: [] };
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
 * Risponde a una domanda.
 * ctx = {ev, checks, spec (Layup Calculator), evBase (S1 congelato, se c'è), previous (route precedente), intents (forzati)}
 * Ritorna {question, route, blocks, text, facts, understood}.
 */
/** Blocco per una richiesta di modifica: azioni proposte, cosa manca, note. */
function commandBlock(cmd, howto) {
  const lines = [];
  if (cmd.actions.length) {
    lines.push(howto
      ? 'Se vuoi lo faccio io: controlla la modifica qui sotto e premi **Applica**, oppure **Annulla**.'
      : 'Ecco cosa cambierei. Controlla l\'anteprima e premi **Applica**, oppure **Annulla**: senza il tuo ok non cambio niente.');
  }
  if (cmd.missing.length) {
    if (howto || cmd.actions.length) lines.push(`Per fare il resto mi serve: ${cmd.missing.join('; ')}.`);
    else lines.push(`La richiesta è troppo generica: mi serve ${cmd.missing.join('; ')}.`);
  }
  lines.push(...cmd.notes);
  const title = cmd.actions.length ? (howto ? 'Posso farlo io' : 'Modifica proposta') : howto ? 'Posso farlo io' : 'Mi serve qualche dettaglio';
  return { id: 'command', title, lines, links: [] };
}

/** Anteprima (totale, margine, nuovi problemi) di ogni azione proposta. */
function withPreview(actions, ctx) {
  const evalCtx = ctx.catalogEntries ? { spec: ctx.spec, catalogEntries: ctx.catalogEntries, rules: ctx.ev.rules } : null;
  return actions.map((a) => ({ ...a, preview: evalCtx && ctx.ev.project ? previewAction(a, ctx.ev.project, evalCtx) : null }));
}

export function answer(question, ctx) {
  const { ev } = ctx;
  const r = route(question, { ev, previous: ctx.previous });
  r.entities.q = r.q;

  // richieste di modifica ("aggiungi…", "crea…") e istruzioni ("come faccio a…"): risposta senza IA, con Applica/Annulla
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
  // capienza di carbonio: si aggiunge la situazione dei limiti ("dove ce n'è troppo")
  if (ids.includes('capacity') && (!r.entities.materials.length || r.entities.materials.some((m) => m.carbon)) && !ids.includes('carbon') && r.entities.wantsWhere) ids = [...ids, 'carbon'];
  if (ids.includes('capacity') && r.entities.wantsWhere && /classific/.test(r.q) && !ids.includes('ranking')) ids = [...ids, 'ranking'];
  // un saluto ("ciao Brumoth") riceve la presentazione
  if (!ids.length && /^(ciao|salve|buongiorno|buonasera|hey|ehi|hola)\b/.test(r.q) && r.q.split(' ').length <= 4) ids = ['help'];
  const understood = ids.length > 0;
  if (!understood) ids = ['summary'];
  const blocks = ids.map((id) => (id === 'summary' ? summaryBlock(ev, ctx.checks || []) : BUILDERS[id](ev, ctx, r.entities))).filter(Boolean);
  const text = blocks.map((b) => `**${b.title}**\n${b.lines.join('\n')}`).join('\n\n');
  const facts = blocks.map((b) => `[${b.title}]\n${b.lines.join('\n')}`).join('\n\n');
  // una simulazione che si può applicare davvero ("e se facessi la deriva in basalto?") propone anche Applica/Annulla
  let actions = [];
  if (ids.includes('whatif')) actions = withPreview(parseCommand(question, ctx)?.actions || [], ctx);
  return { question, route: r, intents: ids, blocks, text, facts, understood, actions };
}

// ------------------------------------------------------------------ IA locale: messaggi e controlli
export const SYSTEM_PROMPT = `Sei Brumoth, l'assistente di "Dollaroni", l'app del Sapienza Foiling Team che calcola i SuMoth Dollars (SM$) della barca per la SuMoth Challenge. Se ti chiedono chi sei, rispondi che sei Brumoth.
Regole:
- Rispondi in italiano, in modo breve e diretto: al massimo 6 frasi oppure un elenco puntato corto.
- Usa SOLO le informazioni nei DATI. I DATI sono calcolati dall'app e sono esatti.
- Non inventare numeri e non fare calcoli nuovi: riporta i numeri dei DATI con le loro unità (SM$, kg, g, %).
- Rispondi prima di tutto alla domanda; aggiungi un consiglio solo se è nei DATI.
- Se nei DATI manca quello che serve, dillo e indica in quale sezione dell'app guardare.
- Se la domanda non riguarda la barca, i costi o il regolamento SuMoth, rispondi che puoi aiutare solo su questo.`;

/** Messaggi per l'IA locale. history = [{question, reply}] delle domande precedenti (si usa solo l'ultima). */
export function buildMessages(ans, history = []) {
  const msgs = [{ role: 'system', content: SYSTEM_PROMPT }];
  const last = history[history.length - 1];
  if (last?.reply) {
    msgs.push({ role: 'user', content: last.question });
    msgs.push({ role: 'assistant', content: String(last.reply).slice(0, 500) });
  }
  const note = ans.understood ? '' : '\n(La domanda non corrisponde a un argomento preciso: questi sono i dati generali del progetto.)';
  msgs.push({ role: 'user', content: `DATI (calcolati da Dollaroni):\n${ans.facts}${note}\n\nDOMANDA: ${ans.question}` });
  return msgs;
}

/** Per le domande che le parole chiave non riconoscono: l'IA sceglie l'argomento con una parola. */
export function routerMessages(question) {
  const list = Object.entries(INTENTS).map(([id, d]) => `${id} = ${d.desc}`).join('\n');
  return [
    { role: 'system', content: `Classifichi le domande fatte a un'app che calcola i costi (SuMoth Dollars) di una barca da regata. Argomenti:\n${list}\naltro = niente di tutto questo\nRispondi con UNA sola parola: il nome dell'argomento.` },
    { role: 'user', content: question },
  ];
}
/** Argomento letto dalla risposta del modello (null se non è uno di quelli previsti). */
export function parseRouterReply(text) {
  const t = normalize(text);
  return Object.keys(INTENTS).find((id) => new RegExp(`\\b${id}\\b`).test(t)) || null;
}

// Numeri: "1.577,64", "1577,64", "1,577.64", "15,8", "3".
const NUM_RE = /\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?/g;

/** Possibili valori di un numero scritto in italiano o in inglese. */
function readings(s) {
  const out = new Set();
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) out.add(Number(s.replace(/\./g, '').replace(',', '.')));
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) out.add(Number(s.replace(/,/g, '')));
  if (/^\d+,\d+$/.test(s)) out.add(Number(s.replace(',', '.')));
  if (/^\d+\.\d+$/.test(s)) out.add(Number(s));
  if (/^\d+$/.test(s)) out.add(Number(s));
  if (/^\d{1,3}\.\d{3}$/.test(s)) out.add(Number(s)); // "1.000" può anche essere 1,0 all'inglese
  return [...out].filter(Number.isFinite);
}

/**
 * Numeri della risposta dell'IA che non compaiono nei fatti (né arrotondati).
 * Si ignorano interi piccoli (elenchi, conteggi), anni e riferimenti al regolamento (§10.1, Tab. 2).
 */
export function verifyNumbers(reply, facts) {
  const factVals = [];
  for (const m of String(facts).matchAll(NUM_RE)) factVals.push(...readings(m[0]));
  const out = [];
  const text = String(reply);
  for (const m of text.matchAll(NUM_RE)) {
    const s = m[0];
    const before = text.slice(Math.max(0, m.index - 6), m.index);
    if (/(§|tab\.?\s?|tabella\s|sezione\s|regola\s)$/i.test(before)) continue;
    const vals = readings(s);
    if (!vals.length) continue;
    if (vals.every((v) => Number.isInteger(v) && (v <= 12 || (v >= 2010 && v <= 2035)))) continue;
    const dec = (s.match(/[.,](\d+)$/)?.[1] || '').length;
    const ok = vals.some((v) => factVals.some((f) => {
      if (Math.abs(f - v) <= 1e-6 * Math.max(1, Math.abs(f))) return true;
      // arrotondamento a meno decimali (1,58 -> 1,6) o a interi (1.577,64 -> 1.578)
      for (let d = 0; d <= Math.max(dec, 2); d += 1) if (Math.abs(Number(f.toFixed(d)) - v) < 1e-9) return true;
      return false;
    }));
    if (!ok) out.push(s);
  }
  return [...new Set(out)];
}

/** Domande suggerite in base al progetto aperto. */
export function suggestedQuestions(ev, checks = []) {
  const out = ['Quanto budget ci rimane?', 'Dove spendiamo di più?'];
  const hasCarbon = ev.carbon.some((g) => g.hasCarbon);
  out.push(hasCarbon ? "Dove c'è troppo carbonio?" : 'Quanto carbonio possiamo usare?');
  out.push('Quanto carbonio serve per finire il budget?');
  if (checks.some((c) => c.level === 'error' || c.level === 'warning')) out.push('Cosa dobbiamo sistemare?');
  const withCarbon = ev.parts.find((pr) => carbonOf(pr).cfrp > 0);
  if (withCarbon) out.push(`E se facessi ${withCarbon.part.name} in basalto?`);
  out.push('Come possiamo risparmiare?');
  out.push("Come aggiungo un materiale che non c'è?");
  if (ev.project?.stage === 'S2' && ev.project?.baseline) out.push("Cosa è cambiato rispetto all'S1?");
  return out.slice(0, 8);
}
