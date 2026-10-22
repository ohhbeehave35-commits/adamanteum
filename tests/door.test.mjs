import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {TokenStore,doorRoutes,DOOR_BASE,DOOR_VERSION} from '../door.mjs';
import {fingerprint} from '../vault-workspace.mjs';

const here=path.dirname(fileURLToPath(import.meta.url)),server=path.join(here,'..','server.mjs'),cli=path.join(here,'..','adamantium-cli.mjs');
const freePort=async()=>{const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const DAY='2026-10-21';

async function boot({write=true,env={}}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'adamantium-door-')),vault=path.join(root,'vault'),dataDir=path.join(root,'data');
 await fs.mkdir(path.join(vault,'Notes'),{recursive:true});
 await fs.writeFile(path.join(vault,'Home.md'),'---\nstatus: live\ntags: [hub]\n---\n# Home\nThe door sample. See [[Notes/Alpha]] and [[Notes/Beta]].\n');
 await fs.writeFile(path.join(vault,'Notes','Alpha.md'),'# Alpha\nDoorneedle lives here. Links to [[Beta]] and back to [[Home]].\n');
 await fs.writeFile(path.join(vault,'Notes','Beta.md'),'# Beta\nBeta points back at [[Alpha]] (a cycle) and at [[Gamma]].\n');
 await fs.writeFile(path.join(vault,'Notes','Gamma.md'),'# Gamma\nGamma links [[Missing note]] which does not exist.\n');
 const port=await freePort();let errors='';
 const child=spawn(process.execPath,[server],{env:{...process.env,PORT:String(port),ADAMANTIUM_VAULT:vault,ADAMANTIUM_DATA_DIR:dataDir,...(write?{ADAMANTIUM_VAULT_WRITE:'1'}:{}),ADAMANTIUM_REUSE_INDEX:'0',...env},stdio:['ignore','pipe','pipe'],windowsHide:true});
 child.stderr.on('data',b=>errors+=b);
 const base='http://127.0.0.1:'+port;
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(errors||'Startup timeout')),20000);child.once('error',reject);child.stdout.on('data',b=>{if(String(b).includes('Adamantium:')){clearTimeout(timer);resolve();}});});
 const until=async(fn,what='condition')=>{for(let i=0;i<150;i++){const r=await fn();if(r)return r;await sleep(100);}throw Error('Timed out waiting for '+what+': '+errors);};
 await until(async()=>(await (await fetch(base+'/api/status')).json()).phase==='ready','index ready');
 const env2={...process.env,ADAMANTIUM_DATA_DIR:dataDir,ADAMANTIUM_DOOR_URL:base};
 const runCli=(args,extra={})=>spawnSync(process.execPath,[cli,'door',...args],{env:{...env2,...extra},encoding:'utf8',input:extra.__input,windowsHide:true});
 const runCliAsync=(args,extra={})=>new Promise(resolve=>{const c=spawn(process.execPath,[cli,'door',...args],{env:{...env2,...extra},windowsHide:true});let stdout='',stderr='';c.stdout.on('data',b=>stdout+=b);c.stderr.on('data',b=>stderr+=b);c.on('close',status=>resolve({status,stdout,stderr}));});
 const mint=(actor,scope)=>{const out=path.join(root,'tokens',actor+'.token'),r=runCli(['mint',actor,'--scope',scope,'--out',out]);assert.equal(r.status,0,r.stderr);return {file:out,token:fsSync.readFileSync(out,'utf8').trim(),stdout:r.stdout};};
 const stop=async()=>{if(child.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});};
 const call=async(token,method,route,body,query={})=>{const url=new URL(base+DOOR_BASE+route);for(const [k,v] of Object.entries(query))url.searchParams.set(k,String(v));const r=await fetch(url,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body!==undefined?JSON.stringify(body):undefined});return {status:r.status,json:await r.json().catch(()=>null)};};
 return {root,vault,dataDir,port,base,until,runCli,runCliAsync,mint,stop,call,env2};
}
const cliJson=r=>{assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};

