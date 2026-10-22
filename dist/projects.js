import {Atlas} from './graph.js';
export function initProjects(){
 const button=document.createElement('button');button.textContent='⌘ Code graph';document.querySelector('.workspace-switcher').append(button);
 const dialog=document.createElement('dialog');dialog.className='workspace-dialog project-dialog';
 dialog.innerHTML='<div class="spot-head"><span>INDEPENDENT PROJECT GRAPH</span><button id="project-close">×</button></div><div class="workspace-content"><p>Parse JavaScript, TypeScript, JSX, Markdown and package dependencies directly. Source code is never executed. No Graphify installation or cloud API required.</p><form id="project-form"><label>Project folder on this computer<input id="project-directory" required placeholder="C:\\Projects\\my-project"></label><button>Scan project</button></form><p id="project-status" role="status">Choose a project folder. Hidden files, dependency folders and large files are excluded.</p><label>Find symbols or files<input id="project-search" placeholder="Filter the code graph"></label><div class="project-map"><canvas id="project-canvas" aria-label="Directed project dependency graph"></canvas></div><div class="workspace-row"><button id="project-fit">Fit graph</button><a href="/api/project/export" download>Export graph JSON</a></div><div id="project-results"></div><pre id="project-source"></pre></div>';
 dialog.querySelector('.workspace-content > p').textContent='Parse JavaScript, TypeScript, Python and 28 additional syntax formats including C/C++, C#, Go, Java, Rust, Ruby, PHP, Kotlin and Swift. Markdown links and package dependencies are included. Additional languages provide syntax evidence, not guessed call targets. Source code is never executed; Python requires Python 3. No Graphify or cloud API required. Changes are watched locally.';
 document.body.append(dialog);let graph,timer,searchTimer,lastShown,selected=null,focus='',request=0,routeStart=null;
 const $=s=>dialog.querySelector(s);
 const controls=document.createElement('div');controls.className='workspace-row';
 controls.innerHTML='<button id="project-focus" disabled>Explore connections</button><button id="project-impact" disabled>Who depends on this?</button><button id="project-route-start" disabled>Route from here</button><button id="project-route-end" disabled>Trace route here</button><button id="project-overview">All symbols</button><a href="/api/project/export?format=graphml" download>Export GraphML</a><span id="project-visible" role="status"></span>';
 $('#project-results').before(controls);
 const save=document.createElement('button');save.textContent='Save to knowledge library';controls.append(save);
 save.onclick=async()=>{save.disabled=true;try{const r=await fetch('/api/project/save',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),data=await r.json();if(!r.ok)throw Error(data.error);$('#project-status').textContent=`Saved ${data.nodes.toLocaleString()} native symbols and ${data.edges.toLocaleString()} relationships. Open Knowledge to explore this snapshot alongside imported graphs.`;}catch(e){$('#project-status').textContent=e.message;}finally{save.disabled=false;}};
 const relations=document.createElement('div');relations.id='project-relations';$('#project-source').before(relations);
 const get=async(route)=>{const r=await fetch('/api/project/'+route);const result=await r.json();if(!r.ok)throw Error(result.error||'Request failed');return result;};
 async function source(id){
  selected=id;graph?.select(id);for(const control of ['#project-focus','#project-impact','#project-route-start'])$(control).disabled=false;$('#project-route-end').disabled=!routeStart;
  try{
   const [n,r]=await Promise.all([get('source?'+new URLSearchParams({id})),get('relations?'+new URLSearchParams({id}))]);if(selected!==id)return;
   $('#project-source').textContent=`${n.path}:${n.line} · ${n.kind}\nIndexed SHA-256: ${n.hash}\n\n${n.body}`;
   relations.replaceChildren();
   for(const [direction,label] of [['incoming','Incoming'],['outgoing','Outgoing']]){
    const section=document.createElement('section'),heading=document.createElement('h3');heading.textContent=`${label} · ${r[direction+'Total']}`;section.append(heading);relations.append(section);
    for(const e of r[direction]){const b=document.createElement('button');b.textContent=`${direction==='incoming'?'←':'→'} ${e.type} · ${e.node.title} · ${e.node.path}:${e.node.line}`;b.onclick=()=>{focus=e.node.id;show().then(()=>source(e.node.id)).catch(error=>$('#project-source').textContent=error.message);};section.append(b);}
   }
  }catch(e){if(selected===id)$('#project-source').textContent=e.message;}
 }
 async function show(){
  const ticket=++request,data=await get('graph?'+new URLSearchParams({q:$('#project-search').value,focus}));if(ticket!==request)return;
  render(data);
 }
 function render(data){
  graph||=new Atlas($('#project-canvas'),{select:source,expand:id=>{focus=id;show().then(()=>source(id)).catch(e=>$('#project-source').textContent=e.message);}});graph.setData(data);
  graph.refresh();$('#project-visible').textContent=`${data.nodes.length} of ${data.totalNodes} symbols shown${focus?' · focused connections':''}`;
  $('#project-results').replaceChildren();
  for(const n of data.nodes.slice(0,60)){const b=document.createElement('button');b.textContent=`${n.title} · ${n.kind} · ${n.path}:${n.line}`;b.onclick=()=>{graph.select(n.id);source(n.id);};$('#project-results').append(b);}
 }
 async function poll(){
  try{const s=await get('status');$('#project-status').textContent=s.phase==='complete'?`${s.files} files · ${s.nodes} symbols · ${s.edges} directed links · ${s.resolvedCalls} resolved calls · ${s.unresolvedCalls} dynamic/external calls · ${s.reused} unchanged files reused · ${s.issues.length} parsing issues · ${s.unresolved} unresolved imports/links`:`${s.phase}: ${s.error||`${s.files||0} files`}`;
   if(s.phase==='complete'){if(lastShown!==s.completed){await show();lastShown=s.completed;if(s.issues.length)$('#project-source').textContent=s.issues.map(i=>`${i.path}: ${i.error}`).join('\n');}$('#project-status').textContent+=s.watching?' · watching for changes':` · watch unavailable: ${s.watchError||'rescan manually'}`;if(dialog.open)timer=setTimeout(poll,3000);}
   else if(s.phase==='extracting'&&dialog.open)timer=setTimeout(poll,1000);
  }catch(e){$('#project-status').textContent=e.message;}
 }
 button.onclick=()=>{dialog.showModal();poll();};
 $('#project-close').onclick=()=>dialog.close();dialog.onclose=()=>{clearTimeout(timer);clearTimeout(searchTimer);request++;};
 $('#project-form').onsubmit=async e=>{e.preventDefault();clearTimeout(timer);try{const r=await fetch('/api/project/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({directory:$('#project-directory').value})});const result=await r.json();if(!r.ok)throw Error(result.error);poll();}catch(error){$('#project-status').textContent=error.message;}};
 $('#project-search').oninput=()=>{focus='';clearTimeout(searchTimer);searchTimer=setTimeout(()=>show().catch(e=>$('#project-status').textContent=e.message),250);};
 $('#project-focus').onclick=()=>{focus=selected;show().catch(e=>$('#project-status').textContent=e.message);};
 $('#project-overview').onclick=()=>{focus='';$('#project-search').value='';show().catch(e=>$('#project-status').textContent=e.message);};
 $('#project-impact').onclick=async()=>{try{const ticket=++request,data=await get('impact?'+new URLSearchParams({focus:selected}));if(ticket!==request)return;render(data);$('#project-visible').textContent=`${data.nodes.length-1} upstream dependents within ${data.depth} steps${data.limited?' · display limit reached':''}`;}catch(e){$('#project-status').textContent=e.message;}};
 $('#project-route-start').onclick=()=>{routeStart=selected;$('#project-route-end').disabled=false;$('#project-visible').textContent='Route start saved. Select another symbol, then Trace route here.';};
 $('#project-route-end').onclick=async()=>{try{const ticket=++request,data=await get('path?'+new URLSearchParams({from:routeStart,to:selected}));if(ticket!==request)return;if(data.path.length)render(data);$('#project-visible').textContent=data.path.length?`${data.path.length-1} directed steps · follows calls, imports and document links`:data.limited?'Search limit reached; narrow the project.':'No directed call/import/link route connects these symbols.';}catch(e){$('#project-status').textContent=e.message;}};
 $('#project-fit').onclick=()=>graph?.fit();
}
