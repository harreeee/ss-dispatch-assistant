import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname} from 'node:path';
const port=Number(process.env.PORT||3000);
const routes=new Set(['onfleet','session','push','monitor']);
const publicFiles=new Set(['/','/index.html','/app.js','/styles.css','/sw.js','/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png']);
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json'};
createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){
   const route=url.pathname.slice(5);if(!routes.has(route)){res.writeHead(404);res.end();return;}
   req.query=Object.fromEntries(url.searchParams);
   let body='';for await(const chunk of req){body+=chunk;if(body.length>10000){res.writeHead(413);res.end();return;}}
   if(body)try{req.body=JSON.parse(body);}catch{req.body=body;}
   res.status=code=>{res.statusCode=code;return res;};res.json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return res;};
   const {default:handler}=await import(`../api/${route}.js`);await handler(req,res);return;
  }
  if(!publicFiles.has(url.pathname)){res.writeHead(404);res.end('Not found');return;}
  const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
  res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(await readFile(file));
 }catch(e){if(!res.headersSent)res.writeHead(500);res.end('Local server error');console.error(e.message);}
}).listen(port,'127.0.0.1',()=>console.log(`Local test server http://127.0.0.1:${port}`));