test('tokens: minted by the owner, stored only as hashes, actor named, revocable',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'adamantium-tok-'));
 try{
  const store=new TokenStore(path.join(dir,'door-tokens.json')),a=store.mint({actor:'director-d2',scope:'write'});
  assert.match(a.token,/^adm1\.[0-9a-f]{12}\./);assert.deepEqual(store.verify(a.token),{id:a.id,actor:'director-d2',scope:'write'});
  const stored=await fs.readFile(path.join(dir,'door-tokens.json'),'utf8');assert.ok(!stored.includes(a.token.split('.')[2]),'the secret is never stored');
  assert.equal(store.verify(a.token.slice(0,-2)+'xx'),null);assert.equal(store.verify('nonsense'),null);
  assert.throws(()=>store.mint({actor:'Bad Actor',scope:'read'}),/Actor names/);assert.throws(()=>store.mint({actor:'ok-actor',scope:'admin'}),/Scope/);
  assert.equal(store.revoke('director-d2').revoked,1);assert.equal(store.verify(a.token),null);
  assert.ok(store.list().every(t=>!('hash' in t)));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('route table: every route refuses a missing or wrong token; GET / lists the same table',async t=>{
 const d=await boot();t.after(d.stop);
 const routes=doorRoutes();assert.equal(routes.length,15);
 for(const r of routes){
  const none=await d.call(null,r.method,r.path.slice(DOOR_BASE.length),r.method==='POST'?{}:undefined);assert.equal(none.status,401,r.path+' without token');
  const wrong=await d.call('adm1.000000000000.'+'a'.repeat(43),r.method,r.path.slice(DOOR_BASE.length),r.method==='POST'?{}:undefined);assert.equal(wrong.status,401,r.path+' wrong token');
 }
 assert.equal((await d.call(null,'GET','/')).status,401);
 const {token}=d.mint('seat-read','read'),index=await d.call(token,'GET','/');assert.equal(index.status,200);assert.equal(index.json.routes.length,routes.length);assert.equal(index.json.version,DOOR_VERSION);assert.equal(index.json.actor,'seat-read');
 assert.equal((await d.call(token,'GET','/nope')).status,404);
});

test('read routes: search (operators, paging, snippets), note (raw, rendered, properties, links, backlinks), context, changed-since, link-health',async t=>{
 const d=await boot();t.after(d.stop);const {token}=d.mint('codex','read');
 const status=await d.call(token,'GET','/status');assert.equal(status.status,200);assert.equal(status.json.actor,'codex');assert.equal(status.json.writable,true);assert.equal(status.json.routes,15);assert.equal(status.json.documents,4);
 const found=await d.call(token,'GET','/search',undefined,{q:'doorneedle'});assert.equal(found.json.hits[0].path,'Notes/Alpha.md');assert.match(found.json.hits[0].snippet,/Doorneedle/i);
 assert.equal((await d.call(token,'GET','/search',undefined,{q:'path:Notes -Doorneedle'})).json.hits.some(h=>h.path==='Notes/Alpha.md'),false,'operators');
 assert.equal((await d.call(token,'GET','/search',undefined,{q:'tag:hub'})).json.hits[0].path,'Home.md');
 const page1=await d.call(token,'GET','/search',undefined,{q:'path:Notes',limit:2}),page2=await d.call(token,'GET','/search',undefined,{q:'path:Notes',limit:2,offset:2});
 assert.equal(page1.json.count,2);assert.equal(page2.json.offset,2);assert.equal(new Set([...page1.json.hits,...page2.json.hits].map(h=>h.path)).size,page1.json.hits.length+page2.json.hits.length,'paging gives different notes');
 const home=(await d.call(token,'GET','/note',undefined,{path:'Home.md'})).json;
 assert.equal(home.sha256,fingerprint(await fs.readFile(path.join(d.vault,'Home.md'),'utf8')));assert.match(home.raw,/^---/);assert.ok(!home.rendered.startsWith('---'));assert.equal(home.properties.status,'live');assert.deepEqual(home.tags.includes('hub'),true);
 assert.deepEqual(home.links.map(l=>l.path).sort(),['Notes/Alpha.md','Notes/Beta.md']);
 const alpha=(await d.call(token,'GET','/note',undefined,{path:'Notes/Alpha.md'})).json;assert.ok(alpha.backlinks.some(b=>b.path==='Home.md'));assert.ok(alpha.links.some(l=>l.path==='Notes/Beta.md'));
 assert.equal((await d.call(token,'GET','/note',undefined,{path:'Nope.md'})).status,404);assert.equal((await d.call(token,'GET','/note',undefined,{path:'.git/config'})).status,403);assert.equal((await d.call(token,'GET','/note',undefined,{path:'../x.md'})).status,400);
 const ctx=(await d.call(token,'GET','/context',undefined,{path:'Notes/Alpha.md',depth:3})).json;
 assert.equal(ctx.records[0].path,'Notes/Alpha.md');assert.equal(new Set(ctx.records.map(r=>r.path)).size,ctx.records.length,'cycle-safe: no note twice');assert.ok(ctx.records.length>=3);assert.match(ctx.notice,/UNTRUSTED/);
 const small=(await d.call(token,'GET','/context',undefined,{path:'Notes/Alpha.md',depth:3,maxChars:512,strategy:'dfs'})).json;assert.equal(small.strategy,'dfs');assert.ok(JSON.stringify(small.records).length<=512+200);
 assert.equal((await d.call(token,'GET','/context',undefined,{path:'Notes/Alpha.md',strategy:'zigzag'})).status,400);
 const changes=(await d.call(token,'GET','/changed-since',undefined,{since:'1d'})).json;assert.equal(changes.total,4);assert.equal((await d.call(token,'GET','/changed-since',undefined,{since:'2099-01-01'})).json.total,0);assert.equal((await d.call(token,'GET','/changed-since',undefined,{since:'soon'})).status,400);
 const health=(await d.call(token,'GET','/link-health')).json;assert.equal(health.summary.broken,1);assert.equal(health.broken[0].source,'Notes/Gamma.md');
 const searches=async()=>(await d.call(token,'GET','/receipts',undefined,{actor:'codex',kind:'search'})).json.receipts.length,beforeSearches=await searches();
 const hookCall=await fetch(d.base+DOOR_BASE+'/search?q=doorneedle',{headers:{Authorization:'Bearer '+token,'X-Door-Purpose':'hook'}});assert.equal(hookCall.status,200);
 assert.equal(await searches(),beforeSearches,'a hook lookup is not the actors own search');assert.ok((await d.call(token,'GET','/receipts',undefined,{actor:'codex',kind:'hook-search'})).json.receipts.length>=1);
});

test('write routes: read-only token refused; stale write refused; actor and receipt match the file; hidden paths refused',async t=>{
 const d=await boot();t.after(d.stop);const reader=d.mint('seat-ro','read').token,writer=d.mint('seat-a','write').token;
 assert.equal((await d.call(reader,'POST','/note',{path:'Notes/New.md',body:'x',expectedHash:null})).status,403);
 assert.equal((await d.call(writer,'POST','/note',{path:'Notes/New.md',body:'x'})).status,400,'expectedHash is required');
 const body1='# New\nfirst doorwrite text [[Home]]\n';
 const first=await d.call(writer,'POST','/note',{path:'Notes/New.md',body:body1,expectedHash:null});assert.equal(first.status,200);
 const onDisk1=await fs.readFile(path.join(d.vault,'Notes','New.md'),'utf8');
 assert.equal(onDisk1,body1);assert.equal(first.json.sha256,fingerprint(onDisk1));assert.equal(first.json.actor,'seat-a');assert.equal(first.json.verifiedOnDisk,true);assert.equal(first.json.created,true);assert.equal(first.json.previousHash,null);assert.equal(first.json.revision,null);
 assert.equal((await d.call(writer,'POST','/note',{path:'Notes/New.md',body:'again',expectedHash:null})).status,409,'creating over an existing file is stale');
 const stale=await d.call(writer,'POST','/note',{path:'Notes/New.md',body:'again',expectedHash:'0'.repeat(64)});assert.equal(stale.status,409);assert.match(stale.json.error,/Stale write refused/);
 assert.equal(await fs.readFile(path.join(d.vault,'Notes','New.md'),'utf8'),body1,'a refused write changes nothing');
 const body2='# New\nsecond version\n',second=await d.call(writer,'POST','/note',{path:'Notes/New.md',body:body2,expectedHash:first.json.sha256});
 assert.equal(second.status,200);assert.equal(second.json.previousHash,first.json.sha256);assert.equal(second.json.sha256,fingerprint(body2));assert.equal(second.json.created,false);assert.ok(second.json.revision?.id);
 const revision=await (await fetch(d.base+'/api/notebook/note?id='+second.json.revision.id)).json();assert.equal(revision.body,body1,'the old text is kept as a revision');assert.equal(revision.properties.actor,'seat-a','the revision names the actor');
 const withProps=await d.call(writer,'POST','/note',{path:'Notes/Props.md',body:'# P\n',properties:{status:'draft',n:3},expectedHash:null});assert.equal(withProps.status,200);assert.match(await fs.readFile(path.join(d.vault,'Notes','Props.md'),'utf8'),/^---\n[\s\S]*status: draft/);
 assert.equal((await d.call(writer,'POST','/note',{path:'.obsidian/x.md',body:'x',expectedHash:null})).status,403);assert.equal((await d.call(writer,'POST','/note',{path:'../x.md',body:'x',expectedHash:null})).status,400);assert.equal((await d.call(writer,'POST','/note',{path:'a.exe',body:'x',expectedHash:null})).status,400);
 assert.equal((await d.call(writer,'POST','/note',{path:'Board.canvas',body:'not json',expectedHash:null})).status,400);
 await d.until(async()=> (await d.call(reader,'GET','/search',undefined,{q:'second version'})).json.hits.length,'new note searchable');
 const audit=(await d.call(reader,'GET','/receipts',undefined,{actor:'seat-a'})).json.receipts;
 assert.ok(audit.every(r=>r.actor==='seat-a'));assert.ok(audit.some(r=>r.kind==='note'&&r.path==='Notes/New.md'&&r.sha256===second.json.sha256));assert.ok(audit.some(r=>r.kind==='write-refused'));
 assert.ok((await d.call(reader,'GET','/receipts',undefined,{kind:'refused'})).json.receipts.some(r=>r.reason==='read-only token'));
 const off=await boot({write:false});t.after(off.stop);assert.equal((await off.call(off.mint('seat-w','write').token,'POST','/note',{path:'A.md',body:'x',expectedHash:null})).status,403,'a read-only Adamantium refuses door writes too');
});

test('results and decision write through the same path with receipts',async t=>{
 const d=await boot();t.after(d.stop);const {token}=d.mint('seat-agent1','write'),reader=d.mint('seat-r','read').token;
 const r1=await d.call(token,'POST','/results',{seat:'agent1',date:DAY,body:'# RESULTS\nline one\n'});assert.equal(r1.status,200);assert.equal(r1.json.path,`Log/${DAY}/AGENT1-RESULTS-${DAY}.md`);
 assert.equal(r1.json.sha256,fingerprint(await fs.readFile(path.join(d.vault,...r1.json.path.split('/')),'utf8')));assert.equal(r1.json.kind,'results');assert.equal(r1.json.actor,'seat-agent1');
 assert.equal((await d.call(token,'POST','/results',{seat:'AGENT1',date:DAY,body:'again'})).status,409,'overwriting needs the sha you read');
 const r2=await d.call(token,'POST','/results',{seat:'AGENT1',date:DAY,body:'# RESULTS\nline two\n',expectedHash:r1.json.sha256});assert.equal(r2.status,200);assert.equal(r2.json.previousHash,r1.json.sha256);
 assert.equal((await d.call(token,'POST','/results',{seat:'x y',body:'x'})).status,400);assert.equal((await d.call(token,'POST','/results',{seat:'AGENT1',date:'2026-13-45',body:'x'})).status,400);
 const noted=(await d.call(reader,'GET','/note',undefined,{path:r1.json.path})).json;assert.equal(noted.sha256,r2.json.sha256,'door note returns the same sha as the receipt');
 const d1=await d.call(token,'POST','/decision',{text:'The owner said yes to the door.',topic:'Door test',date:DAY,time:'13:05'}),d2=await d.call(token,'POST','/decision',{text:'Second line.',topic:'Door test',date:DAY,time:'13:06'});
 assert.equal(d1.status,200);assert.equal(d1.json.path,`Log/${DAY}/DECISION-DOOR-TEST-${DAY}.md`);assert.equal(d2.json.previousHash,d1.json.sha256);assert.equal(d1.json.kind,'decision');
 const file=await fs.readFile(path.join(d.vault,...d1.json.path.split('/')),'utf8');assert.match(file,/^# Decisions, 2026-10-21[^\n]*\n- 13:05: The owner said yes to the door\.\n- 13:06: Second line\.\n$/);assert.equal(d2.json.sha256,fingerprint(file));
 assert.equal((await d.call(token,'POST','/decision',{text:'x',file:`Log/${DAY}/NOTES.md`,date:DAY})).status,400);assert.equal((await d.call(token,'POST','/decision',{text:'x'})).status,400);assert.equal((await d.call(token,'POST','/decision',{text:'x',topic:'t',time:'25:99'})).status,400);
 const both=await Promise.all([1,2,3,4].map(i=>d.call(token,'POST','/decision',{text:'parallel '+i,topic:'Race',date:DAY,time:'14:0'+i})));
 assert.ok(both.every(r=>r.status===200),'concurrent appends retry instead of losing lines: '+JSON.stringify(both.map(r=>[r.status,r.json?.error])));const race=await fs.readFile(path.join(d.vault,'Log',DAY,`DECISION-RACE-${DAY}.md`),'utf8');for(let i=1;i<=4;i++)assert.ok(race.includes('parallel '+i));
});

test('code routes: scan a project, find a symbol, callers and callees with file:line, file symbols, code context',async t=>{
 const d=await boot();t.after(d.stop);const writer=d.mint('seat-code','write').token,reader=d.mint('seat-code-r','read').token;
 assert.equal((await d.call(reader,'GET','/code',undefined,{q:'alpha'})).status,409,'no scan yet');
 const project=path.join(d.root,'proj');await fs.mkdir(project);
 await fs.writeFile(path.join(project,'a.js'),'export function beta(){return 1;}\nexport function alpha(){return beta();}\n');await fs.writeFile(path.join(project,'b.js'),"import {alpha} from './a.js';\nexport function gamma(){return alpha();}\n");
 assert.equal((await d.call(reader,'POST','/code/scan',{directory:project})).status,403);
 assert.equal((await d.call(writer,'POST','/code/scan',{directory:project})).status,200);
 await d.until(async()=>(await (await fetch(d.base+'/api/project/status')).json()).phase==='complete','scan');
 const found=(await d.call(reader,'GET','/code',undefined,{q:'beta'})).json;assert.ok(found.count>=1);const beta=found.symbols.find(s=>s.name==='beta'&&s.path==='a.js');assert.ok(beta&&beta.line===1,'symbol with file and line');
 const rel=(await d.call(reader,'GET','/code',undefined,{id:beta.id})).json;assert.equal(rel.symbol.path,'a.js');assert.ok(rel.callers.some(c=>c.name==='alpha'&&c.path==='a.js'),'alpha calls beta');
 const inFile=(await d.call(reader,'GET','/code',undefined,{file:'a.js'})).json;assert.deepEqual(inFile.symbols.map(s=>s.name).sort(),['alpha','beta']);
 const ctx=(await d.call(reader,'GET','/context',undefined,{id:beta.id})).json;assert.equal(ctx.schema,'adamantium.door.context/v1');assert.match(JSON.stringify(ctx),/alpha/);
 assert.equal((await d.call(reader,'GET','/code',undefined,{id:'nope'})).status,404);assert.equal((await d.call(reader,'GET','/code')).status,400);
});

test('customer model: answers from door evidence only, needs consent, no evidence means no model call, key never returned',async t=>{
 const d=await boot();t.after(d.stop);const writer=d.mint('tenant-acme-model','write').token;
 const seen=[];
 const stub=http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks)):null;seen.push({url:req.url,auth:req.headers.authorization,body});res.setHeader('Content-Type','application/json');
  if(req.url==='/v1/models')return res.end(JSON.stringify({data:[{id:'stub-1'}]}));
  res.end(JSON.stringify({choices:[{message:{content:'Doorneedle is in Alpha [1].'}}]}));});
 stub.listen(0,'127.0.0.1');await once(stub,'listening');t.after(()=>stub.close());const endpoint='http://127.0.0.1:'+stub.address().port+'/v1';
 const attached=await d.call(writer,'POST','/model/attach',{profile:{schema:'adamantium.ai/v1',name:'Acme model',model:'stub-1',endpoint},key:'sk-test-secret-123'});assert.equal(attached.status,200);assert.ok(!JSON.stringify(attached.json).includes('sk-test-secret-123'));
 assert.equal((await d.call(writer,'POST','/model/attach',{profile:{schema:'adamantium.ai/v1',name:'x',model:'m',endpoint,command:'rm'},key:''})).status,400,'cards with commands are refused');
 const models=(await d.call(writer,'GET','/models')).json.models;assert.equal(models.length,1);assert.ok(!JSON.stringify(models).includes('sk-test'));
 const id=attached.json.id,ask=body=>d.call(writer,'POST','/ask',{connectionId:id,...body});
 const before=seen.length;assert.equal((await ask({question:'Where is the doorneedle?'})).status,400,'consent is required');assert.equal(seen.length,before,'no provider call without consent');
 const answered=await ask({question:'Where is the doorneedle?',consent:true});assert.equal(answered.status,200);assert.equal(answered.json.answer,'Doorneedle is in Alpha [1].');assert.equal(answered.json.actor,'tenant-acme-model');assert.equal(answered.json.evidence[0].path,'Notes/Alpha.md');assert.equal(answered.json.evidence[0].sha256,fingerprint(await fs.readFile(path.join(d.vault,'Notes','Alpha.md'),'utf8')));
 const call=seen.at(-1);assert.equal(call.url,'/v1/chat/completions');assert.equal(call.auth,'Bearer sk-test-secret-123');assert.equal(call.body.tools,undefined,'the provider gets no tools');assert.match(call.body.messages[0].content,/ONLY from the numbered vault evidence/);assert.match(call.body.messages[1].content,/\[1\] Notes\/Alpha\.md/);assert.match(call.body.messages[1].content,/Doorneedle lives here/);assert.doesNotMatch(call.body.messages[1].content,/Missing note/,'only matching notes are sent');
 const count=seen.length;const none=await ask({question:'zzzqqq nothing matches this',consent:true});assert.equal(none.status,200);assert.equal(none.json.answer,null);assert.equal(seen.length,count,'no evidence: the model is not called');
 assert.equal((await d.call(writer,'POST','/ask',{connectionId:'nope',question:'q',consent:true})).status,400);
 const audit=(await d.call(writer,'GET','/receipts',undefined,{actor:'tenant-acme-model'})).json.receipts;assert.ok(audit.some(r=>r.kind==='evidence'));assert.ok(audit.some(r=>r.kind==='ask'&&r.provider==='Acme model'));
});

