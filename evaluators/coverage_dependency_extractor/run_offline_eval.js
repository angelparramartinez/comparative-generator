// Arnes de evaluacion offline para coverage_rules_extraction_GGCC (Fase 0 del plan).
// Extrae el jsCode tal cual del workflow real -- nunca mantiene una copia duplicada
// que se pueda desincronizar -- y lo ejecuta contra los fixtures de golden_dataset.json.
//
// Uso:
//   node run_offline_eval.js              -> corre todos los checks disponibles (ramo Hogar)
//   node run_offline_eval.js --ramo=auto  -> mismos checks contra el golden set/ontologia
//     de Autos (golden_dataset_auto.json / valid_risk_fields_auto.json / ontology-auto.md)
//     -- combinable con cualquier otro flag, p.ej. --ramo=auto --hallucination
//   node run_offline_eval.js --chunking   -> solo el check de chunking_boundary
//   node run_offline_eval.js --hallucination -> solo el check de risk_field invalidos/guardrail
//   node run_offline_eval.js --value-type -> solo el check de tipo de "value" vs data_type (Guardrail v4)
//   node run_offline_eval.js --ontology   -> solo el check de alias_match / negative_aliases
//   node run_offline_eval.js --chunk-matching -> solo el check de matching por chunk (Fase 4)
//   node run_offline_eval.js --cost-prefilter -> solo el check de la garantia del pre-filtro de coste (Fase 5)
//   node run_offline_eval.js --evidence-grounding -> solo el check de evidence literal (Guardrail v3)
//   node run_offline_eval.js --hierarchy -> solo el check de deteccion de "article" (nivel 1)
//   node run_offline_eval.js --watermark -> solo el check de eliminacion de marca de agua fusionada (ast walker)
//   node run_offline_eval.js --transversal-chapter -> solo el check de visibilidad de capitulos transversales (Guardrail v5)
//   node run_offline_eval.js --procedural-instruction -> solo el check de visibilidad de instrucciones operativas/procedimentales (Guardrail v6)
//   node run_offline_eval.js --figure-aliases -> solo el check de contaminacion de alias de figura (Merge Shared Texts Into Ramo) -- --ramo=auto unicamente
//   node run_offline_eval.js --vocab-gaps -> solo el check de gaps de vocabulario ya corregidos en las ontologias (alias literales que faltaban)
//
// Checks disponibles hoy (antes de aplicar ninguna fase del plan):
//   - chunking: valida Rule Chunker contra los casos chunking_boundary (documenta el bug conocido de la Fase 3)
//   - hallucination: valida actual_coverage_dependencies contra valid_risk_fields.json,
//     y contra el nodo "Coverage Dependency Risk Field Guardrail" si ya existe en el workflow (Fase 1)
//   - value-type: verifica que "Coverage Dependency Risk Field Guardrail" (v4) rechaza
//     dependencias cuyo "value" tiene un tipo incompatible con el data_type real del
//     campo (p.ej. un alias de texto usado como valor de un campo integer), algo que
//     el chequeo de operador/data_type de la v1 no detecta porque el operador en si
//     puede ser valido -- hallado el 2026-07-17 en un caso real de Santalucia
//     ("specialValueObjects = colecciones")
//   - ontology: parsea knowledge/ontologies/ontology-home.md con el codigo real de
//     "Ontology Splitter" (n8n/workflows/ontology indexing.json) y ejecuta
//     "Ontology Relevance Filter" contra alias_match_expectations del golden set (Fase 2)
//   - cost-prefilter: verifica que "Legal Cue Pre-Filter" nunca descarta una unidad
//     que en alguna de las ejecuciones reales persistidas (ggcc_outputs/) termino
//     generando dependencias -- la garantia formal de la Fase 5
//   - evidence-grounding: verifica que "Coverage Dependency Risk Field Guardrail" (v3)
//     marca como unverified_evidence_dependencies los casos evidence_grounding_regression
//     (evidence truncada con "...", union de fragmentos no contiguos, o citas del
//     coverage_context en vez del propio chunk) -- hallado el 2026-07-16
//   - hierarchy: verifica que "Hierarchy Builder" / "Semantic Assembler" asignan
//     correctamente el "article" (division de nivel 1) tanto cuando el documento usa
//     la convencion "Articulo Nº"/"Articulo Preliminar" (Generali) como cuando no usa
//     ninguna "Articulo" y numera sus divisiones principales de forma simple, tipo
//     "7. Titulo" (Occident) -- hallado el 2026-07-16 al probar Occident (article=None
//     en todas las unidades)
//   - watermark: verifica que "ast walker" elimina, por repeticion (>=3 bloques),
//     fragmentos de una marca de agua de borrador fusionada linea a linea con el
//     texto real via \r\n -- hallado el 2026-07-17 en Occident (persiste igual con
//     dlparse_v4 y con pypdfium2, no es un problema del pdf_backend). Sin lista de
//     literales hardcodeados: la señal es solo repeticion + mayusculas, generico
//     para cualquier compania con un artefacto similar.

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOW_PATH = path.join(
  REPO_ROOT,
  "n8n",
  "workflows",
  "coverage rules extraction GGCC.json"
);
const ONTOLOGY_WORKFLOW_PATH = path.join(
  REPO_ROOT,
  "n8n",
  "workflows",
  "ontology indexing.json"
);
// --ramo=home (default) | --ramo=auto -- selecciona el fichero de ontologia,
// el golden set y el catalogo de risk_field validos del ramo correspondiente.
// No cambia WORKFLOW_PATH/ONTOLOGY_WORKFLOW_PATH: el codigo de los nodos es
// el mismo para todos los ramos (no esta scopeado por ontology_type).
const RAMO_ONTOLOGY_MD = {
  home: "ontology-home.md",
  auto: "ontology-auto.md"
};
const RAMO_GOLDEN_DATASET = {
  home: "golden_dataset.json",
  auto: "golden_dataset_auto.json"
};
const RAMO_VALID_RISK_FIELDS = {
  home: "valid_risk_fields.json",
  auto: "valid_risk_fields_auto.json"
};
let ONTOLOGY_MD_PATH = path.join(
  REPO_ROOT,
  "knowledge",
  "ontologies",
  RAMO_ONTOLOGY_MD.home
);
let GOLDEN_PATH = path.join(__dirname, RAMO_GOLDEN_DATASET.home);
let VALID_RISK_FIELDS_PATH = path.join(__dirname, RAMO_VALID_RISK_FIELDS.home);
const GGCC_OUTPUTS_DIR = path.join(REPO_ROOT, "ggcc_outputs");
const REAL_RUN_FILES = [
  "coverage_matcher_contract_2026-06-12T12-03-35-891Z.json",
  "coverage_matcher_contract_2026-07-15T12-52-00-850Z.json",
  "coverage_matcher_contract_2026-07-15T13-25-51-018Z.json",
  // Autos / Divina Seguros (26/08) -- la garantia del pre-filtro de coste es
  // generica entre ramos, se valida contra todas las ejecuciones reales
  // conocidas, no solo las de Hogar.
  "coverage_matcher_contract_2026-08-26T12-16-28-186Z.json",
  // Autos / Divina Seguros (27/08) -- dos ejecuciones reales mas, antes y
  // despues del fix de contaminacion de alias de figura + guardrail
  // transversal-chapter (ver golden_dataset_auto.json).
  "coverage_matcher_contract_2026-08-27T06-58-13-642Z.json",
  "coverage_matcher_contract_2026-08-27T08-12-49-393Z.json"
];

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function findNode(workflow, name) {
  return workflow.nodes.find(n => n.name === name) || null;
}

