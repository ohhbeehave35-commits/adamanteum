import {APP_SHELL,handleOfflineApi} from './offline-index.js';
const CACHE='adamantium-shell-v1';
const INDEX='/api/offline-index';

self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(APP_SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(self.clients.claim());
});

async function jsonResponse(result){
 return new Response(JSON.stringify(result.body),{status:result.status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
}
async function snapshot(){
 const cached=await caches.match(INDEX);
 if(!cached)return null;
 try{return await cached.json();}catch{return null;}
}
async function fromIndex(request){
 const saved=await snapshot();
 const result=handleOfflineApi(request.url,saved);
 return jsonResponse(result);
}
async function networkThenIndex(request){
 try{
  const response=await fetch(request);
  if(response.ok)return response;
 }catch{}
 return fromIndex(request);
}
async function cacheIndex(request){
 try{
  const response=await fetch(request);
  if(response.ok){
   const copy=response.clone();
   const cache=await caches.open(CACHE);
   await cache.put(INDEX,copy);
  }
  return response;
 }catch{
  return (await caches.match(INDEX))||jsonResponse({status:503,body:{error:'offline: search needs the index',offline:true}});
 }
}

self.addEventListener('message',event=>{
 if(event.data&&event.data.type==='save-offline-index')event.waitUntil(cacheIndex(INDEX).catch(()=>{}));
});

self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET')return;
 const url=new URL(request.url);
 if(url.pathname==='/api/search'||url.pathname==='/api/doc'){
  event.respondWith(networkThenIndex(request));
  return;
 }
 if(url.pathname===INDEX){
  event.respondWith(cacheIndex(request));
  return;
 }
 if(url.pathname.startsWith('/api/'))return;
 // Saved copy first so the app opens offline; refresh the saved copy in the background so an upgraded server is picked up on the next open.
 event.respondWith(caches.match(request).then(cached=>{
  const fresh=fetch(request).then(response=>{
   if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy));}
   return response;
  });
  if(cached){fresh.catch(()=>{});return cached;}
  return fresh;
 }));
});