test('Assistant is a client of the same door: her connector chat gathers its vault context through door evidence and leaves an assistant receipt',async t=>{
 const certPath=path.join(here,'fixtures','test-only-cert.pem'),keyPath=path.join(here,'fixtures','test-only-key.pem');
 const seen=[];
 const stub=https.createServer({cert:fsSync.readFileSync(certPath),key:fsSync.readFileSync(keyPath)},async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks)):null;seen.push({url:req.url,auth:req.headers.authorization,body});res.setHeader('Content-Type','application/json');
  if(req.url==='/api/adamantium/capabilities')return res.end(JSON.stringify({schema:'adamantium.assistant/v1',pkce:'S256'}));
  if(req.url==='/api/adamantium/token')return res.end(JSON.stringify({accessToken:'stub-access',expiresIn:3600}));
  if(req.url==='/api/adamantium/chat')return res.end(JSON.stringify({ok:true,reply:'Alpha has it.'}));
  res.statusCode=404;res.end('{}');});
 stub.listen(0,'127.0.0.1');await once(stub,'listening');t.after(()=>stub.close());
 const d=await boot({env:{ADAMANTIUM_ASSISTANT_ORIGIN:'https://127.0.0.1:'+stub.address().port,NODE_EXTRA_CA_CERTS:certPath}});t.after(d.stop);
 const post=(route,body,cookie)=>fetch(d.base+route,{method:'POST',headers:{Origin:d.base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
 const connect=await post('/api/assistant/connect',{});assert.equal(connect.status,200,await connect.clone().text());const {url}=await connect.json(),binding=/adamantium_connect=([^;]+)/.exec(connect.headers.getSetCookie().join(';'))[1],state=new URL(url).searchParams.get('state');
 const callback=await fetch(d.base+'/assistant/callback?state='+state+'&code=stub-code',{headers:{Cookie:'adamantium_connect='+binding},redirect:'manual'});assert.equal(callback.status,303);const session=/adamantium_assistant=([^;]+)/.exec(callback.headers.getSetCookie().join(';'))[1];
 const chat=await post('/api/assistant/chat',{message:'Where is the doorneedle?',allowSearch:true},'adamantium_assistant='+session);assert.equal(chat.status,200,await chat.clone().text());const answer=await chat.json();
 assert.equal(answer.answer,'Alpha has it.');assert.deepEqual(answer.sources.map(s=>s.path),['Notes/Alpha.md']);
 const sent=seen.find(s=>s.url==='/api/adamantium/chat');assert.equal(sent.auth,'Bearer stub-access');assert.match(sent.body.context,/Doorneedle lives here/);
 const reader=d.mint('director-check','read').token,audit=(await d.call(reader,'GET','/receipts',undefined,{actor:'assistant'})).json.receipts;
 assert.ok(audit.some(r=>r.kind==='evidence'&&r.paths.includes('Notes/Alpha.md')),'her context came through the door, same code path as /ask');
});

test('CLI: every door verb works from one command (any computer)',async t=>{
 const d=await boot();t.after(d.stop);
 const w=d.mint('seat-cli','write'),r=d.mint('seat-cli-r','read');
 assert.ok(!w.stdout.includes(w.token)&&!w.stdout.includes(w.token.split('.')[2]),'mint never prints the token');
 assert.match(await fs.readFile(path.join(d.dataDir,'door-tokens.json'),'utf8'),/seat-cli/);assert.ok(!(await fs.readFile(path.join(d.dataDir,'door-tokens.json'),'utf8')).includes(w.token.split('.')[2]));
 const as=(who,args,extra={})=>d.runCli(args,{ADAMANTIUM_DOOR_TOKEN_FILE:who.file,...extra});
 assert.equal(cliJson(as(w,['routes'])).routes.length,15);
 assert.equal(cliJson(as(w,['status'])).actor,'seat-cli');
 assert.equal(cliJson(as(w,['search','doorneedle','--limit','5'])).hits[0].path,'Notes/Alpha.md');
 assert.equal(cliJson(as(w,['note','Notes/Alpha.md'])).sha256.length,64);assert.match(as(w,['note','Notes/Alpha.md','--text']).stdout,/^# Alpha/);
 assert.ok(cliJson(as(w,['context','Notes/Alpha.md','--depth','2','--max','4000'])).records.length>=3);
 assert.equal(cliJson(as(w,['changed-since','1d'])).total,4);assert.equal(cliJson(as(w,['link-health'])).summary.broken,1);
 const local=path.join(d.root,'in.md');await fs.writeFile(local,'# From CLI\nclineedle text\n');
 const put=cliJson(as(w,['put','Notes/Cli.md','--file',local,'--new']));assert.equal(put.actor,'seat-cli');assert.equal(put.sha256,fingerprint('# From CLI\nclineedle text\n'));
 assert.equal(as(w,['put','Notes/Cli.md','--file',local,'--new']).status,1,'second create is refused');assert.equal(as(w,['put','Notes/Cli.md','--file',local]).status,1,'must say --new or --expected');
 assert.equal(cliJson(as(w,['put','Notes/Cli.md','--file',local,'--expected',put.sha256])).previousHash,put.sha256);
 const res=cliJson(as(w,['results','AGENT1','--file',local,'--date',DAY]));assert.equal(res.path,`Log/${DAY}/AGENT1-RESULTS-${DAY}.md`);
 assert.equal(cliJson(as(w,['decision','Yes to the door','--topic','cli test','--date',DAY,'--time','13:07'])).kind,'decision');
 assert.equal(as(r,['put','Notes/X.md','--file',local,'--new']).status,1,'a read token cannot write');
 const via=spawnSync(process.execPath,[cli,'door','results','STDIN1','--stdin','--date',DAY],{env:{...d.env2,ADAMANTIUM_DOOR_TOKEN_FILE:w.file},input:'# from stdin\n',encoding:'utf8'});assert.equal(JSON.parse(via.stdout).bytes,13);
 assert.ok(cliJson(as(w,['receipts','--actor','seat-cli'])).receipts.length>=5);assert.deepEqual(cliJson(as(w,['models'])).models,[]);
 const project=path.join(d.root,'cliproj');await fs.mkdir(project);await fs.writeFile(path.join(project,'m.js'),'export function onlyone(){return 1;}\n');
 assert.equal(cliJson(as(w,['code-scan',project])).started,true);await d.until(async()=>(await (await fetch(d.base+'/api/project/status')).json()).phase==='complete','scan');
 assert.equal(cliJson(as(w,['code','onlyone'])).symbols[0].path,'m.js');
 const stub=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(req.url.endsWith('/models')?JSON.stringify({data:[{id:'m1'}]}):JSON.stringify({choices:[{message:{content:'ok [1]'}}]}));});stub.listen(0,'127.0.0.1');await once(stub,'listening');t.after(()=>stub.close());
 const card=path.join(d.root,'card.json');await fs.writeFile(card,JSON.stringify({schema:'adamantium.ai/v1',name:'CLI model',model:'m1',endpoint:'http://127.0.0.1:'+stub.address().port+'/v1'}));
 const asyncAs=(who,args,extra={})=>d.runCliAsync(args,{ADAMANTIUM_DOOR_TOKEN_FILE:who.file,...extra});
 const attached=cliJson(await asyncAs(w,['attach','--card',card],{ADAMANTIUM_MODEL_KEY:'k'}));const asked=cliJson(await asyncAs(w,['ask','Where is doorneedle?','--connection',attached.id,'--consent']));assert.equal(asked.answer,'ok [1]');assert.equal((await asyncAs(w,['ask','Where is doorneedle?','--connection',attached.id])).status,1,'ask needs --consent');
 assert.equal(cliJson(as(w,['tokens'])).tokens.length,2);
 assert.equal(cliJson(d.runCli(['revoke','seat-cli'])).revoked,1);assert.equal(as(w,['status']).status,1,'a revoked token is refused at once, no restart');
 assert.equal(spawnSync(process.execPath,[cli,'door','status'],{env:{...d.env2,ADAMANTIUM_DOOR_TOKEN:'',ADAMANTIUM_DOOR_TOKEN_FILE:path.join(d.root,'nope.token')},encoding:'utf8'}).status,1);
});

