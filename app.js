/* Daily Verse Alarm — installable app
   Verses come from monthly "verse packs" in /packs (see README.md).
   packs/index.json lists every pack; each pack folder holds pack.json,
   its images, and one narrated MP3 per verse. */
(function(){
'use strict';

var APP_VERSION='1.0.0';
var $=function(id){return document.getElementById(id);};
var DAY=86400000;

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
function setLibBtn(btn,on){ btn.textContent=on?'■':'▶'; btn.setAttribute('aria-label',on?'Stop this verse':'Hear this verse'); btn.classList.toggle('playing',on); }
function resetLibBtn(){ if(libPlayingBtn){ setLibBtn(libPlayingBtn,false); libPlayingBtn=null; libPlayingV=null; } }
function stopChimes(){ ['chimeAudio','bellsAudio'].forEach(function(id){ var a=$(id); a.pause(); try{a.currentTime=0;}catch(e){} }); }
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
  var a=$(kind==='bells'?'bellsAudio':'chimeAudio');
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
  ['chimeAudio','bellsAudio'].forEach(function(id){
    var a=$(id); a.muted=true;
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
  $('soundSel').value=S.sound;
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
  if(!S.on){ el.innerHTML='⏸️ <strong>Alarm is OFF</strong> — flip the switch when you\'re ready for tomorrow morning.'; return; }
  if(!S.days.length){ el.innerHTML='⚠️ <strong>Pick at least one day</strong> — tap a day above so the alarm knows when to ring.'; return; }
  if(!nextRing) return;
  el.innerHTML='⏰ <strong>Alarm is ON</strong> — next ring <b>'+whenWord(nextRing)+' at '+fmtTime(nextRing)+'</b> with <b>'+verseFor(nextRing).r+'</b>.';
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
  $('ringTime').textContent=fmtTime(new Date());
  $('ringStatus').textContent='Playing your chime, then reading today\'s verse…';
  $('ringOverlay').classList.add('show');
  if(navigator.vibrate) navigator.vibrate([300,150,300,150,500]);
  clearTimeout(speakTimer);
  if(S.sound==='none') speakTimer=setTimeout(function(){speakVerse(v);},600);
  else { playSound(S.sound); speakTimer=setTimeout(function(){speakVerse(v);},4200); }
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
  $('todayText').textContent='“'+v.t+'”';
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
    var r=document.createElement('span'); r.textContent=v.r+' · ▶ Hear it';
    b.appendChild(h); b.appendChild(s); b.appendChild(r);
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
    var btn=document.createElement('button'); btn.className='iconbtn'; btn.setAttribute('aria-label','Hear this verse'); btn.textContent='▶';
    var div=document.createElement('div');
    var bq=document.createElement('blockquote'); bq.textContent='“'+v.t+'”';
    var c=document.createElement('cite'); c.textContent=v.r.toUpperCase();
    div.appendChild(bq); div.appendChild(c); row.appendChild(btn); row.appendChild(div);
    btn.addEventListener('click',function(){
      if(libPlayingV===v && speaking){ stopAllAudio(); toast('Verse stopped.'); return; }
      speakVerse(v); libPlayingBtn=btn; libPlayingV=v; setLibBtn(btn,true);
    });
    list.appendChild(row);
  });
  if(!shown) list.innerHTML='<p class="sub" style="padding:8px 2px">No verse matches that search.</p>';
}
function renderAll(){
  renderedDay=dayStart(new Date());
  todayVerse=verseFor(new Date()); offset=0;
  var p=todayVerse._pack;
  renderPack(p); renderToday(); renderPath(p); renderWeek(); renderList($('searchInput').value);
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
  $('soundSel').addEventListener('change',function(){ S.sound=this.value; saveSettings(); });
  $('snoozeSel').addEventListener('change',function(){ S.snooze=+this.value; $('snoozeLabel').textContent=S.snooze; saveSettings(); });
  $('dismissBtn').addEventListener('click',function(){ closeRing(); snoozeAt=null; if(wakeLock){wakeLock.release().catch(function(){});} toast('Amen — have a blessed day ☀️'); refreshSchedule(); });
  $('snoozeBtn').addEventListener('click',function(){
    closeRing();
    snoozeAt=new Date(Date.now()+S.snooze*60000);
    toast('Snoozed — verse will replay in '+S.snooze+' minutes 💤');
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
    $('installText').innerHTML='📲 <b>Add to your home screen:</b> tap the Share button <span aria-hidden="true">⬆︎</span>, then <b>“Add to Home Screen.”</b> It opens like an app and works offline.';
    banner.classList.add('show');
  }
  var deferred=null;
  window.addEventListener('beforeinstallprompt',function(e){ e.preventDefault(); deferred=e; $('installBtn').hidden=false; banner.classList.add('show'); });
  $('installBtn').addEventListener('click',function(){ if(!deferred) return; deferred.prompt(); deferred.userChoice.finally(function(){ deferred=null; banner.classList.remove('show'); }); });
  $('installDismiss').addEventListener('click',function(){ banner.classList.remove('show'); store.set('installDismissed',true); });
  window.addEventListener('appinstalled',function(){ banner.classList.remove('show'); toast('Installed — find Verse Alarm on your home screen.'); });
}
function setupServiceWorker(){
  if(!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then(function(reg){
    function prompt(w){ $('updateBanner').classList.add('show'); $('updateBtn').onclick=function(){ w.postMessage({type:'skipWaiting'}); }; }
    if(reg.waiting && navigator.serviceWorker.controller) prompt(reg.waiting);
    reg.addEventListener('updatefound',function(){
      var w=reg.installing; if(!w) return;
      w.addEventListener('statechange',function(){ if(w.state==='installed' && navigator.serviceWorker.controller) prompt(w); });
    });
    // Check for a new app/pack version whenever the app is reopened.
    document.addEventListener('visibilitychange',function(){ if(document.visibilityState==='visible') reg.update().catch(function(){}); });
  }).catch(function(){});
  var reloading=false;
  navigator.serviceWorker.addEventListener('controllerchange',function(){ if(reloading) return; reloading=true; location.reload(); });
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
