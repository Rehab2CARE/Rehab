# Praktijkfiches

Eenvoudige web-app (PWA) om in de praktijk fiches aan patiënten te tonen op de iPad.
Werkt offline en kan op het beginscherm gezet worden.

Twee modi:
- **Lokaal** (als `js/config.js` leeg is): alles staat enkel op dit toestel, zoals vroeger.
- **Gedeeld** (met Supabase): elke collega meldt zich aan met een eigen account en het team deelt één verzameling fiches.
  Elk toestel houdt een offline kopie bij, dus tonen en doorsturen werkt ook zonder internet. Wijzigen kan enkel online.

## Gedeelde fiches instellen (Supabase, eenmalig)

1. Maak een account op https://supabase.com en kies **New project**. Naam: praktijkfiches.
   Kies een sterk databankwachtwoord (bewaar het). **Region: Frankfurt (eu-central-1)**.
2. **SQL Editor → New query**: plak de inhoud van `supabase/migraties/001_basis.sql` en klik **Run**.
   Doe daarna hetzelfde met `supabase/migraties/002_standaardstructuur.sql` (de standaardindeling).
3. **Authentication → Sign In / Providers**: zet **Allow new users to sign up** uit. Zo kan enkel wie uitgenodigd is binnen.
4. **Authentication → URL Configuration**: zet *Site URL* op `https://rehab2care.github.io/praktijkfiches/`
   en voeg die ook toe bij *Redirect URLs* (plus `http://localhost:8765/` om lokaal te testen).
5. **Authentication → Users → Invite user**: nodig jezelf uit. Open de mail en kies een wachtwoord.
6. Maak jezelf beheerder: **SQL Editor**, vervang het e-mailadres en klik **Run**:
   ```sql
   update public.profielen set rol = 'beheerder' where email = 'jouw@adres.be';
   ```
7. **Project Settings → API**: kopieer de *Project URL* en de *anon / publishable key* naar `js/config.js`.
   Zet daar **nooit** de *service_role / secret* sleutel.
8. Verhoog `CACHE_VERSIE` in `sw.js` en zet de bestanden op GitHub. Open de app en meld je aan.
9. Stonden er al fiches op de iPad? **Beheer → Instellingen → Fiches van dit toestel kopiëren.**

### Collega's toevoegen
- Supabase → **Authentication → Users → Invite user** met het e-mailadres van de collega.
- De collega klikt op de link in de mail, kiest een wachtwoord en komt in de app op "Nog geen toegang".
- Jij (beheerder) gaat naar **Beheer → Instellingen → Gebruikers** en kiest bij die collega **Therapeut**.
- Iemand weghalen: zet de rol op **Geen toegang** (of verwijder het account in Supabase).

### Rollen
| Rol | Mag |
|---|---|
| Geen toegang | niets (nieuw account, wacht op de beheerder) |
| Therapeut | alle fiches bekijken, doorsturen en beheren |
| Beheerder | therapeut + rollen van anderen aanpassen |

De beveiliging zit in de databank zelf (Row Level Security): wie geen rol heeft, krijgt ook via een
andere weg geen fiches te zien. De bestanden staan in een privé-opslag (bucket `fiches`).

### Goed om te weten
- Het **gratis plan** van Supabase volstaat om te starten (1 GB bestanden). Een gratis project pauzeert na
  een week zonder gebruik; de fiches op de iPads blijven dan wel zichtbaar.
- Zodra er later (fase 3) **patiëntgegevens** in komen: overschakelen naar het betaalde plan (back-ups) en het
  privacy-luik afwerken (zie het plan).

## Patiënten en oefenprogramma's (fase 3)

> **Testfase.** Gebruik voorlopig enkel verzonnen testpatiënten. Voor echte patiënten: eerst beslissen over
> het betaalde Supabase-plan (back-ups) en kort GDPR-advies vragen.

### Eenmalig instellen in Supabase
1. **SQL Editor → New query**: plak `supabase/migraties/003_patienten_programmas.sql` en klik **Run**.
2. **Edge Functions → Deploy a new function → Via Editor**. Naam: `patient-account` (precies zo).
   Plak de inhoud van `supabase/functions/patient-account/index.ts` en klik **Deploy**.
   Laat **Verify JWT** aan staan. De geheime sleutel staat automatisch in Supabase; die hoef je nergens in te vullen.

### Werken met patiënten
- Zet **Beheer** aan. Op het startscherm verschijnt de tegel **Patiënten** (patiëntgegevens zijn enkel in Beheer te zien,
  dus achter de pincode).
- **Patiënt toevoegen**: optioneel een voornaam of initialen. De app maakt een **patiëntcode** (bv. `PT-7K3M9Q`) en een
  **wachtwoord**, met een QR-code. Druk het kaartje af of noteer het: het wachtwoord is later niet meer te zien.
  Kwijt? **Nieuwe toegangscode** maakt een nieuw wachtwoord.
