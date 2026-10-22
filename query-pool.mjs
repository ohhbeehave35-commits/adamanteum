import {Worker} from 'node:worker_threads';
const SLOW=new Set(['health','base','changes','tags','properties']);
export class QueryPool{
 constructor(database,size=2){this.database=database;this.queue=[];this.sequence=0;this.slots=Array.from({length:size},()=>({worker:null,job:null}));for(const slot of this.slots)this.start(slot);}
 start(slot){
  const worker=slot.worker=new Worker(new URL('./query-worker.mjs',import.meta.url),{workerData:{database:this.database},resourceLimits:{maxOldGenerationSizeMb:768}});
  worker.on('message',result=>{
   if(worker!==slot.worker||!slot.job||slot.job.id!==result.id)return;
   const job=slot.job;slot.job=null;clearTimeout(job.timer);
   result.error?job.reject(Error(result.error)):job.resolve(result);this.drain();
  });
  worker.on('error',error=>{if(worker!==slot.worker)return;const job=slot.job;slot.job=null;if(job){clearTimeout(job.timer);job.reject(error);}});
  worker.on('exit',()=>{if(worker!==slot.worker)return;slot.worker=null;if(slot.job){clearTimeout(slot.job.timer);slot.job.reject(Error('Search worker stopped. Please retry.'));slot.job=null;}if(!this.closed){this.start(slot);this.drain();}});
 }
 run(kind,input){
  if(this.closed)return Promise.reject(Error('Search service closed.'));
  if(this.queue.length>=32)return Promise.reject(Error('Search queue is busy. Please retry shortly.'));
  return new Promise((resolve,reject)=>{this.queue.push({id:++this.sequence,kind,input,resolve,reject});this.drain();});
 }
 drain(){
  for(const slot of this.slots)if(slot.worker&&!slot.job&&this.queue.length){
   const job=slot.job=this.queue.shift();
   job.timer=setTimeout(()=>{if(slot.job!==job)return;slot.job=null;job.reject(Error(SLOW.has(job.kind)?'This report took too long. Try a narrower scope.':'Search exceeded 10 seconds. Narrow the query.'));const old=slot.worker;slot.worker=null;old.terminate();this.start(slot);this.drain();},SLOW.has(job.kind)?120000:10000);
   slot.worker.postMessage({id:job.id,kind:job.kind,input:job.input});
  }
 }
 async close(){this.closed=true;for(const job of this.queue)job.reject(Error('Search service closed.'));this.queue=[];await Promise.all(this.slots.map(slot=>{if(slot.job){clearTimeout(slot.job.timer);slot.job.reject(Error('Search service closed.'));slot.job=null;}return slot.worker?.terminate();}));}
}
