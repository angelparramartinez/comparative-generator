// Adaptadores entre la salida de los nodos de limpieza del Excel (`Clean
// covers and modalities` / `Clean Optional Covers`) y lo que esperan
// `matcher.js` (indice de candidatos) y `generator.js` (bloques por
// cobertura, agrupados por si varian o no entre modalidades). Corresponde a
// los nodos A6 ("Build Excel Fixture for Matcher") y A16 ("Build Per-Cover
// Block Groups") del diseño de Fase 4 (ver plan zippy-weaving-crown.md).
// Los bloques vienen de rich_text_block_parser.js (negrita/"-" de la celda
// real de Google Sheets, diseno 22/07) -- ver ese fichero para el criterio
// de bloque/linea. Codigo puro, se valida offline (run_offline_eval.js,
// check --excel-fixture) antes de construir los nodos n8n reales.

const { normalize } = require("./matcher");
const { parseModalityCellBlocks, segmentTextsOf } = require("./rich_text_block_parser");

// Marcador de texto libre (sin relacion con ninguna cobertura real) que el
// Excel usa dentro de una celda de "Coberturas por modalidad" para senalar
// que esa modalidad necesita mapeo a un tuning_key (ver Build Tuning
// Context). No es contenido real de la cobertura -- debe excluirse de los
// bullets antes de construir candidatos/ENTRY, o se cuela como una linea
// literal "Garantía Opcional" visible al usuario final (caso real
// confirmado: COVER_ID 79/81).
const GARANTIA_OPCIONAL_MARKER_NORMALIZED = normalize("Garantía Opcional");

function isGarantiaOpcionalMarker(bulletText) {
  return normalize(bulletText) === GARANTIA_OPCIONAL_MARKER_NORMALIZED;
}

// A6: cleanedModalityCovers = salida de `Clean covers and modalities`
// ({cover_id, cover_name, modalities: {modality_id: cell}}[], cell = celda
// rica de Google Sheets -- {formattedValue, textFormatRuns, effectiveFormat},
// ver rich_text_block_parser.js). cleanedOptionalCovers = salida de `Clean
// Optional Covers` extendida con `epigrafe` (texto crudo de la columna
// EPIGRAFE, ver nota A5 del diseño). Produce el fixture exacto que espera
// matcher.buildCandidateIndex -- los candidatos de texto salen de aplanar
// TODOS los segmentos (cabecera+lineas) de TODOS los bloques de la celda,
// via blocksFromCell/segmentTextsOf (mismo parser que usa el resto del
// modulo, sin una segunda logica de troceo divergente).
function buildExcelFixtureForMatcher(cleanedModalityCovers, cleanedOptionalCovers) {
  const covers_por_modalidad = (cleanedModalityCovers || []).map(cover => {
    const seen = new Set();
    const sample_text_bullets = [];
    for (const cell of Object.values(cover.modalities || {})) {
      const blocks = blocksFromCell(cell, cover.cover_name);
      for (const block of blocks) {
        for (const text of segmentTextsOf(block)) {
          const key = normalize(text);
          if (!seen.has(key)) {
            seen.add(key);
            sample_text_bullets.push(text);
          }
        }
      }
    }
    return { cover_id: cover.cover_id, cover_name: cover.cover_name, sample_text_bullets };
  });

  const coberturas_opcionales = (cleanedOptionalCovers || []).map(opt => ({
    epigrafe: opt.epigrafe,
    cover_name: opt.cover_name,
    text_content: opt.text_content
  }));

  return { covers_por_modalidad, coberturas_opcionales };
}

// Serializa un bloque (ver rich_text_block_parser.parseModalityCellBlocks)
// a una clave comparable, normalizada igual que el resto del modulo -- dos
// bloques son "el mismo" (misma familia) solo si coinciden kind+cabecera+
// TODAS sus lineas, no solo el texto de la cabecera (la cabecera de un
// bloque "value" -- ej. "Capital 150.000€" -- ya varia por modalidad por
// diseno, asi que ahi la clave siempre sera distinta entre modalidades:
// correcto, cada capital es su propia variante).
function serializeBlockForComparison(block) {
  return normalize([block.kind, block.headerText || "", ...(block.lines || [])].join("|"));
}

