# Backgrounds in a two-person call (headless Edge, fake camera, software GPU): the other person must keep
# receiving a moving picture through every background change, after "None", and after the browser pauses the
# hidden camera video (phones do). Run: python bg_test.py [base-url]  (local: npx wrangler dev --port 8797)
import sys
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8797"
WS = BASE.replace("http", "ws", 1)
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required",
        "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
FRAMES = """async (sel) => { const v = document.querySelector(sel); if (!v) return -1;
  let n = 0; const tick = () => { n++; v.requestVideoFrameCallback(tick) }; v.requestVideoFrameCallback(tick);
  await new Promise(r => setTimeout(r, 2000)); return n }"""
OTHER, SELF = '.tile:not([data-id="me"]) video', '.tile[data-id="me"] video'
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)
    def person():
        pg = b.new_context(locale="en-US", permissions=["camera", "microphone"]).new_page()
        pg.on("pageerror", lambda e: errors.append(str(e)))
        return pg
    a = person(); a.goto(f"{BASE}/?signal={WS}"); a.click("#start"); a.fill("#name", "Ana"); a.click("#enter")
    a.wait_for_selector("#call:not([hidden])")
    o = person(); o.goto(f"{a.url}{'&' if '?' in a.url else '?'}signal={WS}"); o.fill("#name", "Beto"); o.click("#enter")
    o.wait_for_selector(OTHER, timeout=20000); o.wait_for_timeout(3000)
    assert o.evaluate(FRAMES, OTHER) >= 20, "no picture before any background"
    a.evaluate("document.getElementById('bBg').click()"); a.wait_for_timeout(500)
    for label in ["Green", "None", "Warm", "Blur", "None"]:
        a.evaluate(f"[...document.querySelectorAll('.bgChoice')].find(e => e.title === '{label}').click()")
        if label != "None":  # the first switch loads the model (a few seconds on a software GPU)
            a.wait_for_function("(window.__juntosBg?.stats.draws || 0) > 5", timeout=30000)
        a.wait_for_timeout(3000)
        seen = o.evaluate(FRAMES, OTHER)
        print(f"{label:6} other person sees {seen} frames in 2 s", flush=True)
        assert seen >= (20 if label == "None" else 3), f"picture stopped after '{label}'"
    a.evaluate(f"[...document.querySelectorAll('.bgChoice')].find(e => e.title === 'Green').click()"); a.wait_for_timeout(3000)
    a.evaluate("window.__juntosBg.video.pause()")  # what a phone does to a hidden video
    a.wait_for_timeout(2500)
    seen = o.evaluate(FRAMES, OTHER)
    print(f"after pause: {seen} frames in 2 s")
    assert seen >= 3, "picture stayed frozen after the camera video was paused"
    b.close()
assert not errors, errors
print("OK")
