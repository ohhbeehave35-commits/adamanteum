import test from 'node:test';
import assert from 'node:assert/strict';
import {extractMultilang,languageFor} from '../multilang-extractor.mjs';
const fixtures={
 c:'int start(void) { return 1; }',cpp:'class Engine { public: int start() { return 1; } };',cs:'class Engine { int Start() { return 1; } }',
 go:'package main\nfunc start() int { return 1 }',java:'class Engine { int start() { return 1; } }',rs:'fn start() { run(); } fn run() {}',
 rb:'class Engine\n def start\n  run()\n end\nend',php:'<?php function start() { return 1; }',lua:'function start() return 1 end',sh:'start() { echo ready; }',
 kt:'fun start(): Int { return 1 }',swift:'func start() -> Int { return 1 }',scala:'object Engine { def start(): Int = 1 }',zig:'fn start() void {}',dart:'int start() { return 1; }',
 ex:'defmodule Engine do\n def start(), do: 1\nend',el:'(defun start () 1)',ml:'let start x = x + 1',res:'let start = (x) => x + 1\n',
 sol:'contract Engine { function start() public pure returns (uint) { return 1; } }',m:'@interface Engine\n- (void)start;\n@end',
 rdl:'addrmap Engine { reg { field {} ready[0:0]; } control; };',tla:'---- MODULE Engine ----\nstart == 1\n====',
 html:'<main><h1>Engine</h1></main>',css:'.engine { color: red; }',vue:'<template><main>Engine</main></template>',toml:'[engine]\nname = "start"',erb:'<main><%= name %></main>'
};
for(const [ext,body] of Object.entries(fixtures))test(`native ${languageFor('sample.'+ext)} syntax graph has source evidence`,async()=>{
 const graph=await extractMultilang('sample.'+ext,body);
 assert.ok(graph.nodes.length>1,`Only a file node: ${JSON.stringify(graph.nodes)}`);
 assert.ok(graph.nodes.every(n=>n.hash.length===64&&n.line>=1&&n.language));
 assert.ok(graph.edges.every(e=>graph.nodes.some(n=>n.id===e.source)&&graph.nodes.some(n=>n.id===e.target)));
 assert.ok(!graph.edges.some(e=>e.type==='invokes'),'Unknown calls must not become resolved callees');
});
test('multilanguage syntax errors and unsupported languages fail explicitly',async()=>{
 await assert.rejects(()=>extractMultilang('bad.rs','fn broken( {'),/syntax error/);
 await assert.rejects(()=>extractMultilang('bad.unknown','x'),/Unsupported/);
});
