-- Praktijkfiches: een patiëntaccount krijgt altijd de rol 'patient'.
-- Plak dit in Supabase → SQL Editor → New query → Run. Je mag het meermaals uitvoeren.
--
-- Waarom: Supabase voegt de app_metadata (met rol 'patient') pas toe NA het aanmaken van het account.
-- Het profiel wordt bij het aanmaken gemaakt en kreeg daardoor geen rol ("Nog geen toegang").
-- Oplossing: zodra er een rij in 'patienten' bijkomt, krijgt het profiel de rol 'patient',
-- maar enkel als het nog geen rol had (een collega wordt zo nooit per ongeluk patiënt).

create or replace function public.markeer_patient()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profielen set rol = 'patient' where id = new.id and rol is null;
  return new;
end;
$$;

drop trigger if exists patient_rol on public.patienten;
create trigger patient_rol
  after insert on public.patienten
  for each row execute function public.markeer_patient();

-- Bestaande patiënten zonder rol herstellen
update public.profielen set rol = 'patient'
where rol is null and id in (select id from public.patienten);

-- Ter controle: alle patiënten met hun rol
select p.code, pr.rol from public.patienten p join public.profielen pr on pr.id = p.id order by p.aangemaakt;
