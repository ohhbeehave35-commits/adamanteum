import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SETTINGS_FILE='Adamantium-settings.json';
const BOOKMARKS_FILE='Adamantium-bookmarks.json';
const OBSIDIAN_FILES=['app.json','daily-notes.json','templates.json','bookmarks.json','workspace.json','core-plugins.json'];
const CARRIED_APP=new Set(['userIgnoreFilters']);
const CARRIED_DAILY=new Set(['folder','format','template']);
const CARRIED_TEMPLATES=new Set(['folder','dateFormat','timeFormat']);

function readJson(file){
 const raw=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');
 return JSON.parse(raw);
}
function tryRead(root,relative){
 const full=path.join(root,relative);
 try{if(!fs.existsSync(full)||!fs.statSync(full).isFile())return {missing:true};return {value:readJson(full)};}
 catch(error){return {error:error.message};}
}
export function pathIgnored(relative,filters){
 const target=String(relative||'').replaceAll('\\','/').replace(/^\/+/,'');
 if(!target)return false;
 for(const raw of filters||[]){
  const filter=String(raw||'').replaceAll('\\','/').replace(/^\/+/,'');
  if(!filter)continue;
  if(/[*?]/.test(filter)){
   const re=new RegExp('^'+filter.replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*\*/g,'«DS»').replace(/\*/g,'[^/]*').replace(/\?/g,'[^/]').replace(/«DS»/g,'.*')+'/?$');
   if(re.test(target)||re.test(target.split('/').pop()))return true;
   continue;
  }
  const folder=filter.endsWith('/')?filter:filter+'/';
  const exact=filter.replace(/\/+$/,'');
  if(target===exact||target.startsWith(folder)||target+'/'===folder)return true;
 }
 return false;
}
export function loadExcludeFilters(root){
 const filters=[];
 for(const [relative,key] of [[SETTINGS_FILE,'exclude'],[path.join('.obsidian','app.json'),'userIgnoreFilters']]){
  const found=tryRead(root,relative);
  if(found.value&&Array.isArray(found.value[key]))filters.push(...found.value[key].map(String));
 }
 return [...new Set(filters)];
}
function walkLeaves(node,out=[]){
 if(!node||typeof node!=='object')return out;
 if(Array.isArray(node)){for(const item of node)walkLeaves(item,out);return out;}
 if(node.type==='leaf')out.push(node);
 for(const value of Object.values(node))if(value&&typeof value==='object')walkLeaves(value,out);
 return out;
}
function walkBookmarks(items,depth=0,files=[],skipped=[]){
 for(const item of Array.isArray(items)?items:[]){
  if(item&&item.type==='file'&&typeof item.path==='string')files.push({path:item.path,title:item.title||path.posix.basename(item.path,'.md')});
  else if(item&&item.type==='group'&&depth<8)walkBookmarks(item.items,depth+1,files,skipped);
  else skipped.push({type:item?.type||'unknown',title:item?.title||item?.query||item?.path||'',reason:'not carried'});
 }
 return {files,skipped};
}
function leftoverKeys(object,carried){
 return Object.keys(object||{}).filter(key=>!carried.has(key));
}
function formatReport({hasObsidian,carried,notCarried}){
 if(!hasObsidian)return 'This vault has no .obsidian folder. Nothing to import.';
 const lines=['Obsidian settings brought into Adamantium',''];
 lines.push('Carried across:');
 if(!carried.length)lines.push('- nothing');else for(const row of carried)lines.push('- '+row);
 lines.push('','Not carried:');
 if(!notCarried.length)lines.push('- nothing');else for(const row of notCarried)lines.push('- '+row);
 return lines.join('\n');
}
function sameSettings(a,b){
 const strip=value=>{const copy={...value};delete copy.importedAt;return copy;};
 return JSON.stringify(strip(a))===JSON.stringify(strip(b));
}
export function importObsidianVault(directory,{write=true}={}){
 if(!directory||!path.isAbsolute(directory))throw Error('Choose an absolute vault folder.');
 const root=fs.realpathSync(directory);
 if(root===path.parse(root).root||root===os.homedir())throw Error('Choose a vault, not a home or drive root.');
 if(!fs.statSync(root).isDirectory())throw Error('Choose a vault folder.');
 const obsidian=path.join(root,'.obsidian');
 const carried=[],notCarried=[];
 if(!fs.existsSync(obsidian)||!fs.statSync(obsidian).isDirectory()){
  const text=formatReport({hasObsidian:false,carried,notCarried});
  return {hasObsidian:false,text,carried,notCarried,settings:null,written:[]};
 }
 const files={};
 for(const name of OBSIDIAN_FILES){
  const found=tryRead(root,path.join('.obsidian',name));
  files[name]=found;
  if(found.missing)notCarried.push(name+' was missing');
  else if(found.error)notCarried.push(name+' could not be read ('+found.error+')');
 }
 const app=files['app.json'].value||{};
 const daily=files['daily-notes.json'].value||{};
 const templates=files['templates.json'].value||{};
 const bookmarksFile=files['bookmarks.json'].value||{};
 const workspace=files['workspace.json'].value||{};
 const plugins=files['core-plugins.json'].value||{};

 const exclude=Array.isArray(app.userIgnoreFilters)?app.userIgnoreFilters.map(String).filter(Boolean):[];
 for(const key of leftoverKeys(app,CARRIED_APP))notCarried.push('app.json '+key);
 if(exclude.length)carried.push('Exclude filters: '+exclude.join(', ')+' (those folders stay hidden here)');
 else if(files['app.json'].value&&!('userIgnoreFilters' in app))notCarried.push('app.json userIgnoreFilters was empty');

 const dailyOut={};
 if(typeof daily.folder==='string')dailyOut.folder=daily.folder;
 if(typeof daily.format==='string')dailyOut.format=daily.format;
 if(typeof daily.template==='string')dailyOut.template=daily.template;
 for(const key of leftoverKeys(daily,CARRIED_DAILY))notCarried.push('daily-notes.json '+key);
 if(Object.keys(dailyOut).length)carried.push('Daily notes: '+[dailyOut.folder&&('folder '+dailyOut.folder),dailyOut.format&&('date format '+dailyOut.format),dailyOut.template&&('template '+dailyOut.template)].filter(Boolean).join(', '));

 const templatesOut={};
 if(typeof templates.folder==='string')templatesOut.folder=templates.folder;
 for(const key of leftoverKeys(templates,CARRIED_TEMPLATES))notCarried.push('templates.json '+key);
 if(templatesOut.folder)carried.push('Templates folder: '+templatesOut.folder);
 if(typeof templates.dateFormat==='string'||typeof templates.timeFormat==='string')carried.push('Template date and time format: '+[templates.dateFormat&&('date '+templates.dateFormat),templates.timeFormat&&('time '+templates.timeFormat)].filter(Boolean).join(', ')+' (read from the Obsidian file itself)');

 for(const key of leftoverKeys(bookmarksFile,new Set(['items'])))notCarried.push('bookmarks.json '+key);
 const {files:bookmarkFiles,skipped:bookmarkSkipped}=walkBookmarks(bookmarksFile.items);
 const seen=new Set();
 const bookmarks=[];
 for(const item of bookmarkFiles){if(seen.has(item.path))continue;seen.add(item.path);bookmarks.push(item);}
 if(bookmarks.length)carried.push('Bookmarks: '+bookmarks.length+' note'+(bookmarks.length===1?'':'s')+' ('+bookmarks.map(b=>b.path).join(', ')+')');
 for(const skip of bookmarkSkipped)notCarried.push('bookmarks.json '+skip.type+(skip.title?' "'+skip.title+'"':''));

 const tabs=[],pinned=[],tabSeen=new Set(),pinSeen=new Set();
 for(const leaf of walkLeaves(workspace)){
  const state=leaf.state,file=state?.state?.file;
  if(state?.type==='markdown'&&typeof file==='string'){
   if(!tabSeen.has(file)){tabSeen.add(file);tabs.push(file);}
   if(leaf.pinned&&!pinSeen.has(file)){pinSeen.add(file);pinned.push(file);}
  }else if(state?.type&&state.type!=='markdown')notCarried.push('workspace.json '+state.type+' leaf');
 }
 for(const key of Object.keys(workspace))if(!['main','left','right','active','lastOpenFiles'].includes(key))notCarried.push('workspace.json '+key);
 if(workspace.lastOpenFiles&&!Array.isArray(workspace.lastOpenFiles))notCarried.push('workspace.json lastOpenFiles');
 if(tabs.length)carried.push('Open workspace tabs: '+tabs.join(', '));
 if(pinned.length)carried.push('Pinned notes: '+pinned.join(', '));
 const starred=bookmarks.map(b=>b.path);
 if(starred.length)carried.push('Starred notes: '+starred.join(', '));
 if(Object.keys(workspace).length&&!tabs.length&&!pinned.length)notCarried.push('workspace.json pane layout');

 for(const key of Object.keys(plugins))notCarried.push('core-plugins.json '+key);

 const settings={
  schema:'adamantium.settings/v1',
  daily:dailyOut,
  templates:templatesOut,
  exclude,
  workspaceTabs:tabs,
  pinned,
  starred,
  report:{carried,notCarried}
 };
 let previous=null;
 try{previous=readJson(path.join(root,SETTINGS_FILE));}catch{}
 if(previous&&sameSettings(previous,settings))settings.importedAt=previous.importedAt;
 else settings.importedAt=previous?.importedAt||new Date().toISOString();

 const written=[];
 if(write){
  fs.writeFileSync(path.join(root,SETTINGS_FILE),JSON.stringify(settings,null,2)+'\n');
  written.push(SETTINGS_FILE);
  let existing=[];
  try{existing=JSON.parse(fs.readFileSync(path.join(root,BOOKMARKS_FILE),'utf8').replace(/^\uFEFF/,''));if(!Array.isArray(existing))existing=[];}catch{existing=[];}
  const merged=[],known=new Set();
  for(const item of [...existing,...bookmarks]){
   if(!item||typeof item.path!=='string'||known.has(item.path))continue;
   known.add(item.path);merged.push({path:item.path,title:item.title||path.posix.basename(item.path,'.md')});
  }
  merged.sort((a,b)=>a.path.localeCompare(b.path));
  fs.writeFileSync(path.join(root,BOOKMARKS_FILE),JSON.stringify(merged,null,2)+'\n');
  written.push(BOOKMARKS_FILE);
 }
 const text=formatReport({hasObsidian:true,carried,notCarried});
 return {hasObsidian:true,text,carried,notCarried,settings,written,root};
}
