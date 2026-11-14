-- Praktijkfiches, fase 1: gedeelde fiches voor het team.
-- Plak dit in Supabase → SQL Editor → New query → Run. Je mag het meermaals uitvoeren.
--
-- Rollen (profielen.rol):
--   null        = nog geen toegang (nieuw account, wacht op de beheerder)
--   therapeut   = fiches bekijken en beheren
--   beheerder   = therapeut + rollen van andere accounts beheren
--   patient     = (fase 3) enkel het eigen programma

-- ---------- Profielen ----------

create table if not exists public.profielen (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  naam text,
  rol text check (rol in ('therapeut', 'beheerder', 'patient')),
  aangemaakt timestamptz not null default now()
);

-- Rol van de aangemelde gebruiker. "security definer" zodat de RLS van profielen
-- zelf niet in een kringloop raakt.
create or replace function public.mijn_rol()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select rol from public.profielen where id = auth.uid()
$$;

create or replace function public.is_team()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.mijn_rol() in ('therapeut', 'beheerder'), false)
$$;

-- Bij elk nieuw account automatisch een profiel, ZONDER rol.
-- De rol komt enkel uit app_metadata (die kan alleen de server zetten, nooit de gebruiker zelf).
create or replace function public.nieuw_profiel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profielen (id, email, naam, rol)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'naam', split_part(new.email, '@', 1)),
    case when new.raw_app_meta_data ->> 'rol' in ('therapeut', 'beheerder', 'patient')
         then new.raw_app_meta_data ->> 'rol' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists bij_nieuwe_gebruiker on auth.users;
create trigger bij_nieuwe_gebruiker
  after insert on auth.users
  for each row execute function public.nieuw_profiel();

-- Profielen voor accounts die al bestonden vóór deze migratie
insert into public.profielen (id, email, naam)
select id, email, split_part(email, '@', 1) from auth.users
on conflict (id) do nothing;

alter table public.profielen enable row level security;

drop policy if exists "profiel: eigen of beheerder leest" on public.profielen;
create policy "profiel: eigen of beheerder leest" on public.profielen
  for select to authenticated
  using (id = auth.uid() or public.mijn_rol() = 'beheerder');

drop policy if exists "profiel: beheerder wijzigt" on public.profielen;
create policy "profiel: beheerder wijzigt" on public.profielen
  for update to authenticated
  using (public.mijn_rol() = 'beheerder')
  with check (public.mijn_rol() = 'beheerder');

-- Een beheerder kan zichzelf niet degraderen (zo blijft er altijd minstens één beheerder).
create or replace function public.bewaak_beheerder()
returns trigger
language plpgsql
as $$
begin
  if old.id = auth.uid() and old.rol = 'beheerder' and new.rol is distinct from 'beheerder' then
    raise exception 'Je kan je eigen beheerdersrol niet afnemen.';
  end if;
  return new;
end;
$$;

drop trigger if exists bewaak_beheerder on public.profielen;
create trigger bewaak_beheerder
  before update on public.profielen
  for each row execute function public.bewaak_beheerder();

-- ---------- Structuur en fiches ----------

-- Eén boom: niveau 0 = onderdeel, 1 = regio, 2 = categorie
create table if not exists public.knopen (
  id uuid primary key default gen_random_uuid(),
  ouder_id uuid references public.knopen (id) on delete cascade,
  niveau smallint not null check (niveau between 0 and 2),
  titel text not null check (length(trim(titel)) > 0),
  omschrijving text not null default '',
  volgorde integer not null default 0,
  bijgewerkt timestamptz not null default now(),
  check ((niveau = 0) = (ouder_id is null))
);
create index if not exists knopen_ouder on public.knopen (ouder_id);

