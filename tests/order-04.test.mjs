import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {VaultWorkspace,fingerprint,frontmatter,markdown,propertyType,tagsOf} from '../vault-workspace.mjs';
import {Notebook} from '../notebook.mjs';
import {searchPlan} from '../vault-search.mjs';
import {baseView,canvasData,linkHealth,changedSince} from '../vault-views.mjs';
import {resolver} from '../lib.mjs';
import {importKnowledgeGraph,knowledgeGroups} from '../knowledge-graph.mjs';
import {writeGraphNotes} from '../graph-notes.mjs';
import {extractMultilang} from '../multilang-extractor.mjs';
import {resolveCalls} from '../symbol-resolution.mjs';
import {AssistantConnection} from '../assistant.mjs';
import {packageFiles,buildZip} from '../package-drop.mjs';
import {fileURLToPath} from 'node:url';
function fixture(fn){const root=fs.mkdtempSync(path.join(os.tmpdir(),'adamantium04-'));const history=new Notebook(':memory:');try{fn(new VaultWorkspace(root,{writable:true,history}),root,history);}finally{history.close();fs.rmSync(root,{recursive:true,force:true});}}
test('order 1 vault writes retain revisions and reject stale hashes and escapes',()=>fixture((v,root,h)=>{
 const first=v.write({path:'Notebook/First.md',body:'# First'});assert.equal(first.sha256,fingerprint('# First'));
 assert.throws(()=>v.write({path:first.path,body:'bad'}),/changed/);
 v.write({path:first.path,body:'# Second',expectedHash:first.sha256});assert.equal(h.list().length,1);assert.equal(h.get(h.list()[0].id).body,'# First');
 assert.throws(()=>v.write({path:'../escape.md',body:''}),/relative/);
 assert.throws(()=>new VaultWorkspace(root).write({path:'no.md',body:''}),/disabled/);
}));
test('order 2 rendered body excludes frontmatter and keeps link and embed source',()=>{
 const note=frontmatter('---\nstatus: draft\n---\n# Heading\n[[Other]]\n![[pic.png]]');
 assert.equal(note.properties.status,'draft');assert.ok(note.body.startsWith('# Heading'));assert.match(note.body,/!\[\[pic.png\]\]/);
});
test('order 3 typed properties round trip without executing markup',()=>{
 const properties={text:'<script>',count:3,date:'2026-10-21',ready:false,list:['a','b']};
 assert.deepEqual({...frontmatter(markdown('Body',properties)).properties},properties);
 assert.deepEqual(Object.values(properties).map(propertyType),['text','number','date','checkbox','list']);
});
test('order 4 tags include frontmatter and inline tags but exclude code',()=>{
 assert.deepEqual(tagsOf('---\ntags:\n  - hub\n  - project/work\n---\n# Heading\n#hub #more `#hidden`'),['hub','project/work','more']);
});
test('order 5 search operator parser preserves phrases and exclusions',()=>{
 const plan=searchPlan('-word "exact phrase" path:Notes file:Home tag:hub line:"hello world" status:draft');
 assert.equal(plan.terms[0].negative,true);assert.equal(plan.terms[1].value,'exact phrase');assert.equal(plan.filters.length,5);assert.equal(plan.filters[3].value,'hello world');
});
test('order 6 property tables filter sort group and persist as vault files',()=>fixture(v=>{
 const config={columns:['file','status'],filters:{status:'draft'},sort:'file',group:'status'};
 const result=baseView([{path:'b.md',body:'---\nstatus: draft\n---\nB'},{path:'a.md',body:'---\nstatus: draft\n---\nA'},{path:'c.md',body:'---\nstatus: done\n---\nC'}],config);
 assert.equal(result.total,2);assert.equal(result.groups.draft[0].file,'a.md');v.write({path:'Views/Work.base',body:JSON.stringify(config)});assert.deepEqual(JSON.parse(v.read('Views/Work.base').body),config);
}));
test('order 7 JSON Canvas accepts text file cards and edges and rejects dangling edges',()=>{
 const canvas={nodes:[{id:'a',type:'text',text:'Find me',x:0,y:0,width:100,height:100},{id:'b',type:'file',file:'Home.md',x:200,y:0,width:100,height:100}],edges:[{fromNode:'a',toNode:'b'}]};
 assert.equal(canvasData(JSON.stringify(canvas)).nodes[1].file,'Home.md');canvas.edges[0].toNode='missing';assert.throws(()=>canvasData(JSON.stringify(canvas)),/Dangling/);
});
test('order 8 daily notes honor vault folder format template and idempotency',()=>fixture((v,root)=>{
 fs.mkdirSync(path.join(root,'.obsidian'));fs.mkdirSync(path.join(root,'Templates'));fs.writeFileSync(path.join(root,'Templates','Daily.md'),'# {{date}}\nPriorities');fs.writeFileSync(path.join(root,'.obsidian','daily-notes.json'),JSON.stringify({folder:'Journal',format:'YYYY/MM-DD',template:'Templates/Daily'}));
 const result=v.daily('2026-10-21');assert.equal(result.path,'Journal/2026/10-21.md');assert.match(v.read(result.path).body,/2026-10-21/);assert.equal(v.daily('2026-10-21').sha256,result.sha256);assert.equal(v.templates().length,1);
}));
test('order 9 bookmarks survive new workspace and duplicates resolve nearest path',()=>fixture((v,root)=>{
 v.write({path:'Adamantium-bookmarks.json',body:JSON.stringify([{path:'Home.md'}])});assert.equal(JSON.parse(new VaultWorkspace(root).read('Adamantium-bookmarks.json').body)[0].path,'Home.md');
 const resolve=resolver(['Projects/Home.md','Archive/Home.md']);assert.equal(resolve('Projects/Sub/Note.md','Home'),'Projects/Home.md');
}));
test('order 10 Graphify community zero and labels survive import',()=>{
 const graph=importKnowledgeGraph({nodes:[{id:'a',label:'Alpha',community:0},{id:'b',label:'Beta',community:2,community_name:'Workers'}],links:[]});assert.equal(graph.nodes[0].communityId,0);assert.equal(graph.nodes[0].community,'Community 0');assert.equal(graph.nodes[1].community,'Workers');assert.equal(knowledgeGroups(graph).length,2);
});
test('order 10 graph notes have readable collision-safe names',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'adamantium04-'));try{await writeGraphNotes({nodes:[{id:'a',title:'Worker calls'},{id:'b',title:'Worker calls'}],edges:[]},path.join(root,'notes'),{readable:true});const names=fs.readdirSync(path.join(root,'notes')).filter(n=>n.endsWith('.md'));assert.equal(names.length,2);assert.ok(names.every(n=>n.startsWith('Worker-calls-')));}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('order 11 direct Go Rust Java C calls resolve to same-file declarations',async()=>{
 for(const [file,body] of Object.entries({'a.go':'package main\nfunc target() {}\nfunc start() { target() }','a.rs':'fn target() {} fn start() { target(); }','a.java':'class Example { static void target() {} static void start() { target(); } }','a.c':'void target(void) {} void start(void) { target(); }'})){
  const extracted=await extractMultilang(file,body);const result=resolveCalls([extracted]);assert.equal(result.edges.filter(e=>e.type==='invokes').length,1,file);assert.equal(result.unresolvedCalls.length,0,file);
 }
});
test('order 11 shadowed C function parameters stay unresolved',async()=>{
 const extracted=await extractMultilang('shadow.c','void target(void) {} void start(void (*target)(void)) { target(); }');assert.equal(resolveCalls([extracted]).edges.length,0);
});
test('order 11 Java receiver dispatch does not guess a same-named declaration',async()=>{
 const extracted=await extractMultilang('dispatch.java','class A { void target() {} } class B { void start(A object) { object.target(); } }');assert.equal(resolveCalls([extracted]).edges.length,0);
});
test('order 12 changed-since and health reports preserve source paths',()=>{
 const docs=[{path:'Home.md',body:'[[Other]] [[Missing]]',mtime:1000},{path:'Other.md',body:'',mtime:2000},{path:'Archive/Other.md',body:'',mtime:0}];const health=linkHealth(docs);assert.equal(health.broken[0].target,'Missing');assert.equal(health.duplicates.length,1);assert.deepEqual(changedSince(docs,'1970-01-01T00:00:01Z'),[{path:'Other.md',mtime:2000}]);
});
test('order 13 unconfigured Assistant refuses connection without a network call',async()=>{
 let calls=0;const connection=new AssistantConnection({fetcher:()=>{calls++;throw Error('Unexpected network');}});await assert.rejects(connection.begin(),/Configure/);assert.equal(calls,0);assert.equal(connection.status('missing').connected,false);
});
test('order 14 unapproved cosmetic styles remain byte-identical',()=>{
 const root=fileURLToPath(new URL('../',import.meta.url)),baseline=JSON.parse(fs.readFileSync(new URL('./visual-baseline-04.json',import.meta.url)));for(const [file,hash] of Object.entries(baseline))assert.equal(fingerprint(fs.readFileSync(path.join(root,file))),hash);
});
test('order 15 private package excludes customer files and has license notices',()=>{
 const root=fileURLToPath(new URL('../',import.meta.url)),files=packageFiles(root),pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json')));assert.equal(pkg.version,'0.6.1-door');assert.equal(pkg.private,true);assert.ok(files.includes('LICENSE'));assert.ok(files.includes('NOTICE'));assert.ok(files.includes('samples/vault/Home.md'));assert.ok(!files.some(f=>/TEAM-CONNECTION|RELEASE-VERIFICATION|\.data|node_modules|live.integration/.test(f)));
});
test('order 16 ZIP has a complete allowlisted central directory',()=>{
 const root=fileURLToPath(new URL('../',import.meta.url)),files=packageFiles(root),zip=buildZip(root,files),end=zip.subarray(-22);assert.equal(end.readUInt32LE(0),0x06054b50);assert.equal(end.readUInt16LE(10),files.length);let offset=end.readUInt32LE(16);const names=[];for(let i=0;i<files.length;i++){assert.equal(zip.readUInt32LE(offset),0x02014b50);const size=zip.readUInt16LE(offset+28);names.push(zip.subarray(offset+46,offset+46+size).toString());offset+=46+size;}assert.deepEqual(names,files);
});