// Mock de $getWorkflowStaticData("global") de n8n -- un unico objeto
// compartido durante toda la ejecucion del arnes (replica que en n8n real
// persiste por workflow, no por ejecucion individual). Ningun check actual
// depende de que dos nodos distintos compartan datos aqui (Hierarchy
// Builder y Build Coverage Matcher Contract se prueban por separado); esto
// solo evita que un nodo que lo usa (p.ej. indice_diagnostics, 30/07) rompa
// al ejecutarse aislado en este arnes.
const mockWorkflowStaticData = {};
function $getWorkflowStaticData() {
  return mockWorkflowStaticData;
}

// Envuelve el jsCode de un Code node de n8n respetando su modo de ejecucion
// declarado (runOnceForAllItems por defecto, o runOnceForEachItem).
function wrapCodeNode(node) {
  const code = node.parameters.jsCode;
  const mode = node.parameters.mode || "runOnceForAllItems";

  if (mode === "runOnceForEachItem") {
    const fn = new Function("$json", "$getWorkflowStaticData", code);
    return { mode, runOnItems: jsonInputs => jsonInputs.map(j => fn(j, $getWorkflowStaticData).json) };
  }

  // n8n expone $json (bound al primer item) incluso en modo "runOnceForAllItems"
  // -- Ontology Splitter depende de eso, asi que se replica aqui. Tambien expone
  // $input.first()/$input.all() -- Hierarchy Builder y ast walker dependen de eso.
  const fn = new Function("items", "$json", "$input", "$getWorkflowStaticData", code);
  return {
    mode,
    runOnItems: jsonInputs => {
      const items = jsonInputs.map(j => ({ json: j }));
      const $input = { first: () => items[0], all: () => items };
      const result = fn(items, items[0]?.json, $input, $getWorkflowStaticData);
      return result.map(r => r.json);
    }
  };
}

function runNode(workflow, nodeName, jsonInputs) {
  const node = findNode(workflow, nodeName);
  if (!node) return null;
  return wrapCodeNode(node).runOnItems(jsonInputs);
}

function checkChunking(workflow, golden) {
  console.log("\n=== Check: chunking_boundary (nodo Rule Chunker) ===");

  const cases = golden.cases.filter(c => c.category === "chunking_boundary");
  let failures = 0;

  for (const c of cases) {
    const [result] = runNode(workflow, "Rule Chunker", [
      {
        semantic_unit: { id: c.semantic_unit_ref, text: c.source_text },
        semantic_unit_id: c.semantic_unit_ref,
        ontology_matches: []
      }
    ]);

    const chunkCount = result.chunk_count;
    let ok = true;
    if (c.min_expected_chunks !== undefined && chunkCount < c.min_expected_chunks) ok = false;
    if (c.max_expected_chunks !== undefined && chunkCount > c.max_expected_chunks) ok = false;

    if (!ok) failures++;
    console.log(
      `${ok ? "PASS" : "FAIL"} ${c.id} (${c.semantic_unit_ref}): chunk_count=${chunkCount}` +
        (c.min_expected_chunks !== undefined ? ` min_expected=${c.min_expected_chunks}` : "") +
        (c.max_expected_chunks !== undefined ? ` max_expected=${c.max_expected_chunks}` : "")
    );
  }

  console.log(`Resultado: ${cases.length - failures}/${cases.length} pasan.`);
  return failures;
}

function checkHallucination(workflow, golden, validRiskFields) {
  console.log("\n=== Check: risk_field invalidos / guardrail ===");

  const validSet = new Set(validRiskFields.valid_risk_fields);
  const guardrailNode = findNode(workflow, "Coverage Dependency Risk Field Guardrail");

  if (!guardrailNode) {
    console.log(
      "Nodo 'Coverage Dependency Risk Field Guardrail' todavia no existe en el workflow (Fase 1 pendiente)."
    );
    console.log("Chequeo estatico contra valid_risk_fields.json sobre actual_coverage_dependencies:\n");
  }

  let invalidFound = 0;
  let missedByGuardrailDesign = 0;

  for (const c of golden.cases) {
    const deps = c.actual_coverage_dependencies || [];
    for (const dep of deps) {
      const isValid = validSet.has(dep.risk_field);
      if (!isValid) {
        invalidFound++;
        console.log(
          `INVALIDO  ${c.id} (${c.semantic_unit_ref}): risk_field="${dep.risk_field}" no existe en la ontologia`
        );
      } else if (c.subtype === "wrong_field_misuse") {
        missedByGuardrailDesign++;
        console.log(
          `VALIDO-PERO-INCORRECTO ${c.id} (${c.semantic_unit_ref}): risk_field="${dep.risk_field}" existe en catalogo pero es semanticamente incorrecto -- el guardrail de la Fase 1 NO lo detecta por diseno, requiere la Fase 2 (huecos de alias)`
        );
      }
    }
  }

  console.log(
    `\nResultado: ${invalidFound} dependencia(s) con risk_field fuera de catalogo, ${missedByGuardrailDesign} dependencia(s) con risk_field valido pero mal aplicado (fuera de alcance del guardrail).`
  );

  if (guardrailNode) {
    console.log("\nEjecutando el guardrail real contra los casos con dependencias...");
    for (const c of golden.cases) {
      if (!c.actual_coverage_dependencies || !c.actual_coverage_dependencies.length) continue;
      const [result] = runNode(workflow, "Coverage Dependency Risk Field Guardrail", [
        { semantic_unit_id: c.semantic_unit_ref, output: { coverage_dependencies: c.actual_coverage_dependencies } }
      ]);
      console.log(
        `${c.id}: accepted=${(result.output?.coverage_dependencies || []).length} rejected=${(result.rejected_dependencies || []).length} ungrounded=${(result.ungrounded_dependencies || []).length}`
      );
    }
  }

  return invalidFound;
}

