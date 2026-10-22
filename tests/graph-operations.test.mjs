import test from 'node:test';
import assert from 'node:assert/strict';
import {combineGraphs,clusterGraph} from '../graph-operations.mjs';
import {knowledgeGroups} from '../knowledge-graph.mjs';
const g={schema:'adamantium.graph/v1',directed:true,nodes:[{id:'a',title:'Alpha'},{id:'b',title:'Beta'},{id:'z',title:'Isolated'}],edges:[{source:'a',target:'b',type:'uses',hash:'proof',quote:'Alpha uses Beta'}],groups:[{id:'team',label:'Team',nodes:['a','b']}]};
test('combined projects retain distinct identities, evidence and groups without invented links',()=>{
 const before=JSON.stringify(g),result=combineGraphs([{id:'one',title:'One',graph:g},{id:'two',title:'Two',graph:g}]);
 assert.equal(result.nodes.length,6);assert.equal(new Set(result.nodes.map(n=>n.id)).size,6);assert.equal(result.edges.length,2);assert.equal(result.edges[1].hash,'proof');assert.equal(result.edges[1].quote,'Alpha uses Beta');assert.equal(knowledgeGroups(result).length,2);assert.equal(JSON.stringify(g),before);
 assert.throws(()=>combineGraphs([{id:'one',graph:g},{id:'two',graph:{...g,directed:false}}]),/direction/);
 assert.throws(()=>combineGraphs([{id:'one',graph:g},{id:'one',graph:g}]),/distinct/);
});
test('deterministic communities cover every entity and preserve disconnected nodes and original edges',()=>{
 const clustered=clusterGraph(g),repeat=clusterGraph({...g,nodes:[...g.nodes].reverse()});
 assert.deepEqual(clustered.groups,repeat.groups);assert.equal(clustered.analysis.isolated,1);assert.equal(clustered.analysis.communities,2);assert.deepEqual(clustered.edges,g.edges);
 const members=clustered.groups.filter(x=>x.origin).flatMap(x=>x.nodes);assert.equal(new Set(members).size,3);assert.equal(members.length,3);
});
