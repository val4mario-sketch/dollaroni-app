// Brumoth: modifiche al progetto chieste a parole e istruzioni su come usare l'app.
//
// Brumoth non modifica MAI da solo: per ogni richiesta prepara un'"azione" con l'elenco di cosa cambia e
// l'anteprima dell'effetto (totale, margine, nuovi problemi); la chat mostra "Applica" / "Annulla" e la
// modifica passa da update() dell'app, quindi Ctrl+Z la annulla come qualsiasi altra.
// Se la richiesta è troppo generica (manca il pezzo, la quantità, il prezzo…) lo dice e spiega cosa serve.
//
// Azioni previste: aggiungere fibra a un pezzo (nuovo substack), aggiungere una voce di costo, creare un pezzo
// laminato, aggiungere un materiale al listino del team, cambiare la fibra di un pezzo, eliminare un pezzo.
// Modulo puro (niente DOM), testato in tests/actions.test.js.

import { evaluate } from './project.js';
import { runChecks } from './checks.js';
import { findMaterials, findParts, findComponents, normalize } from './assistant.js';

const nf = (x, min, max) => Number(x || 0).toLocaleString('it-IT', { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: 'always' });
const sm = (x) => `${nf(x, 2, 2)} SM$`;
const kg = (x) => `${nf(x, 2, 2)} kg`;
const uid = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

// Gruppi della Tab. 2 e del mass breakdown per componente (come templates.DEFAULT_GROUPS dell'interfaccia).
const GROUPS = {
  hull: { limitGroup: 'hull', massGroup: 'hull' },
  foils: { limitGroup: 'main_vertical', massGroup: 'vertical_foils' },
  mechanical_control: { limitGroup: 'other', massGroup: 'other' },
  gantry: { limitGroup: 'gantry', massGroup: 'other' },
  wingbars: { limitGroup: 'wingbars', massGroup: 'wings' },
  rig: { limitGroup: 'rig', massGroup: 'other' },
  electronics: { limitGroup: 'other', massGroup: 'other' },
};

/** Gruppi Tab. 2 e masse di un pezzo nuovo: dal componente, precisati dal nome (timone, orizzontale…). */
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

