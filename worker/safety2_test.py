# Safety round 2 (research/safety-audit-2026-11-21/juntos.md in SelfSustainment), headless Edge. Grows with each fix.
# J15: the test switches in the link (?signal=, ?signal2=, ?relays=) reach this computer only when the page itself is
#      served from this computer; the shipped pages' CSP has no localhost (the test server adds it).
# J16: names are cleaned on the server (hello) and where they enter the app (server messages, relays, helpers).
# J10: someone waiting to be let in can't send handshakes to the people inside; the app takes server handshakes
#      only from people the server listed.
# Run against the TEST server: npx wrangler dev -c wrangler.test.toml --port 8798, then python safety2_test.py [base-url]

import os
import re
import sys
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

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
    b.close()

print("\n" + ("ALL OK" if not errors else f"{len(errors)} FAILED:\n" + "\n".join(errors)))
sys.exit(1 if errors else 0)
