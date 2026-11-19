import { VIDEO_CAP } from "./net.js";
import { NostrSignal, NOSTR_OK } from "./nsig.js";
// Direct (mesh) WebRTC between everyone in a room. The signaling server only passes handshakes;
// audio, video, chat and the board go device to device.
//
// Who offers: the newcomer offers to everyone already there. Every connection carries one audio
// and one video sender (swapped with replaceTrack, so no renegotiation) and one data channel
// (negotiated id 0, created by both sides).
//
// Finding each other: through public Nostr relays first (nsig.js), so an ordinary call never touches our server
// and its free daily allowance. The server is used only when the call needs it: the host started it locked or
// with a passcode, someone was sent out of it, a host uses a host control (then everyone in the call opens the
// server link and newcomers are told to use it too), or no relay can be reached.
const MESH_MAX = 16; // same as the server's: big_test.py

const ICE = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];

export function randomId() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
}

export class Mesh extends EventTarget {
  constructor({ room, name, signalUrl, key, knock, pass, opts, relays }) {
    super();
    this.relays = relays; // null: our server only (tests, local development); [] = the public list; or test relays
    this.viaN = new Set(); // people whose handshake goes through the relays
    this.helloSeen = new Set();
    this.srv = false; // using our server
    this.pass = pass || ""; // the call's passcode, if it has one (typed, or from the link)
    this.opts = opts || null; // the host's choices when starting the call: { lock, pass }
    this.key = key || ""; // only the person who started the call has it: host controls
    this.knock = !!knock; // sent out of this call before: ask to come back in
    this.hosts = new Set(); // ids of the hosts among the others (the host and the co-hosts)
    this.owners = new Set(); // which of them started the call
    this.room = room;
    this.name = name;
    this.signalUrl = signalUrl;
    this.id = randomId();
    this.peers = new Map(); // id -> { pc, dc, name, stream, audio, video }
    this.audioTrack = null;
    this.videoTrack = null;
    this.closed = false;
    // who gets my sound and picture (breakout rooms: only the people in my room); everyone by default
    this.route = () => true;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  connect() {
    // the server decides who comes in: started locked / with a passcode, or I was sent out before
    if (!NOSTR_OK || this.relays == null || this.knock || this.pass || (this.opts && (this.opts.lock || this.opts.pass))) return this.goServer();
    this.listen().then((up) => {
      if (this.closed || this.srv) return;
      if (!up) return this.goServer();
      this.emit("signal-open", { relays: up });
      if (this.key) this.emit("host", { t: "room", locked: false, host: true, owner: true, pass: false, serverless: true });
      this.hello();
      this.emit("joined", { count: this.peers.size });
      // nobody answered: maybe the call uses our server (planned with a passcode or ask-to-join; or the relays
      // that the people in it use aren't reachable from here). One question to the server, only in that case.
      setTimeout(async () => {
        if (this.closed || this.srv || this.peers.size || this.viaN.size || this.key) return;
        try {
          const r = await (await fetch(`${this.signalUrl.replace(/^ws/, "http")}/info/${this.room}`, { cache: "no-store" })).json();
          if (r.server) this.goServer();
        } catch (_) {}
      }, 4500);
    });
  }

  // listen on the relays (also in a call that uses the server: newcomers there are told to use it)
  listen() {
    if (!this.ns) this.ns = new NostrSignal({ room: this.room, relays: this.relays && this.relays.length ? this.relays : null, onMsg: (m) => this.onRelay(m) });
    return this.ns.ready;
  }

  // say I'm here: now and twice more (a relay can be slow); later, again while I'm alone, for whoever comes
  hello() {
    const say = () => !this.closed && !this.srv && this.ns.send({ t: "hello", from: this.id, name: this.name });
    say();
    setTimeout(say, 1500);
    setTimeout(say, 4000);
    clearInterval(this.aloneTimer);
    this.aloneTimer = setInterval(() => !this.peers.size && say(), 20000);
  }

  onRelay(m) {
    if (this.closed || !m || typeof m.from !== "string" || m.from === this.id || (m.to && m.to !== this.id)) return;
    if (!/^[A-Za-z0-9_-]{6,40}$/.test(m.from)) return;
    const name = typeof m.name === "string" ? m.name.slice(0, 60) : "";
    if (m.t === "hello") {
      this.helloSeen.add(m.from);
      if (this.srv) return void this.ns.send({ t: "srv", from: this.id, to: m.from });
      if (this.peers.has(m.from)) return;
      if (this.peers.size + 1 >= MESH_MAX) return void this.ns.send({ t: "full", from: this.id, to: m.from });
      this.ns.send({ t: "here", from: this.id, to: m.from, name: this.name });
      this.viaN.add(m.from);
      this.emit("someone-joining", { id: m.from, name });
    } else if (m.t === "here") {
      if (this.srv || this.peers.has(m.from)) return;
      this.viaN.add(m.from);
      // two newcomers at once: only the one with the lower id calls
      if (this.helloSeen.has(m.from) && this.id > m.from) return;
      if (this.peers.size + 1 >= MESH_MAX) return this.emit("full", { max: MESH_MAX });
      this.call(m.from, name);
    } else if (m.t === "srv") {
      // this call uses our server now (a host control was used, or it started locked or with a passcode)
      this.goServer();
    } else if (m.t === "full") {
      if (!this.peers.size && !this.fullSaid) {
        this.fullSaid = true;
        this.emit("full", { max: MESH_MAX });
      }
    } else if (m.t === "signal" && this.viaN.has(m.from)) {
      this.onSignal({ t: "signal", from: m.from, data: m.data });
    } else if (m.t === "name" && this.peers.has(m.from)) {
      this.onSignal({ t: "name", id: m.from, name });
    } else if (m.t === "bye" && this.viaN.has(m.from) && !this.srv) {
      this.drop(m.from);
    }
  }

  // use our server from now on (keeps every connection already made; the server introduces whoever is missing)
  goServer() {
    if (this.srv || this.closed) return;
    this.srv = true;
    clearInterval(this.aloneTimer);
    if (this.ns) this.ns.send({ t: "srv", from: this.id });
    this.connectServer();
    if (this.relays != null && NOSTR_OK) this.listen(); // newcomers who look on the relays are sent here
  }

  connectServer() {
    const ws = new WebSocket(`${this.signalUrl}/ws/${this.room}`);
    this.ws = ws;
    ws.onopen = () => {
      this.tries = 0;
      this.emit("signal-open");
      this.sendSignal({ t: "hello", id: this.id, name: this.name, ...(this.key ? { key: this.key, claim: true, ...(this.opts ? { opts: this.opts } : {}) } : {}), ...(this.knock ? { knock: true } : {}), ...(this.pass ? { pass: this.pass } : {}) });
    };
    ws.onmessage = (e) => this.onSignal(JSON.parse(e.data));
    ws.onclose = () => {
      if (this.closed || this.ws !== ws) return; // an old link closing after a new one opened
      // The signaling link only matters for new handshakes; calls in progress go on.
      this.emit("signal-lost");
      this.lost = (this.lost || 0) + 1;
      const wait = Math.min(15000, 1000 * 2 ** (this.tries = (this.tries || 0) + 1));
      setTimeout(() => !this.closed && this.reconnect(), wait);
    };
  }

  reconnect() {
    // Same identity: connections still up stay as they are; broken ones are called again.
    for (const [id, p] of this.peers) if (p.state === "failed" || p.state === "closed") this.drop(id);
    this.connectServer();
  }

  sendSignal(m) {
    if (m.t === "signal" && this.ns && (this.viaN.has(m.to) || !this.srv)) return this.relaySignal(m);
    if (m.t === "name" && !this.srv && this.ns) return void this.ns.send({ t: "name", from: this.id, name: m.name });
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
  }

  // through the relays, network routes (ICE candidates) go out together a moment after they're found
  relaySignal(m) {
    const d = m.data;
    if (!d.ice) return void this.ns.send({ t: "signal", from: this.id, to: m.to, data: d });
    const k = m.to + "|" + d.cid;
    const b = ((this.iceOut ||= new Map()).get(k) || { list: [] });
    this.iceOut.set(k, b);
    b.list.push(d.ice);
    clearTimeout(b.timer);
    b.timer = setTimeout(() => {
      this.iceOut.delete(k);
      this.ns.send({ t: "signal", from: this.id, to: m.to, data: { ices: b.list, cid: d.cid, for: d.for } });
    }, 400);
  }

  onSignal(m) {
    if (m.t === "peers") {
      this.admitted = true;
      for (const c of (this.hostQueue || []).splice(0)) this.sendSignal(c);
      for (const p of m.peers) if (p.host) this.hosts.add(p.id);
      for (const p of m.peers) if (p.role === "host") this.owners.add(p.id);
      for (const p of m.peers) if (!this.peers.has(p.id)) this.call(p.id, p.name);
      this.emit("joined", { count: m.peers.length });
    } else if (m.t === "join") {
      const back = this.peers.get(m.id);
      if (back?.away) {
        back.away = false;
        clearTimeout(back.leaveTimer);
      }
      if (m.host) this.hosts.add(m.id);
      else this.hosts.delete(m.id);
      if (m.role === "host") this.owners.add(m.id);
      this.emit("someone-joining", { id: m.id, name: m.name });
    } else if (["room", "lock", "knock", "knock-gone", "waiting", "denied", "removed", "passcode", "pass", "perms", "role"].includes(m.t)) {
      // host controls: who may come in, mute, remove, the passcode (the server checks who is the host)
      if (m.t === "denied" || m.t === "removed" || m.t === "passcode") this.closed = true;
      if (m.t === "pass") this.pass = m.pass || "";
      if (m.t === "role" && m.id !== this.id) {
        if (m.role) this.hosts.add(m.id);
        else this.hosts.delete(m.id);
      }
      this.emit("host", m);
    } else if (m.t === "leave") {
      // The room server lost their link, but our own connection to them still works (a phone changing
      // network): they're still here, and come back to the server in a moment. If they really left, that
      // connection closes too and they're gone at once; if it stays up but they never come back, after 30 s.
      const p = this.peers.get(m.id);
      if (p && !m.removed && p.state === "connected" && p.dc.readyState === "open") {
        p.away = true;
        clearTimeout(p.leaveTimer);
        p.leaveTimer = setTimeout(() => this.peers.get(m.id) === p && p.away && this.drop(m.id), 30000);
        return;
      }
      this.drop(m.id);
    } else if (m.t === "name") {
      const p = this.peers.get(m.id);
      if (p) {
        p.name = m.name;
        this.emit("peer", { id: m.id });
      }
    } else if (m.t === "full") {
      this.emit("full", { max: m.max });
    } else if (m.t === "signal") {
      // one person's handshake messages are handled in order (an answer or a candidate must not overtake
      // the offer it belongs to); a failure is logged instead of silently leaving a half-made connection
      const q = (this.queues ||= new Map());
      // counts only, kept on this device (tests read them): which handshake messages came from whom
      const c = ((this.sigIn ||= {})[m.from] ||= { offer: 0, answer: 0, ice: 0, done: 0 });
      c[m.data && m.data.sdp ? m.data.sdp.type : "ice"]++;
      // a step on a connection that was closed meanwhile never finishes (that's how the WebRTC spec has it):
      // after a few seconds the next message goes ahead anyway, so it can't hold up everything from this person
      const step = () => Promise.race([this.onPeerSignal(m.from, m.data), new Promise((r) => setTimeout(r, 4000))]);
      const next = (q.get(m.from) || Promise.resolve()).then(step).catch((e) => {
        console.warn("juntos: handshake", m.from, e && e.message);
        this.emit("signal-error", { id: m.from, error: String((e && e.name) || e) });
      });
      q.set(m.from, next.then(() => c.done++));
    }
  }

  peer(id, name) {
    let p = this.peers.get(id);
    if (p) return p;
    // once a relay was needed in this call, new connections include it from the start
    const pc = new RTCPeerConnection({ iceServers: this.relayList ? [...ICE, ...this.relayList] : ICE });
    const dc = pc.createDataChannel("juntos", { negotiated: true, id: 0 });
    // cid: this connection's own id; rcid: the id of their end of it. Every handshake message carries both, so
    // a late answer or candidate meant for an older connection between the same two people is dropped instead
    // of being applied to the new one (which left connections stuck half-made in big calls).
    p = { id, pc, dc, name: name || "", stream: new MediaStream(), audio: null, video: null, state: "connecting", cid: randomId(), rcid: null };
    this.peers.set(id, p);
    // No direct connection within a few seconds (mobile networks often block it): try the relay now
    // instead of waiting the half minute a browser takes to give up.
    p.timer = setTimeout(() => p.state !== "connected" && this.viaRelay(p), 6000);
    pc.onicecandidate = (e) => e.candidate && this.sendSignal({ t: "signal", to: id, data: { ice: e.candidate, cid: p.cid, for: p.rcid } });
    pc.ontrack = (e) => {
      if (!p.stream.getTracks().includes(e.track)) p.stream.addTrack(e.track);
      this.emit("peer", { id });
    };
    // told they left while our connection still worked: once it closes, they're gone
    dc.addEventListener("close", () => (p.away || (this.viaN.has(id) && !this.srv)) && this.peers.get(id) === p && this.drop(id));
    pc.onconnectionstatechange = () => {
      if (this.peers.get(id) !== p) return; // replaced by a newer connection
      p.state = pc.connectionState;
      if (p.away && p.state !== "connected") return this.drop(id);
      clearTimeout(p.blip);
      if (p.state === "connected") {
        p.wasConnected = true;
        clearTimeout(p.timer);
        clearTimeout(p.giveUpTimer);
        p.gaveUp = false;
        p.relaying = false;
        this.tune(p); // the encodings exist now
      } else if (p.state === "failed") {
        if (p.relayTried) this.giveUp(p);
        else this.viaRelay(p);
      } else if (p.state === "disconnected") {
        // a short drop (changing wifi, a tunnel): if it lasts, look for a new route
        p.blip = setTimeout(() => p.state === "disconnected" && p.offerer && pc.restartIce(), 4000);
      }
      this.emit("peer", { id });
    };
    pc.onnegotiationneeded = async () => {
      if (!p.offerer) return;
      await pc.setLocalDescription();
      // the first offer of a connection says so: the other side drops any old, broken one it still holds
      this.sendSignal({ t: "signal", to: id, data: { sdp: pc.localDescription, name: this.name, fresh: !p.offered, cid: p.cid, for: p.rcid } });
      p.offered = true;
    };
    dc.onopen = () => this.emit("channel-open", { id });
    dc.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch (_) {
        return;
      }
      this.emit("message", { from: id, msg });
    };
    this.emit("peer", { id });
    return p;
  }

