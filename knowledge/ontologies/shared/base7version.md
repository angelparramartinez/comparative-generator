# Shared Ontology: Base7Version

SharedOntology: true

**Aviso (26/08)**: fichero genérico del tipo `Base7Version`
(avant-back, `javabasesiete/.../base7/dto/Base7Version.java`) — el
objeto real de catálogo Base7 que describe la versión concreta de un
vehículo. A diferencia de `shared/person.md` (donde una misma ontología
de ramo puede tener varias figuras `Person` distintas -- `holder`,
`owner`, `primaryDriver`...), `Base7Version` aparece **una única vez**
por riesgo: `VehicleProperty.base7Version`, confirmado idéntico en
`MotorRisk`/`AutosRisk` y en `MotorbikeRisk` (motos) -- `MotorbikeRisk`
hereda el getter `getBase7Version()` de `MotorRisk` sin sobreescribirlo,
mismo `@JsonView({ASM, COMPARATIVE_REQUEST})`, misma clave real
`base7Version`. Confirma que `Base7Version` es infraestructura
transversal a ramos con vehículo (Autos, Motos, y potencialmente
`RoadsideAssistanceRisk`/`FranchiseProtectionRisk`), no específica de
Autos -- vive en el paquete común `vehicle.property.dto.VehicleProperty`.

Cada ontología de ramo con vehículo declara el bloque `## base7Version`
con `imports: base7version` -- al ser una única figura con el mismo
nombre exacto que la clave real (`base7Version`), se aplica la regla
general ya usada para `owner`/`primaryDriver`/`secondaryDriver` en
Autos: `risk_field: base7Version.<field>` + `context: risk` (sin caso
especial como `holder`). Los `field:` de aquí ya incluyen la ruta
relativa completa desde `Base7Version` (pueden llevar varios niveles de
punto) -- el mecanismo de expansión solo concatena figura + campo, no
necesita entender la ruta.

**Rediseño (26/08, tras revisión del usuario)**: los tres campos de
aquí usan **`.id`** (numérico), no `.description`/`.name` (texto). Los
objetos reales (`Base7Engine`, `Base7Type`, `Base7Category`) no llevan
ningún serializador de colapso a string (a diferencia de `maritalStatus`
o `housingUse`, que sí tienen `@JsonSerialize(using =
CrmEnumJsonSerializer.class)` directamente sobre el getter y por tanto
sirven un string plano) -- en el JSON real que ve SPEL, estos tres
objetos viajan como `{id, name, description}` completos, así que hay
una elección real entre id/name/description como valor de comparación.
`id` es la opción estable: es la clave primaria real de la tabla, no
texto libre editable sin control de versión (ya se vio que `NAME` vs
`DESCRIPTION` intercambian su papel de "texto natural" entre estas
tablas sin ningún patrón fiable -- ver cada bloque). El texto
(`description`/`name`) sigue siendo imprescindible como **vocabulario
de matching** (`aliases`/`values`, lo que ve el LLM extractor en flujo
2) -- el propio `FILTER_EXPR`/`VALUE_EXPR` de flujo 3 debe generarse
contra el `id`, traduciendo el texto en español extraído por flujo 2 al
id real (mismo mecanismo ya usado por `value_matcher.js` para
`housingUse`/`capitalInsuranceType`, adaptado a un catálogo de ids en
vez de un catálogo de strings de enum).

**`type` (26/08)**: se pliega aquí el antiguo concepto `vehicleType` de
`ontology-auto.md` (eliminado de ese fichero) usando `base7Type.id` en
vez del wrapper `type.baseType` (que solo exponía `code`/`name`, sin
`id` ni acceso a la categoría). A diferencia del diseño anterior (25/08)
que dejaba `vehicleType` ramo-específico por su catálogo de valores no
universal, **la ruta de acceso sí es 100% genérica** -- lo que cambia
por categoría de vehículo (Autos/Camiones/Motos/VMP) son los valores que
realmente aparecen, no el campo. El catálogo completo (19 filas reales
de `BASE7_TYPE`, confirmado con export real 26/08) se documenta aquí
íntegro, con su categoría, en vez de filtrar solo a Autos -- mismo
criterio ya usado en `shared/person.md` (estructura completa según el
backend, no solo lo que un ramo concreto ha usado hasta ahora).

