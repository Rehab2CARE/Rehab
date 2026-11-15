-- Praktijkfiches, opvolging stap 2: een patiënt volgt een protocol (traject), fase per fase.
-- Plak dit in Supabase → SQL Editor → New query → Run (na 004_protocollen.sql). Je mag het meermaals uitvoeren.
--
-- De therapeut beslist: een fase gaat enkel open als de therapeut ze vrijgeeft. De datum is een minimum, geen trigger.
-- Een patiënt leest zijn eigen opvolging ENKEL via de functie mijn_opvolging(): die geeft alleen patiëntteksten terug,
-- en alleen wat de therapeut zichtbaar zette. Drempels, testmethodes en notities blijven dicht.

-- ---------- Tabellen ----------

create table if not exists public.patient_trajecten (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patienten (id) on delete cascade,
  protocol_id text not null references public.protocollen (id),
  startdatum date,                               -- operatiedatum (VKB) of letseldatum (enkel)
  zijde text not null default '' check (zijde in ('', 'L', 'R')),
  graft text not null default '',
  ingreep text not null default '',              -- bijkomende ingreep: verschuift de ondergrenzen
  sportprofiel text not null default '',
  huidige_fase integer not null default 1,
  zichtbaar jsonb not null default '{}'::jsonb,  -- afwijkingen voor deze patiënt; ontbreekt = standaard van de fase
  actief boolean not null default true,
  aangemaakt_door uuid references public.profielen (id) on delete set null,
  aangemaakt timestamptz not null default now(),
  bijgewerkt timestamptz not null default now()
);
create index if not exists trajecten_patient on public.patient_trajecten (patient_id);

-- Wanneer werd welke fase vrijgegeven, en door wie
create table if not exists public.traject_fasen (
  id uuid primary key default gen_random_uuid(),
  traject_id uuid not null references public.patient_trajecten (id) on delete cascade,
  nummer integer not null,
  vrijgegeven timestamptz not null default now(),
  door uuid references public.profielen (id) on delete set null
);
create index if not exists traject_fasen_traject on public.traject_fasen (traject_id);

-- Het oefenprogramma van een fase is een gewoon programma, gekoppeld aan het traject
alter table public.programmas add column if not exists traject_id uuid references public.patient_trajecten (id) on delete set null;
alter table public.programmas add column if not exists fase_nummer integer;

drop trigger if exists zet_bijgewerkt on public.patient_trajecten;
create trigger zet_bijgewerkt before insert or update on public.patient_trajecten
  for each row execute function public.zet_bijgewerkt();

-- ---------- Beveiliging per rij (RLS): enkel het team ----------

alter table public.patient_trajecten enable row level security;
alter table public.traject_fasen enable row level security;

drop policy if exists "trajecten: team" on public.patient_trajecten;
create policy "trajecten: team" on public.patient_trajecten
  for all to authenticated using (public.is_team()) with check (public.is_team());
drop policy if exists "traject_fasen: team" on public.traject_fasen;
create policy "traject_fasen: team" on public.traject_fasen
  for all to authenticated using (public.is_team()) with check (public.is_team());

-- ---------- Wat de patiënt mag lezen: enkel via deze functie ----------
-- Per actief traject: de huidige fase in patiënttaal, en enkel wat zichtbaar staat.

create or replace function public.mijn_opvolging()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(rij order by rij->>'aangemaakt'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'traject_id', t.id,
      'aangemaakt', t.aangemaakt,
      'protocol', p.naam,
      'fase', t.huidige_fase,
      'aantal_fasen', (select count(*) from protocol_fasen x where x.protocol_id = t.protocol_id),
      'fase_sinds', (select max(v.vrijgegeven) from traject_fasen v where v.traject_id = t.id and v.nummer = t.huidige_fase),
      'zichtbaar', z.zichtbaar,
      'titel', case when (z.zichtbaar->>'doel')::boolean then f.titel_patient end,
      'doel', case when (z.zichtbaar->>'doel')::boolean then f.doel_patient end,
      'criteria', case when (z.zichtbaar->>'criteria')::boolean then (
        select coalesce(jsonb_agg(c.patient_tekst order by c.volgorde), '[]'::jsonb)
        from protocol_criteria c where c.fase_id = f.id and c.patient_tekst <> ''
      ) end
    ) as rij
    from patient_trajecten t
    join protocollen p on p.id = t.protocol_id
    join protocol_fasen f on f.protocol_id = t.protocol_id and f.nummer = t.huidige_fase
    cross join lateral (
      select jsonb_build_object(
        'oefeningen', coalesce((t.zichtbaar->>'oefeningen')::boolean, (f.zichtbaar->>'oefeningen')::boolean, true),
        'doel', coalesce((t.zichtbaar->>'doel')::boolean, (f.zichtbaar->>'doel')::boolean, true),
        'criteria', coalesce((t.zichtbaar->>'criteria')::boolean, (f.zichtbaar->>'criteria')::boolean, true),
        'testresultaten', coalesce((t.zichtbaar->>'testresultaten')::boolean, (f.zichtbaar->>'testresultaten')::boolean, false)
      ) as zichtbaar
    ) z
    where t.patient_id = auth.uid() and t.actief
  ) s
$$;

-- ---------- Rechten (Data API) ----------

revoke all on public.patient_trajecten, public.traject_fasen from anon;
grant select, insert, update, delete on public.patient_trajecten, public.traject_fasen to authenticated;
grant select, insert, update, delete on public.patient_trajecten, public.traject_fasen to service_role;
revoke all on function public.mijn_opvolging() from public, anon;
grant execute on function public.mijn_opvolging() to authenticated;
