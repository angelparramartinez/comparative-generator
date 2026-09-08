// Generador de ENTRY/LINES (y su JSON intermedio) para una cobertura
// (COVER_ID), a partir de: el texto libre del Excel troceado en bullets, las
// dependencias ya emparejadas por matcher.js, y las reglas fijadas en
// knowledge/Modelo comparativa de coberturas - AI ready.md.
//
// Codigo puro (sin n8n, sin LLM) -- se valida offline (evaluators/
// coverage_insert_generator/run_offline_eval.js, check --generator) antes de
// construir el nodo n8n real (Fase 4 del plan, CLAUDE.md SS7).

const OPERATOR_TO_SPEL = {
  "=": "==",
  "!=": "!=",
  ">": ">",
  ">=": ">=",
  "<": "<",
  "<=": "<="
};

function quoteSpelValue(value) {
  if (typeof value === "string") {
    return `'${value.replace(/'/g, "\\'")}'`;
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  throw new Error(`Tipo de valor SPEL no soportado: ${typeof value} (${JSON.stringify(value)})`);
}

// Traduce una dependencia {risk_field, operator, value} (esquema del flujo 2)
// a una condicion SPEL sobre insurance["risk"]. Sintaxis de IN/NOT_IN
// corregida 24/07 (bug real detectado probando el motor real de ASM,
// Spring SpEL 5.3.39): SpEL no tiene operador `in` -- la sintaxis
// `campo in {v1,v2,v3}` usada originalmente no es valida en ese motor, hay
// que expresar la pertenencia como metodo de coleccion:
// `{v1,v2,v3}.contains(campo)` / `!{v1,v2,v3}.contains(campo)`.
function translateToSpel(dependency) {
  const field = `insurance["risk"].${dependency.risk_field}`;

  if (dependency.operator === "IN" || dependency.operator === "NOT_IN") {
    if (!Array.isArray(dependency.value)) {
      throw new Error(`operator ${dependency.operator} requiere value como array (dependency: ${JSON.stringify(dependency)})`);
    }
    const list = `{${dependency.value.map(quoteSpelValue).join(",")}}`;
    const membership = `${list}.contains(${field})`;
    return dependency.operator === "IN" ? membership : `!${membership}`;
  }

  const spelOp = OPERATOR_TO_SPEL[dependency.operator];
  if (!spelOp) {
    throw new Error(`Operador desconocido: ${dependency.operator}`);
  }
  return `${field} ${spelOp} ${quoteSpelValue(dependency.value)}`;
}

// Combina varias dependencias de un mismo ENTRY con AND. Con 1 sola
// dependencia no anade parentesis de mas. Es el punto de paso UNICO por el que
// una dependencia de flujo 2 se convierte en SPEL, asi que es donde se filtran
// las VACUAS (04/09).
//
// Una dependencia con "vacuous_for_ramo: true" (Guardrail v29b de flujo 2) es
// cierta para TODOS los riesgos del ramo: exige una categoria de vehiculo que
// cubre entera la del ramo que se esta procesando (p.ej. "primera categoria"
// en un producto de Autos). Traducirla a SPEL produciria un FILTER_EXPR que
// no discrimina nada y que, peor, LEIDO POR UNA PERSONA parece decir que la
// cobertura solo aplica a cierto tipo de vehiculo.
//
// Caso real que lo motivo (Zurich su_00039, "Asistencia en viaje"): el texto
// da 450 EUR para primera y tercera categoria y 900 EUR para el resto. La
// rama de los 900 EUR ya la rechaza flujo 2 por estar fuera de ramo
// (segunda categoria = camiones, sin ramo en ASM), y la que queda cubre todo
// el ramo. Resultado correcto: UN solo ENTRY, INCLUDED, sin FILTER_EXPR y con
// su importe -- que es exactamente lo que observo el usuario ("no necesitamos
// 2 entries con diferente value_expr, porque para autos y motos el valor de
// 900 EUR no se daria nunca").
//
// Segunda marca que suprime el FILTER_EXPR, "category_expressed_as_type"
// (Guardrail v29a, cableada aqui el 08/09): la dependencia enumera SUBTIPOS
// donde el texto delimitaba una categoria entera, asi que la enumeracion es un
// artefacto de la extraccion, no la condicion. Traducirla produce un filtro
// RESTRICTIVO Y FALSO: mas estrecho que lo que dice el condicionado.
//
// Caso real que lo motivo (Zurich su_00071, "5-. Robo"): la frase es "Para
// turismos de uso particular o furgonetas de transporte propio, cuyo PMA sea
// menor de 3.500 kg", que delimita la categoria AUTOS completa. De esa MISMA
// frase, flujo 2 saca dos dependencias: los subtipos (marcada v29a) y la
// categoria (marcada vacuous_for_ramo). Filtrar por los subtipos ocultaria la
// linea para un monovolumen o un todo terreno, que la frase si cubre. La
// hermana bien expresada -- la categoria -- es la que debe mandar, y resulta
// que es vacua, asi que no hay FILTER_EXPR y eso es correcto.
//
// Por que hacia falta cablearla y no bastaba con no tener vocabulario para
// "furgoneta": hasta el 08/09 esa dependencia se caia sola porque
// `base7Type.id` no tenia `value_aliases`, o sea acertaba por accidente. Al
// dar de alta el alias de "furgoneta" (que SI es un tipo real y aparece a
// secas en dependencias de varias companias) el accidente desaparece y el
// filtro falso apareceria. Es el patron que ya advierte CLAUDE.md 4.2: una
// marca que nadie lee no hace nada.
//
// Solo se filtra la generacion de SPEL: la dependencia sigue viajando intacta
// en el JSON revisable, con su marca, para que quien revise entienda por que
// el FILTER_EXPR esta vacio.
//
// MANTENER EN SINCRONIA con MARKS_EXEMPT_FROM_TRANSLATION de value_matcher.js:
// una dependencia cuyo valor no llega nunca al SPEL tampoco debe exigir
// traduccion (si no, marca needs_review por algo que no es un problema). Son
// dos modulos y dos nodos distintos, asi que no se puede compartir la
// constante; el arnes comprueba que las dos listas coincidan (--generator).
const MARKS_SUPPRESSING_FILTER_EXPR = ["vacuous_for_ramo", "category_expressed_as_type"];

function suppressesFilterExpr(dependency) {
  return MARKS_SUPPRESSING_FILTER_EXPR.some(mark => dependency[mark] === true);
}

// Varias dependencias del MISMO campo con operador de pertenencia se funden en
// una sola, uniendo sus valores -- no se pueden combinar con AND.
//
// Motivo, y es aritmetico antes que semantico: un campo escalar no puede valer
// dos cosas a la vez, asi que "campo = A && campo = B" es INSATISFACIBLE. Y
// cuando el condicionado enumera alternativas ("vehiculos electricos/hibridos")
// lo que dice es un OR, aunque la extraccion lo parta en dos dependencias con
// "=" -- flujo 2 emite una por valor y no tiene forma de expresar el OR en el
// esquema actual (decision de alcance, ver CLAUDE.md 5.8).
//
// Caso real que lo motivo (Zurich su_00066, "3-. Asistencia en viaje", frase
// "Para el caso de vehiculos electricos/hibridos, se ofrece asistencia
// tecnologica remota"): dos dependencias sobre base7Engine.id, una a
// "vehiculo electrico" y otra a "vehiculo hibrido". Sin fundirlas sale
// "{3,13}.contains(campo) && {7,11,12}.contains(campo)", siempre falso -- otra
// condicion sintacticamente valida e imposible de cumplir, la misma clase de
// fallo que motivo el rediseño del catalogo de valores el 08/09. Antes no se
// veia porque ninguno de los dos valores traducia.
//
// Solo se funden grupos HOMOGENEOS en signo: todos de pertenencia positiva
// (=/IN) -> un IN con la union; todos negativos (!=/NOT_IN) -> un NOT_IN con
// la union (que es el equivalente correcto: no estar en A y no estar en B es
// no estar en la union). Cualquier otra mezcla se deja como estaba y se
// combina con AND, porque ahi el AND SI es lo correcto: "= A && != B" es
// satisfacible, y con comparaciones de rango ("registrationYears >= 2 &&
// <= 5") el AND es justamente el combinador que se quiere.
const POSITIVE_MEMBERSHIP_OPERATORS = new Set(["=", "IN"]);
const NEGATIVE_MEMBERSHIP_OPERATORS = new Set(["!=", "NOT_IN"]);

function mergeSameFieldMembership(dependencies) {
  const groups = new Map();
  for (const dep of dependencies) {
    if (!groups.has(dep.risk_field)) groups.set(dep.risk_field, []);
    groups.get(dep.risk_field).push(dep);
  }

  const merged = [];
  for (const group of groups.values()) {
    if (group.length === 1) { merged.push(group[0]); continue; }

    const allPositive = group.every(dep => POSITIVE_MEMBERSHIP_OPERATORS.has(dep.operator));
    const allNegative = group.every(dep => NEGATIVE_MEMBERSHIP_OPERATORS.has(dep.operator));
    if (!allPositive && !allNegative) { merged.push(...group); continue; }

    const values = [];
    for (const dep of group) {
      for (const value of Array.isArray(dep.value) ? dep.value : [dep.value]) {
        if (!values.includes(value)) values.push(value);
      }
    }
    merged.push({
      ...group[0],
      operator: values.length === 1 ? (allPositive ? "=" : "!=") : (allPositive ? "IN" : "NOT_IN"),
      value: values.length === 1 ? values[0] : values
    });
  }
  return merged;
}

function combineFilterExpr(dependencies) {
  if (!dependencies || dependencies.length === 0) return null;
  const effective = dependencies.filter(dep => dep && !suppressesFilterExpr(dep));
  if (effective.length === 0) return null;
  const parts = mergeSameFieldMembership(effective).map(translateToSpel);
  return parts.length === 1 ? parts[0] : parts.map(p => `(${p})`).join(" && ");
}

// Escapa un texto libre para usarlo como literal de cadena SPEL en TEXT_EXPR.
function spelStringLiteral(text) {
  return `'${(text || "").replace(/'/g, "\\'")}'`;
}

// --- Formato ampliado de la hoja "Coberturas opcionales" (07/09) ---
//
// Dos columnas nuevas, las dos con la MISMA semantica de lista: vacia =
// "todas", rellena = "solo estas".
//   OPCIÓN DE LA COBERTURA -> a que opciones (nivel o capital) aplica el texto
//   MODALIDADES            -> a que PRODUCT_COMPANY_MODALITY_ID aplica la fila
// Se nombran en lenguaje de negocio a proposito: el Excel lo rellena alguien
// externo de la compania, no vale hablar de "tuning" ni de "$1" (ver
// prompts/excel_coverage_sheet_builder.md).
function parseOptionalSheetList(text) {
  return (text || "")
    .toString()
    .split(",")
    .map(part => part.trim())
    .filter(part => part.length > 0);
}

// Resuelve el texto de "OPCIÓN DE LA COBERTURA" a los items reales del
// desplegable de tuning. Acepta la ETIQUETA (lo natural para quien rellena el
// Excel: "Esencial", "60.000€") o el valor en crudo, y busca en TODOS los
// grupos de options[] -- imprescindible en un campo con grupos condicionados
// por otro campo, donde el mismo valor puede aparecer en dos grupos con
// etiquetas distintas (caso real capitalAccidenteConductor de Zurich: el valor
// "3A" es "6.000 Euros MUERTE e INVALIDEZ" en un grupo y el placeholder
// "Seleccione una opcion" en el otro -- por eso se empareja por etiqueta y no
// por valor).
//
// Devuelve null si el campo no tiene opciones (booleano/numerico: no hay nada
// que elegir) o si alguna de las opciones nombradas no existe -- nunca
// adivina, para no generar un FILTER_EXPR sobre un valor inventado.
function resolveTuningOptionValues(tuningFieldDef, optionText) {
  const wanted = parseOptionalSheetList(optionText);
  if (wanted.length === 0) return null;

  const items = [];
  for (const group of (tuningFieldDef && tuningFieldDef.options) || []) {
    for (const item of group.items || []) items.push(item);
  }
  if (items.length === 0) return null;

  const resolved = [];
  for (const name of wanted) {
    const hit = items.find(item => item.value === name)
      || items.find(item => normalizeTuningLabel(item.label) === normalizeTuningLabel(name));
    if (!hit) return null;
    if (!resolved.some(r => r.value === hit.value)) resolved.push({ value: hit.value, label: hit.label });
  }
  return resolved;
}

// Condicion SPEL "el valor contratado es una de estas opciones" y su negacion.
// La negacion se usa para el texto PROPIO de una cobertura marcada "Garantía
// Opcional": ese texto explica como conseguirla, asi que solo debe verse
// mientras NO se haya contratado ninguna de las opciones que si la incluyen
// (caso real Zurich cover 14, que la legacy resolvia con OVERWRITE=1).
function buildTuningValueEqualityExpr(tuningKey, optionValues) {
  if (!tuningKey || tuningKey === "NOT_FOUND" || !optionValues || optionValues.length === 0) return null;
  const parts = optionValues.map(o => `tuning?.${tuningKey} == ${quoteSpelValue(o.value)}`);
  return parts.length === 1 ? parts[0] : parts.join(" || ");
}

function buildTuningValueInequalityExpr(tuningKey, optionValues) {
  if (!tuningKey || tuningKey === "NOT_FOUND" || !optionValues || optionValues.length === 0) return null;
  return optionValues.map(o => `tuning?.${tuningKey} != ${quoteSpelValue(o.value)}`).join(" && ");
}

// Marcador de valor del formato ampliado: CUALQUIER texto entre llaves en la
// columna de texto significa "aqui va el valor que el cliente eligio para
// esta cobertura opcional". Sustituye al $1 de RISK_TUNING_COVER (notacion
// interna de la legacy de ASM, ver USE_TUNNING_VALUE en CoverServiceLegacy).
// No hay vocabulario que aprender: cada fila tiene UNA sola cobertura
// opcional, asi que "{importe contratado}", "{el importe}" o "{capital}"
// significan lo mismo. Se eligieron las llaves porque no aparecen ni una vez
// en las fuentes reales medidas y porque [[...]] ya significa otra cosa
// (condicion de riesgo, ver extractBracketMarker).
const TUNING_VALUE_PLACEHOLDER_PATTERN = /\{[^{}]*\}/;

function hasTuningValuePlaceholder(text) {
  return TUNING_VALUE_PLACEHOLDER_PATTERN.test(text || "");
}

// TEXT_EXPR de una LINE: literal SPEL de siempre, o una concatenacion cuando
// el texto trae el marcador de valor. Sin tuning_key resuelto se deja el
// texto tal cual (con las llaves visibles) en vez de inventar una expresion:
// asi el revisor humano ve que ese marcador no se pudo resolver.
function buildLineTextExpr(text, tuningKey) {
  if (!hasTuningValuePlaceholder(text) || !tuningKey || tuningKey === "NOT_FOUND") {
    return spelStringLiteral(text);
  }
  const parts = [];
  let rest = text;
  let match;
  while ((match = TUNING_VALUE_PLACEHOLDER_PATTERN.exec(rest)) !== null) {
    if (match.index > 0) parts.push(spelStringLiteral(rest.slice(0, match.index)));
    parts.push(`tuning?.${tuningKey}`);
    rest = rest.slice(match.index + match[0].length);
  }
  if (rest.length > 0) parts.push(spelStringLiteral(rest));
  return parts.join(" + ");
}

// El `visible` de un campo de tuning es la condicion bajo la que la compania
// ofrece de verdad esa cobertura opcional, y hasta ahora se ignoraba por
// completo. Hay que distinguir dos formas, porque se resuelven en momentos
// distintos:
//   - `${modalityId}==NNNN`  -> se conoce al GENERAR el INSERT; lo cubre la
//     columna MODALIDADES, no debe acabar en el FILTER_EXPR (no existe
//     ${modalityId} en el contexto SPEL de ejecucion).
//   - cualquier otra (otro campo de tuning o datos del riesgo) -> es una
//     condicion de EJECUCION y va al FILTER_EXPR. Casos reales de Zurich:
//     importeRetiradaCarnet visible solo si privacionPermiso (el importe no
//     significa nada sin la cobertura), y rcCarga visible solo para ciertos
//     base7Version.typeCode.
const MODALITY_ID_TUNING_REFERENCE = /\$\{modalityId\}/;

function runtimeVisibilityFilterExpr(tuningFieldDef) {
  const visible = tuningFieldDef && tuningFieldDef.visible;
  if (typeof visible !== "string") return null;
  if (MODALITY_ID_TUNING_REFERENCE.test(visible)) return null;
  const unwrapped = unwrapTuningSpelExpression(visible);
  return unwrapped && unwrapped.trim().length > 0 ? unwrapped.trim() : null;
}

// Simbolos de enumeracion que el texto libre del Excel puede traer ya
// incluidos (guion, bullet, punto medio, asterisco, la letra "o" usada como
// viñeta de sub-lista) -- se quitan siempre antes de aplicar el formato de
// salida, para no acabar con dos viñetas distintas mezcladas en la misma
// comparativa (la del propio Excel + la que anadimos nosotros). La "o" exige
// al menos un espacio detras (a diferencia de los simbolos, que no exigen
// espacio -- caso real "-Responsabilidad Civil...", sin espacio tras el
// guion): sin ese espacio obligatorio, se comeria la primera letra de
// palabras normales que empiezan por "o" (“objeto”, “otros”...).
const LEADING_BULLET_PATTERN = /^(?:[-•·*]\s*|o\s+)/;

function stripLeadingBulletSymbol(text) {
  return (text || "").replace(LEADING_BULLET_PATTERN, "");
}

// Formato visual de una LINE (feedback real del usuario probando en ASM,
// 27/07): TEXT_EXPR se renderiza en texto PLANO -- sin negrita ni HTML/
// Markdown, el unico "marcado" posible es el propio texto. La primera LINE
// de cada ENTRY actua como titulo (sin viñeta, sin indentar); el resto lleva
// una viñeta unica ("•", el mismo caracter que ya aparece en el unico INSERT
// real de referencia del proyecto, knowledge/.../SS11) + indentado, para que
// se note visualmente que pertenece a la entry.
function formatLineText(text, isHeader) {
  const clean = stripLeadingBulletSymbol(text);
  return isHeader ? clean : `  • ${clean}`;
}

// Marcador [[...]] embebido en el texto libre del Excel (convenio del
// prompt excel_coverage_sheet_builder.md, caso real Allianz 29/07): senala
// una condicion de riesgo que aplica SOLO a esa LINE concreta (nunca al
// ENTRY completo) -- el Excel ya distingue por uso de vivienda/regimen de
// tenencia/tipo de construccion en vez de depender de que el flujo 2 lo
// haya extraido del condicionado. Se quita del texto visible (no debe
// aparecer literal en la comparativa) y se traduce a un FILTER_EXPR real.
const BRACKET_MARKER_PATTERN = /\[\[([^\]]+)\]\]/;

