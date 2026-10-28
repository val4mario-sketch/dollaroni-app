// Regole del 2027 SMC Competition Rulebook, release 1.0 del 7 settembre 2026.
//
// Cosa cambia rispetto al 2026 (verificato sul PDF il 28/09/2026):
//  - budget 10.000 SM$ "da tenere sotto" (§10.1.2); sforarlo costa 500 punti (§10.1.3);
//  - Tab. 2 (limiti di carbonio) identica al 2026, "Wingbars" si chiama "Hiking racks";
//  - il listino non è più un file pubblico: costi e calcolo stanno sulla SuMoth Agora Platform (§10.1.1),
//    aperta solo ai team ammessi. Finché non la vediamo si usano listino e Layup Calculator 2026 (provvisori);
//  - gli sconti di provenienza del §3.3.B 2026 non sono più citati: restano attivi ma "da confermare";
//  - la vecchia Tab. 3 (parti usate a costo fisso + handicap per anno) non c'è più: una parte usata
//    si paga come una voce normale. Al suo posto c'è la nuova Tab. 3 "SuMoth Performance Points" (§11);
//  - il mass breakdown as-built del §2.5 2026 non è più richiesto;
//  - in S2 vanno tracciati anche gli scarti di materiale (§9.2.2);
//  - uno scafo upcycled è ammesso solo se in origine era di un'imbarcazione non foiling (§6.2.1).

import { RULES_2026 } from './rules-2026.js';

const rename = (list) => list.map((x) => (x.id === 'wingbars' ? { ...x, en: 'Hiking racks' } : x));
const AGORA = 'to be confirmed on the SuMoth Agora Platform';

// Tab. 3 2027: punti per le condizioni a)–g) della regola 11.1.3. null = N/A.
//                                   a     b     c    d    e     f     g
const PERF_ROWS = [
  ['hull_internal', 'Hull internal structure', 'Struttura interna scafo', [null, -25, 25, 25, -10, -25, null]],
  ['hull_shell', 'Hull shell', 'Guscio scafo', [null, null, 50, 50, -10, -50, null]],
  ['stern_fitting', 'Stern fitting', 'Attacco di poppa (stern fitting)', [null, -25, 25, 25, -10, -25, -100]],
  ['stem_fitting', 'Stem fitting', 'Attacco di prua (stem fitting)', [null, -25, 25, 25, -10, -25, -50]],
  ['mast_base', 'Mast base (king post)', "Base d'albero (king post)", [null, -25, 25, 25, -10, -25, -50]],
  ['hiking_rack_structure', 'Hiking rack structure', 'Struttura terrazze', [null, -25, 25, 25, -10, -25, -50]],
  ['hiking_rack_covers', 'Hiking rack covers', 'Coperture terrazze', [null, -25, 25, 25, -10, -10, -10]],
  ['main_vertical', 'Main vertical', 'Main vertical', [-150, -50, 50, 50, -25, -50, -100]],
  ['main_horizontal', 'Main horizontal', 'Main horizontal', [-100, -50, 0, 0, -25, -25, -100]],
  ['rudder_vertical', 'Rudder vertical', 'Rudder vertical', [-100, -25, 25, 25, -10, -25, -100]],
  ['rudder_horizontal', 'Rudder horizontal', 'Rudder horizontal', [-50, -25, 0, 0, -10, -25, -100]],
  ['sail', 'Sail', 'Vela', [-10, -10, 10, 10, -5, -10, -10]],
  ['mast', 'Mast', 'Albero', [-10, -10, 10, 10, -5, -10, -10]],
  ['boom', 'Boom', 'Boma', [-10, -10, 10, 10, -5, -10, -10]],
  ['spreader', 'Spreader', 'Crocette (spreader)', [-10, -10, 10, 10, -5, -10, -10]],
];

