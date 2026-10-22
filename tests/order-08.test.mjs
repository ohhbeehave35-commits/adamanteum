import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';

const exec=promisify(execFile);
const root=fileURLToPath(new URL('../',import.meta.url));
const cli=path.join(root,'adamantium-cli.mjs');

// 0.5.0: checks for the three defects found while verifying the phone install and the Obsidian import.
// The service worker is run for real against a small in-memory stand-in for the browser's cache and network.
async function loadWorker({online}){
 const listeners={};
 const store=new Map();
 const fakeCache={
  async put(request,response){store.set(typeof request==='string'?new URL(request,'http://x').pathname:new URL(request.url).pathname,response);},
  async addAll(urls){for(const u of urls)store.set(new URL(u,'http://x').pathname,new Response('shell:'+u));},
  async keys(){return [...store.keys()].map(k=>new Request('http://x'+k));}
 };
 const state={online,fetched:[],origin:'http://x'};
 globalThis.self={addEventListener:(type,fn)=>{listeners[type]=fn;},skipWaiting(){},clients:{claim(){}}};
 globalThis.caches={
  async open(){return fakeCache;},
  async match(request){const key=typeof request==='string'?new URL(request,'http://x').pathname:new URL(request.url).pathname;const hit=store.get(key);return hit?hit.clone():undefined;}
 };
 const realFetch=globalThis.fetch;
 globalThis.fetch=async request=>{
  const url=typeof request==='string'?request:request.url;state.fetched.push(new URL(url,'http://x').pathname);
  if(!state.online)throw new TypeError('Failed to fetch');
  const pathname=new URL(url,'http://x').pathname;
  if(pathname==='/api/offline-index')return new Response(JSON.stringify({saved:true,docs:[{id:1,path:'Needle.md',title:'Needle',body:'ZebraOfflineWord'}]}),{status:200,headers:{'Content-Type':'application/json'}});
  return new Response('network:'+pathname,{status:200});
 };
 await import(pathToFileURL(path.join(root,'dist/sw.js')).href+'?run='+Math.random());
 return {listeners,store,state,restore(){globalThis.fetch=realFetch;delete globalThis.self;delete globalThis.caches;}};
}

test('0.5.0 phone: the worker saves the search index itself on request, so a first visit works offline without a reload',async()=>{
 const w=await loadWorker({online:true});
 try{
  assert.ok(w.listeners.message,'service worker listens for the save request');
  const pending=[];
  w.listeners.message({data:{type:'save-offline-index'},waitUntil:p=>pending.push(p)});
  await Promise.all(pending);
  assert.ok(w.store.has('/api/offline-index'),'index is in the saved copy after one message, with no page fetch involved');
  w.state.online=false;
  let answered;
  w.listeners.fetch({request:new Request('http://x/api/search?q=ZebraOfflineWord'),respondWith:p=>{answered=p;}});
  const res=await answered;
  assert.equal(res.status,200);
  assert.deepEqual((await res.json()).map(d=>d.path),['Needle.md']);
 }finally{w.restore();}
});

test('0.5.0 phone: the app asks the worker to save the index once the worker is ready (not a plain fetch that a first visit would miss)',async()=>{
 const app=await fs.readFile(path.join(root,'dist/app.js'),'utf8');
 assert.match(app,/navigator\.serviceWorker\.ready\.then\(reg=>\{if\(reg\.active\)reg\.active\.postMessage\(\{type:'save-offline-index'\}\)/);
 assert.doesNotMatch(app,/fetch\('\/api\/offline-index'\)/);
});

test('0.5.0 phone: the app opens from the saved copy and the saved copy is refreshed in the background (no stale app after an upgrade)',async()=>{
 const w=await loadWorker({online:true});
 try{
  await w.store.set('/app.js',new Response('old app'));
  const pending=[];
  let answered;
  w.listeners.fetch({request:new Request('http://x/app.js'),respondWith:p=>{answered=p;}});
  assert.equal(await (await answered).text(),'old app','saved copy answers at once');
  await new Promise(r=>setTimeout(r,50));
  assert.ok(w.state.fetched.includes('/app.js'),'the network was asked for a newer copy');
  assert.equal(await (await w.store.get('/app.js').clone()).text(),'network:/app.js','saved copy replaced for the next open');
  w.state.online=false;
  let offlineAnswer;
  w.listeners.fetch({request:new Request('http://x/app.js'),respondWith:p=>{offlineAnswer=p;}});
  assert.equal(await (await offlineAnswer).text(),'network:/app.js','offline still opens');
 }finally{w.restore();}
});

test('0.5.0 offline index lists the most recently changed notes first',async()=>{
 const server=await fs.readFile(path.join(root,'server.mjs'),'utf8');
 assert.match(server,/FROM docs ORDER BY mtime DESC LIMIT 8000/);
});

async function importFixture(){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'adamantium-import8-'));
 const vault=path.join(dir,'vault');
 await fs.mkdir(path.join(vault,'.obsidian'),{recursive:true});
 await fs.writeFile(path.join(vault,'Home.md'),'# Home\n');
 await fs.writeFile(path.join(vault,'.obsidian','templates.json'),JSON.stringify({folder:'Templates',dateFormat:'DD/MM/YYYY',timeFormat:'HH.mm'}));
 await fs.writeFile(path.join(vault,'.obsidian','app.json'),JSON.stringify({userIgnoreFilters:['tools/']}));
 return {dir,vault};
}

