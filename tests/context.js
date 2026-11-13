// Loads the official files and 2026 projects once for all the tests.

import { importCostCatalog, importLayupSpec, importAgoraLibrary } from '../src/io/official.js';
import { RULES_2026 } from '../src/engine/rules-2026.js';
import { evaluate, makeCatalog } from '../src/engine/project.js';

const bytes = async (path) => (await fetch(path)).arrayBuffer();
const json = async (path) => (await fetch(path)).json();

let ctxPromise = null;

export function loadContext() {
  ctxPromise ||= (async () => {
    const templateBytes = await bytes('../data/official/2026_SMC_Composite_Layup_Calculator.xlsx');
    const { entries, warnings } = await importCostCatalog(await bytes('../data/official/2026_SMC_Standardized_Costs.xlsx'));
    const spec = await importLayupSpec(templateBytes);
    const s1 = await json('../data/projects/meravijosa-2026-s1.json');
    const s2 = await json('../data/projects/meravijosa-2026-s2.json');
    const base = { spec, catalogEntries: entries, rules: RULES_2026 };
    const lib = importAgoraLibrary(await json('../data/official/2027_SuMoth_Agora_library.json'));
    return {
      templateBytes, spec, catalogEntries: entries, catalogWarnings: warnings, rules: RULES_2026,
      s1, s2,
      agora: { spec: lib.spec, catalogEntries: lib.entries }, agoraWarnings: lib.warnings,
      evS1: evaluate(s1, base),
      evS2: evaluate(s2, base),
      catalogFor: (project) => makeCatalog(entries, project.catalogExtras || []),
    };
  })();
  return ctxPromise;
}
