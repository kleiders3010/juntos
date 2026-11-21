# Who can join (headless Edge, fake devices), like Zoom's passcode and waiting room and Meet's "Quick access" off:
# the start page offers "people ask to join" and a passcode; the lobby asks for the passcode only when the call has
# one; a wrong one is refused, too many wrong tries wait; a link with the passcode in it joins without typing; the
# host lets several people in at once, changes or removes the passcode; a planned call holds its passcode before
# its host arrives. Run: python secure_test.py [base-url]
import json
import sys
import urllib.request
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8798"
# JUNTOS_SIGNAL: another room server (the Kinetic one: kinetic/server.mjs) with the same protocol
WS = __import__("os").environ.get("JUNTOS_SIGNAL") or BASE.replace("http", "ws", 1)
SIG = "" if BASE.startswith("https://meet.") else f"?signal={WS}"
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


# the live site spreads calls over two room servers (web/rtc.js serverIndex): ask each, keep the one the call is on
SERVERS = [WS] + (["wss://games.jurisgames.com/juntos"] if BASE.startswith("https://meet.") else [])


def info(code):
    got = []
    for url in SERVERS:
        req = urllib.request.Request(f"{url.replace('ws', 'http', 1)}/info/{code}", headers={"User-Agent": "Mozilla/5.0 (juntos-test)"})
        with urllib.request.urlopen(req, timeout=10) as r:
            got.append(json.loads(r.read()))
    return next((g for g in got if g.get("server")), got[0])


def people(pg):
    pg.evaluate("(() => { if (document.getElementById('peoplePane')?.offsetParent) return; if (!document.getElementById('bPeople')) document.getElementById('bMore')?.click(); document.getElementById('bPeople').click() })()")
    pg.wait_for_selector("#peopleList li")