  // A direct connection failed (strict networks, some mobile carriers): try again through a relay.
  // Relay credentials come from our server, which caps how many it gives out a month.
  async viaRelay(p) {
    if (p.relayTried) return;
    p.relayTried = true;
    p.relaying = true;
    this.emit("peer", { id: p.id });
    if (!this.relay) {
      const http = this.signalUrl.replace(/^ws/, "http");
      this.relay = fetch(`${http}/turn`).then((r) => r.json()).then((j) => j.iceServers || []).catch(() => []);
    }
    const got = await this.relay;
    const servers = (Array.isArray(got) ? got : [got]).filter(Boolean);
    if (!servers.length) {
      this.emit("relay-unavailable", { id: p.id });
      return this.giveUp(p);
    }
    this.relayList = servers;
    if (this.peers.get(p.id) !== p || p.state === "connected") return;
    p.pc.setConfiguration({ iceServers: [...ICE, ...servers] });
    if (p.offerer) p.pc.restartIce();
    p.giveUpTimer = setTimeout(() => p.state !== "connected" && this.giveUp(p), 15000);
  }

  giveUp(p) {
    if (this.peers.get(p.id) !== p || p.state === "connected") return;
    // A connection can also stick half-way (one side's checks done, the other's not; seen in big calls
    // with many joining at once): before showing "Try again", the side that called starts a brand-new
    // connection by itself, twice at most. The other side drops its stuck one when the fresh offer arrives.
    const tries = p.autoRetries || 0;
    if (p.offerer && tries < 2 && !this.closed) {
      this.retry(p.id);
      const q = this.peers.get(p.id);
      if (q) q.autoRetries = tries + 1;
      return;
    }
    p.gaveUp = true;
    p.relaying = false;
    this.emit("peer", { id: p.id });
  }

