#!/usr/bin/env node
/**
 * pipeline.js — CLI de scraping réseau Deezer
 *
 * Usage:
 *   npm run scrape -- --artist "Bloodysanji"
 *   npm run scrape -- --from-pipeline [--limit 5]
 */

import { scrapeNetwork } from "./deezer.js";
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../data");
const LATEST_PATH = join(DATA_DIR, "latest.json");

mkdirSync(DATA_DIR, { recursive: true });

// ── Parse args ────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(flag) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}

const artistArg = getArg("--artist");
const fromPipeline = args.includes("--from-pipeline");
const limitArg = parseInt(getArg("--limit") || "0", 10);

if (!artistArg && !fromPipeline) {
  console.error("Usage:");
  console.error("  npm run scrape -- --artist <nom>");
  console.error("  npm run scrape -- --from-pipeline [--limit N]");
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────

function saveResult(data, label) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const slug = label.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
  const filename = `pipeline-${slug}-${ts}.json`;
  const filepath = join(DATA_DIR, filename);

  writeFileSync(filepath, JSON.stringify(data, null, 2));
  writeFileSync(LATEST_PATH, JSON.stringify(data, null, 2));

  console.log(`\n📁 data/${filename}`);
  console.log(`📁 data/latest.json (mis à jour)`);
  return filepath;
}

function printSummary(artists, beatmakers) {
  const v1 = artists.filter((a) => a.wave === "V1").length;
  const v2 = artists.filter((a) => a.wave === "V2").length;
  const v3 = artists.filter((a) => a.wave === "V3").length;
  console.log("\n📊 Résumé:");
  console.log(`  V1 (< 1k fans)   : ${v1}`);
  console.log(`  V2 (1k – 10k)    : ${v2}`);
  console.log(`  V3 (10k – 100k)  : ${v3}`);
  console.log(`  Beatmakers        : ${beatmakers.length}`);
  console.log(`  Total             : ${artists.length + beatmakers.length}`);

  if (artists.length > 0) {
    console.log("\n🎤 Top artistes (par fans) :");
    artists
      .sort((a, b) => b.nb_fan - a.nb_fan)
      .slice(0, 10)
      .forEach((a) =>
        console.log(
          `  [${a.wave}] ${a.name.padEnd(24)} ${a.nb_fan.toLocaleString("fr-FR").padStart(8)} fans` +
            (a.top_track ? ` · "${a.top_track}"` : "")
        )
      );
  }
}

// ── Mode : artiste unique ─────────────────────────────────

if (artistArg) {
  console.log(`\n🔍 Scraping réseau de "${artistArg}"...\n`);
  try {
    const result = await scrapeNetwork(artistArg, { onProgress: console.log });
    const output = { timestamp: new Date().toISOString(), ...result };
    saveResult(output, artistArg);
    printSummary(result.artists, result.beatmakers);
  } catch (e) {
    console.error("\n❌", e.message);
    process.exit(1);
  }
}

// ── Mode : depuis pipeline existant ──────────────────────

if (fromPipeline) {
  let latest;
  try {
    latest = JSON.parse(readFileSync(LATEST_PATH, "utf-8"));
  } catch {
    console.error("❌ Aucun pipeline trouvé. Lance d'abord:");
    console.error("   npm run scrape -- --artist <nom>");
    process.exit(1);
  }

  const allNames = [
    ...(latest.artists || []).map((a) => a.name),
    ...(latest.beatmakers || []).map((b) => b.name),
  ];

  const targets = limitArg > 0 ? allNames.slice(0, limitArg) : allNames;
  console.log(
    `\n📋 Pipeline source: "${latest.sourceArtist}" (${latest.timestamp?.slice(0, 10)})`
  );
  console.log(`🔍 Scraping ${targets.length}/${allNames.length} artistes...\n`);

  const allArtists = [];
  const allBeatmakers = new Map(); // name → data (dédupliqué)
  const errors = [];

  for (let i = 0; i < targets.length; i++) {
    const name = targets[i];
    console.log(`\n[${i + 1}/${targets.length}] ${name}`);
    try {
      const result = await scrapeNetwork(name, {
        onProgress: (m) => console.log("  " + m),
      });
      for (const a of result.artists) {
        if (!allArtists.find((x) => x.deezer_id === a.deezer_id)) allArtists.push(a);
      }
      for (const b of result.beatmakers) {
        if (!allBeatmakers.has(b.name)) allBeatmakers.set(b.name, b);
      }
    } catch (e) {
      console.error(`  ❌ ${e.message}`);
      errors.push({ name, error: e.message });
    }
  }

  const output = {
    timestamp: new Date().toISOString(),
    sourceArtist: latest.sourceArtist,
    mode: "from-pipeline",
    scrapedCount: targets.length,
    artists: allArtists,
    beatmakers: [...allBeatmakers.values()],
    errors,
  };

  saveResult(output, `${latest.sourceArtist}-extended`);
  printSummary(allArtists, [...allBeatmakers.values()]);

  if (errors.length > 0) {
    console.log(`\n⚠️  ${errors.length} erreur(s):`);
    errors.forEach((e) => console.log(`  - ${e.name}: ${e.error}`));
  }
}
