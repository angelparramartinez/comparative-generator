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
function buildEntriesForCover({ coverId, coverName, defaultBullets = [], conditionedBullets = [], opcionales = [] }) {
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

  for (const opt of opcionales) {
    entries.push({
      cover_id: coverId,
      filter_expr: opt.filterExpr ?? null,
      hiring_status_expr: opt.hiringStatusExpr || "OPTIONAL",
      value_expr: null,
      modality_id: null,
      source: "optional_cover",
      lines: [{ filter_expr: null, text_expr: spelStringLiteral(opt.textContent) }]
    });
  }

  const coverOverride = computeCoverOverride(entries);
  if (coverOverride) {
    for (const entry of entries) {
      if (entry.filter_expr === coverOverride.sharedCondition) {
        entry.filter_expr = null;
      }
    }
  }

  return {
    entries,
    coverOverride: coverOverride ? coverOverride.hiringStatusExpr : null
  };
}

// Regla de optimizacion: si TODOS los ENTRY (2 o mas) comparten exactamente
// la misma condicion no nula, se traslada al HIRING_STATUS_EXPR de
// PRODUCT_COMPANY_COVER en vez de repetirse en cada ENTRY (decision del
// usuario, opcion B: el contenido sigue visible aunque la cobertura salga
// NOT_INCLUDED). Con menos de 2 ENTRY no hay nada que deduplicar.
function computeCoverOverride(entries) {
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
  buildEntriesForCover,
  computeCoverOverride,
  wrapAsSpelExpression,
  sqlLiteral,
  buildInsertStatements
};
