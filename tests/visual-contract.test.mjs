import test from 'node:test';
import assert from 'node:assert/strict';
import {arrowGeometry} from '../dist/arrows.js';
import {validateImage} from '../image-input.mjs';
test('arrows follow source to target, reciprocal curves separate and zoom preserves readable size',()=>{
 const a={x:0,y:0},b={x:100,y:0};
 const forward=arrowGeometry(a,b),backward=arrowGeometry(b,a);
 assert.ok(forward.x>forward.left.x&&forward.x>forward.right.x);
 assert.ok(backward.x<backward.left.x&&backward.x<backward.right.x);
 assert.ok(forward.y>0&&backward.y<0);
 assert.equal(arrowGeometry(a,{x:1,y:1}),null);
 for(const zoom of [.5,1,4]){
  const p=arrowGeometry(a,b,{zoom,straight:true});
  assert.ok(Math.abs(Math.hypot(p.x-p.left.x,p.y-p.left.y)*zoom-7)<.001);
 }
});
test('image sharing rejects missing consent, external URLs, mismatched magic and oversized content',()=>{
 const image='data:image/jpeg;base64,'+Buffer.from([255,216,255,0]).toString('base64');
 assert.equal(validateImage(image,true),image);
 assert.throws(()=>validateImage(image,false),/Approve/);
 assert.throws(()=>validateImage('https://example.com/a.jpg',true));
 assert.throws(()=>validateImage('data:image/png;base64,aGVsbG8=',true));
 assert.throws(()=>validateImage('a'.repeat(100001),true));
 assert.equal(validateImage(null,false),null);
});
