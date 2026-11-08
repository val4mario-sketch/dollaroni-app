import { html, useState, Card, Button, Badge, Bar, Empty } from '../ui.js';
import { sm, pct, num, kg } from '../format.js';
import { compareStages } from '../../engine/reports.js';
import { compareItems, compareParts, costingBasis } from '../../engine/compare.js';

const KIND = {
  new: { label: 'nuova', tone: 'info' },
  removed: { label: 'eliminata', tone: 'neutral' },
  changed: { label: 'cambiata', tone: 'warn' },
};
const signed = (x) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${sm(Math.abs(x))}`;
const variation = (v) => (v === null || !Number.isFinite(v) ? '—' : `${v > 0.0005 ? '+' : v < -0.0005 ? '−' : ''}${pct(Math.abs(v), 1)}`);

export function Compare({ project, ev, evBase, onToS2, onLinkBaseline, onDownloadBaseline, go }) {
  const [showAll, setShowAll] = useState(false);

  if (project.stage !== 'S2') {
    return html`
      <div class="page-head"><div><h1>S1 → S2 comparison</h1><p class="muted">The comparison activates when the project moves to S2.</p></div></div>
      <${Empty} title="The project is still in S1" action=${html`<${Button} kind="primary" icon="layers" onClick=${onToS2}>Freeze S1 and create S2</${Button}>`}>
        When S1 is submitted, freeze it: it will stay inside the project as the reference and S2 will start from the same parts and items.</${Empty}>`;
  }
  if (!evBase) {
    return html`
      <div class="page-head"><div><h1>Confronto S1 → S2</h1></div></div>
      <${Empty} title="Reference S1 missing" action=${html`<${Button} kind="primary" icon="folder" onClick=${onLinkBaseline}>Link the submitted S1 file…</${Button}>`}>
        Section 2.3 of S2 asks you to highlight the differences from S1: open the .dollaroni.json file of the submitted S1 to use it as the reference.</${Empty}>`;
  }

  const cmp = compareStages(evBase, ev);
  const items = compareItems(evBase, ev).filter((x) => x.kind !== 'same');
  const parts = compareParts(evBase, ev);
  const basis = costingBasis(ev);
  const shown = showAll ? items : items.slice(0, 12);
  const maxAbs = Math.max(1, ...cmp.rows.map((r) => Math.max(r.s1 || 0, r.s2)));
  const frozen = project.baseline?.frozenAt ? new Date(project.baseline.frozenAt).toLocaleDateString('it-IT', { dateStyle: 'long' }) : null;

  return html`
    <div class="page-head">
      <div><h1>S1 → S2 comparison</h1><p class="muted">What changed compared with the S1 estimate${frozen ? ` frozen on ${frozen}` : ''}. Needed for sections 2.3 (differences from S1) and 2.4 (cost accuracy) of the S2 report.</p></div>
      <${Button} icon="download" onClick=${onDownloadBaseline}>Download the frozen S1</${Button}>
    </div>

    <div class="metrics">
      <div class="metric"><span class="metric-label">Stima S1</span><span class="metric-value">${sm(cmp.total.s1)} <small>SM$</small></span><span class="metric-sub">${evBase.project.name} ${evBase.project.season}</span></div>
      <div class="metric"><span class="metric-label">As-built S2</span><span class="metric-value">${sm(cmp.total.s2)} <small>SM$</small></span><span class="metric-sub">margin ${sm(ev.margin)} SM$</span></div>
      <div class="metric"><span class="metric-label">Difference</span><span class=${`metric-value ${cmp.total.delta > 0 ? 't-warn' : 't-ok'}`}>${signed(cmp.total.delta)} <small>SM$</small></span><span class="metric-sub">${variation(cmp.total.variation)} compared with S1</span></div>
      <div class="metric"><span class="metric-label">Already measured</span><span class="metric-value">${pct(basis.share, 0)}</span><span class="metric-sub">${basis.estimatedCount} items still estimated</span></div>
    </div>

    <${Card} title="By component (comparison table of section 2.3)">
      <table class="tbl cmp-tbl">
        <thead><tr><th>Component</th><th class="r">S1</th><th class="r">S2</th><th class="r">Δ SM$</th><th class="r">Change</th><th style="width:34%"></th></tr></thead>
        <tbody>${cmp.rows.map((r) => {
          const c = ev.components.find((x) => x.en === r.component);
          return html`<tr>
            <td><button class="link" onClick=${() => go('lines', { component: c?.id })}>${c?.it || r.component}</button></td>
            <td class="r">${r.s1 === null ? '—' : sm(r.s1)}</td>
            <td class="r strong">${sm(r.s2)}</td>
            <td class=${`r ${r.delta > 0 ? 't-warn' : r.delta < 0 ? 't-ok' : ''}`}>${r.isNew ? html`<${Badge} tone="info">new</${Badge}>` : signed(r.delta)}</td>
            <td class="r muted">${r.isNew ? '—' : variation(r.variation)}</td>
            <td><div class="dual-bar"><${Bar} ratio=${(r.s1 || 0) / maxAbs} tone="neutral" height=${5} /><${Bar} ratio=${r.s2 / maxAbs} height=${5} /></div></td>
          </tr>`;
        })}</tbody>
        <tfoot><tr><td class="strong">Totale</td><td class="r strong">${sm(cmp.total.s1)}</td><td class="r strong">${sm(cmp.total.s2)}</td><td class="r strong">${signed(cmp.total.delta)}</td><td class="r">${variation(cmp.total.variation)}</td><td class="muted small">grey S1 · blue S2</td></tr></tfoot>
      </table>
    </${Card}>

    <${Card} title=${html`What changed, item by item <span class="muted small">(${items.length} differences, from the largest)</span>`}>
      ${items.length === 0 ? html`<p class="muted">No differences: S2 is still identical to the S1 estimate.</p>` : html`
        <div class="table-scroll"><table class="tbl tbl-compact">
          <thead><tr><th></th><th>Voce</th><th>Componente</th><th class="r">Quantità S1 → S2</th><th class="r">S1</th><th class="r">S2</th><th class="r">Δ SM$</th></tr></thead>
          <tbody>${shown.map((x) => html`<tr>
            <td><${Badge} tone=${KIND[x.kind].tone}>${KIND[x.kind].label}</${Badge}></td>
            <td>${x.kind === 'removed' ? html`<span class="muted">${x.name}</span>` : html`<button class="link" onClick=${() => (x.auto ? go('parts', { part: x.id.split(':')[0] }) : go('lines', { line: x.id }))}>${x.name}</button>`}</td>
            <td class="muted">${ev.components.find((c) => c.id === x.component)?.it || x.component}</td>
            <td class="r small">${x.qty1 === null ? '—' : num(x.qty1, 3)} → ${x.qty2 === null ? '—' : num(x.qty2, 3)} ${x.unit === 'm2' ? 'm²' : x.unit}</td>
            <td class="r">${x.s1 === null ? '—' : sm(x.s1)}</td>
            <td class="r">${x.s2 === null ? '—' : sm(x.s2)}</td>
            <td class=${`r strong ${x.delta > 0 ? 't-warn' : x.delta < 0 ? 't-ok' : ''}`}>${signed(x.delta)}</td>
          </tr>`)}</tbody>
        </table></div>
        ${items.length > 12 && html`<${Button} small onClick=${() => setShowAll(!showAll)}>${showAll ? 'Show only the main ones' : `Show all (${items.length})`}</${Button}>`}`}
    </${Card}>

    <div class="grid-2">
      <${Card} title="Laminated parts: S1 → S2 mass">
        ${parts.length === 0 ? html`<p class="muted">No laminated parts.</p>` : html`<table class="tbl tbl-compact">
          <thead><tr><th>Part</th><th class="r">S1</th><th class="r">S2 calculated</th><th class="r">S2 weighed</th></tr></thead>
          <tbody>${parts.map((p) => html`<tr>
            <td>${p.kind === 'removed' ? html`<span class="muted">${p.name} (deleted)</span>` : html`<button class="link" onClick=${() => go('parts', { part: p.id })}>${p.name}</button>`}${p.kind === 'new' ? html` <${Badge} tone="info">new</${Badge}>` : ''}</td>
            <td class="r">${p.mass1 === null ? '—' : kg(p.mass1)}</td>
            <td class="r">${p.mass2 === null ? '—' : kg(p.mass2)}</td>
            <td class="r">${p.weighed === null ? html`<span class="muted small">to weigh</span>` : kg(p.weighed)}</td>
          </tr>`)}</tbody></table>`}
      </${Card}>
      <${Card} title="How much is already as-built (for section 2.4)">
        <div class="basis-list">${basis.rows.filter((r) => r.count > 0).map((r) => html`
          <div class="basis-row">
            <span>${r.it}</span>
            <${Bar} ratio=${r.total > 0 ? r.measured / r.total : 0} tone=${r.estimatedCount ? 'warn' : 'ok'} height=${6} />
            <span class="small ${r.estimatedCount ? 't-warn' : 't-ok'}">${r.estimatedCount ? `${r.estimatedCount} estimated` : 'all measured'}</span>
          </div>`)}</div>
        <p class="muted small mt">Mark as "measured" each item updated with the real value (weighings, actual hours, receipts). Items still estimated must be declared in the self-assessment.</p>
      </${Card}>
    </div>`;
}