test('0.5.0 import-obsidian reports the template date and time format as carried (they are read live from Obsidian\'s file)',async()=>{
 const {dir,vault}=await importFixture();
 try{
  const out=(await exec(process.execPath,[cli,'import-obsidian',vault],{windowsHide:true})).stdout;
  assert.match(out,/Template date and time format: date DD\/MM\/YYYY, time HH\.mm/);
  assert.doesNotMatch(out,/not carried[\s\S]*templates\.json (dateFormat|timeFormat)/i);
  assert.doesNotMatch(out.split('Not carried:')[1]||'',/templates\.json (dateFormat|timeFormat)/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('0.5.0 import-obsidian --dry-run shows the same report and writes nothing into the vault',async()=>{
 const {dir,vault}=await importFixture();
 try{
  const dry=(await exec(process.execPath,[cli,'import-obsidian',vault,'--dry-run'],{windowsHide:true})).stdout;
  assert.match(dry,/Carried across:/);
  assert.ok(!fsSync.existsSync(path.join(vault,'Adamantium-settings.json')),'no settings file written');
  assert.ok(!fsSync.existsSync(path.join(vault,'Adamantium-bookmarks.json')),'no bookmarks file written');
  const real=(await exec(process.execPath,[cli,'import-obsidian',vault],{windowsHide:true})).stdout;
  assert.equal(real,dry,'the report is the same with and without writing');
  assert.ok(fsSync.existsSync(path.join(vault,'Adamantium-settings.json')));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

async function scanCalls(files){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'adamantium-scan8-'));
 try{
  for(const [name,text] of Object.entries(files)){await fs.mkdir(path.dirname(path.join(dir,name)),{recursive:true});await fs.writeFile(path.join(dir,name),text);}
  const out=path.join(dir,'..',path.basename(dir)+'-graph.json');
  await exec(process.execPath,[cli,'scan',dir,'--output',out],{windowsHide:true});
  const g=JSON.parse(await fs.readFile(out,'utf8'));await fs.rm(out,{force:true});
  const nodes=new Map(g.nodes.map(n=>[n.id,n])),to=new Map(g.edges.filter(e=>e.type==='resolves-to').map(e=>[e.source,e.target]));
  return g.nodes.filter(n=>n.kind==='call').map(c=>({call:c.title,line:c.line,target:to.has(c.id)?nodes.get(to.get(c.id)).path+':'+nodes.get(to.get(c.id)).title:null}));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
}

test('0.5.0 Python: from package import submodule, then submodule.func() resolves to that file\'s function (found by comparing with Graphify on the same repo)',async()=>{
 const found=await scanCalls({
  'pkg/__init__.py':'',
  'pkg/audit.py':'def record_event(x):\n    return x\n\ndef other(y):\n    return y\n\nclass Ledger:\n    def post(self):\n        return 1\n',
  'approvals.py':'from pkg import audit\nfrom pkg.audit import other\nimport pkg.audit as au2\nfrom pkg.audit import Ledger\n\ndef approve(a):\n    audit.record_event(a)\n    other(a)\n    au2.record_event(a)\n    Ledger.post(a)\n    return a\n',
  'shadow.py':'from pkg import audit\n\ndef run(audit):\n    audit.record_event(1)\n',
  'missing.py':'from pkg import nothere\n\ndef go():\n    nothere.func()\n'
 });
 const approve=found.filter(c=>['audit.record_event','other','au2.record_event','Ledger.post'].includes(c.call));
 const byCall=Object.fromEntries(approve.map(c=>[c.call+'@'+c.line,c.target]));
 assert.equal(byCall['audit.record_event@7'],'pkg/audit.py:record_event','submodule call resolves');
 assert.equal(byCall['other@8'],'pkg/audit.py:other');
 assert.equal(byCall['au2.record_event@9'],'pkg/audit.py:record_event');
 assert.equal(byCall['Ledger.post@10'],'pkg/audit.py:post','imported class method resolves');
 const shadow=found.find(c=>c.call==='audit.record_event'&&c.line===4);
 assert.equal(shadow.target,null,'a parameter named like the module is never guessed');
 const missing=found.find(c=>c.call==='nothere.func');
 assert.equal(missing.target,null,'an import that is not a project file stays unresolved');
});
