// Generador de ENTRY/LINES (y su JSON intermedio) para una cobertura
// (COVER_ID), a partir de: el texto libre del Excel troceado en bullets, las
// dependencias ya emparejadas por matcher.js, y las reglas fijadas en
// knowledge/Modelo comparativa de coberturas - AI ready.md.
//
// Codigo puro (sin n8n, sin LLM) -- se valida offline (evaluators/
// coverage_insert_generator/run_offline_eval.js, check --generator) antes de
// construir el nodo n8n real (Fase 4 del plan, CLAUDE.md SS7).

const OPERATOR_TO_SPEL = {
  "=": "==",
  "!=": "!=",
  ">": ">",
  ">=": ">=",
  "<": "<",
  "<=": "<="
};

function quoteSpelValue(value) {
  if (typeof value === "string") {
    return `'${value.replace(/'/g, "\\'")}'`;
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  throw new Error(`Tipo de valor SPEL no soportado: ${typeof value} (${JSON.stringify(value)})`);
}

// Traduce una dependencia {risk_field, operator, value} (esquema del flujo 2)
// a una condicion SPEL sobre insurance["risk"]. Sintaxis de IN/NOT_IN
// confirmada por el usuario: `campo in {v1,v2,v3}` / `!(campo in {v1,v2,v3})`.
function translateToSpel(dependency) {
  const field = `insurance["risk"].${dependency.risk_field}`;

  if (dependency.operator === "IN" || dependency.operator === "NOT_IN") {
    if (!Array.isArray(dependency.value)) {
      throw new Error(`operator ${dependency.operator} requiere value como array (dependency: ${JSON.stringify(dependency)})`);
    }
    const list = `{${dependency.value.map(quoteSpelValue).join(",")}}`;
    const membership = `${field} in ${list}`;
    return dependency.operator === "IN" ? membership : `!(${membership})`;
  }

  const spelOp = OPERATOR_TO_SPEL[dependency.operator];
  if (!spelOp) {
    throw new Error(`Operador desconocido: ${dependency.operator}`);
  }
  return `${field} ${spelOp} ${quoteSpelValue(dependency.value)}`;
}

// Combina varias dependencias de un mismo ENTRY con AND. Con 1 sola
// dependencia no anade parentesis de mas.
function combineFilterExpr(dependencies) {
  if (!dependencies || dependencies.length === 0) return null;
  const parts = dependencies.map(translateToSpel);
  return parts.length === 1 ? parts[0] : parts.map(p => `(${p})`).join(" && ");
}

// Escapa un texto libre para usarlo como literal de cadena SPEL en TEXT_EXPR.
function spelStringLiteral(text) {
  return `'${(text || "").replace(/'/g, "\\'")}'`;
}

// Trocea el texto libre de una celda del Excel en bullets (una linea por
// bullet, ver knowledge/.../criterio de granularidad de LINES). Descarta la
// primera linea si es solo el nombre de la cobertura repetido (patron real
// observado: la celda empieza con el propio nombre a modo de cabecera).
function splitBulletsFromCellText(cellText, coverName) {
  const lines = (cellText || "")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0);
  if (lines.length > 1 && coverName && lines[0].toLowerCase() === coverName.toLowerCase()) {
    return lines.slice(1);
  }
  return lines;
}

// Construye los ENTRY/LINES de una cobertura completa.
//
// Input:
//   coverId, coverName
//   defaultBullets: string[] -- bullets sin ninguna dependencia estructural
//     emparejada (van todos en un unico ENTRY por defecto).
//   conditionedBullets: [{ text, dependencies, modalityId }] -- un ENTRY por
//     elemento (ver criterio de granularidad: ENTRY = condicion estructural).
//   opcionales: [{ coverName, textContent, hiringStatusExpr }] -- de la hoja
//     "Coberturas opcionales" ya resueltos a este cover_id.
//
// Output: { entries: [...], coverOverride: string|null }
// Traduce un bloque (salida de rich_text_block_parser.parseModalityCellBlocks,
// ver excel_fixture_builder.buildBlockGroupsForCover) a las LINES de su
// ENTRY, aplicando la dependencia de flow 2 que le corresponda a CADA
// segmento por separado (cabecera y cada linea, via
// excel_fixture_builder.matchDependenciesForBlock/matchDependenciesToBlockGroups)
// -- NUNCA al ENTRY completo. Motivo: un bloque puede agrupar varias lineas
// (ej. "-Responsabilidad Civil de la vivienda" con 4 lineas) donde solo UNA
// tiene una condicion real extraida del condicionado (ej. "Como inquilino
// frente al arrendador (locativa)" -> housingRegime == 'Tenant'); si esa
// condicion se pusiera en el FILTER_EXPR del ENTRY, ocultaria tambien las
// otras 3 lineas sin relacion. La cabecera (negrita o "-") se mantiene como
// primera linea visible -- ya se mostraba asi antes de este parser. Un
// bloque "value" (ej. "Capital 150.000€") no tiene cuerpo propio: su unica
// linea es el propio valor.
function buildBlockLines(block, headerDependencies, lineDependencies) {
  const lines = [];
  const pushLine = (text, dependencies) => {
    lines.push({ filter_expr: combineFilterExpr(dependencies), text_expr: spelStringLiteral(text) });
  };

  if (block.kind === "value") {
    pushLine(block.headerText, headerDependencies);
    return lines;
  }
  if (block.kind !== "flat" && block.headerText) {
    pushLine(block.headerText, headerDependencies);
  }
  (block.lines || []).forEach((text, i) => pushLine(text, (lineDependencies || [])[i]));
  return lines;
}

