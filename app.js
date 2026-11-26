/* Daily Verse Alarm — installable app
   Verses come from monthly "verse packs" in /packs (see README.md).
   packs/index.json lists every pack; each pack folder holds pack.json,
   its images, and one narrated MP3 per verse. */
(function(){
'use strict';

var APP_VERSION='1.2.0';
var $=function(id){return document.getElementById(id);};
var DAY=86400000;
function ico(n){ return '<svg class="ico" aria-hidden="true"><use href="#i-'+n+'"/></svg>'; }

/* ---------- Storage (safe in private mode) ---------- */
var store={
  get:function(k,d){ try{ var v=localStorage.getItem('dva:'+k); return v===null?d:JSON.parse(v); }catch(e){ return d; } },
  set:function(k,v){ try{ localStorage.setItem('dva:'+k,JSON.stringify(v)); }catch(e){} }
};

/* ---------- Dates ---------- */
function parseDay(s){ var p=s.split('-'); return new Date(+p[0],+p[1]-1,+p[2]); }
function dayStart(d){ return new Date(d.getFullYear(),d.getMonth(),d.getDate()); }
function daysBetween(a,b){ return Math.round((dayStart(b)-dayStart(a))/DAY); }
function fmtTime(d){ return d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}); }
function fmtDate(d){ return d.toLocaleDateString([], {weekday:'long',month:'long',day:'numeric'}); }

/* ---------- Packs ---------- */
var PACKS=[];          // loaded pack objects, sorted by start
function packFor(date){
  var d=dayStart(date), best=null;
  for(var i=0;i<PACKS.length;i++){
    var p=PACKS[i], off=daysBetween(p._start,d);
    if(off>=0 && off<p.verses.length) return p;      // date is inside this pack
    if(off>=0) best=p;                                 // most recent pack that has started
  }
  return best||PACKS[0];
}
function verseFor(date){
  var p=packFor(date), n=p.verses.length;
  var idx=((daysBetween(p._start,date)%n)+n)%n;       // wraps if no newer pack is out yet
  return p.verses[idx];
}
function audioSrc(v){
  var nn=(v._i+1<10?'0':'')+(v._i+1);
  var path=v.audio || v._pack.audio.replace('{nn}',nn).replace('{n}',String(v._i+1));
  return 'packs/'+v._pack.id+'/'+path;
}
function loadPacks(){
  return fetch('packs/index.json',{cache:'no-cache'}).then(function(r){return r.json();}).then(function(idx){
    return Promise.all(idx.packs.map(function(e){
      return fetch('packs/'+e.id+'/pack.json',{cache:'no-cache'}).then(function(r){return r.json();}).catch(function(){return null;});
    }));
  }).then(function(list){
    PACKS=list.filter(Boolean).map(function(p){
      p._start=parseDay(p.start);
      p.audio=p.audio||'audio/verse-{nn}.mp3';
      p.verses.forEach(function(v,i){ v._i=i; v._pack=p; });
      return p;
    }).sort(function(a,b){return a._start-b._start;});
    if(!PACKS.length) throw new Error('No verse packs');
  });
}

