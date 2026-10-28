// Disegna la tabella di un pezzo nello stile del Layup Calculator ufficiale (come gli screenshot
// dell'Appendice G del report S1). Serve per l'anteprima nell'app e per le immagini PNG dell'appendice.
// Solo elementi SVG semplici (niente foreignObject), così la conversione in PNG funziona ovunque.

const COLS = [
  { key: 'sub', w: 72, title: ['Substacks'] },
  { key: 'mat', w: 150, title: ['REINFORCEMENT', 'MATRIX'] },
  { key: 'den', w: 48, title: ['Density'] },
  { key: 'denu', w: 44, title: [''] },
  { key: 'area', w: 72, title: ['Ply area', 'SQM'] },
  { key: 'plies', w: 62, title: ['Num. of', 'plies'] },
  { key: 'gsm', w: 80, title: ['Area Weight', 'g/sqm'] },
  { key: 'proc', w: 140, title: ['PROCESS'] },
  { key: 'vf', w: 70, title: ['FIBER', 'Vol. Fract'] },
  { key: 'wf', w: 84, title: ['WEIGHT', 'FRACTION'] },
  { key: 'mass', w: 72, title: ['Mass (g)'] },
  { key: 'tot', w: 92, title: ['TOTAL', 'PER ELEMENT'] },
  { key: 'pct', w: 60, title: ['TOTAL', '%'] },
];
const ROW = 18;
const SEP = 12;
const C = { title: '#3c78d8', titleName: '#6d9eeb', name: '#ffff00', input: '#ffff00', out: '#fce5cd', sep: '#666666', line: '#999999', text: '#000000', white: '#ffffff' };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const int = (x) => Math.round(x).toLocaleString('en-US');
const pct = (x, d = 0) => `${(x * 100).toFixed(d)}%`;
const plain = (x) => String(Number(Number(x).toPrecision(12)));

/**
 * result: output di computePart per il blocco (max 5 substack); title: nome del pezzo.
 * Ritorna {svg, width, height}.
 */