function checkValueTypeValidation(workflow, golden) {
  console.log("\n=== Check: value_type_regression (nodo Coverage Dependency Risk Field Guardrail v4) ===");

  const cases = golden.cases.filter(c => c.category === "value_type_regression");

  if (!findNode(workflow, "Coverage Dependency Risk Field Guardrail")) {
    console.log("Nodo 'Coverage Dependency Risk Field Guardrail' no encontrado -- check omitido.");
    return 0;
  }

  let failures = 0;

  for (const c of cases) {
    const [result] = runNode(workflow, "Coverage Dependency Risk Field Guardrail", [
      { semantic_unit_id: c.semantic_unit_ref, output: { coverage_dependencies: c.actual_coverage_dependencies } }
    ]);

    const rejectedFields = (result.rejected_dependencies || [])
      .filter(d => d.rejection_reason === "value_type_incompatible_with_data_type")
      .map(d => d.risk_field);
    const expectedRejected = c.expected_rejected_by_value_type || [];

    const ok =
      rejectedFields.length === expectedRejected.length &&
      expectedRejected.every(f => rejectedFields.includes(f));

    if (!ok) failures++;

    console.log(
      `${ok ? "PASS" : "FAIL"} ${c.id} (${c.semantic_unit_ref}): rechazados_por_tipo=${JSON.stringify(rejectedFields)} (esperado ${JSON.stringify(expectedRejected)})`
    );

    const acceptedFields = (result.output?.coverage_dependencies || []).map(d => d.risk_field);
    const shouldStillAccept = (c.actual_coverage_dependencies || [])
      .map(d => d.risk_field)
      .filter(f => !expectedRejected.includes(f));
    const acceptOk = shouldStillAccept.every(f => acceptedFields.includes(f));

    if (!acceptOk) {
      failures++;
      console.log(`  FAIL adicional: se esperaba que ${JSON.stringify(shouldStillAccept)} siguiera aceptado, aceptados=${JSON.stringify(acceptedFields)}`);
    }
  }

  console.log(`Resultado: ${cases.length - failures}/${cases.length} pasan.`);
  return failures;
}

function checkEvidenceGrounding(workflow, golden) {
  console.log("\n=== Check: evidence_grounding_regression (nodo Coverage Dependency Risk Field Guardrail) ===");

  const cases = golden.cases.filter(c => c.category === "evidence_grounding_regression");

  if (!findNode(workflow, "Coverage Dependency Risk Field Guardrail")) {
    console.log("Nodo 'Coverage Dependency Risk Field Guardrail' no encontrado -- check omitido.");
    return 0;
  }

  let failures = 0;

  for (const c of cases) {
    const [result] = runNode(workflow, "Coverage Dependency Risk Field Guardrail", [
      {
        semantic_unit_id: c.semantic_unit_ref,
        chunks: [{ chunk_id: `${c.id}_c1`, text: c.source_text }],
        output: { coverage_dependencies: c.actual_coverage_dependencies },
        unit_ontology_matches: []
      }
    ]);

    const flagged = (result.unverified_evidence_dependencies || []).map(d => d.evidence);
    const expected = c.expected_unverified_evidence || [];

    const ok =
      flagged.length === expected.length &&
      expected.every(e => flagged.includes(e));

    if (!ok) failures++;

    console.log(
      `${ok ? "PASS" : "FAIL"} ${c.id} (${c.semantic_unit_ref}): unverified_evidence=${flagged.length} (esperado ${expected.length})`
    );
    if (!ok) {
      console.log("  flagged :", JSON.stringify(flagged));
      console.log("  expected:", JSON.stringify(expected));
    }
  }

  console.log(`Resultado: ${cases.length - failures}/${cases.length} pasan.`);
  return failures;
}

function checkTransversalChapterVisibility(workflow, golden, validRiskFields) {
  console.log("\n=== Check: transversal_chapter_dependencies (nodo Coverage Dependency Risk Field Guardrail v5) ===");

  const cases = golden.cases.filter(c => c.expected_transversal_chapter_flagged !== undefined);
  const validRiskFieldSet = new Set(validRiskFields.valid_risk_fields || []);

  if (!findNode(workflow, "Coverage Dependency Risk Field Guardrail")) {
    console.log("Nodo 'Coverage Dependency Risk Field Guardrail' no encontrado -- check omitido.");
    return 0;
  }

  let failures = 0;

  for (const c of cases) {
    const [result] = runNode(workflow, "Coverage Dependency Risk Field Guardrail", [
      {
        semantic_unit_id: c.semantic_unit_ref,
        // coverage_path tambien se pasa (no solo article): el titulo real
        // de un capitulo transversal puede vivir en un epigrafe mas
        // profundo (caso real: "04 PROLOGO" > "4.3. Definiciones
        // especificas...", Divina Seguros 27/08, ver GD-AUTO-GAP-001).
        coverage_context: { article: c.article, coverage_path: c.coverage_path || [] },
        chunks: [{ chunk_id: `${c.id}_c1`, text: c.source_text }],
        output: { coverage_dependencies: c.actual_coverage_dependencies },
        unit_ontology_matches: (c.actual_coverage_dependencies || []).map(d => ({ risk_field: d.risk_field }))
      }
    ]);

    const flaggedFields = (result.transversal_chapter_dependencies || []).map(d => d.risk_field);
    const isFlagged = flaggedFields.length > 0;

    const flagOk = isFlagged === c.expected_transversal_chapter_flagged;

    // Anti-regresion critica: sea cual sea el resultado del chequeo de
    // visibilidad, NINGUNA dependencia debe desaparecer de
    // coverage_dependencies por culpa de este chequeo -- es un chequeo de
    // visibilidad, no de bloqueo (ver notas del Guardrail v5). Se compara
    // solo contra los risk_field que YA eran validos en el catalogo real
    // (los invalidos de "actual_coverage_dependencies" -- p.ej. el
    // "vehicle.weight" alucinado de GD-AUTO-GAP-001 -- nunca iban a quedar
    // aceptados por ningun otro chequeo del guardrail, y no es lo que este
    // chequeo de visibilidad debe validar).
    const acceptedFields = (result.output?.coverage_dependencies || []).map(d => d.risk_field);
    const expectedAcceptedFields = (c.actual_coverage_dependencies || [])
      .map(d => d.risk_field)
      .filter(f => validRiskFieldSet.has(f));
    const nothingLost = expectedAcceptedFields.every(f => acceptedFields.includes(f));

    const ok = flagOk && nothingLost;
    if (!ok) failures++;

    console.log(
      `${ok ? "PASS" : "FAIL"} ${c.id} (${c.semantic_unit_ref}): flagged=${isFlagged} (esperado ${c.expected_transversal_chapter_flagged}) | sigue_aceptada=${nothingLost}`
    );
    if (!ok) {
      console.log("  article:", c.article);
      console.log("  flagged_fields:", JSON.stringify(flaggedFields));
      console.log("  accepted_fields:", JSON.stringify(acceptedFields));
    }
  }

  console.log(`Resultado: ${cases.length - failures}/${cases.length} pasan.`);
  return failures;
}

