const orders = [
  { id:'FM-19281', vendor:'Food Mamba', pickup:'11:00', delivery:'11:30', driver:'Ahmed', stage:'DURING', sheet:true, onfleet:true, health:'ACTION', issue:'Predicted delivery delay +16 min', detail:'Onfleet ETA is 11:46 against an 11:30 delivery deadline. Setup is required.', setup:true, eta:'11:46' },
  { id:'PN-829', vendor:'Pantry', pickup:'11:30', delivery:'12:00', driver:'Unassigned', stage:'PRE', sheet:true, onfleet:true, health:'ACTION', issue:'Pickup < 30 min and no driver assigned', detail:'Order exists in both systems but no Onfleet worker is assigned.', setup:false },
  { id:'FFG-192', vendor:'FFG', pickup:'11:40', delivery:'12:15', driver:'—', stage:'PRE', sheet:true, onfleet:false, health:'ACTION', issue:'Missing from Onfleet', detail:'Order exists on the Delivery Sheet but no matching Onfleet task was found.', setup:true },
  { id:'CH-381', vendor:'Chop Hop', pickup:'11:15', delivery:'11:55', driver:'Jason', stage:'DURING', sheet:true, onfleet:true, health:'WATCH', issue:'Only 4 min delivery buffer', detail:'Current ETA is 11:51. The delivery deadline is 11:55.', setup:false, eta:'11:51' },
  { id:'TB-441', vendor:'Tabule', pickup:'12:00', delivery:'12:35', driver:'Mohammed', stage:'PRE', sheet:true, onfleet:true, health:'WATCH', issue:'Pickup time mismatch', detail:'Sheet pickup is 12:00 while Onfleet task is scheduled for 12:10.', setup:false },
  { id:'RS-120', vendor:'Rosies', pickup:'10:15', delivery:'10:55', driver:'Alex', stage:'POST', sheet:true, onfleet:true, health:'WATCH', issue:'Completed 9 min late', detail:'Scheduled delivery was 10:55. Onfleet completion was recorded at 11:04.', setup:true, actual:'11:04' },
  { id:'CL-220', vendor:'Cafe Landwer', pickup:'09:45', delivery:'10:20', driver:'Daniel', stage:'POST', sheet:true, onfleet:true, health:'OK', issue:null, detail:'Completed on time.', setup:false, actual:'10:17' },
  { id:'FM-19282', vendor:'Food Mamba', pickup:'11:45', delivery:'12:20', driver:'John', stage:'PRE', sheet:true, onfleet:true, health:'OK', issue:null, detail:'Ready.', setup:true },
  { id:'PN-830', vendor:'Pantry', pickup:'12:10', delivery:'12:45', driver:'Sam', stage:'PRE', sheet:true, onfleet:true, health:'OK', issue:null, detail:'Ready.', setup:false },
  { id:'KT-932', vendor:'KTC', pickup:'10:50', delivery:'11:35', driver:'Chris', stage:'DURING', sheet:true, onfleet:true, health:'OK', issue:null, detail:'On track.', setup:false, eta:'11:27' },
  { id:'OB-705', vendor:'O&B', pickup:'12:20', delivery:'13:05', driver:'Ali', stage:'PRE', sheet:true, onfleet:true, health:'OK', issue:null, detail:'Ready.', setup:false },
  { id:'FM-19279', vendor:'Food Mamba', pickup:'09:30', delivery:'10:00', driver:'Ahmed', stage:'POST', sheet:true, onfleet:true, health:'OK', issue:null, detail:'Completed on time.', setup:true, actual:'09:57' },
];

let orderFilter = 'ALL';
let issueFilter = 'ALL';
let severityFilter = 'ALL';

const $ = (id) => document.getElementById(id);
const issues = () => orders.filter(o => o.health !== 'OK');

function setClock(){
  const now = new Date();
  $('clock').textContent = now.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
}
setClock(); setInterval(setClock, 30000);

function renderStats(){
  const total = orders.length;
  const ok = orders.filter(o=>o.health==='OK').length;
  const watch = orders.filter(o=>o.health==='WATCH').length;
  const action = orders.filter(o=>o.health==='ACTION').length;
  const completed = orders.filter(o=>o.stage==='POST').length;
  $('totalOrders').textContent=total; $('okCount').textContent=ok; $('watchCount').textContent=watch; $('actionCount').textContent=action;
  $('completedLine').textContent=`${completed} completed`;
  $('navIssueCount').textContent=watch+action;
  $('preIssues').textContent=`${issues().filter(o=>o.stage==='PRE').length} issues`;
  $('duringIssues').textContent=`${issues().filter(o=>o.stage==='DURING').length} issues`;
  $('postIssues').textContent=`${issues().filter(o=>o.stage==='POST').length} issues`;
  $('contextOrders').textContent=total; $('contextAction').textContent=action; $('contextWatch').textContent=watch;
}

