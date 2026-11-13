// Start-up: loads the official files (price list and Layup Calculator) of each rulebook and mounts the app.

import { html, render } from '../../vendor/preact-htm.js';
import { importCostCatalog, importLayupSpec, importAgoraLibrary } from '../io/official.js';
import { RULES } from '../engine/rules.js';
import { App } from './app.js';
import { setupPwa } from './pwa.js';
import { startUpdates } from './updates.js';

setupPwa();

async function bytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Cannot find ${url} (${r.status})`);
  return r.arrayBuffer();
}

/** Price list + Layup Calculator (or the SuMoth Agora library); if two rulebooks use the same files they are read once. */
const loaded = new Map();
function officialData({ costs, layup, agora }) {
  const key = agora || `${costs}|${layup}`;
  if (!loaded.has(key)) {
    loaded.set(key, (async () => {
      if (agora) {
        const { entries, warnings, spec, version } = importAgoraLibrary(JSON.parse(new TextDecoder().decode(await bytes(agora))));
        return { spec, catalogEntries: entries, catalogWarnings: warnings, templateBytes: null, libraryVersion: version };
      }
      const [costBytes, template] = await Promise.all([bytes(costs), bytes(layup)]);
      const { entries, warnings } = await importCostCatalog(costBytes);
      const spec = await importLayupSpec(template);
      return { spec, catalogEntries: entries, catalogWarnings: warnings, templateBytes: template };
    })());
  }
  return loaded.get(key);
}

async function boot() {
  const root = document.getElementById('app');
  try {
    // one context per rulebook: {spec, catalogEntries, catalogWarnings, templateBytes, rules}
    const contexts = {};
    for (const rules of Object.values(RULES)) contexts[rules.id] = { ...(await officialData(rules.official)), rules };
    root.innerHTML = '';
    render(html`<${App} contexts=${contexts} />`, root);
    startUpdates().catch((e) => console.warn('Update check failed:', e));
  } catch (e) {
    console.error(e);
    root.innerHTML = `<div class="boot-error"><h2>Dollaroni cannot start</h2><p>${e.message}</p><p>The app must be opened through a server (e.g. <code>python tools/devserver.py</code>), not by double-clicking the file.</p></div>`;
  }
}

boot();