// Patron real observado (celdas de "Coberturas por modalidad"): la celda
// repite el propio nombre de la cobertura a modo de cabecera antes del
// contenido real. Puede aparecer de 2 formas -- confirmado con datos reales
// 22/07, COVER_ID 18 "Daños por agua": el nombre esta en NEGRITA (bloque
// "label", headerText = nombre repetido), no plano como se asumio al
// principio (el golden set original solo tenia texto sin formato para este
// cover, sin negrita real capturada todavia) -- por eso hace falta cubrir
// AMBOS casos:
//   - sin negrita: un unico bloque "flat" con el nombre como su primera
//     linea (splitBulletsFromCellText ya lo cubria asi antes de este
//     parser).
//   - con negrita: un bloque "label"/"dash"/"value" cuyo headerText ES el
//     nombre repetido -- se descarta la cabecera y el bloque pasa a "flat"
//     con sus lineas propias intactas (mismo resultado final que el caso
//     sin negrita).
// Solo se descarta si queda contenido real debajo (nunca vaciar del todo
// una celda que sea unicamente el nombre repetido).
function stripLeadingCoverNameLine(blocks, coverName) {
  if (!coverName || blocks.length === 0) return blocks;
  const [first, ...rest] = blocks;
  const normalizedCoverName = coverName.toLowerCase();

  if (first.kind === "flat") {
    if (first.lines.length <= 1) return blocks;
    if (first.lines[0].toLowerCase() !== normalizedCoverName) return blocks;
    return [{ ...first, lines: first.lines.slice(1) }, ...rest];
  }

  if (first.headerText && first.lines.length > 0 && first.headerText.toLowerCase() === normalizedCoverName) {
    return [{ kind: "flat", headerText: null, lines: first.lines, needsReview: first.needsReview, reviewReason: first.reviewReason }, ...rest];
  }

  return blocks;
}

// Bloques reales de una celda de "Coberturas por modalidad" (ver
// rich_text_block_parser.js), filtrando el marcador "Garantía Opcional" -- ya
// sea como cabecera de un bloque entero o como una de sus lineas -- con el
// mismo criterio que isGarantiaOpcionalMarker aplicaba a bullets planos, y
// el nombre de cobertura repetido en celdas sin negrita (ver
// stripLeadingCoverNameLine).
function blocksFromCell(cell, coverName) {
  const { blocks } = parseModalityCellBlocks(cell || {});
  // El nombre de cobertura se descarta ANTES del marcador -- si se hiciera al
  // reves, una celda "NombreCobertura\nGarantía Opcional" perderia primero la
  // linea del marcador (quedando solo 1 linea) y ya no cumpliria el guard de
  // "mas de 1 linea" de stripLeadingCoverNameLine, dejando el nombre repetido
  // sin descartar (bug real detectado validando EFB-FIX-002 tras el cambio).
  const withoutCoverName = stripLeadingCoverNameLine(blocks, coverName);
  return withoutCoverName
    .map(b => ({ ...b, lines: (b.lines || []).filter(l => !isGarantiaOpcionalMarker(l)) }))
    .filter(b => !(b.headerText && isGarantiaOpcionalMarker(b.headerText)))
    // Si el marcador era la UNICA linea de un bloque "flat" (celda sin
    // negrita -- caso hipotetico, en los datos reales el marcador siempre
    // viene en negrita y se filtra arriba por headerText), el filtro de
    // lineas de arriba lo deja vacio (0 lineas, sin headerText) pero no lo
    // elimina -- se descarta aqui explicitamente. Un bloque "value" (0
    // lineas por diseno, ej. Capital) nunca se descarta porque SI tiene
    // headerText.
    .filter(b => b.headerText || (b.lines && b.lines.length > 0));
}

// Fallback para cuando el NUMERO de bloques difiere entre modalidades (caso
// real confirmado: COVER_ID 15 "RC" entre sus 11 modalidades completas -- es
// habitual y esperado que un paquete comercial superior incluya garantias
// enteras que el basico no tiene, decision del usuario 21/07: esto no
// deberia bloquear la generacion). Sin una posicion comun que alinear, el
// criterio pasa a ser CONTENIDO: un bloque (cabecera+lineas, normalizado)
// que aparece en TODAS las modalidades presentes es compartido
// (defaultBlocks, sin PRODUCT_COMPANY_MODALITY_ID); el resto se agrupa por
// contenido EXACTO, con groupIndex compartido entre variantes (para que una
// dependencia extraida en una de ellas se aplique a las demas via
// matchDependenciesToBlockGroups). Bloques de contenido UNICO quedan cada
// uno en su propia familia -- mismo criterio de "nunca alinear a la fuerza"
// que el resto del proyecto.
function buildBlockGroupsForHeterogeneousCover(coverId, coverName, blocksByModality) {
  const modalityIds = Object.keys(blocksByModality);
  const normalizedSetPerModality = {};
  for (const id of modalityIds) {
    normalizedSetPerModality[id] = new Set(blocksByModality[id].map(serializeBlockForComparison));
  }

  const defaultBlocks = [];
  const isDefault = new Set();
  for (const id of modalityIds) {
    for (const block of blocksByModality[id]) {
      const key = serializeBlockForComparison(block);
      if (isDefault.has(key)) continue;
      const inAllModalities = modalityIds.every(otherId => normalizedSetPerModality[otherId].has(key));
      if (inAllModalities) {
        defaultBlocks.push(block);
        isDefault.add(key);
      }
    }
  }

  const perModalityBlocks = [];
  const groupIndexByKey = new Map();
  let nextGroupIndex = 0;
  for (const id of modalityIds) {
    blocksByModality[id].forEach((block, blockIndex) => {
      const key = serializeBlockForComparison(block);
      if (isDefault.has(key)) return;
      if (!groupIndexByKey.has(key)) {
        groupIndexByKey.set(key, nextGroupIndex++);
      }
      perModalityBlocks.push({ modalityId: id, block, groupIndex: groupIndexByKey.get(key), blockIndex });
    });
  }

  return { coverId, coverName, homogeneous: true, defaultBlocks, perModalityBlocks };
}

