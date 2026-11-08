// SuMoth Performance Rating (2027 rulebook, §11 and Table 3).
// For each component the points of the true conditions a)–g) add up; in addition sails, masts and foils
// commercially produced from 2017 onwards are worth −100 each, barring compromising damage (§11.1.5).
//
// In the project: project.performance.conditions = { <component id>: ['c', 'd', …] }
// Commercial parts are the items with usedPart (element, year, commercial, damaged).

export function performanceRating(project, rules) {
  const P = rules.performance;
  if (!P) return null;
  const declared = project.performance?.conditions || {};

  const components = P.components.map((c) => {
    const ticked = declared[c.id] || [];
    const conditions = P.conditions.map((cond, i) => ({
      id: cond.id, points: c.points[i], applicable: c.points[i] !== null,
      checked: c.points[i] !== null && ticked.includes(cond.id),
    }));
    const met = conditions.filter((x) => x.checked);
    return { id: c.id, en: c.en, it: c.it, conditions, met: met.map((x) => x.id), points: met.reduce((a, x) => a + x.points, 0) };
  });

  const C = P.commercial;
  const commercial = (project.lines || [])
    .filter((l) => l.usedPart && C.elements.includes(l.usedPart.element))
    .map((l) => {
      const u = l.usedPart;
      const year = typeof u.year === 'number' ? u.year : null;
      const isCommercial = u.commercial !== false;
      // without proof of the year of production the penalty applies (§11.1.5.1)
      const recent = year === null || year >= C.fromYear;
      const damaged = Boolean(u.damaged);
      return {
        lineId: l.id, name: l.name, element: u.element, year, commercial: isCommercial, damaged, recent,
        points: isCommercial && recent && !damaged ? C.points : 0,
      };
    });

  const componentsPoints = components.reduce((a, c) => a + c.points, 0);
  const commercialPoints = commercial.reduce((a, c) => a + c.points, 0);
  return {
    components, commercial, componentsPoints, commercialPoints,
    total: componentsPoints + commercialPoints,
    declaredCount: components.filter((c) => c.met.length).length,
  };
}
