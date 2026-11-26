/* Daily Verse Alarm — service worker
   - App files and pack text: network first, fall back to cache (so monthly
     packs show up as soon as they're published, and the app still opens offline).
   - Images and audio: cache first (fast, and the 6 AM alarm works offline).
   Bump VERSION when app.js / app.css / index.html change. */
var VERSION='v1.2.0';
var SHELL='dva-shell-'+VERSION;
var MEDIA='dva-media';
var SHELL_FILES=[
  './','index.html','app.css','app.js','manifest.webmanifest',
  'sounds/chime.mp3','sounds/bells.mp3','sounds/dulcimer.mp3','sounds/musicbox.mp3',
  'sounds/harp.mp3','sounds/windchimes.mp3','sounds/bowl.mp3',
  'icons/icon-192.png','icons/icon-512.png','icons/apple-touch-icon.png',
  'packs/index.json'
];

self.addEventListener('install',function(e){
  e.waitUntil(caches.open(SHELL).then(function(c){ return c.addAll(SHELL_FILES); }));
});
self.addEventListener('activate',function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k.indexOf('dva-shell-')===0 && k!==SHELL; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});
self.addEventListener('message',function(e){
  var d=e.data||{};
  if(d.type==='skipWaiting') self.skipWaiting();
  if(d.type==='warm' && Array.isArray(d.urls)){
    e.waitUntil(caches.open(MEDIA).then(function(c){
      return Promise.all(d.urls.map(function(u){
        return c.match(u).then(function(hit){
          if(hit) return;
          return fetch(u).then(function(r){ if(r.ok && r.status===200) return c.put(u,r); }).catch(function(){});
        });
      }));
    }));
  }
});

function isMedia(url){ return /\.(mp3|m4a|wav|webp|png|jpe?g|gif|svg)$/i.test(url.pathname); }

/* iPhone Safari asks for audio in byte ranges; answer from the cached file. */
function rangeResponse(req,res){
  var range=req.headers.get('range');
  if(!range) return res;
  return res.arrayBuffer().then(function(buf){
    var m=/bytes=(\d*)-(\d*)/.exec(range)||[];
    var size=buf.byteLength;
    var start=m[1]?parseInt(m[1],10):0;
    var end=m[2]?parseInt(m[2],10):size-1;
    if(!m[1] && m[2]){ start=size-parseInt(m[2],10); end=size-1; }
    end=Math.min(end,size-1);
    return new Response(buf.slice(start,end+1),{status:206,statusText:'Partial Content',headers:{
      'Content-Type':res.headers.get('Content-Type')||'audio/mpeg',
      'Content-Range':'bytes '+start+'-'+end+'/'+size,
      'Content-Length':String(end-start+1),
      'Accept-Ranges':'bytes'
    }});
  });
}

self.addEventListener('fetch',function(e){
  var req=e.request;
  if(req.method!=='GET') return;
  var url=new URL(req.url);
  if(url.origin!==self.location.origin) return;   // fonts etc. go straight to network

  if(isMedia(url)){
    var key=url.origin+url.pathname;
    e.respondWith(caches.open(MEDIA).then(function(c){
      return c.match(key).then(function(hit){
        if(hit) return rangeResponse(req,hit);
        return fetch(key).then(function(r){
          if(r.ok && r.status===200){ c.put(key,r.clone()); return rangeResponse(req,r); }
          return r;
        }).catch(function(){ return caches.match(key).then(function(s){ return s||Response.error(); }); });
      });
    }));
    return;
  }

  // cache:'no-cache' makes the phone check GitHub for a newer copy every
  // time, instead of reusing a stale one for up to 10 minutes.
  e.respondWith(fetch(url.href,{cache:'no-cache',credentials:'same-origin'}).then(function(r){
    if(r.ok){ var copy=r.clone(); caches.open(SHELL).then(function(c){ c.put(req,copy); }); }
    return r;
  }).catch(function(){
    return caches.match(req,{ignoreSearch:true}).then(function(hit){
      return hit || (req.mode==='navigate' ? caches.match('index.html') : Response.error());
    });
  }));
});