// Mismo patron que checkTransversalChapterVisibility, para el Guardrail v6
// (27/08): marca dependencias cuyo "evidence" coincide con un patron de
// instruccion operativa/procedimental (p.ej. "debera indicar" un dato al
// solicitar un servicio) -- visibilidad, no bloqueo. A diferencia de v5
// (evaluado sobre el contexto de TODA la unidad), v6 es por DEPENDENCIA
// individual (su propio "evidence"), asi que se comprueba el flag inline
// en cada dependencia devuelta, no solo la lista agregada.
function checkProceduralInstructionVisibility(workflow, golden, validRiskFields) {
  console.log("\n=== Check: procedural_instruction_dependencies (nodo Coverage Dependency Risk Field Guardrail v6) ===");

  const cases = golden.cases.filter(c => c.expected_procedural_instruction_flagged !== undefined);
  const validRiskFieldSet = new Set(validRiskFields.valid_risk_fields || []);

  if (!findNode(workflow, "Coverage Dependency Risk Field Guardrail")) {
    console.log("Nodo 'Coverage Dependency Risk Field Guardrail' no encontrado -- check omitido.");
    return 0;
  }

  let failures = 0;

  for (const c of cases) {
    const [result] = runNode(workflow, "Coverage Dependency Risk Field Guardrail", [
      {
        semantic_unit_id: c.semantic_unit_ref,
        coverage_context: { article: c.article, coverage_path: c.coverage_path || [] },
        chunks: [{ chunk_id: `${c.id}_c1`, text: c.source_text }],
        output: { coverage_dependencies: c.actual_coverage_dependencies },
        unit_ontology_matches: (c.actual_coverage_dependencies || []).map(d => ({ risk_field: d.risk_field }))
      }
    ]);

    const flaggedFields = (result.procedural_instruction_dependencies || []).map(d => d.risk_field);
    const isFlagged = flaggedFields.length > 0;
    const flagOk = isFlagged === c.expected_procedural_instruction_flagged;

    // Misma anti-regresion que v5: la señal de visibilidad nunca debe
    // quitar una dependencia de coverage_dependencies.
    const acceptedFields = (result.output?.coverage_dependencies || []).map(d => d.risk_field);
    const expectedAcceptedFields = (c.actual_coverage_dependencies || [])
      .map(d => d.risk_field)
      .filter(f => validRiskFieldSet.has(f));
    const nothingLost = expectedAcceptedFields.every(f => acceptedFields.includes(f));

    const ok = flagOk && nothingLost;
    if (!ok) failures++;

    console.log(
      `${ok ? "PASS" : "FAIL"} ${c.id} (${c.semantic_unit_ref}): flagged=${isFlagged} (esperado ${c.expected_procedural_instruction_flagged}) | sigue_aceptada=${nothingLost}`
    );
    if (!ok) {
      console.log("  evidence:", JSON.stringify((c.actual_coverage_dependencies || []).map(d => d.evidence)));
      console.log("  flagged_fields:", JSON.stringify(flaggedFields));
      console.log("  accepted_fields:", JSON.stringify(acceptedFields));
    }
  }

  console.log(`Resultado: ${cases.length - failures}/${cases.length} pasan.`);
  return failures;
}

function checkHierarchyArticleDetection(workflow) {
  console.log("\n=== Check: deteccion de 'article' (nodos Hierarchy Builder / Semantic Assembler) ===");

  if (!findNode(workflow, "Hierarchy Builder") || !findNode(workflow, "Semantic Assembler")) {
    console.log("Nodo 'Hierarchy Builder' o 'Semantic Assembler' no encontrado -- check omitido.");
    return 0;
  }

  let failures = 0;

  function assemble(chunks) {
    const [hierarchyOut] = runNode(workflow, "Hierarchy Builder", [{ chunks }]);
    const [assemblerOut] = runNode(workflow, "Semantic Assembler", [{ hierarchy: hierarchyOut.hierarchy }]);
    return assemblerOut.semantic_units;
  }

  // Caso A: convencion "Articulo Nº", incluyendo "Articulo Preliminar"
  // (sin numero) -- CLAUDE.md documenta que esta seccion se perdia por
  // completo en el cleanup antiguo; aqui se valida que, una vez que
  // cleanup ya no la descarta, Hierarchy Builder tampoco la deja fuera
  // del arbol (regresion real: su_00009..su_00025 en el run del 2026-07-16).
  const casoArticulo = assemble([
    { type: "section_header", page: 18, content: "Artículo Preliminar: Definiciones" },
    { type: "text", page: 18, content: "Incendio: Combustión y abrasamiento con llama capaz de propagarse." },
    { type: "section_header", page: 35, content: "Artículo 1º Objeto del seguro y ámbito territorial" },
    { type: "text", page: 35, content: "Este seguro tiene por objeto cubrir los riesgos descritos." }
  ]);

  const preliminarOk = casoArticulo[0].article === "Artículo Preliminar: Definiciones";
  console.log(`${preliminarOk ? "PASS" : "FAIL"} Articulo Preliminar (sin numero) se reconoce como nivel 1: article="${casoArticulo[0].article}"`);
  if (!preliminarOk) failures++;

  const articulo1Ok = casoArticulo[1].article === "Artículo 1º Objeto del seguro y ámbito territorial";
  console.log(`${articulo1Ok ? "PASS" : "FAIL"} Articulo 1º se reconoce como nivel 1 tras Articulo Preliminar: article="${casoArticulo[1].article}"`);
  if (!articulo1Ok) failures++;

  // Caso B: sin ninguna "Articulo" en el documento (estilo Occident) --
  // las divisiones principales usan numeracion simple "7. Titulo".
  const casoSinArticulo = assemble([
    { type: "section_header", page: 10, content: "7. Siniestros: Pago de la indemnización" },
    { type: "text", page: 10, content: "Texto de cabecera general del artículo de siniestros." },
    { type: "section_header", page: 11, content: "8.1.1. Acuerdo entre las partes" },
    { type: "text", page: 11, content: "El asegurador se personará a la mayor brevedad posible en el lugar del siniestro." },
    { type: "section_header", page: 12, content: "8. Otra materia" },
    { type: "text", page: 12, content: "Otro texto de cuerpo bajo la segunda división principal." }
  ]);

  const occidentTopOk = casoSinArticulo[0].article === "7. Siniestros: Pago de la indemnización";
  console.log(`${occidentTopOk ? "PASS" : "FAIL"} "7. Titulo" se reconoce como nivel 1 cuando no hay ninguna "Articulo": article="${casoSinArticulo[0].article}"`);
  if (!occidentTopOk) failures++;

  const occidentSecondTopOk = casoSinArticulo[2].article === "8. Otra materia";
  console.log(`${occidentSecondTopOk ? "PASS" : "FAIL"} La siguiente division "8. ..." reemplaza correctamente a la anterior como nivel 1: article="${casoSinArticulo[2].article}"`);
  if (!occidentSecondTopOk) failures++;

  // Caso C: robustez ante acentos perdidos por OCR ("Articulo" sin tilde)
  // -- no debe hacer caer todo el documento al modo "sin convencion".
  const casoSinTilde = assemble([
    { type: "section_header", page: 1, content: "Articulo 1° Objeto del seguro" },
    { type: "text", page: 1, content: "Texto de cuerpo." },
    { type: "section_header", page: 2, content: "1. Subdivision dentro del articulo" },
    { type: "text", page: 2, content: "Otro texto de cuerpo." }
  ]);

  // Si la deteccion fuese sensible al acento, "1. Subdivision..." pasaria a
  // nivel 1 (en vez de nivel 2 anidado bajo el articulo) y se convertiria
  // en su propio "article".
  const accentRobustOk = casoSinTilde[1].article === "Articulo 1° Objeto del seguro";
  console.log(`${accentRobustOk ? "PASS" : "FAIL"} "Articulo" sin tilde (OCR) sigue reconociendose como nivel 1: article="${casoSinTilde[1].article}"`);
  if (!accentRobustOk) failures++;

  // Caso D (27/08, Divina Seguros real): el indice usa numeros romanos
  // para los anexos ("ANEXO I"/"ANEXO II") y el cuerpo usa arabigos
  // ("ANEXO 1"/"ANEXO 2") para el mismo anexo -- sin la tolerancia a
  // numeros romanos, titlesMatch nunca ancla estos anexos y todo su
  // contenido cae bajo el ultimo capitulo numerado real (visto en
  // produccion: "19 QUEJAS Y RECLAMACIONES"). Formato de tabla/pagina
  // tomado literalmente de la ejecucion real 324.
  const casoAnexosRomanos = assemble([
    { type: "table", page: 3, content: "| 07 GARANTÍAS ASEGURABLES | 10 |\n| 19 QUEJAS Y RECLAMACIONES | 34 |\n| ANEXO I: Vehículos segunda categoría | 39 |\n| ANEXO II: Vehículos tercera categoría | 43 |" },
    { type: "section_header", page: 10, content: "07 GARANTÍAS ASEGURABLES" },
    { type: "text", page: 10, content: "Texto de cuerpo de garantías." },
    { type: "section_header", page: 34, content: "19 QUEJAS Y RECLAMACIONES" },
    { type: "text", page: 34, content: "Texto de cuerpo de quejas y reclamaciones." },
    { type: "section_header", page: 40, content: "ANEXO 1. VEHÍCULOS DE SEGUNDA CATEGORÍA" },
    { type: "text", page: 40, content: "Se consideran vehículos de segunda categoría los vehículos de cuatro o más ruedas, con peso superior a 3.500 kg." },
    { type: "section_header", page: 44, content: "ANEXO 2. VEHÍCULOS TERCERA CATEGORÍA" },
    { type: "text", page: 44, content: "Se consideran vehículos de tercera categoría los vehículos de dos o tres ruedas." }
  ]);

  const anexo1Unit = casoAnexosRomanos.find(u => (u.text || "").includes("cuatro o más ruedas"));
  const anexo1Ok = !!anexo1Unit && anexo1Unit.article === "ANEXO 1. VEHÍCULOS DE SEGUNDA CATEGORÍA";
  console.log(`${anexo1Ok ? "PASS" : "FAIL"} "ANEXO I" (indice, romano) ancla "ANEXO 1" (cuerpo, arabigo) como nivel 1: article="${anexo1Unit && anexo1Unit.article}"`);
  if (!anexo1Ok) failures++;

  const anexo2Unit = casoAnexosRomanos.find(u => (u.text || "").includes("dos o tres ruedas"));
  const anexo2Ok = !!anexo2Unit && anexo2Unit.article === "ANEXO 2. VEHÍCULOS TERCERA CATEGORÍA";
  console.log(`${anexo2Ok ? "PASS" : "FAIL"} "ANEXO II" (indice, romano) ancla "ANEXO 2" (cuerpo, arabigo) como nivel 1: article="${anexo2Unit && anexo2Unit.article}"`);
  if (!anexo2Ok) failures++;

  console.log(`Resultado: ${7 - failures}/7 expectativas cumplidas.`);
  return failures;
}

