# Raised hands, like Meet's ("Raise your hand in Google Meet"): People lists them in the order they went up, hosts
# lower one ("Lower hand") or all ("Lower all"), someone who isn't a host can't, and a hand goes down by itself once its
# owner has spoken a little.
#   python worker/hands_test.py   (wrangler dev on 8798; a local Nostr relay, so no room server is used)
import asyncio
import json
import sys
import threading

import websockets
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8798"
WS = BASE.replace("http", "ws", 1)
RELAY_PORT = 8816
Q = f"signal={WS}&relays=ws://127.0.0.1:{RELAY_PORT}"
# a steady tone instead of the fake microphone's short beeps: talking, as far as the app can tell
import math, os, struct, wave
TONE = os.path.join(os.environ.get("TEMP", "."), "juntos_tone.wav")
with wave.open(TONE, "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(48000)
    # voiced "syllables": a buzz whose pitch moves (120-220 Hz), 220 ms on, 60 ms off (a steady tone is removed as noise)
    out = []
    for i in range(48000 * 4):
        tt = i / 48000
        on = (tt % 0.28) < 0.22
        f0 = 120 + 100 * (0.5 + 0.5 * math.sin(2 * math.pi * 0.7 * tt))
        v = sum(math.sin(2 * math.pi * f0 * k * tt) / k for k in range(1, 9)) if on else 0.0
        out.append(struct.pack("<h", max(-32000, min(32000, int(9000 * v)))))
    w.writeframes(b"".join(out))
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required",
        f"--use-file-for-fake-audio-capture={TONE}"]
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

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)

    def person(name, url):
        pg = b.new_context(locale="en-US", permissions=["camera", "microphone"]).new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror ({name}): {e}"))
        pg.goto(url)
        if "/r/" not in url:
            pg.click("#start")
        pg.fill("#name", name)
        pg.click("#enter")
        pg.wait_for_selector("#call:not([hidden])")
        pg.wait_for_function("() => __S.joined", timeout=20000)
        return pg

    def mute(pg):
        if pg.evaluate("__S.mic"):
            pg.evaluate("document.getElementById('bMic').click()")
        pg.wait_for_function("() => !__S.mic", timeout=5000)

    def hand(pg):
        pg.evaluate("document.activeElement?.blur()")
        pg.keyboard.press("h")  # the H shortcut

    def people(pg):
        if pg.evaluate("document.getElementById('peopleList')?.offsetParent === null"):
            pg.evaluate("document.getElementById('bPeople').click()")
        pg.wait_for_selector("#peopleList", state="visible", timeout=5000)

    a = person("Ana", f"{BASE}/?{Q}")
    link = a.url.split("?")[0] + "?" + Q
    o = person("Beto", link)
    c = person("Carla", link)
    for pg in (a, o, c):
        pg.wait_for_function("() => __S.mesh.peers.size === 2 && [...__S.mesh.peers.values()].every(p => p.dc.readyState === 'open')", timeout=30000)
        mute(pg)
    ids = {n: pg.evaluate("__S.mesh.id") for n, pg in (("Ana", a), ("Beto", o), ("Carla", c))}

    hand(c)
    c.wait_for_function("() => __S.hands.has('me')", timeout=3000)
    a.wait_for_timeout(400)
    hand(o)
    a.wait_for_function(f"() => __S.hands.has('{ids['Beto']}') && __S.hands.has('{ids['Carla']}')", timeout=10000)
    people(a)
    order = a.evaluate("[...document.querySelectorAll('#peopleList .handsRow ol li span')].map(s => s.textContent)")
    check(order == ["Carla", "Beto"], f"People lists raised hands in the order they went up: {order}")  # pinned: Meet's order
    check(a.query_selector('#peopleList .handsRow [name="lowerAll"]') is not None, "the host has Lower all")
    people(o)
    check(o.query_selector('#peopleList .handsRow [name="lowerAll"]') is None
          and len(o.query_selector_all('#peopleList .handsRow [name="lowerHand"]')) == 1, "Beto (not a host) can lower only his own hand")

    # someone who isn't a host can't lower another's hand
    o.evaluate(f"__S.mesh.roomcast({{ k: 'lowerhand', id: '{ids['Carla']}' }})")
    c.wait_for_timeout(1500)
    check(c.evaluate("__S.hands.has('me')"), "a lower-hand message from someone who isn't a host is ignored")

    # the host lowers Carla's hand
    a.evaluate("[...document.querySelectorAll('#peopleList .handsRow ol li')].find(li => li.textContent.includes('Carla')).querySelector('[name=lowerHand]').click()")
    c.wait_for_function("() => !__S.hands.has('me')", timeout=8000)
    check("lowered your hand" in c.evaluate("document.getElementById('toasts').textContent"), "the host lowers Carla's hand: it goes down and she is told")
    o.wait_for_function(f"() => !__S.hands.has('{ids['Carla']}') && __S.hands.has('me')", timeout=8000)
    check(True, "everyone sees it, Beto's hand stays up")

    # Lower all
    hand(c)
    a.wait_for_function(f"() => __S.hands.has('{ids['Carla']}') && __S.hands.has('{ids['Beto']}')", timeout=8000)
    people(a)
    a.click('#peopleList .handsRow [name="lowerAll"]')
    for pg in (o, c):
        pg.wait_for_function("() => !__S.hands.has('me')", timeout=8000)
    a.wait_for_function("() => __S.hands.size === 0", timeout=8000)
    check(a.query_selector("#peopleList .handsRow") is None, "Lower all: every hand goes down and the list goes away")

    # a hand goes down after its owner speaks (the fake microphone makes sound)
    hand(o)
    a.wait_for_function(f"() => __S.hands.has('{ids['Beto']}')", timeout=8000)
    o.evaluate("document.getElementById('bMic').click()")
    try:
        o.wait_for_function("() => !__S.hands.has('me')", timeout=20000)
    except Exception:
        print("DEBUG", o.evaluate("({ mic: __S.mic, handTalk: __S.handTalk, speaking: document.querySelector('#grid .tile[data-id=me]')?.className, ac: (window.__acState || null), track: __S.micTrack ? [__S.micTrack.enabled, __S.micTrack.readyState, __S.micTrack.muted] : null })"))
        raise
    check("because you spoke" in o.evaluate("document.getElementById('toasts').textContent"), "Beto speaks: his hand goes down by itself and he is told")
    a.wait_for_function(f"() => !__S.hands.has('{ids['Beto']}')", timeout=8000)
    check(True, "and the others see it go down")
    check(not [e for e in errors if e.startswith("pageerror")], "no page errors")
    b.close()

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
