/**
 * contactDiscovery.js — Pipeline de découverte de contacts
 *
 * Ordre de priorité :
 *  1. Handle Instagram via Serper.dev (Google Search)
 *  2. Handle Instagram via Genius API (fallback gratuit)
 *  3. Profil Instagram via Apify (scraping managé)
 *  4. Profil Instagram via API mobile directe (fallback dégradé sans Apify)
 *  5. Scraping link pages (Linktree, Beacons, bio.link, solo.to)
 */

import Bottleneck from "bottleneck";
import * as cheerio from "cheerio";
import { ApifyClient } from "apify-client";

// ─── Rate limiters ────────────────────────────────────────────────────────────
const serperLimiter    = new Bottleneck({ maxConcurrent: 1, minTime: 600 });
const geniusLimiter    = new Bottleneck({ maxConcurrent: 1, minTime: 100 });
const instagramLimiter = new Bottleneck({ maxConcurrent: 1, minTime: 4000 });
const linktreeLimiter  = new Bottleneck({ maxConcurrent: 1, minTime: 2000 });

// ─── Constantes ───────────────────────────────────────────────────────────────
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const MOBILE_UA  = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1";

const SKIP_HANDLES = new Set([
  "p", "reel", "reels", "explore", "stories", "accounts",
  "directory", "about", "legal", "developer", "press",
  "help", "music", "tv", "startpage",
]);

const LINK_PAGE_DOMAINS = [
  "linktr.ee", "beacons.ai", "bio.link", "solo.to",
  "allmylinks.com", "linkr.bio", "msha.ke",
];

