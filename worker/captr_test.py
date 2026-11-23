# Translated captions, like Meet's (Meet help "Use translated captions": pick "Translate to", captions from the
# others show translated; Meet keeps it for paid plans). Here each viewer's own browser translates on the device
# (the Translator API of Chrome and Edge). Speech and the translator are stubs the test drives, so text is exact.
# Ana speaks English; Beto reads in Spanish; Dora speaks German (a translation the browser must download after a
# click); Carla's browser has no translator (like Firefox).
# Checked: Beto sees Ana's words in Spanish, while she talks and when she ends; his own words aren't translated;
# someone who already speaks his language isn't translated; German needs a click, then works; the .txt keeps what was
# said and the translation; "Don't translate" goes back; the choice is remembered; Carla gets it from another browser.
#   python worker/captr_test.py [base-url]   (local: npx wrangler dev -c wrangler.test.toml --port 8798)
import sys
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8798"
WS = BASE.replace("http", "ws", 1)
ARGS = ["--disable-gpu", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
SR = """
window.__sr = [];
class FakeSR {
  start() { if (this.on) throw new Error("already started"); this.on = true; __sr.push(this); }
  stop() { this.abort(); }
  abort() { if (!this.on) return; this.on = false; __sr.splice(__sr.indexOf(this), 1); setTimeout(() => this.onend && this.onend(), 0); }
}
window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;
window.__say = (text, fin) => { for (const r of __sr) { const res = [{ transcript: text }]; res.isFinal = fin; r.onresult({ resultIndex: 0, results: [res] }); } };
"""
# en and es are on the device; de must be downloaded, which the browser only does right after a click
TR = """
window.__made = [];
window.Translator = {
  async availability({ sourceLanguage: s, targetLanguage: t }) { return s === 'de' && !__made.includes('de>' + t) ? 'downloadable' : 'available'; },
  async create({ sourceLanguage: s, targetLanguage: t }) {
    if (s === 'de' && !navigator.userActivation.isActive) throw new DOMException('needs a click', 'NotAllowedError');
    __made.push(s + '>' + t);
    return { async translate(x) { return '[' + s + '>' + t + '] ' + x; } };
  },
};
"""
NO_TR = "delete window.Translator;"
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)

    def page(name, script, lang="en-US"):
        ctx = b.new_context(locale=lang, permissions=["camera", "microphone"], viewport={"width": 1280, "height": 760}, accept_downloads=True)
        ctx.add_init_script(script)
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror ({name}): {e}"))
        return pg

    def enter(pg, name, url):
        pg.goto(url)
        pg.fill("#name", name)
        pg.click("#enter")
        pg.wait_for_selector("#call:not([hidden])")

    def caps(pg):
        return pg.evaluate("[...document.querySelectorAll('#captions .capLine')].map(l => [l.dataset.id, l.lastChild.textContent])")

    a = page("Ana", SR + TR)
    a.goto(f"{BASE}/?signal={WS}")
    a.click("#start")
    a.wait_for_selector("#lobby:not([hidden])")
    a.fill("#name", "Ana")
    a.click("#enter")
    a.wait_for_selector("#call:not([hidden])")
    join = f"{a.url}{'&' if '?' in a.url else '?'}signal={WS}"
    o = page("Beto", SR + TR, "es-AR")
    enter(o, "Beto", join)
    a.wait_for_function("() => [...__S.mesh.peers.values()].every(p => p.dc && p.dc.readyState === 'open') && __S.mesh.peers.size === 1", timeout=30000)
    o.wait_for_function("() => [...__S.mesh.peers.values()].every(p => p.dc && p.dc.readyState === 'open')", timeout=30000)

    # Beto turns captions on and picks Spanish
    o.click("#bCaps")
    o.wait_for_selector(".capSheet")
    o.check('input[name="caps"]')
    check(o.is_enabled('select[name="capTo"]') and o.input_value('select[name="capTo"]') == "", "translation starts off; the choice is there")
    o.select_option('select[name="capTo"]', "es")
    o.click(".capSheet .primary")
    a.wait_for_function("() => __sr.length === 1", timeout=5000)

    a.evaluate("__say('hello every', false)")
    o.wait_for_function("() => document.querySelector('#captions .capLine span')?.textContent.startsWith('[en>es] hello every')", timeout=5000)
    check(True, "Beto reads Ana's words in Spanish while she talks")
    a.evaluate("__say('hello everyone', true)")
    o.wait_for_function("() => document.querySelector('#captions .capLine span').textContent === '[en>es] hello everyone'", timeout=5000)
    check(True, "and when she ends the sentence")

    # his own words: as said
    o.evaluate("__say('hola a todos', true)")
    o.wait_for_function("() => [...document.querySelectorAll('#captions .capLine')].some(l => l.dataset.id === 'me' && l.lastChild.textContent === 'hola a todos')", timeout=5000)
    check(True, "his own words aren't translated")

    # Dora speaks German: the browser downloads that translation only after a click
    d = page("Dora", SR + TR, "de-DE")
    enter(d, "Dora", join)
    o.wait_for_function("() => __S.mesh.peers.size === 2 && [...__S.mesh.peers.values()].every(p => p.dc && p.dc.readyState === 'open')", timeout=30000)
    d.wait_for_function("() => __sr.length === 1", timeout=10000)
    o.wait_for_function("() => !navigator.userActivation.isActive", timeout=15000)  # Beto's last click has worn off
    d.evaluate("__say('guten Tag', true)")
    o.wait_for_function("() => [...document.querySelectorAll('#captions .capLine')].some(l => l.lastChild.textContent === 'guten Tag')", timeout=5000)
    o.wait_for_selector(".toast", timeout=5000)
    check("clic" in o.inner_text(".toasts"), "German needs a download: it shows as said, and Beto is told a click gets it")
    o.click("#grid")
    o.wait_for_function("() => __made.includes('de>es')", timeout=5000)
    d.evaluate("__say('wie geht es', true)")
    o.wait_for_function("() => [...document.querySelectorAll('#captions .capLine')].some(l => l.lastChild.textContent.includes('[de>es]'))", timeout=5000)
    check(True, "after a click German is translated too")

    # someone speaking Spanish already: not translated
    a.evaluate("__S.capLang = 'es-ES'")
    a.evaluate("__say('buenas tardes', true)")
    o.wait_for_function("() => [...document.querySelectorAll('#captions .capLine')].some(l => l.lastChild.textContent.endsWith('buenas tardes'))", timeout=5000)
    check(not any("buenas tardes" in x[1] and "[" in x[1] for x in caps(o)), "words already in Spanish aren't translated")
    a.evaluate("__S.capLang = 'en-US'")

    # the .txt keeps what was said and the translation
    o.click("#bCaps")
    with o.expect_download() as dl:
        o.click('button[name="capSave"]')
    text = open(dl.value.path(), encoding="utf-8").read()
    check("hello everyone\n  (Español) [en>es] hello everyone\n" in text and "guten Tag wie geht es\n  (Español) [de>es] guten Tag wie geht es\n" in text, "the .txt has the words as said and, under them, the translation")
    check(o.evaluate("localStorage.getItem('juntos.capto')") == "es", "the choice is remembered")  # pinned: the language the test picked

    # Don't translate
    o.select_option('select[name="capTo"]', "")
    o.click(".capSheet .primary")
    o.wait_for_timeout(2000)
    a.evaluate("__say('back to normal', true)")
    o.wait_for_function("() => [...document.querySelectorAll('#captions .capLine')].some(l => l.lastChild.textContent === 'back to normal')", timeout=5000)
    check(True, "\"Don't translate\" shows the words as said again")

    # Carla's browser has no translator (like Firefox): a browser in the call that has one translates for her
    # (Kleider, 2026-11-19: "redirecting that traffic through another user that CAN do these things")
    c = page("Carla", SR + NO_TR)
    enter(c, "Carla", join)
    c.wait_for_function("() => __S.capCan.size === 3 && [...__S.capCan.values()].every(x => x.tr)", timeout=30000)
    c.click("#bCaps")
    c.wait_for_selector(".capSheet")
    check(c.is_enabled('select[name="capTo"]') and "translates them for you" in c.inner_text(".capTrNote"), "Carla's browser can't translate: the note says whose browser does it for her")
    c.check('input[name="caps"]')
    c.select_option('select[name="capTo"]', "es")
    c.click(".capSheet .primary")
    a.wait_for_timeout(1500)
    a.evaluate("__say('see you tomorrow', true)")
    c.wait_for_function("() => [...document.querySelectorAll('#captions .capLine')].some(l => l.lastChild.textContent === '[en>es] see you tomorrow')", timeout=8000)
    check(True, "she reads Ana's words in Spanish, translated by another browser in the call")

    b.close()

print("\nALL OK" if not errors else "\nFAILED:\n" + "\n".join(errors))
sys.exit(1 if errors else 0)
