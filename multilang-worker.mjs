import {createInterface} from 'node:readline';
import {extractMultilang} from './multilang-core.mjs';
const input=createInterface({input:process.stdin,crlfDelay:Infinity});
for await(const line of input){
 let request;
 try{request=JSON.parse(line);const result=await extractMultilang(request.file,request.text,request.version);process.stdout.write(JSON.stringify({id:request.id,result})+'\n');}
 catch(error){process.stdout.write(JSON.stringify({id:request?.id,error:error.message})+'\n');}
}
