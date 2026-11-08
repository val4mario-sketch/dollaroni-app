// Number formatting for the internal view (Italian number format).

// useGrouping 'always': in Italian, 8422,44 would otherwise stay without a separator (but 10.000,00 would not).
const it = (x, min, max) => Number(x || 0).toLocaleString('it-IT', { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: 'always' });

export const sm = (x) => it(x, 2, 2);
export const smShort = (x) => it(x, 0, 0);
export const kg = (x, d = 2) => `${it(x, d, d)} kg`;
export const grams = (x) => `${it(Math.round(x), 0, 0)} g`;
export const pct = (x, d = 1) => `${it(x * 100, d, d)}%`;
export const num = (x, maxDec = 3) => it(x, 0, maxDec);

/** Accepts "3,997" or "3.997". Returns null if the text is not (yet) a number. */
export function parseNum(s) {
  const t = String(s ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (t === '' || t === '-' || t === '.' || t.endsWith('.')) return t.endsWith('.') && t.length > 1 ? Number(t.slice(0, -1)) : null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export const uid = (prefix = 'id') => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
