import traverse from '@babel/traverse';
import path from 'node:path';
import {crossFileTargets} from './cross-file-resolution.mjs';

const JS_GLOBALS = new Set(['JSON', 'Math', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'Promise', 'console', 'process', 'Buffer', 'window', 'document', 'parseInt', 'parseFloat', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'fetch', 'require', 'URL', 'URLSearchParams', 'Error', 'TypeError', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'Intl', 'structuredClone', 'atob', 'btoa', 'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI', 'queueMicrotask', 'isNaN', 'isFinite', 'RegExp', 'Uint8Array', 'Float64Array', 'ArrayBuffer', 'BigInt', 'Reflect', 'Proxy', 'globalThis', 'navigator', 'localStorage', 'sessionStorage', 'alert', 'confirm', 'requestAnimationFrame', 'FormData', 'Headers', 'Request', 'Response', 'AbortController', 'TextEncoder', 'TextDecoder', 'crypto', 'performance', 'import']);
const PY_BUILTINS = new Set(['print', 'len', 'range', 'str', 'int', 'float', 'bool', 'list', 'dict', 'set', 'tuple', 'sorted', 'sum', 'min', 'max', 'abs', 'any', 'all', 'enumerate', 'zip', 'map', 'filter', 'open', 'isinstance', 'issubclass', 'getattr', 'setattr', 'hasattr', 'type', 'super', 'repr', 'round', 'reversed', 'iter', 'next', 'bytes', 'bytearray', 'format', 'id', 'hash', 'input', 'vars', 'dir', 'callable', 'ord', 'chr', 'hex', 'bin', 'divmod', 'pow', 'frozenset', 'object', 'Exception', 'ValueError', 'TypeError', 'KeyError', 'RuntimeError', 'NotImplementedError', 'staticmethod', 'classmethod', 'property']);
const EXTERNAL_CODES = new Set(['external-package', 'builtin-or-global', 'external-or-standard-library']);

// Resolve lexical bindings, not name matches. Parameters, mutations and dynamic
// member dispatch deliberately remain unresolved rather than inventing edges.
export function collectSymbols(ast, definitions, occurrences) {
 const exports=[],calls=[];
 function bindingRef(scope,name) {
  const binding=scope.getBinding(name);
  if(!binding || !binding.constant)return null;
  const p=binding.path,n=p.node;
  if(definitions.has(n))return {id:definitions.get(n)};
  if(p.isImportSpecifier()||p.isImportDefaultSpecifier()||p.isImportNamespaceSpecifier()){
   if(n.importKind==='type'||p.parent.importKind==='type')return null;
   return {module:p.parent.source.value,name:p.isImportDefaultSpecifier()?'default':p.isImportNamespaceSpecifier()?'*':n.imported.name||n.imported.value};
  }
  return null;
 }
 // Why a call could not be tied to a declaration, in words a person can act on.
 function why(scope,callee) {
  const base=callee.type==='Identifier'?callee:callee.type==='MemberExpression'&&callee.object.type==='Identifier'?callee.object:null;
  const member=callee.type==='MemberExpression';
  if(callee.type==='MemberExpression'&&callee.object.type==='ThisExpression')return 'method-on-instance';
  if(!base)return 'dynamic';
  const binding=scope.getBinding(base.name);
  if(!binding)return JS_GLOBALS.has(base.name)?'builtin-or-global':'undeclared-name';
  if(!binding.constant)return 'reassigned';
  if(binding.kind==='param')return member?'member-of-parameter':'parameter';
  const p=binding.path;
  if(p.isImportSpecifier()||p.isImportDefaultSpecifier()||p.isImportNamespaceSpecifier())return member?'member-of-import':'import-type-only';
  return member?'member-of-local-value':'local-value-not-a-declared-function';
 }
 traverse(ast,{
  ExportNamedDeclaration(p){
   if(p.node.exportKind==='type')return;
   const declaration=p.node.declaration;
   if(declaration){
    for(const name of Object.keys(p.getBindingIdentifiers())){
     const ref=bindingRef(p.scope,name);if(ref)exports.push({name,ref});
    }
   }
   for(const s of p.node.specifiers){
    if(s.exportKind==='type'||s.type!=='ExportSpecifier')continue;
    const ref=p.node.source?{module:p.node.source.value,name:s.local.name||s.local.value}:bindingRef(p.scope,s.local.name);
    if(ref)exports.push({name:s.exported.name||s.exported.value,ref});
   }
  },
  ExportDefaultDeclaration(p){
   const n=p.node.declaration;
   const ref=definitions.has(n)?{id:definitions.get(n)}:n.type==='Identifier'?bindingRef(p.scope,n.name):null;
   if(ref)exports.push({name:'default',ref});
  },
  ExportAllDeclaration(p){if(p.node.exportKind!=='type')exports.push({name:'*',ref:{module:p.node.source.value,name:'*'}});},
  CallExpression(p){
   const occurrence=occurrences.get(p.node);if(!occurrence)return;
   const n=p.node.callee;let ref=null;
   if(n.type==='Identifier')ref=bindingRef(p.scope,n.name);
   else if(n.type==='MemberExpression'&&!n.computed&&n.object.type==='ThisExpression'){
    // this.method(): the method of the enclosing class (inherited and overridden targets stay unresolved).
    const klass=p.findParent(x=>x.isClass());
    if(klass&&n.property.type==='Identifier'){
     const method=klass.node.body.body.find(m=>(m.type==='ClassMethod'||m.type==='ClassPrivateMethod')&&m.key?.name===n.property.name&&definitions.has(m));
     if(method)ref={id:definitions.get(method)};
    }
   }
   else if(n.type==='MemberExpression'&&!n.computed&&n.object.type==='Identifier'){
    const base=bindingRef(p.scope,n.object.name);
    if(base?.name==='*')ref={...base,name:n.property.name};
    // Class.method() / importedClass.method(): resolved through the class declaration, never by method name alone.
    else if(base&&(base.id||base.module)&&n.property.type==='Identifier')ref={...base,member:n.property.name};
   }
   calls.push({...occurrence,ref,...(ref?{}:{why:why(p.scope,n)})});
  }
 });
 return {exports,calls};
}

