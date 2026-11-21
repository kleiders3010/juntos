# Recording check in headless Edge with a fake camera: the saved file must be a plain MP4 (H.264 + AAC, one moov
# with the real length, then one mdat) so phones and WhatsApp take it. Run: python rec_test.py [base-url]
# [firefox | msedge | encoder]  (encoder = Edge forced onto the Firefox path: WebCodecs H.264 + MP3)
# (start the local server first: npx wrangler dev --port 8798). Needs ffprobe on PATH.
import sys, os, json, struct, subprocess, tempfile
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8798"
MODE = sys.argv[2] if len(sys.argv) > 2 else "msedge"
SECONDS = float(sys.argv[3]) if len(sys.argv) > 3 else 5
with sync_playwright() as p:
    if MODE == "firefox":
        b = p.firefox.launch(headless=True, firefox_user_prefs={"media.navigator.streams.fake": True, "media.navigator.permission.disabled": True,
                                                              "media.autoplay.default": 0})
        pg = b.new_context(accept_downloads=True).new_page()
    else:
        b = p.chromium.launch(headless=True, channel="msedge",
            args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"])
        pg = b.new_context(permissions=["camera", "microphone"], accept_downloads=True).new_page()
    if MODE == "encoder":
        pg.add_init_script("localStorage.setItem('juntos.recEncoder', '1')")
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(BASE + "/"); pg.click("#start"); pg.fill("#name", "Test"); pg.click("#enter")
    pg.wait_for_selector("#call:not([hidden])", timeout=20000); pg.wait_for_timeout(1500)
    pg.evaluate("(document.getElementById('bRec') || __S.barBtns.bRec).click()"); pg.click('#recGo'); pg.wait_for_timeout(int(SECONDS * 1000))
    with pg.expect_download(timeout=20000) as dl:
        pg.evaluate("(document.getElementById('bRec') || __S.barBtns.bRec).click()")
    path = os.path.join(os.environ.get("REC_OUT") or tempfile.mkdtemp(), MODE + ".mp4"); dl.value.save_as(path)
    name = dl.value.suggested_filename
    b.close()
assert not errs, errs
assert name.endswith(".mp4"), name
d = open(path, "rb").read(); i = 0; top = []
while i + 8 <= len(d):
    n = struct.unpack(">I", d[i:i + 4])[0]; top.append(d[i + 4:i + 8].decode("latin1")); i += n
assert top == ["ftyp", "moov", "mdat"], top
info = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_name", "-of", "json", path],
                                 capture_output=True, text=True, creationflags=0x08000000).stdout)
codecs = sorted(s["codec_name"] for s in info["streams"])
assert codecs == (["aac", "h264"] if MODE == "msedge" else ["h264", "mp3"]), codecs
assert abs(float(info["format"]["duration"]) - SECONDS) < 1.5, info["format"]
print("OK", MODE, name, codecs, info["format"]["duration"], "s")
