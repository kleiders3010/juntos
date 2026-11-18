// Juntos signaling: one Durable Object per room relays WebRTC handshakes between the people in it.
// Media, chat and the board never pass through here: they go device to device (WebRTC).
// The room keeps no history and no names once everyone has left; only a hash of the host's key,
// the lock and a hash of the passcode (if the host set one), forgotten a month after the room was last used.

const MAX_PEOPLE = 12; // a direct mesh beyond this asks too much of phones
const MAX_MSG = 64 * 1024;
const ROOM_KEEP = 31 * 24 * 3600 * 1000; // a room's host and lock are forgotten a month after its last use
const HOST_CMDS = new Set(["lock", "admit", "admit-all", "deny", "remove", "mute", "pass"]);
// A passcode, like Zoom's: 4 to 10 letters or numbers (case matters). Wrong tries are limited per network.
const PASS_RE = /^[A-Za-z0-9]{4,10}$/;
const PASS_TRIES = 5; // wrong passcodes in a row from one network ...
const PASS_WAIT = 60 * 1000; // ... then it waits this long

async function passHash(room, pass) {
  return sha("pass|" + room + "|" + pass);
}

async function sha(text) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("juntos-host|" + text));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/(ws|info)\/([a-z0-9-]{4,64})$/);
    if (m) {
      const room = env.ROOMS.get(env.ROOMS.idFromName(m[2]));
      // the lobby asks whether a passcode is needed before joining (yes / no, nothing else)
      if (m[1] === "info") return room.fetch("https://room/info");
      if (req.headers.get("Upgrade") !== "websocket") return new Response("expected a websocket", { status: 426 });
      const h = new Headers(req.headers);
      h.set("x-room", m[2]);
      h.set("x-ip-key", await ipKey(req));
      return room.fetch(new Request(req, { headers: h }));
    }
    if (url.pathname === "/health") return new Response("ok");
    if (url.pathname === "/turn") return turn(req, env);
    return new Response("not found", { status: 404 });
  },
};

// Relay (TURN) credentials, only for people whose direct connection failed. Cloudflare's free
// allowance is 1,000 GB a month (shared with its SFU); past it, it bills. So the number of
// credentials handed out per month is capped well below what could reach that.
const TURN_PER_MONTH = 150;
// One person can't use up everyone's budget: a few credentials per network per day.
const TURN_PER_IP_DAY = 6;

async function ipKey(req) {
  const ip = req.headers.get("CF-Connecting-IP") || "unknown";
  const day = new Date().toISOString().slice(0, 10);
  // Only a hash is kept (never the address), and only until the next day.
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(day + "|juntos|" + ip));
  return "ip:" + day + ":" + [...new Uint8Array(h).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function turn(req, env) {
  if (!env.TURN_KEY || !env.TURN_KEY_ID) return Response.json({ iceServers: [] });
  const budget = env.ROOMS.get(env.ROOMS.idFromName("~budget"));
  const ok = await (await budget.fetch("https://budget/take", { headers: { "x-ip-key": await ipKey(req) } })).json();
  if (!ok.granted) return Response.json({ iceServers: [], reason: ok.reason }, { status: 429 });
  const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.TURN_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ttl: 4 * 3600 }),
  });
  if (!r.ok) return Response.json({ iceServers: [] }, { status: 502 });
  const body = await r.json();
  return Response.json({ iceServers: body.iceServers || [] }, { headers: { "Cache-Control": "no-store" } });
}

export class Room {
  constructor(state) {
    this.state = state;
  }

  // Budget object: drop the per-network counts of past days. A room: forget its host and lock a
  // month after it was last used.
  async alarm() {
    if (await this.state.storage.get("seen")) {
      if (this.peers(true).length) return this.state.storage.setAlarm(Date.now() + ROOM_KEEP);
      return this.state.storage.deleteAll();
    }
    const today = "ip:" + new Date().toISOString().slice(0, 10);
    const old = [...(await this.state.storage.list({ prefix: "ip:" })).keys()].filter((k) => !k.startsWith(today));
    if (old.length) await this.state.storage.delete(old.slice(0, 128));
    if (old.length > 128) await this.state.storage.setAlarm(Date.now() + 1000);
  }

  // people in the call (and, with waiting = true, also those asking to join)
  peers(waiting) {
    return this.state.getWebSockets().map((ws) => ({ ws, a: ws.deserializeAttachment() || {} })).filter((p) => p.a.id && (waiting || !p.a.wait));
  }

  hosts() {
    return this.peers().filter((p) => p.a.host);
  }

