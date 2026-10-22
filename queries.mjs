import path from 'node:path';
import {frontmatter} from './vault-workspace.mjs';
import {advancedSearch,searchPlan} from './vault-search.mjs';
import {baseView} from './vault-views.mjs';
import {compileIgnore} from './obsidian-excluded.mjs';
import {searchExpression,nearest,resolver,targets as targetsOf} from './lib.mjs';
import {provenance} from './intelligence.mjs';
const fields='id,path,title,folder,category,degree,mtime,bytes';
const totals=new WeakMap();
function documentCount(db){
 const version=db.prepare('PRAGMA data_version').get().data_version,cached=totals.get(db);
 if(cached?.version===version)return cached.total;
 const total=Number(db.prepare('SELECT count(*) n FROM docs').get().n);totals.set(db,{version,total});return total;
}
// One link target -> one document, without loading every path (works on a 220,000-note index).
function resolveLink(db,source,target){
 const key=String(target).replaceAll('\\','/').replace(/\.md$/i,'').replace(/^\/+/,'').trim();if(!key)return null;
 const relative=path.posix.normalize(path.posix.join(path.posix.dirname(source||''),key));
 for(const candidate of (key.includes('/')?[relative,key]:[key])){const row=db.prepare('SELECT id,path FROM docs WHERE path IN (?,?,?)').get(candidate+'.md',candidate,candidate+'.canvas');if(row)return row;}
 const name=path.posix.basename(key).toLowerCase().replace(/[\\%_]/g,'\\$&');
 const matches=db.prepare("SELECT id,path FROM docs WHERE lower(path)=? OR lower(path)=? OR lower(path) LIKE ? ESCAPE '\\' OR lower(path) LIKE ? ESCAPE '\\' LIMIT 200").all(name+'.md',name,'%/'+name+'.md','%/'+name);
 if(matches.length){const best=nearest(source||'',matches.map(m=>m.path));return best?matches.find(m=>m.path===best):null;}
 return db.prepare("SELECT d.id,d.path FROM doc_metadata m JOIN docs d ON d.id=m.id WHERE m.properties LIKE '%alias%' AND EXISTS(SELECT 1 FROM json_each(m.properties) p WHERE p.key IN ('aliases','alias') AND (lower(CAST(p.value AS TEXT))=lower(?) OR EXISTS(SELECT 1 FROM json_each(CASE WHEN p.type='array' THEN p.value ELSE '[]' END) v WHERE lower(CAST(v.value AS TEXT))=lower(?)))) LIMIT 1").get(key,key)||null;
}
export function queryVault(db,kind,input={}){
 const scope=['records','generated','archive'].includes(input.scope)?input.scope:'records',folder=input.folder||null;
 if(kind==='search'){
  const query=String(input.q||'').trim().slice(0,500),expression=searchExpression(query),args=folder?[scope,folder]:[scope],where=folder?' AND folder=?':'';
  const rawOffset=Number(input.offset||0),offset=Number.isSafeInteger(rawOffset)&&rawOffset>=0?rawOffset:0;
  const plan=searchPlan(query);
  if(plan.groups.length>1||plan.groups.some(g=>g.filters.length||g.terms.some(t=>t.negative||t.phrase)))return advancedSearch(db,query,scope,folder,offset);
  if(!expression)return db.prepare(`SELECT ${fields} FROM docs WHERE category=?${where} ORDER BY mtime DESC,id LIMIT 80 OFFSET ?`).all(...args,offset);
  const escaped=query.toLowerCase().replace(/[\\%_]/g,'\\$&'),filename=/\.md$/i.test(query)?query.toLowerCase():query.toLowerCase()+'.md',exact=filename.replace(/[\\%_]/g,'\\$&');
  return db.prepare(`WITH matches AS (
   SELECT rowid id,rank score FROM search WHERE search MATCH ?
   UNION ALL SELECT id,CASE WHEN lower(path)=? OR lower(path) LIKE ? ESCAPE '\\' THEN -1e9 ELSE -1e8 END score
    FROM docs WHERE category=?${where} AND lower(path) LIKE ? ESCAPE '\\'
  ) SELECT ${fields.split(',').map(f=>'d.'+f).join(',')} FROM docs d
   JOIN (SELECT id,min(score) score FROM matches GROUP BY id) m ON d.id=m.id
   WHERE category=?${where} ORDER BY m.score,d.id LIMIT 80 OFFSET ?`).all(expression,filename,'%/'+exact,...args,'%'+escaped+'%',...args,offset);
 }
 if(kind==='groups')return db.prepare('SELECT folder,count(*) count FROM docs WHERE category=? GROUP BY folder ORDER BY count DESC').all(scope);
 if(kind==='doc'){
  const doc=db.prepare('SELECT * FROM docs WHERE id=?').get(Number(input.id));
  if(!doc)return null;
  const connections=db.prepare(`SELECT ${fields.split(',').map(f=>'d.'+f).join(',')},e.source=? AS outgoing FROM edges e JOIN docs d ON d.id=CASE WHEN e.source=? THEN e.target ELSE e.source END WHERE e.source=? OR e.target=? ORDER BY d.degree DESC LIMIT 100`).all(doc.id,doc.id,doc.id,doc.id);
  const note=/\.canvas$/i.test(doc.path)?{properties:{},body:doc.body}:frontmatter(doc.body),tags=(()=>{try{return JSON.parse(db.prepare('SELECT tags FROM doc_metadata WHERE id=?').get(doc.id)?.tags||'[]');}catch{return [];}})();
  return {...doc,properties:note.properties,renderBody:note.body,frontmatterError:note.error||null,tags,connections,provenance:provenance(doc)};
 }
 if(kind==='graph'){
  const limit=Math.max(30,Math.min(900,Number(input.limit)||500)),focus=Number(input.focus)||null;
  const nodes=focus?db.prepare(`SELECT ${fields} FROM docs WHERE id=? OR id IN (SELECT target FROM edges WHERE source=? UNION SELECT source FROM edges WHERE target=?) ORDER BY (id=?) DESC,degree DESC LIMIT ?`).all(focus,focus,focus,focus,limit):
   db.prepare(`SELECT ${fields} FROM docs WHERE category=? ${folder?'AND folder=?':''} ORDER BY degree DESC,mtime DESC LIMIT ?`).all(...(folder?[scope,folder,limit]:[scope,limit]));
  const ids=new Set(nodes.map(n=>n.id)),edges=[],statement=db.prepare('SELECT source,target FROM edges WHERE source=?');
  for(const n of nodes)for(const edge of statement.all(n.id))if(ids.has(edge.target))edges.push(edge);
  return {nodes,edges,scope,focus,total:documentCount(db),limit};
 }
 if(kind==='tags')return db.prepare('SELECT t.value tag,count(*) count FROM doc_metadata m JOIN docs d ON d.id=m.id,json_each(m.tags) t WHERE d.category=? GROUP BY t.value ORDER BY count DESC,t.value LIMIT 50000').all(scope);
 if(kind==='properties')return db.prepare('SELECT p.key name,count(*) count,group_concat(DISTINCT p.type) types FROM doc_metadata m JOIN docs d ON d.id=m.id,json_each(m.properties) p WHERE d.category=? GROUP BY p.key ORDER BY count DESC,p.key LIMIT 500').all(scope);
 if(kind==='base'){
  const options={view:input.view,offset:input.offset,limit:input.pageSize};
  if(input.all){
   // A .base file opened by name: every Markdown note in the vault, minus Obsidian's Excluded files, like Obsidian's own table.
   const ignored=compileIgnore((()=>{try{return JSON.parse(input.ignore||'[]');}catch{return [];}})());
   const all=db.prepare("SELECT d.path,d.mtime,d.bytes,m.properties,m.tags FROM docs d JOIN doc_metadata m ON m.id=d.id WHERE d.path LIKE '%.md'").all().filter(r=>!ignored(String(r.path)));
   return baseView(all,JSON.parse(input.config||'{}'),{...options,maxRows:null});
  }
  const rows=db.prepare(`SELECT d.path,d.mtime,d.bytes,m.properties,m.tags FROM docs d JOIN doc_metadata m ON m.id=d.id WHERE d.category=?${folder?' AND d.folder=?':''}`).all(...(folder?[scope,folder]:[scope]));
  return baseView(rows,JSON.parse(input.config||'{}'),options);
 }
 if(kind==='resolve')return resolveLink(db,input.source,input.target);
 if(kind==='changes'){
  const time=Date.parse(input.since);if(!Number.isFinite(time))throw Error('Choose an ISO date');
  const rows=db.prepare('SELECT path,mtime FROM docs WHERE category=? AND mtime>? ORDER BY mtime DESC LIMIT 500').all(scope,time);
  const total=Number(db.prepare('SELECT count(*) n FROM docs WHERE category=? AND mtime>?').get(scope,time).n);
  return {since:new Date(time).toISOString(),total,shown:rows.length,files:rows.map(r=>({path:r.path,mtime:r.mtime,when:new Date(r.mtime).toISOString()}))};
 }
 if(kind==='health'){
  const resolve=resolver(db.prepare('SELECT path FROM docs').all().map(r=>r.path)),broken=[],byName=new Map();let brokenTotal=0,notes=0,last=0;
  const batch=db.prepare("SELECT id,path,body FROM docs WHERE category=? AND id>? AND path LIKE '%.md' ORDER BY id LIMIT 400");
  for(;;){
   const rows=batch.all(scope,last);if(!rows.length)break;
   for(const r of rows){
    last=r.id;notes++;const name=r.path.split('/').pop().toLowerCase();if(!byName.has(name))byName.set(name,[]);byName.get(name).push(r.path);
    for(const t of targetsOf(r.body))if(!resolve(r.path,t)){brokenTotal++;if(broken.length<1000)broken.push({source:r.path,target:t});}
   }
  }
  const orphanSql="FROM docs d WHERE d.category=? AND d.path LIKE '%.md' AND NOT EXISTS(SELECT 1 FROM edges e WHERE e.target=d.id)";
  const orphanTotal=Number(db.prepare('SELECT count(*) n '+orphanSql).get(scope).n),orphans=db.prepare('SELECT d.path '+orphanSql+' ORDER BY d.mtime DESC LIMIT 1000').all(scope).map(r=>r.path);
  const duplicates=[...byName.values()].filter(v=>v.length>1);
  return {scope,summary:{notes,broken:brokenTotal,orphans:orphanTotal,duplicates:duplicates.length},broken,orphans,duplicates:duplicates.slice(0,500)};
 }
 throw Error('Unknown query.');
}
