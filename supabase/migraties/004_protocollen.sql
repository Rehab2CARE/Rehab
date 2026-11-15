-- Praktijkfiches, opvolging stap 1: protocollen met fasen, criteria en standaardoefeningen per fase.
-- Plak dit in Supabase → SQL Editor → New query → Run. Je mag het meermaals uitvoeren.
--
-- Dit bestand maakt enkel de STRUCTUUR. De inhoud van de protocollen (VKB, enkel) staat in een apart,
-- niet-openbaar bestand (local/protocollen/seed-protocollen.sql) dat de therapeut zelf uitvoert.
--
-- Wie ziet wat:
--   therapeut/beheerder : alles lezen en aanpassen
--   patiënt             : (nog) niets; dat komt in stap 2 (enkel de eigen fase, volgens "zichtbaar")

-- ---------- Tabellen ----------

create table if not exists public.protocollen (
  id text primary key,                          -- bv. 'vkb', 'enkel'
  naam text not null,
  versie text not null default '',
  status text not null default '',
  instellingen jsonb not null default '{}'::jsonb, -- verschuivingen per ingreep, sportprofielen, grafttypes
  volgorde integer not null default 0,
  bijgewerkt timestamptz not null default now()
);

create table if not exists public.protocol_fasen (
  id uuid primary key default gen_random_uuid(),
  protocol_id text not null references public.protocollen (id) on delete cascade,
  nummer integer not null,
  titel text not null,                          -- klinische titel (therapeut)
  titel_patient text not null default '',       -- titel in patiënttaal
  kort text not null default '',
  wanneer text not null default '',             -- bv. 'Typisch week 2 tot 4'
  ondergrens_weken numeric,                     -- biologische ondergrens (basis, zonder verschuiving)
  doel_patient text not null default '',
  doel_concept boolean not null default false,  -- true = voorstel, nog goed te keuren
  scope text not null default '',
  opmerkingen text not null default '',
  zichtbaar jsonb not null default '{"oefeningen": true, "doel": true, "criteria": true, "testresultaten": false}'::jsonb,
  bijgewerkt timestamptz not null default now(),
  unique (protocol_id, nummer)
);
create index if not exists fasen_protocol on public.protocol_fasen (protocol_id);

create table if not exists public.protocol_criteria (
  id uuid primary key default gen_random_uuid(),
  fase_id uuid not null references public.protocol_fasen (id) on delete cascade,
  volgorde integer not null default 0,
  criterium text not null,
  testmethode text not null default '',
  drempel text not null default '',
  niveau text not null default '',              -- evidentieniveau A–D
  bron text not null default '',
  bij_niet_halen text not null default '',
  patient_tekst text not null default '',
  patient_concept boolean not null default true, -- true = voorstel, nog goed te keuren
  bijgewerkt timestamptz not null default now()
);
create index if not exists criteria_fase on public.protocol_criteria (fase_id);

-- Standaardoefeningen per fase (fiches + dosering). Bij een patiënt neem je ze over en pas je aan.
create table if not exists public.fase_oefeningen (
  id uuid primary key default gen_random_uuid(),
  fase_id uuid not null references public.protocol_fasen (id) on delete cascade,
  fiche_id uuid not null references public.fiches (id) on delete cascade,
  sets text not null default '',
  herhalingen text not null default '',
  frequentie text not null default '',
  notitie text not null default '',
  volgorde integer not null default 0
);
create index if not exists fase_oefeningen_fase on public.fase_oefeningen (fase_id);

drop trigger if exists zet_bijgewerkt on public.protocollen;
create trigger zet_bijgewerkt before insert or update on public.protocollen
  for each row execute function public.zet_bijgewerkt();
drop trigger if exists zet_bijgewerkt on public.protocol_fasen;
create trigger zet_bijgewerkt before insert or update on public.protocol_fasen
  for each row execute function public.zet_bijgewerkt();
drop trigger if exists zet_bijgewerkt on public.protocol_criteria;
create trigger zet_bijgewerkt before insert or update on public.protocol_criteria
  for each row execute function public.zet_bijgewerkt();

-- ---------- Beveiliging per rij (RLS): enkel het team ----------

alter table public.protocollen enable row level security;
alter table public.protocol_fasen enable row level security;
alter table public.protocol_criteria enable row level security;
alter table public.fase_oefeningen enable row level security;

drop policy if exists "protocollen: team" on public.protocollen;
create policy "protocollen: team" on public.protocollen
  for all to authenticated using (public.is_team()) with check (public.is_team());
drop policy if exists "fasen: team" on public.protocol_fasen;
create policy "fasen: team" on public.protocol_fasen
  for all to authenticated using (public.is_team()) with check (public.is_team());
drop policy if exists "criteria: team" on public.protocol_criteria;
create policy "criteria: team" on public.protocol_criteria
  for all to authenticated using (public.is_team()) with check (public.is_team());
drop policy if exists "fase_oefeningen: team" on public.fase_oefeningen;
create policy "fase_oefeningen: team" on public.fase_oefeningen
  for all to authenticated using (public.is_team()) with check (public.is_team());

-- ---------- Rechten (Data API) ----------

revoke all on public.protocollen, public.protocol_fasen, public.protocol_criteria, public.fase_oefeningen from anon;
grant select, insert, update, delete on public.protocollen, public.protocol_fasen, public.protocol_criteria, public.fase_oefeningen to authenticated;
grant select, insert, update, delete on public.protocollen, public.protocol_fasen, public.protocol_criteria, public.fase_oefeningen to service_role;
