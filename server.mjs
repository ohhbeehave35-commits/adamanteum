import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { category, title, targets, resolver, searchExpression, nearest } from './lib.mjs';
import { ActivityBus } from './activity.mjs';
import { AiWorkspace, graphImpact, connectionPath, provenance } from './intelligence.mjs';
import {readPublicPage} from './web-reader.mjs';
import {Worker} from 'node:worker_threads';
import {Organizer} from './organization.mjs';
import {zipDocuments} from './archive.mjs';
import {AssistantConnection,cookie} from './assistant.mjs';
import {validateImage} from './image-input.mjs';
import {sourceHash} from './code-extractor.mjs';
import {QueryPool} from './query-pool.mjs';
import {projectNeighborhood,projectRelations,projectGraphML,projectPath,projectImpact,projectContext} from './project-navigation.mjs';
import {exportGraph} from './graph-export.mjs';
import {baseYaml,parseBase,canvasData} from './vault-views.mjs';
import {VaultWorkspace,markdown,frontmatter,renderTemplate} from './vault-workspace.mjs';
import {importObsidianVault} from './obsidian-import.mjs';
import {createDoor,DOOR_BASE} from './door.mjs';
import {Notebook} from './notebook.mjs';
import {InterpretationStore,communityEvidence,communityPrompt,notePrompt,validateInterpretation,interpretationNote} from './interpretation.mjs';
import {KnowledgeStore,semanticPrompt,validateSemanticGraph,knowledgeGroups,knowledgeGroup,knowledgeEvidence} from './knowledge-graph.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataRoot=process.env.ADAMANTIUM_DATA_DIR?path.resolve(process.env.ADAMANTIUM_DATA_DIR):path.join(root,'.data');
let localConfig={};
try{localConfig=JSON.parse(fs.readFileSync(path.join(dataRoot,'local-config.json'),'utf8').replace(/^\uFEFF/,''));}catch(error){if(error.code!=='ENOENT')throw error;}
const configuredVault=process.env.ADAMANTIUM_VAULT||localConfig.vault;
// With no vault chosen, open the small sample vault that ships with the code (read-only), so a first run shows something real.
if(!configuredVault)console.log('No vault chosen: opening the sample vault in samples/vault. Set ADAMANTIUM_VAULT to your own Markdown or Obsidian folder.');
const vault = path.resolve(configuredVault||path.join(root,'samples','vault'));
const port = Number(process.env.PORT || 4173);
fs.mkdirSync(dataRoot, {recursive: true});
const db = new DatabaseSync(path.join(dataRoot, 'vault.sqlite'));
const knowledge=new KnowledgeStore(path.join(dataRoot,'knowledge.sqlite'));
const interpretations=new InterpretationStore(path.join(dataRoot,'interpretations.sqlite'));
const notebook=new Notebook(path.join(dataRoot,'notebook.sqlite'));
const workspace=new VaultWorkspace(vault,{writable:process.env.ADAMANTIUM_VAULT_WRITE==='1',history:notebook});
let knowledgeImportBusy=false;
async function operateKnowledge(input){
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./knowledge-operation-worker.mjs',import.meta.url),{workerData:{...input,filename:path.join(dataRoot,'knowledge.sqlite')},resourceLimits:{maxOldGenerationSizeMb:1536}});let result,error;
  const timer=setTimeout(()=>{error=Error('Graph operation exceeded its two-minute budget. Source graphs are unchanged.');worker.terminate();},120000);
  worker.on('message',m=>{result=m.result;if(m.error)error=Error(m.error);});worker.on('error',e=>{clearTimeout(timer);reject(e);});worker.on('exit',()=>{clearTimeout(timer);error?reject(error):result?resolve(result):reject(Error('Graph operation stopped before completion.'));});
 });
}
async function importKnowledge(input,options={}){
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./knowledge-import-worker.mjs',import.meta.url),{workerData:{input,...options,filename:path.join(dataRoot,'knowledge.sqlite')},resourceLimits:{maxOldGenerationSizeMb:1024}});let result,error;
  worker.on('message',m=>{result=m.result;if(m.error)error=Error(m.error);});worker.on('error',reject);worker.on('exit',()=>error?reject(error):result?resolve(result):reject(Error('Graph import stopped before completion.')));
 });
}
db.exec(`
 PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS docs (
  id INTEGER PRIMARY KEY, path TEXT UNIQUE, title TEXT, folder TEXT, category TEXT,
  mtime REAL, bytes INTEGER, body TEXT, degree INTEGER DEFAULT 0);
 CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(title, body, content='docs', content_rowid='id');
 CREATE TABLE IF NOT EXISTS edges (source INTEGER, target INTEGER, PRIMARY KEY(source,target));
 CREATE INDEX IF NOT EXISTS edge_target ON edges(target);
 CREATE INDEX IF NOT EXISTS doc_category_degree ON docs(category, degree DESC);
 CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
 CREATE TABLE IF NOT EXISTS doc_metadata(id INTEGER PRIMARY KEY,properties TEXT,tags TEXT);
`);
const previousRoot = db.prepare("SELECT value FROM meta WHERE key='vault'").get()?.value;
if (previousRoot && previousRoot !== vault) throw new Error('This index belongs to a different vault. Use a separate installation/data directory.');
db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run('vault', vault);
const state = {phase:'starting', scanned:0, indexed:0, skipped:0, errors:0, links:0, started:new Date().toISOString(), source: path.basename(vault)};
const count = () => Number(db.prepare('SELECT count(*) n FROM docs').get().n);
const yieldLoop = () => new Promise(r=>setImmediate(r));
const errors = [];
const activity=new ActivityBus();
db.exec('CREATE INDEX IF NOT EXISTS doc_category_recent ON docs(category,mtime DESC); CREATE INDEX IF NOT EXISTS doc_folder_degree ON docs(category,folder,degree DESC,mtime DESC);');
const queryPool=new QueryPool(path.join(dataRoot,'vault.sqlite'));
let vaultWorker=null,vaultWatchTimer=null,vaultWatchPending=false,lastVaultRefresh=0,fullVaultRefresh=true;
const changedVaultPaths=new Set();
function refreshVault(){
 if(vaultWorker){vaultWatchPending=true;return;}
 lastVaultRefresh=Date.now();const background=state.phase==='ready';
 const changedPaths=fullVaultRefresh?null:[...changedVaultPaths];fullVaultRefresh=false;changedVaultPaths.clear();
 state.refresh={phase:'discovering',started:new Date().toISOString()};
 vaultWorker=new Worker(new URL('./vault-index-worker.mjs',import.meta.url),{workerData:{vault,database:path.join(dataRoot,'vault.sqlite'),changedPaths},resourceLimits:{maxOldGenerationSizeMb:1536}});
 let finished=false;
 vaultWorker.on('message',message=>{
  state.refresh=message;
  if(message.phase==='ready'){
   finished=true;Object.assign(state,message,{snapshot:false});
   const receipt=JSON.stringify({...state,vault},null,2);
   fsp.writeFile(path.join(dataRoot,'index-receipt.json.next'),receipt).then(()=>fsp.rename(path.join(dataRoot,'index-receipt.json.next'),path.join(dataRoot,'index-receipt.json'))).catch(e=>{state.receiptError=e.message;});
   activity.emit('vault.refreshed',`Vault refreshed: ${message.changed} changed, ${message.removed} removed from index`,[],{documents:message.documents});
  }else if(!background)Object.assign(state,message);
 });
 vaultWorker.on('error',e=>{state.refresh={phase:'error',error:e.message};if(!background){state.phase='error';state.error=e.message;}});
 vaultWorker.on('exit',()=>{
  vaultWorker=null;if(!finished&&state.refresh.phase!=='error')state.refresh={phase:'error',error:'Background indexer stopped before completion.'};
  if(vaultWatchPending){vaultWatchPending=false;queueVaultRefresh([]);}
 });
}
function queueVaultRefresh(paths=null){
 if(paths===null)fullVaultRefresh=true;else for(const p of paths)changedVaultPaths.add(p);
 if(changedVaultPaths.size>10000){fullVaultRefresh=true;changedVaultPaths.clear();}
 clearTimeout(vaultWatchTimer);vaultWatchTimer=setTimeout(refreshVault,Math.max(3000,30000-(Date.now()-lastVaultRefresh)));vaultWatchTimer.unref();
}
function watchVault(){
 try{
  const watcher=fs.watch(vault,{recursive:true},(event,filename)=>{
   const name=String(filename||'');if(name.split(/[\\/]/).some(p=>p.startsWith('.')||['node_modules','__pycache__'].includes(p)))return;
   if(/\.adamantium-(lock|tmp)$/i.test(name))return;
   if(/\.(md|canvas)$/i.test(name))queueVaultRefresh([name.replaceAll('\\','/')]);else if(event==='rename')queueVaultRefresh();
  });
  state.watching=true;watcher.on('error',error=>{state.watching=false;state.watchError=error.message;watcher.close();});
 }catch(error){state.watching=false;state.watchError=error.message;}
 // Periodic reconciliation also catches dropped filesystem notifications.
 setInterval(queueVaultRefresh,300000).unref();
}
const assistant=new AssistantConnection({bus:activity,origin:process.env.ADAMANTIUM_ASSISTANT_ORIGIN||null});
const organizer=new Organizer(db);
let projectJob={phase:'idle'},projectWorker=null,projectRoot=null,projectWatcher=null,projectWatchTimer=null,watchPending=false,watchError=null;
async function scanProject(directory){
 if(projectWorker)throw Error('A project scan is already running.');
 if(typeof directory!=='string'||!path.isAbsolute(directory))throw Error('Choose an absolute project folder path.');
 const real=await fsp.realpath(directory);
 if(real===path.parse(real).root||real===process.env.USERPROFILE||real===process.env.HOME)throw Error('Choose a project folder, not an entire drive or home directory.');
 if(!(await fsp.stat(real)).isDirectory())throw Error('Choose a folder.');
 if(localConfig.project!==real){
  const nextConfig={...localConfig,project:real},configPath=path.join(dataRoot,'local-config.json');
  await fsp.writeFile(configPath+'.next',JSON.stringify(nextConfig,null,2));await fsp.rename(configPath+'.next',configPath);localConfig=nextConfig;
 }
 if(real!==projectRoot||!projectWatcher){
  projectWatcher?.close();clearTimeout(projectWatchTimer);watchError=null;
  try{
   projectWatcher=fs.watch(real,{recursive:true},(_event,filename)=>{
    const parts=String(filename||'').split(/[\\/]/);
    if(parts.some(p=>p.startsWith('.')||['node_modules','__pycache__','vendor'].includes(p)))return;
    clearTimeout(projectWatchTimer);
    projectWatchTimer=setTimeout(()=>{if(projectWorker)watchPending=true;else scanProject(real).catch(e=>{watchError=e.message;});},1500);
   });
   projectWatcher.on('error',e=>{watchError=e.message;projectWatcher?.close();projectWatcher=null;});
  }catch(e){watchError=e.message;}
 }
 projectRoot=real;projectJob={phase:'extracting',files:0};
 projectWorker=new Worker(new URL('./project-worker.mjs',import.meta.url),{workerData:{directory:real,cacheFile:path.join(dataRoot,'project-cache.json')},resourceLimits:{maxOldGenerationSizeMb:512}});
 projectWorker.on('message',message=>{projectJob=message;activity.emit('project.'+message.phase,'Independent project graph: '+message.phase);});
 projectWorker.on('error',e=>{projectJob={phase:'error',error:e.message};});
 projectWorker.on('exit',()=>{projectWorker=null;if(!['complete','error'].includes(projectJob.phase))projectJob={phase:'error',error:'Project worker stopped before completion.'};if(watchPending){watchPending=false;scanProject(projectRoot).catch(e=>{watchError=e.message;});}});
 return {phase:'extracting'};
}
let organizationJob={phase:'idle'},organizationWorker=null;
function scanStorage(){
 if(organizationWorker)return organizationJob;
 if(state.phase!=='ready')throw Error('Wait for indexing to finish.');
 organizationJob={phase:'comparing'};
 organizationWorker=new Worker(new URL('./organizer-worker.mjs',import.meta.url),{workerData:{database:path.join(dataRoot,'vault.sqlite')},resourceLimits:{maxOldGenerationSizeMb:512}});
 organizationWorker.on('message',message=>{organizationJob=message;activity.emit('organization.'+message.phase,'Storage analysis: '+message.phase);});
 organizationWorker.on('error',e=>{organizationJob={phase:'error',error:e.message};});
 organizationWorker.on('exit',()=>{organizationWorker=null;if(!['complete','error'].includes(organizationJob.phase))organizationJob={phase:'error',error:'Storage worker stopped before completion.'};});
 return organizationJob;
}
let wholeAnalysis={phase:'idle'},analysisWorker=null;
function startAnalysis(){
  if(analysisWorker)return wholeAnalysis;
  if(state.phase!=='ready')throw Error('Wait for indexing to finish before analyzing the whole vault.');
  wholeAnalysis={phase:'reading',started:new Date().toISOString()};
  analysisWorker=new Worker(new URL('./analysis-worker.mjs',import.meta.url),{workerData:{database:path.join(dataRoot,'vault.sqlite')},resourceLimits:{maxOldGenerationSizeMb:512}});
  analysisWorker.on('message',message=>{
    wholeAnalysis={...wholeAnalysis,...message};
    activity.emit('analysis.'+message.phase,'Whole-vault analysis: '+message.phase,message.result?.ranked.slice(0,12).map(n=>n.id)||[]);
    if(message.phase==='complete')try{fs.writeFileSync(path.join(dataRoot,'analysis-receipt.json'),JSON.stringify({...message.result,indexCompleted:state.completed},null,2));}catch(error){wholeAnalysis.receiptError=error.message;}
  });
  analysisWorker.on('error',error=>{wholeAnalysis={phase:'error',error:error.message};});
  analysisWorker.on('exit',code=>{analysisWorker=null;if(wholeAnalysis.phase!=='complete'&&wholeAnalysis.phase!=='error')wholeAnalysis={phase:'error',error:`Analysis worker exited (${code})`};});
  return wholeAnalysis;
}
const ai=new AiWorkspace({bus:activity,knowledge:selection=>knowledgeEvidence(knowledge.get(selection.graphId),selection.nodeId),document:id=>db.prepare('SELECT * FROM docs WHERE id=?').get(id),search:query=>{
  const expression=searchExpression(query);
  if(!expression)return [];
  return db.prepare('SELECT d.id,d.title,d.path FROM search s JOIN docs d ON d.id=s.rowid WHERE search MATCH ? ORDER BY rank LIMIT 12').all(expression);
}});
const door=createDoor({dataRoot,vault,workspace,db,queryPool,projectJob:()=>projectJob,scanProject,afterWrite:changed=>{queueVaultRefresh([changed]);refreshVault();},activity,ai,sourceHash});
async function linkRecords() {
  const all=db.prepare('SELECT id,path FROM docs').all();
  const resolve=resolver(all.map(r=>r.path)), ids=new Map(all.map(r=>[r.path,r.id]));
  const rows=db.prepare("SELECT id,path,body FROM docs WHERE category='records'").all();
  const edge=db.prepare('INSERT OR IGNORE INTO edges VALUES (?,?)');
  for(let start=0;start<rows.length;start+=100){
    db.exec('BEGIN');
    for(const row of rows.slice(start,start+100))for(const target of targets(row.body)){
      const to=ids.get(resolve(row.path,target));
      if(to&&to!==row.id)edge.run(row.id,to);
    }
    db.exec('COMMIT');await yieldLoop();
  }
  db.exec("UPDATE docs SET degree=(SELECT count(*) FROM edges WHERE source=docs.id)+(SELECT count(*) FROM edges WHERE target=docs.id) WHERE category='records'");
  state.links=Number(db.prepare('SELECT count(*) n FROM edges').get().n);
  state.graphReady=true;
}

