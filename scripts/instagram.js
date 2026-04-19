/**
 * instagram.js — Recherche d'email d'artiste via Instagram
 *
 * Flow :
 *  1. Trouver le handle via Genius API (instagram_name sur la fiche artiste)
 *  2. Fallback Serper.dev (Google : "nom" rappeur site:instagram.com)
 *  3. Fetcher le profil via l'API mobile Instagram (got-scraping + X-IG-App-ID)
 *  4. Extraire les emails : standard + patterns obfusqués
 *  5. Scraper les link pages (Linktree __NEXT_DATA__, Beacons, bio.link, solo.to)
 *  6. Rate limiting Bottleneck (max 150 req/h Instagram, 4 s minimum entre requêtes)
 */

import Bottleneck from "bottleneck";
import { gotScraping } from "got-scraping";
import * as cheerio from "cheerio";
import NodeCache from "node-cache";

// Lus à l'intérieur des fonctions (ESM hoist : les imports s'exécutent avant le chargement du .env)

// Cache profils Instagram pendant 1 heure (évite les doublons dans un pipeline)
const profileCache = new NodeCache({ stdTTL: 3600 });

// Rate limiter Instagram : max 150 req/heure, 1 s minimum entre requêtes
const igLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 1000,
  reservoir: 150,
  reservoirRefreshAmount: 150,
  reservoirRefreshInterval: 60 * 60 * 1000,
});

const SKIP_HANDLES = new Set([
  "p", "explore", "reel", "reels", "stories", "accounts",
  "about", "press", "legal", "help", "music", "tv",
]);

// ── Extraction d'emails ───────────────────────────────────────

/**
 * Extrait tous les emails d'une chaîne, y compris les patterns obfusqués.
 * @param {string} text
 * @returns {string[]}
 */
