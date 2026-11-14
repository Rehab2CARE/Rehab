-- Standaardindeling: onderdelen, regio's en categorieën.
-- Doet enkel iets als er nog geen enkele knoop bestaat (veilig om opnieuw uit te voeren).

do $$
declare
  sectie record;
  regio text;
  cat text;
  s_id uuid;
  r_id uuid;
  si int := 0;
  ri int;
  ci int;
  regios text[] := array['Lage rug', 'Heup', 'Knie', 'Enkel'];
  cats text[];
begin
  if exists (select 1 from public.knopen) then
    raise notice 'Er staan al knopen in de databank: niets gedaan.';
    return;
  end if;

  for sectie in
    select * from (values
      ('Oefenfiches', 'Oefeningen voor thuis'),
      ('Informatiefiches', 'Uitleg over je klacht'),
      ('Revalidatieprotocols', 'Stappenplan van je revalidatie')
    ) as t(titel, omschrijving)
  loop
    insert into public.knopen (niveau, titel, omschrijving, volgorde)
    values (0, sectie.titel, sectie.omschrijving, si) returning id into s_id;
    si := si + 1;

    ri := 0;
    foreach regio in array
      case when sectie.titel = 'Informatiefiches' then regios || 'Algemeen'::text else regios end
    loop
      insert into public.knopen (ouder_id, niveau, titel, volgorde)
      values (s_id, 1, regio, ri) returning id into r_id;
      ri := ri + 1;

      cats := case sectie.titel
        when 'Oefenfiches' then array['Mobiliteit', 'Kracht', 'Balans & proprioceptie', 'Plyometrie & loopopbouw']
        when 'Informatiefiches' then array['Wat is er aan de hand', 'Pijn begrijpen', 'Wat mag ik (wel) doen', 'Na een operatie', 'Terug naar sport of werk']
        else case regio
          when 'Lage rug' then array['Lage rugpijn']
          when 'Heup' then array['Totale heupprothese']
          when 'Knie' then array['VKB-reconstructie', 'Meniscus', 'Totale knieprothese']
          when 'Enkel' then array['Enkelverstuiking', 'Achillespees']
          else array['Algemeen']
        end
      end;

      ci := 0;
      foreach cat in array cats loop
        insert into public.knopen (ouder_id, niveau, titel, volgorde) values (r_id, 2, cat, ci);
        ci := ci + 1;
      end loop;
    end loop;
  end loop;
end;
$$;
