import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export {languageFor,languageExtensions} from './multilang-core.mjs';
function parserClient(){
let child=null,sequence=0,buffer='',diagnostic='';const pending=new Map();
function referenced(value){if(!child)return;for(const stream of [child,child.stdin,child.stdout,child.stderr])stream[value?'ref':'unref']?.();}
function start(){
 if(child)return;
 // Baseline WASM compilation avoids a reproducible Node 24 Windows optimizer
 // crash. Source remains data; only our bundled parser process is executed.
 const processHandle=spawn(process.execPath,['--liftoff-only','--max-old-space-size=512',fileURLToPath(new URL('./multilang-worker.mjs',import.meta.url))],{stdio:['pipe','pipe','pipe'],windowsHide:true});
 child=processHandle;buffer='';diagnostic='';processHandle.stdin.on('error',()=>{});
 const failed=error=>{if(child!==processHandle)return;child=null;processHandle.kill();for(const task of pending.values()){clearTimeout(task.timer);task.reject(error);}pending.clear();};
 processHandle.on('error',failed);processHandle.on('close',()=>failed(Error('Language parser stopped: '+diagnostic.slice(-800))));
 processHandle.stderr.on('data',chunk=>{diagnostic=(diagnostic+chunk).slice(-2000);});
 processHandle.stdout.setEncoding('utf8');processHandle.stdout.on('data',chunk=>{
  buffer+=chunk;if(buffer.length>64*1024*1024)return failed(Error('Language graph response exceeds 64 MiB.'));
  let newline;
  while((newline=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);let response;try{response=JSON.parse(line);}catch{return failed(Error('Invalid parser response.'));}
   const task=pending.get(response.id);if(!task)continue;pending.delete(response.id);clearTimeout(task.timer);response.error?task.reject(Error(response.error)):task.resolve(response.result);
  }
  if(!pending.size)referenced(false);
 });
}
return function extract(file,text,version='adamantium-ast-10'){
 if(Buffer.byteLength(text)>2*1024*1024)return Promise.reject(Error('Source file exceeds 2 MiB.'));
 return new Promise((resolve,reject)=>{
  start();referenced(true);const id=++sequence;
  const timer=setTimeout(()=>{child?.kill();},65000);
  pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,file,text,version})+'\n');
 });
}

}
// Lua has an external scanner that fails after other WASM grammars share a worker.
// Keep its parser in a separate bounded process; neither source nor grammar errors are suppressed.
const generalParser=parserClient(),luaParser=parserClient();
export function extractMultilang(file,text,version='adamantium-ast-10'){return (/\.lua$/i.test(file)?luaParser:generalParser)(file,text,version);}
