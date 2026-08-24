# Auto Insurance Ontology v1.0

OntologyType: auto

**AVISO (21/08, actualizado tras cruzar condicionados reales)**:
`risk_field`, `data_type` y los valores de `garageType` están confirmados
contra el backend real de Avant — fiables. Los `aliases` se cruzaron el
21/08 contra 11 condicionados generales reales de Autos aportados por el
usuario (2 de ellos de Mapfre España, ME100P/ME000P, ed. febrero 2025 — el
resto de otras 9 compañías como contraste), en
`examples/autos/condicionados generales/`. Resultado por concepto, ver cada
bloque:
- **Validados con cita real**: `primaryDriverBirthDate`/
  `secondaryDriverBirthDate` (Mapfre define literalmente "Conductor
  habitual"/"Conductor ocasional"; "edad" confirmado en Axa),
  `primaryDriverLicense` ("antigüedad del carné" confirmado en Reale, Axa,
  Divina — no en Mapfre).
- **Falsos amigos detectados y corregidos con `negative_aliases`**:
  `garageType` (alias "garaje" en Mapfre solo aparece en un artículo de RC
  Ampliada sobre incendio/explosión, nada que ver con el tipo de garaje
  declarado) y `lightTrailer` (alias "remolque" en Mapfre significa el
  servicio de grúa de Asistencia en Viaje, no que el vehículo lleve un
  remolque enganchado).
- **Sin ningún soporte real encontrado en los 11 documentos**:
  `annualMileage` y `previouslyInsured` — probablemente son factores de
  tarificación que nunca se mencionan como condición de cobertura en el
  texto legal. Se mantienen (son campos reales del backend) pero sus alias
  siguen siendo una suposición sin confirmar — no indexar con confianza
  hasta ver un caso real.
- `registrationDate`/`purchaseDate`/`registrationPlate`/
  `circulationAddress`: no cruzados a fondo (identificadores/fechas
  administrativas, poco probable que aparezcan como condición de
  cobertura) — alias sin confirmar, riesgo bajo.
Docling (el extractor real del pipeline) sigue sin poder leer 2 de los 11
PDFs (Allianz y Occident, aparentemente escaneados sin capa de texto) — se
usó `pypdf` solo para esta validación puntual de vocabulario, no sustituye
al pipeline real.

## registrationDate
risk_field: registrationDate
data_type: date
meaning: Vehicle registration (matriculation) date.
aliases:
- fecha de matriculación
- matriculación del vehículo
- vehículo matriculado
contractual_examples:
- vehículos matriculados a partir del
- con antigüedad superior a
interpretation:
Getter de negocio `getMatriculationDate()` (`@JsonView({V1, V1_B2C,
COMPARATIVE_REQUEST})`), pero `@JsonProperty("registrationDate")` — la clave
real accesible desde SPEL es `registrationDate`, no `matriculationDate`.
Confirmado leyendo `MotorRisk.java` (proyecto avant-back) el 21/08.
**Limitación conocida, sin resolver**: es una fecha absoluta, no un año
suelto como `yearBuilt`/`lastReformDate` en Hogar. Una condición real del
tipo "vehículo con menos de 5 años de antigüedad" es relativa a la fecha de
evaluación, no una fecha fija — cuando aparezca la primera dependencia real
así, decidir con el usuario cómo debe representarse `value` (fecha absoluta
calculada por el LLM, o duración relativa que resuelva flujo 3) antes de
generar el `FILTER_EXPR`, no asumir.

---

## purchaseDate
risk_field: purchaseDate
data_type: date
meaning: Vehicle purchase date (may differ from registration date for
second-hand vehicles).
aliases:
- fecha de compra
- vehículo adquirido
interpretation:
Sin renombrado — `getPurchaseDate()` ya usa `@JsonView({V1, V1_B2C,
COMPARATIVE_REQUEST})` con el mismo nombre de clave. Misma limitación de
fecha absoluta vs. duración relativa que `registrationDate`.

---

## registrationPlate
risk_field: registrationPlate
data_type: string
meaning: Vehicle registration plate.
aliases:
- matrícula
- placa de matrícula
interpretation:
Getter de negocio `getPlate()`, pero `@JsonProperty("registrationPlate")` —
clave real `registrationPlate`. Incluido por completitud (mismo patrón que
`address` en Hogar) — es un identificador, no se espera que aparezca nunca
como condición real de una cobertura.

---

## annualMileage
risk_field: kilometersPerYear
data_type: integer
meaning: Estimated kilometers driven per year.
aliases:
- kilómetros anuales
- kilometraje anual
- km/año
contractual_examples:
- vehículos con un uso inferior a
- siempre que el kilometraje anual no supere
interpretation:
Getter de negocio `getYearKilometersNum()` (`@JsonView({V1, V1_B2C,
COMPARATIVE_REQUEST})`), pero `@JsonProperty("kilometersPerYear")` — la
clave real es `kilometersPerYear`, no el nombre del método. **Corregido
21/08**: la primera versión de este fichero usaba `yearKilometersNum` por
error (nombre del método en vez del `@JsonProperty`) — detectado al
confirmar `risk.kilometersPerYear` en `vehicleDtoUtils.ts` de avant-front
(`kilometersPerYear: risk.kilometersPerYear`, usado igual en ambas
direcciones de la conversión DTO↔formulario). Restricciones reales del
backend: mínimo 0, máximo 9999999.
**Sin ningún soporte real encontrado en condicionados (21/08)**: revisados los 11
condicionados de `examples/autos/condicionados generales/` (incluidos los 2
de Mapfre) — "kilómetros" solo aparece en cláusulas de distancia no
relacionadas (umbrales de vehículo de sustitución, fenómenos atmosféricos),
nunca como condición de kilometraje anual declarado. Parece un factor
puramente de tarificación que el condicionado legal nunca menciona como
condición de cobertura — los alias de arriba siguen sin confirmar.

---

## trailer
risk_field: lightTrailer
data_type: boolean
meaning: Whether the insured vehicle tows a light trailer.
aliases:
- remolque ligero
- arrastre de remolque
- enganche de remolque
negative_aliases:
- asistencia en viaje
- traslado del vehículo
- grúa
contractual_examples:
- cuando el vehículo lleve enganchado un remolque
interpretation:
Getter de negocio `getTrailer()` (en `AutosRisk`, sin `@JsonView` —
visible en todas las vistas). El campo realmente accesible en el nivel
correcto de la jerarquía (`AutoProperty`/`VehicleProperty`) es
`getLightTrailer()` (`@JsonView(Views.V1.class)`), con clave `lightTrailer`
— confirmado en `AutosRisk.java`/`AutoProperty.java` el 21/08.
**Falso amigo real, corregido (21/08)**: el alias suelto "remolque" se quitó
tras encontrarlo en el condicionado real de Mapfre (ME000P, art. sobre
Asistencia en Viaje, epígrafe "REMOLQUE DEL VEHÍCULO Y TRASLADO") — ahí
"remolque" es el servicio de grúa que traslada el vehículo averiado, no que
el vehículo asegurado lleve un remolque enganchado. `negative_aliases`
suprime ese uso; los alias que quedan son más específicos a propósito.

---

## garageType
risk_field: garageType
data_type: enum
meaning: Type of parking/garage where the vehicle is usually kept.
aliases:
- tipo de garaje
- plaza de garaje
- vehículo guardado habitualmente en
values:
- PrivateGarage: garaje individual
- CommunalParking: garaje colectivo
- NoGarage: vía pública
negative_aliases:
- incendio o explosión
- responsabilidad civil ampliada
interpretation:
Valores reales confirmados en `api_mappings_es.properties` (proyecto
avant-back) el 21/08.
**Falso amigo real, corregido (21/08)**: se quitaron los alias sueltos
"garaje colectivo"/"garaje individual"/"vía pública" (quedan solo como
`values`, no como `aliases` de texto libre) tras encontrar en el
condicionado real de Mapfre (ME000P, art. 25 bis, Responsabilidad Civil
Ampliada) la frase "estacionado en el garaje del edificio del domicilio
habitual... Se considera garaje el local o recinto..." — un artículo sobre
incendio/explosión mientras el coche está aparcado, sin ninguna relación
con el tipo de garaje declarado a efectos de tarifa. `negative_aliases`
suprime ese uso cuando aparece cerca de "incendio"/"RC ampliada".
**Ambigüedad resuelta con evidencia empírica real (21/08)**: `AutosRisk`
sobreescribe `getGarageType()`/`getGarageTypeB2b()` (heredados de
`MotorRisk`, donde `getGarageType()` es solo `V1_B2C` y `getGarageTypeB2b()`
es `{V1, COMPARATIVE_REQUEST}`) sin repetir la anotación `@JsonView` en el
override — no se podía saber solo leyendo el código si Jackson hereda la
restricción de vista del método padre. Confirmado indirectamente vía
`avant-front`: `autoDtoUtils.ts` mapea en ambas direcciones `risk.garageType`
↔ `garageTypeId` (estado interno del formulario) contra la API real —es
decir, la clave que viaja de verdad por la red en un sistema en producción
es `garageType`, no `garageTypeId`. No es un test unitario aislado
(`writerWithView(Views.ASM.class)` como hace `SpelContext.java`), pero es
evidencia real de un sistema funcionando — suficiente para dar el campo por
accesible.

---

## circulationAddress
risk_field: circulationAddress
data_type: PostalAddress
meaning: Address where the vehicle is habitually parked/circulates.
aliases:
- domicilio de circulación
- lugar de estacionamiento habitual
interpretation:
Getter privado en `MotorRisk.java`, `@JsonView({V1, COMPARATIVE_REQUEST})`,
sin `@JsonProperty` (clave = nombre del método). Mismo patrón que `address`
en Hogar — identifica ubicación, no se espera como condición típica de
cobertura.

---

## previouslyInsured
risk_field: previouslyInsured
data_type: boolean
meaning: Whether the primary driver had previous car insurance.
aliases:
- asegurado con anterioridad
- histórico de seguro previo
- sin seguro previo
contractual_examples:
- siempre que el tomador acredite seguro anterior
- en caso de no disponer de seguro previo
interpretation:
Getter de negocio `getHasHistory()`, `@JsonProperty("previouslyInsured")`,
`@JsonView({V1, V1_B2C, COMPARATIVE_REQUEST})` — clave real
`previouslyInsured`.
**Sin ningún soporte real encontrado (21/08)**: revisados los 11
condicionados reales disponibles — ningún resultado para "seguro anterior",
"póliza anterior", "bonus" ni variantes. Probablemente vive solo en el
proceso de tarificación (cálculo de bonus-malus), no como condición de
cobertura en el texto legal. Alias sin confirmar.

---

## primaryDriverBirthDate
risk_field: primaryDriver.birthDate
data_type: date
meaning: Birth date of the habitual/primary driver.
aliases:
- conductor habitual
- conductor principal
- edad del conductor
- edad
contractual_examples:
- conductores menores de 25 años
- siempre que el conductor habitual sea mayor de
interpretation:
**Validado con condicionados reales (21/08)**: Mapfre (ME000P) define
literalmente "Conductor habitual: Conductor declarado... por conducir con
asiduidad el vehículo asegurado". "Edad" + "antigüedad del carné" como
condición conjunta confirmada en Axa ("su edad y antigüedad del carné...
estén expresamente definidas en este contrato") y "menores de 25 años"
como condición de recargo/exclusión confirmada en Reale y Qualitas.
**Ruta anidada, decisión de diseño del usuario (21/08)**: a diferencia de
Hogar (todo campo plano sobre `HomeRisk`), en Autos el conductor/propietario
son objetos `Person` anidados (`primaryDriver`, `secondaryDriver`, `owner`).
El `risk_field` incluye la ruta punteada completa
(`primaryDriver.birthDate`), tal cual debe usarse en la expresión SPEL —no
se separa concepto/contenedor en dos campos distintos.
`getBirthDate()` en `Person.java`, `@JsonView({V1, V1_B2C, CRM,
COMPARATIVE_REQUEST})` — accesible. `primaryDriver` es la clave real de
`getHabitualDriver()` en `MotorRisk.java` (`@JsonProperty("primaryDriver")`,
`@JsonView({V1, V1_B2C, COMPARATIVE_REQUEST})`).
Distinguir en el condicionado si la condición habla del conductor
**habitual/principal** (este concepto) o de un **segundo conductor/conductor
ocasional** (ver `secondaryDriverBirthDate`) — mismo tipo de matiz que
vivienda principal/secundaria en Hogar.

---

## secondaryDriverBirthDate
risk_field: secondaryDriver.birthDate
data_type: date
meaning: Birth date of the occasional/secondary driver.
aliases:
- conductor ocasional
- segundo conductor
- conductor adicional
interpretation:
**Validado con condicionado real (21/08)**: Mapfre (ME000P) define
literalmente "Conductor ocasional: Conductor o conductores declarados...
que puede conducir el vehículo asegurado con menor asiduidad que el
conductor habitual" — cita textual, no aproximada.
Mismo campo `birthDate` de `Person`, distinto contenedor: `secondaryDriver`
es la clave real de `getOccasionalDriver()` en `AutosRisk.java`
(`@JsonProperty("secondaryDriver")`, `@JsonView({V1, V1_B2C,
COMPARATIVE_REQUEST})`).

---

## primaryDriverLicense
risk_field: primaryDriver.drivingLicenses
data_type: list
meaning: Driving licenses held by the primary driver (type, issue date,
issuing zone) — a list, not a single scalar value.
aliases:
- carné de conducir
- antigüedad del carné
- permiso de conducir
contractual_examples:
- siempre que el carné tenga una antigüedad mínima de
- conductores con menos de X años de carné
interpretation:
**Alias "antigüedad del carné" validado con 3 condicionados reales (21/08)**:
Reale ("Antigüedad del carné superior a 1 año"), Axa ("su edad y antigüedad
del carné... estén expresamente definidas") y Divina Seguros (mismo término
literal). No aparece en el condicionado legal de Mapfre (puede vivir solo en
su manual de tarificación interno, no en el texto legal) — vigilar si
aparece en el condicionado real de Mapfre Autos cuando se procese en flujo 2.
**No es un campo escalar** — no debe extraerse como
`risk_field/operator/value` plano en flujo 2 (el Guardrail no valida
operadores para este `data_type` a propósito, ver
`Coverage Dependency Risk Field Guardrail`). `getDrivingLicenses()` en
`Person.java` (`@JsonView({V1, COMPARATIVE_REQUEST})`, accesible) devuelve
una lista de objetos `{type, date, issuingZone}`. Los getters de
conveniencia con nombre de negocio (`getPermissionType()`/
`getPermissionDate()`, alias JSON `drivingLicenseId`/`drivingLicenseDate`)
**solo llevan `@JsonView(V1_B2C)` — no accesibles desde SPEL real**.
Ejemplo de expresión SPEL para resolver "antigüedad del carné de coche" (a
falta de un caso real que la confirme):
`insurance.primaryDriver.drivingLicenses.?[type == 'B'][0].date` — filtra la
lista por tipo de carné (`B` = turismo) y toma la fecha. Sin resolver
todavía: qué hacer si no hay ningún carné de tipo `B` en la lista (lista
vacía tras el filtro), y cómo debe representarse la condición en el
esquema `risk_field/operator/value` de flujo 2 — decidir con el usuario
cuando aparezca la primera dependencia real de este tipo, no diseñar en el
vacío.

---

## secondaryDriverLicense
risk_field: secondaryDriver.drivingLicenses
data_type: list
meaning: Driving licenses held by the secondary/occasional driver — a list,
not a single scalar value.
aliases:
- carné de conducir
- antigüedad del carné
interpretation:
**Añadido 22/08 — descuido en la v1**: se documentó `primaryDriverLicense`
pero se olvidó su equivalente para el conductor ocasional, pese a que
`secondaryDriver.drivingLicenses` ya estaba en `datos_riesgo_autos.json` y
en el catálogo del Guardrail desde el principio. Mismo caso exacto que
`primaryDriverLicense` (ver ese bloque para el detalle de accesibilidad y
la limitación de "no es un campo escalar"), solo cambia el contenedor:
`secondaryDriver` es la clave real de `getOccasionalDriver()` en
`AutosRisk.java`.

---

## factoryAccessories
risk_field: base7Options
data_type: list
meaning: Factory-installed accessories/option packs (part of the vehicle's
Base7 catalog configuration) — a list, not a single scalar value.
aliases:
- accesorios de fábrica
- equipamiento de serie
- opciones instaladas de fábrica
interpretation:
**Añadido 22/08**, a petición del usuario tras detectar que faltaba en la
v1 (excluido inicialmente con la justificación floja de "es complejo, no un
escalar simple" — revisado y corregido). `AutosRisk.getBase7Options()`
(privado, `@JsonView({ASM, COMPARATIVE_REQUEST})`, sin renombrado) —
accesible sin ninguna ambigüedad, a diferencia de `garageType`/
`nonBase7Options` (ver siguiente concepto). Devuelve una lista de
`Base7OptionPack`. Mismo tipo de limitación que `primaryDriverLicense`: no
es un campo escalar, cualquier condición real ("cuando el vehículo lleve
instalado X de fábrica") necesitaría filtrar la lista — sin ejemplo SPEL
todavía porque no hay ninguna dependencia real que lo confirme.

---

## installedAccessories
risk_field: nonBase7Options
data_type: list
meaning: Non-factory accessories added to the vehicle after purchase — a
list, not a single scalar value.
aliases:
- accesorios instalados
- accesorios no de fábrica
- equipamiento adicional
interpretation:
**Añadido 22/08**, a petición del usuario. El nombre de negocio
`installedAccessories` tiene la misma ambigüedad que `garageType`:
`MotorRisk.getInstalledAccessories()` es solo `@JsonView(API.V1)` (no
accesible), y `AutosRisk` lo sobreescribe públicamente sin repetir
`@JsonView` — no se puede saber sin probarlo si Jackson hereda la
restricción o la anula. **A diferencia de `garageType`, aquí no hace falta
resolver la ambigüedad**: existe `getNonBase7Options()` (privado en
`MotorRisk`, `@JsonView({ASM, COMPARATIVE_REQUEST})`, **no sobreescrito**
en `AutosRisk`) — ruta accesible sin ambigüedad. Por eso el `risk_field`
elegido es `nonBase7Options`, no `installedAccessories` (que sigue siendo
el nombre de negocio/concepto, título de este bloque). Devuelve una lista
de `VehicleAccessory`. Misma limitación de "no es un campo escalar" que el
resto de conceptos de tipo lista.

---

## vehicleType
risk_field: base7Version.type.baseType.name
data_type: enum
meaning: Vehicle category (turismo, comercial derivado, monovolumen,
todo terreno...) — determines which coverages apply or are excluded in
some condicionados.
aliases:
- turismo
- derivado de comercial
- derivado de turismo
- categoría del vehículo
- tipo de vehículo
contractual_examples:
- cuando el vehículo sea un turismo
- para vehículos derivados de turismo
- esta cobertura no aplica a vehículos comerciales
values:
- TURISMO: turismo
- COMERCIAL DERIVADO DE TURISMO: derivado de turismo, comercial derivado de turismo
- COMERCIAL DERIVADO DE TT: derivado de todo terreno, comercial derivado de todo terreno
- MONOVOLUMEN: monovolumen
- TODO TERRENO: todo terreno
- FURGONES Y CAMIONES LIGEROS: furgón, furgoneta, camión ligero
- FURGONES HABILIT. A PASAJEROS: furgón habilitado para pasajeros
interpretation:
**Añadido 22/08**, a petición del usuario (motivación real: los
condicionados pueden incluir/excluir coberturas según sea turismo o
derivado comercial — patrón real de este ramo, no especulativo). Ruta de
acceso completa, confirmada leyendo el backend real:
`getBase7Version()` (`MotorRisk`, protegido, `@JsonView({ASM,
COMPARATIVE_REQUEST})`, clave `base7Version`) → `getType()`
(`Base7Version`, privado, `@JsonView({V1, COMPARATIVE_REQUEST})`, clave
`type`) → devuelve un objeto `VehicleType{code, name, baseType}` construido
como `new VehicleType(base7Class.description, base7Class.name,
new VehicleBaseType(base7Type.description, base7Type.name))` — es decir,
`type.name` es en realidad el `name` de `Base7Class` (catálogo de
carrocería, 93 valores reales, ej. "BERLINA 3 Volúmenes", "PICK UP" —
demasiado granular para esto) y `type.baseType.name` es el `name` de
`Base7Type` (catálogo de categoría, 19 valores reales, el que de verdad
distingue turismo/comercial). `code`/`name` de `VehicleBaseType` ambos
`@JsonView({V1, COMPARATIVE_REQUEST})` — accesible.
**Catálogo real confirmado por el usuario (22/08)**: export de las tablas
`BASE7_TYPE`/`BASE7_CLASS` de la BBDD real. Los `values:` de arriba son las
7 filas de `BASE7_TYPE` con `BASE7_CATEGORY_ID = 1` (categoría "Autos" —
confirmado por el nombre real `Autos 1ª categoría (Turismos)` en
`api_mappings_es.properties`); las otras 12 filas de `BASE7_TYPE`
(motocicletas, vehículos industriales, agrícolas...) no aplican a
`AutosRisk`, pertenecen a otros ramos/tipos de vehículo del mismo Base7.
El campo `name` de `Base7Type` es el texto real usado como `values:` arriba
(literal, en mayúsculas en la BBDD: "TURISMO", "COMERCIAL DERIVADO DE
TURISMO", etc.) — normalizar mayúsculas al comparar, mismo criterio que el
resto de enums del proyecto (`value_matcher.js`).
