# A big call as a tree: N people (more than the 16 a link to everyone allows), all on this machine. When the 17th
# joins, the room server turns the call into a tree: each device links to its parent and a few children, and
# sound, pictures and messages are passed along it, device to device (web/big.js).
# Checks: everyone is in the call and sees everyone; each device holds only its tree links (all open); everyone
# hears everyone; the host's picture reaches everyone; a chat message reaches everyone; a message forged in
# someone else's name is passed on by nobody and shown by nobody; when someone in the middle of the tree leaves,
# the tree closes over the gap and everyone still hears everyone.
# Heavy (N browsers on one machine): run through the machine queue.
# Run: python tree_test.py [people (default 20)] [cameras-on (default 3)] [base-url]
import sys
import time
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

N = int(sys.argv[1]) if len(sys.argv) > 1 else 20
CAMS = int(sys.argv[2]) if len(sys.argv) > 2 else 3
BASE = sys.argv[3] if len(sys.argv) > 3 else "http://127.0.0.1:8798"
# JUNTOS_SIGNAL: another room server (the Kinetic one: kinetic/server.mjs) with the same protocol
WS = __import__("os").environ.get("JUNTOS_SIGNAL") or BASE.replace("http", "ws", 1)
PER_BROWSER = 4
# no GPU: ~30 headless browsers held ~21 GB of video memory and kept other projects' jobs out of the machine queue
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--disable-gpu"]
errors = []

# my links: all real connections with both channels open, and exactly the ones the tree gave me
LINKS_OK = """() => { const m = __S.mesh; if (!m.big) return false;
  const real = [...m.peers.values()].filter(p => !p.far);
  return real.length === m.big.links.size && real.every(p => m.big.links.has(p.id) && p.dc.readyState === 'open' && p.mc && p.mc.readyState === 'open') }"""
