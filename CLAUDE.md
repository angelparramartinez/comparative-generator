# Proyecto: Generación de comparativa de coberturas (ASM)

## 1. Contexto de negocio

ASM es la aplicación que obtiene ofertas de seguros llamando a los servicios web de
distintas compañías. Flujo de usuario:

1. El usuario rellena los datos comunes del riesgo según el **ramo** (p. ej. Hogar).
2. Ajusta cada oferta de compañía en una pantalla específica llamada **tuning**
   (coberturas, descuentos, capitales...).
3. Para cada oferta puede generar una **comparativa de coberturas** (pantalla o PDF).

La comparativa se genera en tiempo de ejecución con un motor basado en **SPEL**, a
partir de datos almacenados en BBDD. Este proyecto NO toca el motor de generación:
su objetivo es producir las sentencias **INSERT SQL** que alimentan esas tablas para
un producto/compañía nuevo, a partir de:

- El **PDF de condiciones generales** del producto (ejemplo de trabajo: Generali Hogar).
- Un **Google Sheet / Excel** de coberturas por modalidad que entrega la compañía
  (ejemplo: `Plantilla_Comparativa_Hogar.xlsx`).

**Restricción de diseño transversal: todo debe ser genérico por ramo.** Las pruebas
se hacen con Generali Hogar, pero nada del pipeline (chunking, matching, prompts,
esquemas) debe depender de conceptos específicos de Hogar. La ontología de cada ramo
vive indexada por separado en Qdrant (flujo `ontology indexing.json`, ver sección 4).

## 2. Ficheros de referencia del proyecto

| Fichero | Contenido |
|---|---|
| `knowledge/Modelo comparativa de coberturas - AI ready.md` | Modelo de datos objetivo del flujo 3: tablas, semántica SPEL (`FILTER_EXPR`/`HIRING_STATUS_EXPR`/`VALUE_EXPR`/`TEXT_EXPR`), criterio de granularidad `ENTRY`/`LINES` y decisión de alcance sobre `covers` — ver sección 3 |
| `knowledge/ontologies/ontology-home.md` | Ontología del riesgo de Hogar: mapea vocabulario del condicionado a campos de `insurance.risk` (aliases, `negative_aliases` por concepto) |
| `example/condiciones generales Generali Hogar.pdf` | Condicionado general de ejemplo (162 páginas) — fuente de las reglas/dependencias no explícitas en el Excel |
| `example/Plantilla Comparativa Hogar.xlsx` | Excel de coberturas por modalidad de Generali. Hoja **"Coberturas por modalidad"**: col. A = `COVER_ID`, col. B = nombre de cobertura, cabeceras numéricas = `PRODUCT_COMPANY_MODALITY_ID`, celdas = texto libre de lo que cubre esa cobertura en esa modalidad (13 coberturas × 11 modalidades). Hoja **"Coberturas opcionales"**: 16 textos adicionales que se insertan dentro de un epígrafe ya existente |
| `evaluators/coverage_dependency_extractor/` | Golden set propio + arnés de evaluación offline del flujo 2 (ver sección 5) |
| `ggcc_outputs/` | Salidas reales de ejecuciones del flujo 2 (no versionado en git, local) |

**Problema de partida:** el Excel a menudo no indica las condiciones bajo las que una
cobertura está incluida (p. ej. Restauración Estética depende de tener contratado
capital de Contenido y/o Continente, pero el Excel solo da los capitales, no la
dependencia). Esa información hay que extraerla del condicionado general — es el
objetivo del flujo 2 (sección 4-5).

## 3. Modelo de datos objetivo (resumen)

Jerarquía (nombres reales de tablas, ver el `.md` de `knowledge/` para el detalle
completo y ejemplos de INSERT):

