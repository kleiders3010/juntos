# A big call: N people (cameras and microphones on), all on this machine. Everyone connects to everyone, everyone
# hears everyone (sound arrives from every other person), and nobody gets more than VIDEO_CAP videos at once (the
# rest show their name: audio first). Prints what each person sends and receives, so the cap on people is set from
# a measurement (Kleider, 2026-11-18: "why is there a 12 people limit? ... could be made unlimited if you tried").
# Heavy (N browsers' worth of WebRTC on one machine): run through the machine queue.
# Run: python big_test.py [people] [cameras-on (default: everyone)] [base-url]
import re
import sys
import time
sys.stdout.reconfigure(encoding='utf-8')
from pathlib import Path
from playwright.sync_api import sync_playwright

N = int(sys.argv[1]) if len(sys.argv) > 1 else 16
CAMS = int(sys.argv[2]) if len(sys.argv) > 2 else N
BASE = sys.argv[3] if len(sys.argv) > 3 else "http://127.0.0.1:8797"
WS = BASE.replace("http", "ws", 1)
PER_BROWSER = 4  # people per browser process, spreads the work over processes like separate devices
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
CAP = int(re.search(r"export const VIDEO_CAP = (\d+)", (Path(__file__).parent.parent / "web" / "net.js").read_text(encoding="utf-8")).group(1))
STATS = """() => Promise.all([...__S.mesh.peers.values()].map(p => p.pc.getStats().then(r => {
  const o = { id: p.id, name: p.name, conn: p.pc.connectionState, dc: !!p.dc && p.dc.readyState === 'open', aIn: 0, vFrames: 0, out: 0, inB: 0 };
  r.forEach(x => {
    if (x.type === 'inbound-rtp' && x.kind === 'audio') o.aIn = x.packetsReceived || 0;
    if (x.type === 'inbound-rtp' && x.kind === 'video') o.vFrames = x.framesDecoded || 0;
    if (x.type === 'inbound-rtp') o.inB += x.bytesReceived || 0;
    if (x.type === 'outbound-rtp') o.out += x.bytesSent || 0;
  });
  return o })))"""
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


