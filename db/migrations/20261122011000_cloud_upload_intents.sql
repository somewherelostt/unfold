create table if not exists unfold.upload_intents (
 asset_id text primary key, project_id text not null references unfold.projects(id) on delete cascade,
 owner_id text not null, object_key text not null unique, expected_bytes bigint not null,
 mime text not null, expires_at bigint not null, completed_at bigint
);
create table if not exists unfold.storage_deletions (
 prefix text primary key, owner_id text not null, created_at bigint not null,
 retain_until bigint not null, checked_at bigint
);
alter table unfold.upload_intents enable row level security;
alter table unfold.storage_deletions enable row level security;
revoke all on unfold.upload_intents,unfold.storage_deletions from public;
do $$ begin
 if exists(select 1 from pg_roles where rolname='anon') then
  execute 'revoke all on unfold.upload_intents,unfold.storage_deletions from anon';
 end if;
 if exists(select 1 from pg_roles where rolname='authenticated') then
  execute 'revoke all on unfold.upload_intents,unfold.storage_deletions from authenticated';
 end if;
end $$;
