import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {deflateRawSync} from 'node:zlib';
export function packageFiles(root){
 const packageInfo=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')),files=['package.json','package-lock.json'];
 const walk=relative=>{for(const entry of fs.readdirSync(path.join(root,relative),{withFileTypes:true})){if(entry.isSymbolicLink())throw Error('Package symlink refused');const name=relative+entry.name;if(entry.isDirectory())walk(name+'/');else files.push(name);}};
 for(const entry of packageInfo.files){if(entry==='*.mjs')files.push(...fs.readdirSync(root).filter(n=>n.endsWith('.mjs')));else if(entry==='tests/*.test.mjs')files.push(...fs.readdirSync(path.join(root,'tests')).filter(n=>n.endsWith('.test.mjs')).map(n=>'tests/'+n));else if(entry.endsWith('/'))walk(entry);else files.push(entry);}
 return [...new Set(files)].sort().map(name=>{if(name.split('/').some(p=>p.startsWith('.')||p==='node_modules')||/TEAM-CONNECTION|RELEASE-VERIFICATION|live.integration|\.patch$|\.sqlite|\.log$/.test(name))throw Error('Private package file refused: '+name);if(!fs.statSync(path.join(root,name)).isFile())throw Error('Missing allowlisted file: '+name);return name;});
}
export function buildZip(root,files){
 const table=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
 const locals=[],central=[];let offset=0;
 for(const file of files){const name=Buffer.from(file),raw=fs.readFileSync(path.join(root,file)),data=deflateRawSync(raw);let crc=0xffffffff;for(const b of raw)crc=table[(crc^b)&255]^(crc>>>8);crc=(crc^0xffffffff)>>>0;
  const l=Buffer.alloc(30);l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt16LE(0x800,6);l.writeUInt16LE(8,8);l.writeUInt16LE(33,12);l.writeUInt32LE(crc,14);l.writeUInt32LE(data.length,18);l.writeUInt32LE(raw.length,22);l.writeUInt16LE(name.length,26);
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(8,10);c.writeUInt16LE(33,14);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(raw.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);locals.push(l,name,data);central.push(c,name);offset+=l.length+name.length+data.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,directory,end]);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=path.dirname(fileURLToPath(import.meta.url)),files=packageFiles(root),output=path.resolve(process.argv[2]||'Adamantium-0.6.1-door.zip');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,buildZip(root,files));console.log(JSON.stringify({output,files:files.length,bytes:fs.statSync(output).size}));
}
