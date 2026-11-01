// Controlli automatici sul progetto valutato. Messaggi in italiano (vista interna).
// level: 'error' (da sistemare prima di consegnare) | 'warning' (da verificare) | 'info'.

import { weighedParts } from './compare.js';

const pct = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%`;
const kg = (x) => `${x.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`;
const sm = (x) => `${x.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' })} SM$`;
const num = (x) => x.toLocaleString('it-IT', { maximumFractionDigits: 3 });

const CARBON_RE = /carbon|\bcf\b|cfrp/i;

/** Materiale di carbonio su una voce a mano: i limiti della Tab. 2 si calcolano solo dai pezzi laminati. */
function isManualCarbon(l) {
  const m = l.material;
  if (!m || l.line.auto || l.usedPart || l.line.material.fromLayup || l.line.material.check) return false;
  if (m.entry && !m.entry.extra) return ['reinforcement', 'prepreg'].includes(m.entry.kind) && CARBON_RE.test(`${m.entry.group ?? ''} ${m.entry.type ?? ''}`);
  // voce libera: solo materiale a peso, non pezzi già fatti come un albero upcycled (in "pc")
  return m.unit === 'kg' && CARBON_RE.test(`${m.label ?? ''} ${m.entry?.name ?? ''}`);
}

/** Valori che non possono essere negativi, come [dove, campo, valore, id]. */
function negativeValues(project) {
  const out = [];
  const scan = (where, id, obj, fields) => {
    for (const [f, label] of fields) {
      if (typeof obj?.[f] === 'number' && obj[f] < 0) out.push([where, label, obj[f], id]);
    }
  };
  for (const part of project?.parts || []) {
    (part.substacks || []).forEach((s, i) => scan(`${part.name}, substack ${i + 1}`, part.id, s, [['plyArea', 'area'], ['plies', 'strati'], ['arealWeight', 'grammatura']]));
    scan(`${part.name}, anima`, part.id, part.core, [['mass', 'massa'], ['area', 'area'], ['thickness', 'spessore'], ['density', 'densità'], ['resinUptake', 'assorbimento di resina']]);
    scan(part.name, part.id, part, [['measuredMass', 'peso pesato']]);
    for (const [ref, kgWaste] of Object.entries(part.waste || {})) {
      if (kgWaste < 0) out.push([part.name, `scarto di ${ref}`, kgWaste, part.id]);
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
  for (const [items, what] of [[project?.parts, 'pezzi'], [project?.lines, 'voci'], [project?.catalogExtras, 'voci del team']]) {
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

  // 2027: il budget va tenuto "sotto" i 10.000 SM$ e sforarlo costa punti
  const penalty = rules.budgetPenalty ? `: costa −${rules.budgetPenalty} punti (${refs.budget})` : '';
  const over = ev.total - ev.budget; // confronto al centesimo
  if (over > 0.005) add('error', 'budget', `Budget superato di ${sm(over)}${penalty}`);
  else if (rules.budgetStrict && over > -0.005) add('error', 'budget', `Budget esattamente al limite: va tenuto sotto ${sm(ev.budget)}${penalty}`);
  else if (ev.margin < ev.budget * 0.02) add('warning', 'budget-margin', `Margine sul budget molto ridotto: ${sm(ev.margin)}`);

  for (const l of ev.unknownComponent) add('error', 'component', `"${l.name}": componente "${l.component}" non valido`, l.id);

  for (const [where, label, value, id] of negativeValues(ev.project)) add('error', 'negative', `${where}: ${label} negativa o negativo (${num(value)}), abbasserebbe i conti`, id);
  for (const [what, id] of duplicateIds(ev.project)) add('error', 'duplicate-id', `Due o più ${what} hanno lo stesso id "${id}": i calcoli e il confronto S1→S2 possono confonderli`, id);

  for (const pr of ev.parts) {
    const p = pr.part;
    for (const e of pr.errors) add('error', 'part', `${p.name}: ${e}`, p.id);
    if (p.component === 'foils' && !p.limitGroup) add('warning', 'foil-group', `${p.name}: scegli quale foil è (limiti carbonio Tab. 2). Finché non lo scegli il carbonio finisce nel gruppo "other" e il limite controllato è sbagliato`, p.id);
    const outside = pr.substacks.filter((r) => !r.errors.length && !r.inCalculator);
    if (outside.length) {
      const names = [...new Set(outside.flatMap((r) => [r.reinforcement, r.matrix].filter((m) => !m.inCalculator).map((m) => m.entry.name)))];
      add('warning', 'not-in-calculator', `${p.name}: ${names.join(', ')} non esiste nel Layup Calculator ufficiale: ${help.notInCalculator || 'documentare il calcolo a parte'}`, p.id);
    }
    const n = (p.substacks || []).length;
    if (n > layupMaxSubstacks) add('info', 'split', `${p.name}: ${n} substack, nel template ufficiale verrà diviso in ${Math.ceil(n / layupMaxSubstacks)} file`, p.id);
    if (pr.core && !pr.core.uptake && rules.massBreakdownRequired !== false) add('info', 'uptake', `${p.name}: assorbimento di resina dell'anima non stimato (richiesto nel mass breakdown ${refs.mass})`, p.id);
  }

  for (const g of ev.carbon) {
    for (const c of g.checks) {
      if (!c.value) continue;
      const where = `${g.en} · ${c.label}`;
      if (c.value > c.limit + 1e-9) {
        const grams = (x) => `${(x * 1000).toLocaleString('it-IT', { maximumFractionDigits: 2 })} g`;
        add('error', 'carbon', `Limite carbonio superato di ${grams(c.value - c.limit)} – ${where}: ${grams(c.value)} su ${grams(c.limit)} (Tab. 2)`, g.id);
      } else if (c.ratio >= 0.95) {
        const p = (c.ratio * 100).toLocaleString('it-IT', { maximumFractionDigits: 1 });
        const v = c.value.toLocaleString('it-IT', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
        add('warning', 'carbon-near', `Carbonio al ${p}% del limite – ${where}: ${v} kg su ${kg(c.limit)} (Tab. 2)`, g.id);
      }
    }
  }

  for (const l of ev.lines) {
    const name = l.line.s2Label || l.name;
    for (const e of l.errors) add('error', 'line', `${name}: ${e}`, l.id);
    const m = l.material;
    if (!l.line.auto && !l.errors.length) {
      // un prezzo 0 del listino ufficiale è legittimo (basalto, PET riciclato…): si segnalano solo i valori inseriti a mano
      const noPrice = m && m.basePrice === 0 && m.factor > 0 && (!m.entry || m.entry.extra || m.manualPrice);
      if (!m && !l.process && !l.usedPart) add('warning', 'zero-cost', `${name}: voce vuota, non costa niente`, l.id);
      else if (m && m.qty === 0) add('warning', 'zero-cost', `${name}: quantità 0, la voce non costa niente`, l.id);
      else if (noPrice) add('warning', 'zero-cost', `${name}: prezzo 0 SM$ inserito a mano. Se è gratis indicane il motivo, altrimenti manca il prezzo`, l.id);
      if (l.process && l.process.cost === 0) add('warning', 'zero-cost', `${name}: lavorazione con ore o tariffa a 0, non costa niente`, l.id);
    }
    if (m && isManualCarbon(l) && m.qty > 0) {
      add('warning', 'manual-carbon', `${name}: ${num(m.qty)} ${m.unit} di carbonio su una voce a mano non contano nei limiti della Tab. 2. Inseriscilo in un pezzo laminato o controlla il limite a parte`, l.id);
    }
    if (m) {
      if (m.layupKg !== null && l.line.material.qty !== undefined && m.layupKg > 0) {
        const d = (m.qty - m.layupKg) / m.layupKg;
        if (Math.abs(d) > qtyTolerance) {
          add('warning', 'qty-vs-layup', `${name}: dichiarati ${kg(m.qty)}, dal layup risultano ${kg(m.layupKg)} (${pct(d)})`, l.id);
        }
      }
      // solo i materiali del listino (PVC/SAN, PTFE…): un pezzo comprato può costare tanto senza essere "penalizzato"
      if (m.entry && !m.entry.extra && (m.basePrice ?? 0) >= 1000 && m.factor > 0) add('warning', 'penalty', `${name}: ${m.label} costa ${m.basePrice} SM$/${m.unit} (materiale penalizzato)`, l.id);
      if (m.source === 'upcycled' && !l.line.origin && !l.line.notes) add('warning', 'upcycled-origin', `${name}: per gli elementi upcycled vanno indicate origine e trasformazione (${refs.upcycled})`, l.id);
      const usedWithoutSource = l.usedPart && !l.usedPart.fixed && !m.priceSource;
      if (usedWithoutSource) {
        add('warning', 'used-price', `${name}: nel 2027 le parti usate non hanno più il costo fisso della vecchia Tab. 3. Prendi il prezzo da SuMoth Agora e indica la fonte`, l.id);
      } else if ((m.manualPrice || m.entry?.extra) && !m.priceSource && !m.entry?.priceSource && m.factor > 0 && m.unitPrice > 0) {
        add('info', 'price-source', `${name}: prezzo inserito a mano senza fonte (${help.priceSource || 'indicare da dove viene'})`, l.id);
      }
      if (m.waste > 0 && m.waste > m.qty + 1e-9) add('warning', 'waste-over', `${name}: lo scarto (${num(m.waste)}) è più della quantità usata (${num(m.qty)})`, l.id);
      // elemento upcycled recuperato (voce libera, non materiale di listino) nello scafo
      if (rules.upcycledHullNonFoiling && l.component === 'hull' && m.source === 'upcycled' && !m.entry) {
        add('info', 'upcycled-hull', `${name}: se è uno scafo (o parte di scafo) recuperato, nel 2027 è ammesso solo se in origine era di un'imbarcazione non foiling (§6.2.1)`, l.id);
      }
    }
    if (l.usedPart?.doubled) add('info', 'foil-doubling', `${name}: handicap raddoppiato (foil usato dopo il primo anno di partecipazione)`, l.id);
  }

  // 2027: gli sconti di provenienza del §3.3.B 2026 non sono più nel regolamento
  if (rules.sourcesToConfirm) {
    const discounted = ev.lines.filter((l) => l.material && l.material.factor !== 1);
    if (discounted.length) {
      const saving = discounted.reduce((a, l) => a + (l.material.basePrice ?? 0) * (1 - l.material.factor) * l.material.qty, 0);
      const noPrice = discounted.filter((l) => l.material.basePrice === null).length;
      const marginWithout = ev.margin - saving;
      const worstCase = marginWithout < 0 ? `sforeresti il budget di ${sm(-marginWithout)}` : `il margine scenderebbe a ${sm(marginWithout)}`;
      add('warning', 'discount-unconfirmed',
        `${discounted.length} voci usano gli sconti di provenienza del 2026 (eccedenza −25%, scaduto −50%, upcycled −100%), che il regolamento 2027 non cita più. ` +
        `Valgono ${sm(saving)} di sconto${noPrice ? ` più ${noPrice} ${noPrice === 1 ? 'elemento upcycled' : 'elementi upcycled'} senza prezzo di listino` : ''}: da confermare su SuMoth Agora. ` +
        `Senza sconti il totale sarebbe ${sm(ev.total + saving)} e ${worstCase}${noPrice ? ', senza contare gli elementi senza prezzo' : ''}`);
    }
  }

  // 2027: Performance Rating (Tab. 3)
  if (ev.performance) {
    for (const c of ev.performance.commercial) {
      if (c.points) add('info', 'commercial-2017', `${c.name}: ${c.year === null ? 'anno di produzione non indicato, quindi' : `prodotto nel ${c.year},`} vale ${c.points} punti di Performance Rating (§11.1.5)`, c.lineId);
    }
    const missing = ev.performance.components.length - ev.performance.declaredCount;
    if (missing > 0) add('info', 'performance-undeclared', `Performance Rating: ${missing} componenti su ${ev.performance.components.length} senza condizioni spuntate (valgono 0). Su SuMoth Agora vanno dichiarati i componenti usati in S2 e S3 (§11.3)`);
  }

  // Controlli dello stage S2 (as-built)
  if (ev.project?.stage === 'S2') {
    if (!ev.project.baseline) add('info', 's2-baseline', "Nessun S1 di riferimento: collega l'S1 consegnato per il confronto richiesto nella 2.3 dell'S2");
    const est = ev.lines.filter((l) => l.status !== 'measured');
    if (est.length) {
      const cost = est.reduce((a, l) => a + l.total, 0);
      const share = ev.total > 0 ? cost / ev.total : 0;
      add('warning', 's2-estimated', `${est.length} voci ancora stimate (${sm(cost)}, ${(share * 100).toLocaleString('it-IT', { maximumFractionDigits: 1 })}% del totale): in S2 vanno aggiornate ai valori reali e segnate come misurate`);
    }
    for (const w of weighedParts(ev)) {
      if (w.ratio !== null && Math.abs(w.ratio) > weighTolerance) {
        add('warning', 'weighed-mass', `${w.name}: pesato ${kg(w.weighed)}, dal calcolo ${kg(w.computed)} (${pct(w.ratio)}). Utile da spiegare nell'autovalutazione (2.4)`, w.id);
      }
    }
    if (rules.wasteTracking && !ev.waste?.rows.length) {
      add('info', 'waste-none', 'Nessuno scarto registrato: nel 2027 in S2 vanno tracciati anche gli scarti di materiale (§9.2.2). Si inseriscono nei pezzi laminati e nei dettagli delle voci');
    }
  }

  const order = { error: 0, warning: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}
