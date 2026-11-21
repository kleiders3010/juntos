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
    finally:
        for k in kin:
            k.kill()
            k.wait()
    b.close()

print("\n" + ("ALL OK" if not errors else f"{len(errors)} FAILED:\n" + "\n".join(errors)))
sys.exit(1 if errors else 0)
