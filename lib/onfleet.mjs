// Read-only Onfleet adapter.
// Never convert a failed/partial API read into a healthy result.
import {localTime,shiftDay} from './rules.mjs';

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

export async function requestOnfleet(path,{fetcher=fetch,key=process.env.ONFLEET_API_KEY}={}) {
  if(!key) throw new Error('ONFLEET_API_KEY is not configured.');
  const response=await fetcher(`https://onfleet.com/api/v2${path}`,{
    method:'GET',
    headers:{Authorization:`Basic ${Buffer.from(`${key}:`).toString('base64')}`,Accept:'application/json'},
    signal:AbortSignal.timeout(15_000)
  });
  const text=await response.text();
  if(!response.ok) {
    const details=errorDetails(text);
    const extra=details.cause?` ${details.cause}`:'';
    const req=details.requestId?` Request ID: ${details.requestId}.`:'';
    throw new Error(`Onfleet HTTP ${response.status}.${extra}${req}`.trim());
  }
  if(!text) return null;
  try{return JSON.parse(text);}catch{throw new Error('Onfleet returned invalid JSON.');}
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

  // Include currently-unassigned tasks without an unbounded /tasks/all?from=0 scan.
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

async function fetchTasksById(ids,request,stopAt,{batchSize=10}={}){
  const tasks=[];const warnings=[];let complete=true;
  for(let i=0;i<ids.length;i+=batchSize){
    if(Date.now()>=stopAt){complete=false;break;}
    const batch=ids.slice(i,i+batchSize);
    const results=await Promise.all(batch.map(async id=>{
      try{return {task:await request(`/tasks/${encodeURIComponent(id)}`)};}
      catch(error){return {error,id};}
    }));
    for(const result of results){
      if(result.task) tasks.push(result.task);
      else {
        complete=false;
        warnings.push(`Task ${result.id} could not be read: ${result.error.message}`);
      }
    }
  }
  return {tasks,complete,warnings};
}

let cached=null,pending=null;
export async function getOnfleet(date,{now=Date.now(),request=requestOnfleet,useCache=true}={}) {
  if(useCache && cached?.date===date && now-cached.at<30_000) return cached.value;
  if(useCache && pending?.date===date) return pending.promise;

  async function load() {
    // Full worker objects provide organization, tasks, activeTask, presence and location.
    const workers=await request('/workers');
    if(!Array.isArray(workers)) throw new Error('Invalid Onfleet workers response.');

    const stopAt=Date.now()+25_000;
    const currentIds=await currentTaskIds(workers,request,stopAt);
    const current=await fetchTasksById(currentIds.ids,request,stopAt);

    // Completed tasks are queried only in a bounded selected-day window.
    const start=localTime(date);
    const next=localTime(shiftDay(date,1));
    const end=Math.min(next ?? now+1,now+1);
    const done=(start!==null && start<end)
      ? await readPages({from:String(start),to:String(end),state:'3'},request,{stopAt})
      : {tasks:[],complete:true};

    const unique=new Map([...current.tasks,...done.tasks].filter(Boolean).map(t=>[t.id,t]));
    const complete=currentIds.complete && current.complete && done.complete;
    const warnings=[...currentIds.warnings,...current.warnings];
    if(!done.complete) warnings.push('Completed-task scan reached its safety limit. Historical totals may be partial.');
    if(!complete) warnings.push('Onfleet data is partial. Missing-order conclusions are disabled until the next complete check.');

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
