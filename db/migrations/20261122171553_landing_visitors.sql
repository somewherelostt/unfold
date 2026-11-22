-- Only keyed hashes are retained. The aggregate starts at zero: no fixture/social-proof data.
create table unfold.landing_visitors (
  visitor_hash text primary key check (visitor_hash ~ '^[0-9a-f]{64}$')
);

alter table unfold.landing_visitors enable row level security;
alter table unfold.landing_visitors force row level security;
revoke all on unfold.landing_visitors from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on unfold.landing_visitors from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on unfold.landing_visitors from authenticated';
  end if;
end $$;

-- The existing server role can read and deduplicate inserts, but cannot update/delete identities.
revoke all on unfold.landing_visitors from unfold_runtime;
grant select, insert on unfold.landing_visitors to unfold_runtime;
create policy landing_visitors_server_read on unfold.landing_visitors
  for select to unfold_runtime using (true);
create policy landing_visitors_server_insert on unfold.landing_visitors
  for insert to unfold_runtime with check (true);
