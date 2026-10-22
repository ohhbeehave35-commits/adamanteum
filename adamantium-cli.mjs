#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Worker} from 'node:worker_threads';
import {projectPath,projectImpact,projectRelations,projectGraphML,projectContext} from './project-navigation.mjs';
import {importKnowledgeGraph} from './knowledge-graph.mjs';
import {exportGraph} from './graph-export.mjs';
import {combineGraphs,clusterGraph} from './graph-operations.mjs';
import {writeGraphNotes} from './graph-notes.mjs';
import {importObsidianVault} from './obsidian-import.mjs';

const [command,file,...args]=process.argv.slice(2);
async function load(file){
 if(!file)throw Error('A graph JSON path is required.');
 if((await fs.stat(file)).size>256*1024*1024)throw Error('Graph JSON exceeds the 256 MiB command-line input limit.');
 const g=JSON.parse(await fs.readFile(file,'utf8'));
 if(g.schema!=='adamantium.graph/v1'||!Array.isArray(g.nodes)||!Array.isArray(g.edges))throw Error('Expected an Adamantium graph export.');
 const ids=new Set();for(const n of g.nodes){if(typeof n.id!=='string'||ids.has(n.id))throw Error('Graph contains invalid or duplicate node identities.');ids.add(n.id);}
 if(g.edges.some(e=>!ids.has(e.source)||!ids.has(e.target)))throw Error('Graph has dangling edges.');return g;
}
async function scan(directory){
 if(!directory||!path.isAbsolute(directory))throw Error('Choose an absolute project directory.');
 const root=await fs.realpath(directory);if(root===path.parse(root).root||root===os.homedir())throw Error('Choose a project, not a home or drive root.');
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'adamantium-cli-'));
 try{return await new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./project-worker.mjs',import.meta.url),{workerData:{directory:root,cacheFile:path.join(temporary,'cache.json')},resourceLimits:{maxOldGenerationSizeMb:768}});let result,error;
  worker.on('message',m=>{if(m.phase==='extracting')process.stderr.write(JSON.stringify({phase:m.phase,files:m.files,reused:m.reused,issues:m.issues})+'\n');if(m.phase==='complete')result=m.result;if(m.phase==='error')error=Error(m.error);});
  worker.on('error',reject);worker.on('exit',()=>error?reject(error):result?resolve(result):reject(Error('Extraction stopped before completion.')));
 });}finally{
  if(path.dirname(temporary)!==os.tmpdir()||!path.basename(temporary).startsWith('adamantium-cli-'))throw Error('Unexpected cache path');
  await fs.rm(temporary,{recursive:true});
 }
}
try{
 let result;
 if(command==='scan'){
  result=await scan(file);
  if(args.length){
   if(args[0]!=='--output'||!args[1]||args.length!==2)throw Error('Use scan <absolute folder> [--output <new graph.json or graph.graphml>].');
   await fs.writeFile(args[1],args[1].endsWith('.graphml')?projectGraphML(result):JSON.stringify(result),{flag:'wx'});
   result={output:path.resolve(args[1]),files:result.files,nodes:result.nodes.length,edges:result.edges.length,issues:result.issues};
  }
 }else if(command==='door'){
  result=await (await import('./door-cli.mjs')).runDoor(file,args);
 }else if(command==='notes'){
  if(args.length!==1)throw Error('Use notes <graph.json> <absolute new folder>.');result=await writeGraphNotes(await load(file),args[0],{readable:true});
 }else if(command==='combine'){
  if(args.length<2||args.length>4)throw Error('Use combine <new graph.json> <source1.json> <source2.json> [source3.json] [source4.json].');
  const sources=[];let bytes=0;for(const source of args){bytes+=(await fs.stat(source)).size;if(bytes>256*1024*1024)throw Error('Combined inputs exceed 256 MiB.');sources.push({id:path.resolve(source),title:path.basename(source),graph:await load(source)});}
  const graph=combineGraphs(sources);await fs.writeFile(file,JSON.stringify(graph),{flag:'wx'});result={output:path.resolve(file),nodes:graph.nodes.length,edges:graph.edges.length};
 }else if(command==='cluster'){
  if(args.length!==1&&!(args.length===3&&args[1]==='--resolution'&&Number(args[2])>0))throw Error('Use cluster <graph.json> <new graph.json> [--resolution 4].');
  const graph=clusterGraph(await load(file),{resolution:args.length===3?Number(args[2]):4});await fs.writeFile(args[0],JSON.stringify(graph),{flag:'wx'});result={output:path.resolve(args[0]),...graph.analysis};
 }else if(command==='import'){
  if(!file||args.length!==1)throw Error('Use import <Graphify or node-link JSON> <new Adamantium JSON>.');
  if((await fs.stat(file)).size>256*1024*1024)throw Error('Graph import exceeds 256 MiB.');
  const g=importKnowledgeGraph(JSON.parse(await fs.readFile(file,'utf8')));await fs.writeFile(args[0],JSON.stringify(g),{flag:'wx'});result={output:path.resolve(args[0]),nodes:g.nodes.length,edges:g.edges.length,warnings:g.warnings};
 }else if(command==='import-obsidian'){
  const dry=args.includes('--dry-run');
  if(!file||args.filter(a=>a!=='--dry-run').length)throw Error('Use import-obsidian <absolute vault folder> [--dry-run].');
  const report=importObsidianVault(file,{write:!dry});
  process.stdout.write(report.text.endsWith('\n')?report.text:report.text+'\n');
 }else if(['query','path','affected','explain','stats','export','context'].includes(command)){
  const g=await load(file);
  if(command==='query'){
   const terms=args.join(' ').toLowerCase().match(/[\p{L}\p{N}_-]+/gu)||[];if(!terms.length)throw Error('Enter search terms.');
   result=g.nodes.map(n=>({node:n,score:terms.reduce((s,t)=>s+(String(n.title).toLowerCase().includes(t)?3:0)+(String(n.path).toLowerCase().includes(t)?1:0),0)})).filter(r=>r.score).sort((a,b)=>b.score-a.score||a.node.id.localeCompare(b.node.id)).slice(0,40);
  }else if(command==='path')result=projectPath(g,args[0],args[1],g.mode?{types:[...new Set(g.edges.map(e=>e.type))]}:{});
  else if(command==='affected')result=projectImpact(g,args[0],{depth:args[1],...(g.mode?{types:[...new Set(g.edges.map(e=>e.type))]}:{})});
  else if(command==='explain')result=projectRelations(g,args[0]);
  else if(command==='context')result=projectContext(g,args[0],{strategy:args[1]||'bfs',maxChars:args[2]||12000});
  else if(command==='stats')result={files:g.files,nodes:g.nodes.length,edges:g.edges.length,resolvedCalls:g.resolvedCalls||0,unresolvedCalls:g.unresolvedCalls?.length||0,relations:g.edges.reduce((r,e)=>(r[e.type]=(r[e.type]||0)+1,r),Object.create(null))};
  else {if(args.length!==1)throw Error('Use export <graph.json> <new graph.json|graphml|md|mermaid|canvas>.');const format=path.extname(args[0]).slice(1);await fs.writeFile(args[0],exportGraph(g,format),{flag:'wx'});result={output:path.resolve(args[0]),format};}
 }else if(!command||command==='--help')result={commands:[
  'scan <absolute folder> [--output <new graph.json or graph.graphml>]',
  'import <Graphify or node-link JSON> <new Adamantium JSON>',
  'query <graph.json> <terms>', 'path <graph.json> <from id> <to id>',
  'affected <graph.json> <symbol id> [depth]', 'explain <graph.json> <symbol id>',
  'context <graph.json> <entity id> [bfs|dfs] [max characters]', 'stats <graph.json>',
  'cluster <graph.json> <new graph.json>',
  'combine <new graph.json> <source1.json> <source2.json> [source3.json] [source4.json]',
  'notes <graph.json> <absolute new folder>',
  'export <graph.json> <new graph.json|graphml|md|mermaid|canvas|svg|html>',
  'import-obsidian <absolute vault folder> [--dry-run]   (--dry-run shows the report and writes nothing)',
  'door <verb> ...  (the vault door for AIs: routes status search note context changed-since link-health code code-scan receipts models put results decision ask attach mint revoke tokens)'
 ],privacy:'Local parsing only. No Graphify runtime, AI call, source execution, or source-file modifications. Existing output files are never overwritten.'};
 else throw Error('Unknown command. Run --help.');
 if(command!=='import-obsidian')process.stdout.write(result&&result.__text!==undefined?result.__text:JSON.stringify(result,null,2)+'\n');
}catch(error){process.stderr.write(JSON.stringify({error:error.message})+'\n');process.exitCode=1;}
