import {parentPort,workerData} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
const db=new DatabaseSync(workerData.database,{readOnly:true});
try{
 db.exec('BEGIN');
 const ids=db.prepare('SELECT id FROM docs ORDER BY id').all().map(r=>r.id),index=new Map(ids.map((id,i)=>[id,i])),n=ids.length;
 const parent=Int32Array.from({length:n},(_,i)=>i),size=new Uint32Array(n).fill(1),out=new Uint32Array(n),degree=new Uint32Array(n);
 const find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
 const count=Number(db.prepare('SELECT count(*) n FROM edges').get().n),sources=new Int32Array(count),targets=new Int32Array(count);let m=0;
 for(const e of db.prepare('SELECT source,target FROM edges').iterate()){
  const a=index.get(e.source),b=index.get(e.target);if(a===undefined||b===undefined)continue;
  sources[m]=a;targets[m++]=b;out[a]++;degree[a]++;degree[b]++;
  let x=find(a),y=find(b);if(x!==y){if(size[x]<size[y])[x,y]=[y,x];parent[y]=x;size[x]+=size[y];}
 }
 parentPort.postMessage({phase:'ranking',documents:n,links:m});
 let rank=new Float64Array(n).fill(1/Math.max(1,n));
 for(let round=0;round<30;round++){
  let dangling=0;for(let i=0;i<n;i++)if(!out[i])dangling+=rank[i];
  const next=new Float64Array(n).fill((.15+.85*dangling)/Math.max(1,n));
  for(let e=0;e<m;e++)next[targets[e]]+=.85*rank[sources[e]]/out[sources[e]];
  rank=next;
 }
 const components=new Map();let isolated=0;
 for(let i=0;i<n;i++){if(!degree[i])isolated++;const root=find(i);components.set(root,(components.get(root)||0)+1);}
 const top=Array.from({length:n},(_,i)=>i).sort((a,b)=>rank[b]-rank[a]).slice(0,40);
 const doc=db.prepare('SELECT id,title,path,folder,category FROM docs WHERE id=?');
 const ranked=top.map(i=>({...doc.get(ids[i]),score:rank[i],connections:degree[i]}));
 const largest=[...components].sort((a,b)=>b[1]-a[1]).slice(0,20).map(([i,count])=>({count,representative:doc.get(ids[i])}));
 const bridges=db.prepare(`SELECT a.folder AS sourceFolder,b.folder AS targetFolder,count(*) AS links FROM edges e JOIN docs a ON a.id=e.source JOIN docs b ON b.id=e.target WHERE a.folder<>b.folder GROUP BY a.folder,b.folder ORDER BY links DESC LIMIT 30`).all();
 db.exec('COMMIT');
 parentPort.postMessage({phase:'complete',result:{schema:'adamantium.analysis/v1',generated:new Date().toISOString(),scope:'entire indexed vault',documents:n,links:m,components:components.size,isolated,largest,ranked,bridges,methods:{rank:'Directed PageRank, damping 0.85, 30 iterations',components:'Exact weakly connected components',bridges:'Actual directed links across top-level source folders'}}});
}catch(error){parentPort.postMessage({phase:'error',error:error.message});}finally{db.close();}
