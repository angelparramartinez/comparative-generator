# Prompt: adaptar Excel de coberturas de una compañía al formato de "Coberturas por modalidad"

Prompt reutilizable para pegar en un agente nuevo (sin contexto previo de este
proyecto) junto con el Excel bruto que entrega una compañía de seguros de
Hogar. Genera el CONTENIDO de las hojas objetivo — no escribe en Google
Sheets, solo produce las tablas para pegar a mano.

Rellena los parámetros de la sección "INPUTS" antes de usarlo.

---

## Contexto

Trabajo para un proyecto de seguros (ramo Hogar) que genera comparativas de
coberturas. Existe un Google Sheet de referencia ya en producción (compañía
Generali) con dos pestañas:

- **"Coberturas por modalidad"**: columna A = `COVER_ID` (código numérico de
  la cobertura), columna B = nombre de la cobertura, y una columna por cada
  modalidad comercial real de la compañía (identificada por su
  `PRODUCT_COMPANY_MODALITY_ID`, un entero). Cada celda de modalidad contiene
  texto libre con los bullets ("• ...") de lo que cubre esa cobertura en esa
  modalidad concreta.
- **"Coberturas opcionales"**: columna `COVER_ID` (a qué cobertura ya
  existente se añade el texto), columna "Cobertura opcional" (nombre visible
  de ese texto adicional), columna de texto libre.

Te voy a pasar el Excel bruto de una compañía nueva con esta misma
información, pero en el formato propio de esa compañía (nombres de pestaña,
columnas y convenciones distintos). Tu tarea es producir el contenido
equivalente a esas dos pestañas, sin escribir en ningún sitio — solo generar
las tablas en tu respuesta, listas para copiar y pegar a mano en el Google
Sheet real.

## Novedad importante: condiciones por uso/ocupación de la vivienda (u otro eje)

Algunas compañías (a diferencia de Generali) distinguen el texto de una
cobertura no solo por modalidad comercial, sino también por otra dimensión
del riesgo — por ejemplo, uso de la vivienda (principal/secundaria/vacía) u
ocupación (propietario/inquilino/destinada a alquiler), o cualquier otro eje
que aparezca (tipo de vivienda, etc.).

Cuando eso ocurra, **no crees columnas nuevas para esas combinaciones** — la
columna de modalidad debe seguir representando solo la modalidad comercial
real. En su lugar, marca la condición **al final del bullet concreto al que
afecta**, con un marcador de doble corchete:

```
• Texto del bullet tal cual lo redacta la compañía. [[condición en las palabras propias de la compañía]]
```

Reglas del marcador:

- Va **siempre al final de la línea/bullet**, nunca en medio.
- El texto dentro de `[[...]]` se mantiene en el **idioma y redacción
  original de la compañía** (no lo traduzcas, no lo normalices a un código
  ni inventes un vocabulario propio) — ejemplos reales ya vistos: `[[sólo
  para inquilinos]]`, `[[no en uso alquiler]]`, `[[solo en vivienda
  habitual]]`, `[[sólo para unifamiliares]]`.
- Un bullet sin condiciones no lleva marcador — se entiende que aplica
  siempre en esa modalidad.
- Si un mismo bullet tiene más de una condición independiente, sepáralas
  dentro del mismo doble corchete tal como las redacte la compañía (no
  inventes una sintaxis de AND/OR propia).
- Si un bullet contiene **varias frases y la condición solo afecta a una de
  ellas** (no a todo el bullet), no dejes el marcador ambiguo al final de
  todo el bullet: **parte el bullet en líneas separadas, una por frase**, y
  pon el marcador solo en la frase a la que realmente corresponde. Ejemplo
  real: `"Robo, expoliación y actos vandálicos dentro de la vivienda.
  Sublímite dinero efectivo 300€. [[solo en vivienda habitual]]"` — la
  condición es solo del sublímite de dinero, no del robo/expoliación en
  general, así que debe quedar como dos bullets:
  ```
  • Robo, expoliación y actos vandálicos dentro de la vivienda.
  • Sublímite dinero efectivo 300€. [[solo en vivienda habitual]]
  ```
  Esto es intencional y coherente con el modelo de datos del proyecto: cada
  frase debe poder llevar su propia condición de forma independiente. Si
  tienes dudas de si una condición afecta a todo el bullet o solo a la
  última frase, contrástalo contra las hojas específicas/resueltas si el
  Excel las trae (ver más abajo); si no las trae, señala la duda en
  "Pendiente de revisión" en vez de decidir a ciegas.

### Si la compañía ya da una hoja "general" con las condiciones ya anotadas