function checkWatermarkStripping(workflow) {
  console.log("\n=== Check: eliminacion de marca de agua fusionada (nodo ast walker) ===");

  if (!findNode(workflow, "ast walker")) {
    console.log("Nodo 'ast walker' no encontrado -- check omitido.");
    return 0;
  }

  let failures = 0;

  // Caso A: marca de agua "SIN VALIDEZ CONTRACTUAL" fusionada linea a linea
  // (via \r\n) con el texto real, repetida en >=3 bloques del mismo
  // documento -- patron real hallado en Occident el 2026-07-17 (independiente
  // del pdf_backend usado: persiste igual con dlparse_v4 y con pypdfium2).
  const [casoWatermark] = runNode(workflow, "ast walker", [
    {
      json_content: {
        texts: [
          { text: "SIN VALIDEZ\r\nCONTRACTUAL\r\nSe entiende por valor de nuevo la cantidad que exigiría la adquisición de uno nuevo.", label: "text", content_layer: "body" },
          { text: "SIN VALIDEZ\r\nCONTRACTUAL\r\nLa vivienda deberá estar registrada ante las administraciones correspondientes.", label: "text", content_layer: "body" },
          { text: "Quedan excluidos los daños producidos por la acción continuada del humo.\r\nSIN VALIDEZ\r\nCONTRACTUAL", label: "text", content_layer: "body" }
        ]
      }
    }
  ]);

  const watermarkGone = casoWatermark.chunks.every(
    c => !c.content.includes("SIN VALIDEZ") && !c.content.includes("CONTRACTUAL")
  );
  console.log(`${watermarkGone ? "PASS" : "FAIL"} fragmentos de "SIN VALIDEZ CONTRACTUAL" repetidos (>=3 bloques) se eliminan de los 3 chunks`);
  if (!watermarkGone) failures++;

  const realContentKept =
    casoWatermark.chunks[0].content.includes("exigiría la adquisición de uno nuevo") &&
    casoWatermark.chunks[1].content.includes("administraciones correspondientes") &&
    casoWatermark.chunks[2].content.includes("acción continuada del humo");
  console.log(`${realContentKept ? "PASS" : "FAIL"} el contenido real de los 3 bloques se conserva integro`);
  if (!realContentKept) failures++;

  // Caso B: un token corto en mayusculas que aparece una unica vez (p.ej.
  // una sigla real como "CCS") no debe eliminarse -- el umbral de repeticion
  // (>=3) es la unica señal, sin lista de literales hardcodeados.
  const [casoSigla] = runNode(workflow, "ast walker", [
    {
      json_content: {
        texts: [
          { text: "El pago de la indemnización corresponde al CCS\r\nen caso de riesgo extraordinario.", label: "text", content_layer: "body" }
        ]
      }
    }
  ]);

  const siglaKept = casoSigla.chunks[0].content.includes("CCS");
  console.log(`${siglaKept ? "PASS" : "FAIL"} una sigla real de aparicion unica ("CCS") no se elimina por falso positivo`);
  if (!siglaKept) failures++;

  // Caso C: documento sin ningun \r\n (caso normal, p.ej. Generali/Axa) no
  // debe verse afectado en absoluto por este check.
  const [casoNormal] = runNode(workflow, "ast walker", [
    {
      json_content: {
        texts: [
          { text: "Texto normal de condiciones generales sin ninguna marca de agua.", label: "text", content_layer: "body" }
        ]
      }
    }
  ]);

  const normalUnaffected = casoNormal.chunks[0].content === "Texto normal de condiciones generales sin ninguna marca de agua.";
  console.log(`${normalUnaffected ? "PASS" : "FAIL"} documento sin \\r\\n no se ve afectado`);
  if (!normalUnaffected) failures++;

  console.log(`Resultado: ${4 - failures}/4 expectativas cumplidas.`);
  return failures;
}

