/**
 * contacts.js — Scraping de contacts sans LLM
 *
 * Sources :
 *  1. MusicBrainz  → URL relationships officielles (Instagram, SoundCloud, etc.)
 *  2. Brave Search → trouver Instagram via scraping HTML
 *  3. Instagram    → API mobile (got-scraping) + scraping link pages (Linktree…)
 */

import { enrichInstagramHandle, findArtistEmail } from "./instagram.js";

const MB_BASE = "https://musicbrainz.org/ws/2";
const MB_HEADERS = {
  "User-Agent": "PurB/1.0 (beat placement tool; contact@purb.fr)",
  Accept: "application/json",
};

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
  Accept: "text/html",
};

// ── MusicBrainz ───────────────────────────────────────────

async function mbSearch(name) {
  const url = `${MB_BASE}/artist/?query=${encodeURIComponent(name)}&fmt=json&limit=3`;
  const res = await fetch(url, { headers: MB_HEADERS });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.artists?.[0] || null;
}

async function mbGetRelations(mbid) {
  await delay(1100); // MusicBrainz : max 1 req/s
  const url = `${MB_BASE}/artist/${mbid}?inc=url-rels&fmt=json`;
  const res = await fetch(url, { headers: MB_HEADERS });
  if (!res.ok) return [];
  const data = await res.json();
  return data?.relations || [];
}

function parseRelations(relations) {
  const out = {};
  for (const rel of relations) {
    const url = rel.url?.resource || "";
    if (url.includes("instagram.com")) {
      const m = url.match(/instagram\.com\/([a-zA-Z0-9_.]+)/);
      if (m && m[1] !== "p" && m[1] !== "explore") out.instagram = "@" + m[1];
    } else if (url.includes("twitter.com") || url.includes("x.com")) {
      const m = url.match(/(?:twitter|x)\.com\/([a-zA-Z0-9_]+)/);
      if (m && m[1] !== "home") out.twitter = "@" + m[1];
    } else if (url.includes("soundcloud.com")) {
      out.soundcloud = url;
    } else if (url.includes("youtube.com") || url.includes("youtu.be")) {
      out.youtube = url;
    } else if (url.includes("tiktok.com")) {
      const m = url.match(/tiktok\.com\/@([a-zA-Z0-9_.]+)/);
      if (m) out.tiktok = "@" + m[1];
    } else if (url.includes("open.spotify.com/artist/")) {
      const m = url.match(/open\.spotify\.com\/artist\/([a-zA-Z0-9]+)/);
      if (m) out.spotify = "https://open.spotify.com/artist/" + m[1];
    }
  }
  return out;
}

// ── Instagram HTML scraping ───────────────────────────────

async function scrapeInstagram(handle) {
  try {
    const res = await fetch(`https://www.instagram.com/${handle}/`, {
      headers: { ...BROWSER_HEADERS, "Cache-Control": "no-cache" },
    });
    if (!res.ok) return null;
    const html = await res.text();

    const descM = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/);
    const titleM = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/);
    const bio = descM?.[1] || null;
    const displayName = titleM?.[1]?.replace(/\s*[•|(@].*$/, "").trim() || null;
    const emailM = bio?.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const linkM = html.match(/"external_url"\s*:\s*"([^"]+)"/);

    return { bio, displayName, email: emailM?.[0] || null, external_url: linkM?.[1] || null };
  } catch {
    return null;
  }
}

// ── Validation handle Instagram ───────────────────────────
// Vérifie que la page Instagram trouvée correspond bien à l'artiste
// en comparant le nom affiché avec le nom Deezer.

