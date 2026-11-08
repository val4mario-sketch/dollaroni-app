import { html, useState, useMemo, useEffect, useCallback } from '../../vendor/preact-htm.js';
import { Button, Icon, Bar, Badge, TextInput, NumInput } from './ui.js';
import { sm, pct } from './format.js';
import { useProject, useAutosave, loadAutosave, openProjectFile, saveProjectFile, serialize, validateProject, downloadBytes, hasUnsavedWork, saveRecoveryCopy, loadRecoveryCopy, clearRecoveryCopy } from './store.js';
import { emptyProject, projectFrom2026, freezeToS2, toRules2027 } from './templates.js';
import { CURRENT_RULES, rulesId } from '../engine/rules.js';
import { evaluate } from '../engine/project.js';
import { runChecks } from '../engine/checks.js';
import { fmtPoints } from '../engine/reports.js';
import { Overview } from './views/overview.js';
import { Parts } from './views/parts.js';
import { Lines } from './views/lines.js';
import { Compare } from './views/compare.js';
import { Checks } from './views/checks.js';
import { Catalog } from './views/catalog.js';
import { Performance } from './views/performance.js';
import { ExportView } from './views/export.js';
import { Welcome } from './views/welcome.js';
import { Assistant } from './views/assistant.js';
import { subscribeUpdates, showNews, checkNow } from './updates.js';

const NAV = [
  { id: 'overview', label: 'Overview', icon: 'home' },
  { id: 'parts', label: 'Laminated parts', icon: 'layers' },
  { id: 'lines', label: 'Cost items', icon: 'list' },
  { id: 'performance', label: 'Performance Rating', icon: 'star', needs: 'performance' },
  { id: 'compare', label: 'S1→S2 comparison', icon: 'gauge' },
  { id: 'checks', label: 'Checks', icon: 'alert' },
  { id: 'catalog', label: 'Price list', icon: 'book' },
  { id: 'export', label: 'Export', icon: 'export' },
];

/** Context (rules + price list + Layup Calculator) of the rulebook requested by the project. */
const contextFor = (contexts, p) => contexts[rulesId(p)] || contexts[CURRENT_RULES];

