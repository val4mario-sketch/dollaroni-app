import { html, Icon } from '../ui.js';

export function Welcome({ autosave, onResume, onNew, onTemplate, onOpen, onExample, onClose }) {
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
        <p class="muted">SuMoth Dollars del Sapienza Foiling Team: si inseriscono i pezzi e le voci di costo, l'app calcola masse, SM$ e limiti, e prepara i file per i report.</p>
      </div>
      ${autosave?.project && html`<div class="welcome-section">
        ${opt('undo', `Riprendi “${autosave.project.name} ${autosave.project.season} ${autosave.project.stage}”`, `ultima modifica ${when}${autosave.fileName ? ` · file ${autosave.fileName}` : ' · non ancora salvato su file'}`, onResume, true)}
      </div>`}
      <div class="welcome-section">
        <h4>Inizia</h4>
        ${opt('plus', 'Nuova barca 2027', 'Progetto vuoto con le regole 2027: aggiungi pezzi e voci da zero.', onNew)}
        ${opt('layers', 'Nuova barca partendo da Meravijosa S1 2026', 'Stessi pezzi e voci della stima 2026, con le regole 2027: il modo più veloce.', onTemplate)}
        ${opt('folder', 'Apri un file progetto…', 'Un file .dollaroni.json salvato da te o da qualcuno del team.', onOpen)}
      </div>
      <div class="welcome-section">
        <h4>Esempi (dati consegnati nel 2026)</h4>
        <div class="welcome-row">
          ${opt('book', 'Meravijosa S1 2026', 'Stima di febbraio (regole 2026): Appendice G e Tabella 2.', () => onExample('meravijosa-2026-s1'))}
          ${opt('book', 'Meravijosa S2 2026', 'As-built del report S2 (regole 2026).', () => onExample('meravijosa-2026-s2'))}
        </div>
      </div>
      ${onClose && html`<div class="welcome-foot"><button class="link" onClick=${onClose}>Torna al progetto aperto</button></div>`}
    </div>
  </div>`;
}
