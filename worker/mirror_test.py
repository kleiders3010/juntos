# The second copy of the site (GitHub Pages, https://kleiders3010.github.io/juntos/): it works on its own under
# /juntos/, and its calls are the same calls as on meet.jurisgames.com.
#   local: python worker/mirror_test.py   (wrangler dev on 8797; builds the copy with tools/mirror.mjs and serves it
#          the way GitHub Pages does: files, "privacy" -> privacy.html, anything else -> 404.html)
#   live:  python worker/mirror_test.py https://kleiders3010.github.io/juntos/ https://meet.jurisgames.com
import asyncio
import functools
import http.server
import json
import os
import subprocess
import sys
import threading

import websockets
from playwright.sync_api import sync_playwright

LIVE = len(sys.argv) > 1 and sys.argv[1].startswith("https://")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIRROR = sys.argv[1] if LIVE else "http://127.0.0.1:8821/juntos/"
MAIN = (sys.argv[2] if len(sys.argv) > 2 else "https://meet.jurisgames.com") if LIVE else "http://127.0.0.1:8797"
WS = MAIN.replace("http", "ws", 1)
RELAY_PORT = 8813
Q = "" if LIVE else f"signal={WS}&relays=ws://127.0.0.1:{RELAY_PORT}"
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
errors = []
relay_events = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


# --- a minimal Nostr relay that replays recent events, like the public ones ---
subs = {}


def matches(f, ev):
    if "kinds" in f and ev.get("kind") not in f["kinds"]:
        return False
    if "#x" in f and not any(t[0] == "x" and t[1] in f["#x"] for t in ev.get("tags", [])):
        return False
    return True


async def relay_conn(ws):
    subs[ws] = []
    try:
        async for raw in ws:
            d = json.loads(raw)
            if d[0] == "REQ":
                subs[ws].append((d[1], d[2]))
                for ev in relay_events[-2000:]:
                    if matches(d[2], ev) and ev["created_at"] >= d[2].get("since", 0):
                        await ws.send(json.dumps(["EVENT", d[1], ev]))
                await ws.send(json.dumps(["EOSE", d[1]]))
            elif d[0] == "EVENT":
                ev = d[1]
                relay_events.append(ev)
                await ws.send(json.dumps(["OK", ev["id"], True, ""]))
                for other, fs in list(subs.items()):
                    for sid, f in fs:
                        if matches(f, ev):
                            try:
                                await other.send(json.dumps(["EVENT", sid, ev]))
                            except Exception:
                                pass
    finally:
        subs.pop(ws, None)


def run_relay():
    async def main():
        async with websockets.serve(relay_conn, "127.0.0.1", RELAY_PORT):
            await asyncio.Future()
    asyncio.run(main())


# --- GitHub Pages, as far as this site needs it ---
class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 256  # the page loads ~25 modules at once; the default 5 refused some (a test-server flake)


class Pages(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send_head(self):
        path = self.translate_path(self.path)
        if not os.path.exists(path) and os.path.exists(path + ".html"):
            self.path = self.path.split("?")[0] + ".html"
        elif not os.path.exists(path):
            # the site's own 404.html, with a 404 status, for any missing path under /juntos/
            f = open(os.path.join(self.directory, "juntos", "404.html"), "rb")
            self.send_response(404)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            return f
        return super().send_head()


if not LIVE:
    site = os.path.join(os.environ.get("TEMP", "/tmp"), "juntos_mirror_test")
    subprocess.run(["node", os.path.join(ROOT, "tools", "mirror.mjs"), os.path.join(site, "juntos"), "/juntos/"], check=True)
    srv = Server(("127.0.0.1", 8821), functools.partial(Pages, directory=site))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    threading.Thread(target=run_relay, daemon=True).start()

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)
    broken = []

    def person(name, url):
        pg = b.new_context(locale="en-US", permissions=["camera", "microphone"]).new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror ({name}): {e}"))
        logs = []
        pg.on("console", lambda m: logs.append(m.text[:160]))
        pg.on("framenavigated", lambda f: logs.append("nav " + f.url) if f == pg.main_frame else None)
        # a file the page needs that isn't there (the call page itself comes from 404.html on GitHub Pages)
        pg.on("response", lambda r: broken.append(f"{name}: {r.status} {r.url}") if r.status >= 400 and r.request.resource_type != "document" else None)
        pg.on("requestfailed", lambda r: broken.append(f"{name}: failed {r.url}") if not r.url.startswith("ws") else None)
        pg.goto(url)
        if "/r/" not in url:
            pg.click("#start")
        try:
            pg.fill("#name", name, timeout=15000)
        except Exception:
            shot = os.path.join(os.environ.get("TEMP", "."), f"mirror_test_{name}.png")
            pg.screenshot(path=shot)
            raise RuntimeError(f"{name}: no name field at {pg.url} (screenshot {shot}); now at {pg.evaluate('location.href')}, "
                               f"shown: {pg.evaluate('[...document.querySelectorAll(`body > *`)].filter(e => !e.hidden && e.id).map(e => e.id)')}, log: {logs[-8:]}")
        pg.click("#enter")
        pg.wait_for_selector("#call:not([hidden])")
        pg.wait_for_function("__S.joined", timeout=20000)
        return pg

    a = person("Ana", MIRROR + ("?" + Q if Q else ""))
    path = a.evaluate("location.pathname")
    code = path.rstrip("/").split("/")[-1]
    check(path.startswith("/juntos/r/"), f"a call started on the copy stays under /juntos/ ({path})")  # pinned: the copy lives at /juntos/
    check(a.evaluate("[...document.styleSheets].some(s => s.cssRules.length > 0)"), "the copy has its styles")
    inv = a.evaluate("`${location.origin}${location.pathname}`")
    both = "__S.mesh.peers.size === {n} && [...__S.mesh.peers.values()].every(p => p.dc.readyState === 'open')"
    o = person("Beto", f"{MAIN}/r/{code}" + ("?" + Q if Q else ""))
    a.wait_for_function(both.format(n=1), timeout=25000)
    o.wait_for_function(both.format(n=1), timeout=25000)
    check(True, "Beto joins the same call from meet.jurisgames.com: one call, two sites")
    c = person("Carla", inv + ("?" + Q if Q else ""))
    for pg in (a, o, c):
        pg.wait_for_function(both.format(n=2), timeout=25000)
    check(True, "Carla opens the copy's call link (/juntos/r/<code>, served by 404.html): three people connected")
    c.wait_for_function("[...__S.mesh.peers.values()].every(p => p.stream && p.stream.getAudioTracks().length > 0)", timeout=15000)
    check(True, "Carla hears both")
    pv = a.evaluate("fetch(new URL('privacy', document.baseURI.replace(/r\\/[^/]*$/, '')).href).then(r => r.status)")
    check(pv == 200, f"the copy's privacy page opens ({pv})")  # pinned: HTTP OK
    c.click("#bLeave"); c.query_selector("#justLeave") and c.click("#justLeave")  # a host is asked: just leave
    c.click("#homeBtn")
    c.wait_for_function("!document.querySelector('#home').hidden", timeout=10000)
    check(c.evaluate("location.pathname") == "/juntos/", f"leaving goes back to the copy's start page ({c.evaluate('location.pathname')})")  # pinned: the copy lives at /juntos/
    a.wait_for_timeout(1500)
    check(not broken, f"no missing files on either site: {broken[:6]}")
    b.close()

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
