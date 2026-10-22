import crypto from 'node:crypto';
import {searchExpression} from './lib.mjs';
export const collections=[
 {id:'today',name:'Recently touched',description:'Source records changed in the past seven days.',rule:{scope:'records',days:7}},
 {id:'decisions',name:'Decisions & approvals',description:'Source records mentioning decisions or approvals.',rule:{scope:'records',query:'decision approval'}},
 {id:'work',name:'Projects & handoffs',description:'Project work, handoffs and next steps.',rule:{scope:'records',query:'project handoff'}},
 {id:'assistant',name:'Assistant',description:'Your AI’s source records, without generated copies.',rule:{scope:'records',query:'Assistant'}},
 {id:'unconnected',name:'Unconnected knowledge',description:'Source records with no resolved links. Candidates to connect—not junk.',rule:{scope:'records',isolated:true}},
 {id:'generated',name:'Machine-generated knowledge',description:'Generated exports kept separate from your original records.',rule:{scope:'generated'}},
 {id:'archive',name:'Historical material',description:'Archives remain searchable without crowding daily work.',rule:{scope:'archive'}},
];
export function validateRule(input){
 const name=String(input.name||'').trim(),query=String(input.query||'').trim(),scope=input.scope||'records';
 if(!name||name.length>80||query.length>200||!['records','generated','archive'].includes(scope))throw Error('Choose a name up to 80 characters, a valid collection, and keywords up to 200 characters.');
 return {id:crypto.randomUUID(),name,description:query?`Automatically matches: ${query}`:'All documents in this collection.',rule:{scope,query}};
}
export function collectionQuery(rule){
 const where=['d.category=?'],params=[rule.scope],expression=searchExpression(rule.query||'');
 let join='';
 if(expression){join='JOIN search s ON s.rowid=d.id';where.push('search MATCH ?');params.push(expression);}
 if(rule.days){where.push('d.mtime>=?');params.push(Date.now()-rule.days*86400000);}
 if(rule.isolated)where.push('d.degree=0');
 return {from:`FROM docs d ${join} WHERE ${where.join(' AND ')}`,params};
}
export class Organizer{
 constructor(db){
  this.db=db;db.exec('CREATE TABLE IF NOT EXISTS smart_collections(id TEXT PRIMARY KEY,name TEXT,description TEXT,rule TEXT)');
 }
 list(){return [...collections,...this.db.prepare('SELECT * FROM smart_collections').all().map(c=>({...c,rule:JSON.parse(c.rule)}))].map(c=>{
  const {from,params}=collectionQuery(c.rule);
  return {...c,count:Number(this.db.prepare('SELECT count(*) n '+from).get(...params).n)};
 });}
 save(input){if(this.db.prepare('SELECT count(*) n FROM smart_collections').get().n>=50)throw Error('This workspace supports 50 personal smart collections.');const c=validateRule(input);this.db.prepare('INSERT INTO smart_collections VALUES (?,?,?,?)').run(c.id,c.name,c.description,JSON.stringify(c.rule));return c;}
 open(id){
  const c=collections.find(c=>c.id===id)||this.db.prepare('SELECT * FROM smart_collections WHERE id=?').get(id);
  if(!c)throw Error('Collection not found.');
  const rule=typeof c.rule==='string'?JSON.parse(c.rule):c.rule,{from,params}=collectionQuery(rule);
  const nodes=this.db.prepare('SELECT d.id,d.title,d.path,d.folder,d.category,d.degree,d.mtime,d.bytes '+from+' ORDER BY d.mtime DESC LIMIT 500').all(...params),ids=new Set(nodes.map(n=>n.id)),edges=[];
  const edge=this.db.prepare('SELECT source,target FROM edges WHERE source=?');for(const n of nodes)for(const e of edge.all(n.id))if(ids.has(e.target))edges.push(e);
  return {name:c.name,nodes,edges,total:Number(this.db.prepare('SELECT count(*) n '+from).get(...params).n)};
 }
}
