# Captions made by someone else's browser (Kleider, 2026-11-19: "This kind of limitation is something you can circumvent
# by redirecting that traffic through another user that CAN do these things"). Carla's browser has no speech
# recognition (like Firefox); Ana's can listen to a voice it receives (Chrome / Edge 135+ on a computer); Beto wants
# captions. Speech is a stub the test drives: a recognition started on a track that isn't the page's own microphone
# is one listening to someone else's voice.
# Checked: Carla is told whose browser makes her captions, Ana whom hers makes them for; Ana's browser listens to
# Carla's voice (her received track, not Ana's microphone); what it hears reaches Beto as Carla's captions (her name,
# while she talks and when she ends, in his .txt); Carla sees them as hers; Carla muting stops the listening; when Ana
# leaves, Carla's captions say they stopped (nobody else can); a browser that can't listen to a given voice doesn't
# offer.
# pinned: the names and words compared are the ones this test types.
#   python worker/caphelp_test.py [base-url]   (local: npx wrangler dev --port 8797)
import sys
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8797"
WS = BASE.replace("http", "ws", 1)
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
# a recognition that can listen to a given track (refuses a stopped one, like Chrome 135+); the page's own
# microphone tracks are noted, so the test can tell "listening to me" from "listening to someone else"
SR_TRACK = """
window.__sr = []; window.__local = new Set();
const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
navigator.mediaDevices.getUserMedia = async (c) => { const s = await gum(c); for (const t of s.getTracks()) __local.add(t.id); return s; };
class FakeSR {
  start(track) {
    if (track && track.readyState === 'ended') throw new DOMException('ended track', 'InvalidStateError');
    if (this.on) throw new Error("already started");
    this.on = true; this.track = track || null; __sr.push(this);
  }
  stop() { this.abort(); }
  abort() { if (!this.on) return; this.on = false; __sr.splice(__sr.indexOf(this), 1); setTimeout(() => this.onend && this.onend(), 0); }
}
window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;
window.__others = () => __sr.filter((r) => r.track && !__local.has(r.track.id) && !__local.has(r.track.label));
window.__sayOthers = (text, fin) => { for (const r of __others()) { const res = [{ transcript: text }]; res.isFinal = fin; r.onresult({ resultIndex: 0, results: [res] }); } };
"""
# an older recognition: ignores a given track (listens to the default microphone)
SR_OLD = """
window.__sr = [];
class FakeSR {
  start() { if (this.on) throw new Error("already started"); this.on = true; __sr.push(this); }
  stop() { this.abort(); }
  abort() { if (!this.on) return; this.on = false; __sr.splice(__sr.indexOf(this), 1); setTimeout(() => this.onend && this.onend(), 0); }
}
window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;
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

    def toasts(pg):
        return pg.evaluate("[...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ')")

    a = page("Ana", SR_TRACK)
    a.goto(f"{BASE}/?signal={WS}")
    a.click("#start")
    a.wait_for_selector("#lobby:not([hidden])")
    a.fill("#name", "Ana")
    a.click("#enter")
    a.wait_for_selector("#call:not([hidden])")
    join = f"{a.url}{'&' if '?' in a.url else '?'}signal={WS}"
    o = page("Beto", SR_OLD)
    enter(o, "Beto", join)
    c = page("Carla", NO_SR)
    enter(c, "Carla", join)
    for pg in (a, o, c):
        pg.wait_for_function("__S.mesh.peers.size === 2 && [...__S.mesh.peers.values()].every(p => p.dc && p.dc.readyState === 'open')", timeout=30000)
    c.wait_for_function("__S.capCan.size === 2", timeout=15000)
    check(c.evaluate("[...__S.capCan.entries()].filter(([, x]) => x.tk).length") == 1, "only Ana's browser offers (Beto's can't listen to a given voice)")
    check(c.evaluate("__S.capHelper") is None, "nobody listens before anyone wants captions")

    # Beto turns captions on
    o.click("#bCaps")
    o.wait_for_selector(".capSheet")
    o.check('input[name="caps"]')
    o.click(".capSheet .primary")
    a_id = a.evaluate("__S.mesh.id")
    c.wait_for_function(f"__S.capHelper === '{a_id}'", timeout=10000)
    check("Ana" in toasts(c), "Carla is told Ana's browser makes her captions")
    a.wait_for_function("__others().length === 1", timeout=10000)
    check("Carla" in toasts(a), "Ana is told her browser makes Carla's captions")
    check(a.evaluate("__others()[0].track.id") != a.evaluate("[...__local][0]"), "Ana's browser listens to Carla's voice as it arrives, not to Ana's microphone")

    a.evaluate("__sayOthers('good morning every', false)")
    o.wait_for_function("[...document.querySelectorAll('#captions .capLine')].some(l => l.lastChild.textContent === 'good morning every')", timeout=5000)
    check(o.evaluate("[...document.querySelectorAll('#captions .capLine')].find(l => l.lastChild.textContent === 'good morning every').firstChild.textContent") == "Carla",
          "Beto reads Carla's words with her name, while she talks")
    a.evaluate("__sayOthers('good morning everyone', true)")
    o.wait_for_function("[...document.querySelectorAll('#captions .capLine')].some(l => l.lastChild.textContent === 'good morning everyone')", timeout=5000)
    check(True, "and when she ends the sentence")
    check(o.evaluate("__S.transcript.some(x => x.name === 'Carla' && x.text === 'good morning everyone')"), "it's in Beto's transcript as Carla's")

    # the words aren't Ana's: a fake 'capfrom' from someone who isn't Carla's helper is ignored
    o.evaluate("for (const [id] of __S.mesh.peers) __S.mesh.sendTo(id, { k: 'capfrom', text: 'not mine', final: true })")
    o.wait_for_timeout(800)
    check(not o.evaluate("[...document.querySelectorAll('#captions .capLine')].some(l => l.lastChild.textContent === 'not mine')")
          and not c.evaluate("__S.transcript.some(x => x.text === 'not mine')"), "only the chosen helper can put words in Carla's captions")

    # Carla mutes: the listening stops
    c.keyboard.press("m")
    a.wait_for_function("__others().length === 0", timeout=8000)
    check(True, "Carla muting stops Ana's browser listening to her")
    c.keyboard.press("m")
    a.wait_for_function("__others().length === 1", timeout=8000)
    check(True, "and it starts again when she unmutes")

    # Ana leaves: nobody else can, so Beto is told Carla's captions stopped
    a.close()
    o.wait_for_function("[...document.querySelectorAll('#captions .capLine')].some(l => /browser can't make captions/.test(l.lastChild.textContent))", timeout=20000)
    check(True, "Ana leaves and nobody else can: Beto is told Carla's browser can't make captions")
    check(c.evaluate("__S.capHelper") is None, "Carla has no helper any more")

    b.close()

print("\nALL OK" if not errors else "\nFAILED:\n" + "\n".join(errors))
sys.exit(1 if errors else 0)