// ------------------------------------------------------------------ riconoscere le richieste
const HOWTO_RE = /\bcome (faccio|si fa|si fanno|posso|possiamo|devo|dobbiamo|aggiungo|creo|inserisco|metto|cambio|tolgo|elimino|esporto|salvo|apro|condivido|aggiorno|uso|registro|si aggiunge|si crea|si inserisce)|\bdove (trovo|si trova|si trovano|aggiungo|metto|inserisco|si)\b|istruzion|spiegami come|mi spieghi come|\bguida\b|\btutorial\b|passaggi per/;
const WHATIF_RE = /\be se\b|cosa succede se|cosa cambia se|che succede se|simula|ipotes|ipotizz/;
const VERB_RE = /\b(aggiungi|aggiungimi|aggiungere|aggiungiamo|aggiungerei|metti|mettimi|mettere|mettiamo|inserisci|inserire|crea|creami|creare|creiamo|togli|togliere|rimuovi|rimuovere|elimina|eliminare|cancella|cancellare|sostituisci|sostituire|cambia|cambiare|passa|portami)\b|^(ok |dai |per favore |brumoth,? )?(fai|fammi|facciamo|fate) (un|una|il|lo|la|le|i|gli|l')\b/;

export const isHowTo = (q) => HOWTO_RE.test(q);
export const isCommand = (q) => !WHATIF_RE.test(q) && !HOWTO_RE.test(q) && VERB_RE.test(q);

/** Testo tra virgolette nella domanda originale («Terrazze», "Terrazze", 'Terrazze'). */
function quoted(question) {
  const m = String(question).match(/[«"“']([^»"”']{2,60})[»"”']/);
  return m ? m[1].trim() : null;
}

/** Nome dopo "chiamato/di nome/che si chiama", preso dalla domanda originale (mantiene maiuscole). */
function namedAs(question) {
  const q = quoted(question);
  if (q) return q;
  const m = String(question).match(/\b(?:chiamat[oaie]|di nome|nome|che si chiam[ai]|denominat[oa])\s+["«]?([^,.;:?!"»]+?)["»]?(?=\s+(?:e|ed|con|nel|nella|nello|nei|negli|nelle|in|tra|fra|sui|sul|per|a|al|che|dove|come)\b|[,.;:?!]|$)/i);
  return m ? m[1].trim() : null;
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function findAmount(q) {
  const m = q.match(/(\d+(?:[.,]\d+)?)\s*(kg|chili|chilogrammi|g|grammi|gr)\b/);
  if (!m) return null;
  const v = Number(m[1].replace(',', '.'));
  return /^(g|gr|grammi)$/.test(m[2]) ? v / 1000 : v;
}

function findPrice(q) {
  const m = q.match(/(\d+(?:[.,]\d+)?)\s*(?:sm\$|sm|dollari|smd)?\s*(?:\/|al |a |per )?\s*(kg|chilo|m2|mq|m|metro|pezzo|pc|l|litro)\b/)
    || q.match(/prezzo\s*(?:di|da|a)?\s*(\d+(?:[.,]\d+)?)/)
    || q.match(/(\d+(?:[.,]\d+)?)\s*(?:sm\$|dollari)\b/);
  if (!m) return null;
  return { price: Number(m[1].replace(',', '.')), unit: unitOf(m[2]) };
}
function unitOf(u) {
  if (!u) return null;
  if (/^(kg|chilo)/.test(u)) return 'kg';
  if (/^(m2|mq)/.test(u)) return 'm2';
  if (/^(m|metro)$/.test(u)) return 'm';
  if (/^(l|litro)$/.test(u)) return 'L';
  return 'pc';
}
function findDensity(q) {
  const m = q.match(/densit\w*\s*(?:di|da|=|:)?\s*(\d+(?:[.,]\d+)?)/);
  return m ? Number(m[1].replace(',', '.')) : null;
}

const partList = (ev) => ev.parts.map((pr) => pr.part.name).join(', ');
const componentList = (ev) => ev.components.map((c) => c.it).join(', ');

// ------------------------------------------------------------------ azioni
/**
 * Interpreta una richiesta di modifica.
 * Ritorna {actions: [...], missing: [testi], notes: [testi]} oppure null se non è una richiesta di modifica.
 * Un'azione: {id, type, title, changes: [testi], apply(progettoBozza), target: {view, opts}}.
 */
export function parseCommand(question, { ev, spec } = {}) {
  const q = normalize(question);
  const out = { actions: [], missing: [], notes: [] };
  const mats = findMaterials(q);
  const parts = findParts(q, ev);
  const comps = findComponents(q, ev);
  const amount = findAmount(q);
  const removing = /\b(togli|togliere|rimuovi|rimuovere|elimina|eliminare|cancella|cancellare)\b/.test(q);
  const swapping = /\b(sostituisci|sostituire|sostituisco|sostituissi|cambia|cambiare|cambio|cambiassi|passa|passo|passassi|fai|fammi|facciamo|facessi|faccio|rifai|usa|uso|usassi|usiamo)\b/.test(q) && /\b(in|con)\s+(il |lo |la |l')?(\w+)/.test(q);
  const wantsPart = /\b(pezz[oi]|sezion[ei]|part[ei] laminat|laminato nuovo|nuovo laminato)\b/.test(q);
  const wantsMaterial = /\b(material[ei]|nel listino|al listino|nuov[oa] (fibra|tessuto|resina)|voce del team|che non c'e|che non ce|non esiste|non c'e)\b/.test(q);

  // --- nuovo materiale nel listino del team
  if (wantsMaterial && !removing) {
    const name = (wantsPart ? null : quoted(question)) || materialNameFrom(question) || (wantsPart ? null : namedAs(question));
    if (!name) out.missing.push('il nome del materiale (es. «aggiungi il materiale "Carbon/Innegra" a 150 SM$/kg con densità 1,3»)');
    else {
      const known = [...ev.catalog.values()].find((e) => normalize(e.name) === normalize(name));
      if (known) out.notes.push(`«${name}» c'è già nel listino: ${nf(known.price ?? 0, 0, 2)} SM$/${known.unit}.`);
      else {
        const kind = kindOf(normalize(name));
        const price = findPrice(q);
        const density = findDensity(q);
        const miss = [];
        if (!price) miss.push(`il prezzo in SM$ (es. «a 150 SM$/kg»: ${ev.rules.sourcesToConfirm ? 'nel 2027 va preso o proposto su SuMoth Agora' : 'va chiesto sul Discord SuMoth'})`);
        if (kind === 'reinforcement' && !density) miss.push('la densità della fibra in g/cm³ (es. «densità 1,3»): serve per calcolare la resina con le formule del Layup Calculator');
        if (miss.length) out.missing.push(...miss.map((m) => `per «${name}»: ${m}`));
        else {
          const unit = price.unit || (kind === 'hardware' ? 'pc' : 'kg');
          const id = uid('extra');
          out.actions.push({
            id, type: 'addMaterial', title: `Nuovo materiale nel listino: ${name}`,
            changes: [
              `Listino → Voci del team: «${name}», tipo ${KIND_IT[kind]}, ${nf(price.price, 0, 2)} SM$/${unit}${density ? `, densità ${nf(density, 0, 3)} g/cm³` : ''}.`,
              'Fonte del prezzo: da completare nel Listino (es. Discord, Agora, MSRP).',
              ...(kind === 'reinforcement' ? ['Nel Layup Calculator ufficiale non esiste: i pezzi che lo usano non si possono esportare nel file ufficiale.'] : []),
              ...(kind === 'reinforcement' && /carbon/.test(normalize(name)) ? ['Avendo "carbon" nel nome, per la Tab. 2 tutta la sua massa conta come carbonio (stima prudente).'] : []),
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

  // --- nuovo pezzo laminato ("sezione")
  if (wantsPart && !removing && /\b(crea|creami|creare|aggiungi|aggiungere|fai|fare|fammi|nuov[oa]|voglio|vorrei|inserisci|metti)\b/.test(q)) {
    const name = namedAs(question);
    const comp = comps[0] || (name ? findComponents(normalize(name), ev)[0] : null);
    if (!name) out.missing.push('il nome del pezzo (es. «crea un pezzo chiamato Terrazze»)');
    if (!comp) out.missing.push(`il componente in cui va (${componentList(ev)})`);
    if (name && comp) {
      // la fibra si mette solo se è detta per il pezzo ("un pezzo in carbonio"), non se si sta creando un materiale nuovo
      const fibre = wantsMaterial ? null : mats.find((m) => m.role === 'fibre');
      const id = uid('part');
      const groups = groupsFor(comp.id, normalize(name));
      const groupName = ev.rules.carbonGroups.find((g) => g.id === groups.limitGroup)?.en || groups.limitGroup;
      const sub = fibre ? { reinforcement: fibre.ref, matrix: 'std-epoxy/lamination-resin', plyArea: 1, plies: 1, arealWeight: 200, process: 'HAND LAYUP + VAC', reinforcementSource: 'new', matrixSource: 'new' } : null;
      out.actions.push({
        id, type: 'addPart', title: `Nuovo pezzo laminato: ${cap(name)}`,
        changes: [
          `Pezzi laminati → «${cap(name)}», componente ${comp.it} (${comp.en}).`,
          `Limiti di carbonio della Tab. 2: gruppo ${groupName} (si cambia nel pezzo, "Limiti carbonio (Tab. 2)"); voci di fibra, resina e anima create in automatico.`,
          sub ? `Un substack di partenza: ${fibre.it}, 1 m², 1 strato da 200 g/m², HAND LAYUP + VAC (da correggere con i valori veri).` : 'Senza substack: li aggiungi tu con "Aggiungi substack" (fibra, area, strati, grammatura, processo).',
        ],
        apply: (d) => {
          d.parts.push({ id, name: cap(name), component: comp.id, ...groups, autoLines: true, substacks: sub ? [sub] : [] });
        },
        target: { view: 'parts', opts: { part: id } },
      });
      if (comp.id === 'wingbars' && /terrazz/.test(normalize(name))) out.notes.push('Nota: il componente Terrazze esiste già e contiene Wing panel e Wing frame; il nuovo pezzo si aggiunge a quelli.');
    }
  }

  if (out.actions.length || out.missing.length || out.notes.length) return out;

  // --- eliminare un pezzo
  if (removing) {
    if (parts.length === 1 && !amount) {
      const p = parts[0].part;
      out.actions.push({
        id: uid('del'), type: 'removePart', title: `Eliminare il pezzo ${p.name}`,
        changes: [`Pezzi laminati: tolgo «${p.name}» con i suoi ${p.substacks?.length || 0} substack${p.autoLines !== false ? ' e le voci di costo generate da lui' : ''}.`],
        apply: (d) => { d.parts = d.parts.filter((x) => x.id !== p.id); },
        target: { view: 'parts' },
      });
    } else if (!parts.length) out.missing.push(`quale pezzo eliminare (${partList(ev)})`);
    else if (amount) out.notes.push('Per togliere materiale da un pezzo modifica i suoi substack (strati o area) in Pezzi laminati: è più preciso che togliere chili a mano.');
    else out.missing.push(`quale pezzo eliminare, uno solo: ho trovato ${parts.map((p) => p.part.name).join(' e ')}`);
    return out;
  }

  // --- cambiare la fibra di un pezzo ("fai la deriva in basalto", "sostituisci il carbonio con il vetro nello scafo")
  const fibres = mats.filter((m) => m.role === 'fibre');
  if (swapping && !amount && fibres.length) {
    let to = fibres[fibres.length - 1];
    let from = fibres.length > 1 ? fibres[0] : null;
    const instead = Math.max(q.indexOf('invece'), q.indexOf('al posto'));
    if (fibres.length > 1 && instead >= 0) {
      const after = fibres.filter((m) => m.index > instead);
      const before = fibres.filter((m) => m.index < instead);
      if (after.length && before.length) { from = after[0]; to = before[before.length - 1]; }
    }
    if (!parts.length) { out.missing.push(`in quale pezzo cambiare la fibra (${partList(ev)})`); return out; }
    for (const pr of parts) {
      const pick = (s) => {
        const e = ev.catalog.get(s.reinforcement);
        if (!from) return s.reinforcement !== to.ref;
        if (from.carbon) return /carbon/i.test(`${e?.group} ${e?.name}`);
        return s.reinforcement === from.ref;
      };
      const n = (pr.part.substacks || []).filter(pick).length;
      if (!n) { out.notes.push(`${pr.part.name}: nessun substack da cambiare${from ? ` (non usa ${from.it})` : ''}.`); continue; }
      const pid = pr.part.id;
      out.actions.push({
        id: uid('swap'), type: 'swapFibre', title: `${pr.part.name}: fibra in ${to.it}`,
        changes: [
          `${pr.part.name}: ${n} substack passano a ${to.it} (stesse aree, strati e grammature; la resina si ricalcola).`,
          'La rigidezza cambia: il dimensionamento va ricontrollato.',
          ...(pr.part.autoLines === false ? [`I costi di ${pr.part.name} sono in voci scritte a mano: vanno aggiornate anche quelle.`] : []),
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

  // --- aggiungere materiale ("aggiungi 2 kg di carbonio allo scafo", "metti 20 kg di MDF nello scafo")
  if (/\b(aggiungi|aggiungimi|aggiungere|aggiungiamo|aggiungo|aggiungessi|metti|mettimi|mettere|mettiamo|metto|mettessi|inserisci|inserire)\b/.test(q)) {
    const m = mats[mats.length - 1];
    if (!m) {
      out.missing.push('cosa aggiungere: un materiale con la quantità (es. «aggiungi 2 kg di carbonio allo scafo»), un pezzo laminato o un materiale nuovo nel listino');
      return out;
    }
    if (m.role === 'resin') {
      out.notes.push('La resina dei pezzi laminati non si aggiunge a mano: la calcola Dollaroni dal processo (Vf) con le formule del Layup Calculator. Se vuoi più resina, cambia il processo del substack; per adesivi o resina extra usa una voce di costo in "Voci di costo".');
      return out;
    }
    if (!amount) out.missing.push(`la quantità di ${m.it} (es. «2 kg»)`);
    if (m.role === 'fibre') {
      if (!parts.length) out.missing.push(`in quale pezzo laminato (${partList(ev)})`);
      else if (parts.length > 1) out.missing.push(`un solo pezzo: ho trovato ${parts.map((p) => p.part.name).join(' e ')}`);
      if (out.missing.length) return out;
      const pr = parts[0];
      const last = pr.part.substacks?.[pr.part.substacks.length - 1];
      const gsm = Number(last?.arealWeight) || 200;
      const process = last?.process || 'HAND LAYUP + VAC';
      const matrix = last?.matrix || 'std-epoxy/lamination-resin';
      const area = (amount * 1000) / gsm;
      const pid = pr.part.id;
      out.actions.push({
        id: uid('add'), type: 'addFibre', title: `${pr.part.name}: +${kg(amount)} di ${m.it}`,
        changes: [
          `${pr.part.name}: nuovo substack di ${m.it}, 1 strato da ${nf(gsm, 0, 0)} g/m² su ${nf(area, 0, 2)} m² = ${kg(amount)} di fibra, ${process}.`,
          'La resina, il costo e i limiti di carbonio si ricalcolano con le formule del Layup Calculator.',
          ...(pr.part.autoLines === false ? [`I costi di ${pr.part.name} sono in voci scritte a mano: il costo del nuovo substack non viene aggiunto da solo.`] : []),
        ],
        apply: (d) => {
          const p = d.parts.find((x) => x.id === pid);
          if (p) p.substacks.push({ reinforcement: m.ref, matrix, plyArea: area, plies: 1, arealWeight: gsm, process, reinforcementSource: 'new', matrixSource: 'new' });
        },
        target: { view: 'parts', opts: { part: pid } },
      });
      if (m.key === 'carbon') out.notes.push('Ho usato il carbonio standard (T700); per un altro tipo scrivi «carbonio intermedio» o «alto modulo».');
      return out;
    }
    // altri materiali (MDF, PET, PVC…): una voce di costo nel componente indicato
    const comp = parts[0] ? ev.components.find((c) => c.id === parts[0].part.component) : comps[0];
    if (!comp) out.missing.push(`in quale componente va la voce (${componentList(ev)})`);
    if (out.missing.length) return out;
    const entry = ev.catalog.get(m.ref);
    const id = uid('line');
    out.actions.push({
      id, type: 'addLine', title: `Nuova voce: ${nf(amount, 0, 3)} ${entry?.unit || 'kg'} di ${m.it} (${comp.it})`,
      changes: [`Voci di costo → ${comp.it}: «${comp.en} - ${m.it}», ${nf(amount, 0, 3)} ${entry?.unit || 'kg'} a ${nf(entry?.price ?? 0, 0, 2)} SM$/${entry?.unit || 'kg'}, provenienza nuova.`],
      apply: (d) => { d.lines.push({ id, component: comp.id, name: `${comp.en} - ${m.it}`, material: { ref: m.ref, qty: amount, source: 'new' } }); },
      target: { view: 'lines', opts: { line: id } },
    });
    return out;
  }

  out.generic = true;
  out.missing.push('cosa vuoi modificare. So aggiungere fibra a un pezzo («aggiungi 2 kg di carbonio allo scafo»), aggiungere una voce («metti 20 kg di MDF nello scafo»), creare un pezzo («crea un pezzo chiamato Timone di riserva nei foil»), aggiungere un materiale al listino, cambiare la fibra di un pezzo («fai la deriva in basalto») ed eliminare un pezzo');
  return out;
}

const KIND_IT = { reinforcement: 'Rinforzi', matrix: 'Matrici e resine', core: 'Anime', consumable: 'Consumabili', hardware: 'Voci del team (MSRP, Discord)', other: 'Altro' };

function kindOf(n) {
  if (/carbon|carbo|innegra|basalt|vetro|glass|kevlar|aramid|lino|flax|fibr|tessut|diolen|dyneema/.test(n)) return 'reinforcement';
  if (/resin|epossid|epoxy|vinil|poliest/.test(n)) return 'matrix';
  if (/anima|core|schiuma|foam|balsa|pet|pvc|nido/.test(n)) return 'core';
  if (/peel|sacco|breather|nastro|tape|distaccante/.test(n)) return 'consumable';
  return 'hardware';
}

/** "aggiungere il carbo innegra che è un materiale…" -> "carbo innegra". */
function materialNameFrom(question) {
  const s = String(question);
  const m = s.match(/\b(?:aggiung\w*|inserisc\w*|mett\w*|crea\w*)\s+(?:anche\s+)?(?:il|lo|la|l'|un|uno|una|i|gli|le)?\s*(?:materiale|tessuto|fibra)?\s*([^,.;:?!]+?)\s+(?:che\s+(?:è|e)\s+un|che\s+non|nel\s+listino|al\s+listino|a\s+\d|con\s+densit|,|$)/i);
  const name = m?.[1]?.trim().replace(/^["«“']|["»”']$/g, '');
  if (!name || /^(un|una|il|lo|la|nuovo|nuova|materiale)$/i.test(name)) return null;
  return name.replace(/^(materiale|tessuto|fibra)\s+/i, '');
}

/**
 * Effetto di un'azione: progetto prima/dopo con le stesse regole e lo stesso listino.
 * evalCtx = {spec, catalogEntries, rules}. Ritorna {before, after, problems} oppure {error}.
 */
export function previewAction(action, project, evalCtx) {
  try {
    const draft = structuredClone(project);
    action.apply(draft);
    const evB = evaluate(project, evalCtx);
    const evA = evaluate(draft, evalCtx);
    // problemi nuovi: stesso controllo sullo stesso elemento che prima non c'era
    const key = (c) => `${c.level}|${c.code}|${c.target}|${c.code === 'carbon' || c.code === 'carbon-near' ? (c.message.split('–')[1] || '').split(':')[0] : ''}`;
    const known = new Set(runChecks(evB).filter((c) => c.level !== 'info').map(key));
    const problems = runChecks(evA).filter((c) => c.level !== 'info' && !known.has(key(c))).map((c) => ({ level: c.level, message: c.message }));
    return { before: { total: evB.total, margin: evB.margin }, after: { total: evA.total, margin: evA.margin }, problems };
  } catch (e) {
    return { error: e.message };
  }
}

export const describeEffect = (p) => (p.error ? `Anteprima non disponibile: ${p.error}` : `Totale ${sm(p.before.total)} → ${sm(p.after.total)} · margine ${sm(p.after.margin)}`);

// ------------------------------------------------------------------ istruzioni ("come faccio a…")
/** Argomenti delle istruzioni: parole chiave e passaggi con i nomi veri dei pulsanti dell'app. */
export function howToTopics(rules, catalog) {
  const innegra = catalog?.get('dry-fabric-innegra');
  return [
    {
      id: 'part', re: /pezz|sezion|laminat|substack|strat|ply|scafo|deriva|timon|terrazz/,
      title: 'Aggiungere un pezzo laminato (una "sezione" con i suoi strati)',
      steps: [
        'Barra a sinistra → **Pezzi laminati** → in alto a destra **Nuovo pezzo**.',
        'Scrivi il **Nome del pezzo** e scegli il **Componente (tabelle S2)**, per esempio Terrazze: i **Limiti carbonio (Tab. 2)** si impostano da soli.',
        '**Aggiungi substack**: per ogni gruppo di strati scegli fibra, matrice, processo, area (m²), numero di ply e grammatura (g/m²), con la provenienza.',
        'Con "Crea da solo le voci di costo di fibra, resina e anima" attivo, i costi e le masse si calcolano mentre scrivi; in fondo c\'è l\'anteprima del Layup Calculator.',
      ],
    },
    {
      id: 'material', re: /material|listino|non c'e|non ce|non esiste|innegra|fibra nuova|nuova fibra|tessuto|prezzo/,
      title: 'Aggiungere un materiale che non c\'è nel listino',
      steps: [
        'Barra a sinistra → **Listino** → riquadro **Voci del team** → **Aggiungi voce**.',
        'Compila **Nome**, **Tipo** (per una fibra: **Rinforzi**), **Unità** (kg), **SM$/unità**, la **Densità g/cm³** (obbligatoria per le fibre: serve a calcolare la resina) e la **Fonte del prezzo**.',
        'Da quel momento il materiale compare nei menu dei substack e delle voci, nel gruppo delle voci del team.',
        rules.sourcesToConfirm
          ? 'Regole 2027: il prezzo ufficiale sta su SuMoth Agora e i materiali nuovi si propongono lì con evidenze scientifiche (§10.3).'
          : 'Regole 2026: il prezzo di un materiale che manca va chiesto sul Discord SuMoth (§3.1).',
        'Attenzione: un materiale aggiunto non esiste nel Layup Calculator ufficiale, quindi i pezzi che lo usano non si possono esportare nel file ufficiale (Dollaroni lo segnala nei Controlli).',
        ...(innegra ? [`Riferimento: nel listino c\'è già l\'Innegra puro a ${nf(innegra.price, 0, 2)} SM$/kg; un ibrido carbonio/Innegra no. Se nel nome c'è "carbon", per la Tab. 2 Dollaroni conta tutta la sua massa come carbonio (stima prudente).`] : []),
      ],
    },
    {
      id: 'line', re: /voc[ei]|cost[oi]|hardware|bozzell|cime|stamp|consumabil|lavorazion|cnc|ore|upcycl|parte usata/,
      title: 'Aggiungere una voce di costo (stampi, consumabili, hardware, lavorazioni…)',
      steps: [
        'Barra a sinistra → **Voci di costo** → nel riquadro del componente giusto clicca **Aggiungi**.',
        'Scegli il tipo: Materiale del listino, Lavorazione a ore, Hardware / voce a prezzo, Parte usata, Elemento upcycled.',
        'Compila quantità o ore, e per i prezzi a mano la fonte; per gli upcycled l\'origine. Le righe grigie arrivano dai pezzi laminati e si modificano lì.',
      ],
    },
    {
      id: 'export', re: /esport|report|word|docx|xlsx|layup calculator|appendic|google docs/,
      title: 'Esportare i file per i report',
      steps: [
        'In alto a destra **Esporta S1** (o **Esporta S2**): Layup Calculator compilato (un file per pezzo), immagini per l\'appendice e documento Word con le tabelle.',
        'Si scaricano uno alla volta o tutti in uno zip; ogni tabella ha anche "Copia per Google Docs".',
      ],
    },
    {
      id: 's2', re: /\bs2\b|congel|as.?built|misurat|consuntiv/,
      title: 'Passare dall\'S1 all\'S2',
      steps: [
        '**Panoramica** → **Congela S1 e crea S2** (c\'è anche in fondo a Esporta): l\'S1 resta dentro il progetto come riferimento.',
        'Aggiorna voci e pezzi ai valori reali e segnali **✓ misurata**; nei pezzi puoi inserire il peso reale pesato.',
        '**Confronto S1→S2** mostra le differenze; **Esporta S2** prepara le tabelle.',
      ],
    },
    {
      id: 'save', re: /salv|apri|aprire|condivid|file|backup|annull|ctrl/,
      title: 'Salvare, aprire e condividere il progetto',
      steps: [
        '**Salva** (Ctrl+S) scrive il file `.dollaroni.json`: è quello da condividere con il team.',
        '**Nuovo / apri** → "Apri un file progetto…" per aprirne uno; il browser tiene comunque una copia automatica ("Riprendi").',
        'Ctrl+Z annulla qualsiasi modifica, anche quelle fatte da me; Ctrl+Y la ripete.',
      ],
    },
    {
      id: 'waste', re: /scart/,
      title: 'Registrare gli scarti (S2, regole 2027 §9.2.2)',
      steps: ['Nei **Pezzi laminati** inserisci il materiale consumato in più e buttato; nei dettagli delle **Voci di costo** il campo "di cui scarto". L\'export S2 li riporta nella tabella "Material use and waste".'],
    },
    {
      id: 'performance', re: /performance|rating|condizion/,
      title: 'Compilare il Performance Rating (2027)',
      steps: ['Barra a sinistra → **Performance Rating** → per ognuno dei 15 componenti spunta le condizioni a)–g) vere. Vele, alberi e foil commerciali dal 2017 contano −100 da soli, dalle voci con la parte usata.'],
    },
    {
      id: 'update', re: /aggiorn|version|novit/,
      title: 'Aggiornare Dollaroni',
      steps: ['Quando esce una versione nuova compare in basso "È disponibile Dollaroni x.y.z": clicca **Aggiorna ora**. In fondo alla barra laterale ci sono la versione, **Novità** e **Controlla**.'],
    },
  ];
}

/** Istruzioni per la domanda: i passaggi degli argomenti riconosciuti (al massimo 3). */
export function howToBlock(question, ev) {
  const q = normalize(question);
  const topics = howToTopics(ev.rules, ev.catalog);
  let hits = topics.filter((t) => t.re.test(q)).slice(0, 3);
  if (!hits.length) {
    return {
      id: 'howto', title: 'Come fare',
      lines: ['Posso spiegarti come: ' + topics.map((t) => t.title.charAt(0).toLowerCase() + t.title.slice(1)).join('; ') + '. Dimmi quale ti serve.'],
      links: [],
    };
  }
  // "pezzo" scatta anche per parole come "scafo": se c'è un argomento più preciso, si tiene solo quello
  if (hits.length > 1 && hits[0].id === 'part' && !/pezz|sezion|substack|strat|ply/.test(q)) hits = hits.slice(1);
  const lines = [];
  for (const t of hits) {
    lines.push(`**${t.title}**`);
    t.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  }
  const links = hits.map((t) => ({ part: { label: 'Pezzi laminati', view: 'parts' }, material: { label: 'Listino', view: 'catalog' }, line: { label: 'Voci di costo', view: 'lines' }, export: { label: 'Esporta', view: 'export' }, s2: { label: 'Panoramica', view: 'overview' }, performance: { label: 'Performance Rating', view: 'performance' } }[t.id])).filter(Boolean);
  return { id: 'howto', title: 'Come fare', lines, links };
}
