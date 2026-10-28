import { html, Card, Button, Badge, Empty } from '../ui.js';

const LEVELS = [
  { id: 'error', title: 'Errori da sistemare', tone: 'err', hint: 'Prima di consegnare vanno risolti.' },
  { id: 'warning', title: 'Da verificare', tone: 'warn', hint: 'Potrebbero essere giusti, ma conviene ricontrollarli.' },
  { id: 'info', title: 'Informazioni', tone: 'info', hint: 'Promemoria utili, niente di bloccante.' },
];

export function Checks({ checks, project, go }) {
  const open = (c) => {
    if (!c.target) return null;
    if (project.parts.some((p) => p.id === c.target)) return () => go('parts', { part: c.target });
    if (project.lines.some((l) => l.id === c.target)) return () => go('lines', { line: c.target });
    const autoPart = project.parts.find((p) => String(c.target).startsWith(p.id + ':'));
    if (autoPart) return () => go('parts', { part: autoPart.id });
    const inGroup = project.parts.find((p) => (p.limitGroup || 'other') === c.target); // limiti di carbonio
    if (inGroup) return () => go('parts', { part: inGroup.id });
    return () => go('overview');
  };

  return html`
    <div class="page-head"><div><h1>Controlli</h1><p class="muted">Verifiche automatiche su budget, limiti di carbonio (Tab. 2), coerenza con il Layup Calculator, prezzi e provenienze.</p></div></div>
    ${checks.length === 0
      ? html`<${Empty} title="Tutto a posto">Nessun problema trovato nel progetto.</${Empty}>`
      : LEVELS.map((lv) => {
          const list = checks.filter((c) => c.level === lv.id);
          if (!list.length) return null;
          return html`<${Card} title=${html`${lv.title} <${Badge} tone=${lv.tone}>${list.length}</${Badge}>`}>
            <p class="muted small">${lv.hint}</p>
            <ul class="check-list">${list.map((c) => {
              const action = open(c);
              return html`<li class=${`check-item tone-border-${lv.tone}`}>
                <span>${c.message}</span>
                ${action && html`<${Button} small onClick=${action}>Vai</${Button}>`}
              </li>`;
            })}</ul>
          </${Card}>`;
        })}`;
}
