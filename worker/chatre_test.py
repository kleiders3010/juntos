# Reactions and quoted replies in chat, like Meet's chat (Google Chat help "Reply to a message"; Workspace update
# "React to messages quickly in Google Chat"): point at a message for quick reactions and "Quote in reply"; reactions
# show under the message with a count, yours highlighted, tap to take yours back, pointing says who; the author hears
# of a reaction while chat is closed; a quote keeps the original words; a late joiner gets it all, names right, no
# doubles; Escape drops a reply; a reaction from someone the host stopped from chatting is ignored.
#   python worker/chatre_test.py   (wrangler dev on 8798; a local Nostr relay, so no room server is used)
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
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
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

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)

    def person(name, url, n_before):
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

    def chat(pg, on=True):
        shown = pg.evaluate("!!document.getElementById('chatLog')?.offsetParent")
        if shown != on:
            pg.evaluate("document.getElementById('bChat').click()")
        pg.wait_for_function("() => !!document.getElementById('chatLog')?.offsetParent === " + ("true" if on else "false"), timeout=5000)

    def msgs(pg):
        return pg.evaluate(MSGS)

    def msg(pg, text):
        return f"[...document.querySelectorAll('#chatLog .msg')].find(m => m.querySelector(':scope > p').textContent === {json.dumps(text)})"

    a = person("Ana", f"{BASE}/?{Q}", 0)
    link = a.url.split("?")[0] + "?" + Q
    o = person("Beto", link, 1)
    c = person("Carla", link, 2)
    for pg in (a, o, c):
        pg.wait_for_function("() => __S.mesh.peers.size === 2 && [...__S.mesh.peers.values()].every(p => p.dc.readyState === 'open')", timeout=30000)

    chat(a)
    a.fill("#chatText", "Hello everyone")
    a.press("#chatText", "Enter")
    for pg in (o, c):
        chat(pg)
        pg.wait_for_function(f"() => !!({msg(pg, 'Hello everyone')})", timeout=8000)
    chat(a, False)

    # Beto points at the message: quick reactions and Quote in reply show
    box = o.locator("#chatLog .msg").first
    box.hover()
    o.wait_for_timeout(200)
    vis = o.evaluate(f"getComputedStyle({msg(o, 'Hello everyone')}.querySelector('.msgAct')).display")
    check(vis == "flex", f"pointing at a message shows its actions ({vis})")  # pinned: the actions show on pointing, like Chat
    quick = o.evaluate(f"[...{msg(o, 'Hello everyone')}.querySelectorAll('.reQuick')].map(b => b.textContent)")
    check(len(quick) == 6, f"quick reactions: {quick}")  # pinned: six quick ones, like the call's reaction bar
    o.click("#chatLog .msg .reQuick >> nth=0")
    first = quick[0]
    a.wait_for_function(f"() => {msg(a, 'Hello everyone')}?.querySelector('.reChip')?.textContent === '{first} 1'", timeout=8000)
    m = msgs(a)[0]["re"][0]
    check(m["title"] == "Beto" and not m["on"], f"Ana sees Beto's reaction with his name on it: {m}")  # pinned: test data, who reacted
    check(f"Beto reacted {first} to your message" in a.evaluate("document.getElementById('toasts').textContent"), "Ana, chat closed, is told of the reaction")
    check(msgs(o)[0]["re"][0]["on"], "Beto's own reaction is highlighted for him")

    # Carla adds the same one, then takes it back
    c.click(f"#chatLog .msg .reChip >> nth=0")
    for pg in (a, o):
        pg.wait_for_function(f"() => {msg(pg, 'Hello everyone')}?.querySelector('.reChip')?.textContent === '{first} 2'", timeout=8000)
    check(True, "Carla taps the reaction: 2 for everyone")
    t = msgs(a)[0]["re"][0]["title"]
    check("Beto" in t and "Carla" in t, f"pointing says who: {t}")
    c.click(f"#chatLog .msg .reChip >> nth=0")
    a.wait_for_function(f"() => {msg(a, 'Hello everyone')}?.querySelector('.reChip')?.textContent === '{first} 1'", timeout=8000)
    check(not msgs(c)[0]["re"][0]["on"], "Carla taps it again: hers is taken back")

    # more emoji
    c.locator("#chatLog .msg").first.hover()
    c.click("#chatLog .msg [name=reMore]")
    c.click("#chatLog .msg .reGrid button:has-text('🔥')")
    o.wait_for_function(f"() => [...{msg(o, 'Hello everyone')}.querySelectorAll('.reChip')].some(c => c.textContent === '🔥 1')", timeout=8000)
    check(True, "an emoji from More reaches everyone")
    check(c.evaluate("JSON.parse(localStorage['juntos.chatEmoji'])['🔥']") == 1, "what you use is counted for your quick reactions")

    # Beto quotes Ana's message in his reply
    o.locator("#chatLog .msg").first.hover()
    o.click("#chatLog .msg [name=quote]")
    check(o.is_visible("#chatQuote") and "Replying to Ana" in o.text_content("#chatQuote"), "Quote in reply: the box says who you reply to")
    o.press("#chatText", "Escape")
    check(not o.is_visible("#chatQuote"), "Escape drops the reply")
    o.locator("#chatLog .msg").first.hover()
    o.click("#chatLog .msg [name=quote]")
    o.fill("#chatText", "Hi Ana!")
    o.press("#chatText", "Enter")
    a.wait_for_function(f"() => !!({msg(a, 'Hi Ana!')})", timeout=8000)
    chat(a)
    m = [x for x in msgs(a) if x["text"] == "Hi Ana!"][0]
    check(m["quote"] == "AnaHello everyone" and m["who"] == "Beto", f"everyone sees the quote with the original words: {m}")  # pinned: test data, a quote keeps the words
    check(not o.is_visible("#chatQuote"), "after sending, the reply box goes")

    # a late joiner gets everything: names right, reactions, quotes, no doubles
    d = person("Dani", link, 3)
    chat(d)
    d.wait_for_function("() => document.querySelectorAll('#chatLog .msg').length >= 2", timeout=15000)
    d.wait_for_timeout(1500)
    ms = msgs(d)
    check(len(ms) == 2, f"no message twice ({len(ms)}: {[x['text'] for x in ms]})")
    check([x["who"] for x in ms] == ["Ana", "Beto"], f"the newcomer sees who wrote each, not 'You': {[x['who'] for x in ms]}")
    res = sorted(r["t"] for r in ms[0]["re"])
    check(res == sorted([f"{first} 1", "🔥 1"]), f"the newcomer sees the reactions: {res}")
    check(ms[1]["quote"] == "AnaHello everyone", "and the quote")  # pinned: test data
    d.click(f"#chatLog .msg .reChip >> nth=0")
    a.wait_for_function(f"() => [...{msg(a, 'Hello everyone')}.querySelectorAll('.reChip')].some(c => c.textContent === '{first} 2')", timeout=8000)
    check(True, "the newcomer's reaction reaches everyone")

    # someone the host stopped from chatting can't react either
    a.evaluate("document.getElementById('bPeople').click()")
    o.evaluate("window.__fake = 1")
    did = a.evaluate("""() => { const b = [...document.querySelectorAll('#peopleList button, #peopleList input')].find(x => /chat/i.test(x.textContent + (x.title||'') + (x.name||'') + (x.closest('label')?.textContent||''))); if (!b) return false; b.click(); return true; }""")
    if did:
        o.wait_for_function("() => document.getElementById('chatText').disabled", timeout=8000)
        o.evaluate(f"__S.mesh.roomcast({{ k: 'chatre', id: __S.chat[0].id, e: '🚀', on: true }})")
        a.wait_for_timeout(1500)
        check(not any(r["t"].startswith("🚀") for r in msgs(a)[0]["re"]), "a reaction sent while chat is off for you is ignored")
    else:
        print("note: no chat switch found in People for the host; skipped the chat-off check")

    check(not [e for e in errors if e.startswith("pageerror")], "no page errors")
    b.close()

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
