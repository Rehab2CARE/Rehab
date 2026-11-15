-- Praktijkfiches, opvolging stap 4: testresultaten, LSI en grafieken.
-- Plak dit in Supabase → SQL Editor → New query → Run (na 007). Je mag het meermaals uitvoeren.
--
-- tests        = de testlijst (aanpasbaar), gebaseerd op de meetformulieren van het werkboek
-- testmomenten = per traject een datum (en gewicht), met
-- metingen     = per test: links en rechts (of één waarde)
-- LSI = aangedane ÷ gezonde zijde × 100 (bij tests waar lager beter is, zoals de 6 m timed hop, omgekeerd).
-- Een patiënt leest zijn resultaten ENKEL via mijn_testresultaten(), en enkel als "testresultaten" zichtbaar staat.

-- ---------- Tabellen ----------

create table if not exists public.tests (
  id text primary key,
  groep text not null,
  naam text not null,                         -- naam voor het team
  naam_patient text not null default '',      -- naam in patiënttaal
  eenheid text not null default '',
  soort text not null default 'lr' check (soort in ('lr', 'enkel', 'keuze')), -- lr = links/rechts met LSI
  lsi_omgekeerd boolean not null default false, -- true = lager is beter (LSI = gezond ÷ aangedaan)
  per_kg boolean not null default false,        -- ook per kg lichaamsgewicht tonen
  doel_lsi numeric,                             -- doelzone in de grafiek (bv. 90); leeg = verschil tonen i.p.v. LSI
  doel_waarde numeric,                          -- voor tests met één waarde (bv. IKDC 80)
  lager_beter boolean not null default false,   -- voor tests met één waarde (bv. pijn)
  opties text[] not null default '{}',          -- voor keuze-tests (bv. stroke test)
  volgorde integer not null default 0,
  actief boolean not null default true
);

create table if not exists public.testmomenten (
  id uuid primary key default gen_random_uuid(),
  traject_id uuid not null references public.patient_trajecten (id) on delete cascade,
  datum date not null default current_date,
  gewicht_kg numeric,
  notitie text not null default '',
  door uuid references public.profielen (id) on delete set null,
  aangemaakt timestamptz not null default now()
);
create index if not exists testmomenten_traject on public.testmomenten (traject_id);

create table if not exists public.metingen (
  id uuid primary key default gen_random_uuid(),
  testmoment_id uuid not null references public.testmomenten (id) on delete cascade,
  test_id text not null references public.tests (id) on delete cascade,
  links numeric,
  rechts numeric,
  waarde numeric,
  tekst text not null default '',
  notitie text not null default '',
  unique (testmoment_id, test_id)
);
create index if not exists metingen_testmoment on public.metingen (testmoment_id);

-- Een criterium kan aan een test gekoppeld zijn: dan toont de app de laatste meting bij het criterium
alter table public.protocol_criteria add column if not exists test_id text references public.tests (id) on delete set null;

-- ---------- Beveiliging (RLS): enkel het team ----------

alter table public.tests enable row level security;
alter table public.testmomenten enable row level security;
alter table public.metingen enable row level security;

drop policy if exists "tests: team" on public.tests;
create policy "tests: team" on public.tests for all to authenticated using (public.is_team()) with check (public.is_team());
drop policy if exists "testmomenten: team" on public.testmomenten;
create policy "testmomenten: team" on public.testmomenten for all to authenticated using (public.is_team()) with check (public.is_team());
drop policy if exists "metingen: team" on public.metingen;
create policy "metingen: team" on public.metingen for all to authenticated using (public.is_team()) with check (public.is_team());

revoke all on public.tests, public.testmomenten, public.metingen from anon;
grant select, insert, update, delete on public.tests, public.testmomenten, public.metingen to authenticated;
grant select, insert, update, delete on public.tests, public.testmomenten, public.metingen to service_role;

-- ---------- De testlijst ----------
-- (id, groep, naam, naam_patient, eenheid, soort, lsi_omgekeerd, per_kg, doel_lsi, doel_waarde, lager_beter, opties, volgorde)

