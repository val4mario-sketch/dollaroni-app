import { html, Card, Bar, Badge, Button, toneForRatio, Empty } from '../ui.js';
import { sm, kg, pct, num } from '../format.js';
import { costingBasis } from '../../engine/compare.js';
import { CURRENT_RULES, rulesId } from '../../engine/rules.js';
import { fmtPoints } from '../../engine/reports.js';

/** Avviso quando il progetto chiede regole diverse da quelle giuste per la stagione. */
function RulesNotice({ project, ctx, onToRules2027 }) {
  const asked = rulesId(project);
  if (asked !== ctx.rules.id) {
    return html`<div class="notice notice-warn">Il file chiede il regolamento ${asked}, che questa versione di Dollaroni non conosce: uso le regole ${ctx.rules.id}.</div>`;
  }
  if (ctx.rules.id === '2026' && (project.season ?? 0) >= 2027 && CURRENT_RULES === '2027') {
    return html`<${Card} className="transition-card" title=${`Questo progetto ${project.season} usa ancora le regole 2026`}>
      <p class="muted">Con le regole 2027: budget da tenere sotto i 10.000 SM$ (sforarlo costa 500 punti), parti usate senza più costo fisso, Performance Rating (Tab. 3) e scarti in S2.
        I costi calcolati non cambiano: listino, sconti e limiti di carbonio restano quelli di adesso.</p>
      <${Button} kind="primary" icon="check" onClick=${onToRules2027}>Passa alle regole 2027</${Button}>
    </${Card}>`;
  }
  return null;
}

/** Cosa è ancora provvisorio con le regole 2027 (listino su SuMoth Agora, non ancora accessibile). */
function ProvisionalCard({ ctx }) {
  if (!ctx.rules.official.provisional) return null;
  return html`<${Card} title=${`Regole ${ctx.rules.id}: cosa è ancora provvisorio`}>
    <ul class="plain-list small">
      <li><strong>Listino:</strong> nel 2027 i costi stanno sulla SuMoth Agora Platform, aperta solo ai team ammessi (§10.1.1). Finché non la vediamo si usano i prezzi 2026.</li>
      <li><strong>Sconti di provenienza</strong> (eccedenza −25%, scaduto −50%, upcycled −100%): il regolamento 2027 non li cita più. Restano attivi ma sono da confermare.</li>
      <li><strong>Layup Calculator:</strong> il regolamento 2027 non lo cita. Le masse si calcolano con le formule del file 2026.</li>
      <li><strong>Consegna del costo:</strong> si dichiara su Agora, come Predicted Manufacturing Cost in S1 (§7.3) e Measured Manufacturing Cost in S2 (§9.2), 500 punti ciascuno. I template 2027 sono su Moodle.</li>
    </ul>
  </${Card}>`;
}

