// Configuration is public when deployed. Never put signing credentials here.
export function parseConfig(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>key!=='walletAddress'))throw new Error('設定ファイルには walletAddress だけを指定してください。');
 const value=input.walletAddress;
 if(value===undefined||value==='')return {walletAddress:null};
 if(typeof value!=='string'||value!==value.trim())throw new Error('walletAddress にSS58形式の公開アドレスを指定してください。');
 return {walletAddress:value};
}
export async function loadBrowserConfig({fetchConfig=globalThis.fetch,validateAddress}={}){
 try{
  const response=await fetchConfig('./config.local.json',{cache:'no-store',credentials:'omit'});
  if(response.status===404)return {walletAddress:null,error:null};
  if(!response.ok)throw new Error('設定ファイルを取得できませんでした。');
  const config=parseConfig(await response.json());
  if(config.walletAddress){const validate=validateAddress??(await import('./live-rpc.js')).validateWalletAddress;config.walletAddress=validate(config.walletAddress);}
  return {...config,error:null};
 }catch{return {walletAddress:null,error:'設定エラー：config.local.json の walletAddress を確認してください。ライブ取得は停止しています。'};}
}
