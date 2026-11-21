# Call screen checks with two people (headless Edge, fake devices): the connection line, full screen for
# one person, the Devices sheet (switching the microphone reaches the other side), recording feedback on
# both sides, and "Try again" after a connection gave up. Run: python ui_test.py [base-url]
import re, sys
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8798"
WS = BASE.replace("http", "ws", 1)
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
OTHER = '.tile:not([data-id="me"])'
FRAMES = """async (sel) => { const v = document.querySelector(sel); if (!v) return -1;
  let n = 0; const tick = () => { n++; v.requestVideoFrameCallback(tick) }; v.requestVideoFrameCallback(tick);
  await new Promise(r => setTimeout(r, 1500)); return n }"""
MIC_SELECT = "[...document.querySelectorAll('.devRow')].find(r => r.firstChild.textContent === 'Microphone').querySelector('select')"
SHEET = "[document.querySelector('.recSheet .seg button.on').dataset.layout, ...[...document.querySelectorAll('.recSheet input')].map(i => i.checked)]"
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)

    def person():
        pg = b.new_context(locale="en-US", permissions=["camera", "microphone"], accept_downloads=True).new_page()
        pg.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        return pg

    a = person()
    a.goto(f"{BASE}/?signal={WS}")
    a.click("#start")
    a.fill("#name", "Ana")
    a.click("#enter")
    a.wait_for_selector("#call:not([hidden])")
    a.wait_for_function("() => __S.joined && !document.getElementById('netState').hidden", timeout=10000)
    check(True, "alone: the top line tells you (waiting for others)")
    o = person()
    o.goto(f"{a.url}{'&' if '?' in a.url else '?'}signal={WS}")
    o.fill("#name", "Beto")
    o.click("#enter")
    a.wait_for_selector(OTHER + " video", timeout=20000)
    a.wait_for_function(f"() => document.querySelector('{OTHER} .status').hidden", timeout=20000)
    check(a.evaluate("document.getElementById('netState').hidden"), "connected: the top line is gone")
    check(a.evaluate(FRAMES, OTHER + " video") > 10, "Ana sees Beto's picture")

    # full screen for one person, Esc brings everyone back
    a.click(OTHER + " .fsBtn")
    check(a.evaluate(f"document.querySelector('{OTHER}').classList.contains('spot') && document.getElementById('grid').classList.contains('hasSpot')"),
          "full screen button puts Beto full screen")
    box = a.evaluate(f"(() => {{ const r = document.querySelector('{OTHER}').getBoundingClientRect(), g = document.getElementById('grid').getBoundingClientRect(); return [r.width / g.width, r.height / g.height] }})()")
    check(box[0] > .95 and box[1] > .95, f"Beto fills the stage ({box[0]:.2f} x {box[1]:.2f})")
    a.keyboard.press("Escape")
    check(not a.evaluate("document.getElementById('grid').classList.contains('hasSpot')"), "Esc goes back to everyone")

    # devices: the sheet lists them; switching the microphone sends the new one to Beto
    a.evaluate("(document.getElementById('bDev') || __S.barBtns.bDev).click()")
    a.wait_for_selector(".devices select")
    rows = a.evaluate("[...document.querySelectorAll('.devRow')].map(r => r.firstChild.textContent + ':' + r.querySelector('select').options.length)")
    check(any(r.startswith("Camera") for r in rows) and any(r.startswith("Microphone") for r in rows), f"devices sheet: {rows}")
    before = a.evaluate("__S.micTrack.id")
    a.evaluate(f"(() => {{ const s = {MIC_SELECT}; s.selectedIndex = (s.selectedIndex + 1) % s.options.length; s.dispatchEvent(new Event('change')) }})()")
    a.wait_for_function(f"() => __S.micTrack.id !== '{before}'", timeout=10000)
    check(a.evaluate("[...__S.mesh.peers.values()][0].audio.sender.track?.id === __S.micTrack.id"), "the new microphone is the one sent to Beto")
    a.evaluate("[...document.querySelectorAll('.sheet button.primary')].pop().click()")

    # recording: red Stop button and a running timer for Ana, "Ana is recording" for Beto
    # volume for one person: above 100 % his voice goes through a boost (and really carries sound); below, the tile's own volume
    a.click(OTHER + " .volBtn")
    a.wait_for_selector(".volPop input[type=range]")
    vmax = int(a.evaluate("document.querySelector('.volPop input').max"))
    a.evaluate(f"(() => {{ const r = document.querySelector('.volPop input'); r.value = {vmax}; r.dispatchEvent(new Event('input')) }})()")
    a.wait_for_timeout(300)
    boost = a.evaluate(f"""async () => {{ const p = [...__S.mesh.peers.values()][0]; if (!p.boost) return 'no boost';
      const an = __S.out.createAnalyser(); an.fftSize = 512; p.boost.gain.connect(an); const buf = new Uint8Array(512); let peak = 0;
      for (let i = 0; i < 30; i++) {{ await new Promise(r => setTimeout(r, 50)); an.getByteTimeDomainData(buf); for (const b of buf) peak = Math.max(peak, Math.abs(b - 128)) }}
      return [p.boost.gain.gain.value, document.querySelector('{OTHER} audio').muted, peak] }}""")
    check(isinstance(boost, list) and abs(boost[0] - vmax / 100) < 0.01 and boost[1] and boost[2] > 2, f"boosted: louder voice really plays, tile quiet ({boost})")
    a.evaluate("(() => { const r = document.querySelector('.volPop input'); r.value = 50; r.dispatchEvent(new Event('input')) })()")
    check(a.evaluate(f"(() => {{ const v = document.querySelector('{OTHER} audio'); return !v.muted && Math.abs(v.volume - .5) < .01 && ![...__S.mesh.peers.values()][0].boost }})()"),
          "lower than normal: the tile's own volume, no boost")
    a.mouse.click(5, 5)
    check(not a.evaluate("!!document.querySelector('.volPop')"), "a tap elsewhere closes the volume box")
    # first a sheet says what will be recorded; the choices made there are remembered next time
    a.evaluate("(document.getElementById('bRec') || __S.barBtns.bRec).click()")
    check(not a.evaluate("!!__S.recorder"), "Record first shows what will be recorded (not recording yet)")
    before = a.evaluate(SHEET)
    a.click('.seg button[data-layout="grid"]')
    a.uncheck('.recSheet input[name="chat"]')
    a.click(".recSheet .ghost")
    a.evaluate("(document.getElementById('bRec') || __S.barBtns.bRec).click()")
    check(a.evaluate(SHEET) == before, "Cancel keeps the old choices")
    a.click('.seg button[data-layout="grid"]')
    a.uncheck('.recSheet input[name="chat"]')
    a.click("#recGo")
    check(a.evaluate("__S.recorder.opts.layout === 'grid' && !__S.recorder.opts.chat"), "the recording uses what was chosen")  # pinned: layout ids speaker/grid are stored on devices
    a.wait_for_timeout(2500)
    check(a.evaluate("(document.getElementById('bRec') || __S.barBtns.bRec).classList.contains('recording')"), "record button turns red")
    dot = a.evaluate("document.getElementById('recDot').hidden ? '' : document.getElementById('recDot').textContent")
    a.wait_for_timeout(1200)
    dot2 = a.evaluate("document.getElementById('recDot').textContent")
    check(bool(re.search(r"\d:\d\d", dot)) and dot != dot2, f"a timer runs at the top: '{dot}' then '{dot2}'")
    o.wait_for_function("() => !document.getElementById('recDot').hidden", timeout=5000)
    check("Ana" in o.evaluate("document.getElementById('recDot').textContent"), "Beto sees that Ana is recording")
    with a.expect_download(timeout=20000):
        a.evaluate("document.getElementById('recDot').click()")
    o.wait_for_function("() => document.getElementById('recDot').hidden", timeout=5000)
    a.evaluate("(document.getElementById('bRec') || __S.barBtns.bRec).click()")
    check(a.evaluate(SHEET)[0] == "grid" and a.evaluate("!document.querySelector('.recSheet input[name=\"chat\"]').checked"),
          "next time the sheet remembers the choices")  # pinned: layout ids speaker/grid are stored on devices
    a.click(".recSheet .ghost")
    check(a.evaluate("document.getElementById('recDot').hidden && !(document.getElementById('bRec') || __S.barBtns.bRec).classList.contains('recording')"), "tapping the timer stops and saves")

    # a connection that gave up shows Try again, and Try again reconnects
    a.evaluate("(() => { const p = [...__S.mesh.peers.values()][0]; p.state = 'failed'; __S.mesh.giveUp(p) })()")
    a.wait_for_selector(OTHER + " .status button", timeout=5000)
    check("Beto" in a.evaluate(f"document.querySelector('{OTHER} .status').textContent"), "gave up: says who and offers Try again")
    a.click(OTHER + " .status button")
    a.wait_for_function(f"() => document.querySelector('{OTHER} .status').hidden", timeout=30000)
    a.wait_for_timeout(1500)
    check(a.evaluate(FRAMES, OTHER + " video") > 10, "after Try again, Ana sees Beto again")
    check(o.evaluate(FRAMES, OTHER + " video") > 10, "and Beto sees Ana")
    check(a.evaluate("document.querySelectorAll('.tile').length") == 2 and o.evaluate("document.querySelectorAll('.tile').length") == 2, "still two tiles each (no ghost)")
    check(a.evaluate("navigator.serviceWorker.getRegistration().then(r => !!r)"), "service worker for the call notification is registered")
    b.close()

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
