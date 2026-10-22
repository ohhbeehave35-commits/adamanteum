import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {importObsidianVault,pathIgnored} from '../obsidian-import.mjs';
import {reconcileVault} from '../vault-indexer.mjs';

const exec=promisify(execFile),cli=fileURLToPath(new URL('../adamantium-cli.mjs',import.meta.url)),root=fileURLToPath(new URL('../',import.meta.url));

async function fixtureVault(){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'adamantium-obsidian-'));
 const vault=path.join(dir,'vault');
 await fs.mkdir(path.join(vault,'.obsidian'),{recursive:true});
 await fs.mkdir(path.join(vault,'Secret'),{recursive:true});
 await fs.mkdir(path.join(vault,'Templates'),{recursive:true});
 await fs.writeFile(path.join(vault,'Home.md'),'# Home\nvisible');
 await fs.writeFile(path.join(vault,'Secret','Hidden.md'),'# Hidden\nshould stay out');
 await fs.writeFile(path.join(vault,'Templates','Daily.md'),'# {{date}}\n');
 await fs.writeFile(path.join(vault,'.obsidian','app.json'),JSON.stringify({
  livePreview:true,
  attachmentFolderPath:'attachments',
  userIgnoreFilters:['Secret/','*.tmp']
 },null,2));
 await fs.writeFile(path.join(vault,'.obsidian','daily-notes.json'),JSON.stringify({
  folder:'Journal',
  format:'YYYY/MM-DD',
  template:'Templates/Daily',
  autorun:false
 },null,2));
 await fs.writeFile(path.join(vault,'.obsidian','templates.json'),JSON.stringify({
  folder:'Templates',
  dateFormat:'YYYY-MM-DD'
 },null,2));
 await fs.writeFile(path.join(vault,'.obsidian','bookmarks.json'),JSON.stringify({
  items:[
   {type:'file',path:'Home.md',title:'Home'},
   {type:'search',query:'tag:#hub',title:'Hub notes'},
   {type:'group',title:'Work',items:[{type:'file',path:'Templates/Daily.md',title:'Daily'}]}
  ]
 },null,2));
 await fs.writeFile(path.join(vault,'.obsidian','workspace.json'),JSON.stringify({
  main:{type:'split',children:[{type:'tabs',children:[
   {type:'leaf',pinned:true,state:{type:'markdown',state:{file:'Home.md',mode:'source'}}},
   {type:'leaf',state:{type:'markdown',state:{file:'Templates/Daily.md'}}},
   {type:'leaf',state:{type:'graph',state:{}}}
  ]}]}
 },null,2));
 await fs.writeFile(path.join(vault,'.obsidian','core-plugins.json'),JSON.stringify({
  'file-explorer':true,
  'daily-notes':true,
  'templates':true,
  'bookmarks':true,
  'starred':true,
  'page-preview':true
 },null,2));
 return {dir,vault};
}

