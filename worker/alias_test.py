# juntos.jurisgames.com is another address for Juntos (Kleider, 2026-11-18: "juntos.jurisgames.com should be an alias
# for meet.jurisgames.com too"). It forwards to meet.jurisgames.com (a Cloudflare redirect rule, no Worker request),
# keeping the path, the query and the passcode after "#", so the host's key, scheduled calls and settings stay in
# one place (a browser keeps them per address). Live only.
# Run: python alias_test.py
import sys
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

ALIAS = "https://juntos.jurisgames.com"
HOME = "https://meet.jurisgames.com"  # pinned: the one address invites use
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"])
    pg = b.new_context(locale="en-US", permissions=["camera", "microphone"]).new_page()
    pg.goto(f"{ALIAS}/")
    check(pg.url.startswith(HOME + "/"), f"the alias opens Juntos at {HOME} ({pg.url})")
    check(pg.is_visible("#start"), "the start page is there")
    pg.goto(f"{ALIAS}/r/abcd-efgh-ijk?lang=es#p=Ab12cd")
    check(pg.url == f"{HOME}/r/abcd-efgh-ijk?lang=es", f"a call link keeps its path and query ({pg.url})")
    # the page keeps the passcode from after "#" and takes it off the address bar: it arrived through the redirect
    check(pg.evaluate("localStorage.getItem('juntos.pass.abcd-efgh-ijk')") == "Ab12cd", "and its passcode")
    b.close()

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