function buildEntriesForCover({
  coverId,
  coverName,
  defaultBullets = [],
  conditionedBullets = [],
  defaultBlocks = [],
  conditionedBlocks = [],
  opcionales = [],
  presentModalityIds = [],
  missingModalityIds = []
}) {
  const entries = [];

  if (defaultBullets.length > 0) {
    entries.push({
      cover_id: coverId,
      filter_expr: null,
      hiring_status_expr: "INCLUDED",
      value_expr: null,
      modality_id: null,
      source: "default",
      lines: defaultBullets.map(text => ({ filter_expr: null, text_expr: spelStringLiteral(text) }))
    });
  }

  for (const entry of defaultBlocks) {
    entries.push({
      cover_id: coverId,
      filter_expr: null,
      hiring_status_expr: "INCLUDED",
      value_expr: null,
      modality_id: null,
      source: "default",
      lines: buildBlockLines(entry.block, entry.headerDependencies, entry.lineDependencies)
    });
  }

  for (const bullet of conditionedBullets) {
    entries.push({
      cover_id: coverId,
      filter_expr: combineFilterExpr(bullet.dependencies),
      hiring_status_expr: "INCLUDED",
      value_expr: null,
      modality_id: bullet.modalityId ?? null,
      source: "modality_bullet",
      lines: [{ filter_expr: null, text_expr: spelStringLiteral(bullet.text) }]
    });
  }

  for (const cond of conditionedBlocks) {
    entries.push({
      cover_id: coverId,
      filter_expr: null,
      hiring_status_expr: "INCLUDED",
      value_expr: null,
      modality_id: cond.modalityId ?? null,
      source: "modality_bullet",
      lines: buildBlockLines(cond.block, cond.headerDependencies, cond.lineDependencies),
      _blockIndex: cond.blockIndex
    });
  }

  // Bug real corregido 22/07 (covers 79/81, "Sin cobertura" en varias
  // modalidades de "Coberturas por modalidad"): una cobertura opcional
  // (hoja "Coberturas opcionales") no tiene por que ofrecerse en TODAS las
  // modalidades de su cobertura base -- si "Coberturas por modalidad" dice
  // "Sin cobertura" para una modalidad concreta, esa modalidad no puede
  // contratar ni la base ni el opcional, y debe salir NOT_INCLUDED
  // explicito, no la formula de tuning (que antes se aplicaba por igual a
  // las 11 modalidades, modality_id null, ignorando cuales la ofrecen
  // realmente). Si NINGUNA modalidad falta (missingModalityIds vacio, caso
  // normal), se mantiene el comportamiento de siempre: una unica ENTRY sin
  // modalidad.
  for (const opt of opcionales) {
    const optLines = splitBulletsFromCellText(opt.textContent, null).map(text => ({ filter_expr: null, text_expr: spelStringLiteral(text) }));

    if (missingModalityIds.length === 0) {
      entries.push({
        cover_id: coverId,
        filter_expr: opt.filterExpr ?? null,
        hiring_status_expr: opt.hiringStatusExpr || "OPTIONAL",
        value_expr: null,
        modality_id: null,
        source: "optional_cover",
        lines: optLines
      });
      continue;
    }

    for (const modalityId of missingModalityIds) {
      entries.push({
        cover_id: coverId,
        filter_expr: null,
        hiring_status_expr: "NOT_INCLUDED",
        value_expr: null,
        modality_id: modalityId,
        source: "optional_cover",
        lines: []
      });
    }
    for (const modalityId of presentModalityIds) {
      entries.push({
        cover_id: coverId,
        filter_expr: opt.filterExpr ?? null,
        hiring_status_expr: opt.hiringStatusExpr || "OPTIONAL",
        value_expr: null,
        modality_id: modalityId,
        source: "optional_cover",
        lines: optLines
      });
    }
  }

  const coverOverride = computeCoverOverride(entries);
  if (coverOverride) {
    for (const entry of entries) {
      if (entry.filter_expr === coverOverride.sharedCondition) {
        entry.filter_expr = null;
      }
    }
  }

  const sorted = sortEntriesByModality(entries);
  sorted.forEach(entry => delete entry._blockIndex);

  return {
    entries: sorted,
    coverOverride: coverOverride ? coverOverride.hiringStatusExpr : null
  };
}

