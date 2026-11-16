-- Praktijkfiches: oefenschema's die meegaan met de weken na de operatie (eerst: het quadricepsschema).
-- Plak dit in Supabase -> SQL Editor -> New query -> Run (na 007). Je mag het meermaals uitvoeren.
--
-- De inhoud van een schema staat in de app (data/schema-quadriceps.json), niet in de databank.
-- Per traject bewaart de databank enkel hoe de therapeut bijstuurt, in de kolom "schemas":
--   {}                              -> automatisch, volgens de weken na de operatie
--   {"quadriceps": {"blok": "week-4-6"}} -> vastgezet op dat blok
--   {"quadriceps": {"uit": true}}   -> niet tonen aan de patiënt
--
-- mijn_opvolging() geeft de patiënt nu ook het aantal weken sinds de operatie (niet de datum zelf) en die instelling.

alter table public.patient_trajecten add column if not exists schemas jsonb not null default '{}'::jsonb;

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
      'protocol_id', t.protocol_id,
      'week', case when t.startdatum is null then null else floor((current_date - t.startdatum)::numeric / 7)::int end,
      'schemas', t.schemas,
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
