import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {VaultWorkspace,renderTemplate} from '../vault-workspace.mjs';
import {baseView,parseBase,normalizeBase} from '../vault-views.mjs';
import {compileIgnore} from '../obsidian-excluded.mjs';

const write=(root,rel,text)=>{fs.mkdirSync(path.dirname(path.join(root,rel)),{recursive:true});fs.writeFileSync(path.join(root,rel),text);};
function fixture(fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'adamantium043-'));
 try{return fn(root);}finally{fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
}

test('0.4.3 templates: every .md under the Templates folder, sub-folders included, non-Markdown ignored',()=>fixture(root=>{
 write(root,'.obsidian/templates.json',JSON.stringify({folder:'Templates',dateFormat:'DD/MM/YYYY',timeFormat:'HH.mm'}));
 write(root,'Templates/Daily.md','Day {{date}} at {{time}} for {{title}}');
 write(root,'Templates/Legal/00-INDEX.md','# Legal {{title}}');
 write(root,'Templates/Legal/Deep/Nested.md','nested');
 write(root,'Templates/Meetings/Weekly.md','# {{date:YYYY}} weekly');
 write(root,'Templates/Legal/Contract.docx','binary');
 write(root,'Templates/.hidden/Secret.md','no');
 const v=new VaultWorkspace(root);
 const list=v.templates();
 assert.deepEqual(list.map(t=>t.name),['Daily','Legal/00-INDEX','Legal/Deep/Nested','Meetings/Weekly']);
 assert.equal(list[1].path,'Templates/Legal/00-INDEX.md');
 // {{date}} and {{time}} follow the vault's own Templates settings, {{title}} the note name.
 const fmt=v.templateFormats();assert.deepEqual(fmt,{dateFormat:'DD/MM/YYYY',timeFormat:'HH.mm'});
 const out=renderTemplate(list[0].body,{date:new Date(Date.UTC(2026,9,21,8,5)),title:'My note',...fmt});
 assert.equal(out,'Day 21/10/2026 at 08.05 for My note');
 assert.equal(renderTemplate(list[3].body,{date:new Date(Date.UTC(2026,9,21))}),'# 2026 weekly');
 // Without settings the Obsidian defaults apply.
 assert.equal(renderTemplate('{{date}} {{time}}',{date:new Date(Date.UTC(2026,9,21,8,5))}),'2026-10-21 08:05');
}));

test('0.4.3 Excluded files matcher: folders, globs and regular expressions as Obsidian reads them',()=>{
 const ignored=compileIgnore(['*.pdf','tools/','Graph/','/^Scratch\\d+\\//']);
 assert.equal(ignored('tools/a.md'),true);assert.equal(ignored('Graph/x/y.md'),true);assert.equal(ignored('notes/doc.pdf'),true);
 assert.equal(ignored('Scratch12/a.md'),true);assert.equal(ignored('Scratch/a.md'),false);
 assert.equal(ignored('Projects/tools.md'),false);assert.equal(ignored('Projects/Plan.md'),false);
 assert.equal(compileIgnore(undefined)('a.md'),false);
});

const docs=[
 {path:'Projects/A.md',properties:{status:'open',owner:'Ben'},tags:['x']},
 {path:'Projects/B.md',properties:{status:'done',owner:'Ann'},tags:[]},
 {path:'Projects/C.md',properties:{status:'open',owner:'Cy'},tags:[]},
 {path:'Other/D.md',properties:{status:'open',owner:'Di'},tags:[]},
].map((d,i)=>({...d,properties:JSON.stringify(d.properties),tags:JSON.stringify(d.tags),mtime:1760000000000+i,bytes:10}));
const baseText=`filters:
  and:
    - file.inFolder("Projects")
views:
  - type: table
    name: Everything
    order:
      - file.name
      - status
  - type: table
    name: Open only
    filters:
      and:
        - status == "open"
    order:
      - file.name
      - owner
    sort:
      - property: owner
        direction: DESC
`;

test('0.4.3 Bases: the first view is the default, the base filters apply, another view is chosen by name or number',()=>{
 const config=parseBase(baseText);
 const first=baseView(docs,config);
 assert.equal(first.name,'Everything');assert.deepEqual(first.views,['Everything','Open only']);assert.equal(first.view,0);
 assert.equal(first.total,3);assert.deepEqual(first.columns,['file.name','status']);
 const second=baseView(docs,config,{view:'Open only'});
 assert.equal(second.name,'Open only');assert.equal(second.total,2);assert.deepEqual(second.columns,['file.name','owner']);
 assert.deepEqual(second.groups.All.map(r=>r['file.name']),['C','A']);
 assert.equal(baseView(docs,config,{view:1}).total,2);
 assert.throws(()=>baseView(docs,config,{view:'Nope'}),/no view/);
 assert.throws(()=>normalizeBase(config,7),/no view/);
});