## engine
field: base7Engine.id
data_type: enum
meaning: Engine/fuel type of the vehicle.
aliases:
- combustible
- tipo de motor
- motorización
- motor eléctrico
- motor híbrido
- vehículo eléctrico
- vehículo híbrido
values:
- 3: ELÉCTRICO
- 2: COMBUSTIÓN INTERNA DIESEL, COMBUSTIBLE GASOIL (Diesel)
- 4: COMBUSTIÓN INTERNA OTTO, COMBUSTIBLE GASOLINA (Gasolina)
- 1: COMBUSTIÓN INTERNA COMBUSTIBLE BIOETANOL O ETANOL
- 5: COMBUSTIÓN INTERNA, COMBUSTIBLE HIDRÓGENO
- 6: COMBUSTIÓN INTERNA, COMBUSTIBLE GAS LICUADO DEL PETROLEO (GLP)
- 7: MOTOR HIBRIDO G+E (híbrido NO enchufable)
- 11: Motor Híbrido Gasolina + Eléctrico enchufable
- 12: Motor Híbrido Diesel + Eléctrico enchufable
- 13: ELÉCTRICO, COMBUSTIBLE HIDRÓGENO (pila de combustible)
- 8: OTROS
- 9: DESCONOCIDO
- 10: DESCONOCIDO
interpretation:
Ruta completa: `getBase7Version()` (`MotorRisk`, `@JsonView({ASM,
COMPARATIVE_REQUEST})`, clave `base7Version`) → `getBase7Engine()`
(`Base7Version`, **sin ninguna `@JsonView`** -- visible en todas las
vistas por regla de accesibilidad, clave `base7Engine`) → `getId()`
(`Base7Engine extends ModelDto`, heredado de `ModelDto.getId()`,
**tampoco lleva `@JsonView`** -- accesible, confirmado por bytecode
26/08, `com.codeoscopic.riality.dto.ModelDto` sin fuente disponible en
este repo). El texto (`getName()`/`getDescription()`, también sin
`@JsonView`) se usa solo como vocabulario de `values:` arriba, no como
`risk_field` -- ver nota de rediseño en la cabecera del fichero.
**NO usar** `base7Version.engine.type` (`ApiVehicleEngine.type`,
`Base7AvantEngine`): ese es un catálogo DISTINTO y más grueso (3
valores reales de salida: `Gasoline`/`Diesel`/`Others`) que colapsa
eléctrico/híbrido/hidrógeno/etanol/GLP a `Others` en `CRM_ENUM_MAPPING`
(confirmado 26/08 con export real, `DTO_CLASS='Base7AvantEngine'`) --
**no permite distinguir un vehículo eléctrico**. `base7Engine`
(catálogo real de la tabla `BASE7_ENGINE`, export real 26/08, 13 filas)
sí lo permite -- ese export tiene `NAME` como código de una letra
(B/D/E/G/H/L/X/O/Y/Z/P/R/C) y `DESCRIPTION` como texto real en español,
usado arriba solo como vocabulario, el id es el de la propia fila.
**Matiz importante para condiciones de "vehículo eléctrico enchufable /
cable de recarga"**: solo los ids 3 (`ELÉCTRICO` puro), 11 y 12 (híbridos
**enchufables**) tienen capacidad de carga por cable. El id 7 (`MOTOR
HIBRIDO G+E`, sin "enchufable" en el nombre) es un híbrido convencional
sin cable; los ids 5/13 son de hidrógeno (sin cable de recarga
eléctrica). Una condición real que hable de "cable de recarga" debe
mapear a `IN [3, 11, 12]`, no a "todo lo que contenga ELÉCTRICO" (el id
13 contiene la palabra "ELÉCTRICO" pero es pila de combustible de
hidrógeno, no enchufable).

---

