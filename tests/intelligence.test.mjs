import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ActivityBus} from '../activity.mjs';
import {validateProfile,graphImpact,connectionPath,AiWorkspace,provenance} from '../intelligence.mjs';

const profile={schema:'adamantium.ai/v1',name:'Test provider',model:'test-model',endpoint:'http://127.0.0.1:9999/v1'};
test('connection cards reject executable content, keys and unsafe endpoints',()=>{
  assert.equal(validateProfile(profile).model,'test-model');
  for(const patch of [{command:'run'},{apiKey:'secret'},{endpoint:'http://example.com/v1'},{endpoint:'https://user:pass@example.com'}])
    assert.throws(()=>validateProfile({...profile,...patch}));
});
test('activity retains bounded real events and deduplicates node ids',()=>{
  const bus=new ActivityBus(2);
  bus.emit('read','Read',[1,1,2]);bus.emit('search','Search');bus.emit('read','Read again',[2]);
  assert.equal(bus.events.length,2);assert.equal(bus.events[1].id,3);
  assert.deepEqual(bus.events[1].nodes,[2]);
});
test('impact and connection paths use only stored edges',()=>{
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE docs(id INTEGER,path TEXT,title TEXT,folder TEXT,category TEXT,mtime INTEGER,degree INTEGER);
    CREATE TABLE edges(source INTEGER,target INTEGER);
    INSERT INTO docs VALUES(1,'a.md','A','','records',0,1),(2,'b.md','B','','records',0,2),(3,'c.md','C','','records',0,1),(4,'d.md','D','','records',0,0);
    INSERT INTO edges VALUES(1,2),(3,2);`);
  assert.deepEqual(connectionPath(db,1,3).path,[1,2,3]);
  assert.deepEqual(connectionPath(db,1,4).path,[]);
  assert.equal(graphImpact(db,1,1).nodes.length,2);
  assert.equal(graphImpact(db,1,2).nodes.length,3);
  db.close();
});
test('provider integration never sends context without consent or returns the key',async()=>{
  const calls=[],bus=new ActivityBus();
  const ai=new AiWorkspace({bus,document:id=>({id,title:'Private',path:'private.md',body:'PRIVATE SOURCE'}),fetcher:async(url,options)=>{
    calls.push({url,options});
    return {ok:true,json:async()=>url.endsWith('/models')?{data:[{id:'test-model'}]}:{choices:[{message:{content:'Answer [1]'}}]}};
  }});
  const attached=await ai.attach(profile,'TEST-KEY');
  assert.equal(JSON.stringify(attached).includes('TEST-KEY'),false);
  await assert.rejects(ai.chat({connectionId:attached.id,message:'Hello',documentIds:[1]}),/Approve/);
  assert.equal(calls.length,1);
  await ai.chat({connectionId:attached.id,message:'Hello'});
  assert.equal(calls[1].options.body.includes('PRIVATE SOURCE'),false);
  const result=await ai.chat({connectionId:attached.id,message:'Read',documentIds:[1],allowContext:true});
  assert.equal(calls[2].options.body.includes('PRIVATE SOURCE'),true);
  assert.equal(result.sources[0].id,1);
  ai.disconnect(attached.id);
  await assert.rejects(ai.chat({connectionId:attached.id,message:'Hello'}),/Connect/);
});
test('provenance includes reproducible content fingerprint',()=>{
  const result=provenance({path:'note.md',mtime:0,body:'source_file: module.js\n'});
  assert.equal(result.source_file,'module.js');assert.equal(result.sha256.length,64);
});

test('knowledge extraction requires explicit consent, uses only selected excerpts and validates evidence',async()=>{
 const calls=[],doc={id:1,title:'Company',path:'company.md',body:'Assistant uses Adamantium.'};
 const ai=new AiWorkspace({bus:new ActivityBus(),document:id=>id===1?doc:null,fetcher:async(url,options)=>{
  calls.push({url,options});return {ok:true,json:async()=>url.endsWith('/models')?{data:[{id:'test-model'}]}:{choices:[{message:{content:JSON.stringify({entities:[{id:'a',name:'Assistant'},{id:'b',name:'Adamantium'}],relations:[{source:'a',target:'b',relation:'uses',documentId:1,quote:doc.body,confidence:.9}]})}}]}};
 }});
 const attached=await ai.attach(profile,'TEST-KEY');
 await assert.rejects(ai.extract({connectionId:attached.id,documentIds:[1]}),/Approve/);assert.equal(calls.length,1);
 await assert.rejects(ai.extract({connectionId:attached.id,documentIds:[99],allowContext:true}),/no longer exists/);assert.equal(calls.length,1);
 const graph=await ai.extract({connectionId:attached.id,documentIds:[1],allowContext:true});assert.equal(graph.edges.length,1);assert.equal(graph.edges[0].origin,'model-inferred');assert.equal(JSON.stringify(graph).includes('TEST-KEY'),false);assert.equal(calls.length,2);
});
test('knowledge evidence is shared only with explicit per-request consent',async()=>{
 const calls=[],selection={graphId:'g',nodeId:'n'},ai=new AiWorkspace({bus:new ActivityBus(),document:()=>null,knowledge:()=>({title:'Private entity',relationships:[{quote:'PRIVATE GRAPH QUOTE'}]}),fetcher:async(url,options)=>{calls.push(options);return {ok:true,json:async()=>url.endsWith('/models')?{data:[{id:'test-model'}]}:{choices:[{message:{content:'Evidence answer'}}]}};}});
 const attached=await ai.attach(profile);
 await assert.rejects(ai.chat({connectionId:attached.id,message:'Explain',knowledgeSelection:selection}),/Approve/);assert.equal(calls.length,1);
 const result=await ai.chat({connectionId:attached.id,message:'Explain',knowledgeSelection:selection,allowKnowledge:true});assert.match(calls[1].body,/PRIVATE GRAPH QUOTE/);assert.equal(result.knowledgeSources[0].nodeId,'n');
 await ai.chat({connectionId:attached.id,message:'Hello again'});assert.doesNotMatch(calls[2].body,/PRIVATE GRAPH QUOTE/);
});
