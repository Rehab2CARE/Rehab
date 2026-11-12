# Praktijkfiches

Eenvoudige web-app (PWA) om in de praktijk fiches aan patiënten te tonen op de iPad.
Werkt offline, kan op het beginscherm gezet worden, en bewaart alles lokaal op het toestel.

## Opbouw

**Onderdeel → Regio → Categorie → Fiches**

- Onderdelen: Oefenfiches, Informatiefiches, Revalidatieprotocols
- Regio's: Lage rug, Heup, Knie, Enkel
- Categorieën: zelf aan te maken per regio
- Fiches: PDF, foto/afbeelding, of een tekst die je in de app schrijft

## Aanpassen in de app (zonder code)

Tik rechtsboven op **Beheer**. Dan kan je:

- onderdelen, regio's en categorieën toevoegen, hernoemen, verschuiven (◀ ▶) en wissen;
- in een categorie bestanden toevoegen (meerdere tegelijk) of een tekstfiche schrijven;
- fiches hernoemen, een korte omschrijving geven, verschuiven en wissen;
- via **Instellingen** een back-up maken en terugzetten.

Tik opnieuw op **Beheer** om terug naar de patiëntweergave te gaan (enkel bekijken).

## Aanpassen in de bestanden

| Wat | Waar |
|---|---|
| Standaardstructuur bij de eerste start (onderdelen, regio's, standaardcategorie) | `data/structuur.json` |
| Kleuren, lettergrootte, knopgrootte | bovenaan `css/style.css` (`:root`) |
| Werking van de schermen | `js/app.js` |
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
