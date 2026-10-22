import test from 'node:test';
import assert from 'node:assert/strict';
import {exportGraph} from '../graph-export.mjs';
const graph={directed:true,nodes:[{id:'a',title:'<script>alert(1)</script>',path:'a.ts',line:7,hash:'abc'},{id:'b',title:'"]\nclick n0 "https://evil.test"'}],edges:[{source:'a',target:'b',type:'calls',origin:'syntax',quote:'call()'}]};
test('document and visual graph exports preserve evidence and direction without executable source labels',()=>{
 const canvas=JSON.parse(exportGraph(graph,'canvas'));assert.equal(canvas.nodes.length,2);assert.equal(canvas.edges[0].toEnd,'arrow');assert.match(canvas.nodes[0].text,/a.ts:7/);
 assert.equal(JSON.parse(exportGraph({...graph,directed:false},'canvas')).edges[0].toEnd,'none');
 const diagram=exportGraph(graph,'mermaid');assert.equal(diagram.split('\n').length,5);assert.ok(!diagram.includes('<script>'));assert.match(diagram,/n0 -->/);
 const md=exportGraph(graph,'md');assert.match(md,/SHA-256: abc/);assert.ok(!md.includes('<script>'));assert.match(md,/origin: syntax/);
 assert.deepEqual(JSON.parse(exportGraph(graph,'json')),graph);
});
test('visual exports enforce bounds and reject malformed graph identities',()=>{
 assert.throws(()=>exportGraph({...graph,nodes:Array.from({length:2001},(_,i)=>({id:String(i)}))},'canvas'),/limited/);
 assert.throws(()=>exportGraph({...graph,edges:[{source:'a',target:'missing'}]},'md'),/dangling/);
 assert.throws(()=>exportGraph(graph,'exe'),/Supported/);
});
test('SVG and offline HTML exports escape hostile labels and load no remote resources',()=>{
 for(const format of ['svg','html']){const result=exportGraph(graph,format);assert.ok(!result.includes('<script>'));assert.ok(!result.includes('onclick='));assert.match(result,/&lt;script&gt;/);assert.match(result,/marker-end="url\(#arrow\)"/);}
 assert.match(exportGraph(graph,'html'),/default-src 'none'/);
 assert.ok(!exportGraph({...graph,directed:false},'svg').includes('marker-end='));
});