  /** "Try again" on someone we couldn't reach: a brand-new connection (with the relay), offered by us. */
  retry(id) {
    const p = this.peers.get(id);
    if (!p) return;
    this.forget(p);
    this.call(id, p.name);
  }

  // close a connection without telling the app the person left (it is being replaced)
  forget(p) {
    clearTimeout(p.leaveTimer);
    clearTimeout(p.timer);
    clearTimeout(p.giveUpTimer);
    clearTimeout(p.blip);
    try {
      p.pc.close();
    } catch (_) {}
    if (this.peers.get(p.id) === p) this.peers.delete(p.id);
  }

  // We offer: the newcomer calls everyone already in the room.
  call(id, name) {
    const p = this.peer(id, name);
    p.offerer = true;
    p.audio = p.pc.addTransceiver("audio", { direction: "sendrecv" });
    p.video = p.pc.addTransceiver("video", { direction: "sendrecv" });
    if (this.audioTrack && this.route(id)) p.audio.sender.replaceTrack(this.audioTrack);
    if (this.videoTrack && this.route(id)) p.video.sender.replaceTrack(this.videoTrack);
    this.tune(p);
  }

  async onPeerSignal(from, data) {
    let p = this.peers.get(from);
    // an offer from another connection of theirs than the one we hold is a new connection too
    const other = !!(p && data.cid && p.rcid && data.cid !== p.rcid);
    if (data.sdp && data.sdp.type === "offer" && (data.fresh || other) && p) {
      // A new connection from them while we still hold an old one: theirs replaces ours (their side of
      // it is gone). Only if both of us are setting up a first connection at the same moment does the
      // lower id win.
      if (p.offerer && !p.wasConnected && p.state !== "failed" && !p.gaveUp && this.id < from) return;
      this.forget(p);
      p = null;
    }
    if (data.sdp && data.sdp.type === "answer") {
      // an answer only belongs to the offer this connection is waiting on
      if (!p || (data.for && data.for !== p.cid) || p.pc.signalingState !== "have-local-offer") return;
    }
    if (data.sdp) {
      if (!p) p = this.peer(from, data.name);
      if (data.cid) p.rcid = data.cid;
      if (data.name) p.name = data.name;
      await p.pc.setRemoteDescription(data.sdp);
      if (data.sdp.type === "offer") {
        const ts = p.pc.getTransceivers();
        p.audio = ts.find((t) => t.receiver.track.kind === "audio");
        p.video = ts.find((t) => t.receiver.track.kind === "video");
        for (const t of ts) t.direction = "sendrecv";
        if (p.audio && this.audioTrack && this.route(from)) await p.audio.sender.replaceTrack(this.audioTrack);
        if (p.video && this.videoTrack && this.route(from)) await p.video.sender.replaceTrack(this.videoTrack);
        await p.pc.setLocalDescription();
        this.sendSignal({ t: "signal", to: from, data: { sdp: p.pc.localDescription, name: this.name, cid: p.cid, for: p.rcid } });
        this.tune(p);
      }
      for (const c of p.pending || []) if (!c.cid || c.cid === p.rcid) await p.pc.addIceCandidate(c.ice).catch(() => {});
      p.pending = null;
      this.emit("peer", { id: from });
    } else if (data.ices && p) {
      for (const ice of data.ices.slice(0, 50)) await this.onPeerSignal(from, { ice, cid: data.cid, for: data.for });
    } else if (data.ice && p) {
      if ((data.for && data.for !== p.cid) || (data.cid && p.rcid && data.cid !== p.rcid)) return; // for an older connection
      if (!p.pc.remoteDescription) (p.pending ||= []).push(data);
      else await p.pc.addIceCandidate(data.ice).catch(() => {});
    }
  }

