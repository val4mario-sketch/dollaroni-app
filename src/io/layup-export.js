// Export nel template ufficiale "SMC Composite Layup Calculator": UN FILE PER PEZZO.
//
// Si parte da una copia del file ufficiale e si modificano solo:
//   - le celle di input (nome parte, rinforzo, matrice, area, n. ply, grammatura, processo)
//   - i valori in cache delle formule (così il file mostra i numeri giusti anche in anteprima)
// Formule, menu a tendina, stili e foglio nascosto restano quelli dell'organizzazione;
// all'apertura Excel/Google Sheets/LibreOffice ricalcolano tutto (fullCalcOnLoad).
// I substack non usati vengono azzerati e le loro righe nascoste, come nell'Appendice G del 2026.

import { openXlsx, parseXml, NS, splitRef } from './xlsx.js';
import { computePart } from '../engine/layup.js';

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Divide una parte in blocchi da `max` substack (il template ne ha 5). */
export function chunkPart(part, max = 5) {
  const subs = part.substacks || [];
  const count = Math.max(1, Math.ceil(subs.length / max));
  return Array.from({ length: count }, (_, i) => ({
    part, index: i, count,
    substacks: subs.slice(i * max, (i + 1) * max),
    title: count > 1 ? `${part.name} (${i + 1}/${count})` : part.name,
  }));
}

const num = (n) => String(Number(Number(n).toPrecision(15)));

function serialize(doc) {
  const s = new XMLSerializer().serializeToString(doc);
  return s.startsWith('<?xml') ? s : XML_DECL + s;
}

/**
 * Crea il file xlsx per un blocco di una parte.
 * Ritorna Uint8Array. Lancia un errore se il pezzo usa materiali assenti dal calcolatore.
 */