Si el Excel de la compañía trae una pestaña que consolida todas las
combinaciones en un solo texto por modalidad, marcando ya las excepciones
(con corchete simple, colores, notas al pie, lo que sea), úsala como fuente
directa: solo tienes que **normalizar su marcador propio al `[[...]]`**
canónico, sin tocar el contenido de la condición.

**Si además el Excel trae hojas específicas/resueltas por combinación**
(redundantes con la general, típicamente para validación), **haz una
verificación cruzada antes de dar la hoja general por buena a ciegas**: para
cada bullet marcado en la general, comprueba en qué subconjunto de hojas
específicas aparece ese mismo bullet sin marcador, y confirma que coincide
con la condición anotada. Si encuentras una discrepancia (el bullet aparece,
o falta, en una hoja específica de forma inconsistente con lo que dice el
marcador de la general, o hay una diferencia de contenido entre ambas
fuentes — un importe distinto, un tramo de más o de menos, etc.):

- **No la reconcilies tú ni decidas cuál de las dos fuentes tiene razón.**
- Deja el texto de la hoja general tal cual (es la fuente elegida para
  construir la salida), pero **añade el caso a "Pendiente de revisión"**
  describiendo exactamente qué hojas discrepan y en qué, para que un humano
  lo resuelva con la compañía.

### Si la compañía NO da una hoja general, solo hojas separadas por combinación

Si en vez de eso la compañía reparte el contenido en varias pestañas (una
por cada combinación de uso/ocupación/etc., cada una con su propio texto ya
"resuelto" para ese caso), tienes que **reconstruir tú la versión
consolidada**:

1. Para cada `(COVER_ID, modalidad)`, compara el bullet a bullet entre todas
   las pestañas de esa combinación.
2. Un bullet presente literalmente igual en TODAS las pestañas → va sin
   marcador en la versión consolidada.
3. Un bullet presente solo en un subconjunto de pestañas → va con
   `[[...]]`, describiendo en lenguaje natural a qué subconjunto pertenece
   (usa el nombre de la propia pestaña/combinación como base del texto de
   la condición, no inventes un código).
4. Si el subconjunto no se puede describir de forma limpia con una sola
   condición (p. ej. aparece en 2 de 5 pestañas sin patrón claro), no
   fuerces una descripción — márcalo como
   `[NEEDS REVIEW: <descripción del patrón encontrado>]` en vez de
   inventar una condición.

## Qué ignorar del Excel bruto

Las compañías suelen incluir columnas de referencia interna que no forman
parte del modelo de datos objetivo: texto legacy/versión anterior, contadores
de longitud de texto, notas internas, etc. Ignóralas — solo te interesan:
`COVER_ID`, nombre de cobertura, y las columnas que representen modalidades
comerciales reales (o combinaciones a resolver según el punto anterior). Si
no tienes claro si una columna es una modalidad real o una columna de
referencia, pregúntamelo antes de asumir.

## Qué NO hacer

- No toques nada de n8n, no generes SPEL ni `FILTER_EXPR` — eso lo hace
  después otro paso del pipeline a partir de estos textos. Tu única salida
  es el contenido de las dos pestañas.
- No traduzcas ni resumas el texto de la compañía — transcríbelo literal
  (permite conservar tildes, mayúsculas, etc. tal cual).
- No elimines un bullet solo porque aparezca en pocas modalidades o
  combinaciones — represéntalo con su marcador, no lo omitas.
- No reordenes las filas de `COVER_ID` respecto al orden del Excel original.
- No inventes un `COVER_ID` que no exista en el Excel de la compañía.

## Formato de salida esperado

Dos tablas (una por pestaña), en formato tabulado/markdown listo para
copiar y pegar en Google Sheets:

**Coberturas por modalidad**

| COVER_ID | Nombre cobertura | `<MODALITY_ID_1>` | `<MODALITY_ID_2>` | ... |
|---|---|---|---|---|

**Coberturas opcionales** (solo si el Excel de la compañía trae algo
equivalente)

| COVER_ID | Cobertura opcional | Texto |
|---|---|---|

Si algo queda sin resolver, añade al final una sección "Pendiente de
revisión" listando cada caso con el motivo, en vez de forzar una respuesta.

---

## INPUTS (rellenar antes de usar el prompt)

- **Compañía**: `<nombre>`
- **Ruta/adjunto del Excel bruto**: `<ruta>`
- **Modalidades comerciales reales y su ID**: `<ej. 5105=Estándar,
  5106=Completo, 5107=Superior>`
- **Nombre de la hoja general/consolidada, si existe**: `<nombre de pestaña
  o "no existe, hay que reconstruir de las hojas separadas">`
- **Otras hojas relevantes** (coberturas opcionales, etc.): `<nombres>`
