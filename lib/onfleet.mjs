// Read-only Onfleet adapter. Partial data must never become an all-clear.
// Per-runtime pacing is not an organization-wide distributed rate limiter.
import {localTime,shiftDay} from './rules.mjs';

const MAX_RUNTIME_MS=7000;
const RECENT_ACTIVE_DAYS=7;
const MAX_FALLBACK_TASKS=8;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function retryDelay(raw,now=Date.now(),fallback=2000){
 if(typeof raw!=='string'||!raw.trim())return fallback;
 const n=Number(raw);
 if(Number.isFinite(n)&&n>=0)return Math.max(1000,n*1000);
 const at=Date.parse(raw);
 return Number.isFinite(at)?Math.max(1000,at-now):fallback;
}
function providerError(response,text,key){
 let cause='',requestId='';
 try{const body=JSON.parse(text),m=body?.message;
  cause=typeof m==='string'?m:(m?.cause||m?.message||'');
  requestId=typeof m==='object'?m?.request||'':'';
 }catch{}
 const safe=v=>String(v||'').split(key).join('[redacted]').replace(/[\r\n]/g,' ').slice(0,320);
 const error=new Error(`Onfleet HTTP ${response.status}. ${safe(cause)}${requestId?' Request ID: '+safe(requestId)+'.':''}`.trim());
 error.status=response.status;
 return error;
}

// Queue the entire HTTP operation, not just the start slot. A retry/cooldown
// therefore also holds later callers. Clock/sleep injection enables real tests.
export function createOnfleetRequest({clock=Date.now,sleep=pause,random=Math.random,spacingMs=400,maxRetries=1}={}){
 let tail=Promise.resolve(),nextAt=0,blockedUntil=0,lastRateError=null;
 return function request(path,{fetcher=fetch,key=process.env.ONFLEET_API_KEY,stopAt=clock()+MAX_RUNTIME_MS}={}){
  if(!key)return Promise.reject(new Error('ONFLEET_API_KEY is not configured.'));
  function rateError(){const e=new Error(lastRateError?.message||'Onfleet is rate limited. Waiting before the next check.');e.status=429;e.retryAfterMs=Math.max(1000,blockedUntil-clock());return e;}
  const job=tail.then(async()=>{
   if(clock()<blockedUntil)throw rateError();
   for(let attempt=0;attempt<=maxRetries;attempt++){
    const wait=Math.max(0,nextAt-clock());
    if(clock()+wait>=stopAt){const e=new Error('Onfleet check reached its time budget; retry shortly.');e.name='TimeoutError';throw e;}
    if(wait)await sleep(wait);
    nextAt=clock()+spacingMs;
    const timeout=Math.max(1,Math.min(8000,Math.floor(stopAt-clock())));
    const response=await fetcher(`https://onfleet.com/api/v2${path}`,{
     method:'GET',headers:{Authorization:`Basic ${Buffer.from(`${key}:`).toString('base64')}`,Accept:'application/json'},signal:AbortSignal.timeout(timeout)
    });
    const text=await response.text();
    const remaining=response.headers.get('x-ratelimit-remaining');
    // Number(null) is 0: absence of this header must not imply an empty quota.
    if(remaining!==null&&remaining.trim()!==''&&Number.isFinite(Number(remaining))&&Number(remaining)<=2)nextAt=Math.max(nextAt,clock()+1100);
    if(response.status===429){
     lastRateError=providerError(response,text,key);
     const delay=retryDelay(response.headers.get('retry-after'),clock(),2000*2**attempt)+Math.floor(random()*250);
     nextAt=Math.max(nextAt,clock()+delay);
     if(attempt<maxRetries&&nextAt+500<stopAt)continue;
     // Stop the whole scan rather than retrying separately for every driver.
     blockedUntil=Math.max(nextAt,clock()+15000);
     throw rateError();
    }
    if(!response.ok)throw providerError(response,text,key);
    if(!text)throw new Error('Onfleet returned an empty response.');
    try{return JSON.parse(text);}catch{throw new Error('Onfleet returned invalid JSON.');}
   }
  });
  tail=job.catch(()=>{}); // A failure cannot poison the queue for all future calls.
  return job;
 };
}
export const requestOnfleet=createOnfleetRequest();

