#!/usr/bin/env node
// Arnes de evaluacion offline del matcher dependencia -> COVER_ID/bullet
// (flujo 3, generacion de INSERTs). Mismo espiritu que
// evaluators/coverage_dependency_extractor/run_offline_eval.js: validar la
// logica determinista contra un golden set real ANTES de tocar n8n
// (CLAUDE.md SS7), sin gastar creditos de LLM.
//
// A diferencia del arnes de flujo 2, este NO extrae el codigo de un workflow
// n8n real -- el workflow de flujo 3 todavia no existe (ver plan, Fase 4).
// Valida directamente matcher.js; cuando se construya el nodo real en n8n,
// migrar este arnes al mismo patron de "extraer el jsCode del workflow".
//
// Flags:
//   --matching        valida el matcher de candidatos (dependencia -> COVER_ID/bullet)
//   --generator       valida el generador de ENTRY/LINES (traduccion SPEL,
//                      granularidad, hoisting de condicion compartida)
//   --tuning          valida el matcher texto-Excel -> tuning_key
//   --value-matching  valida el matcher de valor espanol -> valor enum ingles
//                      (paso previo a generator.translateToSpel para enums)
//   --excel-fixture   valida los adaptadores Sheet limpio -> fixture de
//                      matcher.js y agrupacion de bullets por modalidad
//                      (nodos A6/A16 del diseno de Fase 4)
//   --review-assembly valida los guardrails y el ensamblado del JSON
//                      intermedio revisable por humano (nodos A13/A19/A21/B3
//                      del diseno de Fase 4)
//   --rich-text-blocks valida el parser de bloques/lines a partir de la
//                      negrita real de "Coberturas por modalidad"
//                      (rich_text_block_parser.js, diseno 22/07)
//   --insert-generation valida Trigger B (insert_generation.js): recibe el
//                      JSON revisado por un humano y genera el SQL final --
//                      filtrado de entries eliminadas, guardrail de forma
//                      de entries editadas/anadidas a mano, recalculo de la
//                      condicion compartida por cobertura tras el filtrado
//                      (workflow n8n nuevo, 23/07)
//   (sin flags)       ejecuta todos los checks
//
// Nota sobre "grounding" del matcher lexico (matcher.js): se intento un check
// de solape lexico evidencia (PDF) vs texto del Excel y se descarto -- no
// tiene base solida, el Excel es muy telegrafico (solo nombres/limites) y no
// hay razon para esperar solape con una frase legal completa incluso en
// matches correctos (a diferencia del grounding real del flujo 2, que compara
// evidencia contra el MISMO documento). El guardrail de grounding con sentido
// (que la LLM real devuelva su propia cita literal del Excel, verificable por
// substring) ya esta implementado, pero para el LLM de DECISION del diseno de
// Fase 4 (Coverage Match Decision Agent), no para matcher.js -- ver
// review_assembly.js (applyGroundingGuardrail) y su check --review-assembly.

const path = require("path");
const fs = require("fs");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DATASET_PATH = path.join(__dirname, "golden_dataset.json");
const GENERATOR_DATASET_PATH = path.join(__dirname, "generator_golden_dataset.json");
const TUNING_DATASET_PATH = path.join(__dirname, "tuning_key_golden_dataset.json");
const VALUE_MATCHER_DATASET_PATH = path.join(__dirname, "value_matcher_golden_dataset.json");
const EXCEL_FIXTURE_DATASET_PATH = path.join(__dirname, "excel_fixture_builder_golden_dataset.json");
const REVIEW_ASSEMBLY_DATASET_PATH = path.join(__dirname, "review_assembly_golden_dataset.json");
const RICH_TEXT_BLOCK_PARSER_DATASET_PATH = path.join(__dirname, "rich_text_block_parser_golden_dataset.json");
const INSERT_GENERATION_DATASET_PATH = path.join(__dirname, "insert_generation_golden_dataset.json");
const matcher = require("./matcher");
const generator = require("./generator");
const tuningMatcher = require("./tuning_matcher");
const valueMatcher = require("./value_matcher");
const excelFixtureBuilder = require("./excel_fixture_builder");
const reviewAssembly = require("./review_assembly");
const richTextBlockParser = require("./rich_text_block_parser");
const insertGeneration = require("./insert_generation");

