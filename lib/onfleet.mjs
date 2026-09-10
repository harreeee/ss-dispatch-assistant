// Read-only adapter. A failed/truncated fetch MUST NOT become an empty healthy result.
import {localTime,shiftDay} from './rules.mjs';
export async function requestOnfleet(path,{fetcher=fetch,key=process.env.ONFLEET_API_KEY}={}) {
  if(!key) throw new Error('ONFLEET_API_KEY is not configured.');
  const response=await fetcher(`https://onfleet.com/api/v2${path}`,{method:'GET',headers:{Authorization:`Basic ${Buffer.from(`${key}:`).toString('base64')}`,Accept:'application/json'},signal:AbortSignal.timeout(15_000)});
  if(!response.ok) throw new Error(`Onfleet returned HTTP ${response.status}. Check permissions or retry. No healthy result was assumed.`);
  return response.json();
}
export async function readPages(params,request=requestOnfleet,{maxPages=60,stopAt=Date.now()+20000}={}) {
  const tasks=[],seen=new Set();let cursor=null;
  for(let i=0;i<maxPages;i++) {
    if(Date.now()>=stopAt) return {tasks,complete:false};
    const q=new URLSearchParams(params);if(cursor) q.set('lastId',cursor);
    const data=await request(`/tasks/all?${q}`);
    if(!Array.isArray(data.tasks)) throw new Error('Invalid Onfleet tasks response.');
    tasks.push(...data.tasks);
    if(!data.lastId) return {tasks,complete:true};
    if(seen.has(data.lastId)) throw new Error('Onfleet pagination repeated a cursor.');
    seen.add(data.lastId);cursor=data.lastId;
  }
  return {tasks,complete:false};
}
let cached=null,pending=null;
export async function getOnfleet(date,{now=Date.now(),request=requestOnfleet,useCache=true}={}) {
  if(useCache && cached?.date===date && now-cached.at<30_000) return cached.value;
  if(useCache && pending?.date===date) return pending.promise;
  async function load() {
    const workers=await request('/workers?filter=id,name,displayName,onDuty,activeTask,tasks,timeLastSeen,location');
    if(!Array.isArray(workers)) throw new Error('Invalid Onfleet workers response.');
    // from/to on incomplete tasks filter CREATION time, not scheduled pickup time.
    const stopAt=Date.now()+25000;
    const active=await readPages({from:'0',to:String(now+1),state:'0,1,2'},request,{stopAt});
    const start=localTime(shiftDay(date,-1)),end=Math.min(now+1,localTime(shiftDay(date,8)));
    const done=start<end?await readPages({from:String(start),to:String(end),state:'3'},request,{stopAt}):{tasks:[],complete:true};
    const unique=new Map([...active.tasks,...done.tasks].map(t=>[t.id,t]));
    const value={workers,tasks:[...unique.values()],complete:active.complete&&done.complete,observedAt:now,
      completionCoverage:{from:start,to:end},warnings:[]};
    if(!value.complete) value.warnings.push('Onfleet scan limit reached. Missing-order conclusions are disabled.');
    if(useCache) cached={date,at:now,value};
    return value;
  }
  const promise=load();if(useCache) pending={date,promise};
  try{return await promise;}finally{if(pending?.promise===promise) pending=null;}
}
