// Read-only Onfleet adapter.
// Never convert a failed/partial API read into a healthy result.
import {localTime,shiftDay} from './rules.mjs';

const MIN_REQUEST_SPACING_MS=300; // ~3.3 req/s per runtime; leave headroom for Onfleet's organization-wide limit.
const MAX_429_RETRIES=4;
let paceTail=Promise.resolve();
let nextAllowedAt=0;

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function errorDetails(text) {
  try {
    const body = JSON.parse(text);
    const message = body?.message;
    const cause = typeof message === 'object' ? message?.cause || message?.message : message;
    const requestId = typeof message === 'object' ? message?.request : null;
    return { cause: typeof cause === 'string' ? cause : null, requestId };
  } catch {
    return { cause: null, requestId: null };
  }
}

function retryAfterMs(response,attempt){
  const raw=response.headers.get('retry-after');
  if(raw){
    const seconds=Number(raw);
    if(Number.isFinite(seconds)) return Math.max(1500,seconds*1000);
    const when=Date.parse(raw);
    if(Number.isFinite(when)) return Math.max(1500,when-Date.now());
  }
  return 1500*(2**attempt);
}

async function waitForRateSlot(){
  let release;
  const previous=paceTail;
  paceTail=new Promise(resolve=>{release=resolve;});
  await previous;
  const wait=Math.max(0,nextAllowedAt-Date.now());
  if(wait) await sleep(wait);
  nextAllowedAt=Date.now()+MIN_REQUEST_SPACING_MS;
  release();
}

function addCooldown(ms){
  nextAllowedAt=Math.max(nextAllowedAt,Date.now()+ms);
}

export async function requestOnfleet(path,{fetcher=fetch,key=process.env.ONFLEET_API_KEY}={}) {
  if(!key) throw new Error('ONFLEET_API_KEY is not configured.');

  for(let attempt=0;attempt<=MAX_429_RETRIES;attempt+=1){
    await waitForRateSlot();
    const response=await fetcher(`https://onfleet.com/api/v2${path}`,{
      method:'GET',
      headers:{Authorization:`Basic ${Buffer.from(`${key}:`).toString('base64')}`,Accept:'application/json'},
      signal:AbortSignal.timeout(15_000)
    });
    const text=await response.text();

    const remaining=Number(response.headers.get('x-ratelimit-remaining'));
    if(Number.isFinite(remaining) && remaining<=3) addCooldown(1500);

    if(response.status===429 && attempt<MAX_429_RETRIES){
      const wait=retryAfterMs(response,attempt);
      addCooldown(wait);
      await sleep(wait);
      continue;
    }

    if(!response.ok) {
      const details=errorDetails(text);
      const extra=details.cause?` ${details.cause}`:'';
      const req=details.requestId?` Request ID: ${details.requestId}.`:'';
      const hint=response.status===429?' The app slowed down automatically, but the organization is still rate-limited. Wait a few seconds and refresh once.':'';
      throw new Error(`Onfleet HTTP ${response.status}.${extra}${req}${hint}`.trim());
    }
    if(!text) return null;
    try{return JSON.parse(text);}catch{throw new Error('Onfleet returned invalid JSON.');}
  }

  throw new Error('Onfleet request could not be completed.');
}

export async function readPages(params,request=requestOnfleet,{maxPages=60,stopAt=Date.now()+20000}={}) {
  const tasks=[],seen=new Set();let cursor=null;
  for(let i=0;i<maxPages;i++) {
    if(Date.now()>=stopAt) return {tasks,complete:false};
    const q=new URLSearchParams(params);if(cursor) q.set('lastId',cursor);
    const data=await request(`/tasks/all?${q}`);
    if(!Array.isArray(data?.tasks)) throw new Error('Invalid Onfleet tasks response.');
    tasks.push(...data.tasks);
    if(!data.lastId) return {tasks,complete:true};
    if(seen.has(data.lastId)) throw new Error('Onfleet pagination repeated a cursor.');
    seen.add(data.lastId);cursor=data.lastId;
  }
  return {tasks,complete:false};
}

function taskId(value){
  if(typeof value==='string' && value) return value;
  if(value && typeof value.id==='string') return value.id;
  return null;
}