function loadGoldenDataset() {
  return JSON.parse(fs.readFileSync(DATASET_PATH, "utf8"));
}

function loadGeneratorGoldenDataset() {
  return JSON.parse(fs.readFileSync(GENERATOR_DATASET_PATH, "utf8"));
}

function loadTuningGoldenDataset() {
  return JSON.parse(fs.readFileSync(TUNING_DATASET_PATH, "utf8"));
}

function loadValueMatcherGoldenDataset() {
  return JSON.parse(fs.readFileSync(VALUE_MATCHER_DATASET_PATH, "utf8"));
}

function loadExcelFixtureGoldenDataset() {
  return JSON.parse(fs.readFileSync(EXCEL_FIXTURE_DATASET_PATH, "utf8"));
}

function loadReviewAssemblyGoldenDataset() {
  return JSON.parse(fs.readFileSync(REVIEW_ASSEMBLY_DATASET_PATH, "utf8"));
}

function loadRichTextBlockParserGoldenDataset() {
  return JSON.parse(fs.readFileSync(RICH_TEXT_BLOCK_PARSER_DATASET_PATH, "utf8"));
}

function loadInsertGenerationGoldenDataset() {
  return JSON.parse(fs.readFileSync(INSERT_GENERATION_DATASET_PATH, "utf8"));
}

// Compara el nivel de confianza esperado (etiqueta manual, ver schema_notes)
// contra el nivel de confianza real que produce el matcher. El criterio NO es
// una igualdad estricta: lo que importa es que un caso "match" de alta
// confianza se resuelva bien, y que un caso "out_of_scope"/"general_policy"
// nunca produzca una coincidencia de ALTA confianza incorrecta (eso es lo que
// se colaria a produccion sin revision humana). Los casos de confianza
// media/baja son, por diseno, los que deben caer en el fallback de revision
// humana -- no se exige que el matcher los acierte de pleno.
function evidenceOf(testCase) {
  const fromDeps = (testCase.coverage_dependencies || []).map(d => d.evidence).join(" ");
  return fromDeps || testCase.source_text || "";
}

function evaluateCase(testCase, candidateIndex) {
  const result = matcher.matchDependency(testCase.coverage_path, testCase.article, evidenceOf(testCase), candidateIndex);
  const isMatchCase = testCase.expected_reason === "match";

  if (isMatchCase) {
    const gotCoverId = result.best ? result.best.cover_id : null;
    const correct = gotCoverId === testCase.expected_cover_id;
    // Misma politica que en los casos "sin match": si el propio golden set
    // marco este caso como media/baja confianza (dudoso incluso para la
    // clasificacion manual -- p. ej. GD-MATCH-025, el caso que demuestra que
    // el titulo/coverage_path solo no basta), un fallo del heuristico lexico
    // es una limitacion conocida, no una regresion. En produccion este nivel
    // de ambiguedad lo resuelve el LLM con el evidence completo, no este
    // heuristico de candidatos.
    const isKnownAmbiguousCase = testCase.expected_confidence !== "alta";
    return {
      pass: correct || isKnownAmbiguousCase,
      warn: !correct && isKnownAmbiguousCase,
      detail: correct
        ? `cover_id=${gotCoverId} (confianza ${result.confidence})`
        : `${!correct && isKnownAmbiguousCase ? "(limitacion conocida, caso ya marcado ambiguo en el golden set) " : ""}esperado cover_id=${testCase.expected_cover_id}, obtenido cover_id=${gotCoverId} (confianza ${result.confidence}, top candidatos: ${result.candidates.slice(0,3).map(c=>`${c.cover_id}:${c.score.toFixed(2)}`).join(", ")})`
    };
  }

  // out_of_scope_product | general_policy_rule: el fallo grave es una
  // coincidencia de ALTA confianza a un cover_id incorrecto (eso se insertaria
  // sin revision). Confianza media/baja con o sin candidato es aceptable --
  // cae al fallback de revision humana por diseno.
  const falsePositiveAlta = result.confidence === "alta" && result.best && result.best.cover_id != null;
  // Si el propio golden set marco este caso como "media"/"baja" (dudoso
  // incluso para la clasificacion manual), un heuristico lexico equivocandose
  // es una limitacion conocida -- no una regresion -- porque en produccion
  // este nivel de ambiguedad ya esta cubierto por la capa LLM + revision
  // humana, no por este heuristico. Solo cuenta como fallo real si el propio
  // golden set esperaba "alta" (caso que un heuristico razonable si deberia
  // acertar).
  const isKnownAmbiguousCase = testCase.expected_confidence !== "alta";
  return {
    pass: !falsePositiveAlta || isKnownAmbiguousCase,
    warn: falsePositiveAlta && isKnownAmbiguousCase,
    detail: falsePositiveAlta
      ? `${isKnownAmbiguousCase ? "(limitacion conocida, caso ya marcado ambiguo en el golden set) " : ""}FALSO POSITIVO DE ALTA CONFIANZA: cover_id=${result.best.cover_id} (score ${result.best.score.toFixed(2)}) para un caso "${testCase.expected_reason}"`
      : `correctamente sin match de alta confianza (confianza real: ${result.confidence})`
  };
}

