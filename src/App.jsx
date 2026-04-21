import { useState, useEffect, useCallback, useRef } from "react";
import "./App.css";

const API_URL = "/api/claude";
const MODEL = "claude-sonnet-4-20250514";

// ─── DEEZER API ───────────────────────────────────────────────────────────────
async function deezerFetch(path) {
  const res = await fetch("/api/deezer?path=" + encodeURIComponent(path));
  if (!res.ok) throw new Error(`Deezer HTTP ${res.status}`);
  const d = await res.json();
  if (d?.error) throw new Error(d.error.message || "Deezer error");
  return d;
}
function classifyWave(nb_fan) {
  if (nb_fan < 1000) return "V1";
  if (nb_fan < 10000) return "V2";
  return "V3";
}

// ─── CLAUDE API ───────────────────────────────────────────────────────────────
async function apiFetch(body, timeoutMs = 60000, _retry = 0) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(API_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (res.status === 429 && _retry < 3) {
      const wait = Math.min(5000 * Math.pow(2, _retry), 30000);
      await new Promise(r => setTimeout(r, wait));
      return apiFetch(body, timeoutMs, _retry + 1);
    }
    if (!res.ok) { const e = await res.text().catch(() => ""); throw new Error(`HTTP ${res.status}: ${e.slice(0, 200)}`); }
    return res.json();
  } catch (e) { clearTimeout(timer); if (e.name === "AbortError") throw new Error("Timeout (>60s)"); throw e; }
}
async function askClaude(prompt, system, maxTokens = 1000) {
  const data = await apiFetch({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: prompt }] }, 30000);
  return extractText(data);
}
function extractText(d) { return (d?.content || []).filter(b => b.type === "text").map(b => b.text).join("\n"); }
function parseJSON(t) { if (!t) return null; try { const c = t.replace(/```json|```/g, "").trim(); const m = c.match(/\{[\s\S]*\}|\[[\s\S]*\]/); return m ? JSON.parse(m[0]) : null; } catch { return null; } }

// ─── AudioRing — violet accent on long ticks ───────────────────────────────────
function AudioRing({ size = 540 }) {
  const c = size / 2;
  const R = c * 0.86;
  const ticks = 80;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ animation: "slowRotate 50s linear infinite", position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", pointerEvents: "none", zIndex: 0 }}>
      {[...Array(ticks)].map((_, i) => {
        const angle = (i / ticks) * 2 * Math.PI - Math.PI / 2;
        const long = i % 10 === 0;
        const med  = i % 5 === 0;
        const rIn  = long ? R - 20 : med ? R - 12 : R - 6;
        return (
          <line key={i}
            x1={c + R * Math.cos(angle)} y1={c + R * Math.sin(angle)}
            x2={c + rIn * Math.cos(angle)} y2={c + rIn * Math.sin(angle)}
            stroke={long ? "#FF0066" : "#0a0a0a"}
            strokeWidth={long ? 1.4 : 0.6}
            strokeOpacity={long ? 0.6 : med ? 0.12 : 0.06}
          />
        );
      })}
      <circle cx={c} cy={c} r={R - 24} fill="none" stroke="#FF0066" strokeWidth="0.5" strokeOpacity="0.18"/>
      <circle cx={c} cy={c} r={R * 0.72} fill="none" stroke="#0a0a0a" strokeWidth="0.5" strokeOpacity="0.05"/>
      <circle cx={c} cy={c} r={R * 0.52} fill="none" stroke="#0a0a0a" strokeWidth="0.4" strokeOpacity="0.04"/>
    </svg>
  );
}

// ─── ScrambleText — logique inchangée ─────────────────────────────────────────
function ScrambleText({ text, delay = 400 }) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#@!";
  const [display, setDisplay] = useState(text.split("").map(c => c === " " ? " " : chars[0]).join(""));
  useEffect(() => {
    let t = setTimeout(() => {
      let iter = 0;
      const iv = setInterval(() => {
        iter++;
        if (Math.floor(iter / 2.5) >= text.length) {
          setDisplay(text);
          clearInterval(iv);
          return;
        }
        setDisplay(text.split("").map((c, i) => {
          if (c === " ") return " ";
          if (Math.floor(iter / 2.5) > i) return c;
          return chars[Math.floor(Math.random() * chars.length)];
        }).join(""));
      }, 35);
      return () => clearInterval(iv);
    }, delay);
    return () => clearTimeout(t);
  }, [text, delay]);
  return <>{display}</>;
}

// ─── AnimCounter — Bebas Neue conservé (landing), couleurs → CSS vars ─────────
function AnimCounter({ to, suffix = "+", label }) {
  const [val, setVal] = useState(0);
  const ref = useRef(null);
  const started = useRef(false);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !started.current) {
        started.current = true;
        let v = 0;
        const step = to / 70;
        const iv = setInterval(() => {
          v = Math.min(v + step, to);
          setVal(Math.floor(v));
          if (v >= to) clearInterval(iv);
        }, 18);
      }
    }, { threshold: 0.5 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [to]);
  return (
    <div ref={ref} style={{ textAlign: "center", padding: "20px 0" }}>
      <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: "clamp(52px,5.5vw,80px)", fontWeight: 400, letterSpacing: "0.04em", color: "var(--accent)", lineHeight: 1 }}>
        {val}{suffix}
      </div>
      <div className="sans" style={{ fontSize: 10, color: "var(--g3)", textTransform: "uppercase", letterSpacing: "2.5px", marginTop: 8 }}>{label}</div>
    </div>
  );
}

