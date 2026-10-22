import test from 'node:test';
import assert from 'node:assert/strict';
import {extractSource,extractPython,assembleGraph,parseJsonc,aliasesFromConfigs} from '../code-extractor.mjs';
import {extractMultilang} from '../multilang-extractor.mjs';
import {resolveModule} from '../symbol-resolution.mjs';
import {VaultWorkspace,formatDate,renderTemplate,frontmatter,markdown,tagsOf} from '../vault-workspace.mjs';
import {parseYaml,stringifyYaml} from '../yaml-lite.mjs';
import {baseView,baseYaml,parseBase,canvasText,canvasTargets,compileFilter} from '../vault-views.mjs';
import {searchPlan} from '../vault-search.mjs';
import {nearest,resolver} from '../lib.mjs';
import {clusterGraph} from '../graph-operations.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const links=g=>g.edges.filter(e=>e.type==='invokes').map(e=>[g.nodes.find(n=>n.id===e.source)?.title,g.nodes.find(n=>n.id===e.target)?.title,g.nodes.find(n=>n.id===e.target)?.path]);
const scan=async files=>assembleGraph(await Promise.all(Object.entries(files).map(([name,body])=>/\.py$/.test(name)?extractPython(name,body):/\.[cm]?[jt]sx?$/.test(name)?extractSource(name,body):extractMultilang(name,body))));
test('row 11: tsconfig path aliases resolve project imports; packages stay external',async()=>{
 const configs=[{file:'tsconfig.json',config:parseJsonc('{ // comment\n "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"], }, }, /* block */ }')}];
 const aliases=aliasesFromConfigs(configs);assert.deepEqual(aliases[0],{pattern:'@/*',targets:['src/*']});
 const files=new Map([['src/lib/store.ts',1],['src/a.ts',1]]);
 assert.equal(resolveModule('src/a.ts','@/lib/store',files,aliases),'src/lib/store.ts');
 assert.equal(resolveModule('src/a.ts','react',files,aliases),null);
 const g=assembleGraph([extractSource('src/a.ts',"import {run} from '@/lib/store';import {x} from 'react'; export function go(){run();x();}"),extractSource('src/lib/store.ts','export function run(){}')],{aliases});
 assert.equal(links(g).length,1);assert.equal(g.callSummary.byCode['external-package'],1);
});
test('row 11: this.method(), Class.method() and exported factory bindings resolve; other receivers stay unresolved',async()=>{
 const g=assembleGraph([extractSource('a.ts',"import {Box,useThing} from './b'; export class Local{ ping(){ this.pong(); this.missing(); } pong(){} static make(){} }\nexport function f(o){ Local.make(); Box.open(); o.pong(); useThing(); }"),extractSource('b.ts',"export class Box{ static open(){} }\nexport const useThing = create(() => 1) as Hook;")]);
 const names=links(g).map(([from,to])=>from+'>'+to).sort();
 assert.deepEqual(names,['f>make','f>open','f>useThing','ping>pong']);
 assert.ok(g.unresolvedCalls.some(u=>u.code==='method-on-instance'||u.code==='parameter'||u.code==='member-of-parameter'));
});
test('row 11: Python self.method() and Class.method() resolve by containment; builtins are named',async()=>{
 const g=await scan({'a.py':'class K:\n    def run(self):\n        self.step()\n        len([])\n    def step(self): pass\n    @staticmethod\n    def make(): pass\ndef f():\n    K.make()\n    helper()\n'});
 const names=links(g).map(([a,b])=>a+'>'+b).sort();assert.deepEqual(names,['f>make','run>step']);
 assert.ok(g.unresolvedCalls.some(u=>u.code==='builtin-or-global'));
});
test('row 11: Go package, C global, Java Class.method and Rust module calls resolve across files',async()=>{
 const g=await scan({'util/a.go':'package util\nfunc Helper() {}\nfunc start() { sibling() }','util/b.go':'package util\nfunc sibling() {}','main/m.go':'package main\nimport "demo/util"\nfunc run() { util.Helper() }','x.c':'void shared(void) {} static void local(void) {}','y.c':'void caller(void) { shared(); local(); }','Zed.java':'class Zed { static void util() {} }','Use.java':'class Use { void go() { Zed.util(); } }','src/util.rs':'pub fn target() {}','src/main.rs':'use crate::util::target;\nfn start() { target(); crate::util::target(); }'});
 const names=links(g).map(([a,b,p])=>a+'>'+b+'@'+p).sort();
 assert.deepEqual(names,['caller>shared@x.c','go>util@Zed.java','run>Helper@util/a.go','start>sibling@util/b.go','start>target@src/util.rs','start>target@src/util.rs'].sort());
});
test('row 10: communities carry readable names',()=>{
 const g=clusterGraph({schema:'adamantium.graph/v1',directed:true,nodes:[{id:'a',title:'Payment invoice',path:'billing/invoice.ts'},{id:'b',title:'Payment refund',path:'billing/refund.ts'},{id:'c',title:'Payment ledger',path:'billing/ledger.ts'}],edges:[{source:'a',target:'b',type:'x'},{source:'b',target:'c',type:'x'}]});
 const group=g.groups.find(x=>x.origin);assert.match(group.label,/payment/i);assert.equal(group.nodes.length,3);
});
test('YAML: nested properties, multi-line text, lists and quoting round trip without executing anything',()=>{
 const text='title: "A: b"\nowners:\n  - Ana\n  - Ben\nnested:\n  deep:\n    - k: v\n      n: 2\nnote: |\n  line1\n  line2\nflag: true\n';
 const value=parseYaml(text);assert.equal(value.nested.deep[0].n,2);assert.equal(value.note,'line1\nline2\n');
 assert.deepEqual(parseYaml(stringifyYaml(value)),value);
 assert.throws(()=>parseYaml('a: [1, 2'),/flow|Bad/i);
});
test('properties edit keeps untouched frontmatter text byte for byte',()=>{
 const original='---\n# keep this comment\nstatus:   draft\ntags: [a, b]\n---\nBody\n';const parsed=frontmatter(original);
 assert.equal(markdown('Body\n',parsed.properties,parsed),original);
 assert.notEqual(markdown('Body\n',{...parsed.properties,status:'done'},parsed),original);
 assert.deepEqual(tagsOf('# 123\n#12 #real-tag\n```\n#fenced\n```'),['real-tag']);
});
test('Bases: filter expressions, saved YAML and legacy JSON both work',()=>{
 const docs=[{path:'a/x.md',body:'---\nstatus: draft\npriority: 3\ntags: [hub]\n---\n'},{path:'b/y.md',body:'---\nstatus: done\npriority: 1\n---\n'}];
 assert.equal(compileFilter('status == "draft" && priority >= 2')({file:{name:'x',tags:[],folder:'a'},properties:{status:'draft',priority:3}}),true);
 const yaml=baseYaml({filters:['file.hasTag("hub")'],columns:['file.name','status'],sort:[{property:'priority',direction:'DESC'}],group:{property:'status'},name:'T'});
 const result=baseView(docs,parseBase(yaml));assert.equal(result.total,1);assert.equal(Object.values(result.groups)[0][0]['file.name'],'x');
 assert.equal(baseView(docs,{columns:['file'],filters:{status:'done'}}).total,1);
 assert.throws(()=>baseYaml({filters:['status ==']}),/Filter/);
});
test('Canvas text and file cards become searchable text and note links',()=>{
 const body=JSON.stringify({nodes:[{id:'a',type:'text',text:'needle [[Home]]',x:0,y:0,width:1,height:1},{id:'b',type:'file',file:'Notes/Plan.md#Goals',x:0,y:0,width:1,height:1}],edges:[]});
 assert.match(canvasText(body),/needle/);assert.deepEqual(canvasTargets(body).sort(),['Home','Notes/Plan.md']);
});
test('Search: OR groups and bracket properties parse; duplicate names prefer the vault root',()=>{
 const plan=searchPlan('a OR [status:draft] b');assert.equal(plan.groups.length,2);assert.equal(plan.groups[1].filters[0].key,'status');
 assert.equal(resolver(['00-HOME.md','Archive/R2/00-HOME.md','Archive/R2/Copy.md'])('Archive/R2/Copy.md','00-HOME'),'00-HOME.md');
 assert.equal(nearest('Projects/a.md',['Projects/Zed.md','Notes/Zed.md']),'Projects/Zed.md');
});
test('Daily notes: Moment tokens, literals and template placeholders',()=>{
 const d=new Date('2026-10-21T12:00:00Z');
 assert.equal(formatDate(d,'YYYY/MM-DD dddd'),'2026/10-21 Wednesday');assert.equal(formatDate(d,'[Week] W, MMM Do YY'),'Week 43, Oct 21st 26');
 assert.equal(renderTemplate('# {{date:dddd}} {{title}} {{date}}',{date:d,title:'T'}),'# Wednesday T 2026-10-21');
});
test('vault write is atomic: no temp or lock files remain and the content is complete',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'adamantium05-'));try{const v=new VaultWorkspace(root,{writable:true});const r=v.write({path:'A/b.md',body:'x'.repeat(5000)});
  assert.equal(fs.readdirSync(path.join(root,'A')).join(),'b.md');assert.equal(fs.readFileSync(path.join(root,'A','b.md'),'utf8').length,5000);assert.equal(r.bytes,5000);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
import {validateSemanticGraph,semanticPrompt} from '../knowledge-graph.mjs';
test('row 10: model-written claims must quote the source; Markdown markup is ignored but invented quotes are rejected',()=>{
 const doc={id:7,path:'Notes/a.md',body:'The **laptop** pushes to [GitHub](https://github.com) every ten minutes.'};
 const answer=quote=>JSON.stringify({entities:[{id:'e1',name:'laptop',kind:'system'},{id:'e2',name:'GitHub',kind:'system'}],relations:[{source:'e1',target:'e2',relation:'pushes to',documentId:7,quote,confidence:0.9}]});
 assert.equal(validateSemanticGraph(answer('The laptop pushes to GitHub every ten minutes.'),[doc],'local').edges.length,1);
 const invented=validateSemanticGraph(answer('The laptop never pushes to GitHub, ever, at all.'),[doc],'local');
 assert.equal(invented.edges.length,0);assert.equal(invented.rejected.length,1);
 assert.match(semanticPrompt([doc]),/untrusted DATA/i);
});
test('duplicate names: the note nearest the vault root wins even when a deeper copy is closer to the link',()=>{
 assert.equal(resolver(['A/B/C/Note.md','X/Note.md'])('A/B/C/Sub/Src.md','Note'),'X/Note.md');
 assert.equal(resolver(['A/Note.md','B/Note.md','A/Src.md'])('A/Src.md','Note'),'A/Note.md');
 assert.equal(resolver(['A/Note.md','B/Note.md','Home.md'])('Home.md','Note'),null);
});

test('vault writes never touch hidden folders such as .obsidian or .git',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'adamantium05-'));try{const v=new VaultWorkspace(root,{writable:true});
  assert.throws(()=>v.write({path:'.obsidian/app.json',body:'{}'}),/Hidden folders/);assert.throws(()=>v.write({path:'Notes/.git/config.md',body:'x'}),/Hidden folders/);
  assert.equal(v.write({path:'Notes/ok.md',body:'fine'}).bytes,4);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
