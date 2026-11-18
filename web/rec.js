import { t } from "./i18n.js";
import { defragment } from "./mp4fix.js";
import { WcRecorder } from "./mp4write.js";
// Recording on this device: one landscape picture (the person talking big and everyone else small, or all
// the same size), every voice mixed into one sound track, saved as a file when it stops. Nothing is
// uploaded; no time limit.

export class Recorder {
  constructor(getTiles, opts = {}) {
    this.getTiles = getTiles; // () => [{ id, video: HTMLVideoElement, name, stream, camoff, screen, hand }]
    this.opts = { layout: "speaker", reactions: true, hands: true, chat: true, ...opts };
    this.floats = []; // reactions rising over someone: { id, e, at, dx }
    this.chats = []; // recent chat lines shown at the top: { name, text, at }
    this.rects = new Map(); // where each person was drawn in the last frame
  }

  /** Something that happened in the call, for the picture: { kind: "react", id, e } or { kind: "chat", name, text }. */
  event(ev) {
    const now = performance.now();
    if (ev.kind === "react" && this.opts.reactions) this.floats.push({ id: ev.id, e: ev.e, at: now, dx: (Math.random() - 0.5) * 0.4 });
    if (ev.kind === "chat" && this.opts.chat) this.chats = [...this.chats, { name: ev.name, text: ev.text, at: now }].slice(-3);
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
    this.sources = new Map(); // audio track id -> { src, an, buf } (an: level meter for "who is talking")
    const mix = () => {
      for (const t of this.getTiles()) {
        const tr = t.stream && t.stream.getAudioTracks()[0];
        if (!tr || this.sources.has(tr.id)) continue;
        const src = this.audio.createMediaStreamSource(new MediaStream([tr]));
        src.connect(bus);
        const an = this.audio.createAnalyser();
        an.fftSize = 512;
        src.connect(an);
        this.sources.set(tr.id, { src, an, buf: new Uint8Array(an.fftSize) });
      }
    };
    mix();
    this.running = true;
    this.talk = new Map(); // tile id -> ms of recent talking
    this.small = document.createElement("canvas"); // a tiny copy, stretched: the soft blurred fill behind a picture
    this.small.width = 32;
    this.small.height = 18;
    const draw = () => {
      if (!this.running) return;
      mix();
      const tiles = this.getTiles();
      this.listen(tiles);
      ctx.fillStyle = "#202124";
      ctx.fillRect(0, 0, W, H);
      this.rects.clear();
      if (this.opts.layout === "grid" || tiles.length < 2) this.drawGrid(ctx, tiles, W, H);
      else this.drawSpeaker(ctx, tiles, W, H);
      this.drawFloats(ctx);
      this.drawChat(ctx, W);
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

  // Who is talking now: loudness per person, smoothed so the picture doesn't jump at every cough.
  listen(tiles) {
    for (const t of tiles) {
      const tr = t.stream && t.stream.getAudioTracks()[0];
      const m = tr && this.sources.get(tr.id);
      let level = 0;
      if (m && tr.enabled) {
        m.an.getByteTimeDomainData(m.buf);
        let sum = 0;
        for (const b of m.buf) sum += (b - 128) ** 2;
        level = Math.sqrt(sum / m.buf.length);
      }
      const was = this.talk.get(t.id) || 0;
      this.talk.set(t.id, level > 6 ? Math.min(3000, was + 40) : Math.max(0, was - 20));
    }
  }

  // Like Google Meet's recordings: the person talking (or a shared screen) fills the picture. Unlike Meet,
  // the others stay visible, small along the bottom, so a two-person call shows both faces.
  drawSpeaker(ctx, tiles, W, H) {
    const now = performance.now();
    const ids = tiles.map((t) => t.id);
    const screen = tiles.find((t) => t.screen && !t.camoff);
    let main = screen ? screen.id : this.main;
    if (!screen) {
      if (!ids.includes(main)) main = (tiles.find((t) => t.id !== "me") || tiles[0]).id; // nobody spoke yet: the other person
      // someone else talked for most of a second and the current one has been up for 2 s: switch
      let best = null;
      for (const t of tiles) {
        const k = this.talk.get(t.id) || 0;
        if (t.id !== main && k >= 700 && (!best || k > this.talk.get(best))) best = t.id;
      }
      if (best && now - (this.mainSince || 0) > 2000 && (this.talk.get(main) || 0) < 400) main = best;
    }
    if (main !== this.main) {
      this.main = main;
      this.mainSince = now;
    }
    const big = tiles.find((t) => t.id === main);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();
    this.drawTile(ctx, big, 0, 0, W, H, 26);
    ctx.restore();
    const rest = tiles.filter((t) => t !== big).slice(0, 6);
    const tw = 208;
    const th = 117;
    const gap = 12;
    let x = W - rest.length * (tw + gap);
    const y = H - th - gap;
    for (const t of rest) {
      ctx.save();
      round(ctx, x, y, tw, th, 10);
      ctx.clip();
      this.drawTile(ctx, t, x, y, tw, th, 15);
      ctx.restore();
      if ((this.talk.get(t.id) || 0) > 200) {
        ctx.strokeStyle = "#60a5fa";
        ctx.lineWidth = 3;
        round(ctx, x, y, tw, th, 10);
        ctx.stroke();
      }
      x += tw + gap;
    }
  }

  // Everyone the same size, in the rows and columns that make the pictures biggest.
  drawGrid(ctx, tiles, W, H) {
    const n = Math.max(1, tiles.length);
    let cols = 1;
    let best = 0;
    for (let c = 1; c <= n; c++) {
      const r = Math.ceil(n / c);
      const size = Math.min(W / c, ((H / r) * 16) / 9); // width of the biggest 16:9 picture a cell holds
      if (size > best + 0.5) {
        best = size;
        cols = c;
      }
    }
    const rows = Math.ceil(n / cols);
    const tw = W / cols;
    const th = H / rows;
    tiles.forEach((t, i) => {
      const row = Math.floor(i / cols);
      const inRow = row === rows - 1 ? n - cols * (rows - 1) : cols; // the last row is centred
      const x = (i % cols) * tw + ((cols - inRow) * tw) / 2;
      const y = row * th;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 2, y + 2, tw - 4, th - 4);
      ctx.clip();
      this.drawTile(ctx, t, x + 2, y + 2, tw - 4, th - 4, n > 4 ? 18 : 22);
      ctx.restore();
    });
  }

  // One person in a box: the whole camera picture (never cut) on a blurred copy of itself, or their initial.
  drawTile(ctx, t, x, y, w, h, font) {
    this.rects.set(t.id, { x, y, w, h });
    const v = t.video;
    if (v && v.videoWidth && !t.camoff) {
      const sx = this.small.getContext("2d");
      const cr = Math.max(32 / v.videoWidth, 18 / v.videoHeight);
      sx.drawImage(v, (32 - v.videoWidth * cr) / 2, (18 - v.videoHeight * cr) / 2, v.videoWidth * cr, v.videoHeight * cr);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.small, x - w * 0.1, y - h * 0.1, w * 1.2, h * 1.2); // past the edges: no grey rim (clipped by the box)
      ctx.fillStyle = "rgba(0,0,0,.45)";
      ctx.fillRect(x, y, w, h);
      const r = Math.min(w / v.videoWidth, h / v.videoHeight);
      const vw = v.videoWidth * r;
      const vh = v.videoHeight * r;
      ctx.drawImage(v, x + (w - vw) / 2, y + (h - vh) / 2, vw, vh);
    } else {
      ctx.fillStyle = "#3c4043";
      ctx.fillRect(x, y, w, h);
      const rad = Math.min(w, h) * 0.18;
      ctx.fillStyle = "#5f6368";
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = `${Math.round(rad)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText((t.name || "?").trim().charAt(0).toUpperCase(), x + w / 2, y + h / 2);
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
    }
    if (t.hand && this.opts.hands) {
      const s = Math.round(font * 2);
      ctx.fillStyle = "#facc15";
      round(ctx, x + font * 0.5, y + font * 0.5, s, s, s / 4);
      ctx.fill();
      ctx.font = `${Math.round(s * 0.62)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("✋", x + font * 0.5 + s / 2, y + font * 0.5 + s / 2 + 1);
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
    }
    const label = t.name || "";
    if (!label) return;
    ctx.font = `${font}px system-ui, sans-serif`;
    const pad = Math.round(font * 0.45);
    const lw = ctx.measureText(label).width + pad * 2;
    const lh = Math.round(font * 1.5);
    ctx.fillStyle = "rgba(0,0,0,.55)";
    ctx.fillRect(x + pad, y + h - lh - pad, lw, lh);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, x + pad * 2, y + h - pad - Math.round(lh * 0.3));
  }

