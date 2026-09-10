export function storageConfigured(){return Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY));}
export async function db(path,{method='GET',body,prefer='return=representation'}={}) {
 if(!storageConfigured())throw new Error('Persistent storage is not configured.');
 const base=new URL(process.env.SUPABASE_URL);
 if(base.protocol!=='https:')throw new Error('Supabase must use HTTPS.');
 const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
 const headers={apikey:key,Accept:'application/json','Content-Type':'application/json',Prefer:prefer};
 if(!key.startsWith('sb_secret_'))headers.Authorization=`Bearer ${key}`;
 const r=await fetch(`${base.origin}/rest/v1/${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw new Error(`Storage returned HTTP ${r.status}. Check the private setup SQL and server key.`);
 const text=await r.text();return text?JSON.parse(text):null;
}
export async function getState(key){const r=await db(`dispatch_state?key=eq.${encodeURIComponent(key)}&select=payload&limit=1`);return r?.[0]?.payload||null;}
export async function setState(key,payload){await db('dispatch_state?on_conflict=key',{method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:{key,payload,updated_at:new Date().toISOString()}});}
export async function lock(token){return await db('rpc/dispatch_monitor_lock',{method:'POST',body:{p_token:token}})===true;}
export async function unlock(token){await db('dispatch_lease?key=eq.monitor&token=eq.'+encodeURIComponent(token),{method:'DELETE',prefer:'return=minimal'});}