export async function exportLayupChunk(templateBytes, spec, catalog, chunk, JSZipLib) {
  const L = spec.layout;
  const result = computePart(spec, catalog, { ...chunk.part, substacks: chunk.substacks });
  if (result.errors.length) throw new Error(`${chunk.title}: ${result.errors.join('; ')}`);
  const outside = result.substacks.filter((r) => !r.inCalculator);
  if (outside.length) {
    const names = [...new Set(outside.flatMap((r) => [r.reinforcement, r.matrix].filter((m) => !m.calc).map((m) => m.entry.name)))];
    throw new Error(`${chunk.title}: ${names.join(', ')} non esiste nel Layup Calculator ufficiale`);
  }
  if (!result.substacks.length || result.totals.composite <= 0) throw new Error(`${chunk.title}: nessun materiale da esportare`);

  const x = await openXlsx(templateBytes, JSZipLib);
  const sheet = x.sheets.find((s) => s.name === L.sheet);
  const doc = parseXml(await x.zip.file(sheet.path).async('string'));

  const cells = new Map();
  for (const c of doc.getElementsByTagNameNS(NS, 'c')) cells.set(c.getAttribute('r'), c);
  const rows = new Map();
  for (const r of doc.getElementsByTagNameNS(NS, 'row')) rows.set(Number(r.getAttribute('r')), r);

  const cell = (ref) => {
    let c = cells.get(ref);
    if (c) return c;
    const { col, row } = splitRef(ref);
    const rowEl = rows.get(row);
    if (!rowEl) throw new Error(`Riga ${row} assente nel template`);
    c = doc.createElementNS(NS, 'c');
    c.setAttribute('r', ref);
    const after = [...rowEl.getElementsByTagNameNS(NS, 'c')].find((o) => splitRef(o.getAttribute('r')).col > col);
    rowEl.insertBefore(c, after || null);
    cells.set(ref, c);
    return c;
  };
  const clearValue = (c) => {
    for (const ch of [...c.childNodes]) if (ch.localName !== 'f') c.removeChild(ch);
  };
  const setNumber = (ref, n) => {
    const c = cell(ref);
    c.removeAttribute('t');
    clearValue(c);
    const v = doc.createElementNS(NS, 'v');
    v.textContent = num(n);
    c.appendChild(v);
  };
  const setString = (ref, text) => {
    const c = cell(ref);
    for (const ch of [...c.childNodes]) c.removeChild(ch);
    const idx = x.shared.indexOf(text);
    if (idx >= 0) {
      c.setAttribute('t', 's');
      const v = doc.createElementNS(NS, 'v');
      v.textContent = String(idx);
      c.appendChild(v);
    } else {
      c.setAttribute('t', 'inlineStr');
      const is = doc.createElementNS(NS, 'is');
      const t = doc.createElementNS(NS, 't');
      t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
      t.textContent = text;
      is.appendChild(t);
      c.appendChild(is);
    }
  };

  setString(L.partNameCell, chunk.title.toUpperCase());

  const total = result.totals.composite;
  const first = result.substacks[0];
  L.substackRows.forEach((r, i) => {
    const res = result.substacks[i];
    const used = Boolean(res);
    const s = res || first; // substack vuoto: stessi materiali del primo, area e ply a zero
    const fibre = used ? res.fibre : 0;
    const resin = used ? res.resin : 0;

    setString(`B${r}`, s.reinforcement.calc.exact);
    setString(`B${r + 1}`, s.matrix.calc.exact);
    setNumber(`E${r}`, used ? Number(s.input.plyArea) : 0);
    setNumber(`F${r}`, used ? Number(s.input.plies) : 0);
    setNumber(`G${r}`, Number(s.input.arealWeight));
    setString(`H${r}`, s.process.exact);

    // valori in cache delle formule
    setNumber(`C${r}`, s.reinforcement.density);
    setNumber(`C${r + 1}`, s.matrix.density);
    setNumber(`I${r}`, s.vf);
    setNumber(`J${r}`, s.wf);
    setNumber(`J${r + 1}`, 1 - s.wf);
    setNumber(`K${r}`, fibre);
    setNumber(`K${r + 1}`, resin);
    setNumber(`L${r}`, fibre / total);
    setNumber(`L${r + 1}`, resin / total);
    setNumber(`M${r}`, (fibre + resin) / total);

    const hide = !used;
    for (const rr of [r, r + 1, r + 2]) {
      const rowEl = rows.get(rr);
      if (!rowEl) continue;
      if (hide) rowEl.setAttribute('hidden', '1');
      else rowEl.removeAttribute('hidden');
    }
  });

  const T = L.totals;
  setNumber(T.composite, total);
  setNumber(T.shareSum, 1);
  setNumber(T.fibres, result.totals.fibres);
  setNumber(T.fibresPct, result.totals.fibresPct);
  setNumber(T.resin, result.totals.resin);
  setNumber(T.resinPct, result.totals.resinPct);

  x.zip.file(sheet.path, serialize(doc));

  // Ricalcolo completo all'apertura.
  const wb = await x.read('xl/workbook.xml');
  let calcPr = wb.getElementsByTagNameNS(NS, 'calcPr')[0];
  if (!calcPr) {
    calcPr = wb.createElementNS(NS, 'calcPr');
    wb.documentElement.appendChild(calcPr);
  }
  calcPr.setAttribute('fullCalcOnLoad', '1');
  x.zip.file('xl/workbook.xml', serialize(wb));

  return {
    bytes: await x.zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }),
    result,
  };
}

export function layupFileName(prefix, chunk) {
  const safe = chunk.title.replace(/[\\/:*?"<>|]+/g, '-');
  return `${prefix} - Layup - ${safe}.xlsx`;
}

/** Esporta tutte le parti laminate: [{fileName, bytes, chunk, error}] (un file per pezzo). */
export async function exportAllLayups(templateBytes, spec, catalog, parts, prefix, JSZipLib) {
  const out = [];
  for (const part of parts) {
    for (const chunk of chunkPart(part)) {
      const fileName = layupFileName(prefix, chunk);
      try {
        const { bytes, result } = await exportLayupChunk(templateBytes, spec, catalog, chunk, JSZipLib);
        out.push({ fileName, bytes, chunk, result, error: null });
      } catch (e) {
        out.push({ fileName, bytes: null, chunk, result: null, error: e.message });
      }
    }
  }
  return out;
}
