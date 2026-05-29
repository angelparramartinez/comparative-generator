# Home Insurance Ontology

OntologyType: home

---

# =====================================================
# RISK CONCEPTS
# =====================================================

## address

Meaning:
Postal address of the insured property.

Aliases:
- dirección
- ubicación
- domicilio del riesgo
- emplazamiento
- localización postal

Interpretation:
Identifies the insured property and determines
postal code, geographic zone, catastrophe exposure
and underwriting validations.

---

## continent

Meaning:
Insured building capital.

Aliases:
- continente
- inmueble
- construcción
- edificación
- vivienda

Interpretation:
Represents structural and fixed elements:
walls, roofs, floors, installations,
windows and permanent fixtures.

---

## content

Meaning:
Insured contents capital.

Aliases:
- contenido
- mobiliario
- ajuar
- enseres
- bienes muebles

Interpretation:
Represents furniture, appliances,
clothing and personal belongings.

---

## capitalInsuranceType

Meaning:
Capital insurance methodology.

Aliases:
- modalidad de capital
- forma de aseguramiento
- criterio indemnizatorio

Relevant values:
- valor de reposición
- primer riesgo

Interpretation:
Defines how compensation is calculated
after a loss.

---

## housingUse

Meaning:
Occupancy pattern of the dwelling.

Aliases:
- ocupación
- uso de vivienda
- residencia

Relevant values:
- vivienda habitual
- segunda residencia
- vivienda vacía

Interpretation:
Many coverages and exclusions depend
on occupancy level.

---

## housingRegime

Meaning:
Relationship between insured person
and dwelling.

Aliases:
- propietario
- inquilino
- vivienda alquilada
- régimen de ocupación

Interpretation:
Determines insurable interest over
building and contents.

---

## constructionYear

Meaning:
Year when the building was constructed.

Aliases:
- año de construcción
- antigüedad de construcción
- año de edificación
- yearBuilt

Interpretation:
Building age influences water damage,
electrical risks and maintenance exposure.

---

## lastReformYear

Meaning:
Year of last major renovation.

Aliases:
- reforma integral
- rehabilitación
- renovación

Interpretation:
Recent renovations generally reduce
technical risks.

---

## isReformed

Meaning:
Whether the property has been renovated.

Aliases:
- vivienda reformada
- inmueble renovado

Interpretation:
Simplified underwriting indicator
derived from renovation information.

---

## floorArea

Meaning:
Property surface area.

Aliases:
- metros cuadrados
- superficie
- área construida
- superficie habitable
- meters

Interpretation:
Used to estimate rebuilding cost and
contents exposure.

---

## rooms

Meaning:
Number of rooms.

Aliases:
- habitaciones
- estancias
- cuartos
- roomsNumber

Interpretation:
Indirect indicator of size, occupancy
and insured value.

---

## buildingType

Meaning:
Type of dwelling.

Aliases:
- tipo de vivienda
- chalet
- adosado
- ático
- planta baja

Interpretation:
Determines exposure to theft,
weather events and liability risks.

---

## buildQuality

Meaning:
Construction quality.

Aliases:
- calidad constructiva
- calidad de construcción
- acabados

Relevant values:
- básica
- normal
- alta
- lujo

Interpretation:
Affects rebuilding cost and insured value.

---

## materials

Meaning:
Construction materials.

Aliases:
- materiales constructivos
- composición estructural

Relevant values:
- no combustibles
- parcialmente combustibles
- altamente combustibles

Interpretation:
Impacts fire propagation risk.

---

## location

Meaning:
Geographical environment.

Aliases:
- ubicación
- entorno
- emplazamiento

Relevant values:
- centro urbano
- urbanización
- zona aislada

Interpretation:
Influences theft frequency and emergency response.

---

## alarm

Meaning:
Alarm system installed.

Aliases:
- alarma
- alarma antirobo
- sistema de alarma
- protección electrónica

Relevant values:
- sin alarma
- alarma no conectada
- alarma conectada a central

Interpretation:
Can reduce theft exposure and may become
mandatory above certain insured values.

---

## principalDoorSecurity

Meaning:
Main entrance security level.

Aliases:
- puerta blindada
- puerta de seguridad
- acceso seguro
- securityMainDoor

Interpretation:
Important theft prevention measure.

---

## secondaryDoorsSecurity

Meaning:
Secondary access protection.

Aliases:
- seguridad accesos secundarios
- puertas traseras protegidas

Interpretation:
Relevant especially in detached houses.