  // let someone in: they get everyone already here, everyone hears about them
  admit(ws, a) {
    const others = this.peers().filter((p) => p.ws !== ws);
    ws.serializeAttachment({ id: a.id, name: a.name, host: !!a.host });
    this.send(ws, { t: "peers", peers: others.map((p) => ({ id: p.a.id, name: p.a.name, host: !!p.a.host })) });
    this.send(ws, { t: "room", locked: !!this.locked, host: !!a.host, pass: !!this.hasPass });
    for (const p of others) this.send(p.ws, { t: "join", id: a.id, name: a.name, host: !!a.host });
  }

  async fetch(req) {
    if (new URL(req.url).pathname === "/take") {
      // the "~budget" object: counts relay credentials per calendar month
      const month = new Date().toISOString().slice(0, 7);
      const used = (await this.state.storage.get(month)) || 0;
      if (used >= TURN_PER_MONTH) return Response.json({ granted: false, reason: "monthly relay budget used" });
      // and, per network per day, a hash of the address (deleted by the alarm below)
      const ipk = req.headers.get("x-ip-key") || "ip:none";
      const mine = (await this.state.storage.get(ipk)) || 0;
      if (mine >= TURN_PER_IP_DAY) return Response.json({ granted: false, reason: "daily relay limit for this network" });
      await this.state.storage.put({ [month]: used + 1, [ipk]: mine + 1 });
      await this.state.storage.setAlarm(Date.now() + 26 * 3600 * 1000);
      return Response.json({ granted: true, used: used + 1 });
    }
    if (new URL(req.url).pathname === "/info") {
      const pass = !!(await this.state.storage.get("pass"));
      return Response.json({ pass }, { headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
    }
    const pair = new WebSocketPair();
    // the room's name (for the passcode hash) and a daily hash of the network (for the wrong-passcode limit)
    this.state.acceptWebSocket(pair[1], [req.headers.get("x-room") || "", req.headers.get("x-ip-key") || "ip:none"]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  send(ws, msg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch (_) {}
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== "string" || raw.length > MAX_MSG) return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (_) {
      return;
    }
    const me = ws.deserializeAttachment() || {};
    if (msg.t === "hello") {
      if (me.id) return;
      const id = String(msg.id || "").slice(0, 40);
      const name = String(msg.name || "").slice(0, 60);
      if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) return ws.close(1008, "bad id");
      if (this.peers().length >= MAX_PEOPLE) {
        this.send(ws, { t: "full", max: MAX_PEOPLE });
        return ws.close(1008, "full");
      }
      // The person who started the call holds a secret key (kept on their device); the room keeps
      // only its hash. The first hello that carries a key and asks to claim an unclaimed room claims it.
      const st = this.state.storage;
      let hostHash = await st.get("host");
      let host = false;
      const key = typeof msg.key === "string" ? msg.key.slice(0, 80) : "";
      if (key.length >= 16) {
        const h = await sha(key);
        if (!hostHash && msg.claim) await st.put("host", (hostHash = h));
        host = h === hostHash;
      }
      if (this.locked === undefined) this.locked = !!(await st.get("locked"));
      const [room, net] = this.state.getTags(ws);
      // the host's choices when starting the call (people ask to join, a passcode), only the first time
      if (host && msg.claim && msg.opts && !(await st.get("opened"))) {
        if (msg.opts.lock) await st.put("locked", (this.locked = true));
        if (PASS_RE.test(msg.opts.pass || "")) await st.put("pass", await passHash(room, msg.opts.pass));
      }
      if (host) await st.put("opened", true);
      // a passcode: everyone but the host types it (or has it in the link)
      const passH = await st.get("pass");
      if (passH && !host) {
        this.tries ||= new Map();
        const tr = this.tries.get(net) || { n: 0, until: 0 };
        if (tr.until > Date.now()) {
          this.send(ws, { t: "passcode", wait: Math.ceil((tr.until - Date.now()) / 1000) });
          return ws.close(4003, "passcode");
        }
        const given = typeof msg.pass === "string" ? msg.pass.trim().slice(0, 10) : "";
        if (!given || (await passHash(room, given)) !== passH) {
          if (given) {
            tr.n++;
            if (tr.n >= PASS_TRIES) Object.assign(tr, { n: 0, until: Date.now() + PASS_WAIT });
            this.tries.set(net, tr);
          }
          this.send(ws, { t: "passcode", wrong: !!given, wait: tr.until > Date.now() ? Math.ceil(PASS_WAIT / 1000) : 0 });
          return ws.close(4003, "passcode");
        }
        this.tries.delete(net);
      }
      this.hasPass = !!passH;
      await st.put("seen", Date.now());
      await st.setAlarm(Date.now() + ROOM_KEEP);
      const hosts = this.hosts();
      // locked (or sent out earlier): ask to join, a host decides. With no host here nobody could answer, so come in.
      if (!host && (this.locked || msg.knock) && hosts.length) {
        ws.serializeAttachment({ id, name, wait: true });
        this.send(ws, { t: "waiting" });
        for (const p of hosts) this.send(p.ws, { t: "knock", id, name });
        return;
      }
      return this.admit(ws, { id, name, host });
    }
    if (!me.id) return;
    if (msg.t === "signal" && typeof msg.to === "string") {
      const target = this.peers().find((p) => p.a.id === msg.to);
      if (target) this.send(target.ws, { t: "signal", from: me.id, data: msg.data });
      return;
    }
    if (me.wait) return;
    if (me.host && HOST_CMDS.has(msg.t)) return this.hostCmd(me, msg, ws);
    if (msg.t === "name") {
      const name = String(msg.name || "").slice(0, 60);
      ws.serializeAttachment({ ...me, name });
      for (const p of this.peers()) if (p.ws !== ws) this.send(p.ws, { t: "name", id: me.id, name });
    }
  }

  async hostCmd(me, msg, ws) {
    const all = this.peers(true);
    const target = all.find((p) => p.a.id === msg.id);
    if (msg.t === "lock") {
      this.locked = !!msg.on;
      await this.state.storage.put("locked", this.locked);
      for (const p of this.peers()) this.send(p.ws, { t: "lock", on: this.locked, by: me.name });
      if (!this.locked) for (const p of all) if (p.a.wait) this.admit(p.ws, p.a);
    } else if (msg.t === "admit-all") {
      // Zoom's "Admit all": everyone waiting right now
      const waiting = all.filter((p) => p.a.wait);
      for (const p of waiting) this.admit(p.ws, p.a);
      for (const h of this.hosts()) for (const p of waiting) this.send(h.ws, { t: "knock-gone", id: p.a.id });
    } else if (msg.t === "pass") {
      // set, change or remove the passcode. Only its hash is kept; the people already in the call get the new
      // one so their reconnects and invitations keep working.
      const pass = typeof msg.pass === "string" ? msg.pass.trim() : "";
      if (pass && !PASS_RE.test(pass)) return;
      const [room] = this.state.getTags(ws);
      if (pass) await this.state.storage.put("pass", await passHash(room, pass));
      else await this.state.storage.delete("pass");
      this.hasPass = !!pass;
      for (const p of this.peers()) this.send(p.ws, { t: "pass", on: !!pass, pass, by: me.name });
    } else if (msg.t === "admit" && target?.a.wait) {
      this.admit(target.ws, target.a);
      for (const p of this.hosts()) this.send(p.ws, { t: "knock-gone", id: target.a.id });
    } else if (msg.t === "deny" && target?.a.wait) {
      this.send(target.ws, { t: "denied" });
      target.ws.serializeAttachment({});
      target.ws.close(4001, "denied");
      for (const p of this.hosts()) this.send(p.ws, { t: "knock-gone", id: target.a.id });
    } else if (msg.t === "remove" && target && !target.a.wait && !target.a.host) {
      this.send(target.ws, { t: "removed", by: me.name });
      target.ws.serializeAttachment({});
      target.ws.close(4002, "removed");
      for (const p of this.peers()) this.send(p.ws, { t: "leave", id: target.a.id });
    } else if (msg.t === "mute") {
      for (const p of this.peers()) if (p.a.id !== me.id && (msg.id === "*" || p.a.id === msg.id)) this.send(p.ws, { t: "mute", by: me.name });
    }
  }

  async webSocketClose(ws) {
    this.left(ws);
  }

  async webSocketError(ws) {
    this.left(ws);
  }

  left(ws) {
    const me = ws.deserializeAttachment() || {};
    if (!me.id) return;
    ws.serializeAttachment({});
    if (me.wait) {
      for (const p of this.hosts()) this.send(p.ws, { t: "knock-gone", id: me.id });
      return;
    }
    for (const p of this.peers()) if (p.ws !== ws) this.send(p.ws, { t: "leave", id: me.id });
    // the last host left: nobody can answer anyone asking to join, so they come in
    if (me.host && !this.hosts().length) for (const p of this.peers(true)) if (p.a.wait) this.admit(p.ws, p.a);
  }
}