  // What my picture costs on each connection. Each extra person shares the same upload, so the bitrate
  // falls as the call grows; on top of that each viewer asks for what their tile needs ("want": high for
  // the big picture, low for a small tile, off when they don't show it), and my own cap (data saver, a weak
  // connection) holds for everyone. Sound always goes first: the network sends it ahead of video.
  tune(p) {
    // only the people I send to count (in a breakout room, the room)
    const n = Math.max(1, [...this.peers.keys()].filter((id) => this.route(id)).length);
    let kbps = n <= 2 ? 1500 : n <= 4 ? 800 : n <= 7 ? 450 : n <= 12 ? 250 : 150;
    let h = 720;
    let fps = 30;
    const cap = this.cap;
    if (cap) {
      kbps = Math.min(kbps, cap.kbps);
      h = Math.min(h, cap.h);
      fps = Math.min(fps, cap.fps);
    }
    // until the viewer says what they need: full picture in a small call; none in a big one, where most
    // pictures are names (the video cap), so joining doesn't start a burst of full-size videos to everyone
    const want = p.want || (n > VIDEO_CAP ? "off" : "high");
    if (want === "mid") {
      kbps = Math.min(kbps, 500);
      h = Math.min(h, 360);
    }
    if (want === "low") {
      kbps = Math.min(kbps, 200);
      h = Math.min(h, 180);
      fps = Math.min(fps, 15);
    }
    const a = p.audio && p.audio.sender;
    if (a && a.getParameters) {
      const ap = a.getParameters();
      if (ap.encodings && ap.encodings.length) {
        ap.encodings[0].priority = "high";
        ap.encodings[0].networkPriority = "high";
        a.setParameters(ap).catch(() => {});
      }
    }
    const s = p.video && p.video.sender;
    if (!s || !s.getParameters) return;
    const params = s.getParameters();
    if (!params.encodings || !params.encodings.length) params.encodings = [{}];
    const e = params.encodings[0];
    const src = (this.videoTrack && this.videoTrack.getSettings && this.videoTrack.getSettings().height) || 720;
    e.active = want !== "off";
    e.maxBitrate = kbps * 1000;
    e.scaleResolutionDownBy = Math.max(1, src / h);
    e.maxFramerate = fps;
    e.priority = "low";
    e.networkPriority = "low";
    p.sent = { want, kbps, h: Math.round(src / e.scaleResolutionDownBy), fps };
    s.setParameters(params).catch(() => {});
  }

