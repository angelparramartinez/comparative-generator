// Catalogo de VALORES de enum construido en tiempo de ejecucion desde la
// ontologia del ramo -- fuente de verdad UNICA para la traduccion
// "texto libre en español del condicionado" -> "valor real del enum en
// insurance.risk" que hace value_matcher.js.
//
// Por que existe este modulo (hallazgo real 08/09, ejecucion 402 de
// `coverage insert generation` con Zurich Autos): value_matcher.js llevaba el
// catalogo HARDCODEADO en una constante (ENUM_VALUE_CATALOG) con los tres
// campos de Hogar (occupancy/use/capitalInsuranceType). Consecuencias, las
// dos reales:
//
//   1. Rompia la restriccion transversal de CLAUDE.md ("todo debe ser
//      generico por ramo"): añadir Autos exigia tocar el workflow.
//   2. Duplicaba el dato. La ontologia YA lo tenia -- ontology-home.md
//      declara `values:`, `known_limitations:` y `value_context_overrides:`
//      con correspondencia 1:1 con las tres claves del catalogo -- y el
//      propio fichero documentaba la deuda: "Mantenido tambien en
//      value_matcher.js (ENUM_VALUE_CATALOG) como fuente de verdad
//      ejecutable -- regenerar/revisar a mano si cambia esta seccion".
//      Ese "a mano" es lo que fallo: al llegar Autos nadie regenero nada, los
//      campos de `base7Version` no estaban catalogados, y el texto español
//      ("vehículo eléctrico") acabo LITERAL en el FILTER_EXPR contra un `.id`
//      que en ejecucion es un numero (3 = ELÉCTRICO). 27 LINE de la ejecucion
//      402 con una condicion que nunca puede ser cierta.
//
// Con este modulo, añadir un ramo = editar su .md. Cero cambios en el
// workflow.
//
// El .md ya viaja al contenedor de n8n: `/home/node/ontologies` esta montado,
// y `ontology indexing` lo lee con la misma cadena (Read Ramo Ontology File ->
// Detect Imports -> Read Shared Ontology File), resolviendo el fichero desde
// el campo `Ramo` del formulario.

// ======================================================
// UTILIDADES DE PARSEO
// ======================================================
//
// Mismo patron (y a proposito los mismos nombres) que `Ontology Splitter` y
// `Merge Shared Texts Into Ramo` de `ontology indexing`: ese workflow ya
// parsea `risk_field`/`data_type`/`aliases`/`negative_aliases` de estos
// ficheros. Aqui se añaden las tres claves de VALOR que aquel no necesita.

function extractSingleValue(block, fieldName) {
  const regex = new RegExp(`^${fieldName}:\\s*(.*)$`, "mi");
  const match = block.match(regex);
  return match ? match[1].trim() : null;
}

// Lista de una seccion "clave:\n- item\n- item". Corta al llegar a la
// siguiente clave de nivel superior.
function extractSectionList(block, sectionName) {
  const lines = block.split("\n");
  const values = [];
  let insideSection = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase() === `${sectionName.toLowerCase()}:`) {
      insideSection = true;
      continue;
    }
    if (insideSection && /^[a-zA-Z_]+:\s*/.test(trimmed)) break;
    if (insideSection && trimmed.startsWith("- ")) values.push(trimmed.substring(2).trim());
  }
  return values;
}

// Igual que extractSectionList pero uniendo las lineas de continuacion
// (indentadas) al item anterior.
//
// No es un extra teorico: `value_context_overrides` de ontology-home.md parte
// su unica regla en dos lineas, y la continuacion empieza literalmente por
// "contiene:" -- que casa con la regex de corte de extractSectionList
// (`^[a-zA-Z_]+:`). Con el extractor simple, esa regla se leeria truncada y
// perderia justo la lista de palabras que la hace funcionar. Se distingue
// item de continuacion por la INDENTACION del texto crudo (los items estan a
// columna 0, las continuaciones sangradas), nunca por el contenido.
function extractSectionListMultiline(block, sectionName) {
  const lines = block.split("\n");
  const values = [];
  let insideSection = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!insideSection) {
      if (trimmed.toLowerCase() === `${sectionName.toLowerCase()}:`) insideSection = true;
      continue;
    }
    if (trimmed === "") continue;
    const isIndented = /^\s/.test(line);
    if (!isIndented && /^[a-zA-Z_][a-zA-Z0-9_]*:\s*/.test(trimmed)) break;
    if (trimmed.startsWith("- ")) {
      values.push(trimmed.substring(2).trim());
    } else if (isIndented && values.length > 0) {
      values[values.length - 1] += ` ${trimmed}`;
    }
  }
  return values;
}

