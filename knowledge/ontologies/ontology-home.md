# Home Insurance Ontology v1.5

OntologyType: home

## address
risk_field: address
data_type: PostalAddress
meaning: Postal address of the insured property.
aliases:
- dirección
- domicilio del riesgo
- ubicación del inmueble
- emplazamiento
contractual_examples:
- inmueble situado en
- vivienda ubicada en
interpretation:
Identifies the insured location.

---

## continent
risk_field: continent
data_type: integer
meaning: Insured building capital.
aliases:
- continente
- continente asegurado
- capital de continente
contractual_examples:
- siempre que exista continente asegurado
- cuando se asegure el continente
interpretation:
Building capital declared by the insured.

---

## content
risk_field: content
data_type: integer
meaning: Insured contents capital.
aliases:
- contenido
- contenido asegurado
- capital de contenido
- ajuar doméstico
- enseres
- mobiliario
- mobiliario asegurado
- mobiliario y enseres
- capital de mobiliario
contractual_examples:
- siempre que exista contenido asegurado
- cuando se asegure el contenido
- cuando se asegure el mobiliario
interpretation:
Contents capital declared by the insured.

---

## capitalInsuranceType
risk_field: capitalInsuranceType
data_type: enum
aliases:
- primer riesgo
- valor de reposición
- modalidad de aseguramiento

---

## housingUse
risk_field: housingUse
data_type: enum
meaning: Usage category of the insured dwelling (main residence, secondary residence, seasonal/tourist use, vacant, etc).
aliases:
- segunda residencia
- vivienda vacía
- vivienda desocupada
- uso turístico
- alquiler vacacional
- vivienda de temporada
- vivienda habitual
- residencia principal
- domicilio habitual
- vivienda principal
- vivienda secundaria
contractual_examples:
- en segundas residencias
- cuando la vivienda permanezca desocupada
- vivienda destinada a alquiler vacacional
- inmueble destinado a uso turístico
- vivienda ocupada únicamente por temporadas
- siempre que constituya vivienda habitual
- cuando se trate de residencia principal
- cuando se trate de Vivienda principal o Vivienda secundaria
- esta cobertura solo se aplica cuando se trate de vivienda principal
interpretation:
Unifica el concepto general de uso de la vivienda con el concepto derivado
"vivienda habitual/residencia principal" (antes duplicado en un bloque
separado `isMainResidence`, mismo risk_field). Consolidado en la Fase 2
del plan de mejora de extracción de condiciones tras confirmarse que las
frases reales "vivienda principal"/"vivienda secundaria" del condicionado
no tenian alias literal, lo que provocaba que el LLM extractor inventara
risk_field como "property_use"/"property_type" o reutilizara "content" de
forma incorrecta (casos su_00059, su_00080, su_00064, su_00071).

---

## housingRegime
risk_field: housingRegime
data_type: enum
aliases:
- propietario
- inquilino
- arrendatario
- vivienda alquilada
negative_aliases:
- comunidad de propietarios
- junta de propietarios
- junta de copropietarios
interpretation:
Los negative_aliases excluyen el uso mas frecuente de "propietario" en el
condicionado de Hogar: pertenencia a la comunidad de vecinos del edificio,
que no tiene relacion con el regimen de tenencia de la vivienda del
asegurado. Ver caso real su_00161 (CLAUDE.md §5.1).

---

## constructionYear
risk_field: constructionYear
data_type: integer
aliases:
- año de construcción
- antigüedad del inmueble

---

## lastReformYear
risk_field: lastReformYear
data_type: integer
aliases:
- reforma integral
- rehabilitación
- renovación
negative_aliases:
- cláusula de renovación
- sin cláusula de renovación
interpretation:
El negative_alias excluye el sentido de "renovación" como renovación de un
contrato de alquiler, sin relacion con reformar la vivienda. Ver caso real
su_00196 (CLAUDE.md §5.1).

---

## isReformed
risk_field: isReformed
data_type: boolean
aliases:
- vivienda reformada
- inmueble reformado

---

## floorArea
risk_field: floorArea
data_type: integer
aliases:
- metros cuadrados
- superficie de la vivienda
- superficie construida

---

## rooms
risk_field: rooms
data_type: integer
aliases:
- habitaciones
- estancias
- cuartos
contractual_examples:
- viviendas con más de cinco habitaciones
- cuando la vivienda disponga de cuatro cuartos

---

## buildingType
risk_field: buildingType
data_type: enum
aliases:
- chalet
- vivienda unifamiliar
- adosado
- ático
- planta baja
- piso

---

## buildQuality
risk_field: buildQuality
data_type: enum
aliases:
- calidad constructiva
- acabados

---

## materials
risk_field: materials
data_type: enum
aliases:
- materiales constructivos

---

## location
risk_field: location
data_type: enum
aliases:
- entorno
- zona aislada

---

## alarm
risk_field: alarm
data_type: enum
meaning: Home alarm/security system installed and its status.
aliases:
- alarma
- alarma conectada
- sistema de alarma
- CRA
- central receptora de alarmas
- existe alarma
- dispone de alarma
- vivienda con alarma
- sistema de alarma instalado
- alarma operativa
contractual_examples:
- siempre que exista alarma conectada
- viviendas protegidas mediante alarma
- siempre que exista alarma
- cuando la vivienda disponga de alarma
interpretation:
Unifica el concepto general de alarma con el concepto derivado "existe
alarma" (antes duplicado en un bloque separado `hasAlarm`, mismo
risk_field). Consolidado en la Fase 2 del plan de mejora de extracción de
condiciones (mismo motivo que housingUse/isMainResidence).

---

## principalDoorSecurity
risk_field: principalDoorSecurity
data_type: boolean
aliases:
- puerta blindada
- puerta acorazada
- puerta de seguridad
- cerradura de seguridad
- puerta reforzada

---

## secondaryDoorsSecurity
risk_field: secondaryDoorsSecurity
data_type: boolean
aliases:
- accesos secundarios protegidos
- puertas traseras protegidas

---

## windowSecurity
risk_field: windowSecurity
data_type: boolean
aliases:
- rejas
- ventanas protegidas

---

## securityGuard
risk_field: securityGuard
data_type: boolean
aliases:
- vigilante
- vigilancia privada

---

## closedUrbanization
risk_field: closedUrbanization
data_type: boolean
aliases:
- urbanización cerrada
- recinto privado
- urbanización privada
- recinto cerrado

---

## jewelryInSafeBox
risk_field: jewelryInSafeBox
data_type: integer
aliases:
- joyas en caja fuerte
- joyas y relojes de valor en caja fuerte
- relojes de valor en caja fuerte
- joyas depositadas en caja fuerte
- alhajas en caja fuerte

---

## jewelryOutSafeBox
risk_field: jewelryOutSafeBox
data_type: integer
aliases:
- joyas fuera de caja fuerte
- joyas y relojes de valor fuera de caja fuerte
- relojes de valor fuera de caja fuerte
- joyas no depositadas en caja fuerte
- alhajas fuera de caja fuerte

---

## specialValueObjects
risk_field: specialValueObjects
data_type: integer
aliases:
- objetos especiales
- bienes especiales
- bienes de valor
- objetos de valor especial
- obras de arte
- colecciones
- antigüedades
contractual_examples:
- cuando existan bienes especiales asegurados
- si se declaran obras de arte
- cuando se aseguren antigüedades

---

## dangerousDogs
risk_field: dangerousDogs
data_type: integer
aliases:
- PPP
- perros potencialmente peligrosos
