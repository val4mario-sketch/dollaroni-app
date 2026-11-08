import { html, Card, Button, Badge, Empty } from '../ui.js';

const LEVELS = [
  { id: 'error', title: 'Errors to fix', tone: 'err', hint: 'They must be resolved before submitting.' },
  { id: 'warning', title: 'To check', tone: 'warn', hint: 'They may be right, but it is worth checking them again.' },
  { id: 'info', title: 'Information', tone: 'info', hint: 'Useful reminders, nothing blocking.' },
];

export function Checks({ checks, project, go }) {
  const open = (c) => {
    if (!c.target) return null;
    if (project.parts.some((p) => p.id === c.target)) return () => go('parts', { part: c.target });
    if (project.lines.some((l) => l.id === c.target)) return () => go('lines', { line: c.target });
    const autoPart = project.parts.find((p) => String(c.target).startsWith(p.id + ':'));
    if (autoPart) return () => go('parts', { part: autoPart.id });
    const inGroup = project.parts.find((p) => (p.limitGroup || 'other') === c.target); // carbon limits
    if (inGroup) return () => go('parts', { part: inGroup.id });
    return () => go('overview');
  };

  return html`
    <div class="page-head"><div><h1>Checks</h1><p class="muted">Automatic checks on budget, carbon limits (Table 2), consistency with the Layup Calculator, prices and origins.</p></div></div>
    ${checks.length === 0
      ? html`<${Empty} title="All good">No problems found in the project.</${Empty}>`
      : LEVELS.map((lv) => {
          const list = checks.filter((c) => c.level === lv.id);
          if (!list.length) return null;
          return html`<${Card} title=${html`${lv.title} <${Badge} tone=${lv.tone}>${list.length}</${Badge}>`}>
            <p class="muted small">${lv.hint}</p>
            <ul class="check-list">${list.map((c) => {
              const action = open(c);
              return html`<li class=${`check-item tone-border-${lv.tone}`}>
                <span>${c.message}</span>
                ${action && html`<${Button} small onClick=${action}>Go</${Button}>`}
              </li>`;
            })}</ul>
          </${Card}>`;
        })}`;
}
