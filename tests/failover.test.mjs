import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {ActivityBus} from '../activity.mjs';
import {AiWorkspace} from '../intelligence.mjs';
import {FailoverExhausted,isFallbackTrigger,ProviderError,reasonOf,textOnly,DEAD_MS} from '../failover.mjs';

// Assistant's rules (app/message_failover.py + app/model_router.py), restated as tests. Fake providers only: no paid call.
const card=(name,port)=>({schema:'adamantium.ai/v1',name,model:name.toLowerCase()+'-model',endpoint:`http://127.0.0.1:${port}/v1`});
const refusedConnection=()=>Object.assign(new TypeError('fetch failed'),{cause:Object.assign(Error('connect ECONNREFUSED 127.0.0.1:9 with Bearer SECRET-A'),{code:'ECONNREFUSED'})});
const timedOut=()=>Object.assign(new Error('The operation was aborted due to timeout'),{name:'TimeoutError'});
const ANSWER={ok:'ok'};
// script[port] is a list of behaviours consumed per chat call: 'ok', a status number, {status,text}, {throw:Error}.
function rig(ports,script,{keys={},clock}={}){
  const calls=[],logs=[],receipts=[],t={now:Date.now()};
  const fetcher=async(url,options)=>{
    const port=Number(new URL(url).port);
    if(url.endsWith('/models'))return {ok:true,json:async()=>({data:[{id:Object.values(models)[ports.indexOf(port)]}]})};
    const sent=JSON.parse(options.body);calls.push({port,sent,authorization:options.headers.Authorization||null});
    const step=(script[port]||['ok']).length>1?script[port].shift():script[port][0];
    if(step&&step.throw)throw step.throw;
    if(step==='ok'||step===undefined){const text='Answer from '+port;return {ok:true,status:200,json:async()=>({choices:[{message:{content:text}}],usage:{prompt_tokens:1,completion_tokens:1}}),text:async()=>text};}
    const status=typeof step==='number'?step:step.status,text=typeof step==='number'?'provider says no':step.text;
    return {ok:false,status,text:async()=>text,json:async()=>({error:text})};
  };
  const names=ports.map((p,i)=>'P'+(i+1)),models={};ports.forEach((p,i)=>models[names[i]]=names[i].toLowerCase()+'-model');
  const ai=new AiWorkspace({bus:new ActivityBus(),document:id=>id===1?{id:1,title:'Company',path:'company.md',body:'Assistant uses Adamantium.'}:null,search:()=>[],fetcher,failover:{log:l=>logs.push(l),now:clock||(()=>t.now)}});
  ai.receipt=r=>receipts.push(r);
  const attach=async()=>{const ids=[];for(let i=0;i<ports.length;i++)ids.push((await ai.attach(card(names[i],ports[i]),keys[ports[i]]||'')).id);return ids;};
  return {ai,calls,logs,receipts,attach,t};
}
const A=1111,B=2222,C=3333;

test('rules: what counts as a trigger, and the reason given for it',()=>{
  const http=(status,creditWords=false)=>new ProviderError('http',status,creditWords);
  for(const s of [401,402,403,429,500,502,503])assert.equal(isFallbackTrigger(http(s)),true,String(s));
  assert.equal(isFallbackTrigger(http(400,true)),true,'a 400 that names credit');
  for(const s of [400,404,422])assert.equal(isFallbackTrigger(http(s)),false,'a refused shape is not a dead provider: '+s);
  assert.equal(isFallbackTrigger(new ProviderError('timeout')),true);assert.equal(isFallbackTrigger(new ProviderError('network')),true);
  assert.equal(isFallbackTrigger(new Error('bug')),false);
  assert.deepEqual([402,429,503,401].map(s=>reasonOf(http(s))),['out of credit','rate limit','server error','auth']);
  assert.equal(reasonOf(new ProviderError('timeout')),'timeout');assert.equal(reasonOf(new ProviderError('network')),'connection refused');
  assert.equal(DEAD_MS,600000,'a dead provider is remembered for ten minutes, as Assistant does');
});

