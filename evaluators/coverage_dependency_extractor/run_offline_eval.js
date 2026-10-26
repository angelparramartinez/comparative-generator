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
//   node run_offline_eval.js --person-field-mismatch -> solo el check de visibilidad de campos de peso de persona en evidencia de vehiculo/animal (Guardrail v7)
//   node run_offline_eval.js --coverage-scope -> solo el check de visibilidad de alcance de garantia confundido con condicion (Guardrail v8)
//   node run_offline_eval.js --driving-license -> solo el check de rechazo de uso escalar de "drivingLicenses" (lista) y aceptacion de licenseYears/licenseType (Guardrail v9)
//   node run_offline_eval.js --list-field-scalar -> solo el check de rechazo de uso escalar de cualquier risk_field data_type "list" (base7Options, nonBase7Options, economicActivities...) (Guardrail v10)
//   node run_offline_eval.js --engine-field-value -> solo el check de rechazo de valores invalidos (no vocabulario real de motor/combustible) para base7Version.base7Engine.id (Guardrail v15, hallazgo A)
//   node run_offline_eval.js --policy-admission-criteria -> solo el check de visibilidad de criterios de admision de persona en figura confundidos con condicion de cobertura (Guardrail v16, hallazgo C)
//   node run_offline_eval.js --percentage-indemnification -> solo el check de visibilidad de escalas de indemnizacion en porcentaje confundidas con condicion de cobertura (Guardrail v17, hallazgo D, agnostico de ramo)
//   node run_offline_eval.js --ramo-scope -> solo el check del gate de alcance de ramo del Legal Cue Pre-Filter v2 (capitulos que declaran una categoria de vehiculo ajena al ramo procesado, 03/09)
//   node run_offline_eval.js --negative-alias-score-door -> solo el check de que un alias suprimido por negative_aliases no reentra por la puerta del score alto del Ontology Relevance Filter (fix 03/09)
//   node run_offline_eval.js --premium-calculation -> solo el check de visibilidad de reglas de bonificacion/prima (bonus-malus) confundidas con condicion de cobertura (Guardrail v21, patron 2, agnostico de ramo) + la ampliacion de v6 con nombres de documentos de suscripcion
//   node run_offline_eval.js --invented-age -> solo los checks de "age inventado" (Guardrail v18: campo de duracion con value 0, agnostico de ramo; Guardrail v19: umbral de edad de menor sobre una figura declarada, gateado a Autos) + su contra-prueba de falsos positivos
//   node run_offline_eval.js --relative-duration -> solo el check de rechazo de enteros implausibles contra campos data_type "date" (birthDate/registrationDate/purchaseDate) y aceptacion de registrationYears/age (Guardrail v11)
//   node run_offline_eval.js --figure-selection -> solo el check de visibilidad de seleccion de figura inconsistente (mismo campo base de Person con figuras distintas en la misma unidad) (Guardrail v12)
//   node run_offline_eval.js --artifact-threading -> solo el check generico de que las 8 listas del guardrail (rejected/ungrounded/unverified_evidence/transversal_chapter/procedural_instruction/person_field_mismatch/coverage_scope/figure_selection) se propagan intactas a Build Coverage Dependency Artifact / Build Coverage Matcher Contract
//   node run_offline_eval.js --figure-selection-rejections -> solo el check de rechazo duro de figure_keyword_mismatch y duplicate_figure_without_distinction (Guardrail v13)
//   node run_offline_eval.js --ontology-type-threading -> solo el check de hilado de "ontology_type" (home/auto) en Prepare Dependency Extractor Input v3
//   node run_offline_eval.js --ontology-type-gating -> solo el check de que los chequeos especificos de Autos (v7/v8/v9/v12/v13) no disparan ni dejan de cazar nada segun ontology_type (Guardrail v14, separacion nucleo/ramo)
//   node run_offline_eval.js --prompt-assembler -> solo el check estructural de la separacion nucleo/ramo del prompt (nodo Prompt Assembler) -- NO sustituye a una confirmacion real con el LLM
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
  // Autos / Divina Seguros (27/08) -- cinco ejecuciones reales mas a lo
  // largo de la sesion, una por cada tanda de fixes desplegados (ver
  // golden_dataset_auto.json, schema_notes.session_27_08_closure para el
  // resumen completo de la cadena de hallazgos).
  "coverage_matcher_contract_2026-08-27T06-58-13-642Z.json",
  "coverage_matcher_contract_2026-08-27T08-12-49-393Z.json",
  "coverage_matcher_contract_2026-08-27T08-38-15-059Z.json",
  "coverage_matcher_contract_2026-08-27T09-58-30-291Z.json",
  "coverage_matcher_contract_2026-08-27T10-18-50-347Z.json"
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
// 03/09: varios nodos reales leen el Ramo del formulario via
// $('On form submission'). Hasta ahora cada check que lo necesitaba se
// montaba su propio shim de "$" a mano (ver checkOntologyTypeThreading);
// ahora lo provee wrapCodeNode para todos, con el ramo que le pase el
// check (opts.ramo). Si no se pasa ninguno, "Ramo" llega vacio -- que es
// justo lo que quieren los checks que no van de ramo: cualquier gate por
// ramo queda inerte y siguen validando lo que validaban antes.
// opts.nodes permite inyectar la salida de nodos anteriores para los nodos que
// la consultan con $('Nombre') -- p.ej. "Merge Shared Texts Into Ramo", que
// necesita $('Prepare Import File Paths').all(). Formato:
//   { nodes: { "Prepare Import File Paths": [ {json: {...}}, ... ] } }
function makeNodeRegistryShim(opts) {
  const empty = { first: () => ({ json: {} }), all: () => [] };
  const registry = {
    "On form submission": { first: () => ({ json: { Ramo: opts && opts.ramo ? opts.ramo : null } }) }
  };

  for (const [name, items] of Object.entries((opts && opts.nodes) || {})) {
    registry[name] = { first: () => items[0], all: () => items };
  }

  return name => registry[name] || empty;
}

function wrapCodeNode(node, opts) {
  const code = node.parameters.jsCode;
  const mode = node.parameters.mode || "runOnceForAllItems";
  const $ = makeNodeRegistryShim(opts);

  if (mode === "runOnceForEachItem") {
    const fn = new Function("$json", "$getWorkflowStaticData", "$", code);
    return { mode, runOnItems: jsonInputs => jsonInputs.map(j => fn(j, $getWorkflowStaticData, $).json) };
  }

  // n8n expone $json (bound al primer item) incluso en modo "runOnceForAllItems"
  // -- Ontology Splitter depende de eso, asi que se replica aqui. Tambien expone
  // $input.first()/$input.all() -- Hierarchy Builder y ast walker dependen de eso.
  const fn = new Function("items", "$json", "$input", "$getWorkflowStaticData", "$", code);
  return {
    mode,
    runOnItems: jsonInputs => {
      const items = jsonInputs.map(j => ({ json: j }));
      const $input = { first: () => items[0], all: () => items };
      const result = fn(items, items[0]?.json, $input, $getWorkflowStaticData, $);
      return result.map(r => r.json);
    }
  };
}

function runNode(workflow, nodeName, jsonInputs, opts) {
  const node = findNode(workflow, nodeName);
  if (!node) return null;
  return wrapCodeNode(node, opts).runOnItems(jsonInputs);
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
    // 03/09: "sigue aceptada" se comprobaba filtrando la expectativa por
    // "el campo esta en valid_risk_fields", usando el catalogo de la
    // ontologia como PROXY de "esta dependencia deberia sobrevivir al
    // guardrail". Ese proxy es falso desde que existen chequeos semanticos
    // que rechazan duro campos perfectamente catalogados (v10 uso escalar de
    // una lista, v11 entero implausible contra una fecha, v18 campo de
    // duracion con value 0, v19 umbral de menor de edad...). Se vio al
    // regenerar valid_risk_fields_auto.json: "registrationYears" paso a estar
    // en el catalogo y este check empezo a exigir que sobreviviera una
    // dependencia que v18 rechaza CON RAZON. La propiedad correcta de un
    // chequeo de visibilidad es que ninguna dependencia desaparezca EN
    // SILENCIO: cada una debe estar o aceptada o en rejected_dependencies.
    const acceptedFields = (result.output?.coverage_dependencies || []).map(d => d.risk_field);
    const rejectedFields = (result.rejected_dependencies || []).map(d => d.risk_field);
    const inputFields = (c.actual_coverage_dependencies || []).map(d => d.risk_field);
    const nothingLost = inputFields.every(
      f => acceptedFields.includes(f) || rejectedFields.includes(f)
    );

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
    // 03/09: "sigue aceptada" se comprobaba filtrando la expectativa por
    // "el campo esta en valid_risk_fields", usando el catalogo de la
    // ontologia como PROXY de "esta dependencia deberia sobrevivir al
    // guardrail". Ese proxy es falso desde que existen chequeos semanticos
    // que rechazan duro campos perfectamente catalogados (v10 uso escalar de
    // una lista, v11 entero implausible contra una fecha, v18 campo de
    // duracion con value 0, v19 umbral de menor de edad...). Se vio al
    // regenerar valid_risk_fields_auto.json: "registrationYears" paso a estar
    // en el catalogo y este check empezo a exigir que sobreviviera una
    // dependencia que v18 rechaza CON RAZON. La propiedad correcta de un
    // chequeo de visibilidad es que ninguna dependencia desaparezca EN
    // SILENCIO: cada una debe estar o aceptada o en rejected_dependencies.
    const acceptedFields = (result.output?.coverage_dependencies || []).map(d => d.risk_field);
    const rejectedFields = (result.rejected_dependencies || []).map(d => d.risk_field);
    const inputFields = (c.actual_coverage_dependencies || []).map(d => d.risk_field);
    const nothingLost = inputFields.every(
      f => acceptedFields.includes(f) || rejectedFields.includes(f)
    );

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

// Mismo patron que checkProceduralInstructionVisibility, para el Guardrail
// v7 (27/08): marca dependencias cuyo risk_field es un campo de peso de
// PERSONA (weight/owner.weight/primaryDriver.weight/secondaryDriver.weight)
// pero cuyo "evidence" menciona vehiculo/animal/objeto -- visibilidad, no
// bloqueo.
function checkPersonFieldMismatchVisibility(workflow, golden, validRiskFields) {
  console.log("\n=== Check: person_field_mismatch_dependencies (Guardrail v7, RECHAZO DURO desde v22) ===");

  const cases = golden.cases.filter(c => c.expected_person_field_mismatch_flagged !== undefined);
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
        ontology_type: "auto",
        coverage_context: { article: c.article, coverage_path: c.coverage_path || [] },
        chunks: [{ chunk_id: `${c.id}_c1`, text: c.source_text }],
        output: { coverage_dependencies: c.actual_coverage_dependencies },
        unit_ontology_matches: (c.actual_coverage_dependencies || []).map(d => ({ risk_field: d.risk_field }))
      }
    ]);

    const flaggedFields = (result.person_field_mismatch_dependencies || []).map(d => d.risk_field);
    const isFlagged = flaggedFields.length > 0;
    const flagOk = isFlagged === c.expected_person_field_mismatch_flagged;

    // v22 (03/09): esto dejo de ser solo visibilidad -- un peso de PERSONA con
    // evidencia de vehiculo/remolque/animal se RECHAZA duro. Se verifica
    // tambien el motivo concreto, para que el check distinga entre "marcado"
    // (v7) y "rechazado" (v22) y no pueda pasar por accidente si algun dia se
    // vuelve atras.
    const v22Rejections = (result.rejected_dependencies || [])
      .filter(d => d.rejection_reason === "person_weight_field_for_non_person_evidence")
      .map(d => d.risk_field);
    const hardRejectOk = !c.expected_person_field_mismatch_flagged
      ? v22Rejections.length === 0
      : flaggedFields.every(f => v22Rejections.includes(f));

    // 03/09: "sigue aceptada" se comprobaba filtrando la expectativa por
    // "el campo esta en valid_risk_fields", usando el catalogo de la
    // ontologia como PROXY de "esta dependencia deberia sobrevivir al
    // guardrail". Ese proxy es falso desde que existen chequeos semanticos
    // que rechazan duro campos perfectamente catalogados (v10 uso escalar de
    // una lista, v11 entero implausible contra una fecha, v18 campo de
    // duracion con value 0, v19 umbral de menor de edad...). Se vio al
    // regenerar valid_risk_fields_auto.json: "registrationYears" paso a estar
    // en el catalogo y este check empezo a exigir que sobreviviera una
    // dependencia que v18 rechaza CON RAZON. La propiedad correcta de un
    // chequeo de visibilidad es que ninguna dependencia desaparezca EN
    // SILENCIO: cada una debe estar o aceptada o en rejected_dependencies.
    const acceptedFields = (result.output?.coverage_dependencies || []).map(d => d.risk_field);
    const rejectedFields = (result.rejected_dependencies || []).map(d => d.risk_field);
    const inputFields = (c.actual_coverage_dependencies || []).map(d => d.risk_field);
    const nothingLost = inputFields.every(
      f => acceptedFields.includes(f) || rejectedFields.includes(f)
    );

    const ok = flagOk && nothingLost && hardRejectOk;
    if (!ok) failures++;

    console.log(
      `${ok ? "PASS" : "FAIL"} ${c.id} (${c.semantic_unit_ref}): flagged=${isFlagged} (esperado ${c.expected_person_field_mismatch_flagged}) | rechazo_duro_v22=${hardRejectOk} | nada_perdido_en_silencio=${nothingLost}`
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

// Mismo patron que checkTransversalChapterVisibility (v5): v8 tambien es
// una señal ESTRUCTURAL a nivel de unidad completa (coverage_context.
// article/coverage_path), no por dependencia individual como v6/v7.
// Deliberadamente parcial (ver notas del Guardrail v8): solo cubre casos
// con un epigrafe propio tipo "¿Quien esta asegurado?"/"Vehiculo de
// sustitucion...", confirmado real en Axa y Pelayo (27/08) tras revisar
// que el resto de companias (Reale/Qualitas/Generali) no tienen ninguna
// señal estructural aprovechable para el mismo patron.
function checkCoverageScopeVisibility(workflow, golden, validRiskFields) {
  console.log("\n=== Check: coverage_scope_dependencies (nodo Coverage Dependency Risk Field Guardrail v8) ===");

  const cases = golden.cases.filter(c => c.expected_coverage_scope_flagged !== undefined);
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
        ontology_type: "auto",
        coverage_context: { article: c.article, coverage_path: c.coverage_path || [] },
        chunks: [{ chunk_id: `${c.id}_c1`, text: c.source_text }],
        output: { coverage_dependencies: c.actual_coverage_dependencies },
        unit_ontology_matches: (c.actual_coverage_dependencies || []).map(d => ({ risk_field: d.risk_field }))
      }
    ]);

    const flaggedFields = (result.coverage_scope_dependencies || []).map(d => d.risk_field);
    const isFlagged = flaggedFields.length > 0;
    const flagOk = isFlagged === c.expected_coverage_scope_flagged;

    const acceptedFields = (result.output?.coverage_dependencies || []).map(d => d.risk_field);
    // "expected_accepted_risk_fields" es un override explicito por caso -- solo
    // hace falta cuando otro chequeo mas estricto (p.ej. Guardrail v9, que
    // rechaza "drivingLicenses" siempre) legitimamente retira del catalogo
    // general algo que este chequeo, por defecto, asumiria que sigue aceptado
    // (ver GD-AUTO-HALLUC-007, 28/08). Sin el campo, comportamiento identico a
    // antes de v9.
    // 03/09: mismo cambio de criterio que en v5/v6/v7 (ver nota alli) --
    // cuando el caso declara "expected_accepted_risk_fields" se sigue
    // respetando esa expectativa explicita; si no, se exige solo que nada
    // desaparezca en silencio.
    const rejectedFields = (result.rejected_dependencies || []).map(d => d.risk_field);
    const nothingLost = c.expected_accepted_risk_fields !== undefined
      ? c.expected_accepted_risk_fields.every(f => acceptedFields.includes(f))
      : (c.actual_coverage_dependencies || [])
          .map(d => d.risk_field)
          .every(f => acceptedFields.includes(f) || rejectedFields.includes(f));

    const ok = flagOk && nothingLost;
    if (!ok) failures++;

    console.log(
      `${ok ? "PASS" : "FAIL"} ${c.id} (${c.semantic_unit_ref}): flagged=${isFlagged} (esperado ${c.expected_coverage_scope_flagged}) | sigue_aceptada=${nothingLost}`
    );
    if (!ok) {
      console.log("  article:", c.article, "| coverage_path:", JSON.stringify(c.coverage_path));
      console.log("  flagged_fields:", JSON.stringify(flaggedFields));
      console.log("  accepted_fields:", JSON.stringify(acceptedFields));
    }
  }

  console.log(`Resultado: ${cases.length - failures}/${cases.length} pasan.`);
  return failures;
}

