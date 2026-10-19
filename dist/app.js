import {ShowEngine,LOOP_MS,STAGES,formatSDN} from './engine.js';
import {buildWorld} from './world.js';
import {ReplayEngine,parseReplayJSON,formatExactSDN,MAX_IMPORT_BYTES} from './replay.js';
import {LiveEngine,roundedSDN} from './live-core.js';
import {LiveSession} from './live-session.js';
import {loadBrowserConfig} from './config.js';
const configuration=await loadBrowserConfig();
const walletAddress=configuration.walletAddress;
const $=id=>document.getElementById(id);
const app=$('app'),world=$('world'),cinema=$('cinema');
const liveEngine=new LiveEngine({walletAddress});let engine=walletAddress?liveEngine:new ShowEngine();
if(configuration.error){const notice=document.createElement('p');notice.className='config-error';notice.setAttribute('role','alert');notice.textContent=configuration.error;document.querySelector('header').after(notice);}
$('use-live').disabled=!walletAddress;
$('use-live').title=walletAddress?'ライブ表示':'config.local.json に公開アドレスを設定してください';
const speechCaption=document.createElement('p');speechCaption.className='speech-caption';speechCaption.setAttribute('aria-hidden','true');document.querySelector('.readout').before(speechCaption);
let liveStatus={state:'connecting',lastSuccess:null},balanceFrom=0n,balanceTarget=0n,balanceAt=0,balanceShown=0n;
const liveSession=new LiveSession({createReader:async()=>{const {ChainReader}=await import('./live-rpc.js');return new ChainReader({walletAddress});},onSnapshot:s=>{liveEngine.setSnapshot(s);updateReplayInfo();},onBatch:b=>{liveEngine.ingest(b.records,b.skipped);updateReplayInfo();},onStatus:s=>{liveStatus=s;liveEngine.reconcileBalance(s.verifiedThroughBlock);updateReplayInfo();}});
const poses=['idle','craft','send','watch','joy','wallet'];
const media=matchMedia('(prefers-reduced-motion: reduce)');
let reduced=media.matches,ready=false,sound=false,context,activeSounds=[],previous=performance.now(),lastPhase='',lastCycle=-1,toastTimer,startedAt=0,frames=0,activeMs=0,errors=0,maxFrameGap=0,lastReport=0,previousPose='idle',currentPose='idle',poseChangedAt=0,lastWallet='0.000';
const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
const ease=n=>{const v=clamp(n);return v*v*(3-2*v);};
const mix=(a,b,t)=>a+(b-a)*t;
const bezier=(a,b,c,t)=>[(1-t)**2*a[0]+2*(1-t)*t*b[0]+t*t*c[0],(1-t)**2*a[1]+2*(1-t)*t*b[1]+t*t*c[1]];
let el={};
function opacity(id,value){el[id].setAttribute('opacity',String(clamp(value)));}
function transform(id,value){el[id].setAttribute('transform',value);}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3500);}
function setReduced(value){reduced=value;app.classList.toggle('reduced',value);$('motion').setAttribute('aria-pressed',String(value));$('motion').setAttribute('aria-label',value?'通常の動きに戻す':'動きを抑える');$('motion').title=value?'動き控えめ ON':'動きを抑える';}
setReduced(reduced);media.addEventListener('change',e=>setReduced(e.matches));
function audioAvailable(){return sound&&context&&context.state==='running'&&!engine.paused&&!document.hidden;}
function tone(freq,delay,duration,volume){if(!audioAvailable())return;const start=context.currentTime+delay,o=context.createOscillator(),g=context.createGain();o.type='sine';o.frequency.value=freq;g.gain.setValueAtTime(0,start);g.gain.linearRampToValueAtTime(volume,start+.02);g.gain.exponentialRampToValueAtTime(.0001,start+duration);o.connect(g);g.connect(context.destination);o.onended=()=>{o.disconnect();g.disconnect();activeSounds=activeSounds.filter(x=>x!==o);};activeSounds.push(o);o.start(start);o.stop(start+duration+.02);}
function chime(kind){if(kind==='accepted'){tone(659,0,.35,.035);tone(880,.12,.5,.025);}if(kind==='reward')[523,659,784].forEach((f,i)=>tone(f,i*.12,.5,.04));if(kind==='stowed'){tone(1175,0,.16,.035);tone(1568,.08,.23,.02);}}
function stopSounds(){activeSounds.forEach(o=>{try{o.stop();}catch{}});activeSounds=[];}
async function syncAudio(){if(!context)return;try{if(engine.paused||document.hidden||!sound)await context.suspend();else await context.resume();}catch{}}
function updatePause(){const label=engine.paused?'再生する':'一時停止';$('pause').setAttribute('aria-label',label);$('play-icon').textContent=engine.paused?'▶':'Ⅱ';app.classList.toggle('paused',engine.paused);syncAudio();}
function setPose(next,t){if(next!==currentPose){previousPose=currentPose;currentPose=next;poseChangedAt=t;}const ratio=reduced?1:ease((t-poseChangedAt)/.28);for(const p of poses){opacity('pose-'+p,p===currentPose?ratio:p===previousPose?1-ratio:0);}}
function draw(){
 const t=engine.elapsed/1000,ambient=activeMs/1000,phase=engine.stage.key,stageIndex=STAGES.indexOf(engine.stage);
 if(lastCycle!==engine.cycle){previousPose='idle';currentPose='idle';poseChangedAt=t;lastCycle=engine.cycle;lastPhase='';updateReplayInfo();}
 if(lastPhase!==phase){
  el['speech-text'].textContent=engine.stage.speech;
  speechCaption.textContent=engine.stage.speech;
  el['network-status'].textContent=phase==='verifying'?'検証中…':phase==='accepted'?'採用！':'';
  cinema.dataset.phase=phase;cinema.dataset.cycle=String(engine.cycle);
  $('announcer').textContent=({idle:'新しいブロックを待っています',creating:'Magiがブロックを生成しています',sending:'ブロックをShiden Networkへ送っています',verifying:'ネットワークが受け取り、検証と採用を待っています',accepted:'検証が終わり、ブロックがチェーンに採用されました',reward:'確認済みのSDN報酬を受け取りました',stowing:'受け取ったSDNをお財布へしまいます',rest:'次のブロックを作る準備をしています'})[phase];
  if(phase==='accepted'||phase==='reward')chime(phase);
  lastPhase=phase;
 }
 const wanted=t<1.6?'idle':engine.stage.pose;
 setPose(wanted,phase==='idle'?activeMs/1000:t);
 let dx=0,dy=0,rotation=0,sx=1,sy=1;
 if(!reduced){
  if(phase==='creating'){rotation=Math.sin(t*1.35)*.45;sy=1+Math.sin(t*2)*.003;}
  if(phase==='sending'){const v=clamp((t-9)/1.1);rotation=-2*Math.sin(v*Math.PI);dx=-8*Math.sin(v*Math.PI);}
  if(phase==='verifying'){rotation=1.3*Math.sin((t-15)*1.35);dx=2*Math.sin(t*1.4);dy=-Math.abs(Math.sin(t*1.2))*2;}
  if(phase==='accepted'){rotation=-1.4*Math.sin((t-25)*2);}
  if(phase==='reward'){const jump=t>32?Math.max(0,Math.sin((t-32)*Math.PI/1.3)):0;dy=-22*jump;rotation=jump*1.7;sy=1-jump*.012;}
  if(phase==='stowing'){dx=5*ease((t-36)/1.5);rotation=1.2*ease((t-36)/1.5);}
  if(phase==='rest'){rotation=.3*Math.sin(t*2);}
 }
 transform('character',`translate(${dx} ${dy}) translate(350 742) rotate(${rotation}) scale(${sx} ${sy}) translate(-350 -742)`);
 // Output-masked fabric layers move independently; the body, staff and boots stay registered.
 el['idle-fabric'].setAttribute('filter',phase==='idle'&&!reduced?'url(#idle-breeze)':'none');
 el['hair-wind'].setAttribute('dx',String(Math.sin(ambient*.85)*92));el['hair-wind'].setAttribute('dy',String(Math.cos(ambient*.7)*143));
 el['cape-wind'].setAttribute('dx',String(Math.sin(ambient*.98+1.7)*84));el['cape-wind'].setAttribute('dy',String(Math.cos(ambient*.9+.9)*121));
 // Only the eyelid regions change; the original face, hair and body remain registered.
 const blinkTime=ambient%13.7;
 const blink=Math.max(...[2.8,7.15,7.51,12.1].map(at=>ease((blinkTime-at)/.055)*(1-ease((blinkTime-at-.12)/.09))));
 opacity('idle-blink',phase==='idle'&&!reduced?blink:0);
 opacity('idle-motes',phase==='idle'&&!reduced?.45:0);
 for(let i=0;i<3;i++){const a=ambient*.48+i*2.1;transform('idle-mote-'+i,`translate(${234+Math.cos(a)*39} ${310+Math.sin(a)*31}) scale(${.22+(Math.sin(a+1)+1)*.04})`);opacity('idle-mote-'+i,.25+(Math.sin(a*.7)+1)*.25);}
 // Ambient traffic stays on the existing chain and never implies a new authored/reward event.
 opacity('network-activity',reduced?0:1);
 const links=[[[1000,365],[1075,345]],[[1165,345],[1240,365]],[[1330,365],[1390,345]]];
 for(let i=0;i<3;i++){const q=(ambient/6.8-i*.31+3)%1,[a,b]=links[i];transform('chain-pulse-'+i,`translate(${mix(a[0],b[0],q)} ${mix(a[1],b[1],q)})`);opacity('chain-pulse-'+i,Math.sin(q*Math.PI)*.65);}
 const orbit=ambient*Math.PI/38-1.57;transform('network-orbit',`translate(${1100+Math.cos(orbit)*325} ${363+Math.sin(orbit)*205})`);
 // Each asset retains a registered feet baseline; the crouched pose is shorter.
 for(const p of poses){const image=el['pose-'+p].querySelector('image');if(p==='wallet'){image.setAttribute('x','105');image.setAttribute('y','242');image.setAttribute('height','500');image.setAttribute('width','620');}else if(p==='send'){image.setAttribute('x','30');image.setAttribute('width','700');}}
 opacity('speech',engine.stage.speech?1:0);
 if(!reduced){const a=Math.sin(ambient*.6)*.08+.32;el['magic-floor'].setAttribute('opacity',String(a+((phase==='creating')?.35:0)));transform('magic-pool',`translate(366 754) scale(${1+Math.sin(ambient)*.018} 1) translate(-366 -754)`);}else{el['magic-floor'].setAttribute('opacity','.55');transform('magic-pool','');}
 for(let i=0;i<75;i++)opacity('star-'+i,reduced?.35:.19+(Math.sin(ambient*.6+i*2.4)+1)*.22);
 // Magic data pieces converge into a single candidate block.
 for(let i=0;i<15;i++){
  let a=0,x=0,y=0,s=1;
  if(t>=1.8&&t<8.7){const q=((t-1.8)*.37+i/15)%1;const from=[310+(i%5-2)*28,502+(i%3-1)*20];[x,y]=bezier(from,[410+i*5,210-i*7],[640,260],ease(q));a=Math.sin(q*Math.PI)*clamp((8.7-t)/.7);s=.7+q*.2;}
  if(reduced)a=0;
  opacity('data-'+i,a);transform('data-'+i,`translate(${x} ${y}) rotate(${t*20+i*23}) scale(${s})`);
 }
 let bx=640,by=260,bs=.72,ba=0;
 if(t>=3&&t<9){const v=ease((t-3)/6);ba=v;bs=.25+v*.47;by=260-(reduced?0:Math.sin(t*2)*3);}
 if(t>=9&&t<15){const q=reduced?1:ease((t-9)/5.5);[bx,by]=bezier([640,260],[745,168],[830,367],q);ba=1;}
 if(t>=15){bx=830;by=367;bs=.72;ba=t<42?1:1-ease((t-42)/2);}
 if(phase==='verifying'&&!reduced)by+=Math.sin((t-15)*2)*4;
 if(t>=25)bs=.72+.1*ease((t-25)/.7);
 transform('candidate',`translate(${bx} ${by}) scale(${bs})`);opacity('candidate',ba);
 transform('candidate-glow',`translate(${bx} ${by})`);opacity('candidate-glow',ba*(phase==='verifying'?.5:.8));
 opacity('flight-trail',phase==='sending'&&!reduced?Math.sin(clamp((t-9)/6)*Math.PI)*.75:0);
 opacity('inspection-ring',phase==='verifying'?.65:0);
 transform('inspection-ring',`rotate(${reduced?0:(t-15)*25} 830 367)`);
 for(let i=0;i<3;i++){
  const verified=t>=25;const live=phase==='verifying'&&(Math.floor((t-15)/1.6)%3===i);
  opacity('validation-light-'+i,verified?.8:reduced&&phase==='verifying'?.45:live?.85:.13);opacity('validation-check-'+i,verified?1:0);
 }
 opacity('adoption-link',t>=25&&t<42?1:0);
 const pulse=clamp((t-25)/1.3);opacity('adopted-burst',phase==='accepted'&&!reduced?(1-pulse)*.8:0);transform('adopted-burst',`translate(830 367) scale(${1+pulse*.8})`);
 // Three visible coins represent the one confirmed reward, never three payments.
 const hasReward=engine.mode!=='live'||!!engine.record&&BigInt(engine.record.rewardPlanck)>0n;
 opacity('reward-ray',hasReward&&t>=29&&t<32&&!reduced?.7:0);
 for(let i=0;i<3;i++){
  let a=0,x=330+(i-1)*16,y=420-(i===1?12:0),scale=.68;
  if(hasReward&&t>=29+i*.24&&t<36){
   const q=reduced?1:ease((t-29-i*.24)/2.5);
   [x,y]=bezier([1120+i*20,452],[800,650-i*35],[330+(i-1)*16,420-(i===1?12:0)],q);
   a=1;if(q===1)y+=dy;
  }
  opacity('reward-coin-'+i,a);transform('reward-coin-'+i,`translate(${x} ${y}) scale(${scale})`);
 }
 // Stowing is presentation of the received reward, not another chain event.
 let coinA=0,cx=330,cy=420;
 if(hasReward&&t>=36&&t<40){
  coinA=1;const q=reduced?1:ease((t-36)/4);
  [cx,cy]=bezier([330,420],[535,485],[610,692],q);
 }
 opacity('deposit-coin',coinA);transform('deposit-coin',`translate(${cx} ${cy}) scale(.72)`);
 const open=hasReward&&(t>=36&&t<40.5)?(reduced?1:ease((t-36)/.55)*(1-ease((t-40)/.5))):0;
 transform('purse-lid',`translate(0 ${open*18})`);transform('purse-back',`translate(0 ${-open*9})`);opacity('purse-opening',open);
 const plump=hasReward&&t>=40&&t<42&&!reduced?Math.sin(clamp((t-40)/1.2)*Math.PI)*.07:0;
 transform('purse',`translate(610 719) scale(${1+plump} ${1+plump*.55})`);
 const shown=engine.walletTotal.toString();if(shown!==lastWallet){if(engine.walletTotal>0n)chime('stowed');lastWallet=shown;}
 const celebrating=hasReward&&t>=29&&t<36;opacity('celebration',celebrating?1:0);
 for(let i=0;i<12;i++){const theta=i*Math.PI*2/12;const radius=130+(reduced?0:Math.sin(t*1.7+i)*17);const x=350+Math.cos(theta)*radius*1.25,y=440+Math.sin(theta)*radius;transform('spark-'+i,`translate(${x} ${y}) scale(${reduced?.5:.4+(Math.sin(t*2+i)+1)*.25})`);}
 $('time').textContent=phase==='idle'?'待機中':'00:'+String(Math.floor(t)).padStart(2,'0');$('progress').style.width=(t/45*100)+'%';
 cinema.dataset.walletPlanck=engine.walletTotal.toString();cinema.dataset.confirmedPlanck=engine.total.toString();
}
function report(now){
 cinema.dataset.qa=JSON.stringify({mode:engine.mode,recordCount:engine.dataset?.records.length??0,startedAt,wallMs:startedAt?Date.now()-startedAt:0,activeMs:Math.round(activeMs),frames,cycle:engine.cycle,elapsedMs:Math.round(engine.elapsed),accepted:engine.acceptedCount,stowed:engine.stowedCount,walletPlanck:engine.walletTotal.toString(),confirmedPlanck:engine.total.toString(),records:engine.records.size,seen:engine.seen.size,errors,maxFrameGap:Math.round(maxFrameGap),paused:engine.paused,hidden:document.hidden,imagesReady:ready,domNodes:world.querySelectorAll('*').length,live:engine.mode==='live'?{status:liveStatus.state,polls:liveSession.successes,failures:liveSession.failures,balancePlanck:liveEngine.snapshot?.totalPlanck,displayedPlanck:liveEngine.displayedBalancePlanck?.toString(),pendingPlanck:liveEngine.pendingDisplayPlanck.toString(),block:liveEngine.snapshot?.blockNumber,queue:liveEngine.queue.length,skipped:liveEngine.skippedCount,lastSuccess:liveStatus.lastSuccess}:null});
 lastReport=now;
}
function frame(now){
 const delta=Math.max(0,now-previous);previous=now;
 if(ready&&!document.hidden&&!engine.paused){maxFrameGap=Math.max(maxFrameGap,delta);activeMs+=delta;engine.advance(delta);frames++;draw();}
 if(ready&&!document.hidden)drawReadout(now);
 if(ready&&now-lastReport>1000)report(now);
 requestAnimationFrame(frame);
}
async function load(){
 ready=false;$('loading').hidden=false;$('load-error').hidden=true;world.setAttribute('hidden','');['pause','restart','sound','motion','replay-open'].forEach(id=>$(id).disabled=true);
 try{
  await Promise.all([...poses.map(p=>'magi-'+p+'.png'),'magi-idle-blink.png','magi-hair-drift.svg','magi-cape-drift.svg'].map(async file=>{const image=new Image();image.src='./assets/'+file;await image.decode();}));
  world.innerHTML=buildWorld();el=Object.fromEntries([...world.querySelectorAll('[id]')].map(e=>[e.id,e]));
  world.removeAttribute('hidden');$('loading').hidden=true;ready=true;previous=performance.now();startedAt=Date.now();updateReplayInfo();draw();report(previous);
  ['pause','restart','sound','motion','replay-open'].forEach(id=>$(id).disabled=false);
 }catch(error){errors++;$('loading').hidden=true;$('load-error').hidden=false;console.error('Magi asset loading failed',error);}
}
$('retry').addEventListener('click',load);
$('pause').addEventListener('click',()=>{engine.paused=!engine.paused;previous=performance.now();updatePause();report(previous);});
$('restart').addEventListener('click',()=>{engine.reset();lastPhase='';lastCycle=-1;stopSounds();activeMs=0;frames=0;maxFrameGap=0;startedAt=Date.now();previous=performance.now();lastWallet='0.000';updatePause();draw();report(previous);});
$('motion').addEventListener('click',()=>{setReduced(!reduced);if(ready)draw();});
$('sound').addEventListener('click',async()=>{try{context??=new (window.AudioContext||window.webkitAudioContext)();sound=!sound;await syncAudio();$('sound').setAttribute('aria-pressed',String(sound));$('sound').setAttribute('aria-label',sound?'音を無効にする':'音を有効にする');$('sound').title=sound?'音 ON':'音 OFF';$('sound-label').textContent=sound?'ON':'OFF';}catch{sound=false;toast('このブラウザーでは音を再生できません。');}});
$('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if(app.requestFullscreen)await app.requestFullscreen();else toast('ブラウザーの全画面機能をご利用ください。');}catch{toast('ブラウザーの全画面機能をご利用ください。');}});
document.addEventListener('fullscreenchange',()=>{const name=document.fullscreenElement?'全画面を終了':'全画面';$('fullscreen').setAttribute('aria-label',name);$('fullscreen').title=name;});
document.addEventListener('visibilitychange',()=>{previous=performance.now();syncAudio();liveSession.setActive(engine.mode==='live'&&!document.hidden);});
document.addEventListener('keydown',e=>{if(e.code==='Space'&&e.target===document.body&&ready){e.preventDefault();engine.paused=!engine.paused;previous=performance.now();updatePause();}});
window.addEventListener('error',()=>errors++);window.addEventListener('unhandledrejection',()=>errors++);

let dialogWasPaused=false;
function summarizeDataset(data){
 const start=data.records[0].occurredAt,end=data.records.at(-1).occurredAt;
 const stamp=v=>new Date(v).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',hour12:false});
 return (data.fixture?'検証用の架空記録 / ':'')+data.records.length+'件 / '+formatExactSDN(data.totalPlanck)+' SDN\n'+stamp(start)+' 〜 '+stamp(end)+' JST\n'+(data.sourceKind==='chain'?'PotStake転送・自ブロック・確定履歴をRPC2系統で照合':'Guardianの確認済み報酬記録')+(data.excluded?' / 未確認 '+data.excluded+'件を除外':'')+(data.duplicates?' / 重複 '+data.duplicates+'件を除外':'')+(data.historyGap?'\n履歴欠損あり。欠損分は含みません。':'')+(data.fetchedAt?'\n取得: '+stamp(data.fetchedAt)+' JST':'')+'\n読み込んだ記録だけの合計です。';
}
function updateReplayInfo(){
 const replay=engine.mode==='replay',live=engine.mode==='live',d=engine.dataset,r=engine.record;
 $('mode-label').textContent=live?'LIVE':replay?(d.fixture?'TEST':'REPLAY'):'DEMO';
 $('mode-detail').textContent=live?'・確定後の再現':replay?(d.fixture?'・架空の検証用記録':'・実績 / 時間は演出'):'・架空データ';
 $('mode-badge').classList.toggle('replay',replay);$('mode-badge').classList.toggle('live',live);$('mode-badge').classList.toggle('stale',live&&liveStatus.state==='error');
 $('balance-label').textContent=live?'保有総額':replay?'再生累計':'デモ累計';
 $('record-link').hidden=!r;$('record-date').textContent=r?new Date(r.occurredAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',hour12:false})+' JST':'';
 if(r){$('record-link').textContent='#'+BigInt(r.blockNumber).toLocaleString('en-US');$('record-link').href='https://shiden.subscan.io/block/'+r.blockNumber;}
 $('record-position').textContent=live?(r?'確定したブロックを上映中':'新しいブロックを待っています'):replay?(engine.recordIndex+1)+' / '+d.records.length:'星の魔法でブロックをつくろう';
 $('replay-note').textContent=live?(liveStatus.state==='recovering'?'復帰した記録を照合中…':r?'1件45秒の再現演出':'新着を自動で取得します'):replay?(engine.repeated?'再上映・累計の追加なし':'記録の再現・1件45秒'):'架空データ';
 $('recovery-summary').hidden=!live||!liveEngine.skippedCount;$('recovery-summary').textContent=liveEngine.skippedCount+'件を集約 / '+roundedSDN(liveEngine.skippedPlanck,6)+' SDN';
 $('restart').title=live?'演出をリセットして新着を待つ':'最初から再生';$('restart').setAttribute('aria-label',$('restart').title);
}
function drawReadout(now){
 const live=engine.mode==='live',snapshot=liveEngine.displaySnapshot,target=liveEngine.displayedBalancePlanck;
 if(target!==null&&(!balanceAt||target!==balanceTarget)){balanceFrom=balanceAt?balanceShown:target;balanceTarget=target;balanceAt=now;}
 const q=reduced?1:ease((now-balanceAt)/800);balanceShown=balanceFrom+(balanceTarget-balanceFrom)*BigInt(Math.round(q*1000))/1000n;
 $('balance-number').textContent=live?(snapshot?roundedSDN(balanceShown,4):'—'):roundedSDN(engine.walletTotal,4);
 $('balance-sync').textContent=live?(liveStatus.state==='error'?'更新待ち · 最後に確認できた残高':!snapshot?'確定残高を照合中…':liveEngine.pendingDisplayPlanck>0n?'収納後に反映 · 最新残高は詳細':liveEngine.snapshot&&BigInt(liveEngine.snapshot.lastAuthoredBlock)>BigInt(snapshot.blockNumber)?'報酬記録を照合中 · 最新残高は詳細':'確定残高 · '+new Date(snapshot.occurredAt).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour12:false})+' JST'):'上映した報酬の合計';
 const reward=engine.mode==='demo'?'125000000000000000':engine.record?.rewardPlanck;
 const show=engine.elapsed>=29000&&engine.elapsed<42000&&reward&&BigInt(reward)>0n;
 $('reward-display').hidden=!show;if(show)$('reward-display').textContent='今回 +'+roundedSDN(reward,6)+' SDN';
 document.querySelector('.balance-area').classList.toggle('stowing',!!show&&engine.elapsed>=36000);
 if($('balance-dialog').open)renderBalanceDetails();
}
function renderBalanceDetails(){const s=liveEngine.snapshot;if(engine.mode!=='live'){$('balance-content').textContent='再生累計: '+formatExactSDN(engine.walletTotal.toString())+' SDN\n実残高とは別の表示です。';return;}$('balance-content').textContent=s?'最新の確定保有総額: '+formatExactSDN(s.totalPlanck)+' SDN\n画面の保有総額: '+(liveEngine.displayedBalancePlanck===null?'照合中':formatExactSDN(liveEngine.displayedBalancePlanck.toString())+' SDN')+'\n収納待ちの報酬: '+formatExactSDN(liveEngine.pendingDisplayPlanck.toString())+' SDN\n送金可能額: '+formatExactSDN(s.transferablePlanck)+' SDN\nFree: '+formatExactSDN(s.freePlanck)+' SDN\nReserved: '+formatExactSDN(s.reservedPlanck)+' SDN\nFrozen（内数）: '+formatExactSDN(s.frozenPlanck)+' SDN\n確定ブロック: #'+s.blockNumber+'\n記録日時: '+new Date(s.occurredAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})+' JST\n取得日時: '+new Date(s.fetchedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})+' JST\nアドレス: '+s.address+'\n\n'+(liveStatus.state==='error'?'更新待ち: '+liveStatus.message:'公開RPC 2系統で一致')+'\n今回の報酬: '+(engine.record?formatExactSDN(engine.record.rewardPlanck)+' SDN':'—'):'公開RPCの確定残高を照合しています。'+(liveStatus.message?'\n'+liveStatus.message:'');}
$('balance-detail').addEventListener('click',()=>{renderBalanceDetails();$('balance-dialog').showModal();});$('balance-close').addEventListener('click',()=>$('balance-dialog').close());
function replaceEngine(next){
 stopSounds();engine=next;lastPhase='';lastCycle=-1;lastWallet='0.000';activeMs=0;frames=0;maxFrameGap=0;previous=performance.now();startedAt=Date.now();liveSession.setActive(engine.mode==='live'&&!document.hidden);updatePause();updateReplayInfo();if(ready){draw();report(previous);}
}
function openReplay(){
 dialogWasPaused=engine.paused;engine.paused=true;updatePause();$('record-summary').textContent=engine.mode==='replay'?summarizeDataset(engine.dataset):engine.mode==='live'?'現在はライブ表示です。確定した新着から上映します。':'現在は架空デモを再生しています。';
 $('replay-error').hidden=true;$('replay-dialog').showModal();
}
function closeReplay(){ $('replay-dialog').close();engine.paused=dialogWasPaused;previous=performance.now();updatePause(); }
function beginReplay(data){replaceEngine(new ReplayEngine(data));dialogWasPaused=false;$('replay-dialog').close();updatePause();}
$('replay-open').addEventListener('click',openReplay);
$('replay-close').addEventListener('click',closeReplay);
$('replay-dialog').addEventListener('cancel',e=>{e.preventDefault();closeReplay();});
$('use-live').addEventListener('click',()=>{if(!walletAddress)return;liveEngine.paused=false;replaceEngine(liveEngine);dialogWasPaused=false;$('replay-dialog').close();});
$('use-demo').addEventListener('click',()=>{replaceEngine(new ShowEngine());dialogWasPaused=false;$('replay-dialog').close();});
$('replay-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>MAX_IMPORT_BYTES)throw new Error('JSONは8MB以内で読み込んでください。');$('replay-json').value=await file.text();$('replay-error').hidden=true;}catch(error){$('replay-error').textContent=error.message;$('replay-error').hidden=false;}finally{e.target.value='';}});
$('replay-form').addEventListener('submit',e=>{e.preventDefault();try{beginReplay(parseReplayJSON($('replay-json').value,{walletAddress}));$('replay-json').value='';}catch(error){$('replay-error').textContent=error.message;$('replay-error').hidden=false;}});

await load();requestAnimationFrame(frame);liveSession.setActive(engine.mode==='live'&&!document.hidden);
