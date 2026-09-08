// Matcher de VALOR de dependencia (flujo 2, texto libre en español) -> valor
// real del enum en insurance.risk (p. ej. "vivienda principal" ->
// "MainResidence" en Hogar, "vehículo eléctrico" -> 3 en Autos). Es un paso
// PREVIO a generator.translateToSpel: ese modulo solo traduce {risk_field,
// operator, value} a sintaxis SPEL, no sabe nada de equivalencias de valor --
// ese conocimiento vive aqui.
//
// Este modulo es SOLO EL MOTOR. No contiene vocabulario de ningun ramo: el
// catalogo llega como parametro, construido desde la ontologia del ramo por
// ontology_value_catalog.js. Ver la cabecera de ese fichero para el porque
// (hallazgo real 08/09, ejecucion 402 con Zurich Autos) -- en resumen: el
// catalogo vivia hardcodeado aqui con los tres campos de Hogar, lo que
// (a) rompia la restriccion transversal de CLAUDE.md, porque añadir un ramo
// obligaba a tocar el workflow, y (b) duplicaba un dato que la ontologia ya
// tenia, con sincronizacion manual que al llegar Autos no se hizo.
//
// La firma de las cuatro funciones publicas cambio el 08/09 para recibir
// `catalog` como primer argumento. Antes leian la constante del modulo.

const { normalize } = require("./matcher");

// Indice alias normalizado -> valor(es) real(es), construido una vez por
// risk_field (mismo espiritu que buildIdf/buildCandidateIndex en matcher.js:
// precalcular en vez de recorrer todo en cada llamada).
//
// Devuelve null cuando el campo no da para traducir, con el motivo, porque el
// motivo decide si es un fallo o no (ver matchEnumValue).
//
// El indice es alias -> LISTA de valores, no alias -> valor. Un mismo termino
// del condicionado puede corresponder a varios valores del enum, y son casos
// reales, no hipoteticos:
//
//   - "vehículo eléctrico" son los ids 3 (ELÉCTRICO) y 13 (ELÉCTRICO de pila
//     de combustible/hidrogeno) de base7Engine -- decision del usuario 08/09.
//   - "vehículo híbrido" son 7, 11 y 12 (no enchufable, gasolina enchufable,
//     diesel enchufable).
//   - "vivienda unifamiliar" en Hogar es TerracedHouse (adosado) Y
//     DetachedHouse (chalet), declarado asi en ontology-home.md desde el
//     principio.
//
// Ese ultimo caso llevaba FALLANDO EN SILENCIO: con un Map alias -> valor
// ganaba el ultimo declarado (DetachedHouse) y el adosado se perdia sin que
// nadie se enterase. No es una regresion del 08/09, es un bug preexistente que
// el rediseño destapa y arregla.
function buildValueIndex(catalog, riskField) {
  const entry = (catalog || {})[riskField];
  if (!entry) return { index: null, reason: "risk_field_not_in_ontology" };

  const values = entry.values || [];
  if (values.length === 0) {
    // Un enum sin vocabulario de valores es un hueco de la ontologia: hay algo
    // que traducir y no se sabe a que. Cualquier otro data_type (integer,
    // boolean, date...) simplemente no necesita traduccion.
    return {
      index: null,
      reason: entry.dataType === "enum" ? "enum_without_value_catalog" : "no_translation_needed"
    };
  }

  const aliasToValues = new Map();
  for (const { value, aliases } of values) {
    for (const alias of aliases) {
      const key = normalize(alias);
      const already = aliasToValues.get(key) || [];
      if (!already.includes(value)) already.push(value);
      aliasToValues.set(key, already);
    }
  }
  const knownLimitations = new Set((entry.knownLimitations || []).map(normalize));
  return { index: { aliasToValues, knownLimitations }, reason: null };
}

