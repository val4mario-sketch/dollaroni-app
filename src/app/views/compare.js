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
      <div class="page-head"><div><h1>Confronto S1 → S2</h1><p class="muted">Il confronto si attiva quando il progetto passa a S2.</p></div></div>
      <${Empty} title="Il progetto è ancora in S1" action=${html`<${Button} kind="primary" icon="layers" onClick=${onToS2}>Congela S1 e crea S2</${Button}>`}>
        Quando l'S1 è consegnato, congelalo: resterà dentro il progetto come riferimento e l'S2 partirà dagli stessi pezzi e voci.</${Empty}>`;
  }
  if (!evBase) {
    return html`
      <div class="page-head"><div><h1>Confronto S1 → S2</h1></div></div>
      <${Empty} title="Manca l'S1 di riferimento" action=${html`<${Button} kind="primary" icon="folder" onClick=${onLinkBaseline}>Collega il file dell'S1 consegnato…</${Button}>`}>
        La sezione 2.3 dell'S2 chiede di evidenziare le differenze con l'S1: apri il file .dollaroni.json dell'S1 consegnato per usarlo come riferimento.</${Empty}>`;
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
      <div><h1>Confronto S1 → S2</h1><p class="muted">Cosa è cambiato rispetto alla stima S1${frozen ? ` congelata il ${frozen}` : ''}. Serve per la 2.3 (differenze con l'S1) e la 2.4 (accuratezza dei costi) del report S2.</p></div>
      <${Button} icon="download" onClick=${onDownloadBaseline}>Scarica l'S1 congelato</${Button}>
    </div>

    <div class="metrics">
      <div class="metric"><span class="metric-label">Stima S1</span><span class="metric-value">${sm(cmp.total.s1)} <small>SM$</small></span><span class="metric-sub">${evBase.project.name} ${evBase.project.season}</span></div>
      <div class="metric"><span class="metric-label">As-built S2</span><span class="metric-value">${sm(cmp.total.s2)} <small>SM$</small></span><span class="metric-sub">margine ${sm(ev.margin)} SM$</span></div>
      <div class="metric"><span class="metric-label">Differenza</span><span class=${`metric-value ${cmp.total.delta > 0 ? 't-warn' : 't-ok'}`}>${signed(cmp.total.delta)} <small>SM$</small></span><span class="metric-sub">${variation(cmp.total.variation)} rispetto all'S1</span></div>
      <div class="metric"><span class="metric-label">Già misurato</span><span class="metric-value">${pct(basis.share, 0)}</span><span class="metric-sub">${basis.estimatedCount} voci ancora stimate</span></div>
    </div>

    <${Card} title="Per componente (tabella di confronto della 2.3)">
      <table class="tbl cmp-tbl">
        <thead><tr><th>Componente</th><th class="r">S1</th><th class="r">S2</th><th class="r">Δ SM$</th><th class="r">Variazione</th><th style="width:34%"></th></tr></thead>
        <tbody>${cmp.rows.map((r) => {
          const c = ev.components.find((x) => x.en === r.component);
          return html`<tr>
            <td><button class="link" onClick=${() => go('lines', { component: c?.id })}>${c?.it || r.component}</button></td>
            <td class="r">${r.s1 === null ? '—' : sm(r.s1)}</td>
            <td class="r strong">${sm(r.s2)}</td>
            <td class=${`r ${r.delta > 0 ? 't-warn' : r.delta < 0 ? 't-ok' : ''}`}>${r.isNew ? html`<${Badge} tone="info">nuova</${Badge}>` : signed(r.delta)}</td>
            <td class="r muted">${r.isNew ? '—' : variation(r.variation)}</td>
            <td><div class="dual-bar"><${Bar} ratio=${(r.s1 || 0) / maxAbs} tone="neutral" height=${5} /><${Bar} ratio=${r.s2 / maxAbs} height=${5} /></div></td>
          </tr>`;
        })}</tbody>
        <tfoot><tr><td class="strong">Totale</td><td class="r strong">${sm(cmp.total.s1)}</td><td class="r strong">${sm(cmp.total.s2)}</td><td class="r strong">${signed(cmp.total.delta)}</td><td class="r">${variation(cmp.total.variation)}</td><td class="muted small">grigio S1 · blu S2</td></tr></tfoot>
      </table>
    </${Card}>

    <${Card} title=${html`Cosa è cambiato, voce per voce <span class="muted small">(${items.length} differenze, dalla più grande)</span>`}>
      ${items.length === 0 ? html`<p class="muted">Nessuna differenza: l'S2 è ancora uguale alla stima S1.</p>` : html`
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
        ${items.length > 12 && html`<${Button} small onClick=${() => setShowAll(!showAll)}>${showAll ? 'Mostra solo le principali' : `Mostra tutte (${items.length})`}</${Button}>`}`}
    </${Card}>

    <div class="grid-2">
      <${Card} title="Pezzi laminati: massa S1 → S2">
        ${parts.length === 0 ? html`<p class="muted">Nessun pezzo laminato.</p>` : html`<table class="tbl tbl-compact">
          <thead><tr><th>Pezzo</th><th class="r">S1</th><th class="r">S2 calcolato</th><th class="r">S2 pesato</th></tr></thead>
          <tbody>${parts.map((p) => html`<tr>
            <td>${p.kind === 'removed' ? html`<span class="muted">${p.name} (eliminato)</span>` : html`<button class="link" onClick=${() => go('parts', { part: p.id })}>${p.name}</button>`}${p.kind === 'new' ? html` <${Badge} tone="info">nuovo</${Badge}>` : ''}</td>
            <td class="r">${p.mass1 === null ? '—' : kg(p.mass1)}</td>
            <td class="r">${p.mass2 === null ? '—' : kg(p.mass2)}</td>
            <td class="r">${p.weighed === null ? html`<span class="muted small">da pesare</span>` : kg(p.weighed)}</td>
          </tr>`)}</tbody></table>`}
      </${Card}>
      <${Card} title="Quanto è già as-built (per la 2.4)">
        <div class="basis-list">${basis.rows.filter((r) => r.count > 0).map((r) => html`
          <div class="basis-row">
            <span>${r.it}</span>
            <${Bar} ratio=${r.total > 0 ? r.measured / r.total : 0} tone=${r.estimatedCount ? 'warn' : 'ok'} height=${6} />
            <span class="small ${r.estimatedCount ? 't-warn' : 't-ok'}">${r.estimatedCount ? `${r.estimatedCount} stimate` : 'tutto misurato'}</span>
          </div>`)}</div>
        <p class="muted small mt">Segna "misurata" ogni voce aggiornata con il valore reale (pesate, ore effettive, scontrini). Le voci ancora stimate vanno dichiarate nell'autovalutazione.</p>
      </${Card}>
    </div>`;
}
