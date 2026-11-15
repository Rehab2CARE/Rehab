-- Praktijkfiches, opvolging stap 3: criteria afvinken per patiënt, met voortgang.
-- Plak dit in Supabase → SQL Editor → New query → Run (na 005 en 006). Je mag het meermaals uitvoeren.
--
-- Per traject en per criterium: voldaan, niet voldaan of n.v.t., met datum en een notitie (enkel voor het team).
-- De patiënt ziet via mijn_opvolging() enkel de patiënttekst en of het criterium voldaan is. Nooit de notitie.

create table if not exists public.criterium_status (
  id uuid primary key default gen_random_uuid(),
  traject_id uuid not null references public.patient_trajecten (id) on delete cascade,
  criterium_id uuid not null references public.protocol_criteria (id) on delete cascade,
  status text not null check (status in ('voldaan', 'niet_voldaan', 'nvt')),
  datum date not null default current_date,
  notitie text not null default '',
  door uuid references public.profielen (id) on delete set null,
  bijgewerkt timestamptz not null default now(),
  unique (traject_id, criterium_id)
);
create index if not exists criterium_status_traject on public.criterium_status (traject_id);

drop trigger if exists zet_bijgewerkt on public.criterium_status;
create trigger zet_bijgewerkt before insert or update on public.criterium_status
  for each row execute function public.zet_bijgewerkt();

alter table public.criterium_status enable row level security;
drop policy if exists "criterium_status: team" on public.criterium_status;
create policy "criterium_status: team" on public.criterium_status
  for all to authenticated using (public.is_team()) with check (public.is_team());

revoke all on public.criterium_status from anon;
grant select, insert, update, delete on public.criterium_status to authenticated;
grant select, insert, update, delete on public.criterium_status to service_role;

-- ---------- mijn_opvolging(): nu met voortgang ----------
-- criteria = [{ tekst, voldaan }] (n.v.t. weggelaten), plus aantal voldaan en totaal.

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
        select coalesce(jsonb_agg(jsonb_build_object('tekst', c.patient_tekst, 'voldaan', coalesce(s.status = 'voldaan', false)) order by c.volgorde), '[]'::jsonb)
        from protocol_criteria c
        left join criterium_status s on s.criterium_id = c.id and s.traject_id = t.id
        where c.fase_id = f.id and c.patient_tekst <> '' and coalesce(s.status, '') <> 'nvt'
      ) end,
      'voldaan', case when (z.zichtbaar->>'criteria')::boolean then (
        select count(*) from protocol_criteria c join criterium_status s on s.criterium_id = c.id and s.traject_id = t.id
        where c.fase_id = f.id and c.patient_tekst <> '' and s.status = 'voldaan'
      ) end,
      'totaal', case when (z.zichtbaar->>'criteria')::boolean then (
        select count(*) from protocol_criteria c left join criterium_status s on s.criterium_id = c.id and s.traject_id = t.id
        where c.fase_id = f.id and c.patient_tekst <> '' and coalesce(s.status, '') <> 'nvt'
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

revoke all on function public.mijn_opvolging() from public, anon;
grant execute on function public.mijn_opvolging() to authenticated;
