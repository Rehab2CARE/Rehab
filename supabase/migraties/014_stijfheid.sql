-- Praktijkfiches: stijfheid in de oefensessies (verkeerslicht).
-- Plak dit in Supabase -> SQL Editor -> New query -> Run (na 013). Je mag het meermaals uitvoeren.
--
-- De patient duidt aan of zijn knie (of enkel) stijver is dan de vorige keer: minder goed strekken of plooien.
-- "stijver" telt in het verkeerslicht als oranje (zie js/verkeerslicht.js).

alter table public.oefensessies add column if not exists stijfheid text not null default '';

alter table public.oefensessies drop constraint if exists oefensessies_stijfheid_check;
alter table public.oefensessies add constraint oefensessies_stijfheid_check
  check (stijfheid in ('', 'beter', 'zelfde', 'stijver'));

-- Ter controle
select column_name, data_type, column_default from information_schema.columns
where table_schema = 'public' and table_name = 'oefensessies' and column_name = 'stijfheid';
