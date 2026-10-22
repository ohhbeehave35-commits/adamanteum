import test from 'node:test';
import assert from 'node:assert/strict';
import {publicAddress,webUrl,pageText,readPublicPage} from '../web-reader.mjs';
import {AiWorkspace} from '../intelligence.mjs';
import {ActivityBus} from '../activity.mjs';
test('public reader denies local, private, reserved and credential-bearing destinations',async()=>{
  for(const ip of ['127.0.0.1','10.1.1.1','172.16.1.1','192.168.1.1','169.254.169.254','100.64.1.1','::1','::ffff:127.0.0.1','224.0.0.1'])assert.equal(publicAddress(ip),false,ip);
  assert.equal(publicAddress('93.184.216.34'),true);
  for(const url of ['file:///etc/passwd','http://example.com','https://user:pass@example.com','https://example.com:8443','https://example.com/?key=secret'])assert.throws(()=>webUrl(url));
  await assert.rejects(readPublicPage('https://example.com',{lookup:async()=>[{address:'127.0.0.1'}]}),/blocked/);
});
test('reader strips executable elements and returns inert text and public links',()=>{
  const result=pageText('<title>Test &amp; title</title><script>BAD()</script><style>SECRET</style><p>Good text</p><a href="/docs">Documentation</a>','https://example.com/');
  assert.equal(result.title,'Test & title');assert.ok(result.text.includes('Good text'));
  assert.ok(!result.text.includes('BAD'));assert.ok(!result.text.includes('SECRET'));
  assert.equal(result.links[0].url,'https://example.com/docs');
});
test('AI tools enforce exact-page approval and vault search permission',async()=>{
  const requests=[],reads=[],bus=new ActivityBus();let turn=0;
  const ai=new AiWorkspace({bus,document:id=>({id,body:'vault excerpt'}),search:()=>[{id:1,title:'Source',path:'one.md'}],reader:async url=>{reads.push(url);return {url,title:'Page',text:'public text'};},fetcher:async(url,options)=>{
    requests.push(options);
    if(url.endsWith('/models'))return {ok:true,json:async()=>({data:[{id:'test'}]})};
    turn++;
    return {ok:true,json:async()=>({choices:[{message:turn===1?{tool_calls:[
      {id:'a',type:'function',function:{name:'read_web_page',arguments:'{"url":"https://example.com/"}'}},
      {id:'b',type:'function',function:{name:'read_web_page',arguments:'{"url":"https://evil.example/"}'}},
      {id:'c',type:'function',function:{name:'search_vault',arguments:'{"query":"secret"}'}}
    ]}:{content:'Read approved page.'}}]})};
  }});
  const connection=await ai.attach({schema:'adamantium.ai/v1',name:'Test',model:'test',endpoint:'https://provider.example/v1'});
  const result=await ai.chat({connectionId:connection.id,message:'Read',approvedUrls:['https://example.com/']});
  assert.deepEqual(reads,['https://example.com/']);
  assert.equal(result.trace.filter(t=>t.status==='completed').length,1);
  assert.equal(result.trace.filter(t=>t.status==='refused or failed').length,2);
  assert.equal(result.webSources.length,1);
  assert.ok(!requests.at(-1).body.includes('vault excerpt'));
});
