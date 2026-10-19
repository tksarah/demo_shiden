import test from 'node:test';
import assert from 'node:assert/strict';
import {ShowEngine,LOOP_MS,DEMO_REWARD,formatSDN} from '../dist/engine.js';
test('authorship, submission, adoption, receipt and stowing have separate boundaries',()=>{
 const e=new ShowEngine();e.advance(8999);assert.equal(e.block,null);e.advance(1);assert.equal(e.block,'12345678');assert.equal(e.records.get(e.block).step,0);
 e.advance(6000);assert.equal(e.stage.key,'verifying');assert.equal(e.records.get(e.block).step,1);assert.equal(e.acceptedCount,0);assert.equal(e.total,0n);assert.equal(e.walletTotal,0n);
 e.advance(9999);assert.equal(e.acceptedCount,0);e.advance(1);assert.equal(e.stage.key,'accepted');assert.equal(e.acceptedCount,1);assert.equal(e.total,0n);
 e.advance(4000);assert.equal(e.total,BigInt(DEMO_REWARD));assert.equal(e.walletTotal,0n);e.advance(10999);assert.equal(e.walletTotal,0n);
 e.advance(1);assert.equal(e.walletTotal,BigInt(DEMO_REWARD));assert.equal(e.total,e.walletTotal);assert.equal(e.stowedCount,1);
});
test('out-of-order and duplicate events cannot invent rewards',()=>{
 const e=new ShowEngine(),events=['block_authored','block_submitted','block_accepted','reward_confirmed'].map(t=>e.demoEvent(t));
 assert.equal(e.applyEvent(events[3]),false);assert.equal(e.applyEvent(events[2]),false);assert.equal(e.stow('12345678'),false);
 for(const event of events){assert.equal(e.applyEvent(event),true);assert.equal(e.applyEvent(event),false);assert.equal(e.applyEvent({...event,eventId:'other-'+event.eventId}),false);}
 assert.equal(e.total,BigInt(DEMO_REWARD));assert.equal(e.stow('12345678'),true);assert.equal(e.stow('12345678'),false);assert.equal(e.walletTotal,e.total);
});
test('every phase pauses without advancing the ledger or clock',()=>{
 for(const ms of [4000,11000,19000,27000,32000,38000,43000]){const e=new ShowEngine();e.advance(ms);const saved=[e.elapsed,e.total,e.walletTotal,e.acceptedCount];e.paused=true;e.advance(100000);assert.deepEqual([e.elapsed,e.total,e.walletTotal,e.acceptedCount],saved);e.paused=false;e.advance(100);assert.equal(e.elapsed,ms+100);}
});
test('reset clears the performance and counters',()=>{const e=new ShowEngine();e.advance(41000);e.paused=true;e.reset();assert.equal(e.elapsed,0);assert.equal(e.total,0n);assert.equal(e.walletTotal,0n);assert.equal(e.paused,false);assert.equal(e.seen.size,0);});
test('30 simulated minutes: forty complete loops and exact 5 SDN',()=>{const e=new ShowEngine();for(let i=0;i<108000;i++)e.advance(1000/60);assert.ok(Math.abs(e.cycle*LOOP_MS+e.elapsed-1800000)<.01);assert.equal(e.acceptedCount,40);assert.equal(e.stowedCount,40);assert.equal(e.walletTotal,5000000000000000000n);assert.equal(e.total,e.walletTotal);});
test('24 hours remain bounded and expired duplicates stay rejected',()=>{const e=new ShowEngine(),old=e.demoEvent('block_authored');e.advance(24*3600000);assert.equal(e.cycle,1920);assert.equal(e.walletTotal,240000000000000000000n);assert.equal(e.records.size,256);assert.equal(e.seen.size,1024);assert.equal(e.applyEvent(old),false);assert.equal(e.applyEvent({...old,eventId:'old-renamed'}),false);});
test('large time jumps process every boundary in order',()=>{const e=new ShowEngine();e.advance(LOOP_MS*39+41000);assert.equal(e.stowedCount,40);assert.equal(e.walletTotal,5000000000000000000n);assert.equal(e.stage.key,'stowing');});
test('decimal strings retain precision',()=>{assert.equal(formatSDN(DEMO_REWARD),'0.125');assert.equal(formatSDN('123456789123456789123456789',18),'123,456,789.123456789123456789');});
test('malformed, mismatched or unconfirmed input is rejected',()=>{const e=new ShowEngine(),v=e.demoEvent('block_authored');for(const x of [{...v,mode:'live'},{...v,mode:'unknown'},{...v,eventId:''},{...v,rewardPlanck:'1e18'},{...v,rewardPlanck:'-1'},{...v,rewardPlanck:'10'},{...v,rewardPlanck:0},{...v,blockNumber:123},{...v,occurredAt:'bad'},{...v,type:'reward_expected'}])assert.equal(e.applyEvent(x),false);assert.equal(e.total,0n);});
test('live and replay cannot manufacture events from the demo clock',()=>{for(const mode of ['live','replay']){const e=new ShowEngine({mode});e.advance(45000);assert.equal(e.elapsed,0);assert.equal(e.records.size,0);assert.equal(e.total,0n);}});

test('alternate decimal formatting cannot bypass block deduplication',()=>{const e=new ShowEngine();for(const type of ['block_authored','block_submitted','block_accepted','reward_confirmed'])assert.equal(e.applyEvent(e.demoEvent(type)),true);for(const type of ['block_authored','block_submitted','block_accepted','reward_confirmed'])assert.equal(e.applyEvent({...e.demoEvent(type),eventId:'alias:'+type,blockNumber:'012345678'}),false);assert.equal(e.stow('012345678'),true);assert.equal(e.stow('12345678'),false);assert.equal(e.total,BigInt(DEMO_REWARD));assert.equal(e.walletTotal,e.total);});
