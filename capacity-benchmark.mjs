// Private, doubled real-content index. Does not alter the source vault or live index.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {QueryPool} from './query-pool.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),directory=path.join(root,'.data');
const stamp=Date.now(),destination=path.join(directory,`capacity-2x-${stamp}.sqlite`);
if(fs.statfsSync(directory).bavail*fs.statfsSync(directory).bsize<4*1024**3)throw Error('Need at least 4 GiB free for a private capacity test.');
const source=new DatabaseSync(path.join(directory,'vault.sqlite'),{readOnly:true});
console.log('Taking a consistent private snapshot; live vault remains untouched.');
source.prepare('VACUUM INTO ?').run(destination);source.close();
const db=new DatabaseSync(destination);db.exec('PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;');
const original=Number(db.prepare('SELECT count(*) n FROM docs').get().n),offset=Number(db.prepare('SELECT max(id) n FROM docs').get().n);
console.log(`Doubling ${original} indexed documents with real content.`);
db.exec('BEGIN');
db.prepare("INSERT INTO docs(id,path,title,folder,category,mtime,bytes,body,degree) SELECT id+?, '__capacity_copy__/'||path,title,folder,category,mtime,bytes,body,degree FROM docs WHERE id<=?").run(offset,offset);
db.prepare('INSERT INTO search(rowid,title,body) SELECT id,title,body FROM docs WHERE id>?').run(offset);
db.prepare('INSERT INTO edges(source,target) SELECT source+?,target+? FROM edges WHERE source<=? AND target<=?').run(offset,offset,offset,offset);
db.exec('COMMIT; CREATE INDEX IF NOT EXISTS doc_category_recent ON docs(category,mtime DESC); CREATE INDEX IF NOT EXISTS doc_folder_degree ON docs(category,folder,degree DESC,mtime DESC); ANALYZE;');
const documents=Number(db.prepare('SELECT count(*) n FROM docs').get().n),links=Number(db.prepare('SELECT count(*) n FROM edges').get().n);
if(documents!==original*2)throw Error('Capacity fixture count mismatch.');
const focus=db.prepare("SELECT id FROM docs WHERE category='records' ORDER BY degree DESC LIMIT 1").get().id;db.close();
const pool=new QueryPool(destination),results=[];
try{
 for(const [name,kind,input] of [
  ['Assistant search','search',{q:'Assistant',scope:'records'}],
  ['Approval search','search',{q:'approval',scope:'records'}],
  ['Archive search','search',{q:'invoice',scope:'archive'}],
  ['Generated search','search',{q:'function',scope:'generated'}],
  ['Recent documents','search',{scope:'records'}],
  ['900-node overview','graph',{scope:'records',limit:900}],
  ['Neighborhood','graph',{focus,limit:900}],
  ['Open document','doc',{id:focus}]
 ]){
  const samples=[];let firstMs,error;
  for(let i=0;i<12;i++){
   const start=performance.now();
   try{await pool.run(kind,input);const elapsed=performance.now()-start;if(i===0)firstMs=elapsed;else samples.push(elapsed);}
   catch(e){error=e.message;break;}
  }
  samples.sort((a,b)=>a-b);
  const result={name,firstMs,p50Ms:samples[Math.floor(samples.length*.5)],p95Ms:samples[Math.min(samples.length-1,Math.floor(samples.length*.95))],samples:samples.length,error};
  results.push(result);console.log(JSON.stringify(result));
 }
 const receipt={date:new Date().toISOString(),fixture:'Two logical copies of actual indexed vault content, not two independent corpora or disk files',documents,links,databaseBytes:fs.statSync(destination).size,queryWorkerRoundTrip:true,notBrowserLatency:true,results};
 fs.writeFileSync(path.join(directory,'capacity-receipt.json'),JSON.stringify(receipt,null,2));
 console.log(JSON.stringify({documents,links,receipt:'.data/capacity-receipt.json',privateDatabase:path.basename(destination)}));
}finally{await pool.close();}
