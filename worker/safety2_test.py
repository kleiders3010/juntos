# Safety round 2 (research/safety-audit-2026-11-21/juntos.md in SelfSustainment), headless Edge. Grows with each fix.
# J15: the test switches in the link (?signal=, ?signal2=, ?relays=) reach this computer only when the page itself is
#      served from this computer; the shipped pages' CSP has no localhost (the test server adds it).
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
    b.close()

print("\n" + ("ALL OK" if not errors else f"{len(errors)} FAILED:\n" + "\n".join(errors)))
sys.exit(1 if errors else 0)
