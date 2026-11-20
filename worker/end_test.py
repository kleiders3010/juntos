# End the call for everyone, like Meet's (help 11989526; Workspace update 2021-02 "End meeting for all"): a host or
# co-host pressing Leave chooses "End the call for everyone" or "Just leave the call"; someone else's Leave just
# leaves. Ending sends everyone out (the host too) with "<name> ended the call for everyone" and nothing to rejoin.
# Both ways a call can run: through the room server (?signal= only) and without it (the host's signed document,
# through a small fake Nostr relay on this PC). Without the server, the relays replay the old "ended" document to
# whoever comes later: that must not send a new call on the same code out.
# Run: python end_test.py [base-url]
import asyncio
import json
import os
import sys
import threading
import time
sys.stdout.reconfigure(encoding='utf-8')
import websockets
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8797"
WS = os.environ.get("JUNTOS_SIGNAL") or BASE.replace("http", "ws", 1)
RELAY_PORT = 8814
RELAY = f"ws://127.0.0.1:{RELAY_PORT}"
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


# --- a minimal Nostr relay (as in hostctl_test.py): subscriptions by kind and #x, fan-out, recent events replayed ---
subs = {}
stored = []


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
    except websockets.ConnectionClosed:
        pass  # a page that left mid-send
    finally:
        subs.pop(ws, None)


def run_relay():
    async def main():
        async with websockets.serve(relay_conn, "127.0.0.1", RELAY_PORT, max_size=2**20):
            await asyncio.Future()
    asyncio.run(main())


threading.Thread(target=run_relay, daemon=True).start()
time.sleep(0.5)
full = "(n) => __S.mesh && __S.mesh.peers.size === n && [...__S.mesh.peers.values()].every(p => p.dc.readyState === 'open')"
ended = "() => !__S.mesh && !document.getElementById('ended').hidden"

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)

    def person(name, url, ctx=None):
        pg = (ctx or b.new_context(locale="en-US", permissions=["camera", "microphone"])).new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror ({name}): {e}"))
        pg.goto(url)
        if "/r/" not in url and pg.query_selector("#start:visible"):
            pg.click("#start")
        pg.fill("#name", name)
        pg.click("#enter")
        pg.wait_for_selector("#call:not([hidden])")
        pg.wait_for_function("__S.joined", timeout=15000)
        return pg

    def wait(pg, js, what, arg=None, secs=20):
        try:
            pg.wait_for_function(js, arg=arg, timeout=secs * 1000)
            check(True, what)
            return True
        except Exception:
            check(False, what)
            return False

    def leave_btn(pg):
        pg.click("#bLeave")

    def ended_text(pg):
        return pg.evaluate("[document.getElementById('endedTitle').textContent, document.getElementById('endedMsg').textContent, document.getElementById('rejoin').hidden]")

    for mode in ("server", "serverless"):
        print(f"--- {mode} ---", flush=True)
        q = f"signal={WS}" + ("" if mode == "server" else f"&relays={RELAY}")
        a = person("Ana", f"{BASE}/?{q}")
        link = a.url.split("?")[0] + "?" + q
        o = person("Beto", link)
        c = person("Carla", link)
        d = person("Dan", link)
        for pg in (a, o, c, d):
            pg.wait_for_function(full, arg=3, timeout=30000)
        check(True, "four people in the call")
        check(a.evaluate("__S.mesh.srv ? 'server' : 'serverless'") == mode, f"the call runs {mode}")

        # someone who isn't a host: Leave just leaves
        leave_btn(d)
        wait(d, ended, "Dan (not a host) presses Leave: he is out at once, no choice to make")
        t = ended_text(d)
        check(t[2] is False, f"and can rejoin ({t})")
        wait(a, full, "the others stay: Ana has Beto and Carla", arg=2)

        ido = o.evaluate("__S.mesh.id")
        a.evaluate("(id) => __S.mesh.host({ t: 'cohost', id, on: true })", ido)
        wait(o, "__S.isHost === true", "Ana makes Beto a co-host")

        # the host: a choice; Just leave keeps the call going
        leave_btn(a)
        wait(a, "!!document.getElementById('leaveSheet')", "Ana (host) presses Leave: End the call for everyone / Just leave the call")
        check(a.evaluate("!!document.getElementById('endAll') && !!document.getElementById('justLeave')"), "both choices are there")
        a.click("#justLeave")
        wait(a, ended, "Ana picks Just leave the call: she is out")
        wait(o, full, "Beto and Carla are still in the call together", arg=1)
        check(c.evaluate("!!__S.mesh"), "Carla too")

        # a co-host ends it for everyone
        leave_btn(o)
        wait(o, "!!document.getElementById('leaveSheet')", "Beto (co-host) gets the same choice")
        c.click("#bMore")  # Carla has a sheet open when it ends
        o.click("#endAll")
        wait(c, ended, "Beto ends the call for everyone: Carla is out")
        check(c.evaluate("!document.querySelector('.sheet')"), "and the sheet she had open went with the call")
        tc = ended_text(c)
        check("Beto" in tc[1] and tc[2] is True, f"Carla reads that Beto ended it, nothing to rejoin ({tc})")
        wait(o, ended, "and Beto is out too")
        to = ended_text(o)
        check(to[1] and "Beto" not in to[1] and to[2] is True, f"Beto reads that he ended it ({to})")

        if mode == "serverless":
            # the same code used again later (Ana comes back with her host key): the relays replay the old "ended"
            # document to the people who come now; it must not send them out
            code = a.evaluate("__S.code")
            a2 = person("Ana", link, ctx=a.context)
            e = person("Eve", link)
            wait(e, full, "later, on the same code, Ana starts again and Eve joins", arg=1, secs=30)
            time.sleep(6)
            check(a2.evaluate("!!__S.mesh") and e.evaluate("!!__S.mesh") and e.evaluate("__S.mesh.peers.size === 1"),
                  "the old end replayed by the relays sends nobody out")
            a2.context.close()
            e.context.close()
        for pg in (a, o, c, d):
            if not pg.is_closed():
                pg.context.close()
    b.close()

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
