// Big calls (past 16 people). A link from everyone to everyone asks too much of phones past that, so the room
// server arranges the call as a tree: each device links to one parent and a few children (as many as it said
// it can feed). Sound, pictures and messages are passed along the tree, device to device, never through a server.
//
// - Media: each device encodes its own sound (Opus) and picture (VP8) once, with WebCodecs, and sends the
//   encoded bytes on an unordered, no-retry data channel to its links. Every device passes what it gets on to
//   its other links and decodes it for itself. Nothing is decoded and encoded again on the way.
// - Sound only goes out while someone talks (silence costs nothing); a picture goes out while its person is
//   "on stage": a host, someone sharing their screen, or someone who spoke in the last STAGE_MS.
// - Messages (chat, captions, hands) are passed along the same way, signed by who wrote them (ECDSA P-256; the
//   room server hands out the public keys), so someone passing them along can't change them or write in
//   another person's name.

export const BIG_OK =
  typeof VideoEncoder === "function" &&
  typeof AudioEncoder === "function" &&
  typeof MediaStreamTrackProcessor === "function" &&
  typeof MediaStreamTrackGenerator === "function";

const STAGE_MS = 20000; // a picture stays on this long after its person last spoke
const TALK_HOLD = 700; // ms of sound still sent after the voice drops (ends of words)
const LOUD = 0.012; // RMS that counts as talking
const FRAG = 60000; // the largest piece sent at once (data channel messages over 64 KB aren't safe everywhere)
const KEY_EVERY = 3000; // ms between keyframes, so someone who just joined sees a picture soon
const V_KBPS = 300;
const V_FPS = 15;
const V_W = 640;
const enc = new TextEncoder();
const dec = new TextDecoder();

const b64u = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/** This device's signing key for the call: { priv, pub } (pub travels in the hello, base64url of the raw point). */
export async function makeKeys() {
  const k = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  return { priv: k.privateKey, pub: b64u(new Uint8Array(await crypto.subtle.exportKey("raw", k.publicKey))) };
}

const SIGN = { name: "ECDSA", hash: "SHA-256" };

export class Big {
  constructor(mesh) {
    this.mesh = mesh;
    this.links = new Set(); // ids of my parent and children
    this.seq = 0;
    this.seen = new Map(); // src -> Set of recent message/media keys (a piece is passed on once)
    this.keys = new Map(); // src -> imported public key (promise)
    this.chains = new Map(); // src -> promise: one person's messages are checked and shown in order
    this.out = Promise.resolve(); // my own messages are signed and sent in order
    this.rx = new Map(); // src -> decoders and generated tracks
    this.frags = new Map();
    this.mseq = { 1: 0, 2: 0 };
    this.spoke = 0;
    this.lastLoud = 0;
    this.stats = { sent: 0, fwd: 0, got: 0, decA: 0, decV: 0, bad: 0, keyAsk: 0, dropped: 0 };
    this.watch = setInterval(() => this.idleCheck(), 1000);
  }

  // ---- links ----

  channel(id, media) {
    const p = this.mesh.peers.get(id);
    return p && !p.far ? (media ? p.mc : p.dc) : null;
  }

  linkSend(except, data, media) {
    for (const id of this.links) {
      if (id === except) continue;
      const ch = this.channel(id, media);
      if (!ch || ch.readyState !== "open") continue;
      // a link that can't keep up loses pictures, not everyone else's turn (sound is small and goes first)
      if (media && ch.bufferedAmount > (media === 1 ? 2e6 : 5e5)) {
        this.stats.dropped++;
        continue;
      }
      try {
        ch.send(data);
      } catch (_) {}
    }
  }

  dup(src, key) {
    let s = this.seen.get(src);
    if (!s) this.seen.set(src, (s = new Set()));
    if (s.has(key)) return true;
    s.add(key);
    if (s.size > 3000) {
      const old = [...s].slice(0, 1500);
      for (const k of old) s.delete(k);
    }
    return false;
  }

  // ---- messages ----

