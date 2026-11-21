# Connection quality and spending it well (headless Edge, fake devices), three people:
# bars on every picture (and the details behind them), sound sent ahead of video, each viewer gets what their
# tile needs (big = full, thumbnail = small, hidden = nothing: measured in the received video), Data saver
# (one picture, the rest paused; tap one to see it; my own picture at most 360p), Audio only (no videos, sound
# still flows), the automatic step-down on a weak connection and back up, the line at the top, mobile data
# turns Data saver on by default, the choice is remembered, Spanish.
# A weak link is simulated by feeding bad numbers into the measurement (window.__netFake); the reaction to
# it (what is asked from each sender, what the senders then send) is measured for real.
# Run: python net_test.py [base-url]
import os, sys, tempfile
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8798"
WS = BASE.replace("http", "ws", 1)
OUT = tempfile.mkdtemp()
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
errors = []
OPEN_DEV = "(() => { if (!(document.getElementById('bDev') || __S.barBtns.bDev) || !(document.getElementById('bDev') || __S.barBtns.bDev).offsetParent) document.getElementById('bMore')?.click(); (document.getElementById('bDev') || __S.barBtns.bDev).click() })()"

# per person (by name): video frames decoded and frame height received, audio packets received
INBOUND = """async () => { const out = {}; for (const p of __S.mesh.peers.values()) { const r = await p.pc.getStats();
  const o = { frames: 0, h: 0, audio: 0 }; r.forEach(x => { if (x.type === 'inbound-rtp' && x.kind === 'video') { o.frames = x.framesDecoded || 0; o.h = x.frameHeight || 0 }
  if (x.type === 'inbound-rtp' && x.kind === 'audio') o.audio = x.packetsReceived || 0 }); out[p.name] = o } return out }"""
WANTS = "Object.fromEntries([...document.querySelectorAll('#grid .tile:not([data-id=me])')].map(t => [t.querySelector('.nm').textContent, t.wantSent || null]))"
PAUSED = "Object.fromEntries([...document.querySelectorAll('#grid .tile:not([data-id=me])')].map(t => [t.querySelector('.nm').textContent, t.classList.contains('paused')]))"
BARS = "Object.fromEntries([...document.querySelectorAll('#grid .tile')].map(t => [t.querySelector('.nm').textContent.split(' ')[0], t.querySelector('.bars').hidden ? 0 : +t.querySelector('.bars').dataset.b]))"


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


def flow(pg, secs=3):
    """frames decoded per person during a few seconds, last height, audio packets"""
    a = pg.evaluate(INBOUND)
    pg.wait_for_timeout(secs * 1000)
    b = pg.evaluate(INBOUND)
    return {k: {"frames": b[k]["frames"] - a.get(k, {}).get("frames", 0), "h": b[k]["h"], "audio": b[k]["audio"] - a.get(k, {}).get("audio", 0)} for k in b}


