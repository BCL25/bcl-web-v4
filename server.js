// server.js
const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const PUBLIC_DIR = path.join(__dirname, "public");
const ASSETS_DIR = path.join(__dirname, "assets");
const LOGS_DIR   = path.join(__dirname, "logs");

const FILES = {
  veyaBrain: path.join(ASSETS_DIR, "veya_brain.txt"),
  orionBrain: path.join(ASSETS_DIR, "orion_brain.txt"),
  bothBrain: path.join(ASSETS_DIR, "both_brain.txt"),
  interactions: path.join(LOGS_DIR, "interactions.log"),
  unknown: path.join(LOGS_DIR, "i-dont-know.txt"),
};

// Ensure dirs/files
[PUBLIC_DIR, ASSETS_DIR, LOGS_DIR].forEach(d => { 
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive:true }); 
});
Object.values(FILES).forEach(f => { 
  if (!fs.existsSync(f)) fs.writeFileSync(f,""); 
});

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

function logLine(file, msg){ fs.appendFileSync(file, msg + "\n"); }

function readLines(fp){
  return fs.readFileSync(fp,"utf8")
    .split(/\r?\n/)
    .map(s=>s.trim())
    .filter(Boolean)
    .filter(line => !line.startsWith("#"));
}

function parsePairs(fp){
  return readLines(fp).map(line => {
    const idx = line.indexOf("=");
    if (idx === -1) return { q: line, a: line };
    return { q: line.slice(0, idx).trim(), a: line.slice(idx+1).trim() };
  });
}

function findAnswer(fp, input){
  const pairs = parsePairs(fp);
  const lower = input.toLowerCase();
  return pairs.find(p => p.q.toLowerCase() === lower)?.a || null;
}

// ---- Single speaker ----
app.post("/ask",(req,res)=>{
  const { speaker="Veya", input } = req.body||{};
  if(!input) return res.status(400).json({error:"Missing input"});

  const file = speaker==="Orion" ? FILES.orionBrain : FILES.veyaBrain;
  const ans = findAnswer(file, input);

  if(ans){
    logLine(FILES.interactions, `[${new Date().toISOString()}] [${speaker}] Q: ${input} → A: ${ans}`);
    return res.json({ok:true, response:ans});
  }

  logLine(FILES.unknown, `[${new Date().toISOString()}] [${speaker}] ${input}`);
  return res.json({ok:false, response:"Sorry, I don’t know that yet."});
});

// ---- Both speakers ----
app.post("/askBoth",(req,res)=>{
  const { input } = req.body||{};
  if(!input) return res.status(400).json({error:"Missing input"});

  const pairs = parsePairs(FILES.bothBrain);
  const lower = input.toLowerCase();
  const found = pairs.find(p => p.q.toLowerCase() === lower);

  if(found){
    const parts = found.a.split("|").map(s=>s.trim());
    const veyaText = parts[0] || "…";
    const orionText = parts[1] || "…";
    logLine(FILES.interactions, `[${new Date().toISOString()}] [Both] Q: ${input} → Veya: ${veyaText} | Orion: ${orionText}`);
    return res.json({ok:true, response:{veya:veyaText, orion:orionText}});
  }

  logLine(FILES.unknown, `[${new Date().toISOString()}] [Both] ${input}`);
  return res.json({ok:false, response:{veya:"Sorry, I don’t know that yet.", orion:"Let’s circle back later."}});
});

app.get("/beta",(_req,res)=>res.sendFile(path.join(PUBLIC_DIR,"beta.html")));

app.listen(PORT,()=>console.log(`Server running http://localhost:${PORT}`));