function checkOntology(workflow, golden) {
  console.log("\n=== Check: alias_match / negative_aliases (nodo Ontology Relevance Filter) ===");

  const ontologyWorkflow = loadJson(ONTOLOGY_WORKFLOW_PATH);
  const ontologyText = fs.readFileSync(ONTOLOGY_MD_PATH, "utf8");

  const concepts = runNode(ontologyWorkflow, "Ontology Splitter", [{ ontology_text: ontologyText }]);
  if (!concepts) {
    console.log("Nodo 'Ontology Splitter' no encontrado en ontology indexing.json -- check omitido.");
    return 0;
  }

  const qdrantResult = concepts.map(c => ({ score: 0.5, payload: c }));

  const cases = golden.cases.filter(c => Array.isArray(c.alias_match_expectations));
  let failures = 0;

  for (const c of cases) {
    // Fase 4: Ontology Relevance Filter matchea sobre chunk.text, no
    // sobre semantic_unit.text -- se simula un unico chunk con el
    // texto completo del caso, suficiente para probar la logica de
    // alias/negative_aliases en si misma.
    const [result] = runNode(workflow, "Ontology Relevance Filter", [
      { chunk: { chunk_id: `${c.id}_c1`, text: c.source_text }, result: qdrantResult }
    ]);

    for (const exp of c.alias_match_expectations) {
      const match = (result.ontology_matches || []).find(m => m.risk_field === exp.risk_field);
      const actualAliasMatch = match ? match.alias_match : false;
      const ok = actualAliasMatch === exp.expected_alias_match;
      if (!ok) failures++;
      console.log(
        `${ok ? "PASS" : "FAIL"} ${c.id} (${c.semantic_unit_ref}): risk_field="${exp.risk_field}" alias_match=${actualAliasMatch} (esperado ${exp.expected_alias_match})`
      );
    }
  }

  console.log(`Resultado: ${cases.reduce((n, c) => n + c.alias_match_expectations.length, 0) - failures}/${cases.reduce((n, c) => n + c.alias_match_expectations.length, 0)} expectativas cumplidas.`);
  return failures;
}

// Ejecuta "Merge Shared Texts Into Ramo" (workflow "ontology indexing")
// fuera de n8n -- replica $input.all() y $('Prepare Import File Paths').all(),
// las dos unicas dependencias externas del nodo real, sin mockear nada de
// su logica. Resuelve el hueco documentado en GD-AUTO-FP-001 (26/08):
// checkOntology() solo corre "Ontology Splitter" sobre el .md del ramo tal
// cual, sin expandir los bloques de figura ("## owner\nimports: person"),
// asi que nunca podia validar alias_match sobre conceptos generados por
// figura (owner.*, primaryDriver.*, crmEmploymentStatus bare/holder...).
function runMergeSharedTextsIntoRamo(ontologyWorkflow, ramoOntologyText, ramoOntologyType, sharedTextsByImportName) {
  const node = findNode(ontologyWorkflow, "Merge Shared Texts Into Ramo");
  if (!node) return null;

  const importMatch = ramoOntologyText.match(/^Imports:\s*(.*)$/mi);
  const importNames = importMatch
    ? importMatch[1].split(",").map(s => s.trim()).filter(Boolean)
    : [];

  const originalItems = importNames.map(name => ({
    json: {
      import_name: name,
      file_path: `/home/node/ontologies/shared/${name}.md`,
      ramo_ontology_text: ramoOntologyText,
      ramo_ontology_type: ramoOntologyType
    }
  }));

  const sharedItems = importNames.map(name => ({
    json: { shared_text: sharedTextsByImportName[name] || "" }
  }));

  const nodeRegistry = {
    "Prepare Import File Paths": { all: () => originalItems }
  };
  const $ = name => {
    if (!nodeRegistry[name]) {
      throw new Error(`Mock $(): nodo '${name}' no registrado en el arnes.`);
    }
    return nodeRegistry[name];
  };
  const $input = { all: () => sharedItems, first: () => sharedItems[0] };

  const fn = new Function("$input", "$", node.parameters.jsCode);
  return fn($input, $).map(r => r.json);
}

// Bug real (Divina Seguros, 27/08): "Merge Shared Texts Into Ramo" mezclaba
// los alias de la FIGURA ("propietario", "tomador", "conductor habitual" --
// quien protagoniza el texto) dentro de "aliases" de CADA campo importado de
// person.md, sin relacion con el significado real de ese campo -- la sola
// mencion de "el tomador" activaba como candidato, p.ej., crmEmploymentStatus
// (situacion laboral) para un texto que no hablaba de empleo en absoluto.
// Confirmado con la ejecucion real 318 (Prepare Dependency Extractor Input):
// matched_aliases=['tomador'] sobre crmEmploymentStatus/economicInactivityStatus,
// matched_aliases=['conductor habitual'] sobre primaryDriver.crmEmploymentStatus/
// .drivingLicenses/.economicOccupation. Ver GD-AUTO-HALLUC-001/004/005.
function checkFigureAliasContamination(workflow, golden, ramo) {
  console.log("\n=== Check: contaminacion de alias de figura (nodo Merge Shared Texts Into Ramo) ===");

  if (ramo !== "auto") {
    console.log("Check especifico de Autos (unico ramo con figuras Person distintas de 'holder' hoy) -- omitido para Hogar.");
    return 0;
  }

  const ontologyWorkflow = loadJson(ONTOLOGY_WORKFLOW_PATH);
  if (!findNode(ontologyWorkflow, "Merge Shared Texts Into Ramo")) {
    console.log("Nodo 'Merge Shared Texts Into Ramo' no encontrado -- check omitido.");
    return 0;
  }

  const ramoOntologyText = fs.readFileSync(ONTOLOGY_MD_PATH, "utf8");
  const personText = fs.readFileSync(
    path.join(REPO_ROOT, "knowledge", "ontologies", "shared", "person.md"),
    "utf8"
  );
  const base7Text = fs.readFileSync(
    path.join(REPO_ROOT, "knowledge", "ontologies", "shared", "base7version.md"),
    "utf8"
  );

  const points = runMergeSharedTextsIntoRamo(ontologyWorkflow, ramoOntologyText, "auto", {
    person: personText,
    base7version: base7Text
  });
  const qdrantResult = points.map(p => ({ score: 0, payload: p }));

  // Texto real de la ejecucion 318 (Divina Seguros, 27/08), sin editar --
  // ver evaluators/coverage_dependency_extractor/golden_dataset_auto.json
  // (GD-AUTO-HALLUC-001/004/005, GD-AUTO-FP-001, GD-AUTO-REF-001) para el
  // caso de dependencia completo de cada uno.
  const cases = [
    {
      id: "su_00080_c2",
      text: "Se entiende por asegurado al conductor del vehículo asegurado en el momento del accidente siempre y cuando éste sea uno de los siguientes: el conductor titular declarado, las personas nominadas como conductores autorizados o cualquier persona autorizada por el tomador que conduzca el vehículo siempre que sus características de edad y antigüedad de carné sean similares a las del conductor declarado.",
      must_not_match: ["crmEmploymentStatus"]
    },
    {
      id: "su_00101_c9",
      text: "En los supuestos en que no fuera posible una intervención directa del asegurador, por causa de fuerza mayor, y los gastos en que hubiera incurrido el ASEGURADO se hallen garantizados por las coberturas de esta garantía, el asegurador abonará, contra la presentación de la documentación acreditativa de los mismos, y en el plazo máximo de TREINTA DIAS desde la recepción de dicha información, la asistencia al asegurado en base a las tarifas medias de la zona donde se produzca el percance, una vez que las causas hayan sido definidas. No se atenderán los reembolsos de las prestaciones que no sean proporcionadas por Divina Seguros Asistencia ni aquellas a las que no haya dado su previo consentimiento. Se considera ASEGURADO aquella persona física, residente en España, TOMADOR de la póliza, así como su cónyuge, ascendientes y descendientes de primer grado que con él convivan integrados en la unidad económica familiar. También tienen la condición de asegurados los ocupantes a título gratuito del vehículo asegurado en caso de avería o siniestro sobrevenido al mismo. El ASEGURADO para tener derecho a percibir las prestaciones deberá tener su domicilio en España, residir habitualmente en él y el tiempo máximo de permanencia fuera de dicha residencia habitual no exceder de 90 días por desplazamiento o viaje.",
      must_not_match: ["economicInactivityStatus", "crmEmploymentStatus"]
    },
    {
      id: "su_00207_c2",
      text: "Reclamación de los daños derivados de un ACCIDENTE DE CIRCULACIÓN sufridos por el CONDUCTOR HABITUAL DECLARADO como peatón o ciclista.",
      must_not_match: ["primaryDriver.crmEmploymentStatus", "primaryDriver.drivingLicenses", "primaryDriver.economicOccupation"]
    },
    {
      id: "su_00207_c3",
      text: "Reclamación de daños personales que pueda sufrir el TOMADOR como pasajero de cualquier vehículo privado.",
      must_not_match: ["crmEmploymentStatus", "drivingLicenses"]
    },
    // No-regresion: los alias PROPIOS del campo (no los de figura) deben
    // seguir generando el match -- este fix no debe volverse una purga
    // general de alias_match.
    {
      id: "su_00146_c13_noreg",
      text: "Cuando el PROPIETARIO del vehículo o TOMADOR del seguro sea una persona jurídica, el asegurador NO cubre los desembolsos debidos a obligaciones frente a socios y representantes legítimos de la misma, y frente a los familiares de estos hasta el tercer grado de consanguinidad o afinidad.",
      must_match: ["owner.identificationType"]
    },
    {
      id: "su_00083_c2_noreg",
      text: "En ningún caso se tomará en cuenta la profesión del ASEGURADO, por lo que no podrá alegarse una agravación en la invalidez en base a la actividad profesional.",
      must_match: ["economicOccupation", "owner.economicOccupation", "secondaryDriver.economicOccupation"]
    }
  ];

  let failures = 0;
  for (const c of cases) {
    const [result] = runNode(workflow, "Ontology Relevance Filter", [
      { chunk: { chunk_id: `${c.id}`, text: c.text }, result: qdrantResult }
    ]);
    const aliasMatchedFields = (result.ontology_matches || [])
      .filter(m => m.alias_match)
      .map(m => m.risk_field);

    for (const forbidden of c.must_not_match || []) {
      const ok = !aliasMatchedFields.includes(forbidden);
      if (!ok) failures++;
      console.log(
        `${ok ? "PASS" : "FAIL"} ${c.id}: "${forbidden}" NO debe alias-matchear -- alias_matched=${JSON.stringify(aliasMatchedFields)}`
      );
    }
    for (const required of c.must_match || []) {
      const ok = aliasMatchedFields.includes(required);
      if (!ok) failures++;
      console.log(
        `${ok ? "PASS" : "FAIL"} ${c.id}: "${required}" SI debe seguir alias-matcheando -- alias_matched=${JSON.stringify(aliasMatchedFields)}`
      );
    }
  }

  console.log(`Resultado: ${failures === 0 ? "0 fallos" : failures + " fallos"}.`);
  return failures;
}

