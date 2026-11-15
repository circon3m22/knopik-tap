"""Browser QA against a local app only; every Supabase call is intercepted.
Requires Python Playwright + Chromium. No production users or records are touched.
Run: python3 scripts/qa-journey.py --url http://127.0.0.1:3001
"""
import argparse
import base64
import copy
import json
from pathlib import Path
import subprocess
import time
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:3001')
parser.add_argument('--chromium', default='/usr/bin/chromium')
args = parser.parse_args()
assert urlparse(args.url).hostname in ('127.0.0.1', 'localhost'), 'QA is restricted to a local app'
root = Path(__file__).resolve().parents[1]
out = root / 'outputs/journey'
out.mkdir(parents=True, exist_ok=True)
defaults = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', 'import {createDefaultSave} from "./app/game-logic.ts";console.log(JSON.stringify(createDefaultSave()))'], cwd=root, text=True))
uid = '11111111-2222-4333-8444-555555555555'
user = dict(id=uid, email='qa@knopik.local', aud='authenticated', role='authenticated', app_metadata={'provider': 'email'}, user_metadata={}, identities=[], created_at='2026-11-15T00:00:00Z')
def part(v):
    return base64.urlsafe_b64encode(json.dumps(v).encode()).decode().rstrip('=')
token = part({'alg': 'HS256', 'typ': 'JWT'}) + '.' + part({'sub': uid, 'exp': int(time.time()) + 3600, 'role': 'authenticated'}) + '.qa-test-signature'
checks = []
errors = []

def new_page(browser, viewport=(390, 844), *, legacy=False, calm=False, progress=12, balance=12000):
    context = browser.new_context(viewport=dict(width=viewport[0], height=viewport[1]), device_scale_factor=1, is_mobile=viewport[0] < 760, has_touch=viewport[0] < 760, reduced_motion='reduce' if calm else 'no-preference')
    save = copy.deepcopy(defaults)
    save.update(walletCoins=balance, vaultCoins=5000, totalTaps=2500, tutorialSeen=True, colaCount=2, teaCount=2, pitbullCount=2, hatOwned=True)
    save['settings'].update(sound=False, vibration=False, yellow=True)
    save['adventure'].update(claimedSteps=progress, xp=2500, practicePlays=10)
    if legacy:
        save['version'] = 15
        del save['adventure']
    row = dict(user_id=uid, save=save, revision=1, source_id=None)
    calls = []
    def route(r):
        path = urlparse(r.request.url).path
        calls.append(path)
        if path.endswith('/token'):
            data = dict(access_token=token, refresh_token='qa-refresh', expires_in=3600, token_type='bearer', user=user)
        elif path.endswith('/user'):
            data = user
        elif path.endswith('/profiles'):
            data = dict(id=uid, username='knopik_qa', is_admin=False)
        elif path.endswith('/game_config'):
            data = {'difficulty': 50}
        elif path.endswith('/rpc/save_game_progress'):
            body = r.request.post_data_json
            assert body['expected_revision'] == row['revision'], 'unexpected overlapping save revision'
            row.update(save=body['new_save'], revision=body['expected_revision'] + 1, source_id=body['save_source_id'])
            data = row
        elif path.endswith('/game_saves'):
            data = row
        else:
            data = []
        r.fulfill(status=200, content_type='application/json', body=json.dumps(data))
    context.route('**/*.supabase.co/**', route)
    page = context.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(args.url, wait_until='domcontentloaded')
    page.get_by_label('Логин', exact=True).fill('knopik_qa')
    page.get_by_label('Пароль', exact=True).fill('qa-not-a-real-password')
    page.get_by_role('button', name='Войти', exact=True).click()
    page.locator('[data-hydrated="true"]').wait_for(timeout=20000)
    dismiss = page.get_by_role('button', name='Скрыть уведомление об обновлении')
    if dismiss.count():
        dismiss.click()
    page.evaluate('Math.random = () => 0.1')
    return context, page, row, calls

def saved(page, row):
    # A latest snapshot is written on a fixed cadence, then sent through the existing CAS queue.
    page.wait_for_timeout(2400)
    return copy.deepcopy(row['save'])

def library(page):
    page.get_by_role('button', name='Открыть игры', exact=True).click()
    expect(page.get_by_role('heading', name='Во что сыграем?')).to_be_visible()

def launch(page, title):
    page.locator('.arcade-card').filter(has_text=title).click()
    start = page.get_by_role('button', name='Начать игру', exact=True)
    if start.count():
        start.click()
    else:
        page.get_by_role('button', name='Выбрать ставку', exact=True).click()

