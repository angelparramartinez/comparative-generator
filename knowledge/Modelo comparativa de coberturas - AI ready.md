# Modelo de la comparativa de coberturas (Versión AI-Ready)

---

# 1. Objetivo del modelo

Este modelo define cómo construir la **comparativa de coberturas** de un producto asegurador.

El objetivo es:

- Definir qué coberturas se muestran.
- Definir qué bloques componen cada cobertura.
- Definir qué líneas de texto se muestran.
- Calcular el estado visual de cada cobertura.
- Generar el contenido visible dinámicamente.

La información mostrada se construye a partir de:

1. Definición en base de datos.
2. Datos del riesgo (`insurance`).
3. Valores seleccionados en tuning (`tuning`).
4. Respuesta de la compañía (`covers`).

---

# 2. Modelo conceptual

Una cobertura se compone de bloques.

Cada bloque se compone de líneas.

    Cobertura (PRODUCT_COMPANY_COVER)
    │
    ├── Bloque (PRODUCT_COMPANY_COVER_ENTRY)
    │     ├── Línea (PRODUCT_COMPANY_COVER_LINES)
    │     ├── Línea
    │     └── Línea
    │
    ├── Bloque
    │     ├── Línea
    │     └── Línea
    │
    └── Bloque
          └── Línea

---

# 3. Tablas implicadas

Las siguientes tablas definen la comparativa.

---

## 3.1 PRODUCT_COMMERCIAL

Define los ramos de seguros.

    SELECT ID, DESCRIPTION, NAME 
    FROM PRODUCT_COMMERCIAL
    WHERE DELETION_DATE IS NULL 
    AND COMPARABLE = 1;

---

## 3.2 COVER

Define los epígrafes o coberturas.

Catálogo preexistente por ramo: el `COVER_ID` que trae el Excel de coberturas
(columna A de "Coberturas por modalidad") **siempre** corresponde a una fila ya
existente en `COVER`. El flujo 3 no necesita insertar filas nuevas en `COVER`.

---

## 3.3 PRODUCT_COMPANY

Define los productos aseguradores.

Relación:

    PRODUCT_COMPANY.PRODUCT_ID → PRODUCT_COMMERCIAL.ID

---

## 3.4 PRODUCT_COMPANY_MODALITY

Define las modalidades del producto.

Las coberturas pueden variar por modalidad.

---

# 4. Definición de comparativa por producto

Se define mediante:

- PRODUCT_COMPANY_COVER
- PRODUCT_COMPANY_COVER_ENTRY
- PRODUCT_COMPANY_COVER_LINES

---

# 5. PRODUCT_COMPANY_COVER (Cobertura)

Relaciona:

    Producto ↔ Cobertura

Campos:

| Campo | Tipo | Descripción |
|------|------|-------------|
| ID | Integer | Identificador único |
| COVER_ID | Integer | ID de COVER |
| PRODUCT_COMPANY_ID | Integer | ID del producto |
| HIRING_STATUS_EXPR | SPEL | Override manual del estado global (ver regla de estado final) |

---

## Reglas obligatorias

1. No puede existir más de un registro con:

    (PRODUCT_COMPANY_ID, COVER_ID)

2. Debe existir al menos un bloque asociado.

---

## Regla de estado final

El `HIRING_STATUS_EXPR` de `PRODUCT_COMPANY_COVER` es un **override manual**:

    Si HIRING_STATUS_EXPR (de la cobertura) == NULL:

        El estado se calcula agregando los bloques, por prioridad:

        Si existe al menos un bloque con HIRING_STATUS_EXPR == INCLUDED:
            Cobertura = INCLUDED
        Si no, si existe al menos un bloque con HIRING_STATUS_EXPR == OPTIONAL:
            Cobertura = OPTIONAL
        En caso contrario:
            Cobertura = NOT_INCLUDED

    Si HIRING_STATUS_EXPR (de la cobertura) != NULL:

        Su valor (una expresión SPEL que debe resolver a INCLUDED / NOT_INCLUDED /
        OPTIONAL) determina el estado directamente, ignorando el agregado de bloques.

