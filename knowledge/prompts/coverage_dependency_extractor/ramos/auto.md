“La garantía 'doble capital' tendrá efecto tras el fallecimiento del conductor asegurado que tuviera hijos menores de edad a su cargo... Dicha garantía multiplicará por dos la cantidad prevista para la cobertura de muerte”

→ NO es una dependencia. Describe EN QUÉ ESCENARIO el capital indemnizado se duplica, no si la garantía está incluida o excluida -- es un detalle de cálculo de la indemnización, igual que un límite o un porcentaje. No generes ninguna dependencia sobre la edad de los hijos/beneficiarios a partir de este tipo de cláusula.

REGLA DE ALCANCE DE LA GARANTÍA (A QUIÉN / QUÉ CUBRE)

Además de la regla anterior sobre el objeto físico de la cobertura, un texto puede describir el ALCANCE de una garantía -- a QUIÉN cubre, QUÉ tipos de evento cubre, o CON QUÉ MEDIOS se presta el servicio (p.ej. un vehículo de sustitución distinto del asegurado) -- sin que eso sea una condición de riesgo.

NO generes una dependencia cuando el texto:

* Define quién cuenta como asegurado/conductor cubierto para esta garantía concreta (p.ej. "el conductor, titular o autorizado, del vehículo asegurado...", bajo un epígrafe tipo "¿Quién está asegurado?").
* Describe un vehículo DISTINTO del vehículo asegurado (p.ej. el vehículo de sustitución/cortesía que proporciona la compañía), aunque use los mismos risk_field de tipo/motor que el vehículo asegurado.
* Enumera los tipos de evento o avería que la propia garantía cubre (p.ej. "cobertura... incluyendo falta de combustible, baterías, pérdida de llaves o pinchazo") -- esa lista ES la cobertura, no una condición sobre ella. Presta especial atención cuando el texto mencione "combustible" o "error/falta de combustible": es una AVERÍA del catálogo de eventos cubiertos por una garantía de asistencia, nunca un valor de base7Version.base7Engine.id (ese campo representa el TIPO de motor/combustible real del vehículo -- eléctrico, diésel, gasolina... -- no un incidente relacionado con el combustible). No generes "base7Version.base7Engine.id" con un value tipo "combustible equivocado", "combustible" o cualquier otra descripción de avería -- ninguno de esos valores es un tipo de motor real.
* Describe el propio evento asegurado que da derecho a la indemnización (p.ej. "para el caso de que le sea retirado el permiso de conducir" en una garantía de "retirada de carné") -- el evento cubierto no es una condición de riesgo, es lo que la garantía indemniza.
* Define A QUIÉN beneficia una garantía o ampliación según un atributo del Tomador/Asegurado (p.ej. "si el Tomador es persona física, la cobertura se aplica a él y su cónyuge; si es persona jurídica, se aplica a quien se acredite como conductor habitual") -- el atributo (persona física/jurídica) no activa ni desactiva la garantía, solo determina SOBRE QUIÉN recae el beneficio ya reconocido. No generes una dependencia de identificationType (ni de ningún otro campo) a partir de este tipo de cláusula.

PRUEBA: si eliminas la frase completa, ¿el texto que queda sigue siendo la descripción de qué/quién/cómo cubre esta garantía? Si sí, es alcance, no condición -- omite la dependencia.

EJEMPLOS ILUSTRATIVOS (Autos)

Texto: "El conductor, ya sea titular o autorizado, del vehículo asegurado..., así como cualquier persona que conduzca el vehículo siempre que su edad y antigüedad del carné... estén expresamente definidas en este contrato."

→ NO es una dependencia. Define QUIÉN cuenta como asegurado para esta garantía, no una condición de riesgo.

Texto: "Ponemos a tu disposición un turismo de alquiler... para sustituir tu vehículo asegurado mientras es reparado."

→ NO es una dependencia. Describe el VEHÍCULO DE SUSTITUCIÓN (distinto del asegurado), no el vehículo asegurado.

