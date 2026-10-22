export function initOrganizer({el,api,post,graph,openDoc}){
 const button=el('button','▦ Organize'),dialog=el('dialog',undefined,'workspace-dialog organizer-dialog');
 document.querySelector('.workspace-switcher').prepend(button);document.body.append(dialog);
 const head=el('div',undefined,'spot-head'),close=el('button','Close organizer');close.onclick=()=>dialog.close();head.append(el('span','A PLACE FOR EVERYTHING'),close);
 const content=el('div',undefined,'workspace-content'),cards=el('div',undefined,'collection-grid'),feedback=el('p',undefined,'workspace-note');
 content.append(el('h2','Organized without moving a single file.'),el('p','Smart collections update from your index whenever you open them. One document can belong in several places; the original stays exactly where it is.'),cards);
 const form=el('form',undefined,'collection-form'),name=el('input'),query=el('input'),scope=el('select'),save=el('button','Create smart collection');
 name.placeholder='Collection name';name.setAttribute('aria-label','Smart collection name');name.required=true;name.maxLength=80;
 query.placeholder='Keywords, e.g. invoices or marketing';query.setAttribute('aria-label','Smart collection keywords');query.maxLength=200;
 for(const [value,text] of [['records','Source records'],['generated','Generated knowledge'],['archive','Historical material']]){const o=el('option',text);o.value=value;scope.append(o);}scope.setAttribute('aria-label','Smart collection source');
 form.append(name,query,scope,save);content.append(el('h3','Make your own automatic collection'),form,feedback);
 const storage=el('section'),scan=el('button','Check duplicates & compression opportunities','primary'),scanResult=el('div');
 storage.append(el('h3','Storage intelligence'),el('p','Exact duplicate checks and measured compression estimates. Nothing is deleted or moved. Compressed downloads are copies—not space already reclaimed.'),scan,scanResult);content.append(storage);
 dialog.append(head,content);
 const format=n=>n>=1073741824?(n/1073741824).toFixed(2)+' GiB':n>=1048576?(n/1048576).toFixed(1)+' MiB':(n/1024).toFixed(1)+' KiB';
 async function load(){
  cards.replaceChildren(el('p','Reading your collections…'));
  try{const all=await api('collections');cards.replaceChildren(...all.map(c=>{const card=el('button',undefined,'collection-card');card.append(el('strong',c.name),el('span',c.count.toLocaleString()+' documents'),el('small',c.description));card.onclick=async()=>{try{card.disabled=true;const collection=await api('collection',{id:c.id});graph.timelineMode=false;graph.setData(collection);document.querySelector('#graph-info').textContent=`${collection.name} · ${collection.nodes.length} of ${collection.total.toLocaleString()} documents`;document.querySelector('#results-title').textContent=collection.name.toUpperCase();document.querySelector('#search').value='';document.body.classList.add('searching');document.querySelector('#results').replaceChildren(...collection.nodes.slice(0,80).map(d=>{const b=el('button',undefined,'result');b.append(el('strong',d.title),el('small',d.folder));b.onclick=()=>openDoc(d.id);return b;}));dialog.close();}catch(e){feedback.textContent=e.message;}finally{card.disabled=false;}};return card;}));}catch(e){cards.textContent=e.message;}
 }
 form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{await post('collections',{name:name.value,query:query.value,scope:scope.value});feedback.textContent='Saved. This collection will update from matching indexed documents automatically.';name.value='';query.value='';await load();}catch(error){feedback.textContent=error.message;}finally{save.disabled=false;}};
 async function download(ids,target){
  target.disabled=true;const old=target.textContent;target.textContent='Compressing indexed copies…';
  try{const r=await fetch('/api/archive',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids})});if(!r.ok)throw Error((await r.json()).error);const blob=await r.blob(),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='adamantium-selected-documents.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);feedback.textContent=`Compressed copy downloaded (${format(blob.size)}). Original files remain unchanged.`;}catch(e){feedback.textContent=e.message;}finally{target.disabled=false;target.textContent=old;}
 }
 function renderStorage(r){
  scanResult.replaceChildren(el('p',`${r.duplicateGroups.toLocaleString()} exact-duplicate groups · ${r.duplicateCopies.toLocaleString()} extra copies · ${format(r.duplicateBytes)} of repeated indexed text`),el('p',r.notice));
  for(const g of r.duplicates.slice(0,10)){const details=el('details',undefined,'duplicate-group');details.append(el('summary',`${g.copies} identical copies · ${format((g.copies-1)*g.bytes)} repeated · ${g.documents[0].title}`));for(const d of g.documents){const b=el('button',d.path,'result');b.onclick=()=>{dialog.close();openDoc(d.id);};details.append(b);}scanResult.append(details);}
  scanResult.append(el('h3','Large historical/generated documents'));
  for(const d of r.compressionCandidates.slice(0,10)){const row=el('div',undefined,'storage-candidate');row.append(el('strong',d.title),el('small',`${format(d.bytes)} indexed text → ${format(d.gzipBytes)} measured gzip copy`));const inspect=el('button','Read original');inspect.onclick=()=>{dialog.close();openDoc(d.id);};const zip=el('button','Download compressed ZIP copy');zip.onclick=()=>download([d.id],zip);row.append(inspect,zip);scanResult.append(row);}
 }
 async function poll(){
  try{const job=await api('organization/status');if(job.phase==='complete'){renderStorage(job.result);scan.disabled=false;return;}if(job.phase==='error')throw Error(job.error);scanResult.textContent=`Comparing exact document contents${job.scanned?' · '+job.scanned.toLocaleString()+' checked':''}…`;if(dialog.open)setTimeout(poll,1500);else scan.disabled=false;}catch(e){scanResult.textContent=e.message;scan.disabled=false;}
 }
 scan.onclick=async()=>{scan.disabled=true;try{await post('organization/scan',{});await poll();}catch(e){scanResult.textContent=e.message;scan.disabled=false;}};
 button.onclick=async()=>{dialog.showModal();await load();const job=await api('organization/status');if(job.phase==='complete')renderStorage(job.result);else if(job.phase!=='idle')poll();};
}