async function currentTaskIds(workers,request,stopAt){
  const ids=new Set();
  const warnings=[];
  let complete=true;

  for(const worker of workers){
    for(const value of Array.isArray(worker.tasks)?worker.tasks:[]) {
      const id=taskId(value); if(id) ids.add(id);
    }
    const active=taskId(worker.activeTask); if(active) ids.add(active);
  }

  // Organization containers include currently-unassigned work, including older tasks.
  const organizations=[...new Set(workers.map(w=>taskId(w.organization) || (typeof w.organization==='string'?w.organization:null)).filter(Boolean))];
  for(const organizationId of organizations){
    if(Date.now()>=stopAt){complete=false;break;}
    try{
      const container=await request(`/containers/organizations/${encodeURIComponent(organizationId)}`);
      for(const value of Array.isArray(container?.tasks)?container.tasks:[]) {
        const id=taskId(value); if(id) ids.add(id);
      }
    }catch(error){
      complete=false;
      warnings.push(`Unassigned Onfleet tasks could not be fully checked: ${error.message}`);
    }
  }

  return {ids:[...ids],complete,warnings};
}

async function fetchTasksById(ids,request,stopAt){
  const tasks=[];const warnings=[];let complete=true;
  // Intentionally sequential to avoid request bursts against Onfleet.
  for(const id of ids){
    if(Date.now()>=stopAt){complete=false;break;}
    try{
      const task=await request(`/tasks/${encodeURIComponent(id)}`);
      if(task) tasks.push(task);
    }catch(error){
      complete=false;
      warnings.push(`Task ${id} could not be read: ${error.message}`);
    }
  }
  return {tasks,complete,warnings};
}

let cached=null,pending=null;
export async function getOnfleet(date,{now=Date.now(),request=requestOnfleet,useCache=true}={}) {
  if(useCache && cached?.date===date && now-cached.at<60_000) return cached.value;
  if(useCache && pending?.date===date) return pending.promise;

  async function load() {
    const workers=await request('/workers');
    if(!Array.isArray(workers)) throw new Error('Invalid Onfleet workers response.');

    const stopAt=Date.now()+25_000;
    const currentIds=await currentTaskIds(workers,request,stopAt);

    // Fetch recent active tasks in batches. Individually fetch only current tasks
    // that fall outside this recent-creation window.
    const recentFrom=now-7*24*60*60*1000;
    let recent={tasks:[],complete:true};
    try{
      recent=await readPages({from:String(recentFrom),to:String(now+1),state:'0,1,2'},request,{stopAt});
    }catch(error){
      recent={tasks:[],complete:false,error};
    }
    const recentMap=new Map(recent.tasks.map(task=>[task.id,task]));
    const missingCurrentIds=currentIds.ids.filter(id=>!recentMap.has(id));
    const olderCurrent=await fetchTasksById(missingCurrentIds,request,stopAt);

    // Completed tasks are queried only in the selected delivery-day window.
    const start=localTime(date);
    const next=localTime(shiftDay(date,1));
    const end=Math.min(next ?? now+1,now+1);
    let done={tasks:[],complete:true};
    if(start!==null && start<end){
      try{done=await readPages({from:String(start),to:String(end),state:'3'},request,{stopAt});}
      catch(error){done={tasks:[],complete:false,error};}
    }

    const unique=new Map([...recent.tasks,...olderCurrent.tasks,...done.tasks].filter(Boolean).map(t=>[t.id,t]));
    const complete=currentIds.complete && recent.complete && olderCurrent.complete && done.complete;
    const warnings=[...currentIds.warnings,...olderCurrent.warnings];
    if(!recent.complete) warnings.push(`Recent active-task scan was partial${recent.error?`: ${recent.error.message}`:'.'}`);
    if(!done.complete) warnings.push(`Completed-task scan was partial${done.error?`: ${done.error.message}`:'.'}`);
    if(!complete) warnings.push('Onfleet data is partial. Missing-order and all-clear conclusions are disabled until the next complete check.');

    const value={
      workers,
      tasks:[...unique.values()],
      complete,
      observedAt:now,
      completionCoverage:{from:start,to:end},
      warnings
    };
    if(useCache) cached={date,at:now,value};
    return value;
  }

  const promise=load();if(useCache) pending={date,promise};
  try{return await promise;}finally{if(pending?.promise===promise) pending=null;}
}
