# No single point of failure (Kleider, 2026-11-18: "I don't want the app relaying forever onto the same service, all
# parts of the app should work even if one the pieces break down"). Each piece is taken away in turn:
# - the relays down and the call's first room server down: people still meet, through the second server;
# - a call on a room server (it has a passcode) whose server dies: everyone moves to the other server, the
#   connections between them stay, the passcode still holds there, and a newcomer is sent to the right server;
# - both room servers down: an ordinary call still works through the relays.
# The two room servers here are two copies of kinetic/server.mjs (the same room code Cloudflare runs: host, roles
# and secure tests pass on it with JUNTOS_SIGNAL), so this test can stop them. The pages come from wrangler dev.
# Run: python failover_test.py [base-url]   (an https base: the live site; only the first part, against the real
# servers: Cloudflare's and the game host's, each with the other one unreachable)
import asyncio
import json
import os
import subprocess
import sys
import threading
import time
import urllib.request
sys.stdout.reconfigure(encoding='utf-8')
import websockets
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8798"
HERE = os.path.dirname(os.path.abspath(__file__))
KIN = os.path.join(HERE, "..", "kinetic")
PORTS = [8801, 8802]
DEAD = "ws://127.0.0.1:8809"  # nothing listens here
RELAY_PORT = 8814
RELAY = f"ws://127.0.0.1:{RELAY_PORT}"
ARGS = ["--disable-gpu", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


# --- a minimal Nostr relay (recent events replayed, like the public ones) ---
subs, stored = {}, []


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
                for ev in stored:
                    if matches(d[2], ev) and ev["created_at"] >= d[2].get("since", 0):
                        await ws.send(json.dumps(["EVENT", d[1], ev]))
                await ws.send(json.dumps(["EOSE", d[1]]))
            elif d[0] == "EVENT":
                ev = d[1]
                stored.append(ev)
                del stored[:-2000]
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
        async with websockets.serve(relay_conn, "127.0.0.1", RELAY_PORT, max_size=2**20):
            await asyncio.Future()
    asyncio.run(main())


threading.Thread(target=run_relay, daemon=True).start()

# --- the two room servers ---
subprocess.run(["node", "pack.mjs"], cwd=KIN, check=True, capture_output=True)
procs = {}


def start(port):
    env = {**os.environ, "PORT": str(port), "BIND": "127.0.0.1", "DATA_DIR": os.path.join(os.environ.get("TEMP", "."), f"juntos-failover-{port}")}
    procs[port] = subprocess.Popen(["node", "server.mjs"], cwd=KIN, env=env, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   creationflags=0x08000000 if os.name == "nt" else 0)
    for _ in range(50):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1)
            return
        except Exception:
            time.sleep(0.1)


def stop(port):
    procs[port].kill()
    procs[port].wait()


def info(port, code):
    return json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}/info/{code}", timeout=3).read())


LIVE = BASE.startswith("https://")
if not LIVE:
    for pt in PORTS:
        start(pt)
S1, S2 = (f"ws://127.0.0.1:{pt}" for pt in PORTS)
if LIVE:
    S1, S2 = "wss://meet.jurisgames.com", "wss://games.jurisgames.com/juntos"
    DEAD = "wss://server-down.invalid"  # the live site takes no local test switches: an address that can never connect
time.sleep(0.5)

