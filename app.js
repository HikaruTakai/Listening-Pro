'use strict';

// Keep unrelated app data intact; this app does not need a device UUID.

/* ============================================================
   設定
============================================================ */
const DEFAULT_SETTINGS = { autoLogin:true, defaultSpeed:1.0 };
function loadSettings(){
  try {
    const r = localStorage.getItem('n_app_settings');
    return r ? Object.assign({}, DEFAULT_SETTINGS, JSON.parse(r)) : Object.assign({}, DEFAULT_SETTINGS);
  } catch(e){ return Object.assign({}, DEFAULT_SETTINGS); }
}
function saveSettings(s){
  try { localStorage.setItem('n_app_settings', JSON.stringify(s)); } catch(e){}
}
const appSettings = loadSettings();

/* Static-host account model. CSV and balances are public/client-side, not security controls. */
let currentAccount = null;
let usersCsvPromise = null;
const USER_CSV_URL = './data/users.csv';
function localDateKey(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}

function parseCsvRows(text){
  const rows=[]; let row=[], cell='', quoted=false;
  const input=String(text||'').replace(/^\uFEFF/,'');
  for(let i=0;i<input.length;i++){
    const ch=input[i];
    if(quoted){
      if(ch=='"' && input[i+1]=='"'){cell+='"';i++;}
      else if(ch=='"') quoted=false;
      else cell+=ch;
    } else if(ch=='"' && cell==='') quoted=true;
    else if(ch===','){row.push(cell);cell='';}
    else if(ch==='\n' || ch==='\r'){
      if(ch==='\r' && input[i+1]==='\n') i++;
      row.push(cell);cell='';
      if(row.some(v=>String(v).trim()!=='')) rows.push(row);
      row=[];
    } else cell+=ch;
  }
  if(cell!=='' || row.length){row.push(cell);if(row.some(v=>String(v).trim()!==''))rows.push(row);}
  return rows;
}

async function loadUsersCsv(){
  if(usersCsvPromise) return usersCsvPromise;
  usersCsvPromise=(async()=>{
    const url=new URL(USER_CSV_URL,document.baseURI);
    try{
      const res=await fetch(url.href,{cache:'no-store',credentials:'omit',redirect:'error'});
      if(!res.ok) throw new Error('CSV HTTP '+res.status);
      const raw=await res.text();
      const rows=parseCsvRows(raw);
      if(!rows.length) return {users:[],ok:true};
      const first=rows[0].slice(0,3).map(v=>String(v||'').trim().toLowerCase());
      const hasHeader=first[0]==='id' || first[0]==='user id' || first[1]==='credits' || first[2]==='plan';
      const records=hasHeader?rows.slice(1):rows;
      const users=[]; const ids=new Set();
      for(const cells of records){
        const id=String(cells[0]??'').trim();
        if(!id || ids.has(id)) continue;
        const rawCredits=String(cells[1]??'0').trim();
        const plan=String(cells[2]??'Free').trim()||'Free';
        const isPro=plan.toUpperCase()==='PRO';
        const numeric=Number(rawCredits);
        const credits=isPro?Infinity:(Number.isFinite(numeric)?Math.max(0,Math.floor(numeric)):0);
        users.push({id,plan,credits,isPro}); ids.add(id);
      }
      return {users,ok:true};
    }catch(error){
      usersCsvPromise=null;
      return {users:[],ok:false,error};
    }
  })();
  return usersCsvPromise;
}

function accountStorageKey(id){return 'listening-pro:account:'+encodeURIComponent(String(id));}
function readRemainingCredits(user){
  if(user.isPro) return Infinity;
  try{
    const key=accountStorageKey(user.id),raw=localStorage.getItem(key);
    if(raw){
      const saved=JSON.parse(raw);
      if(Number(saved.baseCredits)===user.credits && Number.isFinite(Number(saved.remaining)))
        return Math.max(0,Math.min(user.credits,Math.floor(Number(saved.remaining))));
    }
  }catch(e){}
  return user.credits;
}
function writeRemainingCredits(){
  if(!currentAccount || currentAccount.isPro || currentAccount.mode==='guest') return;
  try{localStorage.setItem(accountStorageKey(currentAccount.id),JSON.stringify({baseCredits:currentAccount.credits,remaining:currentAccount.remaining}));}catch(e){}
}
function displayCredits(){
  if(!currentAccount) return '0';
  if(currentAccount.isPro) return '無限';
  return String(Math.max(0,currentAccount.remaining??0));
}
function persistOfflineAccount(){
  if(!currentAccount || currentAccount.mode!=='user') return;
  try{
    localStorage.setItem('listening-pro:last-account',JSON.stringify({id:currentAccount.id,plan:currentAccount.plan,credits:currentAccount.credits,isPro:currentAccount.isPro,remaining:currentAccount.remaining}));
  }catch(e){}
}
function restoreOfflineAccount(id){
  try{
    const c=JSON.parse(localStorage.getItem('listening-pro:last-account')||'null');
    if(c && c.id===id){currentAccount={...c,mode:'user',offline:true};return true;}
  }catch(e){}
  return false;
}


/* ============================================================
   状態
============================================================ */
const state = {
  data:null, currentQIdx:0, answers:{}, doubts:{},
  speed: appSettings.defaultSpeed || 1.0, playToken:0,
  seq:{isPlaying:false}, review:{active:false, isPlaying:false},
  isStarting:false, initialized:false
};

const $ = id => document.getElementById(id);
const isPlaybackActive = t => t === state.playToken;

function sleep(ms, token){
  return new Promise(resolve => {
    const s = Date.now();
    const tick = () => {
      if (token !== undefined && token !== state.playToken) return resolve();
      if (Date.now() - s >= ms) return resolve();
      setTimeout(tick, 30);
    };
    tick();
  });
}

function invalidatePlayback(){
  state.playToken++;
  if (typeof speech !== 'undefined' && speech && speech.cancelPlayback){
    try { speech.cancelPlayback(); } catch(e){}
  }
}

