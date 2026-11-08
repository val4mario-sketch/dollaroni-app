// Minimal reading of .xlsx (Office Open XML) files in the browser.
// Used to import the official SuMoth files (cost price list, Layup Calculator)
// without depending on heavy libraries: JSZip for the zip, DOMParser for the XML.

export const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function jszip(lib) {
  const z = lib || globalThis.JSZip;
  if (!z) throw new Error('JSZip not loaded (vendor/jszip.min.js)');
  return z;
}

export function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) throw new Error('Invalid XML: ' + err.textContent.slice(0, 200));
  return doc;
}

/** Converts "B12" to {col: 2, row: 12}. */
export function splitRef(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) throw new Error('Invalid cell reference: ' + ref);
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col, row: Number(m[2]) };
}

export function colLetter(col) {
  let s = '';
  while (col > 0) {
    const r = (col - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    col = Math.floor((col - 1) / 26);
  }
  return s;
}

/**
 * Opens an xlsx. Returns the zip object (for any changes), the sheet list
 * and a function to read the cells of a sheet.
 */
export async function openXlsx(data, JSZipLib) {
  const zip = await jszip(JSZipLib).loadAsync(data);
  const read = async (path) => {
    const f = zip.file(path);
    if (!f) throw new Error('Part missing in the xlsx file: ' + path);
    return parseXml(await f.async('string'));
  };

  const wb = await read('xl/workbook.xml');
  const rels = await read('xl/_rels/workbook.xml.rels');
  const targets = {};
  for (const r of rels.getElementsByTagName('Relationship')) {
    targets[r.getAttribute('Id')] = r.getAttribute('Target');
  }
  const sheets = [...wb.getElementsByTagNameNS(NS, 'sheet')].map((s) => {
    const target = targets[s.getAttributeNS(NS_REL, 'id')];
    const path = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
    return { name: s.getAttribute('name'), state: s.getAttribute('state') || 'visible', path };
  });

  let shared = [];
  if (zip.file('xl/sharedStrings.xml')) {
    const sst = await read('xl/sharedStrings.xml');
    shared = [...sst.getElementsByTagNameNS(NS, 'si')].map((si) =>
      [...si.getElementsByTagNameNS(NS, 't')].map((t) => t.textContent).join('')
    );
  }

  /** Cells of the sheet as a Map "A1" -> {value, formula}. */
  async function cells(sheetName) {
    const sheet = sheets.find((s) => s.name === sheetName);
    if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);
    const doc = await read(sheet.path);
    const out = new Map();
    for (const c of doc.getElementsByTagNameNS(NS, 'c')) {
      const ref = c.getAttribute('r');
      const t = c.getAttribute('t');
      const v = c.getElementsByTagNameNS(NS, 'v')[0]?.textContent;
      const f = c.getElementsByTagNameNS(NS, 'f')[0];
      let value = null;
      if (t === 's') value = shared[Number(v)];
      else if (t === 'inlineStr') value = [...c.getElementsByTagNameNS(NS, 't')].map((x) => x.textContent).join('');
      else if (t === 'str') value = v ?? null;
      else if (t === 'b') value = v === '1';
      else if (t === 'e') value = v ?? null;
      else if (v !== undefined && v !== '') value = Number(v);
      if (value === null && !f) continue;
      out.set(ref, { value, formula: f ? f.textContent : null });
    }
    return out;
  }

  return { zip, sheets, shared, cells, read };
}

/** Rows of a sheet as an array of arrays (columns from 1), handy for tables. */
export function toRows(cellMap) {
  const rows = [];
  for (const [ref, cell] of cellMap) {
    const { col, row } = splitRef(ref);
    (rows[row] ||= [])[col] = cell.value;
  }
  return rows;
}