insert into public.tests (id, groep, naam, naam_patient, eenheid, soort, lsi_omgekeerd, per_kg, doel_lsi, doel_waarde, lager_beter, opties, volgorde) values
  ('quad-iso-60',   'Kracht', 'Quadriceps isometrisch 60°', 'Kracht voorkant bovenbeen', 'Nm', 'lr', false, true, 90, null, false, '{}', 10),
  ('quad-iso-90',   'Kracht', 'Quadriceps isometrisch 90°', 'Kracht voorkant bovenbeen (90°)', 'Nm', 'lr', false, true, 90, null, false, '{}', 11),
  ('ham-iso-90',    'Kracht', 'Hamstrings isometrisch 90°', 'Kracht achterkant bovenbeen', 'Nm', 'lr', false, true, 90, null, false, '{}', 12),
  ('ham-ecc',       'Kracht', 'Hamstrings excentrisch (Nordic of dynamometrie)', 'Remkracht achterkant bovenbeen', 'N', 'lr', false, true, 90, null, false, '{}', 13),
  ('heup-ext',      'Kracht', 'Heupextensoren', 'Kracht bilspieren', 'N', 'lr', false, true, 90, null, false, '{}', 14),
  ('soleus',        'Kracht', 'Soleus, zittende isometrische calf raise', 'Kracht kuit', 'N', 'lr', false, true, 90, null, false, '{}', 15),
  ('legpress-10rm', 'Kracht', 'Leg press 10 RM', 'Beenpers', 'kg', 'lr', false, false, 90, null, false, '{}', 16),
  ('rfd-ext',       'Rate of force development', 'RFD knie-extensoren (0–100 ms)', 'Snelkracht voorkant bovenbeen', 'N/s', 'lr', false, false, 90, null, false, '{}', 20),
  ('rfd-flex',      'Rate of force development', 'RFD knieflexoren (0–100 ms)', 'Snelkracht achterkant bovenbeen', 'N/s', 'lr', false, false, 90, null, false, '{}', 21),
  ('rfd-legpress',  'Rate of force development', 'RFD leg press of squat, isometrisch', 'Snelkracht duwen', 'N/s', 'lr', false, false, 90, null, false, '{}', 22),
  ('peak-legpress', 'Rate of force development', 'Peak force leg press of squat, isometrisch', 'Maximale duwkracht', 'N', 'lr', false, true, 95, null, false, '{}', 23),
  ('hop-single',    'Hoptests', 'Single hop for distance', 'Sprong vooruit op één been', 'cm', 'lr', false, false, 90, null, false, '{}', 30),
  ('hop-triple',    'Hoptests', 'Triple hop for distance', 'Drie sprongen vooruit op één been', 'cm', 'lr', false, false, 90, null, false, '{}', 31),
  ('hop-crossover', 'Hoptests', 'Crossover hop for distance', 'Kruissprongen op één been', 'cm', 'lr', false, false, 90, null, false, '{}', 32),
  ('hop-timed',     'Hoptests', '6 m timed hop', 'Snelheid hoppen over 6 meter', 's', 'lr', true, false, 90, null, false, '{}', 33),
  ('hop-vertical',  'Hoptests', 'Vertical hop', 'Sprong omhoog op één been', 'cm', 'lr', false, false, 90, null, false, '{}', 34),
  ('hop-mediaal',   'Hoptests', 'Medial hop for distance', 'Sprong opzij naar binnen', 'cm', 'lr', false, false, 90, null, false, '{}', 35),
  ('hop-lateraal',  'Hoptests', 'Lateral hop for distance', 'Sprong opzij naar buiten', 'cm', 'lr', false, false, 90, null, false, '{}', 36),
  ('hop-rotatie',   'Hoptests', 'Rotational hop', 'Draaisprong op één been', 'cm', 'lr', false, false, 90, null, false, '{}', 37),
  ('hop-side',      'Hoptests', 'Side hop test', 'Zijwaarts hoppen', 'herh.', 'lr', false, false, 90, null, false, '{}', 38),
  ('cmj-hoogte',    'Krachtplaat', 'CMJ hoogte (bilateraal)', 'Sprong omhoog op twee benen', 'cm', 'enkel', false, false, null, null, false, '{}', 40),
  ('cmj-ecc',       'Krachtplaat', 'CMJ eccentric deceleration impulse', 'Afremmen bij springen', 'Ns', 'lr', false, false, 90, null, false, '{}', 41),
  ('cmj-conc',      'Krachtplaat', 'CMJ concentric impulse', 'Afzet bij springen', 'Ns', 'lr', false, false, 90, null, false, '{}', 42),
  ('dl-landing',    'Krachtplaat', 'Double-leg land and hold, peak landing force', 'Landen op twee benen', 'N', 'lr', false, false, 85, null, false, '{}', 43),
  ('sl-vgrf',       'Krachtplaat', 'Single-leg land and hold, peak vGRF', 'Landen op één been', 'N', 'lr', false, false, 90, null, false, '{}', 44),
  ('sl-loadrate',   'Krachtplaat', 'Single-leg landing, loading rate', 'Opvangen bij landen', 'N/s', 'lr', false, false, 90, null, false, '{}', 45),
  ('sl-tts',        'Krachtplaat', 'Single-leg land and hold, time to stabilization', 'Stilstaan na landen', 's', 'lr', true, false, 85, null, false, '{}', 46),
  ('sl-dj-rsi',     'Krachtplaat', 'Single-leg drop jump, RSI', 'Veerkracht op één been', 'm/s', 'lr', false, false, 90, null, false, '{}', 47),
  ('sl-sit-stance', 'Functioneel', 'Single-leg sit-to-stance (30 bpm)', 'Opstaan op één been', 'herh.', 'lr', false, false, 90, null, false, '{}', 50),
  ('sl-bridge',     'Functioneel', 'Single-leg (hamstring) bridge', 'Bruggetje op één been', 'herh.', 'lr', false, false, 90, null, false, '{}', 51),
  ('sl-calf-raise', 'Functioneel', 'Single-leg calf raise (60 bpm)', 'Op je tenen staan op één been', 'herh.', 'lr', false, false, 90, null, false, '{}', 52),
  ('sl-squat',      'Functioneel', 'Single-leg squat', 'Kniebuiging op één been', 'herh.', 'lr', false, false, 90, null, false, '{}', 53),
  ('sls-open',      'Functioneel', 'Single-leg stand, ogen open', 'Op één been staan', 's', 'lr', false, false, 90, null, false, '{}', 54),
  ('sls-dicht',     'Functioneel', 'Single-leg stand, ogen gesloten', 'Op één been staan, ogen dicht', 's', 'lr', false, false, 90, null, false, '{}', 55),
  ('wblt',          'Mobiliteit', 'Weight-bearing lunge test (knie-tot-muur)', 'Enkel buigen (knie tot muur)', 'cm', 'lr', false, false, 100, null, false, '{}', 60),
  ('flexie',        'Mobiliteit', 'Knieflexie', 'Knie plooien', '°', 'lr', false, false, 95, null, false, '{}', 61),
  ('extensie',      'Mobiliteit', 'Knie-extensie', 'Knie strekken', '°', 'lr', false, false, null, null, false, '{}', 62),
  ('yb-anterior',   'Y-balance', 'Y-balance anterior', 'Evenwicht: reiken naar voren', 'cm', 'lr', false, false, 95, null, false, '{}', 70),
  ('yb-pm',         'Y-balance', 'Y-balance posteromediaal', 'Evenwicht: schuin achter binnen', 'cm', 'lr', false, false, 95, null, false, '{}', 71),
  ('yb-pl',         'Y-balance', 'Y-balance posterolateraal', 'Evenwicht: schuin achter buiten', 'cm', 'lr', false, false, 95, null, false, '{}', 72),
  ('yb-composite',  'Y-balance', 'Y-balance composietscore', 'Evenwicht: totaalscore', '%', 'lr', false, false, 95, null, false, '{}', 73),
  ('ikdc',          'Vragenlijsten', 'IKDC subjective', 'Vragenlijst knie (IKDC)', '/100', 'enkel', false, false, null, 80, false, '{}', 80),
  ('koos',          'Vragenlijsten', 'KOOS (sport/recreatie)', 'Vragenlijst knie (KOOS)', '/100', 'enkel', false, false, null, null, false, '{}', 81),
  ('acl-rsi',       'Vragenlijsten', 'ACL-RSI', 'Vertrouwen in je knie (ACL-RSI)', '/100', 'enkel', false, false, null, 65, false, '{}', 82),
  ('cait',          'Vragenlijsten', 'CAIT', 'Vragenlijst enkel (CAIT)', '/30', 'enkel', false, false, null, 25, false, '{}', 83),
  ('faam-sport',    'Vragenlijsten', 'FAAM sport', 'Vragenlijst enkel bij sporten (FAAM)', '%', 'enkel', false, false, null, null, false, '{}', 84),
  ('stroke',        'Klinisch', 'Zwelling (stroke test)', 'Zwelling', 'graad', 'keuze', false, false, null, null, true, '{"0","spoor","1+","2+","3+"}', 90),
  ('nprs',          'Klinisch', 'Pijn (NPRS)', 'Pijn', '/10', 'enkel', false, false, null, null, true, '{}', 91)
