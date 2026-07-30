// Lee el .xlsx de coberturas subido directamente en el form trigger (nodo A1)
// y reconstruye la MISMA forma de datos que hoy produce la API de Google
// Sheets (spreadsheets.get?includeGridData=true para "Coberturas por
// modalidad", nodo Google Sheets tabular para "Coberturas opcionales") --
// para que "Clean covers and modalities" / "Clean Optional Covers" (y todo lo
// que depende de rich_text_block_parser.js, negrita incluida) no necesiten
// ningun cambio. Sustituye a pegar la URL del Google Sheet + 2 llamadas HTTP
// (ver hilo 29/07: comodidad de subir el Excel tal cual entrega la compania).
//
// Requiere exceljs (lectura real de negrita por segmento, cell.value.richText)
// -- SheetJS/xlsx (Community Edition), la libreria que ya usa el nodo nativo
// "Extract from File" de n8n, descarta el formato al leer, asi que no sirve
// aqui. exceljs necesita NODE_FUNCTION_ALLOW_EXTERNAL=exceljs,jszip en el
// entorno de n8n (Code node) -- ver docker-compose.yml.
const ExcelJS = require("exceljs");
const JSZip = require("jszip");

// Bug real diagnosticado (29/07): un .xlsx exportado por una herramienta que
// no es Microsoft Excel (confirmado con el Excel real de Allianz, generado
// via Google Sheets/LibreOffice al aplicar el prompt de adaptacion) puede
// guardar los comentarios de celda con una estructura que exceljs no
// reconoce -- "xl/comments/commentN.xml" (subcarpeta) en vez de
// "xl/commentsN.xml" (plano, convencion de Microsoft que exceljs exige via
// regex al leer), mismo problema para "xl/drawings/commentsDrawingN.vml" en
// vez de "xl/drawings/vmlDrawingN.vml". El resultado es que exceljs revienta
// (TypeError: Cannot read properties of undefined (reading 'comments')) al
// reconciliar las relaciones del sheet. Aqui se renombran esas entradas del
// zip (y se corrigen los "Target" de sus relationships, que ademas pueden
// venir en formato absoluto "/xl/..." en vez de relativo "../...") ANTES de
// que exceljs lea el fichero -- el .xlsx original en disco no se toca, solo
// esta copia en memoria usada para el parseo automatico. Los comentarios
// documentan cosas para el humano que prepara el Excel (ver
// prompts/excel_coverage_sheet_builder.md); el pipeline nunca los lee como
// dato, asi que da igual si su contenido no se reconstruye perfectamente --
// lo unico que importa es que su sola presencia no rompa la lectura.
async function normalizeNonStandardOoxmlZip(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files);
  let changed = false;

  for (const name of names) {
    const m = name.match(/^xl\/comments\/comment(\d+)\.xml$/);
    if (m) {
      zip.file(`xl/comments${m[1]}.xml`, await zip.files[name].async("string"));
      zip.remove(name);
      changed = true;
    }
  }
  for (const name of names) {
    const m = name.match(/^xl\/drawings\/commentsDrawing(\d+)\.vml$/);
    if (m) {
      zip.file(`xl/drawings/vmlDrawing${m[1]}.vml`, await zip.files[name].async("string"));
      zip.remove(name);
      changed = true;
    }
  }
  if (!changed) return buffer;

  const relsNames = Object.keys(zip.files).filter(n => /worksheets\/_rels\/.*\.rels$/.test(n));
  for (const rn of relsNames) {
    const xml = await zip.files[rn].async("string");
    const fixed = xml
      .replace(/Target="\/?xl\/comments\/comment(\d+)\.xml"/g, 'Target="../comments$1.xml"')
      .replace(/Target="\/?xl\/drawings\/commentsDrawing(\d+)\.vml"/g, 'Target="../drawings/vmlDrawing$1.vml"');
    zip.file(rn, fixed);
  }

  return zip.generateAsync({ type: "nodebuffer" });
}

