# Live captions (headless Edge, fake devices). The browser's speech recognition is replaced by a stub the test
# drives (__say), so "speech" is exact. Three people: Ana talks, Beto (who can't hear) turns captions on, Carla's
# browser has no speech recognition (like Firefox).
# Checked: nobody listens until someone wants captions; Beto sees Ana's words with her name, while she talks and
# when the sentence ends; muting stops the listening; the text size; the .txt transcript; Carla's note; turning
# captions of your own voice off; captions off stops everyone listening; the choice is remembered.
# Run: python captions_test.py [base-url]
import sys
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8797"
WS = BASE.replace("http", "ws", 1)
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
STUB = """
window.__sr = [];
class FakeSR {
  start() { if (this.on) throw new Error("already started"); this.on = true; __sr.push(this); }
  stop() { this.abort(); }
  abort() { if (!this.on) return; this.on = false; __sr.splice(__sr.indexOf(this), 1); setTimeout(() => this.onend && this.onend(), 0); }
}
window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;
window.__say = (text, fin) => { for (const r of __sr) { const res = [{ transcript: text }]; res.isFinal = fin; r.onresult({ resultIndex: 0, results: [res] }); } };
"""
NO_SR = "delete window.SpeechRecognition; delete window.webkitSpeechRecognition;"
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)

    def page(name, script):
        ctx = b.new_context(locale="en-US", permissions=["camera", "microphone"], viewport={"width": 1280, "height": 760}, accept_downloads=True)
        ctx.add_init_script(script)
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror ({name}): {e}"))
        return pg

    def enter(pg, name, url):
        pg.goto(url)
        pg.fill("#name", name)
        pg.click("#enter")
        pg.wait_for_selector("#call:not([hidden])")

    def listening(pg):
        return pg.evaluate("__sr ? __sr.length : -1")

    a = page("Ana", STUB)
    a.goto(f"{BASE}/?signal={WS}")
    a.click("#start")
    a.wait_for_selector("#lobby:not([hidden])")
    a.fill("#name", "Ana")
    a.click("#enter")
    a.wait_for_selector("#call:not([hidden])")
    join = f"{a.url}{'&' if '?' in a.url else '?'}signal={WS}"
    o = page("Beto", STUB)
    enter(o, "Beto", join)
    a.wait_for_function("__S.mesh.peers.size === 1 && [...__S.mesh.peers.values()].every(p => p.dc && p.dc.readyState === 'open')", timeout=30000)
    o.wait_for_function("[...__S.mesh.peers.values()].every(p => p.dc && p.dc.readyState === 'open')", timeout=30000)
    a.wait_for_timeout(500)
    check(listening(a) == 0 and listening(o) == 0, "nobody's voice is turned into text until someone wants captions")

    # Beto turns captions on
    o.click("#bCaps")
    o.wait_for_selector(".capSheet")
    o.check('input[name="caps"]')
    a.wait_for_function("__sr.length === 1", timeout=5000)
    check(listening(o) == 1, "Beto turns captions on: Ana's browser (and his own) start listening")
    check(a.is_visible(".toast"), "Ana is told her voice is being turned into text")
    o.click(".capSheet .primary")

    a.evaluate("__say('hello every', false)")
    o.wait_for_function("document.querySelector('#captions .capLine span')?.textContent.includes('hello every')", timeout=5000)
    check(o.inner_text("#captions .capLine b") == "Ana", "Beto sees Ana's words while she talks, with her name")  # pinned: the name she typed
    a.evaluate("__say('hello everyone', true)")
    a.evaluate("__say('how are you', true)")
    o.wait_for_function("document.querySelector('#captions .capLine span').textContent.includes('how are you')", timeout=5000)
    line = o.inner_text("#captions .capLine span")
    check("hello everyone how are you" in line and "hello every " not in line, "finished sentences replace the words in progress and stay together")  # pinned: the words this test said
    check(o.locator("#captions .capLine").count() == 1 and not a.is_visible("#captions"), "one line per speaker; Ana (captions off) sees none")

    # muted: nothing is listened to
    a.click("#grid")
    a.keyboard.press("m")
    a.wait_for_function("__sr.length === 0", timeout=5000)
    check(True, "Ana mutes: her browser stops listening")
    a.keyboard.press("m")
    a.wait_for_function("__sr.length === 1", timeout=5000)
    check(True, "and starts again when she unmutes")

    # Beto's own voice shows as "You"
    o.evaluate("__say('fine thanks', true)")
    o.wait_for_function("[...document.querySelectorAll('#captions .capLine')].some(l => l.dataset.id === 'me' && l.textContent.includes('fine thanks'))", timeout=5000)
    check(True, "Beto sees his own words too")

    # text size
    o.click("#bCaps")
    o.click('.capSheet [data-v="huge"]')
    big = o.evaluate("parseFloat(getComputedStyle(document.querySelector('#captions')).fontSize)")
    o.click('.capSheet [data-v="normal"]')
    small = o.evaluate("parseFloat(getComputedStyle(document.querySelector('#captions')).fontSize)")
    check(big > small and o.evaluate("localStorage.getItem('juntos.capsize')") == "normal", "text size changes and is remembered")  # pinned: the stored size id the test just picked

    # save the transcript
    with o.expect_download() as d:
        o.click('button[name="capSave"]')
    path = d.value.path()
    text = open(path, encoding="utf-8").read()
    check(d.value.suggested_filename.endswith(".txt") and "Ana: hello everyone" in text and "Ana: how are you" in text and "Beto: fine thanks" in text and "hello every\r" not in text,
          "the .txt has every finished sentence with names, not the words in progress")
    o.click(".capSheet .primary")

    # Carla can't make captions
    c = page("Carla", NO_SR)
    enter(c, "Carla", join)
    o.wait_for_function("[...document.querySelectorAll('#captions .capLine.note')].some(l => l.textContent.includes('Carla'))", timeout=30000)
    check(True, "Carla's browser can't make captions: Beto is told so")
    c.click("#bCaps")
    c.wait_for_selector(".capSheet")
    check(not c.query_selector('input[name="capShare"]') and c.is_visible('input[name="caps"]'), "Carla can still turn on captions to read the others")
    c.check('input[name="caps"]')
    c.click(".capSheet .primary")
    a.evaluate("__say('welcome Carla', true)")
    c.wait_for_function("document.querySelector('#captions')?.textContent.includes('welcome Carla')", timeout=5000)
    check(True, "and she reads Ana")
    c.click("#bCaps")
    c.uncheck('input[name="caps"]')
    c.click(".capSheet .primary")

    # Dani is on Brave: it has the API but its speech service never works. Said plainly, never silently nothing.
    # (Kleider, 2026-11-18: his mother on Brave shared her voice as subtitles and nobody saw them.)
    d = page("Dani", STUB + "Object.defineProperty(navigator, 'brave', { value: { isBrave: () => Promise.resolve(true) } });")
    enter(d, "Dani", join)
    o.wait_for_function("[...document.querySelectorAll('#captions .capLine.note')].some(l => l.textContent.includes('Dani'))", timeout=30000)
    check(listening(d) == 0, "Brave: Dani's browser doesn't pretend to listen; Beto is told her browser can't make captions")
    d.click("#bCaps")
    d.wait_for_selector(".capSheet")
    check("Brave" in d.inner_text(".capSheet") and not d.query_selector('input[name="capShare"]'), "Dani's captions sheet says Brave can't do it and names browsers that can")
    d.click(".capSheet .primary")
    d.close()

    # Eva's browser has the API but the speech service fails ("network"): after a few tries it gives up and says so
    e = page("Eva", STUB.replace("start() { if (this.on) throw new Error(\"already started\"); this.on = true; __sr.push(this); }",
                                 "start() { setTimeout(() => { this.onerror && this.onerror({ error: 'network' }); this.onend && this.onend(); }, 50); }"))
    enter(e, "Eva", join)
    o.wait_for_function("[...document.querySelectorAll('#captions .capLine.note')].some(l => l.textContent.includes('Eva'))", timeout=30000)
    check(True, "a speech service that never answers: Eva's browser gives up and Beto is told")
    e.close()

    # Never silently (Kleider, 2026-11-18: "There should be some kind of warning if your subtitles are unable to reach
    # people for any reason rather than silently drop them"; Chrome on his phone sent none).
    # Fay's phone can't listen while the call holds the mic ("audio-capture"): she sees why, Beto is told.
    f = page("Fay", STUB.replace("start() { if (this.on) throw new Error(\"already started\"); this.on = true; __sr.push(this); }",
                                 "start() { setTimeout(() => { this.onerror && this.onerror({ error: 'audio-capture' }); this.onend && this.onend(); }, 50); }"))
    enter(f, "Fay", join)
    o.wait_for_function("[...document.querySelectorAll('#captions .capLine.note')].some(l => l.textContent.includes('Fay'))", timeout=30000)
    check(f.evaluate("document.querySelector('#bCaps')?.classList.contains('warn')") is True, "Fay's captions button warns (it stays, not just a toast)")
    f.click("#bCaps")
    f.wait_for_selector(".capSheet")
    check(f.is_visible(".capSheet .capWarn") and "call" in f.inner_text(".capSheet .capWarn"), "Fay's captions sheet says why: the device can't listen during the call")
    f.click(".capSheet .primary")
    f.close()

    # Gus's browser listens but never makes text while he talks: after a while he is warned, and Beto told
    g = page("Gus", STUB)
    enter(g, "Gus", join)
    g.wait_for_function("__sr.length === 1", timeout=10000)
    g.evaluate("""() => { const ac = new AudioContext(), o = ac.createOscillator(), d = ac.createMediaStreamDestination(), gn = ac.createGain();
      gn.gain.value = 0.3; o.connect(gn); gn.connect(d); o.start(); __S.micTrack = d.stream.getAudioTracks()[0]; }""")  # he keeps talking
    check(g.wait_for_function("document.querySelector('#bCaps').classList.contains('warn')", timeout=25000) is not None, "talking with no text coming out: Gus is warned")
    o.wait_for_function("[...document.querySelectorAll('#captions .capLine.note')].some(l => l.textContent.includes('Gus'))", timeout=10000)
    check(True, "and Beto is told Gus's captions aren't working")
    g.evaluate("__say('now it works', true)")
    g.wait_for_function("!document.querySelector('#bCaps').classList.contains('warn')", timeout=5000)
    check(True, "the warning goes as soon as text comes out")
    g.close()

    # Ana turns off captions of her voice
    a.click("#bCaps")
    a.uncheck('input[name="capShare"]')
    a.wait_for_function("__sr.length === 0", timeout=5000)
    o.wait_for_function("[...document.querySelectorAll('#captions .capLine.note')].some(l => l.textContent.includes('Ana'))", timeout=5000)
    check(True, "Ana turns off captions of her voice: her browser stops, Beto is told")
    a.check('input[name="capShare"]')
    a.wait_for_function("__sr.length === 1", timeout=5000)
    a.click(".capSheet .primary")

    # Beto turns captions off: nobody listens any more
    o.click("#bCaps")
    o.uncheck('input[name="caps"]')
    o.click(".capSheet .primary")
    a.wait_for_function("__sr.length === 0", timeout=5000)
    check(listening(o) == 0 and o.is_hidden("#captions"), "captions off: everyone stops listening, the box goes")
    check(o.evaluate("localStorage.getItem('juntos.captions')") == "off", "the choice is remembered")

    # on again, then leave: the ended screen offers the file
    o.click("#bCaps")
    o.check('input[name="caps"]')
    o.click(".capSheet .primary")
    o.click("#bLeave")
    o.wait_for_selector("#ended:not([hidden])")
    check(o.is_visible("#endedCaps") and o.evaluate("localStorage.getItem('juntos.captions')") == "on", "after leaving, the captions can still be saved; on stays on")
    b.close()

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
