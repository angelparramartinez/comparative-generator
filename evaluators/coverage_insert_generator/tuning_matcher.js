// Matcher offline texto de cobertura del Excel -> tuning_key, necesario para
// construir FILTER_EXPR/HIRING_STATUS_EXPR/VALUE_EXPR que referencien
// `tuning` (ver knowledge/.../ejemplo completo 2). Adaptado del agente LLM del
// workflow legacy (`Mapping coberturas opcionales y tuning`), generalizado a
// ambas hojas del Excel -- ver tuning_key_matcher_prompt.md para el prompt
// real que se usara en produccion (esto es solo la capa heuristica de
// candidatos, validada offline antes de construir el nodo n8n real).

const { normalize, tokenize, weightedJaccard, buildIdf, confidenceLevel } = require("./matcher");

// Algunas labels del diccionario de tuning no son texto plano: son una
// expresion SPEL dinamica delimitada por "/" ... "/" que decide el label
// segun otro campo (caso real: `yvig24`, cuyo label es
// `/!tuning?.yactsm ? 'Danos malintencionados del inquilino' : 'Danos
// malintencionados del inquilino turistica'/`). En esos casos se extraen
// todos los literales entre comillas simples como candidatos de label.
function extractLabelCandidates(rawLabel) {
  if (typeof rawLabel !== "string") return [];
  if (rawLabel.startsWith("/") && rawLabel.endsWith("/")) {
    const matches = [...rawLabel.matchAll(/'([^']*)'/g)].map(m => m[1]);
    return matches.length > 0 ? matches : [rawLabel];
  }
  return [rawLabel];
}

function buildTuningIndex(tuningDict) {
  return Object.entries(tuningDict).map(([key, def]) => ({
    key,
    label_candidates: extractLabelCandidates(def.label),
    component: def.component
  }));
}

// coverName: nombre de la cobertura/opcional del Excel (columna B de
// "Coberturas por modalidad", o "COBERTURA OPCIONAL" de la otra hoja).
function matchCoverToTuningKey(coverName, tuningIndex) {
  const coverNormalized = normalize(coverName);
  const coverTokens = tokenize(coverName);

  // idf sobre todos los label_candidates del diccionario completo.
  const idfCorpus = tuningIndex.flatMap(entry =>
    entry.label_candidates.map(label => ({ text: label }))
  );
  const idf = buildIdf(idfCorpus);

  const scored = tuningIndex.map(entry => {
    let bestLabelScore = 0;
    let bestLabel = null;
    for (const label of entry.label_candidates) {
      if (normalize(label) === coverNormalized) {
        bestLabelScore = 1.0;
        bestLabel = label;
        break;
      }
      const score = weightedJaccard(coverTokens, tokenize(label), idf);
      if (score > bestLabelScore) {
        bestLabelScore = score;
        bestLabel = label;
      }
    }
    // Una cobertura se modela casi siempre como un interruptor (radio/select),
    // no como un campo numerico/texto libre -- penalizar esos tipos evita que
    // un campo tipo "cantidad de X" (p. ej. "Numero maximo de perros") gane
    // por solape lexico casual sobre un NOT_FOUND real (caso detectado:
    // "RC perros peligrosos" vs el contador numerico de perros, GD-TUNE-012).
    const componentPenalty = (entry.component === "number" || entry.component === "input") ? 0.4 : 1.0;
    return { key: entry.key, matched_label: bestLabel, score: bestLabelScore * componentPenalty };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const confidence = best ? confidenceLevel(best.score) : "sin_match";

  if (!best || confidence === "sin_match") {
    return { tuning_key: "NOT_FOUND", confidence: "sin_match", candidates: scored.slice(0, 3) };
  }
  return { tuning_key: best.key, confidence, candidates: scored.slice(0, 3) };
}

module.exports = {
  extractLabelCandidates,
  buildTuningIndex,
  matchCoverToTuningKey
};