// ─── WaveformMirror — logique inchangée, couleurs SVG conservées ───────────────
function WaveformMirror({ height = 56, opacity = 0.2 }) {
  const bars = 80;
  const vals = [...Array(bars)].map((_, i) => {
    const x = i / bars;
    return Math.max(0.06, Math.min(0.95,
      Math.abs(Math.sin(x * Math.PI * 2.5)) * 0.45 +
      Math.abs(Math.sin(x * Math.PI * 6.7 + 0.8)) * 0.3 +
      Math.abs(Math.sin(x * Math.PI * 15.3 + 2.1)) * 0.18 +
      Math.abs(Math.sin(x * Math.PI * 29 + 3.7)) * 0.07
    ));
  });
  const hh = height / 2;
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${bars * 9} ${height}`} preserveAspectRatio="none" style={{ opacity }}>
      <defs>
        <linearGradient id="wmg" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#FF0066" stopOpacity="0"/>
          <stop offset="8%"   stopColor="#FF0066" stopOpacity="0.7"/>
          <stop offset="92%"  stopColor="#FF0066" stopOpacity="0.7"/>
          <stop offset="100%" stopColor="#FF0066" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <line x1="0" y1={hh} x2={bars * 9} y2={hh} stroke="#0a0a0a" strokeWidth="0.5" strokeOpacity="0.12"/>
      {vals.map((h, i) => {
        const bh = h * hh;
        return (
          <g key={i}>
            <rect x={i * 9 + 1} y={hh - bh} width={6} height={bh} rx={1} fill="url(#wmg)"/>
            <rect x={i * 9 + 1} y={hh}      width={6} height={bh} rx={1} fill="url(#wmg)"/>
          </g>
        );
      })}
    </svg>
  );
}

// ─── EQBars — gradient → violet accent ────────────────────────────────────────
function EQBars({ count = 48, height = 64, opacity = 0.35 }) {
  const baseH = [22,45,65,35,80,28,58,72,40,85,30,62,48,90,25,70,55,38,78,42,60,32,88,50,20,68,44,82,36,56,24,76,52,95,28,66,46,84,34,74,26,64,42,86,38,72,30,58];
  const anims = ["eq1","eq2","eq3","eq4","eq5","eq6","eq7","eq8"];
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height, overflow: "hidden", opacity }}>
      {[...Array(count)].map((_, i) => (
        <div key={i} style={{
          flex: 1, minWidth: 3, height: `${baseH[i % baseH.length]}%`,
          borderRadius: "2px 2px 0 0",
          background: "linear-gradient(to top, var(--accent), rgba(255,0,102,0.06))",
          animation: `${anims[i % anims.length]} ${(0.55 + (i % 5) * 0.22).toFixed(2)}s ease-in-out infinite`,
          animationDelay: `${(-(i % 9) * 0.17).toFixed(2)}s`,
          transformOrigin: "bottom",
        }}/>
      ))}
    </div>
  );
}

// ─── Corner / GridDots — logique inchangée ────────────────────────────────────
function Corner({ pos = "tl", size = 20 }) {
  const d = { tl:`M${size} 0 L0 0 L0 ${size}`, tr:`M0 0 L${size} 0 L${size} ${size}`, bl:`M0 0 L0 ${size} L${size} ${size}`, br:`M0 ${size} L${size} ${size} L${size} 0` };
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: "absolute", ...{ tl:{top:0,left:0}, tr:{top:0,right:0}, bl:{bottom:0,left:0}, br:{bottom:0,right:0} }[pos] }}>
      <path d={d[pos]} stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" fill="none"/>
    </svg>
  );
}

function GridDots({ rows = 8, cols = 16, gap = 28 }) {
  return (
    <svg width={cols * gap} height={rows * gap} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.06, pointerEvents: "none" }}>
      {[...Array(rows)].flatMap((_, r) =>
        [...Array(cols)].map((_, c) => <circle key={`${r}-${c}`} cx={c * gap + gap / 2} cy={r * gap + gap / 2} r={1} fill="#0a0a0a"/>)
      )}
    </svg>
  );
}

// ─── RobotDJ — kept for potential future use but not rendered in UI ───────────
function RobotDJ({ size = 48, pose = "idle" }) {
  const accent = "#FF0066";
  const sw     = "rgba(0,0,0,0.35)";
  const sf     = "rgba(0,0,0,0.04)";

  return (
    <svg width={size} height={size} viewBox="0 0 80 102" fill="none">
      {/* Antenna */}
      <line x1="40" y1="14" x2="40" y2="8" stroke={sw} strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx="40" cy="6" r="2.5" fill={accent} opacity="0.85"/>

      {/* Headphone band */}
      <path d="M 13 28 Q 40 10 67 28" stroke={sw} strokeWidth="2" strokeLinecap="round"/>
      <ellipse cx="11" cy="31" rx="4.5" ry="7"  fill={sf} stroke={sw} strokeWidth="1.2"/>
      <ellipse cx="69" cy="31" rx="4.5" ry="7"  fill={sf} stroke={sw} strokeWidth="1.2"/>

      {/* Head — fill drawn first so visor layers on top */}
      <rect x="18" y="14" width="44" height="36" rx="8" fill={sf}/>

      {/* Visor band — semi-transparent at eye level */}
      <rect x="18" y="27" width="44" height="12" fill="rgba(0,0,0,0.12)"/>

      {/* Eyes — rect 2:1 (w=14 h=7) */}
      <rect x="22" y="29" width="14" height="7" rx="2" fill={accent}/>
      <rect x="44" y="29" width="14" height="7" rx="2" fill={accent}/>
      {/* Eye shine */}
      <rect x="22.5" y="29.5" width="4" height="2" rx="1" fill="white" opacity="0.35"/>
      <rect x="44.5" y="29.5" width="4" height="2" rx="1" fill="white" opacity="0.35"/>

      {/* Head outline on top — clips visor at rounded corners */}
      <rect x="18" y="14" width="44" height="36" rx="8" fill="none" stroke={sw} strokeWidth="1.2"/>

      {/* Mouth — VU meter (4 horizontal lines, diminishing) */}
      <line x1="24" y1="43" x2="56" y2="43" stroke={accent} strokeWidth="1.5" strokeLinecap="round" opacity="0.9"/>
      <line x1="26" y1="46" x2="54" y2="46" stroke={accent} strokeWidth="1.5" strokeLinecap="round" opacity="0.6"/>
      <line x1="29" y1="49" x2="51" y2="49" stroke={accent} strokeWidth="1.5" strokeLinecap="round" opacity="0.3"/>
      <line x1="32" y1="52" x2="48" y2="52" stroke={accent} strokeWidth="1.5" strokeLinecap="round" opacity="0.12"/>

      {/* Body fill */}
      <rect x="21" y="55" width="38" height="24" rx="6" fill={sf}/>
      {/* Speaker grille — 3 horizontal lines */}
      <line x1="25" y1="61"   x2="55" y2="61"   stroke={sw} strokeWidth="1" opacity="0.35"/>
      <line x1="25" y1="65.5" x2="55" y2="65.5" stroke={sw} strokeWidth="1" opacity="0.35"/>
      <line x1="25" y1="70"   x2="55" y2="70"   stroke={sw} strokeWidth="1" opacity="0.35"/>
      {/* Body outline */}
      <rect x="21" y="55" width="38" height="24" rx="6" fill="none" stroke={sw} strokeWidth="1.2"/>

      {/* Left arm — always same */}
      <line x1="21" y1="63" x2="9"  y2="75" stroke={sw} strokeWidth="2" strokeLinecap="round"/>
      <circle cx="8"  cy="77" r="3" fill={sf} stroke={sw} strokeWidth="1.2"/>

      {/* Right arm — pose-dependent */}
      {pose === "wave" ? (
        <>
          <line x1="59" y1="63" x2="71" y2="49" stroke={sw} strokeWidth="2" strokeLinecap="round"/>
          <circle cx="72" cy="47" r="3" fill={sf} stroke={sw} strokeWidth="1.2"/>
        </>
      ) : pose === "think" ? (
        <>
          <line x1="59" y1="63" x2="68" y2="53" stroke={sw} strokeWidth="2" strokeLinecap="round"/>
          <line x1="68" y1="53" x2="62" y2="44" stroke={sw} strokeWidth="2" strokeLinecap="round"/>
          <circle cx="61" cy="43" r="3" fill={sf} stroke={sw} strokeWidth="1.2"/>
        </>
      ) : (
        <>
          <line x1="59" y1="63" x2="71" y2="75" stroke={sw} strokeWidth="2" strokeLinecap="round"/>
          <circle cx="72" cy="77" r="3" fill={sf} stroke={sw} strokeWidth="1.2"/>
        </>
      )}

      {/* Legs */}
      <line x1="32" y1="79" x2="28" y2="96" stroke={sw} strokeWidth="2" strokeLinecap="round"/>
      <line x1="48" y1="79" x2="52" y2="96" stroke={sw} strokeWidth="2" strokeLinecap="round"/>
      {/* Feet */}
      <ellipse cx="26" cy="98" rx="6" ry="2.5" fill={sw} opacity="0.5"/>
      <ellipse cx="54" cy="98" rx="6" ry="2.5" fill={sw} opacity="0.5"/>
    </svg>
  );
}

const LOADER_MSGS = [
  "On est en train de trouver les contacts pour toi — continue de faire des prods à envoyer…",
  "La signature n'est qu'à une dizaine de contacts.",
  "Chaque artiste contacté est une porte qui s'ouvre.",
  "Pendant ce temps, fais chauffer le DAW.",
  "Le réseau, c'est tout. On le construit pour toi.",
  "Un seul bon contact peut tout changer.",
];

function BigLoader({ status, done = 0, total = 0, label = "", onStop }) {
  const [msgIdx, setMsgIdx] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setMsgIdx(i => (i + 1) % LOADER_MSGS.length), 3800);
    return () => clearInterval(iv);
  }, []);

  const hasPct = total > 0;
  const pct    = hasPct ? Math.round((done / total) * 100) : null;
  const r      = 84;
  const circ   = 2 * Math.PI * r;
  const dash   = hasPct ? (done / total) * circ : 0;
  const ticks  = 60;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "calc(100vh - 280px)", padding: "60px 24px 100px", position: "relative", overflow: "hidden" }}>

      {/* AudioRing ambiant */}
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", opacity: 0.09, pointerEvents: "none", zIndex: 0 }}>
        <AudioRing size={500}/>
      </div>

      {/* Noise texture */}
      <div style={{ position: "absolute", inset: 0, backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")", opacity: 0.02, pointerEvents: "none", zIndex: 0 }}/>

      {/* Ring SVG */}
      <div style={{ position: "relative", zIndex: 1, marginBottom: 28 }}>
        <svg width={210} height={210} viewBox="0 0 210 210">
          {/* Ticks */}
          {[...Array(ticks)].map((_, i) => {
            const angle  = (i / ticks) * 2 * Math.PI - Math.PI / 2;
            const long   = i % 15 === 0;
            const med    = i % 5 === 0;
            const rOut   = 103;
            const len    = long ? 11 : med ? 6 : 3;
            const active = hasPct && i <= Math.round((done / total) * ticks);
            return (
              <line key={i}
                x1={105 + rOut * Math.cos(angle)}       y1={105 + rOut * Math.sin(angle)}
                x2={105 + (rOut - len) * Math.cos(angle)} y2={105 + (rOut - len) * Math.sin(angle)}
                stroke={active ? "#FF0066" : "#e0e0e0"}
                strokeWidth={long ? 2 : 0.8}
                strokeOpacity={active ? (long ? 1 : 0.7) : 1}
              />
            );
          })}

          {/* Track */}
          <circle cx="105" cy="105" r={r} fill="none" stroke="#e0e0e0" strokeWidth="1.5"/>

          {/* Progress arc — determinate */}
          {hasPct && dash > 0 && (
            <circle cx="105" cy="105" r={r} fill="none" stroke="#FF0066" strokeWidth="2.5"
              strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
              transform="rotate(-90 105 105)"
              style={{ transition: "stroke-dasharray 0.55s cubic-bezier(0.4,0,0.2,1)" }}
            />
          )}

          {/* Spinner arc — indeterminate */}
          {!hasPct && (
            <circle cx="105" cy="105" r={r} fill="none" stroke="#FF0066" strokeWidth="2.5"
              strokeDasharray={`${circ * 0.16} ${circ * 0.84}`} strokeLinecap="round">
              <animateTransform attributeName="transform" type="rotate"
                from="-90 105 105" to="270 105 105" dur="1.3s" repeatCount="indefinite"/>
            </circle>
          )}

          {/* Glowing dot at tip of arc */}
          {hasPct && done > 0 && (() => {
            const a = (done / total) * 2 * Math.PI - Math.PI / 2;
            return (
              <>
                <circle cx={105 + r * Math.cos(a)} cy={105 + r * Math.sin(a)} r="6" fill="#FF0066" opacity="0.2"/>
                <circle cx={105 + r * Math.cos(a)} cy={105 + r * Math.sin(a)} r="3" fill="#FF0066"/>
              </>
            );
          })()}
        </svg>

        {/* Centre */}
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
          {hasPct ? (
            <>
              <div className="display" style={{ fontSize: 54, color: "var(--white)", lineHeight: 1, letterSpacing: "0.04em" }}>{pct}%</div>
              <div className="mono" style={{ fontSize: 9, color: "var(--g2)", letterSpacing: "2px" }}>{done}/{total}</div>
            </>
          ) : (
            <div className="display" style={{ fontSize: 18, color: "var(--g2)", letterSpacing: "0.12em" }}>SCAN</div>
          )}
        </div>
      </div>

      {/* Messages + status */}
      <div style={{ textAlign: "center", zIndex: 1, maxWidth: 340 }}>
        {label && <div className="mono" style={{ fontSize: 9, color: "var(--g1)", letterSpacing: "2.5px", textTransform: "uppercase", marginBottom: 14 }}>{label}</div>}
        <div key={msgIdx} className="sans" style={{ fontSize: 14, color: "var(--white)", fontWeight: 500, lineHeight: 1.65, marginBottom: 10, animation: "fadeIn 0.4s ease" }}>
          {LOADER_MSGS[msgIdx]}
        </div>
        {status && (
          <div className="mono" style={{ fontSize: 10, color: "var(--accent)", letterSpacing: "0.5px" }}>
            → {status}
          </div>
        )}
        {onStop && (
          <button onClick={onStop} className="sans" style={{ marginTop: 20, padding: "8px 24px", borderRadius: 2, fontSize: 11, fontWeight: 700, background: "none", border: "1px solid var(--b2)", color: "var(--g3)", cursor: "pointer", letterSpacing: "1px" }}>
            ■ STOP
          </button>
        )}
      </div>

      {/* EQBars bas de page */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}>
        <div style={{ position: "relative" }}>
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to right, var(--bg) 0%, transparent 5%, transparent 95%, var(--bg) 100%)", zIndex: 1, pointerEvents: "none" }}/>
          <EQBars count={64} height={44} opacity={0.13}/>
        </div>
      </div>
    </div>
  );
}

function StatusBar({ text, loading: isLoading }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", marginBottom: 20, background: "var(--s1)", border: "1px solid var(--b1)", borderRadius: 10, borderLeft: "3px solid var(--accent)" }}>
      {isLoading && <span style={{ width: 10, height: 10, borderRadius: "50%", border: "1.5px solid var(--b2)", borderTopColor: "var(--accent)", display: "inline-block", animation: "spin 0.7s linear infinite", flexShrink: 0 }}/>}
      {!isLoading && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }}/>}
      <span className="sans" style={{ fontSize: 13, color: "var(--g3)", lineHeight: 1.5 }}>{text}</span>
    </div>
  );
}

function Logo({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none">
      <rect width="36" height="36" rx="8" fill="white"/>
      <path d="M12 25V11l6 4.5L24 11v14l-6-4.5L12 25z" fill="black"/>
    </svg>
  );
}

function ArtistAutocomplete({ value, onChange, onSelect, disabled }) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const debounceRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!value.trim() || value.length < 2) { setSuggestions([]); setOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/deezer?path=" + encodeURIComponent(`/search/artist?q=${encodeURIComponent(value)}&limit=6`));
        const data = await res.json();
        const hits = (data.data || []).filter(a => a.nb_fan !== undefined);
        setSuggestions(hits);
        setOpen(hits.length > 0);
        setHighlighted(-1);
      } catch { /* silencieux */ }
    }, 280);
    return () => clearTimeout(debounceRef.current);
  }, [value]);

  useEffect(() => {
    const handler = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function formatFans(n) {
    if (n >= 1000000) return `${(n/1000000).toFixed(1)}M fans`;
    if (n >= 1000) return `${Math.round(n/1000)}K fans`;
    return `${n} fans`;
  }

  function handleKey(e) {
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlighted(h => Math.min(h + 1, suggestions.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
    if (e.key === "Enter" && highlighted >= 0) { e.preventDefault(); pick(suggestions[highlighted]); }
    if (e.key === "Escape") setOpen(false);
  }

  function pick(artist) {
    onSelect(artist.name, artist);
    setOpen(false);
    setSuggestions([]);
  }

  return (
    <div ref={wrapRef} style={{ position: "relative", flex: 1 }}>
      <input
        className="sans"
        style={{ width: "100%", padding: "16px 20px", borderRadius: open ? "2px 2px 0 0" : 2, border: "1px solid var(--b2)", borderBottom: open ? "1px solid var(--accent)" : "1px solid var(--b2)", background: "var(--s1)", color: "var(--white)", fontSize: 15, boxSizing: "border-box", outline: "none" }}
        value={value}
        onChange={e => { onChange(e.target.value); }}
        onKeyDown={e => { handleKey(e); if (e.key === "Enter" && highlighted < 0) { setOpen(false); } }}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder="ex: Laylow, TKKF, La Fève..."
        disabled={disabled}
        autoFocus
      />
      {open && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "var(--bg)", border: "1px solid var(--b2)", borderTop: "none", borderRadius: "0 0 2px 2px", zIndex: 99, boxShadow: "0 8px 24px rgba(0,0,0,0.08)" }}>
          {suggestions.map((a, i) => (
            <div
              key={a.id}
              onMouseEnter={() => setHighlighted(i)}
              onMouseDown={() => pick(a)}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: i === highlighted ? "var(--s2)" : "transparent", cursor: "pointer", borderBottom: i < suggestions.length - 1 ? "1px solid var(--b1)" : "none" }}
            >
              {a.picture_small && <img src={a.picture_small} alt="" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                <div className="sans" style={{ fontSize: 14, fontWeight: 600, color: "var(--white)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</div>
                <div className="mono" style={{ fontSize: 10, color: "var(--g2)", letterSpacing: "0.5px" }}>{formatFans(a.nb_fan)}</div>
              </div>
              <div className="mono" style={{ fontSize: 9, color: "var(--accent)", letterSpacing: "1.5px" }}>→</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Loader({ text }) {
  return (
    <div className="sans" style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 0", color: "var(--g3)", fontSize: 13 }}>
      <span style={{ width: 14, height: 14, border: "1.5px solid var(--b2)", borderTopColor: "var(--accent)", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }}/>
      {text}
    </div>
  );
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function PurB() {
  const [page, setPage]         = useState("landing");
  const [user, setUser]         = useState(() => { try { return JSON.parse(localStorage.getItem("purb_user") || "null"); } catch { return null; } });
  const [step, setStep]         = useState(0);
  const [tb, setTb]             = useState("");
  const [selectedDeezerArtist, setSelectedDeezerArtist] = useState(null);
  const gmailClientRef = useRef(null);
  const isRunningRef = useRef(false);
  const stopRef = useRef(false);
  const stop = () => { stopRef.current = true; };

  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) return;
    const init = () => {
      if (!window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (resp) => {
          const payload = JSON.parse(atob(resp.credential.split(".")[1]));
          const u = { name: payload.name, email: payload.email, picture: payload.picture };
          setUser(u);
          localStorage.setItem("purb_user", JSON.stringify(u));
        },
      });
    };
    if (window.google?.accounts?.id) init();
    else { const t = setInterval(() => { if (window.google?.accounts?.id) { init(); clearInterval(t); } }, 200); return () => clearInterval(t); }
  }, []);
  const [artists, setArtists]   = useState([]);
  const [beatmakers, setBeatmakers] = useState([]);
  const [sel, setSel]           = useState(new Set());
  const [contacts, setContacts] = useState({});
  const [drafts, setDrafts]     = useState({});
  const [loading, setLoading]   = useState(false);
  const [status, setStatus]     = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError]       = useState(null);
  const [debug, setDebug]       = useState([]);
  const [wf, setWf]             = useState("ALL");

  const log = m => setDebug(d => [...d.slice(-19), `${new Date().toLocaleTimeString()} ${m}`]);


  useEffect(() => {
    const o = new IntersectionObserver(entries => {
      entries.forEach(x => {
        if (x.isIntersecting) {
          x.target.style.opacity = "1";
          x.target.style.animation = "fadeUp 0.6s ease forwards";
        }
      });
    }, { threshold: 0.08 });
    document.querySelectorAll("[data-s]").forEach(el => o.observe(el));
    return () => o.disconnect();
  }, [page, step]);

  const launch = useCallback(async (forceName, forceDeezerArtist) => {
    const input = (forceName || tb).trim();
    if (!input || loading) return;
    stopRef.current = false;
    const deezerArtist = forceDeezerArtist ?? selectedDeezerArtist;
    setLoading(true); setError(null); setDebug([]); setArtists([]); setBeatmakers([]); setSel(new Set()); setProgress({ done: 0, total: 0 });
    try {
      log(`Recherche "${input}" sur Genius...`);
      setStatus(`Exploration du réseau de "${input}"...`);
      setStep(1);
      const params = new URLSearchParams({ name: input });
      if (deezerArtist?.id) params.set("deezer_id", deezerArtist.id);
      const res = await fetch(`/api/genius-network?${params}`);
      if (!res.ok) throw new Error(`Genius network: HTTP ${res.status}`);
      const data = await res.json();
      if (!data.artists?.length && !data.beatmakers?.length) throw new Error(`"${input}" introuvable — essaie un autre nom`);
      setArtists(data.artists || []);
      setBeatmakers(data.beatmakers || []);
      log(`✅ ${data.artists?.length || 0} artistes · ${data.beatmakers?.length || 0} beatmakers`);
    } catch (e) {
      if (!stopRef.current) { log(`❌ ${e.message}`); setError(e.message); setStep(0); }
    }
    setLoading(false); setStatus(""); stopRef.current = false;
  }, [tb, loading]);

  const searchContacts = useCallback(async () => {
    if (sel.size === 0 || loading) return;
    stopRef.current = false;
    setLoading(true); setError(null);
    const all = [...artists, ...beatmakers.map(b => ({ ...b, _bm: 1 }))];
    const targets = all.filter(a => sel.has(a.name));
    const out = { ...contacts };
    let done = 0;
    setProgress({ done: 0, total: targets.length });
    setStatus(`Scraping ${targets.length} contacts en parallèle...`);

    const BATCH = 3;
    for (let i = 0; i < targets.length; i += BATCH) {
      if (stopRef.current) break;
      const batch = targets.slice(i, i + BATCH);
      await Promise.allSettled(batch.map(async (t) => {
        try {
          const res = await fetch(`/api/contacts?name=${encodeURIComponent(t.name)}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const p = await res.json();
          out[t.name] = p;
          log(`✅ ${t.name}: IG=${p.instagram || "—"} · ${p.confidence}`);
        } catch (e) {
          out[t.name] = { name: t.name, error: e.message };
          log(`❌ ${t.name}: ${e.message}`);
        }
        done++;
        setProgress({ done, total: targets.length });
      }));
    }
    setContacts(out); setLoading(false); setStatus(""); stopRef.current = false;
  }, [sel, artists, beatmakers, contacts, loading]);

  const writeDrafts = useCallback(async () => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;
    setLoading(true);
    const names = Object.keys(contacts).filter(n => !contacts[n]?.error);
    const allPeople = [...artists, ...beatmakers];
    const out = { ...drafts };
    setProgress({ done: 0, total: names.length });
    for (let i = 0; i < names.length; i++) {
      const n = names[i];
      if (i > 0) await new Promise(r => setTimeout(r, 3000));
      setStatus(`${n}...`);
      try {
        const artistInfo = allPeople.find(a => a.name === n);
        const topTrack = artistInfo?.top_track || null;
        const nbFan    = artistInfo?.nb_fan ?? null;
        const txt = await askClaude(
          `Tu es un jeune beatmaker français. Tu veux envoyer une prod à ${n}. Rédige 2 messages très différents.
${topTrack ? `Tu connais son son "${topTrack}" — mentionne-le naturellement dans au moins un des messages.` : ""}
${nbFan !== null && nbFan < 50000 ? `C'est un artiste émergent, pas une star inaccessible.` : ""}

STYLE ABSOLU :
- Tu parles comme un vrai mec, pas comme une IA ou un commercial
- Pas de "j'espère que tu vas bien", pas de "je me permets", pas de "en tant que beatmaker"
- Pas de majuscules en début de chaque phrase si ça sonne forcé
- Court. 3-5 lignes max. Comme un vrai DM insta ou mail direct
- Tutoiement. Naturel. Comme si t'envoyais ça à quelqu'un que tu respectes
- Une variante directe/courte, une variante avec un peu plus de contexte sur toi

JSON: {"messages":[{"approach":"nom approche","text":"le msg","send_via":"instagram DM ou email"}]}`,
          "Tu génères des DMs de beatmaker authentiques. Zéro bullshit. JSON uniquement.", 1000);
        const p = parseJSON(txt);
        if (p?.messages) { out[n] = p.messages; log(`✅ ${n}: ${p.messages.length} variantes`); }
      } catch (e) { log(`❌ ${n}: ${e.message}`); }
      setProgress({ done: i + 1, total: names.length });
    }
    setDrafts(out); setLoading(false); setStatus(""); isRunningRef.current = false;
  }, [contacts, drafts, artists, beatmakers, loading]);

  const tog      = n => setSel(p => { const x = new Set(p); x.has(n) ? x.delete(n) : x.add(n); return x; });
  const gmailUrl = (to, subject) => `https://mail.google.com/mail/u/0/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}`;
  const [gmailCopied, setGmailCopied] = useState(null);
  const openGmail = (to, subject, body, key) => {
    if (body) navigator.clipboard?.writeText(body).catch(() => {});
    window.open(gmailUrl(to, subject), "_blank");
    setGmailCopied(key || to);
    setTimeout(() => setGmailCopied(null), 3000);
  };
  const fa       = wf === "ALL" ? artists : artists.filter(a => a.wave === wf);
  const copy     = t => navigator.clipboard?.writeText(t);
  const wavePill = w => `pill pill-${(w || "low").toLowerCase()}`;
  const confPill = c => `pill pill-${c || "low"}`;

  // ─── LANDING ────────────────────────────────────────────────────────────────
  if (page === "landing") return (
    <div className="sans" style={{ background: "var(--bg)", color: "var(--white)", minHeight: "100vh", overflow: "hidden" }}>

      <nav style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 100, padding: "0 40px", height: 60, display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.94)", backdropFilter: "blur(20px)", borderBottom: "1px solid var(--b1)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Logo size={26}/>
          <span className="display" style={{ fontSize: 22, color: "var(--white)" }}>PURB</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {user ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 14px 4px 6px", borderRadius: 99, border: "1px solid var(--b2)", background: "var(--s1)" }}>
              {user.picture && <img src={user.picture} alt="" style={{ width: 24, height: 24, borderRadius: "50%" }}/>}
              <span className="sans" style={{ fontSize: 12, fontWeight: 600, color: "var(--g4)" }}>{user.name.split(" ")[0]}</span>
              <button onClick={() => { setUser(null); localStorage.removeItem("purb_user"); }} className="sans" style={{ fontSize: 10, color: "var(--g2)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>×</button>
            </div>
          ) : (
            <button className="btn-ghost sans" onClick={() => window.google?.accounts?.id?.prompt()} style={{ padding: "7px 18px", borderRadius: 2, fontSize: 12, fontWeight: 500 }}>Connexion</button>
          )}
          <button className="btn-primary-landing sans" onClick={() => setPage("app")} style={{ padding: "8px 22px", borderRadius: 2, fontSize: 12, fontWeight: 700 }}>Commencer →</button>
        </div>
      </nav>

      {/* HERO */}
      <section style={{ minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center", padding: "100px 24px 60px", position: "relative", overflow: "hidden" }}>
        <AudioRing size={560}/>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")", opacity: 0.025, pointerEvents: "none", zIndex: 0 }}/>
        <div style={{ position: "relative", zIndex: 1, maxWidth: 760 }}>
          <div data-s style={{ opacity: 0, display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 32 }}>
            <div style={{ height: 1, width: 32, background: "var(--g2)" }}/>
            <span className="mono" style={{ fontSize: 10, color: "var(--g3)", letterSpacing: "3px", textTransform: "uppercase" }}>Plug Your Beats</span>
            <div style={{ height: 1, width: 32, background: "var(--g2)" }}/>
          </div>
          <h1 data-s className="display" style={{ opacity: 0, fontSize: "clamp(64px,9vw,120px)", lineHeight: 0.92, letterSpacing: "0.04em", marginBottom: 8, color: "var(--white)" }}>
            LE BON ARTISTE<br/>POUR
          </h1>
          <h1 data-s className="display" style={{ opacity: 0, fontSize: "clamp(64px,9vw,120px)", lineHeight: 0.92, letterSpacing: "0.04em", marginBottom: 36, color: "var(--white)" }}>
            <ScrambleText text="CHAQUE BEAT." delay={600}/>
          </h1>
          <p data-s style={{ opacity: 0, fontSize: 15, color: "var(--g3)", maxWidth: 420, margin: "0 auto 40px", lineHeight: 1.75 }}>
            Tu sais pas à qui envoyer ta prod ?<br/>
            PurB trouve les artistes, scrape les contacts,<br/>
            rédige les DMs. <span style={{ color: "var(--accent)", fontWeight: 700 }}>Automatiquement.</span>
          </p>
          <div data-s style={{ opacity: 0 }}>
            <button className="btn-primary-landing display" onClick={() => setPage("app")} style={{ padding: "14px 44px", borderRadius: 2, fontSize: 18, letterSpacing: "0.1em" }}>
              COMMENCER GRATUITEMENT
            </button>
          </div>
        </div>
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 1 }}>
          <WaveformMirror height={60} opacity={0.18}/>
        </div>
      </section>

      {/* STATS */}
      <section style={{ borderTop: "1px solid var(--b1)", borderBottom: "1px solid var(--b1)", position: "relative", overflow: "hidden" }}>
        <GridDots rows={4} cols={20} gap={36}/>
        <div style={{ maxWidth: 900, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(4,1fr)", position: "relative", zIndex: 1 }}>
          {[
            { to: 15, suffix: "+", label: "Artistes par recherche" },
            { to: 4,  suffix: "",  label: "Clics suffisent" },
            { to: 2,  suffix: "×", label: "Variantes par DM" },
            { to: 0,  suffix: "%", label: "De spam toléré" },
          ].map((s, i) => (
            <div key={i} style={{ borderRight: i < 3 ? "1px solid var(--b1)" : "none", padding: "0 20px" }}>
              <AnimCounter {...s}/>
            </div>
          ))}
        </div>
      </section>

      {/* PROBLEM */}
      <section style={{ padding: "100px 40px", maxWidth: 1100, margin: "0 auto" }}>
        <div data-s style={{ opacity: 0, display: "flex", alignItems: "center", gap: 16, marginBottom: 60 }}>
          <div className="display" style={{ fontSize: 11, color: "var(--g3)", letterSpacing: "3px" }}>01</div>
          <div style={{ height: 1, width: 32, background: "var(--b2)" }}/>
          <h2 className="display" style={{ fontSize: "clamp(36px,5vw,60px)", color: "var(--white)" }}>LE PROBLÈME</h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(290px,1fr))", gap: 1, background: "var(--b1)" }}>
          {[
            { n:"01", Icon: () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2" fill="currentColor"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/></svg>, title:"Tu contactes au hasard",   desc:"Tu DM des artistes trop gros qui répondront jamais, ou des gens qui matchent pas ton style." },
            { n:"02", Icon: () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M9 10h.01M15 10h.01"/><path d="M12 2a8 8 0 0 1 8 8v12l-3-3-2.5 2.5-2.5-2.5-2.5 2.5-2.5-2.5-3 3V10a8 8 0 0 1 8-8z"/></svg>, title:"Contacts introuvables",    desc:"30 min de stalking par artiste pour trouver un email. Souvent tu trouves rien du tout." },
            { n:"03", Icon: () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M12 8V4"/><circle cx="12" cy="3" r="1" fill="currentColor"/><circle cx="9" cy="14" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="14" r="1.5" fill="currentColor" stroke="none"/><path d="M8.5 18 Q12 20 15.5 18"/></svg>, title:"Tes DMs sonnent ChatGPT", desc:"Le même copier-coller à 50 artistes, ça se voit de loin. Zéro réponse, zéro placement." },
          ].map(({ n, Icon, title, desc }, i) => (
            <div key={i} data-s className="card-inv" style={{ opacity: 0, padding: "36px 32px", background: "var(--bg)", position: "relative" }}>
              <Corner pos="tl" size={16}/><Corner pos="br" size={16}/>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
                <div className="inv-icon" style={{ color: "var(--g3)" }}><Icon/></div>
                <span className="display mono inv-title" style={{ fontSize: 11, color: "var(--g1)", letterSpacing: "2px" }}>{n}</span>
              </div>
              <div className="sans inv-title" style={{ fontSize: 18, fontWeight: 700, marginBottom: 12, color: "var(--white)" }}>{title}</div>
              <div className="sans inv-desc" style={{ fontSize: 14, color: "var(--g3)", lineHeight: 1.72 }}>{desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* STEPS */}
      <section style={{ padding: "80px 40px 100px", borderTop: "1px solid var(--b1)", position: "relative" }}>
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          <div data-s style={{ opacity: 0, display: "flex", alignItems: "center", gap: 16, marginBottom: 64 }}>
            <div className="display" style={{ fontSize: 11, color: "var(--g3)", letterSpacing: "3px" }}>02</div>
            <div style={{ height: 1, width: 32, background: "var(--b2)" }}/>
            <h2 className="display" style={{ fontSize: "clamp(36px,5vw,60px)", color: "var(--white)" }}>LA SOLUTION</h2>
          </div>
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", left: 28, top: 48, bottom: 0, width: 1, background: "linear-gradient(to bottom, var(--b2), transparent)", transformOrigin: "top", animation: "lineGrow 1.5s ease forwards", animationDelay: "0.5s", transform: "scaleY(0)" }}/>
            {[
              { n:"01", t:"Donne ton type beat",     d:"Un nom d'artiste suffit. Je scrape son réseau Deezer pour trouver les artistes similaires dans son entourage." },
              { n:"02", t:"Je trouve les artistes",  d:"15+ artistes émergents + beatmakers triés par popularité. V1 = émergent, V3 = confirmé." },
              { n:"03", t:"Je scrape les contacts",  d:"Instagram, email, SoundCloud — sources multiples, score de confiance pour chaque résultat." },
              { n:"04", t:"Je rédige les DMs",       d:"Chaque message cite le vrai top track Deezer. 2 variantes uniques par artiste. Zéro copier-coller." },
            ].map((s, i) => (
              <div key={i} data-s style={{ opacity: 0, display: "flex", gap: 32, padding: "32px 0", borderBottom: i < 3 ? "1px solid var(--b1)" : "none" }}>
                <div className="display" style={{ fontSize: "clamp(36px,5vw,56px)", color: "var(--accent)", flexShrink: 0, width: 56, lineHeight: 1 }}>{s.n}</div>
                <div style={{ paddingTop: 4 }}>
                  <div className="sans" style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: "var(--white)" }}>{s.t}</div>
                  <div className="sans" style={{ fontSize: 14, color: "var(--g3)", lineHeight: 1.72 }}>{s.d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* MARQUEE */}
      <div style={{ overflow: "hidden", borderTop: "1px solid var(--b1)", borderBottom: "1px solid var(--b1)", padding: "20px 0", background: "var(--s1)" }}>
        <div style={{ display: "flex", animation: "marquee 18s linear infinite", whiteSpace: "nowrap", width: "max-content" }}>
          {[...Array(3)].flatMap(() =>
            ["TROUVE L'ARTISTE","SCRAPE LE CONTACT","RÉDIGE LE DM","PLUG YOUR BEATS","PLACE TES PRODS","BUILD YOUR NETWORK"].map((t, i) => (
              <span key={`${t}-${i}`} className="display" style={{ fontSize: "clamp(18px,2.5vw,28px)", color: i % 2 === 0 ? "var(--g3)" : "var(--accent)", padding: "0 28px", borderRight: "1px solid var(--b1)" }}>{t}</span>
            ))
          )}
        </div>
      </div>

      {/* EQ STRIP */}
      <div style={{ padding: "60px 0", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to right, var(--bg) 0%, transparent 6%, transparent 94%, var(--bg) 100%)", zIndex: 1, pointerEvents: "none" }}/>
        <EQBars count={64} height={80} opacity={0.3}/>
      </div>

      {/* CTA FINAL */}
      <section data-s style={{ opacity: 0, borderTop: "1px solid var(--b1)", padding: "100px 40px 120px", textAlign: "center", position: "relative", overflow: "hidden" }}>
        <GridDots rows={6} cols={20} gap={40}/>
        <div style={{ position: "relative", zIndex: 1 }}>
          <h2 className="display" style={{ fontSize: "clamp(48px,8vw,110px)", lineHeight: 0.9, marginBottom: 32, color: "var(--white)" }}>
            PRÊT À PLACER<br/><span style={{ color: "var(--accent)" }}>TES PRODS ?</span>
          </h2>
          <p style={{ fontSize: 15, color: "var(--g3)", marginBottom: 40 }}>Commence gratuitement — aucune carte requise.</p>
          <button className="btn-primary-landing display" onClick={() => setPage("app")} style={{ padding: "14px 48px", borderRadius: 2, fontSize: 18, letterSpacing: "0.1em" }}>
            LANCER PURB →
          </button>
        </div>
      </section>

      <footer style={{ padding: "24px 40px", borderTop: "1px solid var(--b1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Logo size={18}/>
          <span className="display" style={{ fontSize: 14, color: "var(--g2)" }}>PURB</span>
        </div>
        <span className="mono" style={{ fontSize: 10, color: "var(--g1)", letterSpacing: "1px" }}>PLUG YOUR BEATS © 2026</span>
      </footer>
    </div>
  );

  // ─── APP VIEW ────────────────────────────────────────────────────────────────
  return (
    <div className="sans" style={{ background: "var(--bg)", color: "var(--white)", minHeight: "100vh" }}>

      <nav style={{ position: "sticky", top: 0, zIndex: 100, padding: "0 28px", height: 56, display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.97)", backdropFilter: "blur(20px)", borderBottom: "1px solid var(--b1)" }}>
        <button onClick={() => setPage("landing")} style={{ display: "flex", alignItems: "center", gap: 9, background: "none", border: "none", padding: 0, cursor: "pointer" }}>
          <Logo size={22}/>
          <span className="display" style={{ fontSize: 18, color: "var(--white)" }}>PURB</span>
        </button>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {["Type beat","Artistes","Contacts","Messages"].map((l, i) => (
            <div key={i} onClick={() => i <= step && setStep(i)} style={{ display: "flex", alignItems: "center", gap: 4, cursor: i <= step ? "pointer" : "default" }}>
              <div style={{ width: 24, height: 24, borderRadius: 2, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, background: i < step ? "var(--accent)" : "transparent", color: i < step ? "#fff" : i === step ? "var(--accent)" : "var(--g1)", border: `1px solid ${i === step ? "var(--accent)" : "var(--b1)"}`, transition: "all 0.2s" }}>{i < step ? "✓" : i + 1}</div>
              {i === step && <span className="sans" style={{ fontSize: 11, fontWeight: 600, color: "var(--g4)" }}>{l}</span>}
              {i < 3 && <div style={{ width: 14, height: 1, background: i < step ? "var(--accent)" : "var(--b1)", margin: "0 2px", transition: "background 0.3s" }}/>}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
<details style={{ fontSize: 10, color: "var(--g1)" }}>
          <summary style={{ cursor: "pointer", listStyle: "none" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
          </summary>
          <div className="mono" style={{ position: "absolute", right: 12, top: 58, background: "var(--s1)", border: "1px solid var(--b1)", borderRadius: 2, padding: 10, maxHeight: 200, overflow: "auto", width: 300, fontSize: 9, lineHeight: 1.6, zIndex: 200 }}>
            {debug.length === 0 ? "No logs" : debug.map((d, i) => <div key={i}>{d}</div>)}
          </div>
        </details>
        </div>
      </nav>

      {/* ── STEP 0 ── */}
      {step === 0 && (
        <div style={{ minHeight: "calc(100vh - 56px)", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "60px 24px 40px", position: "relative", overflow: "hidden" }}>

          {/* AudioRing — même taille que la landing */}
          <AudioRing size={560}/>

          {/* Noise texture */}
          <div style={{ position: "absolute", inset: 0, backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")", opacity: 0.025, pointerEvents: "none", zIndex: 0 }}/>

          <div style={{ position: "relative", zIndex: 1, maxWidth: 640, width: "100%", textAlign: "center" }}>

            {/* Badge */}
            <div data-s style={{ opacity: 0, display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 28, padding: "4px 16px", borderRadius: 99, background: "rgba(255,0,102,0.1)", border: "1px solid rgba(255,0,102,0.2)" }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)", animation: "pulse 2s infinite" }}/>
              <span className="mono" style={{ fontSize: 9, color: "var(--accent)", letterSpacing: "2.5px", textTransform: "uppercase" }}>Purb · Actif</span>
            </div>

            {/* Heading — Bebas Neue comme la landing */}
            <h1 data-s className="display" style={{ opacity: 0, fontSize: "clamp(56px,8vw,100px)", lineHeight: 0.92, letterSpacing: "0.04em", marginBottom: 8, color: "var(--white)" }}>
              C'EST QUOI TON
            </h1>
            <h1 data-s className="display" style={{ opacity: 0, fontSize: "clamp(56px,8vw,100px)", lineHeight: 0.92, letterSpacing: "0.04em", marginBottom: 32, color: "var(--accent)" }}>
              TYPE BEAT ?
            </h1>

            <p data-s style={{ opacity: 0, fontSize: 15, color: "var(--g3)", maxWidth: 380, margin: "0 auto 36px", lineHeight: 1.75 }}>
              Un artiste de référence suffit. Je scrape son réseau Genius, trouve les contacts et rédige des DMs sur mesure.
            </p>

            {/* Search */}
            <div data-s style={{ opacity: 0, marginBottom: 14 }}>
              {error && <div className="sans" style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(248,113,113,0.07)", border: "1px solid rgba(248,113,113,0.2)", color: "var(--red)", fontSize: 12, marginBottom: 12, textAlign: "center" }}>{error}</div>}
              <div style={{ display: "flex", gap: 8 }}>
                <ArtistAutocomplete value={tb} onChange={v => { setTb(v); setSelectedDeezerArtist(null); }} onSelect={(name, artist) => { setTb(name); setSelectedDeezerArtist(artist); launch(name, artist); }} disabled={loading} />
                <button className="btn-primary display" onClick={launch} disabled={loading} style={{ padding: "16px 32px", borderRadius: 2, fontSize: 18, letterSpacing: "0.08em", whiteSpace: "nowrap" }}>{loading ? "..." : "GO →"}</button>
              </div>
              {loading && <Loader text={status}/>}
            </div>

            {/* Chips */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center", marginBottom: 44 }}>
              {["Laylow","TKKF","La Fève","Tiakola","Josman","Zuukou Mayzie"].map(e => (
                <button key={e} className="btn-ghost sans" onClick={() => setTb(e)} style={{ padding: "5px 14px", borderRadius: 99, fontSize: 12, fontWeight: 500 }}>{e}</button>
              ))}
            </div>
          </div>

          {/* Steps strip */}
          <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 720, borderTop: "1px solid var(--b1)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)" }}>
              {[
                { n: "01", l: "Réseau Genius" },
                { n: "02", l: "Fan counts" },
                { n: "03", l: "Contacts IG" },
                { n: "04", l: "DMs sur mesure" },
              ].map(({ n, l }, i) => (
                <div key={n} style={{ padding: "20px 0", textAlign: "center", borderRight: i < 3 ? "1px solid var(--b1)" : "none" }}>
                  <div className="display" style={{ fontSize: "clamp(28px,3.5vw,44px)", color: "var(--b2)", lineHeight: 1 }}>{n}</div>
                  <div className="mono" style={{ fontSize: 9, color: "var(--g2)", marginTop: 6, letterSpacing: "1px", textTransform: "uppercase" }}>{l}</div>
                </div>
              ))}
            </div>
          </div>

          {/* WaveformMirror en bas */}
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 1 }}>
            <WaveformMirror height={50} opacity={0.12}/>
          </div>
        </div>
      )}

      {/* ── STEP 1 — Artistes ── */}
      {step === 1 && (
        <div style={{ animation: "fadeUp 0.45s ease forwards" }}>

          {/* Section header full-width — même style que la landing */}
          <div style={{ borderBottom: "1px solid var(--b1)", padding: "36px 40px 28px", position: "relative", overflow: "hidden" }}>
            <GridDots rows={4} cols={24} gap={32}/>
            <div style={{ position: "relative", zIndex: 1, maxWidth: 900, margin: "0 auto", display: "flex", alignItems: "flex-end", gap: 20 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 8 }}>
                  <span className="display" style={{ fontSize: 11, color: "var(--g3)", letterSpacing: "3px" }}>02</span>
                  <div style={{ height: 1, width: 28, background: "var(--b2)" }}/>
                </div>
                <h2 className="display" style={{ fontSize: "clamp(36px,5vw,64px)", color: "var(--white)", lineHeight: 0.92, letterSpacing: "0.04em" }}>
                  ARTISTES<br/>DÉTECTÉS
                </h2>
              </div>
              {/* EQBars à droite du titre */}
              <div style={{ flex: 1, minWidth: 0, alignSelf: "flex-end", overflow: "hidden" }}>
                <div style={{ position: "relative" }}>
                  <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to right, transparent 0%, transparent 70%, var(--bg) 100%)", zIndex: 1, pointerEvents: "none" }}/>
                  <EQBars count={40} height={52} opacity={0.22}/>
                </div>
              </div>
            </div>
          </div>

          <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 20px" }}>

            {loading && (
              <BigLoader status={status || `Analyse du réseau de "${tb}"...`} label="Réseau Genius" onStop={() => { stop(); }}/>
            )}

            {!loading && artists.length > 0 && (
              <StatusBar text={`Réseau de "${tb}" — ${artists.length} artiste${artists.length > 1 ? "s" : ""} · ${beatmakers.length} beatmaker${beatmakers.length > 1 ? "s" : ""} · ${sel.size} sélectionné${sel.size > 1 ? "s" : ""}`}/>
            )}

            {!loading && artists.length > 0 && (<>
              {/* Stats strip */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 1, background: "var(--b1)", marginBottom: 24, borderRadius: 2, overflow: "hidden" }}>
                {[
                  { n: artists.length,    l: "Artistes",      accent: false },
                  { n: beatmakers.length, l: "Beatmakers",    accent: false },
                  { n: sel.size,          l: "Sélectionnés",  accent: sel.size > 0 },
                ].map(({ n, l, accent: isAccent }) => (
                  <div key={l} style={{ padding: "20px 24px", background: "var(--bg)", textAlign: "center", transition: "background 0.2s" }}>
                    <div className="display" style={{ fontSize: "clamp(40px,5vw,64px)", color: isAccent ? "var(--accent)" : "var(--white)", lineHeight: 1 }}>{n}</div>
                    <div className="mono" style={{ fontSize: 9, color: "var(--g2)", textTransform: "uppercase", letterSpacing: "1.5px", marginTop: 4 }}>{l}</div>
                  </div>
                ))}
              </div>

              {/* Filters + select-all */}
              <div style={{ display: "flex", gap: 6, marginBottom: 14, alignItems: "center" }}>
                {["ALL","V1","V2","V3"].map(w => (
                  <button key={w} className="sans" onClick={() => setWf(w)} style={{ padding: "5px 16px", borderRadius: 99, fontSize: 11, fontWeight: 600, border: `1px solid ${wf===w ? "var(--accent)" : "var(--b1)"}`, background: wf===w ? "rgba(255,0,102,0.12)" : "transparent", color: wf===w ? "var(--accent)" : "var(--g3)", transition: "all 0.15s", cursor: "pointer" }}>
                    {w==="ALL" ? "Tous" : w}
                  </button>
                ))}
                <button className="sans" onClick={() => setSel(new Set([...artists, ...beatmakers].map(a => a.name)))} style={{ marginLeft: "auto", padding: "5px 14px", borderRadius: 99, fontSize: 10, fontWeight: 600, border: "1px solid var(--b1)", background: "transparent", color: "var(--g3)", cursor: "pointer", transition: "all 0.15s" }}>
                  Tout sélectionner
                </button>
              </div>

              {/* Artist cards — clickable rows */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 24 }}>
                {fa.map((a, i) => {
                  const isSelected = sel.has(a.name);
                  return (
                    <div key={i} onClick={() => tog(a.name)} style={{
                      display: "flex", alignItems: "center", gap: 14, padding: "13px 16px",
                      background: isSelected ? "rgba(255,0,102,0.07)" : "var(--s1)",
                      border: `1px solid ${isSelected ? "rgba(255,0,102,0.4)" : "var(--b1)"}`,
                      borderRadius: 2, cursor: "pointer",
                      transition: "all 0.18s var(--ease-smooth)",
                    }}>
                      <div style={{ width: 38, height: 38, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, background: isSelected ? "var(--accent)" : "var(--s3)", color: isSelected ? "#fff" : "var(--g3)", transition: "all 0.18s", border: `1px solid ${isSelected ? "rgba(255,0,102,0.4)" : "var(--b1)"}` }}>
                        {isSelected ? "✓" : (a.name[0] || "?").toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="sans" style={{ fontWeight: 700, fontSize: 14, color: "var(--white)", marginBottom: 2 }}>{a.name}</div>
                        {a.top_track && <div className="mono" style={{ fontSize: 10, color: "var(--g2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>♪ {a.top_track}</div>}
                      </div>
                      <div style={{ textAlign: "right", marginRight: 10, flexShrink: 0 }}>
                        <div className="mono" style={{ fontSize: 12, color: "var(--g3)" }}>{a.nb_fan ? a.nb_fan.toLocaleString("fr-FR") : "—"}</div>
                        <div className="sans" style={{ fontSize: 9, color: "var(--g1)", marginTop: 1 }}>fans</div>
                      </div>
                      <span className={wavePill(a.wave)}>{a.wave}</span>
                    </div>
                  );
                })}
              </div>

              {/* EQBars séparateur full-bleed */}
              <div style={{ margin: "8px -20px 24px", position: "relative" }}>
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to right, var(--bg) 0%, transparent 6%, transparent 94%, var(--bg) 100%)", zIndex: 1, pointerEvents: "none" }}/>
                <EQBars count={64} height={36} opacity={0.18}/>
              </div>

              {/* Beatmakers section */}
              {beatmakers.length > 0 && (<>
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
                  <span className="display" style={{ fontSize: 11, color: "var(--g3)", letterSpacing: "3px" }}>BEATMAKERS</span>
                  <div style={{ flex: 1, height: 1, background: "var(--b1)" }}/>
                  <span className="mono" style={{ fontSize: 10, color: "var(--g1)" }}>{beatmakers.length}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 6, marginBottom: 24 }}>
                  {beatmakers.map((b, i) => {
                    const isSelected = sel.has(b.name);
                    return (
                      <div key={i} onClick={() => tog(b.name)} style={{
                        padding: "14px 16px", display: "flex", gap: 12, alignItems: "flex-start",
                        background: isSelected ? "rgba(255,0,102,0.07)" : "var(--s1)",
                        border: `1px solid ${isSelected ? "rgba(255,0,102,0.4)" : "var(--b1)"}`,
                        borderRadius: 2, cursor: "pointer", transition: "all 0.18s var(--ease-smooth)",
                      }}>
                        <div style={{ width: 32, height: 32, borderRadius: 2, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, background: isSelected ? "var(--accent)" : "var(--s3)", color: isSelected ? "#fff" : "var(--g3)", transition: "all 0.18s", marginTop: 1 }}>
                          {isSelected ? "✓" : (b.name[0] || "?").toUpperCase()}
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                            <div className="sans" style={{ fontWeight: 700, fontSize: 13, color: "var(--white)" }}>{b.name}</div>
                            {b.wave && <span className={wavePill(b.wave)}>{b.wave}</span>}
                          </div>
                          <div className="sans" style={{ fontSize: 11, color: "var(--g3)", lineHeight: 1.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.known_for}</div>
                          <div className="mono" style={{ fontSize: 9, color: "var(--g1)", marginTop: 3 }}>{b.platform}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>)}

              {/* Actions */}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", paddingTop: 16, borderTop: "1px solid var(--b1)" }}>
                <button className="btn-ghost sans" onClick={launch} style={{ padding: "10px 20px", borderRadius: 2, fontSize: 12, fontWeight: 600 }}>Relancer</button>
                {sel.size > 0 && !loading && (
                  <button className="btn-primary display" onClick={() => { setStep(2); searchContacts(); }} style={{ padding: "10px 28px", borderRadius: 2, fontSize: 16, letterSpacing: "0.06em" }}>
                    CONTACTS ({sel.size}) →
                  </button>
                )}
              </div>
            </>)}

            {!loading && artists.length === 0 && (
              <div style={{ textAlign: "center", padding: 60 }}>
                <div className="sans" style={{ color: "var(--g3)", fontSize: 14, marginBottom: 16 }}>Aucun artiste trouvé — essaie un autre nom.</div>
                <button className="btn-ghost sans" onClick={() => setStep(0)} style={{ padding: "10px 24px", borderRadius: 2, fontSize: 13, fontWeight: 600 }}>← Retour</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── STEP 2 — Contacts ── */}
      {step === 2 && (
        <div style={{ animation: "fadeUp 0.45s ease forwards" }}>

          {/* Section header full-width */}
          <div style={{ borderBottom: "1px solid var(--b1)", padding: "36px 40px 28px", position: "relative", overflow: "hidden" }}>
            <GridDots rows={4} cols={24} gap={32}/>
            <div style={{ position: "relative", zIndex: 1, maxWidth: 900, margin: "0 auto", display: "flex", alignItems: "flex-end", gap: 20 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 8 }}>
                  <span className="display" style={{ fontSize: 11, color: "var(--g3)", letterSpacing: "3px" }}>03</span>
                  <div style={{ height: 1, width: 28, background: "var(--b2)" }}/>
                </div>
                <h2 className="display" style={{ fontSize: "clamp(36px,5vw,64px)", color: "var(--white)", lineHeight: 0.92, letterSpacing: "0.04em" }}>
                  CONTACTS<br/>SCRAPÉS
                </h2>
              </div>
              <div style={{ flex: 1, minWidth: 0, alignSelf: "flex-end", overflow: "hidden" }}>
                <div style={{ position: "relative" }}>
                  <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to right, transparent 0%, transparent 70%, var(--bg) 100%)", zIndex: 1, pointerEvents: "none" }}/>
                  <WaveformMirror height={52} opacity={0.28}/>
                </div>
              </div>
            </div>
          </div>

          <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 20px" }}>

            {loading && (
              <BigLoader status={status} done={progress.done} total={progress.total} label="Scraping Instagram" onStop={() => { stop(); }}/>
            )}

            {!loading && Object.keys(contacts).length > 0 && (
              <StatusBar text={`${Object.keys(contacts).length} contact${Object.keys(contacts).length > 1 ? "s" : ""} · ${Object.values(contacts).filter(c => c.emails?.length > 0).length} email${Object.values(contacts).filter(c => c.emails?.length > 0).length > 1 ? "s" : ""} trouvé${Object.values(contacts).filter(c => c.emails?.length > 0).length > 1 ? "s" : ""}`}/>
            )}

            {!loading && Object.keys(contacts).length > 0 && (<>
              {/* Stats strip */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 1, background: "var(--b1)", marginBottom: 24, borderRadius: 2, overflow: "hidden" }}>
                {[
                  { n: Object.keys(contacts).length,                                                 l: "Contacts" },
                  { n: Object.values(contacts).filter(c => c.instagram).length,                      l: "Instagram" },
                  { n: Object.values(contacts).filter(c => c.emails?.length > 0).length,             l: "Avec email" },
                ].map(({ n, l }) => (
                  <div key={l} style={{ padding: "20px 24px", background: "var(--bg)", textAlign: "center" }}>
                    <div className="display" style={{ fontSize: "clamp(40px,5vw,64px)", color: "var(--white)", lineHeight: 1 }}>{n}</div>
                    <div className="mono" style={{ fontSize: 9, color: "var(--g2)", textTransform: "uppercase", letterSpacing: "1.5px", marginTop: 4 }}>{l}</div>
                  </div>
                ))}
              </div>

              {/* Contact cards */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {Object.entries(contacts).sort(([,a],[,b]) => {
                  const aHasEmail = (a.emails?.length > 0 || a.email) ? 1 : 0;
                  const bHasEmail = (b.emails?.length > 0 || b.email) ? 1 : 0;
                  return bHasEmail - aHasEmail;
                }).map(([n, c]) => (
                  <div key={n} style={{ padding: 20, background: "var(--s1)", border: "1px solid var(--b1)", borderRadius: 2, transition: "border-color 0.2s" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: c.error ? 0 : 16 }}>
                      <div style={{ width: 46, height: 46, borderRadius: "50%", background: "rgba(255,0,102,0.12)", border: "2px solid rgba(255,0,102,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 800, color: "var(--accent)", flexShrink: 0 }}>
                        {(n[0] || "?").toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="heading" style={{ fontSize: 17, color: "var(--white)", marginBottom: 2 }}>{n}</div>
                        {c.followersCount && (
                          <div className="mono" style={{ fontSize: 10, color: "var(--g3)" }}>
                            {c.followersCount.toLocaleString("fr-FR")} followers
                          </div>
                        )}
                      </div>
                      {c.confidence && <span className={confPill(c.confidence)}>{c.confidence}</span>}
                    </div>

                    {c.error ? (
                      <div className="sans" style={{ color: "var(--red)", fontSize: 12, padding: "8px 0" }}>{c.error}</div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {c.instagram && (
                          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", background: "var(--s2)", borderRadius: 2, border: "1px solid var(--b1)" }}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--g3)" strokeWidth="1.5"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="0.5" fill="var(--g3)"/></svg>
                            <span className="mono" style={{ flex: 1, fontSize: 12, color: "var(--g4)" }}>{c.instagram}</span>
                            <button className="btn-copy sans" onClick={() => copy(c.instagram)} style={{ padding: "2px 10px", borderRadius: 2, fontSize: 10, fontWeight: 600 }}>Copier</button>
                          </div>
                        )}
                        {(c.emails || (c.email ? [c.email] : [])).map((email, ei) => (
                          <div key={ei} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", background: "var(--s2)", borderRadius: 2, border: `1px solid ${ei === 0 ? "rgba(255,0,102,0.2)" : "var(--b1)"}` }}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={ei === 0 ? "var(--accent)" : "var(--g3)"} strokeWidth="1.5"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                            <span className="mono" style={{ flex: 1, fontSize: 12, color: ei === 0 ? "var(--accent-l)" : "var(--g4)" }}>{email}</span>
                            <button className="btn-copy sans" onClick={() => copy(email)} style={{ padding: "2px 10px", borderRadius: 2, fontSize: 10, fontWeight: 600 }}>Copier</button>
                            <button onClick={() => openGmail(email, `Prod pour ${n}`, drafts[n]?.[0]?.text || "", `${n}_${ei}`)} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 10px", borderRadius: 2, fontSize: 10, fontWeight: 600, background: "rgba(255,0,102,0.08)", border: "1px solid rgba(255,0,102,0.2)", color: "var(--accent)", cursor: "pointer" }}>
                              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                              {gmailCopied === `${n}_${ei}` ? "Copié — Ctrl+V dans Gmail" : "Gmail"}
                            </button>
                          </div>
                        ))}
                        {c.biography && (
                          <div className="sans" style={{ fontSize: 12, color: "var(--g2)", padding: "10px 14px", background: "var(--s2)", borderRadius: 2, borderLeft: "2px solid rgba(255,0,102,0.25)", lineHeight: 1.65 }}>
                            {c.biography.length > 160 ? c.biography.slice(0, 160) + "…" : c.biography}
                          </div>
                        )}
                        {c.source && (
                          <div style={{ display: "flex", alignItems: "center", gap: 5, paddingTop: 2 }}>
                            <div style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--g1)", flexShrink: 0 }}/>
                            <span className="mono" style={{ fontSize: 9, color: "var(--g1)" }}>{c.source}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div style={{ textAlign: "right", marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--b1)" }}>
                <button className="btn-primary display" onClick={() => { setStep(3); writeDrafts(); }} style={{ padding: "10px 28px", borderRadius: 2, fontSize: 16, letterSpacing: "0.06em" }}>GÉNÉRER LES DMS →</button>
              </div>
            </>)}
          </div>
        </div>
      )}

      {/* ── STEP 3 — Messages ── */}
      {step === 3 && (
        <div style={{ animation: "fadeUp 0.45s ease forwards" }}>

          {/* Section header full-width */}
          <div style={{ borderBottom: "1px solid var(--b1)", padding: "36px 40px 28px", position: "relative", overflow: "hidden" }}>
            <GridDots rows={4} cols={24} gap={32}/>
            <div style={{ position: "relative", zIndex: 1, maxWidth: 900, margin: "0 auto", display: "flex", alignItems: "flex-end", gap: 20 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 8 }}>
                  <span className="display" style={{ fontSize: 11, color: "var(--g3)", letterSpacing: "3px" }}>04</span>
                  <div style={{ height: 1, width: 28, background: "var(--b2)" }}/>
                </div>
                <h2 className="display" style={{ fontSize: "clamp(36px,5vw,64px)", color: "var(--white)", lineHeight: 0.92, letterSpacing: "0.04em" }}>
                  DMS<br/>GÉNÉRÉS
                </h2>
              </div>
              <div style={{ flex: 1, minWidth: 0, alignSelf: "flex-end", overflow: "hidden" }}>
                <div style={{ position: "relative" }}>
                  <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to right, transparent 0%, transparent 70%, var(--bg) 100%)", zIndex: 1, pointerEvents: "none" }}/>
                  <EQBars count={40} height={52} opacity={0.22}/>
                </div>
              </div>
            </div>
          </div>

          <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 20px" }}>

            {loading && (
              <BigLoader status={status} done={progress.done} total={progress.total} label="Rédaction DMs" onStop={() => { stop(); }}/>
            )}


            {!loading && Object.entries(drafts).map(([n, msgs]) => (
              <div key={n} style={{ marginBottom: 40 }}>
                {/* Artist header — style landing "01 ─── LE PROBLÈME" */}
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14, paddingBottom: 14, borderBottom: "1px solid var(--b1)" }}>
                  <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(255,0,102,0.15)", border: "1px solid rgba(255,0,102,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: "var(--accent)", flexShrink: 0 }}>
                    {(n[0] || "?").toUpperCase()}
                  </div>
                  <div className="heading" style={{ fontSize: 18, color: "var(--white)", letterSpacing: "-0.01em" }}>{n}</div>
                  <div style={{ flex: 1, height: 1, background: "var(--b1)" }}/>
                  <span className="mono" style={{ fontSize: 9, color: "var(--g1)" }}>{(msgs || []).length} variante{(msgs || []).length > 1 ? "s" : ""}</span>
                </div>

                {(() => {
                  const info = [...artists, ...beatmakers].find(a => a.name === n);
                  const collab = info?.top_track || info?.known_for?.split(" ").slice(1, 3).join(" ") || null;
                  const templateText = `Yo ${n}, voici des prods dans le même style que${collab ? ` "${collab}"` : " tes sons"}. Je te les laisse écouter`;
                  return (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, paddingLeft: 2 }}>
                        <div style={{ width: 3, height: 3, borderRadius: "50%", background: "var(--g2)", flexShrink: 0 }}/>
                        <span className="mono" style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", color: "var(--g2)" }}>Template rapide</span>
                      </div>
                      <div style={{ position: "relative", padding: "14px 18px", background: "var(--s2)", border: "1px solid var(--b1)", borderRadius: "2px 12px 12px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        <div className="sans" style={{ fontSize: 13, color: "var(--g3)", fontStyle: "italic" }}>{templateText}</div>
                        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                          <button className="btn-copy sans" onClick={() => copy(templateText)} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 2, fontSize: 10, fontWeight: 600 }}>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="1"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                            Copier
                          </button>
                          {contacts[n]?.email && (
                            <button onClick={() => openGmail(contacts[n].email, `Prod pour ${n}`, templateText, `tpl_${n}`)} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 2, fontSize: 10, fontWeight: 600, background: "rgba(255,0,102,0.08)", border: "1px solid rgba(255,0,102,0.2)", color: "var(--accent)", cursor: "pointer" }}>
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                              {gmailCopied === `tpl_${n}` ? "Copié — Ctrl+V dans Gmail" : "Gmail"}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}

              </div>
            ))}

          </div>
        </div>
      )}
    </div>
  );
}
