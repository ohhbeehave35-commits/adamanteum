import test from 'node:test';
import assert from 'node:assert/strict';
import {AiWorkspace} from '../intelligence.mjs';
import {ActivityBus} from '../activity.mjs';
test('separate customer connections never borrow the other connection key and images require consent',async()=>{
 const calls=[];
 const ai=new AiWorkspace({bus:new ActivityBus(),document:()=>null,fetcher:async(url,options)=>{
  calls.push({url,...options});
  return {ok:true,json:async()=>url.endsWith('/models')?{data:[{id:'vision'}]}:{choices:[{message:{content:'mock only'}}]}};
 }});
 const profile={schema:'adamantium.ai/v1',name:'Customer',model:'vision',endpoint:'https://customer.example/v1'};
 const a=await ai.attach(profile,'TEST-CUSTOMER-A'),b=await ai.attach({...profile,endpoint:'https://second.example/v1'},'TEST-CUSTOMER-B');
 const image='data:image/jpeg;base64,'+Buffer.from([255,216,255,0]).toString('base64');
 await assert.rejects(ai.chat({connectionId:a.id,message:'Read',image}),/Approve/);
 await ai.chat({connectionId:b.id,message:'Read',image,allowImage:true});
 assert.equal(calls.at(-1).headers.Authorization,'Bearer TEST-CUSTOMER-B');
 assert.equal(calls.at(-1).url,'https://second.example/v1/chat/completions');
 const payload=JSON.parse(calls.at(-1).body);assert.equal(payload.messages[1].content[1].image_url.url,image);
 assert.ok(!JSON.stringify(payload).includes('TEST-CUSTOMER'));
 ai.disconnect(a.id);
 await assert.rejects(ai.chat({connectionId:a.id,message:'Hello'}),/Connect/);
 await ai.chat({connectionId:b.id,message:'Hello'});
 assert.equal(calls.at(-1).headers.Authorization,'Bearer TEST-CUSTOMER-B');
});
