import { html, useState, Card, Button, Badge, Icon, Select, NumInput, TextInput, CatalogSelect, SOURCE_OPTIONS, Bar, Empty, shortName, StatusPill } from '../ui.js';
import { sm, num, pct, uid } from '../format.js';
import { lineTypes, newLine, lineType } from '../templates.js';
import { unitLabel } from '../../engine/reports.js';

const MATERIAL_KINDS = ['reinforcement', 'prepreg', 'matrix', 'core', 'consumable', 'other', 'hardware'];
const UNITS = ['pc', 'kg', 'm', 'm2', 'L', 'set', 'roll15', 'h'].map((u) => ({ value: u, label: unitLabel(u) }));
const SOURCE_LABEL = Object.fromEntries(SOURCE_OPTIONS.map((o) => [o.value, o.label]));

export function Lines({ project, ev, ctx, update, baseTotals, filter, setFilter, expandedId, setExpanded, go }) {
  const [adding, setAdding] = useState(null);
  const { rules } = ctx;
  const isS2 = project.stage === 'S2';
  const comps = ev.components.filter((c) => !filter || c.id === filter);
  const markAllMeasured = (componentId) => update((d) => {
    for (const l of d.lines) if (l.component === componentId) l.status = 'measured';
    for (const p of d.parts) if (p.component === componentId) p.status = 'measured';
  });
  const addLine = (type, component) => {
    const l = newLine(type, component, rules);
    update((d) => { d.lines.push(l); });
    setAdding(null);
    setExpanded(l.id);
  };

  return html`
    <div class="page-head">
      <div><h1>Cost items</h1><p class="muted">Everything that costs SM$, divided into the 7 categories of the S2 template. Grey rows come from the laminated parts.</p></div>
    </div>
    <div class="chips">
      <button class=${`chip ${!filter ? 'active' : ''}`} onClick=${() => setFilter(null)}>All · ${sm(ev.total)}</button>
      ${ev.components.map((c) => html`<button class=${`chip ${filter === c.id ? 'active' : ''}`} onClick=${() => setFilter(c.id)}>${c.it} · ${sm(c.total)}</button>`)}
    </div>

    ${comps.map((c) => html`
      <${Card} className="lines-card" title=${html`${c.it} <span class="muted small">(${c.en})</span>`} actions=${html`
        <span class="group-total">${sm(c.total)} SM$ <span class="muted small">${pct(c.total / ev.budget)} of the budget</span></span>
        ${isS2 && c.lines.some((l) => l.status !== 'measured') && html`<${Button} small icon="check" onClick=${() => markAllMeasured(c.id)} title="Mark all the items and parts of this component as measured">Mark all measured</${Button}>`}
        <${Button} small icon="plus" onClick=${() => setAdding(adding === c.id ? null : c.id)}>Add</${Button}>`}>
        ${adding === c.id && html`<div class="type-picker">
          ${lineTypes(rules).map((t) => html`<button class="type-option" onClick=${() => addLine(t.id, c.id)}><strong>${t.label}</strong><span class="muted small">${t.hint}</span></button>`)}
        </div>`}
        ${c.lines.length === 0
          ? html`<p class="muted small">No items.</p>`
          : html`<div class="table-scroll"><table class="tbl lines-tbl">
              <thead><tr><th>Voce</th><th>Cosa</th><th class="r">Quantità</th><th>Provenienza / anno</th><th class="r">SM$/unità</th><th>Lavorazione</th><th class="r">Totale SM$</th><th></th></tr></thead>
              <tbody>
                ${c.lines.map((lr) => lr.line.auto
                  ? html`<${AutoRow} lr=${lr} project=${project} go=${go} isS2=${isS2} baseTotals=${baseTotals} />`
                  : html`<${LineRow} key=${lr.id} lr=${lr} project=${project} ev=${ev} ctx=${ctx} update=${update} expanded=${expandedId === lr.id} setExpanded=${setExpanded} isS2=${isS2} baseTotals=${baseTotals} />`)}
              </tbody>
            </table></div>`}
      </${Card}>`)}
    ${ev.unknownComponent.length > 0 && html`<${Card} title="Items with an invalid component">
      ${ev.unknownComponent.map((l) => html`<p>${l.name} (${l.component})</p>`)}</${Card}>`}`;
}

