import {ApiPromise,HttpProvider} from '@polkadot/api';
import {decodeAddress} from '@polkadot/util-crypto';
import {u8aToHex,hexToU8a} from '@polkadot/util';
import {POT,RPC,SPECS,balances,Recovery} from '../dist/live-core.js';
export function validateWalletAddress(value){
 if(typeof value!=='string'||!/^[1-9A-HJ-NP-Za-km-z]{45,50}$/.test(value))throw new Error('有効なSS58形式の公開アドレスが必要です。');
 try{if(decodeAddress(value).length!==32)throw new Error();}catch{throw new Error('公開アドレスのチェックサムが不正です。');}
 return value;
}
const safeMethods=new Set(['system_chain','system_properties','system_name','system_version','rpc_methods','chain_getFinalizedHead','chain_getHeader','chain_getBlockHash','state_getStorage','state_getRuntimeVersion','state_getMetadata','state_call']);
export class ChainReader{
 constructor({walletAddress}={}){this.walletAddress=validateWalletAddress(walletAddress);this.api=null;this.recovery=null;this.requestId=0;this.suspended=false;this.controllers=new Set();this.lastSnapshot=null;}
 async rpc(url,method,params=[]){if(this.suspended)throw new Error('取得を休止しています');if(!safeMethods.has(method))throw new Error('Read-only RPC required');const c=new AbortController();this.controllers.add(c);const timeout=setTimeout(()=>c.abort(),20000);try{const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++this.requestId,method,params}),signal:c.signal,credentials:'omit'});if(!response.ok)throw new Error('RPC HTTP '+response.status);const data=await response.json();if(data.error)throw new Error('RPC: '+data.error.message);return data.result;}finally{clearTimeout(timeout);this.controllers.delete(c);}}
 async connect(){if(this.api)return;const names=await Promise.all(RPC.map(url=>this.rpc(url,'system_chain')));if(names.some(n=>n!=='Shiden'))throw new Error('Shiden以外のネットワークです');const provider=new HttpProvider(RPC[0],{},64);provider.send=(method,params)=>this.rpc(RPC[0],method,params);const api=new ApiPromise({provider,noInitWarn:true,throwOnConnect:true,rpcCacheCapacity:64});try{await api.isReadyOrError;this.api=api;}catch(e){await api.disconnect();throw e;}}
 async raw(key,hash,emptyVector=false){const data=await Promise.all(RPC.map(url=>this.rpc(url,'state_getStorage',[key,hash])));if(emptyVector&&data.every(v=>v===null))return '0x00';if(data[0]===null||data[0]!==data[1])throw new Error('RPC照合待ち：記録が一致しません');return data[0];}
 async context(hash){const versions=await Promise.all(RPC.map(url=>this.rpc(url,'state_getRuntimeVersion',[hash])));if(versions[0].specName!==versions[1].specName||versions[0].specVersion!==versions[1].specVersion||!SPECS.includes(versions[0].specVersion))throw new Error('runtimeの確認が必要です');const at=await this.api.at(hash);if(Number(at.runtimeVersion.specVersion)!==versions[0].specVersion)throw new Error('runtimeが一致しません');return at;}
 async snapshot(){await this.connect();const heads=await Promise.all(RPC.map(url=>this.rpc(url,'chain_getFinalizedHead'))),headers=await Promise.all(heads.map((h,i)=>this.rpc(RPC[i],'chain_getHeader',[h])));const height=Math.min(...headers.map(h=>Number.parseInt(h.number,16)));const hashes=await Promise.all(RPC.map(url=>this.rpc(url,'chain_getBlockHash',[height])));if(hashes[0]!==hashes[1])throw new Error('確定ブロックの照合待ち');const hash=hashes[0];
  if(this.lastSnapshot?.blockHash===hash)return {...this.lastSnapshot,fetchedAt:new Date().toISOString()};
  const at=await this.context(hash);const accountKey=at.query.system.account.key(this.walletAddress),authoredKey=at.query.collatorSelection.lastAuthoredBlock.key(this.walletAddress),timeKey=at.query.timestamp.now.key();
  const [accountHex,authoredHex,timeHex,locksHex]=await Promise.all([this.raw(accountKey,hash),this.raw(authoredKey,hash),this.raw(timeKey,hash),this.raw(at.query.balances.locks.key(this.walletAddress),hash,true)]);
  const info=at.registry.createType(at.registry.createLookupType(at.query.system.account.meta.type.asMap.value),accountHex),data=info.data;
  if(!data.frozen)throw new Error('残高形式の確認が必要です');
  const locks=at.registry.createType(at.registry.createLookupType(at.query.balances.locks.meta.type.asMap.value),locksHex);
  const values=balances({free:data.free.toString(),reserved:data.reserved.toString(),frozen:data.frozen.toString(),existentialDeposit:at.consts.balances.existentialDeposit.toString(),allLocked:locks.some(l=>l.amount.isMax())});
  const lastAuthoredBlock=at.registry.createType('BlockNumber',hexToU8a(authoredHex)).toString(),occurredAt=new Date(Number(at.registry.createType('Moment',hexToU8a(timeHex)).toString())).toISOString();
  this.lastSnapshot={address:this.walletAddress,blockNumber:String(height),blockHash:hash,lastAuthoredBlock,occurredAt,fetchedAt:new Date().toISOString(),rpcMatches:2,runtimeSpecVersion:Number(at.runtimeVersion.specVersion),...values};return this.lastSnapshot;
 }
 async record(block,finalized){if(BigInt(block)>BigInt(finalized))throw new Error('未確定ブロックです');const hashes=await Promise.all(RPC.map(url=>this.rpc(url,'chain_getBlockHash',[Number(block)])));if(hashes[0]!==hashes[1])throw new Error('生成ブロックの照合待ち');const hash=hashes[0],header=await this.rpc(RPC[0],'chain_getHeader',[hash]),parentHash=header.parentHash,at=await this.context(hash),before=await this.api.at(parentHash);
  const [eventHex,authoredHex,previousHex,timeHex]=await Promise.all([this.raw(at.query.system.events.key(),hash),this.raw(at.query.collatorSelection.lastAuthoredBlock.key(this.walletAddress),hash),this.raw(before.query.collatorSelection.lastAuthoredBlock.key(this.walletAddress),parentHash),this.raw(at.query.timestamp.now.key(),hash)]);
  const authored=at.registry.createType('BlockNumber',hexToU8a(authoredHex)).toString(),previous=before.registry.createType('BlockNumber',hexToU8a(previousHex)).toString();if(authored!==String(block)||BigInt(previous)>=BigInt(block))throw new Error('自ブロックの生成証拠が一致しません');
  const events=at.registry.createType('Vec<EventRecord>',eventHex),potHex=u8aToHex(decodeAddress(POT)),addressHex=u8aToHex(decodeAddress(this.walletAddress)),found=[];
  events.forEach((record,index)=>{const e=record.event;if(e.section==='balances'&&e.method==='Transfer'&&e.data[0].toHex()===potHex&&e.data[1].toHex()===addressHex)found.push({record,index});});
  if(found.length>1)throw new Error('報酬転送の確認が必要です');const hit=found[0];if(hit&&(!hit.record.phase.isInitialization||BigInt(hit.record.event.data[2].toString())<=0n))throw new Error('報酬イベント形式が一致しません');const rewardPlanck=hit?hit.record.event.data[2].toString():'0';
  return {mode:'live',eventId:'live:'+hash+':'+(hit?.index??'authored'),author:this.walletAddress,blockNumber:String(block),blockHash:hash,parentHash,occurredAt:new Date(Number(at.registry.createType('Moment',hexToU8a(timeHex)).toString())).toISOString(),rewardPlanck,transfer:hit?{from:POT,to:this.walletAddress,amountPlanck:rewardPlanck,eventIndex:hit.index,phase:'Initialization'}:null,evidence:{lastAuthoredBlock:authored,previousAuthoredBlock:previous,runtimeSpecVersion:Number(at.runtimeVersion.specVersion),rpcMatches:2}};
 }
 async poll(onSnapshot){const snapshot=await this.snapshot();onSnapshot(snapshot);if(!this.recovery){this.recovery=new Recovery(snapshot.blockNumber,{walletAddress:this.walletAddress});return null;}this.recovery.begin(snapshot);
  // Bound each pass; long outages can be reconciled across polls without accumulating full history in memory.
  for(let i=0;i<10&&this.recovery.target!==null&&this.recovery.before>this.recovery.cursor;i++){if(this.suspended)return null;const r=await this.record(this.recovery.before.toString(),this.recovery.target.toString());this.recovery.accept(r);}
  return this.recovery.finish();
 }
 suspend(){this.suspended=true;for(const c of this.controllers)c.abort();}
 resume(){this.suspended=false;}
 async close(){this.suspend();await this.api?.disconnect();this.api=null;}
}
