// Fusiona 1+ diccionarios de tuning en uno solo -- necesario porque algunas
// companias (ej. Allianz) entregan el tuning partido en un fichero por fase
// (tarificacion/preemision), con el mismo campo a veces definido de forma
// distinta en cada uno (ver ejemplo real: aestheticDamageToBuilding, cuyas
// opciones en preemision ya vienen condicionadas por modalidad con importes
// reales, mientras que en tarificacion son un unico grupo generico "Capital
// bajo/medio/alto" -- la comparativa debe usar siempre la version mas
// resuelta, sin necesidad de anadir insurance.stage al modelo, ver
// knowledge/... hilo Allianz 28/07).
//
// dictionaries: array de objetos {tuning_key: fieldDef}, ordenados de MENOR
// a MAYOR prioridad (el ULTIMO gana). Fusion por clave completa, sin fusion
// profunda de propiedades dentro de un mismo campo: si un tuning_key existe
// en varios diccionarios, se queda entero el del diccionario de mayor
// prioridad; si solo existe en uno, se usa tal cual (caso real confirmado
// por el usuario 28/07: dtoCap/allRisk/damageCausedByTenant/
// smartphonesScreenDamages solo aparecian en el JSON de tarificacion de este
// ejemplo, pero su valor sigue siendo legible por SPEL en preemision).
//
// Una compania sin distincion de fase (ej. Generali, un unico fichero) sigue
// llamando a esto con un array de 1 solo elemento -- resultado identico al
// diccionario de entrada, sin cambiar comportamiento.
function mergeTuningDictionaries(dictionaries) {
  const merged = {};
  for (const dict of dictionaries || []) {
    for (const [key, def] of Object.entries(dict || {})) {
      merged[key] = def;
    }
  }
  return merged;
}

module.exports = {
  mergeTuningDictionaries
};