def record(name):
    checks.append(name)
    print('PASS', name, flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=args.chromium, headless=True, args=['--no-sandbox'])
    for width, height in ((320,568), (375,667), (390,844), (768,1024), (1440,900)):
        context, page, row, calls = new_page(browser, (width,height), legacy=True)
        geometry = page.evaluate('''() => {
          const box = selector => { const r=document.querySelector(selector).getBoundingClientRect(); return {y:r.y,bottom:r.bottom,width:r.width}; };
          return { width:document.documentElement.scrollWidth, viewport:innerWidth, dog:box('.dog-button'), wallet:box('.wallet-balance'), nav:box('.bottom-bar') };
        }''')
        assert geometry['width'] <= width, geometry
        assert geometry['dog']['bottom'] <= geometry['wallet']['y'] + 2, geometry
        assert page.locator('.bottom-bar .tap-icon').count() == 5
        page.screenshot(path=str(out / f'home-{width}.png'), full_page=True)
        library(page)
        assert page.locator('.arcade-card').count() == 8
        assert page.locator('.arcade-card.is-locked').count() == 3
        page.get_by_role('button', name='На навык', exact=True).click()
        assert page.locator('.arcade-card').count() == 2
        page.get_by_role('button', name='На удачу', exact=True).click()
        assert page.locator('.arcade-card').count() == 6
        page.get_by_role('button', name='Все игры', exact=True).click()
        page.screenshot(path=str(out / f'games-{width}.png'), full_page=True)
        page.keyboard.press('Escape')
        expect(page.get_by_role('heading', name='Во что сыграем?')).not_to_be_visible()
        page.get_by_role('button', name='Путь', exact=True).click()
        assert page.locator('.journey-nodes li').count() == 6
        page.screenshot(path=str(out / f'path-{width}.png'), full_page=True)
        page.get_by_role('button', name='Забрать награду', exact=True).click()
        page.get_by_role('button', name='Закрыть путь').click()
        if width == 390:
            page.get_by_role('button',name='Магазин',exact=True).click()
            page.get_by_role('button',name='Закрыть магазин',exact=True).click()
            page.get_by_role('button',name='Кейсы',exact=True).click()
            page.keyboard.press('Escape')
            assert page.locator('.cases-sheet').count() == 0
            page.get_by_role('button',name='Открыть аккаунт и настройки',exact=True).click()
            page.get_by_role('heading',name='Настройки',exact=True).wait_for()
            page.get_by_role('button',name='Закрыть настройки',exact=True).click()
            record('shop, cases and settings retain explicit exits and Escape')
        state = saved(page,row)
        assert state['version'] == 16 and state['walletCoins'] == 12100 and state['vaultCoins'] == 5000
        assert state['colaCount'] == 2 and state['teaCount'] == 2 and state['pitbullCount'] == 2
        assert state['adventure']['claimedSteps'] == 1
        record(f'{width}x{height}: migration, geometry, 8 games, filters, Escape, path reward')
        context.close()

    context,page,row,calls = new_page(browser,(320,700),balance=9_999_999_999)
    assert page.evaluate('document.documentElement.scrollWidth') <= 320
    page.get_by_role('button',name='Магазин',exact=True).click()
    page.screenshot(path=str(out/'shop-large-balance.png'),full_page=True)
    page.get_by_role('button',name='Закрыть магазин',exact=True).click()
    record('large balance on a narrow phone does not cover the shop exit')
    context.close()

    context,page,row,calls = new_page(browser, progress=0)
    page.get_by_role('button',name='Путь',exact=True).click()
    page.get_by_role('button',name='Забрать награду',exact=True).evaluate('(el) => {el.click(); el.click();}')
    assert saved(page,row)['adventure']['claimedSteps'] == 1
    assert row['save']['walletCoins'] == 12100
    record('rapid checkpoint clicks cannot claim the next eligible step')
    context.close()

    context,page,row,calls = new_page(browser,progress=5)
    page.get_by_role('button',name='Путь',exact=True).click()
    page.get_by_role('button',name='Забрать награду',exact=True).click()
    expect(page.locator('.chapter-banner h3')).to_have_text('Поймай волну')
    state=saved(page,row)
    assert state['adventure']['claimedSteps']==6 and state['commonCases']==1
    record('chapter checkpoint awards one case and advances to the next chapter')
    context.close()

    context,page,row,calls = new_page(browser)
    library(page);launch(page,'Точный тап')
    for n in range(3):
        page.get_by_role('button',name='Начать' if n==0 else 'Следующий раунд',exact=True).click()
        page.wait_for_function("""() => { const track=document.querySelector('.timing-track').getBoundingClientRect(); const marker=document.querySelector('.timing-marker').getBoundingClientRect(); const ratio=(marker.x+marker.width/2-track.x)/track.width;return ratio>.43 && ratio<.53; }""")
        page.get_by_role('button',name='Стоп!',exact=True).click()
    assert saved(page,row)['adventure']['timingWins']==1
    record('animated timing game matches the visible green-zone hit window')
    context.close()

    context,page,row,calls = new_page(browser)
    library(page)
    launch(page,'Монетка')
    page.get_by_role('spinbutton',name='Размер ставки').fill('100')
    page.get_by_role('button',name='Играть · 100 монет',exact=True).evaluate('(el) => {el.click(); el.click();}')
    page.keyboard.press('Escape')
    expect(page.get_by_role('heading',name='Монетка',exact=True)).to_be_visible()
    expect(page.get_by_text('Выплата 190',exact=True)).to_be_visible()
    state=saved(page,row)
    assert state['walletCoins']==12090 and state['adventure']['casinoPlays']==1
    page.screenshot(path=str(out/'coin-win.png'),full_page=True)
    page.get_by_role('button',name='Вернуться в игры',exact=True).click()
    # Detail screen and its selection survive a played round.
    page.get_by_role('button',name='Выбрать ставку',exact=True).click()
    page.get_by_role('spinbutton',name='Размер ставки').fill('100')
    page.get_by_role('button',name='Луна',exact=True).click()
    page.get_by_role('button',name='Играть · 100 монет',exact=True).click()
    expect(page.get_by_text('−100 монет',exact=True)).to_be_visible()
    assert saved(page,row)['walletCoins']==11990
    record('coin win/loss, locked Escape, rapid stake clicks, single payout')
    context.close()

    context,page,row,calls = new_page(browser)
    library(page); launch(page,'Кубик')
    page.get_by_role('spinbutton',name='Размер ставки').fill('100')
    page.get_by_role('button',name='1–3',exact=True).click()
    page.get_by_role('button',name='Играть · 100 монет',exact=True).click()
    expect(page.get_by_text('Выплата 190',exact=True)).to_be_visible()
    assert saved(page,row)['walletCoins']==12090
    record('dice: declared low outcome and payout')
    context.close()

    context,page,row,calls = new_page(browser)
    library(page); launch(page,'Башня сокровищ')
    page.get_by_role('spinbutton',name='Размер ставки').fill('100')
    page.get_by_role('button',name='Плитка 2',exact=True).click()
    page.get_by_role('button',name='Выше · ×2.1',exact=True).click()
    page.get_by_role('button',name='Плитка 3',exact=True).click()
    page.screenshot(path=str(out/'tower-safe.png'),full_page=True)
    page.get_by_role('button',name='Забрать 210',exact=True).evaluate('(el)=>{el.click();el.click();}')
    assert saved(page,row)['walletCoins']==12110
    assert row['save']['adventure']['towerWins']==1
    record('tower: two floors, explicit cashout, no repeated payout')
    context.close()

    context,page,row,calls = new_page(browser,calm=True)
    library(page);launch(page,'Точный тап')
    for n in range(3):
        page.get_by_role('button',name='Начать' if n==0 else 'Следующий раунд',exact=True).click()
        page.get_by_role('button',name='Зелёная плитка, цель',exact=True).click()
    page.screenshot(path=str(out/'timing-result.png'),full_page=True)
    assert saved(page,row)['walletCoins']==12025
    assert row['save']['adventure']['timingWins']==1 and row['save']['adventure']['practicePlays']==11
    assert row['save']['adventure']['xp']==2540
    record('reduced-motion timing game: three rounds, one XP and coin award')
    context.close()

    context,page,row,calls = new_page(browser)
    library(page);launch(page,'Память Кнопика')
    for n in range(3):
        page.get_by_role('button',name='Начать' if n==0 else 'Следующий раунд',exact=True).click()
        tile=page.get_by_role('button',name='Плитка 1',exact=True)
        expect(tile).to_be_enabled(timeout=6000)
        for i in range(4):tile.click()
    assert saved(page,row)['walletCoins']==12025
    assert row['save']['adventure']['memoryWins']==1 and row['save']['adventure']['practicePlays']==11
    page.screenshot(path=str(out/'memory-result.png'),full_page=True)
    record('memory: observed sequence, three rounds, single award')
    context.close()

    context,page,row,calls = new_page(browser)
    library(page);launch(page,'Три барабана')
    page.get_by_role('button',name='Крутить барабаны',exact=True).click()
    expect(page.get_by_role('button',name='Вернуться в игры',exact=True)).to_be_visible(timeout=6000)
    state=saved(page,row)
    assert state['colaCount']==1 and state['slotPlays']==1 and state['adventure']['casinoPlays']==1
    record('legacy slots launched from library, one stock ticket and one round')
    context.close()

    assert not errors, errors
    browser.close()
(out/'qa-results.json').write_text(json.dumps({'checks':checks,'browserErrors':errors,'backend':'isolated in-browser Supabase responses; no production calls'},ensure_ascii=False,indent=2)+'\n')
print(f'{len(checks)} browser scenarios passed; no browser errors',flush=True)
