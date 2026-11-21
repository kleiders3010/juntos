# Calls for later and the invite sheet (headless Edge, clock in New York so daylight saving is in play).
# Checked: "Schedule for later" with sensible defaults; a planned call gives a link this device is host of; the
# invitation; the Google Calendar and Outlook.com links; the .ics (read back by the icalendar library: time zone with
# its daylight saving rules, repeat, reminder, short lines); the QR code reads back as the link (OpenCV); the list of
# planned calls (next date of a repeating call, a finished one-off call is gone, remove); opening it makes you host;
# in the call, Invite people shows the link, Copy and a QR code; Spanish.
# Run: python schedule_test.py [base-url]
import base64
import os
import tempfile
import sys
import time
import urllib.parse
sys.stdout.reconfigure(encoding='utf-8')
import cv2
import icalendar
import numpy as np
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8798"
WS = BASE.replace("http", "ws", 1)
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
TZ = "America/New_York"
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


def qr_text(pg, sel):
    data = pg.eval_on_selector(sel, "c => c.toDataURL('image/png')")
    img = cv2.imdecode(np.frombuffer(base64.b64decode(data.split(",", 1)[1]), np.uint8), cv2.IMREAD_GRAYSCALE)
    return cv2.QRCodeDetector().detectAndDecode(img)[0]


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)
    ctx = b.new_context(locale="en-US", timezone_id=TZ, permissions=["camera", "microphone", "clipboard-read", "clipboard-write"],
                        viewport={"width": 1280, "height": 860}, accept_downloads=True)
    a = ctx.new_page()
    a.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    a.goto(f"{BASE}/?signal={WS}")

    # ---- the form ----
    a.click("#schedule")
    a.wait_for_selector(".schedSheet form")
    d = a.evaluate("""() => { const f = document.querySelector('.schedForm');
      return { date: f.date.value, time: f.time.value, dur: f.dur.value, rep: f.rep.value, now: Date.now() }; }""")
    start = a.evaluate(f"new Date('{d['date']}T{d['time']}').getTime()")
    check(d["dur"] == "60" and d["rep"] == "" and 0 < start - d["now"] <= 60 * 60000 and d["time"][-2:] in ("00", "30"),
          "the form starts at the next half hour, 1 hour, not repeating")  # pinned: defaults like Zoom's
    a.fill('.schedForm [name="title"]', "Team sync, weekly")
    a.fill('.schedForm [name="date"]', "2027-03-10")
    a.fill('.schedForm [name="time"]', "15:00")
    a.select_option('.schedForm [name="rep"]', "weekly")
    a.click('.schedForm [name="create"]')
    a.wait_for_selector(".plannedSheet")
    url = a.input_value('.plannedSheet [name="link"]')
    code = url.rsplit("/r/", 1)[-1]
    check(url.startswith(f"{BASE}/r/") and len(code) >= 4, "a link is made for the planned call")
    check(a.evaluate(f"!!localStorage.getItem('juntos.host.{code}')"), "this device keeps the host key for it")
    t = a.inner_text(".plannedSheet")
    check("Team sync, weekly" in t and "Wednesday, March 10" in t and "3:00" in t and "4:00" in t and "Every week" in t, "the sheet says what, when and that it repeats")

    # ---- copy ----
    a.click('.plannedSheet [name="copy"]')
    check(a.evaluate("navigator.clipboard.readText()") == url, "Copy link copies the link")
    a.click('.plannedSheet [name="invitation"]')
    inv = a.evaluate("navigator.clipboard.readText()")
    check(all(s in inv for s in ["Team sync, weekly", "March 10", "Every week", f"Join: {url}"]), "the invitation has the title, the time, the repeat and the link")

    # ---- calendars ----
    g = urllib.parse.urlparse(a.get_attribute('.plannedSheet [name="google"]', "href"))
    q = dict(urllib.parse.parse_qsl(g.query))
    check(g.netloc == "calendar.google.com" and q.get("dates") == "20270310T150000/20270310T160000" and q.get("ctz") == TZ
          and q.get("recur") == "RRULE:FREQ=WEEKLY" and url in q.get("details", "") and q.get("text") == "Team sync, weekly",
          "the Google Calendar link has the time in the right time zone, the repeat and the link")  # pinned: Google's TEMPLATE format
    o = urllib.parse.urlparse(a.get_attribute('.plannedSheet [name="outlook"]', "href"))
    q = dict(urllib.parse.parse_qsl(o.query))
    check(o.netloc == "outlook.live.com" and q.get("startdt") == "2027-03-10T15:00:00-05:00" and q.get("enddt") == "2027-03-10T16:00:00-05:00",
          "the Outlook.com link has the time with its offset")  # pinned: Outlook's deeplink format
    check("to repeat it there, use the calendar file" in t, "it says Outlook.com adds one date")
    with a.expect_download() as dl:
        a.click('.plannedSheet [name="ics"]')
    check(dl.value.suggested_filename == "Team sync, weekly.ics", "the calendar file is named after the call")  # pinned: file name = the title
    raw = open(dl.value.path(), "rb").read()
    check(all(len(line) <= 75 for line in raw.split(b"\r\n")) and raw.endswith(b"\r\n") and b"\n" not in raw.replace(b"\r\n", b""),
          "the .ics has CRLF lines of at most 75 bytes")  # pinned: RFC 5545
    cal = icalendar.Calendar.from_ical(raw)
    ev = cal.walk("VEVENT")[0]
    st = ev.decoded("DTSTART")
    check(str(st.tzinfo) == TZ and st.strftime("%Y-%m-%d %H:%M") == "2027-03-10 15:00" and ev.decoded("DTEND").hour == 16, "the .ics starts at 3 pm New York time")
    check(ev["RRULE"]["FREQ"] == ["WEEKLY"] and str(ev["SUMMARY"]) == "Team sync, weekly" and url in str(ev["DESCRIPTION"]) and str(ev["UID"]).startswith(code),
          "the .ics repeats weekly and has the title and link")
    check(any((str(al["TRIGGER"].to_ical(), "ascii") if isinstance(al["TRIGGER"].to_ical(), bytes) else al["TRIGGER"].to_ical()) == "-PT10M" for al in ev.walk("VALARM")), "the .ics reminds 10 minutes before")
    tzc = cal.walk("VTIMEZONE")[0]
    rules = {c.name: (c["RRULE"]["BYMONTH"], c["RRULE"]["BYDAY"], str(c.get("TZOFFSETTO").to_ical(), "ascii") if isinstance(c.get("TZOFFSETTO").to_ical(), bytes) else c.get("TZOFFSETTO").to_ical()) for c in tzc.subcomponents}
    check(rules.get("DAYLIGHT") == ([3], ["2SU"], "-0400") and rules.get("STANDARD") == ([11], ["1SU"], "-0500"),
          "the .ics time zone has New York's daylight saving rules (second Sunday of March, first of November)")  # pinned: US DST law
    # after the change to summer time the call stays at 3 pm local
    occ = st.tzinfo.normalize(st.replace(day=17)) if hasattr(st.tzinfo, "normalize") else st.replace(day=17)
    check(occ.utcoffset().total_seconds() == -4 * 3600, "a week later (after daylight saving starts) it is still 3 pm local")

    # ---- QR ----
    check(qr_text(a, ".plannedSheet .schedQr canvas") == url, "the QR code reads back as the link")

    # ---- the list on the start page ----
    a.click('.plannedSheet [name="done"]')
    a.evaluate("""() => { const l = JSON.parse(localStorage.getItem('juntos.sched'));
      const h = 3600000, now = Date.now();
      l.push({ code: 'old-call-one', title: 'Over', start: now - 5 * h, dur: 60, rep: '' });
      const d = new Date(now + 5 * 60000); d.setDate(d.getDate() - 30);  // same wall clock a month ago (across a DST change)
      l.push({ code: 'soon-call-two', title: 'Daily standup', start: d.getTime(), dur: 15, rep: 'daily' });
      localStorage.setItem('juntos.sched', JSON.stringify(l)); }""")
    a.goto(f"{BASE}/?signal={WS}")
    a.wait_for_selector("#upcoming:not([hidden]) .upItem")
    items = a.locator("#upcoming .upItem").all_inner_texts()
    check(len(items) == 2 and "Daily standup" in items[0] and "Team sync, weekly" in items[1], "planned calls are listed, next first; a finished one-off call is gone")  # pinned: the calls this test planned
    check("Join now" in items[0], "a call starting within 15 minutes offers Join now")
    nxt = a.evaluate("""async () => { const m = await import('/schedule.js'); const l = m.load();
      const c = l.find((x) => x.code === 'soon-call-two'); return m.nextStart(c) - Date.now(); }""")
    check(0 < nxt <= 5 * 60000 + 1000, "a daily call started a month ago shows today's time")
    wd = a.evaluate("""async () => { const m = await import('/schedule.js');
      const fri = new Date(2027, 0, 8, 9, 0).getTime();  // a Friday
      return new Date(m.nextStart({ start: fri, dur: 30, rep: 'weekdays' }, fri + 3600000)).getDay(); }""")
    check(wd == 1, "every weekday skips the weekend")  # pinned: Friday -> Monday
    a.click('#upcoming .upItem:has-text("Daily standup") [name="remove"]')
    check(a.locator("#upcoming .upItem").count() == 1,  # pinned: one of the two removed
          "remove takes it off the list")
    a.click("#upcoming .upItem .upInfo")
    a.wait_for_selector(".plannedSheet")
    check(a.input_value('.plannedSheet [name="link"]') == url, "the details open again from the list")
    a.keyboard.press("Escape")
    check(a.locator(".plannedSheet").count() == 0, "Esc closes it")

    # ---- opening it: host ----
    a.click('#upcoming .upItem [name="open"]')
    a.wait_for_selector("#lobby:not([hidden])")
    a.fill("#name", "Ana")
    a.click("#enter")
    a.wait_for_selector("#call:not([hidden])")
    a.wait_for_function("() => __S.isHost", timeout=15000)
    check(True, "whoever planned it is the host when they open it")

    # ---- Invite people in the call ----
    a.click("#invite")
    a.wait_for_selector(".inviteSheet")
    check(a.input_value('.inviteSheet [name="link"]') == url and "Anyone with the link can join" in a.inner_text(".inviteSheet"), "Invite people shows the link")
    a.click('.inviteSheet [name="copy"]')
    check(a.evaluate("navigator.clipboard.readText()") == url, "and copies it")
    check(qr_text(a, ".inviteSheet .schedQr canvas") == url, "its QR code joins this call from a phone")
    a.screenshot(path=os.path.join(tempfile.gettempdir(), "juntos_schedule_invite.png"))
    a.click('.inviteSheet [name="done"]')
    check(a.locator(".inviteSheet").count() == 0, "Done closes it")

    # ---- Spanish ----
    es = b.new_context(locale="es-AR", timezone_id="America/Argentina/Buenos_Aires", viewport={"width": 390, "height": 800}).new_page()
    es.goto(f"{BASE}/?signal={WS}")
    check(es.inner_text("#schedule") != "Schedule for later", "Spanish: the button is translated")
    es.click("#schedule")
    es.wait_for_selector(".schedForm")
    ft = es.inner_text(".schedForm")
    check("Schedule a call" not in es.inner_text(".schedSheet") and "Buenos Aires" in ft, "Spanish: the form, with the time zone")
    if "Buenos Aires" not in ft: print(ft)
    es.click('.schedForm [name="create"]')
    es.wait_for_selector(".plannedSheet")
    es.screenshot(path=os.path.join(tempfile.gettempdir(), "juntos_schedule_phone_es.png"))
    with es.expect_download() as dl:
        es.click('.plannedSheet [name="ics"]')
    ev = icalendar.Calendar.from_ical(open(dl.value.path(), "rb").read()).walk("VEVENT")[0]
    check(ev["DTSTART"].to_ical().decode().endswith("Z") and not icalendar.Calendar.from_ical(open(dl.value.path(), "rb").read()).walk("VTIMEZONE"),
          "a call that doesn't repeat is written in UTC, without a time zone block")
    b.close()

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
