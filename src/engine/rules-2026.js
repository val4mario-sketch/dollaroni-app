// Rules of the 2026 SuMoth Challenge Competition Handbook (version of 15 October 2025).
// When the new rulebook comes out, create rules-20xx.js with the same shape.

export const RULES_2026 = {
  id: '2026',
  title: 'Competition Handbook 2026 (15 October 2025)',
  // official files from which the price list and Layup Calculator are read
  official: {
    costs: 'data/official/2026_SMC_Standardized_Costs.xlsx',
    layup: 'data/official/2026_SMC_Composite_Layup_Calculator.xlsx',
    provisional: false,
  },
  budget: 10000, // §2.2
  budgetStrict: false, // "capped at 10,000 SM$": the limit is included
  budgetPenalty: null,
  // references to the rulebook used in the messages
  refs: { budget: '§2.2', sources: '§3.3.B', upcycled: '§3.3.A', mass: '§2.5', usedParts: 'Tab. 3' },
  help: {
    notInCalculator: 'ask on Discord or document the calculation separately',
    priceSource: 'supplier MSRP or price given on Discord',
    catalogExtras: 'Hardware at MSRP (§3.2: SM$ = list price in USD without taxes and shipping) and materials not in the price list: the price must be requested on the SuMoth Discord (§3.1). Always state the source.',
  },
  massBreakdownRequired: true, // §2.5
  sourcesToConfirm: false,
  wasteTracking: false,
  reportNumbering: true, // section numbering of the 2026 S2 template (2.1–2.4)
  performance: null, // the 2026 Table 4 (handicap A–F) is not implemented
  labels: {
    s2DocTitle: '2. FINAL COST ANALYSIS – tables',
    costBasis: 'unit costs from the official Standardized Costs.',
  },

  // Categories of section 2.2 of the S2 template (one table per category).
  components: [
    { id: 'hull', en: 'Hull', it: 'Hull' },
    { id: 'foils', en: 'Foils', it: 'Foil' },
    { id: 'mechanical_control', en: 'Mechanical Control System', it: 'Mechanical control' },
    { id: 'gantry', en: 'Gantry', it: 'Gantry' },
    { id: 'wingbars', en: 'Wingbars', it: 'Wings' },
    { id: 'rig', en: 'Rig', it: 'Rig' },
    { id: 'electronics', en: 'Electronics', it: 'Electronics' },
  ],

  // §3.3.B and §3.3.A: origin of the material -> multiplier on the price.
  sources: {
    new: { factor: 1, it: 'New', en: null },
    industrial_excess: {
      factor: 0.75, it: 'Industrial surplus −25%', en: 'Industrial Excess',
      footnote: 'Material sourced from industrial excess: 25% reduction under Section 3.3.B of the Rules',
    },
    out_of_shelf_life: {
      factor: 0.5, it: 'Out of shelf life −50%', en: 'OOSL',
      footnote: 'Out-of-shelf-life material: 50% reduction under Section 3.3.B of the Rules',
    },
    upcycled: {
      factor: 0, it: 'Upcycled −100%', en: 'upcycled',
      footnote: 'Upcycled element (Sections 3.3.A and 3.3.B of the Rules): 0 SM$. Origin and transformation must be itemised',
    },
  },

  // Table 2 – carbon limits in kg per component.
  carbonGroups: [
    { id: 'hull', en: 'Hull' }, { id: 'wingbars', en: 'Wingbars' },
    { id: 'main_vertical', en: 'Main Vertical' }, { id: 'main_horizontal', en: 'Main Horizontal' },
    { id: 'rudder_vertical', en: 'Rudder Vertical' }, { id: 'rudder_horizontal', en: 'Rudder Horizontal' },
    { id: 'gantry', en: 'Gantry' }, { id: 'rig', en: 'Rig' }, { id: 'other', en: 'Other parts' },
  ],
  carbonLimits: {
    //                hull  wing  MV     MH    RV    RH    gantry rig  other
    cfrp:            [3.00, 1.00, 1.50,  1.00, 1.50, 1.00, 1.00, 2.00, 1.00],
    cf:              [1.50, 0.50, 0.75,  0.50, 0.75, 0.50, 0.50, 1.00, 0.50],
    recycled_cfrp:   [4.50, 1.50, 2.25,  1.50, 2.25, 1.50, 1.50, 3.00, 1.50],
    recycled_cf:     [2.25, 0.75, 1.125, 0.75, 1.13, 0.75, 0.75, 1.50, 0.75],
    upcycled_cfrp:   [25.0, 5.00, 3.00,  1.00, 2.50, 1.00, 2.00, 1.00, 1.00],
  },

  // Table 3 – used parts (not UFLP): fixed SM$ cost and handicap points by year of production.
  // Negative points = reduction. For foils, the reduction doubles from the following years of participation (§3.4.A).
  usedParts: {
    main_vertical:     { en: 'Main Vertical',     kind: 'foil', cost: 1500, handicap: [-200, -220, -240, -260, -500] },
    main_horizontal:   { en: 'Main Horizontal',   kind: 'foil', cost: 500,  handicap: [-150, -170, -190, -210, -300] },
    rudder_vertical:   { en: 'Rudder Vertical',   kind: 'foil', cost: 1500, handicap: [-150, -170, -190, -210, -300] },
    rudder_horizontal: { en: 'Rudder Horizontal', kind: 'foil', cost: 500,  handicap: [-100, -120, -160, -180, -200] },
    sail:              { en: 'Sail',     kind: 'rig', cost: 0, handicap: [0, -50, -100, -150, -200] },
    mast:              { en: 'Mast',     kind: 'rig', cost: 0, handicap: [0, -50, -100, -150, -200] },
    boom:              { en: 'Boom',     kind: 'rig', cost: 0, handicap: [0, -50, -100, -150, -200] },
    spreader:          { en: 'Spreader', kind: 'rig', cost: 0, handicap: [0, -50, -100, -150, -200] },
  },
  /** Table 3 column for a year of production: Pre 2015, 2015, 2016, 2017, Post 2017. */
  usedPartYearIndex(year) {
    if (year < 2015) return 0;
    if (year > 2017) return 4;
    return year - 2014;
  },

  // Groups of the as-built mass breakdown required by §2.5.
  massGroups: [
    { id: 'hull', en: 'Hull' }, { id: 'wings', en: 'Wings' },
    { id: 'horizontal_foils', en: 'Horizontal foils' }, { id: 'vertical_foils', en: 'Vertical foils' },
    { id: 'other', en: 'Other' },
  ],
};

