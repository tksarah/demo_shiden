import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loadBrowserConfig,parseConfig} from '../dist/config.js';
import {ChainReader,validateWalletAddress} from '../scripts/chain-reader.js';
import {loadLocalWallet} from '../scripts/config.mjs';
import {LiveEngine,validateLiveRecord} from '../dist/live-core.js';
import {parseReplayJSON,parseGuardianJSON} from '../dist/replay.js';
import {ADDRESS,OTHER_ADDRESS,walletConfig,syntheticHistory} from './fixtures.mjs';

const response=(input,status=200)=>async()=>({status,ok:status===200,json:async()=>input});

test('missing or empty browser configuration remains offline without loading an address validator',async()=>{
 let calls=0;const validateAddress=()=>{calls++;throw Error('must not load');};
 for(const fetchConfig of [response(null,404),response({walletAddress:''}),response({})]){
  assert.deepEqual(await loadBrowserConfig({fetchConfig,validateAddress}),{walletAddress:null,error:null});
 }
 assert.equal(calls,0);
});

test('configured wallet is SS58 validated before live initialization',async()=>{
 const config=await loadBrowserConfig({fetchConfig:response(walletConfig),validateAddress:validateWalletAddress});
 assert.deepEqual(config,{...walletConfig,error:null});
 const reader=new ChainReader(config),engine=new LiveEngine(config);
 assert.equal(reader.walletAddress,ADDRESS);assert.equal(engine.walletAddress,ADDRESS);
 assert.throws(()=>new ChainReader(),/公開アドレス/);
});

test('HTTP, parse, shape, unknown-field and checksum failures disable live with a visible message',async()=>{
 const cases=[response(null,500),async()=>{throw Error('offline');},async()=>({status:200,ok:true,json:async()=>{throw Error('bad JSON');}}),response(null),response([]),response({walletAddress:42}),response({walletAddress:' '+ADDRESS}),response({walletAddress:ADDRESS,secret:'not allowed'}),response({walletAddress:'not-an-address'}),response({walletAddress:ADDRESS.slice(0,-1)+(ADDRESS.endsWith('1')?'2':'1')})];
 for(const fetchConfig of cases){const config=await loadBrowserConfig({fetchConfig,validateAddress:validateWalletAddress});assert.equal(config.walletAddress,null);assert.match(config.error,/設定エラー/);}
});

test('browser configuration fetch omits credentials and bypasses cache',async()=>{
 let requested;await loadBrowserConfig({fetchConfig:async(...args)=>{requested=args;return {status:404};}});
 assert.deepEqual(requested,['./config.local.json',{cache:'no-store',credentials:'omit'}]);
});

test('CLI reads the same external configuration and rejects missing or malformed settings',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'magi-config-')),file=path.join(dir,'config.json');
 try{await assert.rejects(loadLocalWallet(file));await fs.writeFile(file,JSON.stringify(walletConfig));assert.equal(await loadLocalWallet(file),ADDRESS);await fs.writeFile(file,'{}');await assert.rejects(loadLocalWallet(file),/公開アドレス/);}finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('replay and live data must match the selected wallet, with no implicit default',()=>{
 const history=syntheticHistory(),text=JSON.stringify(history);
 assert.equal(parseReplayJSON(text,walletConfig).fixture,true);
 assert.throws(()=>parseReplayJSON(text));assert.throws(()=>parseGuardianJSON('{}'));
 assert.throws(()=>parseReplayJSON(text,{walletAddress:OTHER_ADDRESS}));
 const r=history.records[0],live={...r,mode:'live',eventId:'live:'+r.blockHash+':4'};
 assert.equal(validateLiveRecord(live,ADDRESS),live);
 assert.throws(()=>validateLiveRecord(live,OTHER_ADDRESS));assert.throws(()=>validateLiveRecord(live));
 const snapshot={address:ADDRESS,blockNumber:'100',rpcMatches:2,totalPlanck:'10',freePlanck:'10',reservedPlanck:'0'};
 assert.throws(()=>new LiveEngine({walletAddress:OTHER_ADDRESS}).setSnapshot(snapshot));
 assert.throws(()=>new LiveEngine().setSnapshot({...snapshot,address:null}));
});

test('private material cannot be accepted as extra configuration fields',()=>{
 for(const key of ['mnemonic','privateKey','password','token'])assert.throws(()=>parseConfig({...walletConfig,[key]:'never store here'}));
});