  /** A viewer told me what they need from my picture: "high" | "mid" | "low" | "off". */
  setWant(id, want) {
    const p = this.peers.get(id);
    if (!p || !["high", "mid", "low", "off"].includes(want) || p.want === want) return;
    p.want = want;
    this.tune(p);
  }

  /** My own limit for every connection ({ kbps, h, fps }, or null for none). */
  setCap(cap) {
    const same = JSON.stringify(cap || null) === JSON.stringify(this.cap || null);
    this.cap = cap || null;
    if (!same) this.retune();
  }

  retune() {
    for (const p of this.peers.values()) this.tune(p);
  }

  drop(id) {
    const p = this.peers.get(id);
    if (!p) return;
    this.forget(p);
    this.emit("left", { id, name: p.name });
    this.retune();
  }

  async setTracks(audio, video) {
    this.audioTrack = audio || null;
    this.videoTrack = video || null;
    for (const p of this.peers.values()) {
      const to = this.route(p.id);
      if (p.audio) await p.audio.sender.replaceTrack(to ? this.audioTrack : null).catch(() => {});
      if (p.video) await p.video.sender.replaceTrack(to ? this.videoTrack : null).catch(() => {});
    }
    this.retune();
  }

  // the rooms changed: send my sound and picture again only to whom route() allows
  reroute() {
    return this.setTracks(this.audioTrack, this.videoTrack);
  }