// Densities (g/cm³) of materials the official Layup Calculator does NOT include.
// Used only for internal estimates: these materials cannot be entered in the official file.
export const EXTRA_DENSITIES = {
  aramid: 1.44,
  innegra: 0.84,
  diolen: 1.38,
  polyester: 1.2,
  vinylester: 1.1,
};

/**
 * Links a price-list item to the Layup Calculator material.
 * Returns {calc: name in the calculator | null, density?, carbon: bool}.
 */
export function layupMaterialFor(entry) {
  // group/type for the items of the official price list, name for those added by the team
  const txt = `${entry.group ?? ''} ${entry.type ?? ''} ${entry.extra ? entry.name ?? '' : ''}`.toLowerCase();
  if (entry.density && entry.kind === 'reinforcement') return { calc: null, density: entry.density, carbon: /carbon|\bcf\b/.test(txt) };
  if (entry.kind === 'reinforcement') {
    if (/carbon|\bcf\b/.test(txt)) return { calc: 'CARBON FIBER IM', carbon: true };
    if (/glass/.test(txt)) return { calc: 'GLASS FIBER', carbon: false };
    if (/basalt/.test(txt)) return { calc: 'BASALT', carbon: false };
    if (/flax/.test(txt)) return { calc: 'FLAX', carbon: false };
    if (/aramid|kevlar/.test(txt)) return { calc: null, density: EXTRA_DENSITIES.aramid, carbon: false };
    if (/innegra/.test(txt)) return { calc: null, density: EXTRA_DENSITIES.innegra, carbon: false };
    if (/diolen/.test(txt)) return { calc: null, density: EXTRA_DENSITIES.diolen, carbon: false };
  }
  if (entry.kind === 'matrix') {
    if (/epoxy/.test(txt)) return { calc: 'EPOXY', carbon: false };
    if (/pa1[12]/.test(txt)) return { calc: 'THERMOPLASTIC', carbon: false };
    if (/polyester/.test(txt)) return { calc: null, density: EXTRA_DENSITIES.polyester, carbon: false };
    if (/vinyl/.test(txt)) return { calc: null, density: EXTRA_DENSITIES.vinylester, carbon: false };
  }
  return { calc: null, carbon: false };
}
