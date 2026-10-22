import test from 'node:test';
import assert from 'node:assert/strict';
import {projectContext} from '../project-navigation.mjs';
const graph={nodes:['a','b','c','d'].map(id=>({id,title:id,kind:'entity',path:id+'.md',hash:'abc'})),edges:[{source:'a',target:'b',type:'uses',quote:'a uses b',origin:'model-inferred'},{source:'a',target:'c',type:'uses'},{source:'b',target:'d',type:'uses'},{source:'d',target:'a',type:'returns'}]};
test('bounded BFS and DFS context preserve evidence, direction and cycle safety',()=>{
 for(const strategy of ['bfs','dfs']){
  const result=projectContext(graph,'a',{strategy,maxChars:4000});assert.equal(result.entities,4);assert.equal(result.relationships,4);
  assert.equal(result.characters,result.text.length);assert.ok(result.characters<=result.budget);assert.match(result.text,/model-inferred/);assert.match(result.text,/a uses b/);
 }
 assert.equal(projectContext(graph,'a',{depth:0}).entities,1);
 assert.equal(projectContext(graph,'c',{direction:'outgoing'}).entities,1);
 assert.equal(projectContext({...graph,directed:false},'c',{direction:'outgoing'}).entities,4);
 assert.throws(()=>projectContext(graph,'missing'));
 assert.throws(()=>projectContext(graph,'a',{strategy:'bad'}));
});
test('context budgets never silently exceed the declared character limit',()=>{
 const result=projectContext(graph,'a',{maxChars:512});assert.ok(result.text.length<=512);assert.equal(result.truncated,true);
 const long={nodes:[{id:'a'.repeat(2000),title:'Long'}],edges:[]};assert.throws(()=>projectContext(long,long.nodes[0].id,{maxChars:512}),/too small/);
});
test('large neighborhoods reserve room for relationships instead of returning disconnected entity lists',()=>{
 const large={nodes:Array.from({length:100},(_,i)=>({id:String(i),title:'Entity '+i,path:'source.py',hash:'a'.repeat(64)})),edges:Array.from({length:99},(_,i)=>({source:'0',target:String(i+1),type:'calls',origin:'syntax',hash:'b'.repeat(64)}))};
 const result=projectContext(large,'0');assert.ok(result.relationships>0);assert.ok(result.entities>1);assert.ok(result.characters<=12000);assert.equal(result.truncated,true);
});