function extractBracketMarker(text) {
  const match = BRACKET_MARKER_PATTERN.exec(text || "");
  if (!match) return { cleanText: (text || "").trim(), markerText: null };
  // Caso real (cover 20 "Cristales", opcional "Placas solares", 28-29/07):
  // el marcador puede quedar rodeado de puntos ya anadidos por
  // ensureTrailingPeriod en la composicion de la frase ("Placas solares.
  // [[sólo para propietarios]]. No") -- al quitar el corchete quedaria un
  // ". ." duplicado. Se colapsa a un unico punto tras la limpieza de
  // espacios.
  const cleanText = `${text.slice(0, match.index)}${text.slice(match.index + match[0].length)}`
    .replace(/\s+/g, " ")
    .replace(/\.\s*\./g, ".")
    .trim();
  return { cleanText, markerText: match[1].trim() };
}

// Vocabulario real observado en el Excel de Allianz (29/07) -- 4 conceptos,
// los 4 ya existentes en la ontologia (occupancy/use/buildingType), sin
// necesidad de ningun risk_field nuevo. Matching por PALABRA CLAVE (no
// frase exacta) para no depender de la redaccion exacta de cada compania
// (cubre "sólo para vivienda habitual" y "Solo en vivienda habitual" con
// la misma regla, incluido el caso real con una palabra de mas dentro del
// corchete por error de transcripcion: "[[Dinero solo en vivienda
// habitual]]"). "unifamiliar" cubre AMBOS valores reales de vivienda
// unifamiliar (adosado y chalet independiente -- confirmado por el usuario
// 29/07: "unifamiliar puede ser TerracedHouse o DetachedHouse", ninguno de
// los 2 por separado). Negacion: el marcador empieza por "no" -> invierte
// el operador. Ampliar solo cuando aparezca una quinta convencion real, no
// adivinar variantes hipoteticas -- mismo criterio que
// TUNING_NOT_CONTRACTED_LABELS.
function resolveBracketDependency(markerText) {
  if (!markerText) return null;
  const normalized = markerText
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
  const negated = /^no\b/.test(normalized);

  if (normalized.includes("unifamiliar")) {
    return { risk_field: "buildingType", operator: negated ? "NOT_IN" : "IN", value: ["TerracedHouse", "DetachedHouse"] };
  }
  if (normalized.includes("inquilino")) {
    return { risk_field: "use", operator: negated ? "!=" : "=", value: "Tenant" };
  }
  if (normalized.includes("propietario")) {
    return { risk_field: "use", operator: negated ? "!=" : "=", value: "Owner" };
  }
  if (normalized.includes("alquiler")) {
    return { risk_field: "use", operator: negated ? "!=" : "=", value: "Rental" };
  }
  if (normalized.includes("habitual")) {
    if (normalized.includes("secundari")) {
      return { risk_field: "occupancy", operator: negated ? "NOT_IN" : "IN", value: ["MainResidence", "SecondHome"] };
    }
    return { risk_field: "occupancy", operator: negated ? "!=" : "=", value: "MainResidence" };
  }
  if (normalized.includes("secundari")) {
    return { risk_field: "occupancy", operator: negated ? "!=" : "=", value: "SecondHome" };
  }
  return null;
}

