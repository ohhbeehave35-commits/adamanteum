import test from 'node:test';
import assert from 'node:assert/strict';
import {Notebook} from '../notebook.mjs';
test('private notebook saves, searches, retains revisions and restores without overwriting history',()=>{
 const book=new Notebook(':memory:');try{
  const first=book.save({title:'Decision',body:'Original evidence',properties:{owner:'Alex',approved:false}});
  assert.equal(book.list('evidence')[0].id,first.id);
  const second=book.save({...first,body:'Changed'});assert.equal(second.revision,2);assert.equal(book.list('evidence').length,0);
  assert.throws(()=>book.save({...first,body:'stale'}),/another window/);assert.equal(book.get(first.id).body,'Changed');
  assert.equal(book.restore(first.id,1,2).body,'Original evidence');assert.equal(book.history(first.id).length,3);
  assert.match(book.export(first.id),/"owner": "Alex"/);
 }finally{book.close();}
});
test('daily notes are idempotent and unsafe or oversized input cannot enter notebook',()=>{
 const book=new Notebook(':memory:');try{
  assert.equal(book.daily('2026-10-20').id,book.daily('2026-10-20').id);
  assert.throws(()=>book.daily('2026-02-30'));assert.throws(()=>book.save({title:'',body:''}));
  assert.throws(()=>book.save({title:'Bad',body:'a'.repeat(1024*1024+1)}));
  assert.throws(()=>book.save({title:'Bad',body:'',properties:{nested:{secret:1}}}));
  assert.equal(book.list().length,1);
 }finally{book.close();}
});