function renderPriority(){
  const priority = issues().sort((a,b)=> (a.health==='ACTION'?-1:1) - (b.health==='ACTION'?-1:1)).slice(0,5);
  $('priorityIssues').innerHTML = priority.map(o=>`<div class="issue-row">
    <div class="severity-bar ${o.health}"></div>
    <div class="issue-main"><strong>${o.id} · ${o.vendor}</strong><span>${o.issue}</span></div>
    <div class="issue-meta"><b>${o.stage}</b><span>${o.pickup} → ${o.delivery}</span></div>
  </div>`).join('');
}

function renderUpcoming(){
  const next = orders.filter(o=>o.stage!=='POST').sort((a,b)=>a.pickup.localeCompare(b.pickup)).slice(0,6);
  $('upcomingList').innerHTML = next.map(o=>`<div class="timeline-item ${o.health}">
    <div class="timeline-time">${o.pickup}</div><div class="timeline-dot"></div>
    <div class="timeline-info"><strong>${o.id} · ${o.vendor}</strong><span>${o.driver} · Delivery ${o.delivery}</span></div>
  </div>`).join('');
}

function badge(value){ return `<span class="badge ${value}">${value==='ACTION'?'● ACTION':value==='WATCH'?'● WATCH':value==='OK'?'● OK':value}</span>`; }

function renderOrders(){
  const query = $('orderSearch').value.toLowerCase().trim();
  const filtered = orders.filter(o => (orderFilter==='ALL'||o.stage===orderFilter) && (!query || `${o.id} ${o.vendor} ${o.driver}`.toLowerCase().includes(query)));
  $('ordersBody').innerHTML = filtered.map(o=>`<tr>
    <td><strong>${o.id}</strong><small>${o.setup?'Setup required':'Standard delivery'}</small></td>
    <td>${o.vendor}</td><td><strong>${o.pickup}</strong><small>Deliver ${o.delivery}</small></td>
    <td>${o.driver}</td><td>${badge(o.stage)}</td>
    <td><span class="check ${o.sheet?'yes':'no'}">${o.sheet?'✓ MATCHED':'✕ MISSING'}</span></td>
    <td><span class="check ${o.onfleet?'yes':'no'}">${o.onfleet?'✓ MATCHED':'✕ MISSING'}</span></td>
    <td>${badge(o.health)}</td>
  </tr>`).join('') || `<tr><td colspan="8" class="empty">No orders match this filter.</td></tr>`;
}

function renderIssues(){
  const filtered = issues().filter(o => (issueFilter==='ALL'||o.stage===issueFilter) && (severityFilter==='ALL'||o.health===severityFilter));
  $('issuesGrid').innerHTML = filtered.map(o=>`<article class="issue-card ${o.health}">
    <div class="issue-card-top"><div><h3>${o.id}</h3><div class="vendor">${o.vendor} · ${o.pickup} → ${o.delivery}</div></div>${badge(o.health)}</div>
    <div class="description"><strong>${o.issue}</strong><br>${o.detail}</div>
    <div class="issue-card-footer"><span>${o.stage} · Driver: ${o.driver}</span><button data-order="${o.id}">Ask AI</button></div>
  </article>`).join('') || `<div class="empty">No issues match this filter.</div>`;

  document.querySelectorAll('[data-order]').forEach(btn=>btn.addEventListener('click',()=>{
    showView('ai');
    submitChat(`Check order ${btn.dataset.order}`);
  }));
}

function showView(view){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active-view'));
  $(view).classList.add('active-view');
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active', n.dataset.view===view));
  const titles={control:['Control Tower','Monitor every order before, during and after delivery.'],orders:['Orders','One combined view of the Delivery Sheet and Onfleet.'],issues:['Issues','Exceptions that may require dispatcher attention.'],ai:['Ask AI','Ask questions across the Delivery Sheet and Onfleet.']};
  $('pageTitle').textContent=titles[view][0]; $('pageSubtitle').textContent=titles[view][1];
}

document.querySelectorAll('.nav-item').forEach(btn=>btn.addEventListener('click',()=>showView(btn.dataset.view)));
document.querySelectorAll('[data-view-target]').forEach(btn=>btn.addEventListener('click',()=>showView(btn.dataset.viewTarget)));
document.querySelectorAll('.stage-card').forEach(btn=>btn.addEventListener('click',()=>{
  issueFilter=btn.dataset.stage; document.querySelectorAll('#issueStageFilter button').forEach(b=>b.classList.toggle('active', b.dataset.filter===issueFilter)); renderIssues(); showView('issues');
}));

