import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {parseYaml,stringifyYaml} from './yaml-lite.mjs';
import {stripCode} from './lib.mjs';
export const fingerprint=text=>createHash('sha256').update(text).digest('hex');
const FRONTMATTER=/^﻿?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;
export function frontmatter(text){
 const match=FRONTMATTER.exec(text),properties=Object.create(null);
 if(!match)return {properties,body:text,block:''};
 let error=null;
 try{const parsed=parseYaml(match[1]??'');if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))Object.assign(properties,parsed);else if(parsed!==null)error='Frontmatter must be a list of name: value pairs.';}
 catch(e){error=e.message;}
 return {properties,body:text.slice(match[0].length),block:match[0],...(error?{error}:{})};
}
export function propertyType(value){
 if(Array.isArray(value))return 'list';
 if(typeof value==='boolean')return 'checkbox';
 if(typeof value==='number')return 'number';
 if(value&&typeof value==='object')return 'object';
 if(typeof value==='string'){if(/^\d{4}-\d{2}-\d{2}$/.test(value))return 'date';if(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value))return 'datetime';}
 return 'text';
}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
// original = frontmatter() of the file as opened: untouched properties keep their exact source text.
export function markdown(body,properties={},original=null){
 if(original?.block&&same({...original.properties},{...properties}))return original.block+body;
 return Object.keys(properties).length?'---\n'+stringifyYaml(properties)+'\n---\n'+body:body;
}
// Inline tags as Obsidian's reader finds them: not inside fenced code, a code span (it may run over lines inside one paragraph),
// an HTML comment, <style> or <script>, or a link target. A tag starts at a # that follows the start, a space, * or [ (or the
// end of the previous tag, as in #a/#b); after a letter, digit, bracket, colon, equals sign or other mark it is not a tag. Its name is every character up to the next space or punctuation mark (a letter, digit, - _ / or most symbols stay),
// needs one non-digit, and a trailing slash is dropped.
const TAG_STOP=/[ -⁯⸀-⹿'!"#$%&()*+,.:;<=>?@^`{|}~\[\]\\\s]/u,TAG_BEFORE=/[\s*[]/u;
export function inlineTags(body){
 const text=String(body)
  .replace(/^ {0,3}(`{3,}|~{3,})[\s\S]*?(?:^ {0,3}\1[`~]*[ \t]*$|(?![\s\S]))/gm,'')
  .replace(/<!--[\s\S]*?-->|<(style|script)\b[\s\S]*?<\/\1>/gi,'')
  .replace(/(`+)(?!`)(?:(?!\1)[^\n]|\n(?![ \t]*\n))*?\1(?!`)/g,'')
  .replace(/\]\([^)\n]*\)/g,'](link)');
 const out=[];let chainEnd=-1;
 for(let i=0;i<text.length;i++){
  if(text[i]!=='#')continue;
  const prev=i?text[i-1]:'';
  if(prev&&!(TAG_BEFORE.test(prev)||chainEnd===i))continue;
  let j=i+1;while(j<text.length&&!TAG_STOP.test(text[j]))j++;
  const raw=text.slice(i+1,j);
  if(!raw||!/\D/.test(raw))continue;
  out.push(raw.replace(/\/+$/,''));chainEnd=j;i=j-1;
 }
 return out;
}
export function tagOccurrences(text){
 const {properties,body}=frontmatter(text),raw=properties.tags??properties.tag??[];
 // A frontmatter value written as one string counts only when it has no comma (a comma-separated string is not a list to Obsidian, and its tag pane skips it); spaces separate the names.
 const listed=(Array.isArray(raw)?raw:/,/.test(String(raw??''))?[]:String(raw??'').split(/\s+/)).map(t=>String(t??'').replace(/^#/,'').trim());
 return [...listed,...inlineTags(body)].filter(Boolean);
}
export function tagsOf(text){return [...new Set(tagOccurrences(text))];}
// The tag pane's counts, by Obsidian's own rule (metadataCache.getTags): every occurrence counts, one trailing "/" is
// dropped, a tag needs a non-digit, each parent of a nested tag (a/b -> a) counts once more, and names that differ only
// in letter case are one tag, shown in the spelling used most often.
export function obsidianTagCounts(occurrenceLists){
 const exact=new Map(),add=tag=>{if(tag.endsWith('/'))tag=tag.slice(0,-1);if(!tag||!/\D/.test(tag))return;exact.set(tag,(exact.get(tag)||0)+1);const last=tag.split('/').pop();if(last!==tag)add(tag.slice(0,tag.length-last.length-1));};
 for(const list of occurrenceLists)for(const tag of list)add(String(tag));
 const groups=new Map();
 for(const [tag,count] of exact){const key=tag.toLowerCase(),g=groups.get(key);if(!g)groups.set(key,{tag,count,max:count});else{g.count+=count;if(count>g.max){g.max=count;g.tag=tag;}}}
 return Object.fromEntries([...groups.values()].map(g=>[g.tag,g.count]));
}
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
// Moment-style formatting (the subset Obsidian's date settings use). Literal text goes in [brackets].
export function formatDate(date,format){
 const p=(n,w=2)=>String(n).padStart(w,'0'),Y=date.getUTCFullYear(),M=date.getUTCMonth(),D=date.getUTCDate(),W=date.getUTCDay(),h=date.getUTCHours(),m=date.getUTCMinutes(),s=date.getUTCSeconds();
 const jan1=Date.UTC(Y,0,1),day=Math.floor((Date.UTC(Y,M,D)-jan1)/864e5);
 const thursday=new Date(Date.UTC(Y,M,D+3-((W+6)%7))),isoYear=thursday.getUTCFullYear(),isoWeek=1+Math.floor((thursday-Date.UTC(isoYear,0,4)+((new Date(Date.UTC(isoYear,0,4)).getUTCDay()+6)%7)*864e5)/6048e5);
 const ordinal=n=>n+(n%100>=11&&n%100<=13?'th':['th','st','nd','rd'][n%10]||'th');
 const tokens={YYYY:p(Y,4),YY:p(Y%100),MMMM:MONTHS[M],MMM:MONTHS[M].slice(0,3),MM:p(M+1),M:M+1,DDDD:p(day+1,3),DDD:day+1,DD:p(D),Do:ordinal(D),D,dddd:DAYS[W],ddd:DAYS[W].slice(0,3),dd:DAYS[W].slice(0,2),d:W,GGGG:p(isoYear,4),WW:p(isoWeek),W:isoWeek,gggg:p(Y,4),ww:p(isoWeek),w:isoWeek,Q:Math.floor(M/3)+1,HH:p(h),H:h,hh:p(h%12||12),h:h%12||12,mm:p(m),m,ss:p(s),s,A:h<12?'AM':'PM',a:h<12?'am':'pm',X:Math.floor(date/1000),x:+date};
 return String(format).replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DDDD|DDD|DD|Do|D|dddd|ddd|dd|d|GGGG|gggg|WW|W|ww|w|Q|HH|H|hh|h|mm|m|ss|s|A|a|X|x/g,(token,literal)=>literal!==undefined?literal:tokens[token]);
}
export function renderTemplate(body,{date=new Date(),title='',dateFormat='YYYY-MM-DD',timeFormat='HH:mm'}={}){
 return String(body).replace(/\{\{\s*(date|time|title)\s*(?::\s*([^}]*?))?\s*\}\}/g,(_,kind,format)=>kind==='title'?title:formatDate(date,format||(kind==='date'?dateFormat:timeFormat)));
}
const VAULT_WRITABLE=/\.(md|base|json|canvas)$/i;
export class VaultWorkspace{
 constructor(root,{writable=false,history=null}={}){this.root=fs.realpathSync(root);this.writable=writable;this.history=history;}
 // Long form of a vault-relative path: every part that exists is replaced by its real on-disk name, so a Windows 8.3 short name (GIT~1) or another letter case can never hide a dot folder.
 canonical(relative){
  if(typeof relative!=='string'||!relative)return relative;
  const out=[];let current=this.root,resolving=true;
  for(const part of relative.split(/[\\/]/)){
   if(resolving&&part&&part!=='.'&&part!=='..'){const next=path.join(current,part);let real=null;try{real=fs.realpathSync.native(next);}catch{}if(real){out.push(path.basename(real));current=real;continue;}resolving=false;}
   out.push(part);
  }
  return out.join('/');
 }
 file(relative,{create=false}={}){
  if(typeof relative!=='string'||!relative||path.isAbsolute(relative)||relative.split(/[\\/]/).some(p=>!p||p==='..'||p==='.'||/[:*?"<>|]/.test(p)))throw Error('Choose a relative file inside the vault.');
  const full=path.resolve(this.root,relative);let current=this.root;
  for(const part of relative.split(/[\\/]/)){current=path.join(current,part);if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('Symlinks are not writable vault paths.');}
  if(!create&&!fs.existsSync(full))throw Error('Vault file not found.');return full;
 }
 read(relative){const raw=fs.readFileSync(this.file(relative),'utf8'),note=frontmatter(raw);return {path:relative,sha256:fingerprint(raw),...note,raw};}
 write({path:relative,body,expectedHash=null,actor=null}){
  if(!this.writable)throw Error('Vault writing is disabled. Enable it only for your chosen sample or approved copy.');
  if(typeof relative!=='string'||!VAULT_WRITABLE.test(relative)||typeof body!=='string'||Buffer.byteLength(body)>1024*1024)throw Error('Choose a Markdown, Base, Canvas or JSON file up to 1 MiB.');
  this.file(relative,{create:true});
  relative=this.canonical(relative);
  if(relative.split(/[\\/]/).some(p=>p.startsWith('.')))throw Error('Hidden folders such as .obsidian and .git are never written.');
  const full=this.file(relative,{create:true}),exists=fs.existsSync(full),old=exists?fs.readFileSync(full,'utf8'):null;
  if((exists?fingerprint(old):null)!==expectedHash)throw Error('File changed. Reopen it before saving.');
  // The private revision is durable before any source content is replaced.
  const saved=this.history&&exists?this.history.save({title:relative.slice(0,200),body:old,properties:{source:relative,sha256:fingerprint(old),...(actor?{actor}:{})}}):null;
  fs.mkdirSync(path.dirname(full),{recursive:true});
  // A lock file serialises writers; the content is written beside the target and renamed over it,
  // so a crash or power loss leaves either the complete old file or the complete new file.
  const lock=full+'.adamantium-lock',temp=path.join(path.dirname(full),'.'+path.basename(full)+'.'+randomBytes(6).toString('hex')+'.adamantium-tmp');let fd;
  try{
   fd=fs.openSync(lock,'wx');
   const now=fs.existsSync(full)?fs.readFileSync(full,'utf8'):null;
   if((now===null?null:fingerprint(now))!==expectedHash)throw Error('File changed. Reopen it before saving.');
   const handle=fs.openSync(temp,'wx');try{fs.writeFileSync(handle,body);fs.fsyncSync(handle);}finally{fs.closeSync(handle);}
   // Windows refuses a rename over a file another process (the indexer, a virus scanner) has open for a moment: wait and retry.
   for(let attempt=0;;attempt++){try{fs.renameSync(temp,full);break;}catch(error){if(!['EPERM','EBUSY','EACCES'].includes(error.code)||attempt>=8)throw error;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,25*(attempt+1));}}
  }catch(error){try{fs.unlinkSync(temp);}catch{}throw error.code==='EEXIST'?Error('Another save is in progress for this file. Try again.'):error;}
  finally{if(fd!==undefined){fs.closeSync(fd);try{fs.unlinkSync(lock);}catch{}}}
  return {path:relative,sha256:fingerprint(body),previousHash:expectedHash,bytes:Buffer.byteLength(body),created:!exists,revision:saved?{id:saved.id,revision:saved.revision}:null};
 }
 importedSettings(){try{return JSON.parse(fs.readFileSync(this.file('Adamantium-settings.json'),'utf8').replace(/^﻿/,''));}catch{return {};}}
 settings(){
  const read=name=>{try{return JSON.parse(fs.readFileSync(this.file('.obsidian/'+name),'utf8').replace(/^﻿/,''));}catch{return {};}};
  const imported=this.importedSettings(),app=read('app.json');
  return {
   daily:{...read('daily-notes.json'),...(imported.daily||{})},
   templates:{...read('templates.json'),...(imported.templates||{})},
   bookmarks:this.obsidianBookmarks(),
   exclude:Array.isArray(imported.exclude)&&imported.exclude.length?imported.exclude:app.userIgnoreFilters||[],
   workspaceTabs:imported.workspaceTabs||[],
   pinned:imported.pinned||[],
   starred:imported.starred||[],
   importReport:imported.report||null
  };
 }
 obsidianBookmarks(){
  try{
   const parsed=JSON.parse(fs.readFileSync(this.file('.obsidian/bookmarks.json'),'utf8').replace(/^﻿/,'')),out=[];
   const walk=(items,depth=0)=>{for(const item of Array.isArray(items)?items:[]){if(item.type==='file'&&typeof item.path==='string')out.push({path:item.path,title:item.title||path.posix.basename(item.path,'.md')});else if(item.type==='group'&&depth<8)walk(item.items,depth+1);}};
   walk(parsed.items);return out.slice(0,1000);
  }catch{return [];}
 }
 excludedFiles(){try{const f=JSON.parse(fs.readFileSync(this.file('.obsidian/app.json'),'utf8').replace(/^﻿/,'')).userIgnoreFilters;return Array.isArray(f)?f.filter(x=>typeof x==='string'):[];}catch{return [];}}
 templateFormats(){const t=this.settings().templates;return {dateFormat:typeof t.dateFormat==='string'&&t.dateFormat?t.dateFormat:'YYYY-MM-DD',timeFormat:typeof t.timeFormat==='string'&&t.timeFormat?t.timeFormat:'HH:mm'};}
 // Obsidian's Templates core plugin lists every Markdown file under its folder, sub-folders included ("Legal/00-INDEX").
 templates(){const folder=(this.settings().templates.folder||'Templates').replace(/^\/+|\/+$/g,'');let dir;try{dir=this.file(folder);}catch{return [];}const found=[],walk=(rel,depth)=>{if(depth>8||found.length>2000)return;let entries;try{entries=fs.readdirSync(path.join(dir,rel),{withFileTypes:true});}catch{return;}for(const e of entries){if(e.name.startsWith('.')||e.isSymbolicLink())continue;const r=rel?rel+'/'+e.name:e.name;if(e.isDirectory())walk(r,depth+1);else if(/\.md$/i.test(e.name))found.push(r);}};walk('',0);return found.sort((a,b)=>a.localeCompare(b)).map(r=>({name:r.slice(0,-3),path:folder+'/'+r,body:this.read(folder+'/'+r).raw}));}
 bases(){const found=[],walk=(dir,depth)=>{if(depth>6||found.length>500)return;let entries;try{entries=fs.readdirSync(path.join(this.root,dir),{withFileTypes:true});}catch{return;}for(const e of entries){if(e.name.startsWith('.')||e.isSymbolicLink()||e.name==='node_modules')continue;const p=dir?dir+'/'+e.name:e.name;if(e.isDirectory())walk(p,depth+1);else if(/\.base$/i.test(e.name))found.push(p);}};walk('',0);return found.sort();}
 dailyPath(date){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw Error('Invalid date');
  const config=this.settings().daily,format=config.format||'YYYY-MM-DD',name=formatDate(new Date(date+'T12:00:00Z'),format).replace(/[:*?"<>|]/g,'-');
  const folder=String(config.folder||'').replace(/^\/+|\/+$/g,'');
  return {relative:(folder?folder+'/':'')+name+'.md',config,name};
 }
 daily(date){
  const {relative,config,name}=this.dailyPath(date);
  try{return this.read(relative);}catch(e){if(e.message!=='Vault file not found.')throw e;}
  let body='# '+date+'\n';
  if(config.template){try{body=renderTemplate(this.read(config.template.replace(/\.md$/i,'')+'.md').raw,{date:new Date(date+'T12:00:00Z'),title:path.posix.basename(name),...this.templateFormats()});}catch{}}
  return this.write({path:relative,body});
 }
}
