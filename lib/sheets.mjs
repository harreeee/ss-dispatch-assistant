import {createSign} from 'node:crypto';
import {validDay,localTime,schedule,idOf} from './rules.mjs';
const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
export function parseDate(value,year) {
 const text=String(value||'').trim();if(validDay(text))return text;
 const m=text.match(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?\s*([A-Za-z]{3,9})\s+(\d{1,2})(?:,?\s+(\d{4}))?$/i);
 if(!m)return null;const index=months.findIndex(x=>x.toLowerCase().startsWith(m[1].toLowerCase()));
 const result=`${m[3]||year}-${String(index+1).padStart(2,'0')}-${m[2].padStart(2,'0')}`;
 return index>=0&&validDay(result)?result:null;
}
export function parseWindow(value,day) {
 const text=String(value??'').trim().toLowerCase().replace(/[\u2013\u2014]/g,'-').replace(/\s/g,'');
 if(!text)return null;const parts=text.split('-');if(parts.length>2)return null;
 const suffix=text.match(/(am|pm)$/)?.[1]||null;
 function clock(s){
  const mer=s.match(/(am|pm)$/)?.[1]||suffix;s=s.replace(/am|pm/g,'');
  let h,m;
  if(/^\d{1,2}[.:]\d{2}$/.test(s))[h,m]=s.split(/[.:]/).map(Number);
  else if(/^\d{3,4}$/.test(s)){h=+s.slice(0,-2);m=+s.slice(-2);}
  else if(/^\d{1,2}$/.test(s)){h=+s;m=0;}else return null;
  if(mer){if(h<1||h>12)return null;h=h%12+(mer==='pm'?12:0);}
  return localTime(day,h,m);
 }
 const start=clock(parts[0]),end=clock(parts.at(-1));
 return start!==null&&end!==null&&end>=start?{start,end}:null;
}
export function normalizeRows(values,selectedDate){
 if(!Array.isArray(values)||!Array.isArray(values[0]))throw new Error('Sheet header is missing.');
 const headers=values[0].map(x=>String(x||'').replace(/\s+/g,' ').trim().toLowerCase());
 const pos=(...names)=>headers.findIndex(x=>names.includes(x));
 const dateCol=pos('order date','date'),idCol=pos('onfleet id','onfleet task id'),pickupCol=pos('pickup time'),deliveryCol=pos('client delivery time','delivery time'),vendorCol=pos('providor','provider','vendor');
 if(dateCol<0||idCol<0||pickupCol<0||deliveryCol<0)throw new Error('Required Sheet columns are missing. No missing-order conclusions were made.');
 const rows=[];let invalidDates=0;
 values.slice(1).forEach((row,i)=>{
  if(!row?.some(x=>String(x||'').trim()))return;
  const date=parseDate(row[dateCol],selectedDate.slice(0,4));
  if(!date){if(row[dateCol])invalidDates++;return;}
  if(date!==selectedDate)return;
  const pickup=parseWindow(row[pickupCol],date),delivery=parseWindow(row[deliveryCol],date);
  const id=String(row[idCol]||'').trim();
  rows.push({row:i+2,date,onfleetId:id,validId:/^(?:[a-f0-9]{8}|[A-Za-z0-9*~_-]{24})$/i.test(id),vendor:String(row[vendorCol]||'').slice(0,120),pickupAt:pickup?.start??null,deliveryAt:delivery?.end??null});
 });
 return {rows,invalidDates};
}
export function matchRows(rows,tasks,complete=true){
 const result=[],seen=new Map();for(const r of rows)if(r.validId)seen.set(r.onfleetId,(seen.get(r.onfleetId)||0)+1);
 for(const r of rows){
  const exact=r.validId?tasks.filter(t=>t.id===r.onfleetId||t.shortId===r.onfleetId):[];
  let status='UNMATCHED',task=null;
  if(!complete)status='UNVERIFIED';
  else if(!r.validId)status='NEEDS_ID';
  else if(seen.get(r.onfleetId)>1||exact.length>1)status='AMBIGUOUS';
  else if(exact.length===1){task=exact[0];status=schedule(task).day===r.date?'MATCHED':'DATE_MISMATCH';}
  else status='NOT_FOUND';
  // NOT_FOUND is a candidate, never an instruction to create another task automatically.
  result.push({...r,status,taskId:task?.id||null});
 }
 return result;
}
let tokenCache=null;
async function accessToken(){
 let creds;try{creds=JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);}catch{throw new Error('Invalid Google service account configuration.');}
 if(!creds.client_email||!creds.private_key)throw new Error('Google service account is incomplete.');
 if(tokenCache&&tokenCache.until>Date.now())return tokenCache.token;
 const now=Math.floor(Date.now()/1000),encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const data=encode({alg:'RS256',typ:'JWT'})+'.'+encode({iss:creds.client_email,scope:'https://www.googleapis.com/auth/spreadsheets.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
 const signature=createSign('RSA-SHA256').update(data).sign(creds.private_key,'base64url');
 const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${data}.${signature}`}),signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error(`Google authorization failed (HTTP ${response.status}).`);
 const result=await response.json();if(!result.access_token)throw new Error('Google returned no access token.');
 tokenCache={token:result.access_token,until:Date.now()+3000000};return result.access_token;
}
export async function readSheet(date,tasks,complete) {
 if(!process.env.GOOGLE_SHEET_ID||!process.env.GOOGLE_SERVICE_ACCOUNT_JSON)return {connected:false,status:'NOT_CONNECTED',rows:[],missing:null};
 try{
  const token=await accessToken(),base=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(process.env.GOOGLE_SHEET_ID)}`;
  const request=async path=>{const r=await fetch(base+path,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error(`Google Sheets returned HTTP ${r.status}.`);return r.json();};
  const meta=await request('?fields=sheets.properties,properties.timeZone');
  const expected=process.env.GOOGLE_SHEET_TAB||`${months[+date.slice(5,7)-1]} ${date.slice(0,4)}`;
  const tab=meta.sheets?.find(s=>s.properties?.title===expected)?.properties;
  if(!tab)throw new Error(`Sheet tab not found: ${expected}.`);
  // A bounded, complete read for the relevant tab. Do not scan accounting tabs.
  const rowCount=tab.gridProperties?.rowCount||1;
  if(rowCount>10000)throw new Error('Sheet tab exceeds the configured safe scan size.');
  const range=`'${expected.replace(/'/g,"''")}'!A1:Z${rowCount}`;
  const data=await request(`/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`);
  const parsed=normalizeRows(data.values||[],date),rows=matchRows(parsed.rows,tasks,complete);
  return {connected:true,status:'CONNECTED',checkedAt:Date.now(),tab:expected,rows,
   missing:complete?rows.filter(r=>r.status==='NOT_FOUND').length:null,
   needsMapping:rows.filter(r=>['NEEDS_ID','AMBIGUOUS','DATE_MISMATCH'].includes(r.status)).length,
   invalidDates:parsed.invalidDates,note:'Missing candidates use exact Onfleet IDs within the checked data. Blank IDs and duplicates need review; no automatic creation.'};
 }catch(e){return {connected:false,status:'ERROR',error:e.message,rows:[],missing:null};}
}

// Only apply a schedule when an exact Sheet ID identifies a pickup (or one explicit
// pickup dependency). Never reinterpret an arbitrary delivery time as pickup time.
export function sheetPlans(rows,tasks) {
 const candidates=new Map(),notes=[];
 for(const r of rows) {
  if(r.status!=='MATCHED'||!r.taskId)continue;
  const task=tasks.find(t=>t.id===r.taskId);if(!task)continue;
  const add=(t,plan)=>{const previous=candidates.get(t.id);
   if(previous&&JSON.stringify(previous)!==JSON.stringify(plan)){candidates.set(t.id,null);notes.push(`Conflicting Sheet schedules for task ${t.shortId||t.id}. No Sheet override applied.`);}
   else if(previous!==null)candidates.set(t.id,plan);
  };
  if(task.pickupTask===true) {
   const s=schedule(task);if(r.pickupAt&&s.pickup&&r.pickupAt!==s.pickup)notes.push(`Sheet pickup time differs from Onfleet for row ${r.row}. The Start cutoff uses the Sheet pickup time.`);
   if(r.pickupAt)add(task,{taskId:task.id,date:r.date,pickupAt:r.pickupAt});
  } else {
   if(r.deliveryAt)add(task,{taskId:task.id,date:r.date,deadlineAt:r.deliveryAt});
   const ids=(Array.isArray(task.dependencies)?task.dependencies:[]).map(idOf);
   const pickups=tasks.filter(t=>ids.includes(t.id)&&t.pickupTask===true&&schedule(t).day===r.date);
   if(pickups.length===1&&r.pickupAt)add(pickups[0],{taskId:pickups[0].id,date:r.date,pickupAt:r.pickupAt});
   else if(r.pickupAt)notes.push(`Sheet row ${r.row}: the pickup task is not uniquely linked. Its 60-minute Start check cannot use the Sheet time yet.`);
  }
 }
 return {plans:[...candidates.values()].filter(Boolean),notes:[...new Set(notes)]};
}
