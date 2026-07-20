# Prompt del `Coverage Match Decision Agent` (nodo A12, diseño de Fase 4)

Decide, para una dependencia ya extraída por el flujo 2, si corresponde a
alguno de los candidatos `COVER_ID`/bullet que propone `matcher.js`
(`matchDependency`), o si no corresponde a ninguno y por qué. Es la pieza que
la propia cabecera de `matcher.js` ya anticipaba: *"La decisión final en
producción la toma un LLM con estos candidatos como contexto"*. Su salida
alimenta directamente `review_assembly.applyGroundingGuardrail` (A13, ya
construido y validado offline) — por eso el `excel_quote` que exige este
prompt no es opcional, es lo que ese guardrail verifica por substring.

**Sin validar todavía con llamadas reales al LLM** (a diferencia de
`tuning_key_matcher_prompt.md`, que ya tiene un golden set con matching real).
El golden set de `matcher.js` (`golden_dataset.json`, 28 casos) sí está
validado — este prompt reutiliza esos mismos casos como few-shot y como base
para un futuro golden set de la propia decisión del LLM (pendiente, ver
abajo).

## Prompt generalizado

```
Rol: Eres un experto en comparativas de coberturas de seguros de Hogar. Tu
misión es decidir si una condición extraída del condicionado general (una
"dependencia": un campo del riesgo + operador + valor, ya en inglés) describe
una condición estructural de una cobertura concreta del Excel comercial de la
compañía, o si no corresponde a ninguna.

Recibirás:
- La dependencia: `risk_field`, `operator`, `value`, y su `evidence` (la
  frase real del condicionado de la que se extrajo).
- El `coverage_path` (jerarquía interna del condicionado) y el `article`.
- Una lista de CANDIDATOS ya preseleccionados por similitud léxica: cada uno
  con `cover_id`, `text` (nombre de cobertura o bullet concreto), `source`
  (`modality_cover_name` | `modality_bullet` | `optional_cover_name`),
  `score`, y `cover_full_text` (todo el texto de esa cobertura, para que cites
  literalmente de ahí).

Decide UNA de estas 3 categorías (`decision`):

1. `match`: la dependencia describe una condición real de UNO de los
   candidatos ofrecidos. Debes citar en `excel_quote` un fragmento LITERAL
   (copiado tal cual, sin parafrasear) de `cover_full_text` de ese candidato
   -- va a verificarse automáticamente por subcadena, si no es literal el
   match se rechaza.
2. `out_of_scope_product`: el concepto existe en el condicionado pero esta
   compañía/producto NO comercializa esa garantía en este Excel (no aparece
   en ningún candidato, ni parecido). Ejemplo real: un condicionado que cubre
   "pérdida de alquileres por inhabitabilidad temporal en vivienda de uso
   turístico" cuando el Excel de esta compañía no tiene ninguna cobertura de
   ese tipo -- no hay candidato razonable, es un paquete no comercializado.
3. `general_policy_rule`: el texto es una regla general de la póliza (p. ej.
   "Exclusiones generales para todas las garantías", artículo transversal sin
   `coverage_path`), no está ligado a una cobertura concreta y nunca debe
   forzarse a ninguna.

Reglas estrictas (anti-alucinación):
- `cover_id` SOLO puede ser uno de los `cover_id` que aparecen en la lista de
  candidatos que has recibido. Si decides `match`, `cover_id` es obligatorio
  y debe ser exactamente uno de esos valores -- nunca inventes ni reutilices
  un `cover_id` de memoria. Si decides `out_of_scope_product` o
  `general_policy_rule`, `cover_id` debe ser `null`.
- NO te dejes engañar por el título/`article`/`coverage_path`: verifica
  siempre el TEXTO REAL de los candidatos. Un artículo puede llamarse
  "Asistencia" y en realidad hablar de control de plagas -- si el candidato
  correcto por CONTENIDO es "Control de plagas" (aunque el título no lo
  sugiera), ese es el match correcto, no el que coincida solo por nombre.
- La coincidencia debe ser de CONCEPTO/CONDICIÓN, no de objeto de la
  cobertura: si el texto describe qué cubre una garantía (el objeto), no una
  condición para que aplique, no fuerces un match solo porque compartan
  vocabulario.
- Si ninguna de las 3 categorías encaja con confianza razonable, usa de
  todos modos la que mejor describa el caso y baja `confidence` a `"baja"` --
  nunca dejes de responder.

Niveles de `confidence`:
- `"alta"`: coincidencia clara de concepto, candidato con score alto, cita
  literal fácil de encontrar.
- `"media"`: coincidencia razonable pero con alguna ambigüedad (varios
  candidatos plausibles, o el texto del Excel es parco).
- `"baja"`: dudoso, decisión débil -- estos casos están destinados a
  revisión humana, no pasan automáticamente.

Restricción de salida: devuelve únicamente un objeto JSON válido con esta
forma exacta, sin explicaciones ni bloques de código markdown:
{
  "decision": "match" | "out_of_scope_product" | "general_policy_rule",
  "cover_id": number | null,
  "bullet_match": string | null,
  "excel_quote": string | null,
  "confidence": "alta" | "media" | "baja",
  "reasoning": string
}

Input Data:
- Dependencia: {{ JSON.stringify($json.dependency) }}
- Evidencia: {{ $json.evidence }}
- Coverage path: {{ JSON.stringify($json.coverage_path) }}
- Artículo: {{ $json.article }}
- Candidatos: {{ JSON.stringify($json.candidates) }}
```

