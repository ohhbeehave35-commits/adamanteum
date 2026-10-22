import fs from 'node:fs/promises';
import path from 'node:path';
import {parentPort,workerData} from 'node:worker_threads';
import {extractSource,extractPython,assembleGraph,sourceHash,EXTRACTOR_VERSION,parseJsonc,aliasesFromConfigs} from './code-extractor.mjs';
import {languageFor,extractMultilang} from './multilang-extractor.mjs';
const {directory,cacheFile}=workerData;
try{
 const root=await fs.realpath(directory),entries=[],stack=[''],issues=[];
 let cache={};
 try{cache=JSON.parse(await fs.readFile(cacheFile,'utf8'));if(cache.root!==root||cache.version!==EXTRACTOR_VERSION)cache={};}catch{}
 const previous=cache.entries||{},next={},pending=new Set(),configs=[];let reused=0,examined=0;
 async function parseFile(file,absolute){
  try{
   const text=await fs.readFile(absolute,'utf8'),hash=sourceHash(text);
   if(/(^|\/)[tj]sconfig(\.[\w-]+)?\.json$/.test(file))try{configs.push({file,config:parseJsonc(text)});}catch{}
   const extracted=previous[file]?.hash===hash?previous[file]:/\.py$/i.test(file)?await extractPython(file,text):languageFor(file)?await extractMultilang(file,text,EXTRACTOR_VERSION):extractSource(file,text);
   if(extracted===previous[file])reused++;
   next[file]=extracted;entries.push(extracted);
  }catch(e){issues.push({path:file,error:e.message});}
  if(entries.length%100===0)parentPort.postMessage({phase:'extracting',files:entries.length,reused,issues:issues.length});
 }
 while(stack.length){
  const relative=stack.pop(),folder=path.join(root,relative);
  for(const entry of await fs.readdir(folder,{withFileTypes:true})){
   if(entry.isSymbolicLink()||entry.name.startsWith('.')||['node_modules','__pycache__','vendor'].includes(entry.name))continue;
   const file=(relative?relative+'/':'')+entry.name;
   if(entry.isDirectory()){stack.push(file);continue;}
   if(!entry.isFile()||(!/\.(?:[cm]?[jt]sx?|py|md|json)$/i.test(file)&&!languageFor(file))||/^(?:package-lock|.*secrets.*|credentials.*)\.json$/i.test(entry.name))continue;
   if(++examined>20000)throw Error('Project exceeds the 20,000 eligible-file limit. Select a smaller project folder.');
   const absolute=path.join(root,file),stat=await fs.stat(absolute);
   const fileLimit=/\.py$/i.test(file)?4:2;
   if(stat.size>fileLimit*1024*1024){issues.push({path:file,error:`Over ${fileLimit} MiB parsing limit`});continue;}
   const task=parseFile(file,absolute);pending.add(task);task.finally(()=>pending.delete(task));
   if(pending.size>=4)await Promise.race(pending);
  }
 }
 await Promise.all(pending);entries.sort((a,b)=>a.path.localeCompare(b.path));issues.sort((a,b)=>a.path.localeCompare(b.path));
 const result=assembleGraph(entries,{aliases:aliasesFromConfigs(configs.sort((a,b)=>a.file.localeCompare(b.file)))});
 const temp=cacheFile+'.next';
 await fs.writeFile(temp,JSON.stringify({root,version:EXTRACTOR_VERSION,entries:next}));
 await fs.rename(temp,cacheFile);
 parentPort.postMessage({phase:'complete',result:{...result,issues,reused,changed:entries.length-reused,removed:Object.keys(previous).filter(p=>!next[p]).length,completed:new Date().toISOString(),source:path.basename(root)}});
}catch(e){parentPort.postMessage({phase:'error',error:e.message});}