// Door defect 1: a Windows 8.3 short name (GIT~1) must not slip past the hidden-folder refusal.
const shortNameOf=dir=>{const r=spawnSync('cmd.exe',['/d','/s','/c','"for %I in ("'+dir+'") do @echo %~sI"'],{encoding:'utf8',windowsHide:true,windowsVerbatimArguments:true});return path.basename(String(r.stdout||'').trim());};
test('Door defect 1: the short-name form of a hidden folder is refused for write and read',{skip:process.platform!=='win32'&&'8.3 short names exist only on Windows'},async t=>{
 const d=await boot();t.after(d.stop);const writer=d.mint('seat-w','write').token,reader=d.mint('seat-r','read').token;
 await fs.mkdir(path.join(d.vault,'.gitprobe'),{recursive:true});await fs.writeFile(path.join(d.vault,'.gitprobe','Hidden.md'),'# hidden\n');
 const short=shortNameOf(path.join(d.vault,'.gitprobe'));
 assert.match(short,/~\d/,'this volume gave the hidden folder a short name, so the test is real: '+short);assert.ok(!short.startsWith('.'),'the short name does not start with a dot (that is the bypass)');
 for(const form of [short,short.toLowerCase()]){
  const w=await d.call(writer,'POST','/note',{path:form+'/ZZ8dot3.md',body:'# x\n',expectedHash:null});
  assert.equal(w.status,403,'write through '+form+' refused');
  assert.equal(fsSync.existsSync(path.join(d.vault,'.gitprobe','ZZ8dot3.md')),false,'nothing landed in the hidden folder');
  const r=await d.call(reader,'GET','/note',undefined,{path:form+'/Hidden.md'});assert.equal(r.status,403,'read through '+form+' refused');
 }
 const lookalike=await d.call(writer,'POST','/note',{path:'GIT~9/ZZ.md',body:'x',expectedHash:null});assert.equal(lookalike.status,403,'a short-form folder that resolves to nothing is refused, not created');assert.equal(fsSync.existsSync(path.join(d.vault,'GIT~9')),false);
 const ok=await d.call(writer,'POST','/note',{path:'Notes/Fine.md',body:'# fine\n',expectedHash:null});assert.equal(ok.status,200,'ordinary paths still work');
 const {VaultWorkspace}=await import('../vault-workspace.mjs');
 assert.throws(()=>new VaultWorkspace(d.vault,{writable:true}).write({path:short+'/Direct.md',body:'x',expectedHash:null}),/Hidden folders/,'the workspace refuses it too, not only the door');
 assert.equal(fsSync.existsSync(path.join(d.vault,'.gitprobe','Direct.md')),false);
});

