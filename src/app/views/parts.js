import { html, useState, Card, Button, Badge, Icon, Select, NumInput, TextInput, CatalogSelect, SOURCE_OPTIONS, Bar, Empty, toneForRatio, shortName, StatusPill } from '../ui.js';
import { sm, kg, grams, pct, num } from '../format.js';
import { newPart, newSubstack, DEFAULT_GROUPS } from '../templates.js';
import { computePart } from '../../engine/layup.js';
import { chunkPart } from '../../io/layup-export.js';
import { layupTableSvg } from '../../io/layup-svg.js';
import { uid } from '../format.js';

const GSM_VALUES = [80, 100, 120, 150, 180, 200, 220, 240, 260, 300, 340, 400, 600];
const CARBON_SOURCES = [
  { value: 'virgin', label: 'Virgin CF' },
  { value: 'recycled', label: 'Recycled CF' },
  { value: 'upcycled', label: 'CFRP upcycled' },
];

export function Parts({ project, ev, evBase, ctx, update, selectedId, onSelect }) {
  const parts = project.parts;
  const selected = parts.find((p) => p.id === selectedId) || parts[0];
  const add = () => {
    const p = newPart('hull');
    update((d) => { d.parts.push(p); });
    onSelect(p.id);
  };

  return html`
    <div class="page-head">
      <div><h1>Laminated parts</h1><p class="muted">One part = one Layup Calculator sheet. Masses and costs with the same formulas as the official file.</p></div>
      <${Button} kind="primary" icon="plus" onClick=${add}>New part</${Button}>
    </div>
    ${parts.length === 0
      ? html`<${Empty} title="No laminated parts yet" action=${html`<${Button} kind="primary" icon="plus" onClick=${add}>Add the first part</${Button}>`}>
          Hull, wing panels and frame, bulkheads, foils… each with its own fibre and resin substacks.</${Empty}>`
      : html`<div class="parts-layout">
          <nav class="parts-list" aria-label="Pezzi">
            ${parts.map((p) => {
              const pr = ev.parts.find((x) => x.part.id === p.id);
              const comp = ctx.rules.components.find((c) => c.id === p.component);
              const bad = pr?.errors.length;
              const massKg = pr ? pr.totals.composite / 1000 + (pr.core?.mass || 0) : 0;
              return html`<button class=${`part-item ${p.id === selected?.id ? 'active' : ''}`} onClick=${() => onSelect(p.id)}>
                <span class="part-item-name">${p.name || 'Unnamed'} ${bad ? html`<${Icon} name="alert" size=${14} />` : ''}</span>
                <span class="part-item-meta">${comp?.it || p.component} · ${(p.substacks || []).length} substack · ${num(massKg, 2)} kg</span>
                ${project.stage === 'S2' && html`<span class=${`small ${p.status === 'measured' ? 't-ok' : 't-warn'}`}>${p.status === 'measured' ? '✓ measured' : 'stimato'}</span>`}
              </button>`;
            })}
          </nav>
          ${selected && html`<${PartEditor} key=${selected.id} part=${selected} ev=${ev} evBase=${evBase} isS2=${project.stage === 'S2'} ctx=${ctx} update=${update} onSelect=${onSelect} />`}
        </div>`}`;
}