```
PRODUCT_COMMERCIAL / COVER (catálogo)
  → PRODUCT_COMPANY (compañía + producto; PRODUCT_COMPANY_ID es parámetro de entrada al flujo)
    → PRODUCT_COMPANY_MODALITY (modalidad comercializada)
    → PRODUCT_COMPANY_COVER (1 fila por cobertura)
      → PRODUCT_COMPANY_COVER_ENTRY (bloques; FILTER_EXPR, HIRING_STATUS_EXPR, VALUE_EXPR, PRODUCT_COMPANY_MODALITY_ID opcional)
        → PRODUCT_COMPANY_COVER_LINES (líneas de texto; FILTER_EXPR, TEXT_EXPR)
```

Todas las expresiones están en **SPEL**, con acceso a los contextos `insurance`
(datos del riesgo/tuning contratado), `tuning` y `covers` — combinables
libremente en un mismo campo, ningún campo está atado a un contexto fijo.

**Semántica ya definida** (ver el `.md` de `knowledge/` para el detalle completo
con ejemplos):

- `HIRING_STATUS_EXPR` tiene 3 valores reales: `INCLUDED`, `NOT_INCLUDED`,
  `OPTIONAL`. A nivel de `PRODUCT_COMPANY_COVER` es un **override manual** del
  estado agregado de sus bloques: si es `NULL`, el estado se calcula agregando
  los bloques (`INCLUDED` si alguno es `INCLUDED`; si no, `OPTIONAL` si alguno es
  `OPTIONAL`; si no, `NOT_INCLUDED`).
- **Granularidad `ENTRY` vs. `LINES`** (antes sin definir): un `ENTRY` se
  corresponde con una condición estructural distinta (típicamente, una
  dependencia extraída en el flujo 2), no con una frase o bullet del Excel; el
  texto explicativo de esa condición se trocea en `LINES`, preferiblemente una
  frase por línea (permite dar a cada frase su propio `FILTER_EXPR`). La hoja
  "Coberturas opcionales" del Excel se modela mayoritariamente como `ENTRY`
  nuevo dentro de la cobertura ya existente.
- `COVER` (catálogo de epígrafes) siempre preexiste por ramo — el flujo 3 nunca
  necesita insertar filas nuevas ahí.
- **Decisión de alcance**: la v1 del flujo 3 se centra en coberturas cuyas
  expresiones no dependen de `covers` (solo `insurance`/`tuning`), porque el
  formato de la respuesta de cada compañía en `covers` es heterogéneo por
  ejecución y aún no está normalizado. Soporte a `covers` queda para una v2.

El flujo 3 (pipeline n8n que genera los INSERT) en sí **sigue sin construirse**
— lo anterior es el modelo de datos/semántica ya aclarado que lo alimentará.

## 4. Arquitectura del pipeline (n8n)

Tres flujos:

1. **`ontology indexing`**: parsea `knowledge/ontologies/*.md` (nodo `Ontology
   Splitter`) e indexa cada concepto en Qdrant (nodo `Build Qdrant Point` +
   `Upsert en Qdrant`), colección `insurance_ontology`. Incluye ya el campo
   `negative_aliases` (ver 5.3).
2. **`coverage rules extraction GGCC`** (foco del trabajo hecho hasta ahora):
   extrae del condicionado las dependencias de cada cobertura respecto a los
   datos del riesgo.
3. **Generación de INSERTs** (sin construir todavía): a partir de 1+2, genera
   primero un JSON revisable por humano y después las sentencias INSERT. El
   modelo de datos/semántica que alimentará este flujo ya está definido (ver
   sección 3 y `knowledge/Modelo comparativa de coberturas - AI ready.md`).

### 4.1 Flujo 2 — topología actual

Tras aplicar las fases descritas en la sección 5, la topología real desplegada
en n8n es:

```
On form submission → Convert → ast walker → cleanup → Hierarchy Builder
  → Semantic Assembler
  → Ontology Embedding Builder → Split Out → Debug Filter
  → Legal Cue Pre-Filter
  → Rule Chunker → Explode Chunks By Semantic Unit
  → Generate chunks embeddings (Ollama, por chunk) → Merge chuncks with embeddings
  → Qdrant Search → Merge
  → Ontology Relevance Filter (por chunk, con negative_aliases)
  → Regroup Chunks By Semantic Unit
  → Coverage Dependency Candidate Detector → Should call llm filter
  → Prepare Dependency Extractor Input → Loop Over Items
  → Coverage Dependency Extractor (LLM + Structured Output Parser1) → Wait → (loop)
  → Merge Dependency Extractor Results
  → Coverage Dependency Risk Field Guardrail
  → Build Coverage Dependency Artifact → Build Coverage Matcher Contract
  → Generate file name → Convert to File → Read/Write Files from Disk
```

(Rama huérfana `Extract from File → clean data` sigue sin salida — legacy, ignorar.)

**Qué hace cada nodo relevante (solo lo no obvio por el nombre):**

- **Semantic Assembler**: recorre el árbol jerárquico que produce Docling sobre el
  PDF y consolida `text`/`paragraph`/`list_item` consecutivos en un único bloque
  ("semantic unit"), cortando solo cuando aparece un `section_header` nuevo.
  Normaliza espacios en blanco colapsando cualquier secuencia (incluidos saltos de
  línea) a un solo espacio. **Efecto secundario conocido y no corregido**: al
  perderse los saltos de línea originales, `Rule Chunker` no puede detectar
  bullets reales en unidades largas sin marcadores `-`/`•` explícitos (ver 5.9).
- **Ontology Embedding Builder**: construye un `embedding_text` enriquecido, pero
  **sigue sin usarse**: el nodo de embeddings llama con `chunk.text` a secas.
  Ineficiencia menor conocida, no urgente.
- **Legal Cue Pre-Filter**: gate barato (solo regex, sin llamadas externas) que
  descarta unidades sin ningún indicio léxico de condición/límite/exclusión antes
  de gastar embeddings + Qdrant. Reutiliza literalmente el mismo `cueDefinitions`
  que `Coverage Dependency Candidate Detector` — garantía formal: ninguna unidad
  que hoy pasa el gate real (`shouldCallLLM`) puede ser descartada aquí, porque
  las 4 ramas de `shouldCallLLM` requieren `cueMatches.length > 0`.
- **Rule Chunker**: corre justo después del pre-filtro, antes del matching
  ontológico. Subdivide el texto de la unidad en chunks (por bullets vía
  `splitBullets`, o por frase vía `splitIntoSentences`/`isStandaloneLegalBullet`),
  propaga la unidad original completa (`semantic_unit`) para que el detector de
  cues pueda seguir operando sobre el texto íntegro más adelante.
- **Explode Chunks By Semantic Unit / Regroup Chunks By Semantic Unit**: explota
  un item por chunk antes del matching ontológico, y reagrupa después. `Regroup`
  calcula `unit_ontology_matches` (unión deduplicada por `concept_id`, máx. 5) —
  se usa **únicamente** como gate de `Candidate Detector`, no como lo que ve el
  LLM (eso es el `ontology_matches` acotado por chunk).
- **Ontology Relevance Filter**: alias-matching por `.includes()` sobre
  `chunk.text` (no la unidad completa — evita contaminación de contexto entre
  cláusulas no relacionadas del mismo bloque). Soporta `negative_aliases` con una
  ventana de proximidad de 80 caracteres: un alias solo se suprime si **todas**
  sus apariciones están cerca de una frase de `negative_aliases` (si aparece
  también en un uso legítimo lejano, se conserva).
- **Coverage Dependency Candidate Detector**: detecta cues por regex y decide si
  merece la pena llamar al LLM. El gate sigue usando el agregado por unidad
  (`unit_ontology_matches`), equivalente al criterio original.