// Guardrail v9 (28/08): a diferencia de v5-v8 (visibilidad), este chequeo
// verifica un RECHAZO real (mismo nivel que checkValueTypeValidation) --
// cualquier risk_field terminado en "drivingLicenses" usado directamente
// (lista, no escalar) debe rechazarse con driving_licenses_used_as_scalar.
// Cuando el caso trae "corrected_coverage_dependencies" (la extraccion
// correcta usando licenseYears/licenseType), se verifica ademas que ESA
// si pase el guardrail sin problema -- confirma que el escape hatch nuevo
// funciona, no solo que el uso incorrecto se bloquea.
function checkDrivingLicenseListMisuse(workflow, golden) {
  console.log("\n=== Check: driving_license_list_misuse (nodo Coverage Dependency Risk Field Guardrail v9) ===");

  const cases = golden.cases.filter(c => c.category === "driving_license_list_misuse");

  if (!findNode(workflow, "Coverage Dependency Risk Field Guardrail")) {
    console.log("Nodo 'Coverage Dependency Risk Field Guardrail' no encontrado -- check omitido.");
    return 0;
  }

  let failures = 0;

  for (const c of cases) {
    const [badResult] = runNode(workflow, "Coverage Dependency Risk Field Guardrail", [
      { semantic_unit_id: c.semantic_unit_ref, ontology_type: "auto", output: { coverage_dependencies: c.actual_coverage_dependencies } }
    ]);

    const rejectedFields = (badResult.rejected_dependencies || [])
      .filter(d => d.rejection_reason === "driving_licenses_used_as_scalar")
      .map(d => d.risk_field);
    const expectedRejected = c.expected_rejected_risk_fields || [];
    const allExpectedRejected = expectedRejected.every(f => rejectedFields.includes(f));
    const nothingLeaked = (badResult.output?.coverage_dependencies || [])
      .every(d => !/(^|\.)drivingLicenses$/.test(d.risk_field));

    let correctedOk = true;
    let correctedAccepted = [];
    if (c.corrected_coverage_dependencies) {
      const [goodResult] = runNode(workflow, "Coverage Dependency Risk Field Guardrail", [
        { semantic_unit_id: c.semantic_unit_ref, ontology_type: "auto", output: { coverage_dependencies: c.corrected_coverage_dependencies } }
      ]);
      correctedAccepted = (goodResult.output?.coverage_dependencies || []).map(d => d.risk_field);
      correctedOk = c.corrected_coverage_dependencies.every(d => correctedAccepted.includes(d.risk_field));
    }

    const ok = allExpectedRejected && nothingLeaked && correctedOk;
    if (!ok) failures++;

    console.log(
      `${ok ? "PASS" : "FAIL"} ${c.id} (${c.semantic_unit_ref}): rechazados=${JSON.stringify(rejectedFields)} (esperado ${JSON.stringify(expectedRejected)}) | nada_se_cuela=${nothingLeaked}` +
        (c.corrected_coverage_dependencies ? ` | corregida_aceptada=${correctedOk} (${JSON.stringify(correctedAccepted)})` : "")
    );
  }

  console.log(`Resultado: ${cases.length - failures}/${cases.length} pasan.`);
  return failures;
}

// Guardrail v10 (31/08): generaliza v9 -- rechaza cualquier risk_field cuyo
// data_type real sea "list" (base7Options, nonBase7Options,
// economicActivities...), no solo drivingLicenses. rejection_reason nuevo
// "list_field_used_as_scalar", distinto de "driving_licenses_used_as_scalar"
// (v9 se mantiene intacto). Ver golden_dataset_auto.json,
// schema_notes["list_field_used_as_scalar (31/08, Guardrail v10 -- patron 6 cerrado)"].
function checkListFieldUsedAsScalar(workflow, golden) {
  console.log("\n=== Check: list_field_used_as_scalar (nodo Coverage Dependency Risk Field Guardrail v10) ===");

  const cases = golden.cases.filter(c => c.category === "list_field_used_as_scalar");

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
      .filter(d => d.rejection_reason === "list_field_used_as_scalar")
      .map(d => d.risk_field);
    const expectedRejected = c.expected_rejected_risk_fields || [];
    const allExpectedRejected = expectedRejected.every(f => rejectedFields.includes(f));
    const nothingLeaked = (result.output?.coverage_dependencies || []).length === 0;

    const ok = allExpectedRejected && nothingLeaked;
    if (!ok) failures++;

    console.log(
      `${ok ? "PASS" : "FAIL"} ${c.id} (${c.semantic_unit_ref}): rechazados=${JSON.stringify(rejectedFields)} (esperado ${JSON.stringify(expectedRejected)}) | nada_se_cuela=${nothingLeaked}`
    );
  }

  console.log(`Resultado: ${cases.length - failures}/${cases.length} pasan.`);
  return failures;
}

// Guardrail v15 (01/09): verifica que un value de "base7Version.base7Engine.id"
// que no coincida con vocabulario real de tipo de motor/combustible (ni sea un
// id numerico 1-13) se rechace -- rejection_reason "engine_field_invalid_value".
// Cierra el hallazgo A (patron recurrente en 3 companias: Zurich/Axa/Pelayo,
// "combustible equivocado"/"combustible" descrito como averia, no tipo de
// motor real). Ver golden_dataset_auto.json,
// schema_notes["engine_field_invalid_value (01/09, Guardrail v15 -- hallazgo A cerrado)"].
function checkEngineFieldInvalidValue(workflow, golden) {
  console.log("\n=== Check: engine_field_invalid_value (nodo Coverage Dependency Risk Field Guardrail v15) ===");

  const cases = golden.cases.filter(c => c.category === "engine_field_invalid_value");

  if (!findNode(workflow, "Coverage Dependency Risk Field Guardrail")) {
    console.log("Nodo 'Coverage Dependency Risk Field Guardrail' no encontrado -- check omitido.");
    return 0;
  }

  let failures = 0;

  for (const c of cases) {
    const [result] = runNode(workflow, "Coverage Dependency Risk Field Guardrail", [
      { semantic_unit_id: c.semantic_unit_ref, ontology_type: "auto", output: { coverage_dependencies: c.actual_coverage_dependencies } }
    ]);

    const rejectedFields = (result.rejected_dependencies || [])
      .filter(d => d.rejection_reason === "engine_field_invalid_value")
      .map(d => d.risk_field);
    const expectedRejected = c.expected_rejected_risk_fields || [];
    const allExpectedRejected = expectedRejected.every(f => rejectedFields.includes(f));
    const nothingLeaked = (result.output?.coverage_dependencies || []).length === 0;

    const ok = allExpectedRejected && nothingLeaked;
    if (!ok) failures++;

    console.log(
      `${ok ? "PASS" : "FAIL"} ${c.id} (${c.semantic_unit_ref}): rechazados=${JSON.stringify(rejectedFields)} (esperado ${JSON.stringify(expectedRejected)}) | nada_se_cuela=${nothingLeaked}`
    );
  }

  console.log(`Resultado: ${cases.length - failures}/${cases.length} pasan.`);
  return failures;
}

// Guardrail v18/v19 (01/09): dos rechazos duros del patron 3 ("age inventado").
// v18 (agnostico de ramo): campo sintetico de duracion (age/licenseYears/
// registrationYears) con value 0 -- vacio semanticamente ("age > 0" siempre
// cierto, "age = 0" siempre falso). v19 (gateado a Autos): umbral de edad que
// implica minoria de edad -- siempre es un tercero (hijos/beneficiarios), no
// una figura declarada. Cada caso declara "expected_rejection_reason" porque
// ambas categorias comparten mecanismo (rechazo duro) pero razones distintas.
// Cubren ademas los 3 casos del hallazgo B (GD-AUTO-HALLUC-022/023/024), que
// estaban documentados como "sin guardrail de respaldo posible".
function checkInventedAgeRejections(workflow, golden) {
  console.log("\n=== Check: duration_field_used_as_existence_check / age_threshold_implausible_for_figure (Guardrail v18/v19) ===");

  const cases = golden.cases.filter(c =>
    c.expected_rejection_reason === "duration_field_used_as_existence_check" ||
    c.expected_rejection_reason === "age_threshold_implausible_for_figure"
  );

  if (!findNode(workflow, "Coverage Dependency Risk Field Guardrail")) {
    console.log("Nodo 'Coverage Dependency Risk Field Guardrail' no encontrado -- check omitido.");
    return 0;
  }

  let failures = 0;

  for (const c of cases) {
    const [result] = runNode(workflow, "Coverage Dependency Risk Field Guardrail", [
      { semantic_unit_id: c.semantic_unit_ref, ontology_type: "auto", output: { coverage_dependencies: c.actual_coverage_dependencies } }
    ]);

    const rejectedFields = (result.rejected_dependencies || [])
      .filter(d => d.rejection_reason === c.expected_rejection_reason)
      .map(d => d.risk_field);
    const expectedRejected = c.expected_rejected_risk_fields || [];
    const allExpectedRejected = expectedRejected.every(f => rejectedFields.includes(f));
    const nothingLeaked = (result.output?.coverage_dependencies || []).length === 0;

    const ok = allExpectedRejected && nothingLeaked;
    if (!ok) failures++;

    console.log(
      `${ok ? "PASS" : "FAIL"} ${c.id} (${c.semantic_unit_ref}): rechazados=${JSON.stringify(rejectedFields)} (esperado ${JSON.stringify(expectedRejected)}, razon ${c.expected_rejection_reason}) | nada_se_cuela=${nothingLeaked}`
    );
  }

  console.log(`Resultado: ${cases.length - failures}/${cases.length} pasan.`);
  return failures;
}

