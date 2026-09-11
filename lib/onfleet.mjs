// Read-only Onfleet adapter optimized for fast mobile dashboard refreshes.
// A partial API read is never treated as a healthy all-clear.
import {localTime,shiftDay} from './rules.mjs';

const MIN_REQUEST_SPACING_MS = 350;
const MAX_429_RETRIES = 1;
const MAX_RUNTIME_MS = 7000;
const RECENT_ACTIVE_DAYS = 7;
const MAX_FALLBACK_TASKS = 8;
let paceTail = Promise.resolve();
let nextAllowedAt = 0;
let cached = null;
let pending = null;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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

async function waitForRateSlot() {
  let release;
  const previous = paceTail;
  paceTail = new Promise(resolve => { release = resolve; });
  await previous;
  const wait = Math.max(0, nextAllowedAt - Date.now());
  if (wait) await sleep(wait);
  nextAllowedAt = Date.now() + MIN_REQUEST_SPACING_MS;
  release();
}

function retryAfterMs(response) {
  const raw = response.headers.get('retry-after');
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(1000, seconds * 1000);
    const when = Date.parse(raw);
    if (Number.isFinite(when)) return Math.max(1000, when - Date.now());
  }
  return 1200;
}

export async function requestOnfleet(path,{fetcher=fetch,key=process.env.ONFLEET_API_KEY}={}) {
  if (!key) throw new Error('ONFLEET_API_KEY is not configured.');

  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt += 1) {
    await waitForRateSlot();
    const response = await fetcher(`https://onfleet.com/api/v2${path}`, {
      method:'GET',
      headers:{Authorization:`Basic ${Buffer.from(`${key}:`).toString('base64')}`,Accept:'application/json'},
      signal:AbortSignal.timeout(8000)
    });
    const text = await response.text();

    if (response.status === 429 && attempt < MAX_429_RETRIES) {
      const wait = retryAfterMs(response);
      nextAllowedAt = Math.max(nextAllowedAt, Date.now() + wait);
      await sleep(wait);
      continue;
    }

    if (!response.ok) {
      const details = errorDetails(text);
      const extra = details.cause ? ` ${details.cause}` : '';
      const requestId = details.requestId ? ` Request ID: ${details.requestId}.` : '';
      const hint = response.status === 429 ? ' Onfleet is busy. Wait a few seconds; the app will keep the last good snapshot instead of clearing the screen.' : '';
      throw new Error(`Onfleet HTTP ${response.status}.${extra}${requestId}${hint}`.trim());
    }

    if (!text) return null;
    try { return JSON.parse(text); }
    catch { throw new Error('Onfleet returned invalid JSON.'); }
  }

  throw new Error('Onfleet request could not be completed.');
}

export async function readPages(params,request=requestOnfleet,{maxPages=12,stopAt=Date.now()+MAX_RUNTIME_MS}={}) {
  const tasks = [];
  const seen = new Set();
  let cursor = null;

  for (let page = 0; page < maxPages; page += 1) {
    if (Date.now() >= stopAt) return {tasks,complete:false};
    const q = new URLSearchParams(params);
    if (cursor) q.set('lastId', cursor);
    const data = await request(`/tasks/all?${q}`);
    if (!Array.isArray(data?.tasks)) throw new Error('Invalid Onfleet tasks response.');
    tasks.push(...data.tasks);
    if (!data.lastId) return {tasks,complete:true};
    if (seen.has(data.lastId)) throw new Error('Onfleet pagination repeated a cursor.');
    seen.add(data.lastId);
    cursor = data.lastId;
  }

  return {tasks,complete:false};
}

function idOf(value) {
  if (typeof value === 'string' && value) return value;
  if (value && typeof value.id === 'string') return value.id;
  return null;
}

