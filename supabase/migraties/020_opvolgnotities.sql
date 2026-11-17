-- Praktijkfiches: opvolgnotities per patiënt, enkel zichtbaar voor de therapeut die ze schreef.
-- Plak dit in Supabase -> SQL Editor -> New query -> Run (na 019). Je mag het meermaals uitvoeren.
--
-- Wie ziet wat?
--   - De schrijver (auteur) leest, wijzigt en wist enkel zijn eigen notities.
--   - Collega's en de beheerder zien ze NIET. De patiënt ziet ze nooit.
-- Let op: dit zijn gezondheidsgegevens. Zie de README (testfase, GDPR-advies vóór echte patiënten).

create table if not exists public.opvolgnotities (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patienten (id) on delete cascade,
  auteur_id uuid not null default auth.uid() references public.profielen (id) on delete cascade,
  datum date not null default current_date,
  tekst text not null check (length(trim(tekst)) > 0 and length(tekst) <= 4000),
  aangemaakt timestamptz not null default now(),
  bijgewerkt timestamptz not null default now()
);
create index if not exists opvolgnotities_patient on public.opvolgnotities (patient_id, auteur_id, datum desc);

drop trigger if exists zet_bijgewerkt on public.opvolgnotities;
create trigger zet_bijgewerkt before insert or update on public.opvolgnotities
  for each row execute function public.zet_bijgewerkt();

alter table public.opvolgnotities enable row level security;

-- Eén regel voor alles: enkel je eigen notities, en enkel als je (nog) tot het team behoort.
drop policy if exists "opvolgnotities: enkel auteur" on public.opvolgnotities;
create policy "opvolgnotities: enkel auteur" on public.opvolgnotities
  for all to authenticated
  using (auteur_id = auth.uid() and public.is_team())
  with check (auteur_id = auth.uid() and public.is_team());

revoke all on public.opvolgnotities from anon;
grant select, insert, update, delete on public.opvolgnotities to authenticated;
grant select, insert, update, delete on public.opvolgnotities to service_role;
