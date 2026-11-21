# Attendance report, like Meet's (Meet help "Track attendance": name, time joined, time exited, duration; someone
# who rejoins keeps the first join and the last exit, with the time added up; only the organizer gets it).
# Ana starts the call (host); Beto joins, leaves and comes back; Carla joins and leaves.
# Checked: Ana saves a .csv from People with everyone, their first join, last exit, time in the call and how many
# times they joined; someone still there says so; Beto (not a host) has no such button; after Ana leaves she can
# still save it, with her own time ended.
#   python worker/attend_test.py [base-url]   (local: npx wrangler dev -c wrangler.test.toml --port 8798)
import csv
import io
import sys
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8798"
WS = BASE.replace("http", "ws", 1)
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
OPEN_PEOPLE = "(() => { if (document.getElementById('peoplePane')?.offsetParent) return; if (!document.getElementById('bPeople')) document.getElementById('bMore')?.click(); document.getElementById('bPeople').click() })()"
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)

    def page(name):
        ctx = b.new_context(locale="en-US", permissions=["camera", "microphone"], viewport={"width": 1280, "height": 760}, accept_downloads=True)
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror ({name}): {e}"))
        return pg

    def enter(pg, name, url):
        pg.goto(url)
        pg.fill("#name", name)
        pg.click("#enter")
        pg.wait_for_selector("#call:not([hidden])")

    def peers(pg, n):
        pg.wait_for_function(f"() => __S.mesh.peers.size === {n} && [...__S.mesh.peers.values()].every(p => p.name)", timeout=30000)

    def rows(pg, sel):
        with pg.expect_download() as dl:
            pg.click(sel)
        text = open(dl.value.path(), encoding="utf-8-sig").read()
        return dl.value.suggested_filename, {r["Name"]: r for r in csv.DictReader(io.StringIO(text))}

    a = page("Ana")
    a.goto(f"{BASE}/?signal={WS}")
    a.click("#start")
    a.wait_for_selector("#lobby:not([hidden])")
    a.fill("#name", "Ana")
    a.click("#enter")
    a.wait_for_selector("#call:not([hidden])")
    join = f"{a.url}{'&' if '?' in a.url else '?'}signal={WS}"

    o = page("Beto")
    enter(o, "Beto", join)
    c = page("Carla")
    enter(c, "Carla", join)
    peers(a, 2)
    a.wait_for_timeout(1500)
    o.context.close()  # Beto's connection drops; he comes back
    a.wait_for_function("() => __S.mesh.peers.size === 1", timeout=60000)
    o = page("Beto")
    enter(o, "Beto", join)
    peers(a, 2)
    c.evaluate("document.getElementById('bLeave').click(); document.getElementById('justLeave')?.click()")
    a.wait_for_function("() => __S.mesh.peers.size === 1", timeout=60000)

    a.evaluate(OPEN_PEOPLE)
    a.wait_for_selector('button[name="attSave"]')
    name, r = rows(a, 'button[name="attSave"]')
    check(name.endswith(".csv") and set(r) == {"Ana", "Beto", "Carla"}, "Ana saves attendance from People: everyone who came, once each")
    check(r["Beto"]["Times joined"] == "2" and r["Beto"]["Last left"] == "still in the call", "Beto came twice and is still there")  # pinned: the .csv format (English column names and wording)
    check(r["Carla"]["Times joined"] == "1" and r["Carla"]["Last left"][:4].isdigit() and r["Carla"]["First joined"] <= r["Carla"]["Last left"],
          "Carla's first join and her exit")
    secs = lambda s: sum(int(x) * m for x, m in zip(s.split(":"), (3600, 60, 1)))
    check(secs(r["Ana"]["Time in the call"]) >= secs(r["Beto"]["Time in the call"]) > 0, "time in the call adds up (Ana was there longest)")

    o.evaluate(OPEN_PEOPLE)
    o.wait_for_selector("#peopleList li")
    check(o.query_selector('button[name="attSave"]') is None, "Beto isn't a host: no attendance button")

    a.evaluate("document.getElementById('bLeave').click(); document.getElementById('justLeave')?.click()")
    a.wait_for_selector("#endedAtt:not([hidden])")
    _, r2 = rows(a, "#endedAtt")
    check(r2["Ana"]["Last left"][:4].isdigit() and r2["Beto"]["Last left"][:4].isdigit(), "after leaving Ana can still save it; nobody is 'still in the call'")
    o.wait_for_selector("#peopleList li")
    b.close()

print("\nALL OK" if not errors else "\nFAILED:\n" + "\n".join(errors))
sys.exit(1 if errors else 0)