function StageCard({ project, ev, evBase, go, onToS2 }) {
  if (project.stage !== 'S2') {
    return html`<${Card} className="transition-card" title="Avete consegnato l'S1?">
      <p class="muted">Quando la stima S1 è consegnata, si passa a S2 da qui:</p>
      <ol class="small">
        <li>L'S1 viene <strong>congelato</strong> dentro il progetto: resta il riferimento fisso per il confronto della 2.3.</li>
        <li>Il progetto diventa <strong>S2</strong> con gli stessi pezzi e voci, tutti segnati "stimata".</li>
        <li>Durante la costruzione aggiorni ogni voce al valore reale e la segni <strong>misurata</strong>.</li>
        <li>"Esporta S2" produce le tabelle 2.2, 2.3 e i dati per la 2.4.</li>
      </ol>
      <${Button} kind="primary" icon="layers" onClick=${onToS2}>Congela S1 e crea S2</${Button}>
    </${Card}>`;
  }
  const b = costingBasis(ev);
  return html`<${Card} title="Avanzamento S2 (as-built)" actions=${html`<${Button} small onClick=${() => go('compare')}>Confronto con l'S1</${Button}>`}>
    <div class="basis-row"><span>Costo già misurato</span><${Bar} ratio=${b.share} tone=${b.share >= 0.999 ? 'ok' : 'warn'} height=${8} /><span class="strong">${pct(b.share, 0)}</span></div>
    <p class="small muted mt">${b.estimatedCount
      ? `${b.estimatedCount} voci su ${b.count} sono ancora stime da aggiornare con i valori reali.`
      : 'Tutte le voci sono aggiornate con i valori reali.'}
      ${evBase ? ` Rispetto alla stima S1 (${sm(evBase.total)} SM$): ${ev.total - evBase.total >= 0 ? '+' : '−'}${sm(Math.abs(ev.total - evBase.total))} SM$.` : " Manca l'S1 di riferimento per il confronto."}</p>
  </${Card}>`;
}

export function Overview({ project, ev, evBase, ctx, checks, go, onToS2, onToRules2027 }) {
  const lam = ev.parts.reduce((a, p) => a + p.totals.composite / 1000 + (p.core?.mass || 0) + (p.core?.uptake || 0), 0);
  const errors = checks.filter((c) => c.level === 'error');
  const warnings = checks.filter((c) => c.level === 'warning');
  const maxComp = Math.max(1, ...ev.components.map((c) => c.total));
  const carbon = ev.carbon.filter((g) => g.hasCarbon);

  const massRef = ctx.rules.refs.mass;
  return html`
    <div class="page-head">
      <div><h1>Panoramica</h1><p class="muted">Tutto il progetto a colpo d'occhio. I numeri si aggiornano mentre modifichi pezzi e voci.</p></div>
    </div>
    <${RulesNotice} project=${project} ctx=${ctx} onToRules2027=${onToRules2027} />

    <div class="metrics">
      <div class="metric"><span class="metric-label">Costo totale</span><span class="metric-value">${sm(ev.total)} <small>SM$</small></span><span class="metric-sub">${pct(ev.total / ev.budget)} del budget</span></div>
      <div class=${`metric ${ev.margin < 0 ? 'metric-err' : ''}`}><span class="metric-label">Margine</span><span class="metric-value">${sm(ev.margin)} <small>SM$</small></span><span class="metric-sub">budget ${num(ev.budget, 0)} SM$</span></div>
      <div class="metric"><span class="metric-label">Laminati stimati</span><span class="metric-value">${num(lam, 2)} <small>kg</small></span><span class="metric-sub">${ev.parts.length} pezzi, fibra + resina + anime</span></div>
      <div class="metric"><span class="metric-label">Controlli</span><span class="metric-value">${errors.length ? html`<span class="t-err">${errors.length}</span>` : html`<span class="t-ok">0</span>`} <small>${errors.length === 1 ? 'errore' : 'errori'}</small></span><span class="metric-sub">${warnings.length} da verificare${ev.handicap ? ` · handicap ${ev.handicap} pt` : ''}</span></div>
      ${ev.performance && html`<button class="metric metric-link" onClick=${() => go('performance')} title="Apri il Performance Rating">
        <span class="metric-label">Performance Rating</span>
        <span class=${`metric-value ${ev.performance.total > 0 ? 't-ok' : ev.performance.total < 0 ? 't-err' : ''}`}>${fmtPoints(ev.performance.total)} <small>punti</small></span>
        <span class="metric-sub">Tab. 3 · ${ev.performance.declaredCount} su ${ev.performance.components.length} componenti dichiarati</span></button>`}
    </div>

    <${StageCard} project=${project} ev=${ev} evBase=${evBase} go=${go} onToS2=${onToS2} />

    <div class="grid-2">
      <${Card} title="Dove vanno i dollari" actions=${html`<${Button} small onClick=${() => go('lines')}>Tutte le voci</${Button}>`}>
        <div class="comp-list">
          ${ev.components.map((c) => html`
            <button class="comp-row" onClick=${() => go('lines', { component: c.id })} title="Vedi le voci di ${c.it}">
              <span class="comp-name">${c.it}</span>
              <span class="comp-bar"><${Bar} ratio=${c.total / maxComp} /></span>
              <span class="comp-val">${sm(c.total)}</span>
              <span class="comp-pct muted">${pct(c.total / ev.budget)}</span>
            </button>`)}
        </div>
      </${Card}>

      <${Card} title="Limiti di carbonio (Tab. 2)">
        ${carbon.length === 0
          ? html`<p class="muted">Nessun pezzo contiene fibra di carbonio.</p>`
          : html`<div class="carbon-list">
            ${carbon.map((g) => html`
              <div class="carbon-row">
                <div class="carbon-name">${g.en}</div>
                ${g.checks.filter((c) => c.value > 0).map((c) => html`
                  <div class="carbon-check">
                    <span class="muted small">${c.label}</span>
                    <${Bar} ratio=${c.ratio} tone=${toneForRatio(c.ratio)} height=${6} />
                    <span class=${`small t-${toneForRatio(c.ratio)}`}>${num(c.value, 3)} / ${num(c.limit, 2)} kg</span>
                  </div>`)}
              </div>`)}
          </div>`}
      </${Card}>
    </div>

    <div class="grid-2">
      <${Card} title=${massRef ? `Masse stimate per il ${massRef}` : 'Masse stimate'} actions=${html`<span class="muted small">kg</span>`}>
        ${ev.mass.some((m) => m.total > 0)
          ? html`<table class="tbl tbl-compact">
              <thead><tr><th></th><th class="r">Fibra</th><th class="r">Resina</th><th class="r">Anima</th><th class="r">Altro</th><th class="r">Totale</th></tr></thead>
              <tbody>${ev.mass.filter((m) => m.total > 0).map((m) => html`
                <tr><td>${m.en}</td><td class="r">${num(m.fibre, 2)}</td><td class="r">${num(m.resin + m.uptake, 2)}</td><td class="r">${num(m.core, 2)}</td><td class="r">${num(m.other, 2)}</td><td class="r strong">${num(m.total, 2)}</td></tr>`)}
              </tbody></table>`
          : html`<p class="muted">Aggiungi dei pezzi laminati per vedere le masse.</p>`}
      </${Card}>

      <${Card} title="Da sistemare" actions=${html`<${Button} small onClick=${() => go('checks')}>Tutti i controlli</${Button}>`}>
        ${errors.length + warnings.length === 0
          ? html`<p class="t-ok">Nessun problema trovato.</p>`
          : html`<ul class="check-mini">${[...errors, ...warnings].slice(0, 6).map((c) => html`
              <li><${Badge} tone=${c.level === 'error' ? 'err' : 'warn'}>${c.level === 'error' ? 'errore' : 'verifica'}</${Badge}> ${c.message}</li>`)}</ul>`}
      </${Card}>
    </div>
    <${ProvisionalCard} ctx=${ctx} />`;
}

export { Empty };
