// How good each connection is, and spending it well (like Zoom's per-person bars and Meet's data saver).
//
// Every 2 s each connection is measured (round trip, lost packets, jitter: the browser's WebRTC stats) and
// shown as 1-4 bars on that person's picture; the levels follow Zoom's guidance (150 ms or less, 40 ms
// jitter or less and 2 % loss or less is good). Each viewer tells each sender what their tile needs:
// "high" for the big picture, "mid" for a medium one, "low" for a small one, "off" when it isn't shown, so a
// small tile costs little and a hidden one nothing. Sound always goes first (the sender gives it priority).
//
// Video quality, remembered on this device: Auto (the best the connection allows), Data saver (my picture at
// most 360p, only the main picture of the others; the default on mobile data or when the phone asks to save
// data), Audio only (no videos of the others; they still see me). On top of that, when my connection gets
// weak the call steps down by itself (less video, then none) and steps back up once it has been good for a
// while; a line at the top says so.

const KEY = "juntos.quality";
export const QUALITIES = ["auto", "saver", "audio"];
const SAVER_CAP = { kbps: 300, h: 360, fps: 24 };
const WEAK_CAP = { kbps: 250, h: 360, fps: 15 };
const VERY_WEAK_CAP = { kbps: 100, h: 180, fps: 10 };
// Big calls: everyone is heard, but only this many others send me video at once: the pinned / big picture or a
// shared screen first, then whoever spoke last (like Zoom's "active speakers" and Meet's tile limit). The others
// show their name; tapping one makes it the big picture. Each video I get is one more stream to download and
// decode, and on a direct (mesh) call one more upload for its sender, so this is what lets a call grow.
export const VIDEO_CAP = 9;

/** 1-4 bars from a round trip (ms), lost packets (%) and jitter (ms); 0 when not known yet. */
export function barsFor(rtt, loss, jitter) {
  if (rtt == null) return 0;
  const j = jitter || 0;
  const l = loss || 0;
  if (rtt <= 150 && l <= 2 && j <= 40) return 4;
  if (rtt <= 300 && l <= 5 && j <= 80) return 3;
  if (rtt <= 500 && l <= 10) return 2;
  return 1;
}

export class Net {
  /**
   * o: { mesh: () => Mesh, t, grid: () => element, keepVideo: () => bool (recording or the small window
   * shows hidden people), changed: () => void (repaint the line at the top) }
   */
  constructor(o) {
    this.o = o;
    this.links = new Map(); // id -> { rtt, loss, jitter, kbps, w, h, bars, prev, theirs, last }
    this.mine = 0;
    this.level = 0; // 0 normal, 1 weak (less video), 2 very weak (no video)
    this.bad = 0;
    this.veryBad = 0;
    this.good = 0;
    this.focusId = null;
    this.log = []; // the last few minutes of measurements (no content, only numbers)
    this.timers = [];
  }

  get pref() {
    const v = localStorage.getItem(KEY);
    return QUALITIES.includes(v) ? v : this.defaultPref();
  }

  /** On mobile data or when the device asks to save data: Data saver. */
  defaultPref() {
    const c = navigator.connection;
    return c && (c.saveData || c.type === "cellular") ? "saver" : "auto";
  }

  setPref(v) {
    if (!QUALITIES.includes(v)) return;
    localStorage.setItem(KEY, v);
    this.apply();
  }

  start() {
    this.stop();
    this.links.clear();
    this.level = this.bad = this.veryBad = this.good = 0;
    this.mine = 0;
    this.timers.push(setInterval(() => this.sample(), 2000));
    this.timers.push(setInterval(() => this.wants(), 700));
    this.apply();
  }

  stop() {
    for (const x of this.timers) clearInterval(x);
    this.timers = [];
  }

  /** My own limit for what I send, from the choice and how my connection is doing. */
  cap() {
    const caps = [];
    if (this.pref === "saver") caps.push(SAVER_CAP);
    if (this.level === 1) caps.push(WEAK_CAP);
    if (this.level >= 2) caps.push(VERY_WEAK_CAP);
    if (!caps.length) return null;
    return { kbps: Math.min(...caps.map((c) => c.kbps)), h: Math.min(...caps.map((c) => c.h)), fps: Math.min(...caps.map((c) => c.fps)) };
  }

