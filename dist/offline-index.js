export const APP_SHELL=[
 '/','/index.html','/app.js','/graph.js','/projects.js','/arrows.js','/image-share.js',
 '/themes.css','/analysis.js','/organizer.js','/style.css','/manifest.webmanifest',
 '/knowledge.js','/notebook.js','/reader.js','/vault-tools.js','/cell.js','/flow.js',
 '/phone.css','/offline-index.js','/assets/adamantium-mark.svg'
];

function summary(doc){
 return {id:doc.id,path:doc.path,title:doc.title,folder:doc.folder,category:doc.category,degree:doc.degree||0,mtime:doc.mtime||0,bytes:doc.bytes||0};
}

export function searchIndex(docs,query){
 const list=Array.isArray(docs)?docs:[];
 const q=String(query||'').trim();
 if(!q)return list.slice().sort((a,b)=>(b.mtime||0)-(a.mtime||0)).slice(0,80).map(summary);
 const terms=q.toLowerCase().match(/-?(?:"[^"]+"|[^\s]+)/g)||[];
 return list.filter(doc=>{
  const hay=((doc.title||'')+' '+(doc.path||'')+' '+(doc.body||'')).toLowerCase();
  return terms.every(token=>{
   const negative=token.startsWith('-'),value=(negative?token.slice(1):token).replace(/^"|"$/g,'');
   if(!value)return true;
   const hit=hay.includes(value);
   return negative?!hit:hit;
  });
 }).slice(0,80).map(summary);
}

export function readIndex(docs,id){
 const list=Array.isArray(docs)?docs:[];
 const wanted=Number(id);
 return list.find(doc=>doc.id===wanted)||null;
}

export function handleOfflineApi(requestUrl,snapshot){
 const url=new URL(requestUrl,'http://127.0.0.1');
 if(!snapshot||!Array.isArray(snapshot.docs))return {status:503,body:{error:'offline: search needs the index',offline:true}};
 if(url.pathname==='/api/search')return {status:200,body:searchIndex(snapshot.docs,url.searchParams.get('q')||'')};
 if(url.pathname==='/api/doc'){
  const doc=readIndex(snapshot.docs,url.searchParams.get('id'));
  if(!doc)return {status:404,body:{error:'Document not found'}};
  return {status:200,body:{...doc,connections:doc.connections||[]}};
 }
 return {status:503,body:{error:'offline: search needs the index',offline:true}};
}