// Reordena las ENTRY para que sea facil revisar si una modalidad concreta
// tiene todo su contenido (peticion del usuario, 22/07 -- con el orden de
// construccion original, entries de la misma modalidad quedaban dispersas
// entre familias/bloques distintos). Primero las sin modalidad que vienen
// del propio Excel de modalidades (comunes a todas, source "default"),
// despues agrupadas por modalidad, y las de "Coberturas opcionales"
// (source "optional_cover") siempre al FINAL con independencia de que su
// modality_id sea null -- ajuste pedido por el usuario tras revisar un caso
// real (cover 15: "Responsabilidad civil por propiedad y tenencia de
// perros" salia antes que las entries por modalidad, dificultando revisar
// si una modalidad concreta tiene todo su contenido).
//
// Dentro de una MISMA modalidad, se ordena ademas por _blockIndex (la
// posicion original del bloque dentro de su propia celda, ver
// excel_fixture_builder.buildBlockGroupsForCover/Heterogeneous) -- bug real
// detectado 22/07 (cover 15): sin este criterio, el orden dentro de una
// modalidad dependia de en que momento se creaba el groupIndex de cada
// familia durante el agrupamiento (un artefacto interno de
// matchDependenciesToBlockGroups, no el orden real de la celda), asi que el
// Capital aparecia primero en unas modalidades y al final en otras.
// _blockIndex es un campo temporal (no forma parte del ENTRY final, ver el
// borrado tras ordenar en buildEntriesForCover) -- las entries que no vienen
// de conditionedBlocks (default/bullets/opcionales) no lo tienen, se tratan
// como 0 (no afecta su posicion relativa entre modalidades, solo el
// desempate DENTRO de la misma modalidad). Array.prototype.sort es estable
// en Node/V8, asi que el orden relativo dentro de un mismo (modalidad,
// blockIndex) se conserva tal cual las genero buildEntriesForCover.
function sortEntriesByModality(entries) {
  return [...entries].sort((a, b) => {
    const aIsOptional = a.source === "optional_cover" ? 1 : 0;
    const bIsOptional = b.source === "optional_cover" ? 1 : 0;
    if (aIsOptional !== bIsOptional) return aIsOptional - bIsOptional;
    const aKey = a.modality_id == null ? -Infinity : Number(a.modality_id);
    const bKey = b.modality_id == null ? -Infinity : Number(b.modality_id);
    if (aKey !== bKey) return aKey - bKey;
    return (a._blockIndex ?? 0) - (b._blockIndex ?? 0);
  });
}

// Construye el HIRING_STATUS_EXPR real (formula SPEL) de una cobertura
// opcional contratable via tuning, siguiendo el patron ya confirmado en
// knowledge/Modelo comparativa de coberturas - AI ready.md ("Ejemplo
// completo 2"): INCLUDED si el tuning tiene la opcion marcada, OPTIONAL si
// no. Sin un tuning_key real resuelto (NOT_FOUND) no hay forma de construir
// esa condicion -- se mantiene el literal "OPTIONAL" tal cual (mismo
// comportamiento que antes para ese caso).
function buildOptionalHiringStatusExpr(tuningKey) {
  if (!tuningKey || tuningKey === "NOT_FOUND") return "OPTIONAL";
  return `tuning?.${tuningKey} != null && tuning.${tuningKey} ? "INCLUDED" : "OPTIONAL"`;
}