  /** Send a message along the tree: to everyone, to one person (to), or to my breakout room (rc). */
  post(m, to, rc) {
    const s = this.mesh.id;
    const n = ++this.seq;
    this.dup(s, "m" + n);
    this.out = this.out.then(async () => {
      const body = JSON.stringify([s, n, to || "", rc ? 1 : 0, m]);
      const sig = b64u(new Uint8Array(await crypto.subtle.sign(SIGN, this.mesh.keys.priv, enc.encode(body))));
      this.linkSend(null, JSON.stringify({ _r: 1, s, n, to: to || "", rc: rc ? 1 : 0, m, sig }));
    }).catch(() => {});
  }

  pubKey(src) {
    let k = this.keys.get(src);
    const raw = this.mesh.pubs.get(src);
    if (!k && raw) {
      k = crypto.subtle.importKey("raw", unb64u(raw), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
      this.keys.set(src, k);
    }
    return k;
  }

  onRelay(from, raw, o) {
    if (typeof o.s !== "string" || typeof o.n !== "number" || o.s === this.mesh.id || this.dup(o.s, "m" + o.n)) return;
    // pass it on first (whoever is further down doesn't wait for my check; they check it themselves)
    if (o.to !== this.mesh.id) this.linkSend(from, raw);
    if (o.to && o.to !== this.mesh.id) return;
    const prev = this.chains.get(o.s) || Promise.resolve();
    const next = prev
      .then(async () => {
        const k = this.pubKey(o.s);
        if (!k) return (this.stats.bad++, null);
        const body = JSON.stringify([o.s, o.n, o.to || "", o.rc ? 1 : 0, o.m]);
        const ok = await crypto.subtle.verify(SIGN, await k, unb64u(String(o.sig || "")), enc.encode(body));
        if (!ok) return (this.stats.bad++, null);
        if (o.rc && !this.mesh.route(o.s)) return;
        if (o.m && o.m._kf) return this.keyAsked();
        this.mesh.emit("message", { from: o.s, msg: o.m });
      })
      .catch(() => {});
    this.chains.set(o.s, next);
  }

  // ---- my own sound and picture ----

  async setTracks(audio, video) {
    if (audio !== this.aTrack) {
      this.stopReader("a");
      this.aTrack = audio || null;
      if (audio) this.startAudio(audio);
    }
    if (video !== this.vTrack) {
      this.stopReader("v");
      this.vTrack = video || null;
      if (video) this.startVideo(video);
    }
  }

  stopReader(k) {
    const r = this[k + "Run"];
    if (r) {
      r.stop = true;
      r.reader.cancel().catch(() => {});
      try {
        r.enc.close();
      } catch (_) {}
    }
    this[k + "Run"] = null;
  }

  onStage() {
    const v = this.vTrack;
    const screen = !!(v && v.getSettings && v.getSettings().displaySurface);
    return screen || this.mesh.amHost || performance.now() - this.spoke < STAGE_MS;
  }

  startAudio(track) {
    const run = { stop: false };
    this.aRun = run;
    run.reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
    run.enc = new AudioEncoder({
      output: (chunk) => {
        // only while I talk (and a little after): silence isn't sent at all
        if (performance.now() - this.lastLoud > TALK_HOLD) return;
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        this.sendMedia(1, run.flags, chunk.timestamp, data);
      },
      error: () => {},
    });
    (async () => {
      let buf = null;
      for (;;) {
        const { value, done } = await run.reader.read().catch(() => ({ done: true }));
        if (done || run.stop) {
          value?.close();
          break;
        }
        if (!run.configured) {
          const rate = value.sampleRate === 44100 ? 44100 : 48000;
          const ch = value.numberOfChannels > 1 ? 2 : 1;
          run.flags = (rate === 44100 ? 2 : 0) | (ch === 2 ? 4 : 0);
          run.enc.configure({ codec: "opus", sampleRate: rate, numberOfChannels: ch, bitrate: 32000 });
          run.configured = true;
        }
        // how loud: the first channel's RMS
        const n = value.numberOfFrames;
        if (!buf || buf.length < n) buf = new Float32Array(n);
        try {
          value.copyTo(buf, { planeIndex: 0, format: "f32-planar" });
          let sum = 0;
          for (let i = 0; i < n; i += 4) sum += buf[i] * buf[i];
          if (Math.sqrt(sum / (n / 4)) > LOUD && track.enabled) {
            this.lastLoud = performance.now();
            this.spoke = this.lastLoud;
          }
        } catch (_) {}
        try {
          run.enc.encode(value);
        } catch (_) {}
        value.close();
      }
    })();
  }

  startVideo(track) {
    const run = { stop: false, lastKey: 0, lastFrame: 0, wasOn: false };
    this.vRun = run;
    run.reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
    run.enc = new VideoEncoder({
      output: (chunk) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        this.sendMedia(2, chunk.type === "key" ? 1 : 0, chunk.timestamp, data);
      },
      error: () => {
        run.broken = true;
      },
    });
    (async () => {
      for (;;) {
        const { value, done } = await run.reader.read().catch(() => ({ done: true }));
        if (done || run.stop) {
          value?.close();
          break;
        }
        const now = performance.now();
        const on = this.onStage() && track.enabled;
        if (!on || now - run.lastFrame < 1000 / V_FPS - 5 || run.enc.encodeQueueSize > 2 || run.broken) {
          if (!on) run.wasOn = false;
          value.close();
          continue;
        }
        const w = Math.min(V_W, value.displayWidth) & ~1;
        const h = Math.round((w * value.displayHeight) / value.displayWidth) & ~1;
        if (run.w !== w || run.h !== h) {
          run.enc.configure({ codec: "vp8", width: w, height: h, bitrate: V_KBPS * 1000, framerate: V_FPS, latencyMode: "realtime" });
          run.w = w;
          run.h = h;
          run.wasOn = false;
        }
        const key = !run.wasOn || run.wantKey || now - run.lastKey > KEY_EVERY;
        if (key) {
          run.lastKey = now;
          run.wantKey = false;
        }
        run.wasOn = true;
        run.lastFrame = now;
        try {
          run.enc.encode(value, { keyFrame: key });
        } catch (_) {}
        value.close();
      }
    })();
  }

