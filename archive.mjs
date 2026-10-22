import {deflateRawSync} from 'node:zlib';
import crypto from 'node:crypto';
const table=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(buffer){let crc=0xffffffff;for(const b of buffer)crc=table[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
export function zipDocuments(documents){
 if(!Array.isArray(documents)||!documents.length||documents.length>100)throw Error('Choose between one and 100 documents.');
 const entries=[],names=new Set();let bytes=0;
 for(const d of documents){
  const name=String(d.path).replaceAll('\\','/');
  if(!name||name.startsWith('/')||name.split('/').some(p=>p==='..'||p==='.')||/[:\0]/.test(name)||names.has(name))throw Error('Unsafe or duplicate archive path.');
  names.add(name);const data=Buffer.from(d.body,'utf8');bytes+=data.length;
  if(bytes>32*1024*1024)throw Error('Choose fewer documents. Each archive is limited to 32 MiB of indexed text.');
  entries.push({name:'documents/'+name,data});
 }
 entries.push({name:'adamantium-manifest.json',data:Buffer.from(JSON.stringify({schema:'adamantium.archive/v1',created:new Date().toISOString(),notice:'Export of indexed UTF-8 text. Original source files are unchanged. This download does not free source-vault disk space.',documents:documents.map(d=>({path:d.path,modified:d.mtime,sha256:crypto.createHash('sha256').update(d.body).digest('hex')}))},null,2))});
 const locals=[],central=[];let offset=0;
 for(const entry of entries){
  const name=Buffer.from(entry.name),data=deflateRawSync(entry.data,{level:6}),crc=crc32(entry.data),local=Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(8,8);local.writeUInt16LE(33,12);
  local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(entry.data.length,22);local.writeUInt16LE(name.length,26);
  const header=Buffer.alloc(46);header.writeUInt32LE(0x02014b50);header.writeUInt16LE(20,4);header.writeUInt16LE(20,6);header.writeUInt16LE(0x800,8);header.writeUInt16LE(8,10);header.writeUInt16LE(33,14);header.writeUInt32LE(crc,16);header.writeUInt32LE(data.length,20);header.writeUInt32LE(entry.data.length,24);header.writeUInt16LE(name.length,28);header.writeUInt32LE(offset,42);
  locals.push(local,name,data);central.push(header,name);offset+=local.length+name.length+data.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...locals,directory,end]);
}
