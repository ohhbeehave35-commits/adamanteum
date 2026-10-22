import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {TokenStore,DOOR_BASE,doorRoutes} from './door.mjs';

// `adamantium-cli.mjs door <verb>`: one command per door route, for any person or AI on this computer.
// Where: ADAMANTIUM_DOOR_URL (default http://127.0.0.1:4173). Who: ADAMANTIUM_DOOR_TOKEN_FILE, or ADAMANTIUM_DOOR_TOKEN, or ~/.adamantium/door.token.
const here=path.dirname(fileURLToPath(import.meta.url));
const flags=args=>{const flag={},rest=[];for(let i=0;i<args.length;i++){const a=args[i];if(a.startsWith('--')){const name=a.slice(2);if(['raw','text','new','stdin','consent'].includes(name))flag[name]=true;else flag[name]=args[++i];}else rest.push(a);}return {flag,rest};};
const tokenStore=()=>new TokenStore(path.join(process.env.ADAMANTIUM_DATA_DIR?path.resolve(process.env.ADAMANTIUM_DATA_DIR):path.join(here,'.data'),'door-tokens.json'));
function token(){
 if(process.env.ADAMANTIUM_DOOR_TOKEN)return process.env.ADAMANTIUM_DOOR_TOKEN.trim();
 const file=process.env.ADAMANTIUM_DOOR_TOKEN_FILE||path.join(os.homedir(),'.adamantium','door.token');
 try{return fsSync.readFileSync(file,'utf8').trim();}catch{throw Error('No door token. Set ADAMANTIUM_DOOR_TOKEN_FILE to a token file the owner minted with `door mint`.');}
}
async function call(method,route,{query,body}={}){
 const base=(process.env.ADAMANTIUM_DOOR_URL||'http://127.0.0.1:4173').replace(/\/$/,'');
 const url=new URL(base+DOOR_BASE+route);for(const [k,v] of Object.entries(query||{}))if(v!==undefined&&v!==null&&v!=='')url.searchParams.set(k,String(v));
 const response=await fetch(url,{method,headers:{Authorization:'Bearer '+token(),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(120000)});
 const text=await response.text();let json;try{json=JSON.parse(text);}catch{json={error:text.slice(0,300)};}
 if(!response.ok){const error=Error(json.error||('Door answered '+response.status));error.status=response.status;throw error;}
 return json;
}
const readBody=async(flag,rest)=>{
 if(flag.file)return fs.readFile(flag.file,'utf8');
 if(flag.stdin){const chunks=[];for await(const c of process.stdin)chunks.push(c);return Buffer.concat(chunks).toString('utf8');}
 throw Error('Give the text with --file <local file> or --stdin.');
};
export async function runDoor(verb,args){
 const {flag,rest}=flags(args);
 switch(verb){
  case 'routes':return {routes:doorRoutes()};
  case 'status':return call('GET','/status');
  case 'search':return call('GET','/search',{query:{q:rest.join(' '),scope:flag.scope,folder:flag.folder,offset:flag.offset,limit:flag.limit}});
  case 'note':{const result=await call('GET','/note',{query:{path:rest[0],id:flag.id}});return flag.text?{__text:result.raw}:result;}
  case 'context':return call('GET','/context',{query:{path:rest[0],id:flag.id,strategy:flag.strategy,depth:flag.depth,maxChars:flag.max}});
  case 'changed-since':return call('GET','/changed-since',{query:{since:rest[0]||flag.since||'24h',scope:flag.scope}});
  case 'link-health':return call('GET','/link-health',{query:{scope:flag.scope}});
  case 'code':return call('GET','/code',{query:{q:rest.join(' '),id:flag.id,file:flag.file}});
  case 'code-scan':return call('POST','/code/scan',{body:{directory:rest[0]}});
  case 'receipts':return call('GET','/receipts',{query:{since:flag.since,actor:flag.actor,kind:flag.kind,limit:flag.limit}});
  case 'models':return call('GET','/models');
  case 'put':{ // door put <vault path> --file <local> (--expected <sha256> | --new)
   if(!rest[0])throw Error('Use put <vault path> --file <local file> --expected <sha256> | --new');
   if(!flag.new&&!flag.expected)throw Error('Say --new (a new file) or --expected <sha256 you read>.');
   return call('POST','/note',{body:{path:rest[0],body:await readBody(flag,rest),expectedHash:flag.new?null:flag.expected}});
  }
  case 'results':{ // door results <SEAT> --file <local> [--expected <sha256>] [--date YYYY-MM-DD]
   if(!rest[0])throw Error('Use results <SEAT> --file <local file>');
   return call('POST','/results',{body:{seat:rest[0],body:await readBody(flag,rest),date:flag.date,...(flag.expected?{expectedHash:flag.expected}:{})}});
  }
  case 'decision':{ // door decision "<text>" (--topic <name> | --file <vault path>) [--time HH:MM]
   if(!rest.length)throw Error('Use decision "<text>" --topic <name> (or --file Log/<date>/DECISION-...md)');
   return call('POST','/decision',{body:{text:rest.join(' '),topic:flag.topic,file:flag.file,time:flag.time,date:flag.date}});
  }
  case 'ask':{ // door ask "<question>" --connection <id> --consent
   if(!rest.length||!flag.connection)throw Error('Use ask "<question>" --connection <id> --consent (see `door models`).');
   return call('POST','/ask',{body:{question:rest.join(' '),connectionId:flag.connection,consent:flag.consent===true}});
  }
  case 'attach':{ // door attach --card <card.json>   key from ADAMANTIUM_MODEL_KEY (never printed, never stored by the CLI)
   if(!flag.card)throw Error('Use attach --card <adamantium.ai/v1 card.json>; the key comes from ADAMANTIUM_MODEL_KEY.');
   return call('POST','/model/attach',{body:{profile:JSON.parse(await fs.readFile(flag.card,'utf8')),key:process.env.ADAMANTIUM_MODEL_KEY||''}});
  }
  // Owner-only, local: these touch the token file in the data folder, not the server.
  case 'mint':{
   if(!rest[0]||!flag.out)throw Error('Use mint <actor> --scope read|write --out <new token file>. The token goes to the file, never to the screen.');
   const minted=tokenStore().mint({actor:rest[0],scope:flag.scope||'read'});
   await fs.mkdir(path.dirname(path.resolve(flag.out)),{recursive:true});
   try{await fs.writeFile(flag.out,minted.token+'\n',{flag:'wx',mode:0o600});}catch(error){tokenStore().revokeId(minted.id);throw error;}
   return {minted:true,id:minted.id,actor:minted.actor,scope:minted.scope,tokenFile:path.resolve(flag.out)};
  }
  case 'revoke':return tokenStore().revoke(rest[0]);
  case 'tokens':return {tokens:tokenStore().list()};
  default:throw Error('Unknown door verb. Verbs: routes status search note context changed-since link-health code code-scan receipts models put results decision ask attach mint revoke tokens');
 }
}
