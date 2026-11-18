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
print("errors:", bad)
print("OK" if not bad else "FAILED")
sys.exit(1 if bad else 0)
