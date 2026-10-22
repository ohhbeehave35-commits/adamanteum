import {frontmatter,tagsOf} from './vault-workspace.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {category,title,targets,resolver,LINK_PARSER_VERSION,METADATA_VERSION} from './lib.mjs';
import {canvasText,canvasTargets} from './vault-views.mjs';
import {loadExcludeFilters,pathIgnored} from './obsidian-import.mjs';
const isCanvas=p=>/\.canvas$/i.test(p);
// What full-text search sees: notes as written; canvases as their card text, file names and labels.
const searchText=(p,body)=>isCanvas(p)?canvasText(body):body;
const linkTargets=(p,body)=>isCanvas(p)?canvasTargets(body):targets(body);

export async function reconcileVault({vault,database,changedPaths=null,progress=()=>{}}){
 const root=await fs.realpath(vault),db=new DatabaseSync(database);
 db.exec('PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL;');
 db.exec('CREATE TABLE IF NOT EXISTS doc_metadata(id INTEGER PRIMARY KEY,properties TEXT,tags TEXT);');
 db.exec('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT)');
 const metadataMissing=Number(db.prepare('SELECT count(*) n FROM doc_metadata').get().n)!==Number(db.prepare('SELECT count(*) n FROM docs').get().n)||db.prepare("SELECT value FROM meta WHERE key='metadataVersion'").get()?.value!==METADATA_VERSION;
 const report={phase:'discovering',scanned:0,indexed:0,changed:0,removed:0,skipped:0,errors:0,issues:[],started:new Date().toISOString()};
 const issue=(p,error)=>{report.errors++;if(report.issues.length<100)report.issues.push({path:p,error:String(error)});};
 try{
  const old=new Map(db.prepare('SELECT id,path,mtime,bytes FROM docs').all().map(r=>[r.path,r]));
  const needsRepair=db.prepare("SELECT value FROM meta WHERE key='linksDirty'").get()?.value==='1'||db.prepare("SELECT value FROM meta WHERE key='linkParserVersion'").get()?.value!==LINK_PARSER_VERSION,changedIds=new Set(),changedNames=new Set();let membershipChanged=false;
  const incremental=Array.isArray(changedPaths),files=[],stack=incremental?[]:[''],seen=new Set(incremental?old.keys():[]);let discoveryComplete=true;
  report.mode=incremental?'incremental':'full';
  const exclude=loadExcludeFilters(root);
  if(incremental)for(const p of new Set(changedPaths)){
   if(typeof p!=='string'||path.isAbsolute(p)||p.split(/[\\/]/).some(part=>part==='..'||part.startsWith('.'))||!/\.(md|canvas)$/i.test(p))throw Error('Invalid changed document path');
   if(pathIgnored(p,exclude)){seen.delete(p);continue;}
   files.push(p);report.scanned++;
  }
  while(stack.length){
   const relative=stack.pop();
   try{
    for(const entry of await fs.readdir(path.join(root,relative),{withFileTypes:true})){
     if(entry.isSymbolicLink()||entry.name.startsWith('.')||['node_modules','__pycache__'].includes(entry.name))continue;
     const p=relative?relative+'/'+entry.name:entry.name;
     if(pathIgnored(p,exclude))continue;
     if(entry.isDirectory())stack.push(p);
     else if(entry.isFile()){report.scanned++;if(/\.(md|canvas)$/i.test(p)){files.push(p);seen.add(p);}}
    }
   }catch(e){discoveryComplete=false;issue(relative,e.code||e.message);}
   if(report.scanned%1000<100)progress({...report});
  }
  report.total=files.length;report.phase='indexing';progress({...report});
  files.sort((a,b)=>category(b).localeCompare(category(a))||a.localeCompare(b));
  const insert=db.prepare('INSERT INTO docs(path,title,folder,category,mtime,bytes,body) VALUES(?,?,?,?,?,?,?)');
  const update=db.prepare('UPDATE docs SET title=?,folder=?,category=?,mtime=?,bytes=?,body=? WHERE id=?');
  const getBody=db.prepare('SELECT title,body FROM docs WHERE id=?');
  const eraseFTS=db.prepare("INSERT INTO search(search,rowid,title,body) VALUES('delete',?,?,?)");
  const addFTS=db.prepare('INSERT INTO search(rowid,title,body) VALUES(?,?,?)');
  for(let offset=0;offset<files.length;offset+=20){
   const batch=await Promise.all(files.slice(offset,offset+20).map(async p=>{
    try{
     const absolute=path.join(root,p),stat=await fs.lstat(absolute),before=old.get(p);
     if(stat.isSymbolicLink()||!stat.isFile())throw Error('File changed type during scan');
     if(stat.size>8*1024*1024){report.skipped++;issue(p,'Over 8 MiB indexing limit; previous indexed copy retained if present');return null;}
     if(!metadataMissing&&before&&before.mtime===stat.mtimeMs&&before.bytes===stat.size)return {unchanged:true};
     const resolved=await fs.realpath(absolute),relative=path.relative(root,resolved);
     if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('File resolves outside vault');
     const body=await fs.readFile(absolute,'utf8'),after=await fs.stat(absolute);
     if(after.mtimeMs!==stat.mtimeMs||after.size!==stat.size)throw Error('File changed while reading; retry on next refresh');
     return {p,before,stat,body};
    }catch(e){if(incremental&&e.code==='ENOENT'){seen.delete(p);return null;}issue(p,e.code||e.message);return null;}
   }));
   db.exec('BEGIN IMMEDIATE');
   try{
    for(const item of batch){
     if(!item)continue;report.indexed++;if(item.unchanged)continue;
     db.prepare("INSERT OR REPLACE INTO meta VALUES('linksDirty','1')").run();
     const {p,before,stat,body}=item,t=title(body,p),folder=p.includes('/')?p.split('/')[0]:'Home';let id;
     if(before){const previous=getBody.get(before.id);eraseFTS.run(before.id,previous.title,searchText(p,previous.body));update.run(t,folder,category(p),stat.mtimeMs,stat.size,body,before.id);id=before.id;}
     else {id=insert.run(p,t,folder,category(p),stat.mtimeMs,stat.size,body).lastInsertRowid;membershipChanged=true;changedNames.add(path.posix.basename(p).replace(/\.[^.]+$/,''));if(!isCanvas(p))for(const alias of [].concat(frontmatter(body).properties.aliases??[]))if(typeof alias==='string')changedNames.add(alias);}
     changedIds.add(Number(id));
     addFTS.run(id,t,searchText(p,body));db.prepare('INSERT OR REPLACE INTO doc_metadata VALUES(?,?,?)').run(id,JSON.stringify(isCanvas(p)?{}:frontmatter(body).properties),JSON.stringify(isCanvas(p)?[]:tagsOf(body)));report.changed++;
    }
    db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   if(offset%1000===0)progress({...report});
  }
  // A partial directory walk is never evidence that unseen documents vanished.
  if(discoveryComplete){
   const missing=[...old.values()].filter(row=>!seen.has(row.path));
   for(let offset=0;offset<missing.length;offset+=100){
    db.exec('BEGIN IMMEDIATE');
    try{
     for(const row of missing.slice(offset,offset+100)){
      db.prepare("INSERT OR REPLACE INTO meta VALUES('linksDirty','1')").run();
      const previous=getBody.get(row.id);eraseFTS.run(row.id,previous.title,searchText(row.path,previous.body));
      db.prepare('DELETE FROM edges WHERE source=? OR target=?').run(row.id,row.id);
      db.prepare('DELETE FROM docs WHERE id=?').run(row.id);db.prepare('DELETE FROM doc_metadata WHERE id=?').run(row.id);report.removed++;
      membershipChanged=true;changedNames.add(path.posix.basename(row.path).replace(/\.[^.]+$/,''));
     }
     db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
   }
  }
  if(report.changed||report.removed||needsRepair){
   db.prepare("INSERT OR REPLACE INTO meta VALUES('linksDirty','1')").run();
   report.phase='linking';progress({...report});
   const rows=db.prepare('SELECT id,path FROM docs').all(),ids=new Map(rows.map(r=>[r.path,r.id])),aliases=new Map();
   for(const m of db.prepare("SELECT d.path,m.properties FROM doc_metadata m JOIN docs d ON d.id=m.id WHERE m.properties LIKE '%alias%'").all()){try{const p=JSON.parse(m.properties),list=[].concat(p.aliases??p.alias??[]);for(const a of list)if(typeof a==='string'&&a.trim()&&!aliases.has(a.trim().toLowerCase()))aliases.set(a.trim().toLowerCase(),m.path);}catch{}}
   const resolve=resolver(rows.map(r=>r.path),aliases);
   // Everything is relinked after a repair. Otherwise only the documents that could be affected are:
   // the changed ones, plus any document whose text mentions a name that just appeared or disappeared
   // (found through the full-text index), so saving one note never means re-reading a whole 220,000-note vault.
   let rebuildAll=needsRepair;const affected=new Set(changedIds);
   if(!rebuildAll&&membershipChanged){
    const mentions=db.prepare('SELECT rowid FROM search WHERE search MATCH ? LIMIT 20000');
    for(const name of changedNames){
     if(!name.trim()||affected.size>20000){rebuildAll=affected.size>20000||rebuildAll;continue;}
     try{for(const r of mentions.all('"'+name.replaceAll('"','""')+'"'))affected.add(Number(r.rowid));}catch{rebuildAll=true;}
    }
    if(affected.size>20000)rebuildAll=true;
   }
   db.exec('CREATE TEMP TABLE next_edges(source INTEGER,target INTEGER,PRIMARY KEY(source,target))');
   const add=db.prepare('INSERT OR IGNORE INTO next_edges VALUES(?,?)'),one=db.prepare('SELECT path,body FROM docs WHERE id=?');
   const order=rebuildAll?rows.map(r=>r.id).sort((a,b)=>a-b):[...affected].sort((a,b)=>a-b);
   // One document body in memory at a time: a vault may hold multi-megabyte generated files.
   for(let start=0;start<order.length;start+=200){
    db.exec('BEGIN');
    try{for(const id of order.slice(start,start+200)){const row=one.get(id);if(!row)continue;for(const target of linkTargets(row.path,row.body)){const to=ids.get(resolve(row.path,target));if(to&&to!==id)add.run(id,to);}}db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
    if(start%2000===0)progress({...report,linked:start});
   }
   // Publish the replacement edge set atomically; readers never see an empty graph.
   db.exec('BEGIN IMMEDIATE');
   try{
    if(rebuildAll){db.exec('DELETE FROM edges');db.exec('INSERT INTO edges SELECT source,target FROM next_edges; UPDATE docs SET degree=(SELECT count(*) FROM edges WHERE source=docs.id)+(SELECT count(*) FROM edges WHERE target=docs.id);');}
    else{
     const touched=new Set(order),oldTargets=db.prepare('SELECT target FROM edges WHERE source=?'),drop=db.prepare('DELETE FROM edges WHERE source=?');
     for(const id of order){for(const r of oldTargets.all(id))touched.add(r.target);drop.run(id);}
     db.exec('INSERT OR IGNORE INTO edges SELECT source,target FROM next_edges');
     for(const r of db.prepare('SELECT target FROM next_edges').all())touched.add(r.target);
     const degree=db.prepare('UPDATE docs SET degree=(SELECT count(*) FROM edges WHERE source=docs.id)+(SELECT count(*) FROM edges WHERE target=docs.id) WHERE id=?');
     for(const id of touched)degree.run(id);
    }
    db.prepare("INSERT OR REPLACE INTO meta VALUES('linksDirty','0')").run();
    db.prepare("INSERT OR REPLACE INTO meta VALUES('linkParserVersion',?)").run(LINK_PARSER_VERSION);db.prepare("INSERT OR REPLACE INTO meta VALUES('metadataVersion',?)").run(METADATA_VERSION);db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   db.exec('DROP TABLE IF EXISTS temp.next_edges');
  }
  report.phase='ready';report.completed=new Date().toISOString();report.documents=Number(db.prepare('SELECT count(*) n FROM docs').get().n);report.links=Number(db.prepare('SELECT count(*) n FROM edges').get().n);report.graphReady=true;
  return report;
 }finally{db.close();}
}
