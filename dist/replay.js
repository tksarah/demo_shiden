
import {LOOP_MS,STAGES} from './engine.js';
export const MAX_IMPORT_BYTES=8*1024*1024;
const MAX_RECORDS=10000;
const statuses=new Set(['confirmed','confirmed_extra']);
const fail=message=>{throw new Error(message);};
const integer=(v,label)=>{if(typeof v==='number'){if(!Number.isSafeInteger(v)||v<0)fail(label+'が安全な整数ではありません。');return String(v);}if(typeof v!=='string'||!/^\d{1,20}$/.test(v))fail(label+'が不正です。');return BigInt(v).toString();};
const amount=(v,label)=>{if(typeof v!=='string'||!/^\d{1,39}$/.test(v))fail(label+'はPlanck単位の10進文字列が必要です。');return BigInt(v);};
const date=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value))||Date.parse(value)<Date.UTC(2020,0,1))fail('記録日時が不正です。');return new Date(value).toISOString();};
export function formatExactSDN(value){const n=BigInt(value),fraction=(n%10n**18n).toString().padStart(18,'0').replace(/0+$/,'');return (n/10n**18n).toLocaleString('en-US')+(fraction?'.'+fraction:'');}
export function parseGuardianJSON(text,{walletAddress}={}){
 if(!walletAddress)fail('リプレイには walletAddress の設定が必要です。');
 if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_IMPORT_BYTES)fail('JSONは8MB以内で読み込んでください。');
 let input;try{input=JSON.parse(text);}catch{fail('JSONとして読み込めません。Guardianの報酬APIの応答を指定してください。');}
 const pages=Array.isArray(input)?input:[input];
 if(!pages.length||pages.length>100)fail('読み込む報酬ページがありません。');
 const byBlock=new Map(),byHash=new Map(),fingerprints=new Map();let excluded=0,duplicates=0,rows=0,historyGap=false,partial=false;
 for(const page of pages){
  const s=page?.summary;
  if(!s||s.address!==walletAddress||s.schema_ok!==true||!Array.isArray(page.items))fail('Guardianの対応ウォレット・検証済みスキーマを含む報酬API JSONが必要です。');
  const finalized=BigInt(integer(s.finalized_block,'確定ブロック')),scanned=BigInt(integer(s.last_scanned_block,'走査ブロック'));
  historyGap ||=!!s.gap||s.last_history_gap?.history_recovered===false||!!s.sources?.historical_gap;
  partial ||=BigInt(integer(page.next_before_block??0,'次ページ'))>0n;
  for(const item of page.items){
   if(++rows>MAX_RECORDS)fail('一度に読み込める記録は10,000件までです。');
   if(!item||typeof item!=='object')fail('報酬記録が不正です。');
   const blockNumber=integer(item.block_number,'ブロック番号'),height=BigInt(blockNumber);
   if(height<=0n||height>finalized||height>scanned)fail('未確定または未走査のブロックが含まれています。');
   if(typeof item.block_hash!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(item.block_hash))fail('ブロックハッシュが不正です。');
   const blockHash=item.block_hash.toLowerCase(),authoredAt=date(item.authored_at);
   const expected=amount(item.expected_planck,'期待報酬'),credited=amount(item.credited_planck,'残高増分'),before=amount(item.wallet_before_planck,'入金前残高'),after=amount(item.wallet_after_planck,'入金後残高'),pot=amount(item.pot_before_planck,'報酬ポット');
   const signature=JSON.stringify([blockHash,authoredAt,expected.toString(),credited.toString(),before.toString(),after.toString(),pot.toString(),item.verification,item.evidence?.source]);
   if(fingerprints.has(blockNumber)){if(fingerprints.get(blockNumber)!==signature)fail('同じブロックに矛盾する記録があります。');duplicates++;continue;}
   if(byHash.has(blockHash)&&byHash.get(blockHash)!==blockNumber)fail('同じハッシュに異なるブロック番号があります。');
   fingerprints.set(blockNumber,signature);byHash.set(blockHash,blockNumber);
   if(!statuses.has(item.verification)){excluded++;continue;}
   if(item.evidence?.source!=='local'||!Number.isInteger(item.source_count)||item.source_count<1||item.source_count>3)fail('ローカル確定履歴の検証根拠を確認できません。');
   const calculated=(pot>1000000n?pot-1000000n:0n)/2n;
   if(expected<=0n||calculated!==expected||after<before||after-before!==credited||credited<expected||(item.verification==='confirmed'&&credited!==expected)||(item.verification==='confirmed_extra'&&credited<=expected))fail('報酬額・残高差分・検証結果が一致しません。');
   byBlock.set(blockNumber,Object.freeze({mode:'replay',eventId:'guardian:'+blockHash,blockNumber,blockHash,occurredAt:authoredAt,rewardPlanck:expected.toString(),creditedPlanck:credited.toString(),extraPlanck:(credited-expected).toString(),verification:item.verification,sourceCount:item.source_count}));
  }
 }
 const records=[...byBlock.values()].sort((a,b)=>BigInt(a.blockNumber)<BigInt(b.blockNumber)?-1:1);
 if(!records.length)fail('再生できる確認済み報酬がありません。confirmed / confirmed_extra の記録が必要です。');
 return Object.freeze({records:Object.freeze(records),excluded,duplicates,historyGap,partial,totalPlanck:records.reduce((n,r)=>n+BigInt(r.rewardPlanck),0n).toString()});
}
export class ReplayEngine{
 constructor(dataset){this.mode='replay';this.dataset=dataset;this.reset();}
 reset(){this.elapsed=0;this.cycle=0;this.paused=false;this.total=0n;this.walletTotal=0n;this.acceptedCount=0;this.stowedCount=0;this.seen=new Set();this.records=new Map();this.currentReward=null;}
 get record(){return this.dataset.records[this.cycle%this.dataset.records.length];}
 get recordIndex(){return this.cycle%this.dataset.records.length;}
 get blockNumber(){return this.record.blockNumber;}
 get stage(){return STAGES.findLast(s=>this.elapsed>=s.at);}
 get repeated(){return this.cycle>=this.dataset.records.length;}
 get creditFresh(){return !this.repeated;}
 advance(ms){
  if(this.paused||!Number.isFinite(ms)||ms<=0)return;
  let remaining=ms;
  while(remaining>0){
   const step=Math.min(remaining,LOOP_MS-this.elapsed),before=this.elapsed;this.elapsed+=step;remaining-=step;
   const r=this.record,id=r.eventId;
   if(before<25000&&this.elapsed>=25000&&!this.seen.has(id+':accepted')){this.seen.add(id+':accepted');this.acceptedCount++;}
   if(before<29000&&this.elapsed>=29000){this.currentReward=r.rewardPlanck;if(!this.seen.has(id+':reward')){this.seen.add(id+':reward');this.total+=BigInt(r.rewardPlanck);}}
   if(before<40000&&this.elapsed>=40000&&!this.seen.has(id+':stowed')){this.seen.add(id+':stowed');this.walletTotal+=BigInt(r.rewardPlanck);this.stowedCount++;this.records.set(r.blockNumber,r);}
   if(this.elapsed>=LOOP_MS){this.elapsed=0;this.cycle++;this.currentReward=null;}
  }
 }
}

