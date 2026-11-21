# Screens for a cold review (C:/AI/Hub/docs/HARNESS.md "three Haiku reviews"), in the order someone meets them:
# a computer at 1280x720 (the host, Ana), then a phone at 360x640 (Beto). Fake cameras; captions are a stub.
#   python worker/review_shots.py <out folder> [base-url]   (local: npx wrangler dev -c wrangler.test.toml --port 8798)
import os
import sys
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
BASE = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:8798"
WS = BASE.replace("http", "ws", 1)
os.makedirs(OUT, exist_ok=True)
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
n = [0]
shots = []


def close(pg):
    # a sheet closes with its own button (or a tap outside it)
    for sel in (".sheet .primary", ".sheet button.close", ".sheet [name=close]"):
        if pg.locator(sel).count() and pg.locator(sel).first.is_visible():
            pg.locator(sel).first.click()
            break
    else:
        pg.mouse.click(5, 5)
    pg.wait_for_timeout(400)


def shot(pg, what):
    n[0] += 1
    f = os.path.join(OUT, f"{n[0]:02d}-{what}.png")
    pg.wait_for_timeout(700)
    pg.screenshot(path=f)
    shots.append(f)
    print(f, flush=True)


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)

    def page(name, **kw):
        ctx = b.new_context(locale="en-US", permissions=["camera", "microphone"], **kw)
        ctx.add_init_script(STUB)
        return ctx.new_page()

    PC = dict(viewport={"width": 1280, "height": 720})
    PHONE = dict(viewport={"width": 360, "height": 640}, is_mobile=True, has_touch=True)

    a = page("Ana", **PC)
    a.goto(f"{BASE}/?signal={WS}")
    shot(a, "pc-start")
    a.click("#start")
    a.wait_for_selector("#lobby:not([hidden])")
    shot(a, "pc-lobby")
    a.fill("#name", "Ana")
    a.click("#enter")
    a.wait_for_selector("#call:not([hidden])")
    shot(a, "pc-call-alone")
    join = f"{a.url}{'&' if '?' in a.url else '?'}signal={WS}"

    others = []
    for name in ("Beto", "Carla", "Dani"):
        pg = page(name, **(PHONE if name == "Beto" else PC))
        pg.goto(join)
        pg.fill("#name", name)
        pg.click("#enter")
        pg.wait_for_selector("#call:not([hidden])")
        others.append(pg)
    a.wait_for_function("() => __S.mesh.peers.size === 3 && [...__S.mesh.peers.values()].every(p => p.dc && p.dc.readyState === 'open')", timeout=40000)
    a.wait_for_timeout(2500)
    shot(a, "pc-call-four")

    a.click("#bChat")
    a.fill("#chatText", "Hi all, can you see my screen later?")
    a.keyboard.press("Enter")
    shot(a, "pc-chat")
    a.click("#bPeople")
    shot(a, "pc-people")
    a.click("#bCaps")
    a.wait_for_selector(".capSheet")
    shot(a, "pc-captions-sheet")
    a.check('input[name="caps"]')
    a.click(".capSheet .primary")
    others[1].wait_for_function("() => __sr.length === 1", timeout=8000)
    others[1].evaluate("__say('Good morning everyone, shall we start with the budget?', true)")
    a.wait_for_timeout(800)
    shot(a, "pc-captions-on")
    a.click("#bMore")
    a.click(".sheet #bAct")
    shot(a, "pc-polls")
    a.click("#bMore")
    a.click(".sheet #bBoard")
    shot(a, "pc-board")
    a.click("#bMore")
    a.click(".sheet #bLayout")
    shot(a, "pc-layout-sheet")
    close(a)
    a.click("#bReact")
    shot(a, "pc-react")
    close(a)

    # the phone
    beto = others[0]
    shot(beto, "phone-call-four")
    beto.click("#bMore")
    shot(beto, "phone-more")
    beto.click(".sheet #bChat")
    shot(beto, "phone-chat")

    # leaving
    a.click("#bLeave"); a.query_selector("#justLeave") and a.click("#justLeave")  # a host is asked: just leave
    a.wait_for_selector("#ended:not([hidden])")
    shot(a, "pc-after-leaving")
    phone = page("Eva", **PHONE)
    phone.goto(f"{BASE}/?signal={WS}")
    shot(phone, "phone-start")
    b.close()
print("\n".join(shots))
