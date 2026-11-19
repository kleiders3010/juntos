# Shared notes (headless Edge, fake devices). Ana starts the call (host), Beto joins, Carla joins late.
# Checked: the panel and the meeting notes template (date, attendees, notes, action items); what one writes the
# others see, with a notice the first time and a dot on the button; two people typing at the same moment lose
# nothing and end with the same text; my cursor stays where I was while someone else writes above it; deleting;
# "only the host can edit" (the others can't change it, and their changes are not taken); a late joiner gets the
# whole text and can write; the .txt; saving after leaving.
# Run: python notes_test.py [base-url]
import sys
import time
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8797"
WS = BASE.replace("http", "ws", 1)
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
errors = []
TA = "#notesPane textarea"


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


# types text one character at a time at a position, like a person (setRangeText + an input event per letter)
TYPE_JS = """([text, at, gap]) => new Promise((done) => {
  const ta = document.querySelector('#notesPane textarea');
  ta.focus();
  let pos = at === -1 ? ta.value.length : at;
  ta.setSelectionRange(pos, pos);
  let i = 0;
  const step = () => {
    if (i >= text.length) return done();
    const p = ta.selectionStart;
    ta.setRangeText(text[i++], p, p, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    setTimeout(step, gap);
  };
  step();
})"""


def value(pg):
    return pg.eval_on_selector(TA, "t => t.value")


