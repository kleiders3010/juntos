// When two people in a call can't connect to each other (both behind strict routers, and the relay can't be
// reached or doesn't help either), a third person connected to both passes things on between them: their sound and
// video (which that person gets anyway as part of the call) and their messages, sealed with a key only the two of
// them have (exchanged through the call's signaling, never through the helper), so the helper can't read or change
// them. No server is needed for it. Small calls only (a big call has its tree for this).
//
// The person with the lower id asks (_need) the people they are connected to; the first who reaches the other one
// (_can) is asked to help (_fwd). The helper sends each one the other's sound and video on new transceivers, under
// a stream id it announces first (_fwdon), and passes sealed messages (_fw). When the helper or one of them goes,
// the helper says so (_fwdoff) and the two try a direct connection again.
import { cleanName } from "./names.js";

const b64u = (u) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const enc = new TextEncoder();
const dec = new TextDecoder();

export class Fwd {
  constructor(mesh) {
    this.m = mesh;
    this.ecdh = null; // my ECDH key pair for sealed messages (made on first need)
    this.keys = new Map(); // id -> { p: Promise<CryptoKey>, ok: resolve, sent: bool }
    this.asked = new Map(); // id -> time I asked my connections for a helper to them
    this.via = new Map(); // stream id (from a helper) -> whose sound and video it carries
    this.early = new Map(); // stream id -> tracks that came before the helper's _fwdon
    this.earlyOn = new Map(); // id -> a helper's _fwdon that came before my own link to them gave up (J5)
    this.helping = new Map(); // "a|b" -> { a, b, senders: { [id]: RTCRtpSender[] } }
    this.chains = new Map(); // id -> promise: sealed messages to them leave in order
    this.stats = { asked: 0, helped: 0, sealedOut: 0, sealedIn: 0, unreadable: 0 };
  }

  // ---- the two who can't connect ----

  // the direct connection to p gave up for good: ask the people I'm connected to for a helper
  need(p) {
    const m = this.m;
    if (m.big || m.closed || p.via || m.id > p.id) return; // the lower id asks; the other waits for _fwdon
    const t = this.asked.get(p.id);
    if (t && Date.now() - t < 20000) return;
    this.asked.set(p.id, Date.now());
    p.helper = null;
    this.stats.asked++;
    this.sendKey(p.id);
    const s = JSON.stringify({ k: "_need", id: p.id });
    for (const q of m.peers.values()) if (q !== p && !q.via && !q.far && q.dc.readyState === "open") q.dc.send(s);
  }

  // a helper offers: the first one gets the job
  can(from, id) {
    const m = this.m;
    const p = m.peers.get(id);
    const z = m.peers.get(from);
    if (!p || !z || p.via || p.state === "connected" || !this.asked.has(id) || p.helper || z.dc.readyState !== "open") return;
    p.helper = from;
    z.dc.send(JSON.stringify({ k: "_fwd", id }));
  }

  // the helper says it now passes on `of`'s sound and video (under stream sid) and messages
  on(from, of, sid, name) {
    const m = this.m;
    if (of === m.id || typeof sid !== "string" || !m.peers.has(from)) return;
    const old = m.peers.get(of);
    // Only a helper I'm owed (safety round 2, J5): `of` is someone already in the call; the side that asked takes only
    // the helper it picked; the other side only once its own direct link to them has given up (an offer that comes
    // a little early waits for that, 30 s at most). A working link is never replaced.
    if (!old) return;
    if (old.via !== from) {
      if (old.state === "connected" || (old.pc && old.pc.connectionState === "connected")) return;
      if (m.id < of && old.helper !== from) return;
      if (m.id > of && !old.gaveUp) return void this.earlyOn.set(of, { from, sid, name, at: Date.now() });
    }
    if (old && old.via === from) {
      this.via.set(sid, of);
    } else {
      if (old) m.forget(old);
      const p = {
        id: of,
        via: from,
        pc: null,
        dc: { readyState: "open", send: (s) => this.seal(from, of, s) },
        name: (old && old.name) || cleanName(name, 60),
        stream: old ? old.stream : new MediaStream(),
        audio: null,
        video: null,
        state: "connected",
        cid: "",
      };
      for (const t of p.stream.getTracks()) p.stream.removeTrack(t);
      m.peers.set(of, p);
      this.via.set(sid, of);
      this.sendKey(of);
    }
    for (const t of this.early.get(sid) || []) this.track(sid, t);
    this.early.delete(sid);
    m.emit("peer", { id: of });
    m.emit("channel-open", { id: of });
    m.retune();
  }