create table if not exists public.fiches (
  id uuid primary key default gen_random_uuid(),
  categorie_id uuid not null references public.knopen (id) on delete cascade,
  titel text not null check (length(trim(titel)) > 0),
  omschrijving text not null default '',
  soort text not null check (soort in ('pdf', 'afbeelding', 'video', 'tekst')),
  bestand_pad text,          -- pad in de opslag-bucket "fiches" (niet voor tekstfiches)
  mime text,
  bestandsnaam text,
  grootte bigint,
  tekst text,                -- enkel voor tekstfiches
  volgorde integer not null default 0,
  bijgewerkt timestamptz not null default now(),
  check ((soort = 'tekst') = (bestand_pad is null))
);
create index if not exists fiches_categorie on public.fiches (categorie_id);

-- Een fiche hoort altijd in een categorie (niveau 2); een knoop zit altijd één niveau onder zijn ouder.
create or replace function public.controleer_niveau()
returns trigger
language plpgsql
as $$
declare
  n smallint;
begin
  if tg_table_name = 'fiches' then
    select niveau into n from public.knopen where id = new.categorie_id;
    if n is distinct from 2 then raise exception 'Een fiche moet in een categorie staan.'; end if;
  elsif new.ouder_id is not null then
    select niveau into n from public.knopen where id = new.ouder_id;
    if n is distinct from new.niveau - 1 then raise exception 'Verkeerd niveau voor deze knoop.'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists controleer_niveau on public.knopen;
create trigger controleer_niveau before insert or update on public.knopen
  for each row execute function public.controleer_niveau();
drop trigger if exists controleer_niveau on public.fiches;
create trigger controleer_niveau before insert or update on public.fiches
  for each row execute function public.controleer_niveau();

-- "bijgewerkt" altijd door de databank laten zetten
create or replace function public.zet_bijgewerkt()
returns trigger
language plpgsql
as $$
begin
  new.bijgewerkt := now();
  return new;
end;
$$;

drop trigger if exists zet_bijgewerkt on public.knopen;
create trigger zet_bijgewerkt before insert or update on public.knopen
  for each row execute function public.zet_bijgewerkt();
drop trigger if exists zet_bijgewerkt on public.fiches;
create trigger zet_bijgewerkt before insert or update on public.fiches
  for each row execute function public.zet_bijgewerkt();

alter table public.knopen enable row level security;
alter table public.fiches enable row level security;

drop policy if exists "knopen: team" on public.knopen;
create policy "knopen: team" on public.knopen
  for all to authenticated
  using (public.is_team()) with check (public.is_team());

drop policy if exists "fiches: team" on public.fiches;
create policy "fiches: team" on public.fiches
  for all to authenticated
  using (public.is_team()) with check (public.is_team());

-- ---------- Favorieten (fase 2, tabel nu al klaar) ----------

create table if not exists public.favorieten (
  profiel_id uuid not null references public.profielen (id) on delete cascade,
  fiche_id uuid not null references public.fiches (id) on delete cascade,
  aangemaakt timestamptz not null default now(),
  primary key (profiel_id, fiche_id)
);
alter table public.favorieten enable row level security;
drop policy if exists "favorieten: eigen" on public.favorieten;
create policy "favorieten: eigen" on public.favorieten
  for all to authenticated
  using (profiel_id = auth.uid() and public.is_team())
  with check (profiel_id = auth.uid() and public.is_team());

-- ---------- Opslag: privé-bucket voor de bestanden ----------

insert into storage.buckets (id, name, public)
values ('fiches', 'fiches', false)
on conflict (id) do update set public = false;

drop policy if exists "fiches-bucket: team leest" on storage.objects;
create policy "fiches-bucket: team leest" on storage.objects
  for select to authenticated
  using (bucket_id = 'fiches' and public.is_team());

drop policy if exists "fiches-bucket: team schrijft" on storage.objects;
create policy "fiches-bucket: team schrijft" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fiches' and public.is_team());

drop policy if exists "fiches-bucket: team wijzigt" on storage.objects;
create policy "fiches-bucket: team wijzigt" on storage.objects
  for update to authenticated
  using (bucket_id = 'fiches' and public.is_team());

drop policy if exists "fiches-bucket: team wist" on storage.objects;
create policy "fiches-bucket: team wist" on storage.objects
  for delete to authenticated
  using (bucket_id = 'fiches' and public.is_team());