## type
field: base7Type.id
data_type: enum
meaning: Vehicle type/body within its category (turismo, motocicleta,
camión...) -- more granular than `category`, scoped in practice to
whichever category the insured vehicle belongs to.
aliases:
- turismo
- derivado de comercial
- derivado de turismo
- categoría del vehículo
- tipo de vehículo
- motocicleta
- ciclomotor
- camión
values:
- 1: TURISMO (categoría AUTOS)
- 2: MONOVOLUMEN (categoría AUTOS)
- 3: TODO TERRENO (categoría AUTOS)
- 4: COMERCIAL DERIVADO DE TT (categoría AUTOS)
- 5: COMERCIAL DERIVADO DE TURISMO (categoría AUTOS)
- 6: FURGONES Y CAMIONES LIGEROS (categoría AUTOS)
- 7: FURGONES HABILIT. A PASAJEROS (categoría AUTOS)
- 8: FURGONES PESADOS (categoría CAMIONES)
- 9: CAMIONES (categoría CAMIONES)
- 10: TRACTO-CAMIONES (categoría CAMIONES)
- 11: AUTOCARES Y AUTOBUSES (categoría CAMIONES)
- 12: VEHÍCULOS AGRÍCOLAS (categoría CAMIONES)
- 13: VEHÍCULOS INDUSTRIALES (categoría CAMIONES)
- 14: MOTOCICLETAS (categoría MOTOS)
- 15: CICLOMOTORES (categoría MOTOS)
- 16: BICICLETAS E-BIKES (categoría MOTOS)
- 17: BICICLETAS S-PEDELEC (SPEED-PEDELEC) (categoría MOTOS)
- 18: PERSONAL (categoría VMP)
- 19: SERVICIOS (categoría VMP)
interpretation:
**Sustituye al antiguo concepto `vehicleType` de `ontology-auto.md`
(eliminado 26/08)**, que usaba `type.baseType.name` -- un objeto
envoltorio (`VehicleType`/`VehicleBaseType`) construido a mano en
`Base7Version.getType()` que solo expone `code`/`name`, sin `id` ni
acceso a la categoría. Ruta nueva: `getBase7Version()` → `getBase7Type()`
(`Base7Version`, **sin ninguna `@JsonView`** -- accesible, clave
`base7Type`, objeto real con más campos que el wrapper) → `getId()`
(`Base7Type extends ModelDto`, sin `@JsonView` -- accesible).
Catálogo completo confirmado con export real de `BASE7_TYPE` (26/08, 19
filas con `BASE7_CATEGORY_ID`) -- las primeras 7 (categoría AUTOS) son
las mismas ya validadas contra condicionados reales de Autos en la v1
de `ontology-auto.md` (Mapfre/Generali/Axa/Divina...); las 12 restantes
(Camiones/Motos/VMP) se documentan por completitud estructural, sin
ninguna cita real todavía (mismo criterio que el resto de campos
`shared/person.md` sin evidencia real -- estructura completa según el
backend, alias/aplicabilidad real se confirma cuando exista una
ontología de Motos/Camiones). En `BASE7_TYPE`, `NAME` es el campo de
texto natural (TURISMO...) y `DESCRIPTION` es un código numérico interno
("100", "120"...) -- **al revés** que en `category` (ver bloque
siguiente); no asumir cuál columna es la de texto natural sin comprobar
cada tabla.

---

## category
field: base7Type.base7Category.id
data_type: enum
meaning: High-level vehicle category (car, truck, motorcycle, personal
mobility vehicle) -- broader and more universal than `type`.
aliases:
- categoría del vehículo
- tipo de vehículo
- primera categoría
- segunda categoría
- tercera categoría
- vehículos de primera categoría
- vehículos de segunda categoría
- vehículos de tercera categoría
- vehículo de primera categoría
- vehículo de segunda categoría
- vehículo de tercera categoría
- PMA
- peso máximo autorizado
- PMA inferior o igual a 3.500 kg
- PMA menor o igual a 3.500 kg
- PMA menor de 3.500 kg
- PMA superior a 3.500 kg
values:
- 1: AUTOS
- 2: CAMIONES
- 3: MOTOS
- 4: Vehículos de movilidad personal VMP
interpretation:
Ruta completa: `getBase7Version()` → `getBase7Type()` (ver bloque
`type`) → `getBase7Category()` (`Base7Type`, **tampoco lleva
`@JsonView`** -- accesible, clave `base7Category`) → `getId()`
(`Base7Category extends CrmEnumMappingDto extends IdDto`, `IdDto.getId()`
sin `@JsonView` -- accesible). Confirmado con export real de
`BASE7_CATEGORY` (26/08, 4 filas) + `BASE7_TYPE` (26/08, 19 filas con
`BASE7_CATEGORY_ID`, ver bloque `type`) -- catálogo genuinamente
universal (a diferencia de `type`, cuyo subconjunto de valores reales sí
depende de la categoría). En `BASE7_CATEGORY`, `NAME` es un código
ordinal (PRIMERA/SEGUNDA/TERCERA/VMP) y `DESCRIPTION` es el texto natural
(AUTOS/CAMIONES/MOTOS/VMP, usado arriba solo como vocabulario de
`values:`) -- **al revés** que en `BASE7_TYPE`. `type` da el subtipo
concreto (TURISMO, MONOVOLUMEN...) dentro de una categoría; este campo da
el nivel por encima, útil para condiciones que excluyen/incluyen por
categoría gruesa de vehículo en vez de por subtipo.

