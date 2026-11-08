// Brumoth, the Dollaroni assistant: little boat at the bottom right (with the "Ask Brumoth!" bubble)
// that opens a chat on the open project.
//
// Each question IMMEDIATELY gets the answer calculated by the engine (src/engine/assistant.js, exact numbers).
// The drop-down menu under the box chooses the mode:
// - Instant: that answer stays;
// - Complete: the local AI (src/ai/llm.js) rewrites it in its own words, working only on that data;
//   numbers the AI writes that are not in the data are flagged.

import { html, useState, useEffect, useRef, useMemo } from '../../../vendor/preact-htm.js';
import { Icon } from '../ui.js';
import { answer, buildMessages, verifyNumbers, suggestedQuestions, routerMessages, parseRouterReply, SYSTEM_PROMPT } from '../../engine/assistant.js';
import { localAI, MODELS, MODES, recommendedModel, environment, batteryInfo } from '../../ai/llm.js';

const GB = (bytes) => `${(bytes / 1e9).toLocaleString('it-IT', { maximumFractionDigits: 2 })} GB`;
let nextId = 1;

export function Assistant({ ev, checks, ctx, evBase, go, update, undo }) {
  const [open, setOpen] = useState(false);
  const [ai, setAi] = useState(localAI.state);
  const [, setTick] = useState(0); // redraws when the settings change
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [hint, setHint] = useState(false); // "Ask Brumoth!" bubble
  const [battery, setBattery] = useState(null);
  const abortRef = useRef(null);
  const prevRoute = useRef(null);
  const history = useRef([]);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => localAI.subscribe((s) => { setAi(s); setTick((t) => t + 1); }), []);
  useEffect(() => { localAI.init(); }, []);
  // Complete mode: when the chat opens the model loads and reads the instructions, so the first answer is faster
  useEffect(() => {
    if (open && localAI.settings.mode === 'full' && ai.status === 'downloaded') localAI.prepare(SYSTEM_PROMPT).catch(() => {});
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open, ai.status]);
  // on battery the laptop slows the AI down a lot: Complete mode says so
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    const read = () => batteryInfo().then((b) => alive && setBattery(b));
    read();
    const t = setInterval(read, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [open]);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, open]);
  // the bubble appears on entering the app and goes away as soon as you scroll or touch elsewhere
  useEffect(() => {
    let shown = false;
    const t = setTimeout(() => { shown = true; setHint(true); }, 900);
    const hide = (e) => {
      if (!shown) return;
      if (e.type === 'pointerdown' && e.target.closest?.('.ai-hint, .ai-fab')) return;
      shown = false;
      setHint(false);
      events.forEach((ev) => document.removeEventListener(ev, hide, opts));
    };
    const events = ['scroll', 'wheel', 'touchmove', 'pointerdown'];
    const opts = { capture: true, passive: true };
    events.forEach((ev) => document.addEventListener(ev, hide, opts));
    return () => { clearTimeout(t); events.forEach((ev) => document.removeEventListener(ev, hide, opts)); };
  }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && open) setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const suggestions = useMemo(() => (ev && !ev.error ? suggestedQuestions(ev, checks) : []), [ev, checks]);
  const s = localAI.settings;
  const full = s.mode === 'full';
  const onBattery = full && battery && !battery.charging;

  const patch = (id, p) => setMsgs((list) => list.map((m) => (m.id === id ? { ...m, ...p } : m)));

  async function ask(text) {
    const q = String(text || '').trim();
    if (!q || working || !ev || ev.error) return;
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    const base = { ev, checks, spec: ctx.spec, catalogEntries: ctx.catalogEntries, evBase, previous: prevRoute.current };
    let ans = answer(q, base);
    const id = nextId++;
    // changes and instructions: Brumoth answers without AI (exact button texts and names) with Apply/Cancel
    const useAI = full && !ans.noLLM;
    const startedAt = Date.now();
    setMsgs((list) => [...list, { id: nextId++, role: 'user', text: q }, { id, role: 'bot', ans, text: ans.text, mode: ans.noLLM ? 'brumoth' : 'data', pending: useAI, startedAt, actionState: {} }]);
    if (!useAI) {
      prevRoute.current = ans.route;
      history.current.push({ question: q, reply: ans.text });
      return;
    }
    setWorking(true);
    const ctl = new AbortController();
    abortRef.current = ctl;
    let reply = '';
    try {
      // question the keywords do not recognize: the AI chooses the topic
      if (!ans.understood) {
        try {
          const intent = parseRouterReply(await localAI.complete(routerMessages(q), { signal: ctl.signal }));
          if (intent) { ans = answer(q, { ...base, intents: [intent] }); patch(id, { ans, text: ans.text }); }
        } catch { /* answers with the summary */ }
      }
      const r = await localAI.chat(buildMessages(ans, history.current), {
        signal: ctl.signal,
        onText: (t) => { if (t.trim()) patch(id, { text: t, mode: 'ai' }); },
      });
      reply = r.text.trim();
      const tps = r.seconds > 0 && localAI.settings.tps ? localAI.settings.tps : null;
      const seconds = (Date.now() - startedAt) / 1000;
      if (reply) patch(id, { text: reply, mode: 'ai', pending: false, unverified: verifyNumbers(reply, ans.facts), stopped: ctl.signal.aborted, tps, seconds });
      else patch(id, { text: ans.text, mode: 'data', pending: false, stopped: ctl.signal.aborted });
    } catch (e) {
      patch(id, { text: ans.text, mode: 'data', pending: false, error: `Brumoth did not answer (${e.message || e}): here is the answer from the data.` });
    } finally {
      setWorking(false);
      abortRef.current = null;
      prevRoute.current = ans.route;
      history.current.push({ question: q, reply: reply || ans.text });
    }
  }

  const stop = () => abortRef.current?.abort();
  // Apply: the change goes through update() like all the others, so Ctrl+Z undoes it
  const decide = (msgId, action, choice) => {
    if (choice === 'reverted') undo();
    if (choice === 'applied') {
      try {
        update((d) => { action.apply(d); });
      } catch (e) {
        setMsgs((list) => list.map((m) => (m.id === msgId ? { ...m, actionState: { ...m.actionState, [action.id]: 'error' }, error: `Change failed: ${e.message}` } : m)));
        return;
      }
    }
    setMsgs((list) => list.map((m) => (m.id === msgId ? { ...m, actionState: { ...m.actionState, [action.id]: choice } } : m)));
  };
  const clear = () => { stop(); setMsgs([]); history.current = []; prevRoute.current = null; };
  const setMode = async (mode) => {
    if (mode === s.mode) return;
    localAI.updateSettings({ mode });
    if (mode === 'full') localAI.prepare(SYSTEM_PROMPT).catch(() => {}); // download if needed, load and get ready
    else { stop(); await localAI.unload(); await localAI.init({ autoStart: false }); } // frees memory (the running download continues)
    setTimeout(() => inputRef.current?.focus(), 30);
  };

  return html`
    ${hint && !open && html`<button class="ai-hint" onClick=${() => { setHint(false); setOpen(true); }}>Ask Brumoth!</button>`}
    ${open && html`<section class="ai-panel" role="dialog" aria-label="Brumoth, l'assistente di Dollaroni">
      <header class="ai-head">
        <div class="ai-head-title">
          <span class="ai-head-boat"><${BoatIcon} size=${26} /></span>
          <div><strong>Brumoth</strong><div class="ai-status">${statusLine(ai, s)}</div></div>
        </div>
        <div class="ai-head-actions">
          <button class="ai-iconbtn" title="New conversation" aria-label="New conversation" onClick=${clear}><${Icon} name="refresh" /></button>
          <button class=${`ai-iconbtn ${settingsOpen ? 'on' : ''}`} title="Brumoth settings" aria-label="Brumoth settings" onClick=${() => setSettingsOpen(!settingsOpen)}><${Icon} name="settings" /></button>
          <button class="ai-iconbtn" title="Chiudi (Esc)" aria-label="Chiudi" onClick=${() => setOpen(false)}><${Icon} name="x" /></button>
        </div>
      </header>
      ${ai.status === 'downloading' && ai.progress && html`<div class="ai-progress" title="Download del modello">
        <div class="ai-progress-fill" style=${{ width: `${Math.min(100, (ai.progress.loaded / (ai.progress.total || 1)) * 100)}%` }}></div>
      </div>`}
      ${settingsOpen
        ? html`<${Settings} ai=${ai} s=${s} />`
        : html`<div class="ai-msgs" ref=${listRef} aria-live="polite">
            ${!msgs.length && html`<div class="ai-msg bot">
              <p>Hi, I'm <strong>Brumoth</strong>! I answer about the open project with the numbers calculated by Dollaroni: budget, carbon, parts, rules, simulations.</p>
              <p class="muted small">${full
                ? html`<strong>Complete</strong> mode: I give you the answer from the data right away, then I rewrite it with my local AI. It takes a while: from half a minute to a few minutes.`
                : html`<strong>Instant</strong> mode: I answer right away with the data. For answers in my own words choose <strong>Complete</strong> from the menu below.`}</p>
              <div class="ai-chips">${suggestions.map((q) => html`<button class="ai-chip" onClick=${() => ask(q)}>${q}</button>`)}</div>
            </div>`}
            ${msgs.map((m) => (m.role === 'user'
              ? html`<div class="ai-msg user">${m.text}</div>`
              : html`<${BotMessage} m=${m} go=${go} decide=${decide} />`))}
          </div>
          <form class="ai-input" onSubmit=${(e) => { e.preventDefault(); ask(input); }}>
            <textarea ref=${inputRef} rows="1" value=${input} placeholder="Ask Brumoth something…" aria-label="Question for Brumoth"
              onInput=${(e) => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`; }}
              onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input); } }}></textarea>
            <div class="ai-input-bar">
              <${ModePicker} mode=${s.mode} onChange=${setMode} />
              ${onBattery && html`<span class="ai-battery" title="On battery Windows slows the processor: the AI can take twice as long or more">On battery: slower</span>`}
              ${working
                ? html`<button type="button" class="ai-send stop" title="Ferma" aria-label="Ferma" onClick=${stop}><${Icon} name="stop" /></button>`
                : html`<button type="submit" class="ai-send" title="Invia" aria-label="Invia" disabled=${!input.trim()}><${Icon} name="send" /></button>`}
            </div>
          </form>`}
    </section>`}
    <button class=${`ai-fab ${ai.status === 'downloading' ? 'downloading' : ''} ${open ? 'open' : ''}`} onClick=${() => { setHint(false); setOpen(!open); }}
      title=${open ? 'Close Brumoth' : `Ask Brumoth · ${statusLine(ai, s)}`} aria-label=${open ? 'Close Brumoth' : 'Ask Brumoth'}
      style=${ai.status === 'downloading' && ai.progress ? { '--p': `${Math.min(100, (ai.progress.loaded / (ai.progress.total || 1)) * 100)}%` } : null}>
      ${open ? html`<${Icon} name="x" size=${24} />` : html`<${BoatIcon} size=${40} />`}
      <span class=${`ai-dot ${dotTone(ai, s)}`}></span>
    </button>`;
}

/** Brumoth: a little boat (a Moth on its foils) drawn for Dollaroni. */
export function BoatIcon({ size = 30 }) {
  return html`<svg class="boat" width=${size} height=${size} viewBox="0 0 32 32" aria-hidden="true">
    <path d="M15.6 3.2 C 11.4 7.6 8.6 13.4 8.2 19.4 H 15.6 Z" fill="#fff" />
    <path d="M10.4 12.4 C 12 12.1 13.8 12.1 15.6 12.4" stroke="#7fb6ec" stroke-width="1.3" fill="none" />
    <path d="M16.4 2.8 V 20.4" stroke="#fff" stroke-width="1.5" stroke-linecap="round" />
    <path d="M4.6 20.8 H 27.4 C 26.6 23 24.8 23.8 22.2 23.8 H 9.4 C 7.2 23.8 5.4 23 4.6 20.8 Z" fill="#fff" />
    <path d="M16.4 23.8 V 28.2 M 12.6 28.2 H 20.2" stroke="#9fd0ff" stroke-width="1.7" stroke-linecap="round" fill="none" />
    <path d="M2.6 29.6 q 2.2 -1.4 4.4 0 t 4.4 0 M 21.2 29.6 q 2.2 -1.4 4.4 0 t 4.4 0" stroke="#9fd0ff" stroke-width="1.2" fill="none" stroke-linecap="round" opacity=".75" />
  </svg>`;
}

/** Mode drop-down menu (like choosing a model in AI apps). */
function ModePicker({ mode, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', close, true); document.removeEventListener('keydown', key, true); };
  }, [open]);
  const cur = MODES[mode] || MODES.instant;
  return html`<div class="ai-mode" ref=${ref}>
    <button type="button" class=${`ai-mode-btn ${cur.id}`} aria-haspopup="listbox" aria-expanded=${open} title="Choose how Brumoth answers" onClick=${() => setOpen(!open)}>
      <${Icon} name=${cur.icon} size=${14} /><span>${cur.label}</span><${Icon} name="chevronDown" size=${13} />
    </button>
    ${open && html`<div class="ai-mode-menu" role="listbox" aria-label="Modalità di Brumoth">
      ${Object.values(MODES).map((m) => html`<button type="button" role="option" aria-selected=${m.id === cur.id} class=${`ai-mode-item ${m.id === cur.id ? 'on' : ''}`}
        onClick=${() => { setOpen(false); onChange(m.id); }}>
        <span class=${`ai-mode-ico ${m.id}`}><${Icon} name=${m.icon} size=${16} /></span>
        <span class="ai-mode-text"><strong>${m.label}</strong><span>${m.desc}</span></span>
        ${m.id === cur.id && html`<span class="ai-mode-check"><${Icon} name="check" size=${16} /></span>`}
      </button>`)}
    </div>`}
  </div>`;
}

function dotTone(ai, s) {
  if (s.mode !== 'full') return 'ok';
  if (ai.status === 'ready' || ai.status === 'downloaded') return 'ok';
  if (ai.status === 'busy' || ai.status === 'loading' || ai.status === 'downloading') return 'busy';
  if (ai.status === 'error') return 'err';
  return 'off';
}

function statusLine(ai, s) {
  if (s.mode !== 'full') return 'Instant · immediate answers, from the data';
  const model = MODELS[s.model || recommendedModel()];
  const pct = ai.progress ? Math.round((ai.progress.loaded / (ai.progress.total || 1)) * 100) : 0;
  switch (ai.status) {
    case 'downloading': return `Downloading my AI (${model.label.toLowerCase()}) · ${pct}%`;
    case 'downloaded': return 'Complete · AI downloaded, I wake up at the first question';
    case 'loading': return 'Complete · getting ready…';
    case 'ready': return `Complete · local AI ${ai.info?.model || model.name}${ai.info?.gpu ? ' + graphics card' : ''}`;
    case 'busy': return 'Writing…';
    case 'error': return 'AI not available · answers from the data for now';
    default: return 'Complete · AI to download at the first question';
  }
}

const clock = (sec) => (sec < 60 ? `${Math.round(sec)} s` : `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')} min`);

