import test from 'node:test';
import assert from 'node:assert/strict';
import {extractPython,assembleGraph} from '../code-extractor.mjs';
const scan=async files=>assembleGraph(await Promise.all(Object.entries(files).map(([name,body])=>extractPython(name,body))));
const targets=g=>g.edges.filter(e=>e.type==='invokes').map(e=>({from:g.nodes.find(n=>n.id===e.source)?.title,to:g.nodes.find(n=>n.id===e.target)?.title}));
test('Python pipe encoding preserves Unicode names and source text on Windows',async()=>{
 const g=await scan({'café.py':'# 🐝 日本語 résumé\ndef café():\n    return "中文 🚀"\ndef entrée():\n    café()\n'});
 assert.deepEqual(targets(g),[{from:'entrée',to:'café'}]);
 assert.ok(g.nodes.every(n=>n.path==='café.py'));
});
test('Python calls resolve lexical definitions, aliased imports, namespaces and reexports',async()=>{
 const g=await scan({'pkg/main.py':'from .api import run as execute\nimport pkg.helper as helper\ndef start():\n    execute(); helper.run()\n','pkg/api.py':'from .helper import run\n','pkg/helper.py':'def run():\n    return 42\n'});
 assert.deepEqual(targets(g),[{from:'start',to:'run'},{from:'start',to:'run'}]);
 assert.equal(g.nodes.filter(n=>n.path==='pkg/main.py'&&n.kind==='call').length,2);
});
test('Python parameters, local assignments, decorators and wildcard imports never guess a callee',async()=>{
 const g=await scan({'a.py':'def run(): pass\ndef parameter(run):\n    run()\ndef local():\n    run()\n    run = None\n@decorate\ndef altered(): pass\ndef caller():\n    altered()\n','b.py':'from a import *\ndef caller():\n    run()\n'});
 assert.equal(targets(g).length,0);assert.ok(g.unresolvedCalls.length>=4);
});
test('Python methods skip class-body bindings and same-line calls keep distinct identities',async()=>{
 const g=await scan({'a.py':'def run(): pass\nclass Example:\n    def run(): pass\n    def method(self):\n        run(); run()\n'});
 const calls=g.edges.filter(e=>e.type==='invokes');assert.equal(calls.length,2);assert.notEqual(calls[0].occurrence,calls[1].occurrence);
 assert.ok(calls.every(e=>g.nodes.find(n=>n.id===e.target).line===1));
});
test('Python comprehensions, global writes and cyclic exports remain conservative',async()=>{
 const g=await scan({'a.py':'def run(): pass\ndef mutate():\n    global run\n    run = None\ndef caller():\n    run()\n','b.py':'def f(): pass\nvalues = [f() for f in []]\n','c.py':'from d import run\ndef caller():\n    run()\n','d.py':'from c import run\n'});
 assert.equal(targets(g).length,0);assert.ok(g.unresolvedCalls.length>=3);
});
test('Python match bindings and nonlocal mutations do not become false call targets',async()=>{
 const g=await scan({'a.py':'def run(): pass\ndef caller(value):\n    match value:\n        case {"function": run}:\n            run()\ndef outer():\n    def nested(): pass\n    def mutate():\n        nonlocal nested\n        nested = None\n    nested()\n'});assert.equal(targets(g).length,0);
});
