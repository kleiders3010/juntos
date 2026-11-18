# Everyone is heard: the other person's voice really plays (its <audio> starts and its time moves), with cameras on
# and with cameras off. A video element that never gets a picture (camera off, or video not sent to save data) never
# starts; voices used to play from it, so with cameras off nobody was heard while their talking ring still lit up.
# Run: python hear_test.py [base-url]
import sys
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8797"
WS = BASE.replace("http", "ws", 1)
# no --autoplay-policy flag: the page plays sound the way it does for people, after their clicks
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]
VOICE = """() => { const t = document.querySelector('#grid .tile:not([data-id="me"])'); const a = t && t.querySelector('audio');
  return a ? { started: a.readyState > 0, paused: a.paused, muted: a.muted, time: a.currentTime,
               videoMuted: t.querySelector('video').muted } : null }"""
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


def call(b, cams):
    def page(name):
        pg = b.new_context(locale="en-US", permissions=["camera", "microphone"]).new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror ({name}): {e}"))
        return pg

    a = page("Ana")
    a.goto(f"{BASE}/?signal={WS}")
    a.click("#start")
    a.wait_for_selector("#lobby:not([hidden])")
    if not cams:
        a.click("#pCam")
    a.fill("#name", "Ana")
    a.click("#enter")
    a.wait_for_selector("#call:not([hidden])")
    o = page("Beto")
    o.goto(f"{a.url}{'&' if '?' in a.url else '?'}signal={WS}")
    o.wait_for_selector("#lobby:not([hidden])")
    if not cams:
        o.click("#pCam")
    o.fill("#name", "Beto")
    o.click("#enter")
    o.wait_for_selector("#call:not([hidden])")
    label = "cameras on" if cams else "cameras off"
    for who, pg in (("Ana", a), ("Beto", o)):
        try:
            pg.wait_for_function(f"(({VOICE})() || {{}}).time > 0.5", timeout=15000)
        except Exception:
            pass
        v1 = pg.evaluate(VOICE)
        pg.wait_for_timeout(1500)
        v2 = pg.evaluate(VOICE)
        playing = bool(v1 and v2 and v2["started"] and not v2["paused"] and not v2["muted"] and v2["time"] > v1["time"])
        check(playing, f"{label}: {who} hears the other person (voice plays: {v2})")
        check(bool(v2 and v2["videoMuted"]), f"{label}: the picture is muted, the voice comes only from its own element")
    a.context.close()
    o.context.close()


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)
    call(b, cams=True)
    call(b, cams=False)
    b.close()

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