test('first provider out of credit: the second answers, and the switch is a receipt with who, which, and why',async()=>{
  const r=rig([A,B],{[A]:[402],[B]:['ok']}),[a]=await r.attach();
  const result=await r.ai.chat({connectionId:a,message:'Hello',actor:'seat-test'});
  assert.equal(result.answer,'Answer from 2222');assert.equal(result.ai,'P2');
  assert.deepEqual(r.calls.map(c=>c.port),[A,B]);assert.equal(r.calls[1].sent.model,'p2-model','each provider gets its own model name');
  const switched=r.receipts.filter(x=>x.kind==='model-switch');assert.equal(switched.length,1);
  assert.deepEqual({actor:switched[0].actor,site:switched[0].site,tried:switched[0].tried.name,reason:switched[0].reason,to:switched[0].movedOnTo.name},{actor:'seat-test',site:'ask-with-tools',tried:'P1',reason:'out of credit',to:'P2'});
  assert.ok(r.logs.some(l=>l.startsWith('MODEL_SWITCH')));
});

test('a 400 that names credit is out-of-credit (moves on); rate limit, server error, timeout and refused connection all move on',async()=>{
  const cases=[['400 credit',{status:400,text:'Your credit balance is too low'},'out of credit'],['429',429,'rate limit'],['503',503,'server error'],['timeout',{throw:timedOut()},'timeout'],['refused',{throw:refusedConnection()},'connection refused']];
  for(const [label,step,reason] of cases){
    const r=rig([A,B],{[A]:[step],[B]:['ok']}),[a]=await r.attach();
    const result=await r.ai.chat({connectionId:a,message:'Hello'});
    assert.equal(result.ai,'P2',label);assert.equal(r.calls.filter(c=>c.port===A).length,1,label+': no text-only retry for a dead provider');
    assert.equal(r.receipts.find(x=>x.kind==='model-switch').reason,reason,label);
  }
});

test('a refused request shape gets ONE text-only retry on the same provider, then the call moves on',async()=>{
  const search={type:'function',function:{name:'search_vault',parameters:{type:'object'}}};
  const r=rig([A,B],{[A]:[{status:400,text:'tools are not supported'},'ok'],[B]:['ok']}),[a]=await r.attach();
  const flat=await r.ai.post({connectionId:a,site:'ask-with-tools',timeoutMs:1000,body:{messages:[{role:'user',content:'q'},{role:'assistant',content:null,tool_calls:[{id:'1'}]},{role:'tool',tool_call_id:'1',content:'{"hit":1}'}],tools:[search],stream:false}});
  assert.equal(flat.connection.name,'P1','answered by the same provider');
  assert.deepEqual(r.calls.map(c=>c.port),[A,A]);assert.ok(r.calls[0].sent.tools);assert.equal('tools' in r.calls[1].sent,false,'the retry has no tools');
  assert.deepEqual(r.calls[1].sent.messages.map(m=>m.role),['user','user'],'a flat text history: the tool result is carried as text');
  assert.ok(r.receipts.some(x=>x.kind==='model-text-only-retry'&&x.tried.name==='P1'));assert.equal(r.receipts.filter(x=>x.kind==='model-switch').length,0);
  const both=rig([A,B],{[A]:[{status:400,text:'no'}],[B]:['ok']}),[a2]=await both.attach();
  const moved=await both.ai.post({connectionId:a2,site:'ask-with-tools',timeoutMs:1000,body:{messages:[{role:'user',content:'q'}],tools:[search]}});
  assert.equal(moved.connection.name,'P2');assert.deepEqual(both.calls.map(c=>c.port),[A,A,B],'exactly one retry, then the next provider');
  assert.equal(both.receipts.find(x=>x.kind==='model-switch').reason,'refused request shape');
  assert.deepEqual(textOnly({model:'x',tools:[1],tool_choice:'auto',messages:[{role:'user',content:[{type:'text',text:'hi'},{type:'image_url',image_url:{url:'data:'}}]}]}),{model:'x',messages:[{role:'user',content:'hi'}]});
});

test('every provider spent: one clear line for the owner, a FAILOVER_EXHAUSTED event, never an empty or invented answer',async()=>{
  const r=rig([A,B,C],{[A]:[402],[B]:[429],[C]:[{throw:refusedConnection()}]}),[a]=await r.attach();
  await assert.rejects(r.ai.chat({connectionId:a,message:'Hello',actor:'owner'}),e=>{
    assert.ok(e instanceof FailoverExhausted);assert.equal(e.code,'FAILOVER_EXHAUSTED');assert.equal(e.status,503);
    assert.doesNotMatch(e.message,/\n/,'one line');assert.match(e.message,/None of your connected AI providers could answer/);
    assert.match(e.message,/P1: out of credit; P2: rate limit; P3: connection refused/);return true;});
  const event=r.receipts.find(x=>x.kind==='FAILOVER_EXHAUSTED');assert.ok(event);assert.equal(event.actor,'owner');assert.equal(event.outcomes.length,3);
  assert.ok(r.logs.some(l=>l.startsWith('FAILOVER_EXHAUSTED')));
  assert.equal(r.receipts.filter(x=>x.kind==='model-switch').at(-1).movedOnTo,'none left');
});

