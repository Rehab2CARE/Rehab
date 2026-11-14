-- Praktijkfiches, fase 3: patiëntaccounts en oefenprogramma's.
-- Plak dit in Supabase → SQL Editor → New query → Run. Je mag het meermaals uitvoeren.
--
-- Minimale gegevens: een patiëntcode (bv. PT-7K3M9Q) en eventueel een voornaam of initialen.
-- Geen achternaam, geboortedatum, diagnose of medische notities.
-- Een patiëntaccount wordt aangemaakt door de Edge Function "patient-account" (met de service-role-sleutel).
-- Een patiënt ziet ENKEL zijn eigen actieve programma's en de fiches daarin. Alle andere tabellen blijven dicht.

-- ---------- Tabellen ----------

create table if not exists public.patienten (
  id uuid primary key references auth.users (id) on delete cascade,
  code text not null unique,
  naam text not null default '',
  aangemaakt_door uuid references public.profielen (id) on delete set null,
  aangemaakt timestamptz not null default now()
);

create table if not exists public.programmas (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patienten (id) on delete cascade,
  titel text not null check (length(trim(titel)) > 0),
  opmerking text not null default '',
  actief boolean not null default true,
  aangemaakt_door uuid references public.profielen (id) on delete set null,
  aangemaakt timestamptz not null default now(),
  bijgewerkt timestamptz not null default now()
);
create index if not exists programmas_patient on public.programmas (patient_id);

create table if not exists public.programma_items (
  id uuid primary key default gen_random_uuid(),
  programma_id uuid not null references public.programmas (id) on delete cascade,
  fiche_id uuid not null references public.fiches (id) on delete cascade,
  sets text not null default '',
  herhalingen text not null default '',
  frequentie text not null default '',
  notitie text not null default '',
  volgorde integer not null default 0
);
create index if not exists items_programma on public.programma_items (programma_id);
create index if not exists items_fiche on public.programma_items (fiche_id);

drop trigger if exists zet_bijgewerkt on public.programmas;
create trigger zet_bijgewerkt before insert or update on public.programmas
  for each row execute function public.zet_bijgewerkt();

-- ---------- Hulpfunctie: welke fiches mag de aangemelde patiënt zien? ----------
-- "security definer" zodat de RLS op fiches niet in een kringloop raakt.

create or replace function public.mijn_programma_fiches()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select i.fiche_id
  from public.programma_items i
  join public.programmas p on p.id = i.programma_id
  where p.patient_id = auth.uid() and p.actief
$$;

-- ---------- Beveiliging per rij (RLS) ----------

alter table public.patienten enable row level security;
alter table public.programmas enable row level security;
alter table public.programma_items enable row level security;

-- Therapeuten en beheerders: alles
drop policy if exists "patienten: team" on public.patienten;
create policy "patienten: team" on public.patienten
  for all to authenticated using (public.is_team()) with check (public.is_team());

drop policy if exists "programmas: team" on public.programmas;
create policy "programmas: team" on public.programmas
  for all to authenticated using (public.is_team()) with check (public.is_team());

drop policy if exists "items: team" on public.programma_items;
create policy "items: team" on public.programma_items
  for all to authenticated using (public.is_team()) with check (public.is_team());

-- Patiënt: enkel lezen, enkel het eigene, enkel actieve programma's
drop policy if exists "patienten: eigen" on public.patienten;
create policy "patienten: eigen" on public.patienten
  for select to authenticated using (id = auth.uid());

drop policy if exists "programmas: eigen actief" on public.programmas;
create policy "programmas: eigen actief" on public.programmas
  for select to authenticated using (patient_id = auth.uid() and actief);

drop policy if exists "items: eigen actief" on public.programma_items;
create policy "items: eigen actief" on public.programma_items
  for select to authenticated
  using (programma_id in (select id from public.programmas where patient_id = auth.uid() and actief));

drop policy if exists "fiches: patient leest eigen" on public.fiches;
create policy "fiches: patient leest eigen" on public.fiches
  for select to authenticated using (id in (select public.mijn_programma_fiches()));

drop policy if exists "fiches-bucket: patient leest eigen" on storage.objects;
create policy "fiches-bucket: patient leest eigen" on storage.objects
  for select to authenticated
  using (bucket_id = 'fiches' and name in (
    select f.bestand_pad from public.fiches f where f.id in (select public.mijn_programma_fiches())
  ));

-- ---------- Rechten voor de app (Data API) ----------
-- Schrijven kan enkel het team (RLS hierboven). Niet-aangemelde bezoekers ("anon") krijgen niets.

revoke all on public.patienten, public.programmas, public.programma_items from anon;
grant select, insert, update, delete on public.patienten to authenticated;
grant select, insert, update, delete on public.programmas to authenticated;
grant select, insert, update, delete on public.programma_items to authenticated;
grant execute on function public.mijn_programma_fiches() to authenticated;

-- De Edge Function "patient-account" (service_role) maakt patiënten aan en leest de rol in profielen.
grant select, insert, update, delete on public.patienten, public.programmas, public.programma_items to service_role;
grant select on public.profielen to service_role;
