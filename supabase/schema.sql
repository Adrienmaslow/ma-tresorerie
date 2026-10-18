-- =============================================================
-- Ma Trésorerie — schéma Supabase pour la synchronisation
-- À exécuter dans Supabase > SQL Editor.
-- Chaque enregistrement appartient à un utilisateur ; la sécurité
-- au niveau des lignes (RLS) empêche tout accès croisé.
-- =============================================================

create table if not exists public.records (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  store text not null check (store in ('accounts','transactions','pending','products','obligations','categories')),
  id text not null,
  data jsonb not null,
  updated_at bigint not null,          -- horodatage client (ms) : « dernier écrit gagne »
  deleted boolean not null default false,
  server_updated_at timestamptz not null default clock_timestamp(), -- curseur de pull
  primary key (user_id, store, id)
);

create index if not exists records_user_cursor on public.records (user_id, server_updated_at);

alter table public.records enable row level security;

drop policy if exists "records_select_own" on public.records;
create policy "records_select_own" on public.records
  for select using (auth.uid() = user_id);

drop policy if exists "records_insert_own" on public.records;
create policy "records_insert_own" on public.records
  for insert with check (auth.uid() = user_id);

drop policy if exists "records_update_own" on public.records;
create policy "records_update_own" on public.records
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Pas de policy DELETE : les suppressions passent par des tombstones (deleted = true).

-- Upsert conditionnel : n'écrase que si la version reçue est plus récente.
create or replace function public.push_records(payload jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  r jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  for r in select * from jsonb_array_elements(payload) loop
    insert into public.records as t (user_id, store, id, data, updated_at, deleted, server_updated_at)
    values (auth.uid(), r->>'store', r->>'id', r->'data', (r->>'updated_at')::bigint, coalesce((r->>'deleted')::boolean, false), clock_timestamp())
    on conflict (user_id, store, id) do update
      set data = excluded.data,
          updated_at = excluded.updated_at,
          deleted = excluded.deleted,
          server_updated_at = clock_timestamp()
      where t.updated_at < excluded.updated_at;
  end loop;
end;
$$;

grant execute on function public.push_records(jsonb) to authenticated;
