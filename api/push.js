import {requireAuth,requireOrigin,jsonBody} from '../lib/security.mjs';
import {pushConfigured,saveDevice,removeDevice,validateSubscription,sendPush} from '../lib/push.mjs';
export default async function handler(req,res){
 if(!requireAuth(req,res))return;
 if(req.method==='GET')return res.status(200).json({configured:pushConfigured(),publicKey:process.env.VAPID_PUBLIC_KEY||null});
 if(req.method!=='POST'){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'Method not allowed'});}
 if(!requireOrigin(req,res))return;
 if(!pushConfigured())return res.status(503).json({error:'Push is not configured on the server yet. No phone notifications are active.'});
 try{const body=await jsonBody(req),subscription=validateSubscription(body.subscription);
  if(body.action==='subscribe'){await saveDevice(subscription);return res.status(200).json({subscribed:true});}
  if(body.action==='unsubscribe'){await removeDevice(subscription);return res.status(200).json({subscribed:false});}
  if(body.action==='test'){await sendPush(subscription,{title:'S&S Dispatch - test',body:'Test notification. Return to the app and confirm that you saw this.',tag:'ss-test',url:'/?view=settings'});return res.status(200).json({accepted:true,delivered:'unverified'});}
  return res.status(400).json({error:'Unknown action'});
 }catch(e){return res.status(400).json({error:e.message||'Push request failed.'});}
}
