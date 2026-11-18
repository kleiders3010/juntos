# Roles and permissions like Meet and Zoom (Kleider, 2026-11-18: "host controls like Meet/Zoom ... co-hosts,
# permissions (who may share screen, chat, unmute themselves, use captions), all enforced by the room server";
# polls: "the default permission level is a bit too high"). Studied: Meet "Grant host controls" (co-hosts),
# host management locks (chat, present, audio), polls started by hosts; Zoom: a host never unmutes anyone.
# The host makes a co-host, who gets the controls except making co-hosts or removing the host; turns off chat,
# screen sharing and captions for everyone (hosts still may; whatever a device sends anyway isn't shown); who
# starts polls: hosts only by default, everyone, or everyone with a host approving each.
# Run: python roles_test.py [base-url]
import sys
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8797"
WS = BASE.replace("http", "ws", 1)
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
TOASTS = "document.getElementById('toasts').textContent"
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


def pane(pg, btn, sel):
    pg.evaluate(f"(() => {{ if (!document.getElementById('{btn}')) document.getElementById('bMore')?.click(); document.getElementById('{btn}').click() }})()")
    pg.wait_for_selector(sel)


def people(pg):
    if not pg.evaluate("!!document.getElementById('peoplePane')?.offsetParent"):
        pane(pg, "bPeople", "#peopleList li")