// ======================================================
// LAS TRES CLAVES DE VALOR
// ======================================================

// Un valor de enum escrito como digitos pelados ES un numero, y hay que
// devolverlo como tal, no como cadena.
//
// No es cosmetica: `generator.quoteSpelValue` entrecomilla toda cadena de JS,
// asi que un id numerico que viaje como "3" sale al SPEL como `'3'` -- literal
// de texto comparado contra un campo que en ejecucion vale 3. En Spring SpEL
// eso acaba en `String.equals(Integer)`, siempre false. Seria exactamente el
// mismo bug que motivo este modulo (sintacticamente valido, imposible de
// cumplir), colado por la puerta de atras: detectado al revisar el SPEL de
// `{'3','13'}.contains(...)` que producia el caso VM-PIPE-004.
//
// La forma lexica es la señal, y es fiable con los datos reales: los valores
// simbolicos de la ontologia son identificadores (`MainResidence`,
// `FirstRisk`, `PrivateGarage`) y los ids de Base7 son digitos (`3`, `13`).
// Limitacion conocida y aceptada: un enum cuyo valor real fuese una CADENA de
// digitos con ceros a la izquierda ("01") se convertiria mal. Hoy no existe
// ninguno; el dia que aparezca hara falta declarar el tipo del valor en la
// ontologia en vez de deducirlo. Un valor mixto ("3A", como los del tuning de
// Zurich) no casa la regex y se queda cadena, que es lo correcto.
function coerceEnumValue(value) {
  return /^-?\d+$/.test(value) ? Number(value) : value;
}

// "ValorReal: alias1, alias2" -> { ValorReal: [alias1, alias2] }, leido de la
// clave `value_aliases:` y SOLO de ella.
//
// La clave es nueva (08/09) y separa dos cosas que `values:` mezclaba segun el
// fichero: en los .md de ramo, `values:` traia el vocabulario español del
// condicionado ("MainResidence: vivienda principal, residencia principal, ..."),
// mientras que en los compartidos (shared/*.md) trae el catalogo de la BBDD
// ("3: ELÉCTRICO", "2: COMBUSTIÓN INTERNA DIESEL, COMBUSTIBLE GASOIL (Diesel)").
//
// Se descarto leer `values:` como fallback, y no por purismo: medido contra los
// ficheros reales, partir por comas un catalogo de BBDD fabrica alias falsos
// que COLISIONAN entre valores. Caso real, `licenseType` de person.md
// ("A1: moto, edad mínima 15, hasta 125cc" y tres lineas mas del mismo estilo):
// el alias "moto" acabaria apuntando a A1, A2, A y AM a la vez, y en un Map
// alias->valor gana el ultimo. Eso no es un fallo que se vea, es una
// traduccion INCORRECTA -- peor que el bug que motivo este modulo, donde al
// menos el texto español quedaba a la vista en el FILTER_EXPR.
//
// Un enum sin `value_aliases:` se resuelve como `enum_without_value_catalog`,
// que value_matcher trata como fallo real: la dependencia se excluye y se
// reporta. Ruidoso por defecto.
//
// Devuelve una LISTA de { value, aliases } y no un objeto indexado por valor.
// Las claves de un objeto de JS son siempre cadenas, asi que un objeto
// perderia justo la coercion de coerceEnumValue (`values[3]` se guarda como
// `values["3"]`) -- y esa perdida es invisible hasta que sale al SPEL mal
// entrecomillada. La lista tambien conserva de forma explicita el orden de
// declaracion del .md, que es el orden en que salen los valores en el IN.
function parseValueAliases(block) {
  const entries = extractSectionList(block, "value_aliases");
  const values = [];
  for (const entry of entries) {
    const separatorAt = entry.indexOf(":");
    if (separatorAt === -1) continue;
    const rawValue = entry.slice(0, separatorAt).trim();
    const aliases = entry
      .slice(separatorAt + 1)
      .split(",")
      .map(a => a.trim())
      .filter(Boolean);
    if (!rawValue || aliases.length === 0) continue;
    values.push({ value: coerceEnumValue(rawValue), aliases });
  }
  return values;
}