Texto: "El Asegurador da cobertura al vehículo Asegurado en caso de avería o accidente, incluyendo falta de combustible, baterías, pérdida de llaves o pinchazo."

→ NO es una dependencia. Es el catálogo de eventos que cubre la garantía de asistencia, no una condición.

Texto: "Si el vehículo quedara inmovilizado por error de combustible (entendiendo por tal que se haya repostado con un combustible no compatible con el vehículo)..." / "se garantiza reclamar a Estaciones de Servicio los daños sufridos por el vehículo asegurado al repostar con combustible equivocado" / "falta o error de combustible" (dentro de un catálogo de averías tipo "limpiaparabrisas, luces... batería descargada... pérdida o rotura de llaves").

→ NO es una dependencia en ninguno de los tres casos. Los tres describen una AVERÍA relacionada con el combustible (repostar mal, quedarse sin combustible) dentro del catálogo de eventos que cubre una garantía de asistencia en viaje -- no el tipo de motor del vehículo. NUNCA generes "base7Version.base7Engine.id" con value "combustible equivocado", "combustible" ni ninguna otra descripción de avería a partir de este tipo de cláusula -- omite la dependencia.

Texto: "Pago de una indemnización mensual para el caso de que al asegurado le sea retenido o retirado el Permiso de Conducir."

→ NO es una dependencia. La retirada del carné ES el evento asegurado de esta garantía (lo que indemniza), no una condición de riesgo previa.

Texto: "Sufridos por el Tomador como persona física, su cónyuge e hijos... En el supuesto de que el Tomador sea una persona jurídica, la aplicación de estas coberturas tendrán lugar a quien se acredite documentalmente como conductor habitual y autorizado del vehículo asegurado."

→ NO es una dependencia. Define A QUIÉN beneficia la "Ampliación reclamación Daños" según si el Tomador es persona física o jurídica (al propio Tomador y familia, o al conductor habitual) -- no condiciona si la garantía aplica o deja de aplicar, solo el destinatario del beneficio ya reconocido. No generes "identificationType = persona jurídica" ni ninguna variante con prefijo de figura (owner/primaryDriver/secondaryDriver) a partir de esta cláusula.

EJEMPLO ILUSTRATIVO (Autos)

Texto: “No obstante, en caso de siniestro, el Asegurador cubrirá los daños ocasionados en Equipos de Sonido y Accesorios no declarados... siempre que el importe total para el conjunto de Equipos de sonido y Accesorios instalados... no supere el límite máximo de 400 Euros... y 1.500 Euros...”, bajo un capítulo de EXCLUSIONES GENERALES del seguro (no una garantía concreta).

→ NO es una dependencia. Es una excepción a una exclusión general de póliza (no de una garantía concreta) que además fija un límite agregado sobre una lista (nonBase7Options), no una condición de existencia — no generes “nonBase7Options > 0” ni ninguna otra variante. Omite la dependencia.

EJEMPLO ILUSTRATIVO (Autos)

Texto: "En ningún caso se tomará en cuenta la profesión del asegurado, por lo que no podrá alegarse una agravación en la invalidez en base a la actividad profesional."

→ NO es una dependencia. El texto declara EXPLÍCITAMENTE que la profesión NO influye en el cálculo -- no exige que economicOccupation esté informado, ni condiciona la cobertura a ningún valor de ese campo.

Error a evitar: generar "economicOccupation != null" o cualquier variante de "existe/no existe" a partir de una cláusula de este tipo -- es lo opuesto de lo que dice el texto.

EJEMPLO ILUSTRATIVO (Autos)

Texto: "Al solicitar la prestación del servicio el asegurado deberá indicar: Nº de póliza o matrícula."

→ NO es una dependencia. Es una instrucción sobre qué dato aportar al llamar al servicio de asistencia, no una condición de aplicabilidad de la cobertura -- generar "registrationPlate != null" confunde un requisito de identificación operativa con una condición de riesgo.

EJEMPLO ILUSTRATIVO (Autos)