// Regla de optimizacion: si TODOS los ENTRY (2 o mas) comparten exactamente
// la misma condicion no nula, se traslada al HIRING_STATUS_EXPR de
// PRODUCT_COMPANY_COVER en vez de repetirse en cada ENTRY (decision del
// usuario, opcion B: el contenido sigue visible aunque la cobertura salga
// NOT_INCLUDED). Con menos de 2 ENTRY no hay nada que deduplicar -- salvo el
// caso de 0 ENTRY (cobertura sin ningun bloque real): ahi se fuerza
// explicitamente NOT_INCLUDED (decision del usuario, 21/07) en vez de dejar
// NULL y depender de que el motor real agregue "cero bloques" a NOT_INCLUDED
// de forma implicita.
function computeCoverOverride(entries) {
  if (entries.length === 0) {
    return { sharedCondition: undefined, hiringStatusExpr: `"NOT_INCLUDED"` };
  }
  if (entries.length < 2) return null;
  const conditions = entries.map(e => e.filter_expr);
  if (conditions.some(c => c == null)) return null;
  const allSame = conditions.every(c => c === conditions[0]);
  if (!allSame) return null;
  return {
    sharedCondition: conditions[0],
    hiringStatusExpr: `${conditions[0]} ? "INCLUDED" : "NOT_INCLUDED"`
  };
}

// Generacion del SQL INSERT final (motor: MySQL, confirmado por el usuario)
// a partir del artefacto de una cobertura (ver buildEntriesForCover). Usa
// variables de sesion (`SET @var := LAST_INSERT_ID()`) para encadenar las FK
// entre PRODUCT_COMPANY_COVER -> _ENTRY -> _LINES, ya que los INSERT se
// ejecutan secuencialmente y el ID de cada fila se genera en la propia BBDD.
//
// Confirmado por el usuario (20/07): toda expresion SPEL (no solo TEXT_EXPR)
// lleva el envoltorio "/" ... "/" -- se aplica por igual a FILTER_EXPR/
// HIRING_STATUS_EXPR/VALUE_EXPR/TEXT_EXPR.
function wrapAsSpelExpression(rawExpr) {
  return rawExpr == null ? null : `/${rawExpr}/`;
}

// Literal SQL: escapa comillas simples con backslash, igual que el ejemplo
// real del modelo (`'/\'texto\'/'`) -- convencion de MySQL con
// NO_BACKSLASH_ESCAPES desactivado (el modo por defecto).
function sqlLiteral(value) {
  if (value == null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replace(/'/g, "\\'")}'`;
}

// coverArtifact: { coverId, productCompanyId, coverOverride, entries } --
// coverOverride y entries.*.filter_expr/hiring_status_expr/value_expr son
// expresiones SPEL en crudo (sin el envoltorio "/.../"); entries.*.lines[].
// text_expr ya viene como literal de cadena SPEL (`'texto'`, ver
// spelStringLiteral) al que tambien hay que anadirle el envoltorio.
function buildInsertStatements({ coverId, productCompanyId, coverOverride, entries }) {
  const statements = [];

  statements.push(
    `INSERT INTO PRODUCT_COMPANY_COVER (HIRING_STATUS_EXPR, COVER_ID, PRODUCT_COMPANY_ID) VALUES (${sqlLiteral(wrapAsSpelExpression(coverOverride))}, ${coverId}, ${productCompanyId});`
  );
  statements.push("SET @cover_id := LAST_INSERT_ID();");

  entries.forEach((entry, entryIndex) => {
    const entryVar = `@entry_id_${entryIndex + 1}`;
    statements.push(
      `INSERT INTO PRODUCT_COMPANY_COVER_ENTRY (FILTER_EXPR, HIRING_STATUS_EXPR, ENTRY_ORDER, VALUE_EXPR, UNIT, PRODUCT_COMPANY_MODALITY_ID, PRODUCT_COMPANY_COVER_ID) VALUES (${sqlLiteral(wrapAsSpelExpression(entry.filter_expr))}, ${sqlLiteral(wrapAsSpelExpression(entry.hiring_status_expr))}, ${entryIndex + 1}, ${sqlLiteral(wrapAsSpelExpression(entry.value_expr))}, NULL, ${entry.modality_id ?? "NULL"}, @cover_id);`
    );
    statements.push(`SET ${entryVar} := LAST_INSERT_ID();`);

    entry.lines.forEach((line, lineIndex) => {
      statements.push(
        `INSERT INTO PRODUCT_COMPANY_COVER_LINES (TEXT_EXPR, PRODUCT_COMPANY_COVER_ENTRY_ID, LINE_ORDER) VALUES (${sqlLiteral(wrapAsSpelExpression(line.text_expr))}, ${entryVar}, ${lineIndex + 1});`
      );
    });
  });

  return statements;
}

module.exports = {
  translateToSpel,
  combineFilterExpr,
  spelStringLiteral,
  splitBulletsFromCellText,
  buildBlockLines,
  buildEntriesForCover,
  buildOptionalHiringStatusExpr,
  computeCoverOverride,
  wrapAsSpelExpression,
  sqlLiteral,
  buildInsertStatements
};
