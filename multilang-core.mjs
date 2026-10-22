import {Parser,Language} from 'web-tree-sitter';
import {createRequire} from 'node:module';
import path from 'node:path';
import crypto from 'node:crypto';
const require=createRequire(import.meta.url),grammarRoot=path.join(path.dirname(require.resolve('tree-sitter-wasms/package.json')),'out');
export const languageExtensions=Object.freeze({
 '.c':'c','.h':'c','.cpp':'cpp','.cc':'cpp','.cxx':'cpp','.hpp':'cpp','.cs':'c_sharp',
 '.go':'go','.java':'java','.rs':'rust','.rb':'ruby','.php':'php','.lua':'lua','.sh':'bash','.bash':'bash',
 '.kt':'kotlin','.kts':'kotlin','.swift':'swift','.scala':'scala','.sc':'scala','.zig':'zig','.dart':'dart',
 '.ex':'elixir','.exs':'elixir','.el':'elisp','.ml':'ocaml','.mli':'ocaml','.res':'rescript','.resi':'rescript',
 '.sol':'solidity','.m':'objc','.mm':'objc','.rdl':'systemrdl','.tla':'tlaplus',
 '.html':'html','.htm':'html','.css':'css','.vue':'vue','.toml':'toml','.erb':'embedded_template'
});
export const languageFor=file=>languageExtensions[path.extname(file).toLowerCase()]||null;
let initialized;const languages=new Map();
async function language(name){
 initialized||=Parser.init();await initialized;
 if(!languages.has(name))languages.set(name,Language.load(path.join(grammarRoot,`tree-sitter-${name}.wasm`)));
 return languages.get(name);
}
const definitions=/^(function_(definition|definition_statement|declaration|item|signature)|method(_declaration|_definition)?|singleton_method|class(_declaration|_definition|_specifier|_interface|_implementation)?|struct_(item|specifier|declaration)|enum_(item|specifier|declaration)|interface_declaration|trait_item|type_declaration|type_alias_declaration|object_declaration|module|module_definition|module_declaration|contract_declaration|operator_definition|let_binding|let_declaration|component_named_def|component_inst)$/;
const calls=new Set(['call_expression','call','method_invocation','function_call_expression','function_call','invocation_expression','command']);
function firstName(node,depth=0){
 if(!node||depth>5)return null;
 if(/^(identifier|simple_identifier|type_identifier|field_identifier|value_identifier|value_name|id|constant|name|symbol|class_name)$/.test(node.type))return node;
 const field=node.childForFieldName('name')||node.childForFieldName('declarator')||node.childForFieldName('pattern')||node.childForFieldName('id');if(field)return firstName(field,depth+1)||field;
 for(const child of node.namedChildren){if(/body|block|parameters|arguments/.test(child.type))continue;const found=firstName(child,depth+1);if(found)return found;}
 return null;
}
export async function extractMultilang(file,text,version='adamantium-ast-10'){
 const lang=languageFor(file);if(!lang)throw Error('Unsupported source language.');
 const grammar=await language(lang),parser=new Parser();let tree;
 try{
  parser.setLanguage(grammar);
  const deadline=performance.now()+15000;
  tree=parser.parse(text,null,{progressCallback:()=>performance.now()>deadline});
  if(!tree)throw Error(`${lang} parser exceeded its 15-second budget.`);
  if(tree.rootNode.hasError){const bad=tree.rootNode.descendantsOfType('ERROR')[0];throw Error(`${lang} syntax error${bad?' at line '+(bad.startPosition.row+1):' (missing syntax)'}. No inferred graph saved for this file.`);}
  const hash=crypto.createHash('sha256').update(text).digest('hex'),nodes=[],edges=[],imports=[],pending=[];
  function add(title,kind,node){const line=node.startPosition.row+1,column=node.startPosition.column,id=`${file}#${kind}:${title}:${line}:${column}`;nodes.push({id,title,kind,path:file,line,column,endLine:node.endPosition.row+1,hash,language:lang});return id;}
  const fileId=add(path.posix.basename(file),'file',tree.rootNode),stack=[{node:tree.rootNode,owner:fileId}];
  let visited=0;
  while(stack.length){
   if(++visited>1000000||performance.now()>deadline)throw Error('Source AST exceeds the bounded extraction budget.');
   const {node,owner}=stack.pop();let nextOwner=owner,name=null,kind=node.type;
   if(definitions.test(kind))name=firstName(node.childForFieldName('name')||node.childForFieldName('declarator')||node)?.text;
   if(lang==='elixir'&&kind==='call'&&['def','defp','defmodule','defprotocol','defimpl'].includes(node.childForFieldName('target')?.text)){
    const args=node.namedChildren.find(n=>n.type==='arguments');name=args?.namedChildren[0]?.childForFieldName('target')?.text||args?.namedChildren[0]?.text;kind='definition';
   }
   if(lang==='elisp'&&kind==='list'&&/^def(un|macro|var|const|custom)$/.test(node.namedChildren[0]?.text||'')){name=node.namedChildren[1]?.text;kind='definition';}
   if(['html','vue'].includes(lang)&&kind==='element')name=node.namedChildren.find(n=>n.type==='start_tag')?.namedChildren.find(n=>n.type==='tag_name')?.text;
   if(lang==='css'&&kind==='rule_set')name=node.namedChildren.find(n=>n.type==='selectors')?.text;
   if(lang==='toml'&&['table','table_array_element','pair'].includes(kind))name=node.namedChildren[0]?.text;
   if(lang==='embedded_template'&&kind==='output_directive')name=node.namedChildren.find(n=>n.type==='code')?.text.trim();
   if(name){nextOwner=add(name.slice(0,200),kind,node);edges.push({source:owner,target:nextOwner,type:'contains'});if(lang==='c'&&kind==='function_definition'&&/^static\s/.test(node.text))nodes[nodes.length-1].static=true;}
   else if(calls.has(kind)){
    const callee=node.childForFieldName('function')||node.childForFieldName('name')||node.childForFieldName('target')||node.namedChildren[0];
    if(callee){const id=add(callee.text.slice(0,200),'call',node);edges.push({source:owner,target:id,type:'calls'});pending.push({id,owner,line:node.startPosition.row+1,ref:null,name:callee.text,qualified:!!node.childForFieldName('object'),receiver:node.childForFieldName('object')?.text});}
   }
   if(/^(import_(declaration|statement|spec)|use_declaration|preproc_include|require)$/.test(node.type)){
    const target=node.childForFieldName('path')||node.childForFieldName('source')||(node.type==='use_declaration'?node.childForFieldName('argument'):null);
    if(target)imports.push({target:target.text.replace(/^["'<]|["'>]$/g,''),type:'imports',line:node.startPosition.row+1,external:true});
   }
   const children=node.namedChildren;for(let i=children.length-1;i>=0;i--)stack.push({node:children[i],owner:nextOwner});
  }
  if(['go','rust','java','c'].includes(lang)){
   const declared=nodes.filter(n=>/function|method/.test(n.kind)&&n.kind!=='call');
   const shadows=new Set();for(const n of tree.rootNode.descendantsOfType(['parameter_declaration','formal_parameter','parameter','variable_declarator','short_var_declaration','let_declaration'])){const name=firstName(n)?.text;if(name)shadows.add(name);}
   for(const call of pending)call.shadowed=shadows.has(call.name);
   for(const call of pending){if(call.qualified||!/^[A-Za-z_$][\w$]*$/.test(call.name)||shadows.has(call.name))continue;const parent=id=>edges.find(e=>e.type==='contains'&&e.target===id)?.source;const candidates=declared.filter(n=>n.title===call.name&&(lang!=='java'||parent(n.id)===parent(call.owner)));if(candidates.length===1)call.ref={id:candidates[0].id};}
  }
  return {version,path:file,hash,nodes,edges,imports,symbols:{language:lang,exports:[],calls:pending,package:tree.rootNode.descendantsOfType(['package_clause','package_declaration'])[0]?.namedChildren.find(n=>/identifier|package_identifier|scoped_identifier/.test(n.type))?.text||null},resolution:'Unique unshadowed same-file direct calls resolve in Go, Rust, Java and C; external, overloaded and dynamic targets remain unresolved.'};
 }finally{tree?.delete();parser.delete();}
}