- **Programma maken**: tik in het programma op **+ Toevoegen**. Je komt op de startpagina en onderaan verschijnt een balk
  "Fiches kiezen voor …". Kies fiches met het ronde knopje **+** (in de mappen of via Zoeken) en tik **Toevoegen**:
  ze komen in het programma en je bent terug bij de patiënt. Een fiche die er al in staat, wordt niet dubbel toegevoegd.
  Vul per oefening sets, herhalingen, hoe vaak en een notitie in (wordt meteen bewaard).
- **Stopzetten** verbergt het programma voor de patiënt. **Patiënt verwijderen** wist het account en alle programma's.

### De patiënt
- Scant de QR-code met zijn gsm (of typt de code en het wachtwoord in) en ziet **Mijn programma**:
  per oefening de dosering, de notitie en de fiche. Na de eerste keer werkt het ook zonder internet.
- Een patiënt ziet **enkel** de fiches in zijn eigen actieve programma's. Dat wordt afgedwongen in de databank (RLS).
- Er worden geen mails naar patiënten gestuurd. Achter de code zit een intern adres (`…@patienten.praktijkfiches.invalid`).

## Protocollen (opvolging, stap 1)

Overzicht van de revalidatieprotocollen (VKB, enkelverstuiking) met hun fasen en criteria. Enkel voor het team, in **Beheer**.

### Eenmalig instellen in Supabase
1. **SQL Editor**: plak `supabase/migraties/004_protocollen.sql` en klik **Run** (de structuur).
2. **SQL Editor**: plak `local/protocollen/seed-protocollen.sql` en klik **Run** (de inhoud).
   Dit bestand staat bewust **niet** in de openbare repo: het is gemaakt uit je eigen werkboek met
   `python3 -I local/protocollen/bouw-seed.py`. Een protocol dat al bestaat, wordt overgeslagen.

### Werken met protocollen
- Tegel **Protocollen** → kies een protocol → kies een fase.
- **Zichtbaar voor de patiënt**: vinkjes voor oefeningen, doel en uitleg, criteria en voortgang, testresultaten.
  Dit is de standaard voor de fase; per patiënt aanpassen komt in stap 2.
- **Wat de patiënt leest**: titel en doel in patiënttaal. **Wijzigen** of **Goedkeuren**.
- **Standaardoefeningen**: **+ Toevoegen** werkt zoals bij een programma (kiesbalk onderaan). Vul de dosering in.
- **Criteria**: drempel, evidentieniveau, bron, wat je doet bij niet halen, en de patiënttekst.
  Teksten met het label **concept** zijn voorstellen: lees ze na en keur ze goed (één per één of allemaal samen).

## Opbouw

**Onderdeel → Regio → Categorie → Fiches**

- Onderdelen: Oefenfiches, Informatiefiches, Revalidatieprotocols
- Regio's: Lage rug, Heup, Knie, Enkel
- Categorieën: zelf aan te maken per regio
- Fiches: PDF, foto/afbeelding, video, of een tekst die je in de app schrijft

Daarnaast is er een vast onderdeel **Games** met spelletjes (concentratie, reactie, geheugen).

## Games

De spellen staan niet in Beheer, want het zijn kleine programma's en geen fiches.

- De lijst met spellen staat in `data/games.json` (titel, korte uitleg, bestand).
- Een spel zonder bestand (`"bestand": null`) verschijnt als **Binnenkort**.
- De spelbestanden zelf komen in de map `games/`.
- Een nieuw spel ook toevoegen aan de lijst in `sw.js`, zodat het zonder internet werkt.
- Een spel opent schermvullend onder de bovenbalk. Met **Terug** ga je terug naar de lijst.

## Aanpassen in de app (zonder code)

Tik rechtsboven op **Beheer**. Dan kan je:

- onderdelen, regio's en categorieën toevoegen, hernoemen, verschuiven (◀ ▶) en wissen;
- in een categorie bestanden toevoegen (meerdere tegelijk) of een tekstfiche schrijven;
- fiches hernoemen, een korte omschrijving geven, verschuiven en wissen;
- via **Instellingen** een back-up maken en terugzetten.

Tik opnieuw op **Beheer** om terug naar de patiëntweergave te gaan (enkel bekijken).

## Zoeken, favorieten en laatst bekeken

- **Zoeken:** het zoekvak bovenaan het startscherm zoekt in de titel, de omschrijving, de map en de tekst van tekstfiches.
  Hoofdletters en accenten maken niet uit ("een" vindt ook "één").
- **Favorieten:** tik op **☆ Favoriet** in een geopende fiche. Je favorieten staan onderaan het startscherm.
  In de gedeelde modus heeft elke collega zijn eigen favorieten, op al zijn toestellen.
- **Laatst bekeken:** de laatste 8 geopende fiches, onderaan het startscherm. Dit geldt per toestel.

