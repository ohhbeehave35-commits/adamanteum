import test from 'node:test';
import assert from 'node:assert/strict';
import {importKnowledgeGraph,semanticPrompt,validateSemanticGraph,KnowledgeStore,knowledgeGroups,knowledgeGroup} from '../knowledge-graph.mjs';
import {projectPath,projectNeighborhood} from '../project-navigation.mjs';
const documents=[{id:1,path:'notes.md',body:'Assistant uses Adamantium to navigate company records.'}];
const extraction={entities:[{id:'a',name:'Assistant',kind:'system'},{id:'b',name:'Adamantium',kind:'system'}],relations:[{source:'a',target:'b',relation:'uses',documentId:1,quote:documents[0].body,confidence:.9}]};
test('native graph imports preserve attributes without recursively duplicating large payloads',()=>{
 const source={schema:'adamantium.graph/v1',extractor:'test',nodes:[{id:'a',title:'A',column:19},{id:'b',title:'B'}],edges:[{source:'a',target:'b',type:'invokes',occurrence:'call-1'}],unresolvedCalls:[{reason:'dynamic'}]};
 const once=importKnowledgeGraph(source),twice=importKnowledgeGraph(once);
 assert.equal(once.nodes,source.nodes);assert.equal(once.edges,source.edges);assert.equal(twice.sourceEnvelope,undefined);
 assert.equal(twice.nodes[0].column,19);assert.equal(twice.edges[0].occurrence,'call-1');assert.deepEqual(twice.unresolvedCalls,source.unresolvedCalls);
 assert.equal(once.mode,'imported');assert.match(once.warnings.at(-1),/not been independently/);
 assert.throws(()=>importKnowledgeGraph({...source,nodes:[source.nodes[0],source.nodes[0]]}));
 assert.throws(()=>importKnowledgeGraph({...source,edges:[{source:'a',target:'missing',type:'calls'}]}));
});
test('Graphify node-link migration preserves direction, attributes and hyperedges without opening source paths',()=>{
 const source={directed:true,nodes:[{id:'a',label:'A',source_file:'../../secret',source_location:'L42',_origin:'ast'},{id:'b',label:'B'}],links:[{source:'a',target:'b',relation:'calls',confidence:'EXTRACTED',confidence_score:.85}],hyperedges:[{members:['a','b'],meaning:'group'}]};
 const g=importKnowledgeGraph(source);assert.equal(g.nodes[0].line,42);assert.equal(g.edges[0].type,'calls');assert.equal(g.edges[0].confidence,.85);assert.deepEqual(g.sourceEnvelope,source);assert.equal(g.warnings.length,1);
 assert.throws(()=>importKnowledgeGraph({...source,links:[{source:'a',target:'missing'}]}),/missing entity/);
 assert.throws(()=>importKnowledgeGraph({...source,nodes:[{id:1},{id:'1'}]}),/Duplicate/);
 assert.equal(importKnowledgeGraph({...source,directed:false}).directed,false);
});
test('native semantic extraction retains exact evidence and rejects fabricated or out-of-scope claims',()=>{
 const g=validateSemanticGraph(JSON.stringify(extraction),documents,'Own provider');assert.equal(g.edges.length,1);assert.equal(g.nodes.length,2);assert.equal(g.edges[0].origin,'model-inferred');assert.equal(g.edges[0].hash.length,64);
 for(const patch of [{quote:'Assistant purchased Adamantium.'},{documentId:99},{confidence:2},{source:'invented'},{quote:'navigate company records.'}]){
  const invalid={...extraction,relations:[{...extraction.relations[0],...patch}]},r=validateSemanticGraph(JSON.stringify(invalid),documents,'Own');assert.equal(r.edges.length,0);assert.equal(r.nodes.length,0);assert.equal(r.rejected.length,1);
 }
 assert.throws(()=>validateSemanticGraph('not json',documents,'Own'),/Nothing was saved/);
 assert.match(semanticPrompt(documents),/untrusted DATA/);
});
test('private knowledge storage preserves source evidence and keeps independent graph identities',()=>{
 const store=new KnowledgeStore(':memory:');try{
  const g=validateSemanticGraph(JSON.stringify(extraction),documents,'Own');const first=store.save(g,'one'),second=store.save(g,'two');assert.notEqual(first.id,second.id);assert.equal(store.list().length,2);assert.deepEqual(store.get(first.id),g);assert.throws(()=>store.get('unknown'),/not found/);
 }finally{store.close();}
});
test('imported undirected paths navigate both ways and exact names rank above file matches',()=>{
 const graph=importKnowledgeGraph({directed:false,nodes:[{id:'a',label:'Other',source_file:'assistant.py'},{id:'b',label:'Assistant'}],links:[{source:'a',target:'b',relation:'uses'}]});
 assert.deepEqual(projectPath(graph,'b','a',{types:['uses']}).path,['b','a']);assert.equal(projectPath(graph,'b','a',{types:['uses']}).directed,false);
 assert.equal(projectNeighborhood(graph,{q:'assistant'}).nodes[0].id,'b');
});
test('shorter approved excerpts reject quotes outside the shared range but retain full source fingerprints',()=>{
 const g=validateSemanticGraph(JSON.stringify(extraction),[{...documents[0],sharedBody:'Assistant'}],'Assistant');assert.equal(g.edges.length,0);assert.equal(g.sources[0].charactersShared,9);
});
test('hyperedge groups navigate actual members without inventing causal or pairwise edges',()=>{
 const g=importKnowledgeGraph({nodes:[{id:'a',label:'A'},{id:'b',label:'B'},{id:'c',label:'C'}],links:[],hyperedges:[{label:'One group',nodes:['a','b','missing'],relation:'participates in'}]});
 assert.equal(knowledgeGroups(g)[0].missing,1);const group=knowledgeGroup(g,'0');assert.equal(group.nodes.length,2);assert.equal(group.edges.length,0);assert.throws(()=>knowledgeGroup(g,'missing'),/not found/);
});