function PartEditor({ part, ev, evBase, isS2, ctx, update, onSelect }) {
  const { spec, rules } = ctx;
  const catalog = ev.catalog;
  const pr = ev.parts.find((x) => x.part.id === part.id);
  const prBase = evBase?.parts.find((x) => x.part.id === part.id) || null;
  const [preview, setPreview] = useState(false);
  const set = (fn, key) => update((d) => { fn(d.parts.find((x) => x.id === part.id)); }, key && `${part.id}:${key}`);
  const setSub = (i, fn, key) => set((p) => fn(p.substacks[i]), key && `sub${i}:${key}`);

  const autoCost = ev.lines.filter((l) => l.line.auto && l.id.startsWith(part.id + ':')).reduce((a, l) => a + l.total, 0);
  const group = ev.carbon.find((g) => g.id === (part.limitGroup || 'other'));
  const partCarbon = Object.values(pr?.carbon || {}).reduce((a, c) => ({ cf: a.cf + c.cf, cfrp: a.cfrp + c.cfrp }), { cf: 0, cfrp: 0 });
  const nSub = (part.substacks || []).length;

  const move = (i, dir) => set((p) => { const j = i + dir; if (j < 0 || j >= p.substacks.length) return; [p.substacks[i], p.substacks[j]] = [p.substacks[j], p.substacks[i]]; });
  const remove = () => {
    if (!confirm(`Delete the part "${part.name}"? (You can undo with Ctrl+Z)`)) return;
    update((d) => { d.parts = d.parts.filter((x) => x.id !== part.id); });
    onSelect(null);
  };
  const duplicate = () => {
    const copy = { ...structuredClone(part), id: uid('part'), name: `${part.name} (copy)` };
    update((d) => { d.parts.splice(d.parts.findIndex((x) => x.id === part.id) + 1, 0, copy); });
    onSelect(copy.id);
  };

  return html`<div class="part-editor">
    <${Card} className="card-tight">
      <div class="form-grid">
        <label class="field field-wide"><span>Part name</span><${TextInput} value=${part.name} onChange=${(v) => set((p) => { p.name = v; }, 'name')} placeholder="Hull" /></label>
        <label class="field"><span>Component (S2 tables)</span>
          <${Select} value=${part.component} options=${rules.components.map((c) => ({ value: c.id, label: c.it }))}
            onChange=${(v) => set((p) => { p.component = v; Object.assign(p, DEFAULT_GROUPS[v]); })} /></label>
        <label class="field"><span>Carbon limits (Table 2)</span>
          <${Select} value=${part.limitGroup || (part.component === 'foils' ? '' : 'other')} placeholder="Choose the foil…" options=${rules.carbonGroups.map((g) => ({ value: g.id, label: g.en }))} onChange=${(v) => set((p) => {
            p.limitGroup = v;
            if (p.component === 'foils' && /horizontal/.test(v)) p.massGroup = 'horizontal_foils';
            if (p.component === 'foils' && /vertical/.test(v)) p.massGroup = 'vertical_foils';
          })} /></label>
        <label class="field"><span>Mass row${rules.refs.mass ? ` (${rules.refs.mass})` : ''}</span>
          <${Select} value=${part.massGroup || 'other'} options=${rules.massGroups.map((g) => ({ value: g.id, label: g.en }))} onChange=${(v) => set((p) => { p.massGroup = v; })} /></label>
      </div>
      <label class="check-field">
        <input type="checkbox" checked=${part.autoLines !== false} onChange=${(e) => set((p) => { p.autoLines = e.target.checked; })} />
        <span>Automatically create the fibre, resin and core cost items${part.autoLines === false ? html` <span class="muted">(off: the costs of this part are entered by hand in the items)</span>` : ''}</span>
      </label>
      ${isS2 && html`<div class="s2-part-status">
        <${StatusPill} status=${part.status} onToggle=${() => set((p) => { p.status = p.status === 'measured' ? 'estimated' : 'measured'; })} />
        <span class="muted small">${part.status === 'measured'
          ? 'Layup updated to how it was really laminated: its cost items count as measured.'
          : 'Update areas, plies and areal weights to how the part was really laminated, then mark it measured.'}</span>
      </div>`}
    </${Card}>

    <${Card} title="Substack" actions=${html`
      ${nSub > 5 && html`<${Badge} tone="info">in the official file: ${Math.ceil(nSub / 5)} sheets of 5</${Badge}>`}
      <${Button} small icon="plus" onClick=${() => set((p) => { p.substacks.push(newSubstack(p.substacks[p.substacks.length - 1])); })}>Add substack</${Button}>`}>
      <div class="sub-list">
        ${(part.substacks || []).map((s, i) => {
          const r = pr?.substacks[i];
          const ok = r && !r.errors.length;
          return html`<div class=${`sub-card ${r?.errors.length ? 'sub-err' : ''}`}>
            <div class="sub-letter">${'ABCDEFGHIJKLMNOPQRST'[i] || i + 1}${nSub > 5 && i % 5 === 0 ? html`<span class="sub-sheet">sheet ${i / 5 + 1}</span>` : ''}</div>
            <div class="sub-body">
              <div class="sub-row">
                <label class="field"><span>Fibra</span>
                  <${CatalogSelect} catalog=${catalog} kinds=${['reinforcement']} value=${s.reinforcement} onChange=${(v) => setSub(i, (x) => { x.reinforcement = v; })} />
                  <div class="sub-line">
                    <${Select} className="inp-sm" value=${s.reinforcementSource || 'new'} options=${SOURCE_OPTIONS} onChange=${(v) => setSub(i, (x) => { x.reinforcementSource = v; })} />
                    ${r?.reinforcement?.carbon && html`<${Select} className="inp-sm" value=${s.carbonSource || (s.reinforcementSource === 'upcycled' ? 'upcycled' : 'virgin')} options=${CARBON_SOURCES} onChange=${(v) => setSub(i, (x) => { x.carbonSource = v; })} />`}
                  </div>
                </label>
                <label class="field"><span>Matrice</span>
                  <${CatalogSelect} catalog=${catalog} kinds=${['matrix']} value=${s.matrix} onChange=${(v) => setSub(i, (x) => { x.matrix = v; })} />
                  <div class="sub-line"><${Select} className="inp-sm" value=${s.matrixSource || 'new'} options=${SOURCE_OPTIONS} onChange=${(v) => setSub(i, (x) => { x.matrixSource = v; })} /></div>
                </label>
                <label class="field"><span>Process (Vf)</span>
                  <${Select} value=${s.process} options=${spec.processes.map((p) => ({ value: p.name, label: `${p.name} · Vf ${Math.round(p.vf * 100)}%` }))} onChange=${(v) => setSub(i, (x) => { x.process = v; })} /></label>
              </div>
              <div class="sub-row sub-nums">
                <label class="field"><span>Area ply m²</span><${NumInput} value=${s.plyArea} onChange=${(v) => setSub(i, (x) => { x.plyArea = v ?? 0; }, 'area')} width=${84} /></label>
                <label class="field"><span>N. ply</span><${NumInput} value=${s.plies} onChange=${(v) => setSub(i, (x) => { x.plies = v ?? 0; }, 'plies')} width=${60} /></label>
                <label class="field"><span>g/m²</span><input class="inp num" style="width:72px" list="gsm-values" value=${s.arealWeight} inputmode="numeric"
                  onInput=${(e) => { const n = Number(String(e.target.value).replace(',', '.')); if (Number.isFinite(n)) setSub(i, (x) => { x.arealWeight = n; }, 'gsm'); }} /></label>
                <div class="sub-out">
                  ${ok ? html`
                    <span><small>Wf</small>${pct(r.wf)}</span>
                    <span><small>Fibre</small>${grams(r.fibre)}</span>
                    <span><small>Resin</small><strong>${grams(r.resin)}</strong></span>`
                    : html`<span class="t-err small">${r?.errors.join('; ') || '–'}</span>`}
                </div>
              </div>
              ${ok && !r.inCalculator && html`<div class="t-warn small">Material not in the official Layup Calculator: this part cannot be exported to the template.</div>`}
            </div>
            <div class="sub-actions">
              <${Button} small icon="up" title="Sposta su" onClick=${() => move(i, -1)} disabled=${i === 0} />
              <${Button} small icon="down" title="Sposta giù" onClick=${() => move(i, 1)} disabled=${i === nSub - 1} />
              <${Button} small icon="copy" title="Duplica substack" onClick=${() => set((p) => { p.substacks.splice(i + 1, 0, structuredClone(p.substacks[i])); })} />
              <${Button} small icon="trash" title="Elimina substack" onClick=${() => set((p) => { p.substacks.splice(i, 1); })} />
            </div>
          </div>`;
        })}
      </div>
      ${pr && html`<div class="sub-total">
        <span>Composite total <strong>${grams(pr.totals.composite)}</strong></span>
        <span>Fibre <strong>${grams(pr.totals.fibres)}</strong> (${pct(pr.totals.fibresPct)})</span>
        <span>Resin <strong>${grams(pr.totals.resin)}</strong> (${pct(pr.totals.resinPct)})</span>
      </div>`}
      <datalist id="gsm-values">${GSM_VALUES.map((v) => html`<option value=${v} />`)}</datalist>
    </${Card}>

    <div class="grid-2">
      <${CoreCard} part=${part} pr=${pr} catalog=${catalog} set=${set} />
      <${Card} title="Part summary">
        <dl class="kv">
          <dt>Laminate mass</dt><dd>${kg((pr?.totals.composite || 0) / 1000)}</dd>
          <dt>Core (+ absorbed resin)</dt><dd>${kg((pr?.core?.mass || 0) + (pr?.core?.uptake || 0))}</dd>
          <dt>Generated cost</dt><dd>${part.autoLines === false ? html`<span class="muted">manual items</span>` : html`<strong>${sm(autoCost)} SM$</strong>`}</dd>
          ${partCarbon.cf > 0 && html`
            <dt>Carbon (dry CF / CFRP)</dt><dd>${num(partCarbon.cf / 1000, 3)} / ${num(partCarbon.cfrp / 1000, 3)} kg</dd>`}
          ${isS2 && html`
            <dt>Mass in the S1 estimate</dt><dd>${prBase ? kg(prBase.computedMass) : html`<span class="muted">new part</span>`}</dd>`}
        </dl>
        ${isS2 && html`<div class="weigh-field mt">
          <label class="field"><span>Real weighed weight (kg)</span>
            <${NumInput} value=${part.measuredMass} width=${90} placeholder="to weigh"
              onChange=${(v) => set((p) => { if (v === null) delete p.measuredMass; else p.measuredMass = v; }, 'weigh')} /></label>
          ${pr?.measuredMass !== null && pr?.computedMass > 0 && html`<span class=${`small ${Math.abs(pr.measuredMass / pr.computedMass - 1) > 0.1 ? 't-warn' : 't-ok'}`}>
            ${pr.measuredMass >= pr.computedMass ? '+' : '−'}${pct(Math.abs(pr.measuredMass / pr.computedMass - 1))} compared with the calculation (${kg(pr.computedMass)})</span>`}
        </div>`}
        ${group && group.hasCarbon && html`<div class="mt">
          <div class="muted small">Group ${group.en} (all the parts of the group)</div>
          ${group.checks.filter((c) => c.value > 0).map((c) => html`<div class="carbon-check">
            <span class="muted small">${c.label}</span><${Bar} ratio=${c.ratio} tone=${toneForRatio(c.ratio)} height=${6} />
            <span class=${`small t-${toneForRatio(c.ratio)}`}>${num(c.value, 3)} / ${num(c.limit, 2)} kg</span></div>`)}
        </div>`}
      </${Card}>
    </div>

    ${isS2 && rules.wasteTracking && html`<${WasteCard} part=${part} ev=${ev} set=${set} />`}

    <${Card} title="Anteprima nel Layup Calculator" actions=${html`<${Button} small icon=${preview ? 'chevronDown' : 'chevron'} onClick=${() => setPreview(!preview)}>${preview ? 'Hide' : 'Show'}</${Button}>`}>
      ${preview ? html`<${LayupPreview} part=${part} spec=${spec} catalog=${catalog} />` : html`<p class="muted small">How the completed official sheet will look (the same image goes in the appendix).</p>`}
    </${Card}>

    <div class="danger-row">
      <${Button} icon="copy" onClick=${duplicate}>Duplicate part</${Button}>
      <${Button} kind="danger" icon="trash" onClick=${remove}>Delete part</${Button}>
    </div>
  </div>`;
}