export function extractEmails(text) {
  if (!text) return [];
  const emails = new Set();

  // 1. Emails standard
  for (const m of text.matchAll(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g)) {
    emails.add(m[0].toLowerCase());
  }

  // 2. Unicode ＠ (fullwidth at-sign)
  for (const m of text.matchAll(/([a-zA-Z0-9._%+-]+)＠([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g)) {
    emails.add(`${m[1]}@${m[2]}`.toLowerCase());
  }

  // 3. [at] / (at) — avec ou sans [dot] / (dot)
  const deobf = text
    .replace(/\s*[\[({]at[}\])]?\s*/gi, "@")
    .replace(/\s*[\[({]dot[}\])]?\s*/gi, ".");
  for (const m of deobf.matchAll(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g)) {
    emails.add(m[0].toLowerCase());
  }

  // 4. Espaces autour du @  (ex: "contact @ gmail.com")
  for (const m of text.matchAll(/([a-zA-Z0-9._%+-]+)\s+@\s+([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g)) {
    emails.add(`${m[1]}@${m[2]}`.toLowerCase());
  }

  // Filtre les faux positifs évidents
  return [...emails].filter(
    (e) => !e.includes("example") && !e.includes("youremail") && e.length < 100
  );
}

// ── Genius API ────────────────────────────────────────────────

async function findHandleViaGenius(name) {
  const GENIUS_TOKEN = process.env.GENIUS_ACCESS_TOKEN;
  if (!GENIUS_TOKEN) return null;
  try {
    const searchRes = await fetch(
      `https://api.genius.com/search?q=${encodeURIComponent(name)}`,
      { headers: { Authorization: `Bearer ${GENIUS_TOKEN}` } }
    );
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();

    // Trouve le hit dont l'artiste principal ressemble au nom cherché
    const nameLower = name.toLowerCase();
    const hit = (searchData?.response?.hits || []).find(
      (h) =>
        h.type === "song" &&
        h.result?.primary_artist?.name?.toLowerCase().includes(nameLower.split(" ")[0])
    );
    if (!hit) return null;

    const artistId = hit.result.primary_artist.id;
    const artistRes = await fetch(`https://api.genius.com/artists/${artistId}`, {
      headers: { Authorization: `Bearer ${GENIUS_TOKEN}` },
    });
    if (!artistRes.ok) return null;
    const artistData = await artistRes.json();

    const ig = artistData?.response?.artist?.instagram_name;
    return ig ? ig.replace(/^@/, "") : null;
  } catch {
    return null;
  }
}

// ── Serper.dev fallback ───────────────────────────────────────

async function findHandleViaSerper(name) {
  const SERPER_KEY = process.env.SERPER_API_KEY;
  if (!SERPER_KEY) return null;
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": SERPER_KEY,
      },
      body: JSON.stringify({
        q: `"${name}" rappeur site:instagram.com`,
        gl: "fr",
        hl: "fr",
        num: 5,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();

    for (const result of data?.organic || []) {
      const m = result.link?.match(/instagram\.com\/([a-zA-Z0-9_.]{2,30})\/?/);
      if (m && !SKIP_HANDLES.has(m[1]) && !m[1].includes(".")) {
        return m[1];
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ── Instagram mobile API ──────────────────────────────────────

/**
 * Fetche un profil Instagram via l'API mobile non-authentifiée.
 * Utilise got-scraping pour le TLS fingerprinting navigateur.
 * @param {string} username  sans le @
 */
export async function fetchInstagramProfile(username) {
  const cached = profileCache.get(username);
  if (cached !== undefined) return cached;

  const profile = await igLimiter.schedule(async () => {
    try {
      const response = await gotScraping({
        url: `https://i.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
        headers: {
          "X-IG-App-ID": "936619743392459",
          Accept: "application/json",
          "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
          Referer: "https://www.instagram.com/",
        },
        responseType: "json",
        timeout: { request: 10000 },
      });

      const user = response.body?.data?.user;
      if (!user) return null;

      return {
        biography: user.biography || null,
        external_url: user.external_url || null,
        bio_links: (user.bio_links || []).map((l) => l.url).filter(Boolean),
        business_email: user.business_email || null,
        followers_count: user.edge_followed_by?.count ?? 0,
        full_name: user.full_name || null,
      };
    } catch {
      return null;
    }
  });

  profileCache.set(username, profile);
  return profile;
}

// ── Scraping Linktree ─────────────────────────────────────────

async function scrapeLinktree(url) {
  try {
    const res = await gotScraping({ url, headers: { Accept: "text/html" }, timeout: { request: 8000 } });
    const html = res.body;

    // Linktree injecte toutes ses données dans <script id="__NEXT_DATA__">
    const m = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (m) {
      try {
        const json = JSON.parse(m[1]);
        const pp = json?.props?.pageProps ?? {};
        // Les données sont à différents endroits selon la version de Linktree
        const links = [
          ...(pp.links ?? []),
          ...(pp.account?.links ?? []),
          ...(pp.pageData?.links ?? []),
          ...(pp.pageProfile?.links ?? []),
        ];
        const emails = [];
        for (const link of links) {
          const linkUrl = link.url || link.href || "";
          if (linkUrl.startsWith("mailto:")) {
            const email = linkUrl.replace("mailto:", "").split("?")[0].toLowerCase();
            if (email.includes("@")) emails.push(email);
          }
          emails.push(...extractEmails(linkUrl), ...extractEmails(link.title || ""));
        }
        if (emails.length > 0) return [...new Set(emails)];
      } catch { /* JSON malformé — fallback HTML */ }
    }

    // Fallback : regex directe sur le HTML
    const mailtoEmails = [...html.matchAll(/mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g)].map(
      (mt) => mt[1].toLowerCase()
    );
    return [...new Set([...mailtoEmails, ...extractEmails(html)])];
  } catch {
    return [];
  }
}

// ── Scraping pages génériques (Beacons, bio.link, solo.to) ───

async function scrapeGenericLinkPage(url) {
  try {
    const res = await gotScraping({ url, headers: { Accept: "text/html" }, timeout: { request: 8000 } });
    const $ = cheerio.load(res.body);
    const emails = new Set();

    // mailto: dans les <a>
    $("a[href^='mailto:']").each((_, el) => {
      const href = $(el).attr("href") || "";
      const email = href.replace("mailto:", "").split("?")[0].toLowerCase();
      if (email.includes("@")) emails.add(email);
    });

    // Regex sur le texte visible + HTML brut
    for (const e of extractEmails($("body").text())) emails.add(e);
    for (const e of extractEmails(res.body)) emails.add(e);

    return [...emails];
  } catch {
    return [];
  }
}

function isLinktree(url) { return !!url?.includes("linktr.ee"); }
function isLinkPage(url) {
  return !!url && (
    url.includes("linktr.ee") ||
    url.includes("beacons.ai") ||
    url.includes("bio.link") ||
    url.includes("solo.to")
  );
}

// ── Export principal ──────────────────────────────────────────

/**
 * Trouve le handle Instagram et les emails de contact d'un artiste.
 *
 * @param {string} artistName
 * @returns {Promise<{
 *   handle: string|null,
 *   biography: string|null,
 *   emails: string[],
 *   externalUrl: string|null,
 *   followersCount: number
 * }>}
 */
export async function findArtistEmail(artistName) {
  const result = {
    handle: null,
    biography: null,
    emails: [],
    externalUrl: null,
    followersCount: 0,
  };

  // ── Étape 1 : Trouver le handle ────────────────────────────
  let username = await findHandleViaGenius(artistName);
  if (!username) username = await findHandleViaSerper(artistName);
  if (!username) return result;

  result.handle = "@" + username;

  // ── Étape 2 : Profil Instagram via API mobile ──────────────
  const profile = await fetchInstagramProfile(username);
  if (!profile) return result;

  result.biography = profile.biography;
  result.externalUrl = profile.external_url;
  result.followersCount = profile.followers_count;

  // ── Étape 3 : Emails de la bio ─────────────────────────────
  if (profile.business_email) result.emails.push(profile.business_email.toLowerCase());
  result.emails.push(...extractEmails(profile.biography));

  // ── Étape 4 : Scraper les link pages ──────────────────────
  const linksToCheck = [profile.external_url, ...(profile.bio_links || [])].filter(Boolean);

  for (const url of linksToCheck) {
    try {
      const pageEmails = isLinktree(url)
        ? await scrapeLinktree(url)
        : isLinkPage(url)
        ? await scrapeGenericLinkPage(url)
        : await scrapeGenericLinkPage(url);
      result.emails.push(...pageEmails);
    } catch { /* silencieux */ }
  }

  // Déduplique
  result.emails = [...new Set(result.emails)].filter(Boolean);

  return result;
}

/**
 * Enrichit les données d'un handle Instagram déjà connu.
 * Utilisé par contacts.js pour upgrader le scraping HTML basique.
 *
 * @param {string} handle  avec ou sans @
 * @returns {Promise<{email: string|null, emails: string[], bio: string|null, externalUrl: string|null, followersCount: number}>}
 */
export async function enrichInstagramHandle(handle) {
  const username = handle.replace(/^@/, "");
  const profile = await fetchInstagramProfile(username);

  if (!profile) return { email: null, emails: [], bio: null, externalUrl: null, followersCount: 0 };

  const emails = [];
  if (profile.business_email) emails.push(profile.business_email.toLowerCase());
  emails.push(...extractEmails(profile.biography));

  const linksToCheck = [profile.external_url, ...(profile.bio_links || [])].filter(Boolean);
  for (const url of linksToCheck) {
    try {
      const pageEmails = isLinktree(url)
        ? await scrapeLinktree(url)
        : await scrapeGenericLinkPage(url);
      emails.push(...pageEmails);
    } catch { /* silencieux */ }
  }

  const unique = [...new Set(emails)].filter(Boolean);
  return {
    email: unique[0] || null,
    emails: unique,
    bio: profile.biography,
    externalUrl: profile.external_url,
    followersCount: profile.followers_count,
  };
}