Texto: "Pólizas para un segundo vehículo con el mismo conductor: ... siempre que no hay en la unidad familiar hijos en edad comprendida entre 18 y 25 años."

→ NO es una dependencia. Es un requisito para poder contratar esta modalidad de póliza (segundo vehículo), no una condición sobre si una garantía dentro de la póliza ya contratada aplica o no.

REGLA DE ENTIDAD DEL CAMPO (PERSONA vs. VEHÍCULO/ANIMAL/OBJETO)

Cada risk_field de ontology_matches pertenece a una entidad concreta: una PERSONA (rutas owner.*, primaryDriver.*, secondaryDriver.*, o sin prefijo cuando el campo pertenece al tomador/holder), o el VEHÍCULO asegurado/otro objeto o animal descrito en el texto (base7Version.*, registrationPlate...).

Antes de usar un risk_field de una figura de PERSONA, verifica que el texto habla realmente de un atributo de esa PERSONA -- no de un vehículo, remolque, animal u otro objeto que simplemente comparte el nombre del concepto (p.ej. "peso", "tamaño").

Si el texto condiciona la cobertura por un atributo de un VEHÍCULO, un ANIMAL o un OBJETO, y el único risk_field disponible en ontology_matches para ese atributo pertenece a una PERSONA, NO uses ese campo: omite la dependencia. Es preferible omitir que asignar el atributo de un vehículo/animal/objeto a un campo de una persona solo porque el nombre del concepto coincide.

EJEMPLO ILUSTRATIVO (Autos)

Texto: "vehículos de cuatro o más ruedas, con peso superior a 3.500 kg"

→ Los risk_field de tipo "peso" suelen ser TODOS de PERSONA, con independencia de si llevan prefijo o no: "weight" (SIN prefijo -- peso del TOMADOR/holder, no del vehículo, aunque no lleve ningún prefijo de figura), "owner.weight" (peso del PROPIETARIO), "primaryDriver.weight"/"secondaryDriver.weight" (peso de un conductor). Ninguno de ellos describe el peso del VEHÍCULO -- NO generes "weight > 3500" NI "owner.weight > 3500" NI ninguna otra variante con prefijo: son exactamente el mismo error, cambie o no el prefijo. Omite la dependencia.

Texto: "los gastos ocasionados por el traslado de los animales domésticos, de hasta 75 kg. de peso"

→ Mismo caso: el peso es del ANIMAL, no de ninguna persona (con o sin prefijo). No generes "weight <= 75" ni "owner.weight <= 75". Omite la dependencia.

Texto: "Desde la fecha de primera matriculación hasta el segundo año de antigüedad del vehículo, se indemnizará por el valor a nuevo."

→ La antigüedad es del VEHÍCULO (desde su matriculación), no de ninguna persona. NO generes "owner.birthDate >= 2" ni ninguna otra variante con birthDate (con o sin prefijo de figura) -- birthDate es la fecha de nacimiento de una PERSONA, no tiene relación con la matriculación del vehículo. Usa "registrationYears" (ver REGLA DE ANTIGÜEDAD RELATIVA a continuación).

REGLA DE SELECCIÓN DE FIGURA (PERSONA)

Cuando el risk_field pertenece a una figura de PERSONA, el vocabulario del texto determina QUÉ figura corresponde -- nunca asumas una figura por defecto ni reutilices la misma figura que usaste antes en la unidad sin comprobar de nuevo el texto concreto:

* "Tomador", "titular de la póliza", "quien contrata el seguro" → SIN PREFIJO (identificationType, birthDate... -- es el tomador/holder, NO el propietario).
* "Propietario", "titular del vehículo" → prefijo "owner." (owner.identificationType...).
* "Conductor Habitual", "conductor principal" → prefijo "primaryDriver.".
* "Conductor Ocasional", "conductor secundario" → prefijo "secondaryDriver.".

Si el texto menciona la misma figura (p.ej. "el Tomador") más de una vez dentro de la misma unidad, usa la MISMA figura en todas las dependencias que se refieran a ella -- no generes una vez "owner.identificationType" y otra vez "identificationType" (sin prefijo) para la misma mención de "Tomador": son la misma persona, deben usar la misma figura.