/** S2 2027 (§9.2.2): material consumed in excess and thrown away, per material of the part. */
function WasteCard({ part, ev, set }) {
  if (part.autoLines === false) {
    return html`<${Card} title="Material waste (§9.2.2)"><p class="muted small">The cost items of this part are entered by hand: record the waste in the details of those items.</p></${Card}>`;
  }
  // automatic rows of the part grouped by material

  const rows = new Map();
  for (const l of ev.lines) {
    if (!l.line.auto || !l.id.startsWith(part.id + ':') || !l.material) continue;
    const ref = l.line.material.ref;
    const r = rows.get(ref) || { ref, name: shortName(l.material.entry) || l.material.label, used: 0, waste: 0 };
    r.used += l.material.qty;
    r.waste += l.material.waste || 0;
    rows.set(ref, r);
  }
  const setWaste = (ref, v) => set((p) => {
    p.waste ||= {};
    if (v) p.waste[ref] = v;
    else delete p.waste[ref];
    if (!Object.keys(p.waste).length) delete p.waste;
  }, `waste:${ref}`);
  return html`<${Card} title="Material waste (§9.2.2)">
    <p class="muted small">Material consumed in excess of what stays in the part: fabric offcuts, resin left in cups, trimmed core.
      It adds to the quantity and cost of the part's items. It does not count in the carbon limits or masses.</p>
    ${rows.size === 0 ? html`<p class="muted">No material in the part.</p>` : html`<div class="table-scroll"><table class="tbl tbl-compact">
      <thead><tr><th>Materiale</th><th class="r">Nel pezzo</th><th class="r">Scarto (kg)</th><th class="r">Consumato</th><th class="r">Scarto %</th></tr></thead>
      <tbody>${[...rows.values()].map((r) => html`<tr>
        <td>${r.name}</td>
        <td class="r">${kg(r.used - r.waste, 3)}</td>
        <td class="r"><${NumInput} value=${part.waste?.[r.ref]} width=${80} placeholder="0" onChange=${(v) => setWaste(r.ref, v)} /></td>
        <td class="r">${kg(r.used, 3)}</td>
        <td class="r">${r.used > 0 && r.waste > 0 ? pct(r.waste / r.used) : '—'}</td>
      </tr>`)}</tbody></table></div>`}
  </${Card}>`;
}

