# Sharing a tab or screen with sound: the others hear it, also while the sharer's microphone is muted, and it stops
# with the share. (Kleider, 2026-11-18: "Screen sharing doesn't seem to share audio of the window".) The browser's
# picker is replaced by a stand-in that returns a picture and a steady tone, like a shared tab playing sound.
# Run: python share_audio_test.py [base-url]
import sys
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8798"
WS = BASE.replace("http", "ws", 1)
ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]
PICKER = """
navigator.mediaDevices.getDisplayMedia = async (o) => {
  window.__asked = o;
  const c = document.createElement('canvas'); c.width = 640; c.height = 360; const g = c.getContext('2d');
  setInterval(() => { g.fillStyle = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'); g.fillRect(0, 0, 640, 360) }, 100);
  const v = c.captureStream(15).getVideoTracks()[0];
  const tracks = [v];
  if (o && o.audio) { const ac = new AudioContext(), osc = ac.createOscillator(), d = ac.createMediaStreamDestination(), gn = ac.createGain();
    gn.gain.value = 0.4; osc.connect(gn); gn.connect(d); osc.start(); window.__tabSound = d.stream.getAudioTracks()[0]; tracks.push(window.__tabSound); }
  return new MediaStream(tracks);
};
"""
# how loud Ana's voice/sound is at Beto, from the arriving audio (energy grows while there is sound)
ENERGY = """() => Promise.all([...__S.mesh.peers.values()].map(p => p.pc.getStats().then(r => { let e = 0;
  r.forEach(x => { if (x.type === 'inbound-rtp' && x.kind === 'audio') e = x.totalAudioEnergy || 0 }); return e }))).then(a => a[0])"""
errors = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what, flush=True)
    if not ok:
        errors.append(what)


def grows(pg, secs=2.0):
    e1 = pg.evaluate(ENERGY)
    pg.wait_for_timeout(int(secs * 1000))
    return pg.evaluate(ENERGY) - e1


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)

    def page(name, script=""):
        ctx = b.new_context(locale="en-US", permissions=["camera", "microphone"], viewport={"width": 1280, "height": 760})
        if script:
            ctx.add_init_script(script)
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(f"pageerror ({name}): {e}"))
        return pg

    a = page("Ana", PICKER)
    a.goto(f"{BASE}/?signal={WS}")
    a.click("#start")
    a.wait_for_selector("#lobby:not([hidden])")
    a.fill("#name", "Ana")
    a.click("#enter")
    a.wait_for_selector("#call:not([hidden])")
    o = page("Beto")
    o.goto(f"{a.url}{'&' if '?' in a.url else '?'}signal={WS}")
    o.fill("#name", "Beto")
    o.click("#enter")
    o.wait_for_selector("#call:not([hidden])")
    for pg in (a, o):
        pg.wait_for_function("() => __S.mesh.peers.size === 1 && [...__S.mesh.peers.values()].every(p => p.dc && p.dc.readyState === 'open')", timeout=30000)

    # Ana mutes, then shares a tab that plays sound
    a.click("#bMic")
    a.wait_for_function("() => !__S.mic", timeout=3000)
    a.wait_for_timeout(1500)
    quiet = grows(o)
    a.click("#bScreen")
    a.wait_for_function("() => !!__S.screen", timeout=8000)
    check(a.evaluate("!!(__asked && __asked.audio)"), "the share asks the browser for the tab's or screen's sound")
    check(a.evaluate("!!(__asked && __asked.audio && __asked.audio.restrictOwnAudio)"), "and asks it to leave the call's own sound out")
    a.wait_for_timeout(1500)
    loud = grows(o)
    check(loud > max(quiet * 5, 1e-4), f"Beto hears the shared sound while Ana's microphone is muted (energy {quiet:.5f} -> {loud:.5f})")
    check(not a.evaluate("__S.mic"), "Ana's microphone stays muted")

    # stopping the share stops its sound
    a.click("#bScreen")
    a.wait_for_function("() => !__S.screen", timeout=8000)
    check(a.evaluate("__tabSound.readyState") == "ended", "stopping the share stops its sound")  # pinned: MediaStreamTrack state name
    a.wait_for_timeout(1500)
    after = grows(o)
    check(after < loud / 5, f"Beto no longer hears it (energy {after:.5f})")
    b.close()

print("errors:", errors)
print("OK" if not errors else "FAILED")
sys.exit(1 if errors else 0)
