// Regolamenti disponibili. Il progetto dice quale usare nel campo "rules" (i file vecchi senza campo sono 2026).

import { RULES_2026 } from './rules-2026.js';
import { RULES_2027 } from './rules-2027.js';

export const RULES = { 2026: RULES_2026, 2027: RULES_2027 };
export const CURRENT_RULES = '2027';

/** Id delle regole chiesto dal progetto ('2026' se il campo manca). */
export const rulesId = (project) => String(project?.rules ?? '2026');

/** Regole del progetto; null se il file chiede un regolamento che questa versione non conosce. */
export const rulesFor = (project) => RULES[rulesId(project)] || null;

export { RULES_2026, RULES_2027 };
