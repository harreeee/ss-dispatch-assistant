-- Run once in a SEPARATE Supabase project for this app. No existing business tables touched.
-- Server-only tables: no browser/anonymous grants and no permissive RLS policies.
begin;
create table if not exists public.dispatch_state (
 key text primary key, payload jsonb not null, updated_at timestamptz not null default now()
);
create table if not exists public.dispatch_devices (
 id text primary key, subscription jsonb not null,
 expires_at timestamptz not null, updated_at timestamptz not null default now()
);
create table if not exists public.dispatch_lease (
 key text primary key, token text not null, expires_at timestamptz not null
);
alter table public.dispatch_state enable row level security;
alter table public.dispatch_devices enable row level security;
alter table public.dispatch_lease enable row level security;
revoke all on public.dispatch_state,public.dispatch_devices,public.dispatch_lease from public,anon,authenticated;
grant select,insert,update,delete on public.dispatch_state,public.dispatch_devices,public.dispatch_lease to service_role;
create or replace function public.dispatch_monitor_lock(p_token text) returns boolean
 language plpgsql security invoker set search_path='' as $$
 declare n integer;
 begin
  insert into public.dispatch_lease(key,token,expires_at) values ('monitor',p_token,now()+interval '120 seconds')
  on conflict(key) do update set token=excluded.token,expires_at=excluded.expires_at
  where public.dispatch_lease.expires_at<now();
  get diagnostics n=row_count;
  return n=1;
 end;
 $$;
revoke all on function public.dispatch_monitor_lock(text) from public,anon,authenticated;
grant execute on function public.dispatch_monitor_lock(text) to service_role;
commit;
