-- Praktijkfiches: metingen met een dubbeltaak toch tonen aan de patiënt, als aparte reeks.
-- Plak dit in Supabase -> SQL Editor -> New query -> Run (na 015 of 016). Je mag het meermaals uitvoeren.
--
-- Vervangt 016: de patiënt krijgt weer alle metingen, maar nu met een veld "dubbeltaak" (spel, niveau, score),
-- zodat de app de metingen met dubbeltaak apart toont en ze niet vermengt met de gewone metingen.

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
          select jsonb_agg(jsonb_build_object('datum', tm.datum, 'links', m.links, 'rechts', m.rechts, 'waarde', m.waarde, 'tekst', m.tekst,
            'dubbeltaak', case when m.dubbeltaak is null then null else jsonb_build_object(
              'spel_titel', m.dubbeltaak->'spel_titel', 'niveau', m.dubbeltaak->'niveau',
              'score', m.dubbeltaak->'score', 'max', m.dubbeltaak->'max') end
          ) order by tm.datum)
          from metingen m join testmomenten tm on tm.id = m.testmoment_id
          where tm.traject_id = t.id and m.test_id = x.id
        )
      ) order by x.volgorde), '[]'::jsonb)
      from tests x
      where exists (select 1 from metingen m join testmomenten tm on tm.id = m.testmoment_id where tm.traject_id = t.id and m.test_id = x.id)
    )
  )), '[]'::jsonb)
  from patient_trajecten t
  join protocol_fasen f on f.protocol_id = t.protocol_id and f.nummer = t.huidige_fase
  where t.patient_id = auth.uid() and t.actief
    and coalesce((t.zichtbaar->>'testresultaten')::boolean, (f.zichtbaar->>'testresultaten')::boolean, false)
$$;

revoke all on function public.mijn_testresultaten() from public, anon;
grant execute on function public.mijn_testresultaten() to authenticated;