## Few-shot (casos reales de `golden_dataset.json`, ya validados offline)

**Caso `match` directo** (`GD-MATCH-001`, su_00016): evidencia "Cuando se
asegure el continente..." bajo `coverage_path: ["3. Daños por agua", "3.2.
Localización y reparación"]`. El candidato correcto es `cover_id: 18`
(`Daños por agua`), bullet `"Localización y reparación -100%"` -- el nombre
del bullet casi coincide literalmente con la hoja del `coverage_path`.
`excel_quote` esperado: `"Localización y reparación"`.

**Caso `match` por CONTENIDO, no por título** (`GD-MATCH-025`, su_00222): el
`article` es *"Artículo 9º Asistencia"* (sugiere una cobertura genérica de
asistencia), pero el `source_text` real habla de plagas, avispas, roedores.
El candidato correcto NO es el que coincide con el título -- es
`cover_id: 104`, cuyo `cover_full_text` incluye *"Control de plagas"* (viene
de la hoja "Coberturas opcionales", no de "Asistencia"). `confidence` en este
caso real es `"media"` (el propio golden set lo marca como ambiguo, no
`"alta"`) -- ejemplo de que el título por sí solo NUNCA basta.

**Caso `out_of_scope_product`** (`GD-MATCH-005`, su_00039): evidencia "En
vivienda de uso turístico o alquiler vacacional" sobre pérdida de alquileres
por inhabitabilidad temporal. Ningún candidato del Excel de esta compañía
cubre ese paquete -- `decision: "out_of_scope_product"`, `cover_id: null`,
`confidence: "alta"` (está claro que no se comercializa, no es un caso
dudoso).

**Caso `general_policy_rule`** (`GD-MATCH-026`, su_00223): `article`
*"Artículo 10º Exclusiones generales para todas las garantías"*,
`coverage_path: []` (vacío -- señal fuerte de regla transversal). No hay
`coverage_dependencies` reales asociadas. `decision:
"general_policy_rule"`, `cover_id: null`, `confidence: "alta"`.

## Pendiente

- **Validar con llamadas reales al LLM** (`claude-haiku-4-5`, mismo modelo que
  el extractor de dependencias del flujo 2 real) contra los 28 casos de
  `golden_dataset.json` -- construir un golden set propio de la decisión
  (`coverage_match_decision_golden_dataset.json`) cruzando el `decision`/
  `cover_id`/`excel_quote` real del LLM contra `expected_reason`/
  `expected_cover_id`/`expected_bullet_match` ya existentes. Requiere gasto de
  API (a diferencia de todo lo validado hasta ahora en Fases 1-4, que es
  código puro) -- pinear el golden set antes de iterar, mismo criterio que
  `CLAUDE.md` §7 para nodos con llamadas externas.
- Confirmar el modelo/proveedor exacto a usar en n8n (`lmChatAnthropic` +
  `claude-haiku-4-5`, consistente con el resto del proyecto) y el
  `Structured Output Parser` con el JSON schema de arriba.
- El guardrail que verifica `excel_quote`/`cover_id` (A13,
  `review_assembly.applyGroundingGuardrail`) ya está construido y validado
  offline -- no depende de este prompt para existir, pero si el prompt no
  logra que el LLM cite texto literal con frecuencia razonable, muchos casos
  degradarán a confianza `"baja"` y acabarán todos en revisión humana; ajustar
  el prompt si eso ocurre en la validación con LLM real.
