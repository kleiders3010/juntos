# Host controls (headless Edge, fake devices): who starts the call is its host. The host mutes one person
# or everyone, locks the call (newcomers ask to join; let in or deny), removes someone (who then has to ask
# to come back), and when the last host leaves, whoever is waiting comes in. Nobody else gets the controls,
# not even with a made-up key. Run: python host_test.py [base-url]
import sys
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8797"
WS = BASE.replace("http", "ws", 1)
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
TILES = "document.querySelectorAll('.tile').length"
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


def people(pg):
    pg.evaluate("(() => { if (document.getElementById('peoplePane')?.offsetParent) return; if (!document.getElementById('bPeople')) document.getElementById('bMore')?.click(); document.getElementById('bPeople').click() })()")
    pg.wait_for_selector("#peopleList li")


def in_call(pg):
    return pg.evaluate("!document.getElementById('call').hidden && !!__S.mesh && !__S.waiting")


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)

    def person(name, url, wait=True):
        pg = b.new_context(locale="en-US", permissions=["camera", "microphone"]).new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror ({name}): {e}"))
        pg.goto(url)
        if "/r/" not in url:
            pg.click("#start")
        pg.fill("#name", name)
        pg.click("#enter")
        pg.wait_for_selector("#call:not([hidden])")
        if wait:
            pg.wait_for_function("__S.joined", timeout=15000)
        return pg

    a = person("Ana", f"{BASE}/?signal={WS}")
    join = f"{a.url}{'&' if '?' in a.url else '?'}signal={WS}"
    check(a.evaluate("__S.isHost"), "who starts the call is the host")
    o = person("Beto", join)
    a.wait_for_function("__S.mesh.peers.size === 1 && [...__S.mesh.peers.values()][0].dc.readyState === 'open'", timeout=20000)
    check(not o.evaluate("__S.isHost"), "someone who joins is not the host")
    people(o)
    check(not o.query_selector("#lockBtn") and not o.query_selector(".person .chip"), "Beto has no host buttons")
    check("Host" in o.evaluate("[...document.querySelectorAll('.hostTag')].map(e => e.parentNode.textContent).join('|')") and
          "Ana" in o.evaluate("document.querySelector('.hostTag')?.parentNode.textContent || ''"), "Beto sees Ana marked as host")

    # mute one person
    people(a)
    a.click(".person .chip:text('Mute')")
    o.wait_for_function("!__S.mic", timeout=5000)
    check(not o.evaluate("__S.micTrack.enabled") and "muted you" in o.evaluate("document.getElementById('toasts').textContent"), "Ana mutes Beto: his mic is off and he's told who did it")
    o.evaluate("document.getElementById('bMic').click()")
    check(o.evaluate("__S.mic"), "Beto can turn his mic back on himself")

    # lock: Caro asks to join, Ana says no; Caro asks again, Ana lets her in
    a.click("#lockBtn")
    a.wait_for_function("__S.locked", timeout=5000)
    o.wait_for_function("__S.locked", timeout=5000)
    check(a.evaluate("document.getElementById('lockBtn').textContent").startswith("Unlock"), "the lock button now unlocks")
    c = person("Caro", join, wait=False)
    c.wait_for_function("__S.waiting", timeout=10000)
    check("Asking to join" in c.evaluate("document.getElementById('netState').textContent") and c.evaluate(TILES) == 1, "locked: Caro waits, sees nobody")
    a.wait_for_selector(".knock")
    check("Caro" in a.evaluate("document.querySelector('.knock').textContent"), "Ana gets 'Caro wants to join'")
    check(not o.query_selector(".knock"), "only the host is asked")
    a.click(".knock .chip")
    c.wait_for_selector("#ended:not([hidden])", timeout=5000)
    check("let you in" in c.evaluate("document.getElementById('endedMsg').textContent"), "denied: Caro is told nobody let her in")
    check(not a.query_selector(".knock"), "the card goes away")
    c.click("#rejoin")
    a.wait_for_selector(".knock", timeout=10000)
    a.click(".knock .primary")
    c.wait_for_function("__S.joined && !__S.waiting", timeout=10000)
    c.wait_for_function("document.querySelectorAll('.tile video').length >= 3", timeout=20000)
    check(c.evaluate(TILES) == 3, "let in: Caro is in the call with both")

    # mute everyone
    people(a)
    a.click(".hostRow .chip:text('Mute everyone')")
    o.wait_for_function("!__S.mic", timeout=5000)
    c.wait_for_function("!__S.mic", timeout=5000)
    check(a.evaluate("__S.mic"), "mute everyone mutes the others, not Ana")

    # remove Beto: two taps; he has to ask to come back even after the lock is off
    a.evaluate("__S.mesh.host({ t: 'lock', on: false })")
    a.wait_for_function("!__S.locked", timeout=5000)
    beto = a.evaluate("[...__S.mesh.peers.values()].find(p => p.name === 'Beto').id")
    remove = f".person:has-text('Beto') .chip:text('Remove')"
    a.click(remove)
    check(a.evaluate("__S.mesh.peers.size") == 2, "one tap on Remove only asks")
    a.click(f".person:has-text('Beto') .chip.sure")
    o.wait_for_selector("#ended:not([hidden])", timeout=5000)
    check("removed you" in o.evaluate("document.getElementById('endedMsg').textContent"), "Beto is told Ana removed him")
    a.wait_for_function(f"!__S.mesh.peers.has('{beto}')", timeout=5000)
    c.wait_for_function(f"!__S.mesh.peers.has('{beto}')", timeout=5000)
    check(True, "Beto is gone for Ana and Caro")
    o.click("#rejoin")
    o.wait_for_function("__S.waiting", timeout=10000)
    a.wait_for_selector(".knock", timeout=5000)
    check(True, "removed, Beto has to ask to come back (call not locked)")
    a.click(".knock .primary")
    o.wait_for_function("__S.joined && !__S.waiting", timeout=10000)
    check(not o.evaluate("localStorage.getItem(location.pathname.replace('/r/', 'juntos.out.'))"), "let back in: he joins normally next time")

    # a made-up key doesn't make anyone host
    d = b.new_context(locale="en-US", permissions=["camera", "microphone"]).new_page()
    d.on("pageerror", lambda e: errors.append(f"pageerror (Dani): {e}"))
    d.goto(join)
    d.evaluate("localStorage.setItem(location.pathname.replace('/r/', 'juntos.host.'), 'aaaaaaaaaaaaaaaaaaaaaaaa')")
    d.fill("#name", "Dani")
    d.click("#enter")
    d.wait_for_function("__S.joined", timeout=15000)
    check(not d.evaluate("__S.isHost"), "a made-up key doesn't make Dani host")
    d.evaluate("__S.mesh.host({ t: 'mute', id: '*' })")
    a.wait_for_timeout(800)
    check(a.evaluate("__S.mic"), "and her mute-everyone does nothing")

    # the host leaves while someone waits: they come in
    a.evaluate("__S.mesh.host({ t: 'lock', on: true })")
    c.wait_for_function("__S.locked", timeout=5000)
    e = person("Eva", join, wait=False)
    e.wait_for_function("__S.waiting", timeout=10000)
    a.evaluate("document.getElementById('bLeave').click()")
    e.wait_for_function("__S.joined && !__S.waiting", timeout=10000)
    check(True, "the last host leaves: Eva, who was waiting, comes in")
    a.click("#rejoin")
    a.wait_for_function("__S.joined", timeout=10000)
    check(a.evaluate("__S.isHost") and a.evaluate("__S.locked"), "Ana comes back still host, the call still locked")
    b.close()

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
