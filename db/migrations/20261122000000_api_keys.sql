-- Unfold: per-user API keys, encrypted at rest with AES-256-GCM by the app (UNFOLD_ENCRYPTION_KEY).
-- The database only ever sees ciphertext + iv + auth tag + the last 4 characters.

create table if not exists public.api_keys (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  provider    text not null check (provider in ('cerebras', 'gpu')),
  ciphertext  text not null,
  iv          text not null,
  tag         text not null,
  last4       text not null check (char_length(last4) <= 4),
  created_at  timestamptz not null default now(),
  unique (user_id, provider)
);

alter table public.api_keys enable row level security;

-- Users can only see and change their own rows. The service role (agent server) bypasses RLS.
drop policy if exists "api_keys_select_own" on public.api_keys;
create policy "api_keys_select_own" on public.api_keys
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "api_keys_insert_own" on public.api_keys;
create policy "api_keys_insert_own" on public.api_keys
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "api_keys_update_own" on public.api_keys;
create policy "api_keys_update_own" on public.api_keys
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "api_keys_delete_own" on public.api_keys;
create policy "api_keys_delete_own" on public.api_keys
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.api_keys from anon;
grant select, insert, update, delete on public.api_keys to authenticated;
