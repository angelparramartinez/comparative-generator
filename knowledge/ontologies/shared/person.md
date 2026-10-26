# Shared Ontology: Person

SharedOntology: true

**Aviso (25/08, rediseño 2)**: fichero puramente genérico del tipo `Person`
(avant-back, `javacommons/.../person/dto/Person.java`) — no sabe nada de
ramos ni de figuras (`holder`/`owner`/`primaryDriver`/`secondaryDriver`...).
Cada campo de aquí declara `field:` (nombre relativo dentro de un objeto
`Person`) + `data_type:` + `meaning:`/`aliases:`/`interpretation:`
genéricos, fundamentados contra el backend real.

Cada ontología de ramo (`ontology-<ramo>.md`) declara sus propias figuras
(objetos `Person` que usa ese ramo) en bloques `## <figura>` con
`imports: person` — eso expande **todos** los campos de aquí para esa
figura, sin filtrar por si ya se ha visto una cita real o no (decisión
explícita: la estructura debe ser lo más completa posible según el
backend; solo el vocabulario/alias debe fundamentarse en condicionados
reales). El vocabulario que distingue **quién** es la figura ("tomador",
"propietario", "conductor habitual") vive en el bloque de la figura, no
aquí, y se fusiona con los alias genéricos de cada campo en indexado.
Resolución de ruta SPEL: `holder` → `insurance['holder'].<field>` (sin
prefijo, `holder` es clave hermana de `risk`, no anidada); cualquier otra
figura → `insurance["risk"].<figura>.<field>`.

Todos los campos de aquí están confirmados accesibles desde ASM (regla ya
validada: visible si el getter no lleva `@JsonView`, o lo lleva con `V1`
o `ASM` explícitos). Revisado el fichero completo de `Person.java`
(2602 líneas) el 25/08.

## identificationType
field: identificationType
data_type: enum
meaning: Type of identification document of a person -- distinguishes a
natural person from a legal entity (company).
aliases:
- persona jurídica
- persona física
values:
- Cif: persona jurídica (empresa/sociedad)
- Dni: persona física (España)
- Nie: persona física (extranjero residente)
- Passport: persona física (pasaporte)
- Rut: persona física (Chile/Uruguay, según despliegue)
interpretation:
`getIdentificationType()`: `@JsonView({ASM, CRM, COMPARATIVE_REQUEST})` --
visible en ASM, clave real `identificationType`. `CrmEnumJsonSerializer`
colapsa el enum a string en cualquier vista que no sea `API.V1`.
`IdentificationType.JURIDICAL_PERSON = List.of(CIF_MAPPING)` confirma que
`Cif` es el único valor que identifica persona jurídica.

---

