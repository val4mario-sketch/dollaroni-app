import { runAll } from './lib.js';
import './layup.test.js';
import './costs.test.js';
import './checks-export.test.js';
import './export-s1.test.js';
import './s1-s2.test.js';
import './rules-2027.test.js';
import './assistant.test.js';
import './actions.test.js';

const results = await runAll();
const failed = results.filter((r) => !r.ok);
const log = document.getElementById('log');
let lastSuite = '';
for (const r of results) {
  if (r.suite !== lastSuite) {
    const h = document.createElement('div');
    h.className = 'hd';
    h.textContent = r.suite;
    log.appendChild(h);
    lastSuite = r.suite;
  }
  const line = document.createElement('div');
  line.className = r.ok ? 'ok' : 'ko';
  line.textContent = `${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : '\n    ' + r.error}`;
  log.appendChild(line);
}
document.getElementById('summary').textContent = `${results.length - failed.length}/${results.length} test superati`;
window.__RESULTS__ = results;

// per tools/run_tests_headless.py (e GitHub prima di pubblicare): risultati su disco tramite il server locale
fetch('../out/test-results.json', {
  method: 'PUT',
  body: JSON.stringify({ passed: results.length - failed.length, total: results.length, failed: failed.map((r) => ({ suite: r.suite, name: r.name, error: r.error })) }),
}).catch(() => {});
