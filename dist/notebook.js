export function initNotebook({currentDocument,renderMarkdown,openPath}){
 const launch=document.createElement('button');launch.textContent='✎ Notebook';document.querySelector('.workspace-switcher').append(launch);
 const dialog=document.createElement('dialog');dialog.className='workspace-dialog notebook-dialog';
 dialog.innerHTML=`<div class="spot-head"><span>NOTEBOOK · YOUR WRITING</span><button data-close aria-label="Close notebook">×</button></div><div class="workspace-content">
 <p data-mode>Write here. With vault writing on, notes are saved as real Markdown files in your vault and every earlier version is kept privately. Otherwise they live in Adamantium’s private storage and your vault is never touched.</p>
 <div class="workspace-row"><button data-new>New note</button><button data-daily>Today’s note</button><button data-edit>Edit this file</button><button data-copy>Edit a copy of open vault document</button><label>Template<select data-template><option value="blank">Blank</option><option value="decision">Decision</option><option value="meeting">Meeting</option><option value="research">Research</option></select></label></div>
 <div class="notebook-layout"><aside><label>Search your notes<input data-search placeholder="Find your writing"></label><div data-list></div><div class="workspace-row"><button data-prev>Previous</button><button data-next>Next</button></div></aside>
 <section><div class="workspace-row"><label>Vault folder for new notes<input data-folder placeholder="Notebook" maxlength="200"></label><label>Vault file (relative)<input data-path placeholder="Notebook/My note.md"></label><button data-vault-save>Save to vault</button></div><label>Note title<input data-title maxlength="200" placeholder="Give this note a title"></label><label>Markdown<textarea data-body rows="18" spellcheck="true" placeholder="Write your note…"></textarea></label><details open><summary>Properties</summary><div data-props></div><button data-add-prop>Add property</button></details>
 <div class="workspace-row"><button data-save>Save private revision</button><a data-export hidden download>Download Markdown</a><label>Saved revisions<select data-history><option value="">No saved revisions</option></select></label><button data-restore disabled>Restore selected revision</button></div><p data-status role="status">New unsaved note.</p></section></div></div>`;
 document.body.append(dialog);const $=s=>dialog.querySelector(s);let vaultHash=null,note=null,dirty=false,offset=0,timer,request=0,busy=false,hasNext=false,writable=false,pathTouched=false;
 $('[data-history]').setAttribute('aria-label','Saved revisions');$('[data-template]').setAttribute('aria-label','Template');
 try{$('[data-folder]').value=localStorage.getItem('adamantium-notebook-folder')||'Notebook';}catch{$('[data-folder]').value='Notebook';}
 const previewButton=document.createElement('button');previewButton.textContent='Reading preview';const preview=document.createElement('div');preview.className='notebook-preview';preview.hidden=true;$('[data-body]').parentElement.after(previewButton,preview);
 previewButton.onclick=()=>{preview.hidden=!preview.hidden;previewButton.textContent=preview.hidden?'Reading preview':'Close preview';if(!preview.hidden){const text=$('[data-body]').value;preview.replaceChildren(renderMarkdown({body:text.slice(0,100000),renderBody:text.slice(0,100000),path:$('[data-path]').value,properties:{},connections:[]}));if(text.length>100000){const warning=document.createElement('p');warning.textContent='Preview limited to the first 100,000 characters; the complete note is saved and exported.';preview.prepend(warning);}}};
 const templates={blank:'',decision:'# Decision\n\n## Context\n\n## Options\n\n## Decision and rationale\n\n## Evidence\n\n## Next steps\n\n- [ ] ',meeting:'# Meeting\n\n## Attendees\n\n## Agenda\n\n## Notes\n\n## Decisions\n\n## Action items\n\n- [ ] ',research:'# Research\n\n## Question\n\n## Sources\n\n## Findings\n\n## Uncertainty\n\n## Next steps\n'};
 const status=text=>$('[data-status]').textContent=text;
 // ----- typed properties editor -----
 const TYPES=['text','number','checkbox','date','list','json'];
 const typeOf=v=>Array.isArray(v)?'list':typeof v==='boolean'?'checkbox':typeof v==='number'?'number':v&&typeof v==='object'?'json':/^\d{4}-\d{2}-\d{2}$/.test(String(v))?'date':'text';
 function propRow(key='',value='',type=typeOf(value)){
  const row=document.createElement('div');row.className='workspace-row property-editor-row';row.dataset.row='1';
  const k=document.createElement('input');k.placeholder='name';k.value=key;k.setAttribute('aria-label','Property name');
  const t=document.createElement('select');t.setAttribute('aria-label','Property type');for(const name of TYPES){const o=document.createElement('option');o.value=name;o.textContent=name;t.append(o);}t.value=type;
  const holder=document.createElement('span');const remove=document.createElement('button');remove.textContent='Remove';remove.setAttribute('aria-label','Remove property');
  let control;
  const build=(kind,current)=>{
   if(kind==='checkbox'){control=document.createElement('input');control.type='checkbox';control.checked=current===true||current==='true';}
   else if(kind==='number'){control=document.createElement('input');control.type='number';control.step='any';control.value=current===''||current==null?'':String(current);}
   else if(kind==='date'){control=document.createElement('input');control.type='date';control.value=/^\d{4}-\d{2}-\d{2}$/.test(String(current))?current:'';}
   else if(kind==='list'){control=document.createElement('textarea');control.rows=2;control.placeholder='one item per line';control.value=Array.isArray(current)?current.join('\n'):String(current??'');}
   else if(kind==='json'){control=document.createElement('textarea');control.rows=2;control.value=typeof current==='string'?current:JSON.stringify(current??{});}
   else{control=document.createElement('input');control.value=current==null?'':String(current);}
   control.setAttribute('aria-label','Property value');control.oninput=control.onchange=()=>{dirty=true;status('Unsaved changes.');};holder.replaceChildren(control);
  };
  build(type,value);t.onchange=()=>{const old=read();build(t.value,t.value==='list'&&old.value!==''&&!Array.isArray(old.value)?String(old.value):old.value);dirty=true;};
  remove.onclick=()=>{row.remove();dirty=true;status('Unsaved changes.');};
  function read(){
   const kind=t.value;let value;
   if(kind==='checkbox')value=control.checked;
   else if(kind==='number'){value=control.value.trim()===''?'':Number(control.value);if(value!==''&&!Number.isFinite(value))throw Error('“'+k.value+'” needs a number.');}
   else if(kind==='list')value=control.value.split('\n').map(s=>s.trim()).filter(Boolean);
   else if(kind==='json'){try{value=JSON.parse(control.value||'null');}catch{throw Error('“'+k.value+'” needs valid JSON.');}}
   else value=control.value;
   return {key:k.value.trim(),value};
  }
  row.read=read;row.append(k,t,holder,remove);k.oninput=()=>{dirty=true;};return row;
 }
 const getProps=()=>{const out=Object.create(null);for(const row of $('[data-props]').querySelectorAll('[data-row]')){const {key,value}=row.read();if(!key)continue;if(key in out)throw Error('Property “'+key+'” appears twice.');out[key]=value;}return {...out};};
 const setProps=(object={})=>{$('[data-props]').replaceChildren(...Object.entries(object).map(([k,v])=>propRow(k,v)));};
 $('[data-add-prop]').onclick=()=>{$('[data-props]').append(propRow());dirty=true;};
 const leave=()=>!dirty||window.confirm('Discard the unsaved changes in this editor? Saved revisions are kept.');
 async function api(action,input){const r=await fetch('/api/notebook'+action,input?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:{}),data=await r.json();if(!r.ok)throw Error(data.error||'Notebook request failed.');return data;}
 async function vaultApi(action,input){const r=await fetch('/api/workspace/'+action,input?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:{});const data=await r.json();if(!r.ok)throw Error(data.error);return data;}
 async function listing(){const ticket=++request,rows=await api('?'+new URLSearchParams({q:$('[data-search]').value,offset}));if(ticket!==request)return;hasNext=rows.length===80;$('[data-list]').replaceChildren();for(const row of rows){const b=document.createElement('button');b.textContent=row.title;b.onclick=()=>run(async()=>{if(leave())await display(await api('/note?'+new URLSearchParams({id:row.id})));});$('[data-list]').append(b);}$('[data-prev]').disabled=!offset;$('[data-next]').disabled=!hasNext;}
 const suggestPath=()=>{if(pathTouched||vaultHash)return;const title=$('[data-title]').value.trim().replace(/[\\/:*?"<>|]+/g,'-').slice(0,120),folder=$('[data-folder]').value.trim().replace(/^\/+|\/+$/g,'');$('[data-path]').value=title?(folder?folder+'/':'')+title+'.md':'';};
 async function display(value){vaultHash=null;pathTouched=false;$('[data-path]').value='';note=value;dirty=false;$('[data-title]').value=value?.title||'';$('[data-body]').value=value?.body||templates[$('[data-template]').value]||'';setProps(value?.properties||{});$('[data-export]').hidden=!value;$('[data-export]').href=value?'/api/notebook/export?'+new URLSearchParams({id:value.id}):'';$('[data-history]').replaceChildren();$('[data-restore]').disabled=!value;
  preview.hidden=true;previewButton.textContent='Reading preview';if(value){for(const row of await api('/history?'+new URLSearchParams({id:value.id}))){const option=document.createElement('option');option.value=row.revision;option.textContent=`Revision ${row.revision} · ${new Date(row.updated).toLocaleString()}`;$('[data-history]').append(option);}status(`Saved privately · revision ${value.revision}. Vault unchanged.`);}else status('New unsaved note.');
 }
 async function run(fn){if(busy)return;busy=true;for(const b of dialog.querySelectorAll('button,input,textarea,select'))b.disabled=true;try{await fn();}catch(e){status(e.message);}finally{busy=false;for(const b of dialog.querySelectorAll('button,input,textarea,select'))b.disabled=false;$('[data-restore]').disabled=!note;$('[data-prev]').disabled=!offset;$('[data-next]').disabled=!hasNext;$('[data-vault-save]').disabled=!writable;}}
 for(const name of ['title','body'])$(`[data-${name}]`).oninput=()=>{dirty=true;preview.hidden=true;previewButton.textContent='Reading preview';status('Unsaved changes. Save to keep them.');if(name==='title')suggestPath();};
 $('[data-folder]').oninput=()=>{try{localStorage.setItem('adamantium-notebook-folder',$('[data-folder]').value);}catch{/* the folder simply is not remembered */}suggestPath();};
 $('[data-edit]').onclick=()=>run(async()=>{if(!leave())return;const d=currentDocument();if(!d)throw Error('Open a document first.');const file=await vaultApi('file?'+new URLSearchParams({path:d.path}));await display(null);$('[data-path]').value=file.path;pathTouched=true;vaultHash=file.sha256;$('[data-title]').value=file.path.split('/').pop().replace(/\.md$/i,'');$('[data-body]').value=file.body;setProps(file.properties);status('Editing '+file.path+(writable?'':' (vault writing is off: start Adamantium with ADAMANTIUM_VAULT_WRITE=1 to save).'));});
 $('[data-vault-save]').onclick=()=>run(async()=>{
  const path=$('[data-path]').value.trim()||(suggestPath(),$('[data-path]').value.trim());if(!path)throw Error('Give the note a title or a vault file name first.');
  const r=await vaultApi('save',{path,expectedHash:vaultHash,body:$('[data-body]').value,properties:getProps()});vaultHash=r.sha256;pathTouched=true;$('[data-path]').value=r.path;dirty=false;status('Saved '+r.path+' to your vault · SHA-256 '+r.sha256.slice(0,16)+'… · it will be searchable within seconds.');
 });
 $('[data-path]').oninput=()=>{vaultHash=null;pathTouched=true;dirty=true;};
 vaultApi('settings').then(s=>{writable=!!s.writable;$('[data-vault-save]').disabled=!writable;$('[data-vault-save]').title=writable?'Write this note as a Markdown file in your vault':'Vault writing is off. Start Adamantium with ADAMANTIUM_VAULT_WRITE=1.';if(!writable)$('[data-mode]').textContent='Vault writing is OFF: notes live in Adamantium’s private storage and your vault is never touched. Start Adamantium with ADAMANTIUM_VAULT_WRITE=1 to write real Markdown files.';}).catch(e=>status(e.message));
 vaultApi('templates').then(rows=>{for(const row of rows){templates[row.path]=row.body;const option=document.createElement('option');option.value=row.path;option.textContent=row.name+' (vault)';$('[data-template]').append(option);}}).catch(e=>status(e.message));
 $('[data-template]').onchange=()=>run(async()=>{const value=$('[data-template]').value;if(dirty&&$('[data-body]').value.trim())return;if(value in templates&&!value.includes('/')){$('[data-body]').value=templates[value];return;}const rendered=await vaultApi('template?'+new URLSearchParams({path:value,title:$('[data-title]').value}));$('[data-body]').value=rendered.body;});
 $('[data-save]').onclick=()=>run(async()=>{await display(await api('/save',{id:note?.id,revision:note?.revision,title:$('[data-title]').value,body:$('[data-body]').value,properties:getProps()}));await listing();});
 $('[data-new]').onclick=()=>run(async()=>{if(!leave())return;await display(null);const value=$('[data-template]').value;if(value.includes('/')){const rendered=await vaultApi('template?'+new URLSearchParams({path:value,title:''}));$('[data-body]').value=rendered.body;}});
 $('[data-daily]').onclick=()=>run(async()=>{if(!leave())return;const d=new Date(),date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;const settings=await vaultApi('settings');if(settings.writable){const result=await vaultApi('daily',{date});const file=await vaultApi('file?'+new URLSearchParams({path:result.path}));await display(null);$('[data-path]').value=file.path;pathTouched=true;vaultHash=file.sha256;$('[data-title]').value=file.path.split('/').pop().replace(/\.md$/i,'');$('[data-body]').value=file.body;setProps(file.properties);status('Daily note: '+file.path);}else{await display(await api('/daily',{date}));await listing();}});
 $('[data-copy]').onclick=()=>run(async()=>{if(!leave())return;const source=currentDocument();if(!source)throw Error('Open a vault document first, then choose Edit a copy.');await display(await api('/copy',{documentId:source.id}));await listing();});
 $('[data-restore]').onclick=()=>run(async()=>{if(!note||!leave())return;await display(await api('/restore',{id:note.id,revision:note.revision,fromRevision:Number($('[data-history]').value)}));await listing();});
 $('[data-search]').oninput=()=>{clearTimeout(timer);offset=0;timer=setTimeout(()=>listing().catch(e=>status(e.message)),180);};
 $('[data-prev]').onclick=()=>{offset=Math.max(0,offset-80);listing().catch(e=>status(e.message));};$('[data-next]').onclick=()=>{offset+=80;listing().catch(e=>status(e.message));};
 $('[data-close]').onclick=()=>dialog.close();dialog.oncancel=e=>{if(busy)e.preventDefault();};
 window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
 launch.onclick=()=>{dialog.showModal();listing().catch(e=>status(e.message));};
}