// Door defect 2: the stale-write 409 carries the file's current hash so the caller can re-read and retry.
test('Door defect 2: a stale write 409 returns the current hash and the whole retry works',async t=>{
 const d=await boot();t.after(d.stop);const a=d.mint('seat-a','write').token,b=d.mint('seat-b','write').token;
 const created=await d.call(a,'POST','/note',{path:'Notes/Race.md',body:'# Race\none\n',expectedHash:null});assert.equal(created.status,200);
 const read1=(await d.call(a,'GET','/note',undefined,{path:'Notes/Race.md'})).json;assert.equal(read1.sha256,created.json.sha256);
 const other=await d.call(b,'POST','/note',{path:'Notes/Race.md',body:'# Race\ntwo (seat b)\n',expectedHash:read1.sha256});assert.equal(other.status,200);
 const stale=await d.call(a,'POST','/note',{path:'Notes/Race.md',body:'# Race\nthree (seat a)\n',expectedHash:read1.sha256});
 assert.equal(stale.status,409);assert.equal(stale.json.currentHash,other.json.sha256,'the 409 carries the file\'s current sha256');
 assert.ok(stale.json.error.includes(other.json.sha256),'and the message names it');
 assert.equal(await fs.readFile(path.join(d.vault,'Notes','Race.md'),'utf8'),'# Race\ntwo (seat b)\n','the refused write changed nothing');
 const read2=(await d.call(a,'GET','/note',undefined,{path:'Notes/Race.md'})).json;assert.equal(read2.sha256,stale.json.currentHash,'re-reading gives the hash the 409 promised');
 const retry=await d.call(a,'POST','/note',{path:'Notes/Race.md',body:'# Race\nthree (seat a)\n',expectedHash:stale.json.currentHash});assert.equal(retry.status,200);assert.equal(retry.json.previousHash,other.json.sha256);
 assert.equal(await fs.readFile(path.join(d.vault,'Notes','Race.md'),'utf8'),'# Race\nthree (seat a)\n');
 const again=await d.call(a,'POST','/note',{path:'Notes/Race.md',body:'x',expectedHash:null});assert.equal(again.status,409);assert.equal(again.json.currentHash,retry.json.sha256,'creating over an existing file also names the current hash');
});
