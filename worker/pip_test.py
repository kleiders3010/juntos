# Picture-in-picture (headless Edge, fake devices): the call in a small window over every other window.
# Checked: the button is there; the small window opens with who's in the call (Beto big, Ana small), the buttons
# work from it (mic, camera, hand, captions), notices and captions show in it, "Back to the call" closes it,
# leaving closes it; switching tabs is wired to open it; browsers without the small window float the video.
# Run: python pip_test.py [base-url]
import sys
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8797"
WS = BASE.replace("http", "ws", 1)
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
# records the media-session handlers the page sets (to see that switching tabs opens the small window)
HOOK = """
window.__ms = {};
if (navigator.mediaSession) { const o = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
  navigator.mediaSession.setActionHandler = (k, f) => { __ms[k] = f; try { o(k, f); } catch (e) { if (k !== 'enterpictureinpicture') throw e; } }; }
"""
NO_DOC_PIP = "delete window.documentPictureInPicture;"
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)

    def page(name, script=""):
        ctx = b.new_context(locale="en-US", permissions=["camera", "microphone"], viewport={"width": 1280, "height": 760})
        ctx.add_init_script(HOOK + script)
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror ({name}): {e}"))
        return pg

    def enter(pg, name, url):
        pg.goto(url)
        pg.fill("#name", name)
        pg.click("#enter")
        pg.wait_for_selector("#call:not([hidden])")

    a = page("Ana")
    a.goto(f"{BASE}/?signal={WS}")
    a.click("#start")
    a.wait_for_selector("#lobby:not([hidden])")
    a.fill("#name", "Ana")
    a.click("#enter")
    a.wait_for_selector("#call:not([hidden])")
    join = f"{a.url}{'&' if '?' in a.url else '?'}signal={WS}"
    o = page("Beto")
    enter(o, "Beto", join)
    a.wait_for_function("__S.mesh.peers.size === 1 && [...__S.mesh.peers.values()].every(p => p.dc && p.dc.readyState === 'open')", timeout=30000)
    a.wait_for_function("document.querySelector('.tile[data-id]:not([data-id=\"me\"]) video')?.srcObject", timeout=30000)

    check(a.is_visible("#bPip"), "the call has a small window button")
    has_doc = a.evaluate("'documentPictureInPicture' in window")
    check(has_doc, "this Edge has the small window (Document Picture-in-Picture)")
    a.click("#bPip")
    a.wait_for_function("window.__S.pip && __S.pip.document.querySelectorAll('#pipGrid .tile').length === 2", timeout=10000)
    w = "__S.pip.document"
    first = a.evaluate(f"{w}.querySelector('#pipGrid .tile:first-child .nm').textContent")
    check(first == "Beto" and a.evaluate(f"{w}.querySelector('#pipGrid .tile.pipMe').dataset.id") == "me",  # pinned: names this test typed
          "the small window shows Beto big and Ana herself small")
    a.wait_for_function(f"{w}.querySelector('#pipGrid .tile:first-child video').videoWidth > 0", timeout=10000)
    check(True, "Beto's video plays in it")
    check(a.evaluate(f"{w}.querySelector('#pipGrid video').muted"), "the small window adds no second copy of the sound")
    check(a.evaluate("document.querySelector('#bPip').classList.contains('on')"), "the button shows the small window is open")

    # the buttons in the small window
    a.evaluate(f"{w}.getElementById('qMic').click(); 0")
    o.wait_for_function("document.querySelector('.tile:not([data-id=\"me\"])').classList.contains('muted')", timeout=5000)
    check(not a.evaluate("__S.mic") and a.evaluate(f"{w}.getElementById('qMic').classList.contains('danger')"), "mic off from the small window (Beto sees Ana muted)")
    a.evaluate(f"{w}.getElementById('qMic').click(); 0")
    a.evaluate(f"{w}.getElementById('qCam').click(); 0")
    o.wait_for_function("document.querySelector('.tile:not([data-id=\"me\"])').classList.contains('camoff')", timeout=5000)
    check(True, "camera off from the small window")
    a.evaluate(f"{w}.getElementById('qCam').click(); 0")
    a.evaluate(f"{w}.getElementById('qHand').click(); 0")
    o.wait_for_function("!document.querySelector('.tile:not([data-id=\"me\"]) .hand').hidden", timeout=5000)
    check(a.evaluate(f"{w}.getElementById('qHand').classList.contains('on')"), "raise a hand from the small window")
    a.evaluate(f"{w}.getElementById('qHand').click(); 0")
    a.evaluate(f"{w}.getElementById('qCaps').click(); 0")
    check(a.evaluate("__S.capsOn") and a.evaluate(f"{w}.getElementById('qCaps').classList.contains('on')"), "captions on from the small window")
    a.evaluate(f"{w}.getElementById('qCaps').click(); 0")

    # notices reach the small window (Beto raises a hand)
    o.click("#grid")
    o.keyboard.press("h")
    a.wait_for_function(f"{w}.getElementById('pipToasts').textContent.includes('Beto')", timeout=5000)
    check(True, "notices show in the small window")

    # back to the call
    a.evaluate(f"{w}.getElementById('qBack').click(); 0")
    a.wait_for_function("!__S.pip", timeout=5000)
    check(not a.evaluate("document.querySelector('#bPip').classList.contains('on')"), "Back to the call closes the small window")

    # switching tabs is wired to open it
    check(a.evaluate("typeof __ms.enterpictureinpicture === 'function'"), "switching tabs can open the small window")  # pinned: the browser API name

    # leaving closes it
    a.click("#bPip")
    a.wait_for_function("!!__S.pip", timeout=10000)
    a.click("#bLeave")
    a.wait_for_selector("#ended:not([hidden])")
    a.wait_for_function("!__S.pip", timeout=5000)
    check(True, "leaving the call closes the small window")

    # a browser without the small window floats the video of who's talking
    c = page("Carla", NO_DOC_PIP)
    enter(c, "Carla", join)
    c.wait_for_function("document.querySelector('.tile[data-id]:not([data-id=\"me\"]) video')?.videoWidth > 0", timeout=30000)
    c.click("#bPip")
    c.wait_for_timeout(1500)
    el = c.evaluate("document.pictureInPictureElement ? document.pictureInPictureElement.closest('.tile').dataset.id : (document.querySelector('.toast')?.textContent || 'none')")
    check(el not in ("me", "none"), f"without the small window: someone else's video floats, or a clear note ({el})")
    b.close()

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
