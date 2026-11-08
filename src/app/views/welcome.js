import { html, Icon } from '../ui.js';

export function Welcome({ autosave, recovery, onRecover, onResume, onNew, onTemplate, onOpen, onExample, onClose }) {
  const when = autosave?.autosavedAt ? new Date(autosave.autosavedAt).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '';
  const opt = (icon, title, text, onClick, primary = false) => html`
    <button class=${`welcome-opt ${primary ? 'primary' : ''}`} onClick=${onClick}>
      <span class="welcome-icon"><${Icon} name=${icon} size=${22} /></span>
      <span><strong>${title}</strong><span class="muted small">${text}</span></span>
    </button>`;
  return html`<div class="welcome">
    <div class="welcome-box">
      <div class="welcome-head">
        <div class="brand-big">Dollaroni</div>
        <p class="muted">SuMoth Dollars of the Sapienza Foiling Team: enter the parts and cost items, the app calculates masses, SM$ and limits, and prepares the files for the reports.</p>
      </div>
      ${autosave?.project && html`<div class="welcome-section">
        ${opt('undo', `Resume “${autosave.project.name} ${autosave.project.season} ${autosave.project.stage}”`, `last modified ${when}${autosave.fileName ? ` · file ${autosave.fileName}` : ' · not yet saved to a file'}`, onResume, true)}
      </div>`}
      ${recovery?.project && html`<div class="welcome-section">
        ${opt('undo', `Recover “${recovery.project.name} ${recovery.project.season} ${recovery.project.stage}”`, `copy with the unsaved changes, set aside on ${new Date(recovery.keptAt).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}`, onRecover)}
      </div>`}
      <div class="welcome-section">
        <h4>Inizia</h4>
        ${opt('plus', 'New 2027 boat', 'Empty project with the 2027 rules: add parts and items from scratch.', onNew)}
        ${opt('layers', 'New boat from Meravijosa S1 2026', 'Same parts and items as the 2026 estimate, with the 2027 rules: the fastest way.', onTemplate)}
        ${opt('folder', 'Open a project file…', 'A .dollaroni.json file saved by you or by someone on the team.', onOpen)}
      </div>
      <div class="welcome-section">
        <h4>Examples (data submitted in 2026)</h4>
        <div class="welcome-row">
          ${opt('book', 'Meravijosa S1 2026', 'February estimate (2026 rules): Appendix G and Table 2.', () => onExample('meravijosa-2026-s1'))}
          ${opt('book', 'Meravijosa S2 2026', 'As-built of the S2 report (2026 rules).', () => onExample('meravijosa-2026-s2'))}
        </div>
      </div>
      ${onClose && html`<div class="welcome-foot"><button class="link" onClick=${onClose}>Back to the open project</button></div>`}
    </div>
  </div>`;
}
