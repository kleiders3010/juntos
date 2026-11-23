# Pins, like Meet's ("Pin or mute Google Meet participants"): pin several people for yourself (they share the big
# space), Esc unpins; a host pins someone for everyone, newcomers get it too, and nobody else can.
#   python worker/pins_test.py   (wrangler dev on 8798; a local Nostr relay)
import os
import asyncio
import json
import sys
import threading

import websockets
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8798"
WS = BASE.replace("http", "ws", 1)
RELAY_PORT = 8817
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
ARGS = ["--disable-gpu", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required",
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

SHOT = os.path.join(os.environ.get("TEMP", "."), "juntos_pins.png")
SPOTS = "() => [...document.querySelectorAll('#grid .tile.spot')].map(x => x.dataset.id)"
PINALL = "(n) => [...document.querySelectorAll('#peopleList li')].find(li => li.textContent.includes(n) && li.querySelector('[name=pinAll]')).querySelector('[name=pinAll]').click()"

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)

    def person(name, url):
        pg = b.new_context(locale="en-US", permissions=["camera", "microphone"], viewport={"width": 1280, "height": 720}).new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror ({name}): {e}"))
        pg.goto(url)
        if "/r/" not in url:
            pg.click("#start")
        pg.fill("#name", name)
        pg.click("#enter")
        pg.wait_for_selector("#call:not([hidden])")
        pg.wait_for_function("() => __S.joined", timeout=20000)
        return pg

    def people(pg):
        if pg.evaluate("document.getElementById('peopleList')?.offsetParent === null"):
            pg.evaluate("document.getElementById('bPeople').click()")
        pg.wait_for_selector("#peopleList", state="visible", timeout=5000)

    def pin_btn(pg, id):
        pg.evaluate("(id) => document.querySelector(`#grid .tile[data-id='${id}'] .fsBtn`).click()", id)

    def spots(pg):
        return pg.evaluate(SPOTS)

    a = person("Ana", f"{BASE}/?{Q}")
    link = a.url.split("?")[0] + "?" + Q
    o = person("Beto", link)
    c = person("Carla", link)
    d = person("Dan", link)
    for pg in (a, o, c, d):
        pg.wait_for_function("() => __S.mesh.peers.size === 3 && [...__S.mesh.peers.values()].every(p => p.dc.readyState === 'open')", timeout=30000)
    ids = {n: pg.evaluate("__S.mesh.id") for n, pg in (("Ana", a), ("Beto", o), ("Carla", c), ("Dan", d))}

    pin_btn(a, ids["Beto"])
    check(spots(a) == [ids["Beto"]], "Ana pins Beto: his picture is big")
    pin_btn(a, ids["Carla"])
    a.wait_for_timeout(300)
    boxes = a.evaluate("[...document.querySelectorAll('#grid .tile.spot')].map(x => { const r = x.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; })")
    check(sorted(spots(a)) == sorted([ids["Beto"], ids["Carla"]]), "she pins Carla too: both are pinned")
    check(len(boxes) == 2 and abs(boxes[0][2] - boxes[1][2]) < 4 and boxes[0][0] + boxes[0][2] <= boxes[1][0] and min(bx[2] for bx in boxes) > 300,
          f"they share the big space side by side: {boxes}")
    a.screenshot(path=SHOT)
    others = a.evaluate("[...document.querySelectorAll('#grid .tile:not(.spot):not(.off)')].map(x => Math.round(x.getBoundingClientRect().width))")
    check(all(w < 200 for w in others), f"the others stay small on the side: {others}")
    check(spots(o) == [], "only on Ana's screen")
    pin_btn(a, ids["Beto"])
    check(spots(a) == [ids["Carla"]], "the button on a pinned one unpins it")
    a.evaluate("document.activeElement?.blur()")
    a.keyboard.press("Escape")
    check(spots(a) == [], "Esc unpins everyone")

    # a host pins Dan for everyone
    people(a)
    a.evaluate(PINALL, "Dan")
    for pg in (o, c):
        pg.wait_for_function("(id) => [...document.querySelectorAll('#grid .tile.spot')].some(x => x.dataset.id === id)", arg=ids["Dan"], timeout=8000)
    check("pinned Dan for everyone" in o.evaluate("document.getElementById('toasts').textContent"), "the host pins Dan for everyone: Beto and Carla see him big and are told")
    d.wait_for_function("() => !!document.querySelector('#grid .tile.spot[data-id=me]')", timeout=8000)
    check(True, "Dan sees himself pinned")
    people(o)
    check(o.query_selector("#peopleList [name=pinAll]") is None, "Beto (not a host) has no Pin for everyone")
    o.evaluate("(id) => __S.mesh.roomcast({ k: 'pinall', ids: [id] })", ids["Carla"])
    a.wait_for_timeout(1500)
    check(spots(c) == [ids["Dan"]] and spots(a) == [ids["Dan"]], "a pin-for-everyone message from someone who isn't a host is ignored")
    e = person("Eva", link)
    e.wait_for_function("(id) => [...document.querySelectorAll('#grid .tile.spot')].some(x => x.dataset.id === id)", arg=ids["Dan"], timeout=20000)
    check(True, "Eva comes in later and sees Dan pinned too")
    a.evaluate(PINALL, "Dan")
    o.wait_for_function("(id) => ![...document.querySelectorAll('#grid .tile.spot')].some(x => x.dataset.id === id)", arg=ids["Dan"], timeout=8000)
    check(True, "unpinned for everyone: back to normal")
    check(not [x for x in errors if x.startswith("pageerror")], "no page errors")
    print("screenshot:", SHOT)
    b.close()

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