El icono ✔️ se muestra si:

    Cobertura == INCLUDED

---

# 6. PRODUCT_COMPANY_COVER_ENTRY (Bloques)

Define los bloques visibles dentro de una cobertura.

## Criterio de granularidad (qué es un bloque)

**Un `ENTRY` no se corresponde con una frase o un bullet del texto libre del
Excel.** Un `ENTRY` se corresponde con **una condición estructural distinta**:

- Si una cobertura no tiene ninguna condición (se incluye siempre, sin depender de
  ningún dato del riesgo/tuning): un único `ENTRY` con `FILTER_EXPR = NULL` y
  `HIRING_STATUS_EXPR = "INCLUDED"`. Este es el caso por defecto para los bullets
  de la hoja "Coberturas por modalidad" sin dependencia asociada (a diferencia de
  "Coberturas opcionales", cuyo default es `OPTIONAL` — ver más abajo). Nota: se
  ha visto texto literal "Garantía Opcional" en algunas celdas de esa misma hoja
  (`COVER_ID` 79/81) — de momento se trata igual que el resto (default
  `INCLUDED`), pendiente de revisar si conviene detectarlo como caso especial.
- Si el texto de la cobertura describe una condición estructural (típicamente, una
  dependencia extraída en el flujo 2 — un `risk_field`/`operator`/`value`, p. ej.
  "solo si es vivienda principal"): esa condición es su propio `ENTRY`, con su
  `FILTER_EXPR` y/o `HIRING_STATUS_EXPR` construidos a partir de ella.
- Si el texto describe varias condiciones estructurales distintas (p. ej. una
  inclusión general + una exclusión con condición propia + un límite que depende de
  otro dato): cada una es un `ENTRY` distinto.

El texto explicativo asociado a cada condición (el contenido descriptivo, no la
condición en sí) va en las `LINES` de ese `ENTRY` — ver §7.

### Cómo se emparejan las dependencias del flujo 2 con el `COVER_ID` (matching)

Validado con datos reales (Generali, `ggcc_outputs/coverage_matcher_contract_
2026-07-15T14-05-42-683Z.json` cruzado contra `Plantilla Comparativa Hogar.xlsx`):

- El flujo 2 ya produce, por cada dependencia, un campo `coverage_path`
  (jerarquía interna del propio condicionado, p. ej.
  `["3. Daños por agua", "3.2. Localización y reparación"]`), que suele
  corresponder de forma muy cercana al nombre de cobertura del Excel (columna B)
  y a sus bullets internos. Es la señal principal para el matching — más fuerte
  que el `article` a secas.
- El matching es de **dos niveles**: el nivel raíz de `coverage_path` empareja
  con el `COVER_ID` (la cobertura); el nivel hoja empareja con el **bullet
  concreto** dentro del texto libre de esa cobertura en el Excel. Un mismo
  `COVER_ID` puede recibir varias dependencias distintas (una por bullet) — no
  deben fusionarse en una sola condición para toda la cobertura (ver ejemplo real
  de `COVER_ID 18` "Daños por agua": `su_00016` → bullet "Localización y
  reparación", `su_00017` → bullet "Fontanería sin daños", cada uno su propio
  `ENTRY`).
- El matching no puede basarse solo en la etiqueta estructural (`article`/
  `coverage_path`) — hay que verificar el `evidence`/`source_text` real contra
  el texto real del Excel (caso real detectado: una unidad bajo "Artículo 9º
  Asistencia" resultó ser sobre control de plagas, y encajaba con `COVER_ID`
  104 vía la hoja de opcionales, no con la cobertura de asistencia que sugería
  el título).
- **No todas las dependencias tienen un `COVER_ID` al que emparejar** — dos
  motivos distintos, ambos legítimos, ninguno debe forzarse a un match:
  - La garantía descrita en el condicionado no está comercializada en este
    Excel/producto concreto (el condicionado cubre el catálogo completo de la
    aseguradora; el Excel solo lo que se vende en este producto). Confirmado
    con casos reales: paquetes "Ampliación Hogar completo/singular" y toda la
    línea de vivienda arrendada no aparecen en ningún sitio del Excel.
  - La dependencia es una regla general de la póliza (p. ej. reglas de
    tasación/indemnización), no ligada a ninguna cobertura concreta.
