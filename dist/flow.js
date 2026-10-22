// Illustrative motion follows existing source-to-target links; it is not live traffic.
export function flowPoint(a,b,t,straight=false){
 const u=1-t,dx=b.x-a.x,dy=b.y-a.y;
 const cx=(a.x+b.x)/2-(straight?0:dy*.09),cy=(a.y+b.y)/2+(straight?0:dx*.09);
 return {x:u*u*a.x+2*u*t*cx+t*t*b.x,y:u*u*a.y+2*u*t*cy+t*t*b.y};
}
export function flowParticles(edges,time,{active=0,straight=false,limit=64}={}){
 if(!edges.length||limit<1)return [];
 const candidates=active?edges.filter(e=>e.a.id===active||e.b.id===active):edges;
 const stride=Math.max(1,Math.ceil(candidates.length/limit)),particles=[];
 for(let i=0;i<candidates.length&&particles.length<limit;i+=stride){
  const e=candidates[i],phase=((time/4500+i*.61803398875)%1+1)%1;
  if(!Number.isFinite(e.a.x+e.a.y+e.b.x+e.b.y))continue;
  particles.push({head:flowPoint(e.a,e.b,phase,straight),tail:flowPoint(e.a,e.b,Math.max(0,phase-.045),straight),phase});
 }
 return particles;
}
