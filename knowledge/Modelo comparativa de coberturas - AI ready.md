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
| HIRING_STATUS_EXPR | SPEL | Estado global opcional |

---

## Reglas obligatorias

1. No puede existir más de un registro con:

    (PRODUCT_COMPANY_ID, COVER_ID)

2. Debe existir al menos un bloque asociado.

---

## Regla de estado final

El estado final de la cobertura se calcula como:

    Si existe al menos un bloque con:

    HIRING_STATUS_EXPR == INCLUDED

    Entonces:

    Cobertura = INCLUDED

    En caso contrario:

    Cobertura = NOT_INCLUDED

El icono ✔️ se muestra si:

    Cobertura == INCLUDED

---

# 6. PRODUCT_COMPANY_COVER_ENTRY (Bloques)

Define los bloques visibles dentro de una cobertura.

Campos:

| Campo | Tipo | Descripción |
|------|------|-------------|
| ID | Integer | Identificador |
| FILTER_EXPR | SPEL | Controla visibilidad |
| HIRING_STATUS_EXPR | SPEL | Estado del bloque |
| ENTRY_ORDER | Integer | Orden visual |
| VALUE_EXPR | SPEL | Valor visual |
| UNIT | Integer | Unidad del valor |
| PRODUCT_COMPANY_MODALITY_ID | Integer | Modalidad opcional |
| PRODUCT_COMPANY_COVER_ID | Integer | FK |

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

    INCLUDED
    NOT_INCLUDED
    NOT_HIRABLE

---

## Evaluación de valor visual

El contenido visible del bloque se calcula mediante:

    VALUE_EXPR

Este campo:

    No determina el estado lógico.
    Solo determina el valor visual mostrado.

---

## Orden de bloques

    Si ENTRY_ORDER != NULL:

        Orden ascendente.

    Si ENTRY_ORDER == NULL:

        El orden es irrelevante.

---

# 7. PRODUCT_COMPANY_COVER_LINES (Líneas)

Define el texto visible dentro de cada bloque.

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

    4. Calcular estado final:

        Si existe bloque INCLUDED:
            Cobertura = INCLUDED

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

## Paso 1 — Crear la cobertura

Insertar en:

    PRODUCT_COMPANY_COVER

Ejemplo:

    INSERT INTO PRODUCT_COMPANY_COVER 

    (HIRING_STATUS_EXPR, COVER_ID, PRODUCT_COMPANY_ID) 

    VALUES (NULL,13,230);

Después recuperar el ID generado.

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

