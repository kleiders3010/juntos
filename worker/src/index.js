// Juntos signaling: one Durable Object per room relays WebRTC handshakes between the people in it.
// Media, chat and the board never pass through here: they go device to device (WebRTC).
// The room keeps no history and no names once everyone has left.

const MAX_PEOPLE = 12; // a direct mesh beyond this asks too much of phones
const MAX_MSG = 64 * 1024;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/ws\/([a-z0-9-]{4,64})$/);
    if (m) {
      if (req.headers.get("Upgrade") !== "websocket") return new Response("expected a websocket", { status: 426 });
      const id = env.ROOMS.idFromName(m[1]);
      return env.ROOMS.get(id).fetch(req);
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

  // Budget object only: drop the per-network counts of past days.
  async alarm() {
    const today = "ip:" + new Date().toISOString().slice(0, 10);
    const old = [...(await this.state.storage.list({ prefix: "ip:" })).keys()].filter((k) => !k.startsWith(today));
    if (old.length) await this.state.storage.delete(old.slice(0, 128));
    if (old.length > 128) await this.state.storage.setAlarm(Date.now() + 1000);
  }

  peers() {
    return this.state.getWebSockets().map((ws) => ({ ws, a: ws.deserializeAttachment() || {} })).filter((p) => p.a.id);
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
    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1]);
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
      const others = this.peers();
      if (others.length >= MAX_PEOPLE) {
        this.send(ws, { t: "full", max: MAX_PEOPLE });
        return ws.close(1008, "full");
      }
      ws.serializeAttachment({ id, name });
      this.send(ws, { t: "peers", peers: others.map((p) => ({ id: p.a.id, name: p.a.name })) });
      for (const p of others) this.send(p.ws, { t: "join", id, name });
      return;
    }
    if (!me.id) return;
    if (msg.t === "signal" && typeof msg.to === "string") {
      const target = this.peers().find((p) => p.a.id === msg.to);
      if (target) this.send(target.ws, { t: "signal", from: me.id, data: msg.data });
      return;
    }
    if (msg.t === "name") {
      const name = String(msg.name || "").slice(0, 60);
      ws.serializeAttachment({ ...me, name });
      for (const p of this.peers()) if (p.ws !== ws) this.send(p.ws, { t: "name", id: me.id, name });
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
    for (const p of this.peers()) if (p.ws !== ws) this.send(p.ws, { t: "leave", id: me.id });
  }
}
