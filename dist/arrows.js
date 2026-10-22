// A curve's tangent fixes direction even for reciprocal links.
export function arrowGeometry(a,b,{zoom=1,straight=false,targetRadius=3}={}){
 const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
 if(length*zoom<20)return null;
 const control={x:(a.x+b.x)/2-(straight?0:dy*.09),y:(a.y+b.y)/2+(straight?0:dx*.09)};
 const t=Math.max(.5,Math.min(.68,1-(targetRadius+12/zoom)/length)),u=1-t;
 const x=u*u*a.x+2*u*t*control.x+t*t*b.x,y=u*u*a.y+2*u*t*control.y+t*t*b.y;
 const tx=2*u*(control.x-a.x)+2*t*(b.x-control.x),ty=2*u*(control.y-a.y)+2*t*(b.y-control.y),angle=Math.atan2(ty,tx);
 const size=7/zoom,spread=.52;
 return {x,y,left:{x:x-size*Math.cos(angle-spread),y:y-size*Math.sin(angle-spread)},right:{x:x-size*Math.cos(angle+spread),y:y-size*Math.sin(angle+spread)}};
}
