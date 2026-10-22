export function validateImage(image,approved=false){
 if(image==null)return null;
 if(!approved)throw Error('Approve sharing this image with the connected provider.');
 if(typeof image!=='string'||image.length>100000)throw Error('Image exceeds the 75 KB sharing limit.');
 const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
 if(!match)throw Error('Choose a PNG, JPEG, or WebP image.');
 const bytes=Buffer.from(match[2],'base64');
 const valid=match[1]==='png'?bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):match[1]==='jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 if(!valid||bytes.toString('base64')!==match[2])throw Error('Image format does not match its content.');
 return image;
}
