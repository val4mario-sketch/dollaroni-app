// Rules of the 2027 SMC Competition Rulebook, release 1.0 of 7 September 2026.
//
// What changes compared with 2026 (checked on the PDF on 28/09/2026):
//  - budget of 10,000 SM$ "to keep under" (§10.1.2); exceeding it costs 500 points (§10.1.3);
//  - Table 2 (carbon limits) identical to 2026, "Wingbars" is called "Hiking racks";
//  - the price list is no longer a public file: costs and calculation are on the SuMoth Agora Platform (§10.1.1).
//    Since 13/11/2026 we use its library (agora.sumoth.org/library.json, copy in data/official/,
//    update with tools/update_agora_library.py): prices, densities and resin fraction by process × fibre family;
//  - the origin discounts of 2026 §3.3.B are no longer in the rulebook, but Agora applies them per row (−25/−50/−100%);
//  - the old Table 3 (used parts at a fixed cost + handicap by year) is gone: a used part
//    is paid like a normal item. In its place is the new Table 3 "SuMoth Performance Points" (§11);
//  - the as-built mass breakdown of 2026 §2.5 is no longer required;
//  - in S2 material waste must also be tracked (§9.2.2);
//  - an upcycled hull is allowed only if it originally came from a non-foiling boat (§6.2.1).

import { RULES_2026 } from './rules-2026.js';

const rename = (list) => list.map((x) => (x.id === 'wingbars' ? { ...x, en: 'Hiking racks' } : x));
const AGORA = 'as applied by the SuMoth Agora Platform';

// 2027 Table 3: points for conditions a)–g) of rule 11.1.3. null = N/A.
//                                   a     b     c    d    e     f     g
const PERF_ROWS = [
  ['hull_internal', 'Hull internal structure', 'Hull internal structure', [null, -25, 25, 25, -10, -25, null]],
  ['hull_shell', 'Hull shell', 'Hull shell', [null, null, 50, 50, -10, -50, null]],
  ['stern_fitting', 'Stern fitting', 'Stern fitting', [null, -25, 25, 25, -10, -25, -100]],
  ['stem_fitting', 'Stem fitting', 'Stem fitting', [null, -25, 25, 25, -10, -25, -50]],
  ['mast_base', 'Mast base (king post)', "Mast step (king post)", [null, -25, 25, 25, -10, -25, -50]],
  ['hiking_rack_structure', 'Hiking rack structure', 'Wing structure', [null, -25, 25, 25, -10, -25, -50]],
  ['hiking_rack_covers', 'Hiking rack covers', 'Wing covers', [null, -25, 25, 25, -10, -10, -10]],
  ['main_vertical', 'Main vertical', 'Main vertical', [-150, -50, 50, 50, -25, -50, -100]],
  ['main_horizontal', 'Main horizontal', 'Main horizontal', [-100, -50, 0, 0, -25, -25, -100]],
  ['rudder_vertical', 'Rudder vertical', 'Rudder vertical', [-100, -25, 25, 25, -10, -25, -100]],
  ['rudder_horizontal', 'Rudder horizontal', 'Rudder horizontal', [-50, -25, 0, 0, -10, -25, -100]],
  ['sail', 'Sail', 'Sail', [-10, -10, 10, 10, -5, -10, -10]],
  ['mast', 'Mast', 'Mast', [-10, -10, 10, 10, -5, -10, -10]],
  ['boom', 'Boom', 'Boom', [-10, -10, 10, 10, -5, -10, -10]],
  ['spreader', 'Spreader', 'Spreaders', [-10, -10, 10, 10, -5, -10, -10]],
];

