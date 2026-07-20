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
    knownLimitations: []
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

// Traduce el/los valor(es) de una dependencia completa {risk_field, operator,
// value}. Para IN/NOT_IN, value es un array -- se traduce elemento a elemento
// y se reportan por separado los que no se pudieron traducir (visibilidad,
// mismo patron que rejected_dependencies/ungrounded_dependencies del
// guardrail de flujo 2: nunca descartar en silencio).
function translateDependencyValue(dependency) {
  const isArray = Array.isArray(dependency.value);
  const rawValues = isArray ? dependency.value : [dependency.value];
  const results = rawValues.map(v => ({ raw: v, ...matchEnumValue(dependency.risk_field, v) }));
  const unmatched = results.filter(r => !r.matched);
  const translatedValues = results.filter(r => r.matched).map(r => r.value);

  return {
    dependency: {
      ...dependency,
      value: isArray ? translatedValues : (translatedValues[0] ?? dependency.value)
    },
    fullyTranslated: unmatched.length === 0,
    unmatched
  };
}

module.exports = {
  ENUM_VALUE_CATALOG,
  buildValueIndex,
  matchEnumValue,
  translateDependencyValue
};
