// Parser de bloques/lines a partir del texto enriquecido (negrita) de una
// celda real de "Coberturas por modalidad" (Google Sheets API,
// spreadsheets.get?includeGridData=true -> rowData[].values[].
// {formattedValue, textFormatRuns, effectiveFormat}).
//
// Motivo (revision manual del usuario, 22/07, cover_id 15/16/17/22 de
// Generali): el texto libre de una celda no es una lista plana de bullets --
// tiene una jerarquia real de bloque/linea que el troceo actual por "\n"
// (splitBulletsFromCellText en generator.js) no captura. La negrita marca
// SIEMPRE un segmento destacado dentro de la celda, pero su rol semantico
// varia por cobertura (confirmado con datos reales de las 4 coberturas
// citadas, ver evaluators/coverage_insert_generator/rich_text_block_parser_golden_dataset.json):
//   - cover 15 (RC): negrita = un VALOR suelto (Capital ...€), su propio
//     bloque; el cuerpo (sin negrita) mezcla lineas con "-" (nueva
//     sub-cobertura, ej. "-Responsabilidad Civil de la vivienda") y lineas
//     sin "-" (detalle de la sub-cobertura anterior, ej. "Como propietario").
//   - cover 16 (Robo) / 17 (Incendio): negrita = una ETIQUETA (titulo o
//     descripcion), el cuerpo es una lista plana SIN ningun "-" -- va todo
//     como lineas de un unico bloque encabezado por la negrita.
//   - cover 22 (Asistencia): negrita = etiqueta de bloque ("... incluida:"),
//     el cuerpo es una lista plana pero CON "-" en todas sus lineas (el "-"
//     aqui es solo marca de vineta, no separador de sub-bloque, porque
//     ninguna linea tiene a su vez lineas hijas mas indentadas debajo).
//
// Regla de deteccion (ver clasificarCuerpo): un cuerpo se considera MIXTO
// (mezcla lineas con y sin "-") solo cuando eso ocurre -- ahi cada linea con
// "-" abre un bloque nuevo (independiente de la negrita que la precede) y
// las lineas sin "-" que le siguen son su detalle. Un cuerpo UNIFORME (todo
// con "-" o nada con "-") se trata como una lista plana de lineas del bloque
// que encabeza la negrita -- el "-" ahi es solo viñeta, no jerarquia.
//
// Casos que esta regla no puede resolver de forma fiable (marcados
// needsReview en vez de adivinar):
//   - una negrita con mas de 1 linea (nunca visto en los datos reales).
//   - una etiqueta (negrita no-valor) seguida de un cuerpo MIXTO (nunca
//     visto -- en cover 15 el mixto aparece siempre bajo un VALOR, no una
//     etiqueta).
//   - una linea sin "-" que aparece antes de la primera linea con "-" dentro
//     de un cuerpo mixto (no tiene bloque al que asignarse).
//
// Deliberadamente NO resuelve aqui la ambiguedad "estas lineas planas, son
// la MISMA cobertura o varian por modalidad" (cover 16 vs. 17) -- eso ya lo
// resuelve, a nivel de BLOQUE (no de linea suelta), la logica de familias
// por contenido exacto entre modalidades de excel_fixture_builder.js
// (buildBlockGroupsForCover/buildBlockGroupsForHeterogeneousCover). Este
// modulo solo entrega el bloque candidato; la variacion entre modalidades se
// aplica despues.

const VALUE_HEADER_PATTERN = /^(capital|suma asegurada|l[íi]mite|importe)\b.*\d/i;

function buildIsBoldAt(textFormatRuns, fallbackBold) {
  if (!Array.isArray(textFormatRuns) || textFormatRuns.length === 0) {
    return () => !!fallbackBold;
  }
  const runs = textFormatRuns
    .map(r => ({ start: r.startIndex ?? 0, bold: !!(r.format && r.format.bold) }))
    .sort((a, b) => a.start - b.start);
  return function isBoldAt(idx) {
    let bold = false;
    for (const run of runs) {
      if (run.start <= idx) bold = run.bold;
      else break;
    }
    return bold;
  };
}

