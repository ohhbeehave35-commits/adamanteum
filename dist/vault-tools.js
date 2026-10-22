// Vault tools: tags, saved Bases tables, link health, "what changed since" and the JSON Canvas viewer.
export function initVaultTools({el,api,post,openDoc,currentDocument}){
 const button=el('button','Vault tools'),dialog=el('dialog');dialog.className='workspace-dialog';const content=el('div');dialog.append(content);document.body.append(dialog);document.querySelector('.workspace-switcher').append(button);
 const open=async path=>{try{const found=await api('workspace/resolve',{source:'',target:path});if(found){dialog.close();openDoc(found.id);}}catch{/* shown by the caller's status line */}};
 const pathButton=(path,label)=>{const b=el('button',label||path,'result');b.onclick=()=>open(path);return b;};
 const show=async(title,load)=>{content.replaceChildren(el('h2',title));const close=el('button','Close');close.onclick=()=>dialog.close();content.append(close);dialog.showModal();try{await load();}catch(e){content.append(el('p',e.message));}};
 const table=(columns,groups)=>{const out=el('div');for(const [group,rows] of Object.entries(groups)){if(Object.keys(groups).length>1||group!=='All')out.append(el('h3',group+' ('+rows.length+')'));const t=el('table'),head=el('tr');for(const col of columns)head.append(el('th',col));t.append(head);for(const row of rows){const tr=el('tr');columns.forEach((col,i)=>{const value=row[col],td=el('td');const text=Array.isArray(value)?value.join(', '):value===undefined||value===null?'':typeof value==='object'?JSON.stringify(value):String(value);if(i===0){const link=el('button',text||row.__path,'inline-link');link.onclick=()=>open(row.__path);td.append(link);}else td.textContent=text;tr.append(td);});t.append(tr);}out.append(t);}return out;};
 const baseEditor=async(existing)=>{
  const form=el('div');
  const field=(label,value,placeholder)=>{const l=el('label',label),i=el('input');i.value=value||'';if(placeholder)i.placeholder=placeholder;l.append(i);form.append(l);return i;};
  const area=(label,value,placeholder)=>{const l=el('label',label),i=el('textarea');i.rows=3;i.value=value||'';if(placeholder)i.placeholder=placeholder;l.append(i);form.append(l);return i;};
  const props=await api('workspace/properties').catch(()=>[]);
  if(props.length)form.append(el('p','Properties in this vault: '+props.slice(0,25).map(p=>p.name+' ('+p.count+')').join(', ')));
  const filters=area('Filters (one per line, all must match)', existing?.filters?.join('\n')||'', 'status == "draft"\nfile.hasTag("hub")');
  const columns=field('Columns (comma separated)', existing?.columns?.join(', ')||'file.name, status','file.name, status, file.mtime');
  const sort=field('Sort by',existing?.sort||'file.name'),dir=el('select');for(const d of ['ASC','DESC']){const o=el('option',d);o.value=d;dir.append(o);}form.append(el('label','Direction',dir));
  const group=field('Group by (optional)',existing?.group||''),name=field('View name',existing?.name||'Table'),path=field('Save as vault file',existing?.path||'Views/My table.base');
  const output=el('div'),run=el('button','Show table'),save=el('button','Save .base file');
  const config=()=>({filters:filters.value.split('\n').map(s=>s.trim()).filter(Boolean),columns:columns.value.split(',').map(s=>s.trim()).filter(Boolean),sort:sort.value?[{property:sort.value.trim(),direction:dir.value}]:[],group:group.value.trim()?{property:group.value.trim(),direction:'ASC'}:null,name:name.value.trim()||'Table'});
  const preview=async()=>{try{const c=config(),result=await api('workspace/base',{config:JSON.stringify({filters:c.filters.length?{and:c.filters}:null,views:[{type:'table',name:c.name,order:c.columns,sort:c.sort,groupBy:c.group}]})});output.replaceChildren(el('p',result.total+' notes'),table(result.columns,result.groups));}catch(e){output.replaceChildren(el('p',e.message));}};
  run.onclick=preview;
  save.onclick=async()=>{try{const receipt=await post('workspace/base-save',{path:path.value,config:config(),expectedHash:null});output.replaceChildren(el('p','Saved '+receipt.path+' · SHA-256 '+receipt.sha256));}catch(e){output.replaceChildren(el('p',e.message));}};
  form.append(run,save,output);return form;
 };
 const sections={
  'Tags':async()=>{const rows=await api('workspace/tags');content.append(el('p',rows.length+' tags. Choose one to filter the vault.'));for(const r of rows.slice(0,300)){const b=el('button',r.tag+' ('+r.count+')');b.onclick=()=>{document.querySelector('#search').value='tag:'+r.tag;document.querySelector('#search').dispatchEvent(new Event('input'));dialog.close();};content.append(b);}},
  'Bases (tables)':async()=>{
   const files=await api('workspace/bases');
   const openBase=async(file,view)=>{try{
    const result=await api('workspace/base',{file,view:String(view),offset:'0'});
    const box=el('div');box.append(table(result.columns,result.groups));let shown=result.shown;
    const bar=el('div');for(let i=0;i<result.views.length;i++){const v=el('button',result.views[i],i===result.view?'result active':'result');v.setAttribute('aria-pressed',String(i===result.view));v.onclick=()=>openBase(file,i);bar.append(v);}
    const count=el('p',''),more=el('button','');const refresh=()=>{count.textContent=result.total+' notes (showing '+shown+')';more.hidden=shown>=result.total;more.textContent='Show the next '+Math.min(500,result.total-shown)+' notes';};
    more.onclick=async()=>{more.disabled=true;try{const next=await api('workspace/base',{file,view:String(view),offset:String(shown)});box.append(table(next.columns,next.groups));shown+=next.shown;refresh();}catch(e){count.textContent=e.message;}more.disabled=false;};
    refresh();output.replaceChildren(el('h3',file+' · '+result.name),count,bar,box,more);
   }catch(e){output.replaceChildren(el('p',e.message));}};
   content.append(el('h3','Saved in your vault'));
   if(!files.length)content.append(el('p','No .base files yet. Build one below.'));
   const output=el('div');
   for(const file of files){const b=el('button',file,'result');b.onclick=()=>openBase(file,0);content.append(b);}
   content.append(output,el('h3','Build a table view'),await baseEditor());
  },
  'Link health':async()=>{
   const out=el('p','Checking every link…');content.append(out);const r=await api('workspace/health');
   out.textContent=`${r.summary.notes.toLocaleString()} notes · ${r.summary.broken.toLocaleString()} broken links · ${r.summary.orphans.toLocaleString()} notes nobody links to · ${r.summary.duplicates.toLocaleString()} duplicate names`;
   content.append(el('h3','Broken links (first '+r.broken.length+')'));for(const x of r.broken.slice(0,200)){content.append(pathButton(x.source,x.source+' → [['+x.target+']]'));}
   content.append(el('h3','Notes nobody links to (first '+r.orphans.length+')'));for(const p of r.orphans.slice(0,200))content.append(pathButton(p));
   content.append(el('h3','Duplicate names'));for(const group of r.duplicates.slice(0,100))content.append(el('p',group.join('  ·  ')));
  },
  'What changed since':async()=>{
   const input=el('input');input.type='date';input.value=new Date(Date.now()-7*864e5).toISOString().slice(0,10);const go=el('button','Show changes'),out=el('div');content.append(el('label','Since',input),go,out);
   const run=async()=>{const r=await api('workspace/changes',{since:input.value+'T00:00:00Z'});out.replaceChildren(el('p',`${r.total.toLocaleString()} notes changed since ${input.value}${r.total>r.shown?' (newest '+r.shown+' shown)':''}`),...r.files.map(f=>pathButton(f.path,f.when.slice(0,16).replace('T',' ')+'  '+f.path)));};
   go.onclick=()=>run().catch(e=>out.replaceChildren(el('p',e.message)));await run();
  },
  'Properties':async()=>{const rows=await api('workspace/properties');content.append(el('p','Search a property with name:value, for example status:draft.'));for(const r of rows){const b=el('button',r.name+' · '+r.types+' · '+r.count);b.onclick=()=>{document.querySelector('#search').value=r.name+':';document.querySelector('#search').focus();dialog.close();};content.append(b);}},
  'Code and notes':async()=>{
   content.append(el('p','Needs a project scanned in Code graph. Shows the code files the open note mentions, and the notes that mention a code file.'));
   const source=el('pre'),current=currentDocument?.();
   if(current){content.append(el('h3','Code mentioned in "'+current.title+'"'));try{const r=await api('vault/code-links',{path:current.path});if(!r.files.length)content.append(el('p','No scanned code file is named in this note.'));for(const f of r.files){const b=el('button',f.path+':'+f.line,'result');b.onclick=async()=>{try{const n=await api('project/source',{id:f.id});source.textContent=n.path+':'+n.line+'\n\n'+n.body;}catch(e){source.textContent=e.message;}};content.append(b);}}catch(e){content.append(el('p',e.message));}}
   else content.append(el('p','Open a note first to see the code it mentions.'));
   content.append(source,el('h3','Notes that mention a code file'));
   const input=el('input');input.placeholder='app/main.py';const go=el('button','Find notes'),out=el('div');content.append(input,go,out);
   go.onclick=async()=>{try{const r=await api('vault/notes-for-code',{file:input.value});out.replaceChildren(el('p',r.notes.length+' notes mention '+r.file),...r.notes.map(n=>pathButton(n.path,n.title+' · '+n.path)));}catch(e){out.replaceChildren(el('p',e.message));}};
  },
  'Bookmarks':async()=>{
   const file=await api('workspace/bookmarks'),mine=JSON.parse(file.body||'[]'),theirs=file.obsidian||[];
   content.append(el('p',`${mine.length} bookmarks saved in your vault (Adamantium-bookmarks.json). Obsidian has ${theirs.length} of its own.`));
   const importer=el('button','Import Obsidian bookmarks');importer.disabled=!theirs.length;
   importer.onclick=async()=>{try{const known=new Set(mine.map(m=>m.path)),merged=[...mine,...theirs.filter(t=>!known.has(t.path)).map(t=>({path:t.path,title:t.title}))];const receipt=await post('workspace/save',{path:'Adamantium-bookmarks.json',body:JSON.stringify(merged,null,2),expectedHash:file.sha256});importer.textContent='Imported · '+merged.length+' bookmarks · SHA-256 '+receipt.sha256.slice(0,12);importer.disabled=true;}catch(e){importer.textContent=e.message;}};
   content.append(importer);for(const m of mine)content.append(pathButton(m.path,m.title||m.path));
  }
 };
 button.onclick=()=>show('Vault tools',async()=>{for(const [label,action] of Object.entries(sections)){const b=el('button',label);b.onclick=()=>{content.replaceChildren(el('h2',label));const close=el('button','Close');close.onclick=()=>dialog.close();const back=el('button','All tools');back.onclick=()=>button.onclick();content.append(back,close);action().catch(e=>content.append(el('p',e.message)));};content.append(b);}});
}
const COLORS={'1':'#fb464c','2':'#e9973f','3':'#e0de71','4':'#44cf6e','5':'#53dfdd','6':'#a882ff'};
export function renderCanvas(canvas,{el,api,openFile,readingView,save}){
 const root=el('div');root.className='canvas-view';root.style.cssText='position:relative;overflow:hidden;height:600px;touch-action:none';
 const nodes=(canvas.nodes||[]).filter(n=>Number.isFinite(n.x)&&Number.isFinite(n.y)),edges=canvas.edges||[];
 if(nodes.length>2000||edges.length>10000)return el('p','Canvas exceeds display budget');
 const boardWidth=()=>Math.max(800,...nodes.map(n=>n.x+(n.width||200)),0)-Math.min(0,...nodes.map(n=>n.x));
 const boardHeight=()=>Math.max(600,...nodes.map(n=>n.y+(n.height||100)),0)-Math.min(0,...nodes.map(n=>n.y));
 const board=el('div');board.style.cssText='position:absolute;left:0;top:0;transform-origin:0 0';root.append(board);
 const svgNS='http://www.w3.org/2000/svg',svg=document.createElementNS(svgNS,'svg');svg.style.cssText='position:absolute;left:0;top:0;pointer-events:none;overflow:visible';board.append(svg);
 const color=c=>c?(COLORS[c]||(/^#[0-9a-f]{3,8}$/i.test(c)?c:'currentColor')):'currentColor';
 let minX=0,minY=0,selected=null,connecting=null,editing=false,dirty=false;
 const byId=()=>new Map(nodes.map(n=>[n.id,n]));
 const anchor=(n,side)=>{const w=n.width||200,h=n.height||100,x=n.x-minX,y=n.y-minY;return side==='top'?[x+w/2,y]:side==='bottom'?[x+w/2,y+h]:side==='left'?[x,y+h/2]:side==='right'?[x+w,y+h/2]:[x+w/2,y+h/2];};
 function drawEdges(){
  svg.replaceChildren();const defs=document.createElementNS(svgNS,'defs');svg.append(defs);const made=new Set(),map=byId();
  const arrow=c=>{const id='arrow-'+String(c).replace(/[^\w]/g,'');if(!made.has(id)){made.add(id);const m=document.createElementNS(svgNS,'marker');for(const [k,v] of Object.entries({id,viewBox:'0 0 10 10',refX:'9',refY:'5',markerWidth:'8',markerHeight:'8',orient:'auto-start-reverse'}))m.setAttribute(k,v);const p=document.createElementNS(svgNS,'path');p.setAttribute('d','M0 0 10 5 0 10z');p.setAttribute('fill',c);m.append(p);defs.append(m);}return 'url(#'+id+')';};
  for(const edge of edges){const a=map.get(edge.fromNode),b=map.get(edge.toNode);if(!a||!b)continue;
   const [x1,y1]=anchor(a,edge.fromSide),[x2,y2]=anchor(b,edge.toSide),stroke=color(edge.color);
   const line=document.createElementNS(svgNS,'line');for(const [k,v] of Object.entries({x1,y1,x2,y2,stroke,'stroke-width':'2'}))line.setAttribute(k,v);
   if(edge.toEnd!=='none')line.setAttribute('marker-end',arrow(stroke));if(edge.fromEnd==='arrow')line.setAttribute('marker-start',arrow(stroke));svg.append(line);
   if(typeof edge.label==='string'&&edge.label){const t=document.createElementNS(svgNS,'text');t.setAttribute('x',(x1+x2)/2);t.setAttribute('y',(y1+y2)/2);t.setAttribute('fill','currentColor');t.setAttribute('text-anchor','middle');t.textContent=edge.label;svg.append(t);}}
 }
 function cardFor(n){
  const w=n.width||200,h=n.height||100,stroke=color(n.color);let card;
  if(n.type==='file'){
   card=el('div');const title=el('button',(n.file||'').split('/').pop());title.title=n.file;title.onclick=()=>{if(!editing)openFile(n.file+(n.subpath||''));};card.append(title);
   if(/\.(png|jpe?g|gif|webp|svg)$/i.test(n.file||'')){const img=el('img');img.alt=n.file;img.style.cssText='max-width:100%;max-height:'+(h-40)+'px';img.src='/api/workspace/asset?'+new URLSearchParams({path:n.file});card.append(img);}
   else if(api&&readingView)api('workspace/resolve',{source:'',target:n.file}).then(f=>f?api('doc',{id:f.id}):null).then(note=>{if(note)card.append(readingView({...note,properties:{},tags:[],renderBody:(note.renderBody||'').slice(0,1500)},1));}).catch(()=>{});
  }else if(n.type==='link'){card=el('div');const a=el('a',n.url||'');if(/^https?:\/\//i.test(n.url||'')){a.href=n.url;a.target='_blank';a.rel='noopener noreferrer';}card.append(a);}
  else if(n.type==='group'){card=el('div',n.label||'');card.style.fontWeight='600';}
  else{card=readingView?readingView({path:'',properties:{},tags:[],connections:[],renderBody:n.text||''},1):el('div',n.text||'');}
  card.dataset.id=n.id;
  card.style.cssText+=`;position:absolute;overflow:auto;border:${n.type==='group'?'2px dashed':'1px solid'} ${selected===n.id?'#fff':stroke};border-radius:6px;padding:8px;box-sizing:border-box;left:${n.x-minX}px;top:${n.y-minY}px;width:${w}px;height:${h}px;${n.type==='group'?'z-index:0'+(editing?'':';pointer-events:none'):'z-index:1'}`;
  if(editing){const h=el('span');h.dataset.handle=n.id;h.title='Drag to resize';h.style.cssText='position:absolute;right:0;bottom:0;width:14px;height:14px;cursor:nwse-resize;background:currentColor;opacity:.5;border-radius:3px 0 6px 0';card.append(h);}
  return card;
 }
 function draw(){
  minX=Math.min(0,...nodes.map(n=>n.x));minY=Math.min(0,...nodes.map(n=>n.y));
  const w=boardWidth(),h=boardHeight();board.style.width=w+'px';board.style.height=h+'px';svg.setAttribute('width',w);svg.setAttribute('height',h);
  for(const old of [...board.querySelectorAll('[data-id]')])old.remove();
  drawEdges();for(const n of nodes)board.append(cardFor(n));
  statusLine.textContent=editing?(connecting?'Click the card to connect to…':selected?'Selected: '+selected:'Editing: drag cards, double-click a text card to change it.'):'';
 }
 // Pan and zoom
 let scale=1,tx=0,ty=0;const apply=()=>{board.style.transform=`translate(${tx}px,${ty}px) scale(${scale})`;};
 let drag=null,move=null;
 root.onpointerdown=e=>{
  const handle=e.target.closest('[data-handle]');
  if(editing&&handle){const n=byId().get(handle.dataset.handle);if(n){selected=n.id;move={id:n.id,sx:e.clientX,sy:e.clientY,ow:n.width||200,oh:n.height||100,resize:true,moved:false};root.setPointerCapture(e.pointerId);}return;}
  const card=e.target.closest('[data-id]');
  if(editing&&card&&!e.target.closest('a,input,textarea')){
   const id=card.dataset.id;
   if(connecting){const from=connecting;connecting=null;if(from!==id&&!edges.some(x=>x.fromNode===from&&x.toNode===id)){edges.push({id:'e'+Date.now().toString(36),fromNode:from,toNode:id});dirty=true;}draw();return;}
   selected=id;const n=byId().get(id);move={id,sx:e.clientX,sy:e.clientY,ox:n.x,oy:n.y,moved:false};root.setPointerCapture(e.pointerId);draw();return;
  }
  if(e.target.closest('button,a,input,textarea'))return;
  drag={x:e.clientX-tx,y:e.clientY-ty};root.setPointerCapture(e.pointerId);
 };
 root.onpointermove=e=>{
  if(move?.resize){const n=byId().get(move.id);n.width=Math.max(60,Math.round(move.ow+(e.clientX-move.sx)/scale));n.height=Math.max(40,Math.round(move.oh+(e.clientY-move.sy)/scale));move.moved=true;const card=board.querySelector(`[data-id="${CSS.escape(move.id)}"]`);if(card){card.style.width=n.width+'px';card.style.height=n.height+'px';}drawEdges();return;}
  if(move){const n=byId().get(move.id);n.x=Math.round(move.ox+(e.clientX-move.sx)/scale);n.y=Math.round(move.oy+(e.clientY-move.sy)/scale);move.moved=true;const card=board.querySelector(`[data-id="${CSS.escape(move.id)}"]`);if(card){card.style.left=(n.x-minX)+'px';card.style.top=(n.y-minY)+'px';}drawEdges();return;}
  if(!drag)return;tx=e.clientX-drag.x;ty=e.clientY-drag.y;apply();
 };
 root.onpointerup=()=>{if(move?.moved){dirty=true;statusLine.textContent='Unsaved changes.';}move=null;drag=null;};
 root.onwheel=e=>{e.preventDefault();scale=Math.max(.2,Math.min(3,scale*(e.deltaY<0?1.1:1/1.1)));apply();};
 const controls=el('div');controls.style.cssText='position:absolute;right:8px;top:8px;z-index:5;display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;max-width:70%';
 const statusLine=el('span','');statusLine.style.cssText='position:absolute;left:8px;bottom:6px;z-index:5;font-size:12px';
 for(const [label,fn] of [['+',()=>{scale=Math.min(3,scale*1.2);apply();}],['−',()=>{scale=Math.max(.2,scale/1.2);apply();}],['Fit',()=>{scale=Math.min(1,root.clientWidth/boardWidth());tx=0;ty=0;apply();}]]){const b=el('button',label);b.onclick=fn;controls.append(b);}
 if(save){
  const toggle=el('button','Edit canvas'),add=el('button','Add text card'),link=el('button','Connect cards'),del=el('button','Delete card'),store=el('button','Save canvas');
  for(const b of [add,link,del,store])b.hidden=true;
  toggle.onclick=()=>{editing=!editing;toggle.textContent=editing?'Stop editing':'Edit canvas';for(const b of [add,link,del,store])b.hidden=!editing;connecting=null;draw();};
  add.onclick=()=>{const n={id:'t'+Date.now().toString(36),type:'text',text:'New card',x:Math.round((-tx+40)/scale)+minX,y:Math.round((-ty+40)/scale)+minY,width:240,height:100};nodes.push(n);canvas.nodes=nodes;selected=n.id;dirty=true;draw();};
  link.onclick=()=>{if(!selected){statusLine.textContent='Select the starting card first.';return;}connecting=selected;draw();};
  del.onclick=()=>{if(!selected)return;const i=nodes.findIndex(n=>n.id===selected);if(i>=0)nodes.splice(i,1);for(let k=edges.length-1;k>=0;k--)if(edges[k].fromNode===selected||edges[k].toNode===selected)edges.splice(k,1);canvas.nodes=nodes;canvas.edges=edges;selected=null;dirty=true;draw();};
  store.onclick=async()=>{try{canvas.nodes=nodes;canvas.edges=edges;await save(JSON.stringify(canvas,null,2));dirty=false;statusLine.textContent='Saved to your vault.';}catch(e){statusLine.textContent=e.message;}};
  root.ondblclick=e=>{const card=e.target.closest('[data-id]');if(!editing||!card)return;const n=byId().get(card.dataset.id);if(!n||n.type!=='text')return;const next=window.prompt('Card text (Markdown)',n.text||'');if(next!==null){n.text=next;dirty=true;draw();}};
  controls.append(toggle,add,link,del,store);
 }
 root.append(controls,statusLine);draw();
 return root;
}
