// Matcher offline dependencia (flujo 2) -> COVER_ID/bullet del Excel de coberturas.
//
// Este modulo implementa SOLO la parte determinista/heuristica del matcher
// (candidatos por similitud lexica + verificacion de grounding). La decision
// final en produccion la toma un LLM con estos candidatos como contexto (ver
// plan de flujo 3) -- aqui no se llama a ningun LLM, es la capa que se valida
// offline antes de construir el nodo n8n real (CLAUDE.md SS7).
//
// Cuando se construya el workflow n8n de flujo 3 (Fase 4 del plan), el codigo
// de esta funcion debe copiarse (o extraerse, siguiendo el mismo patron que
// evaluators/coverage_dependency_extractor/run_offline_eval.js) al Code node
// real que genera los candidatos antes de la llamada LLM.

const STOPWORDS = new Set([
  "de","la","el","los","las","en","y","o","del","con","por","para","que",
  "un","una","al","su","sus","a","e","u","es","se","lo","como","no","si",
  "the","of"
]);

function normalize(str) {
  return (str || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quitar acentos
    .replace(/^[\d]+(\.[\d]+)*\.?\s*/,"") // quitar numeracion inicial "3.2. "
    .replace(/^[a-z]\)\s*/,"") // quitar numeracion tipo "a) "
    .replace(/^articulo\s+[\wº.]+\s*/,"") // quitar "Articulo 8º "
    .replace(/[^a-z0-9\s]/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function tokenize(str) {
  return normalize(str)
    .split(" ")
    .filter(tok => tok.length > 0 && !STOPWORDS.has(tok));
}

function jaccard(tokensA, tokensB) {
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const tok of setA) if (setB.has(tok)) intersection++;
  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
}

// Jaccard ponderado por rareza (idf-like): una palabra que aparece en pocos
// candidatos del indice (p. ej. "plagas") pesa mucho mas que una que aparece
// en casi todos (p. ej. "asistencia", "daños", "robo" -- genericas del dominio
// asegurador). Sin esto, una etiqueta estructural corta y generica (p. ej.
// "Asistencia") puede ganarle a un match especifico y correcto por pura
// coincidencia de una sola palabra comun (caso real detectado: GD-MATCH-025).
function weightedJaccard(tokensA, tokensB, idf) {
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  if (setA.size === 0 || setB.size === 0) return 0;
  const all = new Set([...setA, ...setB]);
  let intersection = 0;
  let union = 0;
  for (const tok of all) {
    const w = idf.get(tok) || 1;
    union += w;
    if (setA.has(tok) && setB.has(tok)) intersection += w;
  }
  return union === 0 ? 0 : intersection / union;
}

// Frecuencia de documento inversa sobre los textos del indice de candidatos:
// cuantos menos candidatos contienen una palabra, mas discriminante es.
function buildIdf(candidateIndex) {
  const docFreq = new Map();
  const totalDocs = candidateIndex.length || 1;
  for (const candidate of candidateIndex) {
    const uniqueTokens = new Set(tokenize(candidate.text));
    for (const tok of uniqueTokens) docFreq.set(tok, (docFreq.get(tok) || 0) + 1);
  }
  const idf = new Map();
  for (const [tok, df] of docFreq) idf.set(tok, Math.log((totalDocs + 1) / (df + 1)) + 1);
  return idf;
}

// Construye el indice plano de candidatos (cover_id + texto) a partir del
// fixture normalizado del Excel (ambas hojas). Cada candidato lleva ademas
// `cover_full_text` (nombre + todos los bullets de esa cobertura) para el
// guardrail de grounding -- la evidencia de una dependencia describe la
// condicion, no necesariamente repite las palabras del bullet exacto, asi que
// el grounding se comprueba contra el contenido completo de la cobertura, no
// solo el fragmento que gano el matching.
function buildCandidateIndex(excelFixture) {
  const index = [];
  const byCoverName = new Map();
  const fullTextByCoverId = new Map();

  for (const cover of excelFixture.covers_por_modalidad || []) {
    byCoverName.set(normalize(cover.cover_name), cover.cover_id);
    fullTextByCoverId.set(
      cover.cover_id,
      [cover.cover_name, ...(cover.sample_text_bullets || [])].join(" ")
    );
  }
  for (const opt of excelFixture.coberturas_opcionales || []) {
    const parentCoverId = byCoverName.get(normalize(opt.epigrafe)) ?? null;
    if (parentCoverId != null) {
      fullTextByCoverId.set(
        parentCoverId,
        (fullTextByCoverId.get(parentCoverId) || "") + " " + opt.cover_name + " " + (opt.text_content || "")
      );
    }
  }

  for (const cover of excelFixture.covers_por_modalidad || []) {
    index.push({
      cover_id: cover.cover_id,
      text: cover.cover_name,
      cover_full_text: fullTextByCoverId.get(cover.cover_id) || cover.cover_name,
      source: "modality_cover_name"
    });
    for (const bullet of cover.sample_text_bullets || []) {
      index.push({
        cover_id: cover.cover_id,
        text: bullet,
        cover_full_text: fullTextByCoverId.get(cover.cover_id) || bullet,
        source: "modality_bullet"
      });
    }
  }

  for (const opt of excelFixture.coberturas_opcionales || []) {
    const parentCoverId = byCoverName.get(normalize(opt.epigrafe)) ?? null;
    index.push({
      cover_id: parentCoverId,
      text: opt.cover_name,
      cover_full_text: fullTextByCoverId.get(parentCoverId) || opt.cover_name,
      source: "optional_cover_name",
      exact_optional_name: normalize(opt.cover_name)
    });
  }

  return index;
}

const CONFIDENCE_THRESHOLDS = { alta: 0.55, media: 0.3 };

function confidenceLevel(score) {
  if (score >= CONFIDENCE_THRESHOLDS.alta) return "alta";
  if (score >= CONFIDENCE_THRESHOLDS.media) return "media";
  return "sin_match";
}

// coveragePath: array de strings (jerarquia interna del condicionado, la
// produce el flujo 2). article: titulo del articulo (fallback quando
// coverage_path viene vacio). evidenceText: texto real de la dependencia/
// evidencia (source_text o evidence concatenada) -- necesario porque la
// etiqueta estructural (coverage_path/article) puede ser enganosa (caso real:
// "Articulo 9 Asistencia" que en realidad habla de control de plagas, ver
// golden set GD-MATCH-025) y el contenido real desempata correctamente.
function matchDependency(coveragePath, article, evidenceText, candidateIndex) {
  const leafText = (coveragePath || [])[coveragePath.length - 1] || "";
  const leafNormalized = normalize(leafText);
  const leafTokens = tokenize(leafText);
  const rootText = (coveragePath || [])[0] || "";
  const rootNormalized = normalize(rootText);
  const rootTokens = tokenize(rootText + " " + (article || ""));
  const evidenceTokens = tokenize(evidenceText || "");
  const idf = buildIdf(candidateIndex);

  const scored = candidateIndex.map(candidate => {
    // Match exacto por nombre (hoja "Coberturas opcionales" -> join directo,
    // sin necesidad de similitud difusa). El nombre de la opcional puede
    // corresponder tanto al nivel hoja como al nivel raiz de coverage_path
    // (el desglose interno del condicionado no siempre alinea sus niveles con
    // el nombre exacto de la opcional en el mismo nivel).
    if (candidate.exact_optional_name &&
        (candidate.exact_optional_name === leafNormalized || candidate.exact_optional_name === rootNormalized)) {
      return { ...candidate, score: 1.0, match_type: "exact_optional_name" };
    }
    const candidateTokens = tokenize(candidate.text);
    const leafScore = weightedJaccard(leafTokens, candidateTokens, idf);
    const rootScore = weightedJaccard(rootTokens, candidateTokens, idf);
    const evidenceScore = weightedJaccard(evidenceTokens, candidateTokens, idf);
    // El nivel hoja (bullet concreto) es la senal mas especifica; el texto
    // real de la evidencia puede desempatar o corregir cuando la etiqueta
    // estructural es enganosa (palabras raras como "plagas" pesan mucho mas
    // que genericas como "asistencia" gracias al idf); el nivel raiz solo
    // ayuda para candidatos de nombre de cobertura completo.
    const score = Math.max(leafScore, evidenceScore * 0.9, rootScore * 0.8);
    return { ...candidate, score, match_type: "lexical" };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.cover_id == null) {
    return { best: null, confidence: "sin_match", candidates: scored.slice(0, 5) };
  }

  return {
    best,
    confidence: confidenceLevel(best.score),
    candidates: scored.slice(0, 5)
  };
}

// Verifica que la evidencia citada tenga solape lexico real con el texto del
// bullet/cobertura emparejado -- guardrail de grounding (mismo espiritu que
// el guardrail de evidencia del flujo 2, aplicado aqui al texto del Excel en
// vez de al source_text del PDF).
function groundingScore(evidence, candidateText) {
  return jaccard(tokenize(evidence), tokenize(candidateText));
}

module.exports = {
  normalize,
  tokenize,
  jaccard,
  weightedJaccard,
  buildIdf,
  buildCandidateIndex,
  matchDependency,
  groundingScore,
  confidenceLevel,
  CONFIDENCE_THRESHOLDS
};
