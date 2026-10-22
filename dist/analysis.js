// Deterministic structural analysis of the selected graph, never inferred semantic edges.
export function analyzeGraph(nodes,edges){
 const adj=new Map(nodes.map(n=>[n.id,new Set()])),out=new Map(nodes.map(n=>[n.id,[]]));
 for(const {source,target} of edges){if(!adj.has(source)||!adj.has(target))continue;adj.get(source).add(target);adj.get(target).add(source);out.get(source).push(target);}
 const components=[],seen=new Set();
 for(const n of nodes){if(seen.has(n.id))continue;const component=[],queue=[n.id];seen.add(n.id);for(let i=0;i<queue.length;i++){const id=queue[i];component.push(id);for(const next of adj.get(id))if(!seen.has(next)){seen.add(next);queue.push(next);}}components.push(component);}
 const labels=new Map(nodes.map(n=>[n.id,n.id]));
 for(let pass=0;pass<12;pass++){let changed=0;for(const n of nodes){const votes=new Map();for(const id of adj.get(n.id)){const label=labels.get(id);votes.set(label,(votes.get(label)||0)+1);}if(!votes.size)continue;const best=[...votes].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0][0];if(labels.get(n.id)!==best){labels.set(n.id,best);changed++;}}if(!changed)break;}
 const communities=new Map();for(const n of nodes){const key=labels.get(n.id);if(!communities.has(key))communities.set(key,[]);communities.get(key).push(n.id);}
 let scores=new Map(nodes.map(n=>[n.id,1/Math.max(1,nodes.length)]));
 for(let round=0;round<20;round++){let dangling=0;for(const n of nodes)if(!out.get(n.id).length)dangling+=scores.get(n.id);const next=new Map(nodes.map(n=>[n.id,(.15+.85*dangling)/Math.max(1,nodes.length)]));for(const n of nodes){const targets=out.get(n.id);for(const target of targets)next.set(target,next.get(target)+.85*scores.get(n.id)/targets.length);}scores=next;}
 return {scope:'selected graph only',nodes:nodes.length,edges:edges.length,components:components.sort((a,b)=>b.length-a.length),communities:[...communities.values()].sort((a,b)=>b.length-a.length),isolated:nodes.filter(n=>!adj.get(n.id).size).map(n=>n.id),ranked:nodes.map(n=>({id:n.id,title:n.title,score:scores.get(n.id),connections:adj.get(n.id).size})).sort((a,b)=>b.score-a.score)};
}
const xml=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'})[c]);
export function graphML(nodes,edges){
 return '<?xml version="1.0" encoding="UTF-8"?>\n<graphml xmlns="http://graphml.graphdrawing.org/xmlns"><key id="title" for="node" attr.name="title" attr.type="string"/><key id="path" for="node" attr.name="path" attr.type="string"/><graph id="Adamantium" edgedefault="directed">'+nodes.map(n=>`<node id="n${xml(n.id)}"><data key="title">${xml(n.title)}</data><data key="path">${xml(n.path)}</data></node>`).join('')+edges.map((e,i)=>`<edge id="e${i}" source="n${xml(e.source)}" target="n${xml(e.target)}"/>`).join('')+'</graph></graphml>';
}
