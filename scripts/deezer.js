/**
 * deezer.js — Scraping réseau Deezer
 * Appelle l'API Deezer directement (Node.js, pas de CORS).
 */

const DEEZER = "https://api.deezer.com";
const DELAY_MS = 300;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function deezerGet(path) {
  await delay(DELAY_MS);
  const res = await fetch(DEEZER + path);
  if (!res.ok) throw new Error(`Deezer HTTP ${res.status}: ${path}`);
  const data = await res.json();
  if (data?.error) throw new Error(`Deezer: ${data.error.message || JSON.stringify(data.error)}`);
  return data;
}

function classifyWave(nb_fan) {
  if (nb_fan < 1000) return "V1";
  if (nb_fan < 10000) return "V2";
  return "V3";
}

/**
 * Scrape le réseau d'un artiste Deezer.
 * @param {string} artistName
 * @param {{ onProgress?: (msg: string) => void }} options
 * @returns {{ sourceArtist, sourceId, artists, beatmakers }}
 */
export async function scrapeNetwork(artistName, { onProgress } = {}) {
  const log = (msg) => (onProgress ? onProgress(msg) : console.log(msg));

  // ── 1. Recherche artiste ──────────────────────────────
  log(`Recherche "${artistName}"...`);
  const searchData = await deezerGet(`/search?q=${encodeURIComponent(artistName)}&limit=5`);
  if (!searchData?.data?.length) throw new Error(`"${artistName}" introuvable sur Deezer`);

  const mainArtist = searchData.data[0].artist;
  const mainId = mainArtist.id;
  const mainName = mainArtist.name;
  log(`✅ ${mainName} (id: ${mainId})`);

  // ── 2. Détails artiste principal ──────────────────────
  const mainDetails = await deezerGet(`/artist/${mainId}`);
  log(`   ${mainDetails.nb_fan?.toLocaleString("fr-FR")} fans · label: ${mainDetails.record_type || "—"}`);

  // ── 3. Artistes similaires — couche 1 ─────────────────
  const relatedData = await deezerGet(`/artist/${mainId}/related?limit=25`);
  const couche1 = relatedData?.data || [];
  log(`Couche 1: ${couche1.length} artistes similaires`);

  // ── 4. Top tracks → featurings + compositeurs ─────────
  const topTracksData = await deezerGet(`/artist/${mainId}/top?limit=10`);
  const topTracks = topTracksData?.data || [];

  const featuringIds = new Set();
  const contributorNames = new Set(); // beatmakers potentiels

  for (const track of topTracks) {
    if (!track.contributors) continue;
    for (const c of track.contributors) {
      if (!c.id || c.id === mainId) continue;
      if (c.role === "Main") featuringIds.add(c.id);
      if (c.role === "Composer" || c.role === "Author") contributorNames.add(c.name);
    }
  }
  log(`Featurings: ${featuringIds.size} · Compositeurs: ${contributorNames.size}`);

  // Map globale id → source
  const allIds = new Map();
  for (const a of couche1) allIds.set(a.id, "related");
  for (const id of featuringIds) if (!allIds.has(id)) allIds.set(id, "featuring");
  allIds.delete(mainId);

  // ── 5. Couche 2 : similaires des similaires ───────────
  const couche1Slice = couche1.slice(0, 10);
  for (let i = 0; i < couche1Slice.length; i++) {
    const { id } = couche1Slice[i];
    log(`Couche 2: ${i + 1}/${couche1Slice.length}...`);
    try {
      const rel2 = await deezerGet(`/artist/${id}/related?limit=10`);
      for (const a of rel2?.data || []) {
        if (a.id !== mainId && !allIds.has(a.id)) allIds.set(a.id, "couche2");
      }
    } catch (e) {
      log(`  Skip ${id}: ${e.message}`);
    }
  }
  log(`Total à vérifier: ${allIds.size} artistes`);

  // ── 6. Fetch détails + filtre < 100 000 fans ──────────
  const rawDetails = [];
  const idsArr = [...allIds.entries()];
  for (let i = 0; i < idsArr.length; i++) {
    const [id, source] = idsArr[i];
    if ((i + 1) % 10 === 0) log(`  Vérification ${i + 1}/${idsArr.length}...`);
    try {
      const d = await deezerGet(`/artist/${id}`);
      if (d?.nb_fan !== undefined && d.nb_fan < 100000) {
        rawDetails.push({
          deezer_id: id,
          name: d.name,
          nb_fan: d.nb_fan,
          label: d.record_type || null,
          picture: d.picture_medium || null,
          source,
        });
      }
    } catch {
      // skip silencieux
    }
  }
  log(`Filtrés: ${rawDetails.length} artistes émergents`);

  // ── 7. Top track + producteur pour chaque artiste gardé ─
  const finalArtists = [];
  for (let i = 0; i < rawDetails.length; i++) {
    const a = rawDetails[i];
    let top_track = null;
    let producer = null;
    try {
      const tt = await deezerGet(`/artist/${a.deezer_id}/top?limit=3`);
      top_track = tt?.data?.[0]?.title || null;
      // Producteur = premier compositeur trouvé dans les crédits
      outer: for (const track of tt?.data || []) {
        if (!track.contributors) continue;
        for (const c of track.contributors) {
          if (c.role === "Composer" || c.role === "Author") {
            producer = c.name;
            break outer;
          }
        }
      }
    } catch {
      // skip
    }
    finalArtists.push({
      ...a,
      wave: classifyWave(a.nb_fan),
      top_track,
      producer,
    });
  }

  // ── Beatmakers : compositeurs absents de la liste artistes ─
  const artistNameSet = new Set(finalArtists.map((a) => a.name.toLowerCase()));
  const beatmakers = [...contributorNames]
    .filter((n) => !artistNameSet.has(n.toLowerCase()))
    .map((name) => ({
      name,
      known_for: "Compositeur (crédits Deezer)",
      platform: "Deezer Credits",
    }));

  log(`✅ ${finalArtists.length} artistes · ${beatmakers.length} beatmakers`);

  return {
    sourceArtist: mainName,
    sourceId: mainId,
    artists: finalArtists,
    beatmakers,
  };
}