export function App({ contexts }) {
  const autosave = useMemo(loadAutosave, []);
  const { project, update, replace, undo, redo, canUndo, canRedo } = useProject(null);
  const ctx = contextFor(contexts, project);
  const [file, setFile] = useState({ handle: null, fileName: null, savedJson: null, pristineJson: null, lastModified: null });
  const [recovery, setRecovery] = useState(loadRecoveryCopy);
  const [view, setView] = useState('overview');
  const [welcome, setWelcome] = useState(true);
  const [selPart, setSelPart] = useState(null);
  const [lineFilter, setLineFilter] = useState(null);
  const [expandedLine, setExpandedLine] = useState(null);
  const [toast, setToast] = useState(null);

  useAutosave(project, { fileName: file.fileName, savedJson: file.savedJson, pristineJson: file.pristineJson });

  const ev = useMemo(() => {
    if (!project) return null;
    try {
      return evaluate(project, ctx);
    } catch (e) {
      console.error(e);
      return { error: e };
    }
  }, [project]);
  // frozen S1 (reference for the comparison in S2)
  const baseline = project?.baseline?.project || null;
  const evBase = useMemo(() => {
    if (!baseline) return null;
    try {
      return evaluate(baseline, contextFor(contexts, baseline));
    } catch (e) {
      console.error(e);
      return null;
    }
  }, [baseline]);
  const baseTotals = useMemo(() => (evBase ? new Map(evBase.lines.map((l) => [l.id, l.total])) : null), [evBase]);
  const checks = useMemo(() => (ev && !ev.error ? runChecks(ev) : []), [ev]);
  const dirty = project && file.savedJson !== serialize(project);
  const unsaved = hasUnsavedWork(project, file.savedJson, file.pristineJson);

  useEffect(() => {
    if (!unsaved) return undefined;
    const onLeave = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [unsaved]);

  const notify = (text, tone = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 3200);
  };

  /** Before replacing the project: asks for confirmation if there is unsaved work and keeps a recovery copy. */
  const confirmReplace = () => {
    const current = project
      ? (unsaved ? { project, fileName: file.fileName, savedJson: file.savedJson, pristineJson: file.pristineJson } : null)
      : (autosave?.project && hasUnsavedWork(autosave.project, autosave.savedJson, autosave.pristineJson) ? autosave : null);
    if (!current) return true;
    const ok = confirm(
      `"${current.project.name}" has changes not saved to a file.\n\n` +
      'If you continue it will be replaced: I keep a recovery copy on the start screen, but only until you replace another one.\n\n' +
      'Continue?'
    );
    if (!ok) return false;
    if (saveRecoveryCopy(current)) {
      setRecovery(loadRecoveryCopy());
      return true;
    }
    return confirm('Cannot keep the recovery copy: if you continue the changes will be lost. Continue?');
  };

  const load = (p, fileInfo = {}) => {
    replace(p);
    setFile({ handle: null, fileName: null, savedJson: null, lastModified: null, pristineJson: serialize(p), ...fileInfo });
    setWelcome(false);
    setView('overview');
    setSelPart(null);
    setLineFilter(null);
    setExpandedLine(null);
  };

  const fetchJson = async (path) => validateProject(await (await fetch(path)).json());

  const go = useCallback((v, opts = {}) => {
    setView(v);
    if (opts.part) setSelPart(opts.part);
    if ('component' in opts) setLineFilter(opts.component);
    if (opts.line) {
      setExpandedLine(opts.line);
      setLineFilter(null);
      setTimeout(() => document.querySelector('.row-open')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
    }
    document.querySelector('main')?.scrollTo(0, 0);
  }, []);

  const actions = {
    resume: () => {
      try {
        load(validateProject(autosave.project), { fileName: autosave.fileName, savedJson: autosave.savedJson, pristineJson: autosave.pristineJson ?? null });
      } catch (e) {
        alert('Cannot resume the project: ' + e.message);
      }
    },
    recover: () => {
      if (!confirmReplace()) return;
      const kept = recovery;
      try {
        load(validateProject(kept.project), { fileName: kept.fileName, savedJson: kept.savedJson, pristineJson: kept.pristineJson ?? null });
      } catch (e) {
        alert('Cannot recover the project: ' + e.message);
        return;
      }
      // confirmReplace may have just set aside the replaced project: that copy remains
      if (loadRecoveryCopy()?.keptAt === kept.keptAt) {
        clearRecoveryCopy();
        setRecovery(null);
      }
    },
    new: () => { if (confirmReplace()) load(emptyProject()); },
    template: async () => { if (confirmReplace()) load(projectFrom2026(await fetchJson('data/projects/meravijosa-2026-s1.json'))); },
    example: async (id) => {
      if (!confirmReplace()) return;
      const p = await fetchJson(`data/projects/${id}.json`);
      // the 2026 S2 example is linked to the 2026 S1 estimate for the comparison
      if (p.stage === 'S2' && !p.baseline && id === 'meravijosa-2026-s2') {
        p.baseline = { stage: 'S1', frozenAt: null, project: await fetchJson('data/projects/meravijosa-2026-s1.json') };
      }
      load(p);
    },
    open: async () => {
      try {
        const r = await openProjectFile();
        if (r && confirmReplace()) load(r.project, { handle: r.handle, fileName: r.fileName, savedJson: serialize(r.project), lastModified: r.lastModified ?? null });
      } catch (e) {
        alert('Cannot open the file: ' + e.message);
      }
    },
    save: async (saveAs = false) => {
      if (!project) return;
      try {
        const r = await saveProjectFile(project, file.handle, {
          saveAs,
          knownModified: file.lastModified,
          confirmOverwrite: (when) => confirm(
            `The file "${file.fileName}" changed after you opened it (last modified ${new Date(when).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}): perhaps someone else or another window saved it.\n\n` +
            'OK = overwrite it with your version (the other changes will be lost).\n' +
            'Cancel = do not save: with Ctrl+Shift+S you can save to another file.'
          ),
        });
        if (r) {
          setFile((f) => ({ ...f, handle: r.handle, fileName: r.fileName, savedJson: serialize(project), lastModified: r.lastModified }));
          notify(`Saved in ${r.fileName}`);
        }
      } catch (e) {
        alert('Saving failed: ' + e.message);
      }
    },
    toS2: () => {
      if (!project || project.stage === 'S2') return;
      const ok = confirm(
        "Freeze S1 and move to S2?\n\n" +
        "• S1 as it is now is saved inside the project as the reference for the comparison (it can no longer be changed).\n" +
        '• The project becomes S2: same parts and items, all marked "estimated" until you update them with the real values.\n' +
        "• At the next Save you will be asked for a new file, so the S1 file stays as it is.\n\n" +
        'You can undo with Ctrl+Z.'
      );
      if (!ok) return;
      const { s2 } = freezeToS2(project);
      update(() => s2);
      setFile({ handle: null, fileName: null, savedJson: null, pristineJson: null, lastModified: null });
      go('compare');
      notify('S1 frozen: you are now in S2');
    },
    linkBaseline: async () => {
      try {
        const r = await openProjectFile();
        if (!r) return;
        const p = r.project;
        if (p.stage !== 'S1' && !confirm(`The chosen file is stage ${p.stage}, not an S1. Use it as the reference anyway?`)) return;
        const frozen = structuredClone(p);
        delete frozen.baseline;
        update((d) => { d.baseline = { stage: 'S1', frozenAt: p.frozenAt || p.savedAt || null, project: frozen }; });
        notify(`Reference S1: ${r.fileName}`);
      } catch (e) {
        alert('Cannot open the file: ' + e.message);
      }
    },
    toRules2027: () => {
      update((p) => toRules2027(p));
      notify('The project now uses the 2027 rules (Ctrl+Z to go back)');
    },
    downloadBaseline: () => {
      if (!baseline) return;
      const name = `${baseline.name || 'progetto'} ${baseline.season || ''} S1 congelato.dollaroni.json`.replace(/[\\/:*?"<>|]+/g, '-');
      downloadBytes(new TextEncoder().encode(serialize(baseline)), name, 'application/json');
    },
  };

  useEffect(() => {
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); actions.save(e.shiftKey); }
      else if (k === 'z' && !e.shiftKey && !isTextField(e.target)) { e.preventDefault(); undo(); }
      else if ((k === 'y' || (k === 'z' && e.shiftKey)) && !isTextField(e.target)) { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (welcome || !project) {
    // with a project open the save read at start-up is old: "Back to the open project" returns to it
    return html`<${Welcome} autosave=${project ? null : autosave} recovery=${recovery} onRecover=${actions.recover} onResume=${actions.resume} onNew=${actions.new} onTemplate=${actions.template}
      onOpen=${actions.open} onExample=${actions.example} onClose=${project ? () => setWelcome(false) : null} />`;
  }

  const errors = checks.filter((c) => c.level === 'error').length;
  const warnings = checks.filter((c) => c.level === 'warning').length;
  const isS2 = project.stage === 'S2';
  const exportLabel = `Export ${project.stage}`;

  return html`<div class="app">
    <header class="topbar">
      <div class="brand">Dollaroni<span>SM$ · SFT</span></div>
      <div class="project-meta">
        <${TextInput} className="inp-dark" value=${project.name} width=${190} title="Boat name" onChange=${(v) => update((d) => { d.name = v; }, 'pname')} />
        <${NumInput} className="inp-dark" value=${project.season} width=${64} title="Season" onChange=${(v) => update((d) => { d.season = v; }, 'season')} />
        <span class=${`stage-badge ${isS2 ? 's2' : ''}`} title=${isS2 ? 'Stage S2: construction and final accounts' : 'Stage S1: project estimate'}>${isS2 ? 'S2 · as-built' : 'S1 · estimate'}</span>
        <button class=${`rules-badge ${ctx.rules.official.provisional ? 'provisional' : ''}`} onClick=${() => go('overview')}
          title=${`${ctx.rules.title}${ctx.rules.official.provisional ? ' · provisional 2026 price list and Layup Calculator, awaiting SuMoth Agora' : ''}`}>
          Rules ${ctx.rules.id}${ctx.rules.official.provisional ? ' · provisional price list' : ''}</button>
      </div>
      <div class="topbar-actions">
        <${Button} kind="ghost" icon="undo" title="Annulla (Ctrl+Z)" onClick=${undo} disabled=${!canUndo} />
        <${Button} kind="ghost" icon="redo" title="Ripeti (Ctrl+Y)" onClick=${redo} disabled=${!canRedo} />
        <span class="sep"></span>
        <${Button} kind="ghost" icon="file" onClick=${() => setWelcome(true)}>New / open</${Button}>
        <${Button} kind="ghost" icon="save" onClick=${() => actions.save(false)} title="Save (Ctrl+S)">Save</${Button}>
        <${Button} kind="primary" icon="export" onClick=${() => go('export')}>${exportLabel}</${Button}>
      </div>
    </header>

    <div class="budgetbar">
      <div class="budget-main">
        <span class="budget-label">Budget</span>
        <strong class=${ev.error ? '' : ev.total > ev.budget ? 't-err' : ''}>${ev.error ? '–' : sm(ev.total)}</strong>
        <span class="muted">/ ${ev.error ? '–' : sm(ev.budget)} SM$</span>
      </div>
      <div class="budget-bar">${!ev.error && html`<${Bar} ratio=${ev.total / ev.budget} tone=${ev.total > ev.budget ? 'err' : ev.margin < ev.budget * 0.02 ? 'warn' : 'accent'} height=${10} />`}</div>
      <div class="budget-side">
        ${!ev.error && html`<span>Margine <strong class=${ev.margin < 0 ? 't-err' : ''}>${sm(ev.margin)}</strong> SM$ (${pct(Math.max(ev.margin, 0) / ev.budget)})</span>`}
        ${!ev.error && evBase && html`<span class="muted small">S1: ${sm(evBase.total)}</span>`}
        <button class="link-chip" onClick=${() => go('checks')}>
          ${errors ? html`<${Badge} tone="err">${errors} ${errors === 1 ? 'errore' : 'errori'}</${Badge}>` : html`<${Badge} tone="ok">no errors</${Badge}>`}
          ${warnings > 0 && html`<${Badge} tone="warn">${warnings} to check</${Badge}>`}
        </button>
      </div>
    </div>

    <div class="body">
      <nav class="sidebar" aria-label="Sezioni">
        ${NAV.filter((n) => !n.needs || ctx.rules[n.needs]).map((n) => html`<button class=${`nav-item ${view === n.id ? 'active' : ''}`} onClick=${() => go(n.id)}>
          <${Icon} name=${n.icon} /><span>${n.id === 'export' ? exportLabel : n.label}</span>
          ${n.id === 'parts' && html`<span class="nav-count">${project.parts.length}</span>`}
          ${n.id === 'lines' && html`<span class="nav-count">${project.lines.length}</span>`}
          ${n.id === 'performance' && ev.performance && html`<span class="nav-count">${fmtPoints(ev.performance.total)}</span>`}
          ${n.id === 'compare' && !isS2 && html`<span class="nav-count">S2</span>`}
          ${n.id === 'checks' && (errors + warnings > 0) && html`<span class=${`nav-count ${errors ? 'err' : 'warn'}`}>${errors + warnings}</span>`}
        </button>`)}
        <div class="sidebar-foot">
          <div class="small">${file.fileName ? html`<${Icon} name="file" size=${13} /> ${file.fileName}` : html`<span class="muted">Not yet saved to a file</span>`}</div>
          <div class=${`small ${dirty ? 't-warn' : 't-ok'}`}>${dirty ? 'Changes not saved to a file' : 'Saved'}</div>
          <div class="muted small">Automatic copy in the browser is on</div>
          <${VersionFoot} />
        </div>
      </nav>

      <main>
        ${ev.error
          ? html`<div class="notice notice-err">Error calculating the project: ${ev.error.message}. You can undo the last change with Ctrl+Z.</div>`
          : view === 'overview' || (view === 'performance' && !ev.performance) ? html`<${Overview} project=${project} ev=${ev} evBase=${evBase} ctx=${ctx} checks=${checks} go=${go} onToS2=${actions.toS2} onToRules2027=${actions.toRules2027} />`
          : view === 'parts' ? html`<${Parts} project=${project} ev=${ev} evBase=${evBase} ctx=${ctx} update=${update} selectedId=${selPart} onSelect=${setSelPart} />`
          : view === 'lines' ? html`<${Lines} project=${project} ev=${ev} ctx=${ctx} update=${update} baseTotals=${baseTotals} filter=${lineFilter} setFilter=${setLineFilter} expandedId=${expandedLine} setExpanded=${setExpandedLine} go=${go} />`
          : view === 'performance' ? html`<${Performance} project=${project} ev=${ev} ctx=${ctx} update=${update} go=${go} />`
          : view === 'compare' ? html`<${Compare} project=${project} ev=${ev} evBase=${evBase} onToS2=${actions.toS2} onLinkBaseline=${actions.linkBaseline} onDownloadBaseline=${actions.downloadBaseline} go=${go} />`
          : view === 'checks' ? html`<${Checks} checks=${checks} project=${project} go=${go} />`
          : view === 'catalog' ? html`<${Catalog} project=${project} ctx=${ctx} update=${update} />`
          : html`<${ExportView} project=${project} ev=${ev} evBase=${evBase} ctx=${ctx} checks=${checks} onToS2=${actions.toS2} go=${go} />`}
      </main>
    </div>
    ${toast && html`<div class=${`toast tone-${toast.tone}`}>${toast.text}</div>`}
    ${!ev.error && html`<${Assistant} ev=${ev} checks=${checks} ctx=${ctx} evBase=${evBase} go=${go} update=${update} undo=${undo} />`}
  </div>`;
}

/** Version in use, what's new and update status (at the bottom of the sidebar). */
function VersionFoot() {
  const [u, setU] = useState(null);
  useEffect(() => subscribeUpdates(setU), []);
  if (!u?.installed) return null;
  const title = u.mode === 'local'
    ? (u.repository ? `Updates from github.com/${u.repository}${u.checkedAt ? ` · last check ${u.checkedAt.toLocaleTimeString('it-IT', { timeStyle: 'short' })}` : ''}${u.error ? ` · ${u.error}` : ''}` : 'Automatic updates not configured yet (dollaroni.config.json)')
    : u.mode === 'pwa' ? 'Updates itself from the published site' : '';
  return html`<div class="version-foot small muted" title=${title}>
    <span>Dollaroni ${u.installed.version}</span>
    <button class="link" onClick=${() => showNews(u.installed)}>What's new</button>
    ${u.available && u.latest && html`<span class="new">· ${u.latest.version} available</span>`}
    ${u.mode === 'local' && u.repository && !u.available && html`<button class="link" onClick=${() => checkNow()}>Check</button>`}
  </div>`;
}

function isTextField(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.type !== 'checkbox';
}
