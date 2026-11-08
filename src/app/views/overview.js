import { html, Card, Bar, Badge, Button, toneForRatio, Empty } from '../ui.js';
import { sm, kg, pct, num } from '../format.js';
import { costingBasis } from '../../engine/compare.js';
import { CURRENT_RULES, rulesId } from '../../engine/rules.js';
import { fmtPoints } from '../../engine/reports.js';

/** Notice when the project asks for rules different from the right ones for the season. */
function RulesNotice({ project, ctx, onToRules2027 }) {
  const asked = rulesId(project);
  if (asked !== ctx.rules.id) {
    return html`<div class="notice notice-warn">The file asks for the rulebook ${asked}, which this version of Dollaroni does not know: using the rules ${ctx.rules.id}.</div>`;
  }
  if (ctx.rules.id === '2026' && (project.season ?? 0) >= 2027 && CURRENT_RULES === '2027') {
    return html`<${Card} className="transition-card" title=${`This project ${project.season} still uses the 2026 rules`}>
      <p class="muted">With the 2027 rules: budget to keep under 10,000 SM$ (exceeding it costs 500 points), used parts with no fixed cost, Performance Rating (Table 3) and S2 waste.
        The calculated costs do not change: price list, discounts and carbon limits stay as they are now.</p>
      <${Button} kind="primary" icon="check" onClick=${onToRules2027}>Switch to the 2027 rules</${Button}>
    </${Card}>`;
  }
  return null;
}

/** What is still provisional with the 2027 rules (price list on SuMoth Agora, not yet accessible). */
function ProvisionalCard({ ctx }) {
  if (!ctx.rules.official.provisional) return null;
  return html`<${Card} title=${`Rules ${ctx.rules.id}: what is still provisional`}>
    <ul class="plain-list small">
      <li><strong>Price list:</strong> in 2027 the costs are on the SuMoth Agora Platform, open only to admitted teams (§10.1.1). Until we can see it, the 2026 prices are used.</li>
      <li><strong>Origin discounts</strong> (surplus −25%, expired −50%, upcycled −100%): the 2027 rulebook no longer mentions them. They stay active but must be confirmed.</li>
      <li><strong>Layup Calculator:</strong> the 2027 rulebook does not mention it. Masses are calculated with the formulas of the 2026 file.</li>
      <li><strong>Cost submission:</strong> declared on Agora, as Predicted Manufacturing Cost in S1 (§7.3) and Measured Manufacturing Cost in S2 (§9.2), 500 points each. The 2027 templates are on Moodle.</li>
    </ul>
  </${Card}>`;
}