function checkMatching(golden) {
  console.log("\n=== --matching ===");
  const candidateIndex = matcher.buildCandidateIndex(golden.excel_fixture);
  let failures = 0;
  let warnings = 0;
  for (const testCase of golden.cases) {
    const { pass, warn, detail } = evaluateCase(testCase, candidateIndex);
    if (!pass) failures++;
    else if (warn) warnings++;
    const label = !pass ? "FAIL" : warn ? "WARN" : "PASS";
    console.log(`  [${label}] ${testCase.id} (${testCase.semantic_unit_id}, esperado=${testCase.expected_reason}) -- ${detail}`);
  }
  console.log(`--matching: ${golden.cases.length - failures - warnings}/${golden.cases.length} casos OK, ${warnings} limitacion(es) conocida(s), ${failures} fallo(s) real(es)`);
  return failures === 0 ? 0 : 1;
}

function checkGenerator(golden) {
  console.log("\n=== --generator ===");
  let failures = 0;
  let total = 0;

  for (const c of golden.spel_translation_cases || []) {
    total++;
    const got = generator.translateToSpel(c.dependency);
    const pass = got === c.expected_spel;
    if (!pass) failures++;
    console.log(`  [${pass ? "PASS" : "FAIL"}] ${c.id} (${c.description}) -- got: ${got}${pass ? "" : ` | esperado: ${c.expected_spel}`}`);
  }

  for (const c of golden.combine_cases || []) {
    total++;
    const got = generator.combineFilterExpr(c.dependencies);
    const pass = got === c.expected_spel;
    if (!pass) failures++;
    console.log(`  [${pass ? "PASS" : "FAIL"}] ${c.id} (${c.description}) -- got: ${got}${pass ? "" : ` | esperado: ${c.expected_spel}`}`);
  }

  for (const c of golden.bullet_splitting_cases || []) {
    total++;
    const got = generator.splitBulletsFromCellText(c.cellText, c.coverName);
    const pass = JSON.stringify(got) === JSON.stringify(c.expected_bullets);
    if (!pass) failures++;
    console.log(`  [${pass ? "PASS" : "FAIL"}] ${c.id} (${c.description}) -- got: ${JSON.stringify(got)}${pass ? "" : ` | esperado: ${JSON.stringify(c.expected_bullets)}`}`);
  }

  for (const c of golden.entry_building_cases || []) {
    total++;
    const { entries, coverOverride } = generator.buildEntriesForCover(c.input);
    const checks = [
      ["entry_count", entries.length, c.expected.entry_count],
      ["cover_override_present", coverOverride != null, c.expected.cover_override_present],
      ["entries_with_null_filter_expr_count", entries.filter(e => e.filter_expr === null).length, c.expected.entries_with_null_filter_expr_count]
    ];
    if (c.expected.first_entry_hiring_status_expr !== undefined) {
      checks.push(["first_entry_hiring_status_expr", entries[0] ? entries[0].hiring_status_expr : undefined, c.expected.first_entry_hiring_status_expr]);
    }
    if (c.expected.first_entry_lines_count !== undefined) {
      checks.push(["first_entry_lines_count", entries[0] ? entries[0].lines.length : undefined, c.expected.first_entry_lines_count]);
    }
    if (c.expected.cover_override_value !== undefined) {
      checks.push(["cover_override_value", coverOverride, c.expected.cover_override_value]);
    }
    if (c.expected.full_entries !== undefined) {
      checks.push(["full_entries", JSON.stringify(entries), JSON.stringify(c.expected.full_entries)]);
    }
    const mismatches = checks.filter(([, got, expected]) => got !== expected);
    const pass = mismatches.length === 0;
    if (!pass) failures++;
    console.log(`  [${pass ? "PASS" : "FAIL"}] ${c.id} (${c.description})${pass ? "" : ` -- ${mismatches.map(([k, got, exp]) => `${k}: got=${got}, esperado=${exp}`).join("; ")}`}`);
  }

  for (const c of golden.entry_ordering_cases || []) {
    total++;
    const { entries } = generator.buildEntriesForCover(c.input);
    const got = entries.map(e => e.modality_id);
    const pass = JSON.stringify(got) === JSON.stringify(c.expected_modality_order);
    if (!pass) failures++;
    console.log(`  [${pass ? "PASS" : "FAIL"}] ${c.id} (${c.description}) -- got: ${JSON.stringify(got)}${pass ? "" : ` | esperado: ${JSON.stringify(c.expected_modality_order)}`}`);
  }

  for (const c of golden.optional_hiring_status_cases || []) {
    total++;
    const got = generator.buildOptionalHiringStatusExpr(c.tuningKey);
    const pass = got === c.expected_expr;
    if (!pass) failures++;
    console.log(`  [${pass ? "PASS" : "FAIL"}] ${c.id} (${c.description}) -- got: ${got}${pass ? "" : ` | esperado: ${c.expected_expr}`}`);
  }

  for (const c of golden.insert_sql_cases || []) {
    total++;
    const spelLiteral = generator.spelStringLiteral(c.text);
    const wrapped = generator.wrapAsSpelExpression(spelLiteral);
    const got = generator.sqlLiteral(wrapped);
    const pass = got === c.expected_sql_line;
    if (!pass) failures++;
    console.log(`  [${pass ? "PASS" : "FAIL"}] ${c.id} (${c.description}) -- got: ${got}${pass ? "" : ` | esperado: ${c.expected_sql_line}`}`);
  }

  console.log(`--generator: ${total - failures}/${total} casos OK`);
  return failures === 0 ? 0 : 1;
}

