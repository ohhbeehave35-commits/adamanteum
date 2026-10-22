import {parentPort,workerData} from 'node:worker_threads';
import {KnowledgeStore,importKnowledgeGraph} from './knowledge-graph.mjs';
let store;
try{
 const input=JSON.parse(workerData.input),graph=importKnowledgeGraph(workerData.raw?input:input.graph);
 store=new KnowledgeStore(workerData.filename);
 const saved=store.save(graph,workerData.raw?workerData.title:input.title);parentPort.postMessage({result:{...saved,warnings:graph.warnings,rejected:0}});
}catch(error){parentPort.postMessage({error:error.message});}
finally{store?.close();}
