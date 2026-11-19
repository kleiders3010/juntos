# Calls that never touch our server (Kleider, 2026-11-18: "entirely disregarding the free tier when the situation
# allows it ... if anything just to ROUTE the joins"): people find each other through Nostr relays (here a small
# fake relay on this PC, speaking the same protocol), and our server is opened only when the call needs it.
# Checks: an ordinary call makes no request to our server at all (no websocket, no /info); the people in it hear
# each other; someone leaving is gone for the others; when the host sets a passcode, everyone moves to the server
# and keeps their connections; a newcomer then is sent to the server, which asks them for the passcode.
# Run: python serverless_test.py [base-url]
import asyncio
import json
import sys
import threading
sys.stdout.reconfigure(encoding='utf-8')
import websockets
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8797"
WS = BASE.replace("http", "ws", 1)
RELAY_PORT = 8811
RELAY = f"ws://127.0.0.1:{RELAY_PORT}"
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
errors = []
relay_events = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


# --- a minimal Nostr relay: REQ subscriptions (kinds + #x), EVENT fan-out, recent events replayed ---
subs = {}  # websocket -> list of filters


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
                # public relays send what they still have since the subscription's "since" (ephemeral ones too,
                # for a while): a newcomer sees hellos from before it came
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


threading.Thread(target=run_relay, daemon=True).start()

server_hits = {}  # name -> list of our-server requests (websocket links and /info)

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)

    def person(name, url, wait=True):
        pg = b.new_context(locale="en-US", permissions=["camera", "microphone"]).new_page()
        hits = server_hits.setdefault(name, [])
        pg.on("pageerror", lambda e: errors.append(f"pageerror ({name}): {e}"))
        pg.on("websocket", lambda w: hits.append(w.url) if w.url.startswith(WS) else None)
        pg.on("request", lambda r: hits.append(r.url) if "/info/" in r.url or "/turn" in r.url else None)
        pg.goto(url)
        if "/r/" not in url:
            pg.click("#start")
        pg.fill("#name", name)
        pg.click("#enter")
        pg.wait_for_selector("#call:not([hidden])")
        if wait:
            pg.wait_for_function("__S.joined", timeout=15000)
        return pg

    LIVE = BASE.startswith("https://")  # the live site: the public relays, no test parameters
    Q = "" if LIVE else f"signal={WS}&relays={RELAY}"
    a = person("Ana", f"{BASE}/?{Q}")
    link = a.url.split("?")[0] + ("?" + Q if Q else "")
    check(a.evaluate("__S.isHost"), "Ana started the call: she has the host controls without the server")
    o = person("Beto", link)
    both = "__S.mesh.peers.size === {n} && [...__S.mesh.peers.values()].every(p => p.dc.readyState === 'open')"
    a.wait_for_function(both.format(n=1), timeout=20000)
    o.wait_for_function(both.format(n=1), timeout=20000)
    check(True, "Beto found Ana through the relay and they are connected")
    o.wait_for_function("[...__S.mesh.peers.values()][0].stream.getAudioTracks().length > 0", timeout=10000)
    check(True, "Beto gets Ana's sound")
    c = person("Carla", link)
    for pg in (a, o, c):
        pg.wait_for_function(both.format(n=2), timeout=20000)
    check(True, "Carla joins: three people, everyone connected to everyone")
    a.wait_for_timeout(5500)  # past the lone newcomer's server question (nobody should have asked)
    check(not any(server_hits[n] for n in ("Ana", "Beto", "Carla")), f"an ordinary call made no request to our server: {server_hits}")
    check(LIVE or len(relay_events) > 0 and all('"sdp"' not in e["content"] and "Beto" not in e["content"] for e in relay_events),
          "the relay saw only encrypted messages")

    c.click("#bLeave")
    a.wait_for_function("__S.mesh.peers.size === 1", timeout=10000)
    o.wait_for_function("__S.mesh.peers.size === 1", timeout=10000)
    check(True, "Carla leaves: Ana and Beto see her gone")

    # a passcode needs the server (only a gatekeeper can limit guesses): the call moves to it, connections stay
    # (locking, muting, co-hosts and removing work without it: hostctl_test.py)
    beto_pc = a.evaluate("[...__S.mesh.peers.values()][0].cid")
    a.evaluate("__S.mesh.host({ t: 'pass', pass: '482916' })")
    a.wait_for_function("__S.hasPass === true", timeout=15000)
    o.wait_for_function("__S.mesh.srv && __S.mesh.ws && __S.mesh.ws.readyState === 1", timeout=15000)
    check(a.evaluate("[...__S.mesh.peers.values()][0].cid") == beto_pc and a.evaluate(both.format(n=1)),
          "Ana sets a passcode: both move to the server, the connection between them stays")
    d = person("Dan", link, wait=False)
    d.wait_for_function("!__S.mesh && !document.querySelector('#lobby').hidden", timeout=20000)
    check(True, "Dan looks on the relay, is sent to the server, and is asked for the passcode")
    b.close()

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
