import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';

test('isolated application serves UI modules, saves notebook revisions, and exports evidence without touching originals',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'adamantium-server-test-')),vault=path.join(root,'vault'),data=path.join(root,'data');await fs.mkdir(vault);
 const original='# Original\n\nRead-only source record.\n';await fs.writeFile(path.join(vault,'original.md'),original);
 const reserve=net.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
 const child=spawn(process.execPath,[fileURLToPath(new URL('../server.mjs',import.meta.url))],{env:{...process.env,PORT:String(port),ADAMANTIUM_VAULT:vault,ADAMANTIUM_DATA_DIR:data,ADAMANTIUM_REUSE_INDEX:'0'},stdio:['ignore','pipe','pipe'],windowsHide:true});
 let errors='';child.stderr.on('data',chunk=>errors=(errors+chunk).slice(-8000));
 const base=`http://127.0.0.1:${port}`,post=(route,body,origin=base)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Application startup timeout: '+errors)),15000);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',()=>{clearTimeout(timer);reject(Error(errors));});child.stdout.on('data',chunk=>{if(String(chunk).includes('Adamantium:')){clearTimeout(timer);resolve();}});});
  for(const name of ['app','notebook','knowledge','projects','graph','organizer','cell','flow']){const r=await fetch(base+'/'+name+'.js');assert.equal(r.status,200,name);assert.match(r.headers.get('content-type'),/javascript/);}
  assert.equal((await post('/api/notebook/save',{title:'Denied',body:''},'https://foreign.test')).status,403);
  let response=await post('/api/notebook/save',{title:'Local note',body:'Original writing'});assert.equal(response.status,200);const first=await response.json();
  response=await post('/api/notebook/save',{...first,body:'Second writing'});assert.equal(response.status,200);
  assert.equal((await post('/api/notebook/save',{...first,body:'Stale'})).status,400);
  const restored=await (await post('/api/notebook/restore',{id:first.id,fromRevision:1,revision:2})).json();assert.equal(restored.body,'Original writing');assert.equal(restored.revision,3);
  const exported=await fetch(base+'/api/notebook/export?id='+first.id);assert.match(exported.headers.get('content-disposition'),/attachment/);assert.match(await exported.text(),/Original writing/);
  const imported=await (await post('/api/knowledge/import',{graph:{directed:true,nodes:[{id:'a',label:'A'},{id:'b',label:'B'}],links:[{source:'a',target:'b',relation:'uses'}]},title:'Isolated evidence'})).json();
  assert.ok(imported.id,JSON.stringify(imported));
  const clustered=await (await post('/api/knowledge/operate',{action:'cluster',ids:[imported.id],title:'Community copy'})).json();assert.ok(clustered.id,JSON.stringify(clustered));assert.equal(clustered.analysis.communities,1);
  const combined=await (await post('/api/knowledge/operate',{action:'combine',ids:[imported.id,clustered.id],title:'Combined copy'})).json();assert.equal(combined.nodes,4);assert.equal(combined.edges,2);
  assert.equal((await (await fetch(base+'/api/knowledge/groups?graph='+clustered.id)).json()).length,1);
  const g=await (await fetch(base+'/api/knowledge/view?graph='+imported.id)).json();
  const context=await (await fetch(base+'/api/knowledge/context?'+new URLSearchParams({graph:imported.id,id:g.nodes[0].id}))).json();assert.equal(context.relationships,1);assert.ok(context.characters<=context.budget);
  for(const format of ['canvas','md','mermaid','graphml']){const r=await fetch(base+'/api/knowledge/export?'+new URLSearchParams({graph:imported.id,format,scope:'view'}));assert.equal(r.status,200,format);assert.ok((await r.text()).length>10);}
  assert.equal(await fs.readFile(path.join(vault,'original.md'),'utf8'),original);
 }finally{
  if(child.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}
  if(path.dirname(root)!==os.tmpdir()||!path.basename(root).startsWith('adamantium-server-test-'))throw Error('Unexpected test path');await fs.rm(root,{recursive:true,maxRetries:5,retryDelay:100});
 }
});