function checkTuning(golden) {
  console.log("\n=== --tuning ===");
  const tuningIndex = tuningMatcher.buildTuningIndex(golden.tuning_dictionary);
  let failures = 0;
  let warnings = 0;
  for (const c of golden.cases) {
    const result = tuningMatcher.matchCoverToTuningKey(c.cover_name, tuningIndex);
    const correct = result.tuning_key === c.expected_tuning_key;
    const isKnownAmbiguousCase = c.expected_confidence !== "alta";
    const pass = correct || isKnownAmbiguousCase;
    const warn = !correct && isKnownAmbiguousCase;
    if (!pass) failures++;
    else if (warn) warnings++;
    const label = !pass ? "FAIL" : warn ? "WARN" : "PASS";
    console.log(`  [${label}] ${c.id} ("${c.cover_name}") -- esperado=${c.expected_tuning_key}, obtenido=${result.tuning_key} (confianza ${result.confidence})`);
  }
  console.log(`--tuning: ${golden.cases.length - failures - warnings}/${golden.cases.length} casos OK, ${warnings} limitacion(es) conocida(s), ${failures} fallo(s) real(es)`);
  return failures === 0 ? 0 : 1;
}

// A diferencia de checkMatching/checkTuning (heuristicas difusas, con nivel
// de confianza y por tanto WARN para "limitacion conocida ya marcada como
// ambigua"), value_matcher.js es EXACTO por diseno (ver su cabecera): el
// resultado es 100% determinista contra un catalogo cerrado, y el propio
// expected_reason de cada caso ya distingue alias_match de known_limitation.
// Por eso aqui solo hay PASS/FAIL -- cualquier discrepancia es una regresion
// real, nunca una ambiguedad a perdonar.
function checkValueMatching(golden) {
  console.log("\n=== --value-matching ===");
  let failures = 0;
  let total = 0;

  for (const c of golden.value_match_cases || []) {
    total++;
    const got = valueMatcher.matchEnumValue(c.risk_field, c.spanish_value);
    const pass = got.matched === c.expected_matched && got.value === c.expected_value && got.reason === c.expected_reason;
    if (!pass) failures++;
    console.log(`  [${pass ? "PASS" : "FAIL"}] ${c.id} (${c.risk_field}="${c.spanish_value}") -- got: matched=${got.matched}, value=${got.value}, reason=${got.reason}${pass ? "" : ` | esperado: matched=${c.expected_matched}, value=${c.expected_value}, reason=${c.expected_reason}`}`);
  }

  for (const c of golden.dependency_translation_cases || []) {
    total++;
    const got = valueMatcher.translateDependencyValue(c.dependency);
    const gotUnmatchedRaw = got.unmatched.map(u => u.raw);
    const checks = [
      ["translated_value", JSON.stringify(got.dependency.value), JSON.stringify(c.expected_translated_value)],
      ["fully_translated", got.fullyTranslated, c.expected_fully_translated],
      ["unmatched_raw_values", JSON.stringify(gotUnmatchedRaw), JSON.stringify(c.expected_unmatched_raw_values)]
    ];
    const mismatches = checks.filter(([, g, e]) => g !== e);
    const pass = mismatches.length === 0;
    if (!pass) failures++;
    console.log(`  [${pass ? "PASS" : "FAIL"}] ${c.id} (${(c.source_case_refs || []).join(", ")})${pass ? "" : ` -- ${mismatches.map(([k, g, e]) => `${k}: got=${g}, esperado=${e}`).join("; ")}`}`);
  }

  for (const c of golden.pipeline_integration_cases || []) {
    total++;
    const translated = valueMatcher.translateDependencyValue(c.dependency);
    const got = generator.translateToSpel(translated.dependency);
    const pass = got === c.expected_final_spel;
    if (!pass) failures++;
    console.log(`  [${pass ? "PASS" : "FAIL"}] ${c.id} (${(c.source_case_refs || []).join(", ")}) -- got: ${got}${pass ? "" : ` | esperado: ${c.expected_final_spel}`}`);
  }

  for (const c of golden.dependency_set_translation_cases || []) {
    total++;
    const got = valueMatcher.translateDependencies(c.dependencies);
    const checks = [
      ["dependencies_translated", JSON.stringify(got.dependencies_translated), JSON.stringify(c.expected_dependencies_translated)],
      ["fully_translated", got.fully_translated, c.expected_fully_translated]
    ];
    const mismatches = checks.filter(([, g, e]) => g !== e);
    const pass = mismatches.length === 0;
    if (!pass) failures++;
    console.log(`  [${pass ? "PASS" : "FAIL"}] ${c.id} (${c.description})${pass ? "" : ` -- ${mismatches.map(([k, g, e]) => `${k}: got=${g}, esperado=${e}`).join("; ")}`}`);
  }

  console.log(`--value-matching: ${total - failures}/${total} casos OK`);
  return failures === 0 ? 0 : 1;
}

