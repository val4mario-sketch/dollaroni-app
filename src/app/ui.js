// Componenti di interfaccia riusati in tutte le viste (Preact + htm, niente build).

import { html, useState, useEffect, useRef, useMemo } from '../../vendor/preact-htm.js';
import { parseNum, num } from './format.js';

export { html, useState, useEffect, useRef, useMemo };

// ---------------------------------------------------------------- icone (SVG in linea)
const PATHS = {
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  chevron: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 20V9M7 14l5-5 5 5M5 4h14',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  folder: 'M3 7h6l2 2h10v10H3z',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  alert: 'M12 4l9 16H3zM12 10v4M12 17v.5',
  check: 'M5 12l5 5 9-10',
  info: 'M12 11v6M12 7v.5M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
  export: 'M12 3v12M7 8l5-5 5 5M4 14v6h16v-6',
  clipboard: 'M9 4h6v3H9zM7 5H5v16h14V5h-2',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.5M4 12h.5M4 18h.5',
  gauge: 'M4 16a8 8 0 1 1 16 0M12 16l4-5',
  book: 'M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4zM5 16a4 4 0 0 1 4-4h10',
  home: 'M4 11l8-7 8 7M6 10v10h12V10',
  x: 'M6 6l12 12M18 6L6 18',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  chat: 'M4 5h16v11H10l-5 4v-4H4z',
  sparkle: 'M11 3l1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9zM18.5 14.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z',
  send: 'M4 12l16-8-5 16-3-6.5zM12 13.5L20 4',
  stop: 'M7 7h10v10H7z',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2.5v3M12 18.5v3M3.8 7l2.6 1.5M17.6 15.5l2.6 1.5M3.8 17l2.6-1.5M17.6 8.5L20.2 7',
  refresh: 'M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0',
  bolt: 'M13 2L4.5 13.5H11L10 22l8.5-11.5H12z',
};

export function Icon({ name, size = 16 }) {
  return html`<svg class="icon" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${PATHS[name] || ''} /></svg>`;
}

export function Button({ icon, children, onClick, kind = 'secondary', title, disabled, small, type = 'button' }) {
  return html`<button type=${type} class=${`btn btn-${kind}${small ? ' btn-sm' : ''}${!children ? ' btn-icon' : ''}`} onClick=${onClick} title=${title} aria-label=${title} disabled=${disabled}>
    ${icon && html`<${Icon} name=${icon} />`}${children && html`<span>${children}</span>`}
  </button>`;
}

// ---------------------------------------------------------------- campi
/** Campo numerico: accetta la virgola, non "salta" mentre scrivi. */
export function NumInput({ value, onChange, width = 80, placeholder, title, min, className = '' }) {
  const [text, setText] = useState(value === null || value === undefined ? '' : String(value).replace('.', ','));
  const focused = useRef(false);
  useEffect(() => {
    if (focused.current) return;
    setText(value === null || value === undefined ? '' : String(value).replace('.', ','));
  }, [value]);
  const bad = text !== '' && parseNum(text) === null;
  return html`<input class=${`inp num ${bad ? 'bad' : ''} ${className}`} style=${{ width: width + 'px' }} inputmode="decimal" value=${text} placeholder=${placeholder} title=${title}
    onFocus=${() => (focused.current = true)}
    onBlur=${() => { focused.current = false; const n = parseNum(text); setText(n === null ? (value ?? '') === '' ? '' : String(value).replace('.', ',') : String(n).replace('.', ',')); }}
    onInput=${(e) => {
      setText(e.target.value);
      const n = parseNum(e.target.value);
      if (n !== null && (min === undefined || n >= min)) onChange(n);
      else if (e.target.value.trim() === '') onChange(null);
    }} />`;
}

export function TextInput({ value, onChange, width, placeholder, title, className = '' }) {
  return html`<input class=${`inp ${className}`} style=${width ? { width: typeof width === 'number' ? width + 'px' : width } : null} value=${value ?? ''} placeholder=${placeholder} title=${title}
    onInput=${(e) => onChange(e.target.value)} />`;
}

