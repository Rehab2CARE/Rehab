# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Praktijkfiches ("Rehab") is een PWA voor een kinepraktijk: fiches tonen op de iPad, doorsturen naar patiënten,
en (fase 3) patiënten opvolgen met protocollen, criteria, testresultaten en oefenkalenders.
Code, commentaar, UI-teksten, commitberichten en de README zijn in het **Nederlands (Vlaams)**; houd dat zo.
De README is de handleiding voor de gebruiker (therapeut) en beschrijft elke functie en de Supabase-stappen.

## Commando's

Geen build, geen bundler, geen npm, geen linter: gewone ES-modules die rechtstreeks door de browser geladen worden.

```bash
python3 -m http.server 8765          # app lokaal op http://localhost:8765 (ook in .claude/launch.json)

# Browsertests (Playwright/Chromium), de server moet draaien
pip install playwright && python3 -m playwright install chromium   # eenmalig
python3 test/test_app.py             # hele app: deel 1 lokale modus, deel 2 gedeelde modus met test/mock-bron.js
python3 test/test_bron_echt.py       # echte js/bron.js + Supabase-bibliotheek tegen nagebootste HTTP-antwoorden
```

De testscripts zijn één doorlopende `main()` met `stap(...)`-meldingen; er is geen manier om één test apart te draaien.
`test_app.py` vervangt `js/bron.js` door `test/mock-bron.js` en `js/config.js` door een testconfig via `page.route`.
Een nieuwe functie in `bron.js` die de app gebruikt, moet dus ook in `mock-bron.js` komen, anders breekt de test.

RLS-tests in een lokale Postgres (niet in Supabase): eerst `supabase/test/stub_supabase.sql`, dan alle migraties
in volgorde, dan `supabase/test/test_rls.sql`.

## Bij elke wijziging

- **Verhoog `CACHE_VERSIE` in `sw.js`** bij elke wijziging aan een app-bestand, anders blijft de iPad de oude versie tonen.
- **Een nieuw bestand** (JS-module, game, data, font) ook toevoegen aan `BESTANDEN` in `sw.js`, anders werkt het niet offline.
- Databankwijzigingen: een nieuw genummerd bestand in `supabase/migraties/` (`NNN_naam.sql`, volgend nummer).
  Bestaande migraties niet aanpassen: de gebruiker plakt ze één voor één in de Supabase SQL Editor.
- Kleine, gerichte wijzigingen. Lees enkel de bestanden die nodig zijn.
- Vanilla JS, geen framework. **Vraag eerst** voor je een nieuwe bibliotheek toevoegt; bibliotheken komen lokaal in
  `js/vendor/` (de app moet offline werken), nooit via een CDN.
- Vlaamse namen voor variabelen en functies, niet enkel voor teksten.
- Dialogen via `<dialog>` (de functies `dialoog` en `bevestig` in `app.js`, of `ctx.dialoog`/`ctx.bevestig` in de
  modules), nooit `alert`, `confirm` of `prompt`.
  Voeg in de README een stap "Eenmalig instellen in Supabase" toe voor de nieuwe migratie.
- Werk de README bij bij een nieuwe of gewijzigde functie (dat gebeurt in elke commit tot nu toe).

## Architectuur

**Opstarten (`js/app.js` → `start()`).** Twee modi, bepaald door `js/config.js`:
- *lokaal* (config leeg): alles in IndexedDB `praktijkfiches`, structuur uit `data/structuur.json` bij de eerste start.
- *gedeeld* (Supabase): IndexedDB `praktijkfiches-gedeeld` als offline kopie; wijzigen kan enkel online.
  Na aanmelden bepaalt `profielen.rol` wat er gebeurt: `null` → "Nog geen toegang", `therapeut`/`beheerder` → de app,
  `patient` → `startPatient()` in `patienten.js` ("Mijn programma"). Patiënten melden zich aan met een code (`PT-…`)
  die `bron.codeNaarEmail` omzet naar een intern e-mailadres.

**Lagen.**
- `js/bron.js`: het enige bestand dat met Supabase praat (de rest roept enkel deze functies op). Vertaalt fouten naar
  Nederlandse meldingen (`BronFout`). De Supabase-bibliotheek is een globale `supabase` uit `js/vendor/supabase.js`.
