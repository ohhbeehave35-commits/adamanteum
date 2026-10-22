import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {QueryPool} from './query-pool.mjs';
const directory=path.join(path.dirname(fileURLToPath(import.meta.url)),'.data'),name=process.argv[2];
if(!/^capacity-2x-\d+\.sqlite$/.test(name||''))throw Error('Provide the filename of an existing private capacity fixture.');
const file=path.join(directory,name),db=new DatabaseSync(file,{readOnly:true});
const counts={documents:db.prepare('SELECT count(*) n FROM docs').get().n,links:db.prepare('SELECT count(*) n FROM edges').get().n};
const focus=db.prepare("SELECT id FROM docs WHERE category='records' ORDER BY degree DESC LIMIT 1").get().id;db.close();
const pool=new QueryPool(file),results=[];
try{
 for(const [label,kind,input,budgetMs] of [
  ['Search source records','search',{q:'Assistant',scope:'records'},250],
  ['Search archives','search',{q:'invoice',scope:'archive'},250],
  ['Search generated documents','search',{q:'function',scope:'generated'},250],
  ['900-node overview','graph',{scope:'records',limit:900},500],
  ['900-node neighborhood','graph',{focus,limit:900},500],
  ['Open source document','doc',{id:focus},100]
 ]){
  for(const mode of ['uncached-query','repeat-navigation']){
   const times=[];
   for(let i=0;i<12;i++){const start=performance.now();await pool.run(kind,{...input,...(mode==='uncached-query'?{benchmarkNonce:i}:{})});times.push(performance.now()-start);}
   const firstMs=times.shift();times.sort((a,b)=>a-b);
   const p95Ms=times[Math.floor(times.length*.95)],result={label,mode,firstMs,p50Ms:times[Math.floor(times.length*.5)],p95Ms,budgetMs,pass:p95Ms<=budgetMs};
   results.push(result);console.log(JSON.stringify(result));
  }
 }
 const receipt={...counts,fixture:name,created:new Date().toISOString(),method:'Two logical copies of real vault text and directed links. Query-worker round trips, warm OS cache; not end-to-end browser latency, not an Obsidian comparison. First request reported separately; 11 subsequent samples per result. Uncached-query bypasses only the Adamantium result cache.',results,pass:results.every(r=>r.pass)};
 fs.writeFileSync(path.join(directory,'capacity-verified.json'),JSON.stringify(receipt,null,2));
 console.log(JSON.stringify({documents:counts.documents,links:counts.links,pass:receipt.pass}));
}finally{await pool.close();}
