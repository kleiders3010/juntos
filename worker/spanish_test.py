# Every English text the page can show has a Spanish entry (UX review 2026-11-22: new screens kept shipping English
# in Spanish). Looks at t("...") calls in web/*.js, bar buttons (button(id, icon, "Label")), the camera and
# microphone messages (MEDIA_MSG) and the text, title, placeholder and aria-label of web/index.html.
# Run: python spanish_test.py
import glob
import os
import re
import sys
from html.parser import HTMLParser

web = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web")
src = {os.path.basename(f): open(f, encoding="utf-8").read() for f in glob.glob(os.path.join(web, "*.js"))}
LIT = r'"((?:[^"\\]|\\.)*)"'


def unq(s):
    return s.encode("utf-8").decode("unicode_escape").encode("latin-1").decode("utf-8") if "\\" in s else s


# the Spanish keys: the es block of i18n.js and the FEEDBACK_ES block of feedback.js
keys = set()
for name, start in (("i18n.js", "es: {"), ("feedback.js", "FEEDBACK_ES")):
    s = src[name]
    block = s[s.index(start):]
    keys |= {unq(k) for k in re.findall(r'^\s*' + LIT + r'\s*:', block, re.M)}

shown = {}
for name, s in src.items():
    if name in ("i18n.js",):
        continue
    for k in re.findall(r'(?<![\w$])t2?\(\s*' + LIT, s):
        shown.setdefault(unq(k), name)
    for k in re.findall(r'button\("\w+", "\w+", ' + LIT, s):
        shown.setdefault(unq(k), name)
m = re.search(r"const MEDIA_MSG = \{(.*?)\n\};", src["app.js"], re.S)
for k in re.findall(r'^\s+\w+: ' + LIT + ',?$', m.group(1), re.M):
    shown.setdefault(unq(k), "app.js MEDIA_MSG")


class Page(HTMLParser):
    skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.skip += 1
        for a, v in attrs:
            if a in ("title", "placeholder", "aria-label") and v:
                shown.setdefault(v, "index.html")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.skip -= 1

    def handle_data(self, data):
        d = re.sub(r"\s*·\s*$", "", data.strip())
        if d and not self.skip:
            shown.setdefault(d, "index.html")


# colour names (t(COLOR_NAMES[c]))
for name, s in src.items():
    for block in re.findall(r"const COLOR_NAMES = \{(.*?)\};", s, re.S):
        for k in re.findall(r': ' + LIT, block):
            shown.setdefault(unq(k), name + " COLOR_NAMES")
for page in ("index.html", "offline.html"):
    Page().feed(open(os.path.join(web, page), encoding="utf-8").read())
# words that are the same in Spanish, names, and the page title
SAME = {"Juntos", "github.com/kleiders3010/juntos", "✕", "●", "OK", "Chat", "Host", "hello@jurisgames.com"}
missing = sorted(k for k in shown if k not in keys and k not in SAME and re.search(r"[A-Za-z]{2}", k))
for k in missing:
    print(f"missing Spanish ({shown[k]}): {k}")
# one Spanish word per concept (UX review U-J12, APP-RULES 160): the link is "enlace", the passcode is "clave" (the
# call's own code is "código"), locking is "bloquear la entrada" ("cerrar" ends breakout rooms)
s = src["i18n.js"]
es = dict((unq(k), unq(v)) for k, v in re.findall(r'^\s*' + LIT + r'\s*:\s*\n?\s*' + LIT, s[s.index("es: {"):], re.M))
for k, v in es.items():
    bad = []
    if re.search(r"\blink\b", v):
        bad.append('"link" (say "enlace")')
    if re.search(r"passcode", k, re.I) and re.search(r"c[oó]digo", v, re.I):
        bad.append('"código" for the passcode (say "clave")')
    if re.search(r"\b(un)?lock", k, re.I) and re.search(r"\b(cerr|abr)", v, re.I):
        bad.append('"cerrar/abrir" for locking (say "bloquear/desbloquear la entrada")')
    for b in bad:
        missing.append(k)
        print(f"Spanish word: {k} -> {v}: {b}")
print("errors:", len(missing))
print("OK" if not missing else "FAILED")
sys.exit(1 if missing else 0)
