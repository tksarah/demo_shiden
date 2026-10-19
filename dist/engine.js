export const LOOP_MS=45000;
export const DEMO_REWARD='125000000000000000';
export const STAGES=[
 {key:'creating',at:0,pose:'craft',speech:'よし、つくろう！'},
 {key:'sending',at:9000,pose:'send',speech:'いってらっしゃい！'},
 {key:'verifying',at:15000,pose:'watch',speech:'どうかな…？'},
 {key:'accepted',at:25000,pose:'watch',speech:'つながった！'},
 {key:'reward',at:29000,pose:'joy',speech:'やったー！'},
 {key:'stowing',at:36000,pose:'wallet',speech:'こつこつ、貯めよう。'},
 {key:'rest',at:42000,pose:'idle',speech:''}
];
const TYPES=['block_authored','block_submitted','block_accepted','reward_confirmed'];
export function formatSDN(value,precision=3){
 const n=BigInt(value),unit=10n**18n;
 return (n/unit).toLocaleString('en-US')+(precision?'.'+(n%unit).toString().padStart(18,'0').slice(0,precision):'');
}
export class ShowEngine {
 constructor({mode='demo'}={}){if(!['demo','live','replay'].includes(mode))throw new Error('Invalid mode');this.mode=mode;this.reset();}
 reset(){this.elapsed=0;this.cycle=0;this.paused=false;this.total=0n;this.walletTotal=0n;this.currentReward=null;this.block=null;this.records=new Map();this.seen=new Set();this.floor=-1n;this.acceptedCount=0;this.stowedCount=0;}
 get stage(){return STAGES.findLast(s=>this.elapsed>=s.at);}
 get blockNumber(){return String(12345678+this.cycle);}
 applyEvent(e){
  if(!e||e.mode!==this.mode||typeof e.eventId!=='string'||!e.eventId||e.eventId.length>160||!Number.isFinite(Date.parse(e.occurredAt))||!TYPES.includes(e.type)||typeof e.blockNumber!=='string'||!/^\d{1,20}$/.test(e.blockNumber)||typeof e.rewardPlanck!=='string'||!/^\d{1,39}$/.test(e.rewardPlanck)||this.seen.has(e.eventId)||BigInt(e.blockNumber)<=this.floor)return false;
  const blockNumber=BigInt(e.blockNumber).toString();
  const record=this.records.get(blockNumber),step=TYPES.indexOf(e.type);
  if(step!==(record?.step??-1)+1)return false;
  if(step<3&&e.rewardPlanck!=='0')return false;
  if(!record&&this.records.size>=256){
   const first=this.records.entries().next().value;
   if(!first[1].stowed)return false;
   this.floor=BigInt(first[0])>this.floor?BigInt(first[0]):this.floor;
   this.records.delete(first[0]);
   for(const id of first[1].ids)this.seen.delete(id);
  }
  const next=record??{step:-1,ids:[],reward:null,stowed:false};
  next.step=step;next.ids.push(e.eventId);this.records.set(blockNumber,next);this.seen.add(e.eventId);
  if(step===0){this.block=blockNumber;this.currentReward=null;}
  if(step===2)this.acceptedCount++;
  if(step===3){next.reward=e.rewardPlanck;this.currentReward=e.rewardPlanck;this.total+=BigInt(e.rewardPlanck);}
  return true;
 }
 stow(blockNumber){if(typeof blockNumber!=='string'||!/^\d{1,20}$/.test(blockNumber))return false;const r=this.records.get(BigInt(blockNumber).toString());if(!r||r.step!==3||r.stowed)return false;r.stowed=true;this.walletTotal+=BigInt(r.reward);this.stowedCount++;return true;}
 demoEvent(type){const at={block_authored:9000,block_submitted:15000,block_accepted:25000,reward_confirmed:29000}[type];return {mode:'demo',eventId:`demo:${this.cycle}:${type}`,occurredAt:new Date(Date.UTC(2026,9,19)+this.cycle*LOOP_MS+at).toISOString(),type,blockNumber:this.blockNumber,rewardPlanck:type==='reward_confirmed'?DEMO_REWARD:'0'};}
 advance(ms){
  if(this.mode!=='demo'||this.paused||!Number.isFinite(ms)||ms<=0)return;
  let remaining=ms;
  while(remaining>0){
   const step=Math.min(remaining,LOOP_MS-this.elapsed),before=this.elapsed;this.elapsed+=step;remaining-=step;
   for(const [at,type] of [[9000,'block_authored'],[15000,'block_submitted'],[25000,'block_accepted'],[29000,'reward_confirmed']])if(before<at&&this.elapsed>=at)this.applyEvent(this.demoEvent(type));
   if(before<40000&&this.elapsed>=40000)this.stow(this.blockNumber);
   if(this.elapsed>=LOOP_MS){this.elapsed=0;this.cycle++;this.currentReward=null;this.block=null;}
  }
 }
}