// v18/v19 (01/09): contra-prueba de falsos positivos -- los umbrales y campos
// que SI son legitimos deben seguir aceptandose. Sin esto, un endurecimiento
// futuro de v18/v19 podria cargarse condiciones reales sin que nadie lo note
// (p.ej. "content > 0" de Hogar, o "age < 25" de conductor joven).
function checkInventedAgeNoFalsePositives(workflow) {
  console.log("\n=== Check: v18/v19 no tocan condiciones legitimas (contra-prueba) ===");

  if (!findNode(workflow, "Coverage Dependency Risk Field Guardrail")) {
    console.log("Nodo 'Coverage Dependency Risk Field Guardrail' no encontrado -- check omitido.");
    return 0;
  }

  const mustSurvive = [
    // Capitales de Hogar con value 0: la regla de existencia SIGUE siendo valida
    ["home", { risk_field: "content", operator: ">", value: 0, evidence: "cuando se contrate capital de Mobiliario" }],
    ["home", { risk_field: "continent", operator: ">", value: 0, evidence: "cuando se asegure el continente" }],
    // Edades plausibles de una figura declarada en Autos
    ["auto", { risk_field: "primaryDriver.age", operator: "<", value: 25, evidence: "menor de 25 años" }],
    ["auto", { risk_field: "secondaryDriver.age", operator: "<=", value: 25, evidence: "edad <= 25 años" }],
    ["auto", { risk_field: "primaryDriver.age", operator: ">=", value: 25, evidence: "igual o superior a 25 años" }],
    ["auto", { risk_field: "primaryDriver.age", operator: "<", value: 76, evidence: "inferior a 76 años" }],
    ["auto", { risk_field: "primaryDriver.age", operator: "<=", value: 18, evidence: "18 años o menos" }],
    ["auto", { risk_field: "primaryDriver.age", operator: "=", value: 18, evidence: "de 18 años" }],
    // Duraciones con umbral real (no 0)
    ["auto", { risk_field: "primaryDriver.licenseYears", operator: ">", value: 1, evidence: "antigüedad del carné superior a 1 año" }],
    ["auto", { risk_field: "registrationYears", operator: "<", value: 2, evidence: "durante los dos primeros años" }]
  ];

  let failures = 0;
  for (const [ramo, dep] of mustSurvive) {
    const [result] = runNode(workflow, "Coverage Dependency Risk Field Guardrail", [
      { semantic_unit_id: "fp_test", ontology_type: ramo, output: { coverage_dependencies: [dep] } }
    ]);
    const survived = (result.output?.coverage_dependencies || []).length === 1;
    if (!survived) failures++;
    console.log(`${survived ? "PASS" : "FAIL"} [${ramo}] ${dep.risk_field} ${dep.operator} ${dep.value} sigue aceptada`);
  }

  console.log(`Resultado: ${failures === 0 ? "0 fallos" : failures + " fallos"}.`);
  return failures;
}

// Guardrail v16 (01/09): verifica que policy_admission_criteria_dependencies
// marca (visibilidad, no bloqueo) las dependencias de una unidad cuyo
// sourceText completo describe criterios de ADMISION de una persona en una
// figura (p.ej. "se podran incluir conductores principales...que cumplan"),
// no una condicion de aplicabilidad de garantia. Cierra el hallazgo C. Ver
// golden_dataset_auto.json, schema_notes["policy_admission_criteria (01/09,
// Guardrail v16 -- hallazgo C cerrado)"].
function checkPolicyAdmissionCriteriaVisibility(workflow, golden) {
  console.log("\n=== Check: policy_admission_criteria_dependencies (nodo Coverage Dependency Risk Field Guardrail v16) ===");

  const cases = golden.cases.filter(c => c.expected_policy_admission_criteria_flagged !== undefined);

  if (!findNode(workflow, "Coverage Dependency Risk Field Guardrail")) {
    console.log("Nodo 'Coverage Dependency Risk Field Guardrail' no encontrado -- check omitido.");
    return 0;
  }

  let failures = 0;

  for (const c of cases) {
    const [result] = runNode(workflow, "Coverage Dependency Risk Field Guardrail", [
      {
        semantic_unit_id: c.semantic_unit_ref,
        ontology_type: "auto",
        coverage_context: { article: c.article, coverage_path: c.coverage_path || [] },
        chunks: [{ chunk_id: `${c.id}_c1`, text: c.source_text }],
        output: { coverage_dependencies: c.actual_coverage_dependencies }
      }
    ]);

    const flaggedFields = (result.policy_admission_criteria_dependencies || []).map(d => d.risk_field);
    const isFlagged = flaggedFields.length > 0;
    const flagOk = isFlagged === c.expected_policy_admission_criteria_flagged;

    const acceptedFields = (result.output?.coverage_dependencies || []).map(d => d.risk_field);
    const expectedAcceptedFields = (c.actual_coverage_dependencies || []).map(d => d.risk_field);
    const nothingLost = expectedAcceptedFields.every(f => acceptedFields.includes(f));

    const ok = flagOk && nothingLost;
    if (!ok) failures++;

    console.log(
      `${ok ? "PASS" : "FAIL"} ${c.id} (${c.semantic_unit_ref}): flagged=${isFlagged} (esperado ${c.expected_policy_admission_criteria_flagged}) | sigue_aceptada=${nothingLost}`
    );
  }

  console.log(`Resultado: ${cases.length - failures}/${cases.length} pasan.`);
  return failures;
}

// Guardrail v17 (01/09): verifica que percentage_indemnification_dependencies
// marca (visibilidad, no bloqueo, AGNOSTICO de ramo) cualquier dependencia
// cuyo evidence contiene un porcentaje numerico -- señal de escala/calculo de
// indemnizacion, no condicion de aplicabilidad. Cierra el hallazgo D. Ver
// golden_dataset_auto.json, schema_notes["percentage_indemnification (01/09,
// Guardrail v17 -- hallazgo D cerrado)"].
function checkPercentageIndemnificationVisibility(workflow, golden) {
  console.log("\n=== Check: percentage_indemnification_dependencies (nodo Coverage Dependency Risk Field Guardrail v17) ===");

  const cases = golden.cases.filter(c => c.expected_percentage_indemnification_flagged !== undefined);

  if (!findNode(workflow, "Coverage Dependency Risk Field Guardrail")) {
    console.log("Nodo 'Coverage Dependency Risk Field Guardrail' no encontrado -- check omitido.");
    return 0;
  }

  let failures = 0;

  for (const c of cases) {
    // 03/09: desde v24 este chequeo ya no depende solo del "evidence" -- dos de
    // sus tres anclas miran el TITULO del capitulo y el TEXTO de la unidad, asi
    // que hay que pasarle el contexto completo (como hacen los checks de
    // v5/v6/v7/v16). Con la llamada anterior, que solo pasaba las
    // dependencias, el caso de Axa su_00169 (que se detecta por el titulo
    // "6. Valor a nuevo a 3 anios") no podia dispararse.
    const [result] = runNode(workflow, "Coverage Dependency Risk Field Guardrail", [
      {
        semantic_unit_id: c.semantic_unit_ref,
        ontology_type: c.ontology_type || "auto",
        coverage_context: { article: c.article, coverage_path: c.coverage_path || [] },
        chunks: [{ chunk_id: `${c.id}_c1`, text: c.source_text }],
        output: { coverage_dependencies: c.actual_coverage_dependencies }
      }
    ]);

    const flaggedFields = (result.percentage_indemnification_dependencies || []).map(d => d.risk_field);
    const isFlagged = flaggedFields.length > 0;
    const flagOk = isFlagged === c.expected_percentage_indemnification_flagged;

    // Alineado el 04/09 con la invariante que ya usaban los otros chequeos de
    // visibilidad (transversal, procedural, person_field_mismatch): lo que hay
    // que asertar es que NADA DESAPARECE SIN DEJAR RASTRO, no que todo siga
    // aceptado. La marca en si nunca quita nada, pero otra regla de rechazo
    // duro si puede, y eso es legitimo mientras quede en
    // rejected_dependencies. Lo destapo v30, que rechaza duro las 2
    // dependencias de persona de su_00027 -- conviven en la misma unidad con
    // la tabla de valoracion que vigila este chequeo.
    const acceptedFields = (result.output?.coverage_dependencies || []).map(d => d.risk_field);
    const rejectedFields = (result.rejected_dependencies || []).map(d => d.risk_field);
    const inputFields = (c.actual_coverage_dependencies || []).map(d => d.risk_field);
    const nothingLost = inputFields.every(
      f => acceptedFields.includes(f) || rejectedFields.includes(f)
    );

    const ok = flagOk && nothingLost;
    if (!ok) failures++;

    console.log(
      `${ok ? "PASS" : "FAIL"} ${c.id} (${c.semantic_unit_ref}): flagged=${isFlagged} (esperado ${c.expected_percentage_indemnification_flagged}) | nada_desaparece_sin_rastro=${nothingLost}`
    );
  }

  console.log(`Resultado: ${cases.length - failures}/${cases.length} pasan.`);
  return failures;
}

// Guardrail v21 (03/09): verifica que premium_calculation_dependencies marca
// (visibilidad, no bloqueo, AGNOSTICO de ramo) las dependencias de una unidad
// cuyo sourceText completo describe una regla de PRECIO -- bonificacion/bonus/
// malus/recargo/descuento -- en vez de una condicion de aplicabilidad de
// garantia. Cierra el patron 2 de la revision manual del 01/09. Igual que
// v16/v20 se evalua sobre la unidad completa, no sobre el evidence de cada
// dependencia: en el caso real de Reale su_00064 el "recargo del 20%" esta en
// la unidad pero fuera del evidence que eligio el LLM. Ver
// golden_dataset_auto.json, schema_notes["premium_calculation_rule (03/09,
// Guardrail v21 -- patron 2 cerrado)"].
function checkPremiumCalculationVisibility(workflow, golden) {
  console.log("\n=== Check: premium_calculation_dependencies (nodo Coverage Dependency Risk Field Guardrail v21) ===");

  const cases = golden.cases.filter(c => c.expected_premium_calculation_flagged !== undefined);

  if (!findNode(workflow, "Coverage Dependency Risk Field Guardrail")) {
    console.log("Nodo 'Coverage Dependency Risk Field Guardrail' no encontrado -- check omitido.");
    return 0;
  }

  let failures = 0;

  for (const c of cases) {
    const [result] = runNode(workflow, "Coverage Dependency Risk Field Guardrail", [
      {
        semantic_unit_id: c.semantic_unit_ref,
        ontology_type: c.ontology_type || "auto",
        coverage_context: { article: c.article, coverage_path: c.coverage_path || [] },
        chunks: [{ chunk_id: `${c.id}_c1`, text: c.source_text }],
        output: { coverage_dependencies: c.actual_coverage_dependencies }
      }
    ]);

    const isFlagged = (result.premium_calculation_dependencies || []).length > 0;
    const flagOk = isFlagged === c.expected_premium_calculation_flagged;

    // A diferencia de los checks de v16/v17, aqui "nada se pierde" no puede
    // exigir que TODAS las dependencias sigan aceptadas: varios de estos
    // casos reales contienen ademas dependencias que otro chequeo rechaza
    // duro y con razon (p.ej. "registrationYears > 0" de su_00069, que cae
    // en v18). La propiedad que de verdad importa de un chequeo de
    // visibilidad es que ninguna dependencia desaparezca EN SILENCIO: cada
    // una debe estar o aceptada o en rejected_dependencies.
    const acceptedFields = (result.output?.coverage_dependencies || []).map(d => d.risk_field);
    const rejectedFields = (result.rejected_dependencies || []).map(d => d.risk_field);
    const inputFields = (c.actual_coverage_dependencies || []).map(d => d.risk_field);
    const nothingLost = inputFields.every(f => acceptedFields.includes(f) || rejectedFields.includes(f));

    const ok = flagOk && nothingLost;
    if (!ok) failures++;

    console.log(
      `${ok ? "PASS" : "FAIL"} ${c.id} (${c.semantic_unit_ref}): flagged=${isFlagged} (esperado ${c.expected_premium_calculation_flagged}) | nada_perdido_en_silencio=${nothingLost}`
    );
  }

  console.log(`Resultado: ${cases.length - failures}/${cases.length} pasan.`);
  return failures;
}