## Fiches verplaatsen en video

- **Verplaatsen:** in **Beheer** staat onder elke fiche **Naar…**. Kies de nieuwe categorie.
- **Video:** voeg een filmpje (mp4 of mov) toe via **Bestanden toevoegen**. Het speelt af in de app.
  In de gedeelde modus mag een bestand hoogstens 50 MB zijn (limiet van het gratis plan). Elk toestel bewaart
  een kopie, dus veel grote video's nemen plaats in op de iPad en in de gratis opslag van 1 GB.

## Fiches doorsturen naar een patiënt

- Tik op het ronde knopje **+** op een fiche (of **Kiezen om te verzenden** in een geopende fiche). Het wordt een **✓**.
- Kies zo meerdere fiches, ook uit verschillende onderdelen en categorieën.
- Rechtsonder verschijnt **Verzenden** met het aantal. Tik erop, controleer de lijst en tik **Verzenden**.
- Het deelvenster van de iPad opent: kies Mail, WhatsApp, Berichten of AirDrop.
- PDF's en foto's gaan mee zoals ze zijn. Een tekstfiche wordt automatisch een PDF.
- Na het verzenden is de selectie weer leeg.
- Er gaat niets via een server: de bestanden gaan rechtstreeks van de iPad naar de gekozen app.

## Pincode op Beheer

Zet in **Instellingen → Pincode voor Beheer** een code van 4 tot 8 cijfers.

- Beheer vraagt dan eerst de pincode.
- Beheer gaat vanzelf dicht na 5 minuten zonder aanraken, of als je de app verlaat.
- De app start altijd in de patiëntweergave.
- De code zelf wordt niet bewaard, enkel een versleutelde vorm (hash). Ze zit niet in de back-up.
- Het is een kinderslot, geen echte beveiliging: de fiches zelf zijn voor iedereen zichtbaar.

**Pincode vergeten?** Er is geen achterdeur.
- App op het beginscherm: verwijder het icoon van het beginscherm (dat wist de gegevens van die app) en zet de app opnieuw op het beginscherm.
- In Safari zelf: wis de websitegegevens (Instellingen → Apps → Safari → Geavanceerd → Websitegegevens).

In de gedeelde modus haal je daarna alles opnieuw op door je aan te melden. In de lokale modus zet je je laatste back-up terug.
Let op: de app op het beginscherm en dezelfde website in Safari hebben **elk hun eigen opslag**.

## Aanpassen in de bestanden

| Wat | Waar |
|---|---|
| Standaardstructuur bij de eerste start (onderdelen, regio's, standaardcategorie) | `data/structuur.json` |
| Kleuren, lettergrootte, knopgrootte | bovenaan `css/style.css` (`:root`) |
| Lijst met spellen | `data/games.json` |
| Werking van de schermen | `js/app.js` |
| Fiches kiezen en doorsturen, tekst naar PDF | `js/delen.js` |
| Pincode: aantal cijfers, minuten tot Beheer vanzelf dichtgaat | bovenaan het pincodeblok in `js/app.js` (`PIN_MIN`, `PIN_MAX`, `AUTO_SLOT_MIN`) |
| Opslag op het toestel | `js/db.js` |
| Koppeling met Supabase (adres en sleutel) | `js/config.js` |
| Alle contact met Supabase | `js/bron.js` |
| Gedeelde fiches ophalen (offline kopie) | `js/sync.js` |
| Databank: tabellen, rollen en beveiliging | `supabase/migraties/` |

`data/structuur.json` wordt enkel gebruikt bij de allereerste start of na **Instellingen → Alles wissen**.
Wat je daarna in Beheer verandert, staat op het toestel zelf.

Na een wijziging aan een app-bestand: verhoog `CACHE_VERSIE` in `sw.js`, anders blijft de iPad de oude versie tonen.

## Belangrijk

- **Back-up (lokale modus):** de fiches staan enkel op de iPad. Maak regelmatig een back-up (Instellingen) en bewaar die in Bestanden of iCloud.
- **Zet de app op het beginscherm** (Safari → Deel → Zet op beginscherm). Safari kan anders na een tijd ongebruikte websitegegevens wissen.
- Geen patiëntgegevens: de app bevat enkel algemene fiches.

## Lokaal testen op de Mac

```bash
python3 -m http.server 8765
```

Open daarna http://localhost:8765

### Automatische tests

```bash
pip install playwright && python3 -m playwright install chromium   # eenmalig
python3 -m http.server 8765 &
python3 test/test_app.py         # hele app: lokale en gedeelde modus (met nagebootste server)
python3 test/test_bron_echt.py   # echte Supabase-bibliotheek tegen nagebootste server
```

De databankregels (rollen en RLS) testen kan in een lokale Postgres: `supabase/test/stub_supabase.sql`,
daarna de migraties, daarna `supabase/test/test_rls.sql`.
