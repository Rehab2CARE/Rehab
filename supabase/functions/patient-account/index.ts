// Edge Function "patient-account": patiëntaccounts aanmaken, een nieuwe toegangscode geven of verwijderen.
// Draait in Supabase (niet in de app), omdat hiervoor de service-role-sleutel nodig is.
// Die sleutel staat automatisch in Supabase (SUPABASE_SERVICE_ROLE_KEY) en komt nooit in de app.
//
// Enkel een aangemelde therapeut of beheerder mag deze functie gebruiken (sessie nagekeken door Supabase Auth,
// rol uit de tabel profielen). "Verify JWT" mag daarom uit staan.
// Een patiënt meldt zich aan met zijn code (bv. PT-7K3M9Q) en een wachtwoord. Er wordt geen mail verstuurd:
// het e-mailadres achter de code is een intern adres dat nooit gebruikt wordt om te mailen.
//
// Acties (POST, JSON):
//   { actie: 'maak', naam }        → { id, code, wachtwoord }
//   { actie: 'nieuwe-code', id }   → { code, wachtwoord }   (nieuw wachtwoord; het oude werkt niet meer)
//   { actie: 'verwijder', id }     → { ok: true }           (account + programma's weg)

import { createClient } from 'npm:@supabase/supabase-js@2.119.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

// Moet gelijk zijn aan PATIENT_DOMEIN in js/config.js
const DOMEIN = Deno.env.get('PATIENT_DOMEIN') ?? 'patienten.praktijkfiches.invalid';

// Zonder tekens die op elkaar lijken (0/O, 1/I/L)
const ALFABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function willekeurig(n: number) {
  const uit: string[] = [];
  while (uit.length < n) {
    for (const b of crypto.getRandomValues(new Uint8Array(n * 2))) {
      if (b < 248 && uit.length < n) uit.push(ALFABET[b % ALFABET.length]); // 248 = 8 × 31: geen voorkeur voor tekens
    }
  }
  return uit.join('');
}

const antwoord = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return antwoord({ fout: 'Enkel POST.' }, 405);

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const geheim = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!geheim) {
      console.error('SUPABASE_SERVICE_ROLE_KEY ontbreekt in de omgeving van de functie');
      return antwoord({ fout: 'De functie mist haar geheime sleutel in Supabase (SUPABASE_SERVICE_ROLE_KEY).' }, 500);
    }
    const admin = createClient(url, geheim, { auth: { persistSession: false, autoRefreshToken: false } });

    // Wie vraagt dit? De sessie (JWT) van de app laten nakijken door Supabase Auth zelf.
    // Dat werkt met de oude én de nieuwe aanmeldsleutels, ook als "Verify JWT" uit staat.
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: gebruiker, error: sessieFout } = await admin.auth.getUser(token);
    if (sessieFout || !gebruiker?.user) {
      console.error('Sessie niet geldig:', sessieFout?.message);
      return antwoord({ fout: 'Je bent niet (meer) aangemeld. Meld je opnieuw aan en probeer nog eens.' }, 401);
    }
    const wie = gebruiker.user;

    // Enkel therapeuten en beheerders mogen verder.
    const { data: profiel, error: profielFout } = await admin.from('profielen').select('rol').eq('id', wie.id).maybeSingle();
    if (profielFout) {
      console.error('Profiel lezen mislukt:', profielFout.message);
      return antwoord({ fout: 'Je rol kon niet nagekeken worden: ' + profielFout.message }, 500);
    }
    if (!['therapeut', 'beheerder'].includes(profiel?.rol)) {
      console.error('Geen team-rol voor', wie.id, 'rol =', profiel?.rol);
      return antwoord({ fout: 'Je account heeft niet de rol therapeut of beheerder.' }, 403);
    }

    const { actie, naam = '', id } = await req.json();

    if (actie === 'maak') {
      const schoneNaam = String(naam).trim().slice(0, 60);
      for (let poging = 0; poging < 5; poging++) {
        const code = 'PT-' + willekeurig(6);
        const wachtwoord = willekeurig(10);
        const { data, error } = await admin.auth.admin.createUser({
          email: `${code.toLowerCase()}@${DOMEIN}`,
          password: wachtwoord,
          email_confirm: true,
          app_metadata: { rol: 'patient' },
          user_metadata: { naam: schoneNaam || code }
        });
        if (error) {
          if (/already|exists|registered/i.test(error.message)) continue; // code bestond toevallig al
          console.error('Account aanmaken mislukt:', error.message);
          return antwoord({ fout: 'Account aanmaken mislukt: ' + error.message }, 400);
        }
        const { error: rijFout } = await admin.from('patienten').insert({
          id: data.user.id, code, naam: schoneNaam, aangemaakt_door: wie.id
        });
        if (rijFout) {
          await admin.auth.admin.deleteUser(data.user.id);
          return antwoord({ fout: rijFout.message }, 400);
        }
        return antwoord({ id: data.user.id, code, wachtwoord });
      }
      return antwoord({ fout: 'Kon geen unieke code maken. Probeer opnieuw.' }, 500);
    }

    if (actie === 'nieuwe-code' || actie === 'verwijder') {
      // Enkel accounts die in de tabel patienten staan: zo kan je via deze functie nooit een collega wijzigen.
      const { data: p } = await admin.from('patienten').select('id, code').eq('id', id).maybeSingle();
      if (!p) return antwoord({ fout: 'Patiënt niet gevonden.' }, 404);

      if (actie === 'verwijder') {
        const { error } = await admin.auth.admin.deleteUser(p.id); // programma's verdwijnen mee (cascade)
        if (error) return antwoord({ fout: error.message }, 400);
        return antwoord({ ok: true });
      }

      const wachtwoord = willekeurig(10);
      const { error } = await admin.auth.admin.updateUserById(p.id, { password: wachtwoord });
      if (error) return antwoord({ fout: error.message }, 400);
      return antwoord({ code: p.code, wachtwoord });
    }

    return antwoord({ fout: 'Onbekende actie.' }, 400);
  } catch (e) {
    return antwoord({ fout: String((e as Error)?.message ?? e) }, 500);
  }
});
