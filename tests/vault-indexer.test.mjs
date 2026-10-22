import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {reconcileVault} from '../vault-indexer.mjs';
async function fixture(run){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'adamantium-vault-refresh-')),vault=path.join(root,'vault'),database=path.join(root,'index.sqlite');await fs.mkdir(vault);
 const db=new DatabaseSync(database);db.exec(`CREATE TABLE docs(id INTEGER PRIMARY KEY,path TEXT UNIQUE,title TEXT,folder TEXT,category TEXT,mtime REAL,bytes INTEGER,body TEXT,degree INTEGER DEFAULT 0);
 CREATE TABLE edges(source INTEGER,target INTEGER,PRIMARY KEY(source,target));CREATE INDEX edge_target ON edges(target);
 CREATE VIRTUAL TABLE search USING fts5(title,body,content='docs',content_rowid='id');CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);`);
 try{await run({root,vault,database,db,refresh:()=>reconcileVault({vault,database})});}
 finally{db.close();if(path.dirname(root)!==os.tmpdir()||!path.basename(root).startsWith('adamantium-vault-refresh-'))throw Error('Unexpected temporary path');await fs.rm(root,{recursive:true});}
}
test('vault refresh reconciles additions, edits, removed records and links without modifying sources',()=>fixture(async({vault,db,refresh})=>{
 await fs.writeFile(path.join(vault,'a.md'),'# Alpha\n[[b]]');await fs.writeFile(path.join(vault,'b.md'),'# Beta');
 const first=await refresh();assert.equal(first.documents,2);assert.equal(first.links,1);
 const again=await refresh();assert.equal(again.changed,0);assert.equal(again.removed,0);
 await fs.writeFile(path.join(vault,'a.md'),'# Updated\n[[c]]');await fs.writeFile(path.join(vault,'c.md'),'# Gamma');await fs.rm(path.join(vault,'b.md'));
 const last=await refresh();assert.equal(last.documents,2);assert.equal(last.changed,2);assert.equal(last.removed,1);assert.equal(last.links,1);
 assert.equal(db.prepare("SELECT count(*) n FROM search WHERE search MATCH 'Beta'").get().n,0);
 assert.equal(db.prepare("SELECT count(*) n FROM search WHERE search MATCH 'Updated'").get().n,1);
 assert.equal(await fs.readFile(path.join(vault,'a.md'),'utf8'),'# Updated\n[[c]]');
 const edge=db.prepare('SELECT a.path source,b.path target FROM edges e JOIN docs a ON a.id=e.source JOIN docs b ON b.id=e.target').get();assert.deepEqual({...edge},{source:'a.md',target:'c.md'});
}));
test('new target resolves previously unresolved links and missing vault cannot wipe the index',()=>fixture(async({vault,db,refresh})=>{
 await fs.writeFile(path.join(vault,'a.md'),'# Alpha\n[[later]]');await refresh();
 await fs.writeFile(path.join(vault,'later.md'),'# Later');assert.equal((await refresh()).links,1);
 await fs.rename(vault,vault+'-offline');await assert.rejects(refresh);assert.equal(db.prepare('SELECT count(*) n FROM docs').get().n,2);
}));
test('dirty link marker repairs interrupted publication even when content is unchanged',()=>fixture(async({vault,db,refresh})=>{
 await fs.writeFile(path.join(vault,'a.md'),'# Alpha\n[[b]]');await fs.writeFile(path.join(vault,'b.md'),'# Beta');await refresh();
 db.exec("DELETE FROM edges; INSERT OR REPLACE INTO meta VALUES('linksDirty','1')");assert.equal((await refresh()).links,1);
 assert.equal(db.prepare("SELECT value FROM meta WHERE key='linksDirty'").get().value,'0');
}));
test('link parser upgrades rebuild derived edges without rewriting unchanged documents',()=>fixture(async({vault,db,refresh})=>{
 const original='# Alpha\n`[[b]]`';await fs.writeFile(path.join(vault,'a.md'),original);await fs.writeFile(path.join(vault,'b.md'),'# Beta');await refresh();
 db.exec("INSERT INTO edges SELECT a.id,b.id FROM docs a,docs b WHERE a.path='a.md' AND b.path='b.md'; UPDATE meta SET value='old-parser' WHERE key='linkParserVersion'");
 const result=await refresh();assert.equal(result.changed,0);assert.equal(result.links,0);assert.equal(await fs.readFile(path.join(vault,'a.md'),'utf8'),original);
}));
test('incremental reconciliation touches notified documents without dropping unrelated records',()=>fixture(async({vault,database,db,refresh})=>{
 await fs.writeFile(path.join(vault,'a.md'),'# Alpha\n[[b]]');await fs.writeFile(path.join(vault,'b.md'),'# Beta');await fs.writeFile(path.join(vault,'c.md'),'# Gamma\n[[a]]');await refresh();
 await fs.writeFile(path.join(vault,'a.md'),'# Alpha changed\n[[c]]');
 const update=await reconcileVault({vault,database,changedPaths:['a.md']});assert.equal(update.documents,3);assert.equal(update.links,2);assert.equal(update.scanned,1);
 assert.equal(db.prepare("SELECT count(*) n FROM edges e JOIN docs a ON e.source=a.id JOIN docs b ON e.target=b.id WHERE a.path='c.md' AND b.path='a.md'").get().n,1);
 await fs.rm(path.join(vault,'a.md'));const deleted=await reconcileVault({vault,database,changedPaths:['a.md']});assert.equal(deleted.removed,1);assert.equal(deleted.documents,2);assert.equal(deleted.links,0);
 await assert.rejects(()=>reconcileVault({vault,database,changedPaths:['../outside.md']}));
}));
