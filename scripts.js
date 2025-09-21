(() => {
  const $ = sel => document.querySelector(sel);
  const transcript = $('#transcript');
  const pv = $('#portraitVeya');
  const po = $('#portraitOrion');

  function addLine({speaker,text,ts}){
    const side = speaker==="Veya"?"left":speaker==="Orion"?"right":"left";
    const row=document.createElement("div");
    row.className=`line ${side}`;
    const time = ts ? `<small style="opacity:.6">${new Date(ts).toLocaleTimeString()}</small><br>` : "";
    row.innerHTML=`<span class="bubble"><strong>${speaker}</strong>${time}${text}</span>`;
    transcript.appendChild(row);
    transcript.scrollTop=transcript.scrollHeight;
  }
  function flash(s){
    if(s==="Veya"){ po.classList.remove("speaking"); pv.classList.add("speaking"); }
    else if(s==="Orion"){ pv.classList.remove("speaking"); po.classList.add("speaking"); }
    setTimeout(()=>{ pv.classList.remove("speaking"); po.classList.remove("speaking"); },900);
  }

  // Voices: Ava + Nathan Enhanced
  const Speech={
    voices:[], vV:null, vO:null,
    pick(){
      const all=speechSynthesis.getVoices();
      this.voices=all;
      this.vV=all.find(v=>/ava/i.test(v.name))||all[0];
      this.vO=all.find(v=>/nathan/i.test(v.name))||all[1]||all[0];
    },
    say(who,text){
      if(!window.speechSynthesis) return;
      if(!this.voices.length) this.pick();
      const u=new SpeechSynthesisUtterance(text);
      if(who==="Veya"){ u.voice=this.vV; u.pitch=1.08; u.rate=1.02; }
      else if(who==="Orion"){ u.voice=this.vO; u.pitch=0.96; u.rate=1.0; }
      speechSynthesis.speak(u);
    }
  };
  speechSynthesis.onvoiceschanged=()=>Speech.pick();

  let es=null;
  async function startChat(){
    await fetch('/start',{method:'POST'});
    es=new EventSource('/events');
    es.onmessage=ev=>{
      const data=JSON.parse(ev.data);
      addLine(data); flash(data.speaker); Speech.say(data.speaker,data.text);
    };
  }
  async function stopChat(){
    if(es){ es.close(); es=null; }
    await fetch('/stop',{method:'POST'});
    speechSynthesis.cancel();
  }

  $('#openDuo').addEventListener('click',()=>{
    $('#duoModal').hidden=false; $('#duoBackdrop').hidden=false;
    transcript.innerHTML="";
    startChat();
  });
  $('#closeDuo').addEventListener('click',()=>{
    stopChat();
    $('#duoModal').hidden=true; $('#duoBackdrop').hidden=true;
  });
  $('#duoBackdrop').addEventListener('click',()=>$('#closeDuo').click());

  // --- NEW: Manual input handling ---
  async function sendTo(speaker) {
    const inputEl = $('#userInput');
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = "";

    // Show user’s line
    addLine({ speaker:"You → "+speaker, text, ts:new Date().toISOString() });

    try {
      const res = await fetch('/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ speaker, input: text })
      });
      const data = await res.json();
      if (data && data.response) {
        addLine({ speaker, text:data.response, ts:new Date().toISOString() });
        flash(speaker);
        Speech.say(speaker,data.response);
      }
    } catch(e){ console.warn("Send error:", e); }
  }

  $('#sendVeya').addEventListener('click',()=>sendTo("Veya"));
  $('#sendOrion').addEventListener('click',()=>sendTo("Orion"));

  // Optional: Enter key defaults to Veya
  $('#userInput')?.addEventListener('keydown',e=>{
    if(e.key==="Enter"){ e.preventDefault(); sendTo("Veya"); }
  });
})();