import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Worker} from 'node:worker_threads';
function scan(directory,cacheFile){return new Promise((resolve,reject)=>{
 const worker=new Worker(new URL('../project-worker.mjs',import.meta.url),{workerData:{directory,cacheFile}});
 let result;worker.on('message',message=>{if(message.phase==='error')reject(Error(message.error));if(message.phase==='complete')result=message.result;});
 worker.on('error',reject);worker.on('exit',()=>result?resolve(result):reject(Error('No project result')));
});}
test('project worker integrates native C and Rust syntax with JavaScript and cached evidence',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'adamantium-project-test-')),source=path.join(root,'source');await mkdir(source);
 try{
  await writeFile(path.join(source,'native.c'),'int multiply(int a,int b){return a*b;}');
  await writeFile(path.join(source,'native.rs'),'fn greet() { println!("hello"); }');
  await writeFile(path.join(source,'web.js'),'export function start() {}');
  const cache=path.join(root,'cache.json'),first=await scan(source,cache),again=await scan(source,cache);
  assert.equal(first.files,3);assert.equal(first.issues.length,0);assert.equal(again.reused,3);
  for(const title of ['multiply','greet','start'])assert.ok(first.nodes.some(n=>n.title===title),title);
  assert.deepEqual(first.nodes,again.nodes);assert.deepEqual(first.edges,again.edges);
 }finally{if(path.dirname(root)!==os.tmpdir()||!path.basename(root).startsWith('adamantium-project-test-'))throw Error('Unexpected temporary path');await rm(root,{recursive:true});}
});
test('bounded parallel Python parsing retains deterministic graphs and explicit file failures',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'adamantium-project-test-')),source=path.join(root,'source'),cache=path.join(root,'cache.json');await mkdir(source);
 try{
  for(let i=0;i<9;i++)await writeFile(path.join(source,`module${i}.py`),`def café${i}():\n    return ${i}\n`);
  await writeFile(path.join(source,'broken.py'),'def invalid(\n');
  const first=await scan(source,cache),again=await scan(source,cache);
  assert.equal(first.files,9);assert.equal(first.issues.length,1);assert.equal(first.issues[0].path,'broken.py');
  assert.equal(again.reused,9);assert.deepEqual(again.nodes,first.nodes);assert.deepEqual(again.edges,first.edges);
 }finally{if(path.dirname(root)!==os.tmpdir()||!path.basename(root).startsWith('adamantium-project-test-'))throw Error('Unexpected temporary path');await rm(root,{recursive:true});}
});
test('project cache tracks additions, content changes and deletions without modifying source files',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'adamantium-project-test-')),source=path.join(root,'source'),cache=path.join(root,'cache.json');
 await mkdir(source);
 try{
  await writeFile(path.join(source,'a.ts'),"import './b';\nexport const a=1;");
  await writeFile(path.join(source,'b.ts'),'export function b(){return 2;}');
  const first=await scan(source,cache);assert.equal(first.files,2);assert.equal(first.reused,0);
  const again=await scan(source,cache);assert.equal(again.reused,2);
  await writeFile(path.join(source,'b.ts'),'export function changed(){return 3;}');
  await rm(path.join(source,'a.ts'));
  const third=await scan(source,cache);assert.equal(third.files,1);assert.equal(third.removed,1);assert.equal(third.changed,1);
  assert.ok(third.nodes.some(n=>n.title==='changed'));assert.ok(!third.nodes.some(n=>n.path==='a.ts'));
 }finally{
  if(path.dirname(root)!==os.tmpdir()||!path.basename(root).startsWith('adamantium-project-test-'))throw Error('Unexpected temporary path');
  await rm(root,{recursive:true});
 }
});
