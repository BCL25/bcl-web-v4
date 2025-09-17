
let round = 0;
const maxRounds = 20;
let lastVeya = "";
let lastOrion = "";
let stopLoop = false;

document.getElementById('duoChatBtn').addEventListener('click', () => {
  stopLoop = false;
  startDuoChat();
});

function sendToVeya() {
  const input = document.getElementById("veyaInput").value;
  speakText(input, "Ava");
  learnFromPhrase("veya", input);
}

function sendToOrion() {
  const input = document.getElementById("orionInput").value;
  speakText(input, "Nathan");
  learnFromPhrase("orion", input);
}

async function startDuoChat() {
  round = 0;
  await runLoop();
}

async function runLoop() {
  while (round < maxRounds && !stopLoop) {
    round++;
    const veyaLine = await getLine("veya", lastOrion);
    speakText(veyaLine, "Ava");
    learnFromPhrase("veya", veyaLine);
    lastVeya = veyaLine;
    await delay(3000);

    const orionLine = await getLine("orion", lastVeya);
    speakText(orionLine, "Nathan");
    learnFromPhrase("orion", orionLine);
    lastOrion = orionLine;
    await delay(4000);
  }
}

function speakText(text, voiceName) {
  const utter = new SpeechSynthesisUtterance(text);
  const voice = speechSynthesis.getVoices().find(v => v.name.includes(voiceName));
  if (voice) utter.voice = voice;
  speechSynthesis.speak(utter);
}

async function getLine(speaker, context) {
  const res = await fetch(`/generate-response?speaker=${speaker}&context=${encodeURIComponent(context)}`);
  const data = await res.json();
  return data.response;
}

async function learnFromPhrase(speaker, phrase) {
  await fetch("/learn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ speaker, phrase })
  });
}

function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
}