  // someone further along the tree joined or lost pieces and needs a whole picture
  keyAsked() {
    if (this.vRun) this.vRun.wantKey = true;
  }

  // header: kind(1 sound, 2 picture), flags, piece, pieces, u32 seq, f64 timestamp, src length, src, data
  sendMedia(kind, flags, ts, data) {
    const src = enc.encode(this.mesh.id);
    const seq = ++this.mseq[kind];
    const count = Math.max(1, Math.ceil(data.length / FRAG));
    for (let i = 0; i < count; i++) {
      const part = data.subarray(i * FRAG, (i + 1) * FRAG);
      const out = new Uint8Array(17 + src.length + part.length);
      const dv = new DataView(out.buffer);
      out[0] = kind;
      out[1] = flags;
      out[2] = i;
      out[3] = count;
      dv.setUint32(4, seq);
      dv.setFloat64(8, ts);
      out[16] = src.length;
      out.set(src, 17);
      out.set(part, 17 + src.length);
      this.dup(this.mesh.id, `${kind}:${seq}:${i}`);
      this.linkSend(null, out, kind);
      this.stats.sent++;
    }
  }

  // ---- everyone else's ----

  onMedia(from, buf) {
    const u = new Uint8Array(buf);
    if (u.length < 18) return;
    const dv = new DataView(buf);
    const kind = u[0], flags = u[1], i = u[2], count = u[3], seq = dv.getUint32(4), ts = dv.getFloat64(8);
    const src = dec.decode(u.subarray(17, 17 + u[16]));
    if (src === this.mesh.id || (kind !== 1 && kind !== 2) || this.dup(src, `${kind}:${seq}:${i}`)) return;
    this.linkSend(from, buf, kind);
    this.stats.fwd += this.links.size - 1;
    this.stats.got++;
    let data = u.subarray(17 + u[16]);
    if (count > 1) {
      const fk = `${src}:${kind}:${seq}`;
      let f = this.frags.get(fk);
      if (!f) {
        this.frags.set(fk, (f = { parts: new Array(count), n: 0, at: performance.now() }));
        if (this.frags.size > 50) for (const [k, v] of this.frags) if (performance.now() - v.at > 3000) this.frags.delete(k);
      }
      if (!f.parts[i]) {
        f.parts[i] = data.slice();
        f.n++;
      }
      if (f.n < count) return;
      this.frags.delete(fk);
      const all = new Uint8Array(f.parts.reduce((a, p) => a + p.length, 0));
      let o = 0;
      for (const p of f.parts) all.set(p, (o += p.length) - p.length);
      data = all;
    }
    this.play(src, kind, flags, seq, ts, data);
  }