## birthDate
field: birthDate
data_type: date
meaning: Date of birth of a person.
aliases:
- fecha de nacimiento
- nacido antes de
- nacido después de
interpretation:
`getBirthDate()`: `@JsonView({V1, V1_B2C, CRM, COMPARATIVE_REQUEST})` --
visible en ASM (V1 explícito), clave real `birthDate`. Sigue siendo válido
para una condición de fecha de calendario genuinamente fija (rara en la
práctica) -- para una condición de EDAD ("mayor de 25 años", "menor de 18
años"), usar el campo sintético `age` (ver a continuación), nunca un
entero directamente contra `birthDate`. El alias "edad" se retiró de aquí
(31/08) y vive ahora en `age`, para que el matching ontológico dirija las
menciones de edad al campo correcto desde el principio.

---

## age
field: age
data_type: integer
meaning: Age of a person, in years -- NOT the date of birth itself.
aliases:
- edad
- años de edad
- edad mínima
- edad máxima
interpretation:
**Sintético, añadido 31/08** -- no es un getter Java real, deriva de
`birthDate` (ver arriba). Mismo mecanismo ya validado con `licenseYears`
(patrón 3) y `registrationYears` (`ontology-auto.md`, patrón 1): decisión
explícita del usuario (31/08) de representar SIEMPRE la edad/antigüedad
como duración relativa, nunca como fecha absoluta -- el JSON de
dependencias alimenta expresiones SPEL que se persisten en BBDD y se
reutilizan para comparativas futuras, así que una fecha absoluta calculada
ahora quedaría obsoleta con el tiempo. Flujo 3 (aún sin construir esta
parte) debe traducirlo con el mismo helper real ya usado para
`licenseYears`/`registrationYears`: `$utils.dateLessThan(insurance["risk"]
.<figura>.birthDate, insurance['effectiveDate'], 'Nyear')` /
`dateLessOrEqualThan(...)`. No confundir con `licenseYears` (antigüedad
del CARNÉ) -- son dos condiciones distintas que pueden aparecer juntas en
la misma frase (ver `REGLA DE CARNÉ DE CONDUCIR` del prompt, ya advierte
de esto).

---

## drivingLicenses
field: drivingLicenses
data_type: list
meaning: Driving licenses held by a person -- a list, not a scalar.
aliases:
- carné de conducir
- antigüedad del carné
- permiso de conducir
interpretation:
`getDrivingLicenses()`: `@JsonView({V1, COMPARATIVE_REQUEST})` -- visible
en ASM, clave real `drivingLicenses`. No es un campo escalar -- no
extraer como risk_field/operator/value plano. Ver `licenseYears`/
`licenseType` (campos sintéticos derivados de esta lista, para las dos
condiciones reales que sí aparecen en condicionados: antigüedad y tipo
de carné).

---

## licenseType
field: licenseType
data_type: enum
meaning: Type/category of the person's relevant driving license -- car
license (B/LVA) for Autos, motorbike license (A/A1/A2/AM/LCM) for Motos.
aliases:
- carné A1
- carné A2
- carné tipo A
- carné B
- permiso A2
- carné de moto
values:
- A1: moto, edad mínima 15, hasta 125cc
- A2: moto, edad mínima 18, hasta 48cv
- A: moto, edad mínima 20
- AM: moto (ciclomotor), edad mínima 15, hasta 50cc
- LCM: moto (ciclomotor), edad mínima 14, hasta 50cc
- B: coche, edad mínima 18
- LVA: coche (vehículo agrícola), edad mínima 16
interpretation:
**Sintético, añadido 28/08** -- no es un getter Java real. `drivingLicenses`
(concepto anterior) es una lista de objetos `{type, date, issuingZone}`;
`type` vive dentro de un elemento de esa lista, no en el DTO de la
persona, así que no puede extraerse como campo escalar directo. Este
campo existe para que flujo 2 capture "qué tipo de carné" cuando el
condicionado lo menciona explícitamente -- mucho más relevante en Motos
(`Person.setMotorbikePermissionType`, sin valor por defecto, el usuario
elige el tipo real) que en Autos, donde el carné de coche se persiste
siempre con tipo fijo `B` sin preguntarlo (`Person.setPermissionDate` ->
`new DrivingLicense(new DriverLicenseType(DriverLicenseType.B),
permissionDate)`, confirmado en `avant-front/src/production/common/
components/Persons/utils.ts:248`, `person.drivingLicenseType ||
DrivingLicenseTypeId.B`). Flujo 3 (aún sin construir esta parte) debe
traducirlo a una selección real sobre la lista:
`insurance["risk"].<figura>.drivingLicenses.?[type.id == <id real>]`.
Si en el mismo bloque también aparece `licenseYears` para la misma
figura, ambas dependencias comparten la misma entrada de lista -- flujo
3 debe fusionarlas en una única selección en vez de generar dos
filtros independientes.

---

## licenseYears
field: licenseYears
data_type: integer
meaning: Years elapsed since the date of the person's relevant driving
license (car license for Autos, motorbike license for Motos) -- the
license's age, NOT the person's age.
aliases:
- antigüedad del carné
- antigüedad del permiso de conducir
- carné con menos de
- carné con más de
- años de carné
interpretation:
**Sintético, añadido 28/08** -- no es un getter Java real, deriva de
`drivingLicenses[].date` (`DrivingLicense.getDate()`,
`@JsonView({V1, COMPARATIVE_REQUEST})` -- confirmado accesible en ASM,
serializado como string `yyyy-MM-dd` vía `@JsonDate`, avant-back
`vehicle/dto/DrivingLicense.java`). Añadido tras confirmar (28/08) que
el gap no era de accesibilidad -- `DrivingLicense.java` sí expone
`date`/`type` -- sino de representación: un campo de lista no cabe en
la tripleta plana risk_field/operator/value de flujo 2. Flujo 3 (aún
sin construir esta parte) debe traducirlo con el helper ya real
`$utils.dateLessThan(init, end, offsetAndUnit)` / `dateLessOrEqualThan(
...)` (`AsmMethodsUtility`, expuesto al contexto SPEL como `$utils` en
`SpelContext.createContext`, ya usado en producción para validaciones
de tuning), filtrando antes la lista por el tipo de carné relevante del
ramo (`B`/`LVA` en Autos, `A`/`A1`/`A2`/`AM`/`LCM` en Motos) salvo que
`licenseType` haya fijado un valor concreto en el mismo bloque. Ejemplo
de expresión real esperada (Autos, "menos de 2 años"):
`!insurance["risk"].primaryDriver.drivingLicenses.?[type.id ==
4].isEmpty() and $utils.dateLessThan(insurance["risk"].primaryDriver.
drivingLicenses.?[type.id == 4][0].date, insurance['effectiveDate'],
'2year')`. Limitación conocida sin resolver: una condición de mera
EXISTENCIA/ausencia de carné ("carezca de permiso de conducir", sin
mencionar antigüedad ni tipo) no tiene campo dedicado todavía -- ni
`licenseYears` ni `licenseType` la representan, se omite la
dependencia (caso real: Axa su_00050).

---

## gender
field: gender
data_type: enum
meaning: Gender of a person.
aliases:
- sexo
- género
values:
- no confirmado -- catálogo respaldado en BBDD real (`Gender extends
  CrmEnumMappingDto`, mismo patrón que `identificationType`), pedir
  export real antes de dar valores concretos por buenos.
interpretation:
`getGender()`: `@JsonView({V1, CRM, COMPARATIVE_REQUEST})` -- visible en
ASM (V1 explícito), clave real `gender`. `CrmEnumJsonSerializer` colapsa
a string.

---

## maritalStatus
field: maritalStatus
data_type: enum
meaning: Marital status of a person.
aliases:
- estado civil
- casado
- soltero
- divorciado
- viudo
- pareja de hecho
values:
- Married: casado (`MaritalStatus.MARRIED`, `DTO_ID=1`)
- Divorced: divorciado (`MaritalStatus.DIVORCED`, `DTO_ID=2`)
- Single: soltero (`MaritalStatus.SINGLE`, `DTO_ID=3`)
- UnmarriedPartner: pareja de hecho (`MaritalStatus.PARTNER`, `DTO_ID=4`)
- Widowed: viudo (`MaritalStatus.WIDOWER`, `DTO_ID=5`)
interpretation:
`getMaritalStatus()`: `@JsonView({V1, CRM, COMPARATIVE_REQUEST})` --
visible en ASM (V1 explícito), clave real `maritalStatus`.
`CrmEnumJsonSerializer` colapsa el valor a su `ENUM_VALUE` real de
`CRM_ENUM_MAPPING` (`DTO_CLASS='MaritalStatus'`, `CRM_ONLY=0`) -- **no**
al nombre de la constante Java (`MaritalStatus.PARTNER`/`WIDOWER` no son
los strings reales, son solo los nombres internos de las constantes de
`ID`; el string SPEL real es `UnmarriedPartner`/`Widowed`). Confirmado
con export real de `CRM_ENUM_MAPPING` (26/08) -- los IDs 1-5 también
están grounded en uso real de producción (`getId()` comparado contra
`MaritalStatus.{MARRIED,DIVORCED,SINGLE,PARTNER,WIDOWER}` en
`AxaHealthUnmarshaller`, `ErpDataService`, `TestQuotationBuilder`). Existe
una 6ª fila `Separated` en `CRM_ENUM_MAPPING` con `CRM_ONLY=1`,
`DTO_ID=-1`, `COMPATIBLE_DTO_ID=2` -- valor de **entrada** solo-CRM, se
resuelve como `Divorced`, nunca aparece como valor de salida real. Existe
también un getter privado `getMaritalStatusB2c()`
(`@JsonProperty("maritalStatusId")`, `@JsonView(V1_B2C)`) -- NO accesible,
no usar `maritalStatusId`.

---

## nationality
field: nationality
data_type: enum
meaning: Nationality of a person.
aliases:
- nacionalidad
values:
- no confirmado -- catálogo de países (`Nationality extends MasterData`,
  patrón distinto de `identificationType`/`gender`, probablemente un
  catálogo grande tipo ISO), no enumerar sin export real.
interpretation:
`getNationality()`: `@JsonView({V1, CRM, COMPARATIVE_REQUEST})` -- visible
en ASM, clave real `nationality`.

---

## countryBirth
field: countryBirth
data_type: enum
meaning: Country of birth of a person -- distinct from `nationality`
(current citizenship vs. place of birth).
aliases:
- país de nacimiento
- lugar de nacimiento
interpretation:
`getCountryBirth()`: `@JsonView(ASM)` -- visible en ASM, clave real
`countryBirth`. `NationalityJsonSerializer` (serializador propio, no el
genérico Crm). Existe un `getBirthCountry()` duplicado con el mismo dato
pero `@JsonView(API.V1)` -- NO accesible, no usar ese nombre.

---

## isSmoker
field: isSmoker
data_type: boolean
meaning: Whether the person is a smoker.
aliases:
- fumador
- no fumador
interpretation:
`getIsSmoker()`: `@JsonView({ASM, CRM, COMPARATIVE_REQUEST})` -- visible
en ASM, clave real `isSmoker`.

---

## isFreelance
field: isFreelance
data_type: boolean
meaning: Whether the person is self-employed (freelance).
aliases:
- autónomo
- trabajador por cuenta propia
interpretation:
`getIsFreelance()`: `@JsonView(ASM)` -- visible en ASM, clave real
`isFreelance`.

---

## crmEmploymentStatus
field: crmEmploymentStatus
data_type: enum
meaning: Employment status of a person.
aliases:
- situación laboral
- empleo
values:
- no confirmado -- catálogo respaldado en BBDD real, pedir export si
  aparece una dependencia real.
interpretation:
**Cuidado con el nombre**: el campo Java `employmentStatus` NO tiene
ningún getter en `Person.java` -- no es accesible pese a existir el
campo. El campo realmente accesible y equivalente es `crmEmploymentStatus`
(`getCrmEmploymentStatus()`, `@JsonView({ASM, CRM})`, clave real
`crmEmploymentStatus`). Confirmado leyendo el fichero completo, no asumir
el nombre de negocio "employmentStatus" -- mismo tipo de trampa ya vista
con `kilometersPerYear`/`garageType` en Autos.

---

## economicInactivityStatus
field: economicInactivityStatus
data_type: EconomicInactivityStatus
meaning: Economic inactivity status of a person (e.g. retired,
unemployed) -- complex object, not a scalar.
interpretation:
`getEconomicInactivityStatus()`: `@JsonView(V1)` -- visible en ASM (V1
explícito), clave real `economicInactivityStatus`. Estructura interna del
objeto (`EconomicInactivityStatus`) sin investigar a fondo todavía --
sin alias hasta confirmar qué sub-campos son navegables y relevantes.

---

## weight
field: weight
data_type: number
meaning: Weight of the person (kg).
aliases:
- peso
negative_aliases:
- animales domésticos
- animal
- mascota
- remolque
- semirremolque
- caravana
- masa máxima autorizada
- PMA
- peso total
- peso máximo autorizado
- vehículo
interpretation:
`getWeight()`: `@JsonView({V1, V1_B2C, COMPARATIVE_REQUEST, CRM})` --
visible en ASM (V1 explícito), clave real `weight`.
**Falsos amigos reales, corregidos con `negative_aliases` (03/09, patrón 4
de la revisión global)**: el alias "peso" es el único que tiene este campo,
y en los condicionados de Autos aparece casi siempre referido a algo que
NO es una persona -- el peso de un animal transportado (Divina `su_00125`,
"animales domésticos, de hasta 75 kg. de peso"), el de un remolque (Axa
`su_00053`, "el peso del remolque no exceda de 750 Kg."), o el del propio
vehículo (Divina `su_00185` y Zurich `su_00039`, "peso total inferior a
3.500 Kg." / "PMA superior a 3.500 kg"). Los cuatro usos reales de este
campo en las 7 ejecuciones del 01/09 fueron errores de ese tipo, con la
regla del prompt ya puesta y con el ejemplo literal desde el 27/08. Estos
`negative_aliases` evitan que el campo llegue siquiera a ofrecerse como
candidato en esos fragmentos; el `Coverage Dependency Risk Field Guardrail`
v22 lo rechaza además de forma dura si el LLM lo usa igualmente.
**Importante**: NO existe ningún campo de peso del VEHÍCULO accesible
(comprobado en el backend real el 03/09: `Base7Version` no tiene peso ni
MMA; lo único parecido es `trailerMaxWeight` en
`AgriculturalMachineryRisk`, otro modelo). Para el peso del vehículo la
respuesta correcta es omitir o, si el texto realmente está clasificando el
vehículo, usar `base7Type.base7Category.id` (la frontera de los 3.500 kg
es la que separa primera de segunda categoría). Para el remolque, el campo
correcto es `lightTrailer` (`ontology-auto.md`).

---

## height
field: height
data_type: number
meaning: Height of the person.
aliases:
- altura
- estatura
interpretation:
`getHeight()`: `@JsonView({V1, V1_B2C, COMPARATIVE_REQUEST, CRM})` --
visible en ASM (V1 explícito), clave real `height`.

---

## job
field: job
data_type: Job
meaning: Coarse socio-professional category of a person (11 fixed
values: primary sector, administrative/technician, commercial/
industrial, self-employed, civil servant, householder, student,
pensioner, unemployed, other) -- complex object `{id, name}`, not a
scalar. **NOT** employer/job-title information despite the field name.
aliases:
- situación laboral
- categoría profesional
- categoría socioprofesional
values:
- PrimarySector (`Job.PRIMARY_SECTOR = 1`)
- AdministrativeOrTechnician (`Job.ADMINISTRATIVE_OR_TECHNICIAN = 2`)
- NotAdministrativeNorTechnician (`Job.NOT_ADMINISTRATIVE_NOR_TECHNICIAN = 3`)
- ComercialOrIndustrial (`Job.COMERCIAL_OR_INDUSTRIAL = 4`)
- SelfEmployed (`Job.SELF_EMPLOYED = 5`)
- CivilServant (`Job.CIVIL_SERVANT = 6`)
- Householder (`Job.HOUSEHOLDER = 7`)
- Student (`Job.STUDENT = 8`)
- Pensioner (`Job.PENSIONER = 9`)
- Unemployed (`Job.UNEMPLOYED = 10`)
- Other (`Job.OTHER = 11`)
interpretation:
**Ambigüedad con `economicOccupation` RESUELTA (26/08), sin necesidad de
condicionado real -- hallazgo de código**: `job` (`Job extends
MasterData`, tabla `JOB`) NO es información de empleador ni puesto de
trabajo concreto pese al nombre -- es una categoría socioprofesional
gruesa (11 valores fijos), y además es un campo **derivado**, no un dato
de entrada independiente: `PersonJobPostDeserializerHook` lo calcula
automáticamente a partir de `employmentStatus` + el código CNO-11 de
`economicOccupation` (si la persona está activa laboralmente), o de
`economicInactivityStatus` (si está inactiva -- jubilado, estudiante, ama
de casa...). `economicOccupation` (bloque siguiente) es la profesión
concreta y granular (catálogo CNO-11 real); `job` es un resumen/bucket
calculado a partir de ella, no una alternativa equivalente. Los 11 IDs
están grounded en uso real (`PersonJobPostDeserializerHook.java`,
comentario que enlaza el mapeo real en Notion); los `values:` de arriba
son los nombres de las constantes Java, **sin confirmar** contra la BBDD
real (tabla `JOB`, mismo patrón de cautela que otros catálogos
`MasterData`/`CrmEnumMappingDto` de este fichero -- pedir export si
aparece una dependencia real).
`getJob()`: `@JsonView({ASM, COMPARATIVE_REQUEST})` -- visible en ASM,
clave real `job`. Sub-campos accesibles: `id`/`name` de `Job`, ambos
`@JsonView({V1, COMPARATIVE_REQUEST})`.

---

## economicOccupation
field: economicOccupation
data_type: Cno11EconomicOccupation
meaning: Occupation of a person per the CNO-11 (Spanish official
occupation classification, INE) -- complex object with `code`/`name`/
`mainGroup` (section), not a scalar. Fine-grained, hundreds of real
occupation codes (e.g. "Oficiales de las fuerzas armadas").
aliases:
- ocupación
- actividad profesional
- profesión
interpretation:
`getEconomicOccupation()`: `@JsonView({V1, COMPARATIVE_REQUEST})` --
visible en ASM (V1 explícito), clave real `economicOccupation`.
**Ambigüedad con `job` RESUELTA (26/08)**, ver el bloque anterior: este
campo es la profesión real y granular (catálogo oficial CNO-11 del INE,
`Cno11EconomicOccupation extends CnoEconomicOccupation`), distinto de
`job` (categoría socioprofesional gruesa derivada). Para una condición
real de "profesión de riesgo" concreta, usar este campo; para una
condición por categoría laboral gruesa (autónomo/funcionario/
jubilado/estudiante...), usar `job`.

---

## sport
field: sport
data_type: Sport
meaning: Sport practiced by a person -- complex object, not a scalar.
aliases:
- deporte
- práctica deportiva
- deporte de riesgo
interpretation:
`getSport()`: `@JsonView({V1, COMPARATIVE_REQUEST})` -- visible en ASM (V1
explícito), clave real `sport`.

---

## annualIncomeRange
field: annualIncomeRange
data_type: enum
meaning: Annual income range of a person.
aliases:
- renta anual
- ingresos anuales
- nivel de ingresos
values:
- Low, LowerMiddle, Middle, UpperMiddle, High -- enum Java propio de la
  clase (`AnnualIncomeRange.ID`), probablemente los valores reales de la
  tabla BBDD que respalda `CrmEnumMappingDto`, pero sin confirmar al
  100% contra un export real -- mismo criterio de cautela que el resto de
  catálogos BBDD-backed de este fichero.
interpretation:
`getAnnualIncomeRange()`: `@JsonView({ASM, CRM, COMPARATIVE_REQUEST,
API.V1})` -- visible en ASM, clave real `annualIncomeRange`.

---

## economicActivities
field: economicActivities
data_type: list
meaning: Economic activities of a person/company per CNAE-2009 (Spanish
official economic activity classification) -- a list, not a scalar.
aliases:
- actividad económica
- CNAE
- sector de actividad
interpretation:
`getEconomicActivities()`: `@JsonView({V1, COMPARATIVE_REQUEST})` --
visible en ASM (V1 explícito), clave real `economicActivities`.

---

## employeesNumber
field: employeesNumber
data_type: integer
meaning: Number of employees (for a legal entity / company).
aliases:
- número de empleados
- plantilla
interpretation:
`getEmployeesNumber()`: `@JsonView({ASM, COMPARATIVE_REQUEST})` -- getter
privado pero visible en ASM (mismo patrón ya aceptado que
`circulationAddress` en Autos), clave real `employeesNumber`.

---

## yearlyBilling
field: yearlyBilling
data_type: integer
meaning: Yearly billing/turnover (for a legal entity / company).
aliases:
- facturación anual
- volumen de facturación
interpretation:
`getYearlyBilling()`: `@JsonView({ASM, CRM, COMPARATIVE_REQUEST})` --
getter privado pero visible en ASM, clave real `yearlyBilling`.

---

## incorporationDate
field: incorporationDate
data_type: date
meaning: Incorporation date (for a legal entity / company).
aliases:
- fecha de constitución
- antigüedad de la empresa
interpretation:
`getIncorporationDate()`: `@JsonView({ASM, COMPARATIVE_REQUEST})` --
getter privado pero visible en ASM, clave real `incorporationDate`.

---

## childrenNumber
field: childrenNumber
data_type: enum
meaning: Number of children of a person.
aliases:
- número de hijos
- hijos a cargo
values:
- no confirmado -- catálogo respaldado en BBDD real
  (`NumberOfChildren`), pedir export si aparece una dependencia real.
interpretation:
`getChildrenNumber()`: `@JsonView({ASM, COMPARATIVE_REQUEST})` -- getter
privado pero visible en ASM, clave real `childrenNumber`.
`CrmEnumJsonSerializer` colapsa a string.
