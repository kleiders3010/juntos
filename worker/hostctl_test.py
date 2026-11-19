# Host controls without our server (Kleider, 2026-11-18: "all parts of the app should work even if one the pieces
# break down"; item 36: calls must not depend on the free tier): the host's choices are a document signed with the
# host's key, which every device keeps and applies (web/hostauth.js). People find each other through a small fake
# Nostr relay on this PC (same protocol as the public ones).
# Checks: the call's code is made from the host's key; muting everyone, making a co-host, a co-host letting someone
# talk, locking the call, someone asking to join and a co-host letting them in, removing someone, refusing
# someone: all reach everyone; a document forged by a guest is ignored; a co-host can't remove the host; and
# none of it makes a single request to our server.
# Run: python hostctl_test.py [base-url]
import asyncio
import json
import sys
import threading
import time
sys.stdout.reconfigure(encoding='utf-8')
import websockets
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8797"
WS = BASE.replace("http", "ws", 1)
RELAY_PORT = 8812
RELAY = f"ws://127.0.0.1:{RELAY_PORT}"
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


# --- a minimal Nostr relay: REQ subscriptions (kinds + #x), EVENT fan-out, nothing stored ---
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
                await ws.send(json.dumps(["EOSE", d[1]]))
            elif d[0] == "EVENT":
                ev = d[1]
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
time.sleep(0.5)
hits = []  # every request to our server (websocket links, /info, /turn)

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)

    def person(name, url, wait=True):
        pg = b.new_context(locale="en-US", permissions=["camera", "microphone"]).new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror ({name}): {e}"))
        pg.on("console", lambda m: m.type == "error" and print(f"  console ({name}): {m.text}"[:300], flush=True))
        pg.on("websocket", lambda w: hits.append((name, w.url)) if w.url.startswith(WS) else None)
        pg.on("request", lambda r: hits.append((name, r.url)) if "/info/" in r.url or "/turn" in r.url else None)
        pg.goto(url)
        if "/r/" not in url:
            pg.click("#start")
        pg.fill("#name", name)
        pg.click("#enter")
        pg.wait_for_selector("#call:not([hidden])")
        if wait:
            pg.wait_for_function("__S.joined", timeout=15000)
        return pg

    Q = f"signal={WS}&relays={RELAY}"
    full = "(n) => __S.mesh && __S.mesh.peers.size === n && [...__S.mesh.peers.values()].every(p => p.dc.readyState === 'open')"

    def wait(pg, js, what, arg=None, secs=15):
        try:
            pg.wait_for_function(js, arg=arg, timeout=secs * 1000)
            check(True, what)
            return True
        except Exception:
            check(False, what)
            return False

    a = person("Ana", f"{BASE}/?{Q}")
    link = a.url.split("?")[0] + "?" + Q
    check(a.evaluate("__S.isHost && __S.isOwner && __S.mesh.selfHost"), "the call's code is made from Ana's host key: she is the host without the server")
    o = person("Beto", link)
    c = person("Carla", link)
    for pg in (a, o, c):
        pg.wait_for_function(full, arg=2, timeout=20000)
    check(True, "three people in the call")
    ida, ido, idc = (pg.evaluate("__S.mesh.id") for pg in (a, o, c))

    a.evaluate("__S.mesh.host({ t: 'talk', id: '*', on: false })")
    wait(o, "__S.perms.talk === false && !__S.mesh.hosts.has(__S.mesh.id)", "Ana mutes everyone: Beto may not talk")
    wait(c, "__S.perms.talk === false", "and neither may Carla")

    a.evaluate("(id) => __S.mesh.host({ t: 'cohost', id, on: true })", ido)
    wait(o, "__S.isHost === true && !__S.isOwner", "Ana makes Beto a co-host: Beto has the host controls")
    wait(c, "(id) => __S.mesh.hosts.has(id)", "Carla sees Beto as a co-host", ido)

    o.evaluate("(id) => __S.mesh.host({ t: 'talk', id, on: true })", idc)
    wait(c, "(id) => __S.talkOv[id] === true", "Beto (co-host) lets Carla talk: Carla may talk", idc)
    wait(a, "(id) => __S.talkOv[id] === true", "and Ana sees it", idc)

    # Carla forges a document in her own name (not the host's, not a co-host's): everyone ignores it
    c.evaluate("""async ([ana]) => { const h = await import('/hostauth.js'); const m = __S.mesh;
      const d = JSON.parse(m.hd.wire.body); d.hv += 5; d.perms.talk = true; d.out = [ana]; d.by = m.signer.pub; d.name = 'Carla';
      const w = await h.signDoc(d, m.signer.sk); m.ns.send({ t: 'hs', from: m.id, hs: w }); m.broadcast({ k: '_hs', hs: w }) }""", [ida])
    time.sleep(4)
    check(a.evaluate("!!__S.mesh && !__S.mesh.closed && __S.perms.talk === false") and o.evaluate("__S.perms.talk === false"),
          "a document Carla signed herself is ignored (nobody unmuted, Ana not removed)")

    # a co-host can't remove the host
    o.evaluate("(id) => __S.mesh.host({ t: 'remove', id })", ida)
    time.sleep(3)
    check(a.evaluate(f"!!__S.mesh && __S.mesh.peers.size === 2"), "Beto (co-host) can't remove Ana")

    # locked: a newcomer asks; a co-host lets them in
    a.evaluate("__S.mesh.host({ t: 'lock', on: true })")
    wait(c, "__S.locked === true", "Ana locks the call: everyone sees it locked")
    d = person("Dan", link, wait=False)
    wait(d, "__S.waiting === true", "Dan has to ask to join", secs=20)
    wait(a, "__S.knocks && __S.knocks.size === 1", "Ana sees Dan asking")
    wait(o, "__S.knocks && __S.knocks.size === 1", "Beto (co-host) sees Dan asking")
    check(c.evaluate("!__S.knocks || __S.knocks.size === 0"), "Carla (not a host) doesn't")
    did = d.evaluate("__S.mesh.id")
    o.evaluate("(id) => __S.mesh.host({ t: 'admit', id })", did)
    wait(d, full, "Beto lets Dan in: Dan is connected to everyone", arg=3, secs=25)
    wait(a, "__S.knocks.size === 0", "and Ana's 'asking to join' list is empty again")
    check(d.evaluate("__S.perms.talk === false && __S.locked === true"), "Dan gets the call's choices (muted, locked)")

    # removing someone
    a.evaluate("(id) => __S.mesh.host({ t: 'remove', id })", idc)
    wait(c, "!__S.mesh", "Ana removes Carla: Carla is out of the call")
    for pg, nm in ((a, "Ana"), (o, "Beto"), (d, "Dan")):
        wait(pg, full, f"{nm} no longer has Carla", arg=2)

    # refusing someone
    e = person("Eve", link, wait=False)
    wait(e, "__S.waiting === true", "Eve has to ask to join", secs=20)
    a.wait_for_function("__S.knocks.size === 1", timeout=15000)
    eid = e.evaluate("__S.mesh.id")
    a.evaluate("(id) => __S.mesh.host({ t: 'deny', id })", eid)
    wait(e, "!__S.mesh", "Ana says no: Eve is told and leaves")
    check(all(pg.evaluate("__S.mesh.peers.size === 2") for pg in (a, o, d)), "nobody else is disturbed")

    # the host drops out and comes back (a new id, same device key): straight in, host again, the choices kept
    code = a.evaluate("__S.code")
    key = a.evaluate("localStorage.getItem('juntos.host.' + __S.code)")
    a.context.close()
    wait(o, full, "Ana's device is gone: Beto and Dan stay", arg=1, secs=30)
    a2 = b.new_context(locale="en-US", permissions=["camera", "microphone"]).new_page()
    a2.on("pageerror", lambda e: errors.append(f"pageerror (Ana again): {e}"))
    a2.on("websocket", lambda w: hits.append(("Ana again", w.url)) if w.url.startswith(WS) else None)
    a2.goto(f"{BASE}/")
    a2.evaluate("([c, k]) => localStorage.setItem('juntos.host.' + c, k)", [code, key])
    a2.goto(link)
    a2.fill("#name", "Ana")
    a2.click("#enter")
    wait(a2, full, "Ana comes back to the locked call: straight in, without asking", arg=2, secs=25)
    wait(a2, "__S.isHost && __S.isOwner && __S.locked === true && __S.perms.talk === false", "she is the host again and the call's choices are kept")
    ida2 = a2.evaluate("__S.mesh.id")
    wait(d, "(id) => __S.mesh.owners.has(id)", "Dan sees the new Ana as the host", ida2)
    a2.evaluate("__S.mesh.host({ t: 'lock', on: false })")
    wait(d, "__S.locked === false", "her next choice (unlock) reaches everyone")

    check(not hits, f"none of it made a request to our server: {hits[:4]}")
    b.close()

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
