import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {QueryPool} from '../query-pool.mjs';
test('isolated query workers preserve directed edges, sources and bounded search',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'adamantium-query-test-')),file=path.join(directory,'test.sqlite');
 const db=new DatabaseSync(file);db.exec(`CREATE TABLE docs(id INTEGER PRIMARY KEY,path TEXT,title TEXT,folder TEXT,category TEXT,degree INTEGER,mtime REAL,bytes INTEGER,body TEXT);
 CREATE VIRTUAL TABLE search USING fts5(title,body,content='docs',content_rowid='id');
 CREATE TABLE edges(source INTEGER,target INTEGER);
 INSERT INTO docs VALUES(1,'a.md','Alpha','Home','records',1,0,5,'Alpha'),(2,'b.md','Beta','Home','records',1,0,4,'Beta');
 INSERT INTO search(rowid,title,body) SELECT id,title,body FROM docs;
 INSERT INTO edges VALUES(1,2);`);db.close();
 const pool=new QueryPool(file);
 try{
  const [search,graph,doc]=await Promise.all([pool.run('search',{q:'Alpha'}),pool.run('graph',{limit:900}),pool.run('doc',{id:1})]);
  assert.equal(search.result[0].id,1);assert.deepEqual(graph.result.edges,[{source:1,target:2}]);assert.equal(doc.result.body,'Alpha');assert.equal(doc.result.connections[0].outgoing,1);
  assert.ok(search.queryMs>=0);
 }finally{await pool.close();if(path.dirname(directory)!==os.tmpdir()||!path.basename(directory).startsWith('adamantium-query-test-'))throw Error('Unexpected temporary path');await rm(directory,{recursive:true});}
});
