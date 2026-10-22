import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
test('order 1-9 sample HTTP write becomes searchable linked tagged and canvas opens',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'adamantium04-http-')),vault=path.join(root,'vault');await fs.mkdir(vault);await fs.writeFile(path.join(vault,'Home.md'),'# Home\n');await fs.writeFile(path.join(vault,'Board.canvas'),JSON.stringify({nodes:[{id:'a',type:'text',text:'canvasneedle',x:0,y:0,width:100,height:100}],edges:[]}));
 const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));assert.notEqual(port,4173);
 const start=performance.now(),child=spawn(process.execPath,[fileURLToPath(new URL('../server.mjs',import.meta.url))],{env:{...process.env,PORT:String(port),ADAMANTIUM_VAULT:vault,ADAMANTIUM_DATA_DIR:path.join(root,'data'),ADAMANTIUM_VAULT_WRITE:'1',ADAMANTIUM_REUSE_INDEX:'0'},stdio:['ignore','pipe','pipe'],windowsHide:true});let errors='';child.stderr.on('data',b=>errors+=b);const base='http://127.0.0.1:'+port;
 const get=async(route,params={})=>{const r=await fetch(base+'/api/'+route+'?'+new URLSearchParams(params));assert.equal(r.status,200,await r.clone().text());return r.json();};
 const post=(route,body,origin=base)=>fetch(base+'/api/'+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const until=async fn=>{for(let i=0;i<100;i++){const result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+errors);};
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(errors||'Startup timeout')),15000);child.once('error',reject);child.stdout.on('data',b=>{if(String(b).includes('Adamantium:')){clearTimeout(timer);resolve();}});});
  await until(async()=> (await get('status')).phase==='ready');const cold=performance.now()-start;
  assert.equal((await get('search',{q:'canvasneedle'}))[0].path,'Board.canvas');
  assert.equal((await post('workspace/save',{path:'Notebook/New.md',body:'bad'},'https://foreign.test')).status,403);
  const response=await post('workspace/save',{path:'Notebook/New.md',body:'# New\n[[Home]]\n#hub\nneedle exact phrase',properties:{status:'draft',ready:false},expectedHash:null});assert.equal(response.status,200);const receipt=await response.json();assert.equal(receipt.sha256.length,64);
  await until(async()=> (await get('search',{q:'needle'})).length);
  for(const q of ['tag:hub','status:draft','"exact phrase"','needle -absent','path:Notebook','file:New','line:"exact phrase"'])assert.equal((await get('search',{q}))[0]?.path,'Notebook/New.md',q);
  assert.equal((await get('search',{q:'needle -phrase'})).length,0);
  const found=(await get('search',{q:'needle'}))[0],doc=await get('doc',{id:found.id});assert.equal(doc.properties.ready,false);assert.equal(doc.connections[0].path,'Home.md');assert.equal((await get('workspace/tags'))[0].tag,'hub');
  assert.equal((await post('workspace/save',{path:receipt.path,body:'stale',expectedHash:'wrong'})).status,400);
  const measurements=[];for(let i=0;i<5;i++){const before=performance.now();await get('search',{q:'needle'});measurements.push(performance.now()-before);}t.diagnostic(JSON.stringify({sampleDocuments:3,coldStartMs:Math.round(cold),searchMedianMs:measurements.sort((a,b)=>a-b)[2],port}));
 }finally{if(child.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
