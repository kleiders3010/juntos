# Nothing hangs on the camera: with every camera off, a shared screen still goes out and is seen (by the others
# and on your own tile), and goes back to the name when sharing stops. Your own tile lights up while you talk
# (a sign the microphone works) and stays dark while muted. (Kleider, 2026-11-18: "share screen on pc does not
# work unless you have the camera up... You need to stop connecting everything to the camera".)
# Run: python nocam_test.py [base-url]
import sys
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8798"
WS = BASE.replace("http", "ws", 1)
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--auto-select-desktop-capture-source=Entire screen"]
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


def wait(pg, js, timeout=8000):
    __import__("re").match(r"\s*(\([^()]*\)|\w+)\s*=>", js) or (js := "() => " + js)  # the pages forbid eval: Playwright polls functions without it
    try:
        pg.wait_for_function(js, timeout=timeout)
        return True
    except Exception:
        return False


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)

    def page(name):
        pg = b.new_context(locale="en-US", permissions=["camera", "microphone"], viewport={"width": 1280, "height": 760}).new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror ({name}): {e}"))
        return pg

    def enter(pg, name, url):
        pg.goto(url)
        if pg.query_selector("#start") and pg.is_visible("#start"):
            pg.click("#start")
        pg.wait_for_selector("#lobby:not([hidden])")
        pg.click("#pCam")  # camera off before joining
        pg.fill("#name", name)
        pg.click("#enter")
        pg.wait_for_selector("#call:not([hidden])")

    a = page("Ana")
    enter(a, "Ana", f"{BASE}/?signal={WS}")
    o = page("Beto")
    enter(o, "Beto", f"{a.url}{'&' if '?' in a.url else '?'}signal={WS}")
    for pg in (a, o):
        pg.wait_for_function("() => __S.mesh.peers.size === 1 && [...__S.mesh.peers.values()].every(p => p.dc && p.dc.readyState === 'open')", timeout=30000)
    check(not a.evaluate("__S.cam") and not o.evaluate("__S.cam"), "both cameras are off")
    sid = o.evaluate("__S.mesh.id")
    tile = f'#grid .tile[data-id="{sid}"]'

    # my own tile lights up while I talk (the fake microphone beeps), and stays dark while muted
    check(wait(a, "document.querySelector('#grid .tile[data-id=\"me\"]').classList.contains('speaking')", 8000), "my own tile lights up when my microphone hears me")
    a.click("#bMic")
    a.wait_for_function("() => !__S.mic", timeout=3000)
    a.evaluate("window.__lit = false; window.__w = setInterval(() => { if (document.querySelector('#grid .tile[data-id=\"me\"]').classList.contains('speaking')) __lit = true }, 50)")
    a.wait_for_timeout(2500)
    check(not a.evaluate("__lit"), "muted: my own tile stays dark")
    a.click("#bMic")

    # Beto shares his screen with his camera off
    o.click("#bScreen")
    check(wait(o, "!!__S.screen"), "Beto shares his screen with the camera off")
    check(wait(o, "!document.querySelector('#grid .tile[data-id=\"me\"]').classList.contains('camoff')"), "Beto sees his shared screen on his own tile")
    check(wait(a, f"!document.querySelector('{tile}').classList.contains('camoff') && document.querySelector('{tile}').classList.contains('screen')"),
          "Ana's tile for Beto shows the picture, not just his name")
    check(wait(a, f"document.querySelector('{tile} video').videoWidth > 0", 15000), "the shared screen really arrives at Ana (frames)")
    t1 = a.evaluate(f"document.querySelector('{tile} video').currentTime")
    a.wait_for_timeout(1500)
    check(a.evaluate(f"document.querySelector('{tile} video').currentTime") > t1, "and keeps playing")
    check(a.evaluate(f"getComputedStyle(document.querySelector('{tile} video')).visibility") == "visible", "the picture is visible on Ana's screen")  # pinned: a shared screen is shown, never hidden by camera state

    # stop sharing: back to the name, camera still off
    o.click("#bScreen")
    check(wait(o, "!__S.screen"), "Beto stops sharing")
    check(wait(a, f"document.querySelector('{tile}').classList.contains('camoff')"), "Ana sees Beto's name again (his camera is still off)")
    check(not o.evaluate("__S.cam"), "stopping the share doesn't turn the camera on")
    b.close()

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