async function index() {
  state.phase='discovering';
  const files = [], stack = [''];
  while (stack.length) {
    const relative = stack.pop();
    try {
      for (const entry of await fsp.readdir(path.join(vault,relative), {withFileTypes:true})) {
        if (entry.isSymbolicLink() || entry.name.startsWith('.') || /^(node_modules|__pycache__)$/i.test(entry.name)) continue;
        const p = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) stack.push(p);
        else if (entry.isFile()) {state.scanned++; if (/\.md$/i.test(entry.name)) files.push(p);}
      }
    } catch(e) {state.errors++; errors.push({path:relative,error:e.code});}
  }
  // Human-written records become usable before large generated exports.
  files.sort((a,b)=>category(a).localeCompare(category(b)) * -1 || a.localeCompare(b));
  state.total=files.length;
  state.phase='indexing';
  const lookup=db.prepare('SELECT id,mtime,bytes FROM docs WHERE path=?');
  const insert=db.prepare('INSERT INTO docs(path,title,folder,category,mtime,bytes,body) VALUES (?,?,?,?,?,?,?)');
  const update=db.prepare('UPDATE docs SET title=?,folder=?,category=?,mtime=?,bytes=?,body=? WHERE id=?');
  const ftsInsert=db.prepare('INSERT INTO search(rowid,title,body) VALUES (?,?,?)');
  const ftsDelete=db.prepare("INSERT INTO search(search,rowid,title,body) VALUES ('delete',?,?,?)");
  for(let start=0; start<files.length; start+=100) {
    if(!state.graphReady && category(files[start])!=='records')await linkRecords();
    const prepared=await Promise.all(files.slice(start,start+100).map(async p=>{
      try {
        const absolute=path.join(vault,p), old=lookup.get(p), stat=await fsp.stat(absolute);
        if(stat.size>8*1024*1024)return {p,skip:true};
        const changed=!old||old.mtime!==stat.mtimeMs||old.bytes!==stat.size;
        return {p,old,stat,changed,body:changed?await fsp.readFile(absolute,'utf8'):null};
      }catch(e){return {p,error:e.code||e.message};}
    }));
    db.exec('BEGIN');
    try {
      for(const item of prepared) {
        const {p,old,stat,changed,body}=item;
        if(item.error){state.errors++;errors.push({path:p,error:item.error});continue;}
        if(item.skip){state.skipped++;continue;}
        try {
          if(changed) {
            const t=title(body,p), folder=p.includes('/')?p.split('/')[0]:'Home';
            let id;
            if(old) {
              const before=db.prepare('SELECT title,body FROM docs WHERE id=?').get(old.id);
              ftsDelete.run(old.id,before.title,before.body);
              update.run(t,folder,category(p),stat.mtimeMs,stat.size,body,old.id); id=old.id;
            } else id=insert.run(p,t,folder,category(p),stat.mtimeMs,stat.size,body).lastInsertRowid;
            ftsInsert.run(id,t,body);
          }
          state.indexed++;
        } catch(e) {state.errors++; errors.push({path:p,error:e.code||e.message});}
      }
      db.exec('COMMIT');
    } catch(e) {db.exec('ROLLBACK');throw e;}
    await yieldLoop();
  }
  state.phase='linking';
  const rows=db.prepare('SELECT id,path FROM docs').all();
  const resolve=resolver(rows.map(r=>r.path)), ids=new Map(rows.map(r=>[r.path,r.id]));
  const edge=db.prepare('INSERT OR IGNORE INTO edges VALUES (?,?)');
  db.exec('DELETE FROM edges');
  let after=0;
  while(true) {
    const batch=db.prepare('SELECT id,path,body FROM docs WHERE id>? ORDER BY id LIMIT 100').all(after);
    if(!batch.length)break;
    db.exec('BEGIN');
    for(const row of batch) {
      for(const target of targets(row.body)) {
        const p=resolve(row.path,target), to=ids.get(p);
        if(to && to!==row.id) {edge.run(row.id,to);state.links++;}
      }
      after=row.id;
    }
    db.exec('COMMIT');await yieldLoop();
  }
  db.exec('UPDATE docs SET degree=(SELECT count(*) FROM edges WHERE source=docs.id)+(SELECT count(*) FROM edges WHERE target=docs.id)');
  state.phase='ready';state.completed=new Date().toISOString();
  state.links=Number(db.prepare('SELECT count(*) n FROM edges').get().n);
  fs.writeFileSync(path.join(dataRoot,'index-receipt.json'),JSON.stringify({...state,vault,errors},null,2));
  console.log(`INDEX READY: ${count()} documents, ${state.links} links; ${state.errors} errors, ${state.skipped} skipped`);
}
// Obsidian finds an attachment by name anywhere in the vault; the nearest folder wins.
let assetCache={at:0,names:new Map(),building:null};
async function assetNames(){
 if(Date.now()-assetCache.at<120000&&assetCache.names.size)return assetCache.names;
 if(assetCache.building)return assetCache.building;
 assetCache.building=(async()=>{
  const names=new Map(),stack=[''];
  while(stack.length){const dir=stack.pop();let entries;try{entries=await fsp.readdir(path.join(vault,dir),{withFileTypes:true});}catch{continue;}
   for(const e of entries){if(e.isSymbolicLink()||e.name.startsWith('.')||e.name==='node_modules')continue;const p=dir?dir+'/'+e.name:e.name;if(e.isDirectory())stack.push(p);else if(/\.(png|jpe?g|gif|webp|svg)$/i.test(e.name)){const k=e.name.toLowerCase();if(!names.has(k))names.set(k,[]);names.get(k).push(p);}}}
  assetCache={at:Date.now(),names,building:null};return names;
 })();
 return assetCache.building;
}
async function findAsset(relative,source){
 const clean=relative.replaceAll('\\','/').replace(/^\/+/,'');
 for(const candidate of [source?path.posix.join(path.posix.dirname(source),clean):null,clean]){if(!candidate)continue;try{const file=workspace.file(candidate);if(fs.statSync(file).isFile())return file;}catch{}}
 const matches=(await assetNames()).get(path.posix.basename(clean).toLowerCase());if(!matches?.length)return null;
 const best=nearest(source||'',matches)||[...matches].sort()[0];try{return workspace.file(best);}catch{return null;}
}
const json=(res,obj,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj));};
const summaryFields='id,path,title,folder,category,degree,mtime,bytes';
function api(url,res) {
  const q=url.searchParams, scope=['records','generated','archive'].includes(q.get('scope'))?q.get('scope'):'records';
  if(url.pathname==='/api/activity/history')return json(res,activity.events.slice(-30));
  if(url.pathname==='/api/collections')return json(res,organizer.list());
  if(url.pathname==='/api/collection')return json(res,organizer.open(q.get('id')));
  if(url.pathname==='/api/organization/status')return json(res,organizationJob);
  if(url.pathname==='/api/analysis/status')return json(res,wholeAnalysis);
  if(url.pathname==='/api/impact'){
    const id=Number(q.get('id'));
    if(!db.prepare('SELECT id FROM docs WHERE id=?').get(id))return json(res,{error:'Document not found'},404);
    const result=graphImpact(db,id,q.get('depth'));
    activity.emit('analysis.impact',`Traced ${result.nodes.length} connected documents`,result.nodes.slice(0,20).map(n=>n.id));
    return json(res,result);
  }
  if(url.pathname==='/api/path'){
    const result=connectionPath(db,Number(q.get('from')),Number(q.get('to')));
    activity.emit('analysis.path',result.path.length?`Found a ${result.path.length}-document connection path`:'No path found within the search bound',result.path);
    const nodes=result.path.map(id=>db.prepare('SELECT id,path,title,folder,category,mtime,degree FROM docs WHERE id=?').get(id)).filter(Boolean),edges=[];
    for(let i=1;i<result.path.length;i++){const a=result.path[i-1],b=result.path[i];edges.push(...db.prepare('SELECT source,target FROM edges WHERE (source=? AND target=?) OR (source=? AND target=?)').all(a,b,b,a));}
    return json(res,{...result,nodes,edges});
  }
  if(url.pathname==='/api/status')return json(res,{schema:'adamantium.status/v1',vaultId:sourceHash(process.platform==='win32'?vault.toLowerCase():vault),...state,documents:count(),categories:db.prepare('SELECT category,count(*) count FROM docs GROUP BY category').all()});
  if(url.pathname==='/api/groups')return json(res,db.prepare('SELECT folder,count(*) count FROM docs WHERE category=? GROUP BY folder ORDER BY count DESC').all(scope));
  if(url.pathname==='/api/search') {
    const expression=searchExpression(q.get('q')||'');
    const folder=q.get('folder'), params=[scope], clause=folder?' AND folder=?':'';
    if(folder)params.push(folder);
    const rows=expression
      ? db.prepare(`SELECT ${summaryFields.split(',').map(f=>'d.'+f).join(',')} FROM search s JOIN docs d ON d.id=s.rowid WHERE search MATCH ? AND category=?${clause} ORDER BY rank LIMIT 80`).all(expression,...params)
      : db.prepare(`SELECT ${summaryFields} FROM docs WHERE category=?${clause} ORDER BY mtime DESC LIMIT 80`).all(...params);
    activity.emit('search.completed',expression?`Search: ${(q.get('q')||'').slice(0,80)}`:'Loaded recent documents',rows.slice(0,15).map(d=>d.id),{count:rows.length,scope});
    return json(res,rows);
  }
  if(url.pathname==='/api/doc') {
    const doc=db.prepare(`SELECT * FROM docs WHERE id=?`).get(Number(q.get('id')));
    if(!doc)return json(res,{error:'Document not found'},404);
    const connections=db.prepare(`SELECT ${summaryFields.split(',').map(f=>'d.'+f).join(',')}, e.source=? AS outgoing FROM edges e JOIN docs d ON d.id=CASE WHEN e.source=? THEN e.target ELSE e.source END WHERE e.source=? OR e.target=? ORDER BY d.degree DESC LIMIT 100`).all(doc.id,doc.id,doc.id,doc.id);
    activity.emit('document.read',`Opened ${doc.title.slice(0,100)}`,[doc.id],{path:doc.path});
    return json(res,{...doc,connections,provenance:provenance(doc)});
  }
  if(url.pathname==='/api/graph') {
    const limit=Math.max(30,Math.min(900,Number(q.get('limit'))||500)), focus=Number(q.get('focus')), folder=q.get('folder');
    let nodes;
    if(focus) {
      nodes=db.prepare(`SELECT ${summaryFields} FROM docs WHERE id=? OR id IN (SELECT target FROM edges WHERE source=? UNION SELECT source FROM edges WHERE target=?) ORDER BY (id=?) DESC,degree DESC LIMIT ?`).all(focus,focus,focus,focus,limit);
    } else {
      nodes=db.prepare(`SELECT ${summaryFields} FROM docs WHERE category=? ${folder?'AND folder=?':''} ORDER BY degree DESC,mtime DESC LIMIT ?`).all(...(folder?[scope,folder,limit]:[scope,limit]));
    }
    const set=new Set(nodes.map(n=>n.id)), edges=[];
    const getEdges=db.prepare('SELECT source,target FROM edges WHERE source=?');
    for(const n of nodes)for(const e of getEdges.all(n.id))if(set.has(e.target))edges.push(e);
    activity.emit('graph.loaded',`Mapped ${nodes.length} documents and ${edges.length} links`,nodes.slice(0,8).map(n=>n.id),{scope,focus:focus||null});
    return json(res,{nodes,edges,scope,focus:focus||null,total:count(),limit});
  }
  return json(res,{error:'Not found'},404);
}
async function readBody(req,maximum=150000,raw=false){
  if(!String(req.headers['content-type']||'').startsWith('application/json'))throw Error('JSON content type required.');
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;if(size>maximum)throw Error('Request exceeds the permitted size.');chunks.push(chunk);}
  const body=Buffer.concat(chunks).toString('utf8');return raw?body:JSON.parse(body);
}
const server=http.createServer(async(req,res)=>{
  const host=req.headers.host;
  if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host))return json(res,{error:'Invalid host'},403);
  if(req.headers.origin && ![`http://127.0.0.1:${port}`,`http://localhost:${port}`].includes(req.headers.origin))return json(res,{error:'Cross-origin request refused'},403);
  try {
    const url=new URL(req.url,`http://${host}`);
    if(url.pathname===DOOR_BASE||url.pathname.startsWith(DOOR_BASE+'/'))if(await door.handle(req,res,url,{json,readBody}))return;
    if(url.pathname.startsWith('/api/workspace/')){
      const action=url.pathname.slice('/api/workspace/'.length);
      if(req.method==='GET'){
        if(action==='asset'){
          const relative=String(url.searchParams.get('path')||''),extension=path.extname(relative).toLowerCase(),mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml'}[extension];
          if(!mime)throw Error('Unsupported inline image');
          const file=await findAsset(relative,url.searchParams.get('source')||'');if(!file)return json(res,{error:'Image not found'},404);
          if(fs.statSync(file).size>16*1024*1024)throw Error('Image exceeds 16 MiB');
          res.setHeader('Content-Type',mime);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; sandbox");return res.end(fs.readFileSync(file));
        }
        if(action==='settings')return json(res,{writable:workspace.writable,...workspace.settings()});
        if(action==='obsidian-import'){
          const before=workspace.importedSettings().importedAt;
          const report=importObsidianVault(vault,{write:workspace.writable});
          if(workspace.writable&&report.hasObsidian&&report.settings?.importedAt!==before)queueVaultRefresh();
          return json(res,report);
        }
        if(action==='file')return json(res,workspace.read(url.searchParams.get('path')));
        const pooled=async kind=>{const {result}=await queryPool.run(kind,Object.fromEntries(url.searchParams));return json(res,result);};
        if(action==='base'){if(url.searchParams.get('file')){const file=workspace.read(url.searchParams.get('file'));{const {result}=await queryPool.run('base',{pageSize:'500',...Object.fromEntries(url.searchParams),all:'1',ignore:JSON.stringify(workspace.excludedFiles()),config:JSON.stringify(parseBase(file.raw))});return json(res,{...result,file:file.path,sha256:file.sha256});}}return await pooled('base');}
        if(action==='bases')return json(res,workspace.bases());
        if(action==='health'||action==='changes'||action==='tags'||action==='properties')return await pooled(action);
        if(action==='bookmarks'){let obsidian=[];try{obsidian=workspace.obsidianBookmarks();}catch{}try{return json(res,{...workspace.read('Adamantium-bookmarks.json'),obsidian});}catch{return json(res,{body:'[]',sha256:null,obsidian});}}
        if(action==='resolve')return await pooled('resolve');
        if(action==='template'){const found=workspace.templates().find(t=>t.path===url.searchParams.get('path'));if(!found)throw Error('Template not found.');return json(res,{body:renderTemplate(found.body,{title:url.searchParams.get('title')||'',...workspace.templateFormats()})});}
        if(action==='templates')return json(res,workspace.templates());
      }
      if(req.method==='POST'){
        if(!req.headers.origin)return json(res,{error:'A same-origin browser request is required'},403);
        const input=await readBody(req,1200000);let result;
        if(action==='save'){if(/\.canvas$/i.test(String(input.path)))canvasData(input.body);let original=null;if(/\.md$/i.test(String(input.path))){try{original=frontmatter(workspace.read(input.path).raw);}catch{}}result=workspace.write({...input,body:/\.md$/i.test(String(input.path))?markdown(input.body,input.properties||{},original):input.body});}
        else if(action==='base-save'){result=workspace.write({path:input.path,body:baseYaml(input.config||{}),expectedHash:input.expectedHash??null});}
        else if(action==='daily')result=workspace.daily(input.date);
        else throw Error('Unknown workspace action');
        if(/\.(md|canvas)$/i.test(String(result.path)))queueVaultRefresh([result.path]);refreshVault();return json(res,result);
      }
      throw Error('Unknown workspace action');
    }
    // Notes and code in one place: which code files a note mentions, and which notes mention a code file.
    if(req.method==='GET'&&url.pathname==='/api/vault/code-links'){
      if(!projectJob.result)throw Error('Scan a project first (Code graph), then ask again.');
      const notePath=String(url.searchParams.get('path')||''),doc=db.prepare('SELECT body FROM docs WHERE path=?').get(notePath);
      if(!doc)throw Error('Note not found.');
      const files=new Map(projectJob.result.nodes.filter(n=>n.kind==='file').map(n=>[n.path,n])),found=new Map();
      for(const m of doc.body.slice(0,400000).matchAll(/[A-Za-z0-9_.\/-]{3,200}\.[A-Za-z0-9]{1,8}/g)){const p=m[0].replace(/^\.\//,''),n=files.get(p);if(n&&!found.has(p))found.set(p,n);}
      return json(res,{note:notePath,project:projectJob.result.source,files:[...found.values()].slice(0,100).map(n=>({id:n.id,path:n.path,line:n.line}))});
    }
    if(req.method==='GET'&&url.pathname==='/api/vault/notes-for-code'){
      const file=String(url.searchParams.get('file')||'').trim();if(!file||file.length>300)throw Error('Enter a code file path.');
      const rows=db.prepare("SELECT d.id,d.path,d.title FROM search s JOIN docs d ON d.id=s.rowid WHERE search MATCH ? AND d.category='records' LIMIT 60").all('"'+file.replaceAll('"','""')+'"');
      return json(res,{file,notes:rows});
    }
    if(req.method==='POST'&&url.pathname==='/api/knowledge/operate'){
      if(!req.headers.origin)return json(res,{error:'A same-origin browser request is required'},403);
      if(knowledgeImportBusy)throw Error('Another graph operation is running.');
      const input=await readBody(req);knowledgeImportBusy=true;
      try{return json(res,await operateKnowledge({action:input.action,ids:input.ids,title:input.title}));}finally{knowledgeImportBusy=false;}
    }
    if(req.method==='GET'&&url.pathname.startsWith('/api/notebook')){
      const id=url.searchParams.get('id');
      if(url.pathname==='/api/notebook')return json(res,notebook.list(url.searchParams.get('q')||'',url.searchParams.get('offset')));
      if(url.pathname==='/api/notebook/note')return json(res,notebook.get(id));
      if(url.pathname==='/api/notebook/history')return json(res,notebook.history(id));
      if(url.pathname==='/api/notebook/export'){const output=notebook.export(id);res.setHeader('Content-Type','text/markdown; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="adamantium-note.md"');return res.end(output);}
      throw Error('Unknown notebook action.');
    }
    if(req.method==='POST'&&url.pathname.startsWith('/api/notebook/')){
      if(!req.headers.origin)return json(res,{error:'A same-origin browser request is required'},403);
      const input=await readBody(req,1200000);
      if(url.pathname==='/api/notebook/save')return json(res,notebook.save(input));
      if(url.pathname==='/api/notebook/daily')return json(res,notebook.daily(input.date));
      if(url.pathname==='/api/notebook/restore')return json(res,notebook.restore(input.id,input.fromRevision,input.revision));
      if(url.pathname==='/api/notebook/copy'){
        const doc=db.prepare('SELECT title,body,path FROM docs WHERE id=?').get(input.documentId);if(!doc)throw Error('Source document not found.');
        return json(res,notebook.save({title:doc.title.slice(0,200),body:doc.body,properties:{source:doc.path,sourceHash:sourceHash(doc.body)}}));
      }
      throw Error('Unknown notebook action.');
    }
    if(req.method==='GET'&&url.pathname==='/api/knowledge')return json(res,knowledge.list());
    if(req.method==='GET'&&url.pathname==='/api/knowledge/interpretations')return json(res,interpretations.list({kind:url.searchParams.get('kind'),graph:url.searchParams.get('graph')}).map(({evidence,...r})=>r));
    if(req.method==='GET'&&url.pathname==='/api/knowledge/interpretation-note'){const r=interpretations.get(url.searchParams.get('id'));res.setHeader('Content-Type','text/markdown; charset=utf-8');return res.end(interpretationNote(r));}
    if(req.method==='POST'&&['/api/knowledge/import','/api/knowledge/extract','/api/knowledge/assistant-extract','/api/knowledge/interpret'].includes(url.pathname)){
      if(!req.headers.origin)return json(res,{error:'A same-origin browser request is required'},403);
      if(url.pathname.endsWith('/import')){
        if(knowledgeImportBusy)throw Error('A graph import is already running.');knowledgeImportBusy=true;
        try{return json(res,await importKnowledge(await readBody(req,256*1024*1024,true),{raw:url.searchParams.get('raw')==='1',title:(url.searchParams.get('title')||'Imported graph').slice(0,200)}));}finally{knowledgeImportBusy=false;}
      }
      const input=await readBody(req);
      if(url.pathname.endsWith('/interpret')){
        // Consent gate first: no provider call and nothing saved without explicit approval.
        if(input.allowContext!==true)throw Error('Approve sharing the selected items and the provider cost before the model writes labels or summaries.');
        const made=[];
        if(input.kind==='community'){
          const g=knowledge.get(String(input.graphId));const evidence=communityEvidence(g,input.communityId);
          const call=await ai.complete({connectionId:input.connectionId,allowContext:true,user:communityPrompt(evidence)});
          const checked=validateInterpretation('community',call.content,{evidenceText:JSON.stringify(evidence),allowedNames:new Set(evidence.members.map(m=>m.name))});
          made.push(interpretations.save({...checked,subject:String(evidence.communityKey),graphId:String(input.graphId),graphifyLabel:evidence.graphifyLabel,size:evidence.size,evidence,model:call.model,provider:call.provider,promptTokens:call.promptTokens,completionTokens:call.completionTokens,seconds:call.seconds}));
        }else if(input.kind==='note'){
          if(!Array.isArray(input.documentIds)||!input.documentIds.length||input.documentIds.length>20||input.documentIds.some(id=>!Number.isSafeInteger(id)))throw Error('Choose one to twenty indexed notes.');
          for(const id of [...new Set(input.documentIds)]){
            const doc=db.prepare('SELECT id,path,body FROM docs WHERE id=?').get(id);if(!doc)throw Error('A selected note no longer exists.');
            const call=await ai.complete({connectionId:input.connectionId,allowContext:true,user:notePrompt(doc.path,doc.body)});
            const checked=validateInterpretation('note',call.content,{evidenceText:doc.body.slice(0,6000)});
            made.push(interpretations.save({...checked,subject:doc.path,model:call.model,provider:call.provider,promptTokens:call.promptTokens,completionTokens:call.completionTokens,seconds:call.seconds}));
          }
        }else throw Error('Choose kind community or note.');
        return json(res,{interpretations:made.map(({evidence,...r})=>r),notice:'Interpretations are model-written, labelled as such, and never merged into the graph or the vault as facts.'});
      }
      let graph;
      if(url.pathname.endsWith('/assistant-extract')){
        if(input.allowContext!==true)throw Error('Approve document sharing and provider usage cost before extraction.');
        if(!Array.isArray(input.documentIds)||input.documentIds.length!==1||!Number.isSafeInteger(input.documentIds[0]))throw Error('Assistant extraction accepts one document per request.');
        const id=cookie(req,'adamantium_assistant');if(!assistant.status(id).connected)throw Error('Connect Assistant first.');
        const doc=db.prepare('SELECT id,path,body FROM docs WHERE id=?').get(input.documentIds[0]);if(!doc)throw Error('Selected document no longer exists.');
        doc.sharedBody=doc.body.slice(0,2400);
        const context=JSON.stringify({documentId:doc.id,text:doc.sharedBody});
        if(context.length>3900)throw Error('This excerpt exceeds Assistant’s context limit after encoding. Choose a smaller document.');
        const result=await assistant.chat(id,{message:semanticPrompt([]),context});graph=validateSemanticGraph(result.answer,[doc],'Assistant');
      }else graph=await ai.extract(input);
      const saved=knowledge.save(graph,input.title);return json(res,{...saved,warnings:graph.warnings,rejected:graph.rejected?.length||0});
    }
    if(req.method==='GET'&&url.pathname.startsWith('/api/knowledge/')){
      const graph=knowledge.get(url.searchParams.get('graph')),action=url.pathname.slice('/api/knowledge/'.length),id=url.searchParams.get('id');
      if(action==='view')return json(res,{...projectNeighborhood(graph,{q:url.searchParams.get('q')||'',focus:url.searchParams.get('focus')||''}),directed:graph.directed,warnings:graph.warnings,mode:graph.mode});
      if(action==='context'){res.setHeader('Content-Disposition','attachment; filename="adamantium-context.json"');return json(res,projectContext(graph,id,{strategy:url.searchParams.get('strategy')||'bfs',maxChars:url.searchParams.get('budget')||12000}));}
      if(action==='relations')return json(res,projectRelations(graph,id));
      if(action==='groups')return json(res,knowledgeGroups(graph).map(({members,...g})=>({...g,count:members.length})));
      if(action==='group')return json(res,knowledgeGroup(graph,id));
      if(action==='path')return json(res,projectPath(graph,url.searchParams.get('from'),url.searchParams.get('to'),{types:[...new Set(graph.edges.map(e=>e.type))]}));
      if(action==='export'){
        const format=url.searchParams.get('format')||'json',scope=url.searchParams.get('scope');
        const selected=scope==='view'?url.searchParams.get('group')?knowledgeGroup(graph,url.searchParams.get('group')):{...projectNeighborhood(graph,{q:url.searchParams.get('q')||'',focus:url.searchParams.get('focus')||''}),directed:graph.directed}:graph;
        const output=exportGraph(selected,format);
        res.setHeader('Content-Type',format==='json'||format==='canvas'?'application/json; charset=utf-8':'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition',`attachment; filename="adamantium-knowledge.${format}"`);return res.end(output);
      }
      if(action==='evidence'){
        const edge=graph.edges[Number(url.searchParams.get('edge'))];if(!edge)throw Error('Relationship not found.');
        const doc=edge.path?db.prepare('SELECT id,path,body FROM docs WHERE path=?').get(edge.path):null;
        return json(res,{edge,documentId:doc?.id||null,sourceVerified:!!(doc&&edge.hash&&sourceHash(doc.body)===edge.hash),status:!doc?'Source is not in this vault.':!edge.hash?'Imported source has no content fingerprint.':sourceHash(doc.body)===edge.hash?'Source fingerprint matches.':'Source changed since extraction; re-extract before relying on this claim.'});
      }
      throw Error('Unknown knowledge graph action.');
    }
    if(req.method==='GET'&&url.pathname==='/api/project/status'){
      const {result,...status}=projectJob;return json(res,{...status,watching:!!projectWatcher,watchError,...(result?{files:result.files,nodes:result.nodes.length,edges:result.edges.length,reused:result.reused,issues:result.issues,unresolved:result.unresolved.length,resolvedCalls:result.resolvedCalls||0,unresolvedCalls:result.unresolvedCalls?.length||0,source:result.source,completed:result.completed}: {})});
    }
    if(req.method==='GET'&&url.pathname==='/api/project/graph'){
      if(!projectJob.result)throw Error('Scan a project first.');
      return json(res,projectNeighborhood(projectJob.result,{q:url.searchParams.get('q')||'',focus:url.searchParams.get('focus')||''}));
    }
    if(req.method==='GET'&&url.pathname==='/api/project/relations'){
      if(!projectJob.result)throw Error('Scan a project first.');
      return json(res,projectRelations(projectJob.result,url.searchParams.get('id')));
    }
    if(req.method==='GET'&&url.pathname==='/api/project/path'){
      if(!projectJob.result)throw Error('Scan a project first.');
      return json(res,projectPath(projectJob.result,url.searchParams.get('from'),url.searchParams.get('to')));
    }
    if(req.method==='GET'&&url.pathname==='/api/project/impact'){
      if(!projectJob.result)throw Error('Scan a project first.');
      return json(res,projectImpact(projectJob.result,url.searchParams.get('focus'),{depth:url.searchParams.get('depth')}));
    }
    if(req.method==='GET'&&url.pathname==='/api/project/export'){
      if(!projectJob.result)throw Error('Scan a project first.');
      if(url.searchParams.get('format')==='graphml'){
        res.setHeader('Content-Type','application/graphml+xml; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="adamantium-project.graphml"');return res.end(projectGraphML(projectJob.result));
      }
      res.setHeader('Content-Disposition','attachment; filename="adamantium-project-graph.json"');return json(res,projectJob.result);
    }
    if(req.method==='GET'&&url.pathname==='/api/project/source'){
      const node=projectJob.result?.nodes.find(n=>n.id===url.searchParams.get('id'));if(!node)throw Error('Unknown project source.');
      const resolved=await fsp.realpath(path.join(projectRoot,node.path)),relative=path.relative(projectRoot,resolved);
      if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Source is outside the selected project.');
      if((await fsp.stat(resolved)).size>2*1024*1024)throw Error('Source changed and exceeds read limit.');
      const body=await fsp.readFile(resolved,'utf8');
      if(sourceHash(body)!==node.hash)throw Error('Source changed since extraction. Rescan before reading its indexed location.');
      return json(res,{...node,body:body.split('\n').slice(Math.max(0,node.line-3),Math.min(node.endLine+4,node.line+100)).join('\n')});
    }
    if(req.method==='POST'&&url.pathname==='/api/project/scan'){
      if(!req.headers.origin)return json(res,{error:'A same-origin browser request is required'},403);
      const input=await readBody(req);return json(res,await scanProject(input.directory));
    }
    if(req.method==='POST'&&url.pathname==='/api/project/save'){
      if(!req.headers.origin)return json(res,{error:'A same-origin browser request is required'},403);
      await readBody(req);if(!projectJob.result)throw Error('Complete a native project scan first.');
      const graph={...projectJob.result,mode:'native-code',directed:true,warnings:['Extracted locally from source syntax by Adamantium. No Graphify runtime or model inference. Unresolved calls remain unresolved.']};
      return json(res,knowledge.save(graph,'Native code · '+path.basename(projectRoot)));
    }
    if(req.method==='GET'&&url.pathname==='/api/assistant/status')return json(res,assistant.status(cookie(req,'adamantium_assistant')));
    if(req.method==='GET'&&url.pathname==='/assistant/callback'){
      const id=await assistant.complete({state:url.searchParams.get('state'),code:url.searchParams.get('code'),binding:cookie(req,'adamantium_connect')});
      res.writeHead(303,{'Location':'/','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Set-Cookie':[`adamantium_assistant=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`,'adamantium_connect=; HttpOnly; SameSite=Lax; Path=/assistant/callback; Max-Age=0']});return res.end();
    }
    if(req.method==='POST'&&['/api/assistant/connect','/api/assistant/chat','/api/assistant/disconnect'].includes(url.pathname)){
      if(!req.headers.origin)return json(res,{error:'Same-origin request required'},403);
      const input=await readBody(req),id=cookie(req,'adamantium_assistant');
      if(url.pathname==='/api/assistant/connect'){const result=await assistant.begin();res.setHeader('Set-Cookie',`adamantium_connect=${result.binding}; HttpOnly; SameSite=Lax; Path=/assistant/callback; Max-Age=300`);return json(res,{url:result.url});}
      if(url.pathname==='/api/assistant/disconnect'){await assistant.disconnect(id);res.setHeader('Set-Cookie','adamantium_assistant=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(res,{connected:false});}
      const docs=input.allowContext&&Array.isArray(input.documentIds)?input.documentIds.slice(0,1).map(id=>db.prepare('SELECT id,path,title,body FROM docs WHERE id=?').get(Number(id))).filter(Boolean):[];
      if(!assistant.status(id).connected)throw Error('Connect Assistant first.');
      if(typeof input.message!=='string'||!input.message.trim()||input.message.length>2000)throw Error('Use a message up to 2,000 characters.');
      const trace=[],webSources=[],sources=[],knowledgeSources=[],pieces=[];let contextBytes=0;
      const addContext=(label,text)=>{const part=(label+'\n'+text).slice(0,Math.max(0,Math.min(1200,3900-contextBytes)));if(part.length<=label.length+10)return false;pieces.push(part);contextBytes+=part.length+2;return true;};
      if(input.knowledgeSelection){
        if(input.allowKnowledge!==true)throw Error('Approve sharing the selected knowledge entity before sending it.');
        const evidence=knowledgeEvidence(knowledge.get(input.knowledgeSelection.graphId),input.knowledgeSelection.nodeId);
        if(addContext('Untrusted selected knowledge graph evidence:',JSON.stringify(evidence)))knowledgeSources.push({...input.knowledgeSelection,title:evidence.title});
      }
      if(input.allowSearch){for(const item of await door.evidence({query:input.message,limit:3,actor:'assistant'})){const row=db.prepare('SELECT id,path,title,body FROM docs WHERE path=?').get(item.path);if(row&&!docs.some(d=>d.id===row.id))docs.push(row);}trace.push({tool:'authorized vault search',status:'completed'});activity.emit('assistant.memory.search','Retrieved authorized vault excerpts',docs.map(d=>d.id));}
      if(input.allowSearch&&docs.length>1){
        try{
          const judgment=await assistant.judge(id,{message:input.message,choices:docs.map(d=>({id:String(d.id),label:(d.title+' — '+d.body.slice(0,300)).slice(0,500)}))});
          const picked=docs.findIndex(d=>String(d.id)===judgment.selected);
          if(picked>0)docs.unshift(...docs.splice(picked,1));
          trace.push({tool:'JEV / Decisions relevance routing',status:judgment.selected?'ranked':'local order retained',provider:judgment.provider,latencyMs:judgment.latencyMs});
        }catch{trace.push({tool:'JEV / Decisions relevance routing',status:'unavailable — local search retained'});}
      }
      const urls=input.approvedUrls||[];if(!Array.isArray(urls)||urls.length>3)throw Error('Approve up to three public pages for an Assistant request.');
      for(const url of urls){const page=await readPublicPage(url);if(addContext(`Untrusted public page ${page.url}:`,page.text))webSources.push({url:page.url,title:page.title});trace.push({tool:'read approved web page',status:'completed'});activity.emit('browser.read','Assistant context: read approved public page',[],{url:page.url});}
      for(const d of docs)if(d&&addContext(`Untrusted vault source ${d.id} (${d.path}):`,d.body))sources.push({id:d.id,path:d.path,title:d.title});
      const result=await assistant.chat(id,{message:input.message,context:pieces.join('\n\n'),image:validateImage(input.image,input.allowImage)});
      return json(res,{...result,sources,knowledgeSources,webSources,trace});
    }
    if(req.method==='POST'&&['/api/ai/attach','/api/ai/chat','/api/ai/disconnect','/api/browser/read','/api/analysis/start','/api/collections','/api/organization/scan','/api/archive'].includes(url.pathname)){
      if(!req.headers.origin)return json(res,{error:'A same-origin browser request is required'},403);
      const input=await readBody(req);
      if(url.pathname==='/api/collections')return json(res,organizer.save(input));
      if(url.pathname==='/api/organization/scan')return json(res,scanStorage());
      if(url.pathname==='/api/archive'){
        if(!Array.isArray(input.ids)||input.ids.length<1||input.ids.length>100||input.ids.some(id=>!Number.isSafeInteger(id)))throw Error('Choose up to 100 indexed documents.');
        const documents=[...new Set(input.ids)].map(id=>db.prepare('SELECT id,path,body,mtime FROM docs WHERE id=?').get(id));if(documents.some(d=>!d))throw Error('An export document was not found.');
        const archive=zipDocuments(documents);activity.emit('archive.exported',`Created compressed copy of ${documents.length} documents`,input.ids);
        res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="adamantium-selected-documents.zip"','Cache-Control':'no-store','Content-Length':archive.length});return res.end(archive);
      }
      if(url.pathname==='/api/analysis/start')return json(res,startAnalysis());
      if(url.pathname==='/api/browser/read'){
        const page=await readPublicPage(input.url);
        activity.emit('browser.read','Read public web page',[],{url:page.url});
        return json(res,page);
      }
      if(url.pathname==='/api/ai/attach')return json(res,await ai.attach(input.profile,input.key||''));
      if(url.pathname==='/api/ai/disconnect'){ai.disconnect(input.id);return json(res,{disconnected:true});}
      return json(res,await ai.chat(input));
    }
    if(!['GET','HEAD'].includes(req.method))return json(res,{error:'Source vault is read-only'},405);
    if(url.pathname==='/api/activity')return activity.subscribe(req,res);
    if(url.pathname==='/api/offline-index'){
      const docs=db.prepare('SELECT id,path,title,folder,category,mtime,bytes,degree,substr(body,1,8000) AS body FROM docs ORDER BY mtime DESC LIMIT 8000').all();
      return json(res,{saved:true,generated:new Date().toISOString(),documents:docs.length,docs});
    }
    if(['/api/search','/api/graph','/api/doc','/api/groups'].includes(url.pathname)){
      const kind=url.pathname.slice(5),{result,queryMs}=await queryPool.run(kind,Object.fromEntries(url.searchParams));
      if(result===null)return json(res,{error:'Document not found'},404);
      res.setHeader('Server-Timing',`database;dur=${queryMs.toFixed(2)}`);
      const ids=kind==='doc'?[result.id]:kind==='graph'?result.nodes.slice(0,8).map(n=>n.id):kind==='search'?result.slice(0,15).map(n=>n.id):[];
      activity.emit(kind+'.completed',kind==='doc'?`Opened ${result.title.slice(0,100)}`:kind==='graph'?`Mapped ${result.nodes.length} documents and ${result.edges.length} links`:`${kind}: results ready`,ids,{queryMs:Math.round(queryMs)});
      return json(res,result);
    }
    if(url.pathname.startsWith('/api/'))return api(url,res);
    if(url.pathname==='/assets/adamantium-mark.svg'){
      res.writeHead(200,{'Content-Type':'image/svg+xml','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
      if(req.method==='HEAD')return res.end();
      return fs.createReadStream(path.join(root,'assets','adamantium-mark.svg')).pipe(res);
    }
    const routes={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/graph.js':'graph.js','/projects.js':'projects.js','/arrows.js':'arrows.js','/image-share.js':'image-share.js','/themes.css':'themes.css','/analysis.js':'analysis.js','/organizer.js':'organizer.js','/style.css':'style.css','/manifest.webmanifest':'manifest.webmanifest'};
    routes['/knowledge.js']='knowledge.js';
    routes['/notebook.js']='notebook.js';routes['/reader.js']='reader.js';routes['/vault-tools.js']='vault-tools.js';
    routes['/cell.js']='cell.js';
    routes['/flow.js']='flow.js';
    routes['/phone.css']='phone.css';
    routes['/sw.js']='sw.js';
    routes['/offline-index.js']='offline-index.js';
    const file=routes[url.pathname];if(!file)return json(res,{error:'Not found'},404);
    const headers={'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.webmanifest':'application/manifest+json'})[path.extname(file)],'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
    if(file==='sw.js')headers['Service-Worker-Allowed']='/';
    res.writeHead(200,headers);
    if(req.method==='HEAD')return res.end();
    fs.createReadStream(path.join(root,'dist',file)).pipe(res);
  } catch(e) {json(res,{error:e.message||'Request failed'},400);}
});
server.listen(port,'127.0.0.1',()=>console.log(`Adamantium: http://127.0.0.1:${port}`));
if(localConfig.project)scanProject(localConfig.project).catch(error=>{projectJob={phase:'error',error:'Previous project could not reopen: '+error.message};});
const receiptPath=path.join(dataRoot,'index-receipt.json');
if(process.env.ADAMANTIUM_REUSE_INDEX==='1'&&fs.existsSync(receiptPath)){
  const receipt=JSON.parse(fs.readFileSync(receiptPath,'utf8'));
  if(receipt.vault!==vault)throw Error('Snapshot vault mismatch.');
  for(const key of ['scanned','indexed','skipped','links','total','completed'])state[key]=receipt[key];
  state.phase='ready';state.graphReady=true;state.errors=Array.isArray(receipt.errors)?receipt.errors.length:Number(receipt.errors)||0;state.snapshot=true;
}else refreshVault();
watchVault();
if(state.phase==='ready')queueVaultRefresh();
