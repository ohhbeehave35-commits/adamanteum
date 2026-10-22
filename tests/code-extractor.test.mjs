import test from 'node:test';
import assert from 'node:assert/strict';
import {extractSource,extractPython,assembleGraph} from '../code-extractor.mjs';
test('TypeScript module declaration extensions use the TypeScript parser',()=>{
 for(const name of ['types.d.mts','types.d.cts','module.mts','module.cts']){
  const result=extractSource(name,'export interface Options { name: string }\nexport type ID = number;');
  assert.ok(result.nodes.some(n=>n.title==='Options'));
  assert.ok(result.nodes.some(n=>n.title==='ID'));
 }
});
test('Python AST is isolated, does not execute source and resolves explicit module imports',async()=>{
 const a=await extractPython('pkg/main.py',"from .helper import run\nraise RuntimeError('must not execute')\ndef start():\n    return run()\n");
 const b=await extractPython('pkg/helper.py','def run():\n    return 42\n');
 const g=assembleGraph([a,b]);
 assert.ok(g.nodes.some(n=>n.title==='start'&&n.kind==='FunctionDef'));
 assert.ok(g.edges.some(e=>e.type==='imports'&&e.target.startsWith('pkg/helper.py')));
});
test('native AST extracts typed definitions and directed imports with source hashes',()=>{
 const a=extractSource('src/a.ts',"import {run} from './b';\nexport function start(){ return run(); }\ninterface Config { port:number }");
 const b=extractSource('src/b.ts','export const run=()=>42;');
 const g=assembleGraph([a,b]);
 assert.equal(g.files,2);assert.equal(g.unresolved.length,0);
 assert.ok(g.edges.some(e=>e.type==='imports'&&e.source.startsWith('src/a.ts')&&e.target.startsWith('src/b.ts')));
 assert.ok(g.nodes.some(n=>n.title==='Config'&&n.kind==='TSInterfaceDeclaration'));
 assert.ok(g.nodes.every(n=>n.hash.length===64&&n.line>0));
 assert.ok(g.edges.some(e=>e.type==='calls'));
});
test('source code is parsed not executed; invalid syntax is not silently accepted',()=>{
 const result=extractSource('x.js',"throw new Error('must not run');\nfunction f(){}");
 assert.ok(result.nodes.some(n=>n.title==='f'));
 assert.throws(()=>extractSource('broken.ts','function {'));
});
test('Markdown links and package dependencies remain typed evidence',()=>{
 const graph=assembleGraph([extractSource('README.md','# Home\n[Next](guide.md)'),extractSource('guide.md','# Guide'),extractSource('package.json','{"dependencies":{"example":"1.0.0"}}')]);
 assert.ok(graph.edges.some(e=>e.type==='links'));
 assert.ok(graph.edges.some(e=>e.type==='depends-on'));
});
