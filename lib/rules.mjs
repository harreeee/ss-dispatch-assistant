// Deterministic dispatch checks. All schedule calculations use Toronto, never browser time.
export const TZ = 'America/Toronto';
export const MINUTE = 60_000;
export const START_LEAD_MS = 60 * MINUTE;
const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year:'numeric',month:'2-digit',day:'2-digit' });
export function dayAt(ms = Date.now()) {
  const p = Object.fromEntries(dateFormat.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export function validDay(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const n = Date.parse(`${s}T12:00:00Z`);
  return Number.isFinite(n) && new Date(n).toISOString().slice(0,10) === s;
}
export function shiftDay(day, delta) {
  if (!validDay(day)) throw new Error('Invalid calendar date');
  return new Date(Date.parse(`${day}T12:00:00Z`) + delta*86400000).toISOString().slice(0,10);
}
export function localTime(day, hour=0, minute=0) {
  if (!validDay(day) || hour<0 || hour>23 || minute<0 || minute>59) return null;
  const [y,m,d] = day.split('-').map(Number);
  const target = Date.UTC(y,m-1,d,hour,minute);
  let candidate = target;
  const fmt = new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  for(let i=0;i<4;i++) {
    const p=Object.fromEntries(fmt.formatToParts(new Date(candidate)).map(x=>[x.type,x.value]));
    const wall=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute);
    if(wall===target) return candidate;
    candidate += target-wall;
  }
  return null; // Nonexistent DST wall time is unknown, not silently shifted.
}
export function timestamp(value) {
  if (value===null || value===undefined || value==='') return null;
  const n=Number(value);
  // Onfleet timestamps are milliseconds. Do not guess units for malformed fields.
  return Number.isFinite(n) && n>=946684800000 && n<4102444800000 ? n : null;
}
export function idOf(v) { return typeof v==='string' ? v : v?.id || null; }
export function schedule(task) {
  const after=timestamp(task.completeAfter), before=timestamp(task.completeBefore);
  if(after && before && before<after) return {day:null, pickup:null, deadline:null, invalid:true};
  const anchor=task.pickupTask===true ? (after||before) : (before||after);
  return {day: anchor ? dayAt(anchor) : null, pickup: task.pickupTask===true ? (after||before) : null, deadline:before, invalid:false};
}
export function eventTime(task, name) {
  const times=(task.completionDetails?.events||[]).filter(e=>e.name===name).map(e=>timestamp(e.time)).filter(Boolean);
  return times.length ? Math.max(...times) : null;
}
export function hasStarted(task) {
  return task.state===2 || task.state===3; // Assigned/previously stopped is NOT currently started.
}
export function checkTask(task, {now=Date.now(), selectedDate=dayAt(now), plan=null}={}) {
  const s=schedule(task);
  const plannedDay=plan?.date || s.day;
  if(plannedDay!==selectedDate) return null;
  const pickup=timestamp(plan?.pickupAt) || s.pickup;
  const deadline=timestamp(plan?.deadlineAt) || s.deadline;
  const startDue=pickup ? pickup-START_LEAD_MS : null;
  const base={id:task.id, shortId:task.shortId||task.id, workerId:idOf(task.worker)||idOf(task.container?.worker),
    date:plannedDay, type:task.pickupTask===true?'PICKUP':'DELIVERY', pickupAt:pickup,deadlineAt:deadline,
    startDueAt:startDue, state:task.state, active:task.state===2, status:'UNKNOWN', flags:[], forecastAt:null};
  function flag(kind,severity,message,dueAt=null) {base.flags.push({id:`${plannedDay}:${task.id}:${kind}`,kind,severity,message,taskId:task.id,date:plannedDay,workerId:base.workerId,dueAt});}
  if(s.invalid) {flag('INVALID_SCHEDULE','WATCH','Time window is invalid. Confirm the schedule.');return base;}
  if(task.state===3) {
    const done=timestamp(task.completionDetails?.time);
    if(task.completionDetails?.success===false) {base.status='FAILED';flag('FAILED','URGENT','Task completed unsuccessfully.');}
    else if(task.completionDetails?.success!==true || !done || !deadline) base.status='COMPLETED_UNVERIFIED';
    else base.status=done>deadline?'COMPLETED_LATE':'COMPLETED_ON_TIME';
    base.completedAt=done;
    return base;
  }
  if(![0,1,2].includes(task.state)) return base;
  const dueForMonitoring=startDue ?? (deadline ? deadline-START_LEAD_MS : null);
  if(dueForMonitoring!==null && now<dueForMonitoring) {base.status='SCHEDULED';return base;}
  if(selectedDate>dayAt(now) && (startDue===null || now<startDue)) {base.status='SCHEDULED';return base;}
  if(task.pickupTask===true && startDue!==null && now>=startDue && !hasStarted(task)) {
    flag('NOT_STARTED',now>=startDue+15*MINUTE?'URGENT':'WATCH','Pickup task has not been started by the 60-minute cutoff.',startDue);
  }
  if(!base.workerId && dueForMonitoring!==null && now>=dueForMonitoring) flag('UNASSIGNED','URGENT','No driver is assigned.',dueForMonitoring);
  if(deadline!==null && now>deadline) {base.status='LATE';flag('LATE','URGENT','Task is unfinished after its completion deadline.',deadline);return base;}
  if(!deadline) {
    base.status=base.flags.length?'ACTION_REQUIRED':'UNKNOWN';
    if(!base.flags.length) flag('MISSING_TIME','WATCH','No completion deadline; on-time status cannot be verified.');
    return base;
  }
  let predicted=null;
  if(task.state===2 && Number.isFinite(task.eta) && task.eta>=0) {
    const service=Number.isFinite(task.serviceTime) && task.serviceTime>=0 ? task.serviceTime : 0;
    predicted=now+task.eta*1000+service*1000;
  } else predicted=timestamp(task.estimatedCompletionTime);
  if(predicted!==null && predicted<now-MINUTE) predicted=null; // Expired forecasts are not evidence.
  base.forecastAt=predicted;
  if(predicted!==null && deadline-predicted<=10*MINUTE) {
    flag('ETA_RISK','WATCH',predicted>deadline?'Estimated completion is after the deadline.':'Estimated completion has 10 minutes or less of buffer.',deadline);
  }
  // Route/worker delayTime is intentionally not used: it can refer to tomorrow's queue.
  if(base.flags.some(f=>f.kind==='NOT_STARTED'||f.kind==='UNASSIGNED')) base.status='ACTION_REQUIRED';
  else if(base.flags.length) base.status='AT_RISK';
  else base.status=predicted!==null?'ON_TIME':'UNKNOWN';
  return base;
}
export function coordinates(value) {
  if(!Array.isArray(value) || value.length!==2) return null;
  const [lon,lat]=value;
  return Number.isFinite(lon)&&Number.isFinite(lat)&&Math.abs(lon)<=180&&Math.abs(lat)<=90 ? [lon,lat] : null;
}
export function distance(a,b) {
  if(!coordinates(a)||!coordinates(b)) return Infinity;
  const rad=Math.PI/180,lat1=a[1]*rad,lat2=b[1]*rad;
  const dlat=lat2-lat1,dlon=(b[0]-a[0])*rad;
  const h=Math.sin(dlat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dlon/2)**2;
  return 6371000*2*Math.asin(Math.min(1,Math.sqrt(h)));
}
export function motion(worker, task, samples=[], now=Date.now()) {
  if(!task || task.state!==2) return 'IDLE';
  const lastSeen=timestamp(worker.timeLastSeen), location=coordinates(worker.location);
  if(!lastSeen || now-lastSeen>3*MINUTE || lastSeen>now+MINUTE || !location) return 'GPS_STALE';
  if(distance(location,task.destination?.location)<=150) return 'AT_STOP';
  const points=samples.filter(p=>p.taskId===task.id && now-p.at<=15*MINUTE && now-p.at>=0 && coordinates(p.location) && p.seen && p.at-p.seen<=3*MINUTE && p.seen<=p.at+MINUTE).sort((a,b)=>a.at-b.at);
  if(points.length<2) return 'CHECKING';
  const previous=points.filter(p=>p.at<now-30_000).at(-1);
  if(previous && now-previous.at<=3*MINUTE && distance(previous.location,location)>=100) return 'MOVING';
  if(points.length<6 || now-points[0].at<10*MINUTE) return 'CHECKING';
  if(points.some((p,i)=>i>0 && p.at-points[i-1].at>3*MINUTE)) return 'CHECKING';
  if(now-points.at(-1).at>3*MINUTE) return 'CHECKING';
  // This is GPS evidence of a possible stop, NOT a finding of driver misconduct.
  return points.every(p=>distance(p.location,location)<=75)?'STATIONARY':'CHECKING';
}
const STATUS_RANK={LATE:0,NOT_STARTED:1,AT_RISK:2,UNKNOWN:3,ON_TIME:4,SCHEDULED:5,DONE:6,NO_TASKS:7};
export function makeSnapshot({workers=[],tasks=[],date=dayAt(),now=Date.now(),complete=true,samples={},plans=[]}) {
  const checks=tasks.map(t=>checkTask(t,{now,selectedDate:date,plan:plans.find(p=>p.taskId===t.id)})).filter(Boolean);
  const flags=checks.flatMap(t=>t.flags);
  const drivers=workers.map(w=>{
    const own=checks.filter(t=>t.workerId===w.id), open=own.filter(t=>t.state!==3);
    let status='NO_TASKS';
    if(open.some(t=>t.status==='LATE')) status='LATE';
    else if(open.some(t=>t.flags.some(f=>f.kind==='NOT_STARTED'))) status='NOT_STARTED';
    else if(open.some(t=>['AT_RISK','ACTION_REQUIRED'].includes(t.status))) status='AT_RISK';
    else if(!complete) status='UNKNOWN';
    else if(open.some(t=>t.status==='UNKNOWN')) status='UNKNOWN';
    else if(open.some(t=>t.status==='ON_TIME')) status='ON_TIME';
    else if(open.length) status='SCHEDULED';
    else if(own.length) status='DONE';
    const active=tasks.find(t=>t.id===idOf(w.activeTask) && open.some(x=>x.id===t.id));
    const movement=date===dayAt(now)?motion(w,active,samples[w.id]||[],now):'NOT_CURRENT';
    if(['STATIONARY','GPS_STALE'].includes(movement) && active) {
      flags.push({id:`${date}:${w.id}:${movement}`,kind:movement,severity:'WATCH',date,workerId:w.id,taskId:active.id,
        message:movement==='STATIONARY'?'GPS position has barely changed for at least 10 minutes away from the task destination. Check with driver.':'Recent driver location is unavailable; movement and ETA need verification.'});
      if(!['LATE','NOT_STARTED'].includes(status)) status=movement==='GPS_STALE'?'UNKNOWN':'AT_RISK';
    }
    const livePresence=w.onDuty===true && timestamp(w.timeLastSeen) && now-w.timeLastSeen<=3*MINUTE && w.timeLastSeen<=now+MINUTE;
    if(w.onDuty===false && open.some(t=>t.status!=='SCHEDULED') && date===dayAt(now)) {
      flags.push({id:`${date}:${w.id}:OFF_DUTY`,kind:'OFF_DUTY',severity:'WATCH',date,workerId:w.id,message:'Driver is off duty with work due in the monitoring window.'});
      if(!['LATE','NOT_STARTED'].includes(status)) status='AT_RISK';
    }
    return {id:w.id,name:w.displayName||w.name||'Unnamed driver',online:Boolean(livePresence),onDuty:w.onDuty===true,
      presence:w.onDuty!==true?'OFF_DUTY':livePresence?'ONLINE':'STALE',status,deliveryStatus:status,movement,
      taskCountForDay:own.length,activeTaskCount:open.length,timeLastSeen:timestamp(w.timeLastSeen)};
  }).sort((a,b)=>(STATUS_RANK[a.status]-STATUS_RANK[b.status])||a.name.localeCompare(b.name));
  const names=new Map(drivers.map(d=>[d.id,d.name]));
  flags.forEach(f=>{f.driverName=names.get(f.workerId)||'Unassigned';});
  const incompleteCount=tasks.filter(t=>[0,1,2].includes(t.state)&&!schedule(t).day&&!plans.some(p=>p.taskId===t.id)).length;
  return {version:'1.2.0',connected:true,date,today:dayAt(now),timeZone:TZ,checkedAt:now,complete,drivers,tasks:checks,issues:flags,
    warnings:incompleteCount?[`${incompleteCount} unscheduled task(s) cannot be assigned to a date and are excluded from totals.`]:[],
    summary:{total:drivers.length,online:drivers.filter(d=>d.online).length,offline:drivers.filter(d=>!d.online).length,
      onTime:drivers.filter(d=>d.status==='ON_TIME').length,late:checks.filter(t=>t.status==='LATE').length,
      atRisk:checks.filter(t=>t.status==='AT_RISK').length,notStarted:checks.filter(t=>t.flags.some(f=>f.kind==='NOT_STARTED')).length,
      movingOnTime:drivers.filter(d=>d.movement==='MOVING'&&d.status==='ON_TIME').length,
      stationary:drivers.filter(d=>d.movement==='STATIONARY').length,gpsUnknown:drivers.filter(d=>d.movement==='GPS_STALE').length,
      tasks:checks.length,missing:null},sheet:{connected:false,status:'NOT_CONNECTED'}};
}
