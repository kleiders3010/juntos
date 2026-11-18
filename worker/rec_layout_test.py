# Recording layout with two people, one holding a phone upright (a portrait camera): the file must be landscape,
# the portrait person must be shown whole (not cut), and whoever talks takes the big spot.
# Saves frames as PNG next to the file for a look. Run: python rec_layout_test.py [base-url]
# (start the local server first: npx wrangler dev --port 8797). Needs ffmpeg/ffprobe on PATH.
import sys, os, json, subprocess, tempfile
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8797"
WS = BASE.replace("http", "ws", 1)
OUT = os.environ.get("REC_OUT") or tempfile.mkdtemp()
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
OTHER = '.tile:not([data-id="me"])'
# Beto's camera becomes a portrait picture (360x640, green with a white frame at its very edge), like a phone held upright
PORTRAIT = """() => { const c = document.createElement('canvas'); c.width = 360; c.height = 640; const x = c.getContext('2d');
  setInterval(() => { x.fillStyle = '#0a0'; x.fillRect(0, 0, 360, 640); x.strokeStyle = '#fff'; x.lineWidth = 16; x.strokeRect(8, 8, 344, 624);
    x.fillStyle = '#fff'; x.font = '40px sans-serif'; x.fillText(String(Date.now() % 1000), 100, 320) }, 40);
  const tr = c.captureStream(25).getVideoTracks()[0]; __S.camTrack = tr; return __S.mesh.setTracks(__S.micTrack, tr) }"""
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)

    def person():
        pg = b.new_context(locale="en-US", permissions=["camera", "microphone"], accept_downloads=True).new_page()
        pg.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        return pg

    a = person()
    a.goto(f"{BASE}/?signal={WS}")
    a.click("#start")
    a.fill("#name", "Ana")
    a.click("#enter")
    a.wait_for_selector("#call:not([hidden])")
    o = person()
    o.goto(f"{a.url}{'&' if '?' in a.url else '?'}signal={WS}")
    o.fill("#name", "Beto")
    o.click("#enter")
    a.wait_for_function(f"document.querySelector('{OTHER} .status')?.hidden", timeout=20000)
    o.evaluate(PORTRAIT)
    o.evaluate("document.getElementById('bMic').click()")  # Beto mutes: only Ana talks
    a.wait_for_function(f"document.querySelector('{OTHER} video').videoHeight > document.querySelector('{OTHER} video').videoWidth", timeout=10000)
    a.evaluate("document.getElementById('bRec').click()")
    a.click('#recGo')  # the sheet that says what is recorded
    a.wait_for_timeout(3000)
    first = a.evaluate("__S.recorder.main")
    check(first != "me", "nobody talked yet: the other person is the big one")
    # Ana talks: her microphone becomes a steady tone (the fake one only beeps once a second); Beto is muted
    a.evaluate("""() => { const ac = new AudioContext(), o = ac.createOscillator(), d = ac.createMediaStreamDestination(), g = ac.createGain();
      g.gain.value = 0.3; o.connect(g); g.connect(d); o.start(); __S.micTrack = d.stream.getAudioTracks()[0]; return __S.mesh.setTracks(__S.micTrack, __S.mesh.videoTrack) }""")
    a.wait_for_function("__S.recorder.main === 'me'", timeout=8000)
    check(True, "Ana talks: she takes the big spot")
    a.wait_for_timeout(500)
    # what happens in the call shows in the picture: Beto reacts, raises his hand, writes in the chat
    o.evaluate("""() => { __S.mesh.broadcast({ k: 'react', e: '🎉' }); __S.mesh.broadcast({ k: 'hand', on: true });
      __S.mesh.broadcast({ k: 'chat', text: 'Hola! This line is long enough to need a second line in the recording, and then some more words so it gets cut off' }) }""")
    a.wait_for_timeout(300)
    check(a.evaluate("__S.recorder.floats.length === 1 && __S.recorder.chats.length === 1"), "the reaction and the chat message reach the recording")
    a.wait_for_timeout(900)
    with a.expect_download(timeout=20000) as dl:
        a.evaluate("document.getElementById('bRec').click()")
    path = os.path.join(OUT, "layout.mp4")
    dl.value.save_as(path)
    b.close()

info = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=width,height", "-select_streams", "v", "-of", "json", path],
                                 capture_output=True, text=True, creationflags=0x08000000).stdout)["streams"][0]
check(info["width"] > info["height"], f"the file is landscape: {info['width']}x{info['height']}")
# a frame from the start (Beto big): his white frame must be fully inside the picture
png = os.path.join(OUT, "beto-big.png")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "1.5", "-i", path, "-frames:v", "1", png], creationflags=0x08000000)  # machine-queue: light
subprocess.run(["ffmpeg", "-v", "error", "-y", "-sseof", "-0.5", "-i", path, "-frames:v", "1", os.path.join(OUT, "ana-big.png")], creationflags=0x08000000)  # machine-queue: light
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", png, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, creationflags=0x08000000).stdout  # machine-queue: light
W, H = info["width"], info["height"]
px = lambda x, y: raw[(y * W + x) * 3:(y * W + x) * 3 + 3]
white = lambda c: min(c) > 200
row = [white(px(x, H // 2)) for x in range(W)]
xs = [x for x, w in enumerate(row) if w]
# the portrait picture is 640 high in a 720 frame: centred, ~405 wide; both white side edges must show
check(len(xs) > 0 and xs[0] > W * 0.25 and xs[-1] < W * 0.75, f"Beto's whole picture is visible and centred (white edges at x {xs[0] if xs else '-'}..{xs[-1] if xs else '-'})")
col = [white(px(W // 2, y)) for y in range(H)]
ys = [y for y, w in enumerate(col) if w]
check(len(ys) > 0 and ys[0] < 24 and ys[-1] > H - 25, f"its top and bottom borders are in the picture (y {ys[0] if ys else '-'}..{ys[-1] if ys else '-'})")
side = px(60, 60)
check(sum(side) > 30, f"the sides are a soft fill of the picture, not black ({tuple(side)})")
print("frames:", OUT)
print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
