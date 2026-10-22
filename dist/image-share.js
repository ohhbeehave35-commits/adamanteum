let image=null;
export function initImageSharing(){
 const box=document.createElement('div');box.className='image-share';
 box.innerHTML='<label>Share an image for this request<input id="share-image-file" type="file" accept="image/png,image/jpeg,image/webp"></label><img id="share-image-preview" alt="Image selected for sharing" hidden><label><input id="share-image-consent" type="checkbox"> Send this preview to my connected AI</label><small id="share-image-status">Optional. Nothing is sent until you approve and press Send. Preview is resized locally; metadata is removed.</small><button id="share-image-clear" type="button">Remove image</button>';
 document.querySelector('#ai-form').before(box);
 const status=box.querySelector('small'),preview=box.querySelector('img'),file=box.querySelector('[type=file]'),consent=box.querySelector('[type=checkbox]');
 let version=0;
 function clear(){version++;image=null;preview.removeAttribute('src');preview.hidden=true;file.value='';consent.checked=false;}
 box.querySelector('button').onclick=()=>{clear();status.textContent='Image removed. Nothing shared.';};
 file.onchange=async()=>{
  const current=++version;image=null;consent.checked=false;preview.hidden=true;
  const selected=file.files[0];if(!selected)return;
  let bitmap;
  try{
   if(!['image/png','image/jpeg','image/webp'].includes(selected.type)||selected.size>10*1024*1024)throw Error('Choose a PNG, JPEG, or WebP smaller than 10 MB.');
   status.textContent='Preparing private local preview…';
   bitmap=await createImageBitmap(selected);
   if(current!==version)return;
   const canvas=document.createElement('canvas'),scale=Math.min(1,960/Math.max(bitmap.width,bitmap.height));
   canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
   const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
   let data;for(const quality of [.85,.65,.45,.25]){data=canvas.toDataURL('image/jpeg',quality);if(data.length<=100000)break;}
   if(data.length>100000)throw Error('This image is too detailed for the sharing limit. Choose a smaller crop.');
   image=data;preview.src=data;preview.hidden=false;
   status.textContent=`${canvas.width} × ${canvas.height} preview · ${Math.ceil(data.length*.75/1024)} KB · requires your approval`;
  }catch(e){status.textContent=e.message;}finally{bitmap?.close();}
 };
 return {payload(){if(image&&!consent.checked)throw Error('Approve the image preview or remove it before sending.');return {image,allowImage:!!image&&consent.checked};},clear};
}
