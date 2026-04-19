#!/usr/bin/env node
/**
 * dm.js — Génération de DMs beatmaker via Claude
 *
 * Usage:
 *   npm run dm -- --artist "Bloodysanji" --style "dark trap électro"
 *   npm run dm -- --artist "Bloodysanji"  (style optionnel)
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LATEST_PATH = join(__dirname, "../data/latest.json");

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error("❌ ANTHROPIC_API_KEY manquante");
  console.error("   Lance avec: ANTHROPIC_API_KEY=sk-ant-... npm run dm ...");
  process.exit(1);
}

// ── Args ──────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(flag) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}

const artistArg = getArg("--artist");
const styleArg = getArg("--style");

if (!artistArg) {
  console.error("Usage: npm run dm -- --artist <nom> [--style <style>]");
  process.exit(1);
}

// ── Charger pipeline ──────────────────────────────────────

let pipelineData;
try {
  pipelineData = JSON.parse(readFileSync(LATEST_PATH, "utf-8"));
} catch {
  console.error("❌ Aucun pipeline trouvé. Lance d'abord:");
  console.error("   npm run scrape -- --artist <nom>");
  process.exit(1);
}

const allPeople = [
  ...(pipelineData.artists || []),
  ...(pipelineData.beatmakers || []).map((b) => ({ ...b, _bm: true })),
];

const artist = allPeople.find(
  (a) => a.name.toLowerCase() === artistArg.toLowerCase()
);

if (!artist) {
  console.error(`\n❌ "${artistArg}" introuvable dans le pipeline.`);
  console.error(`\nArtistes disponibles (${allPeople.length}) :`);
  allPeople.forEach((a) => {
    const wave = a.wave ? ` [${a.wave}]` : "";
    const fans = a.nb_fan ? ` · ${a.nb_fan.toLocaleString("fr-FR")} fans` : "";
    console.error(`  - ${a.name}${wave}${fans}`);
  });
  process.exit(1);
}

// ── Afficher les infos ────────────────────────────────────

console.log("\n" + "─".repeat(60));
console.log(`🎤  ${artist.name}`);
if (artist.nb_fan) console.log(`    Fans Deezer : ${artist.nb_fan.toLocaleString("fr-FR")}`);
if (artist.wave)    console.log(`    Wave        : ${artist.wave}`);
if (artist.top_track) console.log(`    Top track   : "${artist.top_track}"`);
if (artist.label)   console.log(`    Label       : ${artist.label}`);
if (artist.producer) console.log(`    Producteur  : ${artist.producer}`);
if (artist.source)  console.log(`    Source      : ${artist.source}`);
if (styleArg)       console.log(`    Style prod  : ${styleArg}`);
console.log("─".repeat(60));

// ── Prompt ────────────────────────────────────────────────

const prompt = `Tu es un beatmaker français qui veut envoyer une prod à ${artist.name}.

INFOS ARTISTE (données Deezer réelles):
- Fans: ${artist.nb_fan?.toLocaleString("fr-FR") || "?"}
- Top track: "${artist.top_track || "inconnu"}"
- Label/collectif: ${artist.label || "indépendant"}
- Producteur attitré: ${artist.producer || "inconnu"}
${styleArg ? `- Style de ta prod: "${styleArg}"` : ""}

CE QU'ON SAIT DU RAP FR ÉMERGENT:
- Le contact passe quasi toujours par DM Instagram
- Citer un vrai son = montre que t'as vraiment écouté l'artiste, pas un copier-coller
- Mentionner le collectif/label montre que tu connais leur univers
- Court = mieux (4-6 lignes). Long = supprimé sans lecture.
- Si t'as un producteur attitré connu, tu peux l'invoquer ("j'ai kiffé ce que X a fait sur...")

RÈGLES D'ÉCRITURE:
- Humain, jamais robotique. Aucun mot corporate.
- Tutoiement naturel. Aucun "j'espère que tu vas bien".
- Décontracté mais pro — t'es sérieux dans ta démarche, mais cool.
- 2 variantes VRAIMENT différentes : approche différente, ton différent, pas juste reformuler.${artist.top_track ? `\n- Variante 1 : cite obligatoirement "${artist.top_track}".` : ""}
- Variante 2 : angle totalement différent (peut mentionner le collectif, le style, autre son...).

JSON uniquement, sans backticks:
{"messages":[{"approach":"nom de l'approche","text":"le message complet prêt à envoyer","send_via":"Instagram DM"}]}`;

// ── Appel Claude ──────────────────────────────────────────

console.log("\n⏳ Génération en cours...\n");

try {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: "Beatmaker FR qui DM des artistes émergents. Naturel, jamais robotique. JSON uniquement.",
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);

  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  // Parse JSON
  const clean = text.replace(/```json|```/g, "").trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Réponse JSON invalide");
  const parsed = JSON.parse(match[0]);

  if (!parsed?.messages?.length) throw new Error("Aucun message dans la réponse");

  // ── Affichage ──────────────────────────────────────────
  parsed.messages.forEach((m, i) => {
    console.log(`📩 Variante ${i + 1} — ${m.approach}`);
    console.log(`Via : ${m.send_via}`);
    console.log("─".repeat(60));
    console.log(m.text);
    console.log("─".repeat(60));
    if (i < parsed.messages.length - 1) console.log();
  });
} catch (e) {
  console.error("❌ Erreur Claude:", e.message);
  process.exit(1);
}
