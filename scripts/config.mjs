import fs from 'node:fs/promises';
import {parseConfig} from '../dist/config.js';
import {validateWalletAddress} from './chain-reader.js';
export async function loadLocalWallet(file=new URL('../dist/config.local.json',import.meta.url)){
 const config=parseConfig(JSON.parse(await fs.readFile(file,'utf8')));
 return validateWalletAddress(config.walletAddress);
}