  apply() {
    this.o.mesh()?.setCap(this.cap());
    this.wants();
    this.o.changed?.();
  }

  /** A new connection opened: tell them again what I need (a fresh connection starts at "high"). */
  greet(id) {
    const tile = this.tile(id);
    if (tile) tile.wantSent = null;
    if (this.mine) this.o.mesh()?.sendTo(id, { k: "netq", b: this.mine });
    this.wants();
  }

  left(id) {
    this.links.delete(id);
  }

  receive(from, m) {
    if (m.k === "want") {
      this.o.mesh()?.setWant(from, m.q);
      return true;
    }
    if (m.k === "netq") {
      const l = this.link(from);
      l.theirs = Math.max(0, Math.min(4, Number(m.b) || 0));
      this.paint(from);
      return true;
    }
    return false;
  }

  link(id) {
    let l = this.links.get(id);
    if (!l) this.links.set(id, (l = { bars: 0, hist: [] }));
    return l;
  }

  tile(id) {
    return this.o.grid()?.querySelector(`.tile[data-id="${CSS.escape(id)}"]`);
  }

  async sample() {
    const mesh = this.o.mesh();
    if (!mesh) return;
    const fake = window.__netFake; // tests: { rtt, loss, jitter } for every connection
    for (const [id, p] of mesh.peers) {
      if (p.state !== "connected" || !p.pc) continue; // someone reached along a big call's tree
      let r;
      try {
        r = await p.pc.getStats();
      } catch (_) {
        continue;
      }
      const l = this.link(id);
      let rtt = null;
      let lost = 0;
      let recv = 0;
      let jitter = null;
      let vbytes = 0;
      let rloss = 0;
      let pair = null;
      r.forEach((x) => {
        if (x.type === "transport" && x.selectedCandidatePairId) pair = x.selectedCandidatePairId;
      });
      r.forEach((x) => {
        if (x.type === "candidate-pair" && (pair ? x.id === pair : x.nominated && x.state === "succeeded") && x.currentRoundTripTime != null) rtt = x.currentRoundTripTime * 1000;
        if (x.type === "inbound-rtp") {
          lost += Math.max(0, x.packetsLost || 0);
          recv += x.packetsReceived || 0;
          if (x.kind === "audio" && x.jitter != null) jitter = x.jitter * 1000;
          if (x.kind === "video") {
            vbytes += x.bytesReceived || 0;
            l.w = x.frameWidth || 0;
            l.h = x.frameHeight || 0;
          }
        }
        // what they say about what I send them
        if (x.type === "remote-inbound-rtp" && x.fractionLost != null) rloss = Math.max(rloss, x.fractionLost * 100);
      });
      const now = performance.now();
      let loss = rloss;
      if (l.prev) {
        const dl = lost - l.prev.lost;
        const dr = recv - l.prev.recv;
        if (dl + dr > 0) loss = Math.max(loss, (100 * Math.max(0, dl)) / (dl + dr));
        const dt = (now - l.prev.at) / 1000;
        if (dt > 0) l.kbps = Math.max(0, Math.round(((vbytes - l.prev.vbytes) * 8) / dt / 1000));
      }
      l.prev = { lost, recv, vbytes, at: now };
      if (fake) {
        rtt = fake.rtt ?? rtt;
        loss = fake.loss ?? loss;
        jitter = fake.jitter ?? jitter;
      }
      l.rtt = rtt == null ? null : Math.round(rtt);
      l.loss = Math.round(loss * 10) / 10;
      l.jitter = jitter == null ? null : Math.round(jitter);
      const b = barsFor(rtt, loss, jitter);
      // one bad moment shouldn't flash red: the better of the last two
      l.hist = [...l.hist.slice(-1), b];
      l.bars = Math.max(...l.hist);
      l.last = Date.now();
      this.log.push({ at: Date.now(), id, rtt: l.rtt, loss: l.loss, jitter: l.jitter, kbps: l.kbps || 0, bars: l.bars });
    }
    for (const id of [...this.links.keys()]) if (!mesh.peers.has(id)) this.links.delete(id);
    if (this.log.length > 600) this.log.splice(0, this.log.length - 600);
    this.judge();
    for (const id of this.links.keys()) this.paint(id);
    this.paint("me");
  }