  rxFor(src) {
    let r = this.rx.get(src);
    if (!r) this.rx.set(src, (r = { lastV: 0, needKey: true, askAt: 0, vSeq: 0 }));
    return r;
  }

  attach(src, track) {
    const p = this.mesh.peers.get(src);
    if (!p) return;
    if (!p.stream.getTracks().includes(track)) {
      for (const t of p.stream.getTracks()) if (t.kind === track.kind) p.stream.removeTrack(t);
      p.stream.addTrack(track);
    }
    if (track.kind === "video") p.noVideo = false;
    this.mesh.emit("peer", { id: src });
  }

  play(src, kind, flags, seq, ts, data) {
    const r = this.rxFor(src);
    try {
      if (kind === 1) {
        if (!r.adec || r.aflags !== flags) {
          try {
            r.adec?.close();
          } catch (_) {}
          r.aflags = flags;
          r.agen ||= new MediaStreamTrackGenerator({ kind: "audio" });
          r.awr ||= r.agen.writable.getWriter();
          r.adec = new AudioDecoder({
            output: (a) => {
              this.stats.decA++;
              if (r.awr.desiredSize <= 0) return a.close();
              r.awr.write(a).catch(() => {});
            },
            error: () => (r.adec = null),
          });
          r.adec.configure({ codec: "opus", sampleRate: flags & 2 ? 44100 : 48000, numberOfChannels: flags & 4 ? 2 : 1 });
          this.attach(src, r.agen);
        }
        r.adec.decode(new EncodedAudioChunk({ type: "key", timestamp: ts, data }));
        return;
      }
      const key = !!(flags & 1);
      r.lastV = performance.now();
      if (r.noVideo) {
        r.noVideo = false;
        if (r.vgen) this.attach(src, r.vgen);
      }
      // a lost piece of picture: wait for the next whole one (and ask for it, not too often)
      if (!key && (r.needKey || seq !== r.vSeq + 1)) {
        r.needKey = true;
        r.vSeq = seq;
        if (performance.now() - r.askAt > 1500) {
          r.askAt = performance.now();
          this.stats.keyAsk++;
          this.post({ _kf: 1 }, src);
        }
        return;
      }
      r.vSeq = seq;
      if (!r.vdec || r.vdec.state === "closed") {
        r.vgen ||= new MediaStreamTrackGenerator({ kind: "video" });
        r.vwr ||= r.vgen.writable.getWriter();
        r.vdec = new VideoDecoder({
          output: (f) => {
            this.stats.decV++;
            if (r.vwr.desiredSize <= 0) return f.close();
            r.vwr.write(f).catch(() => {});
          },
          error: () => {
            r.needKey = true;
          },
        });
        r.vdec.configure({ codec: "vp8", optimizeForLatency: true });
        this.attach(src, r.vgen);
      }
      if (r.vdec.decodeQueueSize > 8) {
        r.needKey = true; // this device can't keep up: skip to the next whole picture
        return;
      }
      r.needKey = false;
      r.vdec.decode(new EncodedVideoChunk({ type: key ? "key" : "delta", timestamp: ts, data }));
    } catch (_) {
      if (kind === 2) r.needKey = true;
    }
  }

  // a picture that stopped coming (its person left the stage) shows their name instead of a frozen frame
  idleCheck() {
    const now = performance.now();
    for (const [src, r] of this.rx) {
      const p = this.mesh.peers.get(src);
      if (!p) {
        this.drop(src);
        continue;
      }
      if (r.vgen && !r.noVideo && now - r.lastV > 2500) {
        r.noVideo = true;
        r.needKey = true;
        p.stream.removeTrack(r.vgen);
        p.noVideo = true;
        this.mesh.emit("peer", { id: src });
      }
    }
  }

  drop(src) {
    const r = this.rx.get(src);
    if (!r) return;
    for (const d of [r.adec, r.vdec])
      try {
        d?.close();
      } catch (_) {}
    r.agen?.stop();
    r.vgen?.stop();
    this.rx.delete(src);
    this.seen.delete(src);
    this.chains.delete(src);
  }

  close() {
    clearInterval(this.watch);
    this.stopReader("a");
    this.stopReader("v");
    for (const src of [...this.rx.keys()]) this.drop(src);
  }
}