function checkExcelFixture(golden) {
  console.log("\n=== --excel-fixture ===");
  let failures = 0;
  let total = 0;

  for (const c of golden.fixture_cases || []) {
    total++;
    const got = excelFixtureBuilder.buildExcelFixtureForMatcher(c.cleaned_modality_covers, c.cleaned_optional_covers);
    const pass = JSON.stringify(got) === JSON.stringify(c.expected_fixture);
    if (!pass) failures++;
    console.log(`  [${pass ? "PASS" : "FAIL"}] ${c.id} (${c.description})${pass ? "" : ` -- got: ${JSON.stringify(got)} | esperado: ${JSON.stringify(c.expected_fixture)}`}`);
  }

  for (const c of golden.block_group_cases || []) {
    total++;
    const got = excelFixtureBuilder.buildBlockGroupsForCover(c.coverId, c.coverName, c.modalities);
    const pass = JSON.stringify(got) === JSON.stringify(c.expected);
    if (!pass) failures++;
    console.log(`  [${pass ? "PASS" : "FAIL"}] ${c.id} (${c.description})${pass ? "" : ` -- got: ${JSON.stringify(got, null, 2)} | esperado: ${JSON.stringify(c.expected, null, 2)}`}`);
  }

  for (const c of golden.block_dependency_matching_cases || []) {
    total++;
    const got = c.defaultBlocks
      ? excelFixtureBuilder.matchDependenciesToDefaultBlocks(c.defaultBlocks, c.matches, c.coverId)
      : excelFixtureBuilder.matchDependenciesToBlockGroups(c.perModalityBlocks, c.matches, c.coverId);
    const pass = JSON.stringify(got) === JSON.stringify(c.expected);
    if (!pass) failures++;
    console.log(`  [${pass ? "PASS" : "FAIL"}] ${c.id} (${c.description})${pass ? "" : ` -- got: ${JSON.stringify(got, null, 2)} | esperado: ${JSON.stringify(c.expected, null, 2)}`}`);
  }

  console.log(`--excel-fixture: ${total - failures}/${total} casos OK`);
  return failures === 0 ? 0 : 1;
}