// Empareja un valor en español (tal cual lo extrae el flujo 2) contra el
// catalogo del risk_field. No es un match difuso (a diferencia de
// matcher.js/tuning_matcher.js): los valores de enum son un vocabulario
// cerrado y corto, alias exacto (normalizado) es suficiente y mas seguro --
// un match difuso aqui arriesga traducir mal un FILTER_EXPR sin que se note.
// Devuelve SIEMPRE `values` (lista, 1 o mas elementos cuando casa) y ademas
// `value` como comodidad: el elemento unico si solo hay uno, null si hay
// varios. Asi quien solo maneja el caso escalar no puede confundir "un valor"
// con "el primero de varios".
function matchEnumValue(catalog, riskField, spanishValue) {
  const { index, reason } = buildValueIndex(catalog, riskField);
  if (!index) return { matched: false, value: null, values: [], reason };

  const normalized = normalize(spanishValue);
  if (index.aliasToValues.has(normalized)) {
    const values = index.aliasToValues.get(normalized);
    return {
      matched: true,
      value: values.length === 1 ? values[0] : null,
      values,
      reason: "alias_match"
    };
  }
  if (index.knownLimitations.has(normalized)) {
    return { matched: false, value: null, values: [], reason: "known_limitation" };
  }
  return { matched: false, value: null, values: [], reason: "no_alias_match" };
}

// Reinterpreta los valores ya emparejados por matchEnumValue si el catalogo
// del risk_field declara un `contextOverrides` que aplique -- generico por
// diseno: no conoce ningun risk_field ni palabra concreta, solo ejecuta lo
// que el catalogo (dato, no codigo) declare para el risk_field recibido. El
// vocabulario/ramo especifico vive en la ontologia del ramo (clave
// `value_context_overrides`, ver ontology-home.md), nunca aqui -- asi el
// motor sirve igual para cualquier ramo futuro sin tocarlo.
//
// Trabaja sobre la LISTA y reinterpreta cada valor por separado: con un alias
// que resuelve a varios, una regla puede aplicar a uno y no a los demas.
function applyContextOverrides(catalog, riskField, matchedValues, evidence) {
  const entry = (catalog || {})[riskField];
  const rules = entry && entry.contextOverrides;
  if (!rules || !rules.length || !matchedValues || !matchedValues.length) return matchedValues;
  const normalizedEvidence = normalize(evidence || "");
  return matchedValues.map(matchedValue => {
    for (const rule of rules) {
      if (rule.from !== matchedValue) continue;
      const hasCue = rule.whenEvidenceContainsAny.some(cue => normalizedEvidence.includes(normalize(cue)));
      if (hasCue) return rule.to;
    }
    return matchedValue;
  });
}

// Motivos de "no traducido" que NO son un fallo: el campo no necesitaba
// traduccion, asi que conserva su valor original.
//
// Solo hay uno, y merece la explicacion porque su ausencia costo un bug real
// (22/07, produccion, cover 15 "Patronal sobre empleados domesticos",
// dependencia housingUse NOT_IN ["otros usos"]): esta funcion se llama para
// TODAS las dependencias del flujo 2, no solo las de campo enum. Cuando un
// "no matched" de campo no-enum (ej. "continent > 0") contaba como fallo, se
// marcaba fullyTranslated:false en la inmensa mayoria de dependencias reales
// (5 de 6 en una ejecucion muestreada) y se habria descartado casi todo.
//
// Antes del 08/09 esto se resolvia con un unico motivo, `risk_field_not_
// cataloged`, que mezclaba "no necesita traduccion" con "no se sabe traducir".
// Esa mezcla es exactamente lo que dejo pasar el bug de Autos: los campos
// `base7Version.*.id` son enums cuyo valor real es numerico, no estaban
// catalogados, y su texto español se colo literal al FILTER_EXPR mientras el
// nodo informaba `fully_translated: true`. Ahora son dos motivos distintos
// (`no_translation_needed` frente a `enum_without_value_catalog` /
// `risk_field_not_in_ontology`) y solo el primero es inofensivo.
const NON_FAILURE_REASONS = new Set(["no_translation_needed"]);