def quality(pg, v):
    pg.evaluate(OPEN_DEV)
    pg.wait_for_selector('.qualityBox .seg button[data-v="auto"]')
    pg.click(f'.qualityBox .seg button[data-v="{v}"]')
    pg.click(".sheetInner.devices > .primary")


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)

    def person(name, url, init=None, pre=None, **opts):
        ctx = b.new_context(locale=opts.pop("locale", "en-US"), permissions=["camera", "microphone"], **opts)
        if init:
            ctx.add_init_script(init)
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror ({name}): {e}"))
        if pre:
            pre(pg)
        pg.goto(url)
        if "/r/" not in url:
            pg.click("#start")
        pg.fill("#name", name)
        pg.click("#enter")
        pg.wait_for_selector("#call:not([hidden])")
        return pg

    a = person("Ana", f"{BASE}/?signal={WS}", viewport={"width": 1280, "height": 760})
    join = f"{a.url}{'&' if '?' in a.url else '?'}signal={WS}"
    o = person("Beto", join)
    c = person("Caro", join)
    a.wait_for_function("() => document.querySelectorAll('#grid .tile video').length === 3 && [...__S.mesh.peers.values()].every(p => p.state === 'connected')", timeout=30000)
    for pg in (a, o, c):
        pg.evaluate("document.getElementById('bMic').click()")  # quiet, so nobody takes the spotlight by beeping

    # --- bars ---
    a.wait_for_function(f"() => Object.values({BARS}).every(b => b > 0)", timeout=15000)
    bars = a.evaluate(BARS)
    check(all(v == 4 for v in bars.values()), f"bars on every picture, all good on this machine: {bars}")  # pinned: a local link is 4 bars
    a.wait_for_timeout(3000)
    print("  links:", a.evaluate("JSON.stringify([...__S.netq.links.values()].map(l => [l.rtt, l.loss, l.h, l.kbps]))"))
    a.click('#grid .tile:not([data-id=me]) .bars')
    pop = a.inner_text(".netPop")
    check("Connection: Good" in pop and "Delay" in pop and "kbps" in pop, f"tapping the bars shows what was measured: {pop!r}")
    a.click('#grid .tile[data-id=me] .bars')
    check("Your connection" in a.inner_text(".netPop"), "my own bars: my connection")
    a.mouse.click(5, 5)

    # --- sound ahead of video, error correction for sound ---
    pr = o.evaluate("(() => { const p = [...__S.mesh.peers.values()][0]; return [p.audio.sender.getParameters().encodings[0]?.priority, p.video.sender.getParameters().encodings[0]?.priority, p.pc.remoteDescription.sdp.includes('useinbandfec=1')] })()")
    check(pr[0] == "high" and pr[1] == "low", f"sound goes before video (priority audio {pr[0]}, video {pr[1]})")  # pinned: audio first is the design (item 26)
    check(pr[2], "sound carries error correction (Opus in-band FEC)")

    # --- each tile gets what it needs: Sidebar with Beto big, Caro small ---
    a.evaluate("__S.view.layout = 'sidebar'; document.querySelector('#grid .tile:not([data-id=me])') && 0")
    a.evaluate("[...document.querySelectorAll('#grid .tile')].find(t => t.querySelector('.nm').textContent === 'Beto').querySelector('.fsBtn').click()")
    a.wait_for_timeout(7000)  # the big picture ramps up as the browser's bandwidth estimate grows
    w = a.evaluate(WANTS)
    check(w.get("Beto") == "high" and w.get("Caro") in ("low", "mid"), f"pinned big = high, the others smaller: {w}")  # pinned: want levels high/mid/low/off are the wire protocol
    f = flow(a)
    check(f["Caro"]["h"] <= 180 and f["Caro"]["h"] < f["Beto"]["h"], f"received: Beto {f['Beto']['h']}p big, Caro {f['Caro']['h']}p small")
    sent = c.evaluate("[...__S.mesh.peers.values()].find(p => p.name === 'Ana').sent")
    check(sent and sent["want"] == w["Caro"], f"Caro's sender follows what Ana asked: {sent}")
    # Spotlight: Caro isn't shown at all, so she sends Ana nothing
    a.evaluate("__S.view.layout = 'spotlight'; localStorage.setItem('juntos.view', JSON.stringify(__S.view))")
    a.evaluate("document.getElementById('grid') && 0")
    a.evaluate("(() => { const s = document.querySelector('.tile.spot'); s.querySelector('.fsBtn').click(); s.querySelector('.fsBtn').click() })()")
    a.wait_for_timeout(2500)
    w = a.evaluate(WANTS)
    f = flow(a)
    check(w.get("Caro") == "off" and f["Caro"]["frames"] == 0 and f["Beto"]["frames"] > 20, f"hidden picture costs nothing: {w}, frames {f['Beto']['frames']} / {f['Caro']['frames']}")
    check(f["Caro"]["audio"] > 50, f"her sound still comes ({f['Caro']['audio']} packets in 3 s)")
    a.evaluate("__S.view.layout = 'tiled'; document.querySelector('.tile.spot')?.querySelector('.fsBtn').click()")
    a.wait_for_timeout(3000)
    f = flow(a)
    check(f["Caro"]["frames"] > 20, f"shown again: her video is back ({f['Caro']['frames']} frames)")

    # --- Data saver: one picture, the others paused, mine at most 360p ---
    quality(a, "saver")
    check(a.evaluate("localStorage.getItem('juntos.quality')") == "saver", "the choice is remembered")  # pinned: localStorage juntos.quality ids auto/saver/audio are stored on devices
    a.wait_for_timeout(3500)
    pz = a.evaluate(PAUSED)
    f = flow(a)
    shown = [k for k, v in pz.items() if not v]
    check(len(shown) == 1 and all(f[k]["frames"] == 0 for k, v in pz.items() if v) and f[shown[0]]["frames"] > 15 and f[shown[0]]["h"] <= 360, f"data saver: one picture ({shown}, {f[shown[0]]['h']}p), the other paused: {pz} {f}")
    paused_name = next(k for k, v in pz.items() if v)
    text = a.evaluate(f"[...document.querySelectorAll('#grid .tile')].find(t => t.querySelector('.nm').textContent === '{paused_name}').dataset.paused")
    check("save data" in text, f"the paused picture says why: {text!r}")
    a.screenshot(path=os.path.join(OUT, "net_saver.png"))
    mine = o.evaluate("(async () => { const p = [...__S.mesh.peers.values()].find(p => p.name === 'Ana'); const r = await p.pc.getStats(); let h = 0; r.forEach(x => { if (x.type === 'inbound-rtp' && x.kind === 'video') h = x.frameHeight }); return h })()")
    check(0 < mine <= 360, f"data saver: my own picture arrives at most 360p ({mine}p)")
    a.evaluate(f"[...document.querySelectorAll('#grid .tile')].find(t => t.querySelector('.nm').textContent === '{paused_name}').click()")
    a.wait_for_timeout(3000)
    f = flow(a)
    check(f[paused_name]["frames"] > 15 and not a.evaluate(PAUSED)[paused_name], f"tapping a paused picture shows it ({paused_name}: {f[paused_name]['frames']} frames)")
    a.evaluate("document.querySelector('.tile.spot')?.querySelector('.fsBtn').click()")

    # --- Audio only ---
    quality(a, "audio")
    a.wait_for_timeout(3000)
    f = flow(a)
    check(all(v["frames"] == 0 for v in f.values()) and all(v["audio"] > 50 for v in f.values()) and all(a.evaluate(PAUSED).values()), f"audio only: no videos, sound flows {f}")
    quality(a, "auto")

    # --- a weak connection: steps down, says so, steps back up ---
    a.wait_for_timeout(2500)
    a.evaluate("window.__netFake = { rtt: 420, loss: 8 }")
    a.wait_for_function("() => __S.netq.level === 1", timeout=12000)
    line = a.inner_text("#netState")
    check("weak" in line and "warn" in a.get_attribute("#netState", "class"), f"weak: the line at the top says so: {line!r}")
    a.wait_for_timeout(2000)
    pz = a.evaluate(PAUSED)
    check(sum(1 for v in pz.values() if not v) == 1, f"weak: only one picture kept {pz}")
    o.wait_for_function(f"() => (() => {{ const b = {BARS}; return b.Ana > 0 && b.Ana <= 2 }})()", timeout=10000)
    check(True, "the others see Ana's connection is weak on her picture")
    cap = o.evaluate("(async () => { await new Promise(r => setTimeout(r, 3000)); const p = [...__S.mesh.peers.values()].find(p => p.name === 'Ana'); const r = await p.pc.getStats(); let h = 0; r.forEach(x => { if (x.type === 'inbound-rtp' && x.kind === 'video') h = x.frameHeight }); return h })()")
    check(0 < cap <= 360, f"weak: Ana sends less ({cap}p)")
    a.evaluate("window.__netFake = { rtt: 900, loss: 30 }")
    a.wait_for_function("() => __S.netq.level === 2", timeout=15000)
    a.wait_for_timeout(2500)
    f = flow(a)
    check(all(v["frames"] == 0 for v in f.values()) and all(v["audio"] > 50 for v in f.values()), f"very weak: videos paused, sound keeps going {f}")
    check("very weak" in a.inner_text("#netState"), "very weak: the line says so")
    a.screenshot(path=os.path.join(OUT, "net_weak.png"))
    a.evaluate("window.__netFake = null")
    a.wait_for_function("() => __S.netq.level === 0", timeout=40000)
    a.wait_for_timeout(3000)
    f = flow(a)
    check(all(v["frames"] > 20 for v in f.values()) and a.is_hidden("#netState"), f"connection good again: back to full video, line gone {f}")

    # --- a real bad link: Eva joins with lost packets and delay on her WebRTC (DevTools emulation, which
    # Chrome applies to connections made after it is set) ---
    def lossy(pg):
        cdp = pg.context.new_cdp_session(pg)
        cdp.send("Network.enable")
        cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": 250, "downloadThroughput": -1, "uploadThroughput": -1, "packetLoss": 15})
    e = person("Eva", join, pre=lossy)
    try:
        e.wait_for_function("() => __S.netq.level >= 1", timeout=40000)
        real = e.evaluate("JSON.stringify([...__S.netq.links.values()].map(l => [l.rtt, l.loss, l.bars]))")
        check("weak" in e.inner_text("#netState"), f"real lost packets and delay: Eva's call steps down by itself and says so (measured rtt/loss/bars {real})")
        a.wait_for_function(f"() => (() => {{ const b = {BARS}; return b.Eva > 0 && b.Eva <= 2 }})()", timeout=15000)
        check(True, "the others see Eva's weak connection on her picture")
    except Exception as ex:
        check(False, f"real bad link: {ex}")
    e.context.close()

    # --- mobile data: Data saver by default; Spanish ---
    d = person("Dani", join, init="Object.defineProperty(navigator, 'connection', { value: { saveData: false, type: 'cellular', addEventListener() {} } })", locale="es-AR")
    d.wait_for_function("() => __S.netq.pref === 'saver'", timeout=5000)
    d.evaluate(OPEN_DEV)
    d.wait_for_selector(".qualityBox")
    box = d.inner_text(".qualityBox")
    check("Ahorro de datos" in box and "datos móviles" in box and d.get_attribute('.qualityBox button[data-v="saver"]', "class") == "on", f"on mobile data: Data saver by default, in Spanish: {box!r}")
    d.screenshot(path=os.path.join(OUT, "net_sheet_es.png"))
    b.close()

print("screenshots:", OUT)
print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
