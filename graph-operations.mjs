import {createHash} from 'node:crypto';
import {louvain,modularity} from './louvain.mjs';

export function combineGraphs(sources){
 if(!Array.isArray(sources)||sources.length<2||sources.length>4)throw Error('Choose between two and four graphs.');
 if(new Set(sources.map(s=>s.id)).size!==sources.length)throw Error('Choose distinct source graphs.');
 const directed=sources[0].graph.directed!==false;
 if(sources.some(s=>(s.graph.directed!==false)!==directed))throw Error('Combine graphs with matching direction semantics. Directed and undirected sources must remain separate.');
 if(sources.reduce((n,s)=>n+s.graph.nodes.length,0)>500000||sources.reduce((n,s)=>n+s.graph.edges.length,0)>2500000)throw Error('Combined graph exceeds 500,000 entities or 2,500,000 relationships.');
 const nodes=[],edges=[],groups=[],sourceGraphs=[];
 for(const {id,title,graph} of sources){
  const prefix=createHash('sha256').update(String(id)).digest('hex').slice(0,24)+':',ids=new Map(graph.nodes.map(n=>[n.id,prefix+createHash('sha256').update(n.id).digest('hex')]));
  if(ids.size!==graph.nodes.length)throw Error('Source graph has duplicate identities.');
  for(const n of graph.nodes)nodes.push({...n,id:ids.get(n.id),sourceGraph:id,sourceGraphTitle:title,sourceId:n.id});
  for(const e of graph.edges){if(!ids.has(e.source)||!ids.has(e.target))throw Error('Source graph has a dangling relationship.');edges.push({...e,source:ids.get(e.source),target:ids.get(e.target),sourceGraph:id});}
  const raw=graph.groups||graph.sourceEnvelope?.hyperedges||[];
  for(const [i,g] of raw.entries()){const members=g.nodes||g.members||[];groups.push({...g,id:prefix+String(g.id??i),label:`${title} · ${g.label||g.title||'Group '+i}`,nodes:members.map(n=>ids.get(typeof n==='object'?n.id:String(n))).filter(Boolean),sourceGraph:id});}
  // Keep original non-structural source attributes, including legacy import provenance.
  const {nodes:sourceNodes,edges:sourceEdges,...metadata}=graph;
  sourceGraphs.push({id,title,metadata});
 }
 return {schema:'adamantium.graph/v1',mode:'combined',directed,nodes,edges,groups,sourceGraphs,completed:new Date().toISOString(),warnings:['Source identities are namespaced. Matching labels are not proof of identity; no cross-project relationships have been invented. Original graphs remain unchanged.']};
}

const STOP=new Set(['the','and','for','with','from','this','that','are','not','use','get','set','new','all','one','two','file','test','tests','spec','index','src','lib','null','true','false','function','const','return','async','await','import','export','default','class','type','data','value','values','item','items','call','line','node','path']);
// A community is named by the words its members share (top terms) and where they live (top files), never by a hash.
function readableLabel(nodes,representative){
 const counts=new Map();
 for(const n of nodes)for(const w of new Set(String(n.title||'').toLowerCase().match(/\p{L}[\p{L}\p{N}]{2,}/gu)||[]))if(!STOP.has(w))counts.set(w,(counts.get(w)||0)+1);
 const terms=[...counts].filter(([,c])=>c>1||nodes.length===1).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,3).map(([w])=>w);
 const files=topFiles(nodes,1)[0];
 const base=terms.length?terms.join(' · '):String(representative.title||representative.id).slice(0,60);
 return files?base+' ('+files+')':base;
}
function topFiles(nodes,limit=3){
 const counts=new Map();for(const n of nodes){const file=String(n.path||'').split('#')[0].split('/').pop();if(file)counts.set(file,(counts.get(file)||0)+1);}
 return [...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,limit).map(([f])=>f);
}
export function clusterGraph(graph,{algorithm='louvain',resolution=4}={}){
 if(graph.nodes.length>500000||graph.edges.length>2500000)throw Error('Graph exceeds the structural analysis budget.');
 const ordered=[...graph.nodes].sort((a,b)=>a.id.localeCompare(b.id)),positions=new Map(ordered.map((n,i)=>[n.id,i])),adj=Array.from({length:ordered.length},()=>new Set());
 for(const e of graph.edges){const a=positions.get(e.source),b=positions.get(e.target);if(a===undefined||b===undefined)throw Error('Graph has dangling relationships.');if(a!==b){adj[a].add(b);adj[b].add(a);}}
 const labels=Int32Array.from(ordered,(_,i)=>i);let passes=0,quality=null;
 if(algorithm==='louvain'){const pairs=[];for(let i=0;i<adj.length;i++)for(const j of adj[i])if(i<j)pairs.push([i,j]);const found=louvain(ordered.length,pairs,{resolution});for(let i=0;i<found.length;i++)labels[i]=found[i];
  // A small connected component is one community by itself; resolution only splits large ones.
  const seen=new Uint8Array(adj.length);for(let s=0;s<adj.length;s++){if(seen[s]||!adj[s].size)continue;const stack=[s],members=[];seen[s]=1;while(stack.length){const v=stack.pop();members.push(v);for(const w of adj[v])if(!seen[w]){seen[w]=1;stack.push(w);}}if(members.length<=50){const low=Math.min(...members)+adj.length;for(const v of members)labels[v]=low;}}
  quality=modularity(ordered.length,pairs,labels);}
 for(;algorithm!=='louvain'&&passes<12;passes++){let changed=0;for(let i=0;i<ordered.length;i++){
  const votes=new Map();for(const neighbor of adj[i])votes.set(labels[neighbor],(votes.get(labels[neighbor])||0)+1);
  let best=labels[i],weight=votes.get(best)||0;for(const [candidate,count] of votes)if(count>weight||(count===weight&&candidate<best)){best=candidate;weight=count;}
  if(best!==labels[i]){labels[i]=best;changed++;}
 }if(!changed){passes++;break;}}
 const buckets=new Map();for(let i=0;i<ordered.length;i++){if(!buckets.has(labels[i]))buckets.set(labels[i],[]);buckets.get(labels[i]).push(i);}
 const groups=[...buckets.values()].map(members=>{
  const representative=members.reduce((best,i)=>adj[i].size>adj[best].size?i:best,members[0]);
  return {id:'structural:'+createHash('sha256').update(ordered[members[0]].id).digest('hex').slice(0,24),label:readableLabel(members.map(i=>ordered[i]),ordered[representative]),topFiles:topFiles(members.map(i=>ordered[i])),relation:'structural community',origin:algorithm==='louvain'?'local-louvain':'local-label-propagation',nodes:members.map(i=>ordered[i].id)};
 }).sort((a,b)=>b.nodes.length-a.nodes.length||a.id.localeCompare(b.id));
 return {...graph,groups:[...(graph.groups||graph.sourceEnvelope?.hyperedges||[]),...groups],analysis:{algorithm:algorithm==='louvain'?'deterministic-louvain':'deterministic-label-propagation',modularity:quality,passes,communities:groups.length,isolated:adj.filter(a=>!a.size).length},completed:new Date().toISOString(),warnings:[...(graph.warnings||[]),'Structural communities describe connectivity, not AI-written semantic conclusions. Original relationships and evidence are unchanged.']};
}