// Decision del usuario (29/07): si la MISMA linea ya tiene un filter_expr
// (de una dependencia real extraida por flujo 2) Y ademas trae un marcador
// [[...]], se combinan con AND -- ninguna de las 2 se descarta. Revisar mas
// adelante si aparece un caso real que necesite otra regla (el corchete
// manda siempre, por ejemplo).
function combineTwoFilterExprStrings(a, b) {
  if (a && b) return `(${a}) && (${b})`;
  return a || b || null;
}

// Construye una LINE final {filter_expr, text_expr} aplicando el formato de
// arriba. isHeader: true para la LINE que actua de titulo de la ENTRY (ver
// formatLineText) -- normalmente la primera que se construye, salvo en
// coberturas opcionales con varios capitales posibles (buildTieredOptionalCoverLines),
// donde varias LINES son candidatas a "titulo" (mutuamente excluyentes via
// su propio FILTER_EXPR, solo una visible a la vez). El marcador [[...]] se
// extrae y resuelve aqui (punto unico por el que pasan TODAS las lineas,
// tanto de "Coberturas por modalidad" como de "Coberturas opcionales") para
// que aplique en cualquier sitio sin tener que tocar cada función que
// construye lineas por separado.
// tuningKey (opcional, formato ampliado 07/09): solo se usa para resolver el
// marcador de valor {...} del texto; sin el, el texto se emite tal cual.
function finalizeLine(text, filterExpr, isHeader, tuningKey) {
  const { cleanText, markerText } = extractBracketMarker(text);
  const bracketDependency = resolveBracketDependency(markerText);
  const bracketExpr = bracketDependency ? translateToSpel(bracketDependency) : null;
  const combinedExpr = combineTwoFilterExprStrings(filterExpr, bracketExpr);
  return {
    filter_expr: combinedExpr,
    text_expr: buildLineTextExpr(formatLineText(cleanText, isHeader), tuningKey)
  };
}

// Trocea el texto libre de una celda del Excel en bullets (una linea por
// bullet, ver knowledge/.../criterio de granularidad de LINES). Descarta la
// primera linea si es solo el nombre de la cobertura repetido (patron real
// observado: la celda empieza con el propio nombre a modo de cabecera).
function splitBulletsFromCellText(cellText, coverName) {
  const lines = (cellText || "")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0);
  if (lines.length > 1 && coverName && lines[0].toLowerCase() === coverName.toLowerCase()) {
    return lines.slice(1);
  }
  return lines;
}

// Construye los ENTRY/LINES de una cobertura completa.
//
// Input:
//   coverId, coverName
//   defaultBullets: string[] -- bullets sin ninguna dependencia estructural
//     emparejada (van todos en un unico ENTRY por defecto).
//   conditionedBullets: [{ text, dependencies, modalityId }] -- un ENTRY por
//     elemento (ver criterio de granularidad: ENTRY = condicion estructural).
//   opcionales: [{ coverName, textContent, hiringStatusExpr, filterExpr,
//     tuningKey, tieredConfig }] -- de la hoja "Coberturas opcionales" ya
//     resueltos a este cover_id. tieredConfig (ver resolveTuningSelectConfig)
//     solo esta presente cuando tuningKey es un select/radio de varios
//     capitales (no un booleano simple) -- en ese caso hiringStatusExpr y
//     filterExpr se ignoran (se recalculan a partir de tieredConfig).
//
// Output: { entries: [...], coverOverride: string|null }
// Traduce un bloque (salida de rich_text_block_parser.parseModalityCellBlocks,
// ver excel_fixture_builder.buildBlockGroupsForCover) a las LINES de su
// ENTRY, aplicando la dependencia de flow 2 que le corresponda a CADA
// segmento por separado (cabecera y cada linea, via
// excel_fixture_builder.matchDependenciesForBlock/matchDependenciesToBlockGroups)
// -- NUNCA al ENTRY completo. Motivo: un bloque puede agrupar varias lineas
// (ej. "-Responsabilidad Civil de la vivienda" con 4 lineas) donde solo UNA
// tiene una condicion real extraida del condicionado (ej. "Como inquilino
// frente al arrendador (locativa)" -> use == 'Tenant'); si esa
// condicion se pusiera en el FILTER_EXPR del ENTRY, ocultaria tambien las
// otras 3 lineas sin relacion. La cabecera (negrita o "-") se mantiene como
// primera linea visible -- ya se mostraba asi antes de este parser. Un
// bloque "value" (ej. "Capital 150.000€") no tiene cuerpo propio: su unica
// linea es el propio valor.
function buildBlockLines(block, headerDependencies, lineDependencies) {
  const lines = [];
  let isFirstLine = true;
  // Bug real de Allianz (29/07): un bloque "flat" no tiene ningun titulo
  // real (a diferencia de "value"/"label", que SI lo tienen via headerText)
  // -- todas sus lineas estan al mismo nivel entre si. Antes, solo la
  // primera linea del array recibia isHeader=true (por ser la primera),
  // apareciendo sin viñeta/indentado mientras el resto si lo llevaba, en
  // TODAS las coberturas del Excel de Allianz (sin negrita real, cada celda
  // es un unico bloque "flat" de N lineas). Feedback real del usuario
  // (29/07) tras ver un primer fix (viñeta en todas): mejor sin viñeta en
  // NINGUNA -- asi queda homogeneo con las lineas de coberturas opcionales
  // (buildTieredOptionalCoverLines), que tampoco llevan viñeta. Un bloque
  // flat de 1 sola linea (Generali) no cambia: ya no llevaba viñeta.
  const pushLine = (text, dependencies) => {
    const isHeader = block.kind === "flat" ? true : isFirstLine;
    lines.push(finalizeLine(text, combineFilterExpr(dependencies), isHeader));
    isFirstLine = false;
  };

  if (block.kind === "value") {
    pushLine(block.headerText, headerDependencies);
    return lines;
  }
  if (block.kind !== "flat" && block.headerText) {
    pushLine(block.headerText, headerDependencies);
  }
  (block.lines || []).forEach((text, i) => pushLine(text, (lineDependencies || [])[i]));
  return lines;
}