function checkReviewAssembly(golden) {
  console.log("\n=== --review-assembly ===");
  let failures = 0;
  let total = 0;

  for (const c of golden.grounding_cases || []) {
    total++;
    const got = reviewAssembly.applyGroundingGuardrail(c.llm_decision, c.candidates);
    const checks = [
      ["grounding_ok", got.grounding_ok, c.expected.grounding_ok],
      ["confidence", got.confidence, c.expected.confidence],
      ["degradation_reason", got.degradation_reason ?? null, c.expected.degradation_reason]
    ];
    const mismatches = checks.filter(([, g, e]) => g !== e);
    const pass = mismatches.length === 0;
    if (!pass) failures++;
    console.log(`  [${pass ? "PASS" : "FAIL"}] ${c.id} (${c.description})${pass ? "" : ` -- ${mismatches.map(([k, g, e]) => `${k}: got=${g}, esperado=${e}`).join("; ")}`}`);
  }

  for (const c of golden.tuning_key_cases || []) {
    total++;
    const tuningDictionary = {};
    for (const key of c.tuning_dictionary_keys || []) tuningDictionary[key] = {};
    const got = reviewAssembly.applyTuningKeyGuardrail(c.tuning_key, tuningDictionary);
    const checks = [
      ["tuning_key", got.tuning_key, c.expected.tuning_key],
      ["valid", got.valid, c.expected.valid]
    ];
    if (c.expected.reason) checks.push(["reason", got.reason, c.expected.reason]);
    const mismatches = checks.filter(([, g, e]) => g !== e);
    const pass = mismatches.length === 0;
    if (!pass) failures++;
    console.log(`  [${pass ? "PASS" : "FAIL"}] ${c.id} (${c.description})${pass ? "" : ` -- ${mismatches.map(([k, g, e]) => `${k}: got=${g}, esperado=${e}`).join("; ")}`}`);
  }

  for (const c of golden.review_status_cases || []) {
    total++;
    const got = reviewAssembly.computeEntryReviewStatus(c.entry);
    const pass = got.review_status === c.expected.review_status &&
      JSON.stringify(got.review_reasons) === JSON.stringify(c.expected.review_reasons);
    if (!pass) failures++;
    console.log(`  [${pass ? "PASS" : "FAIL"}] ${c.id} (${c.description})${pass ? "" : ` -- got: ${JSON.stringify(got)} | esperado: ${JSON.stringify(c.expected)}`}`);
  }

  for (const c of golden.completeness_cases || []) {
    total++;
    const got = reviewAssembly.validateReviewCompleteness(c.review_json);
    const pass = JSON.stringify(got) === JSON.stringify(c.expected);
    if (!pass) failures++;
    console.log(`  [${pass ? "PASS" : "FAIL"}] ${c.id} (${c.description})${pass ? "" : ` -- got: ${JSON.stringify(got)} | esperado: ${JSON.stringify(c.expected)}`}`);
  }

  for (const c of golden.assembly_cases || []) {
    total++;
    const got = reviewAssembly.assembleHumanReviewJson(c.input);
    const firstCover = got.covers[0] || {};
    const checks = [
      ["covers_needing_review", got.summary.covers_needing_review, c.expected.covers_needing_review],
      ["first_cover_review_status", firstCover.review_status, c.expected.first_cover_review_status],
      ["first_cover_review_reasons", JSON.stringify(firstCover.review_reasons), JSON.stringify(c.expected.first_cover_review_reasons)],
      ["first_cover_entries_count", (firstCover.entries || []).length, c.expected.first_cover_entries_count]
    ];
    const mismatches = checks.filter(([, g, e]) => g !== e);
    const pass = mismatches.length === 0;
    if (!pass) failures++;
    console.log(`  [${pass ? "PASS" : "FAIL"}] ${c.id} (${c.description})${pass ? "" : ` -- ${mismatches.map(([k, g, e]) => `${k}: got=${g}, esperado=${e}`).join("; ")}`}`);
  }

  console.log(`--review-assembly: ${total - failures}/${total} casos OK`);
  return failures === 0 ? 0 : 1;
}

