# The UX review of 2026-11-22 (research/ux-review-2026-11-22/juntos.md in SelfSustainment): what its fixes must keep
# true, in headless Edge with fake devices. Back closes what is open and never leaves a call running behind the start
# page (U-J1); a refused or busy camera says so, offers Try again and its button stays off (U-J2); the toggles have
# names and states (U-J3); sheets close with Esc (U-J9); Space presses a focused button and single keys can be off
# (U-J9); a host alone sees how to invite (U-J5); errors sit under their field (U-J8); no connection shows our page,
# not the browser's (U-J14). Run: python ux_test.py [base-url]
import sys
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8798"
WS = BASE.replace("http", "ws", 1)
ARGS = ["--disable-gpu", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


def refuse(kind):
    """An init script: the camera fails with this error name (the microphone still works)."""
    return """(() => { const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (c) => c && c.video ? Promise.reject(new DOMException('test', '%s')) : g(c); })()""" % kind


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)

    def person(init=None, locale="en-US"):
        ctx = b.new_context(locale=locale, permissions=["camera", "microphone"], viewport={"width": 1200, "height": 800})
        if init:
            ctx.add_init_script(init)
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        return pg

    # U-J8: a bad code is explained under the box
    a = person()
    a.goto(f"{BASE}/?signal={WS}")
    a.fill("#joinCode", "x")
    a.press("#joinCode", "Enter")
    check(a.evaluate("!document.getElementById('joinCodeErr').hidden && document.getElementById('joinCode').getAttribute('aria-invalid') === 'true'"),
          "a bad code: the error is under the box and tied to it")  # pinned: aria-invalid is the string "true"
    a.fill("#joinCode", "ab")
    check(a.evaluate("document.getElementById('joinCodeErr').hidden"), "typing again clears it")

    # U-J3: the lobby toggles have names and say whether they are on
    a.click("#start")
    a.wait_for_selector("#lobby:not([hidden])")
    a.wait_for_function("() => !!__S.micTrack && !!__S.camTrack", timeout=15000)
    names = a.evaluate("['pMic', 'pCam'].map(id => [document.getElementById(id).getAttribute('aria-label'), document.getElementById(id).getAttribute('aria-pressed')])")
    check(names == [["Microphone", "true"], ["Camera", "true"]], f"lobby toggles are named and pressed: {names}")  # pinned: U-J3 fixed names
    a.click("#pCam")
    check(a.evaluate("document.getElementById('pCam').getAttribute('aria-pressed')") == "false", "the camera toggle says it is off")  # pinned: aria-pressed is a string
    a.click("#pCam")
    # U-J8: no name: the error is under the name field
    a.fill("#name", "")
    a.click("#enter")
    check(a.evaluate("!document.getElementById('nameErr').hidden"), "no name: the error is under the name field")
    a.fill("#name", "Ana")
    a.click("#enter")
    a.wait_for_selector("#call:not([hidden])")
    a.wait_for_function("() => __S.joined", timeout=15000)
    # U-J5: alone, the invite card is in the middle
    a.wait_for_selector("#aloneCard [name=copy]", timeout=10000)
    check(True, "alone in a new call: the invite card with Copy link is shown")

    o = person()
    o.goto(f"{a.url}{'&' if '?' in a.url else '?'}signal={WS}")
    o.fill("#name", "Beto")
    o.click("#enter")
    a.wait_for_function("() => __S.mesh.peers.size === 1", timeout=20000)
    a.wait_for_function("() => !document.getElementById('aloneCard')", timeout=5000)
    check(True, "someone joins: the invite card goes away")

    # U-J1: Back closes the open panel and stays in the call
    a.evaluate("window.__m = __S.mesh")
    a.click("#bChat")
    a.wait_for_selector("#panel:not([hidden])")
    a.go_back()
    a.wait_for_function("() => document.getElementById('panel').hidden", timeout=5000)
    check(a.evaluate("!document.getElementById('call').hidden && __S.mesh === __m"), "Back closes Chat: still in the same call")
    # with nothing open, Back asks instead of leaving or showing the start page
    a.go_back()
    a.wait_for_selector("#leaveSheet", timeout=5000)
    check(a.evaluate("!document.getElementById('call').hidden && __S.mesh === __m && document.getElementById('home').hidden"),
          "Back with nothing open: the Leave question, the call goes on")
    check(a.evaluate("document.getElementById('leaveSheet').getAttribute('role')") == "dialog", "the Leave question is a dialog")  # pinned: ARIA role name
    # U-J9: Esc closes it
    a.keyboard.press("Escape")
    a.wait_for_function("() => !document.getElementById('leaveSheet')", timeout=3000)
    check(a.evaluate("__S.mesh === __m"), "Esc closes the Leave question and the call goes on")
    a.click("#bMore")
    a.wait_for_selector(".moreSheet")
    a.keyboard.press("Escape")
    check(a.evaluate("!document.querySelector('.moreSheet')"), "Esc closes More")
    a.go_back()
    a.wait_for_selector("#leaveSheet", timeout=5000)
    check(a.evaluate("__S.mesh === __m"), "Back still works after a sheet closed with Esc")
    a.click("#stayIn")

    # U-J9: Space presses a focused bar button (it started push-to-talk)
    cam = a.evaluate("__S.cam")
    a.focus("#bCam")
    a.keyboard.press(" ")
    a.wait_for_timeout(500)
    check(a.evaluate("__S.cam") != cam and not a.evaluate("!!__S.ptt"), "Space on the focused camera button turns the camera")
    a.focus("#bCam")
    a.keyboard.press(" ")
    a.evaluate("localStorage.setItem('juntos.singleKeys', 'off'); document.activeElement.blur()")
    mic = a.evaluate("__S.mic")
    a.keyboard.press("m")
    check(a.evaluate("__S.mic") == mic, "single-key shortcuts turned off: M does nothing")
    a.evaluate("localStorage.removeItem('juntos.singleKeys')")
    a.keyboard.press("m")
    check(a.evaluate("__S.mic") != mic, "turned on again: M mutes")
    check(a.evaluate("document.getElementById('bMic').getAttribute('aria-label')") == "Microphone", "the bar's mic button is named Microphone")  # pinned: U-J3 fixed name
    check(a.evaluate("document.getElementById('toasts').getAttribute('role')") == "status", "notices are announced")  # pinned: ARIA role name

    # U-J2: a refused camera says so, offers Try again, and its button stays off
    for kind, words in (("NotAllowedError", "isn't allowed to use your camera"), ("NotReadableError", "being used by another app")):
        r = person(refuse(kind))
        r.goto(f"{a.url}{'&' if '?' in a.url else '?'}signal={WS}")
        r.wait_for_function("() => !!__S.micTrack", timeout=15000)
        msg = r.evaluate("document.getElementById('lobbyMsg').textContent")
        check(words in msg and r.evaluate("!document.getElementById('mediaRetry').hidden"), f"{kind}: the lobby says why and offers Try again ({msg[:60]})")
        r.click("#pCam")
        r.wait_for_timeout(800)
        check(r.evaluate("document.getElementById('pCam').getAttribute('aria-pressed')") == "false" and not r.evaluate("__S.cam"),  # pinned: aria-pressed is a string
              f"{kind}: turning the camera on asks again and stays off when it still fails")  # pinned: aria-pressed is a string
        r.context.close()

    # U-J3 in Spanish
    e = person(locale="es-AR")
    e.goto(f"{BASE}/r/abc-defg-hij?lang=es&signal={WS}")
    e.wait_for_selector("#lobby:not([hidden])")
    e.wait_for_function("() => !!__S.micTrack", timeout=15000)
    check(e.evaluate("document.getElementById('pMic').getAttribute('aria-label')") == "Micrófono", "in Spanish the mic is Micrófono")  # pinned: the Spanish word
    e.context.close()

    # U-J14: with no connection, our own page (the service worker keeps it), not the browser's error page
    # polled from here: an async predicate in wait_for_function passed before anything was kept (Sumate's test)
    for _ in range(40):
        if a.evaluate("async () => (await caches.keys()).includes('juntos-offline-1') && !!(await caches.match(new URL('offline', location.origin).href))"):
            break
        a.wait_for_timeout(500)
    off = a.context.new_page()
    a.context.set_offline(True)
    try:
        off.goto(f"{BASE}/", timeout=15000)
        off.wait_for_selector("#retry", timeout=10000)
        check("No connection" in off.inner_text("body"), "no connection: Juntos's own page with Try again")
    except Exception as ex:
        check(False, f"no connection: Juntos's own page ({str(ex)[:80]})")
    a.context.set_offline(False)
    b.close()

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
