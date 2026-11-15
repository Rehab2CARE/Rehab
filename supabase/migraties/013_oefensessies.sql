-- Praktijkfiches: oefensessies met feedback van de patient (pijn, zwelling, wat ging goed, wat was moeilijk).
-- Plak dit in Supabase -> SQL Editor -> New query -> Run (na 012). Je mag het meermaals uitvoeren.
--
-- De patient duidt in een kalender per dag aan of hij geoefend heeft (alles, een deel, niet) en geeft feedback.
-- Een ingave per dag; de patient mag zijn eigen dagen aanpassen. Hij leest en schrijft enkel zijn eigen ingaven.
-- Het team leest alle sessies (en kan ze wissen). Let op: dit zijn gezondheidsgegevens die de patient zelf ingeeft.

create table if not exists public.oefensessies (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patienten (id) on delete cascade,
  programma_id uuid references public.programmas (id) on delete set null,
  datum date not null default current_date,
  gedaan text not null default 'alles' check (gedaan in ('alles', 'deel', 'niet')),
  pijn integer check (pijn between 0 and 10),
  zwelling text not null default '' check (zwelling in ('', 'geen', 'minder', 'zelfde', 'meer')),
  goed text not null default '' check (length(goed) <= 500),
  moeilijk text not null default '' check (length(moeilijk) <= 500),
  aangemaakt timestamptz not null default now()
);
create index if not exists oefensessies_patient on public.oefensessies (patient_id, datum desc);
create unique index if not exists oefensessies_dag on public.oefensessies (patient_id, datum);

alter table public.oefensessies enable row level security;

drop policy if exists "oefensessies: team" on public.oefensessies;
create policy "oefensessies: team" on public.oefensessies
  for all to authenticated using (public.is_team()) with check (public.is_team());

drop policy if exists "oefensessies: eigen lezen" on public.oefensessies;
create policy "oefensessies: eigen lezen" on public.oefensessies
  for select to authenticated using (patient_id = auth.uid());

drop policy if exists "oefensessies: eigen bewaren" on public.oefensessies;
create policy "oefensessies: eigen bewaren" on public.oefensessies
  for insert to authenticated
  with check (
    patient_id = auth.uid()
    and (programma_id is null or programma_id in (select id from public.programmas where patient_id = auth.uid()))
  );

drop policy if exists "oefensessies: eigen aanpassen" on public.oefensessies;
create policy "oefensessies: eigen aanpassen" on public.oefensessies
  for update to authenticated
  using (patient_id = auth.uid())
  with check (
    patient_id = auth.uid()
    and (programma_id is null or programma_id in (select id from public.programmas where patient_id = auth.uid()))
  );

revoke all on public.oefensessies from anon;
grant select, insert, update, delete on public.oefensessies to authenticated;
grant select, insert, update, delete on public.oefensessies to service_role;
