// Edge Function "patient-account": patiëntaccounts aanmaken, een nieuwe toegangscode geven of verwijderen.
// Draait in Supabase (niet in de app), omdat hiervoor de service-role-sleutel nodig is.
// Die sleutel staat automatisch in Supabase (SUPABASE_SERVICE_ROLE_KEY) en komt nooit in de app.
//
// Enkel een aangemelde therapeut of beheerder mag deze functie gebruiken (controle via is_team()).
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
    const alsGebruiker = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      auth: { persistSession: false }
    });

    // Wie vraagt dit? Enkel het team mag verder.
    const { data: team, error: rolFout } = await alsGebruiker.rpc('is_team');
    if (rolFout || team !== true) return antwoord({ fout: 'Je hebt hiervoor geen toestemming.' }, 403);
    const { data: wie } = await alsGebruiker.auth.getUser();

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
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
          return antwoord({ fout: error.message }, 400);
        }
        const { error: rijFout } = await admin.from('patienten').insert({
          id: data.user.id, code, naam: schoneNaam, aangemaakt_door: wie?.user?.id ?? null
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
