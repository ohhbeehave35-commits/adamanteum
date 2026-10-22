import {arrowGeometry} from './arrows.js';
import {cellLayout,drawCell} from './cell.js';
import {flowParticles} from './flow.js';
function layoutWorker(){
 onmessage=({data})=>{
  const {nodes,edges,version}=data,map=new Map(nodes.map(n=>[n.id,n]));
  for(const n of nodes){n.vx=0;n.vy=0;}
  const links=edges.map(e=>[map.get(e.source),map.get(e.target)]).filter(([a,b])=>a&&b);
  for(let step=0;step<220;step++){
   const cells=new Map(),cellSize=75,heat=1-step/250;
   for(const n of nodes){const key=`${Math.floor(n.x/cellSize)},${Math.floor(n.y/cellSize)}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(n);n.vx-=n.x*.0006;n.vy-=n.y*.0006;}
   for(const n of nodes){const gx=Math.floor(n.x/cellSize),gy=Math.floor(n.y/cellSize);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const b of cells.get(`${gx+dx},${gy+dy}`)||[]){if(n===b)continue;const x=n.x-b.x,y=n.y-b.y,d2=x*x+y*y+.1;if(d2>5600)continue;const force=100/d2;n.vx+=x*force;n.vy+=y*force;}}
   for(const [a,b] of links){const x=b.x-a.x,y=b.y-a.y,d=Math.hypot(x,y)||1,f=(d-45)*.007/Math.sqrt(1+Math.min(a.degree,b.degree));a.vx+=x/d*f;a.vy+=y/d*f;b.vx-=x/d*f;b.vy-=y/d*f;}
   for(const n of nodes){n.vx*=.65;n.vy*=.65;n.x+=Math.max(-8,Math.min(8,n.vx))*heat;n.y+=Math.max(-8,Math.min(8,n.vy))*heat;}
  }
  postMessage({nodes:nodes.map(({id,x,y})=>({id,x,y})),version});
 };
}
export class Atlas{
 constructor(canvas,callbacks){
  this.canvas=canvas;this.ctx=canvas.getContext('2d');this.callbacks=callbacks;this.nodes=[];this.edges=[];this.groups=[];this.colors=['#b49be8','#e7b66e','#74caba','#e58da9','#8baada','#bace7a','#d198e0'];this.view={x:0,y:0,z:1};this.goal={...this.view};this.selected=0;this.hover=0;this.frame=0;
  this.tooltip=canvas.parentElement.querySelector('#tooltip')||document.createElement('div');this.tooltip.classList.add('atlas-tooltip');this.tooltip.hidden=true;if(!this.tooltip.parentElement)canvas.parentElement.append(this.tooltip);
  new ResizeObserver(()=>this.resize()).observe(canvas);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)this.drawSoon();});
  canvas.onpointerdown=e=>{canvas.setPointerCapture(e.pointerId);this.tooltip.hidden=true;this.drag={x:e.clientX,y:e.clientY,vx:this.goal.x,vy:this.goal.y,moved:false};};
  canvas.onpointermove=e=>{if(this.drag){const dx=e.clientX-this.drag.x,dy=e.clientY-this.drag.y;this.drag.moved ||= Math.hypot(dx,dy)>4;this.goal.x=this.drag.vx+dx;this.goal.y=this.drag.vy+dy;this.drawSoon();}else{const n=this.hit(e);this.hover=n?.id||0;canvas.style.cursor=n?'pointer':'grab';const tip=this.tooltip;tip.hidden=!n;if(n){tip.textContent=n.title;tip.style.left=Math.max(0,Math.min(e.offsetX+15,this.w-250))+'px';tip.style.top=Math.max(0,Math.min(e.offsetY+15,this.h-60))+'px';}this.drawSoon();}};
  canvas.onpointerup=e=>{if(this.drag&&!this.drag.moved){const n=this.hit(e);if(n)this.callbacks.select(n.id);}this.drag=null;};canvas.onpointercancel=()=>this.drag=null;canvas.ondblclick=e=>{const n=this.hit(e);if(n)this.callbacks.expand(n.id);};canvas.onwheel=e=>{e.preventDefault();this.zoom(Math.exp(-e.deltaY*.0015),e.offsetX,e.offsetY);};canvas.onpointerleave=()=>{this.hover=0;this.tooltip.hidden=true;this.drawSoon();};
 }
 resize(){const rect=this.canvas.getBoundingClientRect();this.w=rect.width;this.h=rect.height;this.dpr=Math.min(devicePixelRatio||1,2);this.canvas.width=this.w*this.dpr;this.canvas.height=this.h*this.dpr;if(this.nodes.length)this.fit();else this.drawSoon();}
 refresh(){const theme=document.body.dataset.theme;this.colors=theme==='ivory'?['#566592','#9b596b','#347d76','#85619b','#3e7897','#758137','#a76d37']:theme==='terminal'?['#92b9d0','#d6ae75','#8295c8','#7eb9b4','#bd9bb9','#bcc7d2','#bba98a']:['#a1aed0','#cfa0ad','#87bfb7','#b5a6c9','#91b2c9','#b8bd91','#cfb394'];for(const n of this.nodes)n.color=this.colors[this.groups.indexOf(n.folder)%this.colors.length];this.drawSoon();}
 shape(mode){this.worker?.terminate();if(this.timelineMode)this.timeline();const previous=this.cellular?'cell':'';if(previous)for(const n of this.nodes){n.x=n.shapePreviousX??n.x;n.y=n.shapePreviousY??n.y;}this.cellular=mode==='cell'&&previous!==mode;this.applyShape();this.fit();}
 cell(){this.shape('cell');}
 applyShape(){if(this.cellular){for(const n of this.nodes){n.shapePreviousX=n.x;n.shapePreviousY=n.y;}this.cellShape=cellLayout(this.nodes);}this.canvas.dataset.view=this.cellular?'cell':'constellation';this.canvas.dataset.layout='settled';}
 pulse(ids){if(!this.pulses)this.pulses=new Map();const until=performance.now()+2200;for(const id of ids)if(this.nodes.some(n=>n.id===id))this.pulses.set(id,until);this.drawSoon();setTimeout(()=>this.drawSoon(),2250);}
 animate(enabled){this.animating=!!enabled;this.drawSoon();}
 drawFlow(c,active){
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const running=this.animating&&!reduced&&!document.hidden&&!this.hideEdges&&!this.timelineMode&&!this.undirected&&this.edges.length>0;
  this.canvas.dataset.animation=running?'running':this.animating?'paused':'off';
  this.canvas.dataset.flowParticles='0';if(!running)return false;
  const particles=flowParticles(this.edges,performance.now(),{active,straight:this.structural||this.edges.length>12000});
  c.save();c.strokeStyle=this.light?'#467082':'#c3e1ec';c.fillStyle=this.light?'#2d566b':'#e3f4ff';c.lineWidth=1.8/this.view.z;
  for(const p of particles){
   c.globalAlpha=.8*Math.sin(Math.PI*p.phase);c.beginPath();c.moveTo(p.tail.x,p.tail.y);c.lineTo(p.head.x,p.head.y);c.stroke();
   c.beginPath();c.arc(p.head.x,p.head.y,2.3/this.view.z,0,Math.PI*2);c.fill();
  }
  c.restore();this.canvas.dataset.flowParticles=String(particles.length);return particles.length>0;
 }
 drawActivity(c){
  if(!this.pulses)return false;
  const now=performance.now(),reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let active=0;
  for(const [id,until] of this.pulses){if(until<=now){this.pulses.delete(id);continue;}const n=this.nodes.find(n=>n.id===id);if(!n)continue;active++;const fraction=1-(until-now)/2200,x=n.x*this.view.z+this.view.x,y=n.y*this.view.z+this.view.y;c.beginPath();c.arc(x,y,reduce?12:8+fraction*30,0,Math.PI*2);c.strokeStyle=`rgba(104,255,217,${(1-fraction)*.85})`;c.lineWidth=2;c.stroke();c.beginPath();c.arc(x,y,4,0,Math.PI*2);c.fillStyle='#c5fff0';c.fill();}
  this.canvas.dataset.activeNodes=String(active);return active>0&&!reduce;
 }
 timeline(){
  if(this.cellular)this.cell();
  this.worker?.terminate();
  this.timelineMode=!this.timelineMode;
  if(this.timelineMode){
   const min=Math.min(...this.nodes.map(n=>n.mtime)),max=Math.max(...this.nodes.map(n=>n.mtime));
   this.timelineRange=[min,max];
   for(const [i,n] of this.nodes.entries()){n.networkX=n.x;n.networkY=n.y;n.x=(n.mtime-min)/Math.max(1,max-min)*2200-1100+Math.sin(i*2.4)*12;n.y=this.groups.indexOf(n.folder)*100+Math.cos(i*2.4)*26;}
  }else for(const n of this.nodes){n.x=n.networkX;n.y=n.networkY;}
  this.canvas.dataset.map=this.timelineMode?'modified-time':'connections';
  this.canvas.dataset.layout='settled';this.fit();
 }
 trace(c,e){c.moveTo(e.a.x,e.a.y);if(this.structural||this.edges.length>12000)c.lineTo(e.b.x,e.b.y);else{const dx=e.b.x-e.a.x,dy=e.b.y-e.a.y;c.quadraticCurveTo((e.a.x+e.b.x)/2-dy*.09,(e.a.y+e.b.y)/2+dx*.09,e.b.x,e.b.y);}}
 arrows(c,active){
  let count=0;
  if(this.hideEdges||this.timelineMode||this.undirected){this.canvas.dataset.arrows='0';return;}
  const style=getComputedStyle(document.body);
  c.fillStyle=style.getPropertyValue('--accent').trim();
  c.beginPath();
  for(const e of this.edges){
   const focused=e.a.id===active||e.b.id===active;
   if(active&&!focused)continue;
   // At overview scale, emphasize readable long links. Every focused link
   // remains directional; short links reveal their arrow as the user zooms.
   const p=arrowGeometry(e.a,e.b,{zoom:this.view.z,straight:this.structural||this.edges.length>12000,targetRadius:e.b.radius});
   if(!p)continue;
   const sx=p.x*this.view.z+this.view.x,sy=p.y*this.view.z+this.view.y;
   if(sx<0||sy<0||sx>this.w||sy>this.h)continue;
   c.moveTo(p.x,p.y);c.lineTo(p.left.x,p.left.y);c.lineTo(p.right.x,p.right.y);c.closePath();count++;
  }
  c.globalAlpha=active||this.edges.length<50?1:.65;c.fill();c.globalAlpha=1;this.canvas.dataset.arrows=String(count);
 }
 clouds(c){
  if(this.cellular){c.save();c.translate(this.view.x,this.view.y);c.scale(this.view.z,this.view.z);drawCell(c,this.cellShape,{light:this.light,zoom:this.view.z});c.restore();return;}
  if(this.light||this.structural||this.timelineMode)return;
  const groups=new Map();
  for(const n of this.nodes){const g=groups.get(n.folder)||{x:0,y:0,count:0,color:n.color};g.x+=n.x;g.y+=n.y;g.count++;groups.set(n.folder,g);}
  for(const g of groups.values()){if(g.count<5)continue;const x=g.x/g.count*this.view.z+this.view.x,y=g.y/g.count*this.view.z+this.view.y,r=Math.max(50,Math.min(250,Math.sqrt(g.count)*16*this.view.z));const glow=c.createRadialGradient(x,y,0,x,y,r);glow.addColorStop(0,g.color+'12');glow.addColorStop(.45,g.color+'08');glow.addColorStop(1,g.color+'00');c.fillStyle=glow;c.fillRect(x-r,y-r,r*2,r*2);}
 }
 setData(data){
  this.worker?.terminate();const version=this.version=(this.version||0)+1;
  this.groups=[...new Set(data.nodes.map(n=>n.folder))];const groupMap=new Map(this.groups.map((g,i)=>[g,i])),indexes=new Map();
  this.nodes=data.nodes.map(n=>{const g=groupMap.get(n.folder),i=indexes.get(n.folder)||0;indexes.set(n.folder,i+1);const angle=g*2.399963,ring=120+Math.sqrt(g)*60,cx=this.groups.length===1?0:Math.cos(angle)*ring,cy=this.groups.length===1?0:Math.sin(angle)*ring,r=Math.sqrt(i)*19,a=i*2.399963;return {...n,x:cx+Math.cos(a)*r,y:cy+Math.sin(a)*r,color:this.colors[g%this.colors.length],radius:2+Math.min(6,Math.log2(1+n.degree)*.65)};});
  const map=new Map(this.nodes.map(n=>[n.id,n]));this.edges=data.edges.map(e=>({a:map.get(e.source),b:map.get(e.target)})).filter(e=>e.a&&e.b);
  if(this.cellular){this.applyShape();this.fit();return;}this.fit();
  const url=URL.createObjectURL(new Blob([`(${layoutWorker.toString()})()`],{type:'text/javascript'}));this.worker=new Worker(url);URL.revokeObjectURL(url);this.worker.onmessage=({data:result})=>{if(result.version!==this.version||this.cellular)return;for(const p of result.nodes)Object.assign(map.get(p.id),p);this.canvas.dataset.layout='settled';this.fit();this.worker.terminate();};this.canvas.dataset.layout='settling';this.worker.postMessage({nodes:this.nodes,edges:data.edges,version});
 }
 fit(){if(!this.nodes.some(n=>n.id===this.selected))this.selected=0;if(!this.nodes.length){this.drawSoon();return;}if(this.cellular){const r=this.cellShape.radius;this.goal={x:this.w/2,y:this.h/2,z:Math.max(.08,Math.min((this.w-80)/(r*2.5),(this.h-170)/(r*2.3),2))};this.drawSoon();return;}let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;for(const n of this.nodes){minX=Math.min(minX,n.x);maxX=Math.max(maxX,n.x);minY=Math.min(minY,n.y);maxY=Math.max(maxY,n.y);}const z=Math.min((this.w-70)/Math.max(100,maxX-minX),(this.h-100)/Math.max(100,maxY-minY),2);this.goal={x:this.w/2-(minX+maxX)/2*z,y:this.h/2+(this.nodes.length<=40?0:25)-(minY+maxY)/2*z,z:Math.max(.08,z)};this.drawSoon();}
 zoom(factor,x=this.w/2,y=this.h/2){const z=Math.max(.08,Math.min(8,this.goal.z*factor)),ratio=z/this.goal.z;this.goal={x:x-(x-this.goal.x)*ratio,y:y-(y-this.goal.y)*ratio,z};this.drawSoon();}
 select(id){this.selected=this.nodes.some(n=>n.id===id)?id:0;this.drawSoon();}
 hit(e){const x=(e.offsetX-this.view.x)/this.view.z,y=(e.offsetY-this.view.y)/this.view.z;let best=null,d=Infinity;for(const n of this.nodes){const nd=Math.hypot(n.x-x,n.y-y);if(nd<Math.max(n.radius,9/this.view.z)&&nd<d){best=n;d=nd;}}return best;}
 drawSoon(){if(!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=0;this.draw();});}
 draw(){if(!this.w)return;const started=performance.now();this.bg=getComputedStyle(document.body).getPropertyValue('--graph').trim();this.light=document.body.dataset.theme==='ivory';let moving=false;for(const k of ['x','y','z']){const d=this.goal[k]-this.view[k];if(Math.abs(d)>(k==='z'?.001:.15)){this.view[k]+=d*.24;moving=true;}else this.view[k]=this.goal[k];}const c=this.ctx;c.setTransform(this.dpr,0,0,this.dpr,0,0);c.fillStyle=this.bg||'#100e18';c.fillRect(0,0,this.w,this.h);const glow=c.createRadialGradient(this.w*.55,this.h*.52,0,this.w*.55,this.h*.52,this.w*.65);glow.addColorStop(0,this.light?'#c8bba014':'#9480c00b');glow.addColorStop(1,'transparent');c.fillStyle=glow;c.fillRect(0,0,this.w,this.h);c.save();c.translate(this.view.x,this.view.y);c.scale(this.view.z,this.view.z);const active=this.hover||this.selected;const connected=new Set([active]);if(active)for(const e of this.edges)if(e.a.id===active||e.b.id===active){connected.add(e.a.id);connected.add(e.b.id);}c.lineWidth=.55/this.view.z;
 c.restore();this.clouds(c);c.save();c.translate(this.view.x,this.view.y);c.scale(this.view.z,this.view.z);c.lineWidth=.65/this.view.z;
 c.beginPath();for(const e of this.edges){if(active&&(e.a.id===active||e.b.id===active))continue;this.trace(c,e);}c.strokeStyle=this.light?'#66708570':active?'#a0b0c628':this.edges.length<50?'#9cb3cc90':'#9cb3cc45';if(!this.hideEdges&&!this.timelineMode)c.stroke();
 if(active&&!this.hideEdges){const accent=getComputedStyle(document.body).getPropertyValue('--accent').trim()||'#a4c7de';c.beginPath();for(const e of this.edges)if(e.a.id===active||e.b.id===active)this.trace(c,e);c.strokeStyle=accent+'30';c.lineWidth=6/this.view.z;c.stroke();c.strokeStyle=accent+'cf';c.lineWidth=1/this.view.z;c.stroke();}
 this.arrows(c,active);
 const flowing=this.drawFlow(c,active);
 const labels=[],detail=this.nodes.length<=40;
 for(const n of this.nodes){
  const sx=n.x*this.view.z+this.view.x,sy=n.y*this.view.z+this.view.y;if(sx<-30||sx>this.w+30||sy<-30||sy>this.h+30)continue;
  const emphasized=n.id===active,radius=Math.max(n.radius,(detail?4:1.55)/this.view.z);c.globalAlpha=active&&!connected.has(n.id)?.22:1;
  if(emphasized||n.degree>35){const halo=c.createRadialGradient(n.x,n.y,0,n.x,n.y,radius+9/this.view.z);halo.addColorStop(0,n.color+'65');halo.addColorStop(1,n.color+'00');c.beginPath();c.arc(n.x,n.y,radius+9/this.view.z,0,Math.PI*2);c.fillStyle=halo;c.fill();}
  c.beginPath();c.arc(n.x,n.y,radius,0,Math.PI*2);c.fillStyle=n.color;c.fill();
  if(n.degree>35){c.beginPath();c.arc(n.x,n.y,radius*.38,0,Math.PI*2);c.fillStyle=this.light?'#fff9':'#fffC';c.fill();}
  if(emphasized){c.strokeStyle=n.color;c.lineWidth=1/this.view.z;c.beginPath();c.arc(n.x,n.y,radius+4/this.view.z,0,Math.PI*2);c.stroke();}
  if(detail||emphasized||this.view.z>1.5||n.degree>30)labels.push(n);
 }c.globalAlpha=1;c.restore();
 if(this.timelineMode)labels.splice(0,labels.length,...labels.filter(n=>n.id===active));if(this.hideLabels)labels.length=0;
 const occupied=[],fontSize=detail?13:10;c.font=`${fontSize}px Segoe UI`;
 for(const n of labels.sort((a,b)=>(b.id===active)-(a.id===active)||b.degree-a.degree)){
  const x=n.x*this.view.z+this.view.x,y=n.y*this.view.z+this.view.y+Math.max(n.radius*this.view.z,detail?4:0)+fontSize+4,maximum=detail?52:38,text=n.title.length>maximum?n.title.slice(0,maximum-2)+'…':n.title,width=c.measureText(text).width;
  if(n.id!==active&&occupied.some(r=>Math.abs(r.y-y)<fontSize+5&&Math.abs(r.x-x)<(r.width+width)/2+8))continue;
  if(x<0||y<0||y>this.h-(detail?12:50))continue;occupied.push({x,y,width});c.textAlign='center';c.fillStyle=this.light?'#f9f8f3ee':'#151921e8';c.fillRect(x-width/2-4,y-fontSize,width+8,fontSize+5);c.fillStyle=n.id===active?(this.light?'#242237':'#fff'):(this.light?'#3f4651':'#d8dce6');c.fillText(text,x,y);
 }
 this.canvas.dataset.labels=String(occupied.length);
 if(this.timelineMode){c.textAlign='left';c.font='10px Segoe UI';c.fillStyle=this.light?'#7554d4':'#c1abd9';for(const [i,g] of this.groups.entries()){const y=i*100*this.view.z+this.view.y;if(y>100&&y<this.h-120)c.fillText(g,15,y);}const format=t=>new Date(t).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});c.fillText('MODIFIED TIME  '+format(this.timelineRange[0])+' → '+format(this.timelineRange[1]),20,this.h-130);}
 const activeEvents=this.drawActivity(c);this.canvas.dataset.drawMs=(performance.now()-started).toFixed(2);this.canvas.dataset.nodes=this.nodes.length;this.canvas.dataset.edges=this.edges.length;this.canvas.dataset.zoom=this.view.z.toFixed(3);if(!document.hidden&&(moving||activeEvents||flowing))this.drawSoon();}
}
