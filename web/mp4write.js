// Recording for browsers that can't record MP4 themselves (Firefox): the picture is encoded to H.264 with the
// browser's own encoder (WebCodecs), the sound to MP3 (lamejs, vendor/lamejs, LGPL), and both are written into a
// plain MP4 here. H.264 + MP3 in MP4 plays on phones and goes through WhatsApp; Firefox can't encode AAC.
import { box, full } from "./mp4fix.js";

const VIDEO = { codec: "avc1.42E01F", width: 1280, height: 720, bitrate: 2_500_000, framerate: 25, avc: { format: "annexb" } };
const VTS = 90000; // video timescale
const KBPS = 96;

let lamePromise = null;
function loadLame() {
  if (window.lamejs) return Promise.resolve();
  lamePromise ||= new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = new URL("vendor/lamejs/lame.min.js", import.meta.url).href;
    s.onload = ok;
    s.onerror = fail;
    document.head.appendChild(s);
  });
  return lamePromise;
}

export class WcRecorder {
  /** True where this path works: H.264 encoding in the browser, an AudioWorklet, and MP3-friendly sample rates. */
  static async supported(sampleRate) {
    try {
      if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined" || typeof AudioWorkletNode === "undefined") return false;
      if (sampleRate !== 44100 && sampleRate !== 48000) return false;
      return !!(await VideoEncoder.isConfigSupported(VIDEO)).supported;
    } catch {
      return false;
    }
  }

  async start(audio, bus) {
    await loadLame();
    this.video = []; // { data, ts (us), key }
    this.sps = null;
    this.pps = null;
    this.failed = null;
    this.venc = new VideoEncoder({
      output: (chunk) => this.onVideo(chunk),
      error: (e) => { this.failed = e; this.onfail?.(); },
    });
    this.venc.configure(VIDEO);
    this.frames = 0;
    this.t0 = performance.now();

    this.rate = audio.sampleRate;
    this.mp3 = new window.lamejs.Mp3Encoder(1, this.rate, KBPS);
    this.mp3parts = [];
    const code = `registerProcessor("tap", class extends AudioWorkletProcessor {
      process(inputs) { const ch = inputs[0][0]; this.port.postMessage(ch ? ch.slice() : new Float32Array(128)); return true; }
    });`;
    await audio.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: "text/javascript" })));
    this.tap = new AudioWorkletNode(audio, "tap", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit" });
    this.tap.port.onmessage = (e) => this.onAudio(e.data);
    bus.connect(this.tap);
    const mute = audio.createGain();
    mute.gain.value = 0;
    this.tap.connect(mute).connect(audio.destination); // keeps the tap running; nothing is heard
    this.ready = true;
  }

  frame(canvas) {
    if (!this.ready || this.failed || this.venc.state !== "configured") return;
    if (this.venc.encodeQueueSize > 4) return; // the encoder is behind: drop this picture rather than pile up
    const ts = Math.round((performance.now() - this.t0) * 1000);
    const f = new VideoFrame(canvas, { timestamp: ts });
    this.venc.encode(f, { keyFrame: this.frames++ % 50 === 0 });
    f.close();
  }

  onVideo(chunk) {
    const raw = new Uint8Array(chunk.byteLength);
    chunk.copyTo(raw);
    // Annex B (start codes) -> 4-byte lengths; parameter sets go into the sample entry, not the samples
    const nals = splitAnnexB(raw);
    const keep = [];
    for (const n of nals) {
      const type = n[0] & 0x1f;
      if (type === 7) this.sps ||= n;
      else if (type === 8) this.pps ||= n;
      else if (type !== 9) keep.push(n);
    }
    if (!keep.length) return;
    const out = new Uint8Array(keep.reduce((s, n) => s + 4 + n.length, 0));
    const dv = new DataView(out.buffer);
    let o = 0;
    for (const n of keep) { dv.setUint32(o, n.length); out.set(n, o + 4); o += 4 + n.length; }
    this.video.push({ data: out, ts: chunk.timestamp, key: chunk.type === "key" });
  }

  onAudio(f32) {
    const pcm = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, f32[i] * 32768));
    const out = this.mp3.encodeBuffer(pcm);
    if (out.length) this.mp3parts.push(new Uint8Array(out.buffer, out.byteOffset, out.length).slice());
  }

  /** Stops and returns the finished MP4 file, or null if no picture was encoded. */
  async stop() {
    this.ready = false;
    try { this.tap?.disconnect(); } catch {}
    try { await this.venc.flush(); } catch (e) { this.failed ||= e; }
    try { this.venc.close(); } catch {}
    const tail = this.mp3.flush();
    if (tail.length) this.mp3parts.push(new Uint8Array(tail.buffer, tail.byteOffset, tail.length).slice());
    if (!this.sps || !this.pps || !this.video.length) return null; // after a failure, keep what was encoded
    return writeMp4(this.video, this.sps, this.pps, mp3Frames(concat(this.mp3parts)), this.rate);
  }
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function splitAnnexB(b) {
  const out = [];
  let start = -1;
  for (let i = 0; i + 2 < b.length; i++) {
    if (b[i] === 0 && b[i + 1] === 0 && (b[i + 2] === 1 || (b[i + 2] === 0 && b[i + 3] === 1))) {
      const sc = b[i + 2] === 1 ? 3 : 4;
      if (start >= 0) out.push(trimZeros(b.subarray(start, i)));
      start = i + sc;
      i += sc - 1;
    }
  }
  if (start >= 0 && start < b.length) out.push(b.subarray(start));
  else if (start < 0 && b.length) out.push(b); // no start codes: one NAL
  return out.filter((n) => n.length);
}
const trimZeros = (n) => { let e = n.length; while (e > 0 && n[e - 1] === 0) e--; return n.subarray(0, e); };

