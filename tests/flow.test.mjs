import test from 'node:test';
import assert from 'node:assert/strict';
import {flowPoint,flowParticles} from '../dist/flow.js';
import {Atlas} from '../dist/graph.js';
test('animation follows original directed curves without modifying nodes or edges',()=>{
 const a={id:1,x:0,y:0},b={id:2,x:100,y:0},edges=[{a,b}],copy=structuredClone(edges);
 assert.deepEqual(flowPoint(a,b,0),{x:0,y:0});assert.deepEqual(flowPoint(a,b,1),{x:100,y:0});
 assert.deepEqual(flowPoint(a,b,.5,true),{x:50,y:0});assert.equal(flowPoint(a,b,.5).y,4.5);
 assert.ok(flowParticles(edges,2250)[0].head.x>flowParticles(edges,1000)[0].head.x);assert.deepEqual(edges,copy);
});
test('animation bounds work and follows focused connections only',()=>{
 const edges=Array.from({length:100000},(_,i)=>({a:{id:i,x:i,y:0},b:{id:i+1,x:i+1,y:5}}));
 assert.ok(flowParticles(edges,100).length<=64);assert.equal(flowParticles(edges,100,{active:2}).length,2);
 assert.deepEqual(flowParticles([],0),[]);assert.deepEqual(flowParticles(edges,0,{limit:0}),[]);
});
test('animation stops without drawing for hidden, reduced-motion, undirected and paused views',()=>{
 const oldDocument=globalThis.document,oldMatch=globalThis.matchMedia;
 try{
  globalThis.document={hidden:false};globalThis.matchMedia=()=>({matches:false});
  const graph={animating:false,edges:[{}],canvas:{dataset:{}}},c=new Proxy({},{get(){return ()=>{throw Error('Unexpected drawing');};}});
  assert.equal(Atlas.prototype.drawFlow.call(graph,c,0),false);assert.equal(graph.canvas.dataset.animation,'off');
  graph.animating=true;
  for(const flag of ['hideEdges','timelineMode','undirected']){graph[flag]=true;assert.equal(Atlas.prototype.drawFlow.call(graph,c,0),false);graph[flag]=false;}
  document.hidden=true;assert.equal(Atlas.prototype.drawFlow.call(graph,c,0),false);document.hidden=false;
  globalThis.matchMedia=()=>({matches:true});assert.equal(Atlas.prototype.drawFlow.call(graph,c,0),false);
  assert.equal(graph.canvas.dataset.animation,'paused');assert.equal(graph.canvas.dataset.flowParticles,'0');
 }finally{globalThis.document=oldDocument;globalThis.matchMedia=oldMatch;}
});
