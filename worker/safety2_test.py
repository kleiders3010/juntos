# Safety round 2 (research/safety-audit-2026-11-21/juntos.md in SelfSustainment), headless Edge. Grows with each fix.
# J15: the test switches in the link (?signal=, ?signal2=, ?relays=) reach this computer only when the page itself is
#      served from this computer; the shipped pages' CSP has no localhost (the test server adds it).
# J16: names are cleaned on the server (hello) and where they enter the app (server messages, relays, helpers).
# J10: someone waiting to be let in can't send handshakes to the people inside; the app takes server handshakes
#      only from people the server listed.
# J2:  on the room server an id is no password: taking over a link, being a co-host or coming back into a locked
#      call needs the visit's own key (its id is the start of that key); its own key still reconnects.
# J1:  on the relays the sender is the key that signed the event (checked in the browser), and an id is the start
#      of that key: nobody can speak as someone else.
# J4:  nobody becomes host by asking first; the host's lock and passcode reach both room servers (two game-host
#      copies here, kinetic/server.mjs); moving server on a relay word needs a connected person or the host.
# J13: the host's secret key is never sent: the host proves it with a signature.
# J3:  new calls get 15-letter codes; old 10-letter codes still prove their host; the relay tag and key come from the
#      code through a slow hash.
# J5:  a helper that passes someone's sound and picture on is taken only when I asked that one (or my own link to
#      that person gave up); a working link is never replaced.
# J7:  per-address limits on both servers (the Worker's JOINS, the game host's links and new rooms per minute, a cap
#      on stored rooms), and a made-up room with one visitor stores nothing.
# J8:  one network can't fill a call (40 links each), only hosts and co-hosts may say they feed more than 2 in a big
#      call, and a device that can't join a tree is the one told full. J9: 30 wrong passcodes from anywhere lock the
#      call and tell the people in it (ready-made passcodes stay 6 digits: a decision). (A game-host copy with a tree
#      from 4 people on; addresses given in x-forwarded-for, as the game host's proxy does.)
# Run against the TEST server: npx wrangler dev -c wrangler.test.toml --port 8798, then python safety2_test.py [base-url]

import os
import re
import sys
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright
import subprocess
import tempfile
import time
import urllib.request

KIN = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "kinetic")
KPORTS = [8815, 8816]  # two copies of the room server (the game host's), for the two-server checks

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8798"
WS = BASE.replace("http", "ws", 1)
WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web")
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
LOCAL = re.compile(r"//(localhost|127\.0\.0\.1|\[::1\])[:/]")
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


# J15, the shipped files: no page lets itself talk to this computer
for f in sorted(os.listdir(WEB)):
    if f.endswith(".html"):
        csp = re.search(r'Content-Security-Policy" content="([^"]*)"', open(os.path.join(WEB, f), encoding="utf-8").read())
        if csp:
            check(not re.search(r"localhost|127\.0\.0\.1|\[::1\]", csp.group(1)), f"J15 {f}: shipped CSP has no localhost")  # pinned: safety round 2 J15

# J17: the only address server (STUN) is Cloudflare's, the one the privacy page names
rtc = open(os.path.join(WEB, "rtc.js"), encoding="utf-8").read()
stuns = re.findall(r"stun:[^\"']+", rtc)
check(stuns == ["stun:stun.cloudflare.com:3478"], f"J17 STUN is Cloudflare's only ({stuns})")  # pinned: safety round 2 J17
check("stun.cloudflare.com" in open(os.path.join(WEB, "privacy.html"), encoding="utf-8").read(), "J17 the privacy page names it")  # pinned: safety round 2 J17

# J16: the server's copy of the name rule is the app's (web/names.js)
names = open(os.path.join(WEB, "names.js"), encoding="utf-8").read()
srv = open(os.path.join(WEB, "..", "worker", "src", "index.js"), encoding="utf-8").read()
for k in ("const INVISIBLE", "const LONE_JOINER"):
    line = [l for l in names.splitlines() if l.startswith(k)]
    check(line and line[0] in srv, f"J16 the server has the same {k[6:]} as web/names.js")  # pinned: safety round 2 J16

DIRTY = "A\u202eB\u200bC\u0007  D\u2066"  # direction flip, invisible space, a control character, a lone isolate
CLEAN = "ABC D"