with sync_playwright() as p:
    browsers = []
    pages = []

    def page(i):
        if i % PER_BROWSER == 0:
            browsers.append(p.chromium.launch(headless=True, channel="msedge", args=ARGS))
        ctx = browsers[-1].new_context(locale="en-US", permissions=["camera", "microphone"], viewport={"width": 1280, "height": 760})
        # all N on one PC starve each other, which the call reads as a weak link and steps its video down; real
        # devices each hold one person. The step-down has its own test (net_test.py), so here the link reads good.
        ctx.add_init_script("window.__netFake = { rtt: 60, loss: 0, jitter: 5 }")
        pg = ctx.new_page()
        pg.on("pageerror", lambda e, i=i: errors.append(f"pageerror (p{i}): {e}"))
        pg.on("console", lambda m, i=i: m.type in ("warning", "error") and "juntos" in m.text and print(f"  P{i} console: {m.text[:200]}", flush=True))
        return pg

    t0 = time.time()
    a = page(0)
    a.goto(f"{BASE}/?signal={WS}")
    a.click("#start")
    a.wait_for_selector("#lobby:not([hidden])")
    a.fill("#name", "P0")
    a.click("#enter")
    a.wait_for_selector("#call:not([hidden])")
    link = f"{a.url}{'&' if '?' in a.url else '?'}signal={WS}"
    pages.append(a)
    for i in range(1, N):
        pg = page(i)
        pg.goto(link)
        pg.wait_for_selector("#lobby:not([hidden])")
        if i >= CAMS:
            pg.click("#pCam")
        pg.fill("#name", f"P{i}")
        pg.click("#enter")
        pg.wait_for_selector("#call:not([hidden])")
        pages.append(pg)
        print(f"  P{i} in ({time.time() - t0:.0f} s)", flush=True)
    # everyone connected to everyone
    want = N - 1
    t1 = time.time()
    done = False
    while time.time() - t1 < 60 + 4 * N:
        ok = all(pg.evaluate(f"__S.mesh.peers.size === {want} && [...__S.mesh.peers.values()].every(p => p.pc.connectionState === 'connected' && p.dc && p.dc.readyState === 'open')") for pg in pages)  # pinned: WebRTC state names
        if ok:
            done = True
            break
        time.sleep(2)
    took = time.time() - t1
    if not done:
        for i, pg in enumerate(pages):
            bad = pg.evaluate("""[...__S.mesh.peers.values()].filter(p => p.pc.connectionState !== 'connected' || !p.dc || p.dc.readyState !== 'open')
              .map(p => p.name + ':' + p.pc.connectionState + '/' + p.pc.iceConnectionState + '/' + p.pc.signalingState + '/' + (p.dc ? p.dc.readyState : '-'))""")
            print(f"  P{i} peers {pg.evaluate('__S.mesh.peers.size')}, not connected: {bad}", flush=True)
            if bad:
                print(f"     signal lost {pg.evaluate('__S.mesh.lost || 0')}x; from them:", pg.evaluate("""[...__S.mesh.peers.values()].filter(p => p.pc.connectionState !== 'connected')
                  .map(p => p.name + ' ' + JSON.stringify(__S.mesh.sigIn[p.id] || null) + (p.offerer ? ' (I called)' : '') + (p.autoRetries ? ' retries ' + p.autoRetries : '') + (p.gaveUp ? ' gave up' : ''))"""), flush=True)
    check(done, f"{N} people: everyone connected to everyone ({took:.0f} s after the last joined)")
    time.sleep(8)  # the video cap settles (wants every 0.7 s)
    s1 = [{x["id"]: x for x in pg.evaluate(STATS)} for pg in pages]
    t2 = time.time()
    time.sleep(5)
    s2 = [{x["id"]: x for x in pg.evaluate(STATS)} for pg in pages]
    dt = time.time() - t2
    outs, ins, vids = [], [], []
    deaf = 0
    for i, (b1, b2) in enumerate(zip(s1, s2)):
        hears = sum(1 for k, v in b2.items() if k in b1 and v["aIn"] > b1[k]["aIn"])
        sees = sum(1 for k, v in b2.items() if k in b1 and v["vFrames"] > b1[k]["vFrames"])
        out = sum(v["out"] - b1.get(k, v)["out"] for k, v in b2.items()) * 8 / dt / 1000
        inn = sum(v["inB"] - b1.get(k, v)["inB"] for k, v in b2.items()) * 8 / dt / 1000
        outs.append(out)
        ins.append(inn)
        vids.append(sees)
        why = pages[i].evaluate("({ level: __S.netq.level, pref: __S.netq.pref, tiles: [...document.querySelectorAll('#grid .tile:not([data-id=me])')].map(t => t.wantSent + (t.classList.contains('camoff') ? '/camoff' : '') + (t.dataset.paused && t.classList.contains('paused') ? '/' + t.dataset.paused.slice(0, 12) : '')) })")
        print(f"  P{i}: hears {hears}, sees {sees}, up {out:.0f} kbps, down {inn:.0f} kbps, {why}", flush=True)
        if hears < want:
            deaf += 1
            miss = [v["name"] for k, v in b2.items() if not (k in b1 and v["aIn"] > b1[k]["aIn"])]
            check(False, f"P{i} hears {hears} of {want} (not: {miss})")
        if sees > CAP:
            check(False, f"P{i} gets {sees} videos, more than the cap {CAP}")
    if deaf:
        for i, pg in enumerate(pages):
            print(f"  P{i} mic:", pg.evaluate("""({ mic: __S.mic, track: __S.micTrack ? __S.micTrack.readyState + '/' + __S.micTrack.enabled + '/' + __S.micTrack.muted : null,
              senders: [...__S.mesh.peers.values()].map(p => p.audio && p.audio.sender.track ? p.audio.sender.track.readyState[0] : '-').join('') })"""), flush=True)
    check(deaf == 0, f"everyone hears all {want} others")
    check(max(vids) <= CAP, f"nobody gets more than {CAP} videos (got {min(vids)}-{max(vids)})")
    expect = min(CAP, CAMS - 1)
    check(min(vids) >= expect - 1, f"and the cap is used: at least {expect - 1} videos each")
    print(f"RESULT people={N} cams={CAMS} connect_s={took:.0f} up_kbps avg={sum(outs) / N:.0f} max={max(outs):.0f} down_kbps avg={sum(ins) / N:.0f} max={max(ins):.0f} videos={min(vids)}-{max(vids)}", flush=True)
    for b in browsers:
        b.close()

print("errors:", errors[:20])
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
