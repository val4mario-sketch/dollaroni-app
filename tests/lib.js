// Mini framework di test nel browser (nessuna dipendenza).

export const suites = [];
let current = null;

export function suite(name, fn) {
  current = { name, tests: [] };
  suites.push(current);
  fn();
  current = null;
}

export function test(name, fn) {
  if (!current) throw new Error('test() fuori da suite()');
  current.tests.push({ name, fn });
}

export class AssertionError extends Error {}

export function eq(actual, expected, msg = '') {
  if (actual !== expected) throw new AssertionError(`${msg} atteso ${JSON.stringify(expected)}, ottenuto ${JSON.stringify(actual)}`);
}

export function close(actual, expected, tol, msg = '') {
  if (typeof actual !== 'number' || Number.isNaN(actual) || Math.abs(actual - expected) > tol) {
    throw new AssertionError(`${msg} atteso ${expected} ±${tol}, ottenuto ${actual}`);
  }
}

export function ok(cond, msg = '') {
  if (!cond) throw new AssertionError(msg || 'condizione falsa');
}

/** Arrotonda come le tabelle del report (grammi interi, centesimi di SM$). */
export const g = (x) => Math.round(x);
export const cents = (x) => Math.round(x * 100) / 100;

export async function runAll() {
  const results = [];
  for (const s of suites) {
    for (const t of s.tests) {
      const started = performance.now();
      try {
        await t.fn();
        results.push({ suite: s.name, name: t.name, ok: true, ms: performance.now() - started });
      } catch (e) {
        results.push({ suite: s.name, name: t.name, ok: false, error: e instanceof AssertionError ? e.message : e.stack || String(e) });
      }
    }
  }
  return results;
}