HEARD = "() => Object.fromEntries([...__S.mesh.big.rx.entries()].map(([s, r]) => [s, [r.aN || 0, r.vN || 0]]))"


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
        ctx.add_init_script("window.__netFake = { rtt: 60, loss: 0, jitter: 5 }")
        pg = ctx.new_page()
        pg.on("pageerror", lambda e, i=i: errors.append(f"pageerror (p{i}): {e}"))
        return pg

    def wait_all(js, pgs, secs, what):
        t = time.time()
        while time.time() - t < secs:
            if all(pg.evaluate(js) for pg in pgs):
                check(True, f"{what} ({time.time() - t:.0f} s)")
                return True
            time.sleep(2)
        bad = [i for i, pg in enumerate(pgs) if not pg.evaluate(js)]
        check(False, f"{what}: not on {len(bad)} of {len(pgs)}")
        for i in bad[:4]:
            print("   ", pgs[i].evaluate("""() => { const m = __S.mesh; return { big: !!m.big, peers: m.peers.size,
              links: m.big ? [...m.big.links] : null, real: [...m.peers.values()].filter(p => !p.far).map(p => p.name + ':' + p.state + '/' + p.dc.readyState + '/' + (p.mc ? p.mc.readyState : '-')) } }"""), flush=True)
        return False

    def hearing(pgs, ids, what):
        h1 = [pg.evaluate(HEARD) for pg in pgs]
        time.sleep(6)
        h2 = [pg.evaluate(HEARD) for pg in pgs]
        deaf = 0
        for i, (a, b) in enumerate(zip(h1, h2)):
            mine = pgs[i].evaluate("__S.mesh.id")
            miss = [n for s, n in ids.items() if s != mine and not (b.get(s, [0])[0] > a.get(s, [0])[0])]
            if miss:
                deaf += 1
                print(f"    {pgs[i].evaluate('__S.mesh.name')} doesn't hear {miss}", flush=True)
                if deaf <= 3:
                    who = {n: s for s, n in ids.items()}
                    print("      ", pgs[i].evaluate("""(ss) => ss.map(s => { const a = (window.__arr || {})[s];
                      return [s.slice(0, 4), a ? a[0] : 0, a ? a[1].slice(0, 4) : '-', __S.mesh.route(s), !!__S.mesh.big.mkeys.get(s)] })""",
                      [who[n] for n in miss[:4]]), "links", pgs[i].evaluate("[...__S.mesh.big.links].map(x => x.slice(0, 4))"), flush=True)
        check(deaf == 0, f"{what}: everyone hears everyone ({len(pgs)} people)")
        return h1, h2

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

    wait_all(f"__S.mesh.peers.size === {N - 1} && !!__S.mesh.big", pages, 60, f"{N} people: everyone is in the big call and sees everyone")
    wait_all(LINKS_OK, pages, 90, "each device holds only its tree links, all open")
    links = [pg.evaluate("__S.mesh.big.links.size") for pg in pages]
    over = sum(pg.evaluate("__S.mesh.big.links.size > __S.mesh.kidCap + 1") for pg in pages)
    check(over == 0, f"no device links to more than its parent and the children it offered to feed (most links: {max(links)})")
    ids = {pg.evaluate("__S.mesh.id"): pg.evaluate("__S.mesh.name") for pg in pages}
    host = pages[0].evaluate("__S.mesh.id")
    for pg in pages:
        pg.evaluate("""() => { const b = __S.mesh.big, om = b.onMedia.bind(b); window.__arr = {};
          b.onMedia = (from, buf) => { const u = new Uint8Array(buf);
            const src = new TextDecoder().decode(u.subarray(17, 17 + u[16]));
            if (u[0] === 1) __arr[src] = [(__arr[src] || [0])[0] + 1, from]; return om(from, buf) } }""")
    time.sleep(3)
    h1, h2 = hearing(pages, ids, "the tree")
    sees = sum(1 for i, (x, y) in enumerate(zip(h1, h2)) if i == 0 or y.get(host, [0, 0])[1] > x.get(host, [0, 0])[1])
    check(sees == N, f"the host's picture reaches everyone ({sees} of {N})")
    for i, pg in enumerate(pages):
        st = pg.evaluate("__S.mesh.big.stats")
        if i < 4 or i == N - 1:
            print(f"  P{i}: links {links[i]}, sent {st['sent']}, passed on {st['fwd']}, got {st['got']}, dropped {st['dropped']}, bad {st['bad']}, sender unknown {st.get('noKey')}", flush=True)

    # a chat message from someone near the bottom reaches everyone
    pages[N - 1].evaluate("__S.mesh.broadcast({ k: 'chat', text: 'hello along the tree' })")
    wait_all("__S.chat.some(c => c.text === 'hello along the tree')", pages[:N - 1], 15, "a chat message reaches everyone")
    # a message in the host's name with a wrong signature is passed on by nobody and shown by nobody
    bad0 = sum(pg.evaluate("__S.mesh.big.stats.bad") for pg in pages)  # before: only what the forgery adds counts
    forger = pages[N - 2]
    forger.evaluate("""(h) => { const l = [...__S.mesh.big.links].find(x => x !== h); // not the host: it drops its own name unread
      __S.mesh.peers.get(l).dc.send(JSON.stringify({ _r: 1, s: h, n: 987654, to: '', rc: 0, m: { k: 'chat', text: 'forged' }, sig: 'AAAA' })) }""", host)
    time.sleep(4)
    shown = sum(pg.evaluate("__S.chat.some(c => c.text === 'forged')") for pg in pages)
    bad = sum(pg.evaluate("__S.mesh.big.stats.bad") for pg in pages) - bad0
    check(shown == 0 and bad == 1, f"a message forged in the host's name: shown by {shown}, stopped by the first device that got it (got by {bad})")

    # breakout rooms: a device whose room holds only the host plays only the host (the tree still carries the rest)
    r = pages[N - 1]
    r.evaluate("(h) => { __S.mesh.__route = __S.mesh.route; __S.mesh.route = (id) => id === h }", host)
    time.sleep(1)
    x1 = r.evaluate(HEARD)
    time.sleep(5)
    x2 = r.evaluate(HEARD)
    others = [s for s in x2 if s != host and x2[s][0] > x1.get(s, [0])[0]]
    check(x2.get(host, [0])[0] > x1.get(host, [0])[0] and not others, f"in a breakout room only the room is played (others still played: {len(others)})")
    r.evaluate("__S.mesh.route = __S.mesh.__route")

    # private and breakout-room traffic: the devices passing it along can't read it
    room = {pages[0], pages[N - 1], pages[N - 2]}
    rids = [pg.evaluate("__S.mesh.id") for pg in room]
    for pg in pages:
        inside = pg in room
        pg.evaluate("""([ids, inside]) => { const m = __S.mesh, b = m.big;
          m.__route = m.route; m.route = (id) => ids.includes(id) === inside;
          window.__got = []; m.addEventListener('message', (e) => __got.push(e.detail.msg));
          window.__seen = { plain: 0, late: 0, text: 0, sealed: 0 };
          if (inside) window.__mseq0 = { ...b.mseq };
          const ls = b.linkSend.bind(b);
          b.linkSend = (x, d, media) => { if (typeof d === 'string' && d.includes('secret')) __seen.text++; return ls(x, d, media) };
          const om = b.onMedia.bind(b);
          b.onMedia = (from, buf) => { const u = new Uint8Array(buf);
            const src = new TextDecoder().decode(u.subarray(17, 17 + u[16]));
            if (ids.includes(src) && window.__count) {
              const seq = new DataView(u.buffer, u.byteOffset).getUint32(4), sent = (window.__split || {})[src];
              __seen[u[1] & 0x80 ? 'sealed' : sent && seq <= sent[u[0]] ? 'late' : 'plain']++ }
            return om(from, buf) };
          m.reroute() }""", [rids, inside])
    time.sleep(3)
    split = {pg.evaluate("__S.mesh.id"): pg.evaluate("__mseq0") for pg in room}
    for pg in pages:
        pg.evaluate("(s) => { window.__split = s; window.__count = 1 }", split)
    pages[N - 1].evaluate("__S.mesh.roomcast({ k: 'chat', text: 'room secret' })")
    pages[0].evaluate("(id) => __S.mesh.sendTo(id, { k: 'chat', text: 'private secret' })", pages[N - 2].evaluate("__S.mesh.id"))
    time.sleep(6)
    outside = [pg for pg in pages if pg not in room]
    got = lambda pg, t: pg.evaluate(f"__got.some(m => m && m.text === '{t}')")
    check(got(pages[0], "room secret") and got(pages[N - 2], "room secret") and not any(got(pg, "room secret") for pg in outside),
          "a breakout-room message reaches the room and nobody else")
    check(got(pages[N - 2], "private secret") and not any(got(pg, "private secret") for pg in pages if pg is not pages[N - 2]),
          "a private message reaches only its person")
    seen = [pg.evaluate("__seen") for pg in outside]
    passed = sum(pg.evaluate("__S.mesh.big.stats.fwd") for pg in outside)
    check(not any(s["text"] for s in seen), f"no device outside passed along readable private or room text ({passed} pieces passed on)")
    sealed = sum(s["sealed"] for s in seen)
    plain = sum(s["plain"] for s in seen)
    late = sum(s["late"] for s in seen)
    check(sealed > 0 and plain == 0, f"the room's sound reaches devices outside it only encrypted ({sealed} encrypted, {plain} readable sent after the split, {late} sent before it and still on the way)")
    hearing(list(room), {i: ids[i] for i in rids}, "inside the breakout room")
    for pg in pages:
        pg.evaluate("__S.mesh.route = __S.mesh.__route; window.__count = 0; __S.mesh.reroute()")
    time.sleep(2)

    # someone in the middle of the tree leaves: their children hang on elsewhere
    mid = next(i for i in range(1, N) if pages[i].evaluate("__S.mesh.big.links.size") >= 3)
    gone = pages[mid].evaluate("__S.mesh.id")
    print(f"  P{mid} (links {links[mid]}) leaves", flush=True)
    pages[mid].click("#bLeave"); pages[mid].query_selector("#justLeave") and pages[mid].click("#justLeave")  # a host is asked: just leave
    rest = [pg for i, pg in enumerate(pages) if i != mid]
    wait_all(f"__S.mesh.peers.size === {N - 2}", rest, 30, "everyone sees them gone")
    wait_all(LINKS_OK, rest, 60, "the tree closes over the gap: every device's links open again")
    del ids[gone]
    hearing(rest, ids, "after the leave")

    # a device that can't take part in a tree (no WebCodecs track generator, like some browsers today)
    NOTREE = "delete window.MediaStreamTrackGenerator"

    def joiner(url, name, notree=False):
        pg = page(len(pages) + 100)
        pg.set_default_timeout(60000)  # ~30 browsers share one CPU by now: every step can be slow
        if notree:
            pg.context.add_init_script(NOTREE)
        pg.add_init_script("""window.__toasts = []; new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) =>
          n.classList && n.classList.contains('toast') && __toasts.push(n.textContent)))).observe(document, { childList: true, subtree: true })""")
        pg.goto(url)
        pg.wait_for_selector("#lobby:not([hidden])")
        pg.click("#pCam")
        pg.fill("#name", name)
        # #enter is disabled while the camera opens; with ~20 browsers on one PC that can take long
        pg.click("#enter", timeout=60000)
        pg.wait_for_selector("#call:not([hidden])")
        return pg

    x = joiner(link, "NoTree", True)
    x.wait_for_function("() => __toasts.some(t => t.includes('full')) || __S.mesh.peers.size > 0", timeout=20000)
    check(x.evaluate("__toasts.some(t => t.includes('full')) && __S.mesh.peers.size === 0"),
          "a device that can't take part in the tree is told the big call is full")
    check(all(pg.evaluate(f"__S.mesh.peers.size === {N - 2}") for pg in rest), "and nobody in the call is disturbed")
    x.close()
    # the big call is done: its ~20 pages would starve the small call's joiners of CPU (S11 timed out on #pCam)
    for pg in rest:
        pg.close()

    # a small call (the test server's mesh limit) with such a device in it: when it grows past a mesh, that device is
    # the one told the call is full, and everyone else goes on (safety round 2, J8: one such device can't stop a call
    # growing; this step said the opposite before J8)
    h = page(500)
    h.context.add_init_script(NOTREE)
    h.add_init_script("""window.__toasts = []; new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) =>
      n.classList && n.classList.contains('toast') && __toasts.push(n.textContent)))).observe(document, { childList: true, subtree: true })""")
    h.goto(f"{BASE}/?signal={WS}")
    h.click("#start")
    h.wait_for_selector("#lobby:not([hidden])")
    h.click("#pCam")
    h.fill("#name", "FirefoxLike")
    h.click("#enter")
    h.wait_for_selector("#call:not([hidden])")
    room = f"{h.url}{'&' if '?' in h.url else '?'}signal={WS}"
    small = []
    # (the device already in is told the call grew past what it can take part in)
    told = lambda: h.evaluate("(window.__toasts || []).some(t => t.includes('full') || t.includes('grew past')) || !!__S.mesh.closed")
    while not told() and len(small) < 20:
        y = joiner(room, f"S{len(small) + 1}")
        y.wait_for_function("() => __toasts.some(t => t.includes('full')) || __S.mesh.peers.size > 0 || !!__S.mesh.big", timeout=20000)
        check(not y.evaluate("__toasts.some(t => t.includes('full'))"), f"S{len(small) + 1} gets in")
        small.append(y)
        h.wait_for_timeout(300)
    n = len(small) + 1
    print("   ", h.evaluate("({ big: !!__S.mesh.big, peers: __S.mesh.peers.size, closed: !!__S.mesh.closed })"), flush=True)
    check(told() and 2 <= n <= 20, f"past a mesh the device that can't do a tree is the one told the call is full ({n} had come)")
    check(not any(pg.evaluate("__toasts.some(t => t.includes('full'))") for pg in small), "and nobody else is pushed out")
    for b in browsers:
        b.close()

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