export async function readPages(params,request=requestOnfleet,{maxPages=12,stopAt=Date.now()+MAX_RUNTIME_MS}={}){
 const tasks=[],seen=new Set();let cursor=null;
 for(let page=0;page<maxPages;page++){
  if(Date.now()>=stopAt)return {tasks,complete:false};
  const q=new URLSearchParams(params);if(cursor)q.set('lastId',cursor);
  let data;
  try{data=await request(`/tasks/all?${q}`,{stopAt});}
  catch(e){
   if(e.status===429||e.name==='TimeoutError')return {tasks,complete:false,error:e.message,retryAfterMs:e.retryAfterMs||0};
   throw e;
  }
  if(!Array.isArray(data?.tasks))throw new Error('Invalid Onfleet tasks response.');
  tasks.push(...data.tasks);
  if(!data.lastId)return {tasks,complete:true};
  if(seen.has(data.lastId))throw new Error('Onfleet pagination repeated a cursor.');
  seen.add(data.lastId);cursor=data.lastId;
 }
 return {tasks,complete:false};
}
function idOf(value){return typeof value==='string'&&value?value:typeof value?.id==='string'?value.id:null;}
async function fetchFallbackTasks(ids,request,stopAt){
 const tasks=[],warnings=[];let complete=true,retryAfterMs=0;
 for(const id of ids.slice(0,MAX_FALLBACK_TASKS)){
  if(Date.now()>=stopAt){complete=false;break;}
  try{const task=await request(`/tasks/${encodeURIComponent(id)}`,{stopAt});
   if(task?.id!==id){complete=false;warnings.push('A task response did not match its requested ID.');}else tasks.push(task);
  }catch(e){complete=false;warnings.push(`Task ${id} could not be refreshed: ${e.message}`);
   if(e.status===429||e.name==='TimeoutError'){retryAfterMs=e.retryAfterMs||0;break;}
  }
 }
 if(ids.length>MAX_FALLBACK_TASKS){complete=false;warnings.push(`${ids.length-MAX_FALLBACK_TASKS} older assigned task(s) were skipped to keep the dashboard responsive.`);}
 return {tasks,complete,warnings,retryAfterMs};
}
// Keep date caches separate: switching Today/Tomorrow must not evict an in-flight
// request for the first date and start a duplicate scan. Never share across keys.
const contexts=new WeakMap();
export async function getOnfleet(date,{now=Date.now(),request=requestOnfleet,useCache=true}={}){
 let context=contexts.get(request);
 if(!context){context={key:process.env.ONFLEET_API_KEY,cache:new Map(),pending:new Map()};contexts.set(request,context);}
 if(context.key!==process.env.ONFLEET_API_KEY){context={key:process.env.ONFLEET_API_KEY,cache:new Map(),pending:new Map()};contexts.set(request,context);}
 const cached=context.cache.get(date);
 if(useCache&&cached&&now>=cached.at&&now-cached.at<45000)return cached.value;
 if(useCache&&context.pending.has(date))return context.pending.get(date);
 async function load(){
  const stopAt=Date.now()+MAX_RUNTIME_MS;
  const workers=await request('/workers',{stopAt});
  if(!Array.isArray(workers))throw new Error('Invalid Onfleet workers response.');
  const recentFrom=now-RECENT_ACTIVE_DAYS*86400000;
  const active=await readPages({from:String(recentFrom),to:String(now+1),state:'0,1,2'},request,{maxPages:12,stopAt});
  const activeMap=new Map(active.tasks.map(t=>[t.id,t]));
  const missingActiveIds=[...new Set(workers.map(w=>idOf(w.activeTask)).filter(Boolean).filter(id=>!activeMap.has(id)))];
  // A throttled page stops this scan. Do not flood Onfleet with fallback calls.
  const fallback=active.error?{tasks:[],complete:missingActiveIds.length===0,warnings:[],retryAfterMs:active.retryAfterMs||0}:await fetchFallbackTasks(missingActiveIds,request,stopAt);
  const start=localTime(date),end=localTime(shiftDay(date,1)),cutoff=Math.min(end,now+1);
  let done={tasks:[],complete:true};
  if(start!==null&&end!==null&&start<cutoff){
   if(active.error||fallback.retryAfterMs)done={tasks:[],complete:false};
   else{
    try{done=await readPages({from:String(start),to:String(cutoff),state:'3'},request,{maxPages:8,stopAt});}
    catch(e){done={tasks:[],complete:false,error:e.message};}
   }
  }
  const unique=new Map([...active.tasks,...fallback.tasks,...done.tasks].filter(Boolean).map(t=>[t.id,t]));
  const fetchedIds=new Set(unique.keys());
  const queuedIds=workers.flatMap(w=>Array.isArray(w.tasks)?w.tasks.map(idOf).filter(Boolean):[]);
  const unseenQueued=[...new Set(queuedIds.filter(id=>!fetchedIds.has(id)))];
  const complete=active.complete&&fallback.complete&&done.complete&&unseenQueued.length===0;
  const warnings=[...fallback.warnings];
  if(!active.complete)warnings.push(active.error||'Active-task scan hit its safety limit. The visible results are partial.');
  if(!done.complete)warnings.push(done.error||'Completed-task scan was not fully checked. Historical totals are partial.');
  if(unseenQueued.length)warnings.push(`${unseenQueued.length} queued task(s) fall outside the fast scan window; all-clear and missing-order conclusions are disabled.`);
  if(!complete)warnings.push('Onfleet data is partial. Known problems are shown, but an all-clear cannot be verified.');
  const value={workers,tasks:[...unique.values()],complete,observedAt:now,completionCoverage:{from:start,to:cutoff},warnings,
   retryAfterMs:Math.max(active.retryAfterMs||0,fallback.retryAfterMs||0,done.retryAfterMs||0)};
  if(useCache){context.cache.set(date,{at:now,value});while(context.cache.size>7)context.cache.delete(context.cache.keys().next().value);}
  return value;
 }
 const promise=load();if(useCache)context.pending.set(date,promise);
 try{return await promise;}finally{if(context.pending.get(date)===promise)context.pending.delete(date);}
}
