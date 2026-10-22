import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {inflateRawSync} from 'node:zlib';
import {Organizer,validateRule} from '../organization.mjs';
import {zipDocuments} from '../archive.mjs';
import {AssistantConnection} from '../assistant.mjs';
test('smart collections update without moving or rewriting original records',()=>{
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE docs(id INTEGER PRIMARY KEY,title TEXT,path TEXT,folder TEXT,category TEXT,degree INTEGER,mtime REAL,bytes INTEGER,body TEXT);
 CREATE VIRTUAL TABLE search USING fts5(title,body,content='docs',content_rowid='id');
 CREATE TABLE edges(source INTEGER,target INTEGER);
 INSERT INTO docs VALUES(1,'Assistant','one.md','Home','records',0,1,4,'test');
 INSERT INTO search(rowid,title,body) VALUES(1,'Assistant','test');`);
 const organizer=new Organizer(db),c=organizer.save({name:'My AI',query:'Assistant'});
 assert.equal(organizer.open(c.id).total,1);
 db.exec("INSERT INTO docs VALUES(2,'Assistant second','two.md','Home','records',0,2,4,'more'); INSERT INTO search(rowid,title,body) VALUES(2,'Assistant second','more');");
 assert.equal(organizer.open(c.id).total,2);
 assert.equal(db.prepare('SELECT body FROM docs WHERE id=1').get().body,'test');
 assert.throws(()=>validateRule({name:'Bad',scope:"records'; DROP TABLE docs;--"}));
 db.close();
});
test('ZIP round trips indexed UTF-8 text and includes an integrity manifest',()=>{
 const zip=zipDocuments([{id:1,path:'folder/α.md',body:'Actual source\n'.repeat(100),mtime:0}]);
 let offset=0;const entries=[];
 while(zip.readUInt32LE(offset)===0x04034b50){
  const length=zip.readUInt32LE(offset+18),nameLength=zip.readUInt16LE(offset+26),extra=zip.readUInt16LE(offset+28);
  const name=zip.subarray(offset+30,offset+30+nameLength).toString('utf8'),start=offset+30+nameLength+extra;
  entries.push({name,text:inflateRawSync(zip.subarray(start,start+length)).toString('utf8')});offset=start+length;
 }
 assert.equal(entries[0].name,'documents/folder/α.md');
 assert.equal(entries[0].text,'Actual source\n'.repeat(100));
 assert.equal(JSON.parse(entries[1].text).documents[0].sha256.length,64);
 assert.equal(zip.readUInt32LE(offset),0x02014b50);
 assert.throws(()=>zipDocuments([{path:'../outside.md',body:'bad'}]),/Unsafe/);
});
test('Assistant public client binds sign-in to browser and PKCE without exposing access token',async()=>{
 const calls=[];const bridge=new AssistantConnection({origin:'https://service.test',fetcher:async(url,options)=>{
  calls.push({url,options});return {ok:true,json:async()=>url.endsWith('/capabilities')?{schema:'adamantium.assistant/v1',pkce:'S256'}:url.endsWith('/token')?{accessToken:'TEST-TOKEN',expiresIn:3600}:{ok:true,reply:'Test reply'}};
 }});
 const start=await bridge.begin(),url=new URL(start.url),state=url.searchParams.get('state');
 assert.equal(url.searchParams.get('code_challenge').length,43);
 await assert.rejects(bridge.complete({state,code:'test-code',binding:'wrong'}));
 const id=await bridge.complete({state,code:'test-code',binding:start.binding});
 assert.ok(bridge.status(id).connected);assert.ok(!JSON.stringify(bridge.status(id)).includes('TEST-TOKEN'));
 assert.equal((await bridge.chat(id,{message:'Hi'})).answer,'Test reply');
 await bridge.disconnect(id);assert.equal(bridge.status(id).connected,false);
 await assert.rejects(bridge.complete({state,code:'test-code',binding:start.binding}));
});
