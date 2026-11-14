"""Test van het ECHTE js/bron.js met de echte Supabase-bibliotheek, tegen een nagebootste Supabase-server
(de HTTP-antwoorden worden door Playwright gegeven). Controleert dat aanmelden, ophalen, uploaden en downloaden
de juiste adressen aanspreken en dat de app ermee werkt.

    python3 -m http.server 8765 &
    python3 test/test_bron_echt.py
"""
import base64, json, sys, time
from playwright.sync_api import sync_playwright, expect

BASIS = 'http://localhost:8765/'
SB = 'https://test.supabase.co'
CONFIG = f"export const SUPABASE = {{ URL: '{SB}', ANON_KEY: 'anon-test' }};"


def jwt(sub):
    enc = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip('=')
    return f"{enc({'alg': 'HS256', 'typ': 'JWT'})}.{enc({'sub': sub, 'role': 'authenticated', 'exp': int(time.time()) + 3600, 'aud': 'authenticated'})}.c2ln"


GEBRUIKER = {'id': 'u-1', 'email': 'camille@test.be', 'aud': 'authenticated', 'role': 'authenticated', 'app_metadata': {}, 'user_metadata': {}, 'created_at': '2026-11-14T00:00:00Z'}
SESSIE = {'access_token': jwt('u-1'), 'token_type': 'bearer', 'expires_in': 3600, 'expires_at': int(time.time()) + 3600, 'refresh_token': 'r1', 'user': GEBRUIKER}
KNOPEN = [
    {'id': 'k0', 'ouder_id': None, 'niveau': 0, 'titel': 'Oefenfiches', 'omschrijving': 'Thuis', 'volgorde': 0, 'bijgewerkt': '2026-11-14T08:00:00Z'},
    {'id': 'k1', 'ouder_id': 'k0', 'niveau': 1, 'titel': 'Knie', 'omschrijving': '', 'volgorde': 0, 'bijgewerkt': '2026-11-14T08:00:00Z'},
    {'id': 'k2', 'ouder_id': 'k1', 'niveau': 2, 'titel': 'Kracht', 'omschrijving': '', 'volgorde': 0, 'bijgewerkt': '2026-11-14T08:00:00Z'},
]
FICHES = [
    {'id': 'f1', 'categorie_id': 'k2', 'titel': 'Brug', 'omschrijving': '', 'soort': 'afbeelding', 'bestand_pad': 'f1/brug.png', 'mime': 'image/png',
     'bestandsnaam': 'brug.png', 'grootte': 68, 'tekst': None, 'volgorde': 0, 'bijgewerkt': '2026-11-14T08:00:00Z'},
]
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')
log = []


def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(service_workers='block')
        page = ctx.new_page()
        fouten = []
        page.on('pageerror', lambda e: fouten.append(str(e)))
        page.route('**/js/config.js', lambda r: r.fulfill(body=CONFIG, content_type='text/javascript'))

        def server(route):
            req = route.request
            url, m = req.url, req.method
            log.append(f'{m} {url.replace(SB, "")}')
            hdr = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Content-Type': 'application/json'}
            if m == 'OPTIONS':
                return route.fulfill(status=200, headers=hdr, body='')
            assert req.headers.get('apikey') == 'anon-test', 'apikey mee'
            if '/auth/v1/token' in url:
                body = json.loads(req.post_data or '{}')
                if body.get('password') != 'geheim123':
                    return route.fulfill(status=400, headers=hdr, body=json.dumps({'code': 400, 'error_code': 'invalid_credentials', 'msg': 'Invalid login credentials'}))
                return route.fulfill(status=200, headers=hdr, body=json.dumps(SESSIE))
            if '/rest/v1/' in url:
                assert req.headers.get('authorization') == f"Bearer {SESSIE['access_token']}", 'aangemeld verzoek'
            if '/rest/v1/profielen' in url:
                return route.fulfill(status=200, headers=hdr, body=json.dumps({'id': 'u-1', 'email': 'camille@test.be', 'naam': 'Camille', 'rol': 'therapeut'}))
            if '/rest/v1/knopen' in url and m == 'GET':
                return route.fulfill(status=200, headers=hdr, body=json.dumps(KNOPEN))
            if '/rest/v1/fiches' in url and m == 'GET':
                return route.fulfill(status=200, headers=hdr, body=json.dumps(FICHES))
            if '/rest/v1/fiches' in url and m == 'POST':
                rij = json.loads(req.post_data)
                rij = rij[0] if isinstance(rij, list) else rij
                rij.update({'bijgewerkt': '2026-11-14T09:00:00Z', 'omschrijving': rij.get('omschrijving', ''), 'bestand_pad': rij.get('bestand_pad'),
                            'mime': rij.get('mime'), 'bestandsnaam': rij.get('bestandsnaam'), 'grootte': rij.get('grootte'), 'tekst': rij.get('tekst')})
                FICHES.append(rij)
                return route.fulfill(status=201, headers=hdr, body=json.dumps(rij))
            if '/storage/v1/object/fiches/' in url and m == 'POST':
                return route.fulfill(status=200, headers=hdr, body=json.dumps({'Key': 'fiches/x', 'Id': 'x'}))
            if '/storage/v1/object/' in url and m == 'GET':
                return route.fulfill(status=200, headers={**hdr, 'Content-Type': 'image/png'}, body=PNG)
            return route.fulfill(status=404, headers=hdr, body='{}')

        page.route(f'{SB}/**', server)
        page.goto(BASIS)
        expect(page.locator('h1', has_text='Aanmelden')).to_be_visible()
        page.fill('[name=email]', 'camille@test.be'); page.fill('[name=wachtwoord]', 'fout')
        page.click('#aanmeld-form [type=submit]')
        expect(page.locator('#aanmeld-fout')).to_have_text('E-mailadres of wachtwoord klopt niet.')
        print('  ✓ verkeerd wachtwoord vertaald')
        page.fill('[name=wachtwoord]', 'geheim123')
        page.click('#aanmeld-form [type=submit]')
        expect(page.locator('.tegel-titel', has_text='Oefenfiches')).to_be_visible()
        print('  ✓ aangemeld met echte Supabase-bibliotheek, sessie overleeft herlading')
        page.goto(BASIS + '#/k0/k1/k2/f1')
        expect(page.locator('.viewer img')).to_be_visible()
        print('  ✓ structuur en afbeelding opgehaald uit opslag')
        page.goto(BASIS + '#/k0/k1/k2')
        page.click('#beheer')
        page.click('#nieuwe-tekst')
        page.fill('#dialoog [name=titel]', 'Squat'); page.fill('#dialoog [name=tekst]', 'Diep')
        page.click('#dialoog-ok')
        expect(page.locator('.tegel-titel', has_text='Squat')).to_be_visible()
        page.set_input_files('#upload', files=[{'name': 'lunge.png', 'mimeType': 'image/png', 'buffer': PNG}])
        expect(page.locator('.tegel-titel', has_text='lunge')).to_be_visible()
        assert any('POST /storage/v1/object/fiches/' in l and 'lunge.png' in l for l in log), 'upload naar bucket fiches'
        print('  ✓ tekstfiche en upload via de echte bibliotheek')
        b.close()
        if fouten:
            print('JS-FOUTEN:', fouten); sys.exit(1)
    print('\nECHTE BRON.JS: ALLE TESTS GESLAAGD')


if __name__ == '__main__':
    main()
