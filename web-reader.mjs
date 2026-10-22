import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';

export function publicAddress(address){
  if(net.isIP(address)!==4)return false; // Fail closed for IPv6 until equivalent range validation exists.
  const [a,b]=address.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&[0,168].includes(b))||(a===100&&b>=64&&b<=127)||(a===198&&[18,19,51].includes(b))||(a===203&&b===0));
}
export function webUrl(value){
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||url.search)
    throw Error('Use a public HTTPS page without credentials, query parameters, or a custom port.');
  url.hash='';return url;
}
function decode(text){return text.replace(/&(?:amp|lt|gt|quot|apos|#39|nbsp);/g,s=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&#39;':"'",'&nbsp;':' '})[s]);}
export function pageText(html,url){
  const title=decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||url);
  const clean=html.replace(/<!--[\s\S]*?-->/g,' ').replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi,' ');
  const links=[];
  for(const m of clean.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    try{const target=webUrl(new URL(decode(m[1]),url).href).href;if(!links.some(l=>l.url===target))links.push({url:target,title:decode(m[2].replace(/<[^>]+>/g,' ')).trim().slice(0,160)});}catch{}
    if(links.length>=60)break;
  }
  return {url,title,text:decode(clean.replace(/<\/(?:p|div|h[1-6]|li|tr)>/gi,'\n').replace(/<[^>]+>/g,' ')).replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n').trim().slice(0,24000),links};
}
export async function readPublicPage(value,{lookup=dns.lookup,request=https.request}={}){
  const url=webUrl(value);
  const addresses=await lookup(url.hostname,{all:true,family:4});
  if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw Error('Private, reserved, and local network addresses are blocked.');
  const address=addresses[0].address;
  const html=await new Promise((resolve,reject)=>{
    const req=request(url,{method:'GET',headers:{'User-Agent':'Adamantium/0.2 read-only research','Accept':'text/html,text/plain','Accept-Encoding':'identity'},lookup:(_host,options,callback)=>options?.all?callback(null,[{address,family:4}]):callback(null,address,4)},res=>{
      if(res.statusCode<200||res.statusCode>=300){res.resume();reject(Error(`Page returned ${res.statusCode}. Redirects require a separately approved URL.`));return;}
      if(!/^text\/(html|plain)/i.test(String(res.headers['content-type']))){res.resume();reject(Error('Only HTML and plain-text pages can be read.'));return;}
      let size=0;const chunks=[];
      res.on('data',chunk=>{size+=chunk.length;if(size>2*1024*1024){req.destroy(Error('Page exceeds the 2 MB safety limit.'));return;}chunks.push(chunk);});
      res.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error',reject);
    });
    req.on('error',reject);req.setTimeout(15000,()=>req.destroy(Error('Page timed out.')));req.end();
  });
  return {...pageText(html,url.href),readAt:new Date().toISOString(),mode:'read-only HTML; no scripts, cookies, login, forms, or downloads'};
}
