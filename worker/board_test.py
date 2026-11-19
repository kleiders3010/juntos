# Board checks, Ana on a computer and Beto on a phone (headless Edge, fake devices): what one draws arrives
# the same for the other (same board coordinates whatever the screen shape), each moves and zooms their own
# view, the eraser and undo, Clear asks first, the big board with people floating, recording the big board,
# and a latecomer gets the whole board. Saves screenshots for a look. Run: python board_test.py [base-url]
import os, sys, tempfile
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8797"
WS = BASE.replace("http", "ws", 1)
OUT = os.environ.get("BOARD_OUT") or tempfile.mkdtemp()
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
PHONE = dict(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
ITEMS = "JSON.stringify(__S.board.items.map(i => [i.t, i.x1 ?? i.x ?? i.pts?.[0]?.[0], i.y1 ?? i.y ?? i.pts?.[0]?.[1]]).sort())"
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


def board_box(pg):
    return pg.evaluate("(() => { const r = document.getElementById('boardCanvas').getBoundingClientRect(); return [r.x, r.y, r.width, r.height] })()")


def drag(pg, tool, a, b, steps=8):
    pg.click(f'.bTool[data-tool="{tool}"]')
    x, y, w, h = board_box(pg)
    pg.mouse.move(x + w * a[0], y + h * a[1])
    pg.mouse.down()
    pg.mouse.move(x + w * b[0], y + h * b[1], steps=steps)
    pg.mouse.up()


def open_board(pg):
    pg.evaluate("(() => { if (!(document.getElementById('bBoard') || __S.barBtns.bBoard)) document.getElementById('bMore')?.click(); (document.getElementById('bBoard') || __S.barBtns.bBoard).click() })()")
    pg.wait_for_selector("#boardPane:not([hidden]) .bTool")
    pg.wait_for_timeout(300)


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)

    def person(name, url, **opts):
        pg = b.new_context(locale="en-US", permissions=["camera", "microphone"], accept_downloads=True, **opts).new_page()
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
    o = person("Beto", join, **PHONE)
    a.wait_for_function("[...__S.mesh.peers.values()][0]?.dc.readyState === 'open'", timeout=20000)
    open_board(a)
    drag(a, "pen", (.2, .3), (.4, .5))
    drag(a, "rect", (.5, .2), (.7, .4))
    drag(a, "ellipse", (.5, .5), (.7, .7))
    drag(a, "arrow", (.2, .7), (.4, .8))
    a.click('.bTool[data-tool="text"]')
    x, y, w, h = board_box(a)
    a.mouse.click(x + w * .25, y + h * .15)
    a.wait_for_selector(".boardText")
    a.keyboard.type("Hola")
    a.keyboard.press("Enter")
    a.wait_for_timeout(500)
    kinds = sorted(a.evaluate("__S.board.items.map(i => i.t)"))
    check(kinds == sorted(["pen", "rect", "ellipse", "arrow", "text"]), f"pen, rectangle, circle, arrow and text all draw ({kinds})")
    open_board(o)
    o.wait_for_timeout(300)
    check(a.evaluate(ITEMS) == o.evaluate(ITEMS), "Beto's phone has the same drawings at the same board places")
    o.screenshot(path=f"{OUT}/phone-board.png")
    a.screenshot(path=f"{OUT}/pc-board.png")

    # each person's own view: zoom and move on Ana's side don't move Beto's
    beto_view = o.evaluate("JSON.stringify(__S.board.view)")
    z0 = a.evaluate("__S.board.view.z")
    label0 = a.evaluate("document.querySelector('.zLabel').textContent")
    a.click(".boardZoom button:last-child")
    check(a.evaluate("__S.board.view.z") > z0 and a.evaluate("document.querySelector('.zLabel').textContent") != label0, "+ zooms in and the zoom figure follows")
    vx = a.evaluate("__S.board.view.x")
    drag(a, "hand", (.5, .5), (.3, .5))
    check(a.evaluate("__S.board.view.x") > vx, "the hand moves the board")
    n = a.evaluate("__S.board.items.length")
    check(a.evaluate("__S.board.items.length") == n, "moving the board draws nothing")
    a.mouse.move(x + w * .5, y + h * .5)
    a.mouse.wheel(0, 200)
    check(a.evaluate("__S.board.view.y") != 0, "the wheel moves the board too")
    a.click(".zLabel")
    check(o.evaluate("JSON.stringify(__S.board.view)") == beto_view, "Beto's view did not move")

    # eraser: wipe across the pen line; it goes for both
    a.evaluate("(() => { const b = __S.board, it = b.items.find(i => i.t === 'pen'); const r = b.canvas.getBoundingClientRect(), v = b.view;"
               "const mid = it.pts[Math.floor(it.pts.length / 2)]; window.__penAt = [r.x + (mid[0] - v.x) * v.z, r.y + (mid[1] - v.y) * v.z] })()")
    px, py = a.evaluate("__penAt")
    a.click('.bTool[data-tool="eraser"]')
    a.mouse.move(px - 20, py - 20)
    a.mouse.down()
    a.mouse.move(px + 20, py + 20, steps=10)
    a.mouse.up()
    a.wait_for_timeout(300)
    check("pen" not in a.evaluate("__S.board.items.map(i => i.t)") and "pen" not in o.evaluate("__S.board.items.map(i => i.t)"), "the eraser removes the line for both")
    before = a.evaluate("__S.board.items.length")
    a.click(".bActions .bUndo")
    a.wait_for_timeout(300)
    check(a.evaluate("__S.board.items.length") == before - 1 and o.evaluate("__S.board.items.length") == before - 1, "undo takes back my last drawing, for both")

    # Beto draws with a finger; Ana gets it
    x2, y2, w2, h2 = board_box(o)
    o.click('.bTool[data-tool="pen"]')
    o.evaluate("""([x, y]) => { const c = document.getElementById('boardCanvas'); const ev = (type, dx) => c.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', clientX: x + dx, clientY: y + dx, bubbles: true, isPrimary: true }));
      ev('pointerdown', 0); for (let i = 1; i <= 10; i++) ev('pointermove', i * 8); ev('pointerup', 80) }""", [x2 + w2 * .3, y2 + h2 * .4])
    a.wait_for_timeout(400)
    check(a.evaluate("__S.board.items.length") == o.evaluate("__S.board.items.length") == before, "Beto's finger drawing reaches Ana")

    # the big board: people small and floating, the board takes the stage
    a.click("#boardMax")
    a.wait_for_timeout(400)
    big = a.evaluate("(() => { const s = document.querySelector('.stage').getBoundingClientRect(), p = document.getElementById('panel').getBoundingClientRect(), t = document.querySelector('.tile').getBoundingClientRect(); return [p.width / s.width, t.width] })()")
    check(big[0] > .9 and big[1] < 200, f"big board: it fills the stage ({big[0]:.2f}) and people float small ({big[1]:.0f} px)")
    a.screenshot(path=f"{OUT}/pc-board-big.png")
    o.click("#boardMax")
    o.wait_for_timeout(400)
    o.screenshot(path=f"{OUT}/phone-board-big.png")
    # recording while the board is big: the board is the main picture
    a.evaluate("(document.getElementById('bRec') || __S.barBtns.bRec).click()")
    a.click("#recGo")
    a.wait_for_timeout(800)
    check(a.evaluate("__S.recorder.main") == "board", "recording with the big board shows the board")  # pinned: the board's pseudo-tile id in recordings
    with a.expect_download(timeout=20000):
        a.evaluate("(document.getElementById('bRec') || __S.barBtns.bRec).click()")

    # Clear asks first; the second tap clears for everyone
    a.click(".bActions .chip:not(.bUndo)")
    check(a.evaluate("__S.board.items.length") > 0, "one tap on Clear only asks")
    c = person("Caro", join)
    c.wait_for_timeout(2500)
    open_board(c)
    check(c.evaluate(ITEMS) == a.evaluate(ITEMS), "a latecomer gets the whole board")
    a.click(".bActions .chip:not(.bUndo)")
    a.click(".bActions .chip:not(.bUndo)")
    a.wait_for_timeout(400)
    check(a.evaluate("__S.board.items.length") == 0 and o.evaluate("__S.board.items.length") == 0 and c.evaluate("__S.board.items.length") == 0, "the second tap clears it for everyone")
    a.click("#panelClose")
    check(not a.evaluate("document.body.classList.contains('boardBig')"), "closing the board brings the call back")
    b.close()

print("screens:", OUT)
print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