  /** My own connection: the middle of what I measure with each person (one bad link is theirs, not mine). */
  judge() {
    const all = [...this.links.values()].filter((l) => l.bars).map((l) => l.bars).sort((a, b) => a - b);
    const mine = all.length ? all[Math.floor((all.length - 1) / 2)] : 0;
    if (mine !== this.mine) {
      this.mine = mine;
      this.o.mesh()?.broadcast({ k: "netq", b: mine });
    }
    if (!mine) return;
    this.bad = mine <= 2 ? this.bad + 1 : 0;
    this.veryBad = mine <= 1 ? this.veryBad + 1 : 0;
    this.good = mine >= 3 ? this.good + 1 : 0;
    const was = this.level;
    // down quickly (4 s weak, 6 s very weak), up slowly (10 s good), one step at a time
    if (this.level === 0 && this.bad >= 2) this.level = 1;
    else if (this.level === 1 && this.veryBad >= 3) this.level = 2;
    else if (this.level > 0 && this.good >= 5) this.level--;
    if (this.level !== was) {
      this.bad = this.veryBad = this.good = 0;
      this.apply();
    }
  }

  /** What each tile needs from its sender, sent only when it changes. */
  wants() {
    const mesh = this.o.mesh();
    const g = this.o.grid();
    if (!mesh || !g) return;
    const keep = !!this.o.keepVideo?.();
    const pref = this.pref;
    const none = pref === "audio" || this.level >= 2;
    const few = pref === "saver" || this.level === 1;
    const tiles = [...g.querySelectorAll(".tile[data-id]")].filter((x) => x.dataset.id !== "me");
    const focus = few && !none ? this.focus(g, tiles) : null;
    const hidden = document.visibilityState === "hidden";
    const plan = [];
    for (const tile of tiles) {
      const id = tile.dataset.id;
      let q;
      let paused = false;
      const r = tile.getBoundingClientRect();
      const shown = !tile.classList.contains("away") && r.width > 0 && r.height > 0 && getComputedStyle(tile).display !== "none" && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
      if (tile.classList.contains("away")) q = "off";
      else if (none) {
        q = "off";
        paused = true;
      } else if (few) {
        if (tile === focus) q = "mid";
        else {
          q = keep ? "low" : "off";
          paused = !keep;
        }
      } else if (!shown) q = keep ? "low" : "off";
      else if (hidden) q = "low";
      else {
        const big = Math.min(r.height, (r.width * 9) / 16);
        q = big >= 360 || tile.classList.contains("main") || tile.classList.contains("spot") ? "high" : big >= 160 ? "mid" : "low";
      }
      plan.push({ tile, id, q, paused, why: none ? (pref === "audio" ? "Audio only" : "Video paused: weak connection") : "Video paused to save data. Tap to see it" });
    }
    // the video cap of big calls: the first VIDEO_CAP that would get video keep it, the rest show their name
    const rank = (x) => (x.classList.contains("spot") || x.classList.contains("main") || x.classList.contains("screen") ? 1e15 : 0) + (x.spokeAt || 0);
    const video = plan.filter((x) => x.q !== "off" && !x.tile.classList.contains("camoff")).sort((a, b) => rank(b.tile) - rank(a.tile));
    for (const x of video.slice(VIDEO_CAP)) {
      x.q = "off";
      x.paused = true;
      x.why = "Big call: showing who spoke last. Tap to see it";
    }
    for (const { tile, id, q, paused: pz, why } of plan) {
      let paused = pz;
      const p = mesh.peers.get(id);
      if (!p || p.state !== "connected") paused = false; // "Connecting…" says enough
      tile.classList.toggle("paused", paused && !tile.classList.contains("camoff"));
      if (paused) tile.dataset.paused = this.o.t(why);
      if (tile.wantSent !== q) {
        if (p && p.dc.readyState === "open") {
          mesh.sendTo(id, { k: "want", q });
          if (p.via) mesh.fwd?.want(id, q); // a picture passed on by a helper: the helper stops or resumes it
          tile.wantSent = q;
        }
      }
    }
  }

