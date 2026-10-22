import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeGraph,graphML} from '../dist/analysis.js';
test('structural analysis preserves disconnected components and normalized rank',()=>{
 const nodes=[1,2,3,4].map(id=>({id,title:'Node '+id,path:id+'.md'})),edges=[{source:1,target:2},{source:2,target:3}];
 const result=analyzeGraph(nodes,edges);
 assert.deepEqual(result.components,[[1,2,3],[4]]);
 assert.deepEqual(result.isolated,[4]);
 assert.equal(result.ranked[0].id,3);
 assert.ok(Math.abs(result.ranked.reduce((s,n)=>s+n.score,0)-1)<1e-9);
 assert.equal(result.communities.flat().length,4);
 assert.deepEqual(analyzeGraph(nodes,edges),result);
});
test('GraphML exports directed source links and escapes user content',()=>{
 const output=graphML([{id:1,title:'A <script>&"',path:'a.md'},{id:2,title:'B',path:'b.md'}],[{source:1,target:2}]);
 assert.ok(output.includes('edgedefault="directed"'));
 assert.ok(output.includes('source="n1" target="n2"'));
 assert.ok(output.includes('A &lt;script&gt;&amp;&quot;'));
 assert.ok(!output.includes('<script>'));
});
