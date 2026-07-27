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
// dependencia no anade parentesis de mas.
function combineFilterExpr(dependencies) {
  if (!dependencies || dependencies.length === 0) return null;
  const parts = dependencies.map(translateToSpel);
  return parts.length === 1 ? parts[0] : parts.map(p => `(${p})`).join(" && ");
}

// Escapa un texto libre para usarlo como literal de cadena SPEL en TEXT_EXPR.
function spelStringLiteral(text) {
  return `'${(text || "").replace(/'/g, "\\'")}'`;
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

// Construye una LINE final {filter_expr, text_expr} aplicando el formato de
// arriba. isHeader: true para la LINE que actua de titulo de la ENTRY (ver
// formatLineText) -- normalmente la primera que se construye, salvo en
// coberturas opcionales con varios capitales posibles (buildTieredOptionalCoverLines),
// donde varias LINES son candidatas a "titulo" (mutuamente excluyentes via
// su propio FILTER_EXPR, solo una visible a la vez).
function finalizeLine(text, filterExpr, isHeader) {
  return { filter_expr: filterExpr, text_expr: spelStringLiteral(formatLineText(text, isHeader)) };
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
  const pushLine = (text, dependencies) => {
    lines.push(finalizeLine(text, combineFilterExpr(dependencies), isFirstLine));
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
    return [finalizeLine(opt.coverName, null, true)];
  }
  if (bodyLines.length === 1) {
    return [finalizeLine(`${ensureTrailingPeriod(opt.coverName)} ${bodyLines[0]}`, null, true)];
  }
  return [
    finalizeLine(ensureTrailingPeriod(opt.coverName), null, true),
    ...bodyLines.map(text => finalizeLine(text, null, false))
  ];
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

const TUNING_NOT_CONTRACTED_LABEL = "no contratada";

// El valor que significa "no contratado" dentro de un grupo de opciones de
// tuning (item cuyo label normaliza a "no contratada", ej. value "0" en
// zasihb). null si el grupo no tiene ese item -- select "obligatorio" (ej.
// "Franquicia general", 4 opciones sin estado apagado), que no representa un
// on/off de cobertura opcional y por tanto queda fuera de este caso.
function findTuningNotContractedValue(items) {
  const hit = (items || []).find(it => normalizeTuningLabel(it.label) === TUNING_NOT_CONTRACTED_LABEL);
  return hit ? hit.value : null;
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
//
// null si el campo no es un select/radio de opciones no-booleanas, si el
// grupo relevante no tiene ningun item "no contratada", o (caso multi-grupo)
// si falta matchedLabel o no se puede resolver a que grupo corresponde --
// en cualquiera de esos casos el llamador debe seguir usando el formato
// booleano de siempre (limitacion conocida, nunca se asume un grupo al azar).
function resolveTuningSelectConfig(tuningFieldDef, matchedLabel) {
  if (!tuningFieldDef || tuningFieldDef.type === "boolean") return null;
  const groups = tuningFieldDef.options;
  if (!Array.isArray(groups) || groups.length === 0) return null;

  let items;
  let groupFilterExpr = null;

  if (groups.length === 1) {
    items = groups[0].items;
  } else {
    if (!matchedLabel) return null;
    const literals = extractTuningLabelLiterals(tuningFieldDef.label);
    if (literals.length !== groups.length) return null;
    const literalIndex = literals.findIndex(l => normalizeTuningLabel(l) === normalizeTuningLabel(matchedLabel));
    if (literalIndex === -1) return null;
    const group = groups[literalIndex];
    items = group.items;
    groupFilterExpr = unwrapTuningSpelExpression(group.condition);
  }

  if (!Array.isArray(items) || items.length === 0) return null;
  const notContractedValue = findTuningNotContractedValue(items);
  if (notContractedValue == null) return null;

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
function buildTieredHiringStatusExpr(opt, tuningConfig) {
  return `tuning?.${opt.tuningKey} == null || tuning.${opt.tuningKey} == ${quoteSpelValue(tuningConfig.notContractedValue)} ? "OPTIONAL" : "INCLUDED"`;
}

function buildEntriesForCover({
  coverId,
  coverName,
  defaultBullets = [],
  conditionedBullets = [],
  defaultBlocks = [],
  conditionedBlocks = [],
  opcionales = [],
  presentModalityIds = [],
  missingModalityIds = []
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
    // opt.tieredConfig (ver resolveTuningSelectConfig): presente solo cuando
    // el tuning_key resuelto es un select/radio de varios capitales (ej.
    // zasihb) en vez de un booleano simple -- cambia tanto las LINES (1 por
    // valor posible) como el HIRING_STATUS_EXPR (comparacion de valor, no
    // truthy) y puede anadir un FILTER_EXPR de grupo (yvig24). Sin
    // tieredConfig, se mantiene el comportamiento de siempre.
    const optLines = opt.tieredConfig ? buildTieredOptionalCoverLines(opt, opt.tieredConfig) : buildOptionalCoverLines(opt);
    const optHiringStatusExpr = opt.tieredConfig ? buildTieredHiringStatusExpr(opt, opt.tieredConfig) : (opt.hiringStatusExpr || '"OPTIONAL"');
    const optFilterExpr = (opt.tieredConfig ? opt.tieredConfig.groupFilterExpr : null) ?? opt.filterExpr ?? null;

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

  const coverOverride = computeCoverOverride(entries);
  if (coverOverride) {
    for (const entry of entries) {
      if (entry.filter_expr === coverOverride.sharedCondition) {
        entry.filter_expr = null;
      }
    }
  }

  const sorted = sortEntriesByModality(entries);
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
  translateToSpel,
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
  buildInsertStatements
};