# J7: the Worker counts new links and lobby questions per address before waking a room
for f in ("wrangler.toml", "wrangler.test.toml"):
    t = open(os.path.join(WEB, "..", "worker", f), encoding="utf-8").read()
    check('name = "JOINS"' in t and "[[ratelimits]]" in t, f"J7 {f} has the JOINS limit")  # pinned: safety round 2 J7
check("env.JOINS.limit" in srv, "J7 the Worker checks it on /ws and /info")  # pinned: safety round 2 J7

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)

    def sockets_on(origin, code):
        """open the lobby of a call on `origin` with every test switch pointed at this computer, join, and return the
        websocket addresses the page tried (all answered by a stand-in that closes at once: nothing leaves this PC)"""
        ctx = b.new_context(locale="en-US", permissions=["camera", "microphone"])
        if not origin.startswith(BASE):
            # a page served from somewhere that is not this computer: the same files, fetched from the test server
            ctx.route(origin + "/**", lambda r: r.fulfill(response=r.fetch(url=BASE + r.request.url[len(origin):])))
        tried = []

        def stand_in(ws):
            tried.append(ws.url)
            ws.close()
        ctx.route_web_socket(re.compile(".*"), stand_in)
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror ({origin}): {e}"))
        pg.goto(f"{origin}/r/{code}?signal={WS}&signal2=ws://localhost:8798&relays=ws://127.0.0.1:8809")
        pg.fill("#name", "Ana")
        pg.click("#enter")
        pg.wait_for_timeout(4000)
        ctx.close()
        return tried

    away = sockets_on("http://juntos.test", "jfo-tqbx-wme")
    check(away and not any(LOCAL.search(u) for u in away),
          f"J15 a page not on this computer ignores switches pointing at it (tried: {sorted(set(u.split('/ws/')[0] for u in away))})")  # pinned: safety round 2 J15
    home = sockets_on(BASE, "jfo-tqbx-wmf")
    check(any(LOCAL.search(u) for u in home), "J15 a page on this computer still takes them (tests rely on it)")  # pinned: safety round 2 J15
    # J16, the server: a name with hidden characters reaches the others cleaned
    ctx = b.new_context()
    pg = ctx.new_page()
    pg.goto(BASE + "/privacy.html")
    seen = pg.evaluate("""async ([ws, dirty]) => {
      const room = "jfo-tqbx-wmg";
      const open = (id, name) => new Promise((ok) => { const s = new WebSocket(`${ws}/ws/${room}`);
        s.onopen = () => { s.send(JSON.stringify({ t: "hello", id, name })); ok(s) } });
      const a = await open("aaaaaaaa1", "Ana");
      const got = new Promise((ok) => { a.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === "join") ok(m.name) } });
      await new Promise((r) => setTimeout(r, 500));
      await open("bbbbbbbb2", dirty);
      return await Promise.race([got, new Promise((r) => setTimeout(() => r(null), 5000))]);
    }""", [WS, DIRTY])
    check(seen == CLEAN, f"J16 the server cleans the name it passes on ({seen!r})")  # pinned: safety round 2 J16
    ctx.close()

    # J16, the app: a name in a server message is cleaned where it comes in, whatever the server sent
    ctx = b.new_context(locale="en-US", permissions=["camera", "microphone"])
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(f"pageerror (J16): {e}"))
    pg.goto(f"{BASE}/r/jfo-tqbx-wmh?signal={WS}")
    pg.fill("#name", "Ana")
    pg.click("#enter")
    pg.wait_for_function("() => window.__S && __S.joined", timeout=15000)
    got = pg.evaluate("""(dirty) => { __S.mesh.onSignal({ t: "join", id: "cccccccc3", name: dirty });
      __S.mesh.onSignal({ t: "lock", on: true, by: dirty }); return __S.mesh.known.get("cccccccc3") }""", DIRTY)
    check(got == CLEAN, f"J16 the app cleans a name from the server ({got!r})")  # pinned: safety round 2 J16
    ctx.close()

    # J10: a locked call; an outsider waits to be let in and tries a handshake with the host anyway
    ctx = b.new_context(locale="en-US", permissions=["camera", "microphone"])
    h = ctx.new_page()
    h.on("pageerror", lambda e: errors.append(f"pageerror (J10): {e}"))
    h.goto(f"{BASE}/?signal={WS}")
    h.click("#start")
    h.fill("#name", "Host")
    h.click("#enter")
    h.wait_for_function("() => window.__S && __S.joined && __S.isHost", timeout=15000)
    h.evaluate("() => __S.mesh.host({ t: 'lock', on: true })")
    h.wait_for_function("() => __S.locked", timeout=5000)
    room, host_id = h.evaluate("() => [__S.code, __S.mesh.id]")
    out = b.new_context().new_page()
    out.goto(BASE + "/privacy.html")
    said = out.evaluate("""async ([ws, room, to]) => {
      const s = new WebSocket(`${ws}/ws/${room}`);
      const got = [];
      s.onmessage = (e) => got.push(JSON.parse(e.data).t);
      await new Promise((ok) => (s.onopen = ok));
      s.send(JSON.stringify({ t: "hello", id: "dddddddd4", name: "Outsider" }));
      await new Promise((r) => setTimeout(r, 800));
      s.send(JSON.stringify({ t: "signal", to, data: { sdp: { type: "offer", sdp: "v=0" } } }));
      await new Promise((r) => setTimeout(r, 1500));
      return got;
    }""", [WS, room, host_id])
    reached = h.evaluate("() => !!(__S.mesh.sigIn || {})['dddddddd4'] || __S.mesh.peers.has('dddddddd4')")
    check("waiting" in said and not reached, f"J10 a handshake from someone waiting never reaches the host (outsider heard {said})")  # pinned: safety round 2 J10
    # the app itself: a handshake on the server socket from an id the server never listed is dropped
    h.evaluate("""() => __S.mesh.ws.onmessage({ data: JSON.stringify({ t: "signal", from: "eeeeeeee5", data: { sdp: { type: "offer", sdp: "v=0" } } }) })""")
    h.wait_for_timeout(500)
    dropped = h.evaluate("() => !(__S.mesh.sigIn || {})['eeeeeeee5'] && !__S.mesh.peers.has('eeeeeeee5')")
    check(dropped, "J10 the app drops a server handshake from someone the server never listed")  # pinned: safety round 2 J10
    ctx.close()

    # J2: Host starts a locked call, Bea is let in and made co-host; then someone who knows Bea's id tries to be her
    def joined(ctx, url, name, start=False):
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror (J2 {name}): {e}"))
        pg.goto(url)
        if start:
            pg.click("#start")
        pg.fill("#name", name)
        pg.click("#enter")
        return pg
    hc = b.new_context(locale="en-US", permissions=["camera", "microphone"])
    h = joined(hc, f"{BASE}/?signal={WS}", "Host", start=True)
    h.wait_for_function("() => window.__S && __S.joined && __S.isHost", timeout=15000)
    room = h.evaluate("() => __S.code")
    bc = b.new_context(locale="en-US", permissions=["camera", "microphone"])
    bea = joined(bc, f"{BASE}/r/{room}?signal={WS}", "Bea")
    bea.wait_for_function("() => window.__S && __S.joined", timeout=15000)
    bid = bea.evaluate("() => __S.mesh.id")
    check(bid == bea.evaluate("() => __S.mesh.signer.pub.slice(0, 16)"), "J2 a visit's id is the start of its own key")  # pinned: safety round 2 J1/J2
    h.evaluate("(id) => { __S.mesh.host({ t: 'cohost', id, on: true }); __S.mesh.host({ t: 'lock', on: true }) }", bid)
    h.wait_for_function("(id) => __S.mesh.hosts.has(id) && __S.locked", arg=bid, timeout=5000)
    raw = b.new_context().new_page()
    raw.goto(BASE + "/privacy.html")
    TRY = """async ([ws, room, id, extra]) => {
      const s = new WebSocket(`${ws}/ws/${room}`);
      const got = [];
      let code = 0;
      s.onmessage = (e) => got.push(JSON.parse(e.data).t);
      s.onclose = (e) => (code = e.code);
      await new Promise((ok) => (s.onopen = ok));
      s.send(JSON.stringify({ t: "hello", id, name: "Not Bea", ...extra }));
      await new Promise((r) => setTimeout(r, 1500));
      return [code, got];
    }"""
    fake_ck = bea.evaluate("() => __S.mesh.signer.pub")  # her real key, but no signature from it
    for what, extra in [("no proof", {}), ("her key without her signature", {"ck": fake_ck, "idp": "ab" * 64})]:
        code, got = raw.evaluate(TRY, [WS, room, bid, extra])
        alive = bea.evaluate("() => !!__S.mesh.ws && __S.mesh.ws.readyState === 1")
        check(code == 4004 and "peers" not in got and alive, f"J2 someone with Bea's id ({what}) is refused and Bea stays ({code}, {got}, Bea connected: {alive})")  # pinned: safety round 2 J2
    # Bea's own reload of the link (the same key) still comes straight back as co-host
    bea.evaluate("() => __S.mesh.ws.close()")
    t0 = __import__("time").time()
    try:
        bea.wait_for_function("() => !!__S.mesh.ws && __S.mesh.ws.readyState === 1 && __S.mesh.lost >= 1", timeout=20000)
    except Exception:
        pass
    print(f"  (reconnect took {__import__('time').time() - t0:.1f} s)")
    back = bea.evaluate("() => !!__S.mesh.ws && __S.mesh.ws.readyState === 1")
    still = h.evaluate("(id) => __S.mesh.hosts.has(id)", bid)
    check(back and still, f"J2 Bea's own reconnect comes back as co-host (connected: {back}, co-host: {still})")  # pinned: safety round 2 J2
    # Bea leaves; her old id, unproven, is not let straight back into the locked call nor made co-host
    bc.close()
    h.wait_for_timeout(1500)
    code, got = raw.evaluate(TRY, [WS, room, bid, {}])
    check("waiting" in got and "peers" not in got, f"J2 Bea's old id without her key waits to be let in ({code}, {got})")  # pinned: safety round 2 J2
    hc.close()

    # J1, the relay layer: a signed event reaches the call with its signer; changed in any way, it reaches nobody
    pg = b.new_context().new_page()
    pg.on("pageerror", lambda e: errors.append(f"pageerror (J1): {e}"))
    pg.goto(BASE + "/privacy.html")
    res = pg.evaluate("""async (base) => {
      const { NostrSignal } = await import(base + "/nsig.js");
      const got = [];
      const mk = (onMsg) => new NostrSignal({ room: "jfo-tqbx-wmj", relays: ["wss://down.invalid"], onMsg });
      const a = mk(() => {}), b = mk((m, pub) => got.push([m.t, pub]));
      await Promise.all([a.ready, b.ready]);
      let raw = null;
      a.socks = new Map([["x", { readyState: 1, send: (s) => (raw = s) }]]);
      await a.send({ t: "hello", from: "anyone" });
      const ev = JSON.parse(raw)[1];
      await b.onEvent(JSON.stringify(["EVENT", "s", ev]));
      const other = mk(() => {});
      for (const bad of [{ ...ev, id: ev.id.replace(/^./, (c) => (c === "0" ? "1" : "0")) }, { ...ev, pubkey: other.pub }, { ...ev, sig: ev.sig.replace(/^./, (c) => (c === "0" ? "1" : "0")) }, { ...ev, sig: undefined }])
        await b.onEvent(JSON.stringify(["EVENT", "s", bad]));
      a.closed = b.closed = other.closed = true;
      return { got, pub: a.pub };
    }""", BASE)
    check(len(res["got"]) == 1 and res["got"][0][1] == res["pub"], f"J1 a relay event arrives once, with the key that signed it; changed copies never ({len(res['got'])} arrived)")  # pinned: safety round 2 J1

    # J1, the call: a relay message whose id is not the start of the signing key is ignored
    ctx = b.new_context(locale="en-US", permissions=["camera", "microphone"])
    h = ctx.new_page()
    h.on("pageerror", lambda e: errors.append(f"pageerror (J1 call): {e}"))
    h.goto(f"{BASE}/?signal={WS}")
    h.click("#start")
    h.fill("#name", "Host")
    h.click("#enter")
    h.wait_for_function("() => window.__S && __S.joined", timeout=15000)
    seen = h.evaluate("""async () => {
      const m = __S.mesh;
      m.ns ||= { send() {} }; // a page on the server only: answers to the relays go nowhere
      const k1 = "aa".repeat(32), k2 = "bb".repeat(32);
      await m.onRelay({ t: "hello", from: k1.slice(0, 16), name: "Eve as someone" }, k2);
      await m.onRelay({ t: "hello", from: k2.slice(0, 16), name: "Bo" }, k2);
      return [m.helloSeen.has(k1.slice(0, 16)), m.helloSeen.has(k2.slice(0, 16))];
    }""")
    check(seen == [False, True], f"J1 a relay message counts only as the one who signed it (claimed id taken: {seen[0]}, own id taken: {seen[1]})")  # pinned: safety round 2 J1
    ctx.close()

    # J5, on one device with stand-in people: Zoe (connected to me) offers to pass on Lo (lower id) and Hi (higher id)
    ctx = b.new_context(locale="en-US", permissions=["camera", "microphone"])
    h = ctx.new_page()
    h.on("pageerror", lambda e: errors.append(f"pageerror (J5): {e}"))
    h.goto(f"{BASE}/?signal={WS}")
    h.click("#start")
    h.fill("#name", "Me")
    h.click("#enter")
    h.wait_for_function("() => window.__S && __S.joined", timeout=15000)
    r = h.evaluate("""() => {
      const m = __S.mesh, f = m.fwd;
      const stub = (id, more) => ({ id, pc: null, dc: { readyState: "open", send() {} }, name: id, stream: new MediaStream(), audio: null, video: null, state: "connecting", cid: "", ...more });
      const LO = "0000000000000000", HI = "ffffffffffffffff";
      m.peers.set("zoe0000000000000", stub("zoe0000000000000", { state: "connected" }));
      const res = {};
      // a working link is never replaced
      const live = stub(HI, { state: "connected", helper: "zoe0000000000000" });
      m.peers.set(HI, live);
      f.on("zoe0000000000000", HI, "s1", "x");
      res.keptWorking = m.peers.get(HI) === live;
      // I asked for help with HI (higher id: I'm the one who asks) but picked someone else
      m.peers.set(HI, stub(HI, { gaveUp: true, helper: "someoneelse00000" }));
      f.on("zoe0000000000000", HI, "s2", "x");
      res.unasked = !m.peers.get(HI).via;
      m.peers.get(HI).helper = "zoe0000000000000";
      f.on("zoe0000000000000", HI, "s3", "x");
      res.asked = m.peers.get(HI).via === "zoe0000000000000";
      // LO asks, I wait: an offer before my own link gave up waits; when it gives up, it is taken
      const lo = stub(LO, {});
      m.peers.set(LO, lo);
      f.on("zoe0000000000000", LO, "s4", "x");
      res.early = m.peers.get(LO) === lo;
      lo.gaveUp = true;
      f.gaveUp(lo);
      res.afterGiveUp = m.peers.get(LO).via === "zoe0000000000000";
      // someone not in the call at all
      f.on("zoe0000000000000", "nobody0000000000", "s5", "x");
      res.stranger = !m.peers.has("nobody0000000000");
      for (const id of [LO, HI, "zoe0000000000000"]) m.peers.delete(id);
      return res;
    }""")
    check(all(r.values()), f"J5 a helper is taken only when owed, never over a working link ({r})")  # pinned: safety round 2 J5
    ctx.close()

    # J3
    pg = b.new_context().new_page()
    pg.on("pageerror", lambda e: errors.append(f"pageerror (J3): {e}"))
    pg.goto(BASE + "/privacy.html")
    r = pg.evaluate("""async ([base, ws]) => {
      const ha = await import(base + "/hostauth.js");
      const nsig = await import(base + "/nsig.js");
      const fresh = ha.newHost();
      // an old call: a key whose old 10-letter code is the room
      const old = ha.newHost();
      const oldCode = ha.oldCodeOf(Uint8Array.from(ha.pubOf(old.key).match(/../g), (h) => parseInt(h, 16)));
      const hello = await ha.hostHello(old.key, oldCode, {});
      const s = new WebSocket(`${ws}/ws/${oldCode}`);
      const got = [];
      s.onmessage = (e) => got.push(JSON.parse(e.data));
      await new Promise((ok) => (s.onopen = ok));
      s.send(JSON.stringify(hello));
      await new Promise((r) => setTimeout(r, 1200));
      s.close();
      const room = got.find((m) => m.t === "room") || {};
      // the relay tag of a call: not the plain hash of its code any more
      const n = new nsig.NostrSignal({ room: fresh.code, relays: ["wss://down.invalid"], onMsg() {} });
      const t0 = performance.now();
      await n.ready;
      n.closed = true;
      const plain = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("juntos-topic|" + fresh.code))), (b) => b.toString(16).padStart(2, "0")).join("");
      return { code: fresh.code, owns: ha.ownsCode(ha.pubOf(fresh.key), fresh.code), oldOwns: ha.ownsCode(ha.pubOf(old.key), oldCode),
               oldHost: !!room.owner, sentKey: JSON.stringify(hello).includes(old.key), slowTag: n.topic !== plain && /^[0-9a-f]{64}$/.test(n.topic),
               rounds: nsig.SLOW_ROUNDS, ms: Math.round(performance.now() - t0) };
    }""", [BASE, WS])
    check(re.fullmatch(r"[a-z]{5}-[a-z]{5}-[a-z]{5}", r["code"]) and r["owns"], f"J3 a new call's code has 15 letters and its key owns it ({r['code']})")  # pinned: safety round 2 J3
    check(r["oldOwns"] and r["oldHost"] and not r["sentKey"], f"J3 an old 10-letter code still proves its host, on the server too, without the key ({r})")  # pinned: safety round 2 J3
    check(r["slowTag"] and r["rounds"] >= 100000, f"J3 the relay tag comes through a slow hash ({r['rounds']} rounds, {r['ms']} ms here)")  # pinned: safety round 2 J3

    # J4 + J13 on two room servers
    subprocess.run(["node", "pack.mjs"], cwd=KIN, check=True, capture_output=True)
    kin = []
    for port in KPORTS:
        env = {**os.environ, "PORT": str(port), "BIND": "127.0.0.1", "DATA_DIR": tempfile.mkdtemp(prefix=f"juntos-s2-{port}-")}
        kin.append(subprocess.Popen(["node", "server.mjs"], cwd=KIN, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=0x08000000))
    try:
        for port in KPORTS:
            for _ in range(100):
                try:
                    urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=1)
                    break
                except Exception:
                    time.sleep(0.1)
            else:
                raise RuntimeError(f"room server copy on {port} did not start (port in use?)")
        S1, S2 = (f"ws://127.0.0.1:{pt}" for pt in KPORTS)
        raw = b.new_context().new_page()
        raw.goto(BASE + "/privacy.html")
        HELLO = """async ([url, room, hello]) => {
          const s = new WebSocket(`${url}/ws/${room}`);
          const got = [];
          s.onmessage = (e) => got.push(JSON.parse(e.data));
          await new Promise((ok, no) => { s.onopen = ok; s.onerror = no });
          s.send(JSON.stringify({ t: "hello", name: "X", ...hello }));
          await new Promise((r) => setTimeout(r, 1200));
          s.close();
          return got;
        }"""
        # an empty room with a code-like name: asking first with some key makes nobody host
        got = raw.evaluate(HELLO, [S1, "jfo-tqbx-wmk", {"id": "ffffffff6", "key": "ab" * 32, "claim": True, "opts": {"pass": "1234"}}])
        room = next((m for m in got if m.get("t") == "room"), {})
        check(room and not room.get("host") and not room.get("pass"), f"J4 asking first with a key that doesn't make the code gives no host role and sets nothing ({room})")  # pinned: safety round 2 J4

        hc = b.new_context(locale="en-US", permissions=["camera", "microphone"])
        h = hc.new_page()
        h.on("pageerror", lambda e: errors.append(f"pageerror (J4): {e}"))
        sent = []
        h.on("websocket", lambda w: w.on("framesent", lambda f: sent.append(f if isinstance(f, str) else str(f))))
        h.goto(f"{BASE}/?signal={S1}&signal2={S2}")
        h.click("#start")
        h.fill("#name", "Host")
        h.click("#enter")
        h.wait_for_function("() => window.__S && __S.joined && __S.isHost", timeout=20000)
        code, here = h.evaluate("() => [__S.code, __S.mesh.servers[__S.mesh.si]]")
        other = S2 if here == S1 else S1
        h.evaluate("() => { __S.mesh.host({ t: 'pass', pass: '7391' }); __S.mesh.host({ t: 'lock', on: true }) }")
        h.wait_for_timeout(2500)
        got = raw.evaluate(HELLO, [other, code, {"id": "gggggggg7"}])
        check(any(m.get("t") == "passcode" for m in got), f"J4 the passcode set during the call holds on the other server too ({[m.get('t') for m in got]})")  # pinned: safety round 2 J4
        got = raw.evaluate(HELLO, [other, code, {"id": "hhhhhhhh8", "pass": "7391"}])
        # (with no host on that server a locked call still lets people in: nobody there could answer them)
        locked = any(m.get("t") == "room" and m.get("locked") for m in got) or any(m.get("t") == "waiting" for m in got)
        check(locked, f"J4 so does the lock ({[m.get('t') for m in got]})")  # pinned: safety round 2 J4
        key = h.evaluate("(c) => localStorage.getItem(`juntos.host.${c}`)", code)
        check(bool(key) and not any(key in f for f in sent), f"J13 the host's secret key is never sent ({len(sent)} messages checked)")  # pinned: safety round 2 J13
        hc.close()

        # J7 on a copy with low limits: 5 links a minute per address, 3 new rooms a minute
        data = tempfile.mkdtemp(prefix="juntos-s2-limits-")
        env = {**os.environ, "PORT": "8817", "BIND": "127.0.0.1", "DATA_DIR": data, "JOIN_LIMIT": "5", "NEW_PER_MINUTE": "3"}
        kin.append(subprocess.Popen(["node", "server.mjs"], cwd=KIN, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=0x08000000))
        for _ in range(100):
            try:
                urllib.request.urlopen("http://127.0.0.1:8817/health", timeout=1)
                break
            except Exception:
                time.sleep(0.1)
        OPENS = """async ([url, rooms]) => {
          const out = [];
          for (const room of rooms) out.push(await new Promise((ok) => {
            const s = new WebSocket(`${url}/ws/${room}`);
            s.onopen = () => { s.send(JSON.stringify({ t: "hello", id: "kkkkkkkk" + out.length, name: "K" })); setTimeout(() => (s.close(), ok(true)), 300) };
            s.onerror = () => ok(false);
          }));
          return out;
        }"""
        got = raw.evaluate(OPENS, ["ws://127.0.0.1:8817", ["jfo-tqbx-wa1", "jfo-tqbx-wa2", "jfo-tqbx-wa3", "jfo-tqbx-wa4"]])
        check(got == [True, True, True, False], f"J7 the game host opens at most 3 new rooms a minute per address ({got})")  # pinned: safety round 2 J7
        time.sleep(0.6)
        files = [f for f in os.listdir(data) if not f.startswith(".")]
        check(not files, f"J7 a made-up room with one visitor stores nothing ({files})")  # pinned: safety round 2 J7
        got = raw.evaluate(OPENS, ["ws://127.0.0.1:8817", ["jfo-tqbx-wa1", "jfo-tqbx-wa1"]])
        check(got == [True, False], f"J7 and takes at most 5 links a minute per address ({got})")  # pinned: safety round 2 J7
    finally:
        for k in kin:
            k.kill()
            k.wait()
    b.close()