// Guardrail v11 (31/08): verifica que ningun risk_field de la categoria
// person_vehicle_field_confusion se cuele en coverage_dependencies -- sea
// cual sea la capa que lo rechace (v11 nueva, isImplausibleYearValue; o el
// chequeo de forma ya existente, isValueTypeValid, para variantes con
// value string/array). Cada caso declara "expected_rejection_reason" para
// verificar tambien QUE capa lo rechaza, no solo que se rechace. Cuando el
// caso trae "corrected_coverage_dependencies" (usando registrationYears/
// age), se verifica ademas que ESA pase el guardrail sin problema.
function checkRelativeDurationMisuse(workflow, golden) {
  console.log("\n=== Check: person_vehicle_field_confusion (nodo Coverage Dependency Risk Field Guardrail v11) ===");

  const cases = golden.cases.filter(c => c.category === "person_vehicle_field_confusion");

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
      .filter(d => !c.expected_rejection_reason || d.rejection_reason === c.expected_rejection_reason)
      .map(d => d.risk_field);
    const expectedRejected = c.expected_rejected_risk_fields || [];
    const allExpectedRejected = expectedRejected.every(f => rejectedFields.includes(f));
    const nothingLeaked = (result.output?.coverage_dependencies || [])
      .every(d => !expectedRejected.includes(d.risk_field));

    let correctedOk = true;
    let correctedAccepted = [];
    if (c.corrected_coverage_dependencies) {
      const [goodResult] = runNode(workflow, "Coverage Dependency Risk Field Guardrail", [
        { semantic_unit_id: c.semantic_unit_ref, output: { coverage_dependencies: c.corrected_coverage_dependencies } }
      ]);
      correctedAccepted = (goodResult.output?.coverage_dependencies || []).map(d => d.risk_field);
      correctedOk = c.corrected_coverage_dependencies.every(d => correctedAccepted.includes(d.risk_field));
    }

    const ok = allExpectedRejected && nothingLeaked && correctedOk;
    if (!ok) failures++;

    console.log(
      `${ok ? "PASS" : "FAIL"} ${c.id} (${c.semantic_unit_ref}): rechazados=${JSON.stringify(rejectedFields)} (esperado ${JSON.stringify(expectedRejected)}, razon ${c.expected_rejection_reason || "cualquiera"}) | nada_se_cuela=${nothingLeaked}` +
        (c.corrected_coverage_dependencies ? ` | corregida_aceptada=${correctedOk} (${JSON.stringify(correctedAccepted)})` : "")
    );
  }

  console.log(`Resultado: ${cases.length - failures}/${cases.length} pasan.`);
  return failures;
}

// Guardrail v12 (31/08): visibilidad -- verifica que figure_selection_dependencies
// marca (inconsistent_figure_selection=true) cualquier dependencia aceptada
// cuyo campo base de Person tambien aparece con una figura distinta en la
// misma llamada, y que ninguna dependencia se pierde de coverage_dependencies
// (es visibilidad, no bloqueo).
function checkFigureSelectionVisibility(workflow, golden) {
  console.log("\n=== Check: inconsistent_figure_selection (nodo Coverage Dependency Risk Field Guardrail v12) ===");

  const cases = golden.cases.filter(c => c.category === "inconsistent_figure_selection");

  if (!findNode(workflow, "Coverage Dependency Risk Field Guardrail")) {
    console.log("Nodo 'Coverage Dependency Risk Field Guardrail' no encontrado -- check omitido.");
    return 0;
  }

  let failures = 0;

  for (const c of cases) {
    const [result] = runNode(workflow, "Coverage Dependency Risk Field Guardrail", [
      { semantic_unit_id: c.semantic_unit_ref, ontology_type: "auto", output: { coverage_dependencies: c.actual_coverage_dependencies } }
    ]);

    const acceptedFields = (result.output?.coverage_dependencies || []).map(d => d.risk_field);
    const flaggedFields = (result.figure_selection_dependencies || []).map(d => d.risk_field);
    const expectedFlagged = c.expected_flagged_risk_fields || [];

    const nothingLost = c.actual_coverage_dependencies.every(d => acceptedFields.includes(d.risk_field));
    const allFlaggedPresent = expectedFlagged.every(f => flaggedFields.includes(f));
    const countsMatch = flaggedFields.length === expectedFlagged.length;

    const ok = nothingLost && allFlaggedPresent && countsMatch;
    if (!ok) failures++;

    console.log(
      `${ok ? "PASS" : "FAIL"} ${c.id} (${c.semantic_unit_ref}): flagged=${JSON.stringify(flaggedFields)} (esperado ${JSON.stringify(expectedFlagged)}) | sigue_aceptada=${nothingLost}`
    );
  }

  console.log(`Resultado: ${cases.length - failures}/${cases.length} pasan.`);
  return failures;
}

// 31/08: hallado en produccion (5 ejecuciones reales, Axa/Qualitas/Reale/
// Zurich/Generali) que "figure_selection_dependencies" (Guardrail v12)
// nunca llegaba al artefacto final -- el flag inline
// "inconsistent_figure_selection" si viajaba en cada dependencia, pero la
// lista agregada no se hilo hacia "Build Coverage Dependency Artifact" ni
// "Build Coverage Matcher Contract" al desplegar v12. Ningun check
// anterior cubria este threading para NINGUNA de las listas de
// visibilidad del guardrail (transversal_chapter_dependencies,
// coverage_scope_dependencies...) -- todas se validaban solo dentro del
// propio guardrail, nunca aguas abajo. Este check generico cubre las 8
// listas conocidas de una vez, para que un descuido similar en una lista
// futura se detecte aqui en vez de en produccion.
function checkGuardrailListThreading(workflow) {
  console.log("\n=== Check: threading de las listas del guardrail hacia el artefacto final ===");

  const sideListKeys = [
    "rejected_dependencies",
    "ungrounded_dependencies",
    "unverified_evidence_dependencies",
    "transversal_chapter_dependencies",
    "procedural_instruction_dependencies",
    "person_field_mismatch_dependencies",
    "coverage_scope_dependencies",
    "figure_selection_dependencies",
    "policy_admission_criteria_dependencies",
    "percentage_indemnification_dependencies",
    "premium_calculation_dependencies"
  ];

  let failures = 0;

  if (!findNode(workflow, "Build Coverage Dependency Artifact")) {
    console.log("Nodo 'Build Coverage Dependency Artifact' no encontrado -- check omitido.");
    return 0;
  }

  const fakeGuardrailOutput = {
    semantic_unit_id: "su_fake",
    coverage_context: {},
    chunks: [],
    output: { coverage_dependencies: [] }
  };
  for (const key of sideListKeys) fakeGuardrailOutput[key] = [{ marker: key }];

  const [artifact] = runNode(workflow, "Build Coverage Dependency Artifact", [fakeGuardrailOutput]);

  for (const key of sideListKeys) {
    const ok = Array.isArray(artifact[key]) && artifact[key].length === 1 && artifact[key][0].marker === key;
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"} ${key} se propaga intacto a Build Coverage Dependency Artifact`);
  }

  if (findNode(workflow, "Build Coverage Matcher Contract")) {
    const [contract] = runNode(workflow, "Build Coverage Matcher Contract", [
      { ...artifact, has_dependencies: true }
    ]);
    for (const key of sideListKeys) {
      const totalKey = "total_" + key.replace(/_dependencies$/, "") + "_dependencies";
      const ok = contract[totalKey] === 1;
      if (!ok) failures++;
      console.log(`${ok ? "PASS" : "FAIL"} ${totalKey} = ${contract[totalKey]} (esperado 1) en Build Coverage Matcher Contract`);
    }
  } else {
    console.log("Nodo 'Build Coverage Matcher Contract' no encontrado -- mitad del check omitida.");
  }

  console.log(`Resultado: ${failures === 0 ? "0 fallos" : failures + " fallos"}.`);
  return failures;
}

// v14 (2026-09-01): verifica que "Prepare Dependency Extractor Input" hila
// "ontology_type" ("home"/"auto") leyendo el campo "Ramo" del form trigger,
// con el mismo mapeo que ya usa "Qdrant Search" para elegir la coleccion.
// Primer paso de la separacion nucleo/ramo del prompt y el guardrail --
// ver checkOntologyTypeGating mas abajo para la propiedad que este campo
// habilita.
function checkOntologyTypeThreading(workflow) {
  console.log("\n=== Check: threading de ontology_type (nodo Prepare Dependency Extractor Input v3) ===");

  const node = findNode(workflow, "Prepare Dependency Extractor Input");
  if (!node) {
    console.log("Nodo 'Prepare Dependency Extractor Input' no encontrado -- check omitido.");
    return 0;
  }

  const fn = new Function("items", "$json", "$input", "$getWorkflowStaticData", "$", node.parameters.jsCode);

  function run(ramo) {
    const nodeRegistry = { "On form submission": { first: () => ({ json: { Ramo: ramo } }) } };
    const $ = name => nodeRegistry[name];
    const items = [{ json: { semantic_unit_id: "su_fake", chunks: [], unit_ontology_matches: [] } }];
    const $input = { first: () => items[0], all: () => items };
    return fn(items, items[0].json, $input, () => ({}), $)[0].json;
  }

  let failures = 0;
  const cases = [["Autos", "auto"], ["Hogar", "home"]];
  for (const [ramo, expected] of cases) {
    const actual = run(ramo).ontology_type;
    const ok = actual === expected;
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"} Ramo="${ramo}" -> ontology_type="${actual}" (esperado "${expected}")`);
  }

  console.log(`Resultado: ${failures === 0 ? "0 fallos" : failures + " fallos"}.`);
  return failures;
}

