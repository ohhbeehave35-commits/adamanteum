import crypto from 'node:crypto';
const random=()=>crypto.randomBytes(32).toString('base64url');
export class AssistantConnection{
 constructor({origin=null,fetcher=fetch,bus}={}){
  if(!origin){this.origin=null;this.fetcher=fetcher;this.bus=bus;this.pending=new Map();this.sessions=new Map();return;}
  const url=new URL(origin);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('Assistant service must be a credential-free HTTPS origin.');
  this.origin=url.origin;this.fetcher=fetcher;this.bus=bus;this.pending=new Map();this.sessions=new Map();
 }
 async begin(){
  if(!this.origin)throw Error('Configure ADAMANTIUM_ASSISTANT_ORIGIN before connecting.');
  const response=await this.fetcher(this.origin+'/api/adamantium/capabilities',{signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!response.ok)throw Error('Assistant’s Adamantium connector is not activated on her service yet. Your vault is safe; no private text was sent.');
  const capability=await response.json();if(capability.schema!=='adamantium.assistant/v1'||capability.pkce!=='S256')throw Error('Assistant returned an unsupported connection protocol.');
  const now=Date.now();for(const [id,p] of this.pending)if(p.expires<now)this.pending.delete(id);
  if(this.pending.size>=20)throw Error('Too many pending sign-ins. Try again in five minutes.');
  const state=random(),verifier=random(),binding=random(),challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
  this.pending.set(state,{verifier,binding,expires:now+300000});
  return {url:this.origin+'/api/adamantium/authorize?'+new URLSearchParams({state,code_challenge:challenge}),binding};
 }
 async complete({state,code,binding}){
  const pending=this.pending.get(state);
  if(!pending||pending.expires<Date.now()||typeof binding!=='string'||binding.length!==pending.binding.length||!crypto.timingSafeEqual(Buffer.from(binding),Buffer.from(pending.binding)))throw Error('Sign-in expired or belongs to another browser. Start Connect Assistant again.');
  this.pending.delete(state);
  const response=await this.fetcher(this.origin+'/api/adamantium/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,verifier:pending.verifier}),signal:AbortSignal.timeout(20000),redirect:'error'});
  if(!response.ok)throw Error('Assistant did not authorize this connection. Start Connect Assistant again.');
  const grant=await response.json();if(typeof grant.accessToken!=='string'||grant.accessToken.length>8192||!Number.isFinite(grant.expiresIn)||grant.expiresIn<=0)throw Error('Invalid authorization response.');
  const id=random();this.sessions.set(id,{token:grant.accessToken,expires:Date.now()+Math.min(3600,grant.expiresIn)*1000});
  this.bus?.emit('assistant.connected','Assistant connected through your signed-in account');
  return id;
 }
 status(id){const session=this.sessions.get(id);if(!session||session.expires<=Date.now()){this.sessions.delete(id);return {connected:false};}return {connected:true,name:'Assistant',expires:new Date(session.expires).toISOString(),scope:'read-only questions and approved context'};}
 async chat(id,{message,context='',history=[],image=null}){
  if(!this.status(id).connected)throw Error('Connect Assistant first.');
  if(typeof message!=='string'||!message.trim()||message.length>2000||typeof context!=='string'||context.length>4000)throw Error('Use a message up to 2,000 characters and context up to 4,000 characters.');
  const session=this.sessions.get(id);
  this.bus?.emit('assistant.request','Assistant is processing your request');
  const response=await this.fetcher(this.origin+'/api/adamantium/chat',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.token},body:JSON.stringify({message,context,history,image}),signal:AbortSignal.timeout(90000),redirect:'error'});
  if(!response.ok)throw Error('Assistant could not answer. Your sign-in may have expired; reconnect if needed.');
  const result=await response.json();if(!result.ok||typeof result.reply!=='string')throw Error(result.detail||'Assistant returned no answer.');
  this.bus?.emit('assistant.completed','Assistant answered');return {answer:result.reply,ai:'Assistant'};
 }
 async judge(id,{message,choices,image}){
  if(!this.status(id).connected)throw Error('Connect Assistant first.');
  const response=await this.fetcher(this.origin+'/api/adamantium/judge',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+this.sessions.get(id).token},body:JSON.stringify({message,choices,image}),signal:AbortSignal.timeout(4000),redirect:'error'});
  if(!response.ok)throw Error('Decision routing unavailable; local search remains available.');
  const result=await response.json();
  if(!choices.some(c=>c.id===result.selected)||!Number.isFinite(result.confidence)||result.confidence<.8)result.selected=null;
  return result;
 }
 async disconnect(id){
  const session=this.sessions.get(id);this.sessions.delete(id);
  if(session){const r=await this.fetcher(this.origin+'/api/adamantium/disconnect',{method:'POST',headers:{Authorization:'Bearer '+session.token},signal:AbortSignal.timeout(15000),redirect:'error'});if(!r.ok)throw Error('Disconnected locally. Server revocation could not be confirmed; its grant expires within one hour.');}
  this.bus?.emit('assistant.disconnected','Assistant disconnected');
 }
}
export function cookie(req,name){const item=String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='));return item?item.slice(name.length+1):'';}