test('import-obsidian carries every mapped key and reports a key with no equivalent as not carried',async()=>{
 const {dir,vault}=await fixtureVault();
 const run=async()=>(await exec(process.execPath,[cli,'import-obsidian',vault],{windowsHide:true})).stdout;
 try{
  const first=await run();
  assert.match(first,/Carried across:/);
  assert.match(first,/Not carried:/);
  assert.match(first,/Daily notes: folder Journal, date format YYYY\/MM-DD, template Templates\/Daily/);
  assert.match(first,/Templates folder: Templates/);
  assert.match(first,/Bookmarks: 2 notes/);
  assert.match(first,/Pinned notes: Home\.md/);
  assert.match(first,/Starred notes: Home\.md/);
  assert.match(first,/Open workspace tabs: Home\.md, Templates\/Daily\.md/);
  assert.match(first,/Exclude filters: Secret\/, \*\.tmp/);
  assert.match(first,/app\.json livePreview/);
  assert.match(first,/core-plugins\.json page-preview/);
  assert.match(first,/bookmarks\.json search/);
  assert.match(first,/not carried/i);
  const settings=JSON.parse(await fs.readFile(path.join(vault,'Adamantium-settings.json'),'utf8'));
  assert.equal(settings.daily.folder,'Journal');
  assert.equal(settings.daily.format,'YYYY/MM-DD');
  assert.equal(settings.templates.folder,'Templates');
  assert.deepEqual(settings.exclude,['Secret/','*.tmp']);
  assert.deepEqual(settings.workspaceTabs,['Home.md','Templates/Daily.md']);
  assert.deepEqual(settings.pinned,['Home.md']);
  const bookmarks=JSON.parse(await fs.readFile(path.join(vault,'Adamantium-bookmarks.json'),'utf8'));
  assert.equal(bookmarks.length,2);
  const second=await run();
  assert.equal(second,first);
  const settingsAgain=JSON.parse(await fs.readFile(path.join(vault,'Adamantium-settings.json'),'utf8'));
  assert.equal(settingsAgain.importedAt,settings.importedAt);
  assert.equal(JSON.stringify(JSON.parse(await fs.readFile(path.join(vault,'Adamantium-bookmarks.json'),'utf8'))),JSON.stringify(bookmarks));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('exclude filters hide the same folders here as in Obsidian',async()=>{
 const {dir,vault}=await fixtureVault();
 try{
  importObsidianVault(vault);
  assert.equal(pathIgnored('Secret/Hidden.md',['Secret/']),true);
  assert.equal(pathIgnored('Home.md',['Secret/']),false);
  const database=path.join(dir,'index.sqlite');
  const db=new DatabaseSync(database);
  db.exec(`CREATE TABLE docs(id INTEGER PRIMARY KEY,path TEXT UNIQUE,title TEXT,folder TEXT,category TEXT,mtime REAL,bytes INTEGER,body TEXT,degree INTEGER DEFAULT 0);
   CREATE TABLE edges(source INTEGER,target INTEGER,PRIMARY KEY(source,target));CREATE INDEX edge_target ON edges(target);
   CREATE VIRTUAL TABLE search USING fts5(title,body,content='docs',content_rowid='id');CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);`);
  try{
   const report=await reconcileVault({vault,database});
   const paths=db.prepare('SELECT path FROM docs ORDER BY path').all().map(r=>r.path);
   assert.ok(paths.includes('Home.md'));
   assert.ok(!paths.includes('Secret/Hidden.md'));
   assert.ok(report.documents>=1);
  }finally{db.close();}
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('UI returns the same Obsidian import report the first time a vault with .obsidian is opened',async()=>{
 const {dir,vault}=await fixtureVault();
 const data=path.join(dir,'data');
 const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));
 const child=spawn(process.execPath,[path.join(root,'server.mjs')],{env:{...process.env,PORT:String(port),ADAMANTIUM_VAULT:vault,ADAMANTIUM_DATA_DIR:data,ADAMANTIUM_VAULT_WRITE:'1',ADAMANTIUM_REUSE_INDEX:'0'},stdio:['ignore','pipe','pipe'],windowsHide:true});
 let errors='';child.stderr.on('data',b=>errors+=b);
 const base='http://127.0.0.1:'+port;
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(errors||'Startup timeout')),15000);child.once('error',reject);child.stdout.on('data',b=>{if(String(b).includes('Adamantium:')){clearTimeout(timer);resolve();}});});
  const until=async fn=>{for(let i=0;i<100;i++){const result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+errors);};
  await until(async()=>(await (await fetch(base+'/api/status')).json()).phase==='ready');
  const cliText=(await exec(process.execPath,[cli,'import-obsidian',vault],{windowsHide:true})).stdout.trim();
  const api=await (await fetch(base+'/api/workspace/obsidian-import')).json();
  assert.equal(api.hasObsidian,true);
  assert.equal(api.text.trim(),cliText);
  assert.match(api.text,/page-preview/);
  assert.ok((await fs.readFile(path.join(root,'dist/app.js'),'utf8')).includes('obsidian-import-report'));
 }finally{
  if(child.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}
  await fs.rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
 }
});
