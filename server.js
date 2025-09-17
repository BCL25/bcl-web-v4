// server.js — BrightCodeLabz (root paths, single-source logs, clean /learn logging)
// Node 18+ compatible (uses global fetch). Run: node server.js

const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------- Paths ----------------
// Public web root (beta.html, images, etc.)
const PUBLIC_DIR = path.join(__dirname, "public");

// PRIVATE data dirs (not web-exposed)
const ASSETS_DIR = path.join(__dirname, "assets"); // brains + questions
const LOGS_DIR   = path.join(__dirname, "logs");   // learned_log.txt, interactions.log, i-dont-know.txt

// Log files (single source of truth)
const LEARNED_LOG      = path.join(LOGS_DIR, "learned_log.txt");
const INTERACTIONS_LOG = path.join(LOGS_DIR, "interactions.log");
const UNKNOWN_FILE     = path.join(LOGS_DIR, "i-dont-know.txt");

// --------- File discovery (robust to name variations) ----------
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
function ensureFile(filePath, seed = "") {
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, seed);
}

/**
 * Try to resolve a file in `dir` by a list of candidate basenames (case-insensitive),
 * or by a regex. Returns the first matching absolute path; if missing and `createIfMissing`,
 * create an empty file.
 */
function resolveFileOrCreate(dir, candidates, createIfMissing = true) {
  const names = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const lower = names.map(n => n.toLowerCase());
  for (const c of candidates) {
    if (typeof c === "string") {
      const idx = lower.indexOf(c.toLowerCase());
      if (idx !== -1) return path.join(dir, names[idx]);
    } else if (c instanceof RegExp) {
      const i = names.findIndex(n => c.test(n));
      if (i !== -1) return path.join(dir, names[i]);
    }
  }
  // If not found, create the first string candidate (or a default) if allowed
  const firstName = candidates.find(x => typeof x === "string");
  const fallbackName = firstName || "fallback.txt";
  const abs = path.join(dir, fallbackName);
  if (createIfMissing) ensureFile(abs);
  return abs;
}

// Make sure directories exist
ensureDir(PUBLIC_DIR);
ensureDir(ASSETS_DIR);
ensureDir(LOGS_DIR);

// Resolve brains/questions from *root* assets (NOT public)
const VEYA_BRAIN   = resolveFileOrCreate(ASSETS_DIR, [/^veya.*brain.*\.txt$/i, "VeaBrain.txt", "veya_brain.txt"]);
const ORION_BRAIN  = resolveFileOrCreate(ASSETS_DIR, [/^orion.*brain.*\.txt$/i, "OrionBrain.txt", "orion_brain.txt"]);
const QUESTIONS_TXT= resolveFileOrCreate(ASSETS_DIR, [/^questions.*\.txt$/i, "Questions.txt", "questions.txt"]);

// Ensure logs exist (single source)
ensureFile(LEARNED_LOG);
ensureFile(INTERACTIONS_LOG);
ensureFile(UNKNOWN_FILE);

// Map speakers to their brain files
const BRAINS = {
  veya: VEYA_BRAIN,
  orion: ORION_BRAIN
};

// --------------- Middleware ---------------
app.use(express.json());
app.use(express.static(PUBLIC_DIR)); // serve /public/* (beta.html, images, etc.)

// --------------- Helpers ---------------
const recentLines = { veya: [], orion: [] };
const COOLDOWN = 3; // don't repeat the last N lines per speaker

function readLines(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return raw.split("\n").map(s => s.trim()).filter(Boolean);
}

// only non-QA lines, minimum signal
function getBrainLines(speaker) {
  const fp = BRAINS[speaker];
  const lines = readLines(fp);
  return lines.filter(
    l =>
      !l.includes("=") &&       // Q=A lives in questions only
      l.length >= 4 &&          // no "ai"/"ok" noise
      !/^\s*$/u.test(l)
  );
}

function sampleNonRepeating(speaker, pool) {
  const history = recentLines[speaker] || [];
  const candidates = pool.filter(line => !history.includes(line));
  const list = candidates.length > 0 ? candidates : pool;
  if (list.length === 0) return "I'm thinking about that."; // safe fallback

  const choice = list[Math.floor(Math.random() * list.length)];
  history.push(choice);
  while (history.length > COOLDOWN) history.shift();
  recentLines[speaker] = history;
  return choice;
}

