# 27b feasibility: can a middle peer forward ENCODED (encrypted) frames A -> R -> B without decoding?
# A encrypts frames (xor stand-in) in a sender transform; R's receiver transform posts frames to R's sender
# transform on the R->B connection (sender track = a dummy canvas track), which swaps in A's frame data;
# B decrypts in a receiver transform. Pass = B's <video> shows frames of A's size and keeps playing.
import sys
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

PAGE = r"""<!doctype html><body><video id=v autoplay muted playsinline></video><script>
const W = `
let fwd = null;            // R: frames from A waiting to go out
const ch = new BroadcastChannel('x');
onrtctransform = (e) => {
  const t = e.transformer, role = t.options.role;
  let n = 0;
  if (role === 'encA') t.readable.pipeThrough(new TransformStream({ transform(f, c) {
      const d = new Uint8Array(f.data); for (let i = 1; i < d.length; i++) d[i] ^= 0x5a; f.data = d.buffer; c.enqueue(f); } })).pipeTo(t.writable);
  if (role === 'decB') t.readable.pipeThrough(new TransformStream({ transform(f, c) {
      const d = new Uint8Array(f.data); for (let i = 1; i < d.length; i++) d[i] ^= 0x5a; f.data = d.buffer; n++; if (n % 30 == 1) postMessage({ role, n, type: f.type }); c.enqueue(f); } })).pipeTo(t.writable);
  if (role === 'relayIn') { const r = t.readable.getReader(); (async () => { for (;;) { const { value, done } = await r.read(); if (done) break;
      self.last = value; self.q = (self.q || []); self.q.push(value); if (self.q.length > 30) self.q.shift(); n++; if (n % 60 == 1) postMessage({ role, n, type: value.type, meta: value.getMetadata() }); } })(); }
  if (role === 'relayOut') t.readable.pipeThrough(new TransformStream({ transform(f, c) {
      const src = (self.q || []).shift(); if (!src) return; // drop the dummy frame when nothing to forward
      try { c.enqueue(src); n++; if (n % 60 == 1) postMessage({ role, n, how: 'same-frame-object' }); }
      catch (err) { postMessage({ role, err: String(err) }); } } })).pipeTo(t.writable);
};`;
const w = new Worker(URL.createObjectURL(new Blob([W])));
window.log = []; w.onmessage = (e) => log.push(e.data); w.onerror = (e) => log.push({ werr: e.message });
async function pair(a, b) {
  a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate);
  b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate);
}
async function nego(a, b) { await a.setLocalDescription(); await b.setRemoteDescription(a.localDescription); await b.setLocalDescription(); await a.setRemoteDescription(b.localDescription); }
window.run = async () => {
  window.hasTransform = typeof RTCRtpScriptTransform;
  const cam = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
  const A = new RTCPeerConnection(), R1 = new RTCPeerConnection(), R2 = new RTCPeerConnection(), B = new RTCPeerConnection();
  pair(A, R1); pair(R2, B);
  const sA = A.addTrack(cam.getVideoTracks()[0]); sA.transform = new RTCRtpScriptTransform(w, { role: 'encA' });
  R1.ontrack = (e) => { e.receiver.transform = new RTCRtpScriptTransform(w, { role: 'relayIn' }); };
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 48; const g = cv.getContext('2d');
  setInterval(() => { g.fillStyle = '#' + Math.floor(Math.random() * 4095).toString(16).padStart(3, '0'); g.fillRect(0, 0, 64, 48); }, 33);
  const dummy = cv.captureStream(30).getVideoTracks()[0];
  const sR = R2.addTrack(dummy); sR.transform = new RTCRtpScriptTransform(w, { role: 'relayOut' });
  B.ontrack = (e) => { e.receiver.transform = new RTCRtpScriptTransform(w, { role: 'decB' }); document.getElementById('v').srcObject = new MediaStream([e.track]); };
  await nego(A, R1); await nego(R2, B);
  return 'started';
};
</script>"""

ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)
    pg = b.new_context(permissions=["camera"]).new_page()
    pg.route("http://probe.localhost/", lambda r: r.fulfill(body=PAGE, content_type="text/html"))
    pg.goto("http://probe.localhost/")
    print("RTCRtpScriptTransform:", pg.evaluate("typeof RTCRtpScriptTransform"), pg.evaluate("navigator.userAgent"))
    print(pg.evaluate("run()"))
    pg.wait_for_timeout(6000)
    print("video:", pg.evaluate("[v.videoWidth, v.videoHeight, v.currentTime.toFixed(2), v.getVideoPlaybackQuality?.().totalVideoFrames]"))
    for x in pg.evaluate("log")[-12:]:
        print(x)
    b.close()
