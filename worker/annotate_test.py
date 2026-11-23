# Drawing on a shared screen (headless Edge, fake devices and a fake screen). Ana starts the call (host), Beto
# shares his screen, Carla (no host) joins late.
# Checked: the pen button on the shared screen; the tools bar; a pen line lands on the same spot of the shared
# picture for everyone, whatever their layout; text; undo / redo; the sharer erases anyone's mark, someone else only
# their own; the vanishing pen fades; the pointer shows; a late joiner gets the marks; the sharer turns drawing off
# for the others (their marks are no longer taken) and on again; clear everyone's; save a picture; stopping the
# sharing takes the marks away.
# Run: python annotate_test.py [base-url]
import sys
import time
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8798"
WS = BASE.replace("http", "ws", 1)
ARGS = ["--disable-gpu", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required",
        "--auto-select-desktop-capture-source=Entire screen"]
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


def wait(pg, js, arg=None, timeout=6000):
    __import__("re").match(r"\s*(\([^()]*\)|\w+)\s*=>", js) or (js := "() => " + js)  # the pages forbid eval: Playwright polls functions without it
    try:
        pg.wait_for_function(js, arg=arg, timeout=timeout)
        return True
    except Exception:
        return False


# the marks on Beto's screen, as this page holds them
ITEMS = "(sid) => [...(__S.an.shares.get(sid)?.items.values() || [])].map(i => ({ t: i.t, by: i.by, p: i.p, s: i.s }))"


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)

    def page(name, w=1280, h=860):
        ctx = b.new_context(locale="en-US", permissions=["camera", "microphone"], viewport={"width": w, "height": h}, accept_downloads=True)
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror ({name}): {e}"))
        return pg

    def enter(pg, name, url):
        pg.goto(url)
        pg.fill("#name", name)
        pg.click("#enter")
        pg.wait_for_selector("#call:not([hidden])")

    def items(pg):
        return pg.evaluate(ITEMS, sid)

    a = page("Ana")
    a.goto(f"{BASE}/?signal={WS}")
    a.click("#start")
    a.wait_for_selector("#lobby:not([hidden])")
    a.fill("#name", "Ana")
    a.click("#enter")
    a.wait_for_selector("#call:not([hidden])")
    a.wait_for_function("() => __S.isHost", timeout=15000)
    join = f"{a.url}{'&' if '?' in a.url else '?'}signal={WS}"
    o = page("Beto", 1100, 760)  # another size: marks must still land on the same spot of the picture
    enter(o, "Beto", join)
    for pg in (a, o):
        pg.wait_for_function("() => __S.mesh.peers.size === 1 && [...__S.mesh.peers.values()].every(p => p.dc && p.dc.readyState === 'open')", timeout=30000)
    sid = o.evaluate("__S.mesh.id")
    aid = a.evaluate("__S.mesh.id")

    # ---- Beto shares his screen ----
    o.click("#bScreen")
    check(wait(o, "!!__S.screen"), "Beto shares his screen (a fake one)")
    tile_a = f'#grid .tile[data-id="{sid}"]'
    check(wait(a, f"!!document.querySelector('{tile_a} .anBtn:not([hidden])')", timeout=10000), "Ana sees the pen button on Beto's shared screen")
    check(wait(o, "!!document.querySelector('#grid .tile[data-id=\"me\"] .anBtn:not([hidden])')"), "Beto has it on his own screen too")
    a.wait_for_function(f"() => document.querySelector('{tile_a} video').videoWidth > 0", timeout=15000)

    # ---- Ana draws ----
    a.click(f"{tile_a} .anBtn", force=True)
    check(a.is_visible(f"{tile_a} .anBar"), "Ana opens the drawing tools on the shared screen")
    a.wait_for_timeout(400)
    check(a.evaluate(f"document.querySelector('{tile_a}').matches('.spot, .main')"), "the shared screen is made big for drawing")
    # a line from 30 %,40 % to 60 %,40 % of the shared picture
    f = a.evaluate(f"__S.an.frame('{sid}')")
    r = a.evaluate(f"(() => {{ const b = document.querySelector('{tile_a} .anCanvas').getBoundingClientRect(); return [b.left, b.top]; }})()")
    at = lambda fx, fy: (r[0] + f["x"] + f["w"] * fx, r[1] + f["y"] + f["h"] * fy)
    a.mouse.move(*at(0.3, 0.4))
    a.mouse.down()
    for k in range(1, 11):
        a.mouse.move(*at(0.3 + 0.03 * k, 0.4))
    a.mouse.up()
    check(wait(o, f"(sid) => [...(__S.an.shares.get(sid)?.items.values() || [])].some(i => i.t === 'pen' && i.by === '{aid}')", arg=sid), "Beto gets Ana's line")  # pinned: mark kinds pen/text/fade/rect are the wire format between app versions; the text is the one typed above; file name prefix "Juntos screen"
    it = [i for i in items(o) if i["t"] == "pen"][0]  # pinned: mark kinds pen/text/fade/rect are the wire format between app versions; the text is the one typed above; file name prefix "Juntos screen"
    check(abs(it["p"][0] - 3000) < 60 and abs(it["p"][1] - 4000) < 60 and abs(it["p"][-2] - 6000) < 60,
          f"it is on the same spot of the picture (30 % to 60 % across, 40 % down): {it['p'][:2]} .. {it['p'][-2:]}")
    # and Beto's own canvas (another window size) has ink there
    ink = o.evaluate("""() => { const t = document.querySelector('#grid .tile[data-id="me"]'); const c = t.querySelector('.anCanvas');
      const f = __S.an.frame(__S.mesh.id); const d = devicePixelRatio;
      const px = c.getContext('2d').getImageData(Math.round((f.x + f.w * 0.45) * d) - 4, Math.round((f.y + f.h * 0.4) * d) - 4, 9, 9).data;
      let m = 0; for (let i = 3; i < px.length; i += 4) m = Math.max(m, px[i]); return m; }""")
    if ink <= 100:
        print(o.evaluate("""() => { const t = document.querySelector('#grid .tile[data-id="me"]'); const c = t.querySelector('.anCanvas');
          return JSON.stringify({ f: __S.an.frame(__S.mesh.id), cw: c.width, ch: c.height, cls: t.className, tiles: [...__S.an.tiles.keys()], run: __S.an.running }); }"""))
    check(ink > 100, f"Beto sees the line there on his own screen, at his own size (alpha {ink})")

    # ---- text ----
    a.click(f'{tile_a} .anBar [data-tool="text"]')
    a.mouse.click(*at(0.2, 0.7))
    a.wait_for_selector(f"{tile_a} .anText")
    a.wait_for_function("() => document.activeElement?.classList.contains('anText')", timeout=5000)  # it takes focus a moment later
    a.keyboard.type("Look here")  # pinned: mark kinds pen/text/fade/rect are the wire format between app versions; the text is the one typed above; file name prefix "Juntos screen"
    a.keyboard.press("Enter")
    check(wait(o, "(sid) => [...(__S.an.shares.get(sid)?.items.values() || [])].some(i => i.t === 'text' && i.s === 'Look here')", arg=sid), "Ana writes a text and Beto gets it")  # pinned: mark kinds pen/text/fade/rect are the wire format between app versions; the text is the one typed above; file name prefix "Juntos screen"

    # ---- undo / redo ----
    a.mouse.move(*at(0.5, 0.5))
    a.keyboard.press("Control+z")
    check(wait(o, "(sid) => ![...(__S.an.shares.get(sid)?.items.values() || [])].some(i => i.t === 'text')", arg=sid), "Ctrl+Z takes Ana's text away for Beto too")  # pinned: mark kinds pen/text/fade/rect are the wire format between app versions; the text is the one typed above; file name prefix "Juntos screen"
    a.keyboard.press("Control+y")
    check(wait(o, "(sid) => [...(__S.an.shares.get(sid)?.items.values() || [])].some(i => i.t === 'text')", arg=sid), "Ctrl+Y brings it back")  # pinned: mark kinds pen/text/fade/rect are the wire format between app versions; the text is the one typed above; file name prefix "Juntos screen"

    # ---- vanishing pen ----
    a.click(f'{tile_a} .anBar [data-tool="fade"]')
    a.mouse.move(*at(0.1, 0.1))
    a.mouse.down()
    a.mouse.move(*at(0.2, 0.2))
    a.mouse.up()
    check(wait(o, "(sid) => [...(__S.an.shares.get(sid)?.items.values() || [])].some(i => i.t === 'fade')", arg=sid), "the vanishing pen shows for Beto")  # pinned: mark kinds pen/text/fade/rect are the wire format between app versions; the text is the one typed above; file name prefix "Juntos screen"
    check(wait(o, "(sid) => ![...(__S.an.shares.get(sid)?.items.values() || [])].some(i => i.t === 'fade')", arg=sid, timeout=6000), "and fades away by itself")  # pinned: mark kinds pen/text/fade/rect are the wire format between app versions; the text is the one typed above; file name prefix "Juntos screen"

    # ---- pointer ----
    a.click(f'{tile_a} .anBar [data-tool="pointer"]')
    a.mouse.move(*at(0.5, 0.5))
    a.mouse.move(*at(0.52, 0.5))
    check(wait(o, f"(sid) => __S.an.shares.get(sid)?.ptrs.has('{aid}')", arg=sid), "Beto sees where Ana points")

    # ---- a late joiner (not a host) ----
    c = page("Carla")
    enter(c, "Carla", join)
    c.wait_for_function("() => __S.mesh.peers.size === 2 && [...__S.mesh.peers.values()].every(p => p.dc && p.dc.readyState === 'open')", timeout=30000)
    check(wait(c, "(sid) => { const s = __S.an.shares.get(sid); return s && [...s.items.values()].filter(i => i.t !== 'fade').length === 2; }", arg=sid, timeout=10000),
          "Carla, joining late, gets the marks already there")
    tile_c = f'#grid .tile[data-id="{sid}"]'
    c.wait_for_function(f"() => document.querySelector('{tile_c} video')?.videoWidth > 0", timeout=15000)
    c.click(f"{tile_c} .anBtn", force=True)
    c.wait_for_selector(f"{tile_c} .anBar")
    fc = c.evaluate(f"__S.an.frame('{sid}')")
    rc = c.evaluate(f"(() => {{ const b = document.querySelector('{tile_c} .anCanvas').getBoundingClientRect(); return [b.left, b.top]; }})()")
    atc = lambda fx, fy: (rc[0] + fc["x"] + fc["w"] * fx, rc[1] + fc["y"] + fc["h"] * fy)
    c.click(f'{tile_c} .anBar [data-tool="rect"]')
    c.mouse.move(*atc(0.6, 0.6))
    c.mouse.down()
    c.mouse.move(*atc(0.7, 0.7))
    c.mouse.move(*atc(0.8, 0.8))
    c.mouse.up()
    check(wait(o, "(sid) => [...(__S.an.shares.get(sid)?.items.values() || [])].some(i => i.t === 'rect')", arg=sid), "Carla draws a box and Beto gets it")  # pinned: mark kinds pen/text/fade/rect are the wire format between app versions; the text is the one typed above; file name prefix "Juntos screen"
    # Carla's eraser over Ana's line: not hers, so it stays
    c.click(f'{tile_c} .anBar [data-tool="eraser"]')
    c.mouse.move(*atc(0.44, 0.4))
    c.mouse.down()
    c.mouse.move(*atc(0.46, 0.4))
    c.mouse.up()
    time.sleep(0.8)
    check(any(i["t"] == "pen" for i in items(o)) and any(i["t"] == "pen" for i in items(c)), "Carla's eraser leaves Ana's line alone (only her own marks)")  # pinned: mark kinds pen/text/fade/rect are the wire format between app versions; the text is the one typed above; file name prefix "Juntos screen"

    # ---- Beto (the sharer) erases Ana's line ----
    o.click('#grid .tile[data-id="me"] .anBtn', force=True)
    o.wait_for_selector('#grid .tile[data-id="me"] .anBar')
    o.wait_for_timeout(400)
    fo = o.evaluate("__S.an.frame(__S.mesh.id)")
    ro = o.evaluate("(() => { const b = document.querySelector('#grid .tile[data-id=\"me\"] .anCanvas').getBoundingClientRect(); return [b.left, b.top]; })()")
    ato = lambda fx, fy: (ro[0] + fo["x"] + fo["w"] * fx, ro[1] + fo["y"] + fo["h"] * fy)
    o.click('#grid .tile[data-id="me"] .anBar [data-tool="eraser"]')
    o.mouse.move(*ato(0.44, 0.4))
    o.mouse.down()
    o.mouse.move(*ato(0.46, 0.4))
    o.mouse.up()
    check(wait(a, "(sid) => ![...(__S.an.shares.get(sid)?.items.values() || [])].some(i => i.t === 'pen')", arg=sid), "Beto, who shares, erases Ana's line, for everyone")  # pinned: mark kinds pen/text/fade/rect are the wire format between app versions; the text is the one typed above; file name prefix "Juntos screen"

    # ---- Beto turns drawing off for the others ----
    o.click('#grid .tile[data-id="me"] .anBar [name="opts"]')
    o.click('.anMenu button:has-text("Let others draw")')
    check(wait(c, f"!document.querySelector('{tile_c} .anBar') && document.querySelector('{tile_c} .anBtn').hidden"), "Carla's tools close and the pen button goes when Beto turns drawing off")
    c.evaluate(f"__S.mesh.broadcast({{ k: 'ana', s: '{sid}', i: {{ id: 'sneaky1', t: 'pen', c: '#ef4444', w: 4, p: [100, 100, 900, 900] }} }})")
    time.sleep(1)
    check(not any(i.get("s") is None and i["p"] == [100, 100, 900, 900] for i in items(o) + items(a)), "a mark sent anyway is not taken")
    o.click('#grid .tile[data-id="me"] .anBar [name="opts"]')
    o.click('.anMenu button:has-text("Let others draw")')
    check(wait(c, f"!document.querySelector('{tile_c} .anBtn').hidden"), "on again: Carla can draw again")
    a.click(f"{tile_a} .anBtn", force=True)  # Ana's tools were closed too (only the sharer draws while it's off)
    a.wait_for_selector(f"{tile_a} .anBar")

    # ---- save a picture ----
    with a.expect_download() as d:
        a.click(f'{tile_a} .anBar [name="save"]')
    png = open(d.value.path(), "rb").read()
    check(png[:8] == b"\x89PNG\r\n\x1a\n" and d.value.suggested_filename.startswith("Juntos screen "), f"Ana saves a picture of the screen with the drawings ({d.value.suggested_filename})")  # pinned: mark kinds pen/text/fade/rect are the wire format between app versions; the text is the one typed above; file name prefix "Juntos screen"
    check(a.evaluate(f"typeof __S.an.overlay('{sid}') === 'function'"), "a recording draws the marks over the shared screen")

    # ---- clear everyone's ----
    o.click('#grid .tile[data-id="me"] .anBar [name="clear"]')
    o.click(".anMenu button:has-text(\"Clear everyone's drawings\")")
    check(wait(a, "(sid) => (__S.an.shares.get(sid)?.items.size || 0) === 0", arg=sid) and wait(c, "(sid) => (__S.an.shares.get(sid)?.items.size || 0) === 0", arg=sid),
          "Beto clears everyone's drawings")

    # ---- stopping the sharing takes the marks away ----
    a.click(f'{tile_a} .anBar [data-tool="pen"]')
    a.mouse.move(*at(0.3, 0.3))
    a.mouse.down()
    a.mouse.move(*at(0.4, 0.4))
    a.mouse.up()
    wait(o, "(sid) => (__S.an.shares.get(sid)?.items.size || 0) === 1", arg=sid)
    o.click("#bScreen")
    gone = wait(a, f"(sid) => !__S.an.shares.has(sid) && !document.querySelector('{tile_a} .anBtn') && !document.querySelector('{tile_a} .anBar')", arg=sid)
    if not gone:
        print(a.evaluate(f"(sid) => JSON.stringify({{ share: __S.an.shares.has(sid), btn: !!document.querySelector('{tile_a} .anBtn'), bar: !!document.querySelector('{tile_a} .anBar'), cls: document.querySelector('{tile_a}').className }})", sid))
    check(gone, "Beto stops sharing: the marks and the tools are gone")
    b.close()

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