test('a dead provider is remembered and skipped until its ten minutes are up',async()=>{
  const r=rig([A,B],{[A]:[402,'ok'],[B]:['ok']}),[a]=await r.attach();
  await r.ai.chat({connectionId:a,message:'one'});assert.deepEqual(r.calls.map(c=>c.port),[A,B]);
  r.t.now+=9*60*1000;const second=await r.ai.chat({connectionId:a,message:'two'});
  assert.deepEqual(r.calls.map(c=>c.port),[A,B,B],'A was not even called while it is remembered as down');assert.equal(second.ai,'P2');
  r.t.now+=2*60*1000;const third=await r.ai.chat({connectionId:a,message:'three'});
  assert.deepEqual(r.calls.map(c=>c.port),[A,B,B,A],'time is up: A is tried again, and answers');assert.equal(third.ai,'P1');
  const stored=JSON.stringify([...r.ai.failover.down.values()]);assert.doesNotMatch(stored,/provider says no/,'only status and reason are kept, never the provider text');
});

test('the chosen connection is tried first, the rest in the order they were attached',async()=>{
  const r=rig([A,B,C],{[C]:[402],[A]:[500],[B]:['ok']}),[,,c]=await r.attach();
  const result=await r.ai.chat({connectionId:c,message:'Hello'});
  assert.deepEqual(r.calls.map(x=>x.port),[C,A,B]);assert.equal(result.ai,'P2');
});

test('all call sites switch: knowledge graph, labels and summaries, ask with tools, and the door ask',async()=>{
  const graphJson=JSON.stringify({entities:[{id:'a',name:'Assistant'},{id:'b',name:'Adamantium'}],relations:[{source:'a',target:'b',relation:'uses',documentId:1,quote:'Assistant uses Adamantium.',confidence:.9}]});
  const sites={};
  const run=async(name,fn,okText)=>{
    const r=rig([A,B],{[A]:[402],[B]:['ok']}),[a]=await r.attach();
    if(okText){const original=r.ai.fetcher;r.ai.fetcher=async(u,o)=>{const res=await original(u,o);return !u.endsWith('/models')&&res.ok?{...res,json:async()=>({choices:[{message:{content:okText}}]})}:res;};}
    const out=await fn(r.ai,a);sites[name]=r.receipts.find(x=>x.kind==='model-switch');assert.deepEqual(r.calls.map(c=>c.port),[A,B],name);return out;
  };
  const graph=await run('knowledge-graph',(ai,a)=>ai.extract({connectionId:a,documentIds:[1],allowContext:true,actor:'k'}),graphJson);
  assert.equal(graph.edges.length,1);assert.equal(graph.edges[0].origin,'model-inferred');
  const labels=await run('labels-and-summaries',(ai,a)=>ai.complete({connectionId:a,allowContext:true,user:'label this',actor:'l'}));
  assert.equal(labels.provider,'P2');assert.equal(labels.model,'p2-model');
  await run('ask-with-tools',(ai,a)=>ai.chat({connectionId:a,message:'hi',actor:'c'}));
  const asked=await run('door-ask',(ai,a)=>ai.ask({connectionId:a,messages:[{role:'user',content:'q'}],actor:'d'}));
  assert.equal(asked.connection.name,'P2');assert.equal(asked.switched,true);
  assert.deepEqual(Object.entries(sites).map(([k,v])=>[k,v.site,v.actor]),[['knowledge-graph','knowledge-graph','k'],['labels-and-summaries','labels-and-summaries','l'],['ask-with-tools','ask-with-tools','c'],['door-ask','door-ask','d']]);
});

test('a tool round can switch providers mid-conversation; the later rounds use the provider that answered',async()=>{
  const r=rig([A,B],{[A]:['ok'],[B]:['ok']}),[a]=await r.attach();
  let round=0;const original=r.ai.fetcher;
  r.ai.fetcher=async(u,o)=>{if(u.endsWith('/models'))return original(u,o);const port=Number(new URL(u).port);round++;
    if(round===1)return {ok:true,json:async()=>({choices:[{message:{content:null,tool_calls:[{id:'t1',function:{name:'search_vault',arguments:'{"query":"x"}'}}]}}]})};
    if(round===2)return {ok:false,status:429,text:async()=>'slow down'};
    return {ok:true,json:async()=>({choices:[{message:{content:'Final from '+port}}]})};};
  r.ai.search=()=>[];
  const result=await r.ai.chat({connectionId:a,message:'look',allowSearch:true});
  assert.equal(result.answer,'Final from 2222');assert.equal(result.ai,'P2');assert.equal(result.trace[0].tool,'search_vault');
});

