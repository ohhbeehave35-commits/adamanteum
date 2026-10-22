// A biological-cell metaphor for existing graph data; never adds relationships.
export function cellLayout(nodes){
 const radius=Math.max(320,Math.sqrt(nodes.length)*22),ordered=[...nodes].sort((a,b)=>(b.degree||0)-(a.degree||0)||String(a.id).localeCompare(String(b.id))),core=ordered.slice(0,Math.min(7,Math.max(1,Math.ceil(nodes.length*.025)))),coreIds=new Set(core.map(n=>n.id)),groups=new Map();
 core.forEach((n,i)=>{const r=i?radius*.095:0,a=i*2.399963;n.x=-radius*.12+Math.cos(a)*r;n.y=Math.sin(a)*r;});
 for(const n of ordered)if(!coreIds.has(n.id)){const key=n.folder||'Ungrouped';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(n);}
 const organelles=[];let index=0;
 for(const [name,members] of groups){const angle=index*2.399963,ring=radius*(.4+.3*Math.sqrt((index+.5)/Math.max(1,groups.size))),x=Math.cos(angle)*ring*1.13,y=Math.sin(angle)*ring,r=Math.min(radius*.14,Math.max(22,Math.sqrt(members.length)*9));
  members.forEach((n,i)=>{const local=r*.85*Math.sqrt((i+.5)/members.length),a=i*2.399963;n.x=x+Math.cos(a)*local;n.y=y+Math.sin(a)*local;});
  organelles.push({name,x,y,r,color:members[0].color});index++;
 }
 return {radius,nucleus:{x:-radius*.12,y:0,r:radius*.19},organelles};
}
export function drawCell(c,cell,{light=false,zoom=1}={}){
 if(!cell)return;const {radius:r,nucleus:n}=cell;c.save();
 const fill=c.createRadialGradient(-r*.2,-r*.2,r*.1,0,0,r*1.25);fill.addColorStop(0,light?'#dceae899':'#30585b55');fill.addColorStop(.75,light?'#d1dee84d':'#34505c36');fill.addColorStop(1,light?'#c4d7dc88':'#76b6ba28');
 const membrane=(scale)=>{c.beginPath();for(let i=0;i<=180;i++){const a=i/180*Math.PI*2,w=1+.026*Math.sin(a*5)+.018*Math.cos(a*3),x=Math.cos(a)*r*1.18*w*scale,y=Math.sin(a)*r*w*scale;if(i)c.lineTo(x,y);else c.moveTo(x,y);}c.closePath();};
 membrane(1);c.fillStyle=fill;c.fill();c.strokeStyle=light?'#638e9599':'#93c8c6aa';c.lineWidth=2/zoom;c.stroke();membrane(.974);c.strokeStyle=light?'#87a8ac66':'#97c9cc40';c.lineWidth=1/zoom;c.stroke();
 const glow=c.createRadialGradient(n.x-n.r*.3,n.y-n.r*.3,0,n.x,n.y,n.r);glow.addColorStop(0,light?'#d5c9ddaa':'#b0a0c343');glow.addColorStop(1,light?'#cabcd044':'#77668d35');c.beginPath();c.ellipse(n.x,n.y,n.r*1.08,n.r,-.2,0,Math.PI*2);c.fillStyle=glow;c.fill();c.strokeStyle=light?'#98829b88':'#bba6c980';c.lineWidth=1.4/zoom;c.stroke();
 for(const o of cell.organelles.slice(0,80)){c.beginPath();c.ellipse(o.x,o.y,o.r*1.18,o.r,.4,0,Math.PI*2);c.fillStyle=(o.color||'#87bfb7')+(light?'12':'0d');c.fill();c.strokeStyle=(o.color||'#87bfb7')+'40';c.lineWidth=.8/zoom;c.stroke();}
 c.restore();
}
