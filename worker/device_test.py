# A microphone or camera that stops in the middle of a call (unplugged, Bluetooth gone, another app took it) is
# not left silently dead: the microphone is opened again and sent to everyone, a stopped camera is turned off with
# a note, and turning it on opens it again. (Found by big_test.py: a microphone had ended and every connection
# kept sending it, so nobody heard that person.)
# Run: python device_test.py [base-url]
import sys
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8797"
WS = BASE.replace("http", "ws", 1)
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]
SENT = "() => [...__S.mesh.peers.values()].map(p => p.audio && p.audio.sender.track ? p.audio.sender.track.readyState : 'none')"
errors = []


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
    a.wait_for_selector("#lobbyOk.ok:not([hidden])", timeout=5000)
    check("camera" in a.text_content("#lobbyOk") and "microphone" in a.text_content("#lobbyOk"), f"the lobby says the camera and microphone work: {a.text_content('#lobbyOk')!r}")

    # Kleider (hub #335): before joining the screen shows the devices in use, to tell it's all good
    SEL = "id => { const s = document.getElementById(id); return s.selectedIndex < 0 ? '' : s.options[s.selectedIndex].text }"
    a.wait_for_function("document.querySelector('#ldMic').options.length > 0 && document.querySelector('#ldCam').options.length > 0", timeout=5000)
    mic, cam = a.evaluate(SEL, "ldMic"), a.evaluate(SEL, "ldCam")
    real = a.evaluate("() => navigator.mediaDevices.enumerateDevices().then(l => l.map(d => d.label))")
    check(mic in real and cam in real, f"the lobby names the microphone and camera in use: {mic!r}, {cam!r}")
    check(a.evaluate(SEL, "ldMic") == a.evaluate("() => navigator.mediaDevices.enumerateDevices().then(l => l.find(d => d.kind === 'audioinput' && d.deviceId === __S.micTrack.getSettings().deviceId).label)"), "the microphone shown is the one sending")  # pinned: the name shown is the device in use
    check(a.is_visible("#ldSpk") and a.evaluate(SEL, "ldSpk") != "", f"and the speaker: {a.evaluate(SEL, 'ldSpk')!r}")
    check(a.is_visible("#pMeter"), "the microphone's level is next to it")
    a.evaluate("window.__played = 0; const pl = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { if (this instanceof HTMLAudioElement) __played++; return pl.call(this) }; 0")
    a.click("#ldTest")
    a.wait_for_function("!document.querySelector('#ldTest').disabled", timeout=8000)
    check(a.evaluate("__played") == 1, "Test plays a sound on the speaker from the lobby")
    a.click("#pMic")
    a.wait_for_function("!document.querySelector('#lobbyOk').classList.contains('ok')", timeout=3000)
    check("muted" in a.text_content("#lobbyOk") and a.evaluate("document.querySelector('.ldRow[data-k=mic]').classList.contains('bad')"), f"a muted microphone shows before joining: {a.text_content('#lobbyOk')!r}")  # pinned: before joining the lobby says when the microphone is muted (Meet warns too)
    a.click("#pMic")
    a.wait_for_selector("#lobbyOk.ok", timeout=3000)
    a.fill("#name", "Ana")
    a.click("#enter")
    a.wait_for_selector("#call:not([hidden])")
    o = page("Beto")
    o.goto(f"{a.url}{'&' if '?' in a.url else '?'}signal={WS}")
    o.fill("#name", "Beto")
    o.click("#enter")
    o.wait_for_selector("#call:not([hidden])")
    a.wait_for_function("__S.mesh.peers.size === 1 && [...__S.mesh.peers.values()].every(p => p.pc.connectionState === 'connected')", timeout=30000)

    # the microphone stops by itself (what unplugging does to the track)
    a.evaluate("__S.micTrack.stop()")
    try:
        a.wait_for_function("__S.micTrack && __S.micTrack.readyState === 'live'", timeout=6000)
    except Exception:
        pass
    check(a.evaluate("__S.micTrack.readyState") == "live", "a microphone that stopped is opened again")  # pinned: MediaStreamTrack state name
    check(all(x == "live" for x in a.evaluate(SENT)), f"and sent to everyone again ({a.evaluate(SENT)})")  # pinned: MediaStreamTrack state name
    check(a.evaluate("[...document.querySelectorAll('#toasts .toast')].length") > 0, "with a note saying so")
    check(a.evaluate("__S.mic"), "the microphone stays on (it was on)")

    # the camera stops by itself
    a.evaluate("__S.camTrack.stop()")
    try:
        a.wait_for_function("!__S.cam", timeout=6000)
    except Exception:
        pass
    check(not a.evaluate("__S.cam"), "a camera that stopped is turned off")
    a.click("#bCam")
    try:
        a.wait_for_function("__S.cam && __S.camTrack.readyState === 'live'", timeout=6000)
    except Exception:
        pass
    check(a.evaluate("__S.cam && __S.camTrack.readyState === 'live'"), "turning it on opens it again")  # pinned: MediaStreamTrack state name
    b.close()

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
