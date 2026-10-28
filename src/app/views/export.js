import { html, useState, Card, Button, Badge, Icon } from '../ui.js';
import { sm } from '../format.js';
import { buildS1Export, s1Tables } from '../../io/s1-export.js';
import { buildS2Export, s2Tables } from '../../io/s2-export.js';
import { tableHtml } from '../../io/docx.js';
import { downloadBytes } from '../store.js';

const FOLDER_INFO = {
  'Layup Calculator': 'Template ufficiale compilato, un file per pezzo.',
  Appendice: "Immagini delle tabelle di layup, come l'Appendice G del report 2026.",
  'Report S1': 'Documento con tutte le tabelle SM$ e l\'appendice: aprilo in Google Docs e copia quello che serve nel report.',
  'Report S2': 'Documento con le tabelle della sezione 2 del template S2 (2.2, 2.3 e dati per la 2.4): aprilo in Google Docs.',
};

const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Tabella + note a piè di tabella (sconti, budget), per la copia in Google Docs. */
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
      /* alcuni browser la negano (pagina non a fuoco, permessi): si passa al metodo classico */
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
  if (!ok) throw new Error('il browser non permette la copia: seleziona la tabella qui sotto e usa Ctrl+C');
}

export function ExportView({ project, ev, evBase, ctx, checks, onToS2, go }) {
  const isS2 = project.stage === 'S2';
  const [state, setState] = useState({ running: false, progress: '', result: null, error: null, stage: null });
  const [copied, setCopied] = useState(null);
  const errors = checks.filter((c) => c.level === 'error');
  const warnings = checks.filter((c) => c.level === 'warning');

  const run = async () => {
    setState({ running: true, progress: 'Preparo…', result: null, error: null, stage: project.stage });
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
      alert('Copia non riuscita: ' + e.message);
    }
  };

  // tabelle da incollare: [chiave, etichetta, tabella]
  const { rules } = ctx;
  const sec = (n) => (rules.reportNumbering ? `${n} · ` : '');
  const massRef = rules.refs.mass ? ` (${rules.refs.mass})` : '';
  let blocks;
  if (isS2) {
    const t = s2Tables(ev, evBase, rules);
    blocks = [
      ...t.components.map((c) => [c.key, `${sec('2.2')}${c.title}`, c]),
      ['summary', `${sec('2.2')}Riepilogo componenti`, t.summary],
      ['total', `${sec('2.3')}Total cost breakdown`, t.total],
      t.comparison && ['comparison', `${sec('2.3')}Confronto con la stima S1`, t.comparison],
      ['basis', `${sec('2.4')}Misurato vs stimato`, t.basis],
      t.changes && t.changes.rows.length && ['changes', `${sec('2.4')}Differenze maggiori rispetto all'S1`, t.changes],
      t.weighed && ['weighed', `${sec('2.4')}Massa calcolata vs pesata`, t.weighed],
      t.waste && ['waste', 'Materiale usato e scarti (§9.2.2)', t.waste],
      t.mass.rows.length && ['mass', `Mass breakdown as-built${massRef}`, t.mass],
      t.performance && ['performance', 'Performance Rating (Tab. 3)', t.performance],
    ].filter(Boolean);
  } else {
    const t = s1Tables(ev);
    blocks = [
      ['costTable', 'SuMoth Dollar breakdown', t.costTable],
      ['byComponent', 'SM$ per componente', t.byComponent],
      ['carbon', 'Limiti di carbonio', t.carbon],
      ['mass', 'Masse stimate', t.mass],
      t.performance && ['performance', 'Performance Rating (Tab. 3)', t.performance],
    ].filter((b) => b && b[2].rows.length);
  }

  const r = state.stage === project.stage ? state.result : null;
  const folders = r ? [...new Set(r.files.map((f) => f.folder))] : [];

  return html`
    <div class="page-head"><div><h1>Esporta ${project.stage}</h1><p class="muted">${isS2
      ? 'Tabelle della sezione 2 "Final cost analysis" del template S2, calcolate dai dati as-built.'
      : 'Raccoglie i dati del progetto e li mette nei formati ufficiali del report S1.'}</p></div></div>
    ${rules.official.provisional && html`<div class="notice notice-info">Regole ${rules.id}: il costo si dichiara sulla SuMoth Agora Platform
      (${isS2 ? 'Measured Manufacturing Cost, §9.2' : 'Predicted Manufacturing Cost, §7.3'}, 500 punti). Questi file servono da base per compilarlo e per il report.
      I template 2027 sono su Moodle e non li abbiamo ancora visti, quindi le tabelle seguono la struttura dei report 2026.</div>`}

    <div class="grid-2">
      <${Card} title="Cosa viene prodotto">
        <ul class="plain-list">
          ${isS2 ? html`
            <li><${Icon} name="book" /> <strong>${rules.reportNumbering ? '2.2 ' : ''}Components Build</strong>: una tabella Item / Quantity / Cost per ognuna delle 7 categorie, con le note sugli sconti e il riepilogo con le % sul budget</li>
            <li><${Icon} name="gauge" /> <strong>${rules.reportNumbering ? '2.3 ' : ''}Cost Summary</strong>: total cost breakdown e confronto con la stima S1 (Δ e variazione)${evBase ? '' : html` <${Badge} tone="warn">manca l'S1 di riferimento</${Badge}>`}</li>
            <li><${Icon} name="check" /> <strong>${rules.reportNumbering ? '2.4 ' : ''}Self-Assessment</strong>: dati di supporto (quanto è misurato, differenze maggiori, pesato vs calcolato). Il testo lo scrivete voi</li>
            ${rules.wasteTracking && html`<li><${Icon} name="list" /> <strong>Materiale usato e scarti</strong> (§9.2.2)</li>`}
            <li><${Icon} name="layers" /> <strong>Mass breakdown as-built</strong>${massRef} e <strong>Layup Calculator</strong> dei pezzi as-built, con le immagini</li>`
          : html`
            <li><${Icon} name="file" /> <strong>Layup Calculator ufficiale</strong>, un file per pezzo (${project.parts.length} pezzi${project.parts.some((p) => (p.substacks || []).length > 5) ? ', quelli con più di 5 substack su più file' : ''})</li>
            <li><${Icon} name="layers" /> <strong>Immagini delle tabelle di layup</strong> per l'appendice</li>
            <li><${Icon} name="book" /> <strong>Documento per Google Docs</strong> (Montserrat): tabella SuMoth Dollar breakdown, SM$ per componente, limiti di carbonio, masse stimate, appendice</li>`}
          ${ev.performance && html`<li><${Icon} name="star" /> <strong>Performance Rating</strong> (Tab. 3): condizioni per componente e parti commerciali</li>`}
          <li><${Icon} name="download" /> Tutto anche in un unico <strong>zip</strong></li>
        </ul>
      </${Card}>
      <${Card} title="Prima di esportare">
        ${errors.length === 0 && warnings.length === 0
          ? html`<p class="t-ok"><${Icon} name="check" /> Nessun problema: si può esportare.</p>`
          : html`
            ${errors.length > 0 && html`<p><${Badge} tone="err">${errors.length} ${errors.length === 1 ? 'errore' : 'errori'}</${Badge}> Puoi esportare lo stesso, ma vanno sistemati prima della consegna.</p>`}
            <ul class="check-mini">${[...errors, ...warnings].slice(0, 6).map((c) => html`<li><${Badge} tone=${c.level === 'error' ? 'err' : 'warn'}>${c.level === 'error' ? 'errore' : 'verifica'}</${Badge}> ${c.message}</li>`)}</ul>`}
        <div class="export-cta">
          <${Button} kind="primary" icon="export" onClick=${run} disabled=${state.running}>${state.running ? 'Esportazione in corso…' : `Esporta ${project.stage}`}</${Button}>
          ${state.running && html`<span class="muted small">${state.progress}</span>`}
        </div>
        ${state.error && html`<div class="notice notice-err">Export non riuscito: ${state.error}</div>`}
      </${Card}>
    </div>

    ${r && html`<${Card} title="File pronti" actions=${html`<${Button} kind="primary" icon="download" onClick=${() => downloadBytes(r.zip.bytes, r.zip.name, r.zip.mime)}>Scarica tutto (.zip)</${Button}>`}>
      ${r.errors.length > 0 && html`<div class="notice notice-warn"><strong>Non esportati nel Layup Calculator:</strong>${r.errors.map((e) => html`<div>${e}</div>`)}</div>`}
      ${folders.map((f) => html`<div class="file-group">
        <h4>${f}</h4><p class="muted small">${FOLDER_INFO[f] || ''}</p>
        <ul class="file-list">${r.files.filter((x) => x.folder === f).map((x) => html`<li>
          <span><${Icon} name="file" /> ${x.name}</span>
          <${Button} small icon="download" onClick=${() => downloadBytes(x.bytes, x.name, x.mime)}>Scarica</${Button}>
        </li>`)}</ul>
      </div>`)}
    </${Card}>`}

    <${Card} title="Tabelle da incollare nel report" actions=${html`<span class="muted small">"Copia" e poi incolla direttamente in Google Docs</span>`}>
      ${blocks.map(([key, label, t]) => html`
        <div class="table-block">
          <div class="table-block-head"><strong>${label}</strong>
            <${Button} small icon=${copied === key ? 'check' : 'clipboard'} onClick=${() => copy(key, copyableHtml(t))}>${copied === key ? 'Copiata' : 'Copia per Google Docs'}</${Button}></div>
          <div class="table-scroll report-preview" dangerouslySetInnerHTML=${{ __html: tableHtml({ ...t, caption: null }) }}></div>
          ${t.footnotes?.length > 0 && html`<div class="muted small">${t.footnotes.map((f) => html`<div>${f}</div>`)}</div>`}
          ${t.note && html`<div class="muted small">${t.note}</div>`}
        </div>`)}
      <p class="muted small">Totale ${sm(ev.total)} SM$ su ${sm(ev.budget)}.</p>
    </${Card}>

    ${!isS2 && html`<${Card} className="transition-card" title="S1 consegnato?">
      <p class="muted">Quando la stima è consegnata, congela l'S1 e passa a S2: resterà come riferimento per il confronto della 2.3.</p>
      <${Button} icon="layers" onClick=${onToS2}>Congela S1 e crea S2</${Button}>
    </${Card}>`}`;
}