/* ---------- Toast ---------- */
var toastT;
function toast(msg){ var t=$('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(function(){t.classList.remove('show');},2600); }

/* ---------- Audio ---------- */
var verseAudio=$('verseAudio'), speaking=false;
var libPlayingBtn=null, libPlayingV=null;
function setLibBtn(btn,on){ btn.innerHTML=ico(on?'stop':'play'); btn.setAttribute('aria-label',on?'Stop this verse':'Hear this verse'); btn.classList.toggle('playing',on); }
function resetLibBtn(){ if(libPlayingBtn){ setLibBtn(libPlayingBtn,false); libPlayingBtn=null; libPlayingV=null; } }
/* Wake-up sounds. `lead` = seconds before the verse starts (the sound
   fades out underneath). Add a sound: drop an MP3 in sounds/, add a line
   here and in SHELL_FILES in sw.js. */
var SOUNDS=[
  {id:'chime',      label:'Gentle Dawn Chime — soft & warm',           file:'sounds/chime.mp3',      lead:4.2},
  {id:'dulcimer',   label:'Mountain Dulcimer — Amazing Grace',          file:'sounds/dulcimer.mp3',   lead:10.4},
  {id:'musicbox',   label:'Music Box — Silent Night',                   file:'sounds/musicbox.mp3',   lead:7.3},
  {id:'harp',       label:'Morning Harp — rising',                      file:'sounds/harp.mp3',       lead:7.6},
  {id:'windchimes', label:'Porch Wind Chimes — soft & airy',            file:'sounds/windchimes.mp3', lead:6.6},
  {id:'bowl',       label:'Singing Bowl — deep & calm',                 file:'sounds/bowl.mp3',       lead:7.4},
  {id:'bells',      label:'Christmas Bells — bright & clear',           file:'sounds/bells.mp3',      lead:4.2},
  {id:'none',       label:'No sound — verse only',                      file:null,                    lead:0.6}
];
function soundById(id){ for(var i=0;i<SOUNDS.length;i++) if(SOUNDS[i].id===id) return SOUNDS[i]; return SOUNDS[0]; }
var chimeAudio=$('chimeAudio'), fadeTimer=null;
function stopChimes(){ clearInterval(fadeTimer); chimeAudio.pause(); try{chimeAudio.currentTime=0;}catch(e){} chimeAudio.volume=0.9; }
function fadeChime(ms,then){
  clearInterval(fadeTimer);
  if(chimeAudio.paused){ then(); return; }
  var start=chimeAudio.volume, steps=Math.max(1,Math.round(ms/50)), k=0;
  fadeTimer=setInterval(function(){
    k++; try{ chimeAudio.volume=Math.max(0,start*(1-k/steps)); }catch(e){}
    if(k>=steps){ clearInterval(fadeTimer); then(); }
  },50);
}
function stopSpeech(){ try{ if(window.speechSynthesis) speechSynthesis.cancel(); }catch(e){} }

/* Spoken fallback: used only if a verse's narrated MP3 is missing,
   so the alarm never goes silent. */
function speakWithDevice(v,done){
  if(!window.speechSynthesis){ done(); return; }
  var ref=v.r.replace(/(\d+):(\d+)[–-](\d+)/,'$1, verses $2 through $3').replace(/(\d+):(\d+)/,'$1, verse $2');
  var u=new SpeechSynthesisUtterance(v.t+' … '+ref);
  u.rate=0.9; u.onend=done; u.onerror=done;
  speechSynthesis.speak(u);
}
function speakVerse(v,done){
  done=done||function(){};
  stopChimes(); stopSpeech(); resetLibBtn();
  var finish=function(){ speaking=false; resetLibBtn(); $('ringStatus').textContent='That\'s today\'s verse. Rise and shine — He is with you today.'; done(); };
  var src=audioSrc(v);
  if(verseAudio.getAttribute('src')!==src) verseAudio.src=src;
  try{ verseAudio.currentTime=0; }catch(e){}
  speaking=true;
  verseAudio.onended=finish;
  verseAudio.onerror=function(){ speakWithDevice(v,finish); };
  var p=verseAudio.play();
  if(p&&p.catch) p.catch(function(err){
    if(err && err.name==='NotAllowedError'){ speaking=false; resetLibBtn(); toast('Tap “Hear verse again” — your phone blocked sound.'); done(); }
    else speakWithDevice(v,finish);
  });
}
function stopAllAudio(){ stopChimes(); stopSpeech(); verseAudio.pause(); try{verseAudio.currentTime=0;}catch(e){} speaking=false; resetLibBtn(); }
function playSound(kind){
  stopAllAudio();
  if(kind==='none') return;
  var snd=soundById(kind), a=chimeAudio;
  if(!snd.file) return;
  if(a.getAttribute('src')!==snd.file) a.src=snd.file;
  try{a.currentTime=0;}catch(e){} a.volume=0.9;
  var p=a.play(); if(p&&p.catch) p.catch(fallbackChime);
}
var actx=null;
function fallbackChime(){
  try{
    actx=actx||new (window.AudioContext||window.webkitAudioContext)();
    if(actx.state==='suspended') actx.resume();
    [523.25,659.25,783.99,1046.5].forEach(function(f,i){
      var o=actx.createOscillator(), g=actx.createGain(); o.type='sine'; o.frequency.value=f;
      var t=actx.currentTime+i*0.55; g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(0.22,t+0.08); g.gain.exponentialRampToValueAtTime(0.001,t+2.4);
      o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t+2.5);
    });
  }catch(e){}
}
/* Phones only let a page make sound after a tap. Each tap "unlocks" the
   audio players so the morning alarm can play on its own. */
var unlocked=false;
function unlockAudio(){
  if(unlocked) return; unlocked=true;
  [chimeAudio,verseAudio].forEach(function(a){
    if(!a.getAttribute('src')) return;
    a.muted=true;
    var p=a.play(); var undo=function(){ a.pause(); try{a.currentTime=0;}catch(e){} a.muted=false; };
    if(p&&p.then) p.then(undo,function(){ a.muted=false; unlocked=false; }); else undo();
  });
  try{ actx=actx||new (window.AudioContext||window.webkitAudioContext)(); if(actx.state==='suspended') actx.resume(); }catch(e){}
}
document.addEventListener('pointerdown',unlockAudio,{capture:true});

/* ---------- Settings ---------- */
var S=store.get('settings',{time:'06:30',on:true,days:[0,1,2,3,4,5],sound:'chime',snooze:9});
function saveSettings(){ store.set('settings',S); }
function applySettingsToUI(){
  $('alarmTime').value=S.time;
  setToggle(S.on);
  document.querySelectorAll('.day').forEach(function(b){ b.classList.toggle('on',S.days.indexOf(+b.dataset.d)>=0); });
  var sel=$('soundSel'); sel.innerHTML='';
  SOUNDS.forEach(function(x){ var o=document.createElement('option'); o.value=x.id; o.textContent=x.label; sel.appendChild(o); });
  S.sound=soundById(S.sound).id; sel.value=S.sound;
  if(soundById(S.sound).file) chimeAudio.src=soundById(S.sound).file;
  $('snoozeSel').value=String(S.snooze);
  $('snoozeLabel').textContent=S.snooze;
}
function setToggle(v){ var b=$('alarmToggle'); b.classList.toggle('on',v); b.setAttribute('aria-pressed',v?'true':'false'); }

/* ---------- Alarm scheduling ---------- */
var nextRing=null, snoozeAt=null;
var lastFired=store.get('lastFired',0);
function computeNextRing(){
  if(!S.on || !S.days.length) return null;
  var p=S.time.split(':'), h=+p[0], m=+p[1], now=new Date();
  for(var add=0;add<8;add++){
    var d=new Date(now.getFullYear(),now.getMonth(),now.getDate()+add,h,m,0,0);
    if(d>now && S.days.indexOf(d.getDay())>=0) return d;
  }
  return null;
}
function refreshSchedule(){ nextRing=computeNextRing(); updateStatus(); }
function whenWord(d){
  var t=dayStart(new Date());
  var diff=daysBetween(t,d);
  return diff===0?'today':diff===1?'tomorrow':d.toLocaleDateString([], {weekday:'long'});
}
function updateStatus(){
  var el=$('alarmStatus');
  if(!S.on){ el.innerHTML=ico('pause')+' <strong>Alarm is OFF</strong> — flip the switch when you\'re ready for tomorrow morning.'; return; }
  if(!S.days.length){ el.innerHTML=ico('alert')+' <strong>Pick at least one day</strong> — tap a day above so the alarm knows when to ring.'; return; }
  if(!nextRing) return;
  el.innerHTML=ico('bell')+' <strong>Alarm is ON</strong> — next ring <b>'+whenWord(nextRing)+' at '+fmtTime(nextRing)+'</b> with <b>'+verseFor(nextRing).r+'</b>.';
}
/* Checked every second. Fires if the alarm time has passed within the last
   10 minutes (covers a phone that briefly slowed the page down), but never
   rings hours late after the phone was asleep. */
function checkAlarm(now){
  var due=null;
  if(snoozeAt && now>=snoozeAt){ due=snoozeAt; snoozeAt=null; }
  else if(nextRing && now>=nextRing){ due=nextRing; nextRing=computeNextRing(); updateStatus(); }
  if(!due) return;
  if(now-due>10*60000 || +due===lastFired) return;
  lastFired=+due; store.set('lastFired',lastFired);
  fireAlarm(verseFor(now));
}

/* ---------- Ringing ---------- */
var speakTimer=null;
function fireAlarm(v){
  exitBedside(true);
  $('ringText').textContent='“'+v.t+'”';
  $('ringRef').textContent=v.r;
  setAntiphon('ringAnt',v);
  $('ringLine').textContent=(seasonFor(v._pack,new Date())||{}).ringLine||'Rise, and give thanks.';
  $('ringTime').textContent=fmtTime(new Date());
  $('ringStatus').textContent='Playing your chime, then reading today\'s verse…';
  $('ringOverlay').classList.add('show');
  if(navigator.vibrate) navigator.vibrate([300,150,300,150,500]);
  clearTimeout(speakTimer);
  var snd=soundById(S.sound);
  playSound(snd.id);
  // Fade the sound out over the last second of its lead, then read the verse.
  speakTimer=setTimeout(function(){ fadeChime(900,function(){ speakVerse(v); }); }, Math.max(0,snd.lead*1000-900));
  holdWakeLock();
}
function closeRing(){ clearTimeout(speakTimer); stopAllAudio(); $('ringOverlay').classList.remove('show'); }

/* ---------- Bedside mode (screen stays awake) ---------- */
var wakeLock=null, inBedside=false;
function holdWakeLock(){
  if(!('wakeLock' in navigator)) return Promise.resolve(false);
  return navigator.wakeLock.request('screen').then(function(l){
    wakeLock=l; l.addEventListener('release',function(){ wakeLock=null; });
    return true;
  }).catch(function(){ return false; });
}
function enterBedside(){
  if(!S.on){ S.on=true; setToggle(true); saveSettings(); refreshSchedule(); }
  unlockAudio();
  // Prime the narrator player with tomorrow's verse while we still have a tap.
  if(nextRing){ var src=audioSrc(verseFor(nextRing)); verseAudio.src=src; verseAudio.load(); }
  inBedside=true;
  $('bedside').classList.add('show');
  holdWakeLock().then(function(ok){ $('bWarn').classList.toggle('show',!ok); });
  try{ if(document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function(){}); }catch(e){}
  tickBedside();
}
function exitBedside(keepLock){
  if(!inBedside) return;
  inBedside=false;
  $('bedside').classList.remove('show');
  try{ if(document.fullscreenElement) document.exitFullscreen(); }catch(e){}
  if(!keepLock && wakeLock){ wakeLock.release().catch(function(){}); wakeLock=null; }
}
function tickBedside(){
  if(!inBedside) return;
  var now=new Date();
  $('bClock').textContent=fmtTime(now);
  $('bNext').textContent=nextRing ? 'Alarm '+whenWord(nextRing)+' at '+fmtTime(nextRing)+' · '+verseFor(nextRing).r : 'No alarm set';
}
document.addEventListener('visibilitychange',function(){
  if(document.visibilityState==='visible'){
    if(inBedside && !wakeLock) holdWakeLock();
    refreshSchedule();
  }
});

/* ---------- Clock ---------- */
function tick(){
  var now=new Date();
  $('clockLine').textContent=fmtTime(now);
  $('dateLine').textContent=fmtDate(now);
  checkAlarm(now);
  tickBedside();
  if(dayStart(now)-renderedDay!==0) renderAll();   // midnight rollover
}

/* ---------- Rendering ---------- */
var offset=0, renderedDay=null, todayVerse=null;
function currentVerse(){
  if(offset===0) return todayVerse;
  var vs=todayVerse._pack.verses; return vs[(todayVerse._i+offset)%vs.length];
}
function setImg(id,src){ var el=$(id); if(src){ el.src=src; el.hidden=false; } else { el.hidden=true; } }
function renderPack(p){
  var base='packs/'+p.id+'/', im=p.images||{};
  setImg('heroImg',im.hero&&base+im.hero);
  setImg('overlayImg',(im.overlay||im.hero)&&base+(im.overlay||im.hero));
  setImg('photoImg',im.photo&&base+im.photo);
  setImg('sideImg',im.side&&base+im.side);
  $('packPill').textContent=p.pill||p.title;
  $('headline').textContent=p.headline||'Wake up to';
  $('headlineEm').textContent=p.headlineEm||'the Word.';
  $('packLead').textContent=p.lead||'';
  $('seasonKicker').textContent=p.seasonKicker||'The month ahead';
  $('seasonTitle').textContent=p.seasonTitle||p.title;
  $('seasonSub').textContent=p.seasonSub||'';
  $('librarySub').textContent=p.librarySub||'';
  $('searchInput').placeholder=p.searchHint||'Search verses…';
  $('packFooter').textContent=p.footer||p.title;
  $('packVersion').textContent='Pack: '+p.title+' · App v'+APP_VERSION;
  var pc=p.photoCaption||{}; $('photoTitle').textContent=pc.title||''; $('photoText').textContent=pc.text||'';
  var sv=p.sideVerse||{}; $('sideVerseT').textContent=sv.t?'“'+sv.t+'”':''; $('sideVerseR').textContent=sv.r?'— '+sv.r:'';
  document.title='Daily Verse Alarm — '+p.title;
}
function renderToday(){
  var v=currentVerse();
  $('todayText').textContent=v.t;   // no quote marks: the first letter is an illuminated drop cap
  setAntiphon('todayAnt',v);
  $('todayRef').textContent=v.r;
  $('todayLabel').textContent=offset===0?fmtDate(new Date()):'Another verse';
}
function renderPath(p){
  var row=$('seasonPath'); row.innerHTML='';
  var ms=p.milestones||[], today=dayStart(new Date()), current=-1;
  ms.forEach(function(m,i){ if(parseDay(m.date)<=today) current=i; });
  ms.forEach(function(m,i){
    var s=document.createElement('span'); if(i===current) s.className='now';
    var b=document.createElement('b'); b.textContent=m.label; s.appendChild(b);
    s.appendChild(document.createTextNode(' · '+m.name)); row.appendChild(s);
  });
}
function renderWeek(){
  var row=$('weekRow'); row.innerHTML='';
  for(var add=0;add<7;add++)(function(add){
    var d=new Date(); d.setDate(d.getDate()+add); var v=verseFor(d);
    var b=document.createElement('button'); b.className='daycard'+(add===0?' today':'');
    var h=document.createElement('b'); h.textContent=(add===0?'Today · ':'')+d.toLocaleDateString([], {weekday:'short',month:'short',day:'numeric'});
    var s=document.createElement('strong'); s.textContent=v.t.slice(0,72)+(v.t.length>72?'…':'');
    var r=document.createElement('span'); r.textContent=v.r+' · Hear it';
    b.appendChild(h);
    if(v.antiphon){ var an=document.createElement('i'); an.textContent=v.antiphon.t; b.appendChild(an); }
    b.appendChild(s); b.appendChild(r);
    b.addEventListener('click',function(){ speakVerse(v); toast(d.toLocaleDateString([], {weekday:'long'})+' — '+v.r); });
    row.appendChild(b);
  })(add);
}
function renderList(filter){
  var list=$('verseList'); list.innerHTML='';
  var q=(filter||'').toLowerCase(), shown=0;
  todayVerse._pack.verses.forEach(function(v){
    if(q && (v.t+' '+v.r+' '+(v.k||'')).toLowerCase().indexOf(q)<0) return;
    shown++;
    var row=document.createElement('div'); row.className='vrow';
    var btn=document.createElement('button'); btn.className='iconbtn'; btn.setAttribute('aria-label','Hear this verse'); btn.innerHTML=ico('play');
    var div=document.createElement('div');
    var bq=document.createElement('blockquote'); bq.textContent='“'+v.t+'”';
    var c=document.createElement('cite'); c.textContent=v.r;
    div.appendChild(bq); div.appendChild(c); row.appendChild(btn); row.appendChild(div);
    btn.addEventListener('click',function(){
      if(libPlayingV===v && speaking){ stopAllAudio(); toast('Verse stopped.'); return; }
      speakVerse(v); libPlayingBtn=btn; libPlayingV=v; setLibBtn(btn,true);
    });
    list.appendChild(row);
  });
  if(!shown) list.innerHTML='<p class="sub" style="padding:8px 2px">No verse matches that search.</p>';
}
/* ---------- Church year ----------
   pack.json "seasons": [{date, theme, pill?, headline?, headlineEm?, ringLine?}, …]
   The latest entry on or before today wins. theme = advent | gaudete | christmas
   (colours in app.css); packs without seasons keep the default palette. */
var THEME_COLOR={advent:'#2A1B35',gaudete:'#3B1E2A',christmas:'#2B2213'};
function seasonFor(p,date){
  var d=dayStart(date), hit=null;
  (p.seasons||[]).forEach(function(x){ if(parseDay(x.date)<=d) hit=x; });
  return hit;
}
function applySeason(p){
  var x=seasonFor(p,new Date()), root=document.documentElement;
  if(x&&x.theme) root.setAttribute('data-season',x.theme); else root.removeAttribute('data-season');
  var meta=document.querySelector('meta[name="theme-color"]');
  if(meta) meta.setAttribute('content',(x&&THEME_COLOR[x.theme])||'#16241B');
  if(x&&x.pill) $('packPill').textContent=x.pill;
  if(x&&x.headline) $('headline').textContent=x.headline;
  if(x&&x.headlineEm) $('headlineEm').textContent=x.headlineEm;
}
function setAntiphon(id,v){
  var el=$(id), a=v.antiphon;
  el.hidden=!a; if(!a) return;
  el.querySelector('b').textContent=a.t; el.querySelector('span').textContent=a.l||'';
}
/* Advent wreath: the first four milestones are the Sunday candles (the third is
   rose, for Gaudete), the fifth is the Christ candle. Turn on with "wreath": true. */
function renderWreath(p){
  var box=$('wreath'), ms=p.milestones||[];
  if(!p.wreath || ms.length<5){ box.hidden=true; return; }
  var today=dayStart(new Date()), lit=0;
  for(var i=0;i<4;i++) if(parseDay(ms[i].date)<=today) lit=i+1;
  var christ=parseDay(ms[4].date)<=today;
  var VIOLET='#5B3A73', ROSE='#C9789A', WHITE='#F7F1E3';
  // lighting order: front-left, back-left, back-right (rose), front-right
  var C=[{x:66,b:150,w:18,h:58,c:VIOLET},{x:122,b:126,w:16,h:50,c:VIOLET},{x:198,b:126,w:16,h:50,c:ROSE},{x:254,b:150,w:18,h:58,c:VIOLET}];
  var center={x:160,b:140,w:20,h:80,c:WHITE};
  function candle(k,on){
    var top=k.b-k.h, x=k.x, out='';
    if(on) out+='<circle cx="'+x+'" cy="'+(top-12)+'" r="24" fill="url(#wglow)"/>';
    out+='<rect x="'+(x-k.w/2)+'" y="'+top+'" width="'+k.w+'" height="'+k.h+'" rx="2.5" fill="'+k.c+'"/>'+
         '<rect x="'+(x-k.w/2+2.5)+'" y="'+(top+3)+'" width="3.5" height="'+(k.h-8)+'" rx="1.5" fill="#fff" opacity=".22"/>'+
         '<line x1="'+x+'" y1="'+top+'" x2="'+x+'" y2="'+(top-6)+'" stroke="#3B2A16" stroke-width="2" stroke-linecap="round"/>';
    if(on) out+='<path class="flame" d="M'+x+','+(top-28)+' C'+(x+7)+','+(top-18)+' '+(x+7)+','+(top-8)+' '+x+','+(top-4)+' C'+(x-7)+','+(top-8)+' '+(x-7)+','+(top-18)+' '+x+','+(top-28)+'Z" fill="url(#wflame)"/>';
    return out;
  }
  var svg='<svg viewBox="0 0 320 176" role="img" aria-label="Advent wreath: '+(christ?'all five candles lit':lit+' of 4 candles lit')+'">'+
    '<defs><radialGradient id="wglow"><stop offset="0" stop-color="#FFD88A" stop-opacity=".75"/><stop offset="1" stop-color="#FFD88A" stop-opacity="0"/></radialGradient>'+
    '<linearGradient id="wflame" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF6D6"/><stop offset=".55" stop-color="#FFC94D"/><stop offset="1" stop-color="#E8892A"/></linearGradient></defs>'+
    '<ellipse cx="160" cy="140" rx="122" ry="28" fill="none" stroke="#263D2B" stroke-width="24"/>'+
    '<ellipse cx="160" cy="140" rx="122" ry="28" fill="none" stroke="#3F6247" stroke-width="12" stroke-dasharray="4 6"/>'+
    '<ellipse cx="160" cy="137" rx="126" ry="31" fill="none" stroke="#4E7556" stroke-width="3" stroke-dasharray="2 9" opacity=".8"/>'+
    candle(C[1],lit>=2)+candle(C[2],lit>=3)+candle(center,christ)+candle(C[0],lit>=1)+candle(C[3],lit>=4)+
    '</svg>';
  var cap;
  if(christ) cap=parseDay(ms[4].date).getTime()===today.getTime()?'Christ is born — the Christ candle is lit.':'Christmastide — the Light has come.';
  else if(lit) cap=['First','Second','Third','Fourth'][lit-1]+' week of Advent · '+ms[lit-1].name;
  else cap='Advent begins '+ms[0].label+' — the first candle is Hope.';
  box.innerHTML=svg+'<p class="wreath-cap"></p>';
  box.querySelector('.wreath-cap').textContent=cap;
  box.hidden=false;
}
function renderAll(){
  renderedDay=dayStart(new Date());
  todayVerse=verseFor(new Date()); offset=0;
  var p=todayVerse._pack;
  renderPack(p); applySeason(p); renderToday(); renderPath(p); renderWreath(p); renderWeek(); renderList($('searchInput').value);
  refreshSchedule();
  warmAudioCache();
}

/* Ask the service worker to save the next 8 mornings' narration for offline. */
function warmAudioCache(){
  if(!navigator.serviceWorker || !navigator.serviceWorker.controller) return;
  var urls=[];
  for(var i=0;i<8;i++){ var d=new Date(); d.setDate(d.getDate()+i); urls.push(audioSrc(verseFor(d))); }
  navigator.serviceWorker.controller.postMessage({type:'warm',urls:urls});
}

/* ---------- Wire up controls ---------- */
function wire(){
  $('alarmTime').addEventListener('change',function(){ if(!this.value) return; S.time=this.value; S.on=true; setToggle(true); saveSettings(); refreshSchedule(); toast('Alarm time set to '+fmtTime(new Date('2000-01-01T'+this.value))); });
  $('alarmToggle').addEventListener('click',function(){ S.on=!S.on; setToggle(S.on); saveSettings(); refreshSchedule(); toast(S.on?'Alarm is ON':'Alarm is OFF'); });
  $('daysRow').addEventListener('click',function(e){
    var b=e.target.closest('.day'); if(!b) return;
    b.classList.toggle('on');
    S.days=Array.prototype.map.call(document.querySelectorAll('.day.on'),function(x){return +x.dataset.d;});
    saveSettings(); refreshSchedule();
  });
  document.querySelectorAll('[data-quick]').forEach(function(b){ b.addEventListener('click',function(){
    S.time=b.dataset.quick; S.on=true; $('alarmTime').value=S.time; setToggle(true); saveSettings(); refreshSchedule(); toast('Wake-up set for '+b.textContent.trim());
  });});
  $('soundSel').addEventListener('change',function(){
    S.sound=this.value; saveSettings();
    if(soundById(S.sound).file){ playSound(S.sound); toast('Preview: '+soundById(S.sound).label.split(' — ')[0]+' — tap ■ Stop to end'); }
    else { stopAllAudio(); toast('No sound — the verse will start on its own'); }
  });
  $('snoozeSel').addEventListener('change',function(){ S.snooze=+this.value; $('snoozeLabel').textContent=S.snooze; saveSettings(); });
  $('dismissBtn').addEventListener('click',function(){ closeRing(); snoozeAt=null; if(wakeLock){wakeLock.release().catch(function(){});} toast('Amen — have a blessed day.'); refreshSchedule(); });
  $('snoozeBtn').addEventListener('click',function(){
    closeRing();
    snoozeAt=new Date(Date.now()+S.snooze*60000);
    toast('Snoozed — verse will replay in '+S.snooze+' minutes.');
    enterBedside();
  });
  $('replayBtn').addEventListener('click',function(){ stopAllAudio(); setTimeout(function(){ speakVerse(verseFor(new Date())); },250); });
  $('hearTodayBtn').addEventListener('click',function(){ speakVerse(currentVerse()); toast('Reading the verse aloud…'); });
  $('previewBtn').addEventListener('click',function(){ fireAlarm(verseFor(new Date())); });
  $('anotherBtn').addEventListener('click',function(){ offset=(offset+1)%todayVerse._pack.verses.length; renderToday(); });
  $('testSoundBtn').addEventListener('click',function(){ if(S.sound==='none') toast('Sound is set to “verse only”'); else { playSound(S.sound); toast('Playing your wake-up sound…'); } });
  $('stopSoundBtn').addEventListener('click',stopAllAudio);
  $('searchInput').addEventListener('input',function(){ renderList(this.value); });
  $('bedsideBtn').addEventListener('click',enterBedside);
  $('bedside').addEventListener('click',function(){ exitBedside(false); toast('Bedside mode off — the alarm only rings while the app is open.'); });
}

/* ---------- Install + updates ---------- */
function setupInstall(){
  var standalone=window.matchMedia('(display-mode: standalone)').matches || navigator.standalone===true;
  if(standalone || store.get('installDismissed',false)) return;
  var banner=$('installBanner');
  var isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
  if(isIOS){
    $('installText').innerHTML=ico('phone')+' <b>Add to your home screen:</b> tap the Share button <span aria-hidden="true">⬆︎</span>, then <b>“Add to Home Screen.”</b> It opens like an app and works offline.';
    banner.classList.add('show');
  }
  var deferred=null;
  window.addEventListener('beforeinstallprompt',function(e){ e.preventDefault(); deferred=e; $('installBtn').hidden=false; banner.classList.add('show'); });
  $('installBtn').addEventListener('click',function(){ if(!deferred) return; deferred.prompt(); deferred.userChoice.finally(function(){ deferred=null; banner.classList.remove('show'); }); });
  $('installDismiss').addEventListener('click',function(){ banner.classList.remove('show'); store.set('installDismissed',true); });
  window.addEventListener('appinstalled',function(){ banner.classList.remove('show'); toast('Installed — find Verse Alarm on your home screen.'); });
}
var wantReload=false;
function setupServiceWorker(){
  if(!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then(function(reg){
    function prompt(w){ $('updateBanner').classList.add('show'); $('updateBtn').onclick=function(){ wantReload=true; w.postMessage({type:'skipWaiting'}); }; }
    if(reg.waiting && navigator.serviceWorker.controller) prompt(reg.waiting);
    reg.addEventListener('updatefound',function(){
      var w=reg.installing; if(!w) return;
      w.addEventListener('statechange',function(){ if(w.state==='installed' && navigator.serviceWorker.controller) prompt(w); });
    });
    // Check for a new app/pack version whenever the app is reopened.
    document.addEventListener('visibilitychange',function(){ if(document.visibilityState==='visible') reg.update().catch(function(){}); });
  }).catch(function(){});
  // Reload only when the person tapped "Refresh" — never on first open,
  // which would jump the page back to the top mid-scroll.
  var reloading=false;
  navigator.serviceWorker.addEventListener('controllerchange',function(){ if(!wantReload || reloading) return; reloading=true; location.reload(); });
  navigator.serviceWorker.ready.then(function(){ setTimeout(warmAudioCache,1500); });
}

/* ---------- Boot ---------- */
applySettingsToUI();
wire();
setupInstall();
setupServiceWorker();
loadPacks().then(function(){
  renderAll();
  setInterval(tick,1000); tick();
}).catch(function(){
  $('packLead').textContent='Couldn\'t load the verse pack. Check your connection and reopen the app.';
});

})();
