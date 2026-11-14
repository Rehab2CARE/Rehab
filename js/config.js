// Koppeling met Supabase (gedeelde fiches voor het team).
// Vul in uit Supabase → Project Settings → API (zie README, "Supabase instellen").
// Leeg laten = de app werkt zoals vroeger: alles enkel lokaal op dit toestel.
//
// De "anon"/"publishable" sleutel mag publiek in de app staan: de beveiliging zit in de databank (RLS).
// Zet hier NOOIT de "service_role"/"secret" sleutel.
export const SUPABASE = {
  URL: 'https://ozryhokmgushmlonnbdk.supabase.co',
  ANON_KEY: 'sb_publishable_J19653Q7pxExBRhT0334bA_YdhCUUEE'
};