---

## windowSecurity

Meaning:
Window protection measures.

Aliases:
- rejas
- ventanas protegidas
- securityWindows

Interpretation:
Important theft mitigation control.

---

## securityGuard

Meaning:
Private security presence.

Aliases:
- vigilante
- seguridad privada

Interpretation:
Reduces burglary exposure.

---

## closedUrbanization

Meaning:
Property located in gated community.

Aliases:
- urbanización cerrada
- gatedCommunity
- recinto privado

Interpretation:
Can reduce theft and vandalism risk.

---

## jewelry

Meaning:
Jewelry and precious personal valuables.

Aliases:
- joyas
- relojes
- alhajas
- objetos preciosos
- joyería

Interpretation:
May require declaration,
specific insured capital
or special protection measures.

---

## jewelryInSafeBox

Meaning:
Jewelry stored inside a safe.

Aliases:
- joyas en caja fuerte
- joyería protegida

Interpretation:
Lower theft exposure.

---

## jewelryOutSafeBox

Meaning:
Jewelry not stored in a safe.

Aliases:
- joyas sin protección
- joyas fuera de caja fuerte

Interpretation:
Higher theft exposure and often
subject to lower indemnity limits.

---

## safeBox

Meaning:
Physical safe used to protect valuables.

Aliases:
- caja fuerte
- caja de seguridad

Interpretation:
Often required for high-value jewelry coverage.

---

## specialValueObjects

Meaning:
High value declared items.

Aliases:
- objetos especiales
- objetos valiosos
- bienes de valor
- obras de arte
- colecciones
- antigüedades

Interpretation:
Usually require specific declaration
and dedicated coverage limits.

---

## dangerousDogs

Meaning:
Potentially dangerous dogs.

Aliases:
- PPP
- perros peligrosos

Interpretation:
Increases liability exposure.

---

# =====================================================
# INSURANCE CONCEPTS
# =====================================================

## coverage

Meaning:
Insurance protection granted by the policy.

Aliases:
- cobertura
- garantía
- protección aseguradora

Interpretation:
Represents a benefit or protection available
under specific conditions.

---

## optionalCoverage

Meaning:
Coverage requiring explicit purchase.

Aliases:
- garantía opcional
- cobertura opcional
- contratación opcional

Interpretation:
Only applies if explicitly contracted.

---

## insuredCapital

Meaning:
Declared insured amount.

Aliases:
- capital asegurado
- suma asegurada
- capital declarado

Interpretation:
Maximum reference amount used for indemnity.

---

## firstRisk

Meaning:
First risk insurance basis.

Aliases:
- primer riesgo

Interpretation:
Coverage without proportional rule
up to a predefined limit.

---

## indemnityLimit

Meaning:
Maximum payable amount.

Aliases:
- límite
- máximo
- importe máximo
- límite indemnizatorio

Interpretation:
Restricts compensation amount.

---

## sublimit

Meaning:
Limit applicable to a specific coverage.

Aliases:
- sublímite
- límite específico

Interpretation:
Restricts compensation within a broader coverage.

---

## deductible

Meaning:
Part of the loss borne by the insured.

Aliases:
- franquicia
- deducible

Interpretation:
Amount deducted from compensation.

---

## specificDeclaration

Meaning:
Requirement for explicit declaration.

Aliases:
- declaración expresa
- declarado expresamente
- incluido en condiciones particulares
- constará en condiciones particulares

Interpretation:
Coverage only exists if the item has been
specifically declared.

---

## particularConditions

Meaning:
Policy-specific conditions.

Aliases:
- condiciones particulares

Interpretation:
Overrides or complements general conditions.

---

## securityRequirement

Meaning:
Protection measure required by insurer.

Aliases:
- medida de seguridad
- requisito de seguridad
- protección obligatoria

Interpretation:
Coverage validity depends on the presence
of specific protection measures.

---

## exclusion

Meaning:
Situation not covered by insurance.

Aliases:
- exclusión
- no cubierto
- queda excluido

Interpretation:
Circumstance where compensation is denied.

---

## requirement

Meaning:
Condition that must be fulfilled.

Aliases:
- requisito
- condición previa
- condición de aplicación

Interpretation:
Coverage depends on compliance with
the specified condition.

---

## percentageLimit

Meaning:
Limit expressed as percentage.

Aliases:
- porcentaje
- % del capital
- porcentaje del capital asegurado

Interpretation:
Compensation limited by a percentage
of another insured amount.