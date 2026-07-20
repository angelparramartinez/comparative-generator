// Arnes de evaluacion offline para coverage_rules_extraction_GGCC (Fase 0 del plan).
// Extrae el jsCode tal cual del workflow real -- nunca mantiene una copia duplicada
// que se pueda desincronizar -- y lo ejecuta contra los fixtures de golden_dataset.json.
//
// Uso:
//   node run_offline_eval.js              -> corre todos los checks disponibles
//   node run_offline_eval.js --chunking   -> solo el check de chunking_boundary
//   node run_offline_eval.js --hallucination -> solo el check de risk_field invalidos/guardrail
//   node run_offline_eval.js --value-type -> solo el check de tipo de "value" vs data_type (Guardrail v4)
//   node run_offline_eval.js --ontology   -> solo el check de alias_match / negative_aliases
//   node run_offline_eval.js --chunk-matching -> solo el check de matching por chunk (Fase 4)
//   node run_offline_eval.js --cost-prefilter -> solo el check de la garantia del pre-filtro de coste (Fase 5)
//   node run_offline_eval.js --evidence-grounding -> solo el check de evidence literal (Guardrail v3)
//   node run_offline_eval.js --hierarchy -> solo el check de deteccion de "article" (nivel 1)
//   node run_offline_eval.js --watermark -> solo el check de eliminacion de marca de agua fusionada (ast walker)
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
  // -- Ontology Splitter depende de eso, asi que se replica aqui. Tambien expone
  // $input.first()/$input.all() -- Hierarchy Builder y ast walker dependen de eso.
  const fn = new Function("items", "$json", "$input", code);
  return {
    mode,
    runOnItems: jsonInputs => {
      const items = jsonInputs.map(j => ({ json: j }));
      const $input = { first: () => items[0], all: () => items };
      const result = fn(items, items[0]?.json, $input);
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

  console.log(`Resultado: ${5 - failures}/5 expectativas cumplidas.`);
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

  if (runAll || args.includes("--value-type")) {
    exitCode += checkValueTypeValidation(workflow, golden) > 0 ? 1 : 0;
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

  if (runAll || args.includes("--evidence-grounding")) {
    exitCode += checkEvidenceGrounding(workflow, golden) > 0 ? 1 : 0;
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