/** options: [{value, label, group?}] */
export function Select({ value, onChange, options, width, title, className = '', placeholder }) {
  const groups = [];
  for (const o of options) {
    const g = o.group || '';
    let grp = groups.find((x) => x.name === g);
    if (!grp) groups.push((grp = { name: g, items: [] }));
    grp.items.push(o);
  }
  const opt = (o) => html`<option value=${o.value} selected=${o.value === value}>${o.label}</option>`;
  const known = options.some((o) => o.value === value);
  return html`<select class=${`inp ${className}`} style=${width ? { width: typeof width === 'number' ? width + 'px' : width } : null} title=${title}
    onChange=${(e) => onChange(e.target.value)}>
    ${placeholder !== undefined && html`<option value="" selected=${!value}>${placeholder}</option>`}
    ${!known && value && html`<option value=${value} selected>${value} (non trovato)</option>`}
    ${groups.map((g) => (g.name ? html`<optgroup label=${g.name}>${g.items.map(opt)}</optgroup>` : g.items.map(opt)))}
  </select>`;
}

const KIND_LABEL = {
  reinforcement: 'Rinforzi', prepreg: 'Prepreg', matrix: 'Matrici e resine', core: 'Anime',
  process: 'Lavorazioni', consumable: 'Consumabili', other: 'Stampi, metalli, stampa 3D', hardware: 'Voci del team (MSRP, Discord)',
};
export const kindLabel = (k) => KIND_LABEL[k] || k;

/** Nome breve di una voce di listino ("Dry fabric Basalt Fibers" -> "Basalt Fibers"). */
export function shortName(e) {
  if (!e) return '';
  const n = (e.name || e.id).replace(/^Dry fabric\s+/i, '');
  return n.charAt(0).toUpperCase() + n.slice(1);
}

export function catalogOptions(catalog, kinds) {
  const out = [];
  for (const e of catalog.values()) {
    if (kinds && !kinds.includes(e.kind)) continue;
    const price = e.price === null || e.price === undefined ? 'prezzo da chiedere' : `${num(e.price, 2)} SM$/${e.unit}`;
    out.push({ value: e.id, label: `${shortName(e)} · ${price}`, group: kindLabel(e.kind) });
  }
  return out;
}

export function CatalogSelect({ catalog, kinds, value, onChange, width, placeholder }) {
  return html`<${Select} value=${value} onChange=${onChange} options=${catalogOptions(catalog, kinds)} width=${width} placeholder=${placeholder} />`;
}

export const SOURCE_OPTIONS = [
  { value: 'new', label: 'Nuovo' },
  { value: 'industrial_excess', label: 'Eccedenza −25%' },
  { value: 'out_of_shelf_life', label: 'Scaduto −50%' },
  { value: 'upcycled', label: 'Upcycled −100%' },
];

// ---------------------------------------------------------------- piccoli elementi grafici
export function Bar({ ratio, tone = 'accent', height = 8 }) {
  const r = Math.max(0, Math.min(1, ratio || 0));
  return html`<div class="bar" style=${{ height: height + 'px' }}><div class=${`bar-fill tone-${tone}`} style=${{ width: r * 100 + '%' }}></div></div>`;
}

export function Badge({ tone = 'neutral', children, title }) {
  return html`<span class=${`badge tone-${tone}`} title=${title}>${children}</span>`;
}

export function Card({ title, actions, children, className = '' }) {
  return html`<section class=${`card ${className}`}>
    ${(title || actions) && html`<div class="card-head"><h3>${title}</h3><div class="card-actions">${actions}</div></div>`}
    ${children}
  </section>`;
}

export function Empty({ title, children, action }) {
  return html`<div class="empty"><p class="empty-title">${title}</p>${children && html`<p class="muted">${children}</p>`}${action}</div>`;
}

export const toneForRatio = (r) => (r > 1 + 1e-9 ? 'err' : r >= 0.95 ? 'warn' : 'ok');

/** Stato di una voce in S2: stimata (da aggiornare) o misurata (valore reale as-built). */
export function StatusPill({ status, onToggle, title }) {
  const measured = status === 'measured';
  return html`<button type="button" class=${`status-pill ${measured ? 'measured' : 'estimated'}`} onClick=${onToggle} disabled=${!onToggle}
    title=${title || (onToggle ? (measured ? 'Valore reale as-built. Clic per rimetterla stimata' : 'Ancora una stima. Clic quando è aggiornata al valore reale') : '')}>
    ${measured ? '✓ misurata' : 'stimata'}
  </button>`;
}
