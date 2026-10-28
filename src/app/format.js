// Formattazione numeri per la vista interna (italiano).

// useGrouping 'always': in italiano altrimenti 8422,44 resta senza punto (ma 10.000,00 no).
const it = (x, min, max) => Number(x || 0).toLocaleString('it-IT', { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: 'always' });

export const sm = (x) => it(x, 2, 2);
export const smShort = (x) => it(x, 0, 0);
export const kg = (x, d = 2) => `${it(x, d, d)} kg`;
export const grams = (x) => `${it(Math.round(x), 0, 0)} g`;
export const pct = (x, d = 1) => `${it(x * 100, d, d)}%`;
export const num = (x, maxDec = 3) => it(x, 0, maxDec);

/** Accetta "3,997" o "3.997". Ritorna null se il testo non è (ancora) un numero. */
export function parseNum(s) {
  const t = String(s ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (t === '' || t === '-' || t === '.' || t.endsWith('.')) return t.endsWith('.') && t.length > 1 ? Number(t.slice(0, -1)) : null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export const uid = (prefix = 'id') => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
