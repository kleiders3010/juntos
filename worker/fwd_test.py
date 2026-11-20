# Two people who can't connect to each other (strict routers on both sides, no relay): someone connected to both
# passes their sound, video and messages on (web/fwd.js), the messages sealed so the helper can't read them; when the
# helper leaves, another one takes over. No server needed: the call runs on a local Nostr relay.
#   python worker/fwd_test.py            (wrangler dev on 8797 serves the page; no TURN key there, so no relay)
import asyncio
import json
import sys
import threading

import websockets
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8797"
WS = BASE.replace("http", "ws", 1)
RELAY_PORT = 8815
Q = f"signal={WS}&relays=ws://127.0.0.1:{RELAY_PORT}"
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
errors = []
relay_events = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


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


threading.Thread(target=run_relay, daemon=True).start()

# every message a page receives, and every string it sends on a data channel (to see what a helper could read)
SPY = """
window.__juntosNoDirect = %s;
window.__dcOut = [];
const _send = RTCDataChannel.prototype.send;
RTCDataChannel.prototype.send = function (d) { if (typeof d === 'string') window.__dcOut.push(d); return _send.call(this, d); };
"""

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)

    def person(name, url, blocked):
        ctx = b.new_context(locale="en-US", permissions=["camera", "microphone"])
        ctx.add_init_script(SPY % json.dumps(blocked))
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror ({name}): {e}"))
        pg.goto(url)
        if "/r/" not in url:
            pg.click("#start")
        pg.fill("#name", name)
        pg.click("#enter")
        pg.wait_for_selector("#call:not([hidden])")
        pg.wait_for_function("__S.joined", timeout=20000)
        pg.evaluate("""() => { window.__got = []; const m = __S.mesh, o = m.emit.bind(m);
            m.emit = (t, d) => { if (t === 'message') window.__got.push({ from: d.from, msg: d.msg }); return o(t, d); }; }""")
        return pg

    a = person("Ana", f"{BASE}/?{Q}", ["Beto"])
    link = a.url.split("?")[0] + "?" + Q
    c = person("Carla", link, [])
    d = person("Dan", link, [])
    o = person("Beto", link, ["Ana"])
    ids = {n: pg.evaluate("__S.mesh.id") for n, pg in (("Ana", a), ("Beto", o), ("Carla", c), ("Dan", d))}
    direct = "(id) => { const p = __S.mesh.peers.get(id); return !!p && !p.via && p.state === 'connected' && p.dc.readyState === 'open'; }"
    for pg, others in ((a, ("Carla", "Dan")), (o, ("Carla", "Dan")), (c, ("Ana", "Beto", "Dan"))):
        for n in others:
            pg.wait_for_function(f"({direct})('{ids[n]}')", timeout=30000)
    check(True, "Carla and Dan connect to everyone; Ana and Beto can't connect to each other")

    via = "([id, h]) => { const p = __S.mesh.peers.get(id); return !!p && (h ? p.via === h : !!p.via); }"
    a.wait_for_function(f"({via})(['{ids['Beto']}', null])", timeout=90000)
    o.wait_for_function(f"({via})(['{ids['Ana']}', null])", timeout=20000)
    helper = a.evaluate(f"__S.mesh.peers.get('{ids['Beto']}').via")
    hname = [n for n, i in ids.items() if i == helper][0]
    check(o.evaluate(f"__S.mesh.peers.get('{ids['Ana']}').via") == helper, f"no direct way: {hname} passes things on between Ana and Beto")

    live = "(id) => { const p = __S.mesh.peers.get(id); const ts = p ? p.stream.getTracks() : []; return ts.some(t => t.kind === 'audio' && t.readyState === 'live' && !t.muted) && ts.some(t => t.kind === 'video' && t.readyState === 'live' && !t.muted); }"
    a.wait_for_function(f"({live})('{ids['Beto']}')", timeout=20000)
    o.wait_for_function(f"({live})('{ids['Ana']}')", timeout=20000)
    check(True, "Ana gets Beto's sound and video, and Beto gets Ana's, through the helper")
    # the picture really moves: frames arrive on the forwarded video
    fr = "async (id) => { const t = __S.mesh.peers.get(id).stream.getVideoTracks()[0]; const v = document.createElement('video'); v.muted = true; v.srcObject = new MediaStream([t]); await v.play().catch(() => {}); await new Promise(r => setTimeout(r, 1500)); return v.videoWidth; }"
    check(a.evaluate(fr, ids["Beto"]) > 0, "Beto's forwarded picture has frames at Ana's")

    a.evaluate(f"__S.mesh.sendTo('{ids['Beto']}', {{ k: 'fwdtest', text: 'pineapple-42' }})")
    o.wait_for_function(f"__got.some(g => g.from === '{ids['Ana']}' && g.msg.k === 'fwdtest' && g.msg.text === 'pineapple-42')", timeout=15000)
    check(True, "a private message from Ana reaches Beto through the helper")
    o.evaluate(f"__S.mesh.sendTo('{ids['Ana']}', {{ k: 'fwdtest', text: 'mango-7' }})")
    a.wait_for_function(f"__got.some(g => g.from === '{ids['Beto']}' && g.msg.text === 'mango-7')", timeout=15000)
    check(True, "and Beto's answer reaches Ana")
    hp = c if hname == "Carla" else d
    seen = hp.evaluate("JSON.stringify(__got) + __dcOut.join('')")
    check("pineapple-42" not in seen and "mango-7" not in seen, f"the helper ({hname}) passed them on without being able to read them")
    check(hp.evaluate("__S.mesh.fwd.stats.helped") >= 1 and o.evaluate("__S.mesh.fwd.stats.unreadable") == 0, "sealed on the way, opened only at the other end")

    # the helper leaves: the other one takes over
    hp.click("#bLeave"); hp.query_selector("#justLeave") and hp.click("#justLeave")  # a host is asked: just leave
    other = "Dan" if hname == "Carla" else "Carla"
    a.wait_for_function(f"({via})(['{ids['Beto']}', '{ids[other]}'])", timeout=90000)
    o.wait_for_function(f"({via})(['{ids['Ana']}', '{ids[other]}'])", timeout=30000)
    a.wait_for_function(f"({live})('{ids['Beto']}')", timeout=20000)
    check(True, f"{hname} leaves: {other} takes over, Ana and Beto still see and hear each other")
    a.evaluate(f"__S.mesh.sendTo('{ids['Beto']}', {{ k: 'fwdtest', text: 'kiwi-3' }})")
    o.wait_for_function("__got.some(g => g.msg.text === 'kiwi-3')", timeout=15000)
    check(True, "messages go through the new helper")
    check(not [e for e in errors if e.startswith("pageerror")], "no page errors")
    b.close()

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
