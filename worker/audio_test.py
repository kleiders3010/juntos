# Audio and keys (headless Edge, fake devices), two people: the microphone level in the lobby, the noise switch,
# the speaker and microphone tests, "you're muted" when talking with the mic off, hold Space to talk, and the
# keyboard shortcuts (M, V, H, C, ?, Ctrl+D, Ctrl+E), which must not fire while typing.
# Run: python audio_test.py [base-url]
import sys
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8797"
WS = BASE.replace("http", "ws", 1)
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
# a steady tone instead of the fake microphone's short beeps: someone talking
TONE = """() => { const ac = new AudioContext(), o = ac.createOscillator(), d = ac.createMediaStreamDestination(), g = ac.createGain();
  g.gain.value = 0.3; o.connect(g); g.connect(d); o.start(); const t = d.stream.getAudioTracks()[0]; t.enabled = __S.mic;
  __S.micTrack = t; return __S.mesh.setTracks(t, __S.mesh.videoTrack) }"""
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)

    def page(name):
        pg = b.new_context(locale="en-US", permissions=["camera", "microphone"], viewport={"width": 1280, "height": 760}).new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror ({name}): {e}"))
        return pg

    a = page("Ana")
    a.goto(f"{BASE}/?signal={WS}")
    a.click("#start")
    a.wait_for_selector("#lobby:not([hidden])")
    # the lobby shows the microphone hearing you
    a.wait_for_function("parseFloat(document.querySelector('#pMeter i').style.width) > 0", timeout=8000)
    check(a.is_visible("#pMeter"), "lobby: the microphone level moves")

    # Check sound: the devices sheet with the noise switch and the two tests
    a.click("#pCheck")
    a.wait_for_selector(".sheet .devices")
    check(a.is_checked('input[name="noise"]'), "background noise reduction is on by default")
    a.uncheck('input[name="noise"]')
    a.wait_for_function("__S.micTrack && __S.micTrack.getSettings().noiseSuppression === false", timeout=8000)
    check(a.evaluate("localStorage.getItem('juntos.noise')") == "off", "turned off: the microphone runs without it, remembered")
    a.check('input[name="noise"]')
    a.wait_for_function("__S.micTrack.getSettings().noiseSuppression === true", timeout=8000)
    check(True, "turned back on")

    a.evaluate("window.__played = 0; const pl = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { if (this instanceof HTMLAudioElement) __played++; return pl.call(this) }; 0")
    a.click('button[name="testSpeaker"]')
    a.wait_for_function("document.querySelector('button[name=testSpeaker]').disabled", timeout=3000)
    a.wait_for_function("!document.querySelector('button[name=testSpeaker]').disabled", timeout=8000)
    check(a.evaluate("__played") == 1, "test sound plays on the speaker")
    a.click('button[name="testMic"]')
    a.wait_for_function("document.querySelector('button[name=testMic]').textContent.startsWith('Say something')", timeout=3000)
    a.wait_for_function("!document.querySelector('button[name=testMic]').disabled", timeout=12000)
    check(a.evaluate("__played") == 2 and not a.query_selector(".toast"), "microphone test records a few seconds and plays them back")
    a.click(".sheet .devices > .primary")

    a.fill("#name", "Ana")
    a.click("#enter")
    a.wait_for_selector("#call:not([hidden])")
    join = f"{a.url}{'&' if '?' in a.url else '?'}signal={WS}"
    o = page("Beto")
    o.goto(join)
    o.fill("#name", "Beto")
    o.click("#enter")
    o.wait_for_selector("#call:not([hidden])")
    a.wait_for_function("__S.mesh.peers.size === 1 && [...__S.mesh.peers.values()].every(p => p.dc && p.dc.readyState === 'open')", timeout=30000)
    o.wait_for_function("[...__S.mesh.peers.values()].every(p => p.dc && p.dc.readyState === 'open')", timeout=30000)
    ana_on_beto = "document.querySelector('#grid .tile:not([data-id=\"me\"])').classList.contains('muted')"

    # M mutes, everyone sees it; M again unmutes
    a.click("#grid")
    a.keyboard.press("m")
    o.wait_for_function(ana_on_beto, timeout=5000)
    check(not a.evaluate("__S.mic"), "M mutes (Beto sees Ana muted)")

    # talking while muted: the note says so, and Unmute works
    a.evaluate(TONE)
    a.wait_for_selector("#mutedNote:not([hidden])", timeout=6000)
    check(a.is_visible("#mutedNote button"),"talking with the mic off: \"You're muted\" shows")
    a.click("#mutedNote button")
    o.wait_for_function("!" + ana_on_beto, timeout=5000)
    check(a.evaluate("__S.mic") and a.is_hidden("#mutedNote"), "Unmute in the note turns the mic on")

    # hold Space to talk
    a.keyboard.press("m")
    o.wait_for_function(ana_on_beto, timeout=5000)
    a.keyboard.down(" ")
    o.wait_for_function("!" + ana_on_beto, timeout=5000)
    check(a.evaluate("__S.mic") and a.is_visible("#pttNote"), "holding Space: the mic is on while held")
    a.wait_for_timeout(1500)
    check(a.is_hidden("#mutedNote"), "no \"You're muted\" while holding Space")
    a.keyboard.up(" ")
    o.wait_for_function(ana_on_beto, timeout=5000)
    check(not a.evaluate("__S.mic") and a.is_hidden("#pttNote"), "letting go of Space mutes again")

    # Ctrl+D (Meet's key) toggles the mic, V and Ctrl+E the camera
    a.keyboard.press("Control+d")
    o.wait_for_function("!" + ana_on_beto, timeout=5000)
    check(a.evaluate("__S.mic"), "Ctrl+D turns the mic on")
    a.keyboard.press("v")
    o.wait_for_function("document.querySelector('#grid .tile:not([data-id=\"me\"])').classList.contains('camoff')", timeout=5000)
    check(not a.evaluate("__S.cam"), "V turns the camera off (Beto sees it)")
    a.keyboard.press("Control+e")
    a.wait_for_function("__S.cam", timeout=3000)
    check(True, "Ctrl+E turns it back on")

    # H raises a hand, Beto sees it
    a.keyboard.press("h")
    o.wait_for_function("!document.querySelector('#grid .tile:not([data-id=\"me\"]) .hand').hidden", timeout=5000)
    check(True, "H raises a hand (Beto sees it)")
    a.keyboard.press("h")
    o.wait_for_function("document.querySelector('#grid .tile:not([data-id=\"me\"]) .hand').hidden", timeout=5000)
    check(True, "H again lowers it")

    # C opens the chat; typing there sends letters, not shortcuts
    a.keyboard.press("c")
    a.wait_for_selector("#chatPane:not([hidden])")
    a.click("#chatText")
    a.keyboard.type("my video ham ")
    a.keyboard.down(" ")
    a.keyboard.up(" ")
    check(a.evaluate("__S.mic && __S.cam && !__S.hands.has('me')") and a.input_value("#chatText") == "my video ham  ", "typing in the chat: M, V, H and Space stay letters")  # pinned: the text is what this test typed
    a.keyboard.press("Enter")
    o.wait_for_function("document.body.innerText.includes('my video ham')", timeout=5000)
    check(True, "and the message is sent")

    # ? lists the keys
    a.click("#grid")
    a.keyboard.press("?")
    a.wait_for_selector(".keysSheet")
    check(a.locator(".keysSheet dt").count() >= 6, "? shows the keyboard shortcuts")
    a.keyboard.press("m")
    check(a.evaluate("__S.mic"), "with a sheet open, letters do nothing behind it")
    a.click(".keysSheet .primary")
    b.close()

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
