# A shared screen in its own window, like Meet's "Open in new window" (Workspace update 2026-02): Beto opens Ana's
# shared screen in a window of its own, which shows her moving screen while his call shows the people; closing it
# (or "Back to the call") brings it back, and it closes by itself when she stops sharing.
#   python worker/popout_test.py [base-url]   (local: npx wrangler dev -c wrangler.test.toml --port 8798)
import os
import sys

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8798"
WS = BASE.replace("http", "ws", 1)
ARGS = ["--disable-gpu", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
PICKER = """
navigator.mediaDevices.getDisplayMedia = async () => {
  const c = document.createElement('canvas'); c.width = 640; c.height = 360; const g = c.getContext('2d');
  setInterval(() => { g.fillStyle = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'); g.fillRect(0, 0, 640, 360) }, 100);
  return c.captureStream(15);
};
"""
FRAMES = """async () => { const v = document.querySelector('video'); if (!v || !v.srcObject) return -1;
  let n = 0; const tick = () => { n++; v.requestVideoFrameCallback(tick) }; v.requestVideoFrameCallback(tick);
  await new Promise(r => setTimeout(r, 2000)); return n }"""
SHOT = os.path.join(os.environ.get("TEMP", "."), "juntos_popout.png")
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)

    def person():
        ctx = b.new_context(locale="en-US", permissions=["camera", "microphone"], viewport={"width": 1280, "height": 720})
        ctx.add_init_script(PICKER)
        pg = ctx.new_page()
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
    o.wait_for_selector('.tile:not([data-id="me"]) video', timeout=20000)
    check(not o.is_visible(".popBtn"), "no Open in new window on a camera picture")
    a.click("#bScreen")
    o.wait_for_selector(".tile.screen .popBtn", state="visible", timeout=15000)
    check(True, "Ana shares her screen: Beto gets Open in new window on it")
    with o.context.expect_page() as info:
        o.click(".tile.screen .popBtn")
    w = info.value
    w.wait_for_function("() => document.querySelector('video')?.videoWidth > 0", timeout=10000)
    seen = w.evaluate(FRAMES)
    check(seen >= 8, f"the new window shows her moving screen ({seen} frames in 2 s)")
    check(w.evaluate("document.querySelector('video').muted"), "without a second copy of the sound")
    check(o.evaluate("document.getElementById('grid').dataset.mode") == "tiled", "the call window shows the people meanwhile")  # pinned: a popped-out screen leaves the call window to the people
    check(o.is_visible(".tile.popped .poppedNote"), "her tile says it is in its own window")
    check(o.evaluate("(() => { const l = document.querySelector('.tile.popped .label').getBoundingClientRect(); const e = document.elementFromPoint(l.left + 4, l.top + l.height / 2); return !!e.closest('.label') })()"), "her name stays visible on it")
    o.screenshot(path=SHOT)

    w.close()
    o.wait_for_function("() => !document.querySelector('.tile.popped')", timeout=5000)
    check(o.evaluate("document.getElementById('grid').dataset.mode") == "sidebar", "closing the window brings it back into the call")  # pinned: auto layout puts a shared screen big (sidebar)

    with o.context.expect_page() as info:
        o.click(".tile.screen .popBtn")
    w = info.value
    w.wait_for_selector("[name=dock]")
    w.click("[name=dock]")
    o.wait_for_function("() => !document.querySelector('.tile.popped')", timeout=5000)
    check(w.is_closed(), "Back to the call closes it and brings it back")

    with o.context.expect_page() as info:
        o.click(".tile.screen .popBtn")
    w = info.value
    w.wait_for_selector("video")
    a.click("#bScreen")  # she stops sharing
    o.wait_for_function("() => !document.querySelector('.tile.popped')", timeout=10000)
    w.wait_for_event("close", timeout=5000) if not w.is_closed() else None
    check(w.is_closed(), "it closes by itself when she stops sharing")
    check(not [e for e in errors if e.startswith("pageerror")], "no page errors")
    print("screenshot:", SHOT)
    b.close()

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
