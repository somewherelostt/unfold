-- Waitlist emails are private and never exposed through the browser Data API.
create table unfold.waitlist_entries (
  email text primary key check (email = lower(btrim(email)) and length(email) between 3 and 254),
  consent_version text not null check (consent_version = 'launch-v1'),
  created_at timestamptz not null default now()
);
create table unfold.waitlist_limits (
  key text primary key check (key ~ '^[a-f0-9]{64}$'),
  attempts integer not null check (attempts > 0),
  reset_at timestamptz not null
);
create index waitlist_limits_expiry on unfold.waitlist_limits(reset_at);
alter table unfold.waitlist_entries enable row level security;
alter table unfold.waitlist_entries force row level security;
alter table unfold.waitlist_limits enable row level security;
alter table unfold.waitlist_limits force row level security;
revoke all on unfold.waitlist_entries, unfold.waitlist_limits from public, anon, authenticated, unfold_runtime;
grant insert on unfold.waitlist_entries to unfold_runtime;
grant select, insert, update, delete on unfold.waitlist_limits to unfold_runtime;
create policy waitlist_insert on unfold.waitlist_entries for insert to unfold_runtime with check (true);
create policy waitlist_rate_server on unfold.waitlist_limits for all to unfold_runtime using (true) with check (true);
