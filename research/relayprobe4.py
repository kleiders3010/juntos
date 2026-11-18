# 27b feasibility, route 2: WebCodecs encode at A -> AES-GCM -> data channel -> R forwards bytes (can't read them)
# -> data channel -> B decrypts -> VideoDecoder -> MediaStreamTrackGenerator -> <video>. Measures fps and delay at B.
import sys
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

PAGE = r"""<!doctype html><body><video id=v autoplay muted playsinline></video><script>
async function pair(a, b) {
  a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate);
  b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate);
}
async function nego(a, b) { await a.setLocalDescription(); await b.setRemoteDescription(a.localDescription); await b.setLocalDescription(); await a.setRemoteDescription(b.localDescription); }
const open = (dc) => new Promise((r) => dc.readyState === 'open' ? r() : (dc.onopen = r));
window.stat = { sent: 0, fwd: 0, got: 0, dec: 0, delay: [], keyBytes: 0, bytes: 0, err: '' };
window.run = async () => {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 128 }, false, ['encrypt', 'decrypt']);
  const A = new RTCPeerConnection(), R1 = new RTCPeerConnection(), R2 = new RTCPeerConnection(), B = new RTCPeerConnection();
  pair(A, R1); pair(R2, B);
  const opt = { ordered: false, maxRetransmits: 0 };
  const dA = A.createDataChannel('m', opt), dR2 = R2.createDataChannel('m', opt);
  const gotR1 = new Promise((r) => (R1.ondatachannel = (e) => r(e.channel)));
  const gotB = new Promise((r) => (B.ondatachannel = (e) => r(e.channel)));
  await nego(A, R1); await nego(R2, B);
  const dR1 = await gotR1, dB = await gotB;
  await open(dA); await open(dR2); await open(dR1); await open(dB);
  dR1.binaryType = dB.binaryType = 'arraybuffer';
  dR1.onmessage = (e) => { stat.fwd++; dR2.send(e.data); }; // the relay only moves bytes
  // B: decrypt + decode
  const gen = new MediaStreamTrackGenerator({ kind: 'video' }); const wr = gen.writable.getWriter();
  document.getElementById('v').srcObject = new MediaStream([gen]);
  const dec = new VideoDecoder({ output: (f) => { stat.dec++; wr.write(f); }, error: (e) => (stat.err = String(e)) });
  dec.configure({ codec: 'vp8' });
  let needKey = true;
  dB.onmessage = async (e) => {
    stat.got++;
    const buf = e.data, hv = new DataView(buf);
    const isKey = hv.getUint8(0) === 1, ts = hv.getFloat64(1), sentAt = hv.getFloat64(9), iv = new Uint8Array(buf, 17, 12);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, new Uint8Array(buf, 29));
    if (needKey && !isKey) return; needKey = false;
    stat.delay.push(performance.now() - sentAt);
    dec.decode(new EncodedVideoChunk({ type: isKey ? 'key' : 'delta', timestamp: ts, data: plain }));
  };
  // A: camera -> VideoEncoder -> encrypt -> send
  const cam = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, frameRate: 30 } });
  const proc = new MediaStreamTrackProcessor({ track: cam.getVideoTracks()[0] }); const rd = proc.readable.getReader();
  const enc = new VideoEncoder({ output: async (chunk) => {
    const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
    const out = new Uint8Array(29 + ct.length), dv = new DataView(out.buffer);
    dv.setUint8(0, chunk.type === 'key' ? 1 : 0); dv.setFloat64(1, chunk.timestamp); dv.setFloat64(9, performance.now()); out.set(iv, 17); out.set(ct, 29);
    if (chunk.type === 'key') stat.keyBytes = out.length; stat.bytes += out.length;
    if (dA.bufferedAmount < 1e6) { dA.send(out); stat.sent++; }
  }, error: (e) => (stat.err = String(e)) });
  enc.configure({ codec: 'vp8', width: 640, height: 480, bitrate: 600000, framerate: 30, latencyMode: 'realtime' });
  let n = 0;
  (async () => { for (;;) { const { value, done } = await rd.read(); if (done) break; if (enc.encodeQueueSize > 2) { value.close(); continue; } enc.encode(value, { keyFrame: n++ % 90 === 0 }); value.close(); } })();
  return 'started';
};
</script>"""

ARGS = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=ARGS)
    pg = b.new_context(permissions=["camera"]).new_page()
    pg.route("http://probe.localhost/", lambda r: r.fulfill(body=PAGE, content_type="text/html"))
    pg.goto("http://probe.localhost/")
    print(pg.evaluate("run()"))
    pg.wait_for_timeout(1000)
    s0 = pg.evaluate("({...stat, delay: 0})")
    pg.wait_for_timeout(5000)
    s1 = pg.evaluate("({...stat, delay: stat.delay.slice(-100).sort((a,b)=>a-b)})")
    print("decoded fps over 5 s:", (s1['dec'] - s0['dec']) / 5, "sent", s1['sent'], "fwd", s1['fwd'], "got", s1['got'], "err", s1['err'])
    d = s1['delay']
    print("delay ms median/p95:", round(d[len(d) // 2], 1) if d else None, round(d[int(len(d) * .95)], 1) if d else None, "kbps:", round(s1['bytes'] * 8 / 6 / 1000), "key bytes:", s1['keyBytes'])
    print("video:", pg.evaluate("[v.videoWidth, v.videoHeight, v.currentTime.toFixed(2)]"))
    b.close()
