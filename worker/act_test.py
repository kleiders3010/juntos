# Polls and Q&A (headless Edge, fake devices). Ana starts the call (host), Beto joins, Carla joins late.
# Checked: polls (start, notice, vote once, results only for who started it and the host unless shown to everyone,
# names unless "responses without names", end, late joiners catch up); Q&A (ask, anonymous, upvotes and popular
# order, answered, hidden, delete your own, held until the host approves, turned off); nobody but the host or the
# author can delete; the .txt; the ended screen.
# Run: python act_test.py [base-url]
import sys
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8798"
WS = BASE.replace("http", "ws", 1)
ARGS = ["--disable-gpu", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


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

    def panel(pg, tab):
        if pg.is_hidden("#actPane"):
            pg.click("#bMore")
            pg.click(".sheet #bAct")
        pg.click(f'#actPane .actTabs [data-v="{tab}"]')

    def poll_card(pg, q):
        return pg.locator("#pollList .actCard", has_text=q)

    def q_card(pg, text):
        return pg.locator("#qaList .actCard", has_text=text)

    a = page("Ana")
    a.goto(f"{BASE}/?signal={WS}")
    a.click("#start")
    a.wait_for_selector("#lobby:not([hidden])")
    a.fill("#name", "Ana")
    a.click("#enter")
    a.wait_for_selector("#call:not([hidden])")
    a.wait_for_function("() => __S.isHost", timeout=15000)
    join = f"{a.url}{'&' if '?' in a.url else '?'}signal={WS}"
    o = page("Beto")
    enter(o, "Beto", join)
    for pg in (a, o):
        pg.wait_for_function("() => __S.mesh.peers.size === 1 && [...__S.mesh.peers.values()].every(p => p.dc && p.dc.readyState === 'open')", timeout=30000)

    # ---- polls ----
    # only hosts start polls by default (roles_test.py covers that); here Ana lets everyone start them
    panel(a, "polls")
    a.select_option("select[name='pollWho']", "all")
    a.click("#panelClose")  # closed again: a new poll shows as a dot on her button
    panel(o, "polls")
    o.wait_for_function("() => !document.getElementById('pollStart').hidden", timeout=5000)
    check(o.is_visible("#pollList .actEmpty"), "the panel opens, no polls yet")
    o.click("#pollStart")
    o.fill('#pollDraft input[name="q"]', "Pizza or tacos?")
    opts = o.locator('#pollDraft input[name="opt"]')
    opts.nth(0).fill("Pizza")
    opts.nth(1).fill("Tacos")
    o.click("#pollDraft button:has-text('Add an option')")
    o.locator('#pollDraft input[name="opt"]').nth(2).fill("Both")
    o.click("#pollDraft .primary")
    a.wait_for_function("() => [...document.querySelectorAll('.toast')].some(t => t.textContent.includes('Pizza or tacos?'))", timeout=5000)
    check(a.evaluate("__S.barBtns.bAct.classList.contains('badge') && document.querySelector('#bMore').classList.contains('badge')"), "Ana is told Beto started a poll (notice and a dot on the button)")
    panel(a, "polls")
    card = poll_card(a, "Pizza or tacos?")
    card.locator("label", has_text="Tacos").click()
    card.locator("button:has-text('Vote')").click()
    check(card.locator(".actMine").is_visible() and card.locator(".pollVote").count() == 0, "Ana votes once (no second vote)")
    o.wait_for_function("() => document.querySelector('#pollList .resNames')?.textContent.includes('Ana')", timeout=5000)
    check("1 · 100" in poll_card(o, "Pizza or tacos?").inner_text(), "Beto (who started it) sees the result and that Ana voted Tacos")  # pinned: one vote of one
    check(poll_card(a, "Pizza or tacos?").locator(".pollRes").is_visible(), "Ana (host) sees the results too")

    # Carla joins late: catches up, votes, doesn't see results until shown
    c = page("Carla")
    enter(c, "Carla", join)
    c.wait_for_function("() => [...__S.mesh.peers.values()].filter(p => p.dc && p.dc.readyState === 'open').length === 2", timeout=30000)
    panel(c, "polls")
    c.wait_for_selector("#pollList .actCard", timeout=10000)
    cc = poll_card(c, "Pizza or tacos?")
    cc.locator("label", has_text="Pizza").click()
    cc.locator("button:has-text('Vote')").click()
    check(cc.locator(".pollRes").count() == 0 and "Only who started" in cc.inner_text(), "Carla (joined late) sees the poll, votes, but not the results")
    o.wait_for_function("() => document.querySelector('#pollList .actCard .actBy:last-child')?.textContent.startsWith('2')", timeout=5000)
    check(True, "Beto sees both votes")
    poll_card(o, "Pizza or tacos?").locator('button[name="show"]').click()
    c.wait_for_selector("#pollList .pollRes", timeout=5000)
    check(c.locator("#pollList .resNames").count() == 0, "shown to everyone: Carla sees the results, not who voted what")
    poll_card(o, "Pizza or tacos?").locator('button[name="end"]').click()
    a.wait_for_function("() => document.querySelector('#pollList .actCard').classList.contains('ended')", timeout=5000)
    check(True, "Beto ends the poll, for everyone")

    # responses without names
    o.click("#pollStart")
    o.fill('#pollDraft input[name="q"]', "Secret vote?")
    o.locator('#pollDraft input[name="opt"]').nth(0).fill("Yes")
    o.locator('#pollDraft input[name="opt"]').nth(1).fill("No")
    o.check('#pollDraft input[name="anon"]')
    o.click("#pollDraft .primary")
    sc = poll_card(a, "Secret vote?")
    sc.wait_for(timeout=5000)
    sc.locator("label", has_text="Yes").click()
    sc.locator("button:has-text('Vote')").click()
    o.wait_for_function("() => [...document.querySelectorAll('#pollList .actCard')].some(c => c.textContent.includes('Secret vote?') && c.querySelector('.resNum')?.textContent.startsWith('1'))", timeout=5000)
    check(poll_card(o, "Secret vote?").locator(".resNames").count() == 0, "responses without names: Beto sees the count, not the name")

    # nobody else can delete a poll (a forged delete from Carla is ignored)
    pid = a.evaluate("[...__S.act.items.values()].find(x => x.q === 'Secret vote?').id")
    c.evaluate(f"__S.mesh.broadcast({{ k: 'actdel', id: '{pid}' }}); 0")
    a.wait_for_timeout(800)
    check(a.evaluate(f"__S.act.items.has('{pid}')"), "a delete from someone who isn't the host or the author is ignored")
    poll_card(a, "Secret vote?").locator('button[name="del"]').click()
    o.wait_for_function(f"() => !__S.act.items.has('{pid}')", timeout=5000)
    check(True, "the host deletes it, for everyone")

    # ---- Q&A ----
    panel(o, "qa")
    o.fill("#askForm textarea", "Can we record this?")
    o.check('#askForm input[name="anon"]')
    o.click("#askForm .primary")
    o.uncheck('#askForm input[name="anon"]')  # the choice stays ticked between questions
    o.fill("#askForm textarea", "When is the next call?")
    o.click("#askForm .primary")
    panel(a, "qa")
    a.wait_for_function("() => document.querySelectorAll('#qaList .actCard').length === 2", timeout=5000)
    check("Anonymous" in q_card(a, "Can we record this?").inner_text() and "Beto" in q_card(a, "When is the next call?").inner_text(),
          "questions show who asked, or Anonymous")  # pinned: names this test typed
    panel(c, "qa")
    c.wait_for_function("() => document.querySelectorAll('#qaList .actCard').length === 2", timeout=5000)
    q_card(c, "When is the next call?").locator('button[name="up"]').click()
    q_card(a, "When is the next call?").locator('button[name="up"]').click()
    o.wait_for_function("() => document.querySelector('#qaList .actCard').textContent.includes('When is the next call?') && document.querySelector('#qaList .upBtn').textContent.includes('2')", timeout=5000)
    check(True, "upvotes count, the most voted question goes first")
    q_card(c, "When is the next call?").locator('button[name="up"]').click()
    o.wait_for_function("() => [...document.querySelectorAll('#qaList .actCard')].some(c => c.textContent.includes('next call') && c.querySelector('.upBtn').textContent.includes('1'))", timeout=5000)
    check(True, "upvoting again takes it back")
    check(q_card(c, "When is the next call?").locator('button[name="del"]').count() == 0 and q_card(o, "When is the next call?").locator('button[name="del"]').count() == 1,
          "only the author (and the host) can delete a question")
    q_card(a, "Can we record this?").locator('button[name="answered"]').click()
    o.wait_for_function("() => [...document.querySelectorAll('#qaList .actCard')].some(c => c.textContent.includes('record') && c.classList.contains('answered'))", timeout=5000)
    check(True, "the host marks a question answered, everyone sees it")
    q_card(a, "When is the next call?").locator('button[name="hide"]').click()
    c.wait_for_function("() => ![...document.querySelectorAll('#qaList .actCard')].some(c => c.textContent.includes('next call'))", timeout=5000)
    check(True, "the host hides a question: the others stop seeing it")
    q_card(o, "Can we record this?").locator('button[name="del"]').click()
    a.wait_for_function("() => ![...document.querySelectorAll('#qaList .actCard')].some(c => c.textContent.includes('record'))", timeout=5000)
    check(True, "Beto deletes his own (anonymous) question")

    # held until the host approves
    a.check('#qaHost input[name="qaMod"]')
    c.wait_for_function("() => document.querySelector('#qaOff').textContent.length > 0", timeout=5000)
    c.fill("#askForm textarea", "Is this approved?")
    c.click("#askForm .primary")
    check("Pending approval" in q_card(c, "Is this approved?").inner_text(), "Carla sees her question waiting")  # pinned: Meet's wording
    a.wait_for_function("() => [...document.querySelectorAll('.toast')].some(t => t.textContent.includes('approval'))", timeout=5000)
    o.wait_for_timeout(500)
    check(q_card(o, "Is this approved?").count() == 0 and o.evaluate("![...__S.act.items.values()].some(x => x.text === 'Is this approved?')"),
          "Beto doesn't see it (it isn't even sent to him)")  # pinned: the question this test asked
    q_card(a, "Is this approved?").locator('button[name="approve"]').click()
    q_card(o, "Is this approved?").wait_for(timeout=5000)
    check(True, "the host approves it: everyone sees it")

    # questions off
    a.uncheck('#qaHost input[name="qaOn"]')
    c.wait_for_function("() => document.querySelector('#askForm').hidden", timeout=5000)
    check(c.inner_text("#qaOff") != "", "the host turns questions off: Carla can't ask")
    a.check('#qaHost input[name="qaOn"]')

    # the .txt
    with a.expect_download() as d:
        a.click('#actPane button[name="actSave"]')
    text = open(d.value.path(), encoding="utf-8").read()
    check("Pizza or tacos?" in text and "Tacos: 1" in text and "Is this approved?" in text and "Can we record this?" not in text,
          "the .txt has the polls with results and the questions (not deleted ones)")  # pinned: the votes this test made

    a.click("#bLeave"); a.query_selector("#justLeave") and a.click("#justLeave")  # a host is asked: just leave
    a.wait_for_selector("#ended:not([hidden])")
    check(a.is_visible("#endedAct"), "after leaving, polls and questions can still be saved")
    b.close()

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
