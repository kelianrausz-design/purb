/**
 * genius-network.js — Réseau artistique via Genius
 *
 * Genius a les crédits de production explicites (producer_artists,
 * custom_performances "Produced by") que Deezer n'a pas.
 * Deezer reste utilisé uniquement pour les fan counts.
 *
 * Flow :
 *  1. Trouver l'artiste sur Genius (correspondance exacte de nom)
 *  2. Récupérer ses 20 tops songs
 *  3. Extraire les featured_artists depuis la liste (1 appel)
 *  4. Fetch les 10 premières songs individuellement → producer_artists,
 *     custom_performances ("Produced by", "Beat by"…), writer_artists
 *  5. Croiser chaque nom avec Deezer pour obtenir nb_fan
 *  6. Retourner artists[] + beatmakers[] au même format que l'existant
 */

const GENIUS_BASE = "https://api.deezer.com";
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function geniusGet(path) {
  const token = process.env.GENIUS_ACCESS_TOKEN;
  if (!token) throw new Error("GENIUS_ACCESS_TOKEN manquant");
  await delay(350);
  const res = await fetch(`https://api.genius.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Genius HTTP ${res.status}: ${path}`);
  const data = await res.json();
  return data.response;
}

// ── Recherche artiste sur Genius ─────────────────────────────

async function findArtistOnGenius(name) {
  const data = await geniusGet(`/search?q=${encodeURIComponent(name)}`);
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = norm(name);

  // Correspondance exacte d'abord
  const exact = (data.hits || []).find(
    (h) => h.type === "song" && norm(h.result?.primary_artist?.name || "") === target
  );
  if (exact) return exact.result.primary_artist;

  // Correspondance partielle (le nom contient ou est contenu)
  const partial = (data.hits || []).find(
    (h) =>
      h.type === "song" &&
      (norm(h.result?.primary_artist?.name || "").includes(target) ||
        target.includes(norm(h.result?.primary_artist?.name || "")))
  );
  return partial?.result?.primary_artist || null;
}

// ── Songs de l'artiste ────────────────────────────────────────

async function getArtistSongs(artistId, limit = 20) {
  const data = await geniusGet(
    `/artists/${artistId}/songs?sort=popularity&per_page=${limit}&page=1`
  );
  return data.songs || [];
}

// ── Détail d'une song (producers, writers, custom_performances) ──

async function getSongDetails(songId) {
  const data = await geniusGet(`/songs/${songId}`);
  return data.song;
}

// ── Fan count Deezer pour un nom ──────────────────────────────

// Utilise /search/artist (pas /search) pour avoir nb_fan dans la réponse
async function deezerFanCount(name) {
  try {
    await delay(200);
    const res = await fetch(
      `https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=5`
    );
    if (!res.ok) return { nb_fan: 0, deezer_id: null };
    const data = await res.json();

    const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const target = norm(name);

    const match =
      (data.data || []).find((a) => norm(a.name) === target) ||
      (data.data || []).find(
        (a) => norm(a.name).includes(target) || target.includes(norm(a.name))
      );

    return match
      ? { nb_fan: match.nb_fan || 0, deezer_id: match.id }
      : { nb_fan: 0, deezer_id: null };
  } catch {
    return { nb_fan: 0, deezer_id: null };
  }
}

function classifyWave(nb_fan) {
  if (nb_fan < 1000) return "V1";
  if (nb_fan < 10000) return "V2";
  return "V3";
}

// Labels de production dans custom_performances
const PROD_LABELS = [
  "produc", "beat", "mixing", "mixed", "mastering", "mastered",
  "recording", "recorded", "engineered", "engineer",
];

// Labels vidéo/visuel à exclure (producteurs vidéo ne sont pas des beatmakers)
const VIDEO_LABELS = [
  "video", "directed by", "music video", "cinemat", "photograph",
  "animat", "graphic", "illustrat", "art direction", "visual direct",
  "artwork", "cover art",
];

