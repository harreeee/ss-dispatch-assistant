const BASE_URL = 'https://onfleet.com/api/v2';

function authHeader(){
  const key = process.env.ONFLEET_API_KEY;
  if(!key) throw new Error('ONFLEET_API_KEY is not configured in Vercel');
  return `Basic ${Buffer.from(`${key}:`).toString('base64')}`;
}

async function onfleet(path){
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: authHeader(), Accept: 'application/json' }
  });
  if(!response.ok){
    const text = await response.text();
    throw new Error(`Onfleet API ${response.status}: ${text.slice(0,180)}`);
  }
  return response.json();
}

function classifyTask(task, now){
  if(!task || task.state === 3) return 'ON_TIME';
  const delaySeconds = Number(task.delayTime || 0);
  const deadline = Number(task.completeBefore || 0);
  const predictedCompletion = Number(task.estimatedCompletionTime || 0);
  const etaSeconds = Number(task.eta || 0);

  if(delaySeconds > 0) return 'LATE';
  if(deadline && now > deadline) return 'LATE';

  if(deadline && predictedCompletion){
    if(predictedCompletion > deadline) return 'AT_RISK';
    if(deadline - predictedCompletion <= 10 * 60 * 1000) return 'AT_RISK';
  }

  if(deadline && etaSeconds > 0){
    const predictedArrival = now + etaSeconds * 1000;
    if(predictedArrival > deadline) return 'AT_RISK';
    if(deadline - predictedArrival <= 10 * 60 * 1000) return 'AT_RISK';
  }

  return 'ON_TIME';
}

function worstStatus(statuses){
  if(statuses.includes('LATE')) return 'LATE';
  if(statuses.includes('AT_RISK')) return 'AT_RISK';
  return 'ON_TIME';
}

async function workerAssignedTasks(workerId){
  const from = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let lastId = null;
  const tasks = [];

  for(let page = 0; page < 5; page += 1){
    const params = new URLSearchParams({ from: String(from) });
    if(lastId) params.set('lastId', lastId);
    const result = await onfleet(`/workers/${encodeURIComponent(workerId)}/tasks?${params.toString()}`);
    tasks.push(...(result.tasks || []));
    if(!result.lastId) break;
    lastId = result.lastId;
  }
  return tasks;
}

export default async function handler(req, res){
  if(req.method !== 'GET'){
    res.setHeader('Allow','GET');
    return res.status(405).json({ connected:false, error:'Method not allowed' });
  }

  try{
    const workers = await onfleet('/workers?filter=id,name,displayName,onDuty,activeTask,tasks,timeLastSeen,delayTime');
    const now = Date.now();

    const drivers = await Promise.all((workers || []).map(async worker => {
      let tasks = [];
      if(worker.onDuty){
        try{ tasks = await workerAssignedTasks(worker.id); }
        catch(err){ console.error(`Tasks unavailable for ${worker.id}:`, err.message); }
      }

      const activeTasks = tasks.filter(t => t.state === 1 || t.state === 2);
      let deliveryStatus = worstStatus(activeTasks.map(t => classifyTask(t, now)));
      if(Number(worker.delayTime || 0) > 0) deliveryStatus = 'LATE';
      if(!worker.onDuty) deliveryStatus = 'OFFLINE';

      return {
        id: worker.id,
        name: worker.displayName || worker.name || 'Unnamed driver',
        online: Boolean(worker.onDuty),
        deliveryStatus,
        hasActiveTask: Boolean(worker.activeTask) || activeTasks.some(t => t.state === 2),
        activeTaskCount: activeTasks.length,
        timeLastSeen: worker.timeLastSeen || null
      };
    }));

    const rank = { LATE:0, AT_RISK:1, ON_TIME:2, OFFLINE:3 };
    drivers.sort((a,b) => (rank[a.deliveryStatus] - rank[b.deliveryStatus]) || a.name.localeCompare(b.name));

    return res.status(200).json({
      connected:true,
      checkedAt:now,
      drivers,
      summary:{
        total:drivers.length,
        online:drivers.filter(d => d.online).length,
        offline:drivers.filter(d => !d.online).length,
        onTime:drivers.filter(d => d.deliveryStatus === 'ON_TIME').length,
        atRisk:drivers.filter(d => d.deliveryStatus === 'AT_RISK').length,
        late:drivers.filter(d => d.deliveryStatus === 'LATE').length
      }
    });
  }catch(error){
    console.error(error);
    return res.status(500).json({ connected:false, error:error.message || 'Failed to load Onfleet' });
  }
}