async function fetchFallbackTasks(ids,request,stopAt) {
  const tasks = [];
  const warnings = [];
  let complete = true;

  for (const id of ids.slice(0, MAX_FALLBACK_TASKS)) {
    if (Date.now() >= stopAt) { complete = false; break; }
    try {
      const task = await request(`/tasks/${encodeURIComponent(id)}`);
      if (task) tasks.push(task);
    } catch (error) {
      complete = false;
      warnings.push(`Task ${id} could not be refreshed: ${error.message}`);
    }
  }

  if (ids.length > MAX_FALLBACK_TASKS) {
    complete = false;
    warnings.push(`${ids.length-MAX_FALLBACK_TASKS} older assigned task(s) were skipped to keep the dashboard responsive.`);
  }

  return {tasks,complete,warnings};
}

export async function getOnfleet(date,{now=Date.now(),request=requestOnfleet,useCache=true}={}) {
  if (useCache && cached?.date === date && now - cached.at < 90_000) return cached.value;
  if (useCache && pending?.date === date) return pending.promise;

  async function load() {
    const stopAt = Date.now() + MAX_RUNTIME_MS;
    const workers = await request('/workers');
    if (!Array.isArray(workers)) throw new Error('Invalid Onfleet workers response.');

    // One paginated organization query returns all recently-created active tasks,
    // including unassigned tasks, without one request per driver/task.
    const recentFrom = now - RECENT_ACTIVE_DAYS * 24 * 60 * 60 * 1000;
    const active = await readPages({from:String(recentFrom),to:String(now+1),state:'0,1,2'},request,{maxPages:12,stopAt});
    const activeMap = new Map(active.tasks.map(task => [task.id, task]));

    // If a driver is currently working a task created before the recent window,
    // fetch only that active task. Do not expand every queued task individually.
    const missingActiveIds = [...new Set(workers.map(w=>idOf(w.activeTask)).filter(Boolean).filter(id=>!activeMap.has(id)))];
    const fallback = await fetchFallbackTasks(missingActiveIds,request,stopAt);

    // For completed tasks, Onfleet applies from/to to completion time, so this
    // selected-day query is exact and usually only one or two pages.
    const start = localTime(date);
    const end = localTime(shiftDay(date,1));
    let done = {tasks:[],complete:true};
    if (start !== null && end !== null && start < Math.min(end, now+1)) {
      done = await readPages({from:String(start),to:String(Math.min(end,now+1)),state:'3'},request,{maxPages:8,stopAt});
    }

    const unique = new Map([...active.tasks,...fallback.tasks,...done.tasks].filter(Boolean).map(task=>[task.id,task]));

    // Workers expose their queued task IDs. If one is absent from our active scan,
    // mark the snapshot partial rather than making an unsafe all-clear claim.
    const fetchedIds = new Set(unique.keys());
    const queuedIds = workers.flatMap(w => Array.isArray(w.tasks) ? w.tasks.map(idOf).filter(Boolean) : []);
    const unseenQueued = queuedIds.filter(id => !fetchedIds.has(id));

    const complete = active.complete && fallback.complete && done.complete && unseenQueued.length === 0;
    const warnings = [...fallback.warnings];
    if (!active.complete) warnings.push('Active-task scan hit its safety limit. The visible results are partial.');
    if (!done.complete) warnings.push('Completed-task scan hit its safety limit. Historical totals are partial.');
    if (unseenQueued.length) warnings.push(`${unseenQueued.length} queued task(s) fall outside the fast scan window; all-clear and missing-order conclusions are disabled.`);
    if (!complete) warnings.push('Onfleet data is partial. The app will show known problems but will not claim that everything is healthy.');

    const value = {
      workers,
      tasks:[...unique.values()],
      complete,
      observedAt:now,
      completionCoverage:{from:start,to:end},
      warnings
    };

    if (useCache) cached = {date,at:now,value};
    return value;
  }

  const promise = load();
  if (useCache) pending = {date,promise};
  try { return await promise; }
  finally { if (pending?.promise === promise) pending = null; }
}
