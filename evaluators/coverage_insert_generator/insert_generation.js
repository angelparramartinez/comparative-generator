// Trigger B ("Generar SQL desde JSON revisado", workflow n8n
// `coverage insert sql generation.json`, nuevo -- decision del usuario
// 23/07 de separarlo del workflow de Trigger A). Toma el JSON que produjo
// Trigger A (`assembleHumanReviewJson`, review_assembly.js) despues de que
// una mini-app externa lo haya dejado revisado por un humano, y genera el
// SQL final de INSERT.
//
// Esquema real de la revision humana (confirmado por el usuario 23/07,
// aditivo sobre el JSON de Trigger A -- nada se renombra ni reestructura):
//   covers[].entries[].human_decision: {action: "edited"|"added"|"removed",
//     original: <entry-copy-o-null>, timestamp} -- ausente/null si la entry
//     no se toco. Los campos ACTUALES de la entry (filter_expr,
//     hiring_status_expr, value_expr, lines[]) ya reflejan el valor
//     corregido para "edited"/"added"; "removed" es soft-delete (la entry
//     sigue en el array, con sus campos congelados).
//   unmatched_dependencies[].human_annotation: solo trazabilidad, este
//     modulo no lo usa para generar SQL.
//   review_progress: recalculado por la mini-app al exportar -- este modulo
//     NO confia en el, recalcula su propio criterio de completitud via
//     review_assembly.validateReviewCompleteness (misma fuente de verdad
//     que ya valida offline el resto del proyecto).

const generator = require("./generator");
const reviewAssembly = require("./review_assembly");

// Defensivo: Convert to File de n8n serializa TODOS los items de entrada
// como un array (incluso con 1 solo item) -- Trigger A siempre produce
// exactamente ese patron, la mini-app preserva "el mismo array-wrapping si
// el original lo tenia" (confirmado por el usuario). No asume un unico
// formato por si el fichero se edita/genera a mano sin ese wrapping.
function unwrapReviewedJson(raw) {
  return Array.isArray(raw) ? raw[0] : raw;
}

// Soft-delete: la entry "removed" sigue en covers[].entries[] (para no
// perder el rastro de que existio, ver `original`) pero nunca debe generar
// SQL.
function filterActiveEntries(entries) {
  return (entries || []).filter(e => e.human_decision?.action !== "removed");
}

// Guardrail nuevo (Trigger B): una entry generada por la IA en Trigger A ya
// esta garantizada bien formada por construccion (generator.buildEntriesForCover
// siempre las construye asi); una entry "edited"/"added" a mano en la
// mini-app no lo esta -- mismo espiritu que el resto de guardrails del
// proyecto (Risk Field Guardrail, Grounding Guardrail, Tuning Key
// Guardrail): nunca generar SQL a partir de un dato no verificado, listar
// el problema en vez de fallar en silencio o generar SQL invalido.
function validateEntryShape(entry) {
  const errors = [];
  if (typeof entry.hiring_status_expr !== "string" || entry.hiring_status_expr.trim() === "") {
    errors.push("hiring_status_expr debe ser un string no vacio");
  }
  if (entry.filter_expr != null && typeof entry.filter_expr !== "string") {
    errors.push("filter_expr debe ser string o null");
  }
  if (entry.value_expr != null && typeof entry.value_expr !== "string") {
    errors.push("value_expr debe ser string o null");
  }
  if (entry.modality_id != null && Number.isNaN(Number(entry.modality_id))) {
    errors.push("modality_id debe ser null o numerico");
  }
  if (!Array.isArray(entry.lines)) {
    errors.push("lines debe ser un array");
  } else {
    entry.lines.forEach((line, i) => {
      if (typeof line.text_expr !== "string" || line.text_expr.trim() === "") {
        errors.push(`lines[${i}].text_expr debe ser un string no vacio`);
      }
      if (line.filter_expr != null && typeof line.filter_expr !== "string") {
        errors.push(`lines[${i}].filter_expr debe ser string o null`);
      }
    });
  }
  return { valid: errors.length === 0, errors };
}