function isRealFailure(result) {
  return !result.matched && !NON_FAILURE_REASONS.has(result.reason);
}

// Marcas que exoneran de traducir: el valor de esa dependencia NUNCA llega al
// SPEL, porque generator.combineFilterExpr la filtra antes de traducir (es el
// punto de paso unico). Exigirle vocabulario seria pedir que la ontologia
// catalogue terminos que ni son valores del enum.
//
// Caso real de cada una, las dos de la misma frase de Zurich su_00071 ("Para
// turismos de uso particular o furgonetas de transporte propio, cuyo PMA sea
// menor de 3.500 kg"):
//   - vacuous_for_ramo (v29b): "primera categoría" no esta en el catalogo de
//     base7Category (son AUTOS/CAMIONES/MOTOS/VMP), y justo por eso viene
//     marcada vacua.
//   - category_expressed_as_type (v29a): enumera subtipos donde el texto
//     delimitaba una categoria entera; la enumeracion es artefacto de la
//     extraccion, no la condicion.
//
// Sin esta salida temprana, las 7 dependencias vacuas del artefacto de Zurich
// se contarian como fallo de traduccion y marcarian needs_review en 6
// coberturas correctas.
//
// MANTENER EN SINCRONIA con MARKS_SUPPRESSING_FILTER_EXPR de generator.js. Son
// dos modulos y dos nodos distintos, asi que no se puede compartir la
// constante; el arnes comprueba que las dos listas coincidan (--generator).
const MARKS_EXEMPT_FROM_TRANSLATION = ["vacuous_for_ramo", "category_expressed_as_type"];

function isExemptFromTranslation(dependency) {
  return MARKS_EXEMPT_FROM_TRANSLATION.some(mark => dependency[mark] === true);
}

// Promocion de operador cuando un termino del condicionado resuelve a varios
// valores del enum: "= eléctrico" tiene que salir como "IN {3,13}", no como
// una igualdad contra una lista.
//
// Solo estos dos operadores se pueden promover, y no hace falta mas: el
// guardrail de `coverage rules extraction GGCC` ya limita los enum a
// =/!=/IN/NOT_IN por data_type, y IN/NOT_IN ya son de conjunto. La negacion es
// la que cabe esperar -- "distinto de electrico" con dos ids es "no esta en
// {3,13}" -- y `generator.translateToSpel` ya emite ese NOT_IN como
// "!{...}.contains(campo)", asi que la promocion no le exige nada nuevo.
const OPERATOR_PROMOTION = { "=": "IN", "!=": "NOT_IN" };
const SET_OPERATORS = new Set(["IN", "NOT_IN"]);