test('no key in any output: receipts, log lines, errors, responses, saved memory',async()=>{
  const keys={[A]:'SECRET-A-KEY-123',[B]:'SECRET-B-KEY-456'},poisoned=Object.keys(keys).map(Number);
  const leak=text=>`error for Bearer ${text}`;
  const r=rig([A,B],{[A]:[{status:402,text:leak(keys[A])}],[B]:[{status:500,text:leak(keys[B])}]},{keys}),[a]=await r.attach();
  const out=[];
  const error=await r.ai.chat({connectionId:a,message:'Hello'}).catch(e=>e);out.push(error.message,JSON.stringify(error.outcomes));
  const timeout=rig([A,B],{[A]:[{throw:refusedConnection()}],[B]:[{throw:Object.assign(Error('timeout talking with SECRET-B-KEY-456'),{name:'TimeoutError'})}]},{keys}),[t]=await timeout.attach();
  const error2=await timeout.ai.chat({connectionId:t,message:'Hello'}).catch(e=>e);out.push(error2.message);
  const ok=rig([A,B],{[A]:[402],[B]:['ok']},{keys}),[o]=await ok.attach();out.push(JSON.stringify(await ok.ai.chat({connectionId:o,message:'Hello'})));
  for(const x of [r,timeout,ok])out.push(JSON.stringify(x.receipts),x.logs.join('\n'),JSON.stringify([...x.ai.failover.down.values()]));
  const attachedView=await ok.ai.attach(card('P2',B),keys[B]);out.push(JSON.stringify(attachedView));
  for(const text of out)for(const secret of Object.values(keys))assert.ok(!String(text).includes(secret),'a key leaked into: '+String(text).slice(0,120));
  assert.ok(r.calls.every(c=>c.authorization===`Bearer ${keys[c.port]}`),'each provider still receives its own key, and only its own');
  assert.ok(poisoned.length===2);
});

test('anything that is not a provider failure is raised, never swallowed or switched over',async()=>{
  const bug=rig([A,B],{[A]:[{throw:new RangeError('our own bug')}],[B]:['ok']}),[a]=await bug.attach();
  await assert.rejects(bug.ai.chat({connectionId:a,message:'Hello'}),/our own bug/);assert.deepEqual(bug.calls.map(c=>c.port),[A]);assert.equal(bug.receipts.length,0);
  const stop=new AbortController(),aborted=rig([A,B],{[A]:[{throw:Object.assign(Error('This operation was aborted'),{name:'AbortError'})}],[B]:['ok']}),[b]=await aborted.attach();
  stop.abort();await assert.rejects(aborted.ai.chat({connectionId:b,message:'Hello',signal:stop.signal}),/aborted/);assert.deepEqual(aborted.calls.map(c=>c.port),[A],'the owner stopped it: no other provider is asked');
  const missing=rig([A],{});await assert.rejects(missing.ai.chat({connectionId:'nope',message:'x'}),/Connect/);
});

test('one connection only: it behaves as before, with a clear line instead of a bare status when it fails',async()=>{
  const r=rig([A],{[A]:['ok']}),[a]=await r.attach();assert.equal((await r.ai.chat({connectionId:a,message:'Hello'})).answer,'Answer from 1111');assert.equal(r.receipts.length,0);
  const down=rig([A],{[A]:[429]}),[d]=await down.attach();await assert.rejects(down.ai.chat({connectionId:d,message:'Hello'}),/None of your connected AI providers could answer/);
});

