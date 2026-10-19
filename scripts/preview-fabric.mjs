// Local-only visual regression page; no RPC calls, real records or wallet config.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../dist/',import.meta.url));
const harness=new URL('../tests/fabric-browser.html',import.meta.url);
http.createServer(async(req,res)=>{
 try{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file=name==='/'?harness:path.resolve(root,'.'+name);
  if(typeof file==='string'&&!file.startsWith(root)){res.writeHead(403).end();return;}
  const type={'.html':'text/html; charset=utf-8','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png'}[path.extname(typeof file==='string'?file:file.pathname)]||'application/octet-stream';
  const data=await fs.readFile(file);
  res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'}).end(data);
 }catch{res.writeHead(404).end();}
}).listen(4174,'127.0.0.1',()=>console.log('Fabric regression: http://127.0.0.1:4174'));
