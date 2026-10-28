// Regole del 2026 SuMoth Challenge Competition Handbook (versione 15 ottobre 2025).
// Quando esce il regolamento nuovo si crea rules-20xx.js con la stessa forma.

export const RULES_2026 = {
  id: '2026',
  title: 'Competition Handbook 2026 (15 ottobre 2025)',
  // file ufficiali da cui si leggono listino e Layup Calculator
  official: {
    costs: 'data/official/2026_SMC_Standardized_Costs.xlsx',
    layup: 'data/official/2026_SMC_Composite_Layup_Calculator.xlsx',
    provisional: false,
  },
  budget: 10000, // §2.2
  budgetStrict: false, // "capped at 10,000 SM$": il limite è compreso
  budgetPenalty: null,
  // riferimenti al regolamento usati nei messaggi
  refs: { budget: '§2.2', sources: '§3.3.B', upcycled: '§3.3.A', mass: '§2.5', usedParts: 'Tab. 3' },
  help: {
    notInCalculator: 'chiedere su Discord o documentare il calcolo a parte',
    priceSource: 'MSRP del fornitore o prezzo dato su Discord',
    catalogExtras: 'Hardware a prezzo MSRP (§3.2: SM$ = prezzo di listino in USD senza tasse e spedizione) e materiali che non sono nel listino: il prezzo va chiesto sul Discord SuMoth (§3.1). Indica sempre la fonte.',
  },
  massBreakdownRequired: true, // §2.5
  sourcesToConfirm: false,
  wasteTracking: false,
  reportNumbering: true, // numerazione delle sezioni del template S2 2026 (2.1–2.4)
  performance: null, // la Tab. 4 (handicap A–F) del 2026 non è implementata
  labels: {
    s2DocTitle: '2. FINAL COST ANALYSIS – tables',
    costBasis: 'unit costs from the official Standardized Costs.',
  },

  // Categorie della sezione 2.2 del template S2 (una tabella per categoria).
  components: [
    { id: 'hull', en: 'Hull', it: 'Scafo' },
    { id: 'foils', en: 'Foils', it: 'Foil' },
    { id: 'mechanical_control', en: 'Mechanical Control System', it: 'Controllo meccanico' },
    { id: 'gantry', en: 'Gantry', it: 'Gantry' },
    { id: 'wingbars', en: 'Wingbars', it: 'Terrazze' },
    { id: 'rig', en: 'Rig', it: 'Rig' },
    { id: 'electronics', en: 'Electronics', it: 'Elettronica' },
  ],

  // §3.3.B e §3.3.A: provenienza del materiale -> moltiplicatore sul prezzo.
  sources: {
    new: { factor: 1, it: 'Nuovo', en: null },
    industrial_excess: {
      factor: 0.75, it: 'Eccedenza industriale −25%', en: 'Industrial Excess',
      footnote: 'Material sourced from industrial excess: 25% reduction under Section 3.3.B of the Rules',
    },
    out_of_shelf_life: {
      factor: 0.5, it: 'Fuori shelf-life −50%', en: 'OOSL',
      footnote: 'Out-of-shelf-life material: 50% reduction under Section 3.3.B of the Rules',
    },
    upcycled: {
      factor: 0, it: 'Upcycled −100%', en: 'upcycled',
      footnote: 'Upcycled element (Sections 3.3.A and 3.3.B of the Rules): 0 SM$. Origin and transformation must be itemised',
    },
  },

  // Tab. 2 – limiti di carbonio in kg per componente.
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

  // Tab. 3 – parti usate (non UFLP): costo SM$ fisso e punti di handicap per anno di produzione.
  // Punti negativi = riduzione. Per i foil, dagli anni di partecipazione successivi la riduzione raddoppia (§3.4.A).
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
  /** Colonna della Tab. 3 per un anno di produzione: Pre 2015, 2015, 2016, 2017, Post 2017. */
  usedPartYearIndex(year) {
    if (year < 2015) return 0;
    if (year > 2017) return 4;
    return year - 2014;
  },

  // Gruppi del mass breakdown as-built richiesto al §2.5.
  massGroups: [
    { id: 'hull', en: 'Hull' }, { id: 'wings', en: 'Wings' },
    { id: 'horizontal_foils', en: 'Horizontal foils' }, { id: 'vertical_foils', en: 'Vertical foils' },
    { id: 'other', en: 'Other' },
  ],
};

// Densità (g/cm³) dei materiali che il Layup Calculator ufficiale NON prevede.
// Servono solo per le stime interne: nel file ufficiale questi materiali non si possono inserire.
export const EXTRA_DENSITIES = {
  aramid: 1.44,
  innegra: 0.84,
  diolen: 1.38,
  polyester: 1.2,
  vinylester: 1.1,
};

/**
 * Collega una voce del listino al materiale del Layup Calculator.
 * Ritorna {calc: nome nel calcolatore | null, density?, carbon: bool}.
 */
export function layupMaterialFor(entry) {
  // group/type per le voci del listino ufficiale, name per quelle aggiunte dal team
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
