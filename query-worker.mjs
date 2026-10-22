import {parentPort,workerData} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import {queryVault} from './queries.mjs';
const db=new DatabaseSync(workerData.database,{readOnly:true});
db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=2000; PRAGMA cache_size=-32768;');
const cache=new Map();let cacheBytes=0,version=null;
parentPort.on('message',({id,kind,input})=>{
 const started=performance.now();
 try{
  const current=db.prepare('PRAGMA data_version').get().data_version;
  if(current!==version){cache.clear();cacheBytes=0;version=current;}
  const key=JSON.stringify([kind,input]),cached=cache.get(key);
  if(cached){cache.delete(key);cache.set(key,cached);parentPort.postMessage({id,result:cached.result,cacheHit:true,queryMs:performance.now()-started});return;}
  db.exec('BEGIN');
  let result;
  try{result=queryVault(db,kind,input);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
  // Small bounded navigation cache; never retain large document bodies.
  if(kind!=='doc'){
   const size=Buffer.byteLength(JSON.stringify(result));
   if(size<=2*1024*1024){
    while(cache.size>=24||cacheBytes+size>8*1024*1024){const oldest=cache.keys().next().value;cacheBytes-=cache.get(oldest).size;cache.delete(oldest);}
    cache.set(key,{result,size});cacheBytes+=size;
   }
  }
  parentPort.postMessage({id,result,cacheHit:false,queryMs:performance.now()-started});
 }
 catch(error){parentPort.postMessage({id,error:error.message});}
});
