-- Praktijkfiches: meniscus (zijde en type letsel) bij een traject.
-- Plak dit in Supabase → SQL Editor → New query → Run (na 005). Je mag het meermaals uitvoeren.
--
-- De keuzelijsten staan bij de instellingen van het protocol (niet in de code), zodat je ze kan aanpassen.
-- De bijkomende ingreep (bv. meniscusherstel) blijft apart: die verschuift de ondergrenzen.

alter table public.patient_trajecten add column if not exists meniscus_zijde text not null default '';
alter table public.patient_trajecten add column if not exists meniscus_letsel text not null default '';

update public.protocollen
set instellingen = instellingen || jsonb_build_object('meniscus', jsonb_build_object(
  'zijden', jsonb_build_array('Mediaal', 'Lateraal', 'Mediaal en lateraal'),
  'letsels', jsonb_build_array(
    'Longitudinaal (verticaal)', 'Korfhengsel (bucket handle)', 'Radiair', 'Horizontaal',
    'Flap (lapvormig)', 'Complex', 'Wortelletsel', 'Ramp-lesie'
  )
))
where id = 'vkb';

-- Ter controle
select id, instellingen->'meniscus' as meniscus from public.protocollen where id = 'vkb';
