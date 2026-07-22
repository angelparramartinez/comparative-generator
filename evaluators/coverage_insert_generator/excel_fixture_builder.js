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

// Marcador de texto libre (sin relacion con ninguna cobertura real) que el
// Excel usa dentro de una celda de "Coberturas por modalidad" para senalar
// que esa modalidad necesita mapeo a un tuning_key (ver Build Tuning
// Context). No es contenido real de la cobertura -- debe excluirse de los
// bullets antes de construir candidatos/ENTRY, o se cuela como una linea
// literal "Garantía Opcional" visible al usuario final (caso real
// confirmado: COVER_ID 79/81).
const GARANTIA_OPCIONAL_MARKER_NORMALIZED = normalize("Garantía Opcional");

function isGarantiaOpcionalMarker(bulletText) {
  return normalize(bulletText) === GARANTIA_OPCIONAL_MARKER_NORMALIZED;
}

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
        if (isGarantiaOpcionalMarker(bullet)) continue;
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

// Fallback para cuando el NUMERO de bullets difiere entre modalidades (caso
// real confirmado: COVER_ID 15 "RC" y 16 "Robo" entre sus 11 modalidades
// completas -- es habitual y esperado que un paquete comercial superior
// incluya garantias enteras que el basico no tiene, decision del usuario
// 21/07: esto no deberia bloquear la generacion). Sin una posicion comun que
// alinear, el criterio pasa a ser TEXTO: un bullet (normalizado) que aparece
// en TODAS las modalidades presentes es compartido (defaultBullet, sin
// PRODUCT_COMPANY_MODALITY_ID); el resto se genera como ENTRY propia por
// modalidad (ver knowledge/Modelo.../§11). Bullets con el MISMO texto exacto
// en varias modalidades (pero no en todas) comparten groupIndex -- para que
// una dependencia extraida en una de ellas se aplique a las demas via
// matchDependenciesToBulletGroups. Bullets de texto UNICO (aunque
// semanticamente equivalentes a otro con distinta redaccion, p.ej. "robo de
// mobiliario y enseres" vs "...del propietario") quedan cada uno en su
// propia familia: no hay forma segura de adivinar que son la misma garantia
// sin intervencion humana -- mismo criterio que el resto del proyecto
// (nunca alinear a la fuerza, solo lo verificable).
function buildBulletGroupsForHeterogeneousCover(coverId, coverName, bulletsByModality) {
  const modalityIds = Object.keys(bulletsByModality);
  const normalizedSetPerModality = {};
  for (const id of modalityIds) {
    normalizedSetPerModality[id] = new Set(bulletsByModality[id].map(normalize));
  }

  const defaultBullets = [];
  const isDefault = new Set();
  for (const id of modalityIds) {
    for (const text of bulletsByModality[id]) {
      const key = normalize(text);
      if (isDefault.has(key)) continue;
      const inAllModalities = modalityIds.every(otherId => normalizedSetPerModality[otherId].has(key));
      if (inAllModalities) {
        defaultBullets.push(text);
        isDefault.add(key);
      }
    }
  }

  const perModalityBullets = [];
  const groupIndexByNormalizedText = new Map();
  let nextGroupIndex = 0;
  for (const id of modalityIds) {
    for (const text of bulletsByModality[id]) {
      const key = normalize(text);
      if (isDefault.has(key)) continue;
      if (!groupIndexByNormalizedText.has(key)) {
        groupIndexByNormalizedText.set(key, nextGroupIndex++);
      }
      perModalityBullets.push({ modalityId: id, text, groupIndex: groupIndexByNormalizedText.get(key) });
    }
  }

  return { coverId, coverName, homogeneous: true, defaultBullets, perModalityBullets };
}

// A16: agrupa los bullets de una cobertura segun si su texto es identico en
// TODAS las modalidades (comparten un unico bullet sin PRODUCT_COMPANY_
// MODALITY_ID -- visible siempre) o varia por modalidad (un bullet por
// modality_id -- ver knowledge/Modelo.../§11 "se debe generar un registro
// por modalidad"). Alineacion por POSICION dentro de cada celda ya troceada
// cuando todas las modalidades presentes tienen el MISMO numero de bullets
// (caso real confirmado: Danos por agua COVER_ID 18, Robo COVER_ID 16 entre
// un subconjunto de modalidades) -- necesario para casos como "Fontanería
// sin daños" donde el texto varia (importe) pero la posicion es la misma
// garantia real. Cuando el numero de bullets difiere entre modalidades
// (caso real tambien confirmado: RC/Robo entre sus 11 modalidades
// completas), delega en buildBulletGroupsForHeterogeneousCover (ver arriba).
function buildBulletGroupsForCover(coverId, coverName, modalitiesMap) {
  const modalityIds = Object.keys(modalitiesMap || {});
  const bulletsByModality = {};
  for (const modalityId of modalityIds) {
    bulletsByModality[modalityId] = splitBulletsFromCellText(modalitiesMap[modalityId], coverName)
      .filter(bullet => !isGarantiaOpcionalMarker(bullet));
  }

  const counts = new Set(modalityIds.map(id => bulletsByModality[id].length));
  if (counts.size > 1) {
    return buildBulletGroupsForHeterogeneousCover(coverId, coverName, bulletsByModality);
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
        perModalityBullets.push({ modalityId: id, text: textsAtPosition[idx], groupIndex: i });
      });
    }
  }

  return { coverId, coverName, homogeneous: true, defaultBullets, perModalityBullets };
}

// Empareja las dependencias ya traducidas (salida de "Translate Dependency
// Values") con los bullets por-modalidad de una cobertura, aplicando la
// MISMA dependencia a TODAS las variantes de un mismo "bullet" (mismo
// groupIndex, ver buildBulletGroupsForCover) en cuanto UNA de sus variantes
// coincide textualmente con la cita literal (`excel_quote`/`bullet_match`)
// de la dependencia. Caso real que motiva esto: COVER_ID 18 "Fontanería sin
// daños" varia el importe por modalidad (300€/600€/1.000€), pero la
// condicion real extraida (continente contratado) aplica a las 3 variantes
// por igual -- el condicionado solo cita literalmente una de ellas como
// ejemplo, así que un matching por texto integro (con importe incluido)
// dejaba la condicion pegada solo a esa variante.
function matchDependenciesToBulletGroups(perModalityBullets, matches, coverId) {
  function findDependencies(texts) {
    for (const text of texts) {
      const bulletNormalized = normalize(text);
      const hit = (matches || []).find(
        m => m.cover_id === coverId && normalize(m.excel_quote || m.bullet_match || "") === bulletNormalized
      );
      if (hit) return hit.dependencies_translated || [];
    }
    return [];
  }

  const byGroupIndex = new Map();
  for (const bullet of perModalityBullets || []) {
    const key = bullet.groupIndex;
    if (!byGroupIndex.has(key)) byGroupIndex.set(key, []);
    byGroupIndex.get(key).push(bullet);
  }

  const result = [];
  for (const family of byGroupIndex.values()) {
    const dependencies = findDependencies(family.map(b => b.text));
    for (const { modalityId, text } of family) {
      result.push({ text, dependencies, modalityId });
    }
  }
  return result;
}

module.exports = {
  buildExcelFixtureForMatcher,
  buildBulletGroupsForCover,
  buildBulletGroupsForHeterogeneousCover,
  matchDependenciesToBulletGroups,
  isGarantiaOpcionalMarker
};
