import { html, useState, Card, Button, Select, NumInput, TextInput, kindLabel, shortName, Badge } from '../ui.js';
import { num, uid } from '../format.js';
import { unitLabel } from '../../engine/reports.js';

const EXTRA_KINDS = ['hardware', 'reinforcement', 'matrix', 'core', 'consumable', 'other'].map((k) => ({ value: k, label: kindLabel(k) }));
const UNITS = ['pc', 'kg', 'm', 'm2', 'L', 'set', 'h'].map((u) => ({ value: u, label: unitLabel(u) }));

export function Catalog({ project, ctx, update }) {
  const [q, setQ] = useState('');
  const entries = ctx.catalogEntries.filter((e) => !q || `${e.name} ${e.id} ${e.note}`.toLowerCase().includes(q.toLowerCase()));
  const extras = project.catalogExtras || [];
  const setExtra = (id, fn, key) => update((d) => { fn(d.catalogExtras.find((x) => x.id === id)); }, key && `extra:${id}:${key}`);
  const addExtra = () => update((d) => { d.catalogExtras.push({ id: uid('hw'), kind: 'hardware', name: '', unit: 'pc', price: 0, priceSource: '' }); });
  const provisional = ctx.rules.official.provisional;

  return html`
    <div class="page-head"><div><h1>Price list</h1><p class="muted">Official SM$ prices (${ctx.libraryVersion ? `SuMoth Agora library v${ctx.libraryVersion}` : '2026_SMC_Standardized_Costs'}) plus the items added by the team.</p></div></div>
    ${provisional && html`<div class="notice notice-warn">Rules ${ctx.rules.id}: the official price list is on the SuMoth Agora Platform (§10.1.1), open only to admitted teams.
      Until we can see it, the 2026 prices below are used. New materials and price corrections are proposed on Agora with scientific evidence (§10.3).</div>`}

    <${Card} title="Team items" actions=${html`<${Button} small icon="plus" onClick=${addExtra}>Add item</${Button}>`}>
      <p class="muted small">${ctx.rules.help.catalogExtras}</p>
      ${extras.length === 0 ? html`<p class="muted">No items added.</p>` : html`<div class="table-scroll"><table class="tbl">
        <thead><tr><th>Name</th><th>Type</th><th>Unit</th><th class="r">SM$/unit</th><th>Density g/cm³</th><th>Price source</th><th></th></tr></thead>
        <tbody>${extras.map((e) => html`<tr>
          <td><${TextInput} value=${e.name} width=${200} onChange=${(v) => setExtra(e.id, (x) => { x.name = v; }, 'n')} /></td>
          <td><${Select} value=${e.kind || 'hardware'} options=${EXTRA_KINDS} width=${170} onChange=${(v) => setExtra(e.id, (x) => { x.kind = v; })} /></td>
          <td><${Select} value=${e.unit} options=${UNITS} width=${80} onChange=${(v) => setExtra(e.id, (x) => { x.unit = v; })} /></td>
          <td class="r"><${NumInput} value=${e.price} width=${72} onChange=${(v) => setExtra(e.id, (x) => { x.price = v; }, 'p')} /></td>
          <td>${e.kind === 'reinforcement' ? html`<${NumInput} value=${e.density} width=${64} placeholder="es. 1,8" onChange=${(v) => setExtra(e.id, (x) => { x.density = v; }, 'd')} />` : html`<span class="muted small">—</span>`}</td>
          <td><${TextInput} value=${e.priceSource} width=${220} placeholder="es. MSRP Harken, Discord 12/11" onChange=${(v) => setExtra(e.id, (x) => { x.priceSource = v; }, 's')} /></td>
          <td class="row-actions"><${Button} small icon="trash" title="Elimina" onClick=${() => update((d) => { d.catalogExtras = d.catalogExtras.filter((x) => x.id !== e.id); })} /></td>
        </tr>`)}</tbody></table></div>`}
    </${Card}>

    <${Card} title=${ctx.libraryVersion ? `SuMoth Agora library v${ctx.libraryVersion}` : provisional ? `Official 2026 price list (provisional for ${ctx.rules.id})` : 'Official 2026 price list'} actions=${html`<${TextInput} value=${q} onChange=${setQ} placeholder="Cerca (es. basalt, PET, CNC)" width=${240} />`}>
      ${ctx.catalogWarnings.length > 0 && html`<div class="notice notice-warn">${ctx.catalogWarnings.map((w) => html`<div>${w}</div>`)}</div>`}
      <div class="table-scroll"><table class="tbl tbl-compact">
        <thead><tr><th>Categoria</th><th>Voce</th><th>Unità</th><th class="r">SM$/unità</th><th>Nota</th></tr></thead>
        <tbody>${entries.map((e) => html`<tr>
          <td class="muted">${kindLabel(e.kind)}</td>
          <td>${shortName(e)}</td>
          <td>${unitLabel(e.unit)}</td>
          <td class="r">${e.price === null ? html`<${Badge} tone="warn">to request</${Badge}>` : num(e.price, 2)}</td>
          <td class="muted small">${e.note}</td>
        </tr>`)}</tbody>
      </table></div>
    </${Card}>`;
}
