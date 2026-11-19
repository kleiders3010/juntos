# Layouts (headless Edge, fake devices), three people: Auto / Tiled / Spotlight / Sidebar, pinning someone,
# who's talking takes the big place, a shared screen leads, hide people with the camera off, your own picture
# with everyone / small in a corner / hidden, choices remembered, the big board still works.
# Saves screenshots. Run: python layout_test.py [base-url]
import os, sys, tempfile
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8797"
WS = BASE.replace("http", "ws", 1)
OUT = os.environ.get("LAYOUT_OUT") or tempfile.mkdtemp()
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
PHONE = dict(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
# what each tile is doing: name -> [shown, main, floating, width, height]
TILES = """[...document.querySelectorAll('#grid .tile')].map(t => { const r = t.getBoundingClientRect();
  return [t.querySelector('.nm').textContent.split(' ')[0], getComputedStyle(t).display !== 'none', t.classList.contains('main'), t.classList.contains('floatMe'), Math.round(r.width), Math.round(r.height)] })"""
TONE = """() => { const ac = new AudioContext(), o = ac.createOscillator(), d = ac.createMediaStreamDestination(), g = ac.createGain();
  g.gain.value = 0.3; o.connect(g); g.connect(d); o.start(); __S.micTrack = d.stream.getAudioTracks()[0]; return __S.mesh.setTracks(__S.micTrack, __S.mesh.videoTrack) }"""
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


def tiles(pg):
    return {r[0]: r[1:] for r in pg.evaluate(TILES)}


def choose(pg, key, value):
    if not pg.query_selector(".layoutSheet"):
        pg.evaluate("(() => { if (!(document.getElementById('bLayout') || __S.barBtns.bLayout)) document.getElementById('bMore')?.click(); (document.getElementById('bLayout') || __S.barBtns.bLayout).click() })()")
        pg.wait_for_selector(".layoutSheet")
    pg.click(f'.layoutSheet .seg[data-key="{key}"] button[data-v="{value}"]')
    pg.wait_for_timeout(250)


def close_sheet(pg):
    if pg.query_selector(".layoutSheet"):
        pg.click(".layoutSheet .primary")


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)

    def person(name, url, **opts):
        pg = b.new_context(locale="en-US", permissions=["camera", "microphone"], **opts).new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror ({name}): {e}"))
        pg.goto(url)
        if "/r/" not in url:
            pg.click("#start")
        pg.fill("#name", name)
        pg.click("#enter")
        pg.wait_for_selector("#call:not([hidden])")
        return pg

    a = person("Ana", f"{BASE}/?signal={WS}", viewport={"width": 1280, "height": 760})
    join = f"{a.url}{'&' if '?' in a.url else '?'}signal={WS}"
    o = person("Beto", join)
    c = person("Caro", join, **PHONE)
    a.wait_for_function("document.querySelectorAll('#grid .tile video').length === 3 && [...__S.mesh.peers.values()].every(p => p.state === 'connected')", timeout=30000)
    # quiet everyone (the fake microphones beep), so who talks is clear
    for pg in (a, o, c):
        pg.evaluate("document.getElementById('bMic').click()")
    a.wait_for_timeout(1500)

    t0 = tiles(a)
    check(a.evaluate("document.getElementById('grid').dataset.mode") == "tiled" and len({v[2] for v in t0.values()}) == 1, f"auto with no screen: everyone the same size {t0}")  # pinned: layout ids auto/tiled/spotlight/sidebar are stored on devices

    # spotlight: only one person shows; when Caro talks, she takes it
    choose(a, "layout", "spotlight")
    t1 = tiles(a)
    shown = [k for k, v in t1.items() if v[0]]
    check(len(shown) == 1 and t1[shown[0]][1] and shown[0] != "Ana", f"spotlight: only one person, not me ({shown})")
    c.evaluate(TONE)
    c.evaluate("document.getElementById('bMic').click()")
    a.wait_for_function("document.querySelector('#grid .tile.main .nm').textContent.startsWith('Caro')", timeout=10000)
    check(True, "Caro talks: she takes the spotlight")
    a.screenshot(path=f"{OUT}/spotlight.png")

    # sidebar: Caro big, the others in a column on the right
    choose(a, "layout", "sidebar")
    t2 = tiles(a)
    main = [k for k, v in t2.items() if v[1]]
    side = [k for k, v in t2.items() if v[0] and not v[1]]
    check(main == ["Caro"] and sorted(side) == ["Ana", "Beto"], f"sidebar: Caro big, Ana and Beto beside ({t2})")
    check(all(t2[k][3] < t2["Caro"][3] / 3 for k in side), "the others are small")
    boxes = a.evaluate("[...document.querySelectorAll('#grid .tile')].filter(t => !t.classList.contains('main')).map(t => t.getBoundingClientRect().left)")
    mainbox = a.evaluate("document.querySelector('#grid .tile.main').getBoundingClientRect().right")
    check(all(x >= mainbox for x in boxes), "they sit to the right of the big one, not on top of it")
    a.screenshot(path=f"{OUT}/sidebar.png")

    # pin Beto: he leads even while Caro talks
    close_sheet(a)
    a.click('#grid .tile:has(.nm:text-matches("^Beto")) .fsBtn', force=True)
    a.wait_for_timeout(400)
    check(a.evaluate("document.querySelector('#grid .tile.main .nm').textContent.startsWith('Beto')"), "pinning Beto puts him big, even while Caro talks")
    a.keyboard.press("Escape")
    a.wait_for_function("document.querySelector('#grid .tile.main .nm').textContent.startsWith('Caro')", timeout=5000)
    check(True, "Esc unpins: back to who's talking")

    # own picture: small in a corner, then hidden
    choose(a, "layout", "tiled")
    choose(a, "self", "float")
    t3 = tiles(a)
    check(t3["Ana"][2] and t3["Ana"][3] < t3["Beto"][3] / 2, f"my picture small in a corner ({t3['Ana']})")
    a.screenshot(path=f"{OUT}/tiled-float.png")
    choose(a, "self", "hide")
    check(not tiles(a)["Ana"][0], "my picture hidden")
    check(o.evaluate("[...document.querySelectorAll('#grid .tile .nm')].some(n => n.textContent.startsWith('Ana') && n.closest('.tile').offsetParent)"), "Beto still sees Ana")

    # hide people with the camera off
    o.evaluate("document.getElementById('bCam').click()")
    a.wait_for_function("document.querySelector('#grid .tile:not([data-id=\"me\"]) .nm') && [...document.querySelectorAll('#grid .tile.camoff')].length === 1", timeout=8000)
    a.check('.layoutSheet input[name="hideNoVideo"]')
    a.wait_for_timeout(250)
    check(not tiles(a)["Beto"][0] and tiles(a)["Caro"][0], "Beto's camera is off: he's hidden, Caro still shows")
    close_sheet(a)

    # remembered after a reload
    a.goto(join)  # the link with the test server in it (a bare reload would reach the live one)
    a.fill("#name", "Ana")
    a.click("#enter")
    a.wait_for_selector("#call:not([hidden])")
    view = a.evaluate("__S.view")
    check(view == {"layout": "tiled", "hideNoVideo": True, "self": "hide"}, f"choices remembered ({view})")  # pinned: the saved view format juntos.view
    choose(a, "self", "grid")
    choose(a, "layout", "auto")
    a.uncheck('.layoutSheet input[name="hideNoVideo"]')
    close_sheet(a)

    # auto: a shared screen leads, with the people beside (Caro's picture stands in for a screen)
    a.wait_for_function("document.querySelectorAll('#grid .tile video').length === 3", timeout=30000)
    c.wait_for_function("__S.mesh.peers.size === 2 && [...__S.mesh.peers.values()].every(p => p.dc.readyState === 'open')", timeout=30000)
    c.evaluate("__S.mesh.broadcast({ k: 'state', mic: true, cam: true, screen: true })")
    a.wait_for_function("document.getElementById('grid').dataset.mode === 'sidebar'", timeout=8000)
    check(a.evaluate("document.querySelector('#grid .tile.main .nm').textContent.startsWith('Caro')"), "auto: someone shares their screen, it goes big with the people beside")
    c.evaluate("__S.mesh.broadcast({ k: 'state', mic: true, cam: true, screen: false })")
    a.wait_for_function("document.getElementById('grid').dataset.mode === 'tiled'", timeout=8000)
    check(True, "they stop sharing: back to everyone the same size")

    # Caro's phone: sidebar is a row at the bottom
    choose(c, "layout", "sidebar")
    close_sheet(c)
    c.wait_for_timeout(300)
    rows = c.evaluate("[...document.querySelectorAll('#grid .tile')].map(t => [t.classList.contains('main'), t.getBoundingClientRect().top, t.getBoundingClientRect().bottom])")
    mb = [r for r in rows if r[0]][0]
    check(all(r[1] >= mb[2] - 1 for r in rows if not r[0]), "on a phone, the others sit in a row under the big one")
    c.screenshot(path=f"{OUT}/phone-sidebar.png")

    # the big board still floats everyone, whatever the layout
    choose(a, "layout", "spotlight")
    close_sheet(a)
    a.evaluate("(() => { if (!(document.getElementById('bBoard') || __S.barBtns.bBoard)) document.getElementById('bMore')?.click(); (document.getElementById('bBoard') || __S.barBtns.bBoard).click() })()")
    a.wait_for_selector("#boardPane:not([hidden]) .bTool")
    a.click("#boardMax")
    a.wait_for_timeout(400)
    t4 = tiles(a)
    check(all(v[0] for v in t4.values()) and all(v[3] < 200 for v in t4.values()), f"big board: everyone small and floating ({t4})")
    a.click("#panelClose")
    a.wait_for_timeout(300)
    check(a.evaluate("document.getElementById('grid').dataset.mode") == "spotlight", "closing the board goes back to the chosen layout")  # pinned: layout ids are stored on devices
    b.close()

print("screens:", OUT)
print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