try:
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)

        def person(name, url, wait=True):
            pg = b.new_context(locale="en-US", permissions=["camera", "microphone"]).new_page()
            pg.on("pageerror", lambda e: errors.append(f"pageerror ({name}): {e}"))
            pg.goto(url)
            if "/r/" not in url:
                pg.click("#start")
            pg.fill("#name", name)
            pg.click("#enter")
            pg.wait_for_selector("#call:not([hidden])")
            if wait:
                pg.wait_for_function("() => __S.joined", timeout=30000)
            return pg

        full = "(n) => __S.mesh && __S.mesh.peers.size === n && [...__S.mesh.peers.values()].every(p => p.dc.readyState === 'open')"

        def wait(pg, js, what, arg=None, secs=20):
            __import__("re").match(r"\s*(\([^()]*\)|\w+)\s*=>", js) or (js := "() => " + js)  # the pages forbid eval: Playwright polls functions without it
            try:
                pg.wait_for_function(js, arg=arg, timeout=secs * 1000)
                check(True, what)
                return True
            except Exception:
                check(False, what)
                return False

        # 1. the relays down and one room server down: the other one carries the call, whichever is first
        cases = ((DEAD, S2, "Cloudflare's room server down"), (S1, DEAD, "the game host's room server down")) if LIVE else (
            (DEAD, S1, "the first room server down"), (S1, DEAD, "the second room server down"))
        for first, second, what in cases:
            # (the live site takes no local test switches: a relay that can never connect stands for "relays down")
            q = f"signal={first}&signal2={second}&relays=" + ("wss://relays-down.invalid" if LIVE else "ws://127.0.0.1:8810")
            a = person("Ana", f"{BASE}/?{q}")
            link = a.url.split("?")[0] + "?" + q
            o = person("Beto", link)
            ok = wait(a, full, f"relays down and {what}: Ana and Beto meet through the other server", arg=1, secs=30)
            if ok:
                check(a.evaluate("__S.mesh.srvUrl") == (second if first == DEAD else first), f"  (through {a.evaluate('__S.mesh.srvUrl')})")
            a.context.close()
            o.context.close()

        if not LIVE:  # the servers can only be stopped here
            # 2. a call on a room server (it has a passcode) whose server dies
            q = f"signal={S1}&signal2={S2}&relays={RELAY}"
            a = person("Ana", f"{BASE}/?{q}")
            link = a.url.split("?")[0] + "?" + q
            o = person("Beto", link)
            wait(a, full, "Ana and Beto meet through the relays", arg=1)
            a.evaluate("__S.mesh.host({ t: 'pass', pass: '482916' })")
            wait(o, "__S.mesh.srv && __S.mesh.ws && __S.mesh.ws.readyState === 1", "Ana sets a passcode: the call moves to a room server")
            code = a.evaluate("__S.code")
            used = a.evaluate("__S.mesh.srvUrl")
            port = int(used.rsplit(":", 1)[1])
            other = [pt for pt in PORTS if pt != port][0]
            # the host's passcode reaches the server a moment after Beto has moved there
            for _ in range(20):
                if info(port, code)["pass"]:
                    break
                time.sleep(0.25)
            check(o.evaluate("__S.mesh.srvUrl") == used and info(port, code)["pass"], f"both on the server the call's code picked ({port}), the passcode there")
            cid = a.evaluate("[...__S.mesh.peers.values()][0].cid")
            stop(port)
            print(f"  server {port} stopped", flush=True)
            wait(a, f"__S.mesh.srvUrl === 'ws://127.0.0.1:{other}' && __S.mesh.ws.readyState === 1", "Ana moves to the other server", secs=40)
            wait(o, f"__S.mesh.srvUrl === 'ws://127.0.0.1:{other}' && __S.mesh.ws.readyState === 1", "so does Beto", secs=40)
            time.sleep(2)
            check(a.evaluate("[...__S.mesh.peers.values()][0].cid") == cid and a.evaluate(full, 1), "their connection stayed up the whole time")
            check(info(other, code)["pass"] is True, "the passcode holds on the other server too (Ana gave it the call's choices)")
            d = person("Dan", link, wait=False)
            wait(d, "!__S.mesh && !document.querySelector('#lobby').hidden", "Dan looks on the relays, is sent to the working server, and is asked for the passcode", secs=30)

            # 3. both room servers down: an ordinary call still works through the relays
            stop(PORTS[0])
            stop(PORTS[1])
            q = f"signal={S1}&signal2={S2}&relays={RELAY}"
            e = person("Eve", f"{BASE}/?{q}")
            f = person("Fay", e.url.split("?")[0] + "?" + q)
            wait(e, full, "both room servers down: Eve and Fay still meet through the relays", arg=1, secs=30)
        b.close()
finally:
    for pr in procs.values():
        try:
            pr.kill()
        except Exception:
            pass

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
