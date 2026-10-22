import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {ActivityBus} from '../activity.mjs';
import {AiWorkspace} from '../intelligence.mjs';
import {importKnowledgeGraph} from '../knowledge-graph.mjs';
import {InterpretationStore,communityEvidence,communityPrompt,notePrompt,validateInterpretation,interpretationNote} from '../interpretation.mjs';

const profile={schema:'adamantium.ai/v1',name:'Local test model',model:'test-model',endpoint:'http://127.0.0.1:9999/v1'};
const graph=importKnowledgeGraph({nodes:[
 {id:'a',label:'InvoiceService',file_type:'code',source_file:'billing/invoice.py',community:7,community_name:'billing'},
 {id:'b',label:'PaymentGateway',file_type:'code',source_file:'billing/pay.py',community:7,community_name:'billing'},
 {id:'c',label:'TaxTable',file_type:'code',source_file:'billing/tax.py',community:7,community_name:'billing'},
 {id:'d',label:'Elsewhere',file_type:'code',source_file:'other.py',community:9,community_name:'other'}],
 links:[{source:'a',target:'b',relation:'calls'},{source:'a',target:'c',relation:'reads'},{source:'d',target:'a',relation:'calls'}]});

test('community evidence lists only that community, with its relations',()=>{
 const e=communityEvidence(graph,7);
 assert.equal(e.size,3);assert.deepEqual(e.members.map(m=>m.name).sort(),['InvoiceService','PaymentGateway','TaxTable']);
 assert.equal(e.edges.length,2);assert.equal(e.graphifyLabel,'billing');
 assert.throws(()=>communityEvidence(graph,404),/not found/);
 assert.match(communityPrompt(e),/untrusted DATA/);assert.match(notePrompt('x.md','hello'),/untrusted DATA/);
});

test('validation drops key members that are not in the evidence and flags weak grounding',()=>{
 const e=communityEvidence(graph,7),names=new Set(e.members.map(m=>m.name));
 const good=validateInterpretation('community',JSON.stringify({label:'Billing services',summary:'InvoiceService calls PaymentGateway and reads TaxTable to produce invoices.',key_members:['InvoiceService','Ghost']}),{evidenceText:JSON.stringify(e),allowedNames:names});
 assert.deepEqual(good.keyItems,['InvoiceService']);assert.deepEqual(good.droppedUnsupported,['Ghost']);assert.ok(good.grounding>=0.6,String(good.grounding));
 const weak=validateInterpretation('community',JSON.stringify({label:'Space program',summary:'Astronauts launched rockets towards distant planets yesterday.',key_members:[]}),{evidenceText:JSON.stringify(e),allowedNames:names});
 assert.ok(weak.grounding<0.3);assert.match(weak.groundingNote,/LOW/);
 const note=validateInterpretation('note',JSON.stringify({label:'Plan note',summary:'The plan lists three goals for the quarter and one risk.',key_terms:['three goals','moon base']}),{evidenceText:'The plan lists three goals. one risk.'});
 assert.deepEqual(note.keyItems,['three goals']);assert.deepEqual(note.droppedUnsupported,['moon base']);
 for(const bad of ['not json',JSON.stringify({label:'x',summary:'short'}),JSON.stringify([1])])assert.throws(()=>validateInterpretation('note',bad,{evidenceText:'x'}));
 assert.equal(validateInterpretation('note','```json\n'+JSON.stringify({label:'Fenced',summary:'A fenced answer that is still valid JSON overall.',key_terms:[]})+'\n```',{evidenceText:'x'}).label,'Fenced');
});

test('consent gate: no provider call without approval, no call without a provider; the store never marks anything a fact',async()=>{
 const calls=[],ai=new AiWorkspace({bus:new ActivityBus(),document:()=>null,fetcher:async(url,options)=>{calls.push(url);return {ok:true,json:async()=>url.endsWith('/models')?{data:[{id:'test-model'}]}:{choices:[{message:{content:JSON.stringify({label:'Billing services',summary:'InvoiceService calls PaymentGateway for invoices.',key_members:['InvoiceService']})}}],usage:{prompt_tokens:120,completion_tokens:30}}};}});
 await assert.rejects(ai.complete({connectionId:'none',allowContext:true,user:'x'}),/Connect your own AI provider/);
 const attached=await ai.attach(profile,'');
 await assert.rejects(ai.complete({connectionId:attached.id,user:'x'}),/Approve/);
 assert.equal(calls.length,1,'only the read-only model list was called before consent');
 const call=await ai.complete({connectionId:attached.id,allowContext:true,user:communityPrompt(communityEvidence(graph,7))});
 assert.equal(call.promptTokens,120);assert.equal(call.completionTokens,30);assert.equal(call.model,'test-model');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'adamantium-interp-')),store=new InterpretationStore(path.join(dir,'i.sqlite'));
 try{
  const before=crypto.createHash('sha256').update(JSON.stringify(graph)).digest('hex');
  const e=communityEvidence(graph,7),checked=validateInterpretation('community',call.content,{evidenceText:JSON.stringify(e),allowedNames:new Set(e.members.map(m=>m.name))});
  const saved=store.save({...checked,subject:'7',graphId:'g1',graphifyLabel:'billing',evidence:e,model:call.model});
  assert.equal(saved.status,'interpretation');assert.equal(saved.promoted,false);assert.equal(saved.origin,'model-interpretation');
  // Even a caller that tries to set promoted or a fact status gets the fixed values.
  const forced=store.save({...checked,subject:'8',graphId:'g1',promoted:true,status:'fact',origin:'verified'});
  assert.equal(forced.promoted,false);assert.equal(forced.status,'interpretation');assert.equal(forced.origin,'model-interpretation');
  assert.equal(store.get(saved.id).label,'Billing services');assert.equal(store.list({graph:'g1'}).length,2);
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(graph)).digest('hex'),before,'the graph is unchanged');
  const md=interpretationNote(saved);
  assert.match(md,/^---\nkind: interpretation\norigin: model-interpretation\nstatus: interpretation\npromoted: false/);
  assert.match(md,/Not a fact/);assert.match(md,/Graphify's own label for this community:\*\* billing/);
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