  // a track came with a stream id: forwarded sound or video (a person's own tracks come without one)
  track(sid, track) {
    const of = this.via.get(sid);
    if (!of) {
      this.early.set(sid, [...(this.early.get(sid) || []), track]);
      return;
    }
    const p = this.m.peers.get(of);
    if (!p || !p.via) return;
    for (const t of p.stream.getTracks()) if (t.kind === track.kind && t !== track) p.stream.removeTrack(t);
    if (!p.stream.getTracks().includes(track)) p.stream.addTrack(track);
    this.m.emit("peer", { id: of });
  }

  // my direct link to p gave up (rtc.js giveUp): a helper's offer that came before it is taken now
  gaveUp(p) {
    const w = this.earlyOn.get(p.id);
    this.earlyOn.delete(p.id);
    if (w && Date.now() - w.at < 30000) this.on(w.from, p.id, w.sid, w.name);
  }

  // the helper stopped (it left, or lost one of us): try the direct way again
  off(from, of) {
    const m = this.m;
    const p = m.peers.get(of);
    if (!p || p.via !== from) return;
    for (const [sid, id] of this.via) if (id === of) this.via.delete(sid);
    this.asked.delete(of);
    m.forget(p);
    if (m.id < of) return m.call(of, p.name);
    // the other one calls: hold their place (same picture) until the offer comes
    for (const t of p.stream.getTracks()) p.stream.removeTrack(t);
    m.peers.set(of, { id: of, pc: null, dc: { readyState: "connecting", send() {} }, name: p.name, stream: p.stream, audio: null, video: null, state: "connecting", cid: "" });
    m.emit("peer", { id: of });
  }

  // ---- sealed messages between the two ----

