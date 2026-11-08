// Available rulebooks. The project says which to use in the "rules" field (old files without the field are 2026).

import { RULES_2026 } from './rules-2026.js';
import { RULES_2027 } from './rules-2027.js';

export const RULES = { 2026: RULES_2026, 2027: RULES_2027 };
export const CURRENT_RULES = '2027';

/** Rules id requested by the project ('2026' if the field is missing). */
export const rulesId = (project) => String(project?.rules ?? '2026');

/** Rules of the project; null if the file asks for a rulebook this version does not know. */
export const rulesFor = (project) => RULES[rulesId(project)] || null;

export { RULES_2026, RULES_2027 };