- La hoja "Coberturas opcionales" no necesita este matching: ya trae una
  columna `EPÍGRAFE EN EL QUE SE DEBE INCLUIR` con el nombre exacto de la
  cobertura — es un join directo por nombre, no un problema de matching.

### Coberturas opcionales (hoja aparte del Excel)

La hoja "Coberturas opcionales" de `Plantilla Comparativa Hogar.xlsx` aporta 16
textos adicionales que se insertan dentro de un epígrafe (cobertura) ya existente,
no coberturas nuevas. Depende del caso, pero **en su gran mayoría cada uno de esos
textos es un `ENTRY` nuevo** dentro de la cobertura correspondiente — normalmente
con `HIRING_STATUS_EXPR = OPTIONAL` (o una expresión que resuelva a `OPTIONAL`
según `tuning`), ya que representan algo contratable adicionalmente. Solo cuando el
texto no aporta una condición/estado propio, sino que es contenido descriptivo
adicional de una condición ya existente, se modela como `LINES` extra en un
`ENTRY` ya existente.

Campos:

| Campo | Tipo | Descripción |
|------|------|-------------|
| ID | Integer | Identificador |
| FILTER_EXPR | SPEL | Controla visibilidad |
| HIRING_STATUS_EXPR | SPEL | Estado del bloque |
| ENTRY_ORDER | Integer | Orden visual |
| VALUE_EXPR | SPEL | Valor visual |
| UNIT | Integer | Unidad del valor (FK a tabla de unidades, ver abajo) |
| PRODUCT_COMPANY_MODALITY_ID | Integer | Modalidad opcional |
| PRODUCT_COMPANY_COVER_ID | Integer | FK |

---

### Catálogo de unidades (UNIT)

`UNIT` referencia una tabla en base de datos (`ID`, `NAME`, `SYMBOL`) a la que este
flujo no tiene acceso directo por ahora — no es necesario para lo que estamos
diseñando. Valores conocidos actualmente:

| ID | NAME | SYMBOL |
|----|------|--------|
| 1 | Euros | € |
| 2 | Unidades | NULL |

---

## Evaluación de visibilidad

    Si FILTER_EXPR == false:

        El bloque se elimina completamente.

        No se renderiza.

    Si FILTER_EXPR == true o NULL:

        El bloque se muestra.

---

## Evaluación de estado

Se calcula mediante:

    HIRING_STATUS_EXPR

Valores permitidos:

    INCLUDED       → incluido en la oferta.
    NOT_INCLUDED   → no incluido y no contratable.
    OPTIONAL       → no incluido por defecto, pero se puede contratar.

(Nota: una versión anterior de este documento listaba aquí `NOT_HIRABLE` en vez de
`OPTIONAL`. Corregido: el valor real es `OPTIONAL`.)

---

## Evaluación de valor visual

El contenido visible del bloque se calcula mediante:

    VALUE_EXPR

Este campo:

    No determina el estado lógico.
    Solo determina el valor visual mostrado.

Se utiliza cuando hay un valor real que mostrar junto al bloque — típicamente un
capital asegurado que se obtiene de un dato del riesgo (`insurance`) o del tuning
(`tuning`). Cuando el bloque no tiene un valor propio que mostrar (solo texto en
las líneas), **se deja `NULL`** (pendiente de confirmar con un ejemplo real en
producción — no usar el literal `"true"` como placeholder).

---

## Orden de bloques

    Si ENTRY_ORDER != NULL:

        Orden ascendente.

    Si ENTRY_ORDER == NULL:

        El orden es irrelevante.

---

# 7. PRODUCT_COMPANY_COVER_LINES (Líneas)

Define el texto visible dentro de cada bloque.

## Criterio de granularidad (qué es una línea)