**ALIAS DE LA FRONTERA DE PMA (04/09, trabajo de categoría)**: hasta ahora
los alias de este campo eran solo las formas literales
("primera categoría", "categoría del vehículo"...). Medido en la ronda del
03/09: de 13 dependencias sobre `base7Type.id`, **7 tenían vocabulario de
categoría en la evidencia**, y las 7 eran de Zurich, que expresa la
frontera **por el número** ("cuyo PMA sea menor de 3.500 kg") en vez de
nombrarla. Divina, que sí dice "vehículos de primera categoría"
(`su_00008`/`su_00027`), elige este campo correctamente. La causa no era el
prompt -- `shared/person.md` ya indica desde el 03/09 que para clasificar
el vehículo se use este campo, con la frontera de los 3.500 kg citada
expresamente -- sino que **sin alias que matchease "PMA", el concepto no
llegaba a ofrecerse como candidato en `Ontology Relevance Filter`**, así que
el LLM no podía elegirlo y caía en enumerar subtipos de `base7Type` (cuyos
valores "turismo"/"furgoneta" sí matchean). Misma forma de fallo que el caso
`housingUse` de Hogar (CLAUDE.md 5.3). Se añaden las formas multipalabra de
la frontera, **deliberadamente sin ningún umbral numérico suelto**: la
lección del alias `750 kg` de `lightTrailer` (ver `ontology-auto.md`) es que
un número solo no puede distinguir la dirección de la comparación. Tampoco
se añade "resto de vehículos", demasiado genérico para ser alias fiable
aunque sea la expresión real de la categoría complementaria -- eso lo cubre
la regla de prompt.

**Correspondencia con la clasificación legal "primera/segunda/tercera
categoría" (27/08, confirmado por el usuario, no asumido)**: pese a la
advertencia previa de `GD-AUTO-GAP-001` (`evaluators/coverage_dependency_
extractor/golden_dataset_auto.json`) de no confundir esta clasificación
con `category` sin confirmar la correspondencia -- el usuario confirmó
explícitamente la equivalencia real: **primera categoría → AUTOS (id 1)**,
**segunda categoría → CAMIONES (id 2)** (incluye maquinaria agrícola y
remolques, coincide con el propio catálogo `BASE7_TYPE` bajo CAMIONES:
`VEHÍCULOS AGRÍCOLAS`), **tercera categoría → MOTOS (id 3)**, **incluye
los quads** (confirmado explícitamente, pese a que un quad tiene 4 ruedas
-- no se clasifica por nº de ruedas sino por esta equivalencia). Coincide
además con el propio `NAME` ordinal de `BASE7_CATEGORY`
(PRIMERA/SEGUNDA/TERCERA/VMP) -- evidencia adicional independiente de que
la correspondencia es real, no una coincidencia de nombre. Caso real que
motivó esto: anexos de un condicionado que definen "vehículos de 2ª
categoría" (Divina Seguros, `su_00185`/`su_00008`) -- antes sin alias
literal (el condicionado dice "segunda categoría", no "categoría del
vehículo"), así que el concepto ni siquiera entraba como candidato en
`Ontology Relevance Filter`.
