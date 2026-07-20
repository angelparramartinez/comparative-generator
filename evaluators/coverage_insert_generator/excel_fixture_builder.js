// Adaptadores entre la salida de los nodos de limpieza del Excel (`Clean
// covers and modalities` / `Clean Optional Covers`, portados del workflow
// legacy `comparative generation.json`) y lo que esperan `matcher.js`
// (indice de candidatos) y `generator.js` (bullets por cobertura, agrupados
// por si varian o no entre modalidades). Corresponde a los nodos A6 ("Build
// Excel Fixture for Matcher") y A16 ("Build Per-Cover Bullet Groups") del
// diseño de Fase 4 (ver plan zippy-weaving-crown.md). Codigo puro, se valida
// offline (run_offline_eval.js, checks --excel-fixture) antes de construir
// los nodos n8n reales.

const { normalize } = require("./matcher");
const { splitBulletsFromCellText } = require("./generator");

// A6: cleanedModalityCovers = salida de `Clean covers and modalities`
// ({cover_id, cover_name, modalities: {modality_id: cellText}}[]).
// cleanedOptionalCovers = salida de `Clean Optional Covers` extendida con
// `epigrafe` (texto crudo de la columna EPIGRAFE, ver nota A5 del diseño).
// Produce el fixture exacto que espera matcher.buildCandidateIndex.
function buildExcelFixtureForMatcher(cleanedModalityCovers, cleanedOptionalCovers) {
  const covers_por_modalidad = (cleanedModalityCovers || []).map(cover => {
    const seen = new Set();
    const sample_text_bullets = [];
    for (const cellText of Object.values(cover.modalities || {})) {
      for (const bullet of splitBulletsFromCellText(cellText, cover.cover_name)) {
        const key = normalize(bullet);
        if (!seen.has(key)) {
          seen.add(key);
          sample_text_bullets.push(bullet);
        }
      }
    }
    return { cover_id: cover.cover_id, cover_name: cover.cover_name, sample_text_bullets };
  });

  const coberturas_opcionales = (cleanedOptionalCovers || []).map(opt => ({
    epigrafe: opt.epigrafe,
    cover_name: opt.cover_name,
    text_content: opt.text_content
  }));

  return { covers_por_modalidad, coberturas_opcionales };
}

// A16: agrupa los bullets de una cobertura segun si su texto es identico en
// TODAS las modalidades (comparten un unico bullet sin PRODUCT_COMPANY_
// MODALITY_ID -- visible siempre) o varia por modalidad (un bullet por
// modality_id -- ver knowledge/Modelo.../§11 "se debe generar un registro
// por modalidad"). Alineacion por POSICION dentro de cada celda ya troceada
// -- funciona cuando todas las modalidades presentes tienen el MISMO numero
// de bullets (caso real confirmado: Danos por agua COVER_ID 18, Robo
// COVER_ID 16 entre un subconjunto de modalidades). Cuando el numero de
// bullets difiere entre modalidades (caso real tambien confirmado: Robo
// entre sus 11 modalidades completas, que cambian de redaccion y de numero
// de bullets segun el paquete) NO se intenta una alineacion difusa -- es una
// limitacion conocida deliberada (mismo criterio que "known_limitation" en
// value_matcher.js): se marca `homogeneous: false` para revision manual en
// vez de adivinar un alineamiento que podria ser incorrecto.
function buildBulletGroupsForCover(coverId, coverName, modalitiesMap) {
  const modalityIds = Object.keys(modalitiesMap || {});
  const bulletsByModality = {};
  for (const modalityId of modalityIds) {
    bulletsByModality[modalityId] = splitBulletsFromCellText(modalitiesMap[modalityId], coverName);
  }

  const counts = new Set(modalityIds.map(id => bulletsByModality[id].length));
  if (counts.size > 1) {
    return {
      coverId,
      coverName,
      homogeneous: false,
      defaultBullets: [],
      perModalityBullets: [],
      warning: "El numero de bullets difiere entre modalidades -- no se fuerza alineacion automatica, requiere revision manual."
    };
  }

  const bulletCount = modalityIds.length === 0 ? 0 : bulletsByModality[modalityIds[0]].length;
  const defaultBullets = [];
  const perModalityBullets = [];
  for (let i = 0; i < bulletCount; i++) {
    const textsAtPosition = modalityIds.map(id => bulletsByModality[id][i]);
    const allSame = textsAtPosition.every(t => t === textsAtPosition[0]);
    if (allSame) {
      defaultBullets.push(textsAtPosition[0]);
    } else {
      modalityIds.forEach((id, idx) => {
        perModalityBullets.push({ modalityId: id, text: textsAtPosition[idx] });
      });
    }
  }

  return { coverId, coverName, homogeneous: true, defaultBullets, perModalityBullets };
}

module.exports = {
  buildExcelFixtureForMatcher,
  buildBulletGroupsForCover
};