  setName(name) {
    this.name = name;
    this.sendSignal({ t: "name", name });
  }

  broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const p of this.peers.values()) if (p.dc.readyState === "open") p.dc.send(s);
  }

  // only to the people in my room (chat, captions, hands, reactions in a breakout room)
  roomcast(msg) {
    const s = JSON.stringify(msg);
    for (const p of this.peers.values()) if (p.dc.readyState === "open" && this.route(p.id)) p.dc.send(s);
  }

  sendTo(id, msg) {
    const p = this.peers.get(id);
    if (p && p.dc.readyState === "open") p.dc.send(JSON.stringify(msg));
  }

  // host commands: { t: "lock", on } / { t: "admit" | "deny" | "remove", id } / { t: "admit-all" } / { t: "mute", id | "*" } /
  // { t: "pass", pass } (empty: no passcode)
  host(cmd) {
    // host controls need the server: the call moves to it (once), and the command goes when the link is up
    if (!this.srv) this.goServer();
    if (this.ws && this.ws.readyState === 1 && this.admitted) return this.sendSignal(cmd);
    (this.hostQueue ||= []).push(cmd);
  }

  leave() {
    if (this.ns && !this.srv) this.ns.send({ t: "bye", from: this.id }).finally(() => this.ns.close());
    else this.ns?.close();
    clearInterval(this.aloneTimer);
    this.closed = true;
    for (const id of [...this.peers.keys()]) this.drop(id);
    try {
      this.ws.close();
    } catch (_) {}
  }
}