// "A -> B cuando <lo que sea> contiene: x, y, z" -> regla ejecutable.
//
// La frase intermedia es prosa libre a proposito (en ontology-home.md dice
// "cuando la evidencia de la MISMA dependencia tambien contiene:"): la
// ontologia es un documento que leen personas. Solo se exigen las tres piezas
// con significado -- origen, destino y la lista tras "contiene:".
function parseContextOverrides(block) {
  const entries = extractSectionListMultiline(block, "value_context_overrides");
  const rules = [];
  for (const entry of entries) {
    const match = entry.match(/^(\S+)\s*->\s*(\S+)\b.*?contiene:\s*(.+)$/i);
    if (!match) continue;
    const cues = match[3]
      .split(",")
      .map(c => c.trim())
      .filter(Boolean);
    if (cues.length === 0) continue;
    rules.push({ from: match[1], to: match[2], whenEvidenceContainsAny: cues });
  }
  return rules;
}

// ======================================================
// BLOQUES DE CONCEPTO
// ======================================================

// Trocea un .md de ontologia en sus bloques "## <concepto>".
//
// Acepta `risk_field:` y `field:` como clave de campo porque los ficheros de
// ramo usan la primera y los compartidos (shared/*.md) la segunda --
// comprobado: ontology-home 25 `risk_field:` / 0 `field:`, base7version 0 / 3.
function splitConcepts(text) {
  const normalized = (text || "").replace(/\r\n/g, "\n").trim();
  const concepts = [];

  for (const section of normalized.split(/^##\s+/gm)) {
    let block = section.trim();
    if (!block) continue;
    if (block.includes("OntologyType:") || block.includes("SharedOntology:")) continue;
    block = block.replace(/---+/g, "").trim();

    const conceptId = (block.split("\n")[0] || "").trim();
    if (!conceptId) continue;

    concepts.push({
      conceptId,
      riskField: extractSingleValue(block, "risk_field") || extractSingleValue(block, "field"),
      imports: extractSingleValue(block, "imports"),
      dataType: extractSingleValue(block, "data_type"),
      values: parseValueAliases(block),
      knownLimitations: extractSectionList(block, "known_limitations"),
      contextOverrides: parseContextOverrides(block)
    });
  }

  return concepts;
}

// ======================================================
// CONSTRUCCION DEL CATALOGO
// ======================================================

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Ficheros compartidos que el ramo declara en su cabecera ("Imports: person,
// base7version"). Es la MISMA lectura que hace `Detect Imports` de
// `ontology indexing`, y decide que ficheros hay que leer de disco.
//
// Importa respetarla y no fiarse solo del `imports:` de cada bloque de figura:
// son dos declaraciones distintas y produccion usa las dos. Descubierto
// probando este check en negativo -- al borrar `base7version` de la cabecera,
// el catalogo seguia saliendo completo porque el arnes le pasaba todos los
// ficheros compartidos a mano, asi que el arnes era mas permisivo que
// produccion (donde ese fichero simplemente no se lee).
function parseHeaderImports(ramoText) {
  const match = (ramoText || "").match(/^Imports:\s*(.*)$/mi);
  return (match ? match[1].split(",") : []).map(s => s.trim()).filter(Boolean);
}

// Campos que el ramo excluye de un import ("ExcludeImportedFields: person.sport").
function parseExcludedImportedFields(ramoText) {
  const match = (ramoText || "").match(/^ExcludeImportedFields:\s*(.*)$/mi);
  return new Set(
    (match ? match[1].split(",") : []).map(entry => entry.trim()).filter(Boolean)
  );
}

// Nombre de figura que NO prefija sus campos: sus valores viven en la raiz del
// contexto, no bajo la figura. Misma constante y mismo motivo que en
// `Merge Shared Texts Into Ramo`.
const HOLDER_CONTAINER = "holder";

// Compone el risk_field final de un campo importado.
//
// REGLA CRITICA, copiada de `Merge Shared Texts Into Ramo` (nodo de
// `ontology indexing`), que es su fuente de verdad: el risk_field indexado en
// Qdrant -- y por tanto el que el LLM extractor devuelve y el que llega en la
// dependencia -- es `<figura>.<campo>`, salvo la figura `holder`, que no
// prefija. Ejemplo real: la figura `## base7Version` de ontology-auto.md
// importa `base7version`, cuyo campo declara `field: base7Engine.id`, y la
// dependencia real del artefacto de Zurich llega como
// `base7Version.base7Engine.id`. Si esta composicion se desalinea de aquel
// nodo, el catalogo se indexa con claves que ninguna dependencia usa y la
// traduccion vuelve a fallar en silencio.
function composeImportedRiskField(figureName, fieldName) {
  return figureName === HOLDER_CONTAINER ? fieldName : `${figureName}.${fieldName}`;
}

function catalogEntryOf(concept) {
  return {
    dataType: concept.dataType,
    values: concept.values,
    knownLimitations: concept.knownLimitations,
    contextOverrides: concept.contextOverrides
  };
}

// Construye el catalogo completo de un ramo: sus propios conceptos mas los
// campos de cada fichero compartido, expandidos por figura igual que hace la
// indexacion.
//
// `sharedTextsByImportName`: { person: "<texto md>", base7version: "<texto md>" }
// -- las claves son los nombres que el ramo declara en `Imports:` y en el
// `imports:` de cada bloque de figura.
//
// Devuelve un objeto plano risk_field -> { dataType, values, knownLimitations,
// contextOverrides }, listo para value_matcher.js. Un risk_field repetido se
// FUSIONA en vez de sobreescribirse: varios conceptos de negocio pueden
// compartir campo (caso real, ontology-home.md: `housingUse` e
// `isMainResidence` se consolidaron sobre `occupancy`), y quedarse con el
// ultimo bloque perderia en silencio los alias del otro.
function buildValueCatalog(ramoText, sharedTextsByImportName) {
  const catalog = {};

  const addConcept = (riskField, concept) => {
    if (!riskField) return;
    const incoming = catalogEntryOf(concept);
    const existing = catalog[riskField];
    if (!existing) {
      catalog[riskField] = incoming;
      return;
    }
    catalog[riskField] = {
      dataType: existing.dataType || incoming.dataType,
      values: mergeValueAliases(existing.values, incoming.values),
      knownLimitations: Array.from(new Set([...existing.knownLimitations, ...incoming.knownLimitations])),
      contextOverrides: [...existing.contextOverrides, ...incoming.contextOverrides]
    };
  };

  const ramoConcepts = splitConcepts(ramoText);
  for (const concept of ramoConcepts) addConcept(concept.riskField, concept);

  const excludedImportedFields = parseExcludedImportedFields(ramoText);
  const declaredImports = new Set(parseHeaderImports(ramoText));
  const figureBlocks = ramoConcepts.filter(c => c.imports);

  for (const figureBlock of figureBlocks) {
    const importName = figureBlock.imports;

    // Rompe en vez de seguir, igual que `Merge Shared Texts Into Ramo`. Un
    // import que la figura pide y la cabecera no declara (o que quien llama no
    // aporto) significa que el catalogo saldria CALLADAMENTE incompleto: los
    // campos de ese fichero no tendrian vocabulario, value_matcher los
    // reportaria como enum_without_value_catalog y se excluirian dependencias
    // correctas -- con toda la pinta de "este condicionado no tenia
    // condiciones". Preferible fallar donde esta la causa.
    if (!declaredImports.has(importName)) {
      throw new Error(
        `buildValueCatalog: la figura '${figureBlock.conceptId}' importa '${importName}', que no esta en el 'Imports:' de la cabecera del ramo (declarados: ${[...declaredImports].join(", ") || "ninguno"}).`
      );
    }
    const sharedText = (sharedTextsByImportName || {})[importName];
    if (sharedText == null) {
      throw new Error(
        `buildValueCatalog: falta el texto del fichero compartido '${importName}', declarado en el 'Imports:' del ramo y usado por la figura '${figureBlock.conceptId}'.`
      );
    }

    for (const sharedField of splitConcepts(sharedText)) {
      const fieldName = sharedField.riskField || sharedField.conceptId;
      if (excludedImportedFields.has(`${importName}.${fieldName}`)) continue;
      addConcept(composeImportedRiskField(figureBlock.conceptId, fieldName), sharedField);
    }
  }

  return catalog;
}

// Fusiona dos listas de { value, aliases } respetando el orden de aparicion y
// uniendo los alias de un valor que se declare en los dos bloques.
function mergeValueAliases(existingValues, incomingValues) {
  const merged = (existingValues || []).map(v => ({ value: v.value, aliases: [...v.aliases] }));
  for (const incoming of incomingValues || []) {
    const already = merged.find(v => v.value === incoming.value);
    if (already) {
      for (const alias of incoming.aliases) if (!already.aliases.includes(alias)) already.aliases.push(alias);
    } else {
      merged.push({ value: incoming.value, aliases: [...incoming.aliases] });
    }
  }
  return merged;
}

module.exports = {
  HOLDER_CONTAINER,
  coerceEnumValue,
  parseHeaderImports,
  extractSingleValue,
  extractSectionList,
  extractSectionListMultiline,
  parseValueAliases,
  parseContextOverrides,
  splitConcepts,
  parseExcludedImportedFields,
  composeImportedRiskField,
  buildValueCatalog
};