// Divide el texto completo en segmentos de negrita/no-negrita POR CARACTER
// (no por linea) -- la negrita puede terminar A MITAD de una linea fisica
// (bug real 22/07, covers 21 "Restauración Estética" y 104 "Otras
// garantías": "Restauración Estética Continente" en negrita seguido de " -
// 3.000€" sin negrita, ambos en la MISMA linea). Clasificar por linea
// completa (mirando solo su primer caracter, como hacia la version
// anterior) fusionaba estos casos con la linea siguiente en un unico bloque
// con los textos concatenados.
function buildCharSegments(text, isBoldAt) {
  const segments = [];
  if (!text) return segments;
  let start = 0;
  let currentBold = isBoldAt(0);
  for (let i = 1; i <= text.length; i++) {
    const bold = i < text.length ? isBoldAt(i) : !currentBold; // fuerza el flush final
    if (bold !== currentBold || i === text.length) {
      segments.push({ text: text.slice(start, i), bold: currentBold });
      start = i;
      currentBold = bold;
    }
  }
  return segments;
}

// Clasifica cada linea no vacia de la celda: texto recortado, si arranca por
// "-" y si es negrita. Cada segmento de negrita/no-negrita (ver
// buildCharSegments) se trocea a su vez por "\n" -- un segmento puede
// contener varias lineas completas (cabecera en negrita multilinea, ver
// needsReview en classifyBoldRun) o ser solo un FRAGMENTO de una linea (el
// resto de esa misma linea fisica sigue en el siguiente segmento, con
// negrita distinta); en ambos casos el resultado son fragmentos de texto en
// el orden real de la celda, cada uno con su propia negrita ya resuelta con
// precision de caracter -- no hace falta ninguna heuristica adicional para
// el caso de espacios sobrantes antes de un "\n" (el propio split ya deja
// ese fragmento vacio, descartado por el filtro de lineas en blanco).
function analyzeLines(formattedValue, textFormatRuns, effectiveFormatBold) {
  const isBoldAt = buildIsBoldAt(textFormatRuns, effectiveFormatBold);
  const segments = buildCharSegments(formattedValue || "", isBoldAt);

  const result = [];
  for (const segment of segments) {
    for (const raw of segment.text.split("\n")) {
      const trimmed = raw.trim();
      if (trimmed.length === 0) continue;
      result.push({ text: trimmed, isDash: /^-/.test(trimmed), bold: segment.bold });
    }
  }
  return result;
}

// Agrupa lineas consecutivas con la misma negrita en "runs" (secuencia
// bold/no-bold, en el orden real de la celda).
function groupIntoRuns(lines) {
  const runs = [];
  for (const line of lines) {
    const last = runs[runs.length - 1];
    if (last && last.bold === line.bold) {
      last.lines.push(line);
    } else {
      runs.push({ bold: line.bold, lines: [line] });
    }
  }
  return runs;
}

function classifyBoldRun(run) {
  const text = run.lines.map(l => l.text).join(" ");
  return {
    text,
    kind: VALUE_HEADER_PATTERN.test(text) ? "value" : "label",
    needsReview: run.lines.length > 1,
    reviewReason: run.lines.length > 1 ? "bold_header_multiline" : null
  };
}

// Decide si un cuerpo (run sin negrita) es MIXTO (arranca sub-bloques por
// "-") o UNIFORME (lista plana, el "-" si aparece es solo vineta).
function splitBodyRun(run) {
  const hasDash = run.lines.some(l => l.isDash);
  const hasNonDash = run.lines.some(l => !l.isDash);
  const mixed = hasDash && hasNonDash;

  if (!mixed) {
    return { mode: "flat", lines: run.lines.map(l => l.text) };
  }

  const blocks = [];
  for (const line of run.lines) {
    if (line.isDash) {
      blocks.push({ headerText: line.text, lines: [] });
    } else if (blocks.length > 0) {
      blocks[blocks.length - 1].lines.push(line.text);
    } else {
      blocks.push({ headerText: null, lines: [line.text], needsReview: true, reviewReason: "line_before_first_dash_in_mixed_body" });
    }
  }
  return { mode: "dash-split", blocks };
}