on conflict (id) do nothing;

-- ---------- Criteria koppelen aan tests (enkel waar nog niets gekoppeld is) ----------

update public.protocol_criteria c set test_id = m.test_id
from (values
  ('Quadricepskracht%', 'quad-iso-60'), ('Hamstringkracht%', 'ham-iso-90'), ('Heupextensoren%', 'heup-ext'),
  ('10 RM leg press%', 'legpress-10rm'), ('Hoptestbatterij%', 'hop-single'), ('Hoptesting voorwaarts%', 'hop-single'),
  ('Verticale sprong%', 'hop-vertical'), ('Multidirectionele hoptesting%', 'hop-mediaal'),
  ('Reactieve%', 'sl-dj-rsi'), ('Eenbenige landingscontrole%', 'sl-tts'), ('Landingskinetiek%', 'sl-vgrf'),
  ('Landingskwaliteit bilateraal%', 'dl-landing'), ('Excentrische capaciteit%', 'cmj-ecc'), ('Sprongstrategie%', 'cmj-conc'),
  ('Rate of force development knie%', 'rfd-ext'), ('Rate of force development leg press%', 'rfd-legpress'),
  ('Kuitcapaciteit%', 'sl-calf-raise'), ('Single-leg calf raise%', 'sl-calf-raise'), ('Soleuskracht%', 'soleus'),
  ('Single-leg squat%', 'sl-squat'), ('Single-leg bridge%', 'sl-bridge'),
  ('Knieflexie%', 'flexie'), ('Flexie-ROM%', 'flexie'), ('Volledige actieve knie-extensie%', 'extensie'),
  ('Volledige extensie%', 'extensie'), ('Extensie symmetrisch%', 'extensie'), ('Volledige knie-extensie%', 'extensie'),
  ('Enkeldorsiflexie%', 'wblt'), ('Star excursion%', 'yb-composite'), ('IKDC%', 'ikdc'),
  ('Psychologische gereedheid%', 'acl-rsi'), ('PROMs%', 'koos'), ('Effusie%', 'stroke'), ('Pijn%', 'nprs'),
  ('Weight-bearing lunge%', 'wblt'), ('Y-balance%', 'yb-anterior'), ('Hoptests%', 'hop-single'),
  ('Single-leg stand%ogen open%', 'sls-open'), ('Single-leg stand%ogen gesloten%', 'sls-dicht'),
  ('Single-leg calf raises%', 'sl-calf-raise'), ('Vragenlijst: CAIT%', 'cait')
) as m(patroon, test_id)
where c.test_id is null and c.criterium ilike m.patroon;

-- ---------- Wat de patiënt mag lezen ----------
-- Per actief traject waarvan de huidige fase "testresultaten" zichtbaar heeft: de gemeten tests in patiënttaal.
-- Geen notities. De zijde (L/R) zit erbij zodat de app de LSI kan berekenen.

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