// ─── Extraction d'emails ──────────────────────────────────────────────────────
function extractEmails(text) {
  if (!text) return [];
  const emails = new Set();

  // 1. Emails standards
  for (const m of text.matchAll(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g)) {
    emails.add(m[0].toLowerCase());
  }

  // 2. Unicode ＠ fullwidth
  for (const m of text.matchAll(/([a-zA-Z0-9._%+-]+)＠([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g)) {
    emails.add(`${m[1]}@${m[2]}`.toLowerCase());
  }

  // 3. [at] / (at) + [dot] / (dot) obfuscation
  const deobf = text
    .replace(/\s*\[at\]\s*/gi, "@")
    .replace(/\s*\(at\)\s*/gi, "@")
    .replace(/\s*\[dot\]\s*/gi, ".")
    .replace(/\s*\(dot\)\s*/gi, ".")
    .replace(/\s*＠\s*/g, "@")
    .replace(/([a-zA-Z0-9._%+-])\s+@\s+([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, "$1@$2");
  for (const m of deobf.matchAll(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g)) {
    emails.add(m[0].toLowerCase());
  }

  return [...emails].filter(e =>
    !e.includes("example") &&
    !e.includes("youremail") &&
    !e.includes("sentry") &&
    e.length < 100
  );
}

// ─── 3.1A — Résolution handle via Serper.dev ─────────────────────────────────
async function findHandleViaSerper(name) {
  const key = process.env.SERPER_API_KEY;
  if (!key) return null;

  const queries = [
    `"${name}" instagram musique`,
    `${name} rappeur instagram`,
  ];

  for (const q of queries) {
    try {
      const data = await serperLimiter.schedule(() =>
        fetch("https://google.serper.dev/search", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-API-KEY": key },
          body: JSON.stringify({ q, gl: "fr", hl: "fr", num: 10 }),
        }).then(r => r.json())
      );

      for (const result of data?.organic || []) {
        // Nettoyer l'URL : virer query params et fragments avant de matcher
        const cleanUrl = (result.link || "").split("?")[0].split("#")[0].replace(/\/$/, "");
        const m = cleanUrl.match(/https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._]{2,40})$/);
        if (m && !SKIP_HANDLES.has(m[1])) {
          console.log(`  [serper] handle trouvé via "${q}" → @${m[1]}`);
          return m[1];
        }
      }
      console.log(`  [serper] aucun handle IG dans "${q}"`);
    } catch (err) {
      console.error(`  [serper] erreur sur "${q}":`, err.message);
    }
  }
  return null;
}

// ─── 3.1B — Résolution handle via Genius API ─────────────────────────────────
async function findHandleViaGenius(name) {
  const token = process.env.GENIUS_ACCESS_TOKEN;
  if (!token) return null;

  try {
    const searchData = await geniusLimiter.schedule(() =>
      fetch(`https://api.genius.com/search?q=${encodeURIComponent(name)}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then(r => r.json())
    );

    const nameLower = name.toLowerCase();
    const hit = (searchData?.response?.hits || []).find(
      h => h.type === "song" &&
        h.result?.primary_artist?.name?.toLowerCase().includes(nameLower.split(" ")[0])
    );
    if (!hit) { console.log(`  [genius] artiste "${name}" non trouvé`); return null; }

    const artistId = hit.result.primary_artist.id;
    const artistData = await geniusLimiter.schedule(() =>
      fetch(`https://api.genius.com/artists/${artistId}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then(r => r.json())
    );

    const ig = artistData?.response?.artist?.instagram_name;
    if (ig) {
      const handle = ig.replace(/^@/, "");
      console.log(`  [genius] handle trouvé → @${handle}`);
      return handle;
    }
    console.log(`  [genius] pas d'instagram_name pour "${name}"`);
    return null;
  } catch (err) {
    console.error(`  [genius] erreur:`, err.message);
    return null;
  }
}

// ─── 3.2 — Scraping profil via Apify ─────────────────────────────────────────
async function scrapeProfileViaApify(handle) {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) return null;

  console.log(`  [apify] scraping @${handle}...`);
  try {
    const client = new ApifyClient({ token });
    const run = await client.actor("apify/instagram-profile-scraper").call({
      usernames: [handle],
    });

    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    const profile = items[0];
    if (!profile) { console.log(`  [apify] aucun résultat pour @${handle}`); return null; }

    console.log(`  [apify] ✓ @${handle} — ${profile.followersCount ?? "?"} followers`);
    return {
      biography:           profile.biography || null,
      externalUrl:         profile.externalUrl || null,
      businessEmail:       profile.businessEmail || null,
      businessPhoneNumber: profile.businessPhoneNumber || null,
      followersCount:      profile.followersCount ?? null,
      postsCount:          profile.postsCount ?? null,
      profileUrl:          profile.url || `https://www.instagram.com/${handle}/`,
    };
  } catch (err) {
    console.error(`  [apify] erreur pour @${handle}:`, err.message);
    return null;
  }
}

// ─── 3.4 — Fallback profil sans Apify (API mobile directe) ───────────────────
async function scrapeProfileDirect(handle) {
  console.log(`  [ig-direct] tentative fallback @${handle}...`);
  try {
    const data = await instagramLimiter.schedule(() =>
      fetch(`https://i.instagram.com/api/v1/users/web_profile_info/?username=${handle}`, {
        headers: {
          "X-IG-App-ID": "936619743392459",
          "User-Agent": MOBILE_UA,
          "Accept": "application/json",
          "Accept-Language": "fr-FR,fr;q=0.9",
          "Referer": "https://www.instagram.com/",
        },
      }).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
    );

    const user = data?.data?.user;
    if (!user) return null;

    console.log(`  [ig-direct] ✓ @${handle}`);
    return {
      biography:           user.biography || null,
      externalUrl:         user.external_url || null,
      businessEmail:       user.business_email || null,
      businessPhoneNumber: null,
      followersCount:      user.edge_followed_by?.count ?? null,
      postsCount:          user.edge_owner_to_timeline_media?.count ?? null,
      profileUrl:          `https://www.instagram.com/${handle}/`,
    };
  } catch (err) {
    console.log(`  [ig-direct] bloqué pour @${handle}: ${err.message}`);
    return null;
  }
}

// ─── 3.3C — Scraping Linktree ─────────────────────────────────────────────────
async function scrapeLinktree(url) {
  try {
    const res = await linktreeLimiter.schedule(() =>
      fetch(url, { headers: { "User-Agent": BROWSER_UA, Accept: "text/html" } })
    );
    if (!res.ok) return [];
    const html = await res.text();

    const m = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (m) {
      try {
        const json = JSON.parse(m[1]);
        const pp = json?.props?.pageProps ?? {};
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
        if (emails.length > 0) {
          console.log(`  [linktree] ${emails.length} email(s) trouvé(s)`);
          return [...new Set(emails)];
        }
      } catch { /* JSON malformé, fallback HTML */ }
    }

    const mailtos = [...html.matchAll(/mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g)]
      .map(mt => mt[1].toLowerCase());
    return [...new Set([...mailtos, ...extractEmails(html)])];
  } catch (err) {
    console.error(`  [linktree] erreur ${url}:`, err.message);
    return [];
  }
}

// ─── 3.3C — Scraping pages génériques (Beacons, bio.link, solo.to) ────────────
async function scrapeGenericLinkPage(url) {
  try {
    const res = await linktreeLimiter.schedule(() =>
      fetch(url, { headers: { "User-Agent": BROWSER_UA, Accept: "text/html" } })
    );
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const emails = new Set();

    $("a[href^='mailto:']").each((_, el) => {
      const href = $(el).attr("href") || "";
      const email = href.replace("mailto:", "").split("?")[0].toLowerCase();
      if (email.includes("@")) emails.add(email);
    });

    for (const e of extractEmails($("body").text())) emails.add(e);
    for (const e of extractEmails(html)) emails.add(e);

    if (emails.size > 0) console.log(`  [linkpage] ${emails.size} email(s) via ${url}`);
    return [...emails];
  } catch (err) {
    console.error(`  [linkpage] erreur ${url}:`, err.message);
    return [];
  }
}

// ─── Export principal ──────────────────────────────────────────────────────────
/**
 * Découvre les contacts Instagram d'un artiste.
 *
 * @param {string} artistName
 * @returns {Promise<{
 *   handle: string|null,
 *   source: string,
 *   biography: string|null,
 *   emails: string[],
 *   externalUrl: string|null,
 *   followersCount: number|null,
 *   profileUrl: string|null,
 * }>}
 */
export async function discoverContact(artistName) {
  console.log(`\n[contactDiscovery] ── "${artistName}" ──`);

  const result = {
    handle:        null,
    source:        "not_found",
    biography:     null,
    emails:        [],
    externalUrl:   null,
    followersCount: null,
    profileUrl:    null,
  };

  // ── Étape 1 : Résolution du handle ─────────────────────────────────────────
  let handle = null;
  let source = "not_found";

  if (process.env.SERPER_API_KEY) {
    console.log(`  [step 1] Serper → recherche handle...`);
    handle = await findHandleViaSerper(artistName);
    if (handle) source = "serper";
  } else {
    console.log(`  [step 1] SERPER_API_KEY absent — skip`);
  }

  if (!handle && process.env.GENIUS_ACCESS_TOKEN) {
    console.log(`  [step 1] Genius → recherche handle...`);
    handle = await findHandleViaGenius(artistName);
    if (handle) source = "genius";
  }

  if (!handle) {
    console.log(`  [step 1] aucun handle trouvé pour "${artistName}"`);
    return result;
  }

  result.handle = "@" + handle;
  result.source = source;
  console.log(`  [step 1] ✓ handle = @${handle} (source: ${source})`);

  // ── Étape 2 : Profil Instagram ─────────────────────────────────────────────
  let profile = null;

  if (process.env.APIFY_API_TOKEN) {
    console.log(`  [step 2] Apify → scraping profil...`);
    profile = await scrapeProfileViaApify(handle);
  } else {
    console.log(`  [step 2] APIFY_API_TOKEN absent → fallback API directe`);
  }

  if (!profile) {
    console.log(`  [step 2] fallback → API mobile directe...`);
    profile = await scrapeProfileDirect(handle);
  }

  if (!profile) {
    console.log(`  [step 2] aucun profil récupéré — retour handle only`);
    return result;
  }

  result.biography     = profile.biography;
  result.externalUrl   = profile.externalUrl;
  result.followersCount = profile.followersCount;
  result.profileUrl    = profile.profileUrl;

  // ── Étape 3 : Collecte des emails ──────────────────────────────────────────
  const emailSet = new Set();

  if (profile.businessEmail) {
    console.log(`  [step 3] businessEmail: ${profile.businessEmail}`);
    emailSet.add(profile.businessEmail.toLowerCase());
  }

  for (const e of extractEmails(profile.biography)) emailSet.add(e);

  const linksToCheck = [profile.externalUrl].filter(Boolean);
  for (const url of linksToCheck) {
    const isLinkPage = LINK_PAGE_DOMAINS.some(d => url.includes(d));
    if (!isLinkPage) continue;

    console.log(`  [step 3] scraping link page: ${url}`);
    const pageEmails = url.includes("linktr.ee")
      ? await scrapeLinktree(url)
      : await scrapeGenericLinkPage(url);
    for (const e of pageEmails) emailSet.add(e);
  }

  result.emails = [...emailSet].filter(Boolean);

  console.log(`  [contactDiscovery] ✓ "${artistName}" — handle:@${handle} emails:[${result.emails.join(", ") || "aucun"}] followers:${result.followersCount ?? "?"}`);
  return result;
}
