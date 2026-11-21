# Adjust video lighting, like Meet's (Settings > Video > "Adjust video lighting"; Meet suggests it when you look
# underexposed): a camera in a dark room gets the suggestion after a few seconds, turning it on makes the picture the
# OTHER person receives brighter, it keeps working under a background effect, it is remembered, and it turns off.
#   python worker/light_test.py [base-url]   (local: npx wrangler dev -c wrangler.test.toml --port 8798)
import os
import sys

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8798"
WS = BASE.replace("http", "ws", 1)
# a dark room: a dim face-like blob that moves a little on a near-black background
CAM = os.path.join(os.environ.get("TEMP", "."), "juntos_dark.y4m")
W, H, N = 320, 240, 30
with open(CAM, "wb") as f:
    f.write(f"YUV4MPEG2 W{W} H{H} F15:1 Ip A1:1 C420jpeg\n".encode())
    uv = bytes([128]) * (W // 2 * H // 2)
    for i in range(N):
        cx = 160 + (i % 10) * 2
        y = bytearray(W * H)
        for r in range(H):
            for c in range(W):
                y[r * W + c] = 70 if ((c - cx) / 60) ** 2 + ((r - 120) / 80) ** 2 < 1 else 22
        f.write(b"FRAME\n" + bytes(y) + uv + uv)
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required",
        f"--use-file-for-fake-video-capture={CAM}"]
OTHER = '.tile:not([data-id="me"]) video'
SEEN = """(sel) => { const v = document.querySelector(sel); if (!v || !v.videoWidth) return -1;
  const c = document.createElement('canvas'); c.width = 32; c.height = 24; const x = c.getContext('2d');
  x.drawImage(v, 0, 0, 32, 24); const d = x.getImageData(0, 0, 32, 24).data; let s = 0;
  for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; return s / (d.length / 4) }"""
TOP = SEEN.replace("let s = 0;", "const ys = [];").replace("s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; return s / (d.length / 4)",
                                                       "ys.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]); ys.sort((p, q) => p - q); return ys[Math.floor(ys.length * 0.95)]")
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)

    def person():
        pg = b.new_context(locale="en-US", permissions=["camera", "microphone"]).new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        return pg

    a = person()
    a.goto(f"{BASE}/?signal={WS}")
    a.click("#start")
    a.fill("#name", "Ana")
    a.click("#enter")
    a.wait_for_selector("#call:not([hidden])")
    o = person()
    o.goto(f"{a.url}{'&' if '?' in a.url else '?'}signal={WS}")
    o.fill("#name", "Beto")
    o.click("#enter")
    o.wait_for_selector(OTHER, timeout=20000)
    o.wait_for_timeout(2000)
    before = o.evaluate(SEEN, OTHER)
    o.locator(".tile:not([data-id=\"me\"])").first.screenshot(path=os.path.join(os.environ.get("TEMP", "."), "juntos_light_before.png"))
    check(0 <= before < 60, f"Beto sees Ana dark at first (brightness {before:.0f})")

    a.wait_for_selector('#toasts [name="lightOn"]', timeout=15000)
    check("You look dark" in a.evaluate("document.getElementById('toasts').textContent"), "Ana gets the suggestion after a few seconds in the dark")
    a.click('#toasts [name="lightOn"]')
    a.wait_for_function("() => __S.lightOn && window.__juntosLight?.gain > 1", timeout=10000)
    o.wait_for_timeout(2500)
    after = o.evaluate(SEEN, OTHER)
    o.locator(".tile:not([data-id=\"me\"])").first.screenshot(path=os.path.join(os.environ.get("TEMP", "."), "juntos_light_after.png"))
    check(after > before + 30, f"she turns it on: Beto sees her brighter ({before:.0f} -> {after:.0f})")
    top = o.evaluate(TOP, OTHER)
    check(top < 235, f"without burning out the brightest part (the face: {top:.0f}, white is 255)")
    plan = a.evaluate("import('/light.js').then(m => m.plan({ mean: 60, top: 252 }))")
    check(plan["mul"] == 1 and plan["screen"] > 0.5, f"a window behind you: the dark parts are lifted, nothing is multiplied ({plan})")
    plan = a.evaluate("import('/light.js').then(m => m.plan({ mean: 140, top: 230 }))")
    check(plan == {"mul": 1, "screen": 0}, "a well lit picture is left alone")
    check(a.evaluate("localStorage.getItem('juntos.light')") == "on", "it is remembered")
    check(a.query_selector('#toasts [name="lightOn"]') is None, "the suggestion goes away")

    # under a background effect the brightened picture is the one used
    a.evaluate("(document.getElementById('bBg') || __S.barBtns.bBg).click()")
    a.wait_for_timeout(500)
    a.evaluate("[...document.querySelectorAll('.bgChoice')].find(e => e.title === 'Blur').click()")
    a.wait_for_function("() => (window.__juntosBg?.stats.draws || 0) > 5", timeout=30000)
    check(a.evaluate("window.__juntosBg.camera === window.__juntosLight.track"), "a background effect works on the brightened picture")
    a.evaluate("[...document.querySelectorAll('.bgChoice')].find(e => e.title === 'None').click()")
    a.wait_for_timeout(1500)
    a.keyboard.press("Escape")

    # turned off in the settings
    a.evaluate("(document.getElementById('bDev') || __S.barBtns.bDev).click()")
    a.wait_for_selector("input[name=light]", timeout=5000)
    check(a.is_checked("input[name=light]"), "the settings show it on")
    a.click("input[name=light]", force=True)
    a.wait_for_function("() => !__S.lightOn && !__S.light", timeout=5000)
    o.wait_for_timeout(2500)
    off = o.evaluate(SEEN, OTHER)
    check(off < after - 20, f"turned off: back to the camera as it is ({off:.0f})")
    check(not [e for e in errors if e.startswith("pageerror")], "no page errors")
    b.close()

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