- **Prepare Dependency Extractor Input**: construye el payload final para el LLM
  (una llamada por semantic unit, con todos sus chunks juntos). Cada chunk lleva
  su propio `ontology_matches` acotado; el agregado de unidad se expone como
  `unit_ontology_matches` (solo debug) — así la instrucción del prompt ("usa
  únicamente risk_field presentes en ontology_matches") apunta de forma natural
  al listado por chunk.
- **Coverage Dependency Extractor**: nodo de chat con Anthropic (`claude-haiku-4-5`)
  + prompt extenso con anti-patrones explícitos (no inventar `risk_field`, no
  confundir objeto de la cobertura con condición, few-shot contrastado de
  "continente", regla de compatibilidad operador/`data_type`) +
  `Structured Output Parser1` forzando el esquema `{risk_field, operator, value,
  evidence}`.
- **Coverage Dependency Risk Field Guardrail**: valida cada dependencia devuelta
  por el LLM contra (a) el catálogo real de `risk_field` de la ontología, y (b)
  la compatibilidad entre `operator` y el `data_type` real de ese `risk_field`
  (`integer` → solo comparación numérica; `enum` → `=`/`!=`/`IN`/`NOT_IN`;
  `boolean` → `=`/`!=`). Las dependencias inválidas van a `rejected_dependencies`
  (visibilidad, no descarte silencioso); las válidas pero no presentes en el
  `ontology_matches` de esa llamada concreta van a `ungrounded_dependencies`.
- **Build Coverage Dependency Artifact / Build Coverage Matcher Contract**: montan
  el JSON de salida final, propagando `rejected_dependencies`/
  `ungrounded_dependencies` y sus contadores agregados. `source_text` se
  reconstruye como `chunks.map(c => c.text).join("\n\n")` — no es el texto
  original del PDF tal cual, es la unión de los chunks ya procesados.

## 5. Historial de mejoras aplicadas

Se ejecutó un plan de 6 fases para corregir la extracción de dependencias,
validado con Node.js real antes de tocar n8n, y confirmado end-to-end con
**4 ejecuciones completas reales** sobre el condicionado de Generali Hogar.

### 5.1 Golden set y arnés de evaluación offline

`evaluators/coverage_dependency_extractor/`: `golden_dataset.json` (18 casos
reales: falsos positivos, alucinaciones, casos correctos de referencia, límites
de chunking), `valid_risk_fields.json`, `run_offline_eval.js` (extrae el código
real de cada nodo del JSON del workflow — nunca mantiene una copia duplicada
que se desincronice). Checks: `--chunking`, `--hallucination`, `--ontology`,
`--chunk-matching`, `--cost-prefilter`. Este arnés debe ampliarse con cada
hallazgo nuevo y ejecutarse antes de cualquier cambio futuro en estos nodos.

### 5.2 Guardrail post-LLM contra `risk_field` inválidos o mal tipados

Nodo `Coverage Dependency Risk Field Guardrail` (ver 4.1). Confirmado en
producción (4 ejecuciones reales) que cazó tanto `risk_field` inventados
(`property_use`, `property_type`) como varios casos recurrentes de campo válido
pero con operador incompatible con su `data_type` (`specialValueObjects NOT_IN
[...]`, `content IN [...]`, `rooms NOT_IN [...]`) — este último tipo de error
apareció en clausulas puramente definitorias ("se entenderán por cosas muebles
..."), el mismo antipatrón "objeto de la cobertura" que el prompt ya prohibía,
pero que el LLM seguía generando ocasionalmente con un campo válido.

### 5.3 Ontología: consolidación, alias y falsos amigos

`ontology-home.md` consolidado a 25 conceptos únicos (se fusionaron los bloques
duplicados `housingUse`/`isMainResidence` y `alarm`/`hasAlarm`, que compartían
`risk_field` con `data_type` contradictorio). Se añadieron a `housingUse` los
alias "vivienda principal"/"vivienda secundaria" (la frase real del PDF que
antes no tenía alias y forzaba al LLM a inventar `risk_field` o reutilizar
`content` incorrectamente — corregido y confirmado en 6+ unidades reales).
Nuevo campo `negative_aliases` para `housingRegime` ("comunidad de
propietarios", "junta de copropietarios") y `lastReformYear` ("cláusula de
renovación"), consumido por `Ontology Relevance Filter` con ventana de
proximidad (ver 4.1) — evita el falso negativo de suprimir un alias que
también aparece en un uso legítimo en el mismo texto. Few-shot contrastado de
"continente" (objeto dañado vs. condición de capital) añadido al prompt del LLM.

### 5.4 Chunking de prosa densa

`isStandaloneLegalBullet` (en `Rule Chunker`) ahora cuenta tipos de cue
**distintos** (reutilizando `detectAllCues`, ya existente en el mismo nodo): con
≤1 tipo sigue como bloque único (comportamiento original); con ≥2 tipos, delega
en división por frase. Cambio quirúrgico, sin reescribir el chunker.

### 5.5 Matching ontológico a nivel de chunk

Aplicado en n8n (antes diseñado y validado solo offline, nunca desplegado):
nodos nuevos `Explode Chunks By Semantic Unit` / `Regroup Chunks By Semantic
Unit`, `Ontology Relevance Filter` opera por chunk (ver 4.1). Confirmado con
test de integración real: en la unidad de "continente"/regla proporcional, el
párrafo introductorio (sin relación con capitales) queda con 0
`ontology_matches`, mientras que el párrafo de la excepción real sí los recibe.

### 5.6 Reordenación por coste

Nodo `Legal Cue Pre-Filter` (ver 4.1), con la garantía formal descrita ahí.
Validado offline contra las 86 unidades reales con dependencias de las 4
ejecuciones disponibles: 0 violaciones.

### 5.7 Resultado de los 3 casos originales (antigua sección 5.1)

- **su_00161** (`propietario`/`housingRegime` vs. "comunidad de propietarios"):
  **resuelto** — el `negative_alias` suprime el falso match; en producción la
  unidad ya ni siquiera llega a llamar al LLM.
- **su_00196** (`renovación`/`lastReformYear` vs. "cláusula de renovación"):
  **resuelto** — confirmado en 2 ejecuciones reales, sin volver a aparecer.
- **su_00233** (`continente` con doble sentido, objeto vs. condición de
  capital): **mejorado, no resuelto del todo**. El chunking ahora separa el
  párrafo introductorio de la excepción real, pero el objeto-dañado y la
  condición-de-capital siguen dentro de la **misma frase** gramatical (unidos
  por "cuando"), así que ningún split por frase los separa. La dependencia
  extraída (`continent > 0`) sigue sin capturar el matiz completo (capital
  correcto + revalorización automática activa) — eso exigiría condiciones
  compuestas (AND), fuera del esquema actual por decisión deliberada (ver 5.8).
  Solo ~2.5% de las dependencias reales (1 de 39 en una ejecución muestreada)
  necesitan este tipo de condición compuesta — no se considera prioritario.

### 5.8 Decisión de alcance: esquema rico descartado

Existe (sin conectar al pipeline real) una rama de diseño más rica en
`contracts/legal_rule_extractor/`, `policies/legal_rule_extractor/`,
`prompts/legal_rule_extractor/`, `evaluators/legal_rule_extractor/` y
`fewshots/legal_rule_extractor/`, con un esquema `legal_effects` que sí soporta
`effect_type`, `confidence`, condiciones compuestas (`conditions[]`) y `scope`.
**Decisión tomada**: no migrar a ese esquema. El esquema real y estrecho
(`risk_field`/`operator`/`value`/`evidence`) se mantiene porque el flujo 3
(generación de INSERTs) no está diseñado todavía — no se sabe si necesitaría
condiciones compuestas en ese formato exacto — y el caso que las necesitaría
(continente) es minoritario. Esa rama queda como exploración no aplicada; sus
`concept_id` sintéticos no coinciden con la ontología real.

### 5.9 Limitaciones conocidas, no resueltas (fuera de alcance)

- **Colapso de bullets en `Semantic Assembler`**: al normalizar saltos de línea
  a un solo espacio, `Rule Chunker` pierde la capacidad de detectar bullets
  reales en unidades largas sin marcadores explícitos. Ejemplo real: la unidad
  de exclusiones de `su_00196` se queda en 1 solo chunk en producción, aunque
  una reconstrucción manual de los separadores originales (hecha en su día para
  validar el punto 1 offline) sugería que podría dividirse en hasta 17. No
  afecta a la corrección de las dependencias ya extraídas, solo a la
  granularidad del chunking.
- **Normalización de valores**: inconsistencias menores entre ejecuciones en
  los valores extraídos (mayúsculas: "vivienda principal" vs. "Vivienda
  principal"; uso de `IN`/`NOT_IN` con lista de 1 elemento en vez de `=`/`!=`).
  Ambas formas son funcionalmente equivalentes para un motor de reglas, pero no
  son deterministas de una ejecución a otra. No bloqueante.

## 6. Backlog priorizado

1. **[Resuelto]** Granularidad bloque/línea (`PRODUCT_COMPANY_COVER_ENTRY` vs.
   `PRODUCT_COMPANY_COVER_LINES`): `ENTRY` = condición estructural distinta,
   `LINES` = texto explicativo (preferiblemente una frase por línea). Definido
   en `knowledge/Modelo comparativa de coberturas - AI ready.md` (rama
   `covers_flow`, sin PR abierta todavía).
2. **[Parcialmente cubierto]** Convenciones SPEL (`HIRING_STATUS_EXPR`,
   `VALUE_EXPR`, `TEXT_EXPR`): semántica y enum de `HIRING_STATUS_EXPR`
   confirmados (ver sección 3 y knowledge/...), con ejemplos ilustrativos
   aportados directamente por el usuario, no extraídos aún de INSERTs reales en
   producción. Sigue pendiente: confirmar con un ejemplo real de producción si
   `VALUE_EXPR` se deja `NULL` (hipótesis actual) o usa algún placeholder cuando
   el bloque no tiene valor propio que mostrar.
3. **[Sin empezar]** Diseñar el flujo 3 (pipeline n8n): generación de INSERTs
   con un JSON intermedio revisable por humano. El modelo de datos/semántica que
   lo alimentará ya está definido (puntos 1-2 de este backlog); decisión de
   alcance ya tomada: v1 sin soporte a `covers` (formato de respuesta de
   compañía heterogéneo por ejecución, sin normalizar todavía) — solo
   productos/coberturas cuyas expresiones dependen únicamente de
   `insurance`/`tuning`.
4. **[Opcional, menor]** Normalizar valores extraídos (mayúsculas, `IN` de 1
   elemento vs. `=`) antes de persistir, si se detecta que afecta a la
   generación de SQL/SPEL (ver 5.9).
5. **[Opcional, menor]** Preservar separadores de bullet/salto de línea en
   `Semantic Assembler` para que `Rule Chunker` pueda subdividir mejor prosa con
   listas largas (ver 5.9) — solo si aparecen más casos como `su_00196` que lo
   necesiten de verdad.

## 7. Forma de trabajo acordada

- **Nodos de código puro** (sin llamadas HTTP: `Rule Chunker`, `Legal Cue
  Pre-Filter`, la parte de alias-matching de `Ontology Relevance Filter`,
  `Candidate Detector`, `Explode`/`Regroup Chunks By Semantic Unit`,
  `Prepare Dependency Extractor Input`, el `Guardrail`, los `Build...`, etc.):
  validar la lógica offline con Node.js real (o con
  `evaluators/coverage_dependency_extractor/run_offline_eval.js`) sobre texto de
  ejemplo del condicionado, **antes** de tocar nada en n8n. Rápido, sin coste
  de créditos de IA.
- **Nodos con llamadas externas** (embeddings, Qdrant, el LLM extractor): usar
  el golden set de `evaluators/coverage_dependency_extractor/golden_dataset.json`
  pineado justo antes del paso caro, para no reprocesar el documento completo en
  cada iteración.
- **Entrega de cambios**: el código del nodo concreto a pegar en su editor (o vía
  API de n8n, parcheando el JSON), no el fichero completo del workflow — salvo
  cambios estructurales grandes que añadan/quiten nodos y recableen conexiones.
- **Despliegue vía API (práctica ya probada)**: antes de cualquier `PUT`,
  comprobar por `GET` que el workflow en n8n coincide con la versión local (para
  no sobrescribir cambios hechos fuera de este repo, p. ej. desde la UI). El
  `PUT` solo acepta `{name, nodes, connections, settings}` — `settings` solo
  admite `executionOrder` (rechaza `binaryMode` y otros campos que sí trae el
  export completo). Verificar siempre con un segundo `GET` tras el `PUT` que el
  código desplegado coincide byte a byte con el local.
- **Acceso a n8n**: vía su API REST pública (`X-N8N-API-KEY`), no vía MCP — no hay
  conector oficial de n8n en el directorio de Anthropic a día de hoy. Variables de
  entorno esperadas:
  ```
  N8N_API_URL=http://<host>:<puerto>/api/v1
  N8N_API_KEY=<tu api key de Settings > n8n API>
  ```
  **Ya están rellenas en `.env` en la raíz del proyecto** (gitignored, no commitear).
  Antes de pedirlas al usuario, cargar con `set -a; source .env; set +a`.
  Nota: la API pública de n8n permite leer/actualizar workflows completos y lanzar
  ejecuciones, pero no parece tener una operación de "ejecutar solo un nodo" — eso
  sigue siendo función de la UI (pin data). Confirmar en
  `docs.n8n.io/connect/n8n-api/api-reference` si hace falta más granularidad.
- **Ejecución del flujo**: No debes ejecutar el flujo de n8n en ningún caso. Cuando sea necesario probar, avísame y lo ejecutaré yo manualmente. Después podrás leer el resultado si es necesario. Esta regla es independiente de cuánta autonomía se te dé para el resto de pasos (editar ficheros, desplegar por API, ejecutar el arnés offline) — nunca se extiende a disparar una ejecución real.

## 8. Glosario rápido

- **Ramo**: línea de negocio de seguros (Hogar, Auto, Vida...).
- **Tuning**: pantalla donde el usuario ajusta la oferta de una compañía concreta.
- **Comparativa de coberturas**: informe generado en tiempo de ejecución, motor SPEL.
- **Semantic unit**: bloque de texto consolidado por `Semantic Assembler`.
- **Chunk**: subdivisión más fina de una semantic unit (por bullet o frase),
  producida por `Rule Chunker`.
- **ontology_matches**: candidatos de campos de riesgo (de la ontología en Qdrant)
  relevantes para un chunk dado (antes de la Fase 5.5, era por semantic unit
  completa).
- **unit_ontology_matches**: unión deduplicada de los `ontology_matches` de todos
  los chunks de una unidad; solo se usa como gate de `Candidate Detector`, no
  como lo que ve el LLM.
- **Falso amigo (léxico)**: palabra que coincide como alias de un concepto de la
  ontología pero que en ese contexto tiene un significado distinto no relacionado.
- **negative_alias**: frase asociada a un concepto de la ontología que, si
  aparece cerca de un alias, invalida ese match concreto (mecanismo para
  falsos amigos deterministas).
- **Guardrail**: nodo post-LLM que rechaza dependencias con `risk_field` fuera
  de catálogo o con operador incompatible con el `data_type` real del campo.
- **Golden set**: conjunto fijo de casos reales (correctos e incorrectos) usado
  para validar offline los nodos de código antes de desplegar en n8n; vive en
  `evaluators/coverage_dependency_extractor/`.
