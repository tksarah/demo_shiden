import fs from 'node:fs/promises';
import path from 'node:path';
import {ChainReader} from './chain-reader.js';
import {RPC} from '../dist/live-core.js';
import {loadLocalWallet} from './config.mjs';
const walletAddress=await loadLocalWallet();
const count=Number(process.argv[2]??10);
if(!Number.isInteger(count)||count<1||count>100)throw new Error('Count must be 1..100.');
const output=path.resolve(process.argv[3]??'private/replay.json'),reader=new ChainReader({walletAddress});
try{
 const snapshot=await reader.snapshot(),records=[];let block=snapshot.lastAuthoredBlock;
 for(let i=0;i<count&&BigInt(block)>0n;i++){
  const {mode,eventId,...r}=await reader.record(block,snapshot.blockNumber);
  if(BigInt(r.rewardPlanck)>0n)records.push(r);
  console.log(JSON.stringify({block:r.blockNumber,rewardPlanck:r.rewardPlanck,verifiedSources:2}));block=r.evidence.previousAuthoredBlock;
 }
 if(!records.length)throw new Error('No confirmed rewards found.');
 records.reverse();const document={schema:'shiden-collator-replay/v1',network:'shiden',address:walletAddress,source:{kind:'chain',fetchedAt:new Date().toISOString(),rpcSources:RPC,finalizedBlock:snapshot.blockNumber,finalizedHash:snapshot.blockHash,verification:'two-rpc-finalized-transfer-authorship',requestedCount:count},records};
 await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(document,null,2)+'\n');
 console.log(JSON.stringify({saved:output,records:records.length,totalPlanck:records.reduce((n,r)=>n+BigInt(r.rewardPlanck),0n).toString()}));
}finally{await reader.close();}
