-- Praktijkfiches: een protocol hoort bij een categorie in de map Revalidatieprotocols.
-- Plak dit in Supabase → SQL Editor → New query → Run (na 010). Je mag het meermaals uitvoeren.
--
-- Bv. Revalidatieprotocols › Knie › VKB-reconstructie  =  het VKB-protocol dat je patiënten volgen.
-- Wordt de categorie gewist, dan blijft het protocol bestaan (patiënten volgen het nog), maar zonder map.

alter table public.protocollen add column if not exists knoop_id uuid references public.knopen (id) on delete set null;
create unique index if not exists protocollen_knoop on public.protocollen (knoop_id) where knoop_id is not null;

-- De bestaande protocollen koppelen aan hun categorie (enkel als die zo heet en nog niets gekoppeld is)
update public.protocollen p
set knoop_id = k.id
from public.knopen k
join public.knopen r on r.id = k.ouder_id
join public.knopen o on o.id = r.ouder_id
where p.knoop_id is null
  and o.titel ilike 'Revalidatieprotocol%'
  and (
    (p.id = 'vkb' and r.titel ilike 'Knie' and k.titel ilike 'VKB%')
    or (p.id = 'enkel' and r.titel ilike 'Enkel' and k.titel ilike 'Enkelverstuiking%')
  );

-- Ter controle: welk protocol hangt aan welke categorie
select p.id, p.naam, o.titel as onderdeel, r.titel as regio, k.titel as categorie
from public.protocollen p
left join public.knopen k on k.id = p.knoop_id
left join public.knopen r on r.id = k.ouder_id
left join public.knopen o on o.id = r.ouder_id
order by p.volgorde;