// Cubre gaps de vocabulario ya corregidos en las ontologias (alias que
// faltaban para una frase real de un condicionado, sin ningun cambio de
// codigo de por medio) -- distinto de checkFigureAliasContamination (esa
// es sobre un BUG de codigo). Reutiliza el mismo runMergeSharedTextsIntoRamo
// para las ontologias con figuras (auto); para Hogar (sin figuras propias
// hoy) corre "Ontology Splitter" directo, igual que checkOntology.
function checkVocabularyGapFixes(workflow, golden, ramo) {
  console.log("\n=== Check: gaps de vocabulario ya corregidos en la ontologia ===");

  const ontologyWorkflow = loadJson(ONTOLOGY_WORKFLOW_PATH);
  let qdrantResult;

  if (ramo === "auto") {
    const ramoOntologyText = fs.readFileSync(ONTOLOGY_MD_PATH, "utf8");
    const personText = fs.readFileSync(
      path.join(REPO_ROOT, "knowledge", "ontologies", "shared", "person.md"),
      "utf8"
    );
    const base7Text = fs.readFileSync(
      path.join(REPO_ROOT, "knowledge", "ontologies", "shared", "base7version.md"),
      "utf8"
    );
    const points = runMergeSharedTextsIntoRamo(ontologyWorkflow, ramoOntologyText, "auto", {
      person: personText,
      base7version: base7Text
    });
    qdrantResult = points.map(p => ({ score: 0, payload: p }));
  } else {
    const ontologyText = fs.readFileSync(ONTOLOGY_MD_PATH, "utf8");
    const concepts = runNode(ontologyWorkflow, "Ontology Splitter", [{ ontology_text: ontologyText }]);
    if (!concepts) {
      console.log("Nodo 'Ontology Splitter' no encontrado -- check omitido.");
      return 0;
    }
    qdrantResult = concepts.map(c => ({ score: 0, payload: c }));
  }

  // Caso real (27/08, Divina Seguros): "category" (shared/base7version.md)
  // no tenia "primera/segunda/tercera categoria" como alias literal, pese
  // a ser la frase exacta que usa el condicionado (su_00008/su_00185) --
  // el concepto ni siquiera entraba como candidato en Ontology Relevance
  // Filter. Correspondencia confirmada por el usuario (no asumida): 1a=
  // AUTOS, 2a=CAMIONES, 3a=MOTOS (incluye quads).
  const cases = ramo === "auto" ? [
    {
      id: "su_00185_c1",
      text: "Se consideran vehículos de segunda categoría los vehículos de cuatro o más ruedas, con peso superior a 3.500 kg:",
      must_match: ["base7Version.base7Type.base7Category.id"]
    },
    {
      id: "vocab-primera-categoria",
      text: "Cuando el vehículo asegurado sea de primera categoría, los daños causados por remolcaje...",
      must_match: ["base7Version.base7Type.base7Category.id"]
    }
  ] : [];

  if (cases.length === 0) {
    console.log(`Sin casos de vocabulario documentados para ramo '${ramo}' todavia -- check omitido.`);
    return 0;
  }

  let failures = 0;
  for (const c of cases) {
    const [result] = runNode(workflow, "Ontology Relevance Filter", [
      { chunk: { chunk_id: c.id, text: c.text }, result: qdrantResult }
    ]);
    const aliasMatchedFields = (result.ontology_matches || [])
      .filter(m => m.alias_match)
      .map(m => m.risk_field);

    for (const required of c.must_match || []) {
      const ok = aliasMatchedFields.includes(required);
      if (!ok) failures++;
      console.log(
        `${ok ? "PASS" : "FAIL"} ${c.id}: "${required}" debe alias-matchear -- alias_matched=${JSON.stringify(aliasMatchedFields)}`
      );
    }
  }

  console.log(`Resultado: ${failures === 0 ? "0 fallos" : failures + " fallos"}.`);
  return failures;
}