function normalize(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function nameMatch(artistName, handle, igDisplayName, igBio) {
  const a = normalize(artistName);
  const h = normalize(handle);
  const d = normalize(igDisplayName);
  const b = normalize(igBio);

  // 1. Le handle contient le nom ou vice versa (le plus fiable sans og:title)
  if (h.includes(a) || a.includes(h)) return true;

  // 2. Chaque token du nom (> 3 chars) dans le handle
  const tokens = artistName.toLowerCase().split(/[\s_0-9]+/).filter(w => w.length > 3).map(normalize);
  if (tokens.length > 0 && tokens.every(t => h.includes(t))) return true;

  // 3. Display name (si dispo — Instagram le cache souvent)
  if (d && (d.includes(a) || a.includes(d))) return true;

  // 4. Bio (si dispo)
  if (b && a.length > 3 && b.includes(a)) return true;

  return false;
}

// ── Spotify page scraping ─────────────────────────────────

async function scrapeSpotify(spotifyUrl) {
  try {
    const res = await fetch(spotifyUrl, { headers: BROWSER_HEADERS });
    if (!res.ok) return null;
    const html = await res.text();
    // Spotify embed JSON-LD ou structured data
    const igM = html.match(/instagram\.com\/([a-zA-Z0-9_.]{2,30})/);
    const twM = html.match(/(?:twitter|x)\.com\/([a-zA-Z0-9_]{2,30})/);
    return {
      instagram: igM ? "@" + igM[1] : null,
      twitter: twM && twM[1] !== "SpotifyArtists" ? "@" + twM[1] : null,
    };
  } catch {
    return null;
  }
}

// ── Brave Search scraping ─────────────────────────────────

const SKIP_HANDLES = new Set([
  "p", "explore", "reel", "reels", "stories", "accounts",
  "about", "press", "legal", "help", "music", "tv", "startpage",
]);

async function braveSearch(query) {
  try {
    const res = await fetch(
      `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`,
      { headers: { ...BROWSER_HEADERS, Accept: "text/html,application/xhtml+xml" } }
    );
    if (!res.ok) return [];
    const html = await res.text();
    return [...new Set(
      [...html.matchAll(/instagram\.com\/([a-zA-Z0-9_.]{2,30})/g)]
        .map(m => m[1])
        .filter(h => !SKIP_HANDLES.has(h) && !h.includes("."))
    )];
  } catch {
    return [];
  }
}

async function findInstagram(name) {
  const queries = [
    `${name} rappeur instagram`,
    `"${name}" rap français instagram`,
  ];

  for (const q of queries) {
    const handles = await braveSearch(q);
    for (const handle of handles.slice(0, 3)) {
      const igData = await scrapeInstagram(handle);
      if (nameMatch(name, handle, igData?.displayName, igData?.bio)) {
        return { handle: "@" + handle, igData };
      }
    }
    if (handles.length > 0) break; // résultats trouvés → pas besoin de la 2ème requête
    await delay(1000);
  }
  return null;
}

// ── Export principal ──────────────────────────────────────

/**
 * Scrape les contacts d'un artiste sans LLM.
 * @param {string} name
 */
export async function scrapeContacts(name) {
  const result = {
    name,
    instagram: null,
    twitter: null,
    email: null,
    soundcloud: null,
    youtube: null,
    tiktok: null,
    bio: null,
    sources: [],
    confidence: "low",
  };

  // ── 1. MusicBrainz — liens officiels ──────────────────
  try {
    const artist = await mbSearch(name);
    if (artist?.id) {
      const relations = await mbGetRelations(artist.id);
      const socials = parseRelations(relations);
      Object.assign(result, socials);
      if (Object.keys(socials).length > 0) result.sources.push("musicbrainz");
    }
  } catch {
    // non bloquant
  }

  // ── 2. Spotify → liens sociaux (si URL trouvée via MB) ──
  if (result.spotify && !result.instagram) {
    try {
      const sp = await scrapeSpotify(result.spotify);
      if (sp?.instagram) { result.instagram = sp.instagram; result.sources.push("spotify"); }
      if (sp?.twitter && !result.twitter) { result.twitter = sp.twitter; result.sources.push("spotify"); }
    } catch {
      // non bloquant
    }
  }

  // ── 3. DDG + validation Instagram ─────────────────────
  if (!result.instagram) {
    try {
      const found = await findInstagram(name);
      if (found) {
        result.instagram = found.handle;
        result.sources.push("brave");
        // Récupère email + bio depuis la validation déjà faite
        if (found.igData.email) result.email = found.igData.email;
        if (found.igData.bio) result.bio = found.igData.bio.slice(0, 300);
        result.sources.push("instagram_html");
      }
    } catch {
      // non bloquant
    }
  }

  // ── 4. Scrape Instagram (HTML rapide) si handle trouvé via MB sans bio ───
  if (result.instagram && !result.bio) {
    const handle = result.instagram.replace("@", "");
    try {
      const igData = await scrapeInstagram(handle);
      if (igData) {
        if (igData.email && !result.email) result.email = igData.email;
        if (igData.bio) result.bio = igData.bio.slice(0, 300);
        result.sources.push("instagram_html");
      }
    } catch { /* silencieux */ }
  }

  // ── 5. Genius + Serper (fallback si rien trouvé) ──────
  if (!result.instagram) {
    try {
      const ig = await findArtistEmail(name);
      if (ig.handle) {
        result.instagram = ig.handle;
        result.sources.push("genius");
        if (ig.biography) result.bio = ig.biography.slice(0, 300);
        if (ig.emails?.length) result.email = ig.emails[0];
        result.sources.push("instagram_api");
      }
    } catch {
      // non bloquant
    }
  }

  // ── Confidence ─────────────────────────────────────────
  const hits = [result.instagram, result.twitter, result.email, result.soundcloud].filter(Boolean).length;
  result.confidence = hits >= 2 ? "high" : hits === 1 ? "medium" : "low";

  return result;
}
