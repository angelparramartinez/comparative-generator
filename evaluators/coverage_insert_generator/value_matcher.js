// Matcher offline de VALOR de dependencia (flujo 2, texto libre en español) ->
// valor real de enum en insurance.risk (texto en ingles, p. ej. "MainResidence"
// -- confirmado por el usuario 20/07, ver knowledge/Modelo comparativa de
// coberturas - AI ready.md). Es un paso PREVIO a generator.translateToSpel:
// ese modulo solo traduce {risk_field, operator, value} a sintaxis SPEL, no
// sabe nada de que "vivienda principal" == "MainResidence" -- ese
// conocimiento vive aqui.
//
// Alcance deliberado (YAGNI): solo se cataloga el vocabulario de los enums que
// ya han aparecido con dependencias reales extraidas en produccion
// (housingUse, housingRegime, capitalInsuranceType -- ver golden set de
// evaluators/coverage_dependency_extractor/golden_dataset.json). El resto de
// enums de la ontologia (buildingType, buildQuality, materials, location,
// alarm) no tiene todavia ningun caso real de dependencia -- no se inventa su
// catalogo de valores hasta que aparezca uno.

const { normalize } = require("./matcher");

// Cada entrada: valor real en ingles -> lista de alias en español observados
// en el condicionado. `knownLimitations` documenta frases reales que SI han
// aparecido como valor extraido pero que NO se mapean a ningun valor del enum
// -- no es un hueco por descubrir, es una decision ya tomada (ver memoria
// project_flujo3_implementation_progress, seccion housingUse/alquiler
// vacacional): el usuario opto por dejarlo como limitacion conocida en vez de
// forzar un mapeo o inventar un 4o valor de enum.
const ENUM_VALUE_CATALOG = {
  housingUse: {
    values: {
      MainResidence: ["vivienda principal", "residencia principal", "domicilio habitual", "vivienda habitual"],
      SecondHome: ["vivienda secundaria", "segunda residencia", "vivienda de temporada"],
      UnoccupiedProperty: ["vivienda vacía", "vivienda desocupada", "sin ocupación"]
    },
    knownLimitations: ["alquiler vacacional", "uso turístico", "otros usos", "arrendada"]
  },
  housingRegime: {
    values: {
      Owner: ["propietario"],
      Rental: ["arrendada", "vivienda alquilada"],
      Tenant: ["inquilino", "arrendatario"]
    },
    knownLimitations: [],
    // Caso real 23/07 (su_00127): "propietario" es ambiguo en Hogar entre
    // Owner (ocupa la vivienda) y Rental (la tiene arrendada) -- el
    // condicionado no siempre usa una palabra distinta para cada caso, pero
    // SI aporta la desambiguacion en la misma frase de evidencia cuando
    // aplica ("propietario de una vivienda arrendada..."). Mismo mecanismo
    // que `negative_aliases` de matcher/ontologia pero a nivel de VALOR: el
    // dato (que ramo/campo/palabras) vive aqui, el motor (applyContextOverrides
    // mas abajo) no conoce "housingRegime" ni "arrendada" -- es generico.
    contextOverrides: [
      { from: "Owner", to: "Rental", whenEvidenceContainsAny: ["arrendada", "arrendador", "alquilada", "alquiler"] }
    ]
  },
  capitalInsuranceType: {
    values: {
      FirstRisk: ["primer riesgo", "primer_riesgo"],
      VReplacementValue: ["valor de reposición", "valor de reposicion"]
    },
    knownLimitations: []
  }
};

// Indice alias normalizado -> valor real en ingles, construido una vez por
// risk_field (mismo espiritu que buildIdf/buildCandidateIndex en matcher.js:
// precalcular en vez de recorrer todo en cada llamada).
function buildValueIndex(riskField) {
  const catalog = ENUM_VALUE_CATALOG[riskField];
  if (!catalog) return null;
  const aliasToValue = new Map();
  for (const [value, aliases] of Object.entries(catalog.values)) {
    for (const alias of aliases) aliasToValue.set(normalize(alias), value);
  }
  const knownLimitations = new Set((catalog.knownLimitations || []).map(normalize));
  return { aliasToValue, knownLimitations };
}

// Empareja un valor en español (tal cual lo extrae el flujo 2) contra el
// catalogo del risk_field. No es un match difuso (a diferencia de
// matcher.js/tuning_matcher.js): los valores de enum son un vocabulario
// cerrado y corto, alias exacto (normalizado) es suficiente y mas seguro --
// un match difuso aqui arriesga traducir mal un FILTER_EXPR sin que se note.
function matchEnumValue(riskField, spanishValue) {
  const index = buildValueIndex(riskField);
  if (!index) {
    return { matched: false, value: null, reason: "risk_field_not_cataloged" };
  }
  const normalized = normalize(spanishValue);
  if (index.aliasToValue.has(normalized)) {
    return { matched: true, value: index.aliasToValue.get(normalized), reason: "alias_match" };
  }
  if (index.knownLimitations.has(normalized)) {
    return { matched: false, value: null, reason: "known_limitation" };
  }
  return { matched: false, value: null, reason: "no_alias_match" };
}

