import express from "express";
import cors from "cors";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildGeniusNetwork } from "./scripts/genius-network.js";
import { discoverContact } from "./scripts/contactDiscovery.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Charge .env manuellement (pas de dépendance dotenv)
try {
  readFileSync(".env", "utf-8").split("\n").forEach((line) => {
    const [k, ...v] = line.split("=");
    if (k?.trim() && v.length) process.env[k.trim()] ??= v.join("=").trim();
  });
} catch { /* .env optionnel */ }

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Sert le build React en production
const distPath = path.join(__dirname, "dist");
if (existsSync(distPath)) {
  app.use(express.static(distPath));
}

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error("\n❌ ANTHROPIC_API_KEY manquante !");
  console.error("Lance avec :  ANTHROPIC_API_KEY=sk-ant-... node server.js\n");
  process.exit(1);
}

app.post("/api/claude", async (req, res) => {
  try {
    console.log(`→ Appel API (${req.body.tools ? "web_search" : "standard"})...`);
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    if (!response.ok) {
      console.error(`  ✗ API ${response.status}:`, data.error?.message || "");
      return res.status(response.status).json(data);
    }
    const textLen = (data.content || [])
      .filter((b) => b.type === "text")
      .reduce((s, b) => s + b.text.length, 0);
    console.log(`  ✓ OK (${textLen} chars de texte)`);
    res.json(data);
  } catch (err) {
    console.error("  ✗ Erreur proxy:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/deezer", async (req, res) => {
  const { path } = req.query;
  if (!path) return res.status(400).json({ error: "missing path" });
  try {
    const url = "https://api.deezer.com" + path;
    console.log(`→ Deezer: ${path}`);
    const response = await fetch(url);
    const data = await response.json();
    if (data?.error) {
      console.error(`  ✗ Deezer error:`, data.error.message || data.error);
      return res.status(400).json(data);
    }
    res.json(data);
  } catch (err) {
    console.error("  ✗ Deezer fetch:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// /api/contacts — Serper + Apify pipeline (zero LLM)
app.get("/api/contacts", async (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: "missing name" });
  try {
    console.log(`→ Contacts: "${name}"`);
    const raw = await discoverContact(name);

    // Adapter : mappe le format discoverContact vers ce qu'attend le front
    const result = {
      name,
      instagram:  raw.handle,
      email:      raw.emails?.[0] || null,
      emails:     raw.emails || [],
      biography:  raw.biography,
      externalUrl: raw.externalUrl,
      followersCount: raw.followersCount,
      profileUrl: raw.profileUrl,
      source:     raw.source,
      confidence: raw.handle
        ? (raw.emails?.length > 0 ? "high" : "medium")
        : "low",
    };

    console.log(`  ✓ ${result.confidence} · IG: ${result.instagram || "—"} · email: ${result.email || "—"}`);
    res.json(result);
  } catch (err) {
    console.error("  ✗ Contacts:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// /api/contacts/batch — traitement de plusieurs artistes
app.post("/api/contacts/batch", async (req, res) => {
  const { artists } = req.body;
  if (!artists || !Array.isArray(artists)) {
    return res.status(400).json({ error: "artists array required" });
  }
  console.log(`→ Contacts batch: ${artists.length} artistes`);
  const results = [];
  for (const name of artists) {
    try {
      const raw = await discoverContact(name);
      results.push({
        name,
        instagram:  raw.handle,
        email:      raw.emails?.[0] || null,
        emails:     raw.emails || [],
        biography:  raw.biography,
        externalUrl: raw.externalUrl,
        followersCount: raw.followersCount,
        source:     raw.source,
        confidence: raw.handle ? (raw.emails?.length > 0 ? "high" : "medium") : "low",
      });
    } catch (err) {
      console.error(`  ✗ batch "${name}":`, err.message);
      results.push({ name, error: err.message });
    }
  }
  res.json(results);
});

// /api/genius-network — réseau artistique via Genius (producers, featurings) + fan counts Deezer
app.get("/api/genius-network", async (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: "missing name" });
  try {
    console.log(`→ Genius network: "${name}"`);
    const result = await buildGeniusNetwork(name);
    console.log(`  ✓ ${result.artists.length} artistes · ${result.beatmakers.length} beatmakers`);
    res.json(result);
  } catch (err) {
    console.error("  ✗ Genius network:", err.message);
    res.status(500).json({ error: err.message });
  }
});


// SPA fallback — toutes les routes non-API servent index.html
if (existsSync(distPath)) {
  app.use((req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🟢 PurB lancé sur le port ${PORT}`);
  console.log(`   Clé API: ${API_KEY.slice(0, 12)}...${API_KEY.slice(-4)}\n`);
});