// aliases: [{pattern:'@/*', targets:['src/*']}] from tsconfig/jsconfig paths and baseUrl.
export function resolveModule(from,target,files,aliases=[]){
 const attempt=base=>{
  const candidates=[base,...['.js','.mjs','.cjs','.ts','.tsx','.jsx','/index.js','/index.ts','/index.tsx'].map(ext=>base+ext)];
  if(/\.[cm]?js$/.test(base))candidates.push(base.replace(/\.([cm]?)js$/,'.$1ts'));
  return candidates.find(p=>files.has(p))||null;
 };
 if(!target.startsWith('.')){
  // Bare specifiers are packages, never same-named local files, unless a project alias names them.
  for(const alias of aliases){
   const star=alias.pattern.endsWith('*'),prefix=star?alias.pattern.slice(0,-1):alias.pattern;
   if(star?!target.startsWith(prefix):target!==alias.pattern)continue;
   const rest=star?target.slice(prefix.length):'';
   for(const t of alias.targets){const found=attempt(path.posix.normalize(star?t.replace('*',rest):t));if(found)return found;}
  }
  return null;
 }
 return attempt(path.posix.normalize(path.posix.join(path.posix.dirname(from),target)));
}

export function resolveCalls(extractions,{aliases=[]}={}){
 const files=new Map(extractions.map(x=>[x.path,x])),edges=[],unresolvedCalls=[];
 const children=new Map(),nodes=new Map(),parents=new Map();
 for(const x of extractions){for(const n of x.nodes)nodes.set(n.id,n);for(const e of x.edges)if(e.type==='contains'){if(!children.has(e.source))children.set(e.source,[]);children.get(e.source).push(e.target);parents.set(e.target,e.source);}}
 const member=(classId,name)=>{
  const found=(children.get(classId)||[]).map(id=>nodes.get(id)).filter(n=>n&&n.title===name&&/Method|method|function|FunctionDef/.test(n.kind));
  return found.length===1?found[0].id:null;
 };
 function resolve(file,ref,visited=new Set()){
  if(!ref)return null;
  if(ref.id)return ref.member?member(ref.id,ref.member):ref.id;
  if(ref.member){
   const base=resolve(file,{...ref,member:undefined},visited);
   if(base)return member(base,ref.member);
   // Python: `from pkg import submodule` then `submodule.func()`. The imported name is a project file, so the call goes to the one function of that name it defines.
   if(ref.language==='python'&&ref.name!=='*'){
    const dir=path.posix.normalize(path.posix.join(ref.absolute?'':path.posix.dirname(file),ref.module));
    const sub=[dir+'/'+ref.name+'.py',dir+'/'+ref.name+'/__init__.py'].find(p=>files.has(p));
    const direct=sub&&(files.get(sub).symbols?.exports||[]).filter(e=>e.name===ref.member);
    if(direct&&direct.length===1&&visited.size<64)return resolve(sub,direct[0].ref,new Set(visited).add(sub+'#'+ref.member));
   }
   return null;
  }
  const base=ref.language==='python'?path.posix.normalize(path.posix.join(ref.absolute?'':path.posix.dirname(file),ref.module)):null;
  const target=base?[base+'.py',base+'/__init__.py'].find(p=>files.has(p)):resolveModule(file,ref.module,files,aliases);if(!target)return null;
  const key=target+'#'+ref.name;if(visited.has(key)||visited.size>=64)return null;
  const next=new Set(visited).add(key),exports=files.get(target).symbols?.exports||[];
  const direct=exports.find(e=>e.name===ref.name);
  if(direct)return resolve(target,direct.ref,next);
  if(ref.name==='default')return null;
  const matches=new Set(exports.filter(e=>e.name==='*').map(e=>resolve(target,{...e.ref,name:ref.name},next)).filter(Boolean));
  return matches.size===1?[...matches][0]:null;
 }
 // self.method() / cls.method() in Python and Class.method() in the same file, by containment, never by name alone.
 const enclosingClass=id=>{for(let i=0,at=id;at&&i<6;i++,at=parents.get(at)){const parent=parents.get(at);if(parent&&/Class|class/.test(nodes.get(parent)?.kind||''))return parent;}return null;};
 const cross=crossFileTargets(extractions);
 const declared=new Set();for(const x of extractions)if(x.symbols?.language)for(const n of x.nodes)if(/function|method/.test(n.kind)&&n.kind!=='call')declared.add(n.title);
 const reasonFor=(file,call,ref,title)=>{
  const python=/\.py$/i.test(file.path);
  if(call.why)return call.why;
  if(ref?.module){
   // Where does the import point? A package we do not have, a project file we could not find, or a file we found.
   const located=python?null:resolveModule(file.path,ref.module,files,aliases);
   if(python)return ref.absolute?'external-package':'import-not-found';
   if(located)return ref.member?'member-not-declared':'export-unresolved';
   const aliased=ref.module.startsWith('.')||aliases.some(al=>al.pattern!=='*'&&ref.module.startsWith(al.pattern.replace(/\*$/,'')));
   return aliased?'import-not-found':'external-package';
  }
  if(ref?.member)return 'member-not-declared';
  if(python){
   const head=title.split('.')[0];
   if(PY_BUILTINS.has(title))return 'builtin-or-global';
   if(head==='self'||head==='cls')return 'method-on-instance';
   if((file.imports||[]).some(i=>i.absolute&&String(i.target).split('/')[0]===head))return 'external-package';
   if(title.includes('.'))return 'member-of-object';
   return 'dynamic-or-unknown';
  }
  if(file.symbols?.language){const tail=title.split(/::|\.|->/).pop();return declared.has(tail)?'ambiguous-or-shadowed':'external-or-standard-library';}
  return ref?'export-unresolved':'dynamic-or-unknown';
 };
 for(const file of extractions)for(const call of file.symbols?.calls||[]){
  const title=nodes.get(call.id)?.title||'';
  let target=resolve(file.path,call.ref);
  if(!target&&/\.py$/i.test(file.path)){
   const m=/^(self|cls)\.(\w+)$/.exec(title);
   if(m){const klass=enclosingClass(call.owner);if(klass)target=member(klass,m[2]);}
   else{const c=/^([A-Za-z_]\w*)\.(\w+)$/.exec(title);if(c){const classes=file.nodes.filter(n=>n.kind==='ClassDef'&&n.title===c[1]);if(classes.length===1)target=member(classes[0].id,c[2]);}}
  }
  if(!target&&cross.has(call.id))target=cross.get(call.id);
  if(target){
   edges.push({source:call.id,target,type:'resolves-to',line:call.line});
   edges.push({source:call.owner,target,type:'invokes',line:call.line,occurrence:call.id});
  }else unresolvedCalls.push({path:file.path,id:call.id,line:call.line,reason:call.ref?'External, ambiguous or unavailable export':'Dynamic, reassigned or unknown binding',code:reasonFor(file,call,call.ref,title)});
 }
 const resolved=edges.filter(e=>e.type==='invokes').length,byCode={};
 for(const u of unresolvedCalls)byCode[u.code]=(byCode[u.code]||0)+1;
 const external=Object.entries(byCode).filter(([k])=>EXTERNAL_CODES.has(k)).reduce((n,[,v])=>n+v,0),calls=resolved+unresolvedCalls.length;
 return {edges,unresolvedCalls,summary:{calls,resolved,unresolved:unresolvedCalls.length,overallRate:calls?resolved/calls:0,external,inRepoCandidates:calls-external,inRepoRate:calls-external?resolved/(calls-external):0,byCode}};
}