function BotMessage({ m, go, decide }) {
  const [showFacts, setShowFacts] = useState(false);
  const [, setNow] = useState(0); // redraws every second while the AI works, for the elapsed time
  useEffect(() => {
    if (!m.pending) return undefined;
    const t = setInterval(() => setNow((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [m.pending]);
  const links = m.ans?.blocks.flatMap((b) => b.links || []) || [];
  const uniqueLinks = links.filter((l, i) => links.findIndex((x) => x.label === l.label) === i).slice(0, 3);
  return html`<div class=${`ai-msg bot ${m.pending && m.mode === 'data' ? 'pending' : ''}`}>
    <${Md} text=${m.text} />
    ${m.pending && html`<div class="ai-typing" aria-label="Brumoth sta scrivendo"><span></span><span></span><span></span></div>`}
    ${m.unverified?.length > 0 && html`<div class="ai-warn"><${Icon} name="alert" size=${13} /> To check: ${m.unverified.join(', ')} not ${m.unverified.length === 1 ? 'compare' : 'compaiono'} in the app data.</div>`}
    ${m.error && html`<div class="ai-warn">${m.error}</div>`}
    <div class="ai-meta">
      <span title=${m.mode === 'ai' ? "Text written by the local AI from the app data" : 'Immediate answer calculated by Dollaroni, without AI'}>${metaLabel(m)}</span>
      ${m.mode === 'ai' && html`<button class="ai-link" onClick=${() => setShowFacts(!showFacts)}>${showFacts ? 'Hide the data' : 'Data used'}</button>`}
      ${uniqueLinks.map((l) => html`<button class="ai-link" onClick=${() => go(l.view, l.opts || {})}>${l.label} →</button>`)}
    </div>
    ${showFacts && html`<div class="ai-facts"><${Md} text=${m.ans.text} /></div>`}
    ${(m.ans?.actions || []).map((a) => html`<${ActionCard} a=${a} state=${m.actionState?.[a.id]} go=${go}
      onApply=${() => decide(m.id, a, 'applied')} onCancel=${() => decide(m.id, a, 'cancelled')} onRevert=${() => decide(m.id, a, 'reverted')} />`)}
  </div>`;
}

function metaLabel(m) {
  const elapsed = m.startedAt ? (Date.now() - m.startedAt) / 1000 : 0;
  if (m.pending) {
    const st = localAI.state;
    const what = st.status === 'downloading' ? `downloading the AI ${st.progress ? Math.round((st.progress.loaded / (st.progress.total || 1)) * 100) : 0}%`
      : st.status === 'loading' ? 'getting ready' : m.mode === 'ai' ? 'scrivo' : 'ragiono';
    return `Brumoth · Complete · ${what}… ${clock(elapsed)}`;
  }
  if (m.mode === 'ai') {
    if (m.stopped) return 'Brumoth · Complete · stopped';
    const extra = [m.seconds ? `in ${clock(m.seconds)}` : null, m.tps ? `${m.tps.toLocaleString('it-IT', { maximumFractionDigits: 1 })} token/s` : null].filter(Boolean).join(' · ');
    return `Brumoth · Complete${extra ? ` · ${extra}` : ''}`;
  }
  return m.error ? 'Brumoth · from the data' : 'Brumoth · Instant · from the data';
}

const money = (x) => `${Number(x || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' })} SM$`;

/** Change proposed by Brumoth: what changes, effect on the numbers, Apply / Cancel. */
function ActionCard({ a, state, onApply, onCancel, onRevert, go }) {
  const p = a.preview;
  return html`<div class=${`ai-action ${state || 'open'}`}>
    <div class="ai-action-title">${a.title}</div>
    <ul>${a.changes.map((c) => html`<li>${inline(c)}</li>`)}</ul>
    ${p && !p.error && html`<div class="ai-action-effect">Total ${money(p.before.total)} → <strong>${money(p.after.total)}</strong> · margine <strong class=${p.after.margin < 0 ? 't-err' : ''}>${money(p.after.margin)}</strong></div>`}
    ${(p?.problems || []).map((x) => html`<div class=${`ai-action-problem ${x.level}`}><${Icon} name="alert" size=${13} /> ${x.message}</div>`)}
    ${!state
      ? html`<div class="ai-action-buttons">
          <button class="btn btn-sm" onClick=${onCancel}>Annulla</button>
          <button class="btn btn-sm btn-primary" onClick=${onApply}>Apply</button>
        </div>`
      : state === 'applied'
        ? html`<div class="ai-action-done t-ok">✓ Applied.
            ${a.target && html` <button class="ai-link" onClick=${() => go(a.target.view, a.target.opts || {})}>Go and see it →</button>`}
            <button class="ai-link" title="Undo the last change to the project (like Ctrl+Z)" onClick=${onRevert}>Go back</button></div>`
        : state === 'reverted'
          ? html`<div class="ai-action-done muted">Removed: the project is back as it was.</div>`
        : state === 'cancelled'
          ? html`<div class="ai-action-done muted">Cancelled: I changed nothing.</div>`
          : html`<div class="ai-action-done t-err">I could not apply it.</div>`}
  </div>`;
}

/** Minimal and safe Markdown (no HTML): **bold**, "- " and "1. " lists, indented lines. */
function Md({ text }) {
  const out = [];
  let list = null;
  const flush = () => { if (list) { out.push(list.ordered ? html`<ol>${list.items}</ol>` : html`<ul>${list.items}</ul>`); list = null; } };
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-•*]\s+(.*)$/);
    const num = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || num) {
      const ordered = Boolean(num);
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; }
      list.items.push(html`<li>${inline((bullet || num)[1])}</li>`);
      continue;
    }
    if (/^\s{2,}\S/.test(line) && list) { list.items.push(html`<li class="sub">${inline(line.trim())}</li>`); continue; }
    flush();
    if (!line.trim()) continue;
    out.push(/^\s{2,}\S/.test(line) ? html`<p class="sub">${inline(line.trim())}</p>` : html`<p>${inline(line)}</p>`);
  }
  flush();
  return html`<div class="md">${out}</div>`;
}

