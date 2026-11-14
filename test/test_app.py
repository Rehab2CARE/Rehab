"""Automatische test van de app in een echte browser (Chromium via Playwright).

Starten (vanuit de map van de app):
    python3 -m http.server 8765 &
    python3 test/test_app.py

Deel 1 test de lokale modus (zonder Supabase).
Deel 2 test de gedeelde modus met een nagebootste server (test/mock-bron.js), in hetzelfde browserprofiel,
zodat ook het kopiëren van de oude lokale fiches getest wordt.
"""
import json, pathlib, sys, uuid
from playwright.sync_api import sync_playwright, expect

BASIS = 'http://localhost:8765/'
HIER = pathlib.Path(__file__).parent
MOCK = (HIER / 'mock-bron.js').read_text()
CONFIG = "export const SUPABASE = { URL: 'https://test.supabase.co', ANON_KEY: 'test' };"
PDF = b'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'
fouten = []


def stap(naam):
    print('  ✓', naam)


def dialoog_ok(page, waarden):
    expect(page.locator('#dialoog')).to_be_visible()
    for naam, w in waarden.items():
        page.locator(f'#dialoog [name="{naam}"]').fill(w)
    page.click('#dialoog-ok')
    expect(page.locator('#dialoog')).to_be_hidden()


def beheer_aan(page):
    expect(page.locator('#inhoud > *').first).to_be_visible()
    if page.get_attribute('#beheer', 'aria-pressed') != 'true':
        page.click('#beheer')
    expect(page.locator('#beheer')).to_have_attribute('aria-pressed', 'true')


def tegel(page, titel):
    page.locator('.tegel-link', has_text=titel).first.click()


def mock_server():
    def k(titel, niveau, ouder=None, volgorde=0):
        return {'id': str(uuid.uuid4()), 'ouder_id': ouder, 'niveau': niveau, 'titel': titel, 'omschrijving': '', 'volgorde': volgorde, 'bijgewerkt': '2026-11-14T08:00:00Z'}
    oef = k('Oefenfiches', 0); info = k('Informatiefiches', 0, volgorde=1)
    knie = k('Knie', 1, oef['id']); kracht = k('Kracht', 2, knie['id'])
    iknie = k('Knie', 1, info['id']); pijn = k('Pijn begrijpen', 2, iknie['id'])
    return {
        'profielen': [
            {'id': 'u-beheerder', 'email': 'beheerder@test.be', 'naam': 'Beheerder', 'rol': 'beheerder'},
            {'id': 'u-camille', 'email': 'camille@test.be', 'naam': 'Camille', 'rol': 'therapeut'},
            {'id': 'u-nieuw', 'email': 'nieuw@test.be', 'naam': 'nieuw', 'rol': None},
        ],
        'wachtwoorden': {'beheerder@test.be': 'geheim123', 'camille@test.be': 'geheim123', 'nieuw@test.be': 'geheim123'},
        'knopen': [oef, info, knie, kracht, iknie, pijn],
        'fiches': [], 'bestanden': {},
    }


def server(page):
    return page.evaluate("JSON.parse(localStorage.getItem('mock-server'))")


