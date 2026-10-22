import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {queryVault} from '../queries.mjs';

test('search pages are stable, complete and deduplicated; exact filenames lead body matches',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(`CREATE TABLE docs(id INTEGER PRIMARY KEY,path TEXT,title TEXT,folder TEXT,category TEXT,degree INTEGER,mtime REAL,bytes INTEGER,body TEXT);
   CREATE VIRTUAL TABLE search USING fts5(title,body,content='docs',content_rowid='id');`);
  const insert=db.prepare('INSERT INTO docs VALUES(?,?,?,?,?,0,0,1,?)');
  for(let i=1;i<=165;i++)insert.run(i,`Home/note-${i}.md`,'Common entry','Home','records','Common entry');
  insert.run(166,'Home/00-HOME.md','Front door','Home','records','00-HOME common entry');
  insert.run(167,'Archive/00-HOME.md','Backup','Archive','archive','00-HOME common entry');
  insert.run(168,'Home/literal_%.md','Odd filename','Home','records','unrelated');
  db.exec('INSERT INTO search(rowid,title,body) SELECT id,title,body FROM docs');
  const pages=[0,80,160].map(offset=>queryVault(db,'search',{q:'common',offset}));
  assert.deepEqual(pages.map(p=>p.length),[80,80,6]);
  assert.equal(new Set(pages.flat().map(n=>n.id)).size,166);
  assert.equal(queryVault(db,'search',{q:'00-HOME'})[0].id,166);
  assert.deepEqual(queryVault(db,'search',{q:'note-164'}).map(n=>n.id),[164]);
  assert.deepEqual(queryVault(db,'search',{q:'literal_%'}).map(n=>n.id),[168]);
  assert.equal(queryVault(db,'search',{q:'common',offset:240}).length,0);
  assert.deepEqual(queryVault(db,'search',{q:'common',offset:-1}),pages[0]);
  assert.deepEqual(queryVault(db,'search',{q:'common',folder:'Archive'}),[]);
 }finally{db.close();}
});