Cuando el texto diga "el Conductor" o "quien conduzca" SIN especificar si es habitual u ocasional, y ninguna otra parte del texto lo aclare, NO elijas una figura al azar ni la dupliques en primaryDriver y secondaryDriver -- omite la dependencia, es preferible omitir que asignar una figura arbitraria.

Excepción: si el propio texto declara EXPLÍCITAMENTE que aplica a ambos roles (p.ej. "ya sea principal u ocasional", "conductor habitual o autorizado"), sí es correcto generar dos dependencias, una por figura -- en ese caso no es una elección arbitraria, el texto lo pide.

EJEMPLO ILUSTRATIVO (Autos)

Texto: "Sufridos por el Tomador como persona física... En el supuesto de que el Tomador sea una persona jurídica..."

→ Dos dependencias, ambas SIN PREFIJO (identificationType = "persona física" / identificationType = "persona jurídica") -- "Tomador" es siempre la misma figura (holder) en las dos menciones. Error a evitar: generar "owner.identificationType" para la primera mención y "identificationType" para la segunda -- son la misma persona, no pueden tener figuras distintas.

Texto: "Los producidos cuando el conductor carezca del correspondiente permiso de conducir..." (sin mencionar en ningún otro punto de la unidad si es el conductor habitual o el ocasional)

→ No hay forma de saber a qué figura se refiere "el conductor". Omite la dependencia -- no generes "secondaryDriver.drivingLicenses" ni "primaryDriver.drivingLicenses" por elección arbitraria.

REGLA DE CARNÉ DE CONDUCIR (CAMPO DE LISTA)

El campo drivingLicenses (con o sin prefijo de figura: drivingLicenses, owner.drivingLicenses, primaryDriver.drivingLicenses, secondaryDriver.drivingLicenses) es una LISTA de carnés, no un campo escalar. NUNCA generes una dependencia con risk_field terminado en "drivingLicenses" directamente -- ni "!= null", ni ">= N", ni ningún otro operador. Ese risk_field existe en ontology_matches solo para que reconozcas el concepto, no para que lo uses tal cual en una dependencia.

Cuando el texto condiciona la cobertura por la ANTIGÜEDAD del carné (años transcurridos desde su fecha de expedición -- p.ej. "con menos de 2 años de antigüedad del permiso de conducir", "carné con más de 3 años"), usa en su lugar el campo derivado licenseYears (mismo prefijo de figura: primaryDriver.licenseYears, secondaryDriver.licenseYears...), con operator de comparación numérica ("<", "<=", ">", ">=") y value = número de años.

Cuando el texto condiciona la cobertura por el TIPO de carné (p.ej. "carné A2", "carné tipo B"), usa el campo derivado licenseType (mismo prefijo de figura), con operator "=", "!=", "IN" o "NOT_IN" y value = el tipo tal cual aparece en el texto (misma regla de formato de valores enum que el resto de campos enum -- nunca un identificador inventado).

No confundas la antigüedad del CARNÉ con la EDAD de la persona: "edad igual o superior a 25 años" es birthDate, no licenseYears -- aunque ambas condiciones aparezcan juntas en la misma frase, son dos dependencias distintas sobre dos campos distintos.

Si el texto solo declara que el conductor DEBE TENER o CAREZCA de carné (sin mencionar antigüedad ni tipo -- p.ej. "conductores que carezcan del correspondiente permiso de conducir", "que no tengan carné de conducir"), ningún campo actual de la ontología representa esa condición de mera existencia -- omite la dependencia en vez de forzarla sobre drivingLicenses, licenseYears o licenseType.

EJEMPLO ILUSTRATIVO (Autos)

Texto: "Los daños sufridos por el vehículo asegurado cuando éste sea conducido por una persona menor de 25 años o con menos de 2 años de antigüedad del permiso de conducir."

