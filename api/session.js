import {same,authorized,makeSession,requireOrigin,jsonBody,safeHeaders} from '../lib/security.mjs';
const attempts=new Map();
export default async function handler(req,res) {
 safeHeaders(res);
 if(req.method==='GET'){let ok=false;try{ok=authorized(req);}catch{}return res.status(200).json({authenticated:ok,configured:(process.env.APP_ACCESS_PASSWORD||'').length>=16});}
 if(!['POST','DELETE'].includes(req.method)){res.setHeader('Allow','GET, POST, DELETE');return res.status(405).json({error:'Method not allowed'});}
 if(!requireOrigin(req,res))return;
 if(req.method==='DELETE'){res.setHeader('Set-Cookie','ss_dispatch=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');return res.status(200).json({ok:true});}
 const expected=process.env.APP_ACCESS_PASSWORD;
 if(!expected||expected.length<16)return res.status(503).json({error:'Set APP_ACCESS_PASSWORD (16+ random characters) in Vercel, then redeploy.'});
 // This local throttle is a secondary guard; use a strong random password and platform WAF.
 const ip=String(req.headers?.['x-forwarded-for']||req.socket?.remoteAddress||'local').split(',')[0];
 const now=Date.now();if(attempts.size>1000)for(const [k,v] of attempts)if(now-v.at>300000)attempts.delete(k);
 let attempt=attempts.get(ip);if(!attempt||now-attempt.at>300000)attempt={n:0,at:now};
 if(attempt.n>=10)return res.status(429).json({error:'Too many sign-in attempts. Try again later.'});
 try{const body=await jsonBody(req);attempt.n++;attempts.set(ip,attempt);if(typeof body.password!=='string'||!same(body.password,expected))return res.status(401).json({error:'Incorrect password.'});attempts.delete(ip);res.setHeader('Set-Cookie',`ss_dispatch=${makeSession()}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`);return res.status(200).json({ok:true});}catch{return res.status(400).json({error:'Invalid login request.'});}
}
