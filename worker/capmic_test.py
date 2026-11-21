# Captions listen to the microphone picked in Devices (Kleider, 2026-11-18: "This is an important limitation that
# needs to be fixed"). Where the browser can listen to a given microphone (start(track), Chrome 135+ on computers)
# recognition is started on the call's own microphone and again on the new one when it is switched. Where it
# can't, and the default microphone is another one than the call's, the captions sheet says so (never a silent
# caption of the wrong microphone). The browser's recognition is a stub, so both kinds are tested in Edge.
# Run: python capmic_test.py [base-url]
import sys
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8798"
WS = BASE.replace("http", "ws", 1)
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
# a recognition that takes a microphone: refuses a stopped one (as the spec says), remembers which one it got
WITH_TRACK = """
window.__sr = [];
class FakeSR {
  start(t) { if (t !== undefined && t.readyState !== 'live') throw new DOMException('not live', 'InvalidStateError');
    if (this.on) throw new Error('already started'); this.on = true; this.track = t || null; __sr.push(this); }
  stop() { this.abort(); }
  abort() { if (!this.on) return; this.on = false; __sr.splice(__sr.indexOf(this), 1); setTimeout(() => this.onend && this.onend(), 0); }
}
window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;
"""
# an older recognition: ignores the microphone given and hears the default one; the default is another device
NO_TRACK = WITH_TRACK.replace("this.track = t || null;", "this.track = null;").replace(
    "if (t !== undefined && t.readyState !== 'live') throw new DOMException('not live', 'InvalidStateError');", "") + """
const realEnum = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
navigator.mediaDevices.enumerateDevices = async () => (await realEnum()).map(d => d.kind === 'audioinput' && d.deviceId === 'default'
  ? { kind: d.kind, deviceId: d.deviceId, groupId: 'another-device', label: 'Default - Desk Mic' } : d);
"""
MIC_SELECT = "[...document.querySelectorAll('.devRow')].find(r => r.firstChild.textContent === 'Microphone').querySelector('select')"
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)

    def page(name, script):
        ctx = b.new_context(locale="en-US", permissions=["camera", "microphone"])
        ctx.add_init_script(script)
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror ({name}): {e}"))
        return pg

    a = page("Ana", WITH_TRACK)
    a.goto(f"{BASE}/?signal={WS}")
    a.click("#start")
    a.wait_for_selector("#lobby:not([hidden])")
    a.fill("#name", "Ana")
    a.click("#enter")
    a.wait_for_selector("#call:not([hidden])")
    c = page("Carla", NO_TRACK)
    c.goto(f"{a.url}{'&' if '?' in a.url else '?'}signal={WS}")
    c.fill("#name", "Carla")
    c.click("#enter")
    c.wait_for_selector("#call:not([hidden])")
    for pg in (a, c):
        pg.wait_for_function("() => __S.mesh.peers.size === 1 && [...__S.mesh.peers.values()].every(p => p.dc && p.dc.readyState === 'open')", timeout=30000)

    # both turn captions on: each browser listens
    for pg in (a, c):
        pg.click("#bCaps")
        pg.wait_for_selector(".capSheet")
        pg.check('input[name="caps"]')
        pg.click(".capSheet .primary")
    a.wait_for_function("() => __sr.length === 1", timeout=5000)
    check(a.evaluate("__sr[0].track === __S.micTrack"), "Ana's captions listen to the call's own microphone")

    # Ana switches microphone in Devices: captions follow
    a.evaluate("(document.getElementById('bDev') || __S.barBtns.bDev).click()")
    a.wait_for_selector(".devRow")
    n = a.evaluate(f"{MIC_SELECT}.options.length")
    old = a.evaluate("__S.micTrack.id")
    a.evaluate(f"(() => {{ const s = {MIC_SELECT}; s.selectedIndex = (s.selectedIndex + 1) % s.options.length; s.dispatchEvent(new Event('change')) }})()")
    a.wait_for_function(f"() => __S.micTrack.id !== '{old}' && __sr.length === 1 && __sr[0].track === __S.micTrack", timeout=8000)
    check(a.evaluate("__sr.length === 1 && __sr[0].track === __S.micTrack && __S.micTrack.readyState === 'live'"),
          f"after switching microphone ({n} to pick from) captions listen to the new one")  # pinned: MediaStreamTrack state name
    check(not a.evaluate("!!__S.capOtherMic"), "and no 'another microphone' note where captions follow the picked one")

    # Carla's browser can't: her captions sheet says which microphone captions hear
    c.wait_for_function("() => __sr.length === 1", timeout=5000)
    c.wait_for_function("() => !!__S.capOtherMic", timeout=5000)
    c.click("#bCaps")
    c.wait_for_selector(".capSheet")
    note = c.text_content(".capSheet .capMic") if c.query_selector(".capSheet .capMic") else ""
    check("Desk Mic" in note, f"where captions can't follow the picked microphone, the sheet names the one they hear ({note[:90]})")
    b.close()

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
