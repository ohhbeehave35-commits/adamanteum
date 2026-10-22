import test from 'node:test';
import assert from 'node:assert/strict';
import {cellLayout} from '../dist/cell.js';
test('cell layout is stable, bounded and uses existing nodes without inventing graph data',()=>{
 const source=Array.from({length:900},(_,i)=>({id:String(i),title:'Note '+i,folder:'Folder '+i%17,degree:900-i})),a=structuredClone(source),b=structuredClone(source),cell=cellLayout(a);cellLayout(b);
 assert.deepEqual(a,b);assert.equal(a.length,900);assert.equal(a[0].x,cell.nucleus.x);assert.equal(a[0].y,0);
 for(const n of a){assert.ok(Number.isFinite(n.x)&&Number.isFinite(n.y));assert.ok(Math.hypot(n.x/1.18,n.y)<cell.radius);}
 assert.equal(cell.organelles.length,17);assert.equal(cellLayout([]).organelles.length,0);
});