// A16: agrupa los bloques de una cobertura segun si su contenido es
// identico en TODAS las modalidades (comparten un unico bloque sin
// PRODUCT_COMPANY_MODALITY_ID) o varia por modalidad (un bloque por
// modality_id). Alineacion por POSICION dentro de cada celda ya parseada en
// bloques cuando todas las modalidades presentes tienen el MISMO numero de
// bloques (necesario para casos como "Fontanería sin daños" donde el texto
// varia -- importe -- pero la posicion es la misma garantia real). Cuando
// el numero de bloques difiere entre modalidades, delega en
// buildBlockGroupsForHeterogeneousCover (ver arriba).
function buildBlockGroupsForCover(coverId, coverName, modalitiesMap) {
  const modalityIds = Object.keys(modalitiesMap || {});
  const blocksByModality = {};
  for (const modalityId of modalityIds) {
    blocksByModality[modalityId] = blocksFromCell(modalitiesMap[modalityId], coverName);
  }

  const counts = new Set(modalityIds.map(id => blocksByModality[id].length));
  if (counts.size > 1) {
    return buildBlockGroupsForHeterogeneousCover(coverId, coverName, blocksByModality);
  }

  const blockCount = modalityIds.length === 0 ? 0 : blocksByModality[modalityIds[0]].length;
  const defaultBlocks = [];
  const perModalityBlocks = [];
  for (let i = 0; i < blockCount; i++) {
    const blocksAtPosition = modalityIds.map(id => blocksByModality[id][i]);
    const keysAtPosition = blocksAtPosition.map(serializeBlockForComparison);
    const allSame = keysAtPosition.every(k => k === keysAtPosition[0]);
    if (allSame) {
      defaultBlocks.push(blocksAtPosition[0]);
    } else {
      modalityIds.forEach((id, idx) => {
        perModalityBlocks.push({ modalityId: id, block: blocksAtPosition[idx], groupIndex: i, blockIndex: i });
      });
    }
  }

  return { coverId, coverName, homogeneous: true, defaultBlocks, perModalityBlocks };
}

function findDependenciesForText(text, matches, coverId) {
  if (!text) return null;
  const bulletNormalized = normalize(text);
  const hit = (matches || []).find(
    m => m.cover_id === coverId && normalize(m.excel_quote || m.bullet_match || "") === bulletNormalized
  );
  return hit ? (hit.dependencies_translated || []) : null;
}

// Reconstruye {headerDependencies, lineDependencies} a partir de un array
// PLANO de dependencias por segmento (mismo orden que segmentTextsOf) --
// inverso de "aplanar" un bloque a sus segmentos, usado cuando las
// dependencias se resolvieron a nivel de familia (ver
// matchDependenciesToBlockGroups) en vez de directamente sobre el bloque.
function unflattenSegmentDependencies(block, segmentDependencies) {
  if (block.kind === "value") {
    return { headerDependencies: segmentDependencies[0] ?? null, lineDependencies: [] };
  }
  if (block.kind === "flat") {
    return { headerDependencies: null, lineDependencies: segmentDependencies };
  }
  const hasHeader = !!block.headerText;
  return {
    headerDependencies: hasHeader ? (segmentDependencies[0] ?? null) : null,
    lineDependencies: hasHeader ? segmentDependencies.slice(1) : segmentDependencies
  };
}