  // Reactions rise from the bottom of the person who sent them, as they do on screen, and fade.
  drawFloats(ctx) {
    const now = performance.now();
    this.floats = this.floats.filter((f) => now - f.at < 2600);
    for (const f of this.floats) {
      const r = this.rects.get(f.id);
      if (!r) continue;
      const k = (now - f.at) / 2600;
      const size = Math.max(40, Math.min(72, r.h * 0.22));
      ctx.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : 1;
      ctx.font = `${Math.round(size)}px system-ui, "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(f.e, r.x + r.w * (0.5 + f.dx), r.y + r.h - size * 0.4 - k * r.h * 0.6);
      ctx.textAlign = "start";
      ctx.globalAlpha = 1;
    }
  }

  // The last chat lines, for 8 seconds each, top left: "Name: message", at most two lines each.
  drawChat(ctx, W) {
    const now = performance.now();
    this.chats = this.chats.filter((c) => now - c.at < 8000);
    let y = 16;
    const maxW = Math.min(560, W * 0.45);
    for (const c of this.chats) {
      ctx.font = "bold 20px system-ui, sans-serif";
      const nameW = ctx.measureText(`${c.name}: `).width;
      ctx.font = "20px system-ui, sans-serif";
      const lines = wrap(ctx, c.text, maxW - 28, nameW, 2);
      const h = 14 + lines.length * 26;
      const w = Math.min(maxW, 28 + Math.max(...lines.map((l, i) => ctx.measureText(l).width + (i ? 0 : nameW))));
      ctx.globalAlpha = now - c.at > 7400 ? (8000 - (now - c.at)) / 600 : 1;
      ctx.fillStyle = "rgba(17,24,39,.82)";
      round(ctx, 16, y, w, h, 10);
      ctx.fill();
      ctx.fillStyle = "#93c5fd";
      ctx.font = "bold 20px system-ui, sans-serif";
      ctx.fillText(`${c.name}: `, 30, y + 28);
      ctx.fillStyle = "#fff";
      ctx.font = "20px system-ui, sans-serif";
      lines.forEach((l, i) => ctx.fillText(l, 30 + (i ? 0 : nameW), y + 28 + i * 26));
      ctx.globalAlpha = 1;
      y += h + 8;
    }
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

function round(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

// Split text into at most `max` lines of width `w` (the first line starts `first` pixels in); "…" if it goes on.
function wrap(ctx, text, w, first, max) {
  const words = String(text).replace(/\s+/g, " ").trim().split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const room = w - (lines.length ? 0 : first);
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= room || !line) line = next;
    else {
      lines.push(line);
      line = word;
      if (lines.length === max) break;
    }
  }
  if (lines.length < max && line) lines.push(line);
  else if (line) lines[max - 1] += "…";
  return lines.map((l, i) => {
    const room = w - (i ? 0 : first);
    if (ctx.measureText(l).width <= room) return l;
    while (l.length > 1 && ctx.measureText(l + "…").width > room) l = l.slice(0, -1);
    return l + "…";
  });
}
Recorder.forceEncoder = localStorage.getItem("juntos.recEncoder") === "1"; // test switch: the Firefox path in any browser