function checkChunkLevelMatching(workflow, golden) {
  console.log("\n=== Check: matching a nivel de chunk (Fase 4 / Punto 1) ===");

  const ontologyWorkflow = loadJson(ONTOLOGY_WORKFLOW_PATH);
  const ontologyText = fs.readFileSync(ONTOLOGY_MD_PATH, "utf8");
  const concepts = runNode(ontologyWorkflow, "Ontology Splitter", [{ ontology_text: ontologyText }]);
  const qdrantResult = concepts.map(c => ({ score: 0.5, payload: c }));

  const node = findNode(workflow, "Explode Chunks By Semantic Unit");
  if (!node) {
    console.log("Nodo 'Explode Chunks By Semantic Unit' todavia no existe (Fase 4 pendiente) -- check omitido.");
    return 0;
  }

  // Corre la cadena completa: Rule Chunker -> Explode -> Ontology Relevance
  // Filter (por chunk) -> Regroup
  const c = golden.cases.find(x => x.id === "GD-FP-003");
  if (!c) {
    console.log("Caso fijo 'GD-FP-003' no existe en este golden set (check especifico de Hogar) -- omitido.");
    return 0;
  }
  const [ruleOut] = runNode(workflow, "Rule Chunker", [
    { semantic_unit: { id: c.semantic_unit_ref, text: c.source_text, article: c.article }, semantic_unit_id: c.semantic_unit_ref }
  ]);

  const exploded = runNode(workflow, "Explode Chunks By Semantic Unit", [ruleOut]);
  const filtered = exploded.map(j => runNode(workflow, "Ontology Relevance Filter", [{ ...j, result: qdrantResult }])[0]);
  const [regrouped] = runNode(workflow, "Regroup Chunks By Semantic Unit", filtered);

  let failures = 0;

  const chunkCountOk = regrouped.chunks.length === 2;
  console.log(`${chunkCountOk ? "PASS" : "FAIL"} ${c.id}: chunk_count=${regrouped.chunks.length} (esperado 2)`);
  if (!chunkCountOk) failures++;

  const firstChunkMatches = regrouped.chunks[0]?.ontology_matches?.length || 0;
  const firstOk = firstChunkMatches === 0;
  console.log(`${firstOk ? "PASS" : "FAIL"} ${c.id}: primer chunk (parrafo de infraseguro general) tiene ${firstChunkMatches} ontology_matches (esperado 0 -- contexto no contaminado)`);
  if (!firstOk) failures++;

  const secondChunkHasContinent = (regrouped.chunks[1]?.ontology_matches || []).some(m => m.risk_field === "continent");
  console.log(`${secondChunkHasContinent ? "PASS" : "FAIL"} ${c.id}: segundo chunk (excepcion de renuncia) incluye 'continent' entre sus ontology_matches`);
  if (!secondChunkHasContinent) failures++;

  console.log(`Resultado: ${3 - failures}/3 expectativas cumplidas.`);
  return failures;
}

function checkCostPreFilter(workflow) {
  console.log("\n=== Check: garantia del pre-filtro de coste (Fase 5 / Legal Cue Pre-Filter) ===");

  const node = findNode(workflow, "Legal Cue Pre-Filter");
  if (!node) {
    console.log("Nodo 'Legal Cue Pre-Filter' todavia no existe (Fase 5 pendiente) -- check omitido.");
    return 0;
  }

  let total = 0;
  let failures = 0;

  for (const filename of REAL_RUN_FILES) {
    const filePath = path.join(GGCC_OUTPUTS_DIR, filename);
    if (!fs.existsSync(filePath)) continue;

    const data = loadJson(filePath);
    const root = Array.isArray(data) ? data[0] : data;

    for (const artifact of root.artifacts || []) {
      total++;
      const passed = runNode(workflow, "Legal Cue Pre-Filter", [
        { semantic_unit: { text: artifact.source_text } }
      ]);

      if (!passed || passed.length === 0) {
        failures++;
        console.log(
          `FALLO DE GARANTIA: ${filename} | ${artifact.semantic_unit_id} -> el pre-filtro descarta una unidad que SI genero dependencias en produccion`
        );
      }
    }
  }

  const existingRuns = REAL_RUN_FILES.filter(f => fs.existsSync(path.join(GGCC_OUTPUTS_DIR, f))).length;
  console.log(`Resultado: ${total - failures}/${total} unidades reales (de ${existingRuns}/${REAL_RUN_FILES.length} ejecuciones presentes localmente) respetan la garantia.`);
  return failures;
}

function main() {
  const rawArgs = process.argv.slice(2);
  const ramoArg = rawArgs.find(a => a.startsWith("--ramo="));
  const ramo = ramoArg ? ramoArg.split("=")[1] : "home";
  const args = rawArgs.filter(a => !a.startsWith("--ramo="));
  const runAll = args.length === 0;

  if (!RAMO_ONTOLOGY_MD[ramo]) {
    throw new Error(`--ramo=${ramo} desconocido -- valores validos: ${Object.keys(RAMO_ONTOLOGY_MD).join(", ")}`);
  }
  ONTOLOGY_MD_PATH = path.join(REPO_ROOT, "knowledge", "ontologies", RAMO_ONTOLOGY_MD[ramo]);
  GOLDEN_PATH = path.join(__dirname, RAMO_GOLDEN_DATASET[ramo]);
  VALID_RISK_FIELDS_PATH = path.join(__dirname, RAMO_VALID_RISK_FIELDS[ramo]);

  const workflow = loadJson(WORKFLOW_PATH);
  const golden = loadJson(GOLDEN_PATH);
  const validRiskFields = loadJson(VALID_RISK_FIELDS_PATH);

  console.log(`Ramo: ${ramo}`);
  console.log(`Golden set: ${golden.cases.length} casos cargados desde ${GOLDEN_PATH}`);

  let exitCode = 0;

  if (runAll || args.includes("--chunking")) {
    exitCode += checkChunking(workflow, golden) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--hallucination")) {
    checkHallucination(workflow, golden, validRiskFields);
  }

  if (runAll || args.includes("--value-type")) {
    exitCode += checkValueTypeValidation(workflow, golden) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--ontology")) {
    exitCode += checkOntology(workflow, golden) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--figure-aliases")) {
    exitCode += checkFigureAliasContamination(workflow, golden, ramo) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--vocab-gaps")) {
    exitCode += checkVocabularyGapFixes(workflow, golden, ramo) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--chunk-matching")) {
    exitCode += checkChunkLevelMatching(workflow, golden) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--cost-prefilter")) {
    exitCode += checkCostPreFilter(workflow) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--evidence-grounding")) {
    exitCode += checkEvidenceGrounding(workflow, golden) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--transversal-chapter")) {
    exitCode += checkTransversalChapterVisibility(workflow, golden, validRiskFields) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--procedural-instruction")) {
    exitCode += checkProceduralInstructionVisibility(workflow, golden, validRiskFields) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--hierarchy")) {
    exitCode += checkHierarchyArticleDetection(workflow) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--watermark")) {
    exitCode += checkWatermarkStripping(workflow) > 0 ? 1 : 0;
  }

  process.exit(exitCode);
}

main();
