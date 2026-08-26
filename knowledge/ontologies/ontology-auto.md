# Auto Insurance Ontology v1.0

OntologyType: auto
Imports: person, base7version

**AVISO (25/08, rediseño 2)**: `Imports: person` declara que este ramo usa
`knowledge/ontologies/shared/person.md` — un fichero puramente genérico
del tipo `Person` (sin saber nada de ramos ni figuras). Cada figura real
de Autos que use un objeto `Person` (`holder`, `owner`, `primaryDriver`,
`secondaryDriver`) se declara como su propio bloque `## <figura>` con
`imports: person` (ver esos bloques más abajo) — el workflow `ontology
indexing` expande automáticamente **todos** los campos de `person.md`
para cada figura declarada (producto cruzado figura × campo, sin filtrar
por si ya se ha visto una cita real de cada combinación concreta —
decisión deliberada: la estructura debe ser lo más completa posible según
el backend, ver `shared/person.md` para el razonamiento completo). Los
alias propios de cada figura (p. ej. "tomador", "propietario", "conductor
habitual") se fusionan con los alias genéricos de cada campo. Subir este
fichero tal cual al formulario del workflow — el workflow lee
`knowledge/ontologies/shared/<nombre>.md` directamente del volumen
montado de solo lectura en el contenedor de n8n (`docker-compose.yml`),
sin ningún paso manual externo.

**AVISO (26/08)**: `Imports: ..., base7version` añade
`knowledge/ontologies/shared/base7version.md` — mismo mecanismo que
`person`, pero con una única figura por ramo (`## base7Version`, ver más
abajo) porque el objeto real `Base7Version` aparece una sola vez por
riesgo (no como `Person`, que puede tener varias figuras distintas).
Sustituye el acceso a `base7Version.engine.type`/`Base7AvantEngine`
(catálogo de solo 3 valores de salida que colapsa eléctrico/híbrido/
hidrógeno a `Others`, confirmado con export real de `CRM_ENUM_MAPPING`)
por `base7Version.base7Engine.id` (catálogo real de 13 valores que sí
distingue eléctrico) — ver `shared/base7version.md` para el
razonamiento completo. El antiguo concepto `vehicleType` (ramo-
específico, `type.baseType.name`) se elimina de este fichero: se
absorbe en `base7Version` como el campo `type` (`base7Type.id`), con el
catálogo completo de 19 valores reales de `BASE7_TYPE` (no solo los 7 de
Autos) — la ruta de acceso resultó ser genérica entre ramos, solo los
*valores* que aparecen en la práctica son específicos de cada categoría
de vehículo. **Rediseño de `.description` a `.id` (mismo día)**: los
objetos reales (`Base7Engine`/`Base7Type`/`Base7Category`) no colapsan a
string (a diferencia de `maritalStatus`/`housingUse`, que sí llevan
`@JsonSerialize(CrmEnumJsonSerializer)`) — el `id` numérico es la
comparación estable en el `FILTER_EXPR`/`VALUE_EXPR` real; el texto
(`description`/`name`) queda solo como vocabulario de matching para
flujo 2, con la traducción texto→id delegada a flujo 3
(`value_matcher.js`), mismo mecanismo que ya existe para
`housingUse`/`capitalInsuranceType` en Hogar.

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

## holder
imports: person
aliases:
- tomador
- tomador del seguro
interpretation:
**Rediseño 25/08**: figura transversal a todos los ramos (vive a nivel de
`Quotation`, no del DTO de riesgo -- confirmado en `SpelContext.java`).
Expande automáticamente todos los campos de
`knowledge/ontologies/shared/person.md` con `risk_field` sin prefijo y
`context: holder` (`insurance['holder'].<campo>`, no anidado bajo
`insurance["risk"]`).

---

## owner
imports: person
aliases:
- propietario
- propietario del vehículo
contractual_examples:
- cuando el PROPIETARIO del vehículo o TOMADOR del seguro sea una persona jurídica
interpretation:
**Añadido 25/08**, fundamentado con la misma cita de Divina Seguros que
`holder` (distingue explícitamente PROPIETARIO de TOMADOR). Confirmado en
`MotorRisk.java`: `private Person owner`, `getOwner()` con
`@JsonView({V1, V1_B2C, COMPARATIVE_REQUEST})` -- visible en ASM.
`AutosRisk` lo sobreescribe sin repetir `@JsonView` (misma ambigüedad que
`primaryDriver`/`garageType`) -- confirmado accesible vía avant-front real
(`autoDtoUtils.ts:54`, `risk.owner`). Nota: `MotorRisk.initializePersons()`
inicializa `owner = insuranceHolder` si no se informa explícitamente --
propietario y tomador pueden coincidir por defecto.

---

## primaryDriver
imports: person
aliases:
- conductor habitual
- conductor principal
interpretation:
**Rediseño 25/08** (antes escrito a mano campo a campo, ver historial de
git). `primaryDriver` es la clave real de `getHabitualDriver()` en
`MotorRisk.java` (`@JsonProperty("primaryDriver")`, `@JsonView({V1,
V1_B2C, COMPARATIVE_REQUEST})`) -- accesible. Distinguir en el
condicionado si la condición habla del conductor **habitual/principal**
(este bloque) o de un **segundo conductor/conductor ocasional** (ver
`secondaryDriver`) -- mismo tipo de matiz que vivienda principal/
secundaria en Hogar. Validado con condicionados reales (21/08): Mapfre
(ME000P) define literalmente "Conductor habitual"; "edad"+"antigüedad del
carné" confirmado en Axa; "menores de 25 años" en Reale y Qualitas.

---

## secondaryDriver
imports: person
aliases:
- conductor ocasional
- segundo conductor
- conductor adicional
interpretation:
**Rediseño 25/08**. `secondaryDriver` es la clave real de
`getOccasionalDriver()` en `AutosRisk.java` (`@JsonProperty(
"secondaryDriver")`, `@JsonView({V1, V1_B2C, COMPARATIVE_REQUEST})`) --
accesible. Validado con condicionado real (21/08): Mapfre (ME000P) define
literalmente "Conductor ocasional".

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

## base7Version
imports: base7version
interpretation:
**Añadido 26/08, rediseñado el mismo día** (ver historial de git para el
diseño intermedio con `.description`, descartado). Figura única (no hay
varias instancias de `Base7Version` por riesgo, a diferencia de las
figuras de `Person`). Confirmado idéntico en `MotorbikeRisk` (motos) --
misma clave real `base7Version`, mismo `@JsonView`, heredado de
`MotorRisk` sin sobreescribir -- `Base7Version` es infraestructura
transversal a ramos con vehículo, no específica de Autos. Expande
`engine`/`type`/`category` de
`knowledge/ontologies/shared/base7version.md` con `risk_field:
base7Version.<campo>` y `context: risk` (regla general, sin caso
especial como `holder`). El antiguo concepto `vehicleType` (ramo-
específico, `type.baseType.name`) se elimina de aquí -- lo sustituye el
campo `type` del fichero compartido (`base7Type.id`), con el catálogo
completo de 19 valores reales (no solo los 7 de Autos) documentado allí.
