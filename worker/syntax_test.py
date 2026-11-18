# Every web/*.js file parses as an ES module, the way the browser loads it (plain `node --check` reads .js files as
# CommonJS and once let a broken string literal through). Run: python syntax_test.py
import glob
import os
import subprocess
import sys

web = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web")
bad = []
for f in sorted(glob.glob(os.path.join(web, "*.js"))):
    with open(f, "rb") as src:
        r = subprocess.run(["node", "--input-type=module", "--check"], stdin=src, capture_output=True, timeout=60)
    if r.returncode:
        bad.append(os.path.basename(f))
        print("FAIL", os.path.basename(f), r.stderr.decode(errors="replace")[:400])
# A DOM handler property written as `el.onclick = () => a && b()` returns false whenever `a` is false, and a handler
# that returns false cancels the event: clicks did nothing (Send, checkboxes) and keys typed nothing. Use a block body.
import re
EVENTS = "click|dblclick|keydown|keyup|keypress|submit|input|change|mousedown|mouseup|pointerdown|pointerup|touchstart|touchend|wheel|contextmenu"
BOOL_HANDLER = re.compile(r"\.on(" + EVENTS + r") = (\([^)]*\)|\w+) => [^{\n]*(&&|\|\|)")
for f in sorted(glob.glob(os.path.join(web, "*.js"))):
    for n, line in enumerate(open(f, encoding="utf-8"), 1):
        if BOOL_HANDLER.search(line):
            bad.append(f"{os.path.basename(f)}:{n}")
            print("FAIL a handler that can return false (cancels the event):", os.path.basename(f), n, line.strip()[:120])
print("errors:", bad)
print("OK" if not bad else "FAILED")
sys.exit(1 if bad else 0)
