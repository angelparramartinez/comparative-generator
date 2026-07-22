// Guardrails y ensamblado del JSON intermedio revisable por humano (nodos
// A13 "Grounding Guardrail", A19 "Tuning Key Guardrail", A21 "Assemble
// Human-Review JSON" y B3 "Validate Review Completeness" del diseño de Fase
// 4 -- ver plan zippy-weaving-crown.md). Codigo puro, se valida offline
// (run_offline_eval.js, check --review-assembly) antes de construir los
// nodos n8n reales.

const { normalize } = require("./matcher");

// A13: verifica que la decision del LLM de matching (Coverage Match Decision
// Agent) no alucine -- (a) el cover_id elegido debe estar entre los
// candidatos ofrecidos, (b) el excel_quote debe ser substring real
// (normalizado) del texto completo de ese candidato (`cover_full_text`,
// mismo campo que ya construye matcher.buildCandidateIndex). Si falla
// cualquiera, degrada la confianza a "baja" -- nunca descarta en silencio,
// mismo patron de visibilidad que el resto de guardrails del proyecto.
function applyGroundingGuardrail(llmDecision, candidates) {
  if (llmDecision.decision !== "match") {
    return { ...llmDecision, grounding_ok: true };
  }

  const candidate = (candidates || []).find(c => c.cover_id === llmDecision.cover_id);
  if (!candidate) {
    return { ...llmDecision, grounding_ok: false, confidence: "baja", degradation_reason: "cover_id_not_in_candidates" };
  }

  const quoteOk = !!llmDecision.excel_quote &&
    normalize(candidate.cover_full_text || "").includes(normalize(llmDecision.excel_quote));
  if (!quoteOk) {
    return { ...llmDecision, grounding_ok: false, confidence: "baja", degradation_reason: "excel_quote_not_grounded" };
  }

  return { ...llmDecision, grounding_ok: true };
}

// A19: valida que el tuning_key devuelto por el Tuning Key Mapping Agent
// exista realmente en el diccionario de tuning de esa compania, o sea
// "NOT_FOUND" explicito (ya senalado como pendiente en
// tuning_key_matcher_prompt.md). Un tuning_key inventado se degrada a
// NOT_FOUND en vez de colarse en el FILTER_EXPR/HIRING_STATUS_EXPR final.
function applyTuningKeyGuardrail(tuningKey, tuningDictionary) {
  if (tuningKey === "NOT_FOUND") {
    return { tuning_key: "NOT_FOUND", valid: true };
  }
  if (tuningDictionary && Object.prototype.hasOwnProperty.call(tuningDictionary, tuningKey)) {
    return { tuning_key: tuningKey, valid: true };
  }
  return { tuning_key: "NOT_FOUND", valid: false, original_tuning_key: tuningKey, reason: "tuning_key_not_in_dictionary" };
}

// Determina si una entrada necesita revision humana (esquema del JSON
// intermedio, ver plan Fase 4): confianza de matching distinta de "alta",
// grounding fallido, o traduccion de valor de enum parcial
// (value_matcher.translateDependencyValue con fullyTranslated: false).
function computeEntryReviewStatus(entry) {
  const reasons = [];
  if (entry.match && entry.match.confidence && entry.match.confidence !== "alta") {
    reasons.push("match_confidence_not_alta");
  }
  if (entry.match && entry.match.grounding_ok === false) {
    reasons.push("grounding_failed");
  }
  if (entry.value_translation && entry.value_translation.fully_translated === false) {
    reasons.push("value_translation_partial");
  }
  return {
    review_status: reasons.length > 0 ? "needs_review" : "auto_approved",
    review_reasons: reasons
  };
}

// A21: ensambla el JSON intermedio final a partir de los registros por
// cobertura ya generados (generator.buildEntriesForCover + metadatos de
// matching/traduccion/tuning adjuntos a cada entry). coverRecords:
// [{coverId, coverName, coverOverride, entries: [{entry_source, bullet_text,
// modality_id, match, dependencies_raw, dependencies_translated,
// value_translation, filter_expr, hiring_status_expr, value_expr,
// tuning_key, human_decision}], needsReview, reviewReason}].
//
// needsReview/reviewReason (opcional): senal a nivel de COBERTURA, no de
// entry -- para el caso real de bullets heterogeneos entre modalidades
// (buildBulletGroupsForCover, homogeneous:false), donde no hay ningun ENTRY
// que generar automaticamente (0 bloques) pero la cobertura SI necesita
// revision humana. Antes de esto, esas coberturas se descartaban del todo
// del JSON final (bug real confirmado 21/07, cover_id 15/16/21/22/23/104 de
// Generali desaparecian sin dejar rastro).
function assembleHumanReviewJson({ productCompanyId, ramo, sourceFlow2Artifact, sourceExcel, coverRecords, unmatchedDependencies }) {
  const covers = (coverRecords || []).map(cover => {
    const entries = (cover.entries || []).map(entry => {
      const { review_status, review_reasons } = computeEntryReviewStatus(entry);
      return { ...entry, review_status, review_reasons, human_decision: entry.human_decision ?? null };
    });
    const coverReviewReasons = cover.needsReview ? [cover.reviewReason || "structural_review_required"] : [];
    const coverReviewStatus = coverReviewReasons.length > 0 || entries.some(e => e.review_status === "needs_review")
      ? "needs_review"
      : "auto_approved";
    return {
      cover_id: cover.coverId,
      cover_name: cover.coverName,
      cover_override_hiring_status_expr: cover.coverOverride ?? null,
      review_status: coverReviewStatus,
      review_reasons: coverReviewReasons,
      entries
    };
  });

  const totalEntries = covers.reduce((sum, c) => sum + c.entries.length, 0);
  const entriesNeedingReview = covers.reduce(
    (sum, c) => sum + c.entries.filter(e => e.review_status === "needs_review").length,
    0
  );

  return {
    schema_version: "1.0",
    product_company_id: productCompanyId,
    ramo,
    source_flow2_artifact: sourceFlow2Artifact,
    source_excel: sourceExcel,
    summary: {
      total_covers: covers.length,
      covers_needing_review: covers.filter(c => c.review_status === "needs_review").length,
      total_entries: totalEntries,
      entries_needing_review: entriesNeedingReview
    },
    covers,
    unmatched_dependencies: unmatchedDependencies || []
  };
}

// B3: aborta con item de error explicito (nunca rubber-stamp) si queda
// alguna entrada needs_review sin human_decision.action relleno.
function validateReviewCompleteness(reviewJson) {
  const pending = [];
  for (const cover of reviewJson.covers || []) {
    for (const entry of cover.entries || []) {
      if (entry.review_status === "needs_review" && !(entry.human_decision && entry.human_decision.action)) {
        pending.push({ cover_id: cover.cover_id, bullet_text: entry.bullet_text });
      }
    }
  }
  return { complete: pending.length === 0, pending };
}

module.exports = {
  applyGroundingGuardrail,
  applyTuningKeyGuardrail,
  computeEntryReviewStatus,
  assembleHumanReviewJson,
  validateReviewCompleteness
};
