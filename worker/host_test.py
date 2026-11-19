# Host controls (headless Edge, fake devices): who starts the call is its host. The host lets someone speak or
# not (Kleider, 2026-11-18: "it should be 'allow to speak' 'don't allow to speak' and respect the users actual
# mute/unmute status"), or everyone at once, locks the call (newcomers ask to join; let in or deny), removes someone (who then has to ask
# to come back), and when the last host leaves, whoever is waiting comes in. Nobody else gets the controls,
# not even with a made-up key. Run: python host_test.py [base-url]
import sys
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8797"
# JUNTOS_SIGNAL: another room server (the Kinetic one: kinetic/server.mjs) with the same protocol
WS = __import__("os").environ.get("JUNTOS_SIGNAL") or BASE.replace("http", "ws", 1)
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

    # speaking is a permission, apart from Beto's own mic switch: a host never turns anyone's mic on or off
    beto = a.evaluate("[...__S.mesh.peers.values()].find(p => p.name === 'Beto').id")
    BETO_AUDIO = f"document.querySelector('.tile[data-id=\"{beto}\"] audio').volume"
    BETO_ROW = "[...document.querySelectorAll('.person')].find(e => e.textContent.includes('Beto'))?.textContent || ''"
    people(a)
    a.click(".person:has-text('Beto') .talkBtn")
    o.wait_for_function("!__S.micTrack.enabled", timeout=5000)
    check(o.evaluate("__S.mic"), "Ana doesn't let Beto speak: his own mic switch stays on")
    check("allowed you to speak" in o.evaluate("document.getElementById('toasts').textContent") and o.evaluate("document.getElementById('bMic').classList.contains('blocked')"),
          "nothing of his goes out, his mic button shows it and he's told")
    a.wait_for_function(f"{BETO_AUDIO} === 0", timeout=5000)
    check("Not allowed to speak" in a.evaluate(BETO_ROW), "Ana doesn't hear him either way, and People says so")
    a.click(".person:has-text('Beto') .talkBtn")
    o.wait_for_function("__S.micTrack.enabled", timeout=5000)
    check(o.evaluate("__S.mic"), "allowed again: his mic is on, as he had it")
    a.wait_for_function(f"{BETO_AUDIO} === 1", timeout=5000)
    o.evaluate("document.getElementById('bMic').click()")  # he mutes himself
    a.click(".person:has-text('Beto') .talkBtn")
    o.wait_for_function("document.getElementById('bMic').classList.contains('blocked')", timeout=5000)
    o.evaluate("document.getElementById('bMic').click()")
    check(not o.evaluate("__S.mic") and o.evaluate("__S.hands.has('me')"), "not allowed, tapping his mic raises his hand to ask (his mic stays off)")
    a.wait_for_function(f"({BETO_ROW}).includes('✋')", timeout=5000)
    a.click(".person:has-text('Beto') .talkBtn")
    o.wait_for_function("!document.getElementById('bMic').classList.contains('blocked')", timeout=5000)
    check(not o.evaluate("__S.mic") and not o.evaluate("__S.micTrack.enabled"), "allowed: his mic is not turned on for him")
    check(not o.evaluate("__S.hands.has('me')") and "mic is off" in o.evaluate("document.getElementById('toasts').textContent"), "his hand goes down and he's told his mic is off")
    o.evaluate("document.getElementById('bMic').click()")
    check(o.evaluate("__S.mic && __S.micTrack.enabled"), "Beto turns his mic on himself")

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
    try:  # (the host hears "gone" from the server a moment after Caro hears "no")
        a.wait_for_function("!document.querySelector('.knock')", timeout=5000)
        gone = True
    except Exception:
        gone = False
    check(gone, "the card goes away")
    c.click("#rejoin")
    a.wait_for_selector(".knock", timeout=10000)
    a.click(".knock .primary")
    c.wait_for_function("__S.joined && !__S.waiting", timeout=10000)
    c.wait_for_function("document.querySelectorAll('.tile video').length >= 3", timeout=20000)
    check(c.evaluate(TILES) == 3, "let in: Caro is in the call with both")

    # nobody may speak (Zoom's mute all), then one person may
    people(a)
    a.uncheck("input[name='perm-talk']")
    o.wait_for_function("!__S.micTrack.enabled", timeout=5000)
    c.wait_for_function("!__S.micTrack.enabled", timeout=5000)
    check(a.evaluate("__S.mic && __S.micTrack.enabled"), "'Everyone can speak' off: the others aren't heard, Ana is")
    check(o.evaluate("__S.mic") and c.evaluate("__S.mic"), "and their own mic switches are as they left them")
    a.click(".person:has-text('Caro') .talkBtn")
    c.wait_for_function("__S.micTrack.enabled", timeout=5000)
    check(not o.evaluate("__S.micTrack.enabled"), "Ana lets Caro speak: only Caro")
    a.check("input[name='perm-talk']")
    o.wait_for_function("__S.micTrack.enabled", timeout=5000)
    check(True, "everyone may speak again: Beto is heard (his mic was on)")

    # remove Beto: two taps; he has to ask to come back even after the lock is off
    a.evaluate("__S.mesh.host({ t: 'lock', on: false })")
    a.wait_for_function("!__S.locked", timeout=5000)
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
    d.evaluate("__S.mesh.host({ t: 'talk', id: '*', on: false })")
    a.wait_for_timeout(800)
    check(c.evaluate("__S.micTrack.enabled"), "and her 'nobody may speak' does nothing")

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