function isProductionLabel(label) {
  const l = (label || "").toLowerCase();
  if (VIDEO_LABELS.some((v) => l.includes(v))) return false;
  return PROD_LABELS.some((p) => l.includes(p));
}

// ── Export principal ──────────────────────────────────────────

/**
 * Construit le réseau d'un artiste via Genius.
 * @param {string} artistName
 * @returns {Promise<{ artists: object[], beatmakers: object[] }>}
 */
export async function buildGeniusNetwork(artistName) {
  const result = { artists: [], beatmakers: [] };

  // 1. Trouver l'artiste
  const artist = await findArtistOnGenius(artistName);
  if (!artist) return result;

  // 2. Top songs — 40 pour trouver plus de beatmakers
  const songs = await getArtistSongs(artist.id, 40);
  if (!songs.length) return result;

  // 3. Featured artists depuis la liste (rapide, pas de fetch individuel)
  const featuredMap = new Map(); // name → { name, songs[] }
  for (const song of songs) {
    for (const fa of song.featured_artists || []) {
      if (fa.name === artist.name) continue;
      if (!featuredMap.has(fa.name)) featuredMap.set(fa.name, { name: fa.name, songs: [] });
      featuredMap.get(fa.name).songs.push(song.title);
    }
  }

  // 4. Détails des 10 premières songs → producers, custom_performances, writers
  const producerMap = new Map(); // name → { name, songs[], role }

  for (const song of songs.slice(0, 20)) {
    try {
      const details = await getSongDetails(song.id);

      // producer_artists
      for (const p of details.producer_artists || []) {
        if (p.name === artist.name) continue;
        if (!producerMap.has(p.name))
          producerMap.set(p.name, { name: p.name, songs: [], role: "Prod." });
        producerMap.get(p.name).songs.push(song.title);
      }

      // custom_performances (crédits explicites "Produced by", "Beat by"…)
      for (const perf of details.custom_performances || []) {
        if (!isProductionLabel(perf.label)) continue;
        for (const p of perf.artists || []) {
          if (p.name === artist.name) continue;
          if (!producerMap.has(p.name))
            producerMap.set(p.name, { name: p.name, songs: [], role: perf.label });
          producerMap.get(p.name).songs.push(song.title);
        }
      }

      // writer_artists — seulement si pas déjà featured (donc pas rappeur)
      for (const w of details.writer_artists || []) {
        if (w.name === artist.name) continue;
        if (featuredMap.has(w.name)) continue;
        if (!producerMap.has(w.name))
          producerMap.set(w.name, { name: w.name, songs: [], role: "Compo." });
        producerMap.get(w.name).songs.push(song.title);
      }
    } catch {
      // song fetch échoue → on continue
    }
  }

  // 5. Croiser avec Deezer pour fan counts

  // Featured → artists
  for (const [, info] of featuredMap) {
    const deezer = await deezerFanCount(info.name);
    result.artists.push({
      name: info.name,
      deezer_id: deezer.deezer_id,
      nb_fan: deezer.nb_fan,
      wave: classifyWave(deezer.nb_fan),
      top_track: info.songs[0] || null,   // collab track comme contexte
      source: `genius · feat. sur "${info.songs[0]}"`,
    });
  }

  // Producers → beatmakers
  for (const [, info] of producerMap) {
    const deezer = await deezerFanCount(info.name);
    result.beatmakers.push({
      name: info.name,
      known_for: `${info.role} ${info.songs.slice(0, 3).join(", ")}`,
      platform: "Genius Credits",
      wave: classifyWave(deezer.nb_fan),
      nb_fan: deezer.nb_fan,
    });
  }

  result.artists.sort((a, b) => b.nb_fan - a.nb_fan);
  result.beatmakers.sort((a, b) => (b.nb_fan || 0) - (a.nb_fan || 0));

  return result;
}
