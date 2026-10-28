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
    <div class="page-head"><div><h1>Listino</h1><p class="muted">Prezzi SM$ ufficiali (2026_SMC_Standardized_Costs) più le voci aggiunte dal team.</p></div></div>
    ${provisional && html`<div class="notice notice-warn">Regole ${ctx.rules.id}: il listino ufficiale sta sulla SuMoth Agora Platform (§10.1.1), aperta solo ai team ammessi.
      Finché non lo vediamo si usano i prezzi 2026 qui sotto. I materiali nuovi e le correzioni di prezzo si propongono su Agora con evidenze scientifiche (§10.3).</div>`}

    <${Card} title="Voci del team" actions=${html`<${Button} small icon="plus" onClick=${addExtra}>Aggiungi voce</${Button}>`}>
      <p class="muted small">${ctx.rules.help.catalogExtras}</p>
      ${extras.length === 0 ? html`<p class="muted">Nessuna voce aggiunta.</p>` : html`<div class="table-scroll"><table class="tbl">
        <thead><tr><th>Nome</th><th>Tipo</th><th>Unità</th><th class="r">SM$/unità</th><th>Densità g/cm³</th><th>Fonte del prezzo</th><th></th></tr></thead>
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

    <${Card} title=${provisional ? `Listino ufficiale 2026 (provvisorio per il ${ctx.rules.id})` : 'Listino ufficiale 2026'} actions=${html`<${TextInput} value=${q} onChange=${setQ} placeholder="Cerca (es. basalt, PET, CNC)" width=${240} />`}>
      ${ctx.catalogWarnings.length > 0 && html`<div class="notice notice-warn">${ctx.catalogWarnings.map((w) => html`<div>${w}</div>`)}</div>`}
      <div class="table-scroll"><table class="tbl tbl-compact">
        <thead><tr><th>Categoria</th><th>Voce</th><th>Unità</th><th class="r">SM$/unità</th><th>Nota</th></tr></thead>
        <tbody>${entries.map((e) => html`<tr>
          <td class="muted">${kindLabel(e.kind)}</td>
          <td>${shortName(e)}</td>
          <td>${unitLabel(e.unit)}</td>
          <td class="r">${e.price === null ? html`<${Badge} tone="warn">da chiedere</${Badge}>` : num(e.price, 2)}</td>
          <td class="muted small">${e.note}</td>
        </tr>`)}</tbody>
      </table></div>
    </${Card}>`;
}