// Asegura que un texto que va seguido de mas contenido en la MISMA linea
// (nombre de cobertura opcional, texto libre embebido) termine en un signo
// de puntuacion final -- evita que dos fragmentos queden pegados sin
// separador visual (bug real 27/07: "Primer riesgo No contratada", sin
// ningun punto entre el texto libre y el valor de tuning anadido a
// continuacion). No duplica el punto si el texto ya termina en uno (caso
// real: "Limite 1.500€." en zasite, el texto del Excel ya trae su propio
// punto final).
function ensureTrailingPeriod(text) {
  return /[.!?]$/.test(text || "") ? text : `${text}.`;
}

// Construye las LINES de una cobertura opcional (hoja "Coberturas
// opcionales"). El propio nombre de la cobertura opcional (columna
// "COBERTURA OPCIONAL", opt.coverName) va SIEMPRE primero, a modo de
// cabecera/titulo de la entry -- antes se descartaba por completo (solo se
// usaba para resolver el cover_id padre en matcher.js), lo que dejaba dos
// problemas reales confirmados sobre el Excel de Generali (27/07): una entry
// con textContent vacio (ej. "RC perros peligrosos o de dificil manejo") no
// mostraba nada en la comparativa (0 lineas), y dos opcionales que comparten
// epigrafe con el mismo texto libre (ej. "Primer riesgo" en "Danos a placas
// solares" vs. "Averia a placas solares") quedaban indistinguibles.
//
// Rediseno 27/07 (feedback visual probando en ASM, sin soporte de negrita):
// si el texto libre cabe en 1 sola linea, se une a la del nombre separado
// por un punto ("{coverName}. {texto}"); si tiene mas de 1 linea, el nombre
// queda solo en su propia linea y el resto van debajo (formato de cuerpo,
// ver finalizeLine). Se le pasa coverName a splitBulletsFromCellText para no
// duplicar la cabecera si el propio textContent ya repite el nombre como
// primera linea.
function buildOptionalCoverLines(opt) {
  const bodyLines = splitBulletsFromCellText(opt.textContent, opt.coverName);
  if (bodyLines.length === 0) {
    return [finalizeLine(opt.coverName, null, true, opt.tuningKey)];
  }
  if (bodyLines.length === 1) {
    return [finalizeLine(`${ensureTrailingPeriod(opt.coverName)} ${bodyLines[0]}`, null, true, opt.tuningKey)];
  }
  return [
    finalizeLine(ensureTrailingPeriod(opt.coverName), null, true, opt.tuningKey),
    ...bodyLines.map(text => finalizeLine(text, null, false, opt.tuningKey))
  ];
}

// LINES de una fila con "OPCIÓN DE LA COBERTURA" rellena. A diferencia de
// buildOptionalCoverLines, NO antepone el nombre de la cobertura opcional: el
// texto que la compania da para una opcion concreta ya se describe solo (caso
// real Zurich, "Asistencia en Viaje 24h. Ampliada:" seguido de sus viñetas), y
// anteponerlo producia cabeceras redundantes del tipo "Asistencia en viaje.
// Asistencia en Viaje 24h Esencial". Mismo formato que defaultBullets: la
// primera linea hace de titulo.
function buildOptionScopedCoverLines(opt) {
  const bodyLines = splitBulletsFromCellText(opt.textContent, opt.coverName);
  if (bodyLines.length === 0) return [finalizeLine(opt.coverName, null, true, opt.tuningKey)];
  return bodyLines.map((text, i) => finalizeLine(text, null, i === 0, opt.tuningKey));
}