// v14 (2026-09-01): verifica la propiedad de fondo del gating por ramo --
// una dependencia con vocabulario/campos exclusivos de Autos (drivingLicenses
// escalar, evidencia con keyword de figura inequivoco, duplicado
// primaryDriver+secondaryDriver sin distincion, articulo de alcance de
// garantia) NUNCA debe disparar los chequeos v7/v8/v9/v12/v13 cuando
// ontology_type !== "auto" -- ni de forma incorrecta (aceptando lo que
// deberia rechazarse) ni de forma silenciosa (los checks CORE, p.ej. v10
// generico de "list", deben seguir cazando lo que sea real independientemente
// del ramo). Sin esta garantia, la separacion nucleo/ramo del guardrail
// podria "perder" cobertura real en vez de solo dejar de disparar en falso.
function checkOntologyTypeGating(workflow) {
  console.log("\n=== Check: gating por ontology_type de los chequeos especificos de Autos (v7/v8/v9/v12/v13) ===");

  if (!findNode(workflow, "Coverage Dependency Risk Field Guardrail")) {
    console.log("Nodo 'Coverage Dependency Risk Field Guardrail' no encontrado -- check omitido.");
    return 0;
  }

  let failures = 0;
  function expect(label, condition) {
    const ok = !!condition;
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  }

  // v9: drivingLicenses escalar -- rechazado en Autos (razon especifica),
  // pero NO se cuela en Hogar: el chequeo CORE v10 (list generico) lo caza igual.
  const dlDep = { risk_field: "primaryDriver.drivingLicenses", operator: "!=", value: null, evidence: "carezca del permiso" };
  const [dlAuto] = runNode(workflow, "Coverage Dependency Risk Field Guardrail", [
    { semantic_unit_id: "t1", ontology_type: "auto", output: { coverage_dependencies: [dlDep] } }
  ]);
  const [dlHome] = runNode(workflow, "Coverage Dependency Risk Field Guardrail", [
    { semantic_unit_id: "t1", ontology_type: "home", output: { coverage_dependencies: [dlDep] } }
  ]);
  expect("v9 (auto): drivingLicenses escalar rechazado con razon especifica",
    (dlAuto.rejected_dependencies || []).some(d => d.rejection_reason === "driving_licenses_used_as_scalar"));
  expect("v9 (home): gate desactivado (no dispara la razon especifica de v9)",
    !(dlHome.rejected_dependencies || []).some(d => d.rejection_reason === "driving_licenses_used_as_scalar"));
  expect("v10 CORE (home): sigue rechazando por ser data_type list, nada se cuela",
    (dlHome.output?.coverage_dependencies || []).length === 0 &&
    (dlHome.rejected_dependencies || []).some(d => d.rejection_reason === "list_field_used_as_scalar"));

  // v13a: vocabulario inequivoco de figura ("Tomador") contra risk_field de otra figura.
  const figDep = { risk_field: "owner.identificationType", operator: "=", value: "persona física", evidence: "el Tomador, persona física" };
  const [figAuto] = runNode(workflow, "Coverage Dependency Risk Field Guardrail", [
    { semantic_unit_id: "t2", ontology_type: "auto", output: { coverage_dependencies: [figDep] } }
  ]);
  const [figHome] = runNode(workflow, "Coverage Dependency Risk Field Guardrail", [
    { semantic_unit_id: "t2", ontology_type: "home", output: { coverage_dependencies: [figDep] } }
  ]);
  expect("v13a (auto): figure_keyword_mismatch rechaza el campo equivocado",
    (figAuto.rejected_dependencies || []).some(d => d.rejection_reason === "figure_keyword_mismatch"));
  expect("v13a (home): gate desactivado, la dependencia se acepta tal cual",
    (figHome.output?.coverage_dependencies || []).map(d => d.risk_field).includes("owner.identificationType"));

  // v13b/v12: duplicado primaryDriver+secondaryDriver sobre la misma evidencia, sin distincion textual.
  const dupDeps = [
    { risk_field: "primaryDriver.age", operator: "<", value: 25, evidence: "el conductor sea menor de 25 años" },
    { risk_field: "secondaryDriver.age", operator: "<", value: 25, evidence: "el conductor sea menor de 25 años" }
  ];
  const [dupAuto] = runNode(workflow, "Coverage Dependency Risk Field Guardrail", [
    { semantic_unit_id: "t3", ontology_type: "auto", output: { coverage_dependencies: dupDeps } }
  ]);
  const [dupHome] = runNode(workflow, "Coverage Dependency Risk Field Guardrail", [
    { semantic_unit_id: "t3", ontology_type: "home", output: { coverage_dependencies: dupDeps } }
  ]);
  expect("v13b (auto): ambas duplicadas se rechazan",
    (dupAuto.output?.coverage_dependencies || []).length === 0);
  expect("v13b (home): gate desactivado, ambas se aceptan sin deduplicar",
    (dupHome.output?.coverage_dependencies || []).length === 2);
  expect("v12 (home): gate desactivado, figure_selection_dependencies vacio",
    (dupHome.figure_selection_dependencies || []).length === 0);

  // v8: articulo de alcance de garantia ("¿Quien esta asegurado?").
  const scopeDep = { risk_field: "primaryDriver.identificationType", operator: "=", value: "persona física", evidence: "el conductor titular" };
  const [scopeAuto] = runNode(workflow, "Coverage Dependency Risk Field Guardrail", [
    { semantic_unit_id: "t4", ontology_type: "auto", coverage_context: { article: "¿Quién está asegurado?", coverage_path: [] }, output: { coverage_dependencies: [scopeDep] } }
  ]);
  const [scopeHome] = runNode(workflow, "Coverage Dependency Risk Field Guardrail", [
    { semantic_unit_id: "t4", ontology_type: "home", coverage_context: { article: "¿Quién está asegurado?", coverage_path: [] }, output: { coverage_dependencies: [scopeDep] } }
  ]);
  expect("v8 (auto): coverage_scope_dependencies marca la dependencia",
    (scopeAuto.coverage_scope_dependencies || []).length === 1);
  expect("v8 (home): gate desactivado, coverage_scope_dependencies vacio",
    (scopeHome.coverage_scope_dependencies || []).length === 0);

  console.log(`Resultado: ${failures === 0 ? "0 fallos" : failures + " fallos"}.`);
  return failures;
}

// v2 (2026-09-01): verifica el nodo "Prompt Assembler" (separacion nucleo/ramo
// del prompt del extractor, mismo motivo que Guardrail v14) -- que el bloque
// especifico de cada ramo aparece SOLO en su propio ontology_type, que el
// nucleo aparece en ambos, que la sustitucion del JSON del item funciona, y
// que "Coverage Dependency Extractor" ya no lleva el prompt literal sino que
// referencia $json.prompt_text. Desde v2, core.md/ramos/*.md viven en disco
// (knowledge/prompts/coverage_dependency_extractor/, montados read-only en
// /home/node/prompts -- ver docker-compose.yml) y "Read Core/Ramo Prompt
// File" -> "Extract Core/Ramo Prompt Text" los leen en cada ejecucion real;
// este check lee los MISMOS ficheros del repo con fs (misma ruta relativa,
// sin necesidad de Docker) y mockea $() para simular exactamente lo que esos
// nodos entregarian a "Prompt Assembler". Chequeo estructural/mecanico -- NO
// sustituye a una confirmacion real con el LLM (eso exige una ejecucion real,
// pedida al usuario explicitamente, igual que cualquier otro cambio de
// prompt).
function checkPromptAssembler(workflow) {
  console.log("\n=== Check: separacion nucleo/ramo del prompt (nodo Prompt Assembler) ===");

  const node = findNode(workflow, "Prompt Assembler");
  if (!node) {
    console.log("Nodo 'Prompt Assembler' no encontrado -- check omitido.");
    return 0;
  }

  let failures = 0;
  function expect(label, condition) {
    const ok = !!condition;
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  }

  const promptsBase = path.join(REPO_ROOT, "knowledge", "prompts", "coverage_dependency_extractor");
  const coreMdPath = path.join(promptsBase, "core.md");
  if (!fs.existsSync(coreMdPath)) {
    console.log(`'${coreMdPath}' no encontrado -- check omitido.`);
    return 0;
  }
  const coreText = fs.readFileSync(coreMdPath, "utf8");
  const ramoTexts = {
    auto: fs.readFileSync(path.join(promptsBase, "ramos", "auto.md"), "utf8"),
    home: fs.readFileSync(path.join(promptsBase, "ramos", "home.md"), "utf8")
  };

  const fn = new Function("$json", "$getWorkflowStaticData", "$", node.parameters.jsCode);
  function run(ontologyType) {
    const registry = {
      "Extract Core Prompt Text": { first: () => ({ json: { core_prompt_text: coreText } }) },
      "Extract Ramo Prompt Text": { first: () => ({ json: { ramo_prompt_text: ramoTexts[ontologyType] } }) }
    };
    const $ = name => registry[name];
    const sample = { semantic_unit_id: "su_prompt_test", ontology_type: ontologyType, chunks: [] };
    return fn(sample, () => ({}), $).json.prompt_text;
  }

  const autoPrompt = run("auto");
  const homePrompt = run("home");

  const coreMarkers = ["REGLA FUNDAMENTAL", "REGLAS DE NORMALIZACIÓN", "REQUISITOS DE SALIDA", "REGLA DE ANTIGÜEDAD RELATIVA (PERSONA)"];
  for (const m of coreMarkers) {
    expect(`nucleo "${m}" presente en ambos ramos`, autoPrompt.includes(m) && homePrompt.includes(m));
  }

  const autosMarkers = ["REGLA DE SELECCIÓN DE FIGURA", "REGLA DE CARNÉ DE CONDUCIR", "REGLA DE ANTIGÜEDAD RELATIVA (VEHÍCULO)"];
  for (const m of autosMarkers) {
    expect(`"${m}" solo en auto`, autoPrompt.includes(m) && !homePrompt.includes(m));
  }

  const hogarMarkers = ["EJEMPLO CONTRASTADO", "EJEMPLO ILUSTRATIVO (Hogar)"];
  for (const m of hogarMarkers) {
    expect(`"${m}" solo en home`, homePrompt.includes(m) && !autoPrompt.includes(m));
  }

  expect("JSON del item sustituido en el prompt (auto)", autoPrompt.includes('"semantic_unit_id": "su_prompt_test"'));
  expect("marcador <<<INPUT_JSON>>> no queda sin sustituir", !autoPrompt.includes("<<<INPUT_JSON>>>") && !homePrompt.includes("<<<INPUT_JSON>>>"));
  expect("marcador <<<RAMO_BLOCK>>> no queda sin sustituir", !autoPrompt.includes("<<<RAMO_BLOCK>>>") && !homePrompt.includes("<<<RAMO_BLOCK>>>"));
  expect("registrationYears (campo de Autos) no se filtra al nucleo de Hogar", !homePrompt.includes("registrationYears"));

  const readCore = findNode(workflow, "Read Core Prompt File");
  expect("'Read Core Prompt File' apunta a core.md", !!readCore && readCore.parameters.fileSelector === "/home/node/prompts/coverage_dependency_extractor/core.md");

  const readRamo = findNode(workflow, "Read Ramo Prompt File");
  expect("'Read Ramo Prompt File' selecciona el fichero por ontology_type", !!readRamo && /ramos\/\$\{ontologyType\}\.md/.test(readRamo.parameters.fileSelector));

  const extractor = findNode(workflow, "Coverage Dependency Extractor");
  if (extractor) {
    expect(
      "Coverage Dependency Extractor referencia $json.prompt_text (no lleva el prompt literal)",
      extractor.parameters.text === "={{ $json.prompt_text }}"
    );
  }

  console.log(`Resultado: ${failures === 0 ? "0 fallos" : failures + " fallos"}.`);
  return failures;
}

