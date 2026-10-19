import {STAGES,LOOP_MS} from './engine.js';
export const POT='YQnbw3h6couUX48Ghs3qyzhdbyxA3Gu9KQCoi8z2CPBf9N3';
export const RPC=['https://shiden-rpc.n.dwellir.com','https://evm.shiden.astar.network'];
export const SPECS=[2208,2300,2400,2500];
const idle=Object.freeze({key:'idle',pose:'idle',speech:'次の出番を待とう。'});
const noReward=Object.freeze({key:'rest',pose:'idle',speech:'つながった！'});
export function roundedSDN(value,digits=4){
 const n=BigInt(value),negative=n<0n,abs=negative?-n:n,unit=10n**BigInt(18-digits),rounded=(abs+unit/2n)/unit,scale=10n**BigInt(digits);
 return (negative?'-':'')+(rounded/scale).toLocaleString('en-US')+(digits?'.'+(rounded%scale).toString().padStart(digits,'0'):'');
}
export function balances({free,reserved,frozen,existentialDeposit,allLocked=false}){
 const f=BigInt(free),r=BigInt(reserved),z=BigInt(frozen),ed=BigInt(existentialDeposit);
 if([f,r,z,ed].some(n=>n<0n))throw new Error('Invalid balance');
 const minimum=z===0n&&r===0n?0n:ed,held=z-r>minimum?z-r:minimum;
 return {freePlanck:f.toString(),reservedPlanck:r.toString(),frozenPlanck:z.toString(),totalPlanck:(f+r).toString(),transferablePlanck:(allLocked||f<held?0n:f-held).toString()};
}
export function validateLiveRecord(r,walletAddress){
 if(!walletAddress||!r||r.mode!=='live'||r.author!==walletAddress||!/^\d+$/.test(r.blockNumber)||BigInt(r.blockNumber)<=0n||!/^0x[0-9a-f]{64}$/.test(r.blockHash)||!Number.isFinite(Date.parse(r.occurredAt))||!/^\d{1,39}$/.test(r.rewardPlanck)||r.evidence?.rpcMatches!==2||!SPECS.includes(r.evidence.runtimeSpecVersion)||r.evidence.lastAuthoredBlock!==r.blockNumber||BigInt(r.evidence.previousAuthoredBlock)>=BigInt(r.blockNumber))throw new Error('Invalid live authorship');
 if(BigInt(r.rewardPlanck)>0n&&(!r.transfer||r.transfer.from!==POT||r.transfer.to!==walletAddress||r.transfer.amountPlanck!==r.rewardPlanck||r.transfer.phase!=='Initialization'||!Number.isSafeInteger(r.transfer.eventIndex)||r.transfer.eventIndex<0))throw new Error('Invalid live reward');
 const expected='live:'+r.blockHash+':'+(r.transfer?.eventIndex??'authored');if(r.eventId!==expected)throw new Error('Invalid event identifier');
 return r;
}
export class LiveEngine{
 constructor({walletAddress=null}={}){this.walletAddress=walletAddress;this.mode='live';this.snapshot=null;this.displaySnapshot=null;this.queue=[];this.record=null;this.lastRecord=null;this.floor=0n;this.seen=new Set();this.records=new Map();this.skippedCount=0;this.skippedPlanck=0n;this.total=0n;this.walletTotal=0n;this.acceptedCount=0;this.stowedCount=0;this.elapsed=0;this.cycle=0;this.paused=false;}
 get stage(){return !this.record?idle:BigInt(this.record.rewardPlanck)===0n&&this.elapsed>=29000?noReward:STAGES.findLast(s=>this.elapsed>=s.at);}
 get blockNumber(){return this.record?.blockNumber??this.lastRecord?.blockNumber??'';}
 get creditFresh(){return true;}
 get currentReward(){return this.record&&this.elapsed>=29000?this.record.rewardPlanck:null;}
 setSnapshot(s){if(!this.walletAddress||!s||s.address!==this.walletAddress||s.rpcMatches!==2||!/^\d+$/.test(s.blockNumber)||!/^\d+$/.test(s.totalPlanck)||BigInt(s.totalPlanck)!==BigInt(s.freePlanck)+BigInt(s.reservedPlanck))throw new Error('Invalid live snapshot');if(this.snapshot&&BigInt(s.blockNumber)<BigInt(this.snapshot.blockNumber))return false;this.snapshot=s;return true;}
 // A snapshot reaches the headline only after its authorship interval is reconciled.
 // The latest on-chain value remains available in snapshot for the detail dialog.
 reconcileBalance(verifiedThroughBlock){
  const s=this.snapshot;if(!s||!/^\d+$/.test(String(verifiedThroughBlock))||!/^\d+$/.test(s.lastAuthoredBlock??''))return false;
  if(BigInt(s.lastAuthoredBlock)>BigInt(verifiedThroughBlock))return false;
  this.displaySnapshot=s;return true;
 }
 get pendingDisplayPlanck(){
  const s=this.displaySnapshot;if(!s)return 0n;
  const pending=[...this.queue,...(this.record&&this.elapsed<42000?[this.record]:[])];
  return pending.reduce((sum,r)=>sum+(BigInt(r.blockNumber)<=BigInt(s.blockNumber)?BigInt(r.rewardPlanck):0n),0n);
 }
 get displayedBalancePlanck(){
  if(!this.displaySnapshot)return null;
  const value=BigInt(this.displaySnapshot.totalPlanck)-this.pendingDisplayPlanck;
  return value<0n?0n:value;
 }
 ingest(records,{count=0,rewardPlanck='0'}={}){
  // Validate the complete incoming batch before changing the queue or deduplication watermark.
  const sorted=records.map(r=>validateLiveRecord(r,this.walletAddress)).sort((a,b)=>BigInt(a.blockNumber)<BigInt(b.blockNumber)?-1:1),unique=[];
  for(const r of sorted){const other=unique.at(-1);if(other?.blockNumber===r.blockNumber){if(JSON.stringify(other)!==JSON.stringify(r))throw new Error('Conflicting live records');continue;}unique.push(r);}
  for(const r of unique){if(BigInt(r.blockNumber)<=this.floor)continue;this.floor=BigInt(r.blockNumber);this.queue.push(r);}
  this.skippedCount+=count;this.skippedPlanck+=BigInt(rewardPlanck);
  while(this.queue.length>3){const r=this.queue.shift();this.skippedCount++;this.skippedPlanck+=BigInt(r.rewardPlanck);}
  if(!this.paused&&!this.record)this.next();
 }
 next(){this.record=this.queue.shift()??null;this.elapsed=0;this.cycle++;this.seen.clear();this.records.clear();if(this.record)this.lastRecord=this.record;}
 advance(ms){if(this.paused||!Number.isFinite(ms)||ms<=0)return;if(!this.record&&this.queue.length)this.next();let remaining=ms;while(this.record&&remaining>0){const before=this.elapsed,step=Math.min(remaining,LOOP_MS-before);this.elapsed+=step;remaining-=step;const r=this.record;
  if(before<25000&&this.elapsed>=25000){this.acceptedCount++;this.seen.add(r.eventId+':accepted');}
  if(before<29000&&this.elapsed>=29000&&BigInt(r.rewardPlanck)>0n){this.total+=BigInt(r.rewardPlanck);this.seen.add(r.eventId+':reward');}
  if(before<40000&&this.elapsed>=40000&&BigInt(r.rewardPlanck)>0n){this.walletTotal+=BigInt(r.rewardPlanck);this.stowedCount++;this.seen.add(r.eventId+':stowed');this.records.set(r.blockNumber,r);}
  if(this.elapsed===LOOP_MS)this.next();
 }}
 reset(){this.record=null;this.lastRecord=null;this.queue=[];this.elapsed=0;this.cycle++;this.paused=false;this.total=0n;this.walletTotal=0n;this.acceptedCount=0;this.stowedCount=0;this.skippedCount=0;this.skippedPlanck=0n;this.seen.clear();this.records.clear();}
}
// Recovery is read newest-to-oldest, but commits its cursor only after the whole interval is verified.
export class Recovery{
 constructor(cursor,{walletAddress}={}){this.walletAddress=walletAddress;this.cursor=BigInt(cursor);this.target=null;this.before=null;this.recent=[];this.count=0;this.reward=0n;}
 begin(snapshot){if(this.target===null&&BigInt(snapshot.lastAuthoredBlock)>this.cursor){this.target=BigInt(snapshot.blockNumber);this.before=BigInt(snapshot.lastAuthoredBlock);}}
 accept(record){validateLiveRecord(record,this.walletAddress);if(BigInt(record.blockNumber)!==this.before)throw new Error('Recovery order mismatch');if(this.recent.length<3)this.recent.push(record);else{this.count++;this.reward+=BigInt(record.rewardPlanck);}this.before=BigInt(record.evidence.previousAuthoredBlock);}
 finish(){if(this.target===null||this.before>this.cursor)return null;const result={records:this.recent.slice().reverse(),skipped:{count:this.count,rewardPlanck:this.reward.toString()}};this.cursor=this.target;this.target=null;this.before=null;this.recent=[];this.count=0;this.reward=0n;return result;}
}