function expandBodyAsSiblingBlocks(run) {
  const split = splitBodyRun(run);
  if (split.mode === "flat") {
    return [{ kind: "flat", headerText: null, lines: split.lines, needsReview: false, reviewReason: null }];
  }
  return split.blocks.map(b => ({
    kind: "dash",
    headerText: b.headerText,
    lines: b.lines,
    needsReview: !!b.needsReview,
    reviewReason: b.reviewReason || null
  }));
}

// Entrada principal. cell: {formattedValue, textFormatRuns, effectiveFormat}
// tal cual lo devuelve la API real de Google Sheets (ver cabecera).
// Salida: { blocks: [{kind, headerText, lines, needsReview, reviewReason}] }
// -- kind: "value" (bloque = un valor suelto, ej. capital), "label" (bloque
// encabezado por una etiqueta en negrita con su cuerpo como lineas), "dash"
// (sub-bloque abierto por una linea "-" dentro de un cuerpo mixto), "flat"
// (lista plana sin negrita ni jerarquia -- lineas sueltas de una unica
// entrada, sin cabecera propia).
function parseModalityCellBlocks(cell) {
  const effectiveBold = cell.effectiveFormat && cell.effectiveFormat.textFormat && cell.effectiveFormat.textFormat.bold;
  const lines = analyzeLines(cell.formattedValue, cell.textFormatRuns, effectiveBold);
  const runs = groupIntoRuns(lines);

  const blocks = [];
  let i = 0;
  while (i < runs.length) {
    const run = runs[i];

    if (!run.bold) {
      blocks.push(...expandBodyAsSiblingBlocks(run));
      i += 1;
      continue;
    }

    const boldInfo = classifyBoldRun(run);
    const bodyRun = runs[i + 1] && !runs[i + 1].bold ? runs[i + 1] : null;

    if (boldInfo.kind === "value") {
      blocks.push({ kind: "value", headerText: boldInfo.text, lines: [], needsReview: boldInfo.needsReview, reviewReason: boldInfo.reviewReason });
      if (bodyRun) {
        blocks.push(...expandBodyAsSiblingBlocks(bodyRun));
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }

    if (!bodyRun) {
      blocks.push({ kind: "label", headerText: boldInfo.text, lines: [], needsReview: boldInfo.needsReview, reviewReason: boldInfo.reviewReason });
      i += 1;
      continue;
    }

    const split = splitBodyRun(bodyRun);
    if (split.mode === "flat") {
      blocks.push({ kind: "label", headerText: boldInfo.text, lines: split.lines, needsReview: boldInfo.needsReview, reviewReason: boldInfo.reviewReason });
    } else {
      blocks.push({ kind: "label", headerText: boldInfo.text, lines: [], needsReview: true, reviewReason: "mixed_body_under_label" });
      blocks.push(...split.blocks.map(b => ({
        kind: "dash",
        headerText: b.headerText,
        lines: b.lines,
        needsReview: !!b.needsReview,
        reviewReason: b.reviewReason || null
      })));
    }
    i += 2;
  }

  return { blocks };
}

// Lista ordenada de "segmentos" de texto de un bloque -- cabecera (si el
// kind la tiene) seguida de sus lineas, o solo las lineas para un bloque
// "flat" sin cabecera propia. Es el mismo orden que usan
// generator.buildBlockLines (para construir las LINES reales) y
// excel_fixture_builder.matchDependenciesForBlock (para emparejar
// dependencias) -- se expone aqui para que ambos consumidores, y cualquier
// codigo que necesite comparar la "forma" (numero de segmentos) de dos
// bloques, usen siempre el mismo criterio sin duplicarlo.
function segmentTextsOf(block) {
  if (block.kind === "value") return [block.headerText];
  if (block.kind === "flat") return block.lines || [];
  return [block.headerText, ...(block.lines || [])].filter(Boolean);
}

module.exports = {
  parseModalityCellBlocks,
  segmentTextsOf,
  analyzeLines,
  groupIntoRuns,
  classifyBoldRun,
  splitBodyRun
};