def main():
    pdf_pad = HIER / 'voorbeeld.pdf'
    pdf_pad.write_bytes(PDF)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(service_workers='block', viewport={'width': 1024, 'height': 1366})
        page = ctx.new_page()
        page.on('pageerror', lambda e: fouten.append(f'JS-fout: {e}'))
        page.on('console', lambda m: fouten.append(f'console.{m.type}: {m.text}') if m.type == 'error' else None)

        # ---------------- Deel 1: lokale modus ----------------
        print('Deel 1: lokale modus')
        page.goto(BASIS)
        expect(page.locator('.tegel-titel', has_text='Oefenfiches')).to_be_visible()
        expect(page.locator('.tegel-titel', has_text='Games')).to_be_visible()
        stap('startscherm met onderdelen en Games')
        beheer_aan(page)
        tegel(page, 'Oefenfiches'); tegel(page, 'Knie'); tegel(page, 'Algemeen')
        page.click('#nieuwe-tekst')
        dialoog_ok(page, {'titel': 'Brug', 'tekst': '# Uitvoering\n- 3 x 10'})
        page.set_input_files('#upload', str(pdf_pad))
        expect(page.locator('.tegel-titel', has_text='voorbeeld')).to_be_visible()
        expect(page.locator('.tegel-titel', has_text='Brug')).to_be_visible()
        stap('tekstfiche en PDF lokaal toegevoegd')
        page.click('#instellingen')
        expect(page.locator('h2', has_text='Back-up terugzetten')).to_be_visible()
        expect(page.locator('h2', has_text='Account')).to_have_count(0)
        stap('lokale instellingen ongewijzigd (back-up terugzetten aanwezig, geen account)')

        # ---------------- Deel 2: gedeelde modus ----------------
        print('Deel 2: gedeelde modus (nagebootste server)')
        page.route('**/js/bron.js', lambda r: r.fulfill(body=MOCK, content_type='text/javascript'))
        page.route('**/js/config.js', lambda r: r.fulfill(body=CONFIG, content_type='text/javascript'))
        page.evaluate("s => { sessionStorage.clear(); localStorage.setItem('mock-server', s); }", json.dumps(mock_server()))
        page.goto(BASIS + '#/')
        page.reload()
        expect(page.locator('h1', has_text='Aanmelden')).to_be_visible()
        expect(page.locator('#beheer')).to_be_hidden()
        stap('zonder aanmelding: aanmeldscherm, geen Beheer')

        page.fill('[name=email]', 'camille@test.be'); page.fill('[name=wachtwoord]', 'fout')
        page.click('#aanmeld-form [type=submit]')
        expect(page.locator('#aanmeld-fout')).to_have_text('E-mailadres of wachtwoord klopt niet.')
        stap('verkeerd wachtwoord: duidelijke fout')

        page.fill('[name=wachtwoord]', 'geheim123')
        page.click('#aanmeld-form [type=submit]')
        expect(page.locator('.tegel-titel', has_text='Informatiefiches')).to_be_visible()
        expect(page.locator('.tegel-titel', has_text='Oefenfiches')).to_be_visible()
        stap('therapeut aangemeld: gedeelde structuur zichtbaar')

        # Oude lokale fiches kopiëren
        beheer_aan(page); page.click('#instellingen')
        expect(page.locator('#kopieer-oud')).to_have_text('2 fiches kopiëren')
        expect(page.locator('h2', has_text='Back-up terugzetten')).to_have_count(0)
        expect(page.locator('#gebruikers-paneel')).to_have_count(0)
        page.click('#kopieer-oud')
        page.click('#dialoog-ok')  # bevestigen
        expect(page.locator('#dialoog-titel')).to_have_text('Oude kopie wissen?', timeout=10000)
        page.click('#dialoog-ok')
        s = server(page)
        oef = [k for k in s['knopen'] if k['titel'] == 'Oefenfiches']
        assert len(oef) == 1, 'Oefenfiches is samengevoegd, niet verdubbeld'
        assert len(s['fiches']) == 2, f"2 fiches gekopieerd, kreeg {len(s['fiches'])}"
        assert any(f['soort'] == 'pdf' and f['bestand_pad'] in s['bestanden'] for f in s['fiches']), 'PDF staat in de opslag'
        assert any(f['soort'] == 'tekst' and '3 x 10' in (f['tekst'] or '') for f in s['fiches']), 'tekst mee gekopieerd'
        stap('oude lokale fiches gekopieerd en samengevoegd (geen dubbel onderdeel)')
        page.reload()
        beheer_aan(page); page.click('#instellingen')
        expect(page.locator('#kopieer-oud')).to_have_count(0)
        stap('oude lokale kopie gewist: kopieerpaneel weg')

        # Beheer op de server
        page.goto(BASIS + '#/')
        tegel(page, 'Oefenfiches'); tegel(page, 'Knie')
        page.click('[data-actie=nieuw]')
        dialoog_ok(page, {'naam': 'Mobiliteit'})
        expect(page.locator('.tegel-titel', has_text='Mobiliteit')).to_be_visible()
        assert any(k['titel'] == 'Mobiliteit' and k['niveau'] == 2 for k in server(page)['knopen'])
        stap('categorie toegevoegd op de server')

        # volgorde: Mobiliteit naar voren
        titels = page.locator('.tegel-titel').all_inner_texts()
        i = titels.index('Mobiliteit')
        page.locator(f'[data-actie=op][data-i="{i}"]').click()
        expect(page.locator('.tegel-titel').nth(i - 1)).to_have_text('Mobiliteit')
        stap('volgorde aangepast (◀)')

        tegel(page, 'Kracht')
        page.set_input_files('#upload', str(pdf_pad))
        expect(page.locator('.tegel-titel', has_text='voorbeeld')).to_be_visible()
        page.click('#nieuwe-tekst')
        dialoog_ok(page, {'titel': 'Squat', 'tekst': 'Diep zitten'})
        expect(page.locator('.tegel-titel', has_text='Squat')).to_be_visible()
        stap('PDF geüpload en tekstfiche geschreven')
        dl_voor = page.evaluate('window.__downloads || 0')
        tegel(page, 'voorbeeld')
        expect(page.locator('.viewer iframe')).to_be_visible()
        assert page.evaluate('window.__downloads || 0') == dl_voor, 'eigen upload niet opnieuw gedownload'
        stap('geüploade PDF opent zonder opnieuw te downloaden')
        page.go_back()
        n = page.locator('.tegel-fiche').count()
        idx = page.locator('.tegel-titel').all_inner_texts().index('Squat')
        page.locator(f'[data-actie=hernoem][data-i="{idx}"]').click()
        dialoog_ok(page, {'titel': 'Squat (diep)', 'tekst': 'Diep zitten, 3x8'})
        expect(page.locator('.tegel-titel', has_text='Squat (diep)')).to_be_visible()
        assert any(f['titel'] == 'Squat (diep)' and f['tekst'] == 'Diep zitten, 3x8' for f in server(page)['fiches'])
        stap('tekstfiche gewijzigd op de server')
        idx = page.locator('.tegel-titel').all_inner_texts().index('voorbeeld')
        page.locator(f'[data-actie=weg][data-i="{idx}"]').click()
        page.click('#dialoog-ok')
        expect(page.locator('.tegel-fiche')).to_have_count(n - 1)
        stap('fiche gewist (ook het bestand)')

        # Wijziging door een collega op een ander toestel → Nu bijwerken
        page.evaluate("""() => {
          const s = JSON.parse(localStorage.getItem('mock-server'));
          const cat = s.knopen.find(k => k.titel === 'Pijn begrijpen');
          s.fiches.push({ id: crypto.randomUUID(), categorie_id: cat.id, titel: 'Van een collega', omschrijving: '', soort: 'tekst',
            tekst: 'Hallo team', bestand_pad: null, volgorde: 0, bijgewerkt: new Date().toISOString() });
          localStorage.setItem('mock-server', JSON.stringify(s));
        }""")
        page.click('#instellingen'); page.click('#sync-nu')
        expect(page.locator('#melding')).to_contain_text('bijgewerkt')
        page.goto(BASIS + '#/')
        tegel(page, 'Informatiefiches'); tegel(page, 'Knie'); tegel(page, 'Pijn begrijpen')
        tegel(page, 'Van een collega')
        expect(page.locator('.viewer-tekst')).to_contain_text('Hallo team')
        stap('fiche van een collega verschijnt na bijwerken')

        # Wissen van een regio met fiches
        page.goto(BASIS + '#/')
        tegel(page, 'Informatiefiches')
        page.locator('[data-actie=weg][data-i="0"]').click()
        expect(page.locator('#dialoog')).to_contain_text('1 fiche wordt gewist')
        page.click('#dialoog-ok')
        expect(page.locator('.tegel-titel', has_text='Knie')).to_have_count(0)
        assert not any(f['titel'] == 'Van een collega' for f in server(page)['fiches'])
        stap('regio met fiche gewist (cascade)')

        # Offline: lokale kopie blijft zichtbaar, wijzigen geblokkeerd
        page.evaluate("localStorage.setItem('mock-offline','1'); localStorage.setItem('mock-geen-sessie-offline','1')")
        page.add_init_script("try { if (localStorage.getItem('mock-offline') === '1') Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false }); } catch (e) {}")
        page.goto(BASIS + '#/')
        page.reload()
        expect(page.locator('.tegel-titel', has_text='Oefenfiches')).to_be_visible()
        tegel(page, 'Oefenfiches'); tegel(page, 'Knie'); tegel(page, 'Kracht')
        tegel(page, 'Squat (diep)')
        expect(page.locator('.viewer-tekst')).to_contain_text('3x8')
        page.go_back()
        beheer_aan(page)
        page.click('#nieuwe-tekst')
        dialoog_ok(page, {'titel': 'Offline', 'tekst': 'x'})
        expect(page.locator('#melding')).to_contain_text('Geen internet')
        stap('offline: fiches bekijken lukt, wijzigen wordt netjes geweigerd')
        page.evaluate("localStorage.removeItem('mock-offline'); localStorage.removeItem('mock-geen-sessie-offline')")

        # Account zonder rol
        page.evaluate("localStorage.setItem('mock-sessie', JSON.stringify({user:{id:'u-nieuw',email:'nieuw@test.be'}}))")
        page.goto(BASIS + '#/'); page.reload()
        expect(page.locator('h1', has_text='Nog geen toegang')).to_be_visible()
        expect(page.locator('#beheer')).to_be_hidden()
        stap('account zonder rol: geen toegang tot fiches')
        page.click('#afmelden')
        expect(page.locator('h1', has_text='Aanmelden')).to_be_visible()
        stap('afmelden werkt')

        # Beheerder: rollen
        page.fill('[name=email]', 'beheerder@test.be'); page.fill('[name=wachtwoord]', 'geheim123')
        page.click('#aanmeld-form [type=submit]')
        expect(page.locator('.tegel-titel', has_text='Oefenfiches')).to_be_visible()
        beheer_aan(page); page.click('#instellingen')
        expect(page.locator('#gebruikers li')).to_have_count(3)
        expect(page.locator('select[data-rol="u-beheerder"]')).to_be_disabled()
        page.select_option('select[data-rol="u-nieuw"]', 'therapeut')
        expect(page.locator('#melding')).to_contain_text('Rol aangepast')
        assert next(p for p in server(page)['profielen'] if p['id'] == 'u-nieuw')['rol'] == 'therapeut'
        stap('beheerder geeft een nieuwe collega de rol therapeut')

        # Uitnodigingslink: wachtwoord kiezen
        page.evaluate("localStorage.removeItem('mock-sessie')")
        page.goto('about:blank')
        page.goto(BASIS + '#access_token=abc&type=invite&email=nieuw@test.be')
        expect(page.locator('#dialoog-titel')).to_have_text('Welkom! Kies een wachtwoord')
        dialoog_ok(page, {'w1': 'nieuwwachtwoord', 'w2': 'nieuwwachtwoord'})
        expect(page.locator('.tegel-titel', has_text='Oefenfiches')).to_be_visible()
        assert 'access_token' not in page.url, 'token uit de adresbalk'
        assert server(page)['wachtwoorden']['nieuw@test.be'] == 'nieuwwachtwoord'
        stap('uitnodigingslink: wachtwoord kiezen en meteen binnen, token uit de adresbalk')

        page.evaluate("localStorage.removeItem('mock-sessie')")
        page.goto('about:blank')
        page.goto(BASIS + '#error=access_denied&error_description=Email+link+is+invalid+or+has+expired')
        expect(page.locator('#aanmeld-fout')).to_contain_text('werkt niet')
        assert 'error' not in page.url
        stap('verlopen link: aanmeldscherm met duidelijke uitleg')

        browser.close()
    pdf_pad.unlink()
    echte = [f for f in fouten if 'favicon' not in f and 'Failed to load resource' not in f]
    if echte:
        print('\nFOUTEN IN DE BROWSER:'); [print('  ', f) for f in echte]; sys.exit(1)
    print('\nALLE APP-TESTS GESLAAGD')


if __name__ == '__main__':
    main()