→ Dos dependencias: risk_field "primaryDriver.age", operator "<", value 25 (edad) y risk_field "primaryDriver.licenseYears", operator "<", value 2 (antigüedad del carné) -- del conductor que corresponda según el texto.

Error a evitar: generar "primaryDriver.drivingLicenses != null", "primaryDriver.drivingLicenses >= 2" o cualquier variante con risk_field terminado en "drivingLicenses" -- es una lista, no puede compararse directamente con un operador escalar.

REGLA DE ANTIGÜEDAD RELATIVA (VEHÍCULO)

El campo registrationDate (fecha de matriculación del vehículo) es una fecha ABSOLUTA. Una condición de antigüedad expresada en AÑOS ("con menos de 5 años de antigüedad", "matriculado hace más de 3 años") es siempre una duración RELATIVA a la fecha de evaluación, no una fecha fija -- NUNCA generes un entero de años directamente contra registrationDate (p.ej. "registrationDate < 5"): esa comparación no tiene sentido contra una fecha absoluta.

En su lugar, usa el campo derivado registrationYears, con operator de comparación numérica ("<", "<=", ">", ">=") y value = número de años.

registrationDate sigue siendo el campo correcto únicamente para una condición de fecha de calendario genuinamente fija y no relativa a la fecha de evaluación (p.ej. "vehículos matriculados a partir del 1 de enero de 2020") -- en ese caso sí es correcto un value de fecha ISO o un año de 4 cifras real, nunca un entero pequeño que en realidad representa una duración.

Para la EDAD de una persona (no la antigüedad del vehículo), ver la REGLA DE ANTIGÜEDAD RELATIVA (PERSONA) del núcleo -- misma lógica, campo derivado age.

EJEMPLO ILUSTRATIVO (Autos)

Texto: "Desde la fecha de primera matriculación hasta el segundo año de antigüedad del vehículo, se indemnizará por el valor a nuevo. Durante el tercero, cuarto y quinto año de antigüedad del vehículo se indemnizará por el valor de mercado ampliado."

→ Dos dependencias sobre "registrationYears": operator "<", value 2 (primera variante) y operator ">=", value 3 (segunda variante) -- selección entre variantes de indemnización según la antigüedad del vehículo.

Error a evitar: generar "owner.birthDate >= 2" o cualquier variante con birthDate -- confunde la antigüedad del VEHÍCULO con la fecha de nacimiento de una PERSONA, y además usa un entero pequeño (una duración) contra un campo de fecha absoluta.

REGLA DE CATEGORÍA DE VEHÍCULO IMPLÍCITA POR EL PROPIO CAPÍTULO

Cuando coverage_context.article o algún nivel de coverage_path declara explícitamente una categoría de vehículo concreta (p.ej. "ANEXO 1. VEHÍCULOS DE SEGUNDA CATEGORÍA", "ANEXO 2. VEHÍCULOS TERCERA CATEGORÍA"), esa categoría es la condición REAL que aplica a TODO el texto de esa unidad -- aunque el propio texto solo mencione OTRA categoría de forma comparativa o referencial (p.ej. "Además de los indicados para los vehículos de primera categoría, quedan excluidos de la presente garantía...").

Si generas una dependencia sobre base7Version.base7Type.base7Category.id para un texto que vive dentro de un capítulo así, usa como value la categoría del PROPIO capítulo (operador "="), no la categoría mencionada de forma comparativa en la frase.

EJEMPLO ILUSTRATIVO (Autos)

coverage_context.article: "ANEXO 2. VEHÍCULOS TERCERA CATEGORÍA"
Texto: "Además de los indicados para los vehículos de primera categoría, quedan excluidos de la presente garantía: ..."

→ La condición real es "base7Version.base7Type.base7Category.id = tercera categoría" (la categoría del PROPIO anexo, no la mencionada en la frase). NUNCA generes "NOT_IN [primera categoría]" en este caso -- esa condición dejaría pasar también a los vehículos de segunda categoría, que no es a quienes aplica esta cláusula (vive específicamente en el anexo de tercera categoría).
