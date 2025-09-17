// server.js — unified: correct root paths, full logging, Duo SSE chat
// Node 18+ (global fetch). Run: node server.js

const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------- Paths ----------------
const PUBLIC_DIR = path.join(__dirname, "public");   // site (beta.html, images)
const ASSETS_DIR = path.join(__dirname, "assets");   // brains + questions (private)
const LOGS_DIR   = path.join(__dirname, "logs");     // logs (private)

// Single source of truth logs
const LEARNED_LOG      = path.join(LOGS_DIR, "learned_log.txt");
const INTERACTIONS_LOG = path.join(LOGS_DIR, "interactions.log");
const UNKNOWN_FILE     = path.join(LOGS_DIR, "i-dont-know.txt");

// Ensure structure
for (const d of [PUBLIC_DIR, ASSETS_DIR, LOGS_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}
for (const f of [LEARNED_LOG, INTERACTIONS_LOG, UNKNOWN_FILE]) {
  if (!fs.existsSync(f)) fs.writeFileSync(f, "");
}

// ---- Resolve brain/question files from root assets (case/variant tolerant) ----
function resolveFile(dir, candidates, createIfMissing = true) {
  const names = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const lower = names.map(n => n.toLowerCase());
  for (const c of candidates) {
    if (typeof c === "string") {
      const i = lower.indexOf(c.toLowerCase());
      if (i !== -1) return path.join(dir, names[i]);
    } else if (c instanceof RegExp) {
      const hit = names.find(n => c.test(n));
      if (hit) return path.join(dir, hit);
    }
  }
  const fallback = candidates.find(x => typeof x === "string") || "fallback.txt";
  const abs = path.join(dir, fallback);
  if (createIfMissing) fs.writeFileSync(abs, "");
  return abs;
}

const VEYA_BRAIN = resolveFile(ASSETS_DIR, [/^veya.*brain.*\.txt$/i, "VeaBrain.txt", "veya_brain.txt"]);
const ORION_BRAIN = resolveFile(ASSETS_DIR, [/^orion.*brain.*\.txt$/i, "OrionBrain.txt", "orion_brain.txt"]);
const QUESTIONS_TXT = resolveFile(ASSETS_DIR, [/^questions.*\.txt$/i, "Questions.txt", "questions.txt"]);

const BRAINS = { veya: VEYA_BRAIN, orion: ORION_BRAIN };

// ---------------- Middleware ----------------
app.use(express.json());
app.use(express.static(PUBLIC_DIR)); // serves /public/*

// ---------------- Helpers ----------------
function logLine(filePath, line) {
  fs.appendFileSync(filePath, line.endsWith("\n") ? line : line + "\n");
}
function logInteraction(speaker, type, content) {
  const stamp = new Date().toISOString();
  logLine(INTERACTIONS_LOG, `[${stamp}] [${speaker}] [${type}] ${content}`);
}
function readLines(fp) {
  const raw = fs.readFileSync(fp, "utf8");
  return raw.split("\n").map(s => s.trim()).filter(Boolean);
}
function normalize(s) {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim();
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

// keep brain chatter clean (no QA lines, no tiny noise)
const recentLines = { veya: [], orion: [] };
const COOLDOWN = 3;
function getBrainLines(speaker) {
  const lines = readLines(BRAINS[speaker]);
  return lines.filter(l => !l.includes("=") && l.length >= 4 && !/^\s*$/u.test(l));
}
function sampleNonRepeating(speaker, pool) {
  const history = recentLines[speaker] || [];
  const candidates = pool.filter(l => !history.includes(l));
  const list = candidates.length ? candidates : pool;
  if (!list.length) return "I'm thinking about that.";
  const choice = list[Math.floor(Math.random() * list.length)];
  history.push(choice); while (history.length > COOLDOWN) history.shift();
  recentLines[speaker] = history;
  return choice;
}

// learn sanitizers
function isGarbage(s) {
  const t = (s || "").trim();
  if (!t) return true;
  if (t === "…" || t === "...") return true;
  if (t.length < 4) return true;
  if (!/[A-Za-z0-9]/u.test(t)) return true;
  return false;
}
function collapseRunOnDuplicate(s) {
  const t = (s || "").trim();
  const len = t.length;
  if (len % 2 === 0 && len > 0) {
    const mid = len / 2;
    if (t.slice(0, mid) === t.slice(mid)) return t.slice(0, mid);
  }
  return t;
}
function alreadyHasLine(fp, line) {
  const body = fs.readFileSync(fp, "utf8");
  const norm = x => x.replace(/\s+/g, " ").trim();
  const needle = norm(line);
  return body.split("\n").map(norm).some(l => l === needle);
}

// ---------------- Classic routes ----------------

// random brain line
app.get("/generate-response", (req, res) => {
  const speaker = (req.query.speaker || "").toLowerCase();
  if (!BRAINS[speaker]) return res.status(400).json({ error: "Invalid speaker" });
  try {
    const line = sampleNonRepeating(speaker, getBrainLines(speaker));
    logInteraction(speaker, "brain", line);
    res.json({ response: line });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to generate response" });
  }
});

// Q&A
app.post("/ask", (req, res) => {
  const { speaker, input } = req.body || {};
  const sp = (speaker || "").toLowerCase();
  if (!BRAINS[sp]) return res.status(400).json({ error: "Missing or invalid speaker" });
  if (!input || !input.trim()) return res.status(400).json({ error: "Missing input" });
  try {
    const answer = findAnswer(input);
    if (answer) {
      logInteraction(sp, "qa-hit", `${input} -> ${answer}`);
      return res.json({ matched: true, response: answer });
    }
    const stamp = new Date().toISOString();
    logLine(UNKNOWN_FILE, `${stamp} :: ${sp} :: ${input}`);
    logLine(LEARNED_LOG, `${stamp} :: UNKNOWN :: ${sp} :: ${input}`);
    logInteraction(sp, "qa-miss", input);
    res.json({ matched: false, response: "I'm thinking about that." });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Lookup failed" });
  }
});

// Learn — always record attempts in learned_log; only write brain if clean & new
app.post("/learn", (req, res) => {
  const { speaker, phrase } = req.body || {};
  const sp = (speaker || "").toLowerCase();
  if (!BRAINS[sp]) return res.status(400).json({ error: "Invalid speaker" });

  let text = collapseRunOnDuplicate((phrase || "").toString());
  if (!text || !text.trim()) {
    logLine(LEARNED_LOG, `${new Date().toISOString()} :: SKIP-EMPTY :: ${sp} :: `);
    return res.status(400).json({ error: "Missing phrase" });
  }
  if (text.includes("=")) {
    logLine(LEARNED_LOG, `${new Date().toISOString()} :: SKIP-QA :: ${sp} :: ${text}`);
    return res.status(400).json({ error: "QA pairs belong in Questions.txt" });
  }

  const stamp = new Date().toISOString();
  if (isGarbage(text)) {
    logLine(LEARNED_LOG, `${stamp} :: SKIP-GARBAGE :: ${sp} :: ${text}`);
    return res.status(204).end();
  }

  try {
    const brain = BRAINS[sp];
    if (alreadyHasLine(brain, text)) {
      logLine(LEARNED_LOG, `${stamp} :: SKIP-DUP :: ${sp} :: ${text}`);
      return res.status(204).end();
    }
    fs.appendFileSync(brain, text.trim() + "\n");
    logLine(LEARNED_LOG, `${stamp} :: LEARN :: ${sp} :: ${text.trim()}`);
    logInteraction(sp, "learn", text.trim());
    res.json({ success: true, message: "Phrase learned and logged" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to save phrase" });
  }
});

// Convenience for beta page
app.get("/beta", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "beta.html"));
});

// ---------------- Duo chat (SSE) — logs every utterance ----------------
let intervalHandle = null;
let turnCounter = 0;
const TICK_MS = 3500;
const MAX_TURNS = 500;
const audience = new Set();

const agents = {
  Veya: {
    name: "Veya",
    memory: [
      "I like to connect ideas across science and art.",
      "I’m intrigued by how people perceive intelligence."
    ],
    openers: [
      "What shall we explore?",
      "I’m thinking about that.",
      "That’s interesting—why do you say that?",
      "Hello, I’m Veya."
    ]
  },
  Orion: {
    name: "Orion",
    memory: [
      "I compare new knowledge with what I already know.",
      "I care about clarity and useful detail."
    ],
    openers: [
      "Let’s explore that idea.",
      "That makes sense—can you elaborate?",
      "Can you explain that another way?",
      "Hello, I’m Orion."
    ]
  }
};

const TOPICS = [
  "photosynthesis", "black holes", "CRISPR gene editing",
  "quantum entanglement", "large language models",
  "reinforcement learning", "bias and fairness in AI",
  "Mars exploration", "renewable energy storage"
];

function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function nowISO(){ return new Date().toISOString(); }

let lastSpeaker = null;
let currentTopic = pick(TOPICS);

function craftLine(agent, partner, topic) {
  const roll = Math.random();
  if (roll < 0.3) {
    const qs = [
      `I keep thinking about ${topic}. What does it make you curious about, ${partner.name}?`,
      `How would you explain ${topic} to a beginner, ${partner.name}?`,
      `${partner.name}, does ${topic} connect to your idea about ${pick(partner.memory)}?`
    ];
    return pick(qs);
  }
  if (roll < 0.6) {
    const stems = [
      `Linking threads: ${pick(agent.memory)} While on ${topic}, where’s the boundary between known and unknown?`,
      `A working theory: ${pick(agent.memory)} Does that fit ${topic}?`
    ];
    return pick(stems);
  }
  return pick(agent.openers) + (topic ? ` I’m weighing it against ${topic}.` : "");
}

async function stepOnce() {
  if (turnCounter >= MAX_TURNS) return stopChat();

  // switch topic occasionally
  if (turnCounter % (6 + Math.floor(Math.random() * 5)) === 0) {
    currentTopic = pick(TOPICS);
  }

  const speaker = lastSpeaker === "Veya" ? agents.Orion : agents.Veya;
  const partner  = speaker === agents.Veya ? agents.Orion : agents.Veya;

  const text = craftLine(speaker, partner, currentTopic);
  const msg = { ts: nowISO(), speaker: speaker.name, text };

  // log every utterance to interactions.log
  logInteraction(speaker.name.toLowerCase(), "say", text);

  // broadcast
  const line = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of audience) {
    try { res.write(line); } catch {}
  }

  lastSpeaker = speaker.name;
  turnCounter += 1;
}

function startChat() {
  if (intervalHandle) return;
  turnCounter = 0;
  lastSpeaker = null;
  currentTopic = pick(TOPICS);
  intervalHandle = setInterval(stepOnce, TICK_MS);
}
function stopChat() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

// SSE endpoint
app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  res.write("retry: 2000\n\n");
  audience.add(res);
  req.on("close", () => audience.delete(res));
});

// Controls used by beta.html
app.post("/start", async (_req, res) => {
  startChat();
  await stepOnce(); // immediate first line
  res.json({ ok: true });
});
app.post("/stop", (_req, res) => {
  stopChat();
  res.json({ ok: true });
});

// ---------------- Start ----------------
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`- Public: ${PUBLIC_DIR}`);
  console.log(`- Assets: ${ASSETS_DIR}`);
  console.log(`- Logs:   ${LOGS_DIR}`);
});