export const RULES_2027 = {
  id: '2027',
  title: '2027 SMC Competition Rulebook v1.0 (7 settembre 2026)',
  // SuMoth Agora library (prices + resin fractions); there is no Layup Calculator file in 2027.
  official: { agora: 'data/official/2027_SuMoth_Agora_library.json', provisional: false },
  budget: 10000, // §10.1.2 "shall remain below 10,000 SM$"
  budgetStrict: true,
  budgetPenalty: 500, // §10.1.3
  refs: { budget: '§10.1', sources: '§3.3.B 2026', upcycled: '§3.3.A 2026', mass: null, usedParts: null },
  help: {
    notInCalculator: 'it is not in the SuMoth Agora library: propose it on Agora with scientific evidence (§10.3)',
    priceSource: 'price taken from SuMoth Agora or supplier MSRP',
    catalogExtras: 'Materials and hardware not in the price list, always with the price source. In 2027 prices are on SuMoth Agora and new materials are proposed there, with scientific evidence (§10.3).',
  },
  massBreakdownRequired: false,
  sourcesToConfirm: false, // Agora applies them
  wasteTracking: true, // §9.2.2
  upcycledHullNonFoiling: true, // §6.2.1
  reportNumbering: false, // the 2027 templates (on Moodle) are not known yet
  labels: {
    s2DocTitle: 'MEASURED MANUFACTURING COST – supporting tables',
    costBasis: `unit costs from the SuMoth Agora Platform library (Rule 10.1.1); provenance discounts of the 2026 Rules (Section 3.3.B) ${AGORA}.`,
  },

  // Cost categories: the same 7 as the 2026 S2 template, until we see how Agora asks for them.
  components: rename(RULES_2026.components),

  // 2026 §3.3.B discounts: the 2027 rulebook no longer mentions them, Agora applies them per row.
  sources: {
    new: { factor: 1, it: 'New', en: null },
    industrial_excess: {
      factor: 0.75, it: 'Industrial surplus −25%', en: 'Industrial Excess',
      footnote: `Material sourced from industrial excess: 25% reduction (2026 Rules, Section 3.3.B; ${AGORA})`,
    },
    out_of_shelf_life: {
      factor: 0.5, it: 'Out of shelf life −50%', en: 'OOSL',
      footnote: `Out-of-shelf-life material: 50% reduction (2026 Rules, Section 3.3.B; ${AGORA})`,
    },
    upcycled: {
      factor: 0, it: 'Upcycled −100%', en: 'upcycled',
      footnote: `Upcycled element: 0 SM$ (2026 Rules, Sections 3.3.A and 3.3.B; ${AGORA}). Origin and transformation itemised`,
    },
  },

  // 2027 Table 2 – same values as 2026.
  carbonGroups: rename(RULES_2026.carbonGroups),
  carbonLimits: {
    //                hull  racks MV     MH    RV    RH    gantry rig  other
    cfrp:            [3.00, 1.00, 1.50,  1.00, 1.50, 1.00, 1.00, 2.00, 1.00],
    cf:              [1.50, 0.50, 0.75,  0.50, 0.75, 0.50, 0.50, 1.00, 0.50],
    recycled_cfrp:   [4.50, 1.50, 2.25,  1.50, 2.25, 1.50, 1.50, 3.00, 1.50],
    recycled_cf:     [2.25, 0.75, 1.125, 0.75, 1.13, 0.75, 0.75, 1.50, 0.75],
    upcycled_cfrp:   [25.0, 5.00, 3.00,  1.00, 2.50, 1.00, 2.00, 1.00, 1.00],
  },

  // Used parts: no more fixed cost (cost: null). They are paid at the price stated in the item.
  usedParts: Object.fromEntries(Object.entries(RULES_2026.usedParts).map(([id, d]) => [id, { en: d.en, kind: d.kind, cost: null }])),
  usedPartYearIndex: null,

  // The mass breakdown is no longer required by the rulebook, but stays useful (same rows as 2026).
  massGroups: RULES_2026.massGroups,

  // Tab. 3 "SuMoth Performance Points" (§11.1).
  performance: {
    conditions: [
      { id: 'a', it: 'Bought, donated or ordered without technical involvement of the team', en: 'Purchased, donated, or ordered with no technical Team involvement' },
      { id: 'b', it: 'Built by people outside the team', en: 'Manufactured by non-Team members' },
      { id: 'c', it: 'Built with recycled materials', en: 'Manufactured using recycled materials' },
      { id: 'd', it: 'Built with upcycled or recycled moulds or sub-components (moulds from previous editions do not count as upcycled; they are recycled if made with recycled materials)', en: 'Manufactured using upcycled or recycled moulds or sub-components' },
      { id: 'e', it: 'Built by the team under the direct technical supervision of an industrial partner', en: 'Manufactured by Team members under direct technical supervision of an industrial partner' },
      { id: 'f', it: 'Built with moulds made by people outside the team', en: 'Manufactured using moulds made by non-Team members' },
      { id: 'g', it: 'Designed by people outside the team', en: 'Designed by non-Team members' },
    ],
    components: PERF_ROWS.map(([id, en, it, points]) => ({ id, en, it, points })),
    // §11.1.5: commercial sails, masts and foils produced from 2017 onwards, −100 each barring compromising damage.
    // §11.1.5.1: without sufficient evidence (year or damage) the penalty applies.
    commercial: {
      elements: ['sail', 'mast', 'main_vertical', 'main_horizontal', 'rudder_vertical', 'rudder_horizontal'],
      fromYear: 2017,
      points: -100,
    },
  },
};
