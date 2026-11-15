-- Praktijkfiches: testresultaten standaard zichtbaar voor de patiënt.
-- Plak dit in Supabase → SQL Editor → New query → Run (na 009). Je mag het meermaals uitvoeren.
--
-- Zet "testresultaten" aan in alle bestaande fasen en maakt dat de standaard voor nieuwe fasen.
-- Per fase (Protocollen) of per patiënt (Zichtbaar voor deze patiënt) kan je het nog altijd uitzetten.

update public.protocol_fasen
set zichtbaar = jsonb_set(coalesce(zichtbaar, '{}'::jsonb), '{testresultaten}', 'true'::jsonb);

alter table public.protocol_fasen
  alter column zichtbaar set default '{"oefeningen": true, "doel": true, "criteria": true, "testresultaten": true}'::jsonb;

-- Ter controle
select protocol_id, nummer, zichtbaar->>'testresultaten' as testresultaten from public.protocol_fasen order by protocol_id, nummer;