document.querySelectorAll('#orderStageFilter button').forEach(btn=>btn.addEventListener('click',()=>{
  orderFilter=btn.dataset.filter; document.querySelectorAll('#orderStageFilter button').forEach(b=>b.classList.toggle('active',b===btn)); renderOrders();
}));
$('orderSearch').addEventListener('input',renderOrders);
document.querySelectorAll('#issueStageFilter button').forEach(btn=>btn.addEventListener('click',()=>{
  issueFilter=btn.dataset.filter; document.querySelectorAll('#issueStageFilter button').forEach(b=>b.classList.toggle('active',b===btn)); renderIssues();
}));
$('severityFilter').addEventListener('change',e=>{severityFilter=e.target.value;renderIssues();});

function addMessage(role,text){
  const wrap=document.createElement('div'); wrap.className=`message ${role}`;
  wrap.innerHTML=`<div class="message-label">${role==='user'?'You':'AI Dispatcher'}</div><div class="bubble"></div>`;
  wrap.querySelector('.bubble').textContent=text;
  $('chatMessages').appendChild(wrap); $('chatMessages').scrollTop=$('chatMessages').scrollHeight;
}

function aiAnswer(input){
  const q=input.toLowerCase();
  const action=orders.filter(o=>o.health==='ACTION'); const watch=orders.filter(o=>o.health==='WATCH');
  if(q.includes('lunch')){
    const lunch=orders.filter(o=>o.pickup>='11:00' && o.pickup<='12:30'); const bad=lunch.filter(o=>o.health!=='OK');
    return `Lunch window 11:00–12:30: ${lunch.length} orders.\n\n${bad.length} need attention (${bad.filter(o=>o.health==='ACTION').length} action required, ${bad.filter(o=>o.health==='WATCH').length} watch).\n\nMost urgent: ${bad.filter(o=>o.health==='ACTION').map(o=>`${o.id} — ${o.issue}`).join('\n') || 'None.'}`;
  }
  if(q.includes('missing') || q.includes('onfleet')){
    const missing=orders.filter(o=>o.sheet && !o.onfleet);
    if(q.includes('missing')) return missing.length ? `${missing.length} Sheet order is missing from Onfleet:\n\n${missing.map(o=>`${o.id} — ${o.vendor}, pickup ${o.pickup}`).join('\n')}\n\nRecommended action: create the missing Onfleet task before dispatch.` : 'No Sheet orders are missing from Onfleet.';
  }
  if(q.includes('late') && (q.includes('complete')||q.includes('post'))){
    const late=orders.filter(o=>o.stage==='POST' && o.health!=='OK');
    return late.length ? `Post-delivery exceptions:\n\n${late.map(o=>`${o.id} — ${o.issue}. ${o.detail}`).join('\n')}` : 'No late completed orders.';
  }
  const match=orders.find(o=>q.includes(o.id.toLowerCase()));
  if(match) return `${match.id} · ${match.vendor}\nStage: ${match.stage}\nDriver: ${match.driver}\nPickup: ${match.pickup}\nDelivery: ${match.delivery}\nHealth: ${match.health}\n\n${match.issue ? `${match.issue}. ${match.detail}` : 'No issue detected. This order is currently on track.'}`;
  if(q.includes('food mamba')){
    const fm=orders.filter(o=>o.vendor==='Food Mamba');
    return `Food Mamba: ${fm.length} orders today.\n\n${fm.map(o=>`${o.id} — ${o.stage} — ${o.health}${o.issue?` — ${o.issue}`:''}`).join('\n')}`;
  }
  if(q.includes('attention')||q.includes('problem')||q.includes('issue')||q.includes('tình hình')||q.includes('sao')){
    return `Today: ${orders.length} orders. ${action.length} require action and ${watch.length} are on watch.\n\nAction required:\n${action.map(o=>`${o.id} — ${o.issue}`).join('\n')}\n\nHighest priority is ${action[0].id}: ${action[0].detail}`;
  }
  return `I can currently check: today's situation, lunch deliveries, missing Onfleet tasks, specific Order IDs, Food Mamba orders, and post-delivery exceptions.\n\nTry “What needs attention?” or “Check order FM-19281”.`;
}

function submitChat(text){
  if(!text.trim()) return;
  addMessage('user',text.trim());
  setTimeout(()=>addMessage('assistant',aiAnswer(text.trim())),220);
}
$('chatForm').addEventListener('submit',e=>{e.preventDefault(); const text=$('chatInput').value; $('chatInput').value=''; submitChat(text);});
document.querySelectorAll('#quickPrompts button').forEach(btn=>btn.addEventListener('click',()=>submitChat(btn.textContent)));

$('integrationBtn').addEventListener('click',()=> $('integration').classList.remove('hidden'));
$('modalClose').addEventListener('click',()=> $('integration').classList.add('hidden'));
$('modalDone').addEventListener('click',()=> $('integration').classList.add('hidden'));
$('integration').addEventListener('click',e=>{ if(e.target===$('integration')) $('integration').classList.add('hidden'); });

renderStats(); renderPriority(); renderUpcoming(); renderOrders(); renderIssues();
