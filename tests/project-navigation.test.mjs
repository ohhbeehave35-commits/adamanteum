import test from 'node:test';
import assert from 'node:assert/strict';
import {projectNeighborhood,projectRelations,projectGraphML,projectPath,projectImpact} from '../project-navigation.mjs';
const graph={nodes:[{id:'a',title:'caller',kind:'function',path:'a.js',line:1},{id:'b',title:'callee & <safe>',kind:'function',path:'b.js',line:2},{id:'c',title:'unrelated',kind:'file',path:'c.js'}],edges:[{source:'a',target:'b',type:'invokes'}]};
test('focused exploration includes incoming callers and preserves direction',()=>{
 const result=projectNeighborhood(graph,{focus:'b'});assert.equal(result.nodes.length,2);assert.deepEqual(result.edges,graph.edges);
 const relations=projectRelations(graph,'b');assert.equal(relations.incoming[0].node.id,'a');assert.equal(relations.outgoingTotal,0);
});
test('focus is bounded and rejects unknown nodes; search returns actual matches',()=>{
 assert.equal(projectNeighborhood(graph,{focus:'b',limit:1}).nodes.length,1);
 assert.throws(()=>projectNeighborhood(graph,{focus:'missing'}));assert.equal(projectNeighborhood(graph,{q:'unrelated'}).nodes[0].id,'c');
});
test('GraphML exports directed typed relationships with escaped source labels',()=>{
 const xml=projectGraphML(graph);assert.match(xml,/edgedefault="directed"/);assert.match(xml,/callee &amp; &lt;safe&gt;/);assert.match(xml,/source="a" target="b"/);assert.match(xml,/>invokes</);
 assert.match(projectGraphML({...graph,directed:false,edges:[{...graph.edges[0],quote:'a < b',origin:'model-inferred'}]}),/edgedefault="undirected"/);
 assert.match(projectGraphML({...graph,edges:[{...graph.edges[0],quote:'a < b'}]}),/a &lt; b/);
});
test('call paths preserve direction; reverse impact shows actual callers',()=>{
 assert.deepEqual(projectPath(graph,'a','b').path,['a','b']);assert.deepEqual(projectPath(graph,'b','a').path,[]);
 assert.deepEqual(projectImpact(graph,'b').nodes.map(n=>n.id),['b','a']);assert.equal(projectImpact(graph,'b').edges[0].source,'a');
 assert.equal(projectPath(graph,'a','b',{maxVisited:1}).limited,true);
 assert.deepEqual(projectPath(graph,'a','a').path,['a']);assert.throws(()=>projectPath(graph,'bad','b'));
});
test('undirected migration impact walks either endpoint without duplicating edges',()=>{
 const g={...graph,directed:false};
 for(const focus of ['a','b']){
  const result=projectImpact(g,focus);
  assert.equal(result.nodes.length,2);assert.equal(result.edges.length,1);assert.equal(result.directed,false);
 }
 const bounded=projectImpact(g,'a',{limit:1});assert.equal(bounded.limited,true);assert.equal(bounded.edges.length,0);
});