/** In S2: value of the same item in the frozen S1, under the total. */
function S1Ref({ isS2, baseTotals, id }) {
  if (!isS2 || !baseTotals) return null;
  return html`<span class="s1-ref">${baseTotals.has(id) ? `S1 ${sm(baseTotals.get(id))}` : 'new in S2'}</span>`;
}

function AutoRow({ lr, project, go, isS2, baseTotals }) {
  const partId = lr.id.split(':')[0];
  const part = project.parts.find((p) => p.id === partId);
  const m = lr.material;
  return html`<tr class="row-auto">
    <td>${lr.name}<div class="small muted">calculated from the part ${part?.name || ''}</div>
      ${isS2 && html`<${StatusPill} status=${lr.status} title="The state is changed in the laminated part" />`}</td>
    <td>${shortName(m?.entry) || m?.label}</td>
    <td class="r">${num(m?.qty || 0, 3)} ${unitLabel(m?.unit)}${m?.waste > 0 && html`<span class="s1-ref">of which waste ${num(m.waste, 3)}</span>`}</td>
    <td>${SOURCE_LABEL[m?.source] || ''}</td>
    <td class="r">${num(m?.unitPrice || 0, 2)}</td>
    <td></td>
    <td class="r strong">${sm(lr.total)}<${S1Ref} isS2=${isS2} baseTotals=${baseTotals} id=${lr.id} /></td>
    <td class="row-actions"><${Button} small icon="layers" title=${`Open the part ${part?.name || ''}`} onClick=${() => go('parts', { part: partId })} /></td>
  </tr>`;
}

