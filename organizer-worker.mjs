import {parentPort,workerData} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import crypto from 'node:crypto';
import {gzipSync} from 'node:zlib';
const db=new DatabaseSync(workerData.database,{readOnly:true});
try{
 db.exec('BEGIN');
 const categories=db.prepare('SELECT category,count(*) documents,sum(bytes) bytes FROM docs GROUP BY category').all();
 const groups=new Map();let scanned=0;
 for(const d of db.prepare('SELECT id,path,title,category,bytes,body FROM docs WHERE bytes IN (SELECT bytes FROM docs GROUP BY bytes HAVING count(*)>1)').iterate()){
  const hash=crypto.createHash('sha256').update(d.body).digest('hex'),key=d.bytes+':'+hash;
  const group=groups.get(key)||{sha256:hash,bytes:d.bytes,copies:0,documents:[]};group.copies++;
  if(group.documents.length<30)group.documents.push({id:d.id,path:d.path,title:d.title,category:d.category});
  groups.set(key,group);scanned++;
  if(scanned%20000===0)parentPort.postMessage({phase:'comparing',scanned});
 }
 const duplicates=[...groups.values()].filter(g=>g.copies>1).sort((a,b)=>(b.copies-1)*b.bytes-(a.copies-1)*a.bytes);
 const large=db.prepare("SELECT id,path,title,category,bytes,body FROM docs WHERE category IN ('generated','archive') ORDER BY bytes DESC LIMIT 20").all().map(d=>{const compressed=gzipSync(d.body,{level:6}).length;return {id:d.id,path:d.path,title:d.title,category:d.category,bytes:d.bytes,gzipBytes:compressed,potentialCopyReduction:Math.max(0,d.bytes-compressed)};});
 db.exec('COMMIT');
 parentPort.postMessage({phase:'complete',result:{generated:new Date().toISOString(),categories,compared:scanned,duplicateGroups:duplicates.length,duplicateCopies:duplicates.reduce((s,g)=>s+g.copies-1,0),duplicateBytes:duplicates.reduce((s,g)=>s+(g.copies-1)*g.bytes,0),duplicates:duplicates.slice(0,40),compressionCandidates:large,notice:'Recommendations only. No source file has been moved, compressed, or deleted. Duplicate bytes are not automatically reclaimable: paths may carry different provenance. Gzip measurements are compressed-copy sizes, not ZIP sizes or disk space already freed.'}});
}catch(error){parentPort.postMessage({phase:'error',error:error.message});}finally{db.close();}