test('0.4.3 Bases: no 20,000-row cap for a base file, paging keeps the full count',()=>{
 const many=Array.from({length:25000},(_,i)=>({path:'N/n'+i+'.md',properties:'{}',tags:'[]',mtime:1,bytes:1}));
 const page=baseView(many,{views:[{type:'table',name:'T'}]},{maxRows:null,limit:500,offset:500});
 assert.equal(page.total,25000);assert.equal(page.shown,500);assert.equal(page.offset,500);
 assert.equal(Object.values(page.groups).flat().length,500);
 // The builder preview keeps its old cap.
 assert.equal(baseView(many,{views:[{type:'table',name:'T'}]}).total,20000);
 // An empty .base file is one table of every note, as in Obsidian.
 const empty=parseBase('');assert.equal(baseView(many.slice(0,3),empty,{maxRows:null}).total,3);
 assert.equal(baseView(many.slice(0,3),parseBase('filters:\n  and: []\n'),{maxRows:null}).total,3);
});

test('0.4.3 HTTP: a .base file shows every Markdown note of the vault except Excluded files, with views and paging',async()=>{
 const root=await fsp.mkdtemp(path.join(os.tmpdir(),'adamantium043-http-')),vault=path.join(root,'vault');
 write(vault,'.obsidian/app.json',JSON.stringify({userIgnoreFilters:['tools/','*.log']}));
 write(vault,'.obsidian/templates.json',JSON.stringify({folder:'Templates'}));
 write(vault,'Templates/Daily.md','# {{title}} {{date}}');write(vault,'Templates/Legal/00-INDEX.md','# Legal');
 write(vault,'Projects/A.md','---\nstatus: open\n---\nA');write(vault,'Projects/B.md','---\nstatus: done\n---\nB');
 write(vault,'Loose.md','loose');
 write(vault,'tools/hidden.md','hidden');
 // Generated-looking notes (the indexer files these in another collection) still show in a base, as in Obsidian.
 for(let i=0;i<30;i++)write(vault,'GRAPHIFY-EXPORT-x/n'+i+'.md','generated '+i);
 write(vault,'Everything.base','views:\n  - type: table\n    name: All\n');
 write(vault,'Open.base',baseText.replace('file.inFolder("Projects")','file.inFolder("Projects")'));
 write(vault,'Empty.base','');
 const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));assert.notEqual(port,4173);
 const child=spawn(process.execPath,[fileURLToPath(new URL('../server.mjs',import.meta.url))],{env:{...process.env,PORT:String(port),ADAMANTIUM_VAULT:vault,ADAMANTIUM_DATA_DIR:path.join(root,'data'),ADAMANTIUM_REUSE_INDEX:'0'},stdio:['ignore','pipe','pipe']});
 let errors='';child.stderr.on('data',b=>{errors+=b;});const base='http://127.0.0.1:'+port;
 const get=async(route,params={})=>{const r=await fetch(base+'/api/'+route+'?'+new URLSearchParams(params));const text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
 const until=async fn=>{for(let i=0;i<150;i++){const result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+errors);};
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(errors||'Startup timeout')),15000);child.once('error',reject);child.stdout.on('data',b=>{if(String(b).includes('Adamantium:')){clearTimeout(timer);resolve();}});});
  await until(async()=>(await get('status')).phase==='ready');
  assert.deepEqual((await get('workspace/templates')).map(t=>t.name),['Daily','Legal/00-INDEX']);
  const rendered=await get('workspace/template',{path:'Templates/Legal/00-INDEX.md',title:'x'});assert.equal(rendered.body,'# Legal');
  assert.deepEqual(await get('workspace/bases'),['Empty.base','Everything.base','Open.base']);
  // 2 projects + Loose + 2 templates + 30 generated = 35 Markdown notes; tools/ is excluded.
  const all=await get('workspace/base',{file:'Everything.base'});assert.equal(all.total,35);assert.equal(all.name,'All');
  const empty=await get('workspace/base',{file:'Empty.base'});assert.equal(empty.total,35);
  const paged=await get('workspace/base',{file:'Everything.base',pageSize:'10',offset:'30'});assert.equal(paged.total,35);assert.equal(paged.shown,5);
  const open=await get('workspace/base',{file:'Open.base'});assert.equal(open.name,'Everything');assert.equal(open.total,2);
  const openOnly=await get('workspace/base',{file:'Open.base',view:'Open only'});assert.equal(openOnly.name,'Open only');assert.equal(openOnly.total,1);
  const bad=await fetch(base+'/api/workspace/base?'+new URLSearchParams({file:'Open.base',view:'Missing'}));assert.notEqual(bad.status,200);
 }finally{if(child.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}await fsp.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