def msg(pg):
    return pg.evaluate("document.getElementById('lobbyMsg').textContent")


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)

    def page(name, lang="en-US"):
        pg = b.new_context(locale=lang, permissions=["camera", "microphone"]).new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror ({name}): {e}"))
        return pg

    def lobby(name, url, lang="en-US"):
        pg = page(name, lang)
        pg.goto(url)
        pg.wait_for_selector("#lobby:not([hidden])")
        pg.fill("#name", name)
        # the lobby has asked whether a passcode is needed: that request done (a fixed wait was too short live)
        try:
            pg.wait_for_load_state("networkidle", timeout=10000)
        except Exception:
            pass
        pg.wait_for_timeout(300)
        return pg

    def try_pass(pg, code):
        pg.fill("#passcode", code)
        pg.evaluate("document.getElementById('lobbyMsg').textContent = ''")
        pg.click("#enter")
        pg.wait_for_function("() => !document.getElementById('lobby').hidden && document.getElementById('lobbyMsg').textContent || __S.waiting || __S.joined", timeout=15000)

    # --- the start page: who can join ---
    a = page("Ana")
    a.goto(f"{BASE}/{SIG}")
    summ = lambda: a.evaluate("document.querySelector('#startOpts summary').textContent")
    check("anyone with the link" in summ(), "by default anyone with the link can join")
    a.click("#startOpts summary")
    a.check('#startOpts [name="ask"]')
    a.check('#startOpts [name="usePass"]')
    check(a.is_visible('#startOpts [name="pass"]') and len(a.input_value('#startOpts [name="pass"]')) == 6, "ticking Passcode shows a ready 6-digit passcode")  # pinned: Zoom-like 6 digits by default
    a.fill('#startOpts [name="pass"]', "ab")
    a.click("#start")
    check(a.evaluate("location.pathname") == "/", "a passcode under 4 characters doesn't start the call")
    a.fill('#startOpts [name="pass"]', "Abc123")
    check("passcode, and they ask" in summ(), "the line says what was chosen")
    a.click("#start")
    a.wait_for_selector("#lobby:not([hidden])")
    check(a.is_hidden("#passcode"), "the host is never asked for the passcode")
    a.fill("#name", "Ana")
    a.click("#enter")
    a.wait_for_function("() => __S.joined", timeout=15000)
    code = a.evaluate("__S.code")
    try:
        a.wait_for_function("() => __S.isHost && __S.locked && __S.hasPass", timeout=10000)
    except Exception:
        pass
    check(a.evaluate("__S.isHost && __S.locked && __S.hasPass"), "the call starts locked and with a passcode")
    check(info(code) == {"pass": True, "server": True}, "the server only says that a passcode is needed (and that the call uses the server)")
    plain = f"{BASE}/r/{code}{SIG}"

    # --- Beto has the plain link: the lobby asks for the passcode ---
    o = lobby("Beto", plain)
    check(o.is_visible("#passcode") and "has a passcode" in msg(o), "the lobby asks for the passcode")
    o.fill("#passcode", "")
    o.click("#enter")
    check("4 to 10" in msg(o) and o.is_visible("#lobby"), "no passcode typed: it says so and stays")
    try_pass(o, "zzzz")
    check("isn't right" in msg(o) and o.is_visible("#passcode"), "a wrong passcode: back to the lobby, told it isn't right")
    try_pass(o, "abc123")
    check("isn't right" in msg(o), "the passcode is case-sensitive (like Zoom's)")
    try_pass(o, "Abc123")
    o.wait_for_function("() => __S.waiting", timeout=10000)
    check(o.evaluate("__S.waiting"), "the right passcode, and the call asks: Beto waits for the host")
    a.wait_for_selector(".knock")
    check("Beto wants to join" in a.evaluate("document.getElementById('knocks').textContent"), "Ana sees who is asking by name")

    # --- Caro has the invite link with the passcode in it ---
    a.click("#invite")
    a.wait_for_selector(".inviteSheet")
    link = a.input_value('.inviteSheet [name="link"]')
    check(link.endswith("#p=Abc123") and "Abc123" in a.evaluate("document.querySelector('.inviteSheet .passLine').textContent"), "Invite people: the link carries the passcode, and it's shown")
    a.click('.inviteSheet [name="done"]')
    c = lobby("Caro", link.replace("#", f"{SIG}#") if SIG else link)
    check("#p=" not in c.evaluate("location.href"), "the passcode is taken off the address bar")
    check(c.input_value("#passcode") == "Abc123", "the passcode from the link is filled in")  # pinned: the value this test set
    c.click("#enter")
    c.wait_for_function("() => __S.waiting", timeout=10000)
    a.wait_for_selector(".knockAll")
    check("2 people want to join" in a.evaluate("document.querySelector('.knockAll').textContent"), "two waiting: Ana gets 'Let everyone in'")
    a.click('[name="admitAll"]')
    a.wait_for_function("() => __S.mesh.peers.size === 2", timeout=20000)
    o.wait_for_function("() => __S.joined && !__S.waiting", timeout=10000)
    c.wait_for_function("() => __S.joined && !__S.waiting", timeout=10000)
    check(not a.query_selector(".knock"), "both are in, the cards are gone")

    # --- the host changes and removes the passcode ---
    people(a)
    check("Abc123" in a.evaluate("document.querySelector('#peopleList .passRow').textContent"), "People shows the host the passcode")
    people(o)
    check(not o.query_selector("#peopleList .passRow") and "need the passcode" in o.evaluate("document.getElementById('peopleList').textContent"), "the others see that new people need a passcode, not the controls")
    a.click('[name="changePass"]')
    a.click('[name="newPass"]')
    a.keyboard.press("Control+A")
    a.keyboard.type("77x7")  # real keys: the field must take typing
    a.click('[name="savePass"]')
    o.wait_for_function("() => localStorage.getItem('juntos.pass.' + __S.code) === '77x7'", timeout=5000)
    check("set a passcode" in o.evaluate("document.getElementById('toasts').textContent"), "Beto is told, and his invite link gets the new passcode")
    check(o.evaluate("__S.mesh.pass") == "77x7",  # pinned: the value this test set
           "Beto reconnects with the new one if his link drops")
    d = lobby("Dani", plain)
    try_pass(d, "Abc123")
    check("isn't right" in msg(d), "the old passcode no longer works")
    d.context.close()
    people(a)
    a.click('[name="removePass"]')
    o.wait_for_function("() => !__S.hasPass", timeout=5000)
    # the host's panel redraws when the server answers, which can come a moment after Beto hears it
    try:
        a.wait_for_selector('[name="addPass"]', timeout=5000)
    except Exception:
        pass
    inf = info(code)
    check(inf["pass"] is False and a.query_selector('[name="addPass"]'), f"the passcode removed: nobody is asked for one ({inf}, add button: {bool(a.query_selector('[name=addPass]'))})")

    # --- a planned call holds its passcode before the host comes ---
    h = page("Host2")
    h.goto(f"{BASE}/{SIG}")
    h.click("#schedule")
    h.wait_for_selector(".schedForm")
    h.check('.schedForm [name="usePass"]')
    h.fill('.schedForm [name="pass"]', "9911")
    h.click('.schedForm [name="create"]')
    h.wait_for_selector(".plannedSheet")
    plan = h.input_value('.plannedSheet [name="link"]')
    pcode = plan.split("/r/")[1].split("#")[0]
    check(plan.endswith("#p=9911"), "the planned call's link carries its passcode")
    h.click('.plannedSheet [name="invitation"]')
    h.wait_for_timeout(1000)
    check(info(pcode)["pass"] is True and info(pcode)["server"] is True, "the planned call has its passcode before its host arrives")
    e = lobby("Eva", f"{BASE}/r/{pcode}{SIG}")
    try_pass(e, "1234")
    check("isn't right" in msg(e), "early guests without it are refused")
    e.context.close()

    # --- Spanish ---
    s = lobby("Sofi", f"{BASE}/r/{pcode}{SIG}{'&' if SIG else '?'}lang=es", lang="es-AR")
    check(s.get_attribute("#passcode", "placeholder") != "Passcode" and msg(s) and "passcode" not in msg(s), "the lobby asks in Spanish")
    s.context.close()

    # --- too many wrong tries wait (last: it blocks this network for a minute) ---
    f = lobby("Fede", f"{BASE}/r/{pcode}{SIG}")
    for i in range(5):
        try_pass(f, f"bad{i}")
    try_pass(f, "9911")
    check("Too many wrong tries" in msg(f), "after 5 wrong tries even the right one waits")  # pinned: 5 tries, then 60 s

    check(not [x for x in errors if x.startswith("pageerror")], "no page errors")
    b.close()

print("FAILED: " + "; ".join(errors) if errors else "ALL OK")
sys.exit(1 if errors else 0)
