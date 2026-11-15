-- Praktijkfiches: metingen met een dubbeltaak niet tonen aan de patiënt.
-- Plak dit in Supabase -> SQL Editor -> New query -> Run (na 015). Je mag het meermaals uitvoeren.
--
-- mijn_testresultaten() gaf alle metingen door, ook die met een dubbeltaak (bv. single-leg stand terwijl de
-- patiënt een spel speelt). Omdat de patiënt het veld "dubbeltaak" niet krijgt, kwamen die waarden als gewone
-- metingen in zijn grafiek en LSI-balk. Vanaf nu ziet de patiënt enkel de metingen zonder dubbeltaak.
-- Het team ziet in de app nog alles (met de dubbeltaak als aparte reeks).

create or replace function public.mijn_testresultaten()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'traject_id', t.id,
    'zijde', t.zijde,
    'tests', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'naam', coalesce(nullif(x.naam_patient, ''), x.naam), 'eenheid', x.eenheid, 'soort', x.soort,
        'lsi_omgekeerd', x.lsi_omgekeerd, 'doel_lsi', x.doel_lsi, 'doel_waarde', x.doel_waarde, 'lager_beter', x.lager_beter, 'opties', to_jsonb(x.opties),
        'metingen', (
          select jsonb_agg(jsonb_build_object('datum', tm.datum, 'links', m.links, 'rechts', m.rechts, 'waarde', m.waarde, 'tekst', m.tekst) order by tm.datum)
          from metingen m join testmomenten tm on tm.id = m.testmoment_id
          where tm.traject_id = t.id and m.test_id = x.id and m.dubbeltaak is null
        )
      ) order by x.volgorde), '[]'::jsonb)
      from tests x
      where exists (select 1 from metingen m join testmomenten tm on tm.id = m.testmoment_id
                    where tm.traject_id = t.id and m.test_id = x.id and m.dubbeltaak is null)
    )
  )), '[]'::jsonb)
  from patient_trajecten t
  join protocol_fasen f on f.protocol_id = t.protocol_id and f.nummer = t.huidige_fase
  where t.patient_id = auth.uid() and t.actief
    and coalesce((t.zichtbaar->>'testresultaten')::boolean, (f.zichtbaar->>'testresultaten')::boolean, false)
$$;

revoke all on function public.mijn_testresultaten() from public, anon;
grant execute on function public.mijn_testresultaten() to authenticated;
