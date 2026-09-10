import {createHash} from 'node:crypto';
import {db,storageConfigured} from './store.mjs';
export function pushConfigured(){return storageConfigured()&&Boolean(process.env.VAPID_PUBLIC_KEY&&process.env.VAPID_PRIVATE_KEY&&process.env.VAPID_SUBJECT);}
export function validateSubscription(s) {
 if(!s||typeof s.endpoint!=='string'||s.endpoint.length>2500)throw new Error('Invalid subscription');
 const u=new URL(s.endpoint),h=u.hostname;
 const allowed=h==='fcm.googleapis.com'||h==='updates.push.services.mozilla.com'||h.endsWith('.push.services.mozilla.com')||h.endsWith('.push.apple.com')||h==='web.push.apple.com'||h.endsWith('.notify.windows.com');
 if(!allowed||u.protocol!=='https:'||u.username||u.password||u.hash||(u.port&&u.port!=='443'))throw new Error('Push endpoint is not an allowed browser push service.');
 for(const [key,len] of [['p256dh',65],['auth',16]])if(typeof s.keys?.[key]!=='string'||!/^[A-Za-z0-9_=-]+$/.test(s.keys[key])||Buffer.from(s.keys[key],'base64url').length!==len)throw new Error('Invalid push keys.');
 return {endpoint:s.endpoint,keys:{p256dh:s.keys.p256dh,auth:s.keys.auth}};
}
export function deviceId(subscription){return createHash('sha256').update(subscription.endpoint).digest('hex');}
export async function saveDevice(s){s=validateSubscription(s);const id=deviceId(s);await db('dispatch_devices?on_conflict=id',{method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:{id,subscription:s,expires_at:new Date(Date.now()+30*86400000).toISOString(),updated_at:new Date().toISOString()}});return id;}
export async function removeDevice(s){const id=deviceId(validateSubscription(s));await db(`dispatch_devices?id=eq.${id}`,{method:'DELETE',prefer:'return=minimal'});}
export async function sendPush(subscription,payload){
 validateSubscription(subscription);
 const mod=await import('web-push');const webpush=mod.default||mod;
 return webpush.sendNotification(subscription,JSON.stringify(payload),{TTL:300,urgency:'high',timeout:4000,contentEncoding:'aes128gcm',vapidDetails:{subject:process.env.VAPID_SUBJECT,publicKey:process.env.VAPID_PUBLIC_KEY,privateKey:process.env.VAPID_PRIVATE_KEY}});
}
const ALERT_KINDS=new Set(['NOT_STARTED','UNASSIGNED','LATE','ETA_RISK','STATIONARY','GPS_STALE','OFF_DUTY','FAILED']);
// Persistent ledger tracks each alert occurrence and per-device accepted sends.
export function notificationPlan(issues,old={},now=Date.now(),dataComplete=true) {
 const ledger=structuredClone(old),due=[];const seen=new Set();
 for(const issue of issues) {
  if(!ALERT_KINDS.has(issue.kind)||issue.dueAt&&issue.dueAt>now)continue;
  seen.add(issue.id);
  let entry=ledger[issue.id];
  if(!entry||entry.resolvedAt)entry={firstSeen:now,occurrence:now,receipts:{},severity:issue.severity};
  const minutes=(now-entry.firstSeen)/60000;
  const stage=minutes>=30?2:minutes>=15?1:0;
  const key=`${entry.occurrence}:${issue.severity}:${stage}`;
  entry.lastSeen=now;entry.severity=issue.severity;entry.resolvedAt=null;entry.lastKey=key;
  ledger[issue.id]=entry;due.push({issue,key,entry});
 }
 for(const [id,entry] of Object.entries(ledger)) {
  // Never resolve an alert just because a source failed to load.
  if(dataComplete&&!seen.has(id)&&!entry.resolvedAt)entry.resolvedAt=now;
  if(now-(entry.lastSeen||entry.firstSeen)>2*86400000)delete ledger[id];
 }
 return {ledger,due};
}
export async function dispatchNotifications(plan,now=Date.now(),{budgetMs=16000}={}) {
 const devices=await db(`dispatch_devices?expires_at=gt.${encodeURIComponent(new Date(now).toISOString())}&select=id,subscription&limit=100`);
 let accepted=0,failed=0;const stopAt=Date.now()+budgetMs;
 for(const device of devices||[]) {
  if(Date.now()>=stopAt)break; // Unsatisfied receipts remain eligible on the next run.
  const items=plan.due.filter(x=>x.entry.receipts[device.id]!==x.key);
  if(!items.length)continue;
  // No customer address/phone or driver identity on the lock screen by default.
  const count=items.filter(x=>x.issue.kind==='NOT_STARTED').length;
  const payload={title:'S&S Dispatch - action needed',body:count?`${count} pickup task(s) not started by the 60-minute cutoff. ${items.length} alert(s) to review.`:`${items.length} delivery alert(s) need attention. Open the app to review.`,tag:'ss-dispatch-live',url:'/?view=dashboard'};
  try {await sendPush(device.subscription,payload);for(const x of items)x.entry.receipts[device.id]=x.key;accepted++;}
  catch(e){failed++;if([404,410].includes(e.statusCode))await db(`dispatch_devices?id=eq.${device.id}`,{method:'DELETE',prefer:'return=minimal'});}
 }
 return {accepted,failed}; // Accepted by push service does not prove phone displayed it.
}