export function layupTableSvg(result, title) {
  const width = COLS.reduce((a, c) => a + c.w, 0);
  const x0 = [];
  COLS.reduce((x, c, i) => ((x0[i] = x), x + c.w), 0);
  const col = (key) => COLS.findIndex((c) => c.key === key);
  const parts = [];
  const rect = (x, y, w, h, fill, stroke = C.line) =>
    parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="0.6"/>`);
  const text = (x, y, s, { size = 11, weight = 400, anchor = 'middle', fill = C.text } = {}) =>
    parts.push(`<text x="${x}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" fill="${fill}">${esc(s)}</text>`);
  // opts.fill è lo sfondo della cella; il testo resta nero (opts.color per cambiarlo)
  const cell = (key, y, h, s, { fill = C.white, color, ...opts } = {}) => {
    const i = col(key);
    rect(x0[i], y, COLS[i].w, h, fill);
    if (s !== '' && s !== null && s !== undefined) text(x0[i] + COLS[i].w / 2, y + h / 2 + 4, s, { ...opts, fill: color || C.text });
  };

  let y = 0;
  // Barra del titolo come nel foglio: "PART NAME:" + nome
  const labelW = x0[col('den')];
  rect(0, y, width, 10, C.text, C.text);
  y += 10;
  rect(0, y, labelW, 34, C.title);
  text(labelW / 2, y + 23, 'PART NAME:', { size: 18, weight: 700 });
  rect(labelW, y, width - labelW, 34, C.titleName);
  text(labelW + 14, y + 24, title.toUpperCase(), { size: 20, weight: 700, anchor: 'start', fill: C.name });
  y += 34;
  rect(0, y, width, 10, C.text, C.text);
  y += 10;

  // Intestazioni
  COLS.forEach((c, i) => {
    rect(x0[i], y, c.w, ROW * 2, C.white);
    const lines = c.title.filter(Boolean);
    lines.forEach((t, k) => text(x0[i] + c.w / 2, y + (lines.length === 1 ? ROW + 4 : 14 + k * 16), t, { size: 10.5, weight: 700 }));
  });
  y += ROW * 2;

  const total = result.totals.composite;
  result.substacks.forEach((r, i) => {
    const s = r.input;
    const yA = y;
    const yB = y + ROW;
    cell('sub', yA, ROW * 2, 'ABCDE'[i] || String(i + 1), { size: 14, weight: 700 });
    cell('mat', yA, ROW, r.reinforcement.calc?.exact ?? r.reinforcement.entry?.name, { size: 10, weight: 700 });
    cell('mat', yB, ROW, r.matrix.calc?.exact ?? r.matrix.entry?.name, { size: 10, weight: 700 });
    cell('den', yA, ROW, plain(r.reinforcement.density), { size: 10.5 });
    cell('den', yB, ROW, plain(r.matrix.density), { size: 10.5 });
    cell('denu', yA, ROW, 'g/cm3', { size: 10.5 });
    cell('denu', yB, ROW, 'g/cm3', { size: 10.5 });
    cell('area', yA, ROW, plain(s.plyArea), { fill: C.input });
    cell('plies', yA, ROW, plain(s.plies), { fill: C.input });
    cell('gsm', yA, ROW, plain(s.arealWeight), { fill: C.input });
    for (const k of ['area', 'plies', 'gsm']) cell(k, yB, ROW, '', { fill: C.sep });
    cell('proc', yA, ROW * 2, r.process.exact.trim(), { size: 10 });
    cell('vf', yA, ROW * 2, pct(r.vf), { size: 13, weight: 700 });
    cell('wf', yA, ROW, pct(r.wf, 1), { fill: C.out });
    cell('wf', yB, ROW, pct(1 - r.wf, 1));
    cell('mass', yA, ROW, int(r.fibre), { fill: C.out });
    cell('mass', yB, ROW, int(r.resin), { fill: C.out, weight: 700 });
    cell('tot', yA, ROW, pct(total ? r.fibre / total : 0));
    cell('tot', yB, ROW, pct(total ? r.resin / total : 0));
    cell('pct', yA, ROW * 2, pct(total ? r.total / total : 0), { size: 12, weight: 700 });
    y += ROW * 2;
    rect(0, y, width, SEP, C.sep, C.sep);
    y += SEP;
  });

  // Blocco totali
  const labelX = x0[col('vf')]; // etichette su due colonne, altrimenti "Total Composite (g)" non ci sta
  const labelWidth = COLS[col('vf')].w + COLS[col('wf')].w;
  const t = result.totals;
  const totals = [
    ['Total Composite (g)', int(t.composite), 'g', true],
    ['Total Fibers (g)', int(t.fibres), 'g'],
    ['Total Fibers (%)', pct(t.fibresPct, 2), ''],
    ['Total Resin (g)', int(t.resin), 'g'],
    ['Total Resin (%)', pct(t.resinPct, 2), ''],
  ];
  const blockTop = y;
  totals.forEach(([label, value, unit, bold], k) => {
    const yy = y + k * ROW;
    rect(labelX, yy, labelWidth, ROW, C.out);
    text(labelX + labelWidth - 4, yy + ROW / 2 + 4, label, { size: 10, anchor: 'end', weight: bold ? 700 : 400 });
    cell('mass', yy, ROW, value, { fill: C.out, weight: bold ? 700 : 400 });
    cell('tot', yy, ROW, unit, { fill: C.out });
    cell('pct', yy, ROW, bold ? '100%' : '', { weight: 700 });
  });
  rect(0, blockTop, labelX, totals.length * ROW, C.sep, C.sep);
  y += totals.length * ROW;

  const height = Math.ceil(y + 1);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#ffffff"/>${parts.join('')}</svg>`;
  return { svg, width, height };
}

/** Converte un SVG in PNG (Uint8Array) a `scale` volte la risoluzione. */
export async function svgToPng({ svg, width, height }, scale = 2) {
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height };
}
