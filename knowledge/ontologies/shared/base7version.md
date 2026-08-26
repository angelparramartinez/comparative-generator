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
punto, p.ej. `base7Engine.description`) -- el mecanismo de expansión solo
concatena figura + campo, no necesita entender la ruta.

**Decisión de alcance (26/08)**: solo se generalizan aquí los campos
cuyo catálogo de valores es **genuinamente universal** entre categorías
de vehículo (Autos/Camiones/Motos/VMP). El campo `vehicleType`
(`type.baseType.name`, ya existente en `ontology-auto.md`) se queda
ramo-específico a propósito: su catálogo de 7 valores (TURISMO,
MONOVOLUMEN...) está filtrado por `BASE7_CATEGORY_ID = 1` (AUTOS) en la
tabla real `BASE7_TYPE` -- Motos tendría un catálogo real distinto
(MOTOCICLETAS, CICLOMOTORES...) para la misma categoría de campo, así
que generalizarlo ahora sería diseñar para una ontología de Motos que
no existe todavía (YAGNI). Lo que sí es universal es el nivel **por
encima** de `type`: `base7Category` (ver bloque `## category` abajo).

## engine
field: base7Engine.description
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
- "ELÉCTRICO" (id 3)
- "COMBUSTIÓN INTERNA DIESEL, COMBUSTIBLE GASOIL" (id 2)
- "COMBUSTIÓN INTERNA OTTO, COMBUSTIBLE GASOLINA" (id 4)
- "COMBUSTIÓN INTERNA COMBUSTIBLE BIOETANOL O ETANOL" (id 1)
- "COMBUSTIÓN INTERNA, COMBUSTIBLE HIDRÓGENO" (id 5)
- "COMBUSTIÓN INTERNA, COMBUSTIBLE GAS LICUADO DEL PETROLEO" (id 6)
- "MOTOR HIBRIDO G+E" (id 7, híbrido NO enchufable)
- "Motor Híbrido Gasolina + Eléctrico enchufable" (id 11)
- "Motor Híbrido Diesel + Eléctrico enchufable" (id 12)
- "ELÉCTRICO, COMBUSTIBLE HIDRÓGENO" (id 13, pila de combustible)
- "OTROS" (id 8)
- "DESCONOCIDO" (id 9, id 10)
interpretation:
Ruta completa: `getBase7Version()` (`MotorRisk`, `@JsonView({ASM,
COMPARATIVE_REQUEST})`, clave `base7Version`) → `getBase7Engine()`
(`Base7Version`, **sin ninguna `@JsonView`** -- visible en todas las
vistas por regla de accesibilidad, clave `base7Engine`) → `getName()`/
`getDescription()` (`Base7Engine extends ModelDto`, **tampoco llevan
`@JsonView`** -- accesibles). **NO usar** `base7Version.engine.type`
(`ApiVehicleEngine.type`, `Base7AvantEngine`): ese es un catálogo
DISTINTO y más grueso (3 valores reales de salida: `Gasoline`/`Diesel`/
`Others`) que colapsa eléctrico/híbrido/hidrógeno/etanol/GLP a
`Others` en `CRM_ENUM_MAPPING` (confirmado 26/08 con export real,
`DTO_CLASS='Base7AvantEngine'`) -- **no permite distinguir un vehículo
eléctrico**. `base7Engine.description` sí lo permite: confirmado con
export real de la tabla `BASE7_ENGINE` (26/08, 13 filas reales) --
`NAME` es un código de una letra (B/D/E/G/H/L/X/O/Y/Z/P/R/C, no usar
como valor de comparación), `DESCRIPTION` es el texto real en español
usado arriba como `values:`.
**Matiz importante para condiciones de "vehículo eléctrico enchufable /
cable de recarga"**: solo los ids 3 (`ELÉCTRICO` puro), 11 y 12 (híbridos
**enchufables**) tienen capacidad de carga por cable. El id 7 (`MOTOR
HIBRIDO G+E`, sin "enchufable" en el nombre) es un híbrido convencional
sin cable; los ids 5/13 son de hidrógeno (sin cable de recarga
eléctrica). Una condición real que hable de "cable de recarga" debe
mapear a `IN [id 3, id 11, id 12]`, no a "todo lo que contenga
ELÉCTRICO" (el id 13 contiene la palabra "ELÉCTRICO" pero es pila de
combustible de hidrógeno, no enchufable).

---

## category
field: base7Type.base7Category.description
data_type: enum
meaning: High-level vehicle category (car, truck, motorcycle, personal
mobility vehicle) -- broader and more universal than `vehicleType`
(which is scoped to category "AUTOS" only).
aliases:
- categoría del vehículo
- tipo de vehículo
values:
- AUTOS (id 1)
- CAMIONES (id 2)
- MOTOS (id 3)
- "Vehículos de movilidad personal VMP" (id 4)
interpretation:
Ruta completa: `getBase7Version()` → `getBase7Type()` (`Base7Version`,
**sin ninguna `@JsonView`** -- accesible, clave `base7Type`; **distinto**
del `type.baseType` ya usado por el concepto `vehicleType` de
`ontology-auto.md` -- ese es un objeto envoltorio (`VehicleType`/
`VehicleBaseType`) construido a mano que solo expone `code`/`name` y
pierde la categoría; `base7Type` es el objeto real, con más campos) →
`getBase7Category()` (`Base7Type`, **tampoco lleva `@JsonView`** --
accesible, clave `base7Category`) → `getDescription()`
(`Base7Category extends CrmEnumMappingDto`, `@JsonView(V1)` heredado --
accesible). Confirmado con export real de `BASE7_CATEGORY` (26/08, 4
filas) y `BASE7_TYPE` (26/08, 19 filas con `BASE7_CATEGORY_ID`) --
`NAME` de `BASE7_CATEGORY` es un código ordinal (PRIMERA/SEGUNDA/
TERCERA/VMP, no usar), `DESCRIPTION` es el texto real usado arriba
(nótese que aquí es al revés que en `BASE7_TYPE`/`BASE7_ENGINE`, donde
`NAME` es el campo con texto natural -- confirmar siempre por tabla, no
asumir).
`vehicleType` (`type.baseType.name`, ontology-auto.md) da el subtipo
concreto (TURISMO, MONOVOLUMEN...) dentro de `AUTOS`; este campo da el
nivel por encima, útil para condiciones que excluyen/incluyen por
categoría gruesa de vehículo en vez de por subtipo (p.ej. anexos de un
condicionado que definen "vehículos de 2ª categoría" == `CAMIONES`,
ver hallazgo real en Divina Seguros).
