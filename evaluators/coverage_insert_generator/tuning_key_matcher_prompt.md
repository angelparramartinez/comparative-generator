# Prompt del matcher texto-Excel -> tuning_key

Necesario para construir `FILTER_EXPR`/`HIRING_STATUS_EXPR`/`VALUE_EXPR` que
referencien `tuning` (ver ejemplo completo 2 en `knowledge/Modelo comparativa
de coberturas - AI ready.md`: `tuning?.naturalPhenomena`). Adaptado del agente
LLM ya existente en el workflow legacy `n8n/workflows/comparative
generation.json` (nodo `Mapping coberturas opcionales y tuning`), generalizado
para aplicarse tambien a "Coberturas por modalidad" (el legacy solo lo hacia
para "Coberturas opcionales").

**Validado offline** (20/07) con `examples/tuning_generali_traducido.json`
(diccionario real aportado por el usuario) cruzado contra las 16 coberturas
opcionales reales de `Plantilla Comparativa Hogar.xlsx` --
`evaluators/coverage_insert_generator/tuning_key_golden_dataset.json` +
`tuning_matcher.js`, check `--tuning` de `run_offline_eval.js`: 15/16 casos OK,
0 fallos reales, 1 limitacion conocida ("Reconstruccion de jardin" vs
"Reconstruccion de jardines"/"...jardin singular", ambiguedad lexica real que
necesita mas contexto/LLM). Incluye un caso real de `NOT_FOUND` ("RC perros
peligrosos o de dificil manejo", que no tiene tuning_key propia) y un caso real
de label dinamico SPEL (`yvig24`, cuyo label es un ternario que expone dos
literales distintos segun otro campo -- el heuristico extrae ambos literales
como candidatos).

## Prompt generalizado (borrador, adaptado del legacy)

```
Rol: Eres un experto en sistemas de Seguros y Mapping de Datos. Tu mision es
realizar un mapeo semantico entre coberturas comerciales (Excel) y claves
tecnicas (Tuning).

Protocolo de actuacion:
1. Origen de datos: recibiras una lista de coberturas del Excel -- tanto de
   "Coberturas por modalidad" (nombre de cobertura + bullets) como de
   "Coberturas opcionales" (nombre + texto).
2. Diccionario de referencia: usaras las claves (key) y etiquetas (label) del
   diccionario de tuning.
3. Conocimiento de dominio (seguros):
   - Entiende acronimos: "RC"/"R.C." es "Responsabilidad Civil", "DA" es
     "Danos por Agua".
   - Jerarquia: si el Excel pide algo especifico (ej. "perros peligrosos") y
     el tuning tiene el concepto general (ej. "tenencia de perros"), el mapeo
     es CORRECTO.
4. Logica de mapeo semantico:
   - No busques coincidencia de palabras exacta, busca coincidencia de
     concepto.
   - La key puede ser una pista secundaria (ej. claves que empiezan por "qrc"
     suelen referirse a Responsabilidad Civil), pero prioriza el label.
5. Control de errores: solo si no hay absolutamente ninguna relacion tematica
   entre la cobertura y el diccionario, devuelve "NOT_FOUND" -- no inventes
   una key.

Restriccion de salida: devuelve unicamente un objeto JSON valido con el array
`mappings`, sin explicaciones ni bloques de codigo markdown. No modifiques el
cover_name/bullet_text de entrada.

Input Data:
- Coberturas por modalidad (Excel): {{ JSON.stringify($json.context.data.modalities) }}
- Coberturas opcionales (Excel): {{ JSON.stringify($json.context.data.optionals) }}
- Diccionario de referencia (Tuning): {{ JSON.stringify($json.context.data.tuning) }}
```

## Diferencia respecto al legacy

El legacy solo pasaba `context.data.optionals` como origen; aqui se generaliza
para incluir tambien `context.data.modalities`, porque un `ENTRY` de la hoja
principal tambien puede necesitar referenciar `tuning` (no solo los
`ENTRY` que vienen de "Coberturas opcionales").

## Pendiente

- Igual que el matcher de coberturas, esto necesitaria un guardrail post-LLM
  (p. ej.: la key devuelta debe existir realmente en el diccionario de tuning,
  no ser inventada) -- disenar cuando se construya el nodo n8n real (Fase 4).
- Solo validado con la hoja "Coberturas opcionales" (16 casos reales). La
  generalizacion a "Coberturas por modalidad" (bullets de la hoja principal)
  sigue sin un caso real que la ejercite -- probarlo cuando haga falta un
  `ENTRY` de esa hoja que dependa de `tuning`.