  async myKey() {
    this.ecdh ||= crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]);
    return this.ecdh;
  }
  slot(id) {
    let s = this.keys.get(id);
    if (!s) {
      let ok;
      s = { p: new Promise((r) => (ok = r)), ok, sent: false };
      this.keys.set(id, s);
    }
    return s;
  }
  // my public half goes to them through the call's signaling (the relays or the room server), never the helper
  async sendKey(id) {
    const s = this.slot(id);
    if (s.sent) return;
    s.sent = true;
    const k = await this.myKey();
    const raw = b64u(new Uint8Array(await crypto.subtle.exportKey("raw", k.publicKey)));
    this.m.sendSignal({ t: "signal", to: id, data: { fwk: raw } });
  }
  async gotKey(from, raw) {
    if (typeof raw !== "string" || raw.length > 120) return;
    const s = this.slot(from);
    if (s.have) return;
    s.have = true;
    try {
      const k = await this.myKey();
      const theirs = await crypto.subtle.importKey("raw", unb64u(raw), { name: "ECDH", namedCurve: "P-256" }, false, []);
      s.ok(await crypto.subtle.deriveKey({ name: "ECDH", public: theirs }, k.privateKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]));
    } catch (_) {
      s.have = false;
      return;
    }
    this.sendKey(from); // they may not have mine yet
  }

  seal(helper, to, text) {
    const next = (this.chains.get(to) || Promise.resolve()).then(async () => {
      const key = await Promise.race([this.slot(to).p, new Promise((r) => setTimeout(() => r(null), 10000))]);
      const z = this.m.peers.get(helper);
      if (!key || !z || z.dc.readyState !== "open") return;
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(text)));
      const out = new Uint8Array(12 + ct.length);
      out.set(iv);
      out.set(ct, 12);
      z.dc.send(JSON.stringify({ k: "_fw", to, c: b64u(out) }));
      this.stats.sealedOut++;
    });
    this.chains.set(to, next.catch(() => {}));
  }

  async open(helper, from, c) {
    const p = this.m.peers.get(from);
    if (!p || p.via !== helper || typeof c !== "string") return;
    try {
      const key = await this.slot(from).p;
      const b = unb64u(c);
      const text = dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.slice(0, 12) }, key, b.slice(12)));
      this.stats.sealedIn++;
      this.m.onDc(from, text);
    } catch (_) {
      this.stats.unreadable++;
    }
  }

  // ---- the helper ----

  // someone asks whether I reach `id`
  asks(from, id) {
    const q = this.m.peers.get(id);
    const z = this.m.peers.get(from);
    if (!q || !z || q.via || q.far || q.state !== "connected" || q.dc.readyState !== "open") return;
    z.dc.send(JSON.stringify({ k: "_can", id }));
  }

  // pass a and b's sound and video to each other, and their sealed messages
  start(a, b) {
    const m = this.m;
    const pa = m.peers.get(a);
    const pb = m.peers.get(b);
    const key = [a, b].sort().join("|");
    if (!pa || !pb || pa.via || pb.via || this.helping.has(key)) return;
    if (pa.dc.readyState !== "open" || pb.dc.readyState !== "open") return;
    const h = { a, b, senders: {} };
    this.helping.set(key, h);
    this.stats.helped++;
    for (const [src, dst] of [
      [pa, pb],
      [pb, pa],
    ]) {
      const ms = new MediaStream();
      dst.dc.send(JSON.stringify({ k: "_fwdon", of: src.id, sid: ms.id, name: src.name }));
      const tracks = [src.audio && src.audio.receiver.track, src.video && src.video.receiver.track].filter(Boolean);
      h.senders[dst.id] = tracks.map((t) => dst.pc.addTransceiver(t, { direction: "sendonly", streams: [ms] }).sender);
      if (!dst.offerer) dst.reneg = true; // the other side made this connection: I offer the new tracks myself
    }
  }

  pass(from, to, c) {
    const key = [from, to].sort().join("|");
    const q = this.m.peers.get(to);
    if (!this.helping.has(key) || !q || q.dc.readyState !== "open" || typeof c !== "string" || c.length > 200000) return;
    q.dc.send(JSON.stringify({ k: "_fw", from, c }));
  }

  // someone I help for left or lost me: tell the other one, stop sending
  gone(id) {
    for (const [key, h] of this.helping) {
      if (h.a !== id && h.b !== id) continue;
      this.helping.delete(key);
      const other = h.a === id ? h.b : h.a;
      const q = this.m.peers.get(other);
      if (q && q.dc.readyState === "open") q.dc.send(JSON.stringify({ k: "_fwdoff", of: id }));
      for (const s of h.senders[other] || []) {
        try {
          q?.pc?.removeTrack(s);
        } catch (_) {}
      }
    }
  }

  // a message on a direct data channel that belongs to this; true if handled
  onMsg(from, msg) {
    switch (msg.k) {
      case "_need":
        return typeof msg.id === "string" && this.asks(from, msg.id), true;
      case "_can":
        return typeof msg.id === "string" && this.can(from, msg.id), true;
      case "_fwd":
        return typeof msg.id === "string" && this.start(from, msg.id), true;
      case "_fwdon":
        return typeof msg.of === "string" && this.on(from, msg.of, msg.sid, msg.name), true;
      case "_fwdoff":
        return typeof msg.of === "string" && this.off(from, msg.of), true;
      case "_fw":
        if (typeof msg.to === "string") this.pass(from, msg.to, msg.c);
        else if (typeof msg.from === "string") this.open(from, msg.from, msg.c);
        return true;
    }
    return false;
  }
}