function CoreCard({ part, pr, catalog, set }) {
  const c = part.core;
  const byVolume = c && c.mass === undefined;
  const setCore = (fn, key) => set((p) => { p.core ||= {}; fn(p.core); }, key && `core:${key}`);
  return html`<${Card} title="Core">
    <div class="form-grid">
      <label class="field field-wide"><span>Material</span>
        <${CatalogSelect} catalog=${catalog} kinds=${['core']} value=${c?.ref || ''} placeholder="No core"
          onChange=${(v) => set((p) => { if (!v) delete p.core; else { p.core ||= { mass: 0 }; p.core.ref = v; } })} /></label>
      ${c && html`
        <label class="field"><span>Origin</span><${Select} value=${c.source || 'new'} options=${SOURCE_OPTIONS} onChange=${(v) => setCore((x) => { x.source = v; })} /></label>
        <label class="field"><span>Inserisco</span>
          <${Select} value=${byVolume ? 'volume' : 'mass'} options=${[{ value: 'mass', label: 'the mass' }, { value: 'volume', label: 'area × thickness × density' }]}
            onChange=${(v) => setCore((x) => { if (v === 'mass') x.mass = pr?.core?.mass || 0; else delete x.mass; })} /></label>
        ${byVolume
          ? html`
            <label class="field"><span>Thickness (mm)</span><${NumInput} value=${c.thickness} onChange=${(v) => setCore((x) => { x.thickness = v; }, 't')} /></label>
            <label class="field"><span>Densità (kg/m³)</span><${NumInput} value=${c.density} onChange=${(v) => setCore((x) => { x.density = v; }, 'd')} /></label>`
          : html`<label class="field"><span>Mass (kg)</span><${NumInput} value=${c.mass} onChange=${(v) => setCore((x) => { x.mass = v ?? 0; }, 'm')} /></label>`}
        <label class="field"><span>Core area (m²)</span><${NumInput} value=${c.area} onChange=${(v) => setCore((x) => { x.area = v; }, 'a')} /></label>
        <label class="field"><span>Absorbed resin (g/m²)</span><${NumInput} value=${c.resinUptake} onChange=${(v) => setCore((x) => { x.resinUptake = v; }, 'u')} placeholder="es. 250" /></label>
      `}
    </div>
    ${c && html`<p class="muted small mt">Core mass ${kg(pr?.core?.mass || 0, 3)}${pr?.core?.uptake ? ` + absorbed resin ${kg(pr.core.uptake, 3)}` : ' · resin absorption not estimated'}</p>`}
  </${Card}>`;
}

function LayupPreview({ part, spec, catalog }) {
  const chunks = chunkPart(part);
  return html`<div class="preview-list">${chunks.map((ch) => {
    const res = computePart(spec, catalog, { ...part, substacks: ch.substacks });
    if (res.errors.length) return html`<p class="t-err">${ch.title}: ${res.errors.join('; ')}</p>`;
    if (!res.inCalculator) return html`<p class="t-warn">${ch.title}: contains materials the official Layup Calculator does not include, so it cannot be exported to the template.</p>`;
    if (!res.substacks.length) return html`<p class="muted">No substacks.</p>`;
    const { svg } = layupTableSvg(res, ch.title);
    return html`<div class="preview-svg" dangerouslySetInnerHTML=${{ __html: svg }}></div>`;
  })}</div>`;
}

export { shortName };
