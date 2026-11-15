-- Praktijkfiches: herstel van verminkte tekens (graden, trema en accenten die als rare tekens verschenen).
-- Oorzaak: bij het kopieren naar het klembord werd de tekst in een verkeerde tekenset gelezen.
-- Plak dit in Supabase -> SQL Editor -> New query -> Run. Je mag het meermaals uitvoeren: correcte tekst blijft ongewijzigd.
-- Dit bestand bevat bewust enkel gewone tekens (de speciale tekens staan als U&'\00E9'-codes), zodat het zelf niet kan verminken.

create or replace function public.herstel_tekens(t text)
returns text
language plpgsql
immutable
as $$
declare
  paren text[] := array[
    array[U&'\201A\00C4\00EC', U&'\2013'],
    array[U&'\201A\00C4\00EE', U&'\2014'],
    array[U&'\201A\00C4\222B', U&'\203A'],
    array[U&'\201A\00DC\00ED', U&'\2192'],
    array[U&'\201A\00E2\00A7', U&'\2264'],
    array[U&'\201A\00E2\2022', U&'\2265'],
    array[U&'\00AC\221E', U&'\00B0'],
    array[U&'\00AC\00B1', U&'\00B1'],
    array[U&'\221A\00E2', U&'\00C9'],
    array[U&'\221A\00F3', U&'\00D7'],
    array[U&'\221A\00B0', U&'\00E1'],
    array[U&'\221A\00A9', U&'\00E9'],
    array[U&'\221A\00B4', U&'\00EB'],
    array[U&'\221A\00D8', U&'\00EF'],
    array[U&'\221A\2265', U&'\00F3'],
    array[U&'\221A\2202', U&'\00F6'],
    array[U&'\221A\2211', U&'\00F7'],
    array[U&'\221A\00BA', U&'\00FC']
  ];
  i integer;
begin
  if t is null then return t; end if;
  for i in 1 .. array_length(paren, 1) loop
    t := replace(t, paren[i][1], paren[i][2]);
  end loop;
  return t;
end;
$$;

update public.protocollen set
  naam = public.herstel_tekens(naam), versie = public.herstel_tekens(versie), status = public.herstel_tekens(status),
  instellingen = public.herstel_tekens(instellingen::text)::jsonb;

update public.protocol_fasen set
  titel = public.herstel_tekens(titel), titel_patient = public.herstel_tekens(titel_patient), kort = public.herstel_tekens(kort),
  wanneer = public.herstel_tekens(wanneer), doel_patient = public.herstel_tekens(doel_patient),
  scope = public.herstel_tekens(scope), opmerkingen = public.herstel_tekens(opmerkingen)
where (titel || titel_patient || kort || wanneer || doel_patient || scope || opmerkingen)
  is distinct from public.herstel_tekens(titel || titel_patient || kort || wanneer || doel_patient || scope || opmerkingen);

update public.protocol_criteria set
  criterium = public.herstel_tekens(criterium), testmethode = public.herstel_tekens(testmethode), drempel = public.herstel_tekens(drempel),
  niveau = public.herstel_tekens(niveau), bron = public.herstel_tekens(bron), bij_niet_halen = public.herstel_tekens(bij_niet_halen),
  patient_tekst = public.herstel_tekens(patient_tekst)
where (criterium || testmethode || drempel || niveau || bron || bij_niet_halen || patient_tekst)
  is distinct from public.herstel_tekens(criterium || testmethode || drempel || niveau || bron || bij_niet_halen || patient_tekst);

update public.tests set
  groep = public.herstel_tekens(groep), naam = public.herstel_tekens(naam), naam_patient = public.herstel_tekens(naam_patient),
  eenheid = public.herstel_tekens(eenheid), opties = public.herstel_tekens(opties::text)::text[];

update public.knopen set titel = public.herstel_tekens(titel), omschrijving = public.herstel_tekens(omschrijving)
where (titel || omschrijving) is distinct from public.herstel_tekens(titel || omschrijving);

update public.fiches set titel = public.herstel_tekens(titel), omschrijving = public.herstel_tekens(omschrijving)
where (titel || omschrijving) is distinct from public.herstel_tekens(titel || omschrijving);

drop function public.herstel_tekens(text);

-- Ter controle: zoek nog verminkte tekens (dit moet 0 geven)
select
  (select count(*) from public.protocol_fasen where (titel || titel_patient || wanneer || doel_patient || scope || opmerkingen) ~ U&'[\221A\00AC\201A\00C3]') as fasen,
  (select count(*) from public.protocol_criteria where (criterium || testmethode || drempel || bij_niet_halen || patient_tekst) ~ U&'[\221A\00AC\201A\00C3]') as criteria,
  (select count(*) from public.tests where (naam || naam_patient || groep) ~ U&'[\221A\00AC\201A\00C3]') as tests;