// Traduce el/los valor(es) de una dependencia completa {risk_field, operator,
// value}. Para IN/NOT_IN, value es un array -- se traduce elemento a elemento
// y se reportan por separado los que no se pudieron traducir (visibilidad,
// mismo patron que rejected_dependencies/ungrounded_dependencies del
// guardrail de extraccion: nunca descartar en silencio).
//
// Puede cambiar el `operator`, no solo el `value` (ver OPERATOR_PROMOTION).
function translateDependencyValue(catalog, dependency) {
  if (isExemptFromTranslation(dependency)) {
    return { dependency: { ...dependency }, fullyTranslated: true, unmatched: [] };
  }

  const isArray = Array.isArray(dependency.value);
  const rawValues = isArray ? dependency.value : [dependency.value];
  const results = rawValues.map(v => {
    const matched = matchEnumValue(catalog, dependency.risk_field, v);
    if (!matched.matched) return { raw: v, ...matched };
    const overridden = applyContextOverrides(catalog, dependency.risk_field, matched.values, dependency.evidence);
    const changed = overridden.some((val, i) => val !== matched.values[i]);
    return changed
      ? { raw: v, matched: true, value: overridden.length === 1 ? overridden[0] : null, values: overridden, reason: "context_override" }
      : { raw: v, ...matched };
  });

  const realFailures = results.filter(isRealFailure);

  // Aplana las expansiones de todos los valores crudos y deduplica: dos alias
  // distintos de la misma lista IN pueden expandir a conjuntos que se solapan.
  const translatedValues = [];
  for (const r of results) {
    if (isRealFailure(r)) continue;
    const expanded = r.matched ? r.values : [r.raw];
    for (const value of expanded) if (!translatedValues.includes(value)) translatedValues.push(value);
  }

  let operator = dependency.operator;
  let value;
  if (SET_OPERATORS.has(operator)) {
    value = translatedValues;
  } else if (translatedValues.length > 1) {
    const promoted = OPERATOR_PROMOTION[operator];
    if (!promoted) {
      // Un operador escalar no promocionable (>, <=...) sobre un termino que
      // resuelve a varios valores no se puede expresar. Es defensivo: el
      // guardrail de extraccion no deja llegar aqui un enum con esos
      // operadores. Fallo real antes que SPEL inventado.
      return {
        dependency: { ...dependency },
        fullyTranslated: false,
        unmatched: [
          ...realFailures,
          {
            raw: dependency.value,
            matched: false,
            value: null,
            values: [],
            reason: "operator_not_promotable_for_multivalue"
          }
        ]
      };
    }
    operator = promoted;
    value = translatedValues;
  } else {
    value = translatedValues[0] ?? dependency.value;
  }

  return {
    dependency: { ...dependency, operator, value },
    fullyTranslated: realFailures.length === 0,
    unmatched: realFailures
  };
}

// Adaptador para el nodo real "Translate Dependency Values": traduce TODAS las
// dependencias de un match, pero solo incluye en dependencies_translated las
// que se tradujeron sin fallos reales -- una dependencia con un fallo real se
// EXCLUYE por completo, nunca se deja a medias (ej. el bug real de 22/07:
// "!(insurance[\"risk\"].housingUse in {})" -- una lista vacia en el
// FILTER_EXPR final, generada porque antes se incluia igual la dependencia con
// su value ya vaciado por translateDependencyValue). El aggregate
// fully_translated si refleja TODAS las dependencias (incl. las excluidas),
// para que review_assembly.computeEntryReviewStatus pueda seguir marcando
// needs_review cuando corresponda.
//
// Rompe con un catalogo vacio, a proposito. Sin catalogo TODA dependencia de
// campo enum seria un fallo real y se caerian todas a la vez: un fichero de
// ontologia que no se pudo leer o un `Imports:` mal escrito se manifestaria
// como "esta compañia no tiene condiciones", que es indistinguible de un
// condicionado sin dependencias. Preferible romper donde esta la causa.
function translateDependencies(catalog, dependencies) {
  if (!catalog || Object.keys(catalog).length === 0) {
    throw new Error(
      "translateDependencies: el catalogo de valores llego vacio -- revisar que el .md de la ontologia del ramo se leyo y que sus Imports: existen (ver ontology_value_catalog.buildValueCatalog)."
    );
  }
  const translations = (dependencies || []).map(dep => translateDependencyValue(catalog, dep));
  return {
    dependencies_translated: translations.filter(t => t.fullyTranslated).map(t => t.dependency),
    fully_translated: translations.every(t => t.fullyTranslated),
    unmatched: translations.flatMap(t => t.unmatched)
  };
}

module.exports = {
  NON_FAILURE_REASONS,
  MARKS_EXEMPT_FROM_TRANSLATION,
  isExemptFromTranslation,
  OPERATOR_PROMOTION,
  SET_OPERATORS,
  buildValueIndex,
  matchEnumValue,
  applyContextOverrides,
  isRealFailure,
  translateDependencyValue,
  translateDependencies
};
