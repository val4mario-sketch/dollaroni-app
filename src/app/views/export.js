import { html, useState, Card, Button, Badge, Icon } from '../ui.js';
import { sm } from '../format.js';
import { buildS1Export, s1Tables } from '../../io/s1-export.js';
import { buildS2Export, s2Tables } from '../../io/s2-export.js';
import { tableHtml } from '../../io/docx.js';
import { downloadBytes } from '../store.js';

const FOLDER_INFO = {
  'Layup Calculator': 'Official template filled in, one file per part.',
  Appendice: "Images of the layup tables, like Appendix G of the 2026 report.",
  'Report S1': 'Document with all the SM$ tables and the appendix: open it in Google Docs and copy what you need into the report.',
  'Report S2': 'Document with the tables of section 2 of the S2 template (2.2, 2.3 and data for 2.4): open it in Google Docs.',
};

const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Table + notes below it (discounts, budget), for copying to Google Docs. */
function copyableHtml(t) {
  const p = (text) => `<p style="font-family:Montserrat,Arial,sans-serif;font-size:8pt;margin:2px 0">${escHtml(text)}</p>`;
  return tableHtml(t) + (t.footnotes || []).map(p).join('') + (t.note ? p(t.note) : '');
}

async function copyHtml(htmlText) {
  const plain = new DOMParser().parseFromString(htmlText, 'text/html').body.innerText;
  if (navigator.clipboard && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([htmlText], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      })]);
      return;
    } catch {
      /* some browsers refuse it (page not focused, permissions): falls back to the classic method */
    }
  }
  const el = Object.assign(document.createElement('div'), { innerHTML: htmlText, contentEditable: 'true' });
  el.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.appendChild(el);
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  const ok = document.execCommand('copy');
  sel.removeAllRanges();
  el.remove();
  if (!ok) throw new Error('the browser does not allow copying: select the table below and use Ctrl+C');
}

