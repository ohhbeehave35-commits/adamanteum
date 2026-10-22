export class ActivityBus {
  constructor(limit=120){this.limit=limit;this.sequence=0;this.events=[];this.clients=new Set();}
  emit(type,label,nodes=[],detail={}){
    const event={id:++this.sequence,time:new Date().toISOString(),type,label,nodes:[...new Set(nodes)].slice(0,40),...detail};
    this.events.push(event);if(this.events.length>this.limit)this.events.shift();
    for(const response of this.clients){if(response.writableLength>256000){response.destroy();this.clients.delete(response);continue;}response.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);}
    return event;
  }
  subscribe(req,res){
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});
    res.write(': connected\n\n');
    const last=Number(req.headers['last-event-id']||0);
    for(const e of this.events.filter(e=>e.id>last).slice(-20))res.write(`id: ${e.id}\ndata: ${JSON.stringify(e)}\n\n`);
    this.clients.add(res);
    const keepAlive=setInterval(()=>res.write(': heartbeat\n\n'),15000);keepAlive.unref();
    req.on('close',()=>{clearInterval(keepAlive);this.clients.delete(res);});
  }
}