function inline(t) {
  return String(t).split(/(\*\*[^*]+\*\*)/g).map((part) => (/^\*\*[^*]+\*\*$/.test(part) ? html`<strong>${part.slice(2, -2)}</strong>` : part));
}

function Settings({ ai, s }) {
  const [downloaded, setDownloaded] = useState({});
  const env = environment();
  const rec = recommendedModel();
  const current = s.model || rec;
  const gpuOn = env.webgpu && localAI.gpuWanted(current);
  useEffect(() => {
    let alive = true;
    Promise.all(Object.keys(MODELS).map(async (id) => [id, await localAI.isDownloaded(id)])).then((r) => alive && setDownloaded(Object.fromEntries(r)));
    return () => { alive = false; };
  }, [ai.status, current]);

  const choose = async (id) => {
    if (id === current) return;
    await localAI.cancelDownload(); // a half-finished download of the other model must be stopped before changing
    await localAI.unload();
    localAI.updateSettings({ model: id });
    await localAI.init({ autoStart: false });
  };
  const size = (id) => {
    const r = s.resolved?.[id];
    return r?.size ? GB(r.size) : `about ${MODELS[id].approxGB.toLocaleString('it-IT')} GB`;
  };

  return html`<div class="ai-settings">
    <p class="small muted">The mode is chosen from the menu under the chat box: <strong>Instant</strong> (from the data, immediately)
      or <strong>Complete</strong> (with the local AI below, slower).</p>

    <h4>Model for Complete mode</h4>
    ${Object.values(MODELS).map((m) => html`<label class=${`ai-model ${current === m.id ? 'on' : ''}`}>
      <input type="radio" name="ai-model" checked=${current === m.id} onChange=${() => choose(m.id)} />
      <span><strong>${m.label}</strong> · ${m.name} · ${size(m.id)}${m.id === rec ? html` · <span class="t-ok">recommended for this PC</span>` : ''}<br />
        <span class="muted small">${m.desc}</span><br />
        <span class="small">${downloaded[m.id] ? html`<span class="t-ok">✓ downloaded on this PC</span>` : 'not downloaded'}</span></span>
    </label>`)}

    <div class="ai-actions">
      ${ai.status === 'downloading'
        ? html`<button class="btn btn-sm" onClick=${() => localAI.cancelDownload()}>Cancel download</button>`
        : !downloaded[current]
          ? html`<button class="btn btn-sm btn-primary" onClick=${() => localAI.download().catch(() => {})}>Download now (${size(current)})</button>`
          : html`<button class="btn btn-sm btn-danger" onClick=${async () => { if (confirm('Delete the model from this PC? It can be downloaded again.')) { await localAI.remove(current); setDownloaded({ ...downloaded, [current]: false }); } }}>Delete from the PC</button>`}
    </div>
    ${ai.error && html`<div class="ai-warn">${ai.error}</div>`}

    <h4>Opzioni</h4>
    <label class="ai-row"><input type="checkbox" checked=${s.autoDownload} onChange=${() => localAI.updateSettings({ autoDownload: !s.autoDownload })} />
      <span>In Complete mode download the AI automatically when the app opens (once, then it stays on the PC)</span></label>
    <label class="ai-row"><input type="checkbox" checked=${gpuOn} disabled=${!env.webgpu}
      onChange=${async () => { localAI.updateSettings({ gpu: gpuOn ? 'off' : 'on', gpuFailed: { ...s.gpuFailed, [current]: false } }); await localAI.unload(); await localAI.init({ autoStart: false }); }} />
      <span>Also use the graphics card (WebGPU)${!env.webgpu ? ' · not available in this browser'
        : s.gpuFailed?.[current] ? ' · disabled after an error, you can retry'
        : s.gpu === 'auto' ? (MODELS[current].gpu ? ' · on by default for this model' : ' · off by default for this model: it hangs on integrated graphics') : ''}</span></label>

    <h4>This PC</h4>
    <p class="small muted">
      ${env.cores} logical cores${env.memoryGB ? `, at least ${env.memoryGB} GB of RAM` : ''} ·
      ${env.isolated ? 'several usable cores' : 'a single core (open the app from "Avvia Dollaroni.bat" or the installed site)'}
      ${ai.info ? html` · in use: ${ai.info.threads} ${ai.info.threads === 1 ? 'core' : 'core'}${ai.info.gpu ? ' + graphics card' : ''}` : ''}
      ${s.tps ? html` · last answer: ${s.tps.toLocaleString('it-IT')} token/s` : ''}
    </p>
    <p class="small muted">Everything stays on this PC: questions and project data are not sent to anyone.
      The model is downloaded once from Hugging Face and kept in the browser storage for this address.</p>
  </div>`;
}