// Empareja la cita literal de cada dependencia (excel_quote/bullet_match)
// contra CADA segmento del bloque por separado (su cabecera y cada una de
// sus lineas), nunca contra el bloque entero -- un bloque puede agrupar
// varias lineas bajo una misma ENTRY, y solo UNA de ellas puede tener una
// condicion real (ver
// generator.buildBlockLines: cada dependencia se aplica a su LINE, nunca al
// FILTER_EXPR del ENTRY completo, para no ocultar de mas las lineas sin
// relacion). Empareja el bloque SOLO contra su propio texto -- sin mirar
// otras modalidades -- por eso es seguro de usar siempre, a diferencia de
// matchDependenciesToBlockGroups (ver abajo) cuando las formas no coinciden.
function matchDependenciesForBlock(block, matches, coverId) {
  const segments = segmentTextsOf(block);
  const segmentDependencies = segments.map(text => findDependenciesForText(text, matches, coverId));
  return unflattenSegmentDependencies(block, segmentDependencies);
}

// Aplica matchDependenciesForBlock a los bloques ya compartidos (sin
// PRODUCT_COMPANY_MODALITY_ID) que produce buildBlockGroupsForCover/
// buildBlockGroupsForHeterogeneousCover en su campo defaultBlocks.
function matchDependenciesToDefaultBlocks(defaultBlocks, matches, coverId) {
  return (defaultBlocks || []).map(block => ({ block, ...matchDependenciesForBlock(block, matches, coverId) }));
}

// Empareja dependencias para las familias de bloques (perModalityBlocks, ver
// buildBlockGroupsForCover/buildBlockGroupsForHeterogeneousCover), aplicando
// la MISMA dependencia a TODAS las variantes de una familia en cuanto UNA de
// ellas cita literalmente el texto (mismo espiritu que el fix real de
// COVER_ID 18 "Fontaneria sin daños" -- importe variable, condicion comun).
//
// Una familia por CONTENIDO EXACTO (rama heterogenea) tiene todos sus
// miembros identicos por construccion -- ahi da igual emparejar cada uno
// por separado o compartir el resultado, es lo mismo.
//
// Una familia por POSICION (rama homogenea, cuando el contenido difiere en
// la misma posicion -- ej. "Fontaneria sin danos" con el importe variando
// por modalidad) puede tener miembros con DISTINTO NUMERO de segmentos
// internos (caso real confirmado: COVER_ID 16 "Robo", su unico bloque tiene
// 7 lineas en las modalidades altas y solo 4 en la mas basica, aunque el
// CELDA entera cuenta como "1 bloque" en las 11). Aplicar una dependencia
// encontrada en el segmento N de una variante al segmento N de otra con
// menos segmentos no es seguro -- no hay garantia de que sea la misma
// garantia real. Por eso: si TODOS los miembros de la familia tienen el
// MISMO numero de segmentos, se busca la dependencia en cualquiera de ellos
// y se aplica por posicion a todos. Si no, cada miembro se empareja SOLO
// contra su propio texto (matchDependenciesForBlock) -- limitacion conocida
// y deliberada, no se fuerza una correspondencia sin garantia real.
function matchDependenciesToBlockGroups(perModalityBlocks, matches, coverId) {
  const byGroupIndex = new Map();
  for (const entry of perModalityBlocks || []) {
    const key = entry.groupIndex;
    if (!byGroupIndex.has(key)) byGroupIndex.set(key, []);
    byGroupIndex.get(key).push(entry);
  }

  const result = [];
  for (const family of byGroupIndex.values()) {
    const segmentCounts = new Set(family.map(({ block }) => segmentTextsOf(block).length));
    const sameShape = segmentCounts.size <= 1;

    if (!sameShape) {
      for (const { modalityId, block, blockIndex } of family) {
        result.push({ block, modalityId, blockIndex, ...matchDependenciesForBlock(block, matches, coverId) });
      }
      continue;
    }

    const segmentCount = segmentTextsOf(family[0].block).length;
    const segmentDependencies = Array.from({ length: segmentCount }, (_, segIdx) => {
      for (const { block } of family) {
        const hit = findDependenciesForText(segmentTextsOf(block)[segIdx], matches, coverId);
        if (hit) return hit;
      }
      return null;
    });

    for (const { modalityId, block, blockIndex } of family) {
      result.push({ block, modalityId, blockIndex, ...unflattenSegmentDependencies(block, segmentDependencies) });
    }
  }
  return result;
}

module.exports = {
  buildExcelFixtureForMatcher,
  buildBlockGroupsForCover,
  buildBlockGroupsForHeterogeneousCover,
  matchDependenciesForBlock,
  matchDependenciesToDefaultBlocks,
  matchDependenciesToBlockGroups,
  isGarantiaOpcionalMarker
};
