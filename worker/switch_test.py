# Switch to another device, like Meet's "Switch here" (Meet help "Transfer a meeting between devices": on the new
# device pick "Switch here" and the call leaves the old one, which is told; "Join here too" keeps both).
# Ana (host) moves her call from her computer to a second device; Beto stays in the call. Then she joins a third
# device "too". Checked: the link carries a one-time code and her name, kept off the address bar; the lobby offers
# "Switch here" and "Join here too" with her name filled in; after switching the old device leaves and says why,
# the new one is a host and Beto sees one Ana; "Join here too" leaves nobody; a normal link shows "Join now" alone.
#   python worker/switch_test.py [base-url]   (local: npx wrangler dev --port 8797)
import sys
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8797"
WS = BASE.replace("http", "ws", 1)
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
OPEN_SWITCH = "(() => { if (!(document.getElementById('bSwitch') || __S.barBtns.bSwitch)) document.getElementById('bMore')?.click(); (document.getElementById('bSwitch') || __S.barBtns.bSwitch).click() })()"
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)

    def page(name):
        ctx = b.new_context(locale="en-US", permissions=["camera", "microphone"], viewport={"width": 1280, "height": 760})
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror ({name}): {e}"))
        return pg

    def with_signal(url):
        path, _, frag = url.partition("#")
        return f"{path}{'&' if '?' in path else '?'}signal={WS}" + (f"#{frag}" if frag else "")

    def switch_link(pg):
        pg.evaluate(OPEN_SWITCH)
        pg.wait_for_selector(".switchSheet input[name='link']")
        link = pg.input_value(".switchSheet input[name='link']")
        pg.click(".switchSheet [name='done']")
        return link

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
    o.goto(join)
    check(o.inner_text("#enter") == "Join now" and not o.is_visible("#joinToo"), "a normal link: just Join now")  # pinned: Meet's wording
    o.fill("#name", "Beto")
    o.click("#enter")
    o.wait_for_selector("#call:not([hidden])")
    a.wait_for_function("__S.mesh.peers.size === 1 && [...__S.mesh.peers.values()].every(p => p.dc && p.dc.readyState === 'open')", timeout=30000)

    link = switch_link(a)
    check("#" in link and "sw=" in link.split("#")[1] and "n=Ana" in link.split("#")[1], "Ana's switch link carries a one-time code and her name after '#'")

    a2 = page("Ana's phone")
    a2.goto(with_signal(link))
    a2.wait_for_selector("#lobby:not([hidden])")
    check("#" not in a2.url, "the code is taken off the address bar")
    check(a2.input_value("#name") == "Ana" and a2.inner_text("#enter") == "Switch here" and a2.is_visible("#joinToo"),
          "her other device offers Switch here and Join here too, with her name")  # pinned: Meet's wording
    a2.click("#enter")
    a2.wait_for_selector("#call:not([hidden])")
    a.wait_for_selector("#ended:not([hidden])", timeout=30000)
    check("other device" in a.inner_text("#endedMsg"), "the old device leaves and says she switched")
    a2.wait_for_function("__S.isHost", timeout=15000)
    check(True, "the new device is a host")
    o.wait_for_function("__S.mesh.peers.size === 1 && [...__S.mesh.peers.values()].every(p => p.name === 'Ana')", timeout=30000)
    check(True, "Beto sees one Ana")

    # a third device joins "too": nobody leaves
    link2 = switch_link(a2)
    check(link2 != link, "a new code each time")
    a3 = page("Ana's tablet")
    a3.goto(with_signal(link2))
    a3.wait_for_selector("#joinToo")
    a3.click("#joinToo")
    a3.wait_for_selector("#call:not([hidden])")
    o.wait_for_function("__S.mesh.peers.size === 2", timeout=30000)
    a2.wait_for_timeout(2500)
    check(a2.is_visible("#call") and not a2.is_visible("#ended"), "Join here too: her phone stays in the call")

    b.close()

print("\nALL OK" if not errors else "\nFAILED:\n" + "\n".join(errors))
sys.exit(1 if errors else 0)
