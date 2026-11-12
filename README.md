# Praktijkfiches

Eenvoudige web-app (PWA) om in de praktijk fiches aan patiënten te tonen op de iPad.
Werkt offline, kan op het beginscherm gezet worden, en bewaart alles lokaal op het toestel.

## Opbouw

**Onderdeel → Regio → Categorie → Fiches**

- Onderdelen: Oefenfiches, Informatiefiches, Revalidatieprotocols
- Regio's: Lage rug, Heup, Knie, Enkel
- Categorieën: zelf aan te maken per regio
- Fiches: PDF, foto/afbeelding, of een tekst die je in de app schrijft

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

**Pincode vergeten?** Er is geen achterdeur. Wis de websitegegevens van de app in Safari
(Instellingen → Apps → Safari → Geavanceerd → Websitegegevens) en zet daarna je laatste back-up terug.
Daarom: maak regelmatig een back-up.

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

`data/structuur.json` wordt enkel gebruikt bij de allereerste start of na **Instellingen → Alles wissen**.
Wat je daarna in Beheer verandert, staat op het toestel zelf.

Na een wijziging aan een app-bestand: verhoog `CACHE_VERSIE` in `sw.js`, anders blijft de iPad de oude versie tonen.

## Belangrijk

- **Back-up:** de fiches staan enkel op de iPad. Maak regelmatig een back-up (Instellingen) en bewaar die in Bestanden of iCloud.
- **Zet de app op het beginscherm** (Safari → Deel → Zet op beginscherm). Safari kan anders na een tijd ongebruikte websitegegevens wissen.
- Geen patiëntgegevens: de app bevat enkel algemene fiches.

## Lokaal testen op de Mac

```bash
python3 -m http.server 8765
```

Open daarna http://localhost:8765
