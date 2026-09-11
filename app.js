const $=id=>document.getElementById(id);
const TZ='America/Toronto';
function today(){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;}
function nextDay(d){return new Date(Date.parse(d+'T12:00:00Z')+86400000).toISOString().slice(0,10);}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function label(s){return String(s||'UNKNOWN').replaceAll('_',' ');}
function time(ms){return ms?new Intl.DateTimeFormat('en-CA',{timeZone:TZ,hour:'numeric',minute:'2-digit'}).format(new Date(ms)):'Unknown';}
const badge=s=>`<span class="status ${/^[A-Z_]+$/.test(s)?s:'UNKNOWN'}">${esc(label(s))}</span>`;
let data=null,selected=today(),followToday=true,view='dashboard',issueFilter='ALL',driverFilter='ALL',seq=0;
let loading=false,queuedLoad=false,lastLoadStartedAt=0,lastLoadDate=null,activeDate=null;
let retryNotBefore=0,refreshTimer=null;
let pushConfig={configured:false},registration=null;
$('datePicker').value=selected;
function display(viewName){view=viewName;document.querySelectorAll('.view').forEach(e=>e.classList.toggle('hidden',e.id!==view));document.querySelectorAll('[data-view]').forEach(e=>e.classList.toggle('active',e.dataset.view===view));$('pageTitle').textContent=({dashboard:selected===today()?"Today's overview":'Delivery overview',drivers:'Driver status',orders:'Order checks',settings:'Phone alerts'})[view];}
function setDate(d,auto=false){if(!/^\d{4}-\d{2}-\d{2}$/.test(d))return;selected=d;followToday=auto;$('datePicker').value=d;$('todayBtn').classList.toggle('active',d===today());$('tomorrowBtn').classList.toggle('active',d===nextDay(today()));data=null;clearData();display(view);load({force:true});}
function clearData(){for(const id of ['countLate','countStart','countMissing','countMoving','onlineCount','dayDriverCount','issueTotal'])$(id).textContent='-';for(const id of ['issueList','driverList','sheetList','taskList'])$(id).innerHTML='<div class="empty">Loading checked data...</div>';}
async function request(path,options={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 try{
  const response=await fetch(path,{cache:'no-store',credentials:'same-origin',...options,signal:options.signal||controller.signal});
  if(!(response.headers.get('content-type')||'').includes('application/json'))throw new Error('The server API is not available. Check that api/ was uploaded and deployed.');
  const body=await response.json();
  if(response.status===401){showLogin();throw new Error('Session expired. Sign in again.');}
  if(!response.ok){const e=new Error(body.error||`Request failed (${response.status})`);e.status=response.status;
   const delay=Number(body.retryAfterSeconds||response.headers.get('retry-after'));
   e.retryAfterSeconds=Number.isFinite(delay)&&delay>0?delay:(response.status===429?15:0);throw e;}
  return body;
 }catch(e){if(e.name==='AbortError')throw new Error('Refresh timed out. The current status could not be verified.');throw e;}
 finally{clearTimeout(timer);}
}
function render(){if(!data)return;
 const s=data.summary||{};$('countLate').textContent=s.late??'-';$('countStart').textContent=s.notStarted??'-';$('countMissing').textContent=s.missing??'-';$('countMoving').textContent=s.movingOnTime??'-';$('onlineCount').textContent=s.online??'-';$('dayDriverCount').textContent=data.drivers.filter(d=>d.taskCountForDay>0).length;
 const notes=[...(data.warnings||[])];if(!data.complete)notes.unshift('Partial Onfleet data. On-time and missing-order conclusions may be unavailable.');if(!data.sheet.connected)notes.push('Google Sheet is not connected: missing orders cannot yet be checked.');
 $('warnings').innerHTML=notes.map(n=>`<div class="notice">${esc(n)}</div>`).join('');
 $('monitorState').textContent=data.background?.running?'Server checks are reporting. Last successful check: '+time(data.background.lastSuccessAt)+'.':'Not active / not verified. Phone alerts are not guaranteed while the app is closed.';
 renderIssues();renderDrivers();renderOrders();
}
function renderIssues(){if(!data)return;const all=data.issues||[];$('issueTotal').textContent=all.length;const issues=all.filter(i=>issueFilter==='ALL'||i.kind===issueFilter).sort((a,b)=>(a.severity==='URGENT'?0:1)-(b.severity==='URGENT'?0:1));
 $('attentionSubtitle').textContent=`${selected} / Toronto. ${data.complete?'Checked tasks only.':'Incomplete source data.'}`;
 $('issueList').innerHTML=issues.length?issues.map(i=>`<article class="card ${i.severity==='URGENT'?'urgent':'watch'}"><div class="card-top"><span class="card-name">${esc(i.driverName||'Unassigned')}</span>${badge(i.kind==='NOT_STARTED'?'NOT_STARTED':i.severity)}</div><p><b>${esc(label(i.kind))}</b><br>${esc(i.message)}</p>${i.dueAt?`<p><small>Action due ${time(i.dueAt)} / ${esc(i.date)}</small></p>`:''}</article>`).join(''):`<div class="empty">${!data.complete?'Some checks are unavailable. Do not assume all deliveries are healthy.':all.length?'No alerts match this filter.':'No alerts detected in the checked data. Missing ETA, GPS or Sheet data may still need verification.'}</div>`;
}
function renderDrivers(){if(!data)return;const q=$('driverSearch').value.trim().toLowerCase();const list=data.drivers.filter(d=>(!q||d.name.toLowerCase().includes(q))&&(driverFilter==='ALL'||driverFilter==='ONLINE'&&d.online||driverFilter==='ATTENTION'&&['LATE','NOT_STARTED','AT_RISK','UNKNOWN'].includes(d.status)||driverFilter===d.status));
 $('driverList').innerHTML=list.length?list.map(d=>`<article class="card driver-row"><div><span class="card-name">${esc(d.name)}</span><span class="presence ${d.online?'online':''}">${esc(label(d.presence))} &middot; ${esc(label(d.movement))}</span></div>${badge(d.status)}</article>`).join(''):'<div class="empty">No drivers match this filter.</div>';
}
function renderOrders(){if(!data)return;const sheet=data.sheet||{};$('sheetState').textContent=sheet.connected?`${sheet.rows.length} Sheet rows / ${selected}`:'Google Sheet not connected';$('sheetNotice').textContent=sheet.error||sheet.note||'This app cannot determine missing orders until the private Google Sheet is connected. This is not a zero-missing result.';
 $('sheetList').innerHTML=(sheet.rows||[]).filter(r=>r.status!=='MATCHED').map(r=>`<article class="card"><div class="card-top"><b>Sheet row ${r.row}</b>${badge(r.status)}</div><p>${esc(r.vendor)} &middot; Pickup ${time(r.pickupAt)}</p><small>${r.status==='NOT_FOUND'?'Missing candidate. Confirm before creating a task.':'Review the row mapping; no automatic duplicate removal.'}</small></article>`).join('');
 $('taskList').innerHTML=data.tasks.length?data.tasks.map(t=>`<article class="card"><div class="card-top"><b>${esc(t.shortId)}</b>${badge(t.status)}</div><p>${esc(t.type)} &middot; ${esc(t.date)}<br>Pickup ${time(t.pickupAt)} &middot; Deadline ${time(t.deadlineAt)}</p>${t.startDueAt?`<small>Start required by ${time(t.startDueAt)}</small>`:''}</article>`).join(''):'<div class="empty">No dated Onfleet tasks were returned for this day.</div>';
}
async function load({force=false}={}){
 const now=Date.now();
 // Never abort and replace an in-flight scan: the server may still be running it.
 if(loading){if(selected!==activeDate)queuedLoad=true;return;}
 const allowedAt=Math.max(retryNotBefore,lastLoadDate===selected?lastLoadStartedAt+15000:0);
 if(now<allowedAt){
  $('refreshBtn').disabled=true;$('refreshBtn').textContent=`Retry in ${Math.ceil((allowedAt-now)/1000)}s`;
  clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>{
   $('refreshBtn').disabled=false;$('refreshBtn').textContent='Refresh';
   if(!document.hidden&&!$('shell').classList.contains('hidden'))load();
  },allowedAt-now+50);return;
 }
 clearTimeout(refreshTimer);
 loading=true;queuedLoad=false;lastLoadStartedAt=now;lastLoadDate=selected;activeDate=selected;
 const mySeq=++seq,requestDate=selected;
 $('refreshBtn').disabled=true;$('refreshBtn').textContent='Checking...';$('connectionState').className='source pending';$('connectionState').textContent='Checking Onfleet';$('globalError').classList.add('hidden');
 try{
  const result=await request(`/api/onfleet?date=${encodeURIComponent(requestDate)}`);
  if(mySeq!==seq||requestDate!==selected)return;
  if(result.version!=='1.2.0')throw new Error('Backend is still the old version. Upload the new api/ and lib/ folders together.');
  data=result;render();$('connectionState').className='source '+(data.complete?'good':'pending');$('connectionState').textContent=data.complete?'Onfleet checked':'Onfleet partial';
  $('checkedAt').textContent=`Onfleet observed ${time(data.sources?.onfleet?.checkedAt||data.checkedAt)}`;
 }catch(e){
  // A quota cooldown applies to all dates, even if the user switched dates.
  if(e.retryAfterSeconds)retryNotBefore=Math.max(retryNotBefore,Date.now()+e.retryAfterSeconds*1000);
  if(mySeq!==seq||requestDate!==selected)return;
  $('connectionState').className='source error';$('connectionState').textContent=e.status===429?'Waiting for Onfleet':'Refresh failed';
  if(data){$('checkedAt').textContent=`OLD SNAPSHOT ${time(data.sources?.onfleet?.checkedAt||data.checkedAt)} - NOT LIVE`;
   $('globalError').textContent=e.message+' Showing the previous snapshot only; current on-time status is not verified.';
  }else{clearData();$('checkedAt').textContent='Status is unknown';$('globalError').textContent=e.message;
   for(const id of ['issueList','driverList','sheetList','taskList'])$(id).innerHTML='<div class="empty">Data unavailable. The app will wait before retrying; do not assume deliveries are on time.</div>';
  }
  $('globalError').classList.remove('hidden');
 }finally{
  loading=false;activeDate=null;$('refreshBtn').disabled=false;$('refreshBtn').textContent='Refresh';
  // Switching dates queues exactly the last selection. Same-date Refresh taps do not.
  if(queuedLoad&&requestDate!==selected){queuedLoad=false;load({force:true});}
  else if(retryNotBefore>Date.now())load();
 }
}
function showLogin(){$('shell').classList.add('hidden');$('login').classList.remove('hidden');}
async function initPush(){try{if('serviceWorker' in navigator){registration=await navigator.serviceWorker.register('/sw.js');}pushConfig=await request('/api/push');$('pushState').textContent=pushConfig.configured?'Server push is configured. Enable this phone and send a test.':'Phone push is not configured on the server yet.';$('enablePush').disabled=!pushConfig.configured;$('testPush').disabled=!pushConfig.configured;}catch(e){$('pushState').textContent=e.message;}}
function keyBytes(s){const raw=atob(s.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,c=>c.charCodeAt(0));}
async function deviceSubscription(){if(!registration)throw new Error('This browser does not support push here.');return (await navigator.serviceWorker.ready).pushManager.getSubscription();}
async function pushAction(action,subscription){return request('/api/push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,subscription:subscription.toJSON()})});}
$('enablePush').addEventListener('click',async()=>{try{
 if(!('Notification'in window)||!('PushManager'in window))throw new Error('Install the app to the Home Screen first, then reopen it.');
 if(!pushConfig.configured)throw new Error('Server push setup is required first.');
 const permission=await Notification.requestPermission();if(permission!=='granted')throw new Error('Notifications are not allowed. Enable them in phone settings.');
 const reg=await navigator.serviceWorker.ready;const sub=await reg.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(pushConfig.publicKey)});
 await pushAction('subscribe',sub);$('pushState').textContent='This phone is subscribed. Send a test; background checks must also be active.';
 }catch(e){$('pushState').textContent=e.message;}});
