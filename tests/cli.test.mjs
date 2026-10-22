import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile),cli=fileURLToPath(new URL('../adamantium-cli.mjs',import.meta.url));
test('standalone CLI extracts, searches, traces and exports without Graphify or overwriting files',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'adamantium-cli-test-')),source=path.join(root,'source'),output=path.join(root,'graph.json');await fs.mkdir(source);
 const run=async(...args)=>JSON.parse((await exec(process.execPath,[cli,...args],{windowsHide:true})).stdout);
 try{
  await fs.writeFile(path.join(source,'a.js'),"import {run} from './b.js';export function start(){run();}");await fs.writeFile(path.join(source,'b.js'),'export function run(){}');
  const scanned=await run('scan',source,'--output',output);assert.equal(scanned.files,2);
  const g=JSON.parse(await fs.readFile(output,'utf8')),from=g.nodes.find(n=>n.title==='start'),to=g.nodes.find(n=>n.title==='run'&&n.kind==='FunctionDeclaration');
  assert.equal((await run('path',output,from.id,to.id)).path.length,2);
  assert.equal((await run('affected',output,to.id)).nodes.length,2);
  assert.ok((await run('query',output,'start')).length);
  assert.equal((await run('stats',output)).resolvedCalls,1);
  const context=await run('context',output,from.id,'bfs','2000');assert.ok(context.entities>0);assert.ok(context.characters<=2000);assert.match(context.text,/UNTRUSTED GRAPH DATA/);
  const xml=path.join(root,'graph.graphml');await run('export',output,xml);assert.match(await fs.readFile(xml,'utf8'),/edgedefault="directed"/);
  await assert.rejects(()=>run('export',output,xml));
  const legacy=path.join(root,'legacy.json'),migrated=path.join(root,'migrated.json');await fs.writeFile(legacy,JSON.stringify({directed:true,nodes:[{id:'a',label:'Assistant'},{id:'b',label:'Memory'}],links:[{source:'a',target:'b',relation:'uses'}]}));
  assert.equal((await run('import',legacy,migrated)).edges,1);assert.equal((await run('query',migrated,'Assistant'))[0].node.title,'Assistant');await assert.rejects(()=>run('import',legacy,migrated));
  const clustered=path.join(root,'clustered.json'),combined=path.join(root,'combined.json');assert.equal((await run('cluster',migrated,clustered)).communities,1);assert.equal((await run('combine',combined,migrated,clustered)).nodes,4);assert.equal((await run('notes',migrated,path.join(root,'notes'))).notes,2);
  for(const format of ['canvas','md','mermaid','svg','html']){const target=path.join(root,'portable.'+format);await run('export',migrated,target);assert.ok((await fs.stat(target)).size>20);}
 }finally{if(path.dirname(root)!==os.tmpdir()||!path.basename(root).startsWith('adamantium-cli-test-'))throw Error('Unexpected path');await fs.rm(root,{recursive:true});}
});
