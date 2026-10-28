// Performance Rating del regolamento 2027 (Tab. 3, §11): condizioni a)–g) per componente
// e penalità per vele, alberi e foil commerciali dal 2017 in poi (§11.1.5).

import { html, Card, Button, NumInput } from '../ui.js';
import { fmtPoints } from '../../engine/reports.js';

const GROUPS = [
  ['Scafo', ['hull_internal', 'hull_shell', 'stern_fitting', 'stem_fitting', 'mast_base']],
  ['Terrazze', ['hiking_rack_structure', 'hiking_rack_covers']],
  ['Foil', ['main_vertical', 'main_horizontal', 'rudder_vertical', 'rudder_horizontal']],
  ['Rig', ['sail', 'mast', 'boom', 'spreader']],
];

const tone = (p) => (p > 0 ? 'pos' : p < 0 ? 'neg' : 'zero');
const toneText = (p) => (p > 0 ? 't-ok' : p < 0 ? 't-err' : 'muted');

export function Performance({ project, ev, ctx, update, go }) {
  const P = ctx.rules.performance;
  const perf = ev.performance;
  const condText = Object.fromEntries(P.conditions.map((c) => [c.id, c.it]));

  const toggle = (compId, condId) => update((d) => {
    d.performance ||= {};
    d.performance.conditions ||= {};
    const list = d.performance.conditions[compId] || [];
    const next = list.includes(condId) ? list.filter((x) => x !== condId) : [...list, condId].sort();
    if (next.length) d.performance.conditions[compId] = next;
    else delete d.performance.conditions[compId];
  });
  const setUsed = (lineId, fn, key) => update((d) => { fn(d.lines.find((l) => l.id === lineId).usedPart); }, key && `${lineId}:${key}`);

  const byId = new Map(perf.components.map((c) => [c.id, c]));
  const grouped = GROUPS.map(([title, ids]) => [title, ids.map((id) => byId.get(id)).filter(Boolean)]);
  const known = new Set(GROUPS.flatMap(([, ids]) => ids));
  const others = perf.components.filter((c) => !known.has(c.id));
  if (others.length) grouped.push(['Altro', others]);

  return html`
    <div class="page-head"><div><h1>Performance Rating</h1>
      <p class="muted">Tab. 3 del regolamento 2027 (§11): punti per componente in base a quanto il team ha progettato e costruito da sé.
      Valgono nelle prove S2 e nelle regate S3 e si dichiarano su SuMoth Agora.</p></div></div>

    <div class="metrics">
      <div class="metric"><span class="metric-label">Performance Rating</span><span class=${`metric-value ${toneText(perf.total)}`}>${fmtPoints(perf.total)} <small>punti</small></span><span class="metric-sub">somma di componenti e parti commerciali</span></div>
      <div class="metric"><span class="metric-label">Dai componenti</span><span class="metric-value">${fmtPoints(perf.componentsPoints)} <small>punti</small></span><span class="metric-sub">${perf.declaredCount} su ${perf.components.length} con condizioni spuntate</span></div>
      <div class="metric"><span class="metric-label">Parti commerciali</span><span class="metric-value">${fmtPoints(perf.commercialPoints)} <small>punti</small></span><span class="metric-sub">vele, alberi e foil dal 2017 (§11.1.5)</span></div>
    </div>

    <${Card} title="Come si calcola">
      <ul class="plain-list small">
        <li>Per ogni componente spunta le condizioni vere: i punti si sommano. Un componente senza condizioni vale 0 (§11.1.6).</li>
        <li>I punti positivi arrivano da <strong>materiali riciclati (c)</strong> e da <strong>stampi o sotto-componenti upcycled o riciclati (d)</strong>. Quelli negativi da tutto quello che è comprato, costruito, stampato o progettato fuori dal team.</li>
        <li>Un componente non dichiarato su Agora prende il punteggio più basso possibile (§11.3.2).</li>
      </ul>
      <div class="perf-legend mt">
        ${P.conditions.map((c) => html`<strong>${c.id})</strong><span title=${c.en}>${c.it}</span>`)}
      </div>
    </${Card}>

    <${Card} title="Punti per componente">
      <div class="table-scroll"><table class="tbl perf-tbl">
        <thead><tr><th>Componente</th>${P.conditions.map((c) => html`<th class="c" title=${`${c.it} (${c.en})`}>${c.id})</th>`)}<th class="r">Punti</th></tr></thead>
        <tbody>
          ${grouped.map(([title, comps]) => html`
            <tr class="perf-group"><td colspan=${P.conditions.length + 2}>${title}</td></tr>
            ${comps.map((c) => html`<tr>
              <td title=${c.en}>${c.it}</td>
              ${c.conditions.map((x) => x.applicable
                ? html`<td class="c"><label class=${`perf-opt ${x.checked ? 'on' : ''} ${tone(x.points)}`} title=${condText[x.id]}>
                    <input type="checkbox" checked=${x.checked} onChange=${() => toggle(c.id, x.id)} /><span>${fmtPoints(x.points)}</span></label></td>`
                : html`<td class="c perf-na" title="Condizione non applicabile a questo componente">N/A</td>`)}
              <td class=${`r strong ${toneText(c.points)}`}>${fmtPoints(c.points)}</td>
            </tr>`)}`)}
        </tbody>
        <tfoot><tr><td class="strong">Totale componenti</td><td colspan=${P.conditions.length}></td><td class=${`r strong ${toneText(perf.componentsPoints)}`}>${fmtPoints(perf.componentsPoints)}</td></tr></tfoot>
      </table></div>
    </${Card}>

    <${Card} title="Vele, alberi e foil commerciali (§11.1.5)" actions=${html`<${Button} small icon="list" onClick=${() => go('lines', { component: 'foils' })}>Voci di costo</${Button}>`}>
      <p class="muted small">Se prodotti dal ${P.commercial.fromYear} in poi valgono ${P.commercial.points} punti ciascuno, a meno che il team li abbia presi con danni compromettenti.
        Senza prove sufficienti sull'anno o sul danno la penalità si applica (§11.1.5.1). L'elenco arriva dalle voci "Parte usata o commerciale".</p>
      ${perf.commercial.length === 0
        ? html`<p class="muted">Nessuna vela, albero o foil tra le parti usate o commerciali. Se ne usate, aggiungili in Voci di costo come "Parte usata o commerciale".</p>`
        : html`<div class="table-scroll"><table class="tbl">
            <thead><tr><th>Voce</th><th>Elemento</th><th>Anno di produzione</th><th>Commerciale</th><th>Con danni compromettenti</th><th class="r">Punti</th><th></th></tr></thead>
            <tbody>${perf.commercial.map((c) => html`<tr>
              <td>${c.name}</td>
              <td>${ctx.rules.usedParts[c.element]?.en || c.element}</td>
              <td><${NumInput} value=${c.year} width=${72} placeholder="non noto" onChange=${(v) => setUsed(c.lineId, (u) => { u.year = v; }, 'year')} /></td>
              <td><input type="checkbox" checked=${c.commercial} onChange=${(e) => setUsed(c.lineId, (u) => { u.commercial = e.target.checked; })} /></td>
              <td><input type="checkbox" checked=${c.damaged} onChange=${(e) => setUsed(c.lineId, (u) => { if (e.target.checked) u.damaged = true; else delete u.damaged; })} /></td>
              <td class=${`r strong ${toneText(c.points)}`}>${fmtPoints(c.points)}</td>
              <td class="row-actions"><${Button} small title="Apri la voce" icon="chevron" onClick=${() => go('lines', { line: c.lineId })} /></td>
            </tr>`)}</tbody>
          </table></div>`}
    </${Card}>`;
}
