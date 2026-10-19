import test from 'node:test';
import {walletConfig} from './fixtures.mjs';
import assert from 'node:assert/strict';
import {ChainReader} from '../scripts/chain-reader.js';
test('raw storage disagreement cannot become a verified record',async()=>{const r=new ChainReader(walletConfig);let n=0;r.rpc=async()=>++n===1?'0x01':'0x02';await assert.rejects(r.raw('key','hash'),/一致/);});
test('only an absent lock vector may decode as an empty vector on both sources',async()=>{const r=new ChainReader(walletConfig);r.rpc=async()=>null;assert.equal(await r.raw('locks','hash',true),'0x00');await assert.rejects(r.raw('account','hash'),/一致/);});
test('unknown or mismatched runtime does not initialize a decoder',async()=>{const r=new ChainReader(walletConfig);r.api={at(){throw Error('Must not decode');}};r.rpc=async()=>({specName:'shiden',specVersion:9999});await assert.rejects(r.context('hash'),/runtime/);let n=0;r.rpc=async()=>({specName:'shiden',specVersion:++n===1?2500:2400});await assert.rejects(r.context('hash'),/runtime/);});
test('unmatched finalized hashes never produce a balance snapshot',async()=>{const r=new ChainReader(walletConfig);r.connect=async()=>{};r.rpc=async(url,method)=>method==='chain_getFinalizedHead'?'head':method==='chain_getHeader'?{number:'0x64'}:url.includes('dwellir')?'hash1':'hash2';await assert.rejects(r.snapshot(),/照合待ち/);assert.equal(r.lastSnapshot,null);});
test('transaction RPCs are never allowed and suspension prevents requests',async()=>{const r=new ChainReader(walletConfig);await assert.rejects(r.rpc('https://example.com','author_submitExtrinsic',[]),/Read-only/);r.suspend();await assert.rejects(r.rpc('https://example.com','system_chain',[]),/休止/);});