- `js/db.js`: IndexedDB met stores `instellingen` (structuur, pincode, profiel, kopieën) en `fiches` (inhoud).
  `db` is een proxy; `db.gebruik(naam)` wisselt van databank.
- `js/sync.js`: haalt in de gedeelde modus alle `knopen` en `fiches` op, bouwt de boom (`bouwStructuur`) en downloadt
  enkel nieuwe of gewijzigde bestanden. `app.js` roept dit op bij het starten, bij terugkeer naar de app en elke 5 min.

**Datamodel fiches.** Boom van drie niveaus, Onderdeel → Regio → Categorie, met fiches in een categorie
(in Supabase: tabel `knopen` met `niveau` 0–2 en `ouder_id`, plus `fiches`). Navigatie gaat via de URL-hash
(`#/<onderdeel>/<regio>/<categorie>/<fiche>`, plus `#/instellingen`, `#/zoeken`, `#/games`, `#/schema/…`);
`toon()` tekent het scherm opnieuw bij `hashchange`. Alle HTML wordt met template strings opgebouwd: gebruik `esc()`.

**Modules voor patiënten (fase 3).** `app.js` geeft één `hulp`-object (esc, melding, dialoog, bevestig, link, pad,
toon, profielId, …) aan `initPatienten`, `initProtocollen`, `initTesten`, `initSessies`, `initNotities` en `initSchemas`.
Die modules gebruiken `ctx` in plaats van `app.js` te importeren (zo zijn er geen cirkels).
- `patienten.js`: therapeutscherm per patiënt (stroken), oefenprogramma's, de kiesbalk om fiches te kiezen
  (`startKiesModus`/`registreerKiesDoel`, ook gebruikt door protocollen) en het patiëntscherm.
- `protocollen.js`: protocollen → fasen → criteria en standaardoefeningen; een protocol hangt aan een categorie (SQL 011).
- `testen.js`: testmomenten, LSI-berekening en grafieken (Chart.js in `js/vendor/`).
- `sessies.js` + `verkeerslicht.js`: oefenkalender met feedback van de patiënt en het signaal (pijn, zwelling, stijfheid).
- `notities.js`: opvolgnotities, enkel zichtbaar voor de schrijver (RLS in SQL 020).
- `schemas.js`: week-gebonden oefenschema's; inhoud uit de tabel `oefenschemas`, met `data/schema-<id>.json` als terugval.

**Beveiliging zit in de databank.** Rollen en wat een patiënt mag zien worden afgedwongen met RLS in de migraties,
niet in de app. Een patiënt krijgt enkel patiëntteksten (geen drempels, testmethodes of notities van het team).
Patiëntaccounts maken/verwijderen gebeurt in de Edge Function `supabase/functions/patient-account/` (service-role-sleutel
enkel daar). "Verify JWT" staat voor die functie uit in Supabase: de functie controleert zelf sessie en rol, dus die
controle niet weghalen. In `js/config.js` staat enkel de publieke anon/publishable sleutel; daar hoort nooit een service-role-sleutel.

**Beheer en pincode.** "Beheer" schakelt bewerken in; patiëntgegevens zijn enkel in Beheer zichtbaar. De optionele pincode
(`PIN_MIN`, `PIN_MAX`, `AUTO_SLOT_MIN` in `app.js`) is een kinderslot, geen beveiliging.

**Games.** Losse HTML-bestanden in `games/` met gedeelde `spel.js`/`spel.css`, opgelijst in `data/games.json`
(`"bestand": null` = "Binnenkort"). Ze staan niet in Beheer.

**Vormgeving.** Kleuren en maten als variabelen in `:root` bovenaan `css/style.css` (grafiet en wit met één oranje accent);
fonts lokaal in `fonts/`. De app moet bruikbaar blijven op de iPad (staand, 1024×1366 in de tests) en de gsm van de patiënt.

## Buiten de repo

- `local/` staat in `.gitignore`: daar staan bv. `local/protocollen/seed-protocollen.sql` en `bouw-seed.py`
  (protocolinhoud uit het eigen werkboek). In deze kloon ontbreekt die map; ze bestaat wel in de bovenliggende map.
- Gepubliceerd via GitHub Pages: `https://rehab2care.github.io/Rehab/`.
- Testfase: enkel verzonnen testpatiënten, geen echte patiëntgegevens.