// MPEG-1 Layer III frames (lamejs writes MPEG-1 at 44.1/48 kHz): split the stream at frame headers
const BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const RATES = [44100, 48000, 32000];
function mp3Frames(b) {
  const out = [];
  for (let i = 0; i + 4 <= b.length; ) {
    if (b[i] !== 0xff || (b[i + 1] & 0xfe) !== 0xfa) { i++; continue; } // sync + MPEG-1 + Layer III
    const br = BITRATES[b[i + 2] >> 4], sr = RATES[(b[i + 2] >> 2) & 3], pad = (b[i + 2] >> 1) & 1;
    if (!br || !sr) { i++; continue; }
    const len = Math.floor((144000 * br) / sr) + pad;
    if (i + len > b.length) break;
    out.push(b.subarray(i, i + len));
    i += len;
  }
  return out;
}

const u16 = (v) => [(v >> 8) & 255, v & 255];
const u32 = (v) => [(v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255];
const bytes = (...a) => new Uint8Array(a.flat());
const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].flatMap(u32);

function writeMp4(video, sps, pps, audio, rate) {
  // durations: each picture lasts until the next one; the last one 1/25 s
  const vs = video.map((s, i) => ({
    data: s.data, key: s.key,
    dur: Math.max(1, Math.round(((i + 1 < video.length ? video[i + 1].ts : s.ts + 40000) - s.ts) * VTS / 1e6)),
  }));
  const as = audio.map((data) => ({ data, dur: 1152 }));
  const vDur = vs.reduce((n, s) => n + s.dur, 0);
  const aDur = as.length * 1152;
  const movie = Math.max(Math.round((vDur * 1000) / VTS), Math.round((aDur * 1000) / rate));

  // interleave about one second of each track at a time
  const chunks = [];
  for (let i = 0; i < vs.length; i += 25) chunks.push({ track: 0, from: i, to: Math.min(vs.length, i + 25), t: i / 25 });
  const per = Math.round(rate / 1152);
  for (let i = 0; i < as.length; i += per) chunks.push({ track: 1, from: i, to: Math.min(as.length, i + per), t: i / per });
  chunks.sort((a, b) => a.t - b.t || a.track - b.track);
  const tracks = [vs, as];
  const dataLen = vs.reduce((n, s) => n + s.data.length, 0) + as.reduce((n, s) => n + s.data.length, 0);

  const ftyp = box("ftyp", bytes([..."isom"].map((c) => c.charCodeAt(0)), u32(512), [..."isomiso2avc1mp41"].map((c) => c.charCodeAt(0))));
  const build = (mdatData) => {
    const offs = [[], []];
    let o = mdatData;
    for (const c of chunks) {
      offs[c.track].push({ off: o, n: c.to - c.from });
      for (let k = c.from; k < c.to; k++) o += tracks[c.track][k].data.length;
    }
    const stbl = (entry, S, off, sync) => {
      const stts = [];
      for (const s of S) { const l = stts[stts.length - 1]; if (l && l[1] === s.dur) l[0]++; else stts.push([1, s.dur]); }
      const stsc = [];
      off.forEach((c, k) => { if (!stsc.length || stsc[stsc.length - 1][1] !== c.n) stsc.push([k + 1, c.n, 1]); });
      const parts = [box("stsd", bytes(u32(0), u32(1)), entry),full("stts", 0, 0, [stts.length, ...stts.flat()])];
      if (sync) { const ss = S.map((s, k) => (s.key ? k + 1 : 0)).filter(Boolean); parts.push(full("stss", 0, 0, [ss.length, ...ss])); }
      parts.push(full("stsc", 0, 0, [stsc.length, ...stsc.flat()]));
      parts.push(full("stsz", 0, 0, [0, S.length, ...S.map((s) => s.data.length)]));
      parts.push(full("stco", 0, 0, [off.length, ...off.map((c) => c.off)]));
      return box("stbl", ...parts);
    };
    const dinf = box("dinf", box("dref", bytes(u32(0), u32(1)), full("url ", 0, 1, [])));
    const hdlr = (h) => box("hdlr", bytes(u32(0), u32(0), [...h].map((c) => c.charCodeAt(0)), u32(0), u32(0), u32(0), [0]));
    const mdhd = (ts, dur) => full("mdhd", 0, 0, [0, 0, ts, dur, 0x55c40000]);
    const tkhd = (id, dur, vol, w, h) => box("tkhd", bytes(u32(3), u32(0), u32(0), u32(id), u32(0), u32(dur), u32(0), u32(0), u16(0), u16(0), u16(vol), u16(0), MATRIX, u32(w << 16), u32(h << 16)));

    const avcC = box("avcC", bytes([1, sps[1], sps[2], sps[3], 0xff, 0xe1], u16(sps.length), [...sps], [1], u16(pps.length), [...pps]));
    const avc1 = box("avc1", bytes(Array(6).fill(0), u16(1), u16(0), u16(0), u32(0), u32(0), u32(0), u16(VIDEO.width), u16(VIDEO.height),
      u32(0x00480000), u32(0x00480000), u32(0), u16(1), Array(32).fill(0), u16(0x18), u16(0xffff)), avcC);
    const vtrak = box("trak",
      tkhd(1, Math.round((vDur * 1000) / VTS), 0, VIDEO.width, VIDEO.height),
      box("mdia", mdhd(VTS, vDur), hdlr("vide"), box("minf", full("vmhd", 0, 1, [0, 0]), dinf, stbl(avc1, vs, offs[0], true))));

    // MP3 in MP4: an mp4a entry whose decoder config says object type 0x6B (MPEG-1 audio)
    const dcd = bytes([0x04, 13, 0x6b, 0x15], [0, 0, 0], u32(KBPS * 1000), u32(KBPS * 1000));
    const esd = bytes([0x03, 3 + dcd.length + 3], u16(1), [0], [...dcd], [0x06, 1, 2]);
    const esds = box("esds", bytes(u32(0), [...esd]));
    const mp4a = box("mp4a", bytes(Array(6).fill(0), u16(1), u32(0), u32(0), u16(1), u16(16), u16(0), u16(0), u32(rate << 16 >>> 0)), esds);
    const atrak = box("trak",
      tkhd(2, Math.round((aDur * 1000) / rate), 0x0100, 0, 0),
      box("mdia", mdhd(rate, aDur), hdlr("soun"), box("minf", box("smhd", bytes(u32(0), u16(0), u16(0))), dinf, stbl(mp4a, as, offs[1], false))));
    const mvhd = box("mvhd", bytes(u32(0), u32(0), u32(0), u32(1000), u32(movie), u32(0x00010000), u16(0x0100), u16(0), u32(0), u32(0), MATRIX, Array(24).fill(0), u32(3)));
    return box("moov", mvhd, ...(as.length ? [vtrak, atrak] : [vtrak]));
  };
  let moov = build(0);
  moov = build(ftyp.length + moov.length + 8);
  const out = new Uint8Array(ftyp.length + moov.length + 8 + dataLen);
  out.set(ftyp, 0);
  out.set(moov, ftyp.length);
  let o = ftyp.length + moov.length;
  new DataView(out.buffer).setUint32(o, 8 + dataLen);
  out.set([109, 100, 97, 116], o + 4);
  o += 8;
  for (const c of chunks) for (let k = c.from; k < c.to; k++) { out.set(tracks[c.track][k].data, o); o += tracks[c.track][k].data.length; }
  return out;
}
