// Performance Rating of the 2027 rulebook (Table 3, §11): conditions a)–g) by component
// and penalties for commercial sails, masts and foils from 2017 onwards (§11.1.5).

import { html, Card, Button, NumInput } from '../ui.js';
import { fmtPoints } from '../../engine/reports.js';

const GROUPS = [
  ['Hull', ['hull_internal', 'hull_shell', 'stern_fitting', 'stem_fitting', 'mast_base']],
  ['Wings', ['hiking_rack_structure', 'hiking_rack_covers']],
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
  if (others.length) grouped.push(['Other', others]);

  return html`
    <div class="page-head"><div><h1>Performance Rating</h1>
      <p class="muted">Table 3 of the 2027 rulebook (§11): points by component based on how much the team designed and built itself.
      They apply to the S2 tests and the S3 races and are declared on SuMoth Agora.</p></div></div>

    <div class="metrics">
      <div class="metric"><span class="metric-label">Performance Rating</span><span class=${`metric-value ${toneText(perf.total)}`}>${fmtPoints(perf.total)} <small>points</small></span><span class="metric-sub">sum of components and commercial parts</span></div>
      <div class="metric"><span class="metric-label">From the components</span><span class="metric-value">${fmtPoints(perf.componentsPoints)} <small>points</small></span><span class="metric-sub">${perf.declaredCount} of ${perf.components.length} with conditions ticked</span></div>
      <div class="metric"><span class="metric-label">Commercial parts</span><span class="metric-value">${fmtPoints(perf.commercialPoints)} <small>points</small></span><span class="metric-sub">sails, masts and foils from 2017 (§11.1.5)</span></div>
    </div>

    <${Card} title="How it is calculated">
      <ul class="plain-list small">
        <li>For each component tick the true conditions: the points add up. A component with no conditions is worth 0 (§11.1.6).</li>
        <li>Positive points come from <strong>recycled materials (c)</strong> and <strong>upcycled or recycled moulds or sub-components (d)</strong>. Negative ones from anything bought, built, printed or designed outside the team.</li>
        <li>A component not declared on Agora gets the lowest possible score (§11.3.2).</li>
      </ul>
      <div class="perf-legend mt">
        ${P.conditions.map((c) => html`<strong>${c.id})</strong><span title=${c.en}>${c.it}</span>`)}
      </div>
    </${Card}>

    <${Card} title="Points by component">
      <div class="table-scroll"><table class="tbl perf-tbl">
        <thead><tr><th>Component</th>${P.conditions.map((c) => html`<th class="c" title=${`${c.it} (${c.en})`}>${c.id})</th>`)}<th class="r">Points</th></tr></thead>
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
        <tfoot><tr><td class="strong">Components total</td><td colspan=${P.conditions.length}></td><td class=${`r strong ${toneText(perf.componentsPoints)}`}>${fmtPoints(perf.componentsPoints)}</td></tr></tfoot>
      </table></div>
    </${Card}>

    <${Card} title="Commercial sails, masts and foils (§11.1.5)" actions=${html`<${Button} small icon="list" onClick=${() => go('lines', { component: 'foils' })}>Cost items</${Button}>`}>
      <p class="muted small">If produced from ${P.commercial.fromYear} onwards they are worth ${P.commercial.points} points each, unless the team took them with compromising damage.
        Without sufficient evidence of the year or the damage the penalty applies (§11.1.5.1). The list comes from the "Used or commercial part" items.</p>
      ${perf.commercial.length === 0
        ? html`<p class="muted">No sail, mast or foil among the used or commercial parts. If you use any, add them in Cost items as "Used or commercial part".</p>`
        : html`<div class="table-scroll"><table class="tbl">
            <thead><tr><th>Item</th><th>Element</th><th>Year of production</th><th>Commercial</th><th>With compromising damage</th><th class="r">Points</th><th></th></tr></thead>
            <tbody>${perf.commercial.map((c) => html`<tr>
              <td>${c.name}</td>
              <td>${ctx.rules.usedParts[c.element]?.en || c.element}</td>
              <td><${NumInput} value=${c.year} width=${72} placeholder="unknown" onChange=${(v) => setUsed(c.lineId, (u) => { u.year = v; }, 'year')} /></td>
              <td><input type="checkbox" checked=${c.commercial} onChange=${(e) => setUsed(c.lineId, (u) => { u.commercial = e.target.checked; })} /></td>
              <td><input type="checkbox" checked=${c.damaged} onChange=${(e) => setUsed(c.lineId, (u) => { if (e.target.checked) u.damaged = true; else delete u.damaged; })} /></td>
              <td class=${`r strong ${toneText(c.points)}`}>${fmtPoints(c.points)}</td>
              <td class="row-actions"><${Button} small title="Apri la voce" icon="chevron" onClick=${() => go('lines', { line: c.lineId })} /></td>
            </tr>`)}</tbody>
          </table></div>`}
    </${Card}>`;
}
