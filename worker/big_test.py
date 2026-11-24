# A big call: N people (cameras and microphones on), all on this machine. Everyone connects to everyone, everyone
# hears everyone (sound arrives from every other person), and nobody gets more than VIDEO_CAP videos at once (the
# rest show their name: audio first). Prints what each person sends and receives, so the cap on people is set from
# a measurement (Kleider, 2026-11-18: "why is there a 12 people limit? ... could be made unlimited if you tried").
# Heavy (N browsers' worth of WebRTC on one machine): run through the machine queue.
# Run: python big_test.py [people] [cameras-on (default: everyone)] [base-url]
import os
import re
import sys
import threading
import time
sys.stdout.reconfigure(encoding='utf-8')
from pathlib import Path
from playwright.sync_api import sync_playwright

N = int(sys.argv[1]) if len(sys.argv) > 1 else 16
CAMS = int(sys.argv[2]) if len(sys.argv) > 2 else N
BASE = sys.argv[3] if len(sys.argv) > 3 else "http://127.0.0.1:8798"
WS = BASE.replace("http", "ws", 1)
PER_BROWSER = 4  # people per browser process, spreads the work over processes like separate devices
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--disable-gpu"]  # headless: no GPU memory held (2026-11-23)
CAP = int(re.search(r"export const VIDEO_CAP = (\d+)", (Path(__file__).parent.parent / "web" / "net.js").read_text(encoding="utf-8")).group(1))
# per person, by the tracks they reach me with (a direct link or a helper passing them on, fwd.js): inbound stats are
# matched on trackIdentifier, so a helper's link carrying several people's pictures counts each one (2026-11-23)
STATS = """async () => {
  const peers = [...__S.mesh.peers.values()];
  const byTrack = {};
  const link = {};
  for (const p of peers.filter(p => p.pc)) {
    const r = await p.pc.getStats();
    const l = { out: 0, inB: 0 };
    r.forEach(x => {
      if (x.type === 'inbound-rtp') { l.inB += x.bytesReceived || 0; if (x.trackIdentifier) byTrack[x.trackIdentifier] = x; }
      if (x.type === 'outbound-rtp') l.out += x.bytesSent || 0;
    });
    link[p.id] = l;
  }
  return peers.map(p => {
    const o = { id: p.id, name: p.name, via: p.via || '', aIn: 0, vFrames: 0, out: (link[p.id] || {}).out || 0, inB: (link[p.id] || {}).inB || 0 };
    for (const t of p.stream ? p.stream.getTracks() : []) {
      const x = byTrack[t.id];
      if (x && t.kind === 'audio') o.aIn = x.packetsReceived || 0;
      if (x && t.kind === 'video') o.vFrames = x.framesDecoded || 0;
    }
    return o });
}"""
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
        try:
            pg.wait_for_selector("#call:not([hidden])", timeout=60000)  # 16 browsers on one PC: a busy machine needs more than 30 s
        except Exception:
            # what the joiner saw when it never got in (2026-11-23: P? stuck in the lobby on the working copy only)
            print(f"  P{i} STUCK: " + pg.evaluate("""() => JSON.stringify({
                msg: document.getElementById('lobbyMsg')?.textContent,
                passErr: document.getElementById('passcodeErr')?.textContent,
                shown: [...document.querySelectorAll('section,[id]')].filter(e => e.offsetParent && e.id).map(e => e.id).slice(0, 40),
                enter: document.getElementById('enter')?.disabled})"""), flush=True)
            raise
        pages.append(pg)
        print(f"  P{i} in ({time.time() - t0:.0f} s)", flush=True)
    # everyone connected to everyone
    want = N - 1
    t1 = time.time()
    done = False
    while time.time() - t1 < 60 + 4 * N:
        ok = all(pg.evaluate(f"__S.mesh.peers.size === {want} && [...__S.mesh.peers.values()].every(p => (p.pc ? p.pc.connectionState === 'connected' : !!p.via && p.state === 'connected') && p.dc && p.dc.readyState === 'open')") for pg in pages)  # pinned: WebRTC state names
        if ok:
            done = True
            break
        time.sleep(2)
    took = time.time() - t1
    if not done:
        for i, pg in enumerate(pages):
            # a peer with no pc is a place held while a helper passes them on or a direct link is retried (fwd.js)
            bad = pg.evaluate("""[...__S.mesh.peers.values()].filter(p => !(p.pc ? p.pc.connectionState === 'connected' : !!p.via && p.state === 'connected') || !p.dc || p.dc.readyState !== 'open')
              .map(p => p.name + ':' + (p.pc ? p.pc.connectionState + '/' + p.pc.iceConnectionState + '/' + p.pc.signalingState : 'no-link' + (p.via ? ' via ' + p.via : '')) + '/' + (p.dc ? p.dc.readyState : '-'))""")
            print(f"  P{i} peers {pg.evaluate('__S.mesh.peers.size')}, not connected: {bad}", flush=True)
            if bad:
                print(f"     signal lost {pg.evaluate('__S.mesh.lost || 0')}x; from them:", pg.evaluate("""[...__S.mesh.peers.values()].filter(p => p.pc?.connectionState !== 'connected')
                  .map(p => p.name + ' ' + JSON.stringify(__S.mesh.sigIn[p.id] || null) + (p.offerer ? ' (I called)' : '') + (p.autoRetries ? ' retries ' + p.autoRetries : '') + (p.gaveUp ? ' gave up' : ''))"""), flush=True)
    check(done, f"{N} people: everyone connected to everyone ({took:.0f} s after the last joined)")
    # page.evaluate has no timeout: a page that stops answering held the run until the suite's 30 min limit with no
    # reading (2026-11-24 j_suite18, PC at 97% CPU). The readings below take ~1 min; past READ_LIMIT_S it ends with a FAIL.
    READ_LIMIT_S = 600

    where = ["after connecting"]

    def each(label, js):
        """pg.evaluate(js) on every page, noting which one is being read (the watchdog names it)."""
        out = []
        for k, pg in enumerate(pages):
            where[0] = f"{label}, P{k} ({time.strftime('%H:%M:%S')})"
            out.append(pg.evaluate(js))
        return out

    def hung():
        print(f"FAIL the readings after connecting took over {READ_LIMIT_S} s: a page stopped answering at {where[0]}", flush=True)
        print("FAILED", flush=True)
        os._exit(1)

    watchdog = threading.Timer(READ_LIMIT_S, hung)
    watchdog.daemon = True
    watchdog.start()
    # a pair that can't connect directly is passed on by a third person (fwd.js): fine, but counted, since on one
    # computer it means the direct links struggled under load
    relayed = sum(each("helper pairs", "[...__S.mesh.peers.values()].filter(p => p.via).length")) // 2
    print(f"  pairs passed on by a helper: {relayed}", flush=True)
    # what makes wants change (2026-11-24: 92 changes in 3 s over 16 viewers): every 200 ms each page notes a tile
    # whose want moved, whether the cap took/gave its place (vidOn), how long ago that person spoke, and whether the
    # tile is on screen
    REC = """() => { if (window.__rec) return; window.__rec = []; const last = {};
      setInterval(() => { for (const t of document.querySelectorAll('#grid .tile:not([data-id=me])')) {
        const q = t.wantSent || null, id = t.dataset.id;
        if (id in last && last[id].q !== q) { const r = t.getBoundingClientRect();
          window.__rec.push({ from: last[id].q, to: q, cap: last[id].on !== !!t.vidOn, spoke: Math.round((Date.now() - (t.spokeAt || 0)) / 100) / 10,
            seen: r.width > 0 && r.bottom > 0 && r.top < innerHeight, paused: t.classList.contains('paused') }); }
        last[id] = { q, on: !!t.vidOn }; } }, 200); }"""
    each("recorder", REC)
    time.sleep(8)  # the video cap settles (wants every 0.7 s)
    s1 = [{x["id"]: x for x in r} for r in each("stats 1", STATS)]
    each("recorder mark", "window.__recFrom = window.__rec.length; window.__recT0 = Date.now()")
    t2 = time.time()
    time.sleep(5)
    s2 = [{x["id"]: x for x in r} for r in each("stats 2", STATS)]
    each("recorder end", "window.__recTo = window.__rec.length; window.__recT1 = Date.now()")
    # pictures that took a place from another in each page's window: the cap allows one every CAP_SWAP_MS (3 s,
    # cappick.js), and both the leaving and the new one send frames in the window.
    # 2026-11-24 suite21: the pages are read one after another, so a page's window ran 5 s plus the reading of all 16
    # (8-12 s on a busy PC) while the count ran to the moment "swaps" reached it: 3-4 swaps were counted while capLog
    # showed the page swapping once every 3.5 s. Each page now counts between its own two marks, against its own length.
    swaps = each("swaps", "window.__rec.slice(window.__recFrom, window.__recTo).filter(r => r.cap && r.from === 'off').length")
    win_ms = each("swap window", "window.__recT1 - window.__recT0")
    allowed = [int(w // 3000) + 1 for w in win_ms]  # pinned: CAP_SWAP_MS = 3000 (cappick.js); 5 s -> 2
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
        if sees > CAP + swaps[i] or swaps[i] > allowed[i]:
            check(False, f"P{i} gets {sees} videos with {swaps[i]} swaps in {win_ms[i] / 1000:.1f} s (cap {CAP}, at most {allowed[i]} swaps)")
            if i < 2:  # 2026-11-24 suite20: 3-4 swaps in 5 s while capPicker alone allows 2: what each pass decided
                print(f"  P{i} cap passes [s ago, items, shown before, newly shown, swaps]:", pages[i].evaluate(
                    "(__S.netq.capLog || []).filter(r => Date.now() - r[0] < 9000).map(r => [Math.round((Date.now() - r[0]) / 100) / 10, r[1], r[2], r[3], r[4]])"), flush=True)
    if deaf:
        for i, pg in enumerate(pages):
            print(f"  P{i} mic:", pg.evaluate("""({ mic: __S.mic, track: __S.micTrack ? __S.micTrack.readyState + '/' + __S.micTrack.enabled + '/' + __S.micTrack.muted : null,
              senders: [...__S.mesh.peers.values()].map(p => p.audio && p.audio.sender.track ? p.audio.sender.track.readyState[0] : '-').join('') })"""), flush=True)
    # the cap end to end: what each viewer's tile asked for, what the sender got, and whether its encoder is on
    # (2026-11-23: pictures wanted off kept arriving; this tells a lost message from a sender that didn't apply it)
    WANTS = """async () => {
      const asked = {}; for (const t of document.querySelectorAll('#grid .tile:not([data-id=me])')) { asked[t.dataset.id] = t.wantSent || null; const vp = __S.mesh.peers.get(t.dataset.id); (window.__wd ||= {})[t.dataset.id] = vp ? [vp.via ? 'via' : 'direct', vp.dc?.readyState, vp.state, Math.round((Date.now() - (t.wantAt || 0)) / 1000) + 's'] : ['none']; }
      const sending = {};
      for (const p of __S.mesh.peers.values()) {
        const s = p.video && p.video.sender; let active = null;
        try { const e = s && s.getParameters().encodings; active = e && e.length ? e[0].active !== false : null; } catch (_) {}
        sending[p.id] = { want: p.want || null, active, hasTrack: !!(s && s.track), how: [p.via ? 'via' : 'direct', p.dc?.readyState, p.state] };
      }
      return { me: __S.mesh.id, asked, sending, wd: window.__wd || {} };
    }"""
    # the pages are read one after another (seconds apart), so a want sent just before a viewer was read may not have
    # reached a sender read before it (2026-11-24: 43 "lost" with both ends connected, sent 2 s before). Read the
    # viewers, wait, read everyone again: lost = asked the same both times, and the sender (read 3+ s later) differs.
    w0 = each("wants 1", WANTS)
    time.sleep(3)
    w = each("wants 2", WANTS)
    recs = [r for x in each("recorder read", "window.__rec || []") for r in x]
    kinds = {}
    for r in recs:
        k = f"{r['from']}->{r['to']}" + (" cap" if r["cap"] else "") + ("" if r["seen"] else " offscreen")
        kinds[k] = kinds.get(k, 0) + 1
    spoke = sorted(r["spoke"] for r in recs if r["cap"])
    print(f"  want changes seen by the recorder: {len(recs)} {kinds}; spoke s ago at cap changes: {spoke[:8]}..{spoke[-8:]}", flush=True)
    before = {x["me"]: x["asked"] for x in w0}
    by = {x["me"]: x for x in w}
    lost, unapplied, offs = [], [], 0
    for viewer in w:
        for sid, q in viewer["asked"].items():
            snd = by.get(sid, {}).get("sending", {}).get(viewer["me"])
            if q is None or snd is None or before.get(viewer["me"], {}).get(sid) != q:
                continue
            offs += q == "off"
            if snd["want"] != q:
                lost.append(f"{sid[:4]}->{viewer['me'][:4]} asked {q}, sender has {snd['want']} (viewer end {viewer['wd'].get(sid)}, sender end {snd['how']})")
            elif q == "off" and snd["active"] and snd["hasTrack"]:
                unapplied.append(f"{sid[:4]}->{viewer['me'][:4]}")
    churn = sum(1 for x in w for sid, q in x["asked"].items() if before.get(x["me"], {}).get(sid, q) != q)
    print(f"  wants that changed in 3 s (who is shown moving): {churn} over {len(w)} viewers", flush=True)
    print(f"  wanted off: {offs}; not received by the sender: {len(lost)} {lost[:12]}; received but still sending: {len(unapplied)} {unapplied[:6]}", flush=True)
    check(not lost, "every viewer's want reached its sender")
    check(not unapplied, "every picture wanted off is off at its sender")
    check(deaf == 0, f"everyone hears all {want} others")
    check(all(v <= CAP + sw for v, sw in zip(vids, swaps)), f"nobody gets more than {CAP} videos plus the ones swapped in those 5 s (got {min(vids)}-{max(vids)}, swaps {swaps})")
    check(all(sw <= al for sw, al in zip(swaps, allowed)), f"who is shown changes at most once per 3 s per viewer (got {swaps} in windows of {[round(w / 1000, 1) for w in win_ms]} s)")
    expect = min(CAP, CAMS - 1)
    check(min(vids) >= expect - 1, f"and the cap is used: at least {expect - 1} videos each")
    print(f"RESULT people={N} cams={CAMS} connect_s={took:.0f} up_kbps avg={sum(outs) / N:.0f} max={max(outs):.0f} down_kbps avg={sum(ins) / N:.0f} max={max(ins):.0f} videos={min(vids)}-{max(vids)}", flush=True)
    watchdog.cancel()
    for b in browsers:
        b.close()

print("errors:", errors[:20])
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
