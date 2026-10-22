import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
export class Notebook {
 constructor(filename){
  this.db=new DatabaseSync(filename);this.db.exec(`PRAGMA journal_mode=WAL;
   CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,properties TEXT NOT NULL,revision INTEGER NOT NULL,updated TEXT NOT NULL,daily TEXT UNIQUE);
   CREATE TABLE IF NOT EXISTS revisions(id TEXT,revision INTEGER,title TEXT,body TEXT,properties TEXT,updated TEXT,PRIMARY KEY(id,revision));
   CREATE VIRTUAL TABLE IF NOT EXISTS note_search USING fts5(id UNINDEXED,title,body);
  `);
 }
 close(){this.db.close();}
 get(id){const note=this.db.prepare('SELECT * FROM notes WHERE id=?').get(id);if(!note)throw Error('Note not found.');return {...note,properties:JSON.parse(note.properties)};}
 list(q='',offset=0){
  offset=Math.max(0,Math.min(1000000,Math.floor(Number(offset)||0)));
  const terms=String(q).match(/[\p{L}\p{N}_-]+/gu)?.slice(0,20).map(t=>'"'+t+'"').join(' AND ');
  return terms?this.db.prepare('SELECT n.id,n.title,n.revision,n.updated,n.daily FROM note_search s JOIN notes n ON n.id=s.id WHERE note_search MATCH ? ORDER BY rank,n.id LIMIT 80 OFFSET ?').all(terms,offset):this.db.prepare('SELECT id,title,revision,updated,daily FROM notes ORDER BY updated DESC,id LIMIT 80 OFFSET ?').all(offset);
 }
 save({id,title,body,properties={},revision,daily=null}){
  if(typeof title!=='string'||!title.trim()||title.length>200)throw Error('Use a title between 1 and 200 characters.');
  if(typeof body!=='string'||Buffer.byteLength(body)>1024*1024)throw Error('Notes may contain up to 1 MiB of text.');
  if(!properties||Array.isArray(properties)||typeof properties!=='object'||Object.keys(properties).length>50||Object.entries(properties).some(([k,v])=>!k||k.length>80||!['string','number','boolean'].includes(typeof v))||JSON.stringify(properties).length>16000)throw Error('Use up to 50 simple text, numeric or boolean properties.');
  if(daily!==null&&(!/^\d{4}-\d{2}-\d{2}$/.test(daily)||new Date(daily+'T00:00:00Z').toISOString().slice(0,10)!==daily))throw Error('Choose a valid daily-note date.');
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const previous=id?this.get(id):null;
   if(previous&&revision!==previous.revision)throw Error('This note changed in another window. Reopen it before saving; your draft has not been discarded.');
   id=previous?.id||randomUUID();const next=(previous?.revision||0)+1,updated=new Date().toISOString(),props=JSON.stringify(properties);
   this.db.prepare('INSERT INTO notes VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,properties=excluded.properties,revision=excluded.revision,updated=excluded.updated').run(id,title.trim(),body,props,next,updated,previous?.daily||daily);
   this.db.prepare('INSERT INTO revisions VALUES (?,?,?,?,?,?)').run(id,next,title.trim(),body,props,updated);
   this.db.prepare('DELETE FROM note_search WHERE id=?').run(id);this.db.prepare('INSERT INTO note_search VALUES (?,?,?)').run(id,title.trim(),body);
   this.db.exec('COMMIT');return this.get(id);
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 daily(date){const existing=this.db.prepare('SELECT id FROM notes WHERE daily=?').get(date);return existing?this.get(existing.id):this.save({title:date,body:`# ${date}\n\n## Priorities\n\n- [ ] \n\n## Notes\n\n## Decisions\n`,daily:date,properties:{type:'daily'}});}
 history(id){this.get(id);return this.db.prepare('SELECT revision,title,updated FROM revisions WHERE id=? ORDER BY revision DESC LIMIT 100').all(id);}
 restore(id,fromRevision,revision){const old=this.db.prepare('SELECT * FROM revisions WHERE id=? AND revision=?').get(id,fromRevision);if(!old)throw Error('Revision not found.');return this.save({id,revision,title:old.title,body:old.body,properties:JSON.parse(old.properties)});}
 export(id){const n=this.get(id);return `---\n${Object.entries({title:n.title,...n.properties}).map(([k,v])=>JSON.stringify(k)+': '+JSON.stringify(v)).join('\n')}\n---\n\n${n.body}`;}
}