// Guardrail v13 (31/08): dos rechazos duros para el patron 2, respaldo de
// la REGLA DE SELECCION DE FIGURA del prompt (confirmada insuficiente sola
// con 5 ejecuciones reales) -- figure_keyword_mismatch (vocabulario
// español inequivoco en evidence contra una figura distinta) y
// duplicate_figure_without_distinction (misma evidencia duplicada en
// primaryDriver+secondaryDriver sin distincion textual). Mismo patron de
// verificacion que checkRelativeDurationMisuse (v11): usa
// expected_rejection_reason por caso porque ambas categorias comparten
// mecanismo (rechazo duro via evidence lexico) pero razones distintas.
function checkFigureSelectionRejections(workflow, golden) {
  console.log("\n=== Check: figure_keyword_mismatch / duplicate_figure_without_distinction (nodo Coverage Dependency Risk Field Guardrail v13) ===");

  const cases = golden.cases.filter(c =>
    c.category === "figure_keyword_mismatch" || c.category === "duplicate_figure_without_distinction"
  );

  if (!findNode(workflow, "Coverage Dependency Risk Field Guardrail")) {
    console.log("Nodo 'Coverage Dependency Risk Field Guardrail' no encontrado -- check omitido.");
    return 0;
  }

  let failures = 0;

  for (const c of cases) {
    const [result] = runNode(workflow, "Coverage Dependency Risk Field Guardrail", [
      { semantic_unit_id: c.semantic_unit_ref, ontology_type: "auto", output: { coverage_dependencies: c.actual_coverage_dependencies } }
    ]);

    const rejectedFields = (result.rejected_dependencies || [])
      .filter(d => !c.expected_rejection_reason || d.rejection_reason === c.expected_rejection_reason)
      .map(d => d.risk_field);
    const expectedRejected = c.expected_rejected_risk_fields || [];
    const allExpectedRejected = expectedRejected.every(f => rejectedFields.includes(f));
    const acceptedFields = (result.output?.coverage_dependencies || []).map(d => d.risk_field);
    const expectedAccepted = c.actual_coverage_dependencies
      .map(d => d.risk_field)
      .filter(f => !expectedRejected.includes(f));
    const acceptedOk = expectedAccepted.every(f => acceptedFields.includes(f)) &&
      acceptedFields.every(f => expectedAccepted.includes(f));

    let correctedOk = true;
    let correctedAccepted = [];
    if (c.corrected_coverage_dependencies) {
      const [goodResult] = runNode(workflow, "Coverage Dependency Risk Field Guardrail", [
        { semantic_unit_id: c.semantic_unit_ref, ontology_type: "auto", output: { coverage_dependencies: c.corrected_coverage_dependencies } }
      ]);
      correctedAccepted = (goodResult.output?.coverage_dependencies || []).map(d => d.risk_field);
      correctedOk = c.corrected_coverage_dependencies.every(d => correctedAccepted.includes(d.risk_field));
    }

    const ok = allExpectedRejected && acceptedOk && correctedOk;
    if (!ok) failures++;

    console.log(
      `${ok ? "PASS" : "FAIL"} ${c.id} (${c.semantic_unit_ref}): rechazados=${JSON.stringify(rejectedFields)} (esperado ${JSON.stringify(expectedRejected)}) | aceptados=${JSON.stringify(acceptedFields)} (esperado ${JSON.stringify(expectedAccepted)})` +
        (c.corrected_coverage_dependencies ? ` | corregida_aceptada=${correctedOk} (${JSON.stringify(correctedAccepted)})` : "")
    );
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

  // Caso E: contenido justo despues del ultimo capitulo anclado (indice
  // agotado) sigue anidando bajo el, ventana acotada -- caso real Divina
  // (ANEXO II es la ultima entrada, el documento termina 2 paginas
  // despues, ver caso D arriba).
  const casoColaCorta = assemble([
    // HAS_INDICE exige >=3 entradas parseadas -- las dos primeras no
    // necesitan aparecer como section_header real en el cuerpo, solo
    // estar en la tabla para que el indice cuente como "real".
    { type: "table", page: 3, content: "| CAPITULO A | 10 |\n| CAPITULO B | 25 |\n| ULTIMO CAPITULO DEL INDICE | 40 |" },
    { type: "section_header", page: 40, content: "ULTIMO CAPITULO DEL INDICE" },
    { type: "text", page: 40, content: "Texto de cabecera del ultimo capitulo real." },
    { type: "section_header", page: 41, content: "1. Subgarantia A" },
    { type: "text", page: 41, content: "Texto de la subgarantia A, dos paginas despues del ultimo anclaje." }
  ]);
  const colaCortaUnit = casoColaCorta.find(u => (u.text || "").includes("subgarantia A"));
  const colaCortaOk = !!colaCortaUnit && colaCortaUnit.article === "ULTIMO CAPITULO DEL INDICE";
  console.log(`${colaCortaOk ? "PASS" : "FAIL"} Cola corta (1 pagina) tras agotar el indice sigue anidada bajo el ultimo capitulo: article="${colaCortaUnit && colaCortaUnit.article}"`);
  if (!colaCortaOk) failures++;

  // Caso F (anti-regresion Axa real, CLAUDE.md SS5.10): un capitulo entero
  // SIN LISTAR en el indice, muchas paginas mas alla del ultimo anclaje --
  // NO debe anidarse bajo el ultimo capitulo confirmado, debe seguir
  // cayendo en el fallback heuristico original (capitulo nuevo de nivel 1).
  const casoColaLarga = assemble([
    { type: "table", page: 3, content: "| CAPITULO A | 10 |\n| CAPITULO B | 25 |\n| SOLUCION DE CONFLICTOS | 58 |" },
    { type: "section_header", page: 58, content: "SOLUCION DE CONFLICTOS" },
    { type: "text", page: 58, content: "Texto de cabecera de solucion de conflictos." },
    { type: "section_header", page: 90, content: "CONSORCIO DE COMPENSACIÓN DE SEGUROS" },
    { type: "text", page: 90, content: "Texto de cabecera del Consorcio, capitulo entero sin listar en el indice." },
    { type: "section_header", page: 90, content: "1. Ámbito de aplicación" },
    { type: "text", page: 90, content: "Texto de la subgarantia del Consorcio, 32 paginas despues del ultimo anclaje." }
  ]);
  const colaLargaUnit = casoColaLarga.find(u => (u.text || "").includes("subgarantia del Consorcio"));
  const colaLargaOk = !!colaLargaUnit && colaLargaUnit.article === "1. Ámbito de aplicación";
  console.log(`${colaLargaOk ? "PASS" : "FAIL"} Cola larga (32 paginas) tras agotar el indice vuelve al fallback (capitulo nuevo, no anidado): article="${colaLargaUnit && colaLargaUnit.article}"`);
  if (!colaLargaOk) failures++;

  console.log(`Resultado: ${9 - failures}/9 expectativas cumplidas.`);
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

// 03/09: el hueco de la "puerta del score alto". "Ontology Relevance Filter"
// conserva un concepto si alias_match O final_score >= 0.80. Un alias
// suprimido por negative_aliases deja alias_match en false, asi que el
// concepto podia reentrar por el segundo camino y deshacer la supresion en
// silencio. checkOntology() no podia detectarlo porque monta todos los
// candidatos de Qdrant con un score fijo de 0.5 (por debajo del umbral).
// Este check reutiliza los mismos casos del golden set (los que declaran
// alias_match_expectations con expected_alias_match: false) pero con un
// score POR ENCIMA del umbral, y exige que un concepto realmente suprimido
// no sobreviva. Incluye un control opuesto: un concepto SIN ningun alias en
// el texto debe seguir entrando por score -- ese es el proposito legitimo
// del grupo, y el fix no debe tocarlo.
function checkNegativeAliasScoreDoor(workflow, golden, ramo) {
  console.log("\n=== Check: negative_aliases vs. puerta del score alto (nodo Ontology Relevance Filter) ===");

  if (!findNode(workflow, "Ontology Relevance Filter")) {
    console.log("Nodo 'Ontology Relevance Filter' no encontrado -- check omitido.");
    return 0;
  }

  const ontologyWorkflow = loadJson(ONTOLOGY_WORKFLOW_PATH);
  const ontologyText = fs.readFileSync(ONTOLOGY_MD_PATH, "utf8");

  // Se montan los conceptos igual que en produccion, expandiendo los
  // ficheros compartidos por figura (Merge Shared Texts Into Ramo) -- sin
  // eso, conceptos como "weight" (que vive en shared/person.md, no en el .md
  // del ramo) no aparecerian y el check se saltaria en silencio los casos
  // de Autos, que son justamente los nuevos.
  const ownConcepts = runNode(ontologyWorkflow, "Ontology Splitter", [{ ontology_text: ontologyText }]) || [];
  let sharedConcepts = [];
  if (findNode(ontologyWorkflow, "Merge Shared Texts Into Ramo")) {
    const sharedDir = path.join(REPO_ROOT, "knowledge", "ontologies", "shared");
    const shared = {};
    for (const name of fs.readdirSync(sharedDir)) {
      if (name.endsWith(".md")) shared[name.replace(/\.md$/, "")] = fs.readFileSync(path.join(sharedDir, name), "utf8");
    }
    sharedConcepts = runMergeSharedTextsIntoRamo(ontologyWorkflow, ontologyText, ramo, shared) || [];
  }
  // Ontology Splitter da los conceptos propios del ramo; Merge Shared Texts
  // Into Ramo da los generados por figura desde shared/*.md. Se necesitan los
  // dos: "use"/"lastReformDate" (Hogar) son propios, y "weight" (el caso
  // nuevo de Autos) viene de shared/person.md.
  const byField = new Map();
  for (const k of [...ownConcepts, ...sharedConcepts]) {
    if (k && k.risk_field && !byField.has(k.risk_field)) byField.set(k.risk_field, k);
  }
  const concepts = [...byField.values()];
  if (!concepts.length) {
    console.log("No se pudieron montar los conceptos de la ontologia -- check omitido.");
    return 0;
  }

  const HIGH = 0.95;
  const LOW = 0.5;
  let failures = 0;
  let checked = 0;

  const runOne = (text, concept, score) =>
    runNode(workflow, "Ontology Relevance Filter", [
      { chunk: { chunk_id: "c1", text }, result: [{ score, payload: concept }] }
    ])[0];

  for (const c of golden.cases.filter(x => Array.isArray(x.alias_match_expectations))) {
    for (const exp of c.alias_match_expectations.filter(e => e.expected_alias_match === false)) {

      const concept = concepts.find(k => k.risk_field === exp.risk_field);
      if (!concept) continue;

      // Hay que distinguir dos situaciones que desde fuera se parecen: que
      // el alias existiera en el texto y lo SUPRIMIERA un negative_alias, o
      // que simplemente no hubiera ningun alias. El nodo solo expone
      // negative_alias_suppressed en los matches que devuelve, y un match
      // suprimido con score bajo no se devuelve -- asi que se sondea con el
      // propio nodo: se repite la llamada con los negative_aliases vaciados;
      // si entonces hay alias_match, es que habia alias y lo suprimieron.
      const probe = runOne(c.source_text, { ...concept, negative_aliases: [] }, LOW);
      const probeMatch = (probe.ontology_matches || []).find(m => m.risk_field === exp.risk_field);
      const hadAlias = !!(probeMatch && probeMatch.alias_match);

      const low = runOne(c.source_text, concept, LOW);
      const lowMatch = (low.ontology_matches || []).find(m => m.risk_field === exp.risk_field);
      const wasSuppressed = hadAlias && (!lowMatch || lowMatch.negative_alias_suppressed === true || lowMatch.alias_match === false);

      if (!wasSuppressed) continue;

      const high = runOne(c.source_text, concept, HIGH);
      const survivesByScore = (high.ontology_matches || []).some(m => m.risk_field === exp.risk_field);

      checked++;
      const ok = !survivesByScore;
      if (!ok) failures++;
      console.log(
        `${ok ? "PASS" : "FAIL"} ${c.id} (${c.semantic_unit_ref}): "${exp.risk_field}" suprimido por negative_alias NO reentra con score ${HIGH} (reentra=${survivesByScore})`
      );
    }
  }

  // Control opuesto: concepto sin ningun alias presente en el texto, score
  // alto -> debe seguir entrando (no se ha roto el proposito del grupo).
  const controlConcept = concepts.find(k => (k.aliases || []).length > 0);
  if (controlConcept) {
    const controlText = "Zzzz texto sin ninguna palabra de la ontologia qqqq.";
    const out = runOne(controlText, controlConcept, HIGH);
    const survives = (out.ontology_matches || []).some(m => m.risk_field === controlConcept.risk_field);
    checked++;
    if (!survives) failures++;
    console.log(
      `${survives ? "PASS" : "FAIL"} CONTROL: "${controlConcept.risk_field}" sin alias en el texto SIGUE entrando por score ${HIGH} (entra=${survives})`
    );
  }

  console.log(`Resultado: ${checked - failures}/${checked} pasan.`);
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

// Legal Cue Pre-Filter v2 (03/09): gate de ALCANCE DE RAMO. Verifica las dos
// direcciones sobre casos reales: que una unidad cuyo capitulo declara una
// categoria de vehiculo ajena al ramo se descarta, y que una unidad que solo
// MENCIONA otra categoria en su texto (con un titulo de capitulo neutro) NO
// se descarta en ningun ramo -- ese es el falso positivo que hundiria la
// idea, y por eso el gate se ancla en el titulo. Cierra el patron 5 por la
// via del alcance de ramo. Ver golden_dataset_auto.json, schema_notes
// ["out_of_scope_ramo (03/09, ...)"].
function checkRamoScopeGate(workflow, golden) {
  console.log("\n=== Check: alcance de ramo (nodo Legal Cue Pre-Filter v2) ===");

  if (!findNode(workflow, "Legal Cue Pre-Filter")) {
    console.log("Nodo 'Legal Cue Pre-Filter' no encontrado -- check omitido.");
    return 0;
  }

  const cases = golden.cases.filter(c => Array.isArray(c.ramo_scope_expectations));
  let failures = 0;
  let checked = 0;

  for (const c of cases) {
    for (const exp of c.ramo_scope_expectations) {
      const kept = runNode(
        workflow,
        "Legal Cue Pre-Filter",
        [{
          semantic_unit_id: c.semantic_unit_ref,
          semantic_unit: { id: c.semantic_unit_ref, text: c.source_text },
          article: c.article || null,
          coverage_path: c.coverage_path || []
        }],
        { ramo: exp.ramo }
      );

      const survives = Array.isArray(kept) && kept.length > 0;
      const ok = survives === exp.expected_kept;
      checked++;
      if (!ok) failures++;
      console.log(
        `${ok ? "PASS" : "FAIL"} ${c.id} (${c.semantic_unit_ref}) Ramo=${exp.ramo}: pasa=${survives} (esperado ${exp.expected_kept})`
      );
    }
  }

  // Barrido global: sobre las unidades reales que SI generaron dependencias
  // en produccion, con Ramo=Autos, cuantas descarta el gate nuevo y son
  // exactamente las que declaran una categoria ajena en su titulo.
  const ALIEN_TITLE = /(segunda|tercera)\s+categor[íi]a|categor[íi]a\s+(segunda|tercera)|\b[23][ªa]?\s*categor[íi]a\b|\bcamiones\b|\bmotocicletas?\b|\bciclomotores?\b/i;
  let sweptTotal = 0;
  let sweptSkipped = 0;
  let unexpected = [];
  for (const filename of REAL_RUN_FILES) {
    const filePath = path.join(GGCC_OUTPUTS_DIR, filename);
    if (!fs.existsSync(filePath)) continue;
    const data = loadJson(filePath);
    const root = Array.isArray(data) ? data[0] : data;
    for (const artifact of root.artifacts || []) {
      sweptTotal++;
      const kept = runNode(
        workflow,
        "Legal Cue Pre-Filter",
        [{
          semantic_unit_id: artifact.semantic_unit_id,
          semantic_unit: { id: artifact.semantic_unit_id, text: artifact.source_text },
          article: artifact.article || null,
          coverage_path: artifact.coverage_path || []
        }],
        { ramo: "Autos" }
      );
      const survives = Array.isArray(kept) && kept.length > 0;
      if (survives) continue;
      const titles = [artifact.article, ...(artifact.coverage_path || [])].filter(Boolean).join(" || ");
      if (ALIEN_TITLE.test(titles)) sweptSkipped++;
      else unexpected.push(`${filename} | ${artifact.semantic_unit_id} | titulo="${titles}"`);
    }
  }
  checked++;
  if (unexpected.length) {
    failures++;
    console.log(`FAIL barrido global: ${unexpected.length} unidad(es) descartadas SIN declarar categoria ajena en el titulo:`);
    unexpected.forEach(u => console.log(`     ${u}`));
  } else {
    console.log(
      `PASS barrido global (Ramo=Autos): ${sweptSkipped}/${sweptTotal} unidades reales con dependencias se descartan, y todas declaran una categoria ajena en su titulo`
    );
  }

  console.log(`Resultado: ${checked - failures}/${checked} pasan.`);
  return failures;
}

// Ojo (03/09): este check valida la garantia del gate de CUES, que es una
// optimizacion de coste y por tanto no puede perder recall. NO valida el
// segundo gate del nodo (alcance de ramo, v2), que SI descarta a proposito
// unidades que llamarian al LLM -- eso lo valida checkRamoScopeGate. Aqui se
// llama al nodo sin ramo, asi que ese segundo gate queda inerte.
// Guardrail v25 (04/09, familia A): lightTrailer NUNCA es condicion.
// Decision del usuario por relacion coste/riesgo, no por correccion
// semantica -- ver notas de GD-AUTO-TRAILER-001/002.
function checkTrailerScopeExtension(workflow, golden) {
  console.log("\n=== Check: trailer_scope_extension_not_condition (Guardrail v25) ===");

  const cases = golden.cases.filter(c => c.category === "trailer_scope_extension");

  if (!findNode(workflow, "Coverage Dependency Risk Field Guardrail")) {
    console.log("Nodo 'Coverage Dependency Risk Field Guardrail' no encontrado -- check omitido.");
    return 0;
  }

  let failures = 0;

  for (const c of cases) {
    const [result] = runNode(workflow, "Coverage Dependency Risk Field Guardrail", [
      { semantic_unit_id: c.semantic_unit_ref, ontology_type: "auto", output: { coverage_dependencies: c.actual_coverage_dependencies } }
    ]);

    const rejected = (result.rejected_dependencies || [])
      .filter(d => d.rejection_reason === "trailer_scope_extension_not_condition")
      .map(d => d.risk_field);
    const allRejected = (c.expected_rejected_risk_fields || []).every(f => rejected.includes(f));
    const nothingLeaked = (result.output?.coverage_dependencies || []).length === 0;

    const ok = allRejected && nothingLeaked;
    if (!ok) failures++;

    console.log(
      `${ok ? "PASS" : "FAIL"} ${c.id} (${c.semantic_unit_ref}): rechazados=${JSON.stringify(rejected)} | nada_se_cuela=${nothingLeaked}`
    );
  }

  console.log(`Resultado: ${cases.length - failures}/${cases.length} pasan.`);
  return failures;
}

// Guardrail v28 (04/09, familia B): vocabulario real de tipo de vehiculo,
// por raices y no por literal. Incluye la contra-prueba del sinonimo
// legitimo, que es la que justifica no hacerlo literal.
function checkVehicleTypeValue(workflow, golden) {
  console.log("\n=== Check: vehicle_type_field_invalid_value (Guardrail v28) ===");

  const invalidCases = golden.cases.filter(c => c.category === "vehicle_type_field_invalid_value");
  const validCases = golden.cases.filter(c => c.category === "vehicle_type_valid_synonym");

  if (!findNode(workflow, "Coverage Dependency Risk Field Guardrail")) {
    console.log("Nodo 'Coverage Dependency Risk Field Guardrail' no encontrado -- check omitido.");
    return 0;
  }

  let failures = 0;

  for (const c of invalidCases) {
    const [result] = runNode(workflow, "Coverage Dependency Risk Field Guardrail", [
      { semantic_unit_id: c.semantic_unit_ref, ontology_type: "auto", output: { coverage_dependencies: c.actual_coverage_dependencies } }
    ]);
    const rejected = (result.rejected_dependencies || [])
      .filter(d => d.rejection_reason === "vehicle_type_field_invalid_value")
      .map(d => d.risk_field);
    const ok = (c.expected_rejected_risk_fields || []).every(f => rejected.includes(f))
      && (result.output?.coverage_dependencies || []).length === 0;
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"} ${c.id} (${c.semantic_unit_ref}): rechazados=${JSON.stringify(rejected)}`);
  }

  for (const c of validCases) {
    const [result] = runNode(workflow, "Coverage Dependency Risk Field Guardrail", [
      { semantic_unit_id: c.semantic_unit_ref, ontology_type: "auto", output: { coverage_dependencies: c.actual_coverage_dependencies } }
    ]);
    const accepted = result.output?.coverage_dependencies || [];
    const ok = accepted.length === c.actual_coverage_dependencies.length
      && (result.rejected_dependencies || []).length === 0;
    if (!ok) failures++;
    console.log(
      `${ok ? "PASS" : "FAIL"} ${c.id} (${c.semantic_unit_ref}, CONTRA-PRUEBA sinonimo legitimo): aceptadas=${accepted.length}/${c.actual_coverage_dependencies.length} rechazadas=${(result.rejected_dependencies || []).length}`
    );
  }

  const total = invalidCases.length + validCases.length;
  console.log(`Resultado: ${total - failures}/${total} pasan.`);
  return failures;
}

// Guardrail v29 (04/09, trabajo de categoria): (a) marca la extraccion que
// enumera subtipos donde el texto delimitaba por categoria entera; (b)
// alcance de ramo a nivel de DEPENDENCIA -- rechazo duro si la categoria es
// ajena al ramo, marca vacuous_for_ramo si cubre entera la del ramo.
function checkVehicleCategoryRamoScope(workflow, golden) {
  console.log("\n=== Check: categoria de vehiculo vs. alcance de ramo (Guardrail v29) ===");

  if (!findNode(workflow, "Coverage Dependency Risk Field Guardrail")) {
    console.log("Nodo 'Coverage Dependency Risk Field Guardrail' no encontrado -- check omitido.");
    return 0;
  }

  const cases = golden.cases.filter(c =>
    c.category === "category_expressed_as_type" ||
    c.category === "vehicle_category_ramo_scope" ||
    c.category === "vehicle_category_vacuous"
  );

  let failures = 0;

  for (const c of cases) {
    const [result] = runNode(workflow, "Coverage Dependency Risk Field Guardrail", [
      {
        semantic_unit_id: c.semantic_unit_ref,
        ontology_type: "auto",
        coverage_context: { article: c.article, coverage_path: c.coverage_path || [] },
        chunks: [{ text: c.source_text }],
        output: { coverage_dependencies: c.actual_coverage_dependencies }
      }
    ]);

    const accepted = result.output?.coverage_dependencies || [];
    const rejected = result.rejected_dependencies || [];
    let ok;
    let detalle;

    if (c.category === "vehicle_category_ramo_scope") {
      const reasons = rejected.map(d => d.rejection_reason);
      ok = reasons.includes(c.expected_rejection_reason) && accepted.length === 0;
      detalle = `rechazo=${JSON.stringify(reasons)}`;
    } else {
      const mark = (c.expected_dependency_marks || [])[0];
      ok = accepted.length === c.actual_coverage_dependencies.length
        && accepted.every(d => d[mark] === true)
        && rejected.length === 0;
      detalle = `aceptadas=${accepted.length} marca_${mark}=${accepted.map(d => d[mark] === true).join(",")}`;
    }

    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"} ${c.id} (${c.semantic_unit_ref}, ${c.category}): ${detalle}`);
  }

  console.log(`Resultado: ${cases.length - failures}/${cases.length} pasan.`);
  return failures;
}

// v26/v27 (04/09): stripStructuralNumbering no quitaba la numeracion
// "3-." / "II-." de Zurich, asi que ningun patron de titulo (v5 transversal,
// v8 alcance) se evaluaba sobre el titulo limpio; y a los patrones de v8 les
// faltaba "beneficiario" por una palabra. Se comprueba a traves del nodo
// real, no reimplementando la funcion.
function checkStructuralNumberingAndScopeTitles(workflow) {
  console.log("\n=== Check: numeracion romana/guion en titulos + 'beneficiario' en v8 (Guardrail v26/v27) ===");

  if (!findNode(workflow, "Coverage Dependency Risk Field Guardrail")) {
    console.log("Nodo 'Coverage Dependency Risk Field Guardrail' no encontrado -- check omitido.");
    return 0;
  }

  const dep = { risk_field: "primaryDriver.age", operator: ">=", value: 25, evidence: "el conductor debera ser mayor de 25 anios" };

  const expectations = [
    { titulo: "II-. Definiciones", mark: "transversal_chapter", esperado: true, nota: "Zurich su_00014, numero romano con guion" },
    { titulo: "3-. Asistencia en viaje", mark: "transversal_chapter", esperado: false, nota: "contra-prueba: garantia real con numeracion de guion" },
    { titulo: "IV. Disposiciones generales", mark: "transversal_chapter", esperado: true, nota: "romano con punto" },
    { titulo: "Incendio y sus consecuencias", mark: "transversal_chapter", esperado: false, nota: "CONTRA-PRUEBA CLAVE: empieza por 'I', no debe perder la letra" },
    { titulo: "¿Quién es el Beneficiario?", mark: "coverage_scope_definition", esperado: true, nota: "Pelayo su_00105, familia E" },
    { titulo: "¿Quién es el conductor?", mark: "coverage_scope_definition", esperado: true, nota: "no regresion del patron original" },
    { titulo: "Robo del vehículo", mark: "coverage_scope_definition", esperado: false, nota: "contra-prueba: garantia normal" }
  ];

  let failures = 0;

  for (const e of expectations) {
    const [result] = runNode(workflow, "Coverage Dependency Risk Field Guardrail", [
      {
        semantic_unit_id: "su_test",
        ontology_type: "auto",
        coverage_context: { article: e.titulo, coverage_path: [e.titulo] },
        chunks: [{ text: dep.evidence }],
        output: { coverage_dependencies: [dep] }
      }
    ]);

    const accepted = result.output?.coverage_dependencies || [];
    const obtenido = accepted.length > 0 && accepted[0][e.mark] === true;
    const ok = obtenido === e.esperado;
    if (!ok) failures++;

    console.log(`${ok ? "PASS" : "FAIL"} "${e.titulo}" -> ${e.mark}=${obtenido} (esperado ${e.esperado}) -- ${e.nota}`);
  }

  console.log(`Resultado: ${expectations.length - failures}/${expectations.length} expectativas cumplidas.`);
  return failures;
}

// Guardrail v30 (04/09, punto 7): persona no declarada en el momento del
// siniestro. Rechazo duro, con las dos contra-pruebas que definen su frontera:
// la figura declarada nombrada explicitamente, y el conductor ocasional (que
// es una figura REAL y ya lo marcan v20/v21).
function checkUndeclaredPersonAtClaimTime(workflow, golden) {
  console.log("\n=== Check: undeclared_person_at_claim_time (Guardrail v30) ===");

  if (!findNode(workflow, "Coverage Dependency Risk Field Guardrail")) {
    console.log("Nodo 'Coverage Dependency Risk Field Guardrail' no encontrado -- check omitido.");
    return 0;
  }

  const cases = golden.cases.filter(c =>
    c.category === "undeclared_person_at_claim_time" ||
    c.category === "declared_figure_condition"
  );

  let failures = 0;

  for (const c of cases) {
    const [result] = runNode(workflow, "Coverage Dependency Risk Field Guardrail", [
      { semantic_unit_id: c.semantic_unit_ref, ontology_type: "auto", chunks: [{ text: c.source_text }], output: { coverage_dependencies: c.actual_coverage_dependencies } }
    ]);

    const rejectedByV30 = (result.rejected_dependencies || [])
      .filter(d => d.rejection_reason === "undeclared_person_at_claim_time")
      .map(d => d.risk_field);
    const accepted = result.output?.coverage_dependencies || [];

    let ok;
    if (c.category === "undeclared_person_at_claim_time") {
      ok = (c.expected_rejected_risk_fields || []).every(f => rejectedByV30.includes(f)) && accepted.length === 0;
    } else {
      // Contra-prueba: v30 no debe tocarla.
      ok = rejectedByV30.length === 0 && accepted.length === c.actual_coverage_dependencies.length;
    }

    if (!ok) failures++;
    console.log(
      `${ok ? "PASS" : "FAIL"} ${c.id} (${c.semantic_unit_ref}, ${c.category}): rechazadas_v30=${JSON.stringify(rejectedByV30)} aceptadas=${accepted.length}`
    );
  }

  console.log(`Resultado: ${cases.length - failures}/${cases.length} pasan.`);
  return failures;
}

// ExcludeImportedFields (04/09, punto 6): campos de un fichero compartido que
// un ramo declara que NO le aplican, para que no lleguen ni a Qdrant. Se
// prueba contra los ficheros REALES de knowledge/ontologies, no con un
// fixture, porque lo que importa es que la lista declarada surta efecto.
function checkExcludedImportedFields() {
  console.log("\n=== Check: ExcludeImportedFields (nodo Merge Shared Texts Into Ramo) ===");

  // Este nodo vive en el workflow de indexacion, no en el de extraccion.
  const workflow = loadJson(ONTOLOGY_WORKFLOW_PATH);

  if (!findNode(workflow, "Merge Shared Texts Into Ramo")) {
    console.log("Nodo 'Merge Shared Texts Into Ramo' no encontrado -- check omitido.");
    return 0;
  }

  const autoMd = fs.readFileSync(path.join(REPO_ROOT, "knowledge", "ontologies", "ontology-auto.md"), "utf8");
  const personMd = fs.readFileSync(path.join(REPO_ROOT, "knowledge", "ontologies", "shared", "person.md"), "utf8");
  const base7Md = fs.readFileSync(path.join(REPO_ROOT, "knowledge", "ontologies", "shared", "base7version.md"), "utf8");

  const run = (ramoText) => {
    const prepared = [
      { json: { import_name: "person", ramo_ontology_text: ramoText, ramo_ontology_type: "auto" } },
      { json: { import_name: "base7version", ramo_ontology_text: ramoText, ramo_ontology_type: "auto" } }
    ];
    return runNode(
      workflow,
      "Merge Shared Texts Into Ramo",
      [{ shared_text: personMd }, { shared_text: base7Md }],
      { nodes: { "Prepare Import File Paths": prepared } }
    );
  };

  let failures = 0;

  const generated = run(autoMd);
  const riskFields = new Set(generated.map(g => g.risk_field));

  const declared = (autoMd.match(/^ExcludeImportedFields:\s*(.*)$/mi) || [])[1] || "";
  const excluded = declared.split(",").map(e => e.trim()).filter(Boolean);

  const okDeclared = excluded.length > 0;
  if (!okDeclared) failures++;
  console.log(`${okDeclared ? "PASS" : "FAIL"} ontology-auto.md declara ExcludeImportedFields (${excluded.length} campos)`);

  for (const entry of excluded) {
    const fieldName = entry.split(".").slice(1).join(".");
    const leaked = [...riskFields].filter(rf => rf === fieldName || rf.endsWith(`.${fieldName}`));
    const ok = leaked.length === 0;
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"} '${entry}' no llega a ningun punto de Qdrant${ok ? "" : ` -- se cuela como ${JSON.stringify(leaked)}`}`);
  }

  // Contra-prueba: los campos que SI aplican siguen generandose para las 4
  // figuras. Si la exclusion se pasara de larga, esto lo caza.
  for (const must of ["primaryDriver.age", "primaryDriver.licenseYears", "owner.identificationType", "maritalStatus"]) {
    const ok = riskFields.has(must);
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"} CONTRA-PRUEBA: '${must}' sigue generandose`);
  }

  // El typo en la lista debe romper la indexacion, no pasar desapercibido.
  let threw = false;
  try {
    run(autoMd.replace(/^ExcludeImportedFields:.*$/mi, "ExcludeImportedFields: person.noExisteEsteCampo"));
  } catch (e) {
    threw = /no existen en ningun import/.test(e.message);
  }
  if (!threw) failures++;
  console.log(`${threw ? "PASS" : "FAIL"} un campo inexistente en la lista rompe la indexacion (fallo ruidoso, no silencioso)`);

  const total = 1 + excluded.length + 4 + 1;
  console.log(`Resultado: ${total - failures}/${total} expectativas cumplidas.`);
  return failures;
}

// Guardrail v31 (04/09, revision manual del usuario): valor invalido de
// base7Category. Chequeo hermano de v15 (motor) y v28 (tipo) que faltaba, con
// la contra-prueba del sinonimo legitimo, que es la que justifica no hacerlo
// por lista literal.
function checkVehicleCategoryValue(workflow, golden) {
  console.log("\n=== Check: vehicle_category_field_invalid_value (Guardrail v31) ===");

  if (!findNode(workflow, "Coverage Dependency Risk Field Guardrail")) {
    console.log("Nodo 'Coverage Dependency Risk Field Guardrail' no encontrado -- check omitido.");
    return 0;
  }

  const invalid = golden.cases.filter(c => c.category === "vehicle_category_field_invalid_value");
  const valid = golden.cases.filter(c => c.category === "vehicle_category_valid_synonym");

  let failures = 0;

  for (const c of invalid) {
    const [result] = runNode(workflow, "Coverage Dependency Risk Field Guardrail", [
      { semantic_unit_id: c.semantic_unit_ref, ontology_type: "auto", chunks: [{ text: c.source_text }], output: { coverage_dependencies: c.actual_coverage_dependencies } }
    ]);
    const reasons = (result.rejected_dependencies || []).map(d => d.rejection_reason);
    const ok = reasons.includes("vehicle_category_field_invalid_value")
      && (result.output?.coverage_dependencies || []).length === 0;
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"} ${c.id} (${c.semantic_unit_ref}): rechazos=${JSON.stringify(reasons)}`);
  }

  for (const c of valid) {
    const [result] = runNode(workflow, "Coverage Dependency Risk Field Guardrail", [
      { semantic_unit_id: c.semantic_unit_ref, ontology_type: "auto", chunks: [{ text: c.source_text }], output: { coverage_dependencies: c.actual_coverage_dependencies } }
    ]);
    const accepted = result.output?.coverage_dependencies || [];
    // Sinonimos legitimos: no se rechazan Y, al cubrir entera la categoria del
    // ramo, quedan marcadas vacuous_for_ramo por v29b.
    const ok = accepted.length === c.actual_coverage_dependencies.length
      && (result.rejected_dependencies || []).length === 0
      && accepted.every(d => d.vacuous_for_ramo === true);
    if (!ok) failures++;
    console.log(
      `${ok ? "PASS" : "FAIL"} ${c.id} (CONTRA-PRUEBA sinonimo legitimo): aceptadas=${accepted.length} vacuous=${accepted.map(d => d.vacuous_for_ramo === true).join(",")}`
    );
  }

  const total = invalid.length + valid.length;
  console.log(`Resultado: ${total - failures}/${total} pasan.`);
  return failures;
}

// Guardrail v32 (04/09, revision manual del usuario): deduplicacion general
// dentro de la unidad, que no existia. La clave normaliza mayusculas y el
// orden de las listas, las dos inconsistencias no deterministas de 5.9.
function checkDuplicateDependencies(workflow, golden) {
  console.log("\n=== Check: duplicate_dependency_in_unit (Guardrail v32) ===");

  if (!findNode(workflow, "Coverage Dependency Risk Field Guardrail")) {
    console.log("Nodo 'Coverage Dependency Risk Field Guardrail' no encontrado -- check omitido.");
    return 0;
  }

  const cases = golden.cases.filter(c => c.category === "duplicate_dependency_in_unit");
  let failures = 0;

  for (const c of cases) {
    const [result] = runNode(workflow, "Coverage Dependency Risk Field Guardrail", [
      { semantic_unit_id: c.semantic_unit_ref, ontology_type: "auto", chunks: [{ text: c.source_text }], output: { coverage_dependencies: c.actual_coverage_dependencies } }
    ]);
    const accepted = result.output?.coverage_dependencies || [];
    const dupRejected = (result.rejected_dependencies || []).filter(d => d.rejection_reason === "duplicate_dependency_in_unit");
    const sobrantes = c.actual_coverage_dependencies.length - c.expected_accepted_count;

    const ok = accepted.length === c.expected_accepted_count
      && dupRejected.length === sobrantes;

    if (!ok) failures++;
    console.log(
      `${ok ? "PASS" : "FAIL"} ${c.id} (${c.semantic_unit_ref}): aceptadas=${accepted.length} (esperado ${c.expected_accepted_count}) | duplicados_rechazados=${dupRejected.length} (esperado ${sobrantes})`
    );
  }

  // Contra-prueba estructural: dos dependencias del MISMO campo con valores
  // DISTINTOS no son duplicados y deben sobrevivir las dos.
  const [r2] = runNode(workflow, "Coverage Dependency Risk Field Guardrail", [
    {
      semantic_unit_id: "su_sint_dup", ontology_type: "auto",
      chunks: [{ text: "para vehiculos electricos y para vehiculos hibridos" }],
      output: { coverage_dependencies: [
        { risk_field: "base7Version.base7Engine.id", operator: "=", value: "vehiculo electrico", evidence: "para vehiculos electricos" },
        { risk_field: "base7Version.base7Engine.id", operator: "=", value: "vehiculo hibrido", evidence: "para vehiculos hibridos" }
      ] }
    }
  ]);
  const okDistinct = (r2.output?.coverage_dependencies || []).length === 2;
  if (!okDistinct) failures++;
  console.log(`${okDistinct ? "PASS" : "FAIL"} CONTRA-PRUEBA: mismo campo con valores distintos NO se deduplica (aceptadas=${(r2.output?.coverage_dependencies || []).length}/2)`);

  console.log(`Resultado: ${cases.length + 1 - failures}/${cases.length + 1} pasan.`);
  return failures;
}

function checkCostPreFilter(workflow) {
  console.log("\n=== Check: garantia del pre-filtro de coste (Fase 5 / Legal Cue Pre-Filter, gate de cues) ===");

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

  if (runAll || args.includes("--trailer-scope")) {
    exitCode += checkTrailerScopeExtension(workflow, golden) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--vehicle-type-value")) {
    exitCode += checkVehicleTypeValue(workflow, golden) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--vehicle-category")) {
    exitCode += checkVehicleCategoryRamoScope(workflow, golden) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--structural-numbering")) {
    exitCode += checkStructuralNumberingAndScopeTitles(workflow) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--undeclared-person")) {
    exitCode += checkUndeclaredPersonAtClaimTime(workflow, golden) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--excluded-imported-fields")) {
    exitCode += checkExcludedImportedFields() > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--vehicle-category-value")) {
    exitCode += checkVehicleCategoryValue(workflow, golden) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--duplicate-dependencies")) {
    exitCode += checkDuplicateDependencies(workflow, golden) > 0 ? 1 : 0;
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

  if (runAll || args.includes("--person-field-mismatch")) {
    exitCode += checkPersonFieldMismatchVisibility(workflow, golden, validRiskFields) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--coverage-scope")) {
    exitCode += checkCoverageScopeVisibility(workflow, golden, validRiskFields) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--driving-license")) {
    exitCode += checkDrivingLicenseListMisuse(workflow, golden) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--list-field-scalar")) {
    exitCode += checkListFieldUsedAsScalar(workflow, golden) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--engine-field-value")) {
    exitCode += checkEngineFieldInvalidValue(workflow, golden) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--policy-admission-criteria")) {
    exitCode += checkPolicyAdmissionCriteriaVisibility(workflow, golden) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--percentage-indemnification")) {
    exitCode += checkPercentageIndemnificationVisibility(workflow, golden) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--invented-age")) {
    exitCode += checkInventedAgeRejections(workflow, golden) > 0 ? 1 : 0;
    exitCode += checkInventedAgeNoFalsePositives(workflow) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--ramo-scope")) {
    exitCode += checkRamoScopeGate(workflow, golden) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--negative-alias-score-door")) {
    exitCode += checkNegativeAliasScoreDoor(workflow, golden, ramo) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--premium-calculation")) {
    exitCode += checkPremiumCalculationVisibility(workflow, golden) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--relative-duration")) {
    exitCode += checkRelativeDurationMisuse(workflow, golden) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--figure-selection")) {
    exitCode += checkFigureSelectionVisibility(workflow, golden) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--artifact-threading")) {
    exitCode += checkGuardrailListThreading(workflow) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--figure-selection-rejections")) {
    exitCode += checkFigureSelectionRejections(workflow, golden) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--ontology-type-threading")) {
    exitCode += checkOntologyTypeThreading(workflow) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--ontology-type-gating")) {
    exitCode += checkOntologyTypeGating(workflow) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--prompt-assembler")) {
    exitCode += checkPromptAssembler(workflow) > 0 ? 1 : 0;
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
