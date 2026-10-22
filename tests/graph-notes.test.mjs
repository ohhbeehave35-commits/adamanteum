import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {writeGraphNotes} from '../graph-notes.mjs';
test('graph notes preserve directed wiki links and evidence, reject traversal and never overwrite existing folders',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'adamantium-notes-test-')),output=path.join(root,'export'),graph={nodes:[{id:'../../hostile',title:'Alpha',path:'source.ts',line:4,hash:'abc'},{id:'b',title:'Beta'}],edges:[{source:'../../hostile',target:'b',type:'uses',origin:'model-inferred',quote:'Alpha uses Beta',hash:'proof'}]};
 try{const result=await writeGraphNotes(graph,output);assert.equal(result.notes,2);const manifest=JSON.parse(await fs.readFile(path.join(output,'adamantium-manifest.json'),'utf8'));for(const f of manifest.files)assert.match(f.file,/^[a-f0-9]{64}\.md$/);const body=await fs.readFile(path.join(output,manifest.files[0].file),'utf8');assert.match(body,/Alpha uses Beta/);assert.match(body,/model-inferred/);assert.match(body,/Outgoing · 1/);assert.ok(body.includes('[['+manifest.files[1].file.slice(0,-3)));await assert.rejects(()=>writeGraphNotes(graph,output));}
 finally{if(path.dirname(root)!==os.tmpdir()||!path.basename(root).startsWith('adamantium-notes-test-'))throw Error('Unexpected test path');await fs.rm(root,{recursive:true});}
});
