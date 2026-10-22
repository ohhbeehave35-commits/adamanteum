import {parentPort,workerData} from 'node:worker_threads';
import {reconcileVault} from './vault-indexer.mjs';
try{parentPort.postMessage(await reconcileVault({...workerData,progress:s=>parentPort.postMessage(s)}));}
catch(error){parentPort.postMessage({phase:'error',error:error.message});}
