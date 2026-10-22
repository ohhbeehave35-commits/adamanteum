import {parse} from '@babel/parser';
import crypto from 'node:crypto';
import path from 'node:path';
import {targets} from './lib.mjs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {collectSymbols,resolveCalls,resolveModule} from './symbol-resolution.mjs';
export const EXTRACTOR_VERSION='adamantium-ast-10';
export const sourceHash=text=>crypto.createHash('sha256').update(text).digest('hex');
export function extractPython(file,text){
 return new Promise((resolve,reject)=>{
  const hash=sourceHash(text),child=spawn(process.platform==='win32'?'python':'python3',['-I','-X','utf8',fileURLToPath(new URL('./python-extractor.py',import.meta.url))],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  let output='',error='',settled=false;
  const finish=(err,result)=>{if(settled)return;settled=true;clearTimeout(timer);if(err)reject(err);else resolve(result);};
  const timer=setTimeout(()=>{child.kill();finish(Error('Python parser exceeded 20 seconds.'));},20000);
  child.on('error',e=>finish(Error('Python AST parser unavailable: '+e.message)));
  child.stdout.on('data',chunk=>{output+=chunk;if(output.length>16000000){child.kill();finish(Error('Python graph exceeds output limit.'));}});
  child.stderr.on('data',chunk=>{error=(error+chunk).slice(-2000);});
  child.stdin.on('error',()=>{});
  child.on('close',code=>{if(code!==0)return finish(Error('Python parse failed: '+error));try{finish(null,{version:EXTRACTOR_VERSION,path:file,hash,...JSON.parse(output)});}catch(e){finish(e);}});
  child.stdin.end(JSON.stringify({path:file,text,hash}));
 });
}
const unwrapExpression=node=>{while(node&&['TSAsExpression','TSSatisfiesExpression','TSNonNullExpression','ParenthesizedExpression','TSTypeAssertion'].includes(node.type))node=node.expression;return node;};
export function extractSource(file,text){
 const hash=sourceHash(text),nodes=[],edges=[],imports=[],definitions=new WeakMap(),occurrences=new WeakMap(),constBindings=new WeakSet();let symbols;
 const node=(name,kind,line=1,end=line,column=0)=>{const id=`${file}#${kind}:${name}:${line}:${column}`;nodes.push({id,title:name,kind,path:file,line,column,endLine:end,hash});return id;};
 const fileId=node(path.posix.basename(file),'file');
 if(/\.md$/i.test(file)){
  for(const [i,line] of text.split('\n').entries()){
   const match=/^(#{1,6})\s+(.+)$/.exec(line);if(match){const id=node(match[2],'heading',i+1);edges.push({source:fileId,target:id,type:'contains'});}
  }
  for(const target of targets(text))imports.push({target,type:'links',line:1});
 }else if(/\.[cm]?[jt]sx?$/i.test(file)){
  const ast=parse(text,{sourceType:'unambiguous',plugins:[...(/\.(?:[cm]?ts|tsx)$/i.test(file)?['typescript']:[]),...(/\.[jt]sx$/i.test(file)?['jsx']:[])],attachComment:false});
  function walk(value,parent=fileId){
   if(!value||typeof value!=='object')return;
   let owner=parent;
   if(['FunctionDeclaration','ClassDeclaration','ClassMethod','ObjectMethod','TSInterfaceDeclaration','TSTypeAliasDeclaration'].includes(value.type)){
    const name=value.id?.name||value.key?.name||value.key?.value||'(anonymous)';
    owner=node(String(name),value.type,value.loc.start.line,value.loc.end.line,value.loc.start.column);definitions.set(value,owner);edges.push({source:parent,target:owner,type:'contains'});
   }
   if(value.type==='VariableDeclarator'&&['ArrowFunctionExpression','FunctionExpression'].includes(value.init?.type)){
    owner=node(value.id.name||'(binding)','function',value.loc.start.line,value.loc.end.line,value.loc.start.column);definitions.set(value,owner);edges.push({source:parent,target:owner,type:'contains'});
   }
   // const useThing = createThing(...): calls to useThing() resolve to this declaration (the factory result is not followed).
   if(value.type==='VariableDeclaration'&&value.kind==='const')for(const d of value.declarations)constBindings.add(d);
   if(value.type==='VariableDeclarator'&&constBindings.has(value)&&value.id?.type==='Identifier'&&['CallExpression','NewExpression'].includes(unwrapExpression(value.init)?.type)){
    owner=node(value.id.name,'binding',value.loc.start.line,value.loc.end.line,value.loc.start.column);definitions.set(value,owner);edges.push({source:parent,target:owner,type:'contains'});
   }
   if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(value.type)&&value.source?.value)imports.push({target:value.source.value,type:'imports',line:value.loc.start.line});
   if(value.type==='CallExpression'&&value.callee?.name==='require'&&value.arguments?.[0]?.type==='StringLiteral')imports.push({target:value.arguments[0].value,type:'imports',line:value.loc.start.line});
   // Calls are evidence records, not guessed resolved links across scopes.
   if(value.type==='CallExpression'){
    const callee=value.callee?.name||(value.callee?.object?.name&&value.callee?.property?.name?`${value.callee.object.name}.${value.callee.property.name}`:value.callee?.type==='MemberExpression'&&!value.callee.computed&&value.callee.object?.type==='ThisExpression'&&value.callee.property?.name?`this.${value.callee.property.name}`:null);
    if(callee){const id=node(callee,'call',value.loc.start.line,value.loc.end.line,value.loc.start.column);occurrences.set(value,{id,owner,line:value.loc.start.line});edges.push({source:owner,target:id,type:'calls'});}
   }
   for(const [key,child] of Object.entries(value)){
    if(['loc','start','end','extra','comments','tokens'].includes(key))continue;
    if(Array.isArray(child)){for(const item of child)walk(item,owner);}else if(child&&typeof child==='object')walk(child,owner);
   }
  }
  walk(ast);
  symbols=collectSymbols(ast,definitions,occurrences);
 }else if(/\.json$/i.test(file)){
  const value=/(^|\/)[tj]sconfig(\.[\w-]+)?\.json$/.test(file)?parseJsonc(text):JSON.parse(text);
  if(path.posix.basename(file)==='package.json')for(const [name,version] of Object.entries({...value.dependencies,...value.devDependencies})){
   const id=node(`${name}@${version}`,'package');edges.push({source:fileId,target:id,type:'depends-on'});
  }
 }
 // Multiple calls on one line can share identity; preserve a unique graph.
 return {version:EXTRACTOR_VERSION,path:file,hash,nodes:[...new Map(nodes.map(n=>[n.id,n])).values()],edges:[...new Map(edges.map(e=>[JSON.stringify(e),e])).values()],imports,symbols};
}
// tsconfig/jsconfig files are JSON with comments and trailing commas.
export function parseJsonc(text){
 let out='',i=0;
 while(i<text.length){
  const c=text[i];
  if(c==='"'){let j=i+1;while(j<text.length&&text[j]!=='"'){if(text[j]==='\\')j++;j++;}out+=text.slice(i,j+1);i=j+1;}
  else if(c==='/'&&text[i+1]==='/'){while(i<text.length&&text[i]!=='\n')i++;}
  else if(c==='/'&&text[i+1]==='*'){i=text.indexOf('*/',i+2);i=i<0?text.length:i+2;}
  else{out+=c;i++;}
 }
 return JSON.parse(out.replace(/,(\s*[}\]])/g,'$1').replace(/^﻿/,''));
}
// Module aliases from compilerOptions.paths / baseUrl, as repo-relative patterns.
export function aliasesFromConfigs(configs){
 const aliases=[];
 for(const {file,config} of configs){
  const options=config?.compilerOptions||{},dir=path.posix.dirname(file),base=options.baseUrl?path.posix.normalize(path.posix.join(dir,options.baseUrl)):dir;
  for(const [pattern,list] of Object.entries(options.paths||{}))if(Array.isArray(list))aliases.push({pattern,targets:list.filter(t=>typeof t==='string').map(t=>path.posix.normalize(path.posix.join(base,t)))});
  if(options.baseUrl)aliases.push({pattern:'*',targets:[path.posix.join(base==='.'?'':base,'*')]});
 }
 return aliases;
}
export function assembleGraph(extractions,{aliases=[]}={}){
 const nodes=extractions.flatMap(x=>x.nodes),edges=extractions.flatMap(x=>x.edges),files=new Map(extractions.map(x=>[x.path,x.nodes[0].id])),unresolved=[];
 for(const item of extractions)for(const dependency of item.imports){
  if(dependency.external){unresolved.push({source:item.path,...dependency});continue;}
  const base=path.posix.normalize(path.posix.join(dependency.absolute?'':path.posix.dirname(item.path),dependency.target.split('#')[0]));
  const candidates=[base,...['.js','.mjs','.cjs','.ts','.tsx','.jsx','.md','.py','/index.js','/index.ts','/__init__.py'].map(ext=>base+ext)];
  const resolved=/\.[cm]?[jt]sx?$/i.test(item.path)&&dependency.type==='imports'?resolveModule(item.path,dependency.target,files,aliases):candidates.find(p=>files.has(p));
  if(resolved)edges.push({source:item.nodes[0].id,target:files.get(resolved),type:dependency.type,line:dependency.line});
  else unresolved.push({source:item.path,...dependency});
 }
 const calls=resolveCalls(extractions,{aliases});edges.push(...calls.edges);
 return {schema:'adamantium.graph/v1',extractor:EXTRACTOR_VERSION,nodes,edges,unresolved:unresolved.slice(0,20000),unresolvedTotal:unresolved.length,unresolvedCalls:calls.unresolvedCalls.slice(0,20000),unresolvedCallsTotal:calls.unresolvedCalls.length,callSummary:calls.summary,resolvedCalls:calls.edges.filter(e=>e.type==='invokes').length,files:extractions.length};
}
