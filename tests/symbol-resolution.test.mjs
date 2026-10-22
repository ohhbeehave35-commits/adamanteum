import test from 'node:test';
import assert from 'node:assert/strict';
import {extractSource,assembleGraph} from '../code-extractor.mjs';
const graph=files=>assembleGraph(Object.entries(files).map(([p,s])=>extractSource(p,s)));
const invocations=g=>g.edges.filter(e=>e.type==='invokes');
test('lexical calls resolve through imports, aliases, namespace and re-exports',()=>{
 const g=graph({'a.ts':"import {run as go} from './barrel'; import * as helpers from './b'; export function start(){go();helpers.run();}",
 'barrel.ts':"export {run} from './b';",'b.ts':'export const run=()=>42;'});
 assert.equal(invocations(g).length,2);
 assert.ok(invocations(g).every(e=>e.source.includes('start')&&e.target.startsWith('b.ts#function:run')));
});
test('parameters and reassigned functions do not falsely resolve to an outer definition',()=>{
 const g=graph({'a.js':'function run(){} function f(run){run();} run(); let changed=()=>1; changed=other; changed();'});
 assert.equal(invocations(g).length,1);assert.equal(g.unresolvedCalls.length,2);
});
test('same-line call sites and shadowed local definitions remain distinct',()=>{
 const g=graph({'a.js':'function run(){} function f(){function run(){} run();run();} run();'});
 assert.equal(invocations(g).length,3);
 assert.equal(new Set(invocations(g).map(e=>e.occurrence)).size,3);
 assert.equal(new Set(invocations(g).map(e=>e.target)).size,2);
});
test('package names are never resolved to coincidentally named project files',()=>{
 const g=graph({'a.js':"import {run} from 'b';run();",'b.js':'export function run(){}'});
 assert.equal(invocations(g).length,0);assert.equal(g.unresolved.length,1);
});
test('star export ambiguity and cycles terminate without inventing a target',()=>{
 const g=graph({'a.js':"import {run} from './barrel';run();",'barrel.js':"export * from './b';export * from './c';export * from './cycle';",
 'b.js':'export function run(){}','c.js':'export function run(){}','cycle.js':"export * from './barrel';"});
 assert.equal(invocations(g).length,0);assert.equal(g.unresolvedCalls.length,1);
});
test('default function export and TypeScript runtime extension resolve',()=>{
 const g=graph({'a.ts':"import start from './b.js';start();",'b.ts':'export default function run(){}'});
 assert.equal(invocations(g).length,1);assert.ok(invocations(g)[0].target.includes('run'));
});
