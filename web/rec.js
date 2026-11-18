import { t } from "./i18n.js";
import { defragment } from "./mp4fix.js";
import { WcRecorder } from "./mp4write.js";
// Recording on this device: every video tile drawn into one picture, every voice mixed into one
// sound track, saved as a file when it stops. Nothing is uploaded; no time limit.

export class Recorder {
  constructor(getTiles) {
    this.getTiles = getTiles; // () => [{ video: HTMLVideoElement, name, stream }]
  }

  static supported() {
    return typeof MediaRecorder !== "undefined" && !!HTMLCanvasElement.prototype.captureStream;
  }

  async start() {
    const W = 1280;
    const H = 720;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    this.audio = new (window.AudioContext || window.webkitAudioContext)();
    const dest = this.audio.createMediaStreamDestination();
    const bus = this.audio.createGain(); // every voice goes here, then to the recording
    bus.connect(dest);
    this.sources = new Map();
    const mix = () => {
      for (const t of this.getTiles()) {
        const tr = t.stream && t.stream.getAudioTracks()[0];
        if (!tr || this.sources.has(tr.id)) continue;
        const src = this.audio.createMediaStreamSource(new MediaStream([tr]));
        src.connect(bus);
        this.sources.set(tr.id, src);
      }
    };
    mix();
    this.running = true;
    const draw = () => {
      if (!this.running) return;
      mix();
      const tiles = this.getTiles();
      const n = Math.max(1, tiles.length);
      const cols = Math.ceil(Math.sqrt(n));
      const rows = Math.ceil(n / cols);
      const tw = W / cols;
      const th = H / rows;
      ctx.fillStyle = "#202124";
      ctx.fillRect(0, 0, W, H);
      tiles.forEach((t, i) => {
        const x = (i % cols) * tw;
        const y = Math.floor(i / cols) * th;
        const v = t.video;
        if (v && v.videoWidth) {
          const r = Math.min(tw / v.videoWidth, th / v.videoHeight);
          const vw = v.videoWidth * r;
          const vh = v.videoHeight * r;
          ctx.drawImage(v, x + (tw - vw) / 2, y + (th - vh) / 2, vw, vh);
        }
        ctx.fillStyle = "rgba(0,0,0,.55)";
        ctx.font = "20px system-ui, sans-serif";
        const label = t.name || "";
        const lw = ctx.measureText(label).width + 16;
        ctx.fillRect(x + 8, y + th - 38, lw, 30);
        ctx.fillStyle = "#fff";
        ctx.fillText(label, x + 16, y + th - 16);
      });
      this.wc?.frame(canvas);
    };
    // A worker's timer, so recording goes on while the tab is in the background.
    this.ticker = new Worker(URL.createObjectURL(new Blob(["setInterval(() => postMessage(0), 40)"], { type: "text/javascript" })));
    this.ticker.onmessage = draw;
    draw();
    this.stream = new MediaStream([...canvas.captureStream(25).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    this.startedAt = Date.now();
    this.parts = []; // finished files: { blob, ext }
    // MP4 (H.264 + AAC) where the browser records it; WhatsApp and most phones refuse WebM.
    const mp4 = ["video/mp4;codecs=avc1.42E01F,mp4a.40.2", "video/mp4;codecs=avc1,mp4a.40.2", "video/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
    if (mp4 && !Recorder.forceEncoder) return this.record(mp4);
    // Firefox can't record MP4: encode H.264 + MP3 ourselves and write the MP4 (mp4write.js)
    if (await WcRecorder.supported(this.audio.sampleRate)) {
      try {
        this.wc = new WcRecorder();
        await this.wc.start(this.audio, bus);
        this.wc.onfail = () => this.running && !this.rec && this.record(); // carry on in WebM if the encoder stops
        return;
      } catch {
        this.wc = null;
      }
    }
    this.record(); // last resort: WebM (Firefox on Android)
  }

  record(type) {
    type ||= ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
    this.mime = type;
    this.chunks = [];
    this.rec = new MediaRecorder(this.stream, type ? { mimeType: type, videoBitsPerSecond: 2_500_000 } : undefined);
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start(1000);
  }

  async stop() {
    this.running = false;
    this.ticker.terminate();
    if (this.wc) {
      const file = await this.wc.stop();
      if (file) this.parts.push({ blob: new Blob([file], { type: "video/mp4" }), ext: "mp4" });
    }
    if (this.rec) {
      await new Promise((done) => { this.rec.onstop = done; this.rec.stop(); });
      const type = this.rec.mimeType || this.mime || "video/webm";
      let blob = new Blob(this.chunks, { type });
      if (type.includes("mp4")) {
        // browsers write MP4 in pieces with no overall length; phones and WhatsApp want one plain file
        const plain = defragment(new Uint8Array(await blob.arrayBuffer()));
        if (plain) blob = new Blob([plain], { type: "video/mp4" });
      }
      this.parts.push({ blob, ext: type.includes("mp4") ? "mp4" : "webm" });
    }
    this.audio.close();
    const d = new Date(this.startedAt), p2 = (n) => String(n).padStart(2, "0");
    // local time, as the person sees it on their clock
    const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}h${p2(d.getMinutes())}`;
    this.parts.forEach((part, i) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(part.blob);
      a.download = `${t("Meeting")} ${stamp}${i ? ` (${i + 1})` : ""}.${part.ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  }
}

Recorder.forceEncoder = localStorage.getItem("juntos.recEncoder") === "1"; // test switch: the Firefox path in any browser