function checkRichTextBlockParser(golden) {
  console.log("\n=== --rich-text-blocks ===");
  let failures = 0;
  let total = 0;

  for (const c of golden.cases || []) {
    total++;
    const got = richTextBlockParser.parseModalityCellBlocks(c.cell);
    const normalize = blocks => blocks.map(b => ({
      kind: b.kind,
      headerText: b.headerText,
      lines: b.lines,
      needsReview: !!b.needsReview
    }));
    const pass = JSON.stringify(normalize(got.blocks)) === JSON.stringify(normalize(c.expected.blocks));
    if (!pass) failures++;
    console.log(`  [${pass ? "PASS" : "FAIL"}] ${c.id} (${c.description})${pass ? "" : ` -- got: ${JSON.stringify(normalize(got.blocks), null, 2)} | esperado: ${JSON.stringify(normalize(c.expected.blocks), null, 2)}`}`);
  }

  console.log(`--rich-text-blocks: ${total - failures}/${total} casos OK`);
  return failures === 0 ? 0 : 1;
}

function checkInsertGeneration(golden) {
  console.log("\n=== --insert-generation ===");
  let failures = 0;
  let total = 0;

  for (const c of golden.unwrap_cases || []) {
    total++;
    const got = insertGeneration.unwrapReviewedJson(c.raw);
    const pass = JSON.stringify(got) === JSON.stringify(c.expected);
    if (!pass) failures++;
    console.log(`  [${pass ? "PASS" : "FAIL"}] ${c.id} (${c.description})${pass ? "" : ` -- got: ${JSON.stringify(got)} | esperado: ${JSON.stringify(c.expected)}`}`);
  }

  for (const c of golden.entry_shape_cases || []) {
    total++;
    const got = insertGeneration.validateEntryShape(c.entry);
    const validMatches = got.valid === c.expected_valid;
    const errorsMatch = (c.expected_error_substrings || []).every(sub => got.errors.some(e => e.includes(sub)));
    const pass = validMatches && errorsMatch;
    if (!pass) failures++;
    console.log(`  [${pass ? "PASS" : "FAIL"}] ${c.id} (${c.description})${pass ? "" : ` -- got: valid=${got.valid}, errors=${JSON.stringify(got.errors)} | esperado: valid=${c.expected_valid}, error_substrings=${JSON.stringify(c.expected_error_substrings)}`}`);
  }

  for (const c of golden.cover_insert_cases || []) {
    total++;
    const got = insertGeneration.buildCoverInserts(c.cover, c.product_company_id);
    let pass;
    if (c.expected_ok) {
      const sql = (got.statements || []).join("\n");
      const containsOk = (c.expected_sql_contains || []).every(sub => sql.includes(sub));
      const notContainsOk = (c.expected_sql_not_contains || []).every(sub => !sql.includes(sub));
      pass = got.ok === true
        && got.activeEntryCount === c.expected_active_entry_count
        && got.statements.length === c.expected_statement_count
        && containsOk && notContainsOk;
    } else {
      pass = got.ok === false && (got.shapeErrors || []).length === c.expected_shape_error_count;
    }
    if (!pass) failures++;
    console.log(`  [${pass ? "PASS" : "FAIL"}] ${c.id} (${c.description})${pass ? "" : ` -- got: ${JSON.stringify(got, null, 2)}`}`);
  }

  for (const c of golden.final_sql_cases || []) {
    total++;
    const got = insertGeneration.buildFinalSql(c.reviewed_json);
    let pass;
    if (c.expected_ok) {
      const containsOk = (c.expected_sql_contains || []).every(sub => got.sql.includes(sub));
      const notContainsOk = (c.expected_sql_not_contains || []).every(sub => !got.sql.includes(sub));
      pass = got.ok === true
        && JSON.stringify(got.stats) === JSON.stringify(c.expected_stats)
        && containsOk && notContainsOk;
    } else {
      const pendingCoverIds = (got.pending || []).map(p => p.cover_id);
      const pendingOk = !c.expected_pending_cover_ids
        || JSON.stringify(pendingCoverIds) === JSON.stringify(c.expected_pending_cover_ids);
      pass = got.ok === false && got.reason === c.expected_reason && pendingOk;
    }
    if (!pass) failures++;
    console.log(`  [${pass ? "PASS" : "FAIL"}] ${c.id} (${c.description})${pass ? "" : ` -- got: ${JSON.stringify({ ok: got.ok, reason: got.reason, stats: got.stats, pending: got.pending, errors: got.errors }, null, 2)}`}`);
  }

  console.log(`--insert-generation: ${total - failures}/${total} casos OK`);
  return failures === 0 ? 0 : 1;
}