Dentro de un mismo `ENTRY` (una única condición estructural), el texto
explicativo se trocea **preferiblemente una frase por `LINE`** (no todo el
párrafo en una sola `LINE`), por dos motivos:

1. Legibilidad en la comparativa.
2. Una frase concreta podría no tener que mostrarse en determinados casos (tiene
   su propia condición de visibilidad) — trocear por frase permite darle su
   propio `FILTER_EXPR` sin afectar al resto del bloque.

Campos:

| Campo | Tipo | Descripción |
|------|------|-------------|
| ID | Integer | Identificador |
| FILTER_EXPR | SPEL | Visibilidad |
| LINE_ORDER | Integer | Orden |
| TEXT_EXPR | SPEL | Texto visible |
| PRODUCT_COMPANY_COVER_ENTRY_ID | Integer | FK |

---

## Evaluación de visibilidad

    Si FILTER_EXPR == false:

        La línea no se muestra.

    Si FILTER_EXPR == true o NULL:

        La línea se muestra.

---

## Orden de líneas

    Orden ascendente por LINE_ORDER.

---

## Evaluación del texto

El texto visible se calcula mediante:

    TEXT_EXPR

Este campo puede generar texto dinámico.

---

# 8. Contexto disponible en expresiones SPEL

Las expresiones pueden acceder a:

---

## insurance (datos del riesgo)

Ejemplo:

    '• Fallecimiento por accidente (Doble capital). Capital contratado: ' 
    + insurance['risk'].insuredAccidentDeathCapital 
    + "€."

---

## tuning (valores seleccionados)

Ejemplo:

    ' Capital: ' + 
    (tuning?.permanentDisabilityChecked == True 
     ? tuning?.permanentDisabilitySumInsured + ' €.' 
     : "")

---

## covers (respuesta de la compañía)

Ejemplo:

    covers['90'].getCoverName() + 
    (covers['90'].getCapital() > 0 
     ? '. Capital asegurado: ' 
     + covers['90'].getCapitalAsString() 
     + ' € ' 
     + covers['90'].getHireType() 
     : '. ')

**No hay un catálogo fijo de métodos de `covers[COVER_ID]`.** El objeto y sus
métodos dependen de cómo responde cada compañía a la aplicación que obtiene las
ofertas — formato y estructura distintos en cada caso, y no todas las coberturas
lo tienen. Esta información tendría que facilitarse al flujo en cada ejecución,
con un formato normalizado aún por definir. **Decisión de alcance**: la primera
versión del flujo 3 se centra en coberturas cuyas expresiones (`FILTER_EXPR`,
`HIRING_STATUS_EXPR`, `VALUE_EXPR`, `TEXT_EXPR`) dependen solo de `insurance`/
`tuning` y no necesitan `covers`; el soporte a `covers` (con su formato de entrada
por ejecución) queda para una segunda versión.

---

## Combinación libre de contextos

`FILTER_EXPR`, `HIRING_STATUS_EXPR` y `VALUE_EXPR` (y también `TEXT_EXPR` en las
líneas) **no están atados cada uno a un contexto fijo**: cualquiera de ellos puede
referenciar `insurance`, `tuning` y/o `covers`, y una misma expresión puede combinar
varios a la vez. No hay una regla de "FILTER_EXPR es siempre insurance" o
"HIRING_STATUS_EXPR es siempre tuning/covers".

### Ejemplo completo 1 — condición estructural del riesgo

    FILTER_EXPR         = insurance["risk"].housingUse == "MainResidence"
    HIRING_STATUS_EXPR  = "INCLUDED"
    VALUE_EXPR           = NULL

Si la vivienda es residencia principal: el bloque es visible y su estado es
`INCLUDED`. Si no lo es: `FILTER_EXPR` es `false`, el bloque se elimina
completamente (no visible), y por tanto no aporta ningún estado `INCLUDED` al
agregado de la cobertura (§5).

