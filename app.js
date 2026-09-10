let drivers = [];
let currentFilter = 'ALL';

const $ = (id) => document.getElementById(id);

function statusLabel(status){
  return status === 'AT_RISK' ? 'AT RISK' : status === 'ON_TIME' ? 'ON TIME' : status;
}

function renderSummary(summary = {}){
  $('statTotal').textContent = summary.total ?? '—';
  $('statOnline').textContent = summary.online ?? '—';
  $('statRisk').textContent = summary.atRisk ?? '—';
  $('statLate').textContent = summary.late ?? '—';
  $('driverOnline').textContent = summary.online ?? 0;
  $('driverOffline').textContent = summary.offline ?? 0;
  $('driverOnTime').textContent = summary.onTime ?? 0;
  $('driverAtRisk').textContent = summary.atRisk ?? 0;
  $('driverLate').textContent = summary.late ?? 0;
}

function renderAttention(){
  const urgent = drivers.filter(d => d.deliveryStatus === 'LATE' || d.deliveryStatus === 'AT_RISK');
  $('attentionList').innerHTML = urgent.length ? urgent.map(d => `
    <div class="attention-row">
      <div>
        <div class="driver-name">${escapeHtml(d.name)}</div>
        <small>${d.online ? 'Online' : 'Offline'}${d.hasActiveTask ? ' · Active delivery' : ''}</small>
      </div>
      <span class="status ${d.deliveryStatus}">${statusLabel(d.deliveryStatus)}</span>
    </div>`).join('') : '<div class="empty">No drivers currently need attention.</div>';
}

function renderDrivers(){
  const query = $('driverSearch').value.trim().toLowerCase();
  const filtered = drivers.filter(d => {
    const statusOK = currentFilter === 'ALL' || d.deliveryStatus === currentFilter;
    const searchOK = !query || d.name.toLowerCase().includes(query);
    return statusOK && searchOK;
  });

  $('driverList').innerHTML = filtered.length ? filtered.map(d => `
    <div class="driver-row">
      <div class="driver-name">${escapeHtml(d.name)}</div>
      <span class="presence ${d.online ? 'online' : 'offline'}">${d.online ? 'ONLINE' : 'OFFLINE'}</span>
      <span class="status ${d.deliveryStatus}">${statusLabel(d.deliveryStatus)}</span>
    </div>`).join('') : '<div class="empty">No drivers match this filter.</div>';
}

function escapeHtml(value){
  return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
}

async function loadOnfleet(){
  $('refreshBtn').disabled = true;
  $('refreshBtn').textContent = 'Loading…';
  $('onfleetState').textContent = 'CHECKING';
  $('onfleetDot').className = 'dot pending';

  try{
    const response = await fetch('/api/onfleet', { cache: 'no-store' });
    const data = await response.json();
    if(!response.ok || !data.connected) throw new Error(data.error || 'Could not connect to Onfleet');

    drivers = data.drivers || [];
    renderSummary(data.summary || {});
    renderAttention();
    renderDrivers();
    $('onfleetState').textContent = 'CONNECTED';
    $('onfleetDot').className = 'dot good';
  }catch(error){
    drivers = [];
    renderSummary({total:0,online:0,offline:0,onTime:0,atRisk:0,late:0});
    $('attentionList').innerHTML = `<div class="error-box">Onfleet connection failed: ${escapeHtml(error.message)}</div>`;
    $('driverList').innerHTML = `<div class="error-box">${escapeHtml(error.message)}</div>`;
    $('onfleetState').textContent = 'ERROR';
    $('onfleetDot').className = 'dot bad';
  }finally{
    $('refreshBtn').disabled = false;
    $('refreshBtn').textContent = 'Refresh';
  }
}

function showView(view){
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active-view'));
  $(view).classList.add('active-view');
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  const titles = {
    dashboard:['Control Tower','Monitor delivery execution and driver risk.'],
    drivers:['Driver Status','See who is online, on time, at risk or late.'],
    orders:['Orders','Google Sheet + Onfleet order monitoring.'],
    issues:['Issues','Missing, late and at-risk deliveries.'],
    ai:['Ask AI','Dispatch assistant powered by live operational data.']
  };
  $('pageTitle').textContent = titles[view][0];
  $('pageSubtitle').textContent = titles[view][1];
}

document.querySelectorAll('.nav-item').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
document.querySelectorAll('[data-view-target]').forEach(b => b.addEventListener('click', () => showView(b.dataset.viewTarget)));
document.querySelectorAll('#driverFilter button').forEach(b => b.addEventListener('click', () => {
  currentFilter = b.dataset.status;
  document.querySelectorAll('#driverFilter button').forEach(x => x.classList.toggle('active', x === b));
  renderDrivers();
}));
$('driverSearch').addEventListener('input', renderDrivers);
$('refreshBtn').addEventListener('click', loadOnfleet);

loadOnfleet();
setInterval(loadOnfleet, 60_000);