export const RULES_2027 = {
  id: '2027',
  title: '2027 SMC Competition Rulebook v1.0 (7 settembre 2026)',
  // Il listino 2027 sta su SuMoth Agora: intanto si usano i file 2026, segnati come provvisori.
  official: { ...RULES_2026.official, provisional: true },
  budget: 10000, // §10.1.2 "shall remain below 10,000 SM$"
  budgetStrict: true,
  budgetPenalty: 500, // §10.1.3
  refs: { budget: '§10.1', sources: '§3.3.B 2026', upcycled: '§3.3.A 2026', mass: null, usedParts: null },
  help: {
    notInCalculator: 'nel 2027 il calcolo si fa su SuMoth Agora: verificare lì come dichiararlo',
    priceSource: 'prezzo preso da SuMoth Agora o MSRP del fornitore',
    catalogExtras: 'Materiali e hardware che non sono nel listino, sempre con la fonte del prezzo. Nel 2027 i prezzi stanno su SuMoth Agora e i materiali nuovi si propongono lì, con evidenze scientifiche (§10.3).',
  },
  massBreakdownRequired: false,
  sourcesToConfirm: true,
  wasteTracking: true, // §9.2.2
  upcycledHullNonFoiling: true, // §6.2.1
  reportNumbering: false, // i template 2027 (su Moodle) non sono ancora noti
  labels: {
    s2DocTitle: 'MEASURED MANUFACTURING COST – supporting tables',
    costBasis: `unit costs from the 2026 Standardized Costs (provisional: the 2027 costs are defined on the SuMoth Agora Platform, Rule 10.1.1); provenance discounts of the 2026 Rules (Section 3.3.B) ${AGORA}.`,
  },

  // Categorie dei costi: le stesse 7 del template S2 2026, in attesa di vedere come le chiede Agora.
  components: rename(RULES_2026.components),

  // Sconti del §3.3.B 2026: il regolamento 2027 non li cita più. Restano, ma da confermare su Agora.
  sources: {
    new: { factor: 1, it: 'Nuovo', en: null },
    industrial_excess: {
      factor: 0.75, it: 'Eccedenza industriale −25%', en: 'Industrial Excess',
      footnote: `Material sourced from industrial excess: 25% reduction (2026 Rules, Section 3.3.B; ${AGORA})`,
    },
    out_of_shelf_life: {
      factor: 0.5, it: 'Fuori shelf-life −50%', en: 'OOSL',
      footnote: `Out-of-shelf-life material: 50% reduction (2026 Rules, Section 3.3.B; ${AGORA})`,
    },
    upcycled: {
      factor: 0, it: 'Upcycled −100%', en: 'upcycled',
      footnote: `Upcycled element: 0 SM$ (2026 Rules, Sections 3.3.A and 3.3.B; ${AGORA}). Origin and transformation itemised`,
    },
  },

  // Tab. 2 2027 – stessi valori del 2026.
  carbonGroups: rename(RULES_2026.carbonGroups),
  carbonLimits: {
    //                hull  racks MV     MH    RV    RH    gantry rig  other
    cfrp:            [3.00, 1.00, 1.50,  1.00, 1.50, 1.00, 1.00, 2.00, 1.00],
    cf:              [1.50, 0.50, 0.75,  0.50, 0.75, 0.50, 0.50, 1.00, 0.50],
    recycled_cfrp:   [4.50, 1.50, 2.25,  1.50, 2.25, 1.50, 1.50, 3.00, 1.50],
    recycled_cf:     [2.25, 0.75, 1.125, 0.75, 1.13, 0.75, 0.75, 1.50, 0.75],
    upcycled_cfrp:   [25.0, 5.00, 3.00,  1.00, 2.50, 1.00, 2.00, 1.00, 1.00],
  },

  // Parti usate: niente più costo fisso (cost: null). Si pagano al prezzo indicato nella voce.
  usedParts: Object.fromEntries(Object.entries(RULES_2026.usedParts).map(([id, d]) => [id, { en: d.en, kind: d.kind, cost: null }])),
  usedPartYearIndex: null,

  // Il mass breakdown non è più richiesto dal regolamento, ma resta utile (stesse righe del 2026).
  massGroups: RULES_2026.massGroups,

  // Tab. 3 "SuMoth Performance Points" (§11.1).
  performance: {
    conditions: [
      { id: 'a', it: 'Comprato, donato o ordinato senza coinvolgimento tecnico del team', en: 'Purchased, donated, or ordered with no technical Team involvement' },
      { id: 'b', it: 'Costruito da persone esterne al team', en: 'Manufactured by non-Team members' },
      { id: 'c', it: 'Costruito con materiali riciclati', en: 'Manufactured using recycled materials' },
      { id: 'd', it: 'Costruito con stampi o sotto-componenti upcycled o riciclati (gli stampi di edizioni precedenti non contano come upcycled; sono riciclati se fatti con materiali riciclati)', en: 'Manufactured using upcycled or recycled moulds or sub-components' },
      { id: 'e', it: 'Costruito dal team sotto supervisione tecnica diretta di un partner industriale', en: 'Manufactured by Team members under direct technical supervision of an industrial partner' },
      { id: 'f', it: 'Costruito con stampi fatti da persone esterne al team', en: 'Manufactured using moulds made by non-Team members' },
      { id: 'g', it: 'Progettato da persone esterne al team', en: 'Designed by non-Team members' },
    ],
    components: PERF_ROWS.map(([id, en, it, points]) => ({ id, en, it, points })),
    // §11.1.5: vele, alberi e foil commerciali prodotti dal 2017 in poi, −100 ciascuno salvo danni compromettenti.
    // §11.1.5.1: senza prove sufficienti (anno o danno) la penalità si applica.
    commercial: {
      elements: ['sail', 'mast', 'main_vertical', 'main_horizontal', 'rudder_vertical', 'rudder_horizontal'],
      fromYear: 2017,
      points: -100,
    },
  },
};
