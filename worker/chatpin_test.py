# Pinned chat messages, like Meet's (help 'Send chat messages to video meeting participants'; Workspace update
# 'Pin chat messages in Google Meet', 2024-01): you pin and unpin your own messages, hosts may unpin anyone's; pinned
# messages sit at the top of the chat for everyone, people who join later too. A host and three others.
#   python worker/chatpin_test.py   (wrangler dev on 8798; a local Nostr relay, so no room server is used)
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
ARGS = ["--disable-gpu", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
errors = []
relay_events = []
subs = {}


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


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

MSGS = "[...document.querySelectorAll('#chatLog .msg')].map(m => ({ who: m.querySelector(':scope > b').textContent, text: m.querySelector(':scope > p').textContent, quote: m.querySelector('.quote')?.textContent || '', re: [...m.querySelectorAll('.reChip')].map(c => ({ t: c.textContent, on: c.classList.contains('on'), title: c.title })) }))"

PINS = "[...document.querySelectorAll('#chatPins .pinRow')].map(r => ({ text: r.querySelector('.pinGo span').textContent, x: !!r.querySelector('.unpin') }))"
SHOTS = os.environ.get("JUNTOS_SHOTS")

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)

    def person(name, url):
        pg = b.new_context(locale="en-US", permissions=["camera", "microphone"], viewport={"width": 1280, "height": 800}).new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror ({name}): {e}"))
        pg.goto(url)
        if "/r/" not in url:
            pg.click("#start")
        pg.fill("#name", name)
        pg.click("#enter")
        pg.wait_for_selector("#call:not([hidden])")
        pg.wait_for_function("() => __S.joined", timeout=20000)
        return pg

    def chat(pg):
        if not pg.evaluate("!!document.getElementById('chatLog')?.offsetParent"):
            pg.evaluate("document.getElementById('bChat').click()")
        pg.wait_for_function("() => !!document.getElementById('chatLog')?.offsetParent", timeout=5000)

    def msg(text):
        return f"[...document.querySelectorAll('#chatLog .msg')].find(m => m.querySelector(':scope > p').textContent === {json.dumps(text)})"

    def say(pg, text):
        pg.fill("#chatText", text)
        pg.press("#chatText", "Enter")

    def pins(pg):
        return pg.evaluate(PINS)

    def wait_pins(pg, n):
        pg.wait_for_function(f"() => document.querySelectorAll('#chatPins .pinRow').length === {n}", timeout=8000)

    def shot(pg, name):
        if SHOTS:
            os.makedirs(SHOTS, exist_ok=True)
            pg.screenshot(path=os.path.join(SHOTS, name + ".png"))

    a = person("Ana", f"{BASE}/?{Q}")  # starts the call: the host
    link = a.url.split("?")[0] + "?" + Q
    o = person("Beto", link)
    c = person("Carla", link)
    for pg in (a, o, c):
        pg.wait_for_function("() => __S.mesh.peers.size === 2 && [...__S.mesh.peers.values()].every(p => p.dc.readyState === 'open')", timeout=30000)
        chat(pg)
    check(a.is_hidden("#chatPins"), "no pinned messages: no pinned area")
    say(o, "Slides: page 12")
    say(c, "Can you hear me?")
    for pg in (a, o, c):
        pg.wait_for_function(f"() => !!({msg('Slides: page 12')}) && !!({msg('Can you hear me?')})", timeout=8000)

    # Beto pins his own message; it goes to the top of everyone's chat
    o.hover(f"#chatLog .msg >> nth=0")
    check(o.locator("#chatLog .msg").nth(0).locator("[name=pin]").count() == 1, "your own message can be pinned")
    check(o.locator("#chatLog .msg").nth(1).locator("[name=pin]").count() == 0, "someone else's can't (not a host)")
    check(a.locator("#chatLog .msg").nth(1).locator("[name=pin]").count() == 0, "a host can't pin someone else's either (like Meet)")
    o.locator("#chatLog .msg").nth(0).locator("[name=pin]").click()
    for pg in (a, o, c):
        wait_pins(pg, 1)
    check(pins(c)[0]["text"] == "Slides: page 12", f"everyone sees it pinned at the top ({pins(c)})")  # pinned: test data
    check(c.evaluate(f"!!{msg('Slides: page 12')}.querySelector('.pinMark')"), "the message itself shows a pin")
    check(not pins(c)[0]["x"] and pins(a)[0]["x"] and pins(o)[0]["x"], "unpin: offered to its author and to the host, not to others")
    shot(c, "1-pinned")

    # a forged pin or unpin from someone else is ignored
    mid = o.evaluate(f"__S.chat.find(x => x.text === 'Can you hear me?').id")
    pid = o.evaluate(f"__S.chat.find(x => x.text === 'Slides: page 12').id")
    o.evaluate(f"__S.mesh.roomcast({{ k: 'chatpin', id: {json.dumps(mid)}, on: true }})")
    c.evaluate(f"__S.mesh.roomcast({{ k: 'chatpin', id: {json.dumps(pid)}, on: false }})")
    a.wait_for_timeout(1500)
    check([x["text"] for x in pins(a)] == ["Slides: page 12"], f"pinning someone else's or unpinning it as a guest does nothing ({pins(a)})")

    # Carla pins hers too: the newest pin first
    c.hover("#chatLog .msg >> nth=1")
    c.locator("#chatLog .msg").nth(1).locator("[name=pin]").click()
    wait_pins(a, 2)
    check([x["text"] for x in pins(a)] == ["Can you hear me?", "Slides: page 12"], f"two pinned, newest first ({pins(a)})")
    shot(a, "2-two-pinned")

    # the host unpins Beto's
    a.locator("#chatPins .pinRow", has_text="Slides").locator(".unpin").click()
    for pg in (a, o, c):
        wait_pins(pg, 1)
    check(not o.evaluate(f"!!{msg('Slides: page 12')}.querySelector('.pinMark')"), "the host unpinned it for everyone")

    # tapping a pinned message shows it in the chat
    for k in range(30):
        say(o, f"filler {k}")
    a.wait_for_function(f"() => !!({msg('filler 29')})", timeout=8000)
    a.locator("#chatPins .pinGo").click()
    a.wait_for_timeout(900)
    seen = a.evaluate(f"(() => {{ const r = {msg('Can you hear me?')}.getBoundingClientRect(), l = document.getElementById('chatLog').getBoundingClientRect(); return r.top >= l.top && r.bottom <= l.bottom; }})()")
    check(seen, "tapping a pinned message scrolls the chat to it")

    # someone who joins later sees what's pinned
    d = person("Dani", link)
    chat(d)
    d.wait_for_function(f"() => !!({msg('Can you hear me?')})", timeout=15000)
    wait_pins(d, 1)
    check(pins(d)[0]["text"] == "Can you hear me?" and not pins(d)[0]["x"], f"a late joiner sees the pinned message ({pins(d)})")

    # the author unpins their own
    c.locator("#chatPins .unpin").click()
    for pg in (a, o, c, d):
        pg.wait_for_function("() => document.getElementById('chatPins').hidden", timeout=8000)
    check(True, "the author unpinned it; the pinned area goes for everyone")

    check(not [e for e in errors if e.startswith("pageerror")], "no page errors")
    b.close()

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
