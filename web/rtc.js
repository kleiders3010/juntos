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
  constructor({ room, name, signalUrl }) {
    super();
    this.room = room;
    this.name = name;
    this.signalUrl = signalUrl;
    this.id = randomId();
    this.peers = new Map(); // id -> { pc, dc, name, stream, audio, video }
    this.audioTrack = null;
    this.videoTrack = null;
    this.closed = false;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  connect() {
    const ws = new WebSocket(`${this.signalUrl}/ws/${this.room}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.sendSignal({ t: "hello", id: this.id, name: this.name });
    };
    ws.onmessage = (e) => this.onSignal(JSON.parse(e.data));
    ws.onclose = () => {
      if (this.closed) return;
      // The signaling link only matters for new handshakes; calls in progress go on.
      this.emit("signal-lost");
      const wait = Math.min(15000, 1000 * 2 ** (this.retry = (this.retry || 0) + 1));
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
      for (const p of m.peers) if (!this.peers.has(p.id)) this.call(p.id, p.name);
      this.emit("joined", { count: m.peers.length });
    } else if (m.t === "join") {
      this.emit("someone-joining", { id: m.id, name: m.name });
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
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const dc = pc.createDataChannel("juntos", { negotiated: true, id: 0 });
    p = { id, pc, dc, name: name || "", stream: new MediaStream(), audio: null, video: null, state: "connecting" };
    this.peers.set(id, p);
    pc.onicecandidate = (e) => e.candidate && this.sendSignal({ t: "signal", to: id, data: { ice: e.candidate } });
    pc.ontrack = (e) => {
      if (!p.stream.getTracks().includes(e.track)) p.stream.addTrack(e.track);
      this.emit("peer", { id });
    };
    pc.onconnectionstatechange = () => {
      p.state = pc.connectionState;
      if (pc.connectionState === "failed") this.viaRelay(p);
      this.emit("peer", { id });
    };
    pc.onnegotiationneeded = async () => {
      if (!p.offerer) return;
      await pc.setLocalDescription();
      this.sendSignal({ t: "signal", to: id, data: { sdp: pc.localDescription, name: this.name } });
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
    if (!this.relay) {
      const http = this.signalUrl.replace(/^ws/, "http");
      this.relay = fetch(`${http}/turn`).then((r) => r.json()).then((j) => j.iceServers || []).catch(() => []);
    }
    const servers = await this.relay;
    if (!servers.length) return this.emit("relay-unavailable", { id: p.id });
    p.pc.setConfiguration({ iceServers: [...ICE, ...(Array.isArray(servers) ? servers : [servers])] });
    if (p.offerer) p.pc.restartIce();
  }

  // We offer: the newcomer calls everyone already in the room.
  call(id, name) {
    const p = this.peer(id, name);
    p.offerer = true;
    p.audio = p.pc.addTransceiver("audio", { direction: "sendrecv" });
    p.video = p.pc.addTransceiver("video", { direction: "sendrecv" });
    if (this.audioTrack) p.audio.sender.replaceTrack(this.audioTrack);
    if (this.videoTrack) p.video.sender.replaceTrack(this.videoTrack);
    this.tune(p);
  }

  async onPeerSignal(from, data) {
    let p = this.peers.get(from);
    if (data.sdp) {
      if (!p) p = this.peer(from, data.name);
      if (data.name) p.name = data.name;
      await p.pc.setRemoteDescription(data.sdp);
      if (data.sdp.type === "offer") {
        const ts = p.pc.getTransceivers();
        p.audio = ts.find((t) => t.receiver.track.kind === "audio");
        p.video = ts.find((t) => t.receiver.track.kind === "video");
        for (const t of ts) t.direction = "sendrecv";
        if (p.audio && this.audioTrack) await p.audio.sender.replaceTrack(this.audioTrack);
        if (p.video && this.videoTrack) await p.video.sender.replaceTrack(this.videoTrack);
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
    const n = Math.max(1, this.peers.size);
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
    try {
      p.pc.close();
    } catch (_) {}
    this.peers.delete(id);
    this.emit("left", { id, name: p.name });
    this.retune();
  }

  async setTracks(audio, video) {
    this.audioTrack = audio || null;
    this.videoTrack = video || null;
    for (const p of this.peers.values()) {
      if (p.audio) await p.audio.sender.replaceTrack(this.audioTrack).catch(() => {});
      if (p.video) await p.video.sender.replaceTrack(this.videoTrack).catch(() => {});
    }
  }

  setName(name) {
    this.name = name;
    this.sendSignal({ t: "name", name });
  }

  broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const p of this.peers.values()) if (p.dc.readyState === "open") p.dc.send(s);
  }

  sendTo(id, msg) {
    const p = this.peers.get(id);
    if (p && p.dc.readyState === "open") p.dc.send(JSON.stringify(msg));
  }

  leave() {
    this.closed = true;
    for (const id of [...this.peers.keys()]) this.drop(id);
    try {
      this.ws.close();
    } catch (_) {}
  }
}