// Reinterpreta un valor ya emparejado por matchEnumValue si el catalogo del
// risk_field declara un `contextOverrides` que aplique -- generico por
// diseno: no conoce ningun risk_field ni palabra concreta, solo ejecuta lo
// que el catalogo (dato, no codigo) declare para el risk_field recibido. El
// vocabulario/ramo especifico vive en ENUM_VALUE_CATALOG (mirror ejecutable
// de la ontologia, ver value_context_overrides en ontology-home.md), nunca
// aqui -- asi el motor sirve igual para el catalogo de cualquier ramo futuro.
function applyContextOverrides(riskField, matchedValue, evidence) {
  const rules = ENUM_VALUE_CATALOG[riskField] && ENUM_VALUE_CATALOG[riskField].contextOverrides;
  if (!rules || !matchedValue) return matchedValue;
  const normalizedEvidence = normalize(evidence || "");
  for (const rule of rules) {
    if (rule.from !== matchedValue) continue;
    const hasCue = rule.whenEvidenceContainsAny.some(cue => normalizedEvidence.includes(normalize(cue)));
    if (hasCue) return rule.to;
  }
  return matchedValue;
}

// Traduce el/los valor(es) de una dependencia completa {risk_field, operator,
// value}. Para IN/NOT_IN, value es un array -- se traduce elemento a elemento
// y se reportan por separado los que no se pudieron traducir (visibilidad,
// mismo patron que rejected_dependencies/ungrounded_dependencies del
// guardrail de flujo 2: nunca descartar en silencio).
//
// Bug real detectado 22/07 (produccion, cover 15 "Patronal sobre empleados
// domesticos", dependencia real housingUse NOT_IN ["otros usos"]): esta
// funcion se llama en el nodo real (Translate Dependency Values) para TODAS
// las dependencias del flujo 2, no solo las de campo enum -- y
// matchEnumValue devuelve matched:false/reason:"risk_field_not_cataloged"
// para CUALQUIER risk_field que no sea un enum (ej. "continent > 0"). Sin
// distinguir este caso, ese "no matched" contaba igual que un fallo real de
// traduccion (known_limitation/no_alias_match), marcando fullyTranslated:
// false para la inmensa mayoria de dependencias reales (5 de 6 en una
// ejecucion real muestreada) que ni siquiera son enums -- si el nodo llegara
// a filtrar por ese flag (como deberia, ver mas abajo), se habria descartado
// casi todo. "risk_field_not_cataloged" NO es un fallo -- ese campo
// simplemente no necesita traduccion, se mantiene su valor original.
function translateDependencyValue(dependency) {
  const isArray = Array.isArray(dependency.value);
  const rawValues = isArray ? dependency.value : [dependency.value];
  const results = rawValues.map(v => {
    const matched = matchEnumValue(dependency.risk_field, v);
    if (!matched.matched) return { raw: v, ...matched };
    const overridden = applyContextOverrides(dependency.risk_field, matched.value, dependency.evidence);
    return overridden === matched.value
      ? { raw: v, ...matched }
      : { raw: v, matched: true, value: overridden, reason: "context_override" };
  });

  const realFailures = results.filter(r => !r.matched && r.reason !== "risk_field_not_cataloged");
  const translatedValues = results
    .filter(r => r.matched || r.reason === "risk_field_not_cataloged")
    .map(r => (r.matched ? r.value : r.raw));

  return {
    dependency: {
      ...dependency,
      value: isArray ? translatedValues : (translatedValues[0] ?? dependency.value)
    },
    fullyTranslated: realFailures.length === 0,
    unmatched: realFailures
  };
}

// Adaptador para el nodo real "Translate Dependency Values" (A15): traduce
// TODAS las dependencias de un match, pero solo incluye en
// dependencies_translated las que se tradujeron sin fallos reales -- una
// dependencia con un fallo real (known_limitation/no_alias_match) se
// EXCLUYE por completo, nunca se deja a medias (ej. el bug real de 22/07:
// "!(insurance[\"risk\"].housingUse in {})" -- una lista vacia en el
// FILTER_EXPR final, generada porque antes se incluia igual la dependencia
// con su value ya vaciado por translateDependencyValue). El aggregate
// fully_translated si refleja TODAS las dependencias (incl. las excluidas),
// para que review_assembly.computeEntryReviewStatus pueda seguir marcando
// needs_review cuando corresponda.
function translateDependencies(dependencies) {
  const translations = (dependencies || []).map(dep => translateDependencyValue(dep));
  return {
    dependencies_translated: translations.filter(t => t.fullyTranslated).map(t => t.dependency),
    fully_translated: translations.every(t => t.fullyTranslated),
    unmatched: translations.flatMap(t => t.unmatched)
  };
}

module.exports = {
  ENUM_VALUE_CATALOG,
  buildValueIndex,
  matchEnumValue,
  applyContextOverrides,
  translateDependencyValue,
  translateDependencies
};