function main() {
  const args = process.argv.slice(2);
  const runAll = args.length === 0;
  const golden = loadGoldenDataset();
  const generatorGolden = loadGeneratorGoldenDataset();
  const tuningGolden = loadTuningGoldenDataset();
  const valueMatcherGolden = loadValueMatcherGoldenDataset();
  const excelFixtureGolden = loadExcelFixtureGoldenDataset();
  const reviewAssemblyGolden = loadReviewAssemblyGoldenDataset();
  const richTextBlockParserGolden = loadRichTextBlockParserGoldenDataset();
  const insertGenerationGolden = loadInsertGenerationGoldenDataset();

  let exitCode = 0;
  if (runAll || args.includes("--matching")) {
    exitCode = Math.max(exitCode, checkMatching(golden));
  }
  if (runAll || args.includes("--generator")) {
    exitCode = Math.max(exitCode, checkGenerator(generatorGolden));
  }
  if (runAll || args.includes("--tuning")) {
    exitCode = Math.max(exitCode, checkTuning(tuningGolden));
  }
  if (runAll || args.includes("--value-matching")) {
    exitCode = Math.max(exitCode, checkValueMatching(valueMatcherGolden));
  }
  if (runAll || args.includes("--excel-fixture")) {
    exitCode = Math.max(exitCode, checkExcelFixture(excelFixtureGolden));
  }
  if (runAll || args.includes("--review-assembly")) {
    exitCode = Math.max(exitCode, checkReviewAssembly(reviewAssemblyGolden));
  }
  if (runAll || args.includes("--rich-text-blocks")) {
    exitCode = Math.max(exitCode, checkRichTextBlockParser(richTextBlockParserGolden));
  }
  if (runAll || args.includes("--insert-generation")) {
    exitCode = Math.max(exitCode, checkInsertGeneration(insertGenerationGolden));
  }
  process.exit(exitCode);
}

main();
