-- Test van rollen en RLS. Uitvoeren na stub_supabase.sql + migraties, in een lokale Postgres.
\set ON_ERROR_STOP on
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;

insert into auth.users (id, email, raw_app_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'beheerder@test.be', '{}'),
  ('00000000-0000-0000-0000-00000000000b', 'camille@test.be', '{}'),
  ('00000000-0000-0000-0000-00000000000c', 'nieuw@test.be', '{}'),
  ('00000000-0000-0000-0000-00000000000d', 'patient@test.be', '{"rol":"patient"}');

-- Eerste beheerder zetten zoals in de README (als databankeigenaar)
update public.profielen set rol = 'beheerder' where email = 'beheerder@test.be';

do $$ begin
  assert (select count(*) from public.profielen) = 4, 'trigger maakt profielen';
  assert (select rol from public.profielen where email = 'nieuw@test.be') is null, 'nieuw account zonder rol';
  assert (select rol from public.profielen where email = 'patient@test.be') = 'patient', 'rol uit app_metadata';
  assert (select count(*) from public.knopen where niveau = 0) = 3, 'standaardstructuur: 3 onderdelen';
  assert (select count(*) from public.knopen where niveau = 2) > 20, 'standaardstructuur: categorieën';
end $$;

set role authenticated;

-- Beheerder maakt Camille therapeut
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
update public.profielen set rol = 'therapeut' where email = 'camille@test.be';
do $$ begin
  assert (select count(*) from public.profielen) = 4, 'beheerder ziet alle profielen';
end $$;

-- Beheerder kan zichzelf niet degraderen
do $$ begin
  begin
    update public.profielen set rol = 'therapeut' where email = 'beheerder@test.be';
    raise exception 'FOUT: degraderen mocht';
  exception when others then
    if sqlerrm like 'FOUT%' then raise; end if;
  end;
end $$;

-- Therapeut: ziet knopen, maakt een fiche, maar kan geen rollen wijzigen
select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
do $$
declare cat uuid; n int;
begin
  assert (select count(*) from public.knopen) > 0, 'therapeut ziet knopen';
  assert (select count(*) from public.profielen) = 1, 'therapeut ziet enkel eigen profiel';
  select id into cat from public.knopen where niveau = 2 limit 1;
  insert into public.fiches (categorie_id, titel, soort, tekst) values (cat, 'Testfiche', 'tekst', 'Hallo');
  update public.profielen set rol = 'beheerder' where email = 'nieuw@test.be';
  get diagnostics n = row_count;
  assert n = 0, 'therapeut kan geen rollen wijzigen';
  insert into storage.objects (bucket_id, name) values ('fiches', 'x/test.pdf');
end $$;

-- Fiche in een onderdeel (niveau 0) mag niet
do $$
declare s uuid;
begin
  select id into s from public.knopen where niveau = 0 limit 1;
  begin
    insert into public.fiches (categorie_id, titel, soort, tekst) values (s, 'Fout', 'tekst', 'x');
    raise exception 'FOUT: fiche op niveau 0 mocht';
  exception when others then
    if sqlerrm like 'FOUT%' then raise; end if;
  end;
end $$;

-- Account zonder rol en patiënt: zien niets van het team
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
do $$ begin
  assert (select count(*) from public.knopen) = 0, 'zonder rol: geen knopen';
  assert (select count(*) from public.fiches) = 0, 'zonder rol: geen fiches';
  assert (select count(*) from storage.objects) = 0, 'zonder rol: geen bestanden';
  begin
    insert into public.knopen (niveau, titel) values (0, 'Inbraak');
    raise exception 'FOUT: zonder rol kon invoegen';
  exception when others then
    if sqlerrm like 'FOUT%' then raise; end if;
  end;
end $$;

select set_config('test.uid', '00000000-0000-0000-0000-00000000000d', false);
do $$ begin
  assert (select count(*) from public.fiches) = 0, 'patiënt: geen fiches (fase 1)';
  assert (select count(*) from public.profielen) = 1, 'patiënt: enkel eigen profiel';
end $$;

-- Zonder aanmelding (anon): niets
reset role;
set role anon;
select set_config('test.uid', '', false);
do $$ begin
  begin
    perform count(*) from public.knopen;
    raise exception 'FOUT: anon kan knopen lezen';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Wissen van een regio wist ook categorieën en fiches (cascade)
do $$
declare r uuid;
begin
  select k.id into r from public.knopen k where niveau = 1 and exists (
    select 1 from public.knopen c join public.fiches f on f.categorie_id = c.id where c.ouder_id = k.id);
  delete from public.knopen where id = r;
  assert (select count(*) from public.fiches) = 0, 'cascade wist fiches';
end $$;

select 'ALLE RLS-TESTS GESLAAGD' as resultaat;
