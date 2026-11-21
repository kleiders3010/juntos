# Companion mode, like Meet's "Use Companion mode": a second device in the same room joins with no microphone and
# no sound (so no echo), camera off, its tile hidden from the grid; it can still chat and share. "Use my audio"
# makes it a normal participant in place. (Studied: Meet help 11295884.)
# Run: python companion_test.py [base-url]
import sys
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8798"
WS = BASE.replace("http", "ws", 1)
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
errors = []
# what this device plays from the others: every tile's voice, muted or at 0 (a boosted voice goes through a gain)
HEARD = "() => [...__S.mesh.peers.values()].some(p => { const a = document.querySelector(`.tile[data-id='${p.id}'] audio`); return (a && !a.muted && a.volume > 0) || (p.boost && p.boost.gain.gain.value > 0) })"


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)

    def page(name):
        pg = b.new_context(locale="en-US", permissions=["camera", "microphone"]).new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror ({name}): {e}"))
        return pg

    a = page("Ana")
    a.goto(f"{BASE}/?signal={WS}")
    a.click("#start")
    a.wait_for_selector("#lobby:not([hidden])")
    a.fill("#name", "Ana")
    a.click("#enter")
    a.wait_for_selector("#call:not([hidden])")

    c = page("Ana laptop")
    c.goto(f"{a.url}{'&' if '?' in a.url else '?'}signal={WS}")
    c.wait_for_selector("#lobby:not([hidden])")
    check(c.is_visible("#enterComp"), "the lobby offers Companion mode next to Join now")
    c.fill("#name", "Ana")
    c.click("#enterComp")
    c.wait_for_selector("#call:not([hidden])")
    a.wait_for_function("() => __S.mesh.peers.size === 1 && [...__S.mesh.peers.values()].every(p => p.pc.connectionState === 'connected')", timeout=30000)
    c.wait_for_function("() => __S.mesh.peers.size === 1 && [...__S.mesh.peers.values()].every(p => p.pc.connectionState === 'connected')", timeout=30000)
    c.wait_for_timeout(1500)

    # the companion device: no microphone out, no sound in, camera off
    check(c.evaluate("!__S.micTrack || !__S.micTrack.enabled"), "Companion mode sends no microphone")  # pinned: Companion mode = no mic (Meet)
    check(not c.evaluate(HEARD), "and plays nobody's voice (no echo in the room)")  # pinned: Companion mode = no sound (Meet)
    check(not c.evaluate("__S.cam"), "the camera starts off")
    check(c.is_visible("#compBox") and c.is_visible("#compOff"), "the call says Companion mode, with Use my audio")
    c.click("#bMic")
    c.wait_for_timeout(300)
    check(c.evaluate("!__S.micTrack || !__S.micTrack.enabled"), "the mic button doesn't turn the microphone on there")
    c.keyboard.down(" ")
    c.wait_for_timeout(300)
    check(c.evaluate("!__S.micTrack || !__S.micTrack.enabled"), "nor does holding Space")
    c.keyboard.up(" ")

    # the others: not a tile, named "(Companion)" in People, can still chat
    cid = a.evaluate("[...__S.mesh.peers.keys()][0]")
    a.wait_for_function(f"() => document.querySelector('.tile[data-id=\"{cid}\"]')?.classList.contains('compHid')", timeout=5000)
    check(not a.is_visible(f'.tile[data-id="{cid}"]'), "the others don't see a companion's tile")  # pinned: hidden from the grid (Meet)
    a.click("#bPeople")
    a.wait_for_timeout(300)
    check("Ana (Companion)" in a.text_content("#panel"), "People names it 'Ana (Companion)'")
    check(a.evaluate(HEARD), "the others still hear everyone as usual")
    c.click("#bChat")
    c.fill("#chatText", "slides are up")
    c.press("#chatText", "Enter")
    a.wait_for_function("() => __S.chat.some(m => m.text === 'slides are up')", timeout=5000)
    check(True, "a companion can chat")

    # camera on: the tile shows (Meet shows a companion who turns the camera on)
    c.click("#bCam")
    a.wait_for_function(f"() => !document.querySelector('.tile[data-id=\"{cid}\"]').classList.contains('compHid')", timeout=5000)
    check(a.is_visible(f'.tile[data-id="{cid}"]'), "a companion with the camera on is shown")
    check(c.evaluate("!__S.micTrack || !__S.micTrack.enabled"), "still without a microphone")

    # Use my audio: a normal participant, in place
    c.click("#compOff")
    c.wait_for_timeout(800)
    check(c.evaluate("__S.micTrack && __S.micTrack.enabled"), "Use my audio turns the microphone on (it was on in the lobby)")
    check(c.evaluate(HEARD), "and the sound")
    check(c.is_hidden("#compBox"), "the Companion note goes away")
    a.wait_for_function(f"() => !__S.comps.has('{cid}')", timeout=5000)
    check("(Companion)" not in a.text_content("#panel"), "the others see a normal participant again")
    b.close()

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