$('testPush').addEventListener('click',async()=>{try{const sub=await deviceSubscription();if(!sub)throw new Error('Enable phone alerts first.');await pushAction('test',sub);$('pushState').textContent='Test accepted by the push service. Confirm that it appears on your phone; delivery is not yet verified.';}catch(e){$('pushState').textContent=e.message;}});
$('disablePush').addEventListener('click',async()=>{try{const sub=await deviceSubscription();if(sub){await pushAction('unsubscribe',sub);await sub.unsubscribe();}$('pushState').textContent='Alerts are off on this phone.';}catch(e){$('pushState').textContent=e.message;}});
$('logoutBtn').addEventListener('click',async()=>{let note='';try{const sub=await deviceSubscription();if(sub){try{await pushAction('unsubscribe',sub);}finally{await sub.unsubscribe();}}}catch{note='Signed out. Verify notifications are disabled in your phone settings.';}try{await request('/api/session',{method:'DELETE'});data=null;showLogin();$('loginError').textContent=note;}catch(e){$('pushState').textContent=e.message;}});
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();try{await request('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('password').value})});$('password').value='';$('loginError').textContent='';$('login').classList.add('hidden');$('shell').classList.remove('hidden');await load({force:true});await initPush();}catch(err){$('loginError').textContent=err.message;}});
$('todayBtn').addEventListener('click',()=>setDate(today(),true));$('tomorrowBtn').addEventListener('click',()=>setDate(nextDay(today())));$('datePicker').addEventListener('change',e=>setDate(e.target.value));$('refreshBtn').addEventListener('click',()=>load({force:true}));$('driverSearch').addEventListener('input',renderDrivers);
for(const b of document.querySelectorAll('[data-view]'))b.addEventListener('click',()=>display(b.dataset.view));
for(const b of document.querySelectorAll('#issueFilters button'))b.addEventListener('click',()=>{issueFilter=b.dataset.kind;document.querySelectorAll('#issueFilters button').forEach(x=>x.classList.toggle('active',x===b));renderIssues();});
for(const b of document.querySelectorAll('[data-issue-filter]'))b.addEventListener('click',()=>{issueFilter=b.dataset.issueFilter;document.querySelectorAll('#issueFilters button').forEach(x=>x.classList.toggle('active',x.dataset.kind===issueFilter));renderIssues();});
for(const b of document.querySelectorAll('#driverFilters button'))b.addEventListener('click',()=>{driverFilter=b.dataset.status;document.querySelectorAll('#driverFilters button').forEach(x=>x.classList.toggle('active',x===b));renderDrivers();});
setInterval(()=>{if(document.hidden||$('shell').classList.contains('hidden'))return;if(followToday&&selected!==today())setDate(today(),true);else load();},60_000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!$('shell').classList.contains('hidden')){if(followToday&&selected!==today())setDate(today(),true);else load();}});
try{const session=await request('/api/session');if(!session.authenticated){showLogin();if(!session.configured)$('loginError').textContent='One-time setup: add APP_ACCESS_PASSWORD (16+ random characters) in Vercel and redeploy.';}else{$('shell').classList.remove('hidden');const requested=new URLSearchParams(location.search).get('view');if(['dashboard','drivers','orders','settings'].includes(requested))display(requested);await load({force:true});await initPush();}}catch(e){showLogin();$('loginError').textContent=e.message;}
