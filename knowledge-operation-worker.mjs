import {parentPort,workerData} from 'node:worker_threads';
import {KnowledgeStore} from './knowledge-graph.mjs';
import {combineGraphs,clusterGraph} from './graph-operations.mjs';
let store;
try{
 store=new KnowledgeStore(workerData.filename);
 const ids=workerData.ids;if(!Array.isArray(ids)||!ids.length||ids.length>4||new Set(ids).size!==ids.length)throw Error('Choose distinct saved graphs.');
 let bytes=0;for(const id of ids){const row=store.db.prepare('SELECT length(CAST(payload AS BLOB)) bytes FROM graphs WHERE id=?').get(id);if(!row)throw Error('Source graph not found.');bytes+=row.bytes;}
 if(bytes>256*1024*1024)throw Error('Selected source graphs exceed the 256 MiB operation budget.');
 const sources=ids.map(id=>({id,title:store.db.prepare('SELECT title FROM graphs WHERE id=?').get(id).title,graph:store.get(id)}));
 let graph;if(workerData.action==='combine')graph=combineGraphs(sources);else if(workerData.action==='cluster'&&ids.length===1)graph=clusterGraph(sources[0].graph);else throw Error('Unknown graph operation.');
 const saved=store.save(graph,workerData.title);parentPort.postMessage({result:{...saved,analysis:graph.analysis,warnings:graph.warnings}});
}catch(error){parentPort.postMessage({error:error.message});}finally{store?.close();}
