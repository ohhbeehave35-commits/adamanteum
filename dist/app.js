import {initVaultTools,renderCanvas} from './vault-tools.js';
import {Atlas} from './graph.js';
import {analyzeGraph,graphML} from './analysis.js';
import {initOrganizer} from './organizer.js';
import {initNotebook} from './notebook.js';
import {createReader} from './reader.js';
const $=s=>document.querySelector(s);
const state={scope:'records',folder:'',focus:0,theme:localStorage.getItem('adamantium-interface')||'nebula'};
const api=async(path,params={})=>{const r=await fetch('/api/'+path+'?'+new URLSearchParams(params));if(!r.ok)throw Error(`Vault service: ${r.status}`);return r.json();};
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const graph=new Atlas($('#graph'),{select:openDoc,expand:id=>{state.focus=id;loadGraph();}});
const restore=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))||fallback;}catch{return fallback;}};
let saved=restore('adamantium-saved',[]),visited=restore('adamantium-visited',[]),docHistory=[],historyAt=-1,currentDoc=null;
let bookmarksHash=null;api('workspace/bookmarks').then(file=>{saved=JSON.parse(file.body);bookmarksHash=file.sha256;}).catch(()=>{});
const historyButtons=()=>{$('#back-doc').disabled=historyAt<=0;$('#forward-doc').disabled=historyAt>=docHistory.length-1;};
function documentOpened(d,fromHistory){
 currentDoc=d;
 document.body.classList.add('has-document');
 if(!fromHistory&&docHistory[historyAt]!==d.id){docHistory=docHistory.slice(0,historyAt+1);docHistory.push(d.id);historyAt=docHistory.length-1;}
 historyButtons();
 visited=[{id:d.id,title:d.title,folder:d.folder},...visited.filter(n=>n.id!==d.id)].slice(0,30);
 localStorage.setItem('adamantium-visited',JSON.stringify(visited));
 const pin=el('button',saved.some(n=>n.id===d.id)?'★ Saved':'☆ Save this place','save-document');
 pin.onclick=async()=>{try{const has=saved.some(n=>n.id===d.id),next=has?saved.filter(n=>n.id!==d.id):[{id:d.id,path:d.path,title:d.title,folder:d.folder},...saved];const receipt=await post('workspace/save',{path:'Adamantium-bookmarks.json',body:JSON.stringify(next,null,2),expectedHash:bookmarksHash});saved=next;bookmarksHash=receipt.sha256;pin.textContent=has?'Save this place':'Saved';}catch(e){pin.textContent=e.message;}};
 $('#document').insertBefore(pin,$('#document .primary'));
 const analysis=el('details',undefined,'outline');analysis.append(el('summary','Knowledge tools · provenance and connections'));
 if(d.provenance){const provenance=el('p',`Source: ${d.provenance.source_file||d.path}${d.provenance.location?' · '+d.provenance.location:''}\nContent SHA-256: ${d.provenance.sha256}`,'doc-path');analysis.append(provenance);}
 const impact=el('button','Explore 2-hop neighborhood');impact.onclick=async()=>{try{impact.disabled=true;const result=await api('impact',{id:d.id,depth:2});graph.timelineMode=false;graph.setData(result);$('#graph-info').textContent=`${result.nodes.length} documents within 2 hops${result.truncated?' · bounded to 300 documents':''}`;graph.pulse(result.nodes.slice(0,20).map(n=>n.id));}catch(e){impact.textContent=e.message;}finally{impact.disabled=false;}};analysis.append(impact);
 const destinations=saved.filter(n=>n.id!==d.id);if(destinations.length){const select=el('select');select.setAttribute('aria-label','Find connection to saved document');for(const n of destinations){const option=el('option',n.title);option.value=n.id;select.append(option);}const pathButton=el('button','Find connection path');pathButton.onclick=async()=>{try{pathButton.disabled=true;const result=await api('path',{from:d.id,to:select.value});if(!result.path.length){pathButton.textContent=result.bounded?'No path within 5,000 visited nodes':'No connected path';return;}graph.timelineMode=false;graph.setData(result);$('#graph-info').textContent=`Connection path · ${result.path.length} documents · actual source links`;graph.pulse(result.path);}catch(e){pathButton.textContent=e.message;}finally{pathButton.disabled=false;}};analysis.append(select,pathButton);}
 $('#document').append(analysis);
 const readingRoot=$('#document > .reading'),headings=readingRoot?[...readingRoot.querySelectorAll('h2,h3,h4')]:[];
 if(headings.length>0){const outline=el('details',undefined,'outline');outline.append(el('summary','In this document · '+headings.length+' sections'));for(const [index,heading] of headings.entries()){const b=el('button',heading.textContent);b.onclick=()=>readingRoot?.querySelectorAll('h2,h3,h4')[index]?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});outline.append(b);}$('#document').insertBefore(outline,readingRoot);}
}
let graphRequest=0,searchRequest=0;
function theme(name){if(!['nebula','ember','aurora','ivory','terminal'].includes(name))name='nebula';state.theme=name;document.body.dataset.theme=name;localStorage.setItem('adamantium-interface',name);document.querySelectorAll('nav button').forEach(b=>{b.classList.toggle('active',b.dataset.theme===name);b.setAttribute('aria-pressed',b.dataset.theme===name);});graph.refresh();}
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>theme(b.dataset.theme));theme(state.theme);
async function loadGraph(){const request=++graphRequest;try{const data=await api('graph',{...state,limit:$('#density').value});if(request!==graphRequest)return;graph.timelineMode=false;timeMap.textContent='Map: connections';graph.setData(data);$('#graph-info').textContent=`${data.nodes.length.toLocaleString()} documents · ${data.edges.length.toLocaleString()} real links${state.focus?' · neighborhood':state.folder?' · '+state.folder:' · strongest connections'}`;$('#legend').replaceChildren(...graph.groups.slice(0,7).map((g,i)=>{const n=el('span',g);n.style.setProperty('--dot',graph.colors[i%graph.colors.length]);return n;}));}catch(e){$('#graph-info').textContent=e.message;}}
async function groups(){const data=await api('groups',state);$('#groups').replaceChildren(...data.map(g=>{const b=el('button',undefined,'group');b.append(el('span',g.folder),el('small',g.count.toLocaleString()));b.onclick=()=>{state.folder=g.folder;state.focus=0;document.querySelectorAll('.group').forEach(n=>n.classList.remove('selected'));b.classList.add('selected');loadGraph();search();};return b;}));}
async function search(offset=0){if(!Number.isSafeInteger(offset))offset=0;const request=++searchRequest;try{const q=$('#search').value;const rows=await api('search',{...state,q,offset});if(request!==searchRequest)return;$('#results-title').textContent=q?`SEARCH · ${offset+1}–${offset+rows.length}${rows.length===80?'+':''}`:'RECENT DOCUMENTS';$('#results').replaceChildren(...rows.map(d=>{const b=el('button',undefined,'result');b.append(el('strong',d.title),el('small',d.path+' · '+d.degree+' links'));b.onclick=()=>openDoc(d.id);return b;}));if(!rows.length){$('#results-title').textContent=q?'SEARCH · END OF RESULTS':'RECENT DOCUMENTS';$('#results').append(el('p',offset?'No more results.':'No matching documents. Try fewer words.'));}const paging=el('div',undefined,'workspace-row');if(offset){const previous=el('button','← Previous 80');previous.onclick=()=>search(Math.max(0,offset-80));paging.append(previous);}if(rows.length===80){const next=el('button','Next 80 →');next.onclick=()=>search(offset+80);paging.append(next);}$('#results').append(paging);}catch(e){$('#results').textContent=e.message;}}
let selectedRequest=0;
let vaultWritable=false;fetch('/api/workspace/settings').then(r=>r.json()).then(s=>{vaultWritable=!!s.writable;}).catch(()=>{});
const reader=createReader({el,api,openDoc:(id,fromHistory,anchor)=>openDoc(id,fromHistory,anchor),filterTag:tag=>{$('#search').value='tag:'+tag;$('#search').dispatchEvent(new Event('input'));}});
function readingView(d){
 if(d.path?.endsWith('.canvas')){try{return renderCanvas(d.body.trim()?JSON.parse(d.body):{nodes:[],edges:[]},{el,api,readingView:reader.view,save:vaultWritable?async json=>{const file=await api('workspace/file',{path:d.path});await post('workspace/save',{path:d.path,body:json,expectedHash:file.sha256});}:null,openFile:async target=>{const found=await api('workspace/resolve',{source:d.path,target});if(found)openDoc(found.id);}});}catch(e){return el('p',e.message);}}
 return reader.view(d);
}
async function openDoc(id,fromHistory=false,anchor=null){const request=++selectedRequest;try{const d=await api('doc',{id});if(request!==selectedRequest)return;graph.select(id);const title=el('h2',d.title),meta=el('p',d.path,'doc-path'),date=el('small',new Date(d.mtime).toLocaleString()+' · '+(d.bytes/1024).toFixed(1)+' KB'),expand=el('button','Explore connections ↗','primary');let body=readingView(d);const source=el('button','View original Markdown','source-toggle');let raw=false;source.onclick=()=>{raw=!raw;const next=raw?el('pre',d.body,'doc-body'):readingView(d);body.replaceWith(next);body=next;source.textContent=raw?'Reading view':'View original Markdown';const outline=$('#document .outline');if(outline)outline.hidden=raw;};expand.onclick=()=>{state.focus=id;loadGraph();};const links=el('div',undefined,'connections');links.append(el('h3',`${d.degree} connections`));for(const c of d.connections){const b=el('button',(c.outgoing?'↗ ':'↙ ')+c.title);b.onclick=()=>openDoc(c.id);links.append(b);}$('#document').replaceChildren(title,meta,date,expand,source,body,links);documentOpened(d,fromHistory);if(anchor)body.scrollToAnchor?.(anchor);}catch(e){$('#document').textContent=e.message;}}
let timer;$('#search').oninput=()=>{document.body.classList.toggle('searching',!!$('#search').value.trim());clearTimeout(timer);timer=setTimeout(search,180);};
$('#scope').onchange=()=>{state.scope=$('#scope').value;state.folder='';state.focus=0;groups();search();loadGraph();};
$('#all').onclick=()=>{state.folder='';state.focus=0;groups();search();loadGraph();};
$('#overview').onclick=()=>{state.focus=0;loadGraph();};
$('#density').onchange=loadGraph;
$('#fit').onclick=()=>graph.fit();$('#plus').onclick=()=>graph.zoom(1.3);$('#minus').onclick=()=>graph.zoom(1/1.3);
$('#close-doc').onclick=()=>{selectedRequest++;currentDoc=null;$('#document').replaceChildren(el('h2','Follow a connection.'),el('p','Select any document to read its original text.'));graph.select(0);document.body.classList.remove('reader-focus','has-document');};
$('#back-doc').onclick=()=>{if(historyAt>0)openDoc(docHistory[--historyAt],true);};
$('#forward-doc').onclick=()=>{if(historyAt<docHistory.length-1)openDoc(docHistory[++historyAt],true);};
$('#reader-mode').onclick=()=>{document.body.classList.remove('graph-focus');document.body.classList.toggle('reader-focus');};
function showPlaces(items,label){const area=$('#places-list');if(area.dataset.label===label&&!area.hidden){area.hidden=true;return;}area.dataset.label=label;area.hidden=false;area.replaceChildren(el('div',label,'section-title'),...items.map(d=>{const b=el('button',d.title,'result');b.onclick=()=>openDoc(d.id);return b;}));if(!items.length)area.append(el('p',label==='SAVED PLACES'?'Open a document and choose “Save this place”.':'Documents you open will appear here.'));}
$('#saved-places').onclick=()=>showPlaces(saved,'SAVED PLACES');$('#recent-places').onclick=()=>showPlaces(visited,'RECENTLY VISITED');
const tools=el('div',undefined,'atlas-tools'),full=el('button','⛶ Expand atlas'),labels=el('button','Labels: auto'),edges=el('button','Links: on'),exportGraph=el('button','↓ Export graph');
full.onclick=()=>{document.body.classList.remove('reader-focus');const expanded=document.body.classList.toggle('graph-focus');full.textContent=expanded?'⤢ Restore panels':'⛶ Expand atlas';};
labels.onclick=()=>{graph.hideLabels=!graph.hideLabels;labels.textContent=graph.hideLabels?'Labels: off':'Labels: auto';graph.refresh();};
edges.onclick=()=>{graph.hideEdges=!graph.hideEdges;edges.textContent=graph.hideEdges?'Links: off':'Links: on';graph.refresh();};
exportGraph.onclick=()=>{$('#graph').toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='Adamantium-vault-graph.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});};
const rendering=el('button','View: constellation');rendering.onclick=()=>{graph.structural=!graph.structural;rendering.textContent=graph.structural?'View: structure':'View: constellation';graph.refresh();};
const cellView=el('button','◉ Cell view');const shapeButtons=()=>{cellView.textContent=graph.cellular?'◉ Exit cell view':'◉ Cell view';};cellView.title='Arrange real notes inside a cell-shaped membrane; the most connected notes form its nucleus.';cellView.onclick=()=>{graph.cell();shapeButtons();timeMap.textContent='Map: connections';};
const timeMap=el('button','Map: connections');timeMap.onclick=()=>{if(!graph.nodes.length)return;graph.timeline();shapeButtons();timeMap.textContent=graph.timelineMode?'Map: modified time':'Map: connections';};
const animate=el('button','▶ Animate'),motionPreference=matchMedia('(prefers-reduced-motion: reduce)');
const syncAnimation=()=>{animate.disabled=motionPreference.matches;animate.textContent=graph.animating?'■ Stop animation':'▶ Animate';animate.setAttribute('aria-pressed',String(!!graph.animating));animate.title=motionPreference.matches?'Animation is disabled by your reduced-motion preference.':'Illustrative source-to-target motion on existing links, not live data traffic. Nodes stay still. Pauses when links are hidden or the time map is open.';};
animate.onclick=()=>{graph.animate(!graph.animating);syncAnimation();};motionPreference.addEventListener('change',()=>{if(motionPreference.matches)graph.animate(false);syncAnimation();});syncAnimation();
tools.append(full,cellView,timeMap,rendering,labels,edges,exportGraph,animate);$('.atlas').append(tools);
const analyze=el('button','◎ Analyze'),analysisDialog=el('dialog',undefined,'workspace-dialog');
analysisDialog.setAttribute('aria-label','Graph analysis');document.body.append(analysisDialog);tools.append(analyze);
analyze.onclick=()=>{
 const nodes=graph.nodes.map(({id,title,path,folder,category,degree,mtime,bytes})=>({id,title,path,folder,category,degree,mtime,bytes})),links=graph.edges.map(e=>({source:e.a.id,target:e.b.id}));
 const result=analyzeGraph(nodes,links),head=el('div',undefined,'spot-head'),close=el('button','Close analysis');close.onclick=()=>analysisDialog.close();head.append(el('span','UNDERSTAND THIS MAP'),close);
 const content=el('div',undefined,'workspace-content');content.append(el('h2',`${result.nodes} documents. ${result.edges} real links.`),el('p',`${result.communities.length} structural communities · ${result.components.length} connected components · ${result.isolated.length} isolated documents`),el('p','Analysis applies to this selected map, not the entire vault. Communities are calculated from link structure; they are not AI-inferred facts.'));
 const downloads=el('div',undefined,'workspace-row');
 for(const [label,filename,type,body] of [['Download JSON','adamantium-graph.json','application/json',JSON.stringify({schema:'adamantium.graph/v1',source:'selected source-backed map',nodes,edges:links,analysis:result},null,2)],['Download GraphML','adamantium-graph.graphml','application/graphml+xml',graphML(nodes,links)]]){
  const button=el('button',label);button.onclick=()=>{const url=URL.createObjectURL(new Blob([body],{type})),a=el('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};downloads.append(button);
 }
 content.append(downloads,el('h3','Key documents · directed PageRank'));
 const entire=el('button','Analyze my entire vault','primary'),entireResult=el('div');content.insertBefore(entire,downloads);content.insertBefore(entireResult,downloads);
 entire.onclick=async()=>{
  entire.disabled=true;
  try{
   await post('analysis/start',{});
   const poll=async()=>{
    try{
     const job=await api('analysis/status');
     entireResult.replaceChildren(el('p','Whole-vault analysis: '+job.phase));
     if(job.phase==='error'){entireResult.append(el('p',job.error));entire.disabled=false;return;}
     if(job.phase!=='complete'){if(analysisDialog.open)setTimeout(poll,1000);else entire.disabled=false;return;}
     const r=job.result;entireResult.replaceChildren(el('h3','Your entire indexed vault'),el('p',`${r.documents.toLocaleString()} documents · ${r.links.toLocaleString()} real links · ${r.components.toLocaleString()} components · ${r.isolated.toLocaleString()} isolated documents`));
     entireResult.append(el('p','Exact components and directed PageRank across all indexed documents, calculated in a background worker. No AI inference or source changes.'));
     for(const n of r.ranked.slice(0,10)){const b=el('button',n.title+' · '+n.connections+' links','result');b.onclick=()=>{analysisDialog.close();openDoc(n.id);};entireResult.append(b);}
     const download=el('button','Download whole-vault analysis');download.onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(r,null,2)],{type:'application/json'})),a=el('a');a.href=url;a.download='adamantium-whole-vault-analysis.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};entireResult.append(download);entire.disabled=false;
    }catch(error){entireResult.textContent=error.message;entire.disabled=false;}
   };await poll();
  }catch(error){entireResult.textContent=error.message;entire.disabled=false;}
 };
 for(const n of result.ranked.slice(0,12)){const button=el('button',`${n.title} · ${n.connections} connections`,'result');button.onclick=()=>{analysisDialog.close();openDoc(n.id);};content.append(button);}
 content.append(el('h3','Explore a structural community'));
 for(const [i,community] of result.communities.slice(0,16).entries()){const button=el('button',`Community ${i+1} · ${community.length} documents`,'result');button.onclick=()=>{const selected=new Set(community);graph.setData({nodes:nodes.filter(n=>selected.has(n.id)),edges:links.filter(e=>selected.has(e.source)&&selected.has(e.target))});$('#graph-info').textContent=`Structural community ${i+1} · ${community.length} documents`;analysisDialog.close();};content.append(button);}
 analysisDialog.replaceChildren(head,content);analysisDialog.showModal();
};
let spotRequest=0,spotIndex=-1,spotRows=[];
const spot=$('#spotlight'),spotInput=$('#spot-query');
function openSpot(){spot.showModal();spotInput.focus();}
$('#quick-open').onclick=openSpot;$('#spot-close').onclick=()=>spot.close();
async function quickSearch(){const request=++spotRequest,q=spotInput.value.trim();if(!q){$('#spot-results').replaceChildren(el('p','Search source records, exports, and archives together.'));return;}$('#spot-results').replaceChildren(el('p','Searching…'));try{const batches=await Promise.all(['records','generated','archive'].map(scope=>api('search',{q,scope})));if(request!==spotRequest)return;spotRows=batches.flat().slice(0,90);spotIndex=-1;$('#spot-results').replaceChildren(...spotRows.map(d=>{const b=el('button',undefined,'spot-result');b.append(el('strong',d.title),el('small',d.category+' / '+d.path));b.onclick=()=>{spot.close();document.body.classList.remove('graph-focus');openDoc(d.id);};return b;}));if(!spotRows.length)$('#spot-results').append(el('p','No matching documents.'));}catch(e){$('#spot-results').textContent=e.message;}}
let spotTimer;spotInput.oninput=()=>{clearTimeout(spotTimer);spotTimer=setTimeout(quickSearch,180);};
spotInput.onkeydown=e=>{const buttons=[...$('#spot-results').querySelectorAll('button')];if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();spotIndex=Math.max(0,Math.min(buttons.length-1,spotIndex+(e.key==='ArrowDown'?1:-1)));buttons.forEach((b,i)=>b.classList.toggle('spot-selected',i===spotIndex));buttons[spotIndex]?.scrollIntoView({block:'nearest'});}if(e.key==='Enter'&&buttons.length){e.preventDefault();buttons[Math.max(0,spotIndex)].click();}};
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(!spot.open)openSpot();}if(e.key==='Escape'){document.body.classList.remove('graph-focus','reader-focus');full.textContent='⛶ Expand atlas';}});
const activityStream=new EventSource('/api/activity');
activityStream.onopen=()=>{$('#activity-connection').textContent='● Connected';};
activityStream.onerror=()=>{$('#activity-connection').textContent='Reconnecting…';};
activityStream.onmessage=e=>{const event=JSON.parse(e.data);if(Date.now()-Date.parse(event.time)<5000)graph.pulse(event.nodes||[]);const row=el('div',undefined,'activity-row');row.append(el('small',new Date(event.time).toLocaleTimeString()+' · '+event.type),el('strong',event.label));if(event.nodes?.length){const view=el('button','Inspect '+event.nodes.length+' document'+(event.nodes.length===1?'':'s'));view.onclick=()=>{state.focus=event.nodes[0];loadGraph();openDoc(event.nodes[0]);};row.append(view);}$('#activity-events').prepend(row);while($('#activity-events').children.length>40)$('#activity-events').lastElementChild.remove();};
$('#activity-open').onclick=()=>{$('#activity-panel').hidden=!$('#activity-panel').hidden;};$('#activity-close').onclick=()=>{$('#activity-panel').hidden=true;};
let aiConnection=null,aiBusy=false,selectedKnowledge=null;
const knowledgeConsent=el('label'),knowledgeCheck=el('input'),knowledgeLabel=el('span','No knowledge entity selected.');knowledgeCheck.type='checkbox';knowledgeCheck.id='ai-knowledge';knowledgeConsent.append(knowledgeCheck,knowledgeLabel);knowledgeConsent.hidden=true;$('.context-choice').append(knowledgeConsent);
const post=async(route,input)=>{const response=await fetch('/api/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const data=await response.json();if(!response.ok)throw Error(data.error||'Request failed');return data;};
$('#assistant-connect').onclick=async()=>{if(aiBusy)return;aiBusy=true;$('#assistant-connect').disabled=true;$('#ai-status').textContent='Checking Assistant’s secure sign-in…';try{const result=await post('assistant/connect',{});window.location.assign(result.url);}catch(e){$('#ai-status').textContent=e.message;}finally{aiBusy=false;$('#assistant-connect').disabled=false;}};
api('assistant/status').then(s=>{if(s.connected){aiConnection={kind:'assistant',name:'Assistant'};$('#ai-send').disabled=false;$('#ai-disconnect').disabled=false;$('#ai-status').textContent='Assistant connected through your account · '+s.scope;$('#ai-config').open=false;}}).catch(()=>{});
function profile(){return {schema:'adamantium.ai/v1',name:$('#ai-name').value.trim(),model:$('#ai-model').value.trim(),endpoint:$('#ai-endpoint').value.trim()};}
$('#ai-open').onclick=()=>{$('#ai-context-label').textContent=currentDoc?`Selected: ${currentDoc.title}. Up to 10,000 characters will be sent only if checked.`:'No document selected. Context is off by default.';$('#ai-panel').showModal();};$('#ai-close').onclick=()=>$('#ai-panel').close();
async function loadCard(file){try{if(!file||file.size>20000)throw Error('Choose a JSON connection card under 20 KB.');const p=JSON.parse(await file.text());if(p.schema!=='adamantium.ai/v1'||p.command||p.script||p.apiKey||p.tools)throw Error('Use a safe adamantium.ai/v1 connection card without keys, commands, or tools.');$('#ai-name').value=String(p.name||'');$('#ai-model').value=String(p.model||'');$('#ai-endpoint').value=String(p.endpoint||'');$('#ai-status').textContent=`${p.name||'AI'} card loaded. Review the endpoint, then Connect AI. No vault text has been sent.`;}catch(e){$('#ai-status').textContent=e.message;}}
$('#ai-file').onchange=e=>loadCard(e.target.files[0]);$('#ai-drop').ondragover=e=>{e.preventDefault();$('#ai-drop').classList.add('dragging');};$('#ai-drop').ondragleave=()=>$('#ai-drop').classList.remove('dragging');$('#ai-drop').ondrop=e=>{e.preventDefault();$('#ai-drop').classList.remove('dragging');loadCard(e.dataTransfer.files[0]);};
$('#ai-card').onclick=()=>{const p=profile();if(!p.name||!p.model||!p.endpoint){$('#ai-status').textContent='Enter a name, model, and endpoint first.';return;}const url=URL.createObjectURL(new Blob([JSON.stringify(p,null,2)],{type:'application/json'})),a=el('a');a.href=url;a.download='adamantium-ai-connection.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('#ai-connect').onclick=async()=>{if(aiBusy)return;aiBusy=true;$('#ai-connect').disabled=true;$('#ai-status').textContent='Checking provider and model…';try{if(aiConnection)await post('ai/disconnect',{id:aiConnection.id});aiConnection=await post('ai/attach',{profile:profile(),key:$('#ai-key').value});$('#ai-key').value='';$('#ai-status').textContent=`${aiConnection.name} connected to ${new URL(aiConnection.endpoint).host}. Context is off until you approve it.`;$('#ai-send').disabled=false;$('#ai-disconnect').disabled=false;$('#ai-config').open=false;}catch(e){aiConnection=null;$('#ai-send').disabled=true;$('#ai-status').textContent=e.message;}finally{aiBusy=false;$('#ai-connect').disabled=false;}};
$('#ai-disconnect').onclick=async()=>{try{if(aiConnection)await post(aiConnection.kind==='assistant'?'assistant/disconnect':'ai/disconnect',{id:aiConnection.id});$('#ai-status').textContent='Disconnected. This computer no longer holds the connection credential.';}catch(e){$('#ai-status').textContent=e.message;}finally{aiConnection=null;$('#ai-key').value='';$('#ai-send').disabled=true;$('#ai-disconnect').disabled=true;}};
const {initImageSharing}=await import('./image-share.js');
const imageSharing=initImageSharing();
const {initProjects}=await import('./projects.js');initProjects();
const {initKnowledge}=await import('./knowledge.js');const knowledgeWorkspace=initKnowledge({connection:()=>aiConnection,currentDocument:()=>currentDoc,openDocument:openDoc,askAI:selection=>{selectedKnowledge=selection;knowledgeConsent.hidden=false;knowledgeCheck.checked=false;knowledgeLabel.textContent=`Send selected knowledge entity “${selection.title}” and up to eight evidence-linked relationships to my connected AI.`;$('#ai-context').checked=false;$('#ai-search').checked=false;$('#ai-open').click();$('#ai-message').value=`Explain ${selection.title}, its relationships, and any uncertainty in the evidence.`;}});
const directionKey=document.createElement('div');directionKey.className='direction-key';directionKey.textContent='Source → linked document · select to trace';document.querySelector('.atlas').append(directionKey);
$('#ai-form').onsubmit=async e=>{
 e.preventDefault();if(!aiConnection||aiBusy)return;
 const message=$('#ai-message').value.trim();if(!message)return;
 const context=$('#ai-context').checked&&currentDoc;aiBusy=true;$('#ai-send').disabled=true;
 const user=el('div',undefined,'chat-message user');user.append(el('small','YOU'),el('p',message));$('#ai-conversation').append(user);
 const reply=el('div','Waiting for your AI…','chat-message');$('#ai-conversation').append(reply);
 try{
  const result=await post(aiConnection.kind==='assistant'?'assistant/chat':'ai/chat',{connectionId:aiConnection.id,message,...imageSharing.payload(),documentIds:context?[currentDoc.id]:[],allowContext:!!context,knowledgeSelection:knowledgeCheck.checked?selectedKnowledge:null,allowKnowledge:knowledgeCheck.checked,allowSearch:$('#ai-search').checked,approvedUrls:$('#ai-urls').value.split('\n').map(s=>s.trim()).filter(Boolean)});
  reply.replaceChildren(el('small',result.ai),el('p',result.answer));
  for(const source of result.sources){const b=el('button','Source: '+source.title);b.onclick=()=>{$('#ai-panel').close();openDoc(source.id);};reply.append(b);}
  for(const source of result.knowledgeSources||[]){const b=el('button','Knowledge: '+source.title);b.onclick=()=>{$('#ai-panel').close();knowledgeWorkspace.open(source);};reply.append(b);}
  for(const source of result.webSources||[]){const a=el('a','Web source: '+source.title);a.href=source.url;a.target='_blank';a.rel='noopener noreferrer';reply.append(a);}
  if(result.trace?.length)reply.append(el('small',result.trace.map(t=>t.tool+': '+t.status).join(' · ')));
  $('#ai-message').value='';
  imageSharing.clear();
 }catch(err){reply.textContent='Request failed: '+err.message;}
 finally{aiBusy=false;knowledgeCheck.checked=false;$('#ai-send').disabled=!aiConnection;}
};
$('#browser-open').onclick=()=>$('#browser-panel').showModal();$('#browser-close').onclick=()=>$('#browser-panel').close();
$('#browser-form').onsubmit=e=>{e.preventDefault();try{const url=new URL($('#browser-url').value);if(url.protocol!=='https:'||url.username||url.password)throw Error('Use an HTTPS address without embedded credentials.');$('#browser-reading').hidden=true;$('#workspace-browser').hidden=false;$('#workspace-browser').src=url.href;$('#browser-external').href=url.href;}catch(err){$('#browser-url').setCustomValidity(err.message);$('#browser-url').reportValidity();}};
$('#browser-read').onclick=async()=>{const button=$('#browser-read');button.disabled=true;$('#browser-status').textContent='Reading public page…';try{const page=await post('browser/read',{url:$('#browser-url').value});$('#workspace-browser').hidden=true;$('#browser-reading').hidden=false;$('#browser-reading').replaceChildren(el('h2',page.title),el('p',page.text));$('#browser-status').textContent=`Read ${page.text.length.toLocaleString()} characters · ${page.mode}`;$('#browser-external').href=page.url;}catch(e){$('#browser-status').textContent=e.message;}finally{button.disabled=false;}};
$('#browser-ai').onclick=()=>{try{const url=new URL($('#browser-url').value);if(url.protocol!=='https:'||url.username||url.password||url.search)throw Error('Choose a public HTTPS page without credentials or query parameters.');url.hash='';$('#ai-urls').value=url.href;$('#browser-panel').close();$('#ai-open').click();$('#ai-message').value='Read this approved page and explain its key points: '+url.href;}catch(e){$('#browser-status').textContent=e.message;}};
$('#browser-url').oninput=()=>$('#browser-url').setCustomValidity('');
let previousPhase='',previousDocuments=0,previousGraph=false,previousCompleted='',indexPrefetched=false;
// Phone: ask the service worker to save the search index itself. On a first visit this page is not yet controlled by the worker, so a plain fetch from here would not be cached.
function saveOfflineIndex(){if(!('serviceWorker' in navigator))return;navigator.serviceWorker.ready.then(reg=>{if(reg.active)reg.active.postMessage({type:'save-offline-index'});}).catch(()=>{});}
async function status(){
 try{
  const s=await api('status');
  $('.library h1').replaceChildren(document.createTextNode(s.source||'Your vault'),el('span','.'));
  $('#status').textContent=s.phase==='ready'?`${s.documents.toLocaleString()} documents · ${s.links.toLocaleString()} links`:`${s.phase} · ${s.indexed.toLocaleString()} / ${(s.total||0).toLocaleString()} documents`;
  if(s.snapshot&&s.completed)$('#status').textContent+=` · snapshot ${new Date(s.completed).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}`;
  if(s.refresh&&s.refresh.phase!=='ready')$('#status').textContent+=s.refresh.phase==='error'?` · refresh failed: ${s.refresh.error}`:` · background ${s.refresh.phase}`;
  else if(s.watching)$('#status').textContent+=' · live updates';
  if(s.errors||s.skipped)$('#status').textContent+=` · ${s.errors} errors, ${s.skipped} skipped`;
  if(s.phase!==previousPhase||(!previousDocuments&&s.documents)||s.graphReady!==previousGraph||s.completed!==previousCompleted){groups();search();if(!previousCompleted||s.changed||s.removed)loadGraph();}
  previousPhase=s.phase;previousDocuments=s.documents;previousGraph=s.graphReady;previousCompleted=s.completed;
  if(s.phase==='ready'&&!indexPrefetched){indexPrefetched=true;saveOfflineIndex();}
 }catch(e){$('#status').textContent=e.message;}
 setTimeout(status,5000);
}
initOrganizer({el,api,post,graph,openDoc});
initVaultTools({el,api,post,openDoc,currentDocument:()=>currentDoc});
initNotebook({currentDocument:()=>currentDoc,renderMarkdown:readingView});
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js',{type:'module'}).catch(()=>{});
api('workspace/obsidian-import').then(report=>{
 if(!report?.hasObsidian||!report.text)return;
 try{if(localStorage.getItem('adamantium-obsidian-import-seen'))return;localStorage.setItem('adamantium-obsidian-import-seen','1');}catch{return;}
 const dialog=el('dialog');dialog.className='workspace-dialog';dialog.id='obsidian-import-report';
 const head=el('div',undefined,'spot-head');head.append(el('span','OBSIDIAN SETTINGS'),el('button','Close'));
 head.querySelector('button').onclick=()=>dialog.close();
 const content=el('div',undefined,'workspace-content');
 const body=el('pre',report.text);body.style.whiteSpace='pre-wrap';
 content.append(el('p','The same report as import-obsidian. Shown the first time this vault is opened.'),body);
 dialog.append(head,content);document.body.append(dialog);dialog.showModal();
}).catch(()=>{});
status();loadGraph();groups();search();
