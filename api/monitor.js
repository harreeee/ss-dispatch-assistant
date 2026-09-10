import {randomUUID} from 'node:crypto';
import {same,safeHeaders} from '../lib/security.mjs';
import {dayAt,shiftDay} from '../lib/rules.mjs';
import {getOnfleet} from '../lib/onfleet.mjs';
import {computeSnapshot,addSamples} from '../lib/snapshot.mjs';
import {getState,setState,lock,unlock,storageConfigured} from '../lib/store.mjs';
import {notificationPlan,dispatchNotifications,pushConfigured} from '../lib/push.mjs';
export default async function handler(req,res){
 safeHeaders(res);
 if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'Method not allowed'});}
 const secret=process.env.CRON_SECRET;
 if(!secret||secret.length<32||!same(req.headers?.authorization||'',`Bearer ${secret}`))return res.status(401).json({error:'Unauthorized monitor request'});
 if(!storageConfigured())return res.status(503).json({error:'Persistent storage is required for background monitoring.'});
 const token=randomUUID();let acquired=false;
 try{
  acquired=await lock(token);if(!acquired)return res.status(200).json({skipped:true,reason:'Another check is running.'});
  const now=Date.now(),date=dayAt(now),old=await getState('monitor')||{};
  const raw=await getOnfleet(date,{now,useCache:false}),samples=addSamples(old.samples,raw.workers,now);
  const today=await computeSnapshot(date,{raw,history:samples,now});
  // Include tomorrow ONLY for rules whose real due time has already arrived,
  // e.g. a 00:30 pickup requires Start at 23:30 the previous day.
  const tomorrow=await computeSnapshot(shiftDay(date,1),{raw,history:samples,now});
  const dueTomorrow=tomorrow.issues.filter(i=>i.kind==='NOT_STARTED'&&i.dueAt<=now);
  const plan=notificationPlan([...today.issues,...dueTomorrow],old.ledger||{},now,raw.complete);
  let push={accepted:0,failed:0,configured:pushConfigured()};
  if(push.configured)push={...push,...await dispatchNotifications(plan,now)};
  await setState('monitor',{lastSuccessAt:now,complete:raw.complete,samples,ledger:plan.ledger,push});
  return res.status(200).json({checkedAt:now,complete:raw.complete,issueCount:today.issues.length,push});
 }catch(e){return res.status(502).json({error:e.message||'Monitoring failed; no healthy status assumed.'});}
 finally{if(acquired)try{await unlock(token);}catch{}}
}