**Convenciones de valor confirmadas (20/07):** el `risk_field` es el que usa
`knowledge/ontologies/ontology-home.md` (`housingUse`, no `occupancy` — hay
varios campos duplicados/alias entre la ontología y
`knowledge/risks/datos_riesgo_hogar.json`, cualquiera de los dos nombres es
accesible en `insurance.risk`, pero para no romper nada se mantienen los de la
ontología). El valor de un enum es su texto en **inglés** con el casing exacto
del catálogo (`MainResidence`, no `mainresidence` ni el código numérico) — el
flujo 2 extrae el texto libre en **español** del condicionado, así que hace
falta un paso de traducción antes de generar este `FILTER_EXPR`; ver
`evaluators/coverage_insert_generator/value_matcher.js` (catálogo de alias por
valor, validado offline con casos reales).

### Ejemplo completo 2 — cobertura opcional contratable vía tuning

    FILTER_EXPR         = NULL
    HIRING_STATUS_EXPR  = tuning?.naturalPhenomena != null && tuning.naturalPhenomena
                           ? "INCLUDED"
                           : "OPTIONAL"
    VALUE_EXPR           = NULL

El bloque siempre es visible (`FILTER_EXPR` es `NULL`). Su estado depende de si el
tuning tiene marcada la opción: si sí, `INCLUDED`; si no, `OPTIONAL` (se muestra
como contratable, no como excluido).

### Operadores `IN` / `NOT_IN` (dependencias enum del flujo 2)

Corregido 24/07 (bug real detectado probando el motor real de ASM, Spring
SpEL 5.3.39): SpEL **no tiene** operador `in` — la pertenencia a una lista se
expresa como método de colección, `.contains(...)`, y la negación con `!`
delante (sin paréntesis adicionales, `.contains(...)` liga más fuerte que
`!`). Una dependencia `risk_field IN [v1, v2, v3]` (del flujo 2, ya con los
valores traducidos al texto en inglés del enum — ver nota de la sección
anterior) se traduce como:

    {'MainResidence','SecondHome'}.contains(insurance["risk"].housingUse)

Y `NOT_IN` como su negación:

    !{'MainResidence','SecondHome'}.contains(insurance["risk"].housingUse)

---

# 9. Flujo completo de evaluación

La construcción visual sigue este orden:

    1. Obtener cobertura.

    2. Evaluar cada bloque:

        Si FILTER_EXPR == false:
            eliminar bloque

        Si visible:
            evaluar HIRING_STATUS_EXPR
            evaluar VALUE_EXPR

    3. Evaluar cada línea:

        Si FILTER_EXPR == false:
            eliminar línea

        Si visible:
            evaluar TEXT_EXPR

    4. Calcular estado final (ver regla de override en §5):

        Si HIRING_STATUS_EXPR de la cobertura != NULL:
            Cobertura = ese valor (INCLUDED / NOT_INCLUDED / OPTIONAL)

        Si no:
            Si existe bloque INCLUDED:
                Cobertura = INCLUDED
            Si no, si existe bloque OPTIONAL:
                Cobertura = OPTIONAL
            Si no:
                Cobertura = NOT_INCLUDED

    5. Renderizar visualmente.

---

# 10. Convenciones obligatorias

Estas reglas deben cumplirse siempre.

    1. Una cobertura debe tener al menos un bloque.

    2. Un bloque debe tener al menos una línea.

    3. FILTER_EXPR == false elimina el elemento.

    4. VALUE_EXPR es visual.

    5. HIRING_STATUS_EXPR es lógico.

    6. El estado final depende de los bloques.

---

# 11. Reglas de generación de SQL

Esta sección define cómo generar las sentencias SQL necesarias

para construir la definición de una cobertura.

---

## Orden obligatorio de generación

Las sentencias deben generarse en este orden:

    1. PRODUCT_COMPANY_COVER

    2. PRODUCT_COMPANY_COVER_ENTRY

    3. PRODUCT_COMPANY_COVER_LINES

---

## Convenciones confirmadas de generación

- **Envoltorio de expresiones SPEL**: toda expresión SPEL almacenada en un
  campo `_EXPR` (`FILTER_EXPR`, `HIRING_STATUS_EXPR`, `VALUE_EXPR`,
  `TEXT_EXPR`) se envuelve entre `/` y `/` — no solo `TEXT_EXPR`. Ejemplo:
  una condición `insurance["risk"].continent > 0` se almacena literalmente
  como `/insurance["risk"].continent > 0/`.