// Convierte una celda de exceljs a la misma forma que consume
// rich_text_block_parser.js: {formattedValue, textFormatRuns, effectiveFormat}
// (ver esa cabecera para el contrato completo). Igual que Google Sheets,
// textFormatRuns solo se genera cuando la celda tiene de verdad varios runs
// (negrita a mitad de celda); una celda de un unico estilo se representa solo
// con effectiveFormat.textFormat.bold -- buildIsBoldAt ya sabe interpretar
// ambos casos exactamente igual.
function cellToGoogleLikeCell(cell) {
  const value = cell.value;
  const isRichText = value && typeof value === "object" && Array.isArray(value.richText);

  if (isRichText) {
    let cursor = 0;
    const textFormatRuns = value.richText.map(run => {
      const startIndex = cursor;
      cursor += (run.text || "").length;
      return { startIndex, format: { bold: !!(run.font && run.font.bold) } };
    });
    return {
      formattedValue: value.richText.map(run => run.text || "").join(""),
      textFormatRuns,
      effectiveFormat: { textFormat: { bold: !!(cell.font && cell.font.bold) } }
    };
  }

  return {
    formattedValue: cell.text != null ? String(cell.text) : "",
    effectiveFormat: { textFormat: { bold: !!(cell.font && cell.font.bold) } }
  };
}

// Reconstruye la forma exacta que hoy devuelve
// spreadsheets.get?includeGridData=true (ver "Covers by modality"):
// {sheets: [{data: [{rowData: [{values: [cell, ...]}, ...]}]}]}.
function buildModalityGrid(worksheet) {
  const rowData = [];
  for (let r = 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const values = [];
    for (let c = 1; c <= worksheet.columnCount; c++) {
      values.push(cellToGoogleLikeCell(row.getCell(c)));
    }
    rowData.push({ values });
  }
  return { sheets: [{ data: [{ rowData }] }] };
}

// Reconstruye la forma tabular que hoy devuelve el nodo Google Sheets para
// "Coberturas opcionales" (fila 1 = cabecera, cada fila siguiente -> objeto
// {cabecera: texto}) -- "Clean Optional Covers" ya opera sobre esa forma
// (row["EPÍGRAFE EN EL QUE SE DEBE INCLUIR"], etc.), texto plano sin negrita.
function buildOptionalRows(worksheet) {
  if (!worksheet) return [];

  const headers = {};
  worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber] = (cell.text || "").trim();
  });

  const rows = [];
  for (let r = 2; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const obj = {};
    let hasAnyValue = false;
    for (const [colNumber, headerName] of Object.entries(headers)) {
      if (!headerName) continue;
      const text = row.getCell(Number(colNumber)).text || "";
      obj[headerName] = text;
      if (text.trim() !== "") hasAnyValue = true;
    }
    if (hasAnyValue) rows.push(obj);
  }
  return rows;
}

async function parseCoverageExcel(buffer, options) {
  const {
    modalitySheetName = "Coberturas por modalidad",
    optionalSheetName = "Coberturas opcionales"
  } = options || {};

  const fixedBuffer = await normalizeNonStandardOoxmlZip(buffer);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fixedBuffer);

  const modalitySheet = workbook.getWorksheet(modalitySheetName);
  if (!modalitySheet) {
    throw new Error(
      `No se encontro la hoja "${modalitySheetName}" en el Excel. Hojas disponibles: ${workbook.worksheets.map(s => s.name).join(", ")}`
    );
  }
  const optionalSheet = workbook.getWorksheet(optionalSheetName);

  return {
    rawModalityGrid: buildModalityGrid(modalitySheet),
    rawOptionalRows: buildOptionalRows(optionalSheet)
  };
}

module.exports = {
  parseCoverageExcel,
  normalizeNonStandardOoxmlZip,
  cellToGoogleLikeCell,
  buildModalityGrid,
  buildOptionalRows
};