  /** The one picture kept when showing less: pinned, the big one, else who talks most (with a cam on). */
  focus(g, tiles) {
    const live = tiles.filter((x) => !x.classList.contains("away"));
    const pick = g.querySelector(".tile.spot:not([data-id='me'])") || live.find((x) => x.classList.contains("main") && x.classList.contains("screen")) || live.find((x) => x.classList.contains("main"));
    if (pick) return (this.focusId = pick.dataset.id), pick;
    const cams = live.filter((x) => !x.classList.contains("camoff") || x.classList.contains("screen"));
    const cur = cams.find((x) => x.dataset.id === this.focusId);
    const best = cams.reduce((a, x) => ((x.talk || 0) > (a?.talk || 0) ? x : a), null);
    const next = !cur || (best && best !== cur && (best.talk || 0) >= 600 && (cur.talk || 0) < 300) ? best || cams[0] : cur;
    this.focusId = next?.dataset.id || null;
    return next || null;
  }

  /** The bars on a tile ("me" = my own connection). */
  paint(id) {
    const tile = this.tile(id);
    const el = tile?.querySelector(".bars");
    if (!el) return;
    const l = id === "me" ? null : this.links.get(id);
    let b = id === "me" ? this.mine : l?.bars || 0;
    if (l?.theirs) b = Math.min(b || l.theirs, l.theirs); // their own connection counts too
    el.hidden = !b;
    el.dataset.b = b;
    const name = this.o.t(["", "Very weak", "Weak", "OK", "Good"][b] || "");
    el.title = this.o.t("Connection: {q}", { q: name });
    el.setAttribute("aria-label", el.title);
  }

  /** The details behind the bars: what was measured, and what this connection is showing. */
  details(id) {
    const t = this.o.t;
    const lines = [];
    if (id === "me") {
      const b = this.mine;
      lines.push(t("Your connection: {q}", { q: t(["", "Very weak", "Weak", "OK", "Good"][b] || "Not measured yet") }));
      const cap = this.cap();
      lines.push(cap ? t("You send at most {h}p", { h: cap.h }) : t("You send the best your connection allows"));
      if (this.level) lines.push(t(this.level >= 2 ? "Video paused: weak connection" : "Showing less video: weak connection"));
      return lines;
    }
    const l = this.links.get(id) || {};
    const b = Math.min(l.bars || 0, l.theirs || l.bars || 0);
    lines.push(t("Connection: {q}", { q: t(["", "Very weak", "Weak", "OK", "Good"][b] || "Not measured yet") }));
    if (l.rtt != null) lines.push(t("Delay {ms} ms · {loss}% lost", { ms: l.rtt, loss: l.loss || 0 }));
    if (l.theirs && l.theirs <= 2) lines.push(t("Their own connection is weak"));
    if (l.h && l.kbps) lines.push(t("Their video here: {h}p, {kbps} kbps", { h: l.h, kbps: l.kbps }));
    return lines;
  }

  /** The line at the top of the call when the call stepped down by itself. */
  note() {
    if (this.level >= 2) return this.o.t("Your connection is very weak: video paused so the sound keeps going.");
    if (this.level === 1) return this.o.t("Your connection is weak: showing less video.");
    return "";
  }

  /** The Video quality choice, for the settings sheet. */
  section() {
    const t = this.o.t;
    const box = document.createElement("div");
    box.className = "qualityBox";
    const h = document.createElement("p");
    h.className = "small";
    h.textContent = t("Video quality");
    const seg = document.createElement("div");
    seg.className = "seg three";
    seg.dataset.key = "quality";
    const choices = [
      ["auto", t("Auto"), t("The best your connection allows")],
      ["saver", t("Data saver"), t("Only the main picture; yours at 360p")],
      ["audio", t("Audio only"), t("No videos; the others still see you")],
    ];
    for (const [id, name, hint] of choices) {
      const b = document.createElement("button");
      b.dataset.v = id;
      b.innerHTML = "<b></b><small></small>";
      b.firstChild.textContent = name;
      b.lastChild.textContent = hint;
      b.classList.toggle("on", this.pref === id);
      b.onclick = () => {
        this.setPref(id);
        for (const x of seg.children) x.classList.toggle("on", x === b);
      };
      seg.append(b);
    }
    box.append(h, seg);
    if (!localStorage.getItem(KEY) && this.defaultPref() === "saver") {
      const p = document.createElement("p");
      p.className = "small";
      p.textContent = t("Data saver is on because you are on mobile data.");
      box.append(p);
    }
    return box;
  }
}