def row(name):
    return f"[...document.querySelectorAll('.person')].find(e => e.textContent.includes('{name}'))"


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
        pg.wait_for_function("__S.joined", timeout=15000)
        return pg

    a = person("Ana", f"{BASE}/?signal={WS}")
    join = f"{a.url}{'&' if '?' in a.url else '?'}signal={WS}"
    o = person("Beto", join)
    c = person("Caro", join)
    for pg in (a, o, c):
        pg.wait_for_function("__S.mesh.peers.size === 2 && [...__S.mesh.peers.values()].every(p => p.dc && p.dc.readyState === 'open')", timeout=30000)
    caro = a.evaluate("[...__S.mesh.peers.values()].find(p => p.name === 'Caro').id")
    ana = o.evaluate("[...__S.mesh.peers.values()].find(p => p.name === 'Ana').id")

    # everyone sees who hosts
    people(c)
    check("Host: Ana" in c.evaluate("document.querySelector('.hostLine')?.textContent || ''"), "Caro's People says who hosts the call")

    # the host makes Beto a co-host
    people(a)
    a.click(".person:has-text('Beto') .coBtn")
    o.wait_for_function("__S.isHost", timeout=5000)
    check("made you a co-host" in o.evaluate(TOASTS), "Beto becomes a co-host and is told")
    c.wait_for_function(f"({row('Beto')})?.textContent.includes('Co-host')", timeout=5000)
    check(True, "everyone sees Beto marked as co-host")
    people(o)
    o.wait_for_selector("input[name='perm-chat']")
    check(not o.query_selector(".coBtn"), "a co-host can't make co-hosts")
    check(not o.evaluate(f"!!({row('Ana')})?.querySelector('.sure, .chip')"), "nor remove or silence the host")
    o.evaluate(f"__S.mesh.host({{ t: 'cohost', id: '{caro}', on: true }})")
    a.wait_for_timeout(800)
    check(not c.evaluate("__S.isHost"), "and his made-up co-host command does nothing")
    o.click(".person:has-text('Caro') .talkBtn")
    c.wait_for_function("!__S.micTrack.enabled", timeout=5000)
    check(c.evaluate("__S.mic"), "the co-host can stop Caro speaking (her own mic switch stays on)")
    o.click(".person:has-text('Caro') .talkBtn")
    c.wait_for_function("__S.micTrack.enabled", timeout=5000)

    # what everyone may do: chat, screen sharing, captions (hosts and co-hosts still may)
    a.uncheck("input[name='perm-chat']")
    c.wait_for_function("document.getElementById('chatText').disabled", timeout=5000)
    check("turned off chat" in c.evaluate(TOASTS), "chat off: Caro's message box is off and she's told")
    a.wait_for_function("__S.perms.chat === false", timeout=5000)  # Ana has the setting too (the server tells everyone)
    c.evaluate("__S.mesh.roomcast({ k: 'chat', text: 'sneaky' })")
    o.evaluate("__S.mesh.roomcast({ k: 'chat', text: 'from the co-host' })")
    a.wait_for_function("__S.chat.some(m => m.text === 'from the co-host')", timeout=5000)
    check(not a.evaluate("__S.chat.some(m => m.text === 'sneaky')"), "a message her device sends anyway isn't shown; the co-host's is")  # pinned: text the test itself sent
    a.check("input[name='perm-chat']")
    c.wait_for_function("!document.getElementById('chatText').disabled", timeout=5000)

    a.uncheck("input[name='perm-share']")
    c.wait_for_function("__S.perms.share === false", timeout=5000)
    c.evaluate("document.getElementById('bScreen')?.click() || (() => { document.getElementById('bMore')?.click(); document.getElementById('bScreen')?.click() })()")
    c.wait_for_timeout(300)
    check(not c.evaluate("!!__S.screen") and "turned off screen sharing" in c.evaluate(TOASTS), "screen sharing off: Caro can't share, she's told")

    a.uncheck("input[name='perm-caps']")
    c.wait_for_function("__S.perms.caps === false", timeout=5000)
    c.evaluate("document.getElementById('bCaps') || document.getElementById('bMore')?.click()")
    c.evaluate("document.getElementById('bCaps').click()")
    c.wait_for_selector(".capSheet")
    c.check('input[name="caps"]')
    c.click(".capSheet .primary")
    c.wait_for_timeout(300)
    check(not c.evaluate("__S.capsOn") and "turned off captions" in c.evaluate(TOASTS), "captions off: Caro can't turn them on")
    o.evaluate("document.getElementById('bCaps') || document.getElementById('bMore')?.click()")
    o.evaluate("document.getElementById('bCaps').click()")
    o.wait_for_selector(".capSheet")
    o.check('input[name="caps"]')
    o.click(".capSheet .primary")
    check(o.evaluate("__S.capsOn"), "the co-host still can")
    a.check("input[name='perm-caps']")
    a.check("input[name='perm-share']")

    # a co-host stays one after a dropped connection
    o.evaluate("window.__oldWs = __S.mesh.ws; __S.mesh.ws.close()")
    o.wait_for_function("__S.mesh.ws !== window.__oldWs && __S.mesh.ws.readyState === 1", timeout=40000)  # the closing handshake takes a while
    o.wait_for_timeout(1000)
    check(o.evaluate("__S.isHost") and c.evaluate(f"({row('Beto')})?.textContent.includes('Co-host')"), "Beto is still co-host after his connection drops and comes back")
    a.wait_for_timeout(3000)
    check(c.evaluate("[...__S.mesh.peers.values()].some(p => p.name === 'Beto' && p.state === 'connected' && !p.away)"),
          "and his link to the server dropping didn't drop him from the call")

    # the host takes the co-host controls back
    people(a)
    a.click(".person:has-text('Beto') .coBtn")
    o.wait_for_function("!__S.isHost", timeout=5000)
    check("took back" in o.evaluate(TOASTS), "the host takes back Beto's co-host controls")

    # polls: only hosts start them by default
    pane(c, "bAct", "#actPolls")
    check(c.evaluate("document.getElementById('pollStart').hidden") and "Only hosts" in c.evaluate("document.getElementById('pollOff').textContent"),
          "by default only hosts start polls: Caro has no 'Start a poll'")
    c.evaluate("""__S.mesh.broadcast({ k: 'act', item: { id: 'forged1', at: Date.now(), ver: Date.now(), lock: 'x', type: 'poll', q: 'Forged?', opts: ['a', 'b'], approved: true } })""")
    a.wait_for_timeout(600)
    check(not a.evaluate("[...__S.act.items.values()].some(x => x.q === 'Forged?')"), "a poll her device sends anyway isn't taken")  # pinned: text the test itself sent

    # the host lets everyone start polls, a host approving each first
    pane(a, "bAct", "#actPolls")
    a.select_option("select[name='pollWho']", "approve")
    c.wait_for_function("!document.getElementById('pollStart').hidden", timeout=5000)
    c.click("#pollStart")
    c.fill("#pollDraft input[name='q']", "Pizza or tacos?")
    opts = c.query_selector_all("#pollDraft .pollOpts input")
    opts[0].fill("Pizza")
    opts[1].fill("Tacos")
    c.click("#pollDraft .primary")
    a.wait_for_function("[...document.querySelectorAll('#pollList .actCard')].some(e => e.textContent.includes('Pizza or tacos?') && e.textContent.includes('Pending approval'))", timeout=5000)
    check("waiting for your approval" in a.evaluate(TOASTS), "Caro's poll waits for a host, who is told")
    pane(o, "bAct", "#actPolls")
    check(not o.evaluate("[...document.querySelectorAll('#pollList .actCard')].some(e => e.textContent.includes('Pizza'))"), "Beto doesn't see it yet")
    a.click("#pollList .actCard:has-text('Pizza') button[name='approve']")
    o.wait_for_function("[...document.querySelectorAll('#pollList .actCard')].some(e => e.textContent.includes('Pizza'))", timeout=5000)
    check(True, "approved: Beto sees the poll")
    a.click("#pollList .actCard:has-text('Pizza') button[name='hide']")
    o.wait_for_function("![...document.querySelectorAll('#pollList .actCard')].some(e => e.textContent.includes('Pizza'))", timeout=5000)
    check(True, "the host hides it: gone for Beto")
    a.click("#pollList .actCard:has-text('Pizza') button[name='hide']")
    o.wait_for_function("[...document.querySelectorAll('#pollList .actCard')].some(e => e.textContent.includes('Pizza'))", timeout=5000)
    a.click("#pollList .actCard:has-text('Pizza') button[name='end']")
    o.wait_for_function("document.querySelector('#pollList .actCard.ended') !== null", timeout=5000)
    check(True, "shown again, then the host ends it for everyone")
    b.close()

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