// Ensambla los INSERT de una cobertura: filtra las entries eliminadas,
// valida la forma de las que quedan, y recalcula coverOverride sobre las
// entries ACTIVAS finales -- nunca sobre cover.cover_override_hiring_status_expr
// (el que congelo Trigger A), porque un removed/added/edited puede cambiar
// si "todas las entries comparten la misma condicion" (regla de
// optimizacion, knowledge/Modelo comparativa de coberturas - AI ready.md:
// "su HIRING_STATUS_EXPR debe calcularse despues de tener claras las
// condiciones de todos sus ENTRY").
function buildCoverInserts(cover, productCompanyId) {
  const activeEntries = filterActiveEntries(cover.entries);

  const shapeErrors = [];
  activeEntries.forEach((entry, i) => {
    const { valid, errors } = validateEntryShape(entry);
    if (!valid) {
      shapeErrors.push({ cover_id: cover.cover_id, entry_index: i, errors });
    }
  });
  if (shapeErrors.length > 0) {
    return { ok: false, shapeErrors };
  }

  const coverOverride = generator.computeCoverOverride(activeEntries);
  // Mismo paso que generator.buildEntriesForCover tras detectar condicion
  // compartida: la condicion se traslada al HIRING_STATUS_EXPR de la
  // cobertura, asi que no debe repetirse tambien en el FILTER_EXPR de cada
  // ENTRY (evita duplicar la misma condicion dos veces en el SQL final).
  // Clona antes de mutar para no alterar el JSON de entrada del caller.
  const finalEntries = coverOverride && coverOverride.sharedCondition !== undefined
    ? activeEntries.map(e => e.filter_expr === coverOverride.sharedCondition ? { ...e, filter_expr: null } : e)
    : activeEntries;

  const statements = generator.buildInsertStatements({
    coverId: cover.cover_id,
    productCompanyId,
    coverOverride: coverOverride ? coverOverride.hiringStatusExpr : null,
    entries: finalEntries
  });

  return { ok: true, statements, activeEntryCount: finalEntries.length };
}

function countByAction(covers, action) {
  return covers.reduce(
    (sum, c) => sum + (c.entries || []).filter(e => e.human_decision?.action === action).length,
    0
  );
}

// Punto de entrada unico del nodo real "Build Insert SQL". Nunca aborta en
// silencio: si queda revision humana pendiente O una entry mal formada,
// devuelve {ok:false, reason, ...detalle} para que el workflow escriba un
// fichero de error legible en vez de fallar la ejecucion de n8n sin mas --
// mismo principio que rejected_dependencies/ungrounded_dependencies en
// flujo 2 (nunca descartar en silencio).
function buildFinalSql(rawReviewedJson) {
  const reviewJson = unwrapReviewedJson(rawReviewedJson);
  const covers = reviewJson.covers || [];

  const completeness = reviewAssembly.validateReviewCompleteness(reviewJson);
  if (!completeness.complete) {
    const pending = [];
    for (const cover of covers) {
      for (const entry of cover.entries || []) {
        if (entry.review_status === "needs_review" && !entry.human_decision?.action) {
          pending.push({ cover_id: cover.cover_id, review_reasons: entry.review_reasons || [] });
        }
      }
    }
    return { ok: false, reason: "pending_review", pending, product_company_id: reviewJson.product_company_id };
  }

  const productCompanyId = reviewJson.product_company_id;
  const allShapeErrors = [];
  const coverStatements = [];

  for (const cover of covers) {
    const result = buildCoverInserts(cover, productCompanyId);
    if (!result.ok) {
      allShapeErrors.push(...result.shapeErrors);
      continue;
    }
    coverStatements.push(...result.statements);
  }

  if (allShapeErrors.length > 0) {
    return { ok: false, reason: "invalid_entries", errors: allShapeErrors, product_company_id: productCompanyId };
  }

  const sql = ["START TRANSACTION;", ...coverStatements, "COMMIT;"].join("\n");

  return {
    ok: true,
    sql,
    product_company_id: productCompanyId,
    stats: {
      total_covers: covers.length,
      total_entries: covers.reduce((sum, c) => sum + filterActiveEntries(c.entries).length, 0),
      edited_entries: countByAction(covers, "edited"),
      added_entries: countByAction(covers, "added"),
      removed_entries: countByAction(covers, "removed")
    }
  };
}

module.exports = {
  unwrapReviewedJson,
  filterActiveEntries,
  validateEntryShape,
  buildCoverInserts,
  buildFinalSql
};
