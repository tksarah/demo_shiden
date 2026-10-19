import {encodeAddress} from '@polkadot/util-crypto';
import {POT,RPC} from '../dist/live-core.js';
export const ADDRESS=encodeAddress(new Uint8Array(32).fill(7),5);
export const OTHER_ADDRESS=encodeAddress(new Uint8Array(32).fill(8),5);
export const walletConfig={walletAddress:ADDRESS};
export function syntheticHistory(){
 const records=Array.from({length:10},(_,i)=>{const n=1001+i;return {blockNumber:String(n),blockHash:'0x'+n.toString(16).padStart(64,'0'),parentHash:'0x'+(n-1).toString(16).padStart(64,'0'),occurredAt:new Date(Date.UTC(2030,0,1,0,i)).toISOString(),rewardPlanck:'25000000000000000',author:ADDRESS,transfer:{from:POT,to:ADDRESS,amountPlanck:'25000000000000000',eventIndex:4,phase:'Initialization'},evidence:{lastAuthoredBlock:String(n),previousAuthoredBlock:String(n-1),runtimeSpecVersion:2500,rpcMatches:2}};});
 return {fixture:true,schema:'shiden-collator-replay/v1',network:'shiden',address:ADDRESS,source:{kind:'chain',fetchedAt:'2030-01-01T01:00:00Z',rpcSources:RPC,finalizedBlock:'1100',finalizedHash:'0x'+'e'.repeat(64),verification:'two-rpc-finalized-transfer-authorship',requestedCount:10},records};
}
