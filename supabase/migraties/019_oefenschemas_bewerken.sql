-- Praktijkfiches: oefenschema's (bv. het quadricepsschema) aanpassen in de app.
-- Plak dit in Supabase -> SQL Editor -> New query -> Run (na 018). Je mag het meermaals uitvoeren.
--
-- Eén rij per schema; de volledige inhoud (blokken, oefeningen, teksten) staat als jsonb in "inhoud".
-- Zolang er voor een schema geen rij is, gebruikt de app de startinhoud uit data/schema-<id>.json.
-- De eerste wijziging in de app maakt de rij aan.
--
-- Lezen: iedereen die aangemeld is (ook patiënten: de inhoud is niet persoonlijk, en de patiënt heeft ze nodig).
-- Schrijven: enkel het team.

create table if not exists public.oefenschemas (
  id text primary key,
  inhoud jsonb not null,
  bijgewerkt timestamptz not null default now(),
  bijgewerkt_door uuid references public.profielen (id) on delete set null
);

drop trigger if exists zet_bijgewerkt on public.oefenschemas;
create trigger zet_bijgewerkt before insert or update on public.oefenschemas
  for each row execute function public.zet_bijgewerkt();

alter table public.oefenschemas enable row level security;

drop policy if exists "oefenschemas: lezen" on public.oefenschemas;
create policy "oefenschemas: lezen" on public.oefenschemas
  for select to authenticated using (true);
drop policy if exists "oefenschemas: team schrijft" on public.oefenschemas;
create policy "oefenschemas: team schrijft" on public.oefenschemas
  for all to authenticated using (public.is_team()) with check (public.is_team());

revoke all on public.oefenschemas from anon;
grant select, insert, update, delete on public.oefenschemas to authenticated;
grant select, insert, update, delete on public.oefenschemas to service_role;