function LineRow({ lr, project, ev, ctx, update, expanded, setExpanded, isS2, baseTotals }) {
  const line = lr.line;
  const type = lineType(line);
  const catalog = ev.catalog;
  const { rules } = ctx;
  const set = (fn, key) => update((d) => { fn(d.lines.find((x) => x.id === line.id)); }, key && `${line.id}:${key}`);
  const setMat = (fn, key) => set((l) => { l.material ||= {}; fn(l.material); }, key);
  const m = lr.material;
  const errs = lr.errors.length > 0;

  const usedDef = type === 'used' ? rules.usedParts?.[line.usedPart.element] : null;
  const usedAtPrice = type === 'used' && usedDef?.cost === null; // 2027: no fixed cost

  // the process paired with a material (e.g. MDF + CNC) is edited in the details; only the summary here

  const processCell = type === 'process' || (type === 'used' && !usedAtPrice) || !line.process
    ? html`<span class="muted small">—</span>`
    : html`<button class="link small" onClick=${() => setExpanded(line.id)}>${shortName(lr.process?.entry) || line.process.ref} · ${num(line.process.hours || 0, 1)} h</button>`;

  let what, qty, source, unitPrice;
  if (usedAtPrice) {
    const perf = ev.performance?.commercial.find((c) => c.lineId === line.id);
    what = html`<${Select} value=${line.usedPart.element} width=${170} options=${Object.entries(rules.usedParts).map(([id, d]) => ({ value: id, label: d.en, group: d.kind === 'foil' ? 'Foil' : 'Rig' }))}
      onChange=${(v) => set((l) => { if (!l.material.name || l.material.name === usedDef?.en) l.material.name = rules.usedParts[v].en; l.usedPart.element = v; })} />`;
    qty = html`<div class="proc-cell"><${NumInput} value=${line.material.qty} width=${60} onChange=${(v) => setMat((x) => { x.qty = v; }, 'qty')} /><span class="muted small unit">pc</span></div>`;
    source = html`<div class="proc-cell"><span class="muted small">year</span><${NumInput} className="inp-sm" value=${line.usedPart.year} width=${64} placeholder="?" onChange=${(v) => set((l) => { l.usedPart.year = v; }, 'year')} />
      ${perf?.points ? html`<${Badge} tone="warn" title="Performance Rating: commercial from 2017 or year not documented (§11.1.5)">${perf.points} pt</${Badge}>` : ''}</div>`;
    unitPrice = html`<${NumInput} value=${line.material.price} width=${58} placeholder="?" title="SM$ price from SuMoth Agora" onChange=${(v) => setMat((x) => { if (v === null) delete x.price; else x.price = v; }, 'price')} />`;
  } else if (type === 'used') {
    const def = lr.usedPart?.def;
    what = html`<${Select} value=${line.usedPart.element} width=${170} options=${Object.entries(rules.usedParts).map(([id, d]) => ({ value: id, label: `${d.en} · ${d.cost} SM$`, group: d.kind === 'foil' ? 'Foil' : 'Rig' }))}
      onChange=${(v) => set((l) => { l.usedPart.element = v; })} />`;
    qty = html`<span class="muted">1 pc</span>`;
    source = html`<div class="proc-cell"><span class="muted small">year</span><${NumInput} className="inp-sm" value=${line.usedPart.year} width=${64} onChange=${(v) => set((l) => { l.usedPart.year = v ?? 2014; }, 'year')} />
      ${lr.usedPart && html`<${Badge} tone=${lr.usedPart.handicap < 0 ? 'warn' : 'neutral'} title="Handicap points (Table 3)">${lr.usedPart.handicap} pt</${Badge}>`}</div>`;
    unitPrice = def ? num(def.cost, 2) : '–';
  } else if (type === 'process') {
    what = html`<${Select} value=${line.process.ref} width=${190} options=${[...catalog.values()].filter((e) => e.kind === 'process').map((e) => ({ value: e.id, label: shortName(e) }))}
      onChange=${(v) => set((l) => { l.process.ref = v; })} />`;
    qty = html`<div class="proc-cell"><${NumInput} value=${line.process.hours} width=${64} onChange=${(v) => set((l) => { l.process.hours = v ?? 0; }, 'hours')} /><span class="muted small">h</span></div>`;
    source = '';
    unitPrice = num(lr.process?.rate || 0, 2);
  } else {
    const free = type === 'hardware' || type === 'upcycled';
    what = free
      ? html`<${TextInput} value=${line.material.name} width=${180} placeholder=${type === 'upcycled' ? 'e.g. Gantry from a retired Moth' : 'e.g. Harken blocks'} onChange=${(v) => setMat((x) => { x.name = v; }, 'name')} />`
      : html`<${CatalogSelect} catalog=${catalog} kinds=${MATERIAL_KINDS} value=${line.material.ref} width=${180} onChange=${(v) => setMat((x) => { x.ref = v; })} />`;
    qty = html`<div class="proc-cell">
      <${NumInput} value=${line.material.qty} width=${60} onChange=${(v) => setMat((x) => { x.qty = v; }, 'qty')} />
      ${free
        ? html`<${Select} className="inp-sm" value=${line.material.unit || 'pc'} options=${UNITS} width=${62} onChange=${(v) => setMat((x) => { x.unit = v; })} />`
        : html`<span class="muted small unit">${unitLabel(m?.unit)}</span>`}
    </div>`;
    source = type === 'upcycled'
      ? html`<span class="muted small">Upcycled −100%</span>`
      : html`<${Select} className="inp-sm" value=${line.material.source || 'new'} options=${SOURCE_OPTIONS} width=${124} onChange=${(v) => setMat((x) => { x.source = v; })} />`;
    unitPrice = type === 'hardware'
      ? html`<${NumInput} value=${line.material.price} width=${58} title="MSRP price in SM$ (= USD without taxes)" onChange=${(v) => setMat((x) => { x.price = v ?? 0; }, 'price')} />`
      : html`${m && m.factor !== 1 && m.basePrice ? html`<s class="muted small">${num(m.basePrice, 2)}</s> ` : ''}${num(m?.unitPrice || 0, 2)}`;
  }

  const remove = () => update((d) => { d.lines = d.lines.filter((x) => x.id !== line.id); });
  const duplicate = () => update((d) => { const i = d.lines.findIndex((x) => x.id === line.id); d.lines.splice(i + 1, 0, { ...structuredClone(line), id: uid('line') }); });

  return html`
    <tr class=${`${errs ? 'row-err' : ''} ${expanded ? 'row-open' : ''}`}>
      <td><${TextInput} value=${line.name} width=${150} placeholder="Item name" onChange=${(v) => set((l) => { l.name = v; }, 'lname')} />
        ${isS2 && html`<div><${StatusPill} status=${lr.status} onToggle=${() => set((l) => { l.status = l.status === 'measured' ? 'estimated' : 'measured'; })} /></div>`}
        ${errs && html`<div class="t-err small">${lr.errors.join(' · ')}</div>`}</td>
      <td>${what}</td>
      <td class="r">${qty}</td>
      <td>${source}</td>
      <td class="r">${unitPrice}</td>
      <td>${processCell}</td>
      <td class="r strong">${sm(lr.total)}<${S1Ref} isS2=${isS2} baseTotals=${baseTotals} id=${line.id} /></td>
      <td class="row-actions">
        <${Button} small icon=${expanded ? 'chevronDown' : 'chevron'} title="Details" onClick=${() => setExpanded(expanded ? null : line.id)} />
        <${Button} small icon="trash" title="Elimina voce" onClick=${remove} />
      </td>
    </tr>
    ${expanded && html`<tr class="row-details"><td colspan="8"><${LineDetails} line=${line} lr=${lr} type=${type} usedAtPrice=${usedAtPrice} project=${project} ctx=${ctx} set=${set} setMat=${setMat} catalog=${catalog} duplicate=${duplicate} /></td></tr>`}`;
}

