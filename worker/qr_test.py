# The QR codes Juntos draws decode back to the same text (OpenCV's reader), for every size 1-10.
# Run: python qr_test.py
import json
import subprocess
import sys
import numpy as np
import cv2

TEXTS = ["a", "https://meet.jurisgames.com/r/abc-defg-hij", "Juntos ñandú 😀 " * 3] + ["x" * n for n in (14, 26, 42, 62, 84, 106, 122, 152, 180, 213)]
JS = "import {qrMatrix} from './web/qr.js'; const t = JSON.parse(process.argv[1]); console.log(JSON.stringify(t.map((s) => { const m = qrMatrix(s); return m && m.map((r) => r.map((d) => (d ? 1 : 0)).join('')); })));"
import os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = subprocess.run(["node", "--input-type=module", "-e", JS, json.dumps(TEXTS)], cwd=root, capture_output=True, text=True, encoding="utf-8", timeout=60)
mats = json.loads(out.stdout)
errors = []
det = cv2.QRCodeDetector()
for text, m in zip(TEXTS, mats):
    a = np.array([[0 if c == "1" else 255 for c in row] for row in m], dtype=np.uint8)
    a = np.pad(a, 4, constant_values=255)
    img = cv2.resize(a, (a.shape[1] * 8, a.shape[0] * 8), interpolation=cv2.INTER_NEAREST)
    got, _, _ = det.detectAndDecode(img)
    ver = (len(m) - 17) // 4
    ok = got == text
    print(("ok   " if ok else "FAIL ") + f"version {ver}, {len(text.encode())} bytes", flush=True)
    if not ok:
        errors.append(text[:20])
check_none = subprocess.run(["node", "--input-type=module", "-e", "import {qrMatrix} from './web/qr.js'; console.log(qrMatrix('x'.repeat(214)) === null)"], cwd=root, capture_output=True, text=True, timeout=60).stdout.strip()
print(("ok   " if check_none == "true" else "FAIL ") + "too long gives no code")
if check_none != "true":
    errors.append("too long")
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
