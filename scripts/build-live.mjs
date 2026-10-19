import {build} from 'esbuild';
await build({entryPoints:['scripts/chain-reader.js'],bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,outfile:'dist/live-rpc.js',legalComments:'eof'});