def same(pages, timeout=8000):
    end = time.time() + timeout / 1000
    while time.time() < end:
        vals = [value(pg) for pg in pages]
        if len(set(vals)) == 1:
            return vals[0]
        time.sleep(0.2)
    return None


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)

    def page(name):
        ctx = b.new_context(locale="en-US", permissions=["camera", "microphone"], viewport={"width": 1280, "height": 860}, accept_downloads=True)
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror ({name}): {e}"))
        return pg

    def enter(pg, name, url):
        pg.goto(url)
        pg.fill("#name", name)
        pg.click("#enter")
        pg.wait_for_selector("#call:not([hidden])")

    def notes(pg):
        if pg.is_hidden("#notesPane"):
            pg.click("#bMore")
            pg.click(".sheet #bNotes")
        pg.wait_for_selector(TA)

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
    for pg in (a, o):
        pg.wait_for_function("__S.mesh.peers.size === 1 && [...__S.mesh.peers.values()].every(p => p.dc && p.dc.readyState === 'open')", timeout=30000)

    # ---- the panel and the template ----
    notes(o)
    check(value(o) == "" and o.is_visible('#notesPane [name="template"]'), "the panel opens empty, with the meeting notes template")
    check(o.is_hidden('#notesPane select[name="who"]') and "Everyone can edit" in o.inner_text(".notesWho"), "Beto (not the host) sees that everyone can edit, without the host's choice")
    o.click('#notesPane [name="template"]')
    text = value(o)
    check(all(s in text for s in ["Notes · ", "Attendees: Beto, Ana", "Action items", "[ ] "]), "the template has the date, who is in the call, notes and action items")
    a.wait_for_function("[...document.querySelectorAll('.toast')].some(t => t.textContent.includes('Beto is taking notes'))", timeout=5000)
    check(a.evaluate("__S.barBtns.bNotes.classList.contains('badge') && document.querySelector('#bMore').classList.contains('badge')"), "Ana is told Beto is taking notes (notice and a dot on the button)")
    notes(a)
    check(value(a) == text, "Ana sees the same notes")
    check(o.evaluate("document.activeElement.matches('#notesPane textarea') && document.activeElement.selectionStart") == text.index("- ") + 2,
          "Beto's cursor is put after the first '- ' under Notes")

    # ---- what one writes, the other sees ----
    o.evaluate(TYPE_JS, ["We start Monday", text.index("- ") + 2, 20])
    check(same([a, o]) is not None and "- We start Monday" in value(a), "what Beto writes shows up for Ana")
    check("Beto is writing" in a.inner_text(".notesWriting"), "Ana sees who is writing")

    # ---- two people typing at the same moment ----
    o.evaluate("window.__p = null")
    a.evaluate("([js, args]) => { window.__p = eval(js)(args); }", [TYPE_JS, ["ana ana ana ana ana", 0, 15]])
    o.evaluate("([js, args]) => { window.__p = eval(js)(args); }", [TYPE_JS, ["beto beto beto beto", -1, 15]])
    a.evaluate("window.__p")
    o.evaluate("window.__p")
    t2 = same([a, o])
    check(t2 is not None, "after typing at the same moment, both have the same text")
    check(t2 is not None and t2.startswith("ana ana ana ana ana") and t2.endswith("beto beto beto beto") and "We start Monday" in t2,
          "nothing either of them typed was lost or mixed up")

    # ---- my cursor stays put while someone writes above it ----
    pos = value(o).index("We start Monday") + len("We start")
    o.evaluate(f"() => {{ const t = document.querySelector('{TA}'); t.focus(); t.setSelectionRange({pos}, {pos}); }}")
    a.evaluate(TYPE_JS, ["Top line\n", 0, 10])
    same([a, o])
    o.evaluate(f"() => {{ const t = document.querySelector('{TA}'); t.setRangeText(' next', t.selectionStart, t.selectionStart, 'end'); t.dispatchEvent(new Event('input', {{ bubbles: true }})); }}")
    t3 = same([a, o])
    check(t3 is not None and "We start next Monday" in t3 and t3.startswith("Top line\n"), "Beto's cursor stays where he was while Ana writes above it")

    # ---- deleting ----
    a.evaluate(f"() => {{ const t = document.querySelector('{TA}'); const i = t.value.indexOf('ana ana ana ana ana'); t.setRangeText('', i, i + 'ana ana ana ana ana'.length, 'end'); t.dispatchEvent(new Event('input', {{ bubbles: true }})); }}")
    t4 = same([a, o])
    check(t4 is not None and "ana ana" not in t4 and "beto beto" in t4, "what Ana deletes is gone for Beto too")

    # ---- only the host can edit ----
    check(a.is_visible('#notesPane select[name="who"]'), "Ana (the host) can choose who edits")
    a.select_option('#notesPane select[name="who"]', "host")
    o.wait_for_function("document.querySelector('#notesPane textarea').readOnly", timeout=5000)
    check("Only the host can edit" in o.inner_text(".notesWho"), "Beto now can't edit, and is told why")
    before = value(a)
    # even typed into the box some other way, Beto's change is put back and not sent
    o.evaluate(TYPE_JS, [" sneaky", -1, 10])
    time.sleep(1.5)
    check(value(a) == before and value(o) == before, "a change from someone who isn't the host is put back and not sent")
    a.evaluate(TYPE_JS, [" (host)", -1, 10])
    time.sleep(1)
    check(value(o).endswith("(host)"), "the host still writes and everyone sees it")
    a.select_option('#notesPane select[name="who"]', "all")
    o.wait_for_function("!document.querySelector('#notesPane textarea').readOnly", timeout=5000)
    check(True, "everyone can edit again")

    # ---- a late joiner ----
    c = page("Carla")
    enter(c, "Carla", join)
    c.wait_for_function("__S.mesh.peers.size === 2 && [...__S.mesh.peers.values()].every(p => p.dc && p.dc.readyState === 'open')", timeout=30000)
    notes(c)
    c.wait_for_function("(v) => document.querySelector('#notesPane textarea').value === v", arg=value(a), timeout=8000)
    check(True, "Carla, joining late, gets the whole text")
    c.evaluate(TYPE_JS, ["\nCarla was here", -1, 10])
    t5 = same([a, o, c])
    check(t5 is not None and t5.endswith("Carla was here"), "Carla writes and everyone sees it")

    # ---- saving ----
    with a.expect_download() as d:
        a.click('#notesPane button[name="save"]')
    saved = open(d.value.path(), encoding="utf-8").read()
    check(saved.replace("\r\n", "\n").rstrip("\n") == value(a), "the .txt is the notes")
    a.click("#bLeave")
    a.wait_for_selector("#ended:not([hidden])")
    check(a.is_visible("#endedNotes"), "after leaving, the notes can still be saved")
    with a.expect_download() as d:
        a.click("#endedNotes")
    check("Carla was here" in open(d.value.path(), encoding="utf-8").read(), "and the .txt saved after leaving has everything")
    b.close()

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