function LineDetails({ line, lr, type, usedAtPrice, project, ctx, set, setMat, catalog, duplicate }) {
  const { rules } = ctx;
  const m = line.material;
  const needsOrigin = type === 'used' || type === 'upcycled';
  const canHaveProcess = type === 'material' || type === 'hardware' || type === 'upcycled';
  const trackWaste = rules.wasteTracking && project.stage === 'S2' && m && type !== 'used';
  return html`<div class="details-grid">
    ${canHaveProcess && html`<div class="field"><span>Paired process (e.g. CNC of the mould, 3D printing)</span>
      <div class="proc-cell">
        <${Select} value=${line.process?.ref || ''} placeholder="none"
          options=${[...catalog.values()].filter((e) => e.kind === 'process').map((e) => ({ value: e.id, label: `${shortName(e)} · ${e.price} SM$/h` }))}
          onChange=${(v) => set((l) => { if (!v) delete l.process; else l.process = { ...(l.process || { hours: 0 }), ref: v }; })} />
        ${line.process && html`<${NumInput} value=${line.process.hours} width=${60} title="ore" onChange=${(v) => set((l) => { l.process.hours = v ?? 0; }, 'hours')} /><span class="muted small">h</span>`}
      </div></div>`}
    <label class="field"><span>Label in the S2 table</span><${TextInput} value=${line.s2Label} placeholder=${lr.material ? `${lr.material.label} (${line.name})` : line.name} onChange=${(v) => set((l) => { if (v) l.s2Label = v; else delete l.s2Label; }, 's2')} /></label>
    <label class="field"><span>Notes (Notes column, S1 table)</span><${TextInput} value=${line.notes} placeholder="es. Upcycled, pre 2015" onChange=${(v) => set((l) => { if (v) l.notes = v; else delete l.notes; }, 'notes')} /></label>
    <label class="field"><span>${needsOrigin ? `Origin and transformation (${rules.refs.upcycled})` : 'Origin / supplier'}</span><${TextInput} value=${line.origin} placeholder=${needsOrigin ? 'e.g. on loan from Lega Navale Ventotene' : 'facoltativo'} onChange=${(v) => set((l) => { if (v) l.origin = v; else delete l.origin; }, 'origin')} /></label>
    <label class="field"><span>Component</span><${Select} value=${line.component} options=${rules.components.map((c) => ({ value: c.id, label: c.it }))} onChange=${(v) => set((l) => { l.component = v; })} /></label>
    ${type === 'material' && html`
      <label class="field"><span>Manual price (SM$/unit)</span><${NumInput} value=${m.price} placeholder=${lr.material?.entry?.price ?? ''} onChange=${(v) => setMat((x) => { if (v === null) delete x.price; else x.price = v; }, 'mprice')} /></label>`}
    ${(type === 'hardware' || usedAtPrice || (type === 'material' && m.price !== undefined)) && html`
      <label class="field"><span>Price source</span><${TextInput} value=${m.priceSource} placeholder=${usedAtPrice ? 'e.g. SuMoth Agora, 12/01/2027' : 'e.g. MSRP Harken 2026, price given on Discord'} onChange=${(v) => setMat((x) => { x.priceSource = v; }, 'psrc')} /></label>`}
    ${usedAtPrice && html`
      <label class="check-field"><input type="checkbox" checked=${line.usedPart.commercial !== false} onChange=${(e) => set((l) => { l.usedPart.commercial = e.target.checked; })} />
        <span>Commercial (industrially produced)</span></label>
      <label class="check-field"><input type="checkbox" checked=${Boolean(line.usedPart.damaged)} onChange=${(e) => set((l) => { if (e.target.checked) l.usedPart.damaged = true; else delete l.usedPart.damaged; })} />
        <span>Taken with compromising, documented damage (§11.1.5)</span></label>`}
    ${trackWaste && html`
      <label class="field"><span>Of which waste (${unitLabel(lr.material?.unit) || 'unità'}), §9.2.2</span><${NumInput} value=${m.waste} placeholder="0" onChange=${(v) => setMat((x) => { if (!v) delete x.waste; else x.waste = v; }, 'waste')} /></label>`}
    ${type === 'material' && html`
      <label class="field"><span>Check the quantity against the part</span>
        <${Select} value=${m.check?.parts?.[0] || ''} placeholder="no check" options=${project.parts.map((p) => ({ value: p.id, label: p.name }))}
          onChange=${(v) => setMat((x) => { if (!v) delete x.check; else x.check = { parts: [v], kind: x.check?.kind || 'resin' }; })} /></label>
      ${m.check && html`<label class="field"><span>…comparing with</span>
        <${Select} value=${m.check.kind} options=${[{ value: 'fibre', label: 'the fibre of the part' }, { value: 'resin', label: 'the resin of the part' }, { value: 'core', label: "the core of the part" }]}
          onChange=${(v) => setMat((x) => { x.check.kind = v; })} /></label>`}
      ${lr.material?.layupKg !== null && lr.material?.layupKg !== undefined && html`<p class="small muted field">From the layup: <strong>${num(lr.material.layupKg, 3)} kg</strong></p>`}`}
    ${(type === 'material' || type === 'hardware') && html`
      <label class="field"><span>Counts in the mass breakdown${rules.refs.mass ? ` (${rules.refs.mass})` : ''}</span>
        <${Select} value=${line.mass?.group || ''} placeholder="no" options=${rules.massGroups.map((g) => ({ value: g.id, label: g.en }))}
          onChange=${(v) => set((l) => { if (!v) delete l.mass; else l.mass = { group: v, kind: l.mass?.kind || 'other' }; })} /></label>`}
    ${type === 'used' && !usedAtPrice && lr.usedPart?.def.kind === 'foil' && html`
      <label class="field"><span>Year of participation with this foil</span><${NumInput} value=${line.usedPart.participationYear || 1} onChange=${(v) => set((l) => { l.usedPart.participationYear = v || 1; })} /></label>`}
    <div class="field details-actions"><span> </span><${Button} small icon="copy" onClick=${duplicate}>Duplicate item</${Button}></div>
  </div>`;
}

export { Empty, Bar, Icon };
