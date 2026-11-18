# Breakout rooms (headless Edge, fake devices). Ana starts the call (host); Beto, Carla and Dani join; Eva joins late.
# Checked: only the host has the button; rooms are set up (spread, moved one by one), opened; invitations (Join, or
# stay and join later); people in other rooms aren't seen or sent sound and picture; room chat stays in the room;
# ask for help reaches the host, who joins and leaves the room; return to main call; edit rooms moves someone;
# a late joiner lands in the main call; a forged close from someone who isn't the host is ignored; close rooms
# (30 seconds, close now) brings everyone back and deletes room chat; a timer that runs out closes the rooms.
# Run: python br_test.py [base-url]
import sys
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8797"
WS = BASE.replace("http", "ws", 1)
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)

    def page(name):
        ctx = b.new_context(locale="en-US", permissions=["camera", "microphone"], viewport={"width": 1280, "height": 860})
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror ({name}): {e}"))
        return pg

    def enter(pg, name, url):
        pg.goto(url)
        pg.fill("#name", name)
        pg.click("#enter")
        pg.wait_for_selector("#call:not([hidden])")

    def connected(pg, n):
        pg.wait_for_function(f"[...__S.mesh.peers.values()].filter(p => p.dc && p.dc.readyState === 'open').length === {n}", timeout=40000)

    def visible_tiles(pg):
        return set(pg.evaluate("[...document.querySelectorAll('#grid .tile:not(.away)')].map(t => t.querySelector('.nm').textContent)"))

    def sends_to(pg, other_id):
        # is my microphone / camera going to this person?
        return pg.evaluate(f"(() => {{ const p = __S.mesh.peers.get('{other_id}'); return !!(p.audio.sender.track || p.video.sender.track); }})()")

    def here(pg):
        return pg.evaluate("__S.br.here")

    a = page("Ana")
    a.goto(f"{BASE}/?signal={WS}")
    a.click("#start")
    a.wait_for_selector("#lobby:not([hidden])")
    a.fill("#name", "Ana")
    a.click("#enter")
    a.wait_for_selector("#call:not([hidden])")
    a.wait_for_function("__S.isHost", timeout=15000)
    join = f"{a.url}{'&' if '?' in a.url else '?'}signal={WS}"
    o = page("Beto")
    enter(o, "Beto", join)
    c = page("Carla")
    enter(c, "Carla", join)
    d = page("Dani")
    enter(d, "Dani", join)
    for pg in (a, o, c, d):
        connected(pg, 3)
    ids = {n: pg.evaluate("__S.mesh.id") for n, pg in (("Ana", a), ("Beto", o), ("Carla", c), ("Dani", d))}

    check(a.is_visible("#bBreak") and not o.is_visible("#bBreak"), "only the host has the breakout rooms button")

    # ---- set up and open ----
    a.click("#bBreak")
    a.wait_for_selector("#brPane select[name=move]")
    # (people joined after the host's panel was first drawn: they must still be spread, not left in the main call)
    check(a.locator("#brPane .brRoom[data-room='0']").count() == 0 and a.locator("#brPane .brRoom select").count() == 3,
          "the three others are spread over the rooms automatically")
    a.fill('#brPane input[name="rooms"]', "2")
    a.dispatch_event('#brPane input[name="rooms"]', "change")
    for name, room in (("Beto", "1"), ("Dani", "1"), ("Carla", "2")):
        a.select_option(f"#brPane select[name=move][data-id='{ids[name]}']", room)
    check(a.locator("#brPane .brRoom[data-room='1'] .brPerson").count() == 2, "the host moves people between rooms")
    a.click('#brPane button[name="openRooms"]')

    for pg, room in ((o, "Room 1"), (c, "Room 2"), (d, "Room 1")):
        pg.wait_for_selector("#brBar.invite", timeout=5000)
    check("Ana invites you to Room 1" in o.inner_text("#brBar"), "Beto gets an invitation from Ana to Room 1")  # pinned: names this test typed
    o.click("#brBar button[name=brJoin]")
    c.click("#brBar button[name=brJoin]")
    d.click("#brBar button[name=brStay]")
    o.wait_for_function("__S.br.here === 1")
    check(here(d) == 0 and d.locator("#brBar button[name=brJoin]").is_visible(), "Dani stays in the main call for now and can join later")

    # who sees and hears whom
    o.wait_for_function("document.querySelectorAll('#grid .tile:not(.away)').length === 1", timeout=5000)
    check(visible_tiles(o) == {"Beto (you)"}, "Beto, alone in Room 1, doesn't see the others")  # pinned: names this test typed
    a.wait_for_function("document.querySelectorAll('#grid .tile:not(.away)').length === 2", timeout=5000)
    check(visible_tiles(a) == {"Ana (you)", "Dani"}, "Ana (main call) sees only Dani")  # pinned: names this test typed
    o.wait_for_timeout(500)
    check(not sends_to(o, ids["Carla"]) and not sends_to(o, ids["Ana"]), "Beto's sound and picture don't go to other rooms")
    check(sends_to(a, ids["Dani"]), "Ana's still go to Dani, in the main call with her")

    d.click("#brBar button[name=brJoin]")
    o.wait_for_function("document.querySelectorAll('#grid .tile:not(.away)').length === 2", timeout=5000)
    check(visible_tiles(o) == {"Beto (you)", "Dani"} and sends_to(o, ids["Dani"]), "Dani joins Room 1: Beto sees and hears her")  # pinned: names this test typed
    check("Room 1" in o.inner_text("#brBar") and o.locator("#brBar button[name=brBack]").is_visible(), "in a room: its name and Return to main call at the top")

    # chat stays in the room
    o.click("#bChat")
    o.fill("#chatText", "room one hello")
    o.press("#chatText", "Enter")
    d.wait_for_function("document.querySelector('#chatLog')?.textContent.includes('room one hello') || [...document.querySelectorAll('.toast')].some(t => t.textContent.includes('room one hello'))", timeout=5000)
    c.wait_for_timeout(800)
    check(not c.evaluate("__S.chat.some(m => m.text === 'room one hello')") and not a.evaluate("__S.chat.some(m => m.text === 'room one hello')"),
          "room chat reaches Dani (same room), not Carla or Ana")  # pinned: the message this test sent

    # ask for help
    c.click("#brBar button[name=brHelp]")
    a.wait_for_function("document.querySelector('#brBar .brCall')?.textContent.includes('Carla')", timeout=5000)
    check("Cancel ask for help" in c.inner_text("#brBar"), "Carla asks for help (and can cancel)")  # pinned: Meet's wording
    a.wait_for_selector("#brBar .brCall", timeout=5000)
    check(a.locator("#brBar .brCall button[name=helpJoin]").is_visible() and a.locator("#brBar .brCall button[name=helpLater]").is_visible(),
          "the host gets a notice to Join or answer Later")
    a.click("#brBar .brCall button[name=helpLater]")
    check(a.locator("#brBar .brCall").count() == 0, "Later puts the notice away")
    a.wait_for_selector("#brPane .brRoom.help[data-room='2']", timeout=5000)
    check("Asked for help" in a.inner_text("#brPane .brRoom[data-room='2']"), "the host sees Room 2 asked for help")  # pinned: Meet's wording
    a.click("#brPane .brRoom[data-room='2'] button[name=joinRoom]")
    c.wait_for_function("document.querySelectorAll('#grid .tile:not(.away)').length === 2", timeout=5000)
    check(visible_tiles(c) == {"Carla (you)", "Ana"} and here(a) == 2, "the host joins Room 2: Carla and Ana see each other")  # pinned: names this test typed
    a.click("#brPane .brRoom[data-room='2'] button[name=leaveRoom]")
    a.wait_for_function("__S.br.here === 0")
    check(True, "the host leaves the room, back in the main call")

    # return to main call, and back
    o.click("#brBar button[name=brBack]")
    a.wait_for_function("document.querySelectorAll('#grid .tile:not(.away)').length === 2", timeout=5000)
    check(visible_tiles(a) == {"Ana (you)", "Beto"}, "Beto returns to the main call: Ana sees him")  # pinned: names this test typed
    o.click("#brBar button[name=brJoin]")
    o.wait_for_function("__S.br.here === 1")
    check(True, "and goes back to Room 1")

    # a late joiner lands in the main call
    e = page("Eva")
    enter(e, "Eva", join)
    connected(e, 4)
    e.wait_for_function("__S.br.plan && document.querySelectorAll('#grid .tile:not(.away)').length === 2", timeout=10000)
    check(here(e) == 0 and visible_tiles(e) == {"Eva (you)", "Ana"}, "Eva joins late: in the main call with Ana, the rooms are apart")  # pinned: names this test typed
    ids["Eva"] = e.evaluate("__S.mesh.id")

    # edit rooms: Carla to Room 1, Eva to Room 2
    a.click('#brPane button[name="edit"]')
    a.select_option(f"#brPane select[name=move][data-id='{ids['Carla']}']", "1")
    a.select_option(f"#brPane select[name=move][data-id='{ids['Eva']}']", "2")
    a.click('#brPane button[name="save"]')
    c.wait_for_selector("#brBar.invite", timeout=5000)
    check("Room 1" in c.inner_text("#brBar .brAsk"), "edit rooms: Carla is invited to Room 1")
    c.click("#brBar button[name=brJoin]")
    o.wait_for_function("document.querySelectorAll('#grid .tile:not(.away)').length === 3", timeout=5000)
    check(visible_tiles(o) == {"Beto (you)", "Dani", "Carla"}, "Carla is now in Room 1 with Beto and Dani")  # pinned: names this test typed
    e.wait_for_selector("#brBar.invite", timeout=5000)
    check(not d.locator("#brBar.invite").count(), "people whose room didn't change aren't asked again")

    # only the host can close the rooms
    o.evaluate("__S.mesh.broadcast({ k: 'br', n: 0 }); 0")
    c.wait_for_timeout(800)
    check(here(c) == 1, "a close from someone who isn't the host is ignored")

    # close rooms: 30 seconds, then close now
    a.click('#brPane button[name="closeRooms"]')
    a.click('#brPane button[name="closeRooms"]')
    o.wait_for_function("document.querySelector('#brBar .brTime').textContent.includes('Rooms close in')", timeout=5000)
    check(o.evaluate("__S.br.plan.closing - Date.now()") > 20000, "close rooms: everyone gets about 30 seconds")
    a.click('#brPane button[name="closeNow"]')
    for pg in (o, c, d):
        pg.wait_for_function("__S.br.here === 0 && !__S.br.plan", timeout=5000)
    o.wait_for_function("document.querySelectorAll('#grid .tile:not(.away)').length === 5", timeout=5000)
    check(sends_to(o, ids["Ana"]) and sends_to(o, ids["Eva"]), "close now: everyone back in the main call, seeing and hearing all")
    check(not o.evaluate("__S.chat.some(m => m.text === 'room one hello')"), "room chat is gone when the rooms end")  # pinned: the message this test sent

    # a timer that runs out closes the rooms the same way
    a.click('#brPane select[name="timer"]')
    a.select_option('#brPane select[name="timer"]', "5")
    a.click('#brPane button[name="openRooms"]')
    o.wait_for_selector("#brBar.invite", timeout=5000)
    o.click("#brBar button[name=brJoin]")
    left = o.inner_text("#brBar .brTime")
    check(left.startswith("4:") or left.startswith("5:"), f"the timer shows the time left ({left})")
    for pg in (a, o, c, d, e):
        pg.evaluate("__S.br.plan.ends = Date.now() + 300; 0")  # the five minutes, skipped
    o.wait_for_function("document.querySelector('#brBar .brTime').textContent.includes('Rooms close in')", timeout=5000)
    check(True, "time is up: the rooms close in 30 seconds")
    for pg in (a, o, c, d, e):
        pg.evaluate("__S.br.plan && (__S.br.plan.closing = Date.now() + 300); 0")  # the 30 seconds, skipped
    o.wait_for_function("__S.br.here === 0 && !__S.br.plan", timeout=5000)
    check(o.is_hidden("#brBar"), "and then everyone is back in the main call")
    b.close()

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