// Compara labels de opciones de tuning ignorando mayusculas/acentos (uso
// interno -- generator.js es autocontenido, se copia entero al Code node de
// n8n, sin requires a matcher.js/tuning_matcher.js).
function normalizeTuningLabel(text) {
  return (text || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

// Dos convenciones reales de texto para el item "no contratado" de un
// desplegable de tuning: "No contratada" (Generali, zasihb/yvig24/...) y
// "No" (Allianz, solarPanels) -- mismo concepto, distinta redaccion por
// compania. Ampliar aqui solo cuando aparezca una tercera convencion real,
// no adivinar variantes hipoteticas.
// Redacciones reales del item "apagado" de un desplegable de tuning. Ampliar
// SOLO cuando aparezca una nueva en el diccionario real de una compania:
// "no contratada" (Generali: zasihb/zimpac/ztcar), "no" (radios si/no) y
// "no contrata" (Zurich Autos: rcCarga -- sin esta, resolveTuningSelectConfig
// devolvia null y los 5 capitales de RC de la carga caian al formato booleano
// en vez de al de capitales, hallazgo del 07/09).
const TUNING_NOT_CONTRACTED_LABELS = new Set(["no contratada", "no contrata", "no"]);

// El valor que significa "no contratado" dentro de un grupo de opciones de
// tuning (item cuyo label normaliza a una de TUNING_NOT_CONTRACTED_LABELS,
// ej. value "0" en zasihb o value "N" en solarPanels). null si el grupo no
// tiene ese item -- select "obligatorio" (ej. "Franquicia general", 4
// opciones sin estado apagado) o select siempre incluido, solo con tramos de
// capital a elegir (ej. aestheticDamageToBuilding de Allianz, sin ningun
// item de "no contratado" -- confirmado por el usuario 28/07: esa cobertura
// no se puede excluir, solo varia el capital). Ninguno de los dos casos
// representa un on/off de cobertura opcional y por tanto quedan fuera de
// este concepto.
function findTuningNotContractedValue(items) {
  const hit = (items || []).find(it => TUNING_NOT_CONTRACTED_LABELS.has(normalizeTuningLabel(it.label)));
  return hit ? hit.value : null;
}

// Patron real de Allianz para un grupo de options[] condicionado por
// modalidad (a diferencia de yvig24, condicionado por OTRO campo de tuning):
// condition = "/${modalityId}==NNNN/". A diferencia del caso yvig24, esta
// condicion se puede resolver en tiempo de GENERACION del INSERT (la
// modalidad ya se conoce al construir cada fila), no necesita FILTER_EXPR de
// runtime.
const MODALITY_CONDITION_PATTERN = /^\/\$\{modalityId\}==(\d+)\/$/;

// Si TODOS los grupos de options[] siguen el patron de arriba, devuelve un
// mapa modality_id -> items[] (uno por grupo); null si algun grupo no lo
// sigue (caso mixto, o condicionado por otro campo de tuning -- ver
// matchedLabel en resolveTuningSelectConfig).
function extractModalityConditionedGroups(groups) {
  const byModality = {};
  for (const group of groups) {
    const match = MODALITY_CONDITION_PATTERN.exec(group.condition || "");
    if (!match) return null;
    byModality[match[1]] = group.items;
  }
  return byModality;
}

// Quita el envoltorio SPEL "/.../ " que ya trae el diccionario de tuning en
// sus expresiones dinamicas (label/condition/visible/required) -- nuestro
// propio wrapAsSpelExpression lo vuelve a anadir al generar el SQL final, asi
// que aqui hay que dejarlo "en crudo" para no envolverlo dos veces.
function unwrapTuningSpelExpression(expr) {
  if (typeof expr !== "string") return null;
  return expr.startsWith("/") && expr.endsWith("/") ? expr.slice(1, -1) : expr;
}

// Extrae, en el orden en que aparecen, los literales entre comillas simples
// de un label dinamico de tuning (caso real yvig24: label = "/!tuning?.yactsm
// ? 'Danos malintencionados del inquilino' : 'Danos malintencionados del
// inquilino turistica'/"). Ese mismo orden coincide 1:1 con el orden de
// options[] (confirmado sobre el dato real: 1er literal -> grupo con
// condition "/!tuning?.yactsm/", 2o literal -> grupo con condition
// "/tuning?.yactsm/") -- es la misma logica con la que ASM decide que texto
// mostrar segun el grupo vigente, solo que aqui hace falta saber a mano a
// que grupo pertenece el literal que ya emparejo esta fila del Excel.
function extractTuningLabelLiterals(rawLabel) {
  if (typeof rawLabel !== "string") return [];
  return [...rawLabel.matchAll(/'([^']*)'/g)].map(m => m[1]);
}

// Resuelve la configuracion necesaria para tratar un campo de tuning
// "select"/"radio" de varios valores posibles (no booleano, ej. zasihb: 0 =
// no contratada, 1-6 = capitales distintos) como una cobertura opcional con
// capitales -- de ahi sale el HIRING_STATUS_EXPR (OPTIONAL si el valor
// contratado es el "no contratado", INCLUDED en cualquier otro caso) y 1
// LINE por cada valor posible (ver buildTieredOptionalCoverLines).
//
// Soporta 2 formas reales confirmadas sobre el diccionario de tuning de
// Generali (27/07):
//   - 1 solo grupo de opciones (zasihb, zasite, zimpac, ztcar): se usa tal
//     cual, sin condicion de grupo adicional en el ENTRY (groupFilterExpr
//     null).
//   - Varios grupos condicionados por OTRO campo de tuning (yvig24: sus
//     capitales reales cambian segun tuning.yactsm -- 2 filas reales ya
//     separadas en "Coberturas opcionales", "Danos malintencionados del
//     inquilino" / "...turistica"). Cada grupo trae su propio "condition";
//     se usa matchedLabel (el literal que emparejo ESTA fila del Excel, ver
//     tuning_matcher.matchCoverToTuningKey / el agente de matching de
//     tuning_key en n8n) para elegir el grupo correcto via
//     extractTuningLabelLiterals. El ENTRY resultante lleva ademas ese
//     FILTER_EXPR (el "condition" del grupo, sin envoltorio SPEL) para que
//     solo se muestre cuando ese grupo es el vigente -- evita mostrar
//     capitales que no aplican al contexto real (ej. los importes de
//     "turistica" en una vivienda que no lo es).
//   - Varios grupos condicionados por MODALIDAD (caso real Allianz 28/07:
//     aestheticDamageToBuilding/aestheticDamageToContent, condition
//     "/${modalityId}==NNNN/") -- a diferencia de los dos casos anteriores,
//     se resuelve en tiempo de GENERACION del INSERT (no hace falta
//     matchedLabel ni FILTER_EXPR de runtime: la modalidad ya se conoce al
//     construir cada fila). Devuelve la forma { byModality: { modalityId:
//     {items, notContractedValue} } } en vez de { items, notContractedValue,
//     groupFilterExpr } -- buildEntriesForCover genera 1 ENTRY por
//     modalidad. notContractedValue puede ser null aqui (a diferencia de los
//     otros 2 casos): estas coberturas no tienen ningun estado "no
//     contratado", siempre estan incluidas donde la modalidad las ofrece,
//     solo varia el tramo -- buildTieredHiringStatusExpr lo interpreta como
//     HIRING_STATUS_EXPR fijo "INCLUDED".
//
// null si el campo no es un select/radio de opciones no-booleanas, si (caso
// de 1 grupo o multi-grupo por otro campo de tuning) el grupo relevante no
// tiene ningun item "no contratado", o (caso multi-grupo por otro campo de
// tuning) si falta matchedLabel o no se puede resolver a que grupo
// corresponde -- en cualquiera de esos casos el llamador debe seguir usando
// el formato booleano de siempre (limitacion conocida, nunca se asume un
// grupo al azar).
function resolveTuningSelectConfig(tuningFieldDef, matchedLabel) {
  if (!tuningFieldDef || tuningFieldDef.type === "boolean") return null;
  const groups = tuningFieldDef.options;
  if (!Array.isArray(groups) || groups.length === 0) return null;

  if (groups.length === 1) {
    const items = groups[0].items;
    if (!Array.isArray(items) || items.length === 0) return null;
    const notContractedValue = findTuningNotContractedValue(items);
    if (notContractedValue == null) return null;
    return { items, notContractedValue, groupFilterExpr: null };
  }

  const modalityGroups = extractModalityConditionedGroups(groups);
  if (modalityGroups) {
    const byModality = {};
    for (const [modalityId, items] of Object.entries(modalityGroups)) {
      if (!Array.isArray(items) || items.length === 0) return null;
      byModality[modalityId] = { items, notContractedValue: findTuningNotContractedValue(items) };
    }
    return { byModality };
  }

  if (!matchedLabel) return null;
  const literals = extractTuningLabelLiterals(tuningFieldDef.label);
  if (literals.length !== groups.length) return null;
  const literalIndex = literals.findIndex(l => normalizeTuningLabel(l) === normalizeTuningLabel(matchedLabel));
  if (literalIndex === -1) return null;
  const group = groups[literalIndex];
  const items = group.items;
  if (!Array.isArray(items) || items.length === 0) return null;
  const notContractedValue = findTuningNotContractedValue(items);
  if (notContractedValue == null) return null;
  const groupFilterExpr = unwrapTuningSpelExpression(group.condition);

  return { items, notContractedValue, groupFilterExpr };
}

// Si el label de un valor de tuning es un capital (numero con separador de
// miles, ej. "5.000", "15.000" -- forma real confirmada en zasihb/zimpac/
// ztcar/yvig24), se le anade el simbolo € al mostrarlo. Un label no numerico
// (ej. "No contratada") se deja tal cual.
const TUNING_CAPITAL_LABEL_PATTERN = /^\d{1,3}(\.\d{3})*$/;

function formatTuningValueText(label) {
  return TUNING_CAPITAL_LABEL_PATTERN.test(label || "") ? `${label}€` : label;
}

// LINE(S) de una cobertura opcional ligada a un campo de tuning de varios
// valores (ver resolveTuningSelectConfig). Rediseno 27/07 (feedback visual
// probando en ASM, sin soporte de negrita): en vez de una LINE de cabecera +
// 1 LINE por valor (diseno anterior), el valor seleccionado se integra en la
// MISMA linea que la cabecera -- 1 LINE por cada valor posible (mutuamente
// excluyentes via su propio FILTER_EXPR, solo una visible a la vez), cada
// una compuesta como "{coverName}. {texto libre si cabe en 1 sola linea}
// {valor}{€ si es capital}". Si el texto libre del Excel tiene MAS de 1
// linea, no cabe integrado -- la cabecera queda solo con el nombre + valor,
// y esas lineas van debajo como cuerpo (formato de finalizeLine). Sin
// excluir el valor "no contratado" del desplegable (decision del usuario
// 27/07: con un unico ENTRY compartido por todos los valores, omitirlo
// dejaria la cobertura mostrada como OPTIONAL pero sin ningun texto que lo
// explique).
function buildTieredOptionalCoverLines(opt, tuningConfig) {
  const bodyLines = splitBulletsFromCellText(opt.textContent, opt.coverName);
  const inlineBody = bodyLines.length === 1 ? bodyLines[0] : null;

  const headerLines = tuningConfig.items.map(item => {
    const parts = [ensureTrailingPeriod(opt.coverName)];
    if (inlineBody) parts.push(ensureTrailingPeriod(inlineBody));
    parts.push(formatTuningValueText(item.label));
    return finalizeLine(
      parts.join(" "),
      `tuning?.${opt.tuningKey} == ${quoteSpelValue(item.value)}`,
      true
    );
  });

  const extraBodyLines = bodyLines.length > 1 ? bodyLines.map(text => finalizeLine(text, null, false)) : [];

  return [...headerLines, ...extraBodyLines];
}

// HIRING_STATUS_EXPR de una cobertura opcional ligada a un campo de tuning de
// varios valores: OPTIONAL si el valor contratado es el "no contratado" (o
// no hay tuning todavia), INCLUDED en cualquier otro caso (cualquier capital
// contratado). Mismo patron de seguridad que buildOptionalHiringStatusExpr
// (comprobar null antes de comparar, para no depender de que "tuning" exista
// siempre).
//
// notContractedValue null (caso real Allianz, grupos condicionados por
// modalidad -- ver resolveTuningSelectConfig): esta cobertura no tiene
// ningun estado "no contratado", siempre esta incluida donde la modalidad la
// ofrece, solo varian los tramos -- HIRING_STATUS_EXPR fijo, sin ternario.
function buildTieredHiringStatusExpr(opt, tuningConfig) {
  if (tuningConfig.notContractedValue == null) return '"INCLUDED"';
  return `tuning?.${opt.tuningKey} == null || tuning.${opt.tuningKey} == ${quoteSpelValue(tuningConfig.notContractedValue)} ? "OPTIONAL" : "INCLUDED"`;
}

// FILTER_EXPR que hay que aplicar al contenido PROPIO de una cobertura
// marcada "Garantía Opcional": ese texto explica como conseguir la cobertura
// ("Contratando Asistencia en viaje 24 h Plus..."), asi que deja de tener
// sentido en cuanto se contrata una de las opciones que SI la incluyen -- se
// filtra con la negacion de esas opciones. Es lo que la legacy hacia con
// OVERWRITE=1 (sustituir el texto base), traducido a SPEL.
//
// Solo cuentan las filas CON opcion: una fila sin opcion (booleano o importe)
// AÑADE informacion al texto propio en vez de sustituirlo (OVERWRITE=0 en la
// legacy), asi que no debe filtrarlo -- caso real Zurich cover 11, donde
// "Subsidio por pérdida de carné" se ve siempre y el capital se suma al
// contratar.
function buildOwnContentMarkerFilterExpr(opcionales) {
  const replacing = (opcionales || []).filter(
    o => o.optionValues && o.optionValues.length > 0 && o.tuningKey && o.tuningKey !== "NOT_FOUND"
  );
  const parts = replacing
    .map(o => buildTuningValueInequalityExpr(o.tuningKey, o.optionValues))
    .filter(Boolean);
  if (parts.length === 0) return null;
  return parts.length === 1 ? parts[0] : parts.map(p => `(${p})`).join(" && ");
}

// Reparte el contenido propio de la cobertura (sources "default" y
// "modality_bullet") entre las modalidades donde esta INCLUIDA y aquellas
// donde solo se OFRECE (celda con el marcador "Garantía Opcional").
//
// Antes, un bloque que venia de una celda llevaba '"INCLUDED"' fijo, asi que
// una cobertura marcada como opcional en su celda salia como incluida. Cuando
// unas modalidades estan marcadas y otras no (caso real Zurich cover 12,
// marcada solo en la 1360, y cover 13 en 1358/1359) hay que ENUMERAR por
// modalidad: el estado ya no es el mismo en todas, asi que la regla de
// optimizacion del modelo ("mismos valores en todas -> modality_id NULL") no
// aplica. Si TODAS las modalidades estan marcadas (covers 11 y 14) se
// conserva la entry unica.
function applyOptionalMarkerToOwnContent(entries, {
  markerModalityIds = [],
  presentModalityIds = [],
  coverTuningKey = null,
  markerFilterExpr = null
} = {}) {
  if (!markerModalityIds || markerModalityIds.length === 0) return entries;

  const marker = new Set(markerModalityIds.map(String));
  // Con markerFilterExpr, el propio FILTER_EXPR ya acota la entry a la rama
  // "no contratada" (es la negacion de las opciones que SI incluyen la
  // cobertura), asi que el estado es OPTIONAL sin necesidad de ternario -- y
  // sin depender de que el mapeo nombre-de-cobertura -> tuning_key haya
  // acertado. Sin markerFilterExpr la MISMA entry se ve en los dos estados
  // (el texto propio se conserva al contratar, OVERWRITE=0 en la legacy), y
  // ahi si hace falta el ternario sobre el campo de la cobertura.
  const optionalStatusExpr = markerFilterExpr
    ? '"OPTIONAL"'
    : buildOptionalHiringStatusExpr(coverTuningKey);
  const present = presentModalityIds.map(String);
  const includedIds = present.filter(id => !marker.has(id));
  const optionalIds = present.filter(id => marker.has(id));

  const asOptional = entry => ({
    ...entry,
    hiring_status_expr: optionalStatusExpr,
    filter_expr: combineTwoFilterExprStrings(entry.filter_expr, markerFilterExpr)
  });

  const result = [];
  for (const entry of entries) {
    const isOwnContent = entry.source === "default" || entry.source === "modality_bullet";
    if (!isOwnContent) {
      result.push(entry);
      continue;
    }
    if (entry.modality_id != null) {
      result.push(marker.has(String(entry.modality_id)) ? asOptional(entry) : entry);
      continue;
    }
    if (optionalIds.length === 0) {
      result.push(entry);
      continue;
    }
    if (includedIds.length === 0) {
      result.push(asOptional(entry));
      continue;
    }
    for (const modalityId of includedIds) result.push({ ...entry, modality_id: modalityId });
    for (const modalityId of optionalIds) result.push(asOptional({ ...entry, modality_id: modalityId }));
  }
  return result;
}

// optionalMarkerModalityIds: modalidades cuya celda traia el marcador
// "Garantía Opcional" (la cobertura se ofrece ahi, pero no viene incluida).
// coverTuningKey: tuning_key mapeado a partir del NOMBRE DE LA COBERTURA (via
// Build Tuning Context -> Tuning Key Mapping Agent), distinto del tuning_key
// de cada fila de "Coberturas opcionales" -- es el que decide el
// HIRING_STATUS_EXPR del contenido propio en esas modalidades.
function buildEntriesForCover({
  coverId,
  coverName,
  defaultBullets = [],
  conditionedBullets = [],
  defaultBlocks = [],
  conditionedBlocks = [],
  opcionales = [],
  presentModalityIds = [],
  missingModalityIds = [],
  optionalMarkerModalityIds = [],
  coverTuningKey = null
}) {
  const entries = [];

  if (defaultBullets.length > 0) {
    entries.push({
      cover_id: coverId,
      filter_expr: null,
      hiring_status_expr: '"INCLUDED"',
      value_expr: null,
      modality_id: null,
      source: "default",
      lines: defaultBullets.map((text, i) => finalizeLine(text, null, i === 0))
    });
  }

  for (const entry of defaultBlocks) {
    entries.push({
      cover_id: coverId,
      filter_expr: null,
      hiring_status_expr: '"INCLUDED"',
      value_expr: null,
      modality_id: null,
      source: "default",
      lines: buildBlockLines(entry.block, entry.headerDependencies, entry.lineDependencies)
    });
  }

  for (const bullet of conditionedBullets) {
    entries.push({
      cover_id: coverId,
      filter_expr: combineFilterExpr(bullet.dependencies),
      hiring_status_expr: '"INCLUDED"',
      value_expr: null,
      modality_id: bullet.modalityId ?? null,
      source: "modality_bullet",
      lines: [finalizeLine(bullet.text, null, true)]
    });
  }

  for (const cond of conditionedBlocks) {
    entries.push({
      cover_id: coverId,
      filter_expr: null,
      hiring_status_expr: '"INCLUDED"',
      value_expr: null,
      modality_id: cond.modalityId ?? null,
      source: "modality_bullet",
      lines: buildBlockLines(cond.block, cond.headerDependencies, cond.lineDependencies),
      _blockIndex: cond.blockIndex
    });
  }

  // Bug real corregido 24/08 (Mapfre Autos 237, sin ninguna cobertura
  // opcional en todo el producto): el NOT_INCLUDED explicito para
  // modalidades que no ofrecen esta cobertura en absoluto ("No
  // contratable"/"Sin cobertura" en "Coberturas por modalidad") solo se
  // generaba mas abajo, dentro del bucle de coberturas opcionales -- si la
  // cobertura no tiene ninguna fila en "Coberturas opcionales", ese bucle
  // nunca corre y esas modalidades se quedaban sin ningun ENTRY (si el
  // resto de modalidades presentes tenia texto variable) o, peor,
  // HEREDABAN el ENTRY por defecto sin modalidad si el resto compartia
  // exactamente el mismo texto (caso real confirmado: "Defensa en
  // multas"/"Retirada de carne" de Mapfre, marcadas INCLUDED en el 100% de
  // las modalidades del producto pese a que el Excel decia "No contratable"
  // en 14/17 y 17/17 de ellas respectivamente). Guardado con
  // `opcionales.length === 0` para no duplicar el NOT_INCLUDED que el
  // bucle de opcionales ya genera correctamente cuando SI hay opcionales
  // (ver GEN-MISSING-001/002 en generator_golden_dataset.json). Validado
  // offline (GEN-MISSING-003/004) antes de desplegar.
  if (opcionales.length === 0 && missingModalityIds.length > 0) {
    if (presentModalityIds.length === 0) {
      // Mismo criterio de optimizacion que el bucle de opcionales de abajo:
      // si la cobertura no esta disponible en NINGUNA modalidad, una unica
      // ENTRY sin modalidad en vez de una identica por cada una.
      entries.push({
        cover_id: coverId,
        filter_expr: null,
        hiring_status_expr: '"NOT_INCLUDED"',
        value_expr: null,
        modality_id: null,
        source: "base_not_offered",
        lines: []
      });
    } else {
      for (const modalityId of missingModalityIds) {
        entries.push({
          cover_id: coverId,
          filter_expr: null,
          hiring_status_expr: '"NOT_INCLUDED"',
          value_expr: null,
          modality_id: modalityId,
          source: "base_not_offered",
          lines: []
        });
      }
    }
  }

  // Bug real corregido 22/07 (covers 79/81, "Sin cobertura" en varias
  // modalidades de "Coberturas por modalidad"): una cobertura opcional
  // (hoja "Coberturas opcionales") no tiene por que ofrecerse en TODAS las
  // modalidades de su cobertura base -- si "Coberturas por modalidad" dice
  // "Sin cobertura" para una modalidad concreta, esa modalidad no puede
  // contratar ni la base ni el opcional, y debe salir NOT_INCLUDED
  // explicito, no la formula de tuning (que antes se aplicaba por igual a
  // las 11 modalidades, modality_id null, ignorando cuales la ofrecen
  // realmente). Si NINGUNA modalidad falta (missingModalityIds vacio, caso
  // normal), se mantiene el comportamiento de siempre: una unica ENTRY sin
  // modalidad.
  for (const opt of opcionales) {
    // Fila con "OPCIÓN DE LA COBERTURA" rellena (formato ampliado 07/09): 1
    // ENTRY por fila, con su PROPIO texto y la condicion de esa(s) opcion(es)
    // en el FILTER_EXPR -- criterio de granularidad del modelo (ENTRY = una
    // condicion estructural distinta, ver knowledge/Modelo comparativa...).
    //
    // Sustituye, para estas filas, al apaño de buildTieredOptionalCoverLines
    // ("1 LINE por valor, con la etiqueta del desplegable como texto"), que
    // solo podia variar la ETIQUETA y no el cuerpo. Caso real que lo exigia:
    // asistenciaViaje de Zurich, donde Esencial es una linea y Ampliada/Plus
    // son listas de 11 viñetas completamente distintas.
    const optionSelectionExpr = buildTuningValueEqualityExpr(opt.tuningKey, opt.optionValues);
    if (optionSelectionExpr) {
      const optionFilterExpr = combineTwoFilterExprStrings(
        combineTwoFilterExprStrings(optionSelectionExpr, opt.visibilityFilterExpr ?? null),
        opt.filterExpr ?? null
      );
      const optionLines = buildOptionScopedCoverLines(opt);
      const targetModalityIds = (opt.modalityIds && opt.modalityIds.length > 0) ? opt.modalityIds : [null];
      for (const modalityId of targetModalityIds) {
        entries.push({
          cover_id: coverId,
          filter_expr: optionFilterExpr,
          hiring_status_expr: '"INCLUDED"',
          value_expr: null,
          modality_id: modalityId,
          source: "optional_cover",
          // Informativo, para el JSON revisable por humano: a que opcion(es)
          // de la cobertura corresponde esta ENTRY (assembleHumanReviewJson
          // propaga los campos de la entry tal cual, y validateEntryShape
          // ignora los que no conoce).
          cover_option: opt.optionValues.map(o => o.label).join(", "),
          lines: optionLines
        });
      }
      continue;
    }

    // opt.tieredConfig.byModality (ver resolveTuningSelectConfig): caso real
    // Allianz 28/07 (aestheticDamageToBuilding/aestheticDamageToContent) --
    // los tramos de capital YA vienen resueltos por modalidad en el propio
    // diccionario de tuning, a diferencia de yvig24 (un unico grupo
    // resuelto por matchedLabel, compartido por todas las modalidades). Se
    // genera 1 ENTRY POR MODALIDAD, con modality_id explicito y SIN
    // FILTER_EXPR de grupo -- la modalidad ya se conoce en tiempo de
    // generacion del INSERT, no hace falta condicion de runtime para ella.
    if (opt.tieredConfig && opt.tieredConfig.byModality) {
      for (const [modalityId, config] of Object.entries(opt.tieredConfig.byModality)) {
        entries.push({
          cover_id: coverId,
          filter_expr: opt.filterExpr ?? null,
          hiring_status_expr: buildTieredHiringStatusExpr(opt, config),
          value_expr: null,
          modality_id: modalityId,
          source: "optional_cover",
          lines: buildTieredOptionalCoverLines(opt, config)
        });
      }
      continue;
    }

    // opt.tieredConfig (ver resolveTuningSelectConfig): presente solo cuando
    // el tuning_key resuelto es un select/radio de varios capitales (ej.
    // zasihb) en vez de un booleano simple -- cambia tanto las LINES (1 por
    // valor posible) como el HIRING_STATUS_EXPR (comparacion de valor, no
    // truthy) y puede anadir un FILTER_EXPR de grupo (yvig24). Sin
    // tieredConfig, se mantiene el comportamiento de siempre.
    const optLines = opt.tieredConfig ? buildTieredOptionalCoverLines(opt, opt.tieredConfig) : buildOptionalCoverLines(opt);
    const optHiringStatusExpr = opt.tieredConfig ? buildTieredHiringStatusExpr(opt, opt.tieredConfig) : (opt.hiringStatusExpr || '"OPTIONAL"');
    // opt.visibilityFilterExpr (formato ampliado 07/09): el `visible` del
    // campo de tuning, o sea la condicion real bajo la que la compania ofrece
    // esta cobertura opcional (ver runtimeVisibilityFilterExpr). Antes se
    // ignoraba, asi que el opcional se mostraba tambien donde no aplica --
    // caso real Zurich rcCarga, visible solo para ciertos base7Version.
    const optFilterExpr = combineTwoFilterExprStrings(
      (opt.tieredConfig ? opt.tieredConfig.groupFilterExpr : null) ?? opt.filterExpr ?? null,
      opt.visibilityFilterExpr ?? null
    );

    // "MODALIDADES" rellena: la fila aplica SOLO a esas modalidades. No entra
    // en el reparto present/missing de la cobertura, que responde a otra
    // pregunta (donde se ofrece la cobertura entera, no el alcance de un
    // opcional concreto) -- caso real Zurich fenomenosAtmosfericos, ofrecido
    // solo en las modalidades 1358 y 1359.
    if (opt.modalityIds && opt.modalityIds.length > 0) {
      for (const modalityId of opt.modalityIds) {
        entries.push({
          cover_id: coverId,
          filter_expr: optFilterExpr,
          hiring_status_expr: optHiringStatusExpr,
          value_expr: null,
          modality_id: modalityId,
          source: "optional_cover",
          lines: optLines
        });
      }
      continue;
    }

    if (missingModalityIds.length === 0) {
      entries.push({
        cover_id: coverId,
        filter_expr: optFilterExpr,
        hiring_status_expr: optHiringStatusExpr,
        value_expr: null,
        modality_id: null,
        source: "optional_cover",
        lines: optLines
      });
      continue;
    }

    // Caso simetrico al de arriba: la cobertura opcional no esta disponible
    // en NINGUNA modalidad (presentModalityIds vacio) -- incluida la propia
    // cobertura base, no solo el opcional (bug real 24/07, cover 105
    // "Vehiculos/maq. autopropulsada en reposo"). Todas las entries
    // resultarian identicas (mismo NOT_INCLUDED, mismas 0 lineas) salvo por
    // el modality_id, asi que aplica la regla de optimizacion obligatoria
    // del modelo (Paso 2: mismos valores en todas las modalidades ->
    // PRODUCT_COMPANY_MODALITY_ID = NULL) -- una unica ENTRY, no una por
    // modalidad.
    if (presentModalityIds.length === 0) {
      entries.push({
        cover_id: coverId,
        filter_expr: null,
        hiring_status_expr: '"NOT_INCLUDED"',
        value_expr: null,
        modality_id: null,
        source: "optional_cover",
        lines: []
      });
      continue;
    }

    for (const modalityId of missingModalityIds) {
      entries.push({
        cover_id: coverId,
        filter_expr: null,
        hiring_status_expr: '"NOT_INCLUDED"',
        value_expr: null,
        modality_id: modalityId,
        source: "optional_cover",
        lines: []
      });
    }
    for (const modalityId of presentModalityIds) {
      entries.push({
        cover_id: coverId,
        filter_expr: optFilterExpr,
        hiring_status_expr: optHiringStatusExpr,
        value_expr: null,
        modality_id: modalityId,
        source: "optional_cover",
        lines: optLines
      });
    }
  }

  // El reparto por marcador va ANTES de computeCoverOverride: cambia el
  // hiring_status_expr y el filter_expr de las entries de contenido propio, y
  // el override de la cobertura se calcula agregando justamente eso.
  const withMarker = applyOptionalMarkerToOwnContent(entries, {
    markerModalityIds: optionalMarkerModalityIds,
    presentModalityIds,
    coverTuningKey,
    markerFilterExpr: buildOwnContentMarkerFilterExpr(opcionales)
  });

  const coverOverride = computeCoverOverride(withMarker);
  if (coverOverride) {
    for (const entry of withMarker) {
      if (entry.filter_expr === coverOverride.sharedCondition) {
        entry.filter_expr = null;
      }
    }
  }

  const sorted = sortEntriesByModality(withMarker);
  sorted.forEach(entry => delete entry._blockIndex);

  return {
    entries: sorted,
    coverOverride: coverOverride ? coverOverride.hiringStatusExpr : null
  };
}

// Reordena las ENTRY para que sea facil revisar si una modalidad concreta
// tiene todo su contenido (peticion del usuario, 22/07 -- con el orden de
// construccion original, entries de la misma modalidad quedaban dispersas
// entre familias/bloques distintos). Primero las sin modalidad que vienen
// del propio Excel de modalidades (comunes a todas, source "default"),
// despues agrupadas por modalidad, y las de "Coberturas opcionales"
// (source "optional_cover") siempre al FINAL con independencia de que su
// modality_id sea null -- ajuste pedido por el usuario tras revisar un caso
// real (cover 15: "Responsabilidad civil por propiedad y tenencia de
// perros" salia antes que las entries por modalidad, dificultando revisar
// si una modalidad concreta tiene todo su contenido).
//
// Dentro de una MISMA modalidad, se ordena ademas por _blockIndex (la
// posicion original del bloque dentro de su propia celda, ver
// excel_fixture_builder.buildBlockGroupsForCover/Heterogeneous) -- bug real
// detectado 22/07 (cover 15): sin este criterio, el orden dentro de una
// modalidad dependia de en que momento se creaba el groupIndex de cada
// familia durante el agrupamiento (un artefacto interno de
// matchDependenciesToBlockGroups, no el orden real de la celda), asi que el
// Capital aparecia primero en unas modalidades y al final en otras.
// _blockIndex es un campo temporal (no forma parte del ENTRY final, ver el
// borrado tras ordenar en buildEntriesForCover) -- las entries que no vienen
// de conditionedBlocks (default/bullets/opcionales) no lo tienen, se tratan
// como 0 (no afecta su posicion relativa entre modalidades, solo el
// desempate DENTRO de la misma modalidad). Array.prototype.sort es estable
// en Node/V8, asi que el orden relativo dentro de un mismo (modalidad,
// blockIndex) se conserva tal cual las genero buildEntriesForCover.
function sortEntriesByModality(entries) {
  return [...entries].sort((a, b) => {
    const aIsOptional = a.source === "optional_cover" ? 1 : 0;
    const bIsOptional = b.source === "optional_cover" ? 1 : 0;
    if (aIsOptional !== bIsOptional) return aIsOptional - bIsOptional;
    const aKey = a.modality_id == null ? -Infinity : Number(a.modality_id);
    const bKey = b.modality_id == null ? -Infinity : Number(b.modality_id);
    if (aKey !== bKey) return aKey - bKey;
    return (a._blockIndex ?? 0) - (b._blockIndex ?? 0);
  });
}

// Construye el HIRING_STATUS_EXPR real (formula SPEL) de una cobertura
// opcional contratable via tuning, siguiendo el patron ya confirmado en
// knowledge/Modelo comparativa de coberturas - AI ready.md ("Ejemplo
// completo 2"): INCLUDED si el tuning tiene la opcion marcada, OPTIONAL si
// no. Sin un tuning_key real resuelto (NOT_FOUND) no hay forma de construir
// esa condicion -- se mantiene el literal "OPTIONAL" tal cual (mismo
// comportamiento que antes para ese caso).
function buildOptionalHiringStatusExpr(tuningKey) {
  if (!tuningKey || tuningKey === "NOT_FOUND") return '"OPTIONAL"';
  return `tuning?.${tuningKey} != null && tuning.${tuningKey} ? "INCLUDED" : "OPTIONAL"`;
}

// Regla de optimizacion: si TODOS los ENTRY (2 o mas) comparten exactamente
// la misma condicion no nula, se traslada al HIRING_STATUS_EXPR de
// PRODUCT_COMPANY_COVER en vez de repetirse en cada ENTRY (decision del
// usuario, opcion B: el contenido sigue visible aunque la cobertura salga
// NOT_INCLUDED). Con menos de 2 ENTRY no hay nada que deduplicar -- salvo el
// caso de 0 ENTRY (cobertura sin ningun bloque real): ahi se fuerza
// explicitamente NOT_INCLUDED (decision del usuario, 21/07) en vez de dejar
// NULL y depender de que el motor real agregue "cero bloques" a NOT_INCLUDED
// de forma implicita.
function computeCoverOverride(entries) {
  if (entries.length === 0) {
    return { sharedCondition: undefined, hiringStatusExpr: `"NOT_INCLUDED"` };
  }
  if (entries.length < 2) return null;
  const conditions = entries.map(e => e.filter_expr);
  if (conditions.some(c => c == null)) return null;
  const allSame = conditions.every(c => c === conditions[0]);
  if (!allSame) return null;
  return {
    sharedCondition: conditions[0],
    hiringStatusExpr: `${conditions[0]} ? "INCLUDED" : "NOT_INCLUDED"`
  };
}

// Generacion del SQL INSERT final (motor: MySQL, confirmado por el usuario)
// a partir del artefacto de una cobertura (ver buildEntriesForCover). Usa
// variables de sesion (`SET @var := LAST_INSERT_ID()`) para encadenar las FK
// entre PRODUCT_COMPANY_COVER -> _ENTRY -> _LINES, ya que los INSERT se
// ejecutan secuencialmente y el ID de cada fila se genera en la propia BBDD.
//
// Confirmado por el usuario (20/07): toda expresion SPEL (no solo TEXT_EXPR)
// lleva el envoltorio "/" ... "/" -- se aplica por igual a FILTER_EXPR/
// HIRING_STATUS_EXPR/VALUE_EXPR/TEXT_EXPR.
function wrapAsSpelExpression(rawExpr) {
  return rawExpr == null ? null : `/${rawExpr}/`;
}

// Literal SQL: escapa comillas simples con backslash, igual que el ejemplo
// real del modelo (`'/\'texto\'/'`) -- convencion de MySQL con
// NO_BACKSLASH_ESCAPES desactivado (el modo por defecto).
function sqlLiteral(value) {
  if (value == null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replace(/'/g, "\\'")}'`;
}

// coverArtifact: { coverId, productCompanyId, coverOverride, entries } --
// coverOverride y entries.*.filter_expr/hiring_status_expr/value_expr son
// expresiones SPEL en crudo (sin el envoltorio "/.../"); entries.*.lines[].
// text_expr ya viene como literal de cadena SPEL (`'texto'`, ver
// spelStringLiteral) al que tambien hay que anadirle el envoltorio.
function buildInsertStatements({ coverId, productCompanyId, coverOverride, entries }) {
  const statements = [];

  statements.push(
    `INSERT INTO PRODUCT_COMPANY_COVER (HIRING_STATUS_EXPR, COVER_ID, PRODUCT_COMPANY_ID) VALUES (${sqlLiteral(wrapAsSpelExpression(coverOverride))}, ${coverId}, ${productCompanyId});`
  );
  statements.push("SET @cover_id := LAST_INSERT_ID();");

  entries.forEach((entry, entryIndex) => {
    const entryVar = `@entry_id_${entryIndex + 1}`;
    statements.push(
      `INSERT INTO PRODUCT_COMPANY_COVER_ENTRY (FILTER_EXPR, HIRING_STATUS_EXPR, ENTRY_ORDER, VALUE_EXPR, UNIT, PRODUCT_COMPANY_MODALITY_ID, PRODUCT_COMPANY_COVER_ID) VALUES (${sqlLiteral(wrapAsSpelExpression(entry.filter_expr))}, ${sqlLiteral(wrapAsSpelExpression(entry.hiring_status_expr))}, ${entryIndex + 1}, ${sqlLiteral(wrapAsSpelExpression(entry.value_expr))}, NULL, ${entry.modality_id ?? "NULL"}, @cover_id);`
    );
    statements.push(`SET ${entryVar} := LAST_INSERT_ID();`);

    entry.lines.forEach((line, lineIndex) => {
      statements.push(
        `INSERT INTO PRODUCT_COMPANY_COVER_LINES (FILTER_EXPR, TEXT_EXPR, PRODUCT_COMPANY_COVER_ENTRY_ID, LINE_ORDER) VALUES (${sqlLiteral(wrapAsSpelExpression(line.filter_expr))}, ${sqlLiteral(wrapAsSpelExpression(line.text_expr))}, ${entryVar}, ${lineIndex + 1});`
      );
    });
  });

  return statements;
}

module.exports = {
  POSITIVE_MEMBERSHIP_OPERATORS,
  NEGATIVE_MEMBERSHIP_OPERATORS,
  mergeSameFieldMembership,
  MARKS_SUPPRESSING_FILTER_EXPR,
  suppressesFilterExpr,
  translateToSpel,
  parseOptionalSheetList,
  resolveTuningOptionValues,
  buildTuningValueEqualityExpr,
  buildTuningValueInequalityExpr,
  buildLineTextExpr,
  runtimeVisibilityFilterExpr,
  buildOwnContentMarkerFilterExpr,
  buildOptionScopedCoverLines,
  applyOptionalMarkerToOwnContent,
  combineFilterExpr,
  spelStringLiteral,
  splitBulletsFromCellText,
  buildBlockLines,
  buildEntriesForCover,
  buildOptionalHiringStatusExpr,
  resolveTuningSelectConfig,
  formatLineText,
  formatTuningValueText,
  ensureTrailingPeriod,
  computeCoverOverride,
  wrapAsSpelExpression,
  sqlLiteral,
  buildInsertStatements,
  extractBracketMarker,
  resolveBracketDependency,
  finalizeLine
};