export function ExportView({ project, ev, evBase, ctx, checks, onToS2, go }) {
  const isS2 = project.stage === 'S2';
  const [state, setState] = useState({ running: false, progress: '', result: null, error: null, stage: null });
  const [copied, setCopied] = useState(null);
  const errors = checks.filter((c) => c.level === 'error');
  const warnings = checks.filter((c) => c.level === 'warning');

  const run = async () => {
    setState({ running: true, progress: 'Preparing…', result: null, error: null, stage: project.stage });
    const onProgress = (p) => setState((s) => ({ ...s, progress: p }));
    const common = { project, ev, spec: ctx.spec, catalog: ev.catalog, templateBytes: ctx.templateBytes, onProgress };
    try {
      const result = isS2 ? await buildS2Export({ ...common, evS1: evBase, rules: ctx.rules }) : await buildS1Export(common);
      setState({ running: false, progress: '', result, error: null, stage: project.stage });
    } catch (e) {
      console.error(e);
      setState({ running: false, progress: '', result: null, error: e.message || String(e), stage: project.stage });
    }
  };

  const copy = async (key, htmlText) => {
    try {
      await copyHtml(htmlText);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch (e) {
      alert('Copy failed: ' + e.message);
    }
  };

  // tables to paste: [key, label, table]

  const { rules } = ctx;
  const sec = (n) => (rules.reportNumbering ? `${n} · ` : '');
  const massRef = rules.refs.mass ? ` (${rules.refs.mass})` : '';
  let blocks;
  if (isS2) {
    const t = s2Tables(ev, evBase, rules);
    blocks = [
      ...t.components.map((c) => [c.key, `${sec('2.2')}${c.title}`, c]),
      ['summary', `${sec('2.2')}Component summary`, t.summary],
      ['total', `${sec('2.3')}Total cost breakdown`, t.total],
      t.comparison && ['comparison', `${sec('2.3')}Comparison with the S1 estimate`, t.comparison],
      ['basis', `${sec('2.4')}Measured vs estimated`, t.basis],
      t.changes && t.changes.rows.length && ['changes', `${sec('2.4')}Largest differences from S1`, t.changes],
      t.weighed && ['weighed', `${sec('2.4')}Calculated vs weighed mass`, t.weighed],
      t.waste && ['waste', 'Material used and waste (§9.2.2)', t.waste],
      t.mass.rows.length && ['mass', `Mass breakdown as-built${massRef}`, t.mass],
      t.performance && ['performance', 'Performance Rating (Tab. 3)', t.performance],
    ].filter(Boolean);
  } else {
    const t = s1Tables(ev);
    blocks = [
      ['costTable', 'SuMoth Dollar breakdown', t.costTable],
      ['byComponent', 'SM$ by component', t.byComponent],
      ['carbon', 'Carbon limits', t.carbon],
      ['mass', 'Estimated masses', t.mass],
      t.performance && ['performance', 'Performance Rating (Tab. 3)', t.performance],
    ].filter((b) => b && b[2].rows.length);
  }

  const r = state.stage === project.stage ? state.result : null;
  const folders = r ? [...new Set(r.files.map((f) => f.folder))] : [];

  return html`
    <div class="page-head"><div><h1>Export ${project.stage}</h1><p class="muted">${isS2
      ? 'Tables of section 2 "Final cost analysis" of the S2 template, calculated from the as-built data.'
      : 'Collects the project data and puts it in the official formats of the S1 report.'}</p></div></div>
    ${rules.official.provisional && html`<div class="notice notice-info">Rules ${rules.id}: the cost is declared on the SuMoth Agora Platform
      (${isS2 ? 'Measured Manufacturing Cost, §9.2' : 'Predicted Manufacturing Cost, §7.3'}, 500 points). These files are a basis for filling it in and for the report.
      The 2027 templates are on Moodle and we have not seen them yet, so the tables follow the structure of the 2026 reports.</div>`}

    <div class="grid-2">
      <${Card} title="What is produced">
        <ul class="plain-list">
          ${isS2 ? html`
            <li><${Icon} name="book" /> <strong>${rules.reportNumbering ? '2.2 ' : ''}Components Build</strong>: an Item / Quantity / Cost table for each of the 7 categories, with notes on discounts and the summary with % of the budget</li>
            <li><${Icon} name="gauge" /> <strong>${rules.reportNumbering ? '2.3 ' : ''}Cost Summary</strong>: total cost breakdown and comparison with the S1 estimate (Δ and change)${evBase ? '' : html` <${Badge} tone="warn">reference S1 missing</${Badge}>`}</li>
            <li><${Icon} name="check" /> <strong>${rules.reportNumbering ? '2.4 ' : ''}Self-Assessment</strong>: supporting data (how much is measured, largest differences, weighed vs calculated). You write the text</li>
            ${rules.wasteTracking && html`<li><${Icon} name="list" /> <strong>Material used and waste</strong> (§9.2.2)</li>`}
            <li><${Icon} name="layers" /> <strong>Mass breakdown as-built</strong>${massRef} and <strong>Layup Calculator</strong> of the as-built parts, with the images</li>`
          : html`
            <li><${Icon} name="file" /> <strong>Official Layup Calculator</strong>, one file per part (${project.parts.length} parts${project.parts.some((p) => (p.substacks || []).length > 5) ? ', those with more than 5 substacks in several files' : ''})</li>
            <li><${Icon} name="layers" /> <strong>Images of the layup tables</strong> for the appendix</li>
            <li><${Icon} name="book" /> <strong>Document for Google Docs</strong> (Montserrat): SuMoth Dollar breakdown table, SM$ by component, carbon limits, estimated masses, appendix</li>`}
          ${ev.performance && html`<li><${Icon} name="star" /> <strong>Performance Rating</strong> (Table 3): conditions by component and commercial parts</li>`}
          <li><${Icon} name="download" /> Everything also in a single <strong>zip</strong></li>
        </ul>
      </${Card}>
      <${Card} title="Before exporting">
        ${errors.length === 0 && warnings.length === 0
          ? html`<p class="t-ok"><${Icon} name="check" /> No problems: you can export.</p>`
          : html`
            ${errors.length > 0 && html`<p><${Badge} tone="err">${errors.length} ${errors.length === 1 ? 'errore' : 'errori'}</${Badge}> You can export anyway, but they must be fixed before submitting.</p>`}
            <ul class="check-mini">${[...errors, ...warnings].slice(0, 6).map((c) => html`<li><${Badge} tone=${c.level === 'error' ? 'err' : 'warn'}>${c.level === 'error' ? 'errore' : 'verifica'}</${Badge}> ${c.message}</li>`)}</ul>`}
        <div class="export-cta">
          <${Button} kind="primary" icon="export" onClick=${run} disabled=${state.running}>${state.running ? 'Exporting…' : `Export ${project.stage}`}</${Button}>
          ${state.running && html`<span class="muted small">${state.progress}</span>`}
        </div>
        ${state.error && html`<div class="notice notice-err">Export failed: ${state.error}</div>`}
      </${Card}>
    </div>

    ${r && html`<${Card} title="File pronti" actions=${html`<${Button} kind="primary" icon="download" onClick=${() => downloadBytes(r.zip.bytes, r.zip.name, r.zip.mime)}>Download all (.zip)</${Button}>`}>
      ${r.errors.length > 0 && html`<div class="notice notice-warn"><strong>Not exported to the Layup Calculator:</strong>${r.errors.map((e) => html`<div>${e}</div>`)}</div>`}
      ${folders.map((f) => html`<div class="file-group">
        <h4>${f}</h4><p class="muted small">${FOLDER_INFO[f] || ''}</p>
        <ul class="file-list">${r.files.filter((x) => x.folder === f).map((x) => html`<li>
          <span><${Icon} name="file" /> ${x.name}</span>
          <${Button} small icon="download" onClick=${() => downloadBytes(x.bytes, x.name, x.mime)}>Download</${Button}>
        </li>`)}</ul>
      </div>`)}
    </${Card}>`}

    <${Card} title="Tables to paste into the report" actions=${html`<span class="muted small">"Copy" then paste directly into Google Docs</span>`}>
      ${blocks.map(([key, label, t]) => html`
        <div class="table-block">
          <div class="table-block-head"><strong>${label}</strong>
            <${Button} small icon=${copied === key ? 'check' : 'clipboard'} onClick=${() => copy(key, copyableHtml(t))}>${copied === key ? 'Copied' : 'Copy for Google Docs'}</${Button}></div>
          <div class="table-scroll report-preview" dangerouslySetInnerHTML=${{ __html: tableHtml({ ...t, caption: null }) }}></div>
          ${t.footnotes?.length > 0 && html`<div class="muted small">${t.footnotes.map((f) => html`<div>${f}</div>`)}</div>`}
          ${t.note && html`<div class="muted small">${t.note}</div>`}
        </div>`)}
      <p class="muted small">Total ${sm(ev.total)} SM$ of ${sm(ev.budget)}.</p>
    </${Card}>

    ${!isS2 && html`<${Card} className="transition-card" title="S1 submitted?">
      <p class="muted">Once the estimate is submitted, freeze S1 and move to S2: it will stay as the reference for the comparison in section 2.3.</p>
      <${Button} icon="layers" onClick=${onToS2}>Freeze S1 and create S2</${Button}>
    </${Card}>`}`;
}
