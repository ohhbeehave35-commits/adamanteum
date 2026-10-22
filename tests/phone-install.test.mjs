import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {searchIndex,handleOfflineApi,APP_SHELL} from '../dist/offline-index.js';

const root=fileURLToPath(new URL('../',import.meta.url));

test('phone layout rules exist for the five workspace roots, note view, search and Notebook',async()=>{
 const css=await fs.readFile(path.join(root,'dist/phone.css'),'utf8');
 assert.match(css,/@media \(max-width:\s*390px\)/);
 assert.match(css,/overflow-x:\s*hidden/);
 assert.match(css,/padding-left:\s*16px/);
 assert.match(css,/padding-right:\s*16px/);
 assert.match(css,/min-height:\s*44px/);
 for(const theme of ['nebula','ember','aurora','ivory','terminal'])assert.match(css,new RegExp('data-theme='+theme),theme);
 assert.match(css,/#document/);
 assert.match(css,/#results/);
 assert.match(css,/#spot-results/);
 assert.match(css,/\.notebook-layout/);
 assert.match(css,/flex-direction:\s*column/);
});

test('manifest is served and valid; offline search returns results from the saved index',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'adamantium-phone-'));
 const vault=path.join(dir,'vault'),data=path.join(dir,'data');
 await fs.mkdir(vault);
 await fs.writeFile(path.join(vault,'Needle.md'),'# Needle\nUniqueOfflineNeedle lives here.\n');
 await fs.writeFile(path.join(vault,'Other.md'),'# Other\nNothing special.\n');
 const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));
 const child=spawn(process.execPath,[path.join(root,'server.mjs')],{env:{...process.env,PORT:String(port),ADAMANTIUM_VAULT:vault,ADAMANTIUM_DATA_DIR:data,ADAMANTIUM_REUSE_INDEX:'0'},stdio:['ignore','pipe','pipe'],windowsHide:true});
 let errors='';child.stderr.on('data',b=>errors+=b);
 const base='http://127.0.0.1:'+port;
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(errors||'Startup timeout')),15000);child.once('error',reject);child.stdout.on('data',b=>{if(String(b).includes('Adamantium:')){clearTimeout(timer);resolve();}});});
  const until=async fn=>{for(let i=0;i<100;i++){const result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+errors);};
  await until(async()=>(await (await fetch(base+'/api/status')).json()).phase==='ready');
  const manifestRes=await fetch(base+'/manifest.webmanifest');
  assert.equal(manifestRes.status,200);
  assert.match(manifestRes.headers.get('content-type'),/manifest\+json|json/);
  const manifest=await manifestRes.json();
  assert.equal(manifest.name,'Adamantium');
  assert.equal(manifest.short_name,'Adamantium');
  assert.equal(manifest.display,'standalone');
  assert.match(String(manifest.theme_color),/^#(?:0|1)/);
  assert.ok(Array.isArray(manifest.icons)&&manifest.icons.length);
  assert.ok(manifest.icons.every(icon=>icon.src.includes('adamantium-mark')));
  const mark=await fetch(base+'/assets/adamantium-mark.svg');
  assert.equal(mark.status,200);
  assert.match(mark.headers.get('content-type'),/svg/);
  const sw=await fetch(base+'/sw.js');
  assert.equal(sw.status,200);
  const swBody=await sw.text();
  assert.match(swBody,/APP_SHELL|caches\.open/);
  assert.match(swBody,/\/api\/search/);
  assert.match(swBody,/\/api\/doc/);
  const phone=await fetch(base+'/phone.css');
  assert.equal(phone.status,200);
  assert.match(await phone.text(),/max-width:\s*390px/);
  const html=await (await fetch(base+'/')).text();
  assert.match(html,/manifest\.webmanifest/);
  assert.match(html,/phone\.css/);
  const snapshot=await (await fetch(base+'/api/offline-index')).json();
  assert.equal(snapshot.saved,true);
  assert.ok(snapshot.docs.some(d=>d.path==='Needle.md'));
  const live=await (await fetch(base+'/api/search?'+new URLSearchParams({q:'UniqueOfflineNeedle'}))).json();
  assert.equal(live[0].path,'Needle.md');
  child.kill();
  const offline=handleOfflineApi(base+'/api/search?q=UniqueOfflineNeedle',snapshot);
  assert.equal(offline.status,200);
  assert.equal(offline.body[0].path,'Needle.md');
  assert.deepEqual(searchIndex(snapshot.docs,'UniqueOfflineNeedle').map(d=>d.path),['Needle.md']);
  const note=handleOfflineApi(base+'/api/doc?id='+offline.body[0].id,snapshot);
  assert.equal(note.status,200);
  assert.match(note.body.body,/UniqueOfflineNeedle/);
  const missing=handleOfflineApi(base+'/api/search?q=x',null);
  assert.equal(missing.status,503);
  assert.match(missing.body.error,/offline: search needs the index/);
  assert.ok(APP_SHELL.includes('/phone.css'));
  assert.ok(APP_SHELL.includes('/assets/adamantium-mark.svg'));
 }finally{
  if(child.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}
  if(path.dirname(dir)!==os.tmpdir()||!path.basename(dir).startsWith('adamantium-phone-'))throw Error('Unexpected path');
  await fs.rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
 }
});
