import {requireAuth} from '../lib/security.mjs';
import {dayAt,validDay} from '../lib/rules.mjs';
import {currentSnapshot} from '../lib/snapshot.mjs';
export default async function handler(req,res){
 if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'Method not allowed'});}
 if(!requireAuth(req,res))return;
 const date=req.query?.date||new URL(req.url,'http://local').searchParams.get('date')||dayAt();
 if(!validDay(date))return res.status(400).json({connected:false,error:'Use a valid date in YYYY-MM-DD format.'});
 try{return res.status(200).json(await currentSnapshot(date));}
 catch(e){
  if(e.status===429){const retryAfterSeconds=Math.max(1,Math.ceil((e.retryAfterMs||15000)/1000));
   res.setHeader('Retry-After',String(retryAfterSeconds));
   return res.status(429).json({connected:false,date,retryAfterSeconds,error:'Onfleet request limit reached. Waiting before retrying. No current on-time conclusion can be made.'});}
  return res.status(502).json({connected:false,date,error:e.name==='TimeoutError'?'Onfleet check timed out. Status is unknown; retry.':e.message});
 }
}