function normalize(s) {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseQuestions() {
  const lines = readLines(QUESTIONS_TXT);
  const pairs = [];
  for (const line of lines) {
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const q = line.slice(0, idx).trim();
    const a = line.slice(idx + 1).trim();
    if (q && a) pairs.push({ q, a });
  }
  return pairs;
}

function findAnswer(input) {
  const n = normalize(input);
  const pairs = parseQuestions();

  let hit = pairs.find(p => normalize(p.q) === n);
  if (hit) return hit.a;

  hit = pairs.find(p => n.startsWith(normalize(p.q)));
  if (hit) return hit.a;

  hit = pairs.find(p => n.includes(normalize(p.q)));
  if (hit) return hit.a;

  return null;
}

function logLine(filePath, line) {
  fs.appendFileSync(filePath, line.endsWith("\n") ? line : line + "\n");
}

function logInteraction(speaker, type, content) {
  const stamp = new Date().toISOString();
  logLine(INTERACTIONS_LOG, `[${stamp}] [${speaker}] [${type}] ${content}`);
}

// ---- learn sanitizers (brains stay clean, logs get everything) ----
function isGarbage(s) {
  const t = (s || "").trim();
  if (!t) return true;
  if (t === "…" || t === "...") return true;     // ellipsis-only
  if (t.length < 4) return true;                 // too short
  if (!/[A-Za-z0-9]/u.test(t)) return true;      // punctuation-only
  return false;
}

function collapseRunOnDuplicate(s) {
  const t = (s || "").trim();
  const len = t.length;
  if (len % 2 === 0 && len > 0) {
    const mid = len / 2;
    const left = t.slice(0, mid);
    const right = t.slice(mid);
    if (left === right) return left;
  }
  return t;
}

function alreadyHasLine(filePath, line) {
  const body = fs.readFileSync(filePath, "utf8");
  const norm = x => x.replace(/\s+/g, " ").trim();
  const needle = norm(line);
  return body
    .split("\n")
    .map(l => norm(l))
    .some(l => l === needle);
}

// --------------- Routes ---------------

/**
 * GET /generate-response?speaker=veya|orion
 * Returns a random, cleaned line from the speaker’s brain (no QA pairs).
 */
app.get("/generate-response", (req, res) => {
  const speaker = (req.query.speaker || "").toLowerCase();
  if (!BRAINS[speaker]) {
    return res.status(400).json({ error: "Invalid speaker" });
  }

  try {
    const pool = getBrainLines(speaker);
    const line = sampleNonRepeating(speaker, pool);
    logInteraction(speaker, "brain", line);
    res.json({ response: line });
  } catch (err) {
    console.error("generate-response error:", err);
    res.status(500).json({ error: "Failed to generate response" });
  }
});

/**
 * POST /ask
 * Body: { speaker: "veya"|"orion", input: "text" }
 * Looks up input in Questions.txt and returns the ANSWER only.
 * If unknown, logs to logs/i-dont-know.txt and to logs/learned_log.txt (UNKNOWN event).
 */
app.post("/ask", (req, res) => {
  const { speaker, input } = req.body || {};
  if (!speaker || !BRAINS[(speaker || "").toLowerCase()]) {
    return res.status(400).json({ error: "Missing or invalid speaker" });
  }
  if (!input || !input.trim()) {
    return res.status(400).json({ error: "Missing input" });
  }
  const sp = speaker.toLowerCase();

  try {
    const answer = findAnswer(input);
    if (answer) {
      logInteraction(sp, "qa-hit", `${input} -> ${answer}`);
      return res.json({ matched: true, response: answer });
    }

    const stamp = new Date().toISOString();
    logLine(UNKNOWN_FILE, `${stamp} :: ${sp} :: ${input}`);
    // also reflect in learned log as an unknown encounter
    logLine(LEARNED_LOG, `${stamp} :: UNKNOWN :: ${sp} :: ${input}`);
    logInteraction(sp, "qa-miss", input);
    return res.json({ matched: false, response: "I'm thinking about that." });
  } catch (err) {
    console.error("ask error:", err);
    res.status(500).json({ error: "Lookup failed" });
  }
});

/**
 * POST /learn
 * Body: { speaker: "veya"|"orion", phrase: "text" }
 *
 * Behavior:
 * - ALWAYS writes an entry to logs/learned_log.txt (including garbage/duplicates, marked with SKIP-*),
 *   so you have a full audit trail of everything that tried to get learned.
 * - ONLY appends to the speaker’s brain file when it's a clean, non-duplicate freeform line.
 *   (QA pairs must go to Questions.txt.)
 */
app.post("/learn", (req, res) => {
  const { speaker, phrase } = req.body || {};
  const sp = (speaker || "").toLowerCase();

  if (!BRAINS[sp]) {
    return res.status(400).json({ error: "Invalid speaker" });
  }

  let text = collapseRunOnDuplicate((phrase || "").toString());
  if (!text || !text.trim()) {
    // still log the attempt
    logLine(LEARNED_LOG, `${new Date().toISOString()} :: SKIP-EMPTY :: ${sp} :: `);
    return res.status(400).json({ error: "Missing phrase" });
  }

  // QA pairs belong to Questions.txt, not freeform brain
  if (text.includes("=")) {
    logLine(LEARNED_LOG, `${new Date().toISOString()} :: SKIP-QA :: ${sp} :: ${text}`);
    return res.status(400).json({ error: "QA pairs belong in Questions.txt" });
  }

  // Log EVERY attempt first (your requirement)
  const stamp = new Date().toISOString();

  // Garbage? Log as SKIP but still success (no brain write)
  if (isGarbage(text)) {
    logLine(LEARNED_LOG, `${stamp} :: SKIP-GARBAGE :: ${sp} :: ${text}`);
    // 204 = no content; request accepted, nothing to append to brain
    return res.status(204).end();
  }

  try {
    const brainPath = BRAINS[sp];

    if (alreadyHasLine(brainPath, text)) {
      // Log the duplicate attempt (per your request, logged regardless)
      logLine(LEARNED_LOG, `${stamp} :: SKIP-DUP :: ${sp} :: ${text}`);
      return res.status(204).end();
    }

    // Append to brain + log the learn
    fs.appendFileSync(brainPath, text.trim() + "\n");
    logLine(LEARNED_LOG, `${stamp} :: LEARN :: ${sp} :: ${text.trim()}`);
    logInteraction(sp, "learn", text.trim());

    res.json({ success: true, message: "Phrase learned and logged" });
  } catch (err) {
    console.error("learn error:", err);
    res.status(500).json({ error: "Failed to save phrase" });
  }
});

// Optional: shortcut so /beta hits your page directly
app.get("/beta", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "beta.html"));
});

// --------------- Start ---------------
app.listen(PORT, () => {
  console.log(`BrightCodeLabz server listening on http://localhost:${PORT}`);
  console.log(`- Public site: / (serves ./public) e.g. /beta.html`);
  console.log(`- Assets (brains/questions): ${ASSETS_DIR}`);
  console.log(`- Logs: ${LOGS_DIR}`);
});