function StageCard({ project, ev, evBase, go, onToS2 }) {
  if (project.stage !== 'S2') {
    return html`<${Card} className="transition-card" title="Have you submitted S1?">
      <p class="muted">Once the S1 estimate is submitted, move to S2 from here:</p>
      <ol class="small">
        <li>S1 is <strong>frozen</strong> inside the project: it stays the fixed reference for the comparison in section 2.3.</li>
        <li>The project becomes <strong>S2</strong> with the same parts and items, all marked "estimated".</li>
        <li>During construction you update each item to its real value and mark it <strong>measured</strong>.</li>
        <li>"Export S2" produces tables 2.2 and 2.3 and the data for 2.4.</li>
      </ol>
      <${Button} kind="primary" icon="layers" onClick=${onToS2}>Freeze S1 and create S2</${Button}>
    </${Card}>`;
  }
  const b = costingBasis(ev);
  return html`<${Card} title="Avanzamento S2 (as-built)" actions=${html`<${Button} small onClick=${() => go('compare')}>Comparison with S1</${Button}>`}>
    <div class="basis-row"><span>Cost already measured</span><${Bar} ratio=${b.share} tone=${b.share >= 0.999 ? 'ok' : 'warn'} height=${8} /><span class="strong">${pct(b.share, 0)}</span></div>
    <p class="small muted mt">${b.estimatedCount
      ? `${b.estimatedCount} items of ${b.count} are still estimates to update with the real values.`
      : 'All items are updated with the real values.'}
      ${evBase ? ` Compared with the S1 estimate (${sm(evBase.total)} SM$): ${ev.total - evBase.total >= 0 ? '+' : '−'}${sm(Math.abs(ev.total - evBase.total))} SM$.` : " The reference S1 for the comparison is missing."}</p>
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
      <div><h1>Overview</h1><p class="muted">The whole project at a glance. The numbers update as you edit parts and items.</p></div>
    </div>
    <${RulesNotice} project=${project} ctx=${ctx} onToRules2027=${onToRules2027} />

    <div class="metrics">
      <div class="metric"><span class="metric-label">Total cost</span><span class="metric-value">${sm(ev.total)} <small>SM$</small></span><span class="metric-sub">${pct(ev.total / ev.budget)} of the budget</span></div>
      <div class=${`metric ${ev.margin < 0 ? 'metric-err' : ''}`}><span class="metric-label">Margin</span><span class="metric-value">${sm(ev.margin)} <small>SM$</small></span><span class="metric-sub">budget ${num(ev.budget, 0)} SM$</span></div>
      <div class="metric"><span class="metric-label">Estimated laminates</span><span class="metric-value">${num(lam, 2)} <small>kg</small></span><span class="metric-sub">${ev.parts.length} parts, fibre + resin + cores</span></div>
      <div class="metric"><span class="metric-label">Checks</span><span class="metric-value">${errors.length ? html`<span class="t-err">${errors.length}</span>` : html`<span class="t-ok">0</span>`} <small>${errors.length === 1 ? 'errore' : 'errori'}</small></span><span class="metric-sub">${warnings.length} to check${ev.handicap ? ` · handicap ${ev.handicap} pt` : ''}</span></div>
      ${ev.performance && html`<button class="metric metric-link" onClick=${() => go('performance')} title="Apri il Performance Rating">
        <span class="metric-label">Performance Rating</span>
        <span class=${`metric-value ${ev.performance.total > 0 ? 't-ok' : ev.performance.total < 0 ? 't-err' : ''}`}>${fmtPoints(ev.performance.total)} <small>points</small></span>
        <span class="metric-sub">Table 3 · ${ev.performance.declaredCount} of ${ev.performance.components.length} components declared</span></button>`}
    </div>

    <${StageCard} project=${project} ev=${ev} evBase=${evBase} go=${go} onToS2=${onToS2} />

    <div class="grid-2">
      <${Card} title="Where the dollars go" actions=${html`<${Button} small onClick=${() => go('lines')}>All items</${Button}>`}>
        <div class="comp-list">
          ${ev.components.map((c) => html`
            <button class="comp-row" onClick=${() => go('lines', { component: c.id })} title="See the items of ${c.it}">
              <span class="comp-name">${c.it}</span>
              <span class="comp-bar"><${Bar} ratio=${c.total / maxComp} /></span>
              <span class="comp-val">${sm(c.total)}</span>
              <span class="comp-pct muted">${pct(c.total / ev.budget)}</span>
            </button>`)}
        </div>
      </${Card}>

      <${Card} title="Carbon limits (Table 2)">
        ${carbon.length === 0
          ? html`<p class="muted">No part contains carbon fibre.</p>`
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
      <${Card} title=${massRef ? `Estimated masses for the ${massRef}` : 'Estimated masses'} actions=${html`<span class="muted small">kg</span>`}>
        ${ev.mass.some((m) => m.total > 0)
          ? html`<table class="tbl tbl-compact">
              <thead><tr><th></th><th class="r">Fibra</th><th class="r">Resina</th><th class="r">Anima</th><th class="r">Altro</th><th class="r">Totale</th></tr></thead>
              <tbody>${ev.mass.filter((m) => m.total > 0).map((m) => html`
                <tr><td>${m.en}</td><td class="r">${num(m.fibre, 2)}</td><td class="r">${num(m.resin + m.uptake, 2)}</td><td class="r">${num(m.core, 2)}</td><td class="r">${num(m.other, 2)}</td><td class="r strong">${num(m.total, 2)}</td></tr>`)}
              </tbody></table>`
          : html`<p class="muted">Add laminated parts to see the masses.</p>`}
      </${Card}>

      <${Card} title="To fix" actions=${html`<${Button} small onClick=${() => go('checks')}>All checks</${Button}>`}>
        ${errors.length + warnings.length === 0
          ? html`<p class="t-ok">No problems found.</p>`
          : html`<ul class="check-mini">${[...errors, ...warnings].slice(0, 6).map((c) => html`
              <li><${Badge} tone=${c.level === 'error' ? 'err' : 'warn'}>${c.level === 'error' ? 'errore' : 'verifica'}</${Badge}> ${c.message}</li>`)}</ul>`}
      </${Card}>
    </div>
    <${ProvisionalCard} ctx=${ctx} />`;
}

export { Empty };