export const POT_ADDRESS='YQnbw3h6couUX48Ghs3qyzhdbyxA3Gu9KQCoi8z2CPBf9N3';
export function parseReplayJSON(text,{walletAddress}={}){
 if(!walletAddress)fail('リプレイには walletAddress の設定が必要です。');
 if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_IMPORT_BYTES)fail('JSONは8MB以内で読み込んでください。');
 let input;try{input=JSON.parse(text);}catch{fail('JSONを読み込めません。');}
 if(input?.schema!=='shiden-collator-replay/v1')return {...parseGuardianJSON(text,{walletAddress}),sourceKind:'guardian',fixture:input?.fixture===true};
 const s=input.source;
 if(input.network!=='shiden'||input.address!==walletAddress||s?.kind!=='chain'||s.verification!=='two-rpc-finalized-transfer-authorship'||!Array.isArray(s.rpcSources)||new Set(s.rpcSources).size!==2||s.rpcSources.some(x=>typeof x!=='string'||!x.startsWith('https://')))fail('Shidenの2系統照合済み転送記録が必要です。');
 const finalized=BigInt(integer(s.finalizedBlock,'確定ブロック'));date(s.fetchedAt);
 if(!Array.isArray(input.records)||!input.records.length||input.records.length>MAX_RECORDS)fail('記録数は1〜10,000件です。');
 const blocks=new Map(),hashes=new Set();let duplicates=0;
 for(const r of input.records){
  const blockNumber=integer(r.blockNumber,'ブロック番号'),height=BigInt(blockNumber),reward=amount(r.rewardPlanck,'報酬');
  if(height<=0n||height>finalized||typeof r.blockHash!=='string'||!/^0x[0-9a-f]{64}$/.test(r.blockHash)||typeof r.parentHash!=='string'||!/^0x[0-9a-f]{64}$/.test(r.parentHash))fail('ブロックの確定情報が不正です。');
  const occurredAt=date(r.occurredAt),t=r.transfer,e=r.evidence;
  if(r.author!==walletAddress||t?.from!==POT_ADDRESS||t.to!==walletAddress||amount(t.amountPlanck,'転送額')!==reward||reward<=0n||!Number.isInteger(t.eventIndex)||t.eventIndex<0||t.phase!=='Initialization')fail('PotStakeからの報酬転送を確認できません。');
  if(e?.rpcMatches!==2||integer(e.lastAuthoredBlock,'生成ブロック')!==blockNumber||BigInt(integer(e.previousAuthoredBlock,'前回生成ブロック'))>=height||![2208,2300,2400,2500].includes(e.runtimeSpecVersion))fail('自ブロックの検証根拠が不正です。');
  const normalized={mode:'replay',eventId:'chain:'+r.blockHash+':'+t.eventIndex,blockNumber,blockHash:r.blockHash,occurredAt,rewardPlanck:reward.toString(),extraPlanck:'0',sourceCount:2,eventIndex:t.eventIndex};
  if(blocks.has(blockNumber)){if(JSON.stringify(blocks.get(blockNumber))!==JSON.stringify(normalized))fail('同じブロックに矛盾する記録があります。');duplicates++;continue;}
  if(hashes.has(r.blockHash))fail('重複ハッシュのブロック番号が一致しません。');
  blocks.set(blockNumber,Object.freeze(normalized));hashes.add(r.blockHash);
 }
 const records=Object.freeze([...blocks.values()].sort((a,b)=>BigInt(a.blockNumber)<BigInt(b.blockNumber)?-1:1));
 return Object.freeze({records,excluded:0,duplicates,historyGap:false,partial:true,totalPlanck:records.reduce((n,r)=>n+BigInt(r.rewardPlanck),0n).toString(),sourceKind:'chain',fetchedAt:s.fetchedAt,fixture:input.fixture===true});
}
