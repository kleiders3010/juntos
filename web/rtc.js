// Direct (mesh) WebRTC between everyone in a room. The signaling server only passes handshakes;
// audio, video, chat and the board go device to device.
//
// Who offers: the newcomer offers to everyone already there. Every connection carries one audio
// and one video sender (swapped with replaceTrack, so no renegotiation) and one data channel
// (negotiated id 0, created by both sides).

const ICE = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];

export function randomId() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
}

export class Mesh extends EventTarget {
  constructor({ room, name, signalUrl, key, knock }) {
    super();
    this.key = key || ""; // only the person who started the call has it: host controls
    this.knock = !!knock; // sent out of this call before: ask to come back in
    this.hosts = new Set(); // ids of the hosts among the others
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
    const ws = new WebSocket(`${this.signalUrl}/ws/${this.room}`);
    this.ws = ws;
    ws.onopen = () => {
      this.tries = 0;
      this.emit("signal-open");
      this.sendSignal({ t: "hello", id: this.id, name: this.name, ...(this.key ? { key: this.key, claim: true } : {}), ...(this.knock ? { knock: true } : {}) });
    };
    ws.onmessage = (e) => this.onSignal(JSON.parse(e.data));
    ws.onclose = () => {
      if (this.closed) return;
      // The signaling link only matters for new handshakes; calls in progress go on.
      this.emit("signal-lost");
      const wait = Math.min(15000, 1000 * 2 ** (this.tries = (this.tries || 0) + 1));
      setTimeout(() => !this.closed && this.reconnect(), wait);
    };
  }

  reconnect() {
    // Same identity: connections still up stay as they are; broken ones are called again.
    for (const [id, p] of this.peers) if (p.state === "failed" || p.state === "closed") this.drop(id);
    this.connect();
  }

  sendSignal(m) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
  }

  onSignal(m) {
    if (m.t === "peers") {
      for (const p of m.peers) if (p.host) this.hosts.add(p.id);
      for (const p of m.peers) if (!this.peers.has(p.id)) this.call(p.id, p.name);
      this.emit("joined", { count: m.peers.length });
    } else if (m.t === "join") {
      if (m.host) this.hosts.add(m.id);
      this.emit("someone-joining", { id: m.id, name: m.name });
    } else if (["room", "lock", "knock", "knock-gone", "waiting", "denied", "removed", "mute"].includes(m.t)) {
      // host controls: who may come in, mute, remove (the server checks who is the host)
      if (m.t === "denied" || m.t === "removed") this.closed = true;
      this.emit("host", m);
    } else if (m.t === "leave") {
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
      this.onPeerSignal(m.from, m.data);
    }
  }

  peer(id, name) {
    let p = this.peers.get(id);
    if (p) return p;
    // once a relay was needed in this call, new connections include it from the start
    const pc = new RTCPeerConnection({ iceServers: this.relayList ? [...ICE, ...this.relayList] : ICE });
    const dc = pc.createDataChannel("juntos", { negotiated: true, id: 0 });
    p = { id, pc, dc, name: name || "", stream: new MediaStream(), audio: null, video: null, state: "connecting" };
    this.peers.set(id, p);
    // No direct connection within a few seconds (mobile networks often block it): try the relay now
    // instead of waiting the half minute a browser takes to give up.
    p.timer = setTimeout(() => p.state !== "connected" && this.viaRelay(p), 6000);
    pc.onicecandidate = (e) => e.candidate && this.sendSignal({ t: "signal", to: id, data: { ice: e.candidate } });
    pc.ontrack = (e) => {
      if (!p.stream.getTracks().includes(e.track)) p.stream.addTrack(e.track);
      this.emit("peer", { id });
    };
    pc.onconnectionstatechange = () => {
      if (this.peers.get(id) !== p) return; // replaced by a newer connection
      p.state = pc.connectionState;
      clearTimeout(p.blip);
      if (p.state === "connected") {
        p.wasConnected = true;
        clearTimeout(p.timer);
        clearTimeout(p.giveUpTimer);
        p.gaveUp = false;
        p.relaying = false;
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
      this.sendSignal({ t: "signal", to: id, data: { sdp: pc.localDescription, name: this.name, fresh: !p.offered } });
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
    if (data.sdp && data.sdp.type === "offer" && data.fresh && p) {
      // A new connection from them while we still hold an old one: theirs replaces ours (their side of
      // it is gone). Only if both of us are setting up a first connection at the same moment does the
      // lower id win.
      if (p.offerer && !p.wasConnected && p.state !== "failed" && !p.gaveUp && this.id < from) return;
      this.forget(p);
      p = null;
    }
    if (data.sdp) {
      if (!p) p = this.peer(from, data.name);
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
        this.sendSignal({ t: "signal", to: from, data: { sdp: p.pc.localDescription, name: this.name } });
        this.tune(p);
      }
      for (const c of p.pending || []) await p.pc.addIceCandidate(c).catch(() => {});
      p.pending = null;
      this.emit("peer", { id: from });
    } else if (data.ice && p) {
      if (!p.pc.remoteDescription) (p.pending ||= []).push(data.ice);
      else await p.pc.addIceCandidate(data.ice).catch(() => {});
    }
  }

  // Each extra person shares the same upload: lower the video bitrate as the call grows.
  tune(p) {
    // only the people I send to count (in a breakout room, the room)
    const n = Math.max(1, [...this.peers.keys()].filter((id) => this.route(id)).length);
    const kbps = n <= 2 ? 1500 : n <= 4 ? 800 : n <= 7 ? 450 : 250;
    const s = p.video && p.video.sender;
    if (!s || !s.getParameters) return;
    const params = s.getParameters();
    if (!params.encodings || !params.encodings.length) params.encodings = [{}];
    params.encodings[0].maxBitrate = kbps * 1000;
    s.setParameters(params).catch(() => {});
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

  // host commands: { t: "lock", on } / { t: "admit" | "deny" | "remove", id } / { t: "mute", id | "*" }
  host(cmd) {
    this.sendSignal(cmd);
  }

  leave() {
    this.closed = true;
    for (const id of [...this.peers.keys()]) this.drop(id);
    try {
      this.ws.close();
    } catch (_) {}
  }
}