// --- the real server: the door ask goes through the switcher and the switch lands in the door's own receipt file ---
const freePort=async()=>{const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;};
test('real server: door /ask moves from a dead provider to a live one and the door receipts show it',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'adamantium-failover-')),vault=path.join(root,'vault'),dataDir=path.join(root,'data');
  await fs.mkdir(vault,{recursive:true});await fs.writeFile(path.join(vault,'Home.md'),'# Home\nThe failoverneedle is in Home.\n');
  const stub=(chat)=>{const s=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.url.endsWith('/models'))return res.end(JSON.stringify({data:[{id:'m'}]}));chat(req,res);});return new Promise(r=>s.listen(0,'127.0.0.1',()=>r(s)));};
  const dead=await stub((req,res)=>{res.statusCode=402;res.end(JSON.stringify({error:{message:'insufficient credit SECRET-DEAD'}}));});
  const live=await stub((req,res)=>res.end(JSON.stringify({choices:[{message:{content:'Found it [1].'}}]})));
  const port=await freePort(),server=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','server.mjs'),cli=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','adamantium-cli.mjs');
  let errors='';const child=spawn(process.execPath,[server],{env:{...process.env,PORT:String(port),ADAMANTIUM_VAULT:vault,ADAMANTIUM_DATA_DIR:dataDir,ADAMANTIUM_VAULT_WRITE:'1',ADAMANTIUM_REUSE_INDEX:'0'},stdio:['ignore','pipe','pipe'],windowsHide:true});
  child.stderr.on('data',b=>errors+=b);
  t.after(async()=>{if(child.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}dead.close();live.close();await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(errors||'Startup timeout')),20000);child.once('error',reject);child.stdout.on('data',b=>{if(String(b).includes('Adamantium:')){clearTimeout(timer);resolve();}});});
  const base='http://127.0.0.1:'+port;for(let i=0;i<150;i++){if((await (await fetch(base+'/api/status')).json()).phase==='ready')break;await new Promise(r=>setTimeout(r,100));}
  const tokenFile=path.join(root,'t.token'),mint=spawnSync(process.execPath,[cli,'door','mint','seat-failover','--scope','write','--out',tokenFile],{env:{...process.env,ADAMANTIUM_DATA_DIR:dataDir,ADAMANTIUM_DOOR_URL:base},encoding:'utf8'});assert.equal(mint.status,0,mint.stderr);
  const token=fsSync.readFileSync(tokenFile,'utf8').trim().split(/\s+/).pop();
  const call=async(method,route,body)=>{const r=await fetch(base+'/api/door/v1'+route,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,json:await r.json()};};
  const attach=async(name,srv)=>(await call('POST','/model/attach',{profile:{schema:'adamantium.ai/v1',name,model:'m',endpoint:`http://127.0.0.1:${srv.address().port}/v1`},key:'SECRET-'+name})).json.id;
  const deadId=await attach('Dead one',dead);await attach('Live one',live);
  const asked=await call('POST','/ask',{connectionId:deadId,question:'Where is the failoverneedle?',consent:true});
  assert.equal(asked.status,200,JSON.stringify(asked.json));assert.equal(asked.json.provider,'Live one');assert.equal(asked.json.answer,'Found it [1].');
  const receipts=(await call('GET','/receipts')).json.receipts,switched=receipts.find(r=>r.kind==='model-switch');
  assert.ok(switched,'the switch is in the door receipt log');assert.deepEqual({actor:switched.actor,from:switched.tried.name,why:switched.reason,to:switched.movedOnTo.name},{actor:'seat-failover',from:'Dead one',why:'out of credit',to:'Live one'});
  const onDisk=fsSync.readFileSync(path.join(dataDir,'door-receipts.jsonl'),'utf8');assert.match(onDisk,/model-switch/);assert.doesNotMatch(onDisk+JSON.stringify(asked.json)+errors,/SECRET-/);
});

test('the conversation is never lost: a busy provider (429 with Retry-After) switches at once, with no waiting; and a shape every provider refuses ends in the one clear line',async()=>{
  const r=rig([A,B],{[A]:[{status:429,text:'busy',retryAfter:'120'}],[B]:['ok']}),[a]=await r.attach();
  const started=Date.now(),result=await r.ai.chat({connectionId:a,message:'Hello'});
  assert.equal(result.ai,'P2');assert.ok(Date.now()-started<500,'no waiting on the busy provider');assert.deepEqual(r.calls.map(c=>c.port),[A,B],'one try, then the next provider');
  assert.equal(r.receipts.find(x=>x.kind==='model-switch').reason,'rate limit');
  const refuse=rig([A,B],{[A]:[{status:400,text:'no'}],[B]:[{status:422,text:'no'}]}),[b]=await refuse.attach();
  await assert.rejects(refuse.ai.chat({connectionId:b,message:'Hello'}),e=>e instanceof FailoverExhausted&&/None of your connected AI providers could answer/.test(e.message));
  assert.deepEqual(refuse.calls.map(c=>c.port),[A,A,B,B],'each refused once more as plain text, and then the person is told');
  assert.ok(refuse.receipts.some(x=>x.kind==='FAILOVER_EXHAUSTED'));
});