/* ============================================================
   モーダル
============================================================ */
function showModal(title, text, isConfirm, onConfirm){
  const modal = $('customModal'), bg = $('customModalBg'), box = $('customModalBox');
  $('customModalTitle').innerText = title;
  $('customModalText').innerText = text;
  const c = $('customModalCancel'), k = $('customModalConfirm');
  if (isConfirm){ c.classList.remove('hidden'); k.innerText = 'OK'; }
  else { c.classList.add('hidden'); k.innerText = '閉じる'; }
  modal.classList.remove('hidden');
  void modal.offsetWidth;
  bg.classList.replace('opacity-0','opacity-100');
  box.classList.replace('scale-95','scale-100');
  box.classList.replace('opacity-0','opacity-100');
  const close = () => {
    bg.classList.replace('opacity-100','opacity-0');
    box.classList.replace('scale-100','scale-95');
    box.classList.replace('opacity-100','opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 300);
  };
  k.onclick = () => { close(); if (onConfirm) onConfirm(); };
  c.onclick = close;
}

/* ============================================================
   ★ 音声エンジン（端末標準 SpeechSynthesis・音声データの保存なし）
   - voiceMap:      speechSynthesis 用 {voice, pitch} オブジェクト
   - iOS Safariのキャンセル競合を抑制 / エラー時は画面に通知
============================================================ */
const speech = {
  synth: window.speechSynthesis,
  voices: [],
  audioSessionReady: false,

  /* speechSynthesis 用 voice マップ（speaker -> {voice, pitch}） */
  voiceMap: null,

  init(){
    try {
      if (navigator.audioSession && !this.audioSessionReady){
        try { navigator.audioSession.type = 'playback'; } catch(e){}
        this.audioSessionReady = true;
      }
    } catch(e){}
    if (!this.synth) return;
    const load = () => {
      try {
        const v = this.synth.getVoices() || [];
        if (v.length) this.voices = v;
      } catch(e){}
    };
    load();
    if (this.synth.onvoiceschanged !== undefined) this.synth.onvoiceschanged = load;
    let n = 0;
    const t = setInterval(() => {
      load();
      if (this.voices.length || n++ > 60) clearInterval(t);
    }, 200);
  },

  warmup(){
    // Call from a real tap. Do not keep a silent audio element running in the background.
    try { if (this.synth && typeof this.synth.resume === 'function') this.synth.resume(); } catch(e){}
    return !!this.synth;
  },

  cancelPlayback(){
    try { if (this.synth && (this.synth.speaking || this.synth.pending)) this.synth.cancel(); } catch(e){}
  },

  /* ---- speechSynthesis 用 英語voice（Kyoko排除・品質順） ---- */
  getEnglishVoices(){
    const list = this.voices;
    if (!list || !list.length) return [];
    const en = list.filter(v => {
      const l = String(v.lang || '').toLowerCase();
      const n = String(v.name || '').toLowerCase();
      if (l.indexOf('ja') === 0) return false;
      if (/kyoko|o-ren|otoya|hattori/.test(n)) return false;
      if (!/^en/.test(l)) return false;
      if (/albert|bells|bubbles|cellos|jester|organ|whisper|zarvox|wobble|bahh|deranged|hysterical|bruce\b|junior|kathy|princess|ralph|agnes|trinoids|boing|superstar|pipe organ|good news|bad news/i.test(n)) return false;
      return true;
    });
    const score = v => {
      let s = 0; const n = (v.name || '').toLowerCase();
      if (/enhanced|premium/.test(n)) s += 1000;
      if (/neural|natural/.test(n)) s += 800;
      if (/siri/.test(n)) s += 600;
      if (/samantha/.test(n)) s += 500;
      if (/alex\b/.test(n)) s += 480;
      if (/daniel/.test(n)) s += 460;
      if (/karen/.test(n)) s += 440;
      if (/moira/.test(n)) s += 420;
      if (/tessa/.test(n)) s += 400;
      if (/serena/.test(n)) s += 380;
      if (/fiona/.test(n)) s += 360;
      if (/rishi/.test(n)) s += 340;
      if (/google/.test(n)) s += 320;
      if (/nathan|evan|zoe/.test(n)) s += 200;
      if (v.localService) s += 100;
      if (String(v.lang||'').toLowerCase() === 'en-us') s += 30;
      return s;
    };
    en.sort((a,b) => score(b) - score(a));
    return en;
  },

  getEnglishVoice(){
    const all = this.getEnglishVoices();
    return all.length ? all[0] : null;
  },

  guessGenderFromName(name){
    const n = String(name || '').toLowerCase();
    const f = ['samantha','karen','moira','tessa','fiona','serena','zoe','victoria','allison','ava','susan','joanna','salli','kendra','kimberly','amy','emma','nicole','catherine','alice','anna','daria','ellen','helena','ioana','joana','lana','laura','marie','martha','melina','milena','monica','nora','paulina','sara','shelley','tina','female','woman','girl'];
    const m = ['alex','daniel','fred','tom','oliver','arthur','nathan','evan','matthew','joey','justin','brian','russell','eric','ryan','rishi','aaron','eddy','gordon','jacques','martin','ralph','reed','thomas','xander','hattori','male','man','boy'];
    for (const t of f) if (n.indexOf(t) !== -1) return 'f';
    for (const t of m) if (n.indexOf(t) !== -1) return 'm';
    return 'u';
  },

  /* ---- speechSynthesis 用 voiceMap 構築 ---- */
  buildVoiceMap(speakerKeys){
    const all = this.getEnglishVoices();
    const pools = { all, f: [], m: [] };
    for (const v of all){
      const g = this.guessGenderFromName(v.name);
      if (g === 'f') pools.f.push(v);
      else if (g === 'm') pools.m.push(v);
    }
    const keys = Array.from(new Set(speakerKeys || [])).filter(k => k && k !== 'JA' && k !== 'Q_JA');
    const ordered = ['N','Q'].filter(k => keys.indexOf(k) !== -1)
      .concat(keys.filter(k => ['N','Q'].indexOf(k) === -1));

    const map = {};
    const used = new Set();
    let counter = 0;
    for (const spk of ordered){
      if (map[spk]) continue;
      const hint = /^(w|f|woman|girl|female|ms|mrs|miss|sister|mother|mom|she|her|女)/i.test(spk) ? 'f'
                 : /^(m|man|boy|male|mr|sir|brother|father|dad|he|him|男)/i.test(spk) ? 'm' : null;
      let pool = pools.all;
      if (hint === 'f' && pools.f.length) pool = pools.f;
      else if (hint === 'm' && pools.m.length) pool = pools.m;
      if (!pool.length) pool = pools.all;

      let chosen = pool.find(v => !used.has(v.voiceURI)) || null;
      let pitch = 1.0;
      if (!chosen && pool.length){
        const cycle = Math.floor(counter / pool.length);
        const within = counter % pool.length;
        chosen = pool[within];
        if (cycle === 1) pitch = 1.15;
        else if (cycle === 2) pitch = 0.85;
        else if (cycle >= 3) pitch = (cycle % 2 === 1) ? 1.20 : 0.80;
      }
      if (chosen) used.add(chosen.voiceURI);
      map[spk] = { voice: chosen, pitch };
      counter++;
    }
    this.voiceMap = map;
  },

  resetVoiceMap(){
    this.voiceMap = null;
  },

  async playViaSynth(text, speakerKey, isJa, token){
    if (!isPlaybackActive(token)) return false;
    if (!this.synth || typeof SpeechSynthesisUtterance === 'undefined') return false;
    const cleaned = cleanTextForTTS(text, isJa);
    if (!cleaned) return true;

    const buildUtterance = () => {
      const u = new SpeechSynthesisUtterance(cleaned);
      if (isJa){
        u.lang = 'ja-JP';
        const ja = (this.voices || []).filter(v => String(v.lang || '').toLowerCase().indexOf('ja') === 0);
        if (ja.length){
          ja.sort((a,b) => {
            const sc = x => {
              let s = 0; const n = (x.name || '').toLowerCase();
              if (/enhanced|premium/.test(n)) s += 500;
              if (/siri/.test(n)) s += 300;
              if (/google/.test(n)) s += 200;
              if (x.localService) s += 50;
              return s;
            };
            return sc(b) - sc(a);
          });
          u.voice = ja[0];
        }
        u.pitch = 1.0;
      } else {
        const prof = this.voiceMap && this.voiceMap[speakerKey];
        let voice = prof ? prof.voice : null;
        let pitch = prof ? prof.pitch : 1.0;
        if (!voice) voice = this.getEnglishVoice();
        // A browser may expose voices asynchronously or return an empty list. Do not fail silently:
        // set the language and allow the operating system's default voice to speak.
        u.lang = (voice && voice.lang) ? voice.lang : 'en-US';
        if (voice) u.voice = voice;
        u.pitch = Math.max(0.5, Math.min(2.0, pitch));
      }
      u.rate = Math.max(0.5, Math.min(2.0, state.speed));
      u.volume = 1.0;
      return u;
    };

    const doAttempt = () => new Promise(res => {
      if (!isPlaybackActive(token)) return res(false);
      const u = buildUtterance();
      if (!u) return res(false);
      let started = false, finished = false;
      let watchdog=null, maxTimer=null;
      const finish = ok => { if (finished) return; finished = true; if(watchdog)clearTimeout(watchdog); if(maxTimer)clearTimeout(maxTimer); res(ok); };
      u.onstart = () => { started = true; if(watchdog){clearTimeout(watchdog);watchdog=null;} };
      u.onend = () => finish(true);
      u.onerror = () => finish(false);
      watchdog = setTimeout(() => {
        if (!started && !finished){ try { this.synth.cancel(); } catch(e){} finish(false); }
      }, 8000);
      const est = Math.max(20000, (cleaned.length / (state.speed * 0.006)) + 8000);
      maxTimer = setTimeout(() => { try{this.synth.cancel();}catch(e){} finish(false); }, Math.min(180000, est));
      try { this.synth.speak(u); } catch(e){ finish(false); }
    });

    // Do not delay the first speak() call after a tap; iOS Safari may require user activation.
    try { this.synth.resume(); } catch(e){}
    let ok = await doAttempt();
    if (!ok && isPlaybackActive(token)){
      try { this.synth.cancel(); } catch(e){}
      await new Promise(r => setTimeout(r, 220));
      if (!isPlaybackActive(token)) return false;
      try { this.synth.resume(); } catch(e){}
      ok = await doAttempt();
    }
    return ok;
  },

  /* ---- 1チャンク再生:端末内のSpeechSynthesisのみ。音声データを生成・保存しない ---- */
  async playOne(text, speaker, token){
    if (!isPlaybackActive(token)) return false;
    const isJa = (speaker === 'JA' || speaker === 'Q_JA');
    const cleaned = cleanTextForTTS(text, isJa);
    if (!cleaned) return true;
    if (!isPlaybackActive(token)) return false;
    return await this.playViaSynth(cleaned, speaker, isJa, token);
  },

  async speak(text, speaker, token){
    if (!isPlaybackActive(token)) return false;
    const isJa = (speaker === 'JA' || speaker === 'Q_JA');
    const cleaned = cleanTextForTTS(text, isJa);
    if (!cleaned) return true;
    const chunks = this.splitText(cleaned, isJa ? 80 : 150);
    for (let i = 0; i < chunks.length; i++){
      if (!isPlaybackActive(token)) return false;
      const ok = await this.playOne(chunks[i], speaker, token);
      if (!isPlaybackActive(token)) return false;
      if (!ok) return false;
      if (i < chunks.length - 1) await sleep(isJa ? 100 : 140, token);
    }
    return true;
  },

  splitText(text, maxLen){
    if (text.length <= maxLen) return [text];
    const parts = text.split(/(?<=[.!?。！？])\s+/).filter(s => s.trim().length);
    const chunks = [];
    let cur = '';
    for (const p of parts){
      if (!p) continue;
      if ((cur + ' ' + p).trim().length > maxLen && cur){ chunks.push(cur.trim()); cur = p; }
      else cur = cur ? cur + ' ' + p : p;
    }
    if (cur) chunks.push(cur.trim());
    const final = [];
    for (const c of chunks){
      if (c.length <= maxLen){ final.push(c); continue; }
      let s = c;
      while (s.length > maxLen){
        let cut = s.lastIndexOf(' ', maxLen);
        if (cut < maxLen / 2) cut = maxLen;
        final.push(s.slice(0, cut).trim());
        s = s.slice(cut).trim();
      }
      if (s) final.push(s);
    }
    return final;
  }
};

/* ============================================================
   テキスト整形
============================================================ */
function cleanTextForTTS(text, isJa){
  if (!text) return "";
  let t = String(text).trim();
  if (!isJa){
    t = t.replace(/^Question\s*[:：]\s*/i, 'Question. ')
         .replace(/^Q\s*[:：]\s*/i, 'Question. ')
         .replace(/\b([A-Z])'s\b/g, '$1s')
         .replace(/\be\.g\.\b/gi, 'for example')
         .replace(/\bi\.e\.\b/gi, 'that is')
         .replace(/\betc\.\b/gi, 'et cetera')
         .replace(/\bvs\.\b/gi, 'versus')
         .replace(/&/g, 'and');
  }
  return t;
}

/* ============================================================
   話者収集
============================================================ */
function collectSpeakersFromQuestion(q){
  const set = new Set(['N','Q']);
  if (q && q.dialogue) q.dialogue.forEach(d => { if (d.speaker) set.add(d.speaker); });
  return Array.from(set);
}
function collectSpeakersFromAllData(){
  const set = new Set(['N','Q']);
  if (state.data && state.data.questions){
    state.data.questions.forEach(q => {
      if (q.dialogue) q.dialogue.forEach(d => { if (d.speaker) set.add(d.speaker); });
    });
  }
  return Array.from(set);
}

/* ============================================================
   N-Format パーサー
============================================================ */
function parseTableBuffer(buf){
  return buf.map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    .map(r => r.split('|').map(c => c.trim()));
}

function parseNFormat(inputStr){
  try {
    let text = inputStr.trim();
    if (!text.includes('#TITLE:') || !text.includes('#Q_START:')){
      let cs = text.replace(/```[a-zA-Z0-9]*\n?/gi, '').replace(/```/g, '').replace(/[\s\r\n]+/g, '');
      cs = cs.replace(/-/g, '+').replace(/_/g, '/');
      while (cs.length % 4 !== 0) cs += '=';
      try {
        const b = atob(cs);
        try {
          const by = new Uint8Array(b.length);
          for (let i = 0; i < b.length; i++) by[i] = b.charCodeAt(i);
          text = new TextDecoder('utf-8', { fatal:true }).decode(by);
        } catch(e){ text = decodeURIComponent(escape(b)); }
      } catch(e){ text = decodeURIComponent(escape(atob(cs.replace(/[^A-Za-z0-9+/=]/g, '')))); }
    }
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

    const lines = text.split(/\r?\n/);
    const data = { title:"リスニングテスト", questions:[] };
    let q = null, coll = null, buf = [];

    const commit = () => {
      if (!q){ buf = []; coll = null; return; }
      if (coll === 'svg') q.svg = buf.join('\n').trim();
      else if (coll === 'table') q.table = parseTableBuffer(buf);
      buf = []; coll = null;
    };

    for (const raw of lines){
      const line = raw.trim();
      if (coll === 'svg'){ if (line === '#SVG_END:') commit(); else buf.push(raw); continue; }
      if (coll === 'table'){ if (line === '#TABLE_END:') commit(); else buf.push(raw); continue; }
      if (!line) continue;

      if (line.startsWith('#TITLE:')) data.title = line.substring(7).trim();
      else if (line.startsWith('#Q_START:')){
        q = {
          id: data.questions.length, type: line.substring(9).trim(),
          instruction:"", repeats:2, svg:"", table:null, dialogue:[],
          question:{ text:"", ja:"" }, options:[], answer:null, explanation:""
        };
      } else if (q){
        if (line === '#SVG_START:'){ coll = 'svg'; buf = []; }
        else if (line === '#TABLE_START:'){ coll = 'table'; buf = []; }
        else if (line.startsWith('#INST:')) q.instruction = line.substring(6).trim();
        else if (line.startsWith('#REP:')) q.repeats = parseInt(line.substring(5), 10) || 2;
        else if (line.startsWith('#SVG:')) q.svg = line.substring(5).trim();
        else if (line.startsWith('#DIA:')){
          const p = line.substring(5).split('|');
          if (p.length >= 2){
            q.dialogue.push({
              speaker: p[0].trim(),
              text: p[1].trim(),
              ja: p[2] ? p[2].trim() : ""
            });
          }
        } else if (line.startsWith('#QTXT:')){
          const p = line.substring(6).split('|');
          q.question = { text: p[0].trim(), ja: p[1] ? p[1].trim() : "" };
        } else if (line.startsWith('#OPT:')){
          q.options = line.substring(5).split('|').map(s => s.trim());
        } else if (line.startsWith('#ANS:')){
          const a = line.substring(5).trim();
          q.answer = q.type === 'choice'
            ? parseInt(a, 10)
            : a.split(',').map(s => parseInt(s.trim(), 10));
        } else if (line.startsWith('#EXP:')){
          q.explanation = line.substring(5).trim();
        } else if (line.startsWith('#Q_END:')){
          if (q.options.length && q.answer !== null) data.questions.push(q);
          q = null;
        }
      }
    }
    if (coll) commit();
    if (!data.questions.length) throw new Error("データがありません。");
    return data;
  } catch(e){
    throw new Error("解読失敗。正しいデータか確認してください。");
  }
}

function escapeHtml(s){
  return s == null ? '' : String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* Strict SVG allowlist for user-pasted N-Format diagrams. No scripts, links, images, foreignObject, or event attributes. */
function sanitizeSvgMarkup(markup){
  if(typeof DOMParser==='undefined') return '';
  const doc=new DOMParser().parseFromString(String(markup||''),'image/svg+xml');
  const root=doc.documentElement;
  if(!root || String(root.localName).toLowerCase()!=='svg' || doc.querySelector('parsererror')) return '';
  const elements=new Set(['svg','g','path','rect','circle','ellipse','line','polyline','polygon','text','tspan','defs','marker','clippath','lineargradient','radialgradient','stop','title','desc']);
  const attrs=new Set(['xmlns','width','height','viewbox','preserveaspectratio','id','class','x','y','x1','y1','x2','y2','cx','cy','r','rx','ry','d','points','transform','fill','fill-rule','fill-opacity','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-dasharray','stroke-dashoffset','stroke-opacity','opacity','clip-path','clipPathUnits'.toLowerCase(),'marker-start','marker-mid','marker-end','markerwidth','markerheight','refx','refy','orient','gradientunits','gradienttransform','offset','stop-color','stop-opacity','font-size','font-family','font-weight','font-style','text-anchor','dominant-baseline','alignment-baseline','dx','dy','rotate']);
  const localUrlAttrs=new Set(['fill','stroke','clip-path','marker-start','marker-mid','marker-end']);
  const safeStyleProps=new Set(['color','fill','fill-rule','fill-opacity','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-dasharray','stroke-opacity','opacity','font-size','font-family','font-weight','font-style','text-anchor','dominant-baseline','alignment-baseline','text-decoration']);
  function sanitizeStyle(value){
    const safe=[];
    for(const decl of String(value||'').split(';')){
      const i=decl.indexOf(':'); if(i<1) continue;
      const prop=decl.slice(0,i).trim().toLowerCase(), val=decl.slice(i+1).trim();
      if(!safeStyleProps.has(prop) || !val || /url\s*\(|expression|javascript:|@import|[<>]/i.test(val)) continue;
      if(!/^[#(),.%\w\s+-]+$/.test(val)) continue;
      safe.push(prop+':'+val);
    }
    return safe.join(';');
  }
  function clean(node){
    for(const attr of Array.from(node.attributes||[])){
      const name=attr.name.toLowerCase(), value=attr.value.trim();
      if(name.startsWith('on')){node.removeAttribute(attr.name);continue;}
      if(name==='style'){
        const safe=sanitizeStyle(value); if(safe) node.setAttribute('style',safe); else node.removeAttribute(attr.name);
        continue;
      }
      if(!attrs.has(name)){node.removeAttribute(attr.name);continue;}
      if(localUrlAttrs.has(name) && /url\s*\(/i.test(value) && !/^url\(\s*#[\w:.-]+\s*\)$/i.test(value)) node.removeAttribute(attr.name);
      if(/javascript:|data:text\/html|https?:\/\//i.test(value) && localUrlAttrs.has(name)) node.removeAttribute(attr.name);
    }
    for(const child of Array.from(node.children||[])){
      if(!elements.has(String(child.localName).toLowerCase())) child.remove();
      else clean(child);
    }
  }
  clean(root);
  return root.outerHTML;
}

function renderTableHTML(t){
  if (!t || !t.length) return '';
  const [h, ...b] = t;
  return '<div style="overflow-x:auto;margin:14px 0;border-radius:14px;border:1px solid #e2e8f0;background:#fff;">'
    + '<table class="n-table"><thead><tr>'
    + h.map(x => '<th>' + escapeHtml(x) + '</th>').join('')
    + '</tr></thead><tbody>'
    + b.map(r => '<tr>' + r.map(c => '<td>' + escapeHtml(c) + '</td>').join('') + '</tr>').join('')
    + '</tbody></table></div>';
}

/* ============================================================
   認証
============================================================ */
function setupAuth(){
  const loginBtn=$('loginBtn'),guestBtn=$('guestBtn'),userIdInput=$('userIdInput');
  const showMainUI=(plan,credits)=>{
    $('loginOverlay').classList.add('opacity-0','pointer-events-none');
    setTimeout(()=>$('loginOverlay').classList.add('hidden'),350);
    const pill=$('accountStatusPill');pill.classList.remove('hidden');pill.classList.add('flex');
    $('logoutBtn').classList.remove('hidden');$('homeBtn').classList.remove('hidden');$('settingsBtn').classList.remove('hidden');
    $('planDisplay').innerText=String(plan||'Free');$('creditDisplay').innerText=String(credits);
  };
  const showLogin=()=>{$('loginOverlay').classList.remove('hidden','opacity-0','pointer-events-none');};
  const setLoading=busy=>{loginBtn.disabled=busy;loginBtn.textContent=busy?'確認中…':'ログイン';};
  const failLogin=(title,message)=>{setLoading(false);showLogin();showModal(title,message,false);};
  const tryLogin=async uid=>{
    uid=String(uid||'').trim();
    if(!uid){showModal('入力エラー','IDを入力してください。',false);return;}
    setLoading(true);
    const result=await loadUsersCsv();
    if(!result.ok){
      let restored=false;
      if(result.error && navigator.onLine===false) restored=restoreOfflineAccount(uid);
      if(restored){setLoading(false);persistOfflineAccount();showMainUI(currentAccount.plan,displayCredits());return;}
      failLogin('データを読み込めません','data/users.csv を読み込めませんでした。ネットワークを確認してください。');return;
    }
    const user=result.users.find(u=>u.id===uid);
    if(!user){failLogin('ログインできません','IDが見つかりません。IDと data/users.csv の内容を確認してください。');return;}
    currentAccount={...user,mode:'user',remaining:readRemainingCredits(user),offline:false};
    if(appSettings.autoLogin){try{localStorage.setItem('n_user_id',uid);localStorage.setItem('n_user_mode','user');}catch(e){}}
    persistOfflineAccount();setLoading(false);showMainUI(currentAccount.plan,displayCredits());
  };
  const enterGuest=()=>{
    const today=localDateKey();
    let date='',count=0;
    try{date=localStorage.getItem('n_guest_date')||'';count=parseInt(localStorage.getItem('n_guest_count')||'0',10)||0;}catch(e){}
    if(date!==today){date=today;count=0;try{localStorage.setItem('n_guest_date',date);localStorage.setItem('n_guest_count','0');}catch(e){}}
    currentAccount={id:'',plan:'GUEST',isPro:false,credits:Math.max(0,2-count),remaining:Math.max(0,2-count),mode:'guest'};
    try{localStorage.setItem('n_user_mode','guest');localStorage.removeItem('n_user_id');}catch(e){}
    showMainUI('GUEST',Math.max(0,2-count)+'回');
  };
  let savedMode=null,savedId=null;
  try{savedMode=localStorage.getItem('n_user_mode');savedId=localStorage.getItem('n_user_id');}catch(e){}
  if(savedMode==='guest') enterGuest();
  else if(savedMode==='user' && savedId && appSettings.autoLogin) tryLogin(savedId);
  loginBtn.addEventListener('click',()=>tryLogin(userIdInput.value));
  userIdInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();tryLogin(userIdInput.value);}});
  guestBtn.addEventListener('click',enterGuest);
  $('logoutBtn').addEventListener('click',()=>{
    showModal('ログアウト','ログアウトしますか？',true,()=>{
      invalidatePlayback();currentAccount=null;
      try{localStorage.removeItem('n_user_id');localStorage.removeItem('n_user_mode');}catch(e){}
      showLogin();$('accountStatusPill').classList.add('hidden');$('accountStatusPill').classList.remove('flex');
      $('logoutBtn').classList.add('hidden');$('homeBtn').classList.add('hidden');$('settingsBtn').classList.add('hidden');userIdInput.value='';
    });
  });
}

/* ============================================================
   設定モーダル
============================================================ */
function openSettings(){
  const m = $('settingsModal'), bg = $('settingsModalBg'), c = $('settingsModalContent');
  $('settingAutoLogin').checked = !!appSettings.autoLogin;
  $('settingSpeed').value = appSettings.defaultSpeed || 1.0;
  $('settingSpeedVal').innerText = (appSettings.defaultSpeed || 1.0).toFixed(1) + 'x';
  m.classList.remove('hidden'); document.body.classList.add('modal-open'); void m.offsetWidth;
  bg.classList.replace('opacity-0', 'opacity-100'); c.classList.add('open');
}
function closeSettings(){
  const bg = $('settingsModalBg'), c = $('settingsModalContent');
  c.classList.remove('open'); bg.classList.replace('opacity-100', 'opacity-0');
  setTimeout(() => {
    $('settingsModal').classList.add('hidden');
    document.body.classList.remove('modal-open');
  }, 300);
}

/* ============================================================
   初期化
============================================================ */
function initializeApp(){
  if (state.initialized) return;
  state.initialized = true;
  speech.init();
  setupAuth();

  const applySpeed = (val, update) => {
    const n = Math.max(0.7, Math.min(1.8, parseFloat(val) || 1.0));
    state.speed = n;
    $('globalSpeed').value = n;
    $('globalSpeedVal').innerText = n.toFixed(1) + 'x';
    if (update){
      appSettings.defaultSpeed = n;
      saveSettings(appSettings);
      if (document.activeElement !== $('settingSpeed')){
        $('settingSpeed').value = n;
        $('settingSpeedVal').innerText = n.toFixed(1) + 'x';
      }
    }
  };
  applySpeed(appSettings.defaultSpeed || 1.0, false);

  $('globalSpeed').addEventListener('input', e => applySpeed(e.target.value, true));
  $('settingsBtn').addEventListener('click', openSettings);
  $('closeSettingsBtn').addEventListener('click', closeSettings);
  $('settingsModalBg').addEventListener('click', closeSettings);
  $('settingSpeed').addEventListener('input', e => {
    $('settingSpeedVal').innerText = parseFloat(e.target.value).toFixed(1) + 'x';
  });
  $('saveSettingsBtn').addEventListener('click', () => {
    appSettings.autoLogin = $('settingAutoLogin').checked;
    appSettings.defaultSpeed = parseFloat($('settingSpeed').value) || 1.0;
    saveSettings(appSettings);
    applySpeed(appSettings.defaultSpeed, false);
    if (!appSettings.autoLogin){
      try {
        localStorage.removeItem('n_user_id');
        localStorage.removeItem('n_user_mode');
      } catch(e){}
    }
    closeSettings();
  });

  $('homeBtn').addEventListener('click', () => { if (state.data) resetToStart(); });
  $('homeFab').addEventListener('click', resetToStart);

  $('startTestBtn').addEventListener('click', () => {
    if (state.isStarting) return;
    speech.warmup();
    const btn = $('startTestBtn');
    if (btn.classList.contains('opacity-50')) return;

    let mode = null;
    try { mode = localStorage.getItem('n_user_mode'); } catch(e){}

    const orig = btn.innerHTML;
    state.isStarting = true;
    btn.innerHTML = '...';
    btn.classList.add('opacity-80', 'cursor-not-allowed', 'pointer-events-none');

    const done = () => {
      state.isStarting = false;
      btn.innerHTML = orig;
      btn.classList.remove('opacity-80', 'cursor-not-allowed', 'pointer-events-none');
    };

    // Validate before taking a local credit so malformed data never consumes one.
    try{parseNFormat($('dataInput').value);}catch(e){done();showModal('データエラー','問題データを解読できません。入力形式を確認してください。',false);return;}
    if(mode==='guest'){
      const today=localDateKey();
      let c=0,date='';
      try{c=parseInt(localStorage.getItem('n_guest_count')||'0',10)||0;date=localStorage.getItem('n_guest_date')||'';}catch(e){}
      if(date!==today)c=0;
      if(c>=2){done();showModal('制限到達','ゲスト利用は1日2回までです。',false);return;}
      try{localStorage.setItem('n_guest_date',today);localStorage.setItem('n_guest_count',String(c+1));}catch(e){}
      currentAccount={id:'',plan:'GUEST',isPro:false,credits:2,remaining:Math.max(0,1-c),mode:'guest'};
      $('creditDisplay').innerText=Math.max(0,1-c)+'回';done();startTest();
    }else if(currentAccount && currentAccount.mode==='user'){
      if(!currentAccount.isPro && Number(currentAccount.remaining)<=0){done();showModal('クレジット不足','残りクレジットがありません。管理者にCSVのCredits欄を更新してもらってください。',false);return;}
      if(!currentAccount.isPro){currentAccount.remaining=Math.max(0,Number(currentAccount.remaining)-1);writeRemainingCredits();}
      $('creditDisplay').innerText=displayCredits();persistOfflineAccount();done();startTest();
    }else{
      done();showModal('ログインしてください','有効なIDでログインするか、ゲストとして試してください。',false);
    }
  });

  $('pasteBtn').addEventListener('click', async () => {
    try {
      $('dataInput').value = await navigator.clipboard.readText();
      validateInput();
    } catch(e){
      showModal('通知', 'クリップボードの読み取りに失敗しました。', false);
    }
  });

  $('dataInput').addEventListener('input', validateInput);
  $('prevQBtn').addEventListener('click', () => navigate(-1));
  $('nextQBtn').addEventListener('click', () => navigate(1));
  $('submitTestBtn').addEventListener('click', confirmSubmit);
  $('toggleDoubtBtn').addEventListener('click', toggleDoubt);
  $('masterPlayBtn').addEventListener('click', () => {
    try { speech.warmup(); } catch(e){}
    triggerSequence();
  });
  $('closeReviewBtn').addEventListener('click', closeReviewModal);
  $('reviewPlayAllBtn').addEventListener('click', () => { speech.warmup(); playReviewAll(); });
  $('returnTopBtn').addEventListener('click', resetToStart);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden){
      invalidatePlayback();
      state.seq.isPlaying = false;
      state.review.isPlaying = false;
    }
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeApp);
else initializeApp();

/* ============================================================
   入力検証・テスト開始
============================================================ */
function validateInput(){
  const v = $('dataInput').value.trim();
  const b = $('startTestBtn');
  if (v.length > 10) b.classList.remove('opacity-50', 'cursor-not-allowed');
  else b.classList.add('opacity-50', 'cursor-not-allowed');
}

async function startTest(){
  if ($('startTestBtn').classList.contains('opacity-50')) return;
  try { state.data = parseNFormat($('dataInput').value); }
  catch(e){
    showModal('データエラー', '解読失敗。正しいデータか確認してください。', false);
    return;
  }
  invalidatePlayback();

  speech.resetVoiceMap();
  const speakers = collectSpeakersFromAllData();
  speech.buildVoiceMap(speakers);
  // Voice selection is entirely local; no server or API calls.

  $('viewStart').classList.add('hidden');
  const ve = $('viewExam');
  ve.classList.remove('hidden'); ve.classList.add('flex');
  $('examTitleDisplay').innerText = state.data.title;

  state.data.questions.forEach(q => {
    state.answers[q.id] = q.type === 'sort' ? [] : null;
    state.doubts[q.id] = false;
  });
  state.currentQIdx = 0;
  renderQuestion();

  const fab = $('homeFab');
  fab.classList.remove('hidden'); fab.style.display = 'flex';
  window.scrollTo({ top:0, behavior:'smooth' });
}

/* ============================================================
   問題描画
============================================================ */
function renderQuestion(){
  const q = state.data.questions[state.currentQIdx];
  if (!q) return;

  $('questionCounter').innerText = (state.currentQIdx + 1) + '/' + state.data.questions.length;
  $('prevQBtn').disabled = state.currentQIdx === 0;

  if (state.currentQIdx === state.data.questions.length - 1){
    $('nextQBtn').classList.add('hidden');
    $('submitTestBtn').classList.remove('hidden');
  } else {
    $('nextQBtn').classList.remove('hidden');
    $('submitTestBtn').classList.add('hidden');
  }

  const db = $('toggleDoubtBtn');
  if (state.doubts[q.id]){
    db.classList.add('text-orange-500', 'bg-orange-50');
    db.classList.remove('text-slate-400', 'bg-white/60');
  } else {
    db.classList.remove('text-orange-500', 'bg-orange-50');
    db.classList.add('text-slate-400', 'bg-white/60');
  }

  const sv = $('svgContainer');
  if (q.svg && q.svg.length > 5){
    const safeSvg=sanitizeSvgMarkup(q.svg);
    sv.innerHTML = safeSvg || '';
    if(safeSvg) sv.classList.remove('hidden'); else { sv.textContent='図を安全に表示できませんでした。'; sv.classList.remove('hidden'); }
  } else { sv.innerHTML = ''; sv.classList.add('hidden'); }

  const qa = $('questionArea');
  qa.innerHTML = '';

  const inst = document.createElement('p');
  inst.className = 'text-slate-800 font-bold mb-5 text-base leading-relaxed';
  inst.innerText = q.instruction || '';
  qa.appendChild(inst);

  if (q.table && q.table.length){
    const w = document.createElement('div');
    w.innerHTML = renderTableHTML(q.table);
    qa.appendChild(w);
  }

  if (q.type === 'choice'){
    const od = document.createElement('div');
    od.className = 'space-y-3';
    q.options.forEach((opt, idx) => {
      const ck = state.answers[q.id] === idx;
      const lb = document.createElement('label');
      lb.className = 'block p-4 rounded-[18px] cursor-pointer border shadow-sm spring '
        + (ck ? 'bg-blue-50 border-blue-400' : 'bg-white/80 border-white');
      lb.innerHTML = '<div class="flex items-center pointer-events-none">'
        + '<div class="w-5 h-5 rounded-full border-2 mr-4 flex items-center justify-center flex-shrink-0 '
        + (ck ? 'border-blue-600' : 'border-slate-300') + '">'
        + (ck ? '<div class="w-2.5 h-2.5 bg-blue-600 rounded-full"></div>' : '') + '</div>'
        + '<span class="font-bold ' + (ck ? 'text-blue-900' : 'text-slate-700') + '">'
        + escapeHtml(opt) + '</span></div>';
      lb.addEventListener('click', () => {
        state.answers[q.id] = idx;
        renderQuestion();
      });
      od.appendChild(lb);
    });
    qa.appendChild(od);
  } else if (q.type === 'sort'){
    renderSortUI(q, qa);
  }
}

function renderSortUI(q, container){
  const arr = state.answers[q.id] || [];
  const w = document.createElement('div');
  w.className = 'bg-white/80 rounded-[20px] border border-white/80 overflow-hidden shadow-sm';

  const slot = document.createElement('div');
  slot.className = 'min-h-[80px] p-4 bg-white/40 border-b border-white/60 flex flex-wrap gap-2 items-center';
  if (!arr.length){
    slot.innerHTML = '<span class="text-slate-400 font-medium mx-auto text-sm">下の単語をタップして並べてください</span>';
  }
  arr.forEach((wi, pos) => {
    const b = document.createElement('button');
    b.className = 'px-4 py-2 bg-blue-600 text-white font-bold rounded-lg shadow-sm spring';
    b.textContent = q.options[wi];
    b.onclick = () => { arr.splice(pos, 1); renderQuestion(); };
    slot.appendChild(b);
  });

  const pool = document.createElement('div');
  pool.className = 'p-4 flex flex-wrap gap-2.5';
  q.options.forEach((wd, idx) => {
    if (!arr.includes(idx)){
      const b = document.createElement('button');
      b.className = 'px-4 py-2 bg-white border border-slate-200 text-slate-700 font-bold rounded-lg shadow-sm spring';
      b.textContent = wd;
      b.onclick = () => { arr.push(idx); renderQuestion(); };
      pool.appendChild(b);
    }
  });

  w.appendChild(slot);
  w.appendChild(pool);
  container.appendChild(w);
}

function toggleDoubt(){
  if (!state.data) return;
  const id = state.data.questions[state.currentQIdx].id;
  state.doubts[id] = !state.doubts[id];
  renderQuestion();
}

function navigate(d){
  stopSequence();
  state.currentQIdx += d;
  renderQuestion();
}

function resetToStart(){
  stopSequence();
  state.data = null; state.currentQIdx = 0; state.answers = {}; state.doubts = {};
  $('viewResult').classList.add('hidden');
  $('viewExam').classList.add('hidden'); $('viewExam').classList.remove('flex');
  $('viewStart').classList.remove('hidden');
  $('dataInput').value = '';
  validateInput();
  const fab = $('homeFab');
  fab.classList.add('hidden'); fab.style.display = 'none';
  window.scrollTo({ top:0, behavior:'smooth' });
}

/* ============================================================
   シーケンサ
============================================================ */
function triggerSequence(){ if (state.seq.isPlaying) stopSequence(); else startSequence(); }
function stopSequence(){
  invalidatePlayback();
  state.seq.isPlaying = false;
  const btn = $('masterPlayBtn');
  if (btn) btn.innerHTML = '<span class="pointer-events-none">音声を再生</span>';
  $('sequencerState').innerText = 'STANDBY';
  $('sequencerMessage').innerText = '▶️ 再生をタップして開始';
  $('sequencerProgress').style.width = '0%';
}

async function startSequence(){
  if (!state.data || !state.data.questions[state.currentQIdx]) return;
  const token = ++state.playToken;
  state.seq.isPlaying = true;
  const q = state.data.questions[state.currentQIdx];

  // 話者が増えていれば voiceMap を補完
  speech.buildVoiceMap(collectSpeakersFromQuestion(q));
  // Voice selection is entirely local; the browser supplies the available voices.

  const btn = $('masterPlayBtn');
  btn.innerHTML = '<span class="pointer-events-none">停止</span>';

  const setMsg = (s, m) => {
    if (isPlaybackActive(token)){
      $('sequencerState').innerText = s;
      $('sequencerMessage').innerText = m;
    }
  };
  const setProg = p => {
    if (isPlaybackActive(token)) $('sequencerProgress').style.width = p + '%';
  };

  try {
    setProg(5); setMsg('ANNOUNCEMENT', '問題の指示を読み上げています...');
    if (!(await speech.speak(q.instruction, 'JA', token))){ setMsg('AUDIO ERROR','音声を開始できません。もう一度タップしてください。'); return; }
    if (!isPlaybackActive(token)) return;
    await sleep(900, token);
    if (!isPlaybackActive(token)) return;

    for (let r = 1; r <= q.repeats; r++){
      if (!isPlaybackActive(token)) return;
      setProg(15); setMsg('PLAYING (' + r + '/' + q.repeats + ')', '対話を再生中...');
      for (let i = 0; i < q.dialogue.length; i++){
        if (!isPlaybackActive(token)) return;
        if (!(await speech.speak(q.dialogue[i].text, q.dialogue[i].speaker, token))){ setMsg('AUDIO ERROR','音声の再生に失敗しました。再生ボタンでもう一度お試しください。'); return; }
        if (!isPlaybackActive(token)) return;
        await sleep(250, token);
      }
      setProg(60); setMsg('PAUSE', '...');
      await sleep(1500, token);
      if (!isPlaybackActive(token)) return;

      setProg(75); setMsg('QUESTION (' + r + '/' + q.repeats + ')', '質問を再生中...');
      if (!(await speech.speak(q.question.text, 'N', token))){ setMsg('AUDIO ERROR','質問音声の再生に失敗しました。もう一度お試しください。'); return; }
      if (!isPlaybackActive(token)) return;

      if (r < q.repeats){
        setProg(100); setMsg('PAUSE', '次の再生まで...');
        await sleep(3500, token);
        if (!isPlaybackActive(token)) return;
      }
    }
    setProg(100); setMsg('FINISHED', '解答を記入してください');
  } catch(e){
    setMsg('ERROR','再生中にエラーが発生しました。再生ボタンでもう一度お試しください。');
  } finally {
    if (isPlaybackActive(token)){
      btn.innerHTML = '<span class="pointer-events-none">もう一度聴く</span>';
      state.seq.isPlaying = false;
    }
  }
}

/* ============================================================
   採点
============================================================ */
function confirmSubmit(){
  const un = state.data.questions.filter(q => {
    if (q.type === 'choice') return state.answers[q.id] === null;
    return (state.answers[q.id] || []).length === 0;
  }).length;
  if (un > 0) showModal('確認', '未解答が ' + un + ' 問あります。採点しますか？', true, submitTest);
  else submitTest();
}

function submitTest(){
  stopSequence();
  $('viewExam').classList.add('hidden');
  $('viewExam').classList.remove('flex');
  $('viewResult').classList.remove('hidden');
  window.scrollTo({ top:0, behavior:'smooth' });

  let cc = 0;
  const list = $('resultList');
  list.innerHTML = '';

  state.data.questions.forEach((q, idx) => {
    const a = state.answers[q.id];
    const ok = q.type === 'choice'
      ? a === q.answer
      : JSON.stringify(a) === JSON.stringify(q.answer);
    if (ok) cc++;

    const li = document.createElement('li');
    li.className = 'p-4 cursor-pointer flex items-center justify-between spring '
      + (ok ? 'bg-white/80' : 'bg-red-50/60');
    li.onclick = () => openReviewModal(idx, ok);
    li.innerHTML = '<div class="flex items-center">'
      + '<span class="' + (ok ? 'text-[#34c759]' : 'text-[#ff3b30]') + ' font-black text-xl w-8">'
      + (ok ? '◯' : '✕') + '</span>'
      + '<span class="font-bold text-slate-800">Question ' + (idx + 1) + '</span>'
      + '</div><span class="text-slate-400">›</span>';
    list.appendChild(li);
  });

  $('scoreDisplay').innerText = Math.round((cc / (state.data.questions.length || 1)) * 100);
}

/* ============================================================
   復習モーダル
============================================================ */
let currentReviewQ = null;

function openReviewModal(idx, ok){
  invalidatePlayback();
  state.review.isPlaying = false;
  currentReviewQ = state.data.questions[idx];

  // 復習対象問題の話者で voiceMap を補完
  speech.buildVoiceMap(collectSpeakersFromQuestion(currentReviewQ));
  // Voice selection is entirely local.

  const m = $('reviewModal'), bg = $('reviewModalBg'), c = $('reviewModalContent');
  m.classList.remove('hidden');
  document.body.classList.add('modal-open');
  void m.offsetWidth;
  bg.classList.replace('opacity-0', 'opacity-100');
  c.classList.add('open');

  $('reviewModalTitle').innerText = 'Question ' + (idx + 1);
  $('reviewModalIcon').innerHTML = ok
    ? '<span class="text-[#34c759]">◯</span>'
    : '<span class="text-[#ff3b30]">✕</span>';

  const area = $('reviewScriptArea');
  area.innerHTML = '';

  const cs = currentReviewQ.type === 'choice'
    ? currentReviewQ.options[currentReviewQ.answer]
    : currentReviewQ.answer.map(i => currentReviewQ.options[i]).join(' ');
  let us = '未解答';
  if (currentReviewQ.type === 'choice'){
    us = state.answers[currentReviewQ.id] !== null
      ? currentReviewQ.options[state.answers[currentReviewQ.id]]
      : '未解答';
  } else {
    const ar = state.answers[currentReviewQ.id] || [];
    us = ar.length ? ar.map(i => currentReviewQ.options[i]).join(' ') : '未解答';
  }

  const ed = document.createElement('div');
  ed.className = 'bg-slate-50 border border-slate-200 rounded-[20px] p-5 mb-6';
  ed.innerHTML =
    '<div class="mb-4">'
    + '<span class="text-[10px] font-black text-slate-400 block mb-1">Correct Answer</span>'
    + '<div class="font-bold text-[#34c759] bg-green-50 px-4 py-2.5 rounded-xl border border-green-200">'
    + escapeHtml(cs) + '</div></div>'
    + '<div class="mb-4">'
    + '<span class="text-[10px] font-black text-slate-400 block mb-1">Your Answer</span>'
    + '<div class="font-bold px-4 py-2.5 border rounded-xl '
    + (!ok ? 'bg-red-50 text-[#ff3b30] border-red-200' : 'text-slate-700 bg-white border-slate-200')
    + '">' + escapeHtml(us) + '</div></div>'
    + '<div class="mt-4 pt-4 border-t border-slate-200">'
    + '<span class="text-[10px] font-black text-slate-400 block mb-1.5">Explanation</span>'
    + '<p class="text-sm text-slate-700 leading-relaxed">'
    + escapeHtml(currentReviewQ.explanation) + '</p></div>';
  area.appendChild(ed);

  currentReviewQ.dialogue.forEach((d, i) => {
    area.appendChild(createScriptLine(d.speaker, d.text, d.ja, 'dia-' + i));
  });
  area.appendChild(createScriptLine('Q', currentReviewQ.question.text, currentReviewQ.question.ja, 'qt'));
}

function createScriptLine(spk, en, ja, id){
  const d = document.createElement('div');
  d.className = 'mb-3 flex items-start';
  d.id = 'script-' + id;

  const b = document.createElement('div');
  b.className = 'w-9 h-9 rounded-full bg-blue-50 text-blue-600 font-bold flex items-center justify-center shrink-0 mt-1 mr-3 border border-blue-100 text-sm';
  b.innerText = spk;

  const c = document.createElement('div');
  c.className = 'flex-grow p-3.5 rounded-[16px] bg-slate-50 border border-slate-100 spring';
  c.onclick = () => playSingleLine(spk, en, d);
  c.innerHTML = '<p class="font-bold text-slate-800 text-base mb-1">'
    + escapeHtml(en) + '</p>'
    + '<p class="text-xs text-slate-500">' + escapeHtml(ja || '') + '</p>';

  d.appendChild(b);
  d.appendChild(c);
  return d;
}

async function playSingleLine(spk, text, el){
  speech.warmup();
  if (!speech.voiceMap || !speech.voiceMap[spk]) {
    speech.buildVoiceMap([spk]);
  }
  // No external voice service is used.
  const token = ++state.playToken;
  state.review.isPlaying = false;
  $('reviewPlayAllBtn').innerHTML = '<span class="pointer-events-none">通して聴く</span>';
  document.querySelectorAll('[id^="script-"] > div:nth-child(2)').forEach(x => {
    x.classList.remove('bg-amber-50', 'border-amber-300');
  });
  const cd = el.querySelector('div:nth-child(2)');
  if (cd) cd.classList.add('bg-amber-50', 'border-amber-300');
  const spoken=await speech.speak(text, spk, token);
  if (!isPlaybackActive(token)) return;
  if (!spoken) showModal('音声を再生できません','このブラウザーで利用できる読み上げ音声を開始できませんでした。端末の音声設定を確認し、ページを再読み込みしてから再試行してください。',false);
  if (cd) cd.classList.remove('bg-amber-50', 'border-amber-300');
}

async function playReviewAll(){
  const btn = $('reviewPlayAllBtn');
  if (state.review.isPlaying){
    invalidatePlayback();
    state.review.isPlaying = false;
    btn.innerHTML = '<span class="pointer-events-none">通して聴く</span>';
    document.querySelectorAll('[id^="script-"] > div:nth-child(2)').forEach(x => {
      x.classList.remove('bg-amber-50', 'border-amber-300');
    });
    return;
  }

  if (currentReviewQ){
    speech.buildVoiceMap(collectSpeakersFromQuestion(currentReviewQ));
  }

  const token = ++state.playToken;
  state.review.isPlaying = true;
  btn.innerHTML = '<span class="pointer-events-none">停止</span>';
  const q = currentReviewQ;

  try {
    for (let i = 0; i < q.dialogue.length; i++){
      if (!isPlaybackActive(token)) break;
      const el = document.getElementById('script-dia-' + i);
      document.querySelectorAll('[id^="script-"] > div:nth-child(2)').forEach(x => {
        x.classList.remove('bg-amber-50', 'border-amber-300');
      });
      if (el && el.children[1]) el.children[1].classList.add('bg-amber-50', 'border-amber-300');
      if (!(await speech.speak(q.dialogue[i].text, q.dialogue[i].speaker, token))){ showModal('音声の再生エラー','この端末で音声を開始できませんでした。ページを再読み込みして再試行してください。',false); return; }
      if (!isPlaybackActive(token)) return;
      await sleep(300, token);
    }
    if (!isPlaybackActive(token)) return;
    await sleep(1000, token);
    if (!isPlaybackActive(token)) return;

    const el = document.getElementById('script-qt');
    document.querySelectorAll('[id^="script-"] > div:nth-child(2)').forEach(x => {
      x.classList.remove('bg-amber-50', 'border-amber-300');
    });
    if (el && el.children[1]) el.children[1].classList.add('bg-amber-50', 'border-amber-300');
    if (!(await speech.speak(q.question.text, 'Q', token))) showModal('音声の再生エラー','この端末で音声を開始できませんでした。ページを再読み込みして再試行してください。',false);
  } finally {
    if (isPlaybackActive(token)){
      state.review.isPlaying = false;
      btn.innerHTML = '<span class="pointer-events-none">通して聴く</span>';
      document.querySelectorAll('[id^="script-"] > div:nth-child(2)').forEach(x => {
        x.classList.remove('bg-amber-50', 'border-amber-300');
      });
    }
  }
}

function closeReviewModal(){
  invalidatePlayback();
  state.review.isPlaying = false;
  state.review.active = false;
  const bg = $('reviewModalBg'), c = $('reviewModalContent');
  c.classList.remove('open');
  bg.classList.replace('opacity-100', 'opacity-0');
  setTimeout(() => {
    $('reviewModal').classList.add('hidden');
    document.body.classList.remove('modal-open');
  }, 300);
}


/* PWA shell only; user CSV is deliberately never precached. */
window.addEventListener('online',()=>document.documentElement.classList.remove('is-offline'));
window.addEventListener('offline',()=>document.documentElement.classList.add('is-offline'));
if(!navigator.onLine) document.documentElement.classList.add('is-offline');
if('serviceWorker' in navigator){
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js',{scope:'./'}).catch(()=>{}));
}
window.addEventListener('pagehide',()=>{try{speech.cancelPlayback();}catch(e){}});

