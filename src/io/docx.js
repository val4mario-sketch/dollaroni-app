// Generatore minimale di file .docx (WordprocessingML), senza dipendenze oltre a JSZip.
// Pensato per essere importato in Google Docs: font Montserrat, A4, margini 2,5 cm,
// interlinea 1,15 come chiede il template SuMoth.
//
// blocks: [
//   {type: 'heading', text, level: 1|2},
//   {type: 'paragraph', text, italic?, size?},        // size in pt
//   {type: 'table', columns: [{title, width, align}], rows: [[...]], totalRow?: [...], size?},
//   {type: 'image', png: Uint8Array, width, height, maxWidthCm?},   // width/height in px
//   {type: 'pageBreak'}
// ]

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const TEXT_WIDTH_TWIPS = 9072; // 21 cm − 2 × 2,5 cm = 16 cm
const EMU_PER_CM = 360000;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function run(text, { bold = false, italic = false, size = 10, color = null } = {}) {
  const rPr = `<w:rPr><w:rFonts w:ascii="Montserrat" w:hAnsi="Montserrat" w:cs="Montserrat"/>${bold ? '<w:b/>' : ''}${italic ? '<w:i/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}<w:sz w:val="${Math.round(size * 2)}"/><w:szCs w:val="${Math.round(size * 2)}"/></w:rPr>`;
  return `<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

function para(content, { align = 'left', after = 120, keepNext = false, style = null } = {}) {
  const jc = align === 'left' ? '' : `<w:jc w:val="${align === 'right' ? 'right' : 'center'}"/>`;
  return `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${keepNext ? '<w:keepNext/>' : ''}<w:spacing w:before="0" w:after="${after}" w:line="276" w:lineRule="auto"/>${jc}</w:pPr>${content}</w:p>`;
}

function table(block) {
  const size = block.size ?? 8;
  const totalW = block.columns.reduce((a, c) => a + (c.width || 1), 0);
  const widths = block.columns.map((c) => Math.floor(((c.width || 1) / totalW) * TEXT_WIDTH_TWIPS));
  const border = '<w:top w:val="single" w:sz="4" w:color="999999"/><w:left w:val="single" w:sz="4" w:color="999999"/><w:bottom w:val="single" w:sz="4" w:color="999999"/><w:right w:val="single" w:sz="4" w:color="999999"/><w:insideH w:val="single" w:sz="4" w:color="999999"/><w:insideV w:val="single" w:sz="4" w:color="999999"/>';
  const headerSize = block.headerSize ?? size - 0.5;
  const tc = (content, i, { fill = null, bold = false, align = 'left', fontSize = size } = {}) =>
    `<w:tc><w:tcPr><w:tcW w:w="${widths[i]}" w:type="dxa"/>${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ''}<w:vAlign w:val="center"/></w:tcPr>${para(run(content, { bold, size: fontSize }), { align, after: 0 })}</w:tc>`;
  const header = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${block.columns.map((c, i) => tc(c.title, i, { fill: 'D9E2F3', bold: true, align: 'center', fontSize: headerSize })).join('')}</w:tr>`;
  const body = block.rows.map((r) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.map((v, i) => tc(v, i, { align: block.columns[i].align || 'left' })).join('')}</w:tr>`).join('');
  const total = block.totalRow ? `<w:tr>${block.totalRow.map((v, i) => tc(v, i, { fill: 'F2F2F2', bold: true, align: block.columns[i].align || 'left' })).join('')}</w:tr>` : '';
  return `<w:tbl><w:tblPr><w:tblW w:w="${TEXT_WIDTH_TWIPS}" w:type="dxa"/><w:tblBorders>${border}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="60" w:type="dxa"/><w:right w:w="60" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${header}${body}${total}</w:tbl>${para('', { after: 120 })}`;
}

function image(block, relId, n) {
  const maxCm = block.maxWidthCm ?? 16;
  const wCm = Math.min(maxCm, block.width / 96 * 2.54 / (block.scale || 1));
  const cx = Math.round(wCm * EMU_PER_CM);
  const cy = Math.round(cx * (block.height / block.width));
  return para(`<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Picture ${n}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="image${n}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`, { after: 200 });
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W_NS}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Montserrat" w:hAnsi="Montserrat" w:cs="Montserrat" w:eastAsia="Montserrat"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="1F6FAF"/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:color w:val="1F6FAF"/><w:sz w:val="24"/></w:rPr></w:style>
</w:styles>`;

export async function buildDocx(blocks, JSZipLib = globalThis.JSZip) {
  const zip = new JSZipLib();
  const rels = [`<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`];
  let imgN = 0;
  const body = blocks.map((b) => {
    switch (b.type) {
      case 'heading': {
        const size = b.level === 1 ? 14 : 12;
        return para(run(b.text, { bold: b.level === 1, size, color: '1F6FAF' }), { style: b.level === 1 ? 'Heading1' : 'Heading2', keepNext: true, after: 120 });
      }
      case 'paragraph':
        return para(run(b.text, { italic: b.italic, size: b.size ?? 10, bold: b.bold }), { keepNext: b.keepNext });
      case 'table':
        return table(b);
      case 'image': {
        imgN += 1;
        const id = `rIdImg${imgN}`;
        zip.file(`word/media/image${imgN}.png`, b.png);
        rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${imgN}.png"/>`);
        return image(b, id, imgN);
      }
      case 'pageBreak':
        return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      default:
        throw new Error('Blocco docx sconosciuto: ' + b.type);
    }
  }).join('');

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('word/document.xml', document);
  zip.file('word/styles.xml', STYLES);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/** Tabella HTML con stile in linea: incollata in Google Docs mantiene bordi e font. */
export function tableHtml({ caption, columns, rows, totalRow, size = 8 }) {
  const td = (v, c, extra = '') => `<td style="border:1px solid #999;padding:2px 4px;font-family:Montserrat,Arial,sans-serif;font-size:${size}pt;text-align:${c.align || 'left'};${extra}">${esc(v)}</td>`;
  const th = columns.map((c) => `<th style="border:1px solid #999;padding:2px 4px;background:#d9e2f3;font-family:Montserrat,Arial,sans-serif;font-size:${size}pt;text-align:center">${esc(c.title)}</th>`).join('');
  const body = rows.map((r) => `<tr>${r.map((v, i) => td(v, columns[i])).join('')}</tr>`).join('');
  const tot = totalRow ? `<tr>${totalRow.map((v, i) => td(v, columns[i], 'background:#f2f2f2;font-weight:bold')).join('')}</tr>` : '';
  const cap = caption ? `<p style="font-family:Montserrat,Arial,sans-serif;font-size:10pt;font-style:italic">${esc(caption)}</p>` : '';
  return `${cap}<table style="border-collapse:collapse">${`<tr>${th}</tr>`}${body}${tot}</table>`;
}
