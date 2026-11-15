-- Praktijkfiches: dubbeltaak per meting (bv. single-leg stand terwijl de patiënt "Ballen volgen" speelt).
-- Plak dit in Supabase -> SQL Editor -> New query -> Run (na 014). Je mag het meermaals uitvoeren.
--
-- dubbeltaak = leeg (geen dubbeltaak) of een JSON-object, bv.
--   { "spel": "ballen", "spel_titel": "Ballen volgen", "niveau": 4, "score": 12, "max": 16,
--     "omschrijving": "4 van 8 ballen · gemiddeld · 10 s", "kleur": { "juist": 3, "van": 4 } }
-- Enkel het team leest en schrijft metingen (RLS uit 009 blijft gelden). mijn_testresultaten() geeft
-- dit veld niet door aan de patiënt.

alter table public.metingen add column if not exists dubbeltaak jsonb;

-- Ter controle
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'metingen' and column_name = 'dubbeltaak';
