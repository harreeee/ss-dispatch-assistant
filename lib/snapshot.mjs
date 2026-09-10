import {getOnfleet} from './onfleet.mjs';
import {makeSnapshot,dayAt,MINUTE} from './rules.mjs';
import {getState,storageConfigured} from './store.mjs';
import {readSheet,sheetPlans} from './sheets.mjs';
export function addSamples(history,workers,now){
 const next={};
 for(const w of workers){const taskId=typeof w.activeTask==='string'?w.activeTask:w.activeTask?.id;
  if(!taskId||!Array.isArray(w.location))continue;
  const list=(history?.[w.id]||[]).filter(x=>now-x.at<=15*MINUTE&&x.taskId===taskId);
  if(!list.length||now-list.at(-1).at>=30000)list.push({at:now,seen:w.timeLastSeen,location:w.location,taskId});
  next[w.id]=list.slice(-31);
 }
 return next;
}
export async function computeSnapshot(date,{raw=null,history={},now=Date.now()}={}) {
 raw=raw||await getOnfleet(date,{now});
 const sheet=await readSheet(date,raw.tasks,raw.complete);
 const mapped=sheetPlans(sheet.rows||[],raw.tasks);
 const snapshot=makeSnapshot({workers:raw.workers,tasks:raw.tasks,date,now,complete:raw.complete,samples:history,plans:mapped.plans});
 snapshot.warnings.push(...raw.warnings,...mapped.notes);
 snapshot.sheet=sheet;
 snapshot.summary.missing=snapshot.sheet.missing;
 if(snapshot.sheet.connected) {
  for(const row of snapshot.sheet.rows){
   if(row.status==='NOT_FOUND')snapshot.issues.push({id:`${date}:sheet:${row.row}:NOT_FOUND`,kind:'SHEET_NOT_FOUND',severity:'WATCH',date,driverName:'Not linked',message:`Sheet row ${row.row}: exact Onfleet ID was not found in the checked data. Confirm before creating a task.`,row:row.row});
   if(['NEEDS_ID','AMBIGUOUS','DATE_MISMATCH'].includes(row.status))snapshot.issues.push({id:`${date}:sheet:${row.row}:MAPPING`,kind:'SHEET_MAPPING',severity:'WATCH',date,driverName:'Needs review',message:`Sheet row ${row.row}: ${row.status.replaceAll('_',' ')}.`,row:row.row});
  }
 }
 snapshot.sources={onfleet:{checkedAt:raw.observedAt,complete:raw.complete},sheet:{connected:snapshot.sheet.connected,checkedAt:snapshot.sheet.checkedAt||null}};
 return snapshot;
}
export async function currentSnapshot(date) {
 let monitor=null,warning=null;
 if(storageConfigured())try{monitor=await getState('monitor');}catch{warning='Persistent monitor storage is unavailable.';}
 const now=Date.now();
 const fresh=monitor?.lastSuccessAt&&now-monitor.lastSuccessAt<150000;
 const history=monitor?.samples||{};
 const snapshot=await computeSnapshot(date,{history,now});
 if(warning)snapshot.warnings.push(warning);
 if(!fresh)snapshot.warnings.push('Movement history is not verified until the server monitor is running. Started tasks alone do not prove movement.');
 snapshot.background={configured:storageConfigured(),running:Boolean(fresh),lastSuccessAt:monitor?.lastSuccessAt||null,
  note:fresh?'Background checks are reporting.':'Background monitoring is not verified. Opening the app alone cannot deliver alerts while it is closed.'};
 if(date!==dayAt(now))snapshot.warnings.push('Delivery status is for the selected date. Online/off-duty presence is current, not historical.');
 return snapshot;
}
