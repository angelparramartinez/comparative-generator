// Arnes de evaluacion offline para coverage_rules_extraction_GGCC (Fase 0 del plan).
// Extrae el jsCode tal cual del workflow real -- nunca mantiene una copia duplicada
// que se pueda desincronizar -- y lo ejecuta contra los fixtures de golden_dataset.json.
//
// Uso:
//   node run_offline_eval.js              -> corre todos los checks disponibles
//   node run_offline_eval.js --chunking   -> solo el check de chunking_boundary
//   node run_offline_eval.js --hallucination -> solo el check de risk_field invalidos/guardrail
//   node run_offline_eval.js --ontology   -> solo el check de alias_match / negative_aliases
//   node run_offline_eval.js --chunk-matching -> solo el check de matching por chunk (Fase 4)
//   node run_offline_eval.js --cost-prefilter -> solo el check de la garantia del pre-filtro de coste (Fase 5)
//
// Checks disponibles hoy (antes de aplicar ninguna fase del plan):
//   - chunking: valida Rule Chunker contra los casos chunking_boundary (documenta el bug conocido de la Fase 3)
//   - hallucination: valida actual_coverage_dependencies contra valid_risk_fields.json,
//     y contra el nodo "Coverage Dependency Risk Field Guardrail" si ya existe en el workflow (Fase 1)
//   - ontology: parsea knowledge/ontologies/ontology-home.md con el codigo real de
//     "Ontology Splitter" (n8n/workflows/ontology indexing.json) y ejecuta
//     "Ontology Relevance Filter" contra alias_match_expectations del golden set (Fase 2)
//   - cost-prefilter: verifica que "Legal Cue Pre-Filter" nunca descarta una unidad
//     que en alguna de las ejecuciones reales persistidas (ggcc_outputs/) termino
//     generando dependencias -- la garantia formal de la Fase 5

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
const ONTOLOGY_MD_PATH = path.join(
  REPO_ROOT,
  "knowledge",
  "ontologies",
  "ontology-home.md"
);
const GOLDEN_PATH = path.join(__dirname, "golden_dataset.json");
const VALID_RISK_FIELDS_PATH = path.join(__dirname, "valid_risk_fields.json");
const GGCC_OUTPUTS_DIR = path.join(REPO_ROOT, "ggcc_outputs");
const REAL_RUN_FILES = [
  "coverage_matcher_contract_2026-06-12T12-03-35-891Z.json",
  "coverage_matcher_contract_2026-07-15T12-52-00-850Z.json",
  "coverage_matcher_contract_2026-07-15T13-25-51-018Z.json"
];

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function findNode(workflow, name) {
  return workflow.nodes.find(n => n.name === name) || null;
}

// Envuelve el jsCode de un Code node de n8n respetando su modo de ejecucion
// declarado (runOnceForAllItems por defecto, o runOnceForEachItem).
function wrapCodeNode(node) {
  const code = node.parameters.jsCode;
  const mode = node.parameters.mode || "runOnceForAllItems";

  if (mode === "runOnceForEachItem") {
    const fn = new Function("$json", code);
    return { mode, runOnItems: jsonInputs => jsonInputs.map(j => fn(j).json) };
  }

  // n8n expone $json (bound al primer item) incluso en modo "runOnceForAllItems"
  // -- Ontology Splitter depende de eso, asi que se replica aqui.
  const fn = new Function("items", "$json", code);
  return {
    mode,
    runOnItems: jsonInputs => {
      const items = jsonInputs.map(j => ({ json: j }));
      const result = fn(items, items[0]?.json);
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

  console.log(`Resultado: ${total - failures}/${total} unidades reales (de 3 ejecuciones) respetan la garantia.`);
  return failures;
}

function main() {
  const args = process.argv.slice(2);
  const runAll = args.length === 0;

  const workflow = loadJson(WORKFLOW_PATH);
  const golden = loadJson(GOLDEN_PATH);
  const validRiskFields = loadJson(VALID_RISK_FIELDS_PATH);

  console.log(`Golden set: ${golden.cases.length} casos cargados desde ${GOLDEN_PATH}`);

  let exitCode = 0;

  if (runAll || args.includes("--chunking")) {
    exitCode += checkChunking(workflow, golden) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--hallucination")) {
    checkHallucination(workflow, golden, validRiskFields);
  }

  if (runAll || args.includes("--ontology")) {
    exitCode += checkOntology(workflow, golden) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--chunk-matching")) {
    exitCode += checkChunkLevelMatching(workflow, golden) > 0 ? 1 : 0;
  }

  if (runAll || args.includes("--cost-prefilter")) {
    exitCode += checkCostPreFilter(workflow) > 0 ? 1 : 0;
  }

  process.exit(exitCode);
}

main();