# ---- J8 + J9 on a game-host copy (no browser) ----
import asyncio
import json as _json
import websockets

HELLO_JS = """
const ha = await import("file:///" + process.argv[1].replace(/\\\\/g, "/") + "/hostauth.js");
const h = ha.newHost();
const code = h.code;
console.log(JSON.stringify({ code, hello: await ha.hostHello(h.key, code, { ctl: [{ t: "pass", pass: "k3m9x2ab" }] }) }));
"""


async def j8_j9():
    data = tempfile.mkdtemp(prefix="juntos-s2-tree-")
    env = {**os.environ, "PORT": "8818", "BIND": "127.0.0.1", "DATA_DIR": data, "MESH_MAX": "3"}
    proc = subprocess.Popen(["node", "server.mjs"], cwd=KIN, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=0x08000000)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen("http://127.0.0.1:8818/health", timeout=1)
                break
            except Exception:
                time.sleep(0.1)
        U = "ws://127.0.0.1:8818/ws/"
        pub = lambda i: ("p%02d" % i) + "A" * 41

        async def join(room, ip, hello, keep=1.0):
            ws = await websockets.connect(U + room, additional_headers={"x-forwarded-for": ip})
            await ws.send(_json.dumps({"t": "hello", "name": "T", **hello}))
            return ws

        async def drain(ws, secs=0.8):
            out = []
            try:
                while True:
                    out.append(_json.loads(await asyncio.wait_for(ws.recv(), secs)))
            except Exception:
                pass
            return out

        # J8 a: 40 links from one network, the 41st is told the call is full for its network
        socks = [await join("jfo-tqbx-wb1", "10.1.1.1", {"id": "netnet%03d" % i, "pub": pub(i)}) for i in range(41)]
        last = await drain(socks[-1])
        check(any(m.get("t") == "full" and m.get("net") for m in last), f"J8 the 41st link from one network is turned away ({[m.get('t') for m in last]})")  # pinned: safety round 2 J8
        for w in socks:
            await w.close()
        # J8 b: four people (a tree from 4 on) each claiming to feed 6: nobody but a host gets more than 2 children
        socks = [await join("jfo-tqbx-wb2", f"10.2.0.{i}", {"id": "tree%04d" % i, "cap": 6, "pub": pub(i)}) for i in range(1, 5)]
        await asyncio.sleep(0.5)
        trees = [[m for m in await drain(w) if m.get("t") == "tree"] for w in socks]
        most = max((len(t[-1]["kids"]) for t in trees if t), default=-1)
        check(0 <= most <= 2, f"J8 a guest saying it can feed 6 gets at most 2 ({most})")  # pinned: safety round 2 J8
        for w in socks:
            await w.close()
        # J8 c: a device without a key is the one told full when the call grows past a mesh, not the newcomer
        socks = [await join("jfo-tqbx-wb3", "10.3.0.1", {"id": "keyless01"})]
        socks += [await join("jfo-tqbx-wb3", f"10.3.0.{i}", {"id": "keyed%04d" % i, "pub": pub(i)}) for i in range(2, 4)]
        await asyncio.sleep(0.3)
        await drain(socks[0], 0.3)
        socks.append(await join("jfo-tqbx-wb3", "10.3.0.9", {"id": "newcomer9", "pub": pub(9)}))
        old, new = await drain(socks[0]), await drain(socks[-1])
        check(any(m.get("t") == "full" and m.get("device") for m in old) and any(m.get("t") == "peers" for m in new),
              f"J8 the keyless device is told full and the newcomer gets in ({[m.get('t') for m in old]}, {[m.get('t') for m in new]})")  # pinned: safety round 2 J8
        for w in socks:
            await w.close()
        # J9: a passcode call; 30 wrong tries from 30 networks lock it and the person inside is told
        made = subprocess.run(["node", "--input-type=module", "-e", HELLO_JS, os.path.join(WEB)], capture_output=True, text=True, check=True)
        h = _json.loads(made.stdout)
        ctl = await websockets.connect(U + h["code"], additional_headers={"x-forwarded-for": "10.9.9.9"})
        await ctl.send(_json.dumps(h["hello"]))
        await drain(ctl, 0.5)
        inside = await join(h["code"], "10.9.9.8", {"id": "inside001", "pass": "k3m9x2ab"})
        await drain(inside, 0.5)
        for i in range(30):
            w = await join(h["code"], f"10.4.{i}.1", {"id": "guess%04d" % i, "pass": "wrong%03d" % i})
            await drain(w, 0.2)
        told = await drain(inside, 1.0)
        check(any(m.get("t") == "lock" and m.get("guesses") for m in told), f"J9 30 wrong passcodes lock the call and tell those in it ({[m.get('t') for m in told]})")  # pinned: safety round 2 J9
        await inside.close()
    finally:
        proc.kill()
        proc.wait()


asyncio.run(j8_j9())
pw = subprocess.run(["node", "--input-type=module", "-e",
                     "const s = await import('file:///' + process.argv[1].replace(/\\\\/g, '/') + '/schedule.js').catch(() => null);"
                     " console.log(s ? s.newPass() : '')", WEB], capture_output=True, text=True)
check(bool(re.fullmatch(r"\d{6}", pw.stdout.strip())), f"J9 a ready-made passcode stays 6 digits, the call lock covers guessing ({pw.stdout.strip() or pw.stderr.strip()[-120:]})")  # pinned: Zoom-like 6 digits by default

print("\n" + ("ALL OK" if not errors else f"{len(errors)} FAILED:\n" + "\n".join(errors)))
sys.exit(1 if errors else 0)