- **Motor de base de datos**: MySQL. Como los `INSERT` se ejecutan en
  secuencia y cada FK depende del ID autogenerado del `INSERT` anterior
  (`PRODUCT_COMPANY_COVER` → `_ENTRY` → `_LINES`), el encadenado se hace con
  variables de sesión (`SET @cover_id := LAST_INSERT_ID();` tras cada
  `INSERT`, reutilizando la variable en el siguiente).

---

## Paso 1 — Crear la cobertura

Insertar en:

    PRODUCT_COMPANY_COVER

Ejemplo:

    INSERT INTO PRODUCT_COMPANY_COVER 

    (HIRING_STATUS_EXPR, COVER_ID, PRODUCT_COMPANY_ID) 

    VALUES (NULL,13,230);

Después recuperar el ID generado.

---

### Regla de optimización — condición compartida por cobertura

Los `ENTRY` se generan siempre a nivel de bullet/condición individual (ver §6,
"Criterio de granularidad") — nunca se fusionan varios bullets en un único
`ENTRY` solo porque compartan condición.

Si, tras generar todos los `ENTRY` de una cobertura, se detecta que **todos**
comparten exactamente la misma condición (mismo `risk_field`/`operator`/`value`
del flujo 2, traducido al mismo `FILTER_EXPR`) y **ninguno** tiene una condición
adicional distinta, esa condición se traslada al `HIRING_STATUS_EXPR` de
`PRODUCT_COMPANY_COVER` (el override de §5) en vez de repetirse en el
`FILTER_EXPR` de cada `ENTRY`. Los `ENTRY` siguen existiendo por separado (uno
por bullet, cada uno con sus `LINES`), solo se evita duplicar la condición N
veces en el SQL.

Decisión tomada explícitamente: si la cobertura queda `NOT_INCLUDED` por este
override, los `ENTRY`/`LINES` individuales pueden seguir siendo visibles (no se
fuerza `FILTER_EXPR = false` en ellos) — se acepta que el texto se muestre igual,
confiando en que el estado `NOT_INCLUDED` de la cobertura ya deja claro que no
está incluida. Esto evita tener que colapsar todos los bullets en un `ENTRY`
único.

Nota de orden: aunque `PRODUCT_COMPANY_COVER` se inserta primero en el SQL
(necesitamos su ID para las FK de `ENTRY`), su `HIRING_STATUS_EXPR` debe
**calcularse** después de tener claras las condiciones de todos sus `ENTRY` —
es una cuestión de orden de cálculo, no de orden de INSERT.

---

## Paso 2 — Crear los bloques

Insertar en:

    PRODUCT_COMPANY_COVER_ENTRY

---

### Regla especial — Modalidades

Si el bloque aplica a todas las modalidades:

    PRODUCT_COMPANY_MODALITY_ID = NULL

Se debe generar un único registro.

---

Si el bloque aplica a modalidades específicas:

Se debe generar un registro por modalidad.

Ejemplo:

    PRODUCT_COMPANY_MODALITY_ID = 5475

    PRODUCT_COMPANY_MODALITY_ID = 5476

---

### Regla de optimización obligatoria

Si un bloque tiene los mismos valores para todas las modalidades:

    FILTER_EXPR

    HIRING_STATUS_EXPR

    VALUE_EXPR

    UNIT

    Líneas

Entonces:

    PRODUCT_COMPANY_MODALITY_ID = NULL

---

## Paso 3 — Crear las líneas

Insertar en:

    PRODUCT_COMPANY_COVER_LINES

Ejemplo:

    INSERT INTO PRODUCT_COMPANY_COVER_LINES 

    (TEXT_EXPR,PRODUCT_COMPANY_COVER_ENTRY_ID, LINE_ORDER) 

    VALUES 

    (

    '/\'• Texto visible.\'/',

    1199,

    1

    );

Las líneas deben insertarse en orden ascendente.

---

