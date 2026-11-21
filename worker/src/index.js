// Juntos signaling: one Durable Object per room relays WebRTC handshakes between the people in it.
// Media, chat and the board never pass through here: they go device to device (WebRTC).
// The room keeps no history and no names once everyone has left; only a hash of the host's key,
// the lock, a hash of the passcode (if the host set one), the permissions, and by random per-visit ids (no names)
// the co-hosts, speaking choices and who was let in; forgotten a month after the room was last used.

// Up to MESH_MAX people everyone links to everyone (big_test.py: 16 people, everyone hears everyone). Past that a
// direct link to everyone asks too much of phones, so the call becomes a tree (tree_test.py): each person links to
// one parent and a few children, and sound, pictures and messages are passed along it, device to device.
import { schnorr } from "../../web/vendor/noble-secp256k1/index.js";

// A name as others see it, cleaned here too (safety round 2, J16): the same rule as web/names.js, copied so the
// game host's copy (kinetic/pack.mjs) needs no other file; safety2_test.py checks the two stay the same.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u115f\u1160\u180e\u200b\u200c\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\u3164\ufeff\uffa0\ufff9-\ufffb]/g;
const LONE_JOINER = /(?<![\p{Extended_Pictographic}\p{Emoji_Modifier}\ufe0f])\u200d|\u200d(?!\p{Extended_Pictographic})/gu;
const cleanName = (v, n) => String(v ?? "").replace(/\s+/g, " ").replace(INVISIBLE, "").replace(LONE_JOINER, "").replace(/ {2,}/g, " ").trim().slice(0, n);

// The call's code is made from the host's public key (web/hostauth.js codeOf): whoever holds a key that makes
// this code started the call (APP-RULES safety 2). Old calls (a random code) can't prove it and keep the old rule.
const CABC = "abcdefghijkmnpqrstuvwxyz";
const codeOfPub = (pub) => {
  const s = Array.from(pub.subarray(0, 10), (b) => CABC[b % CABC.length]).join("");
  return `${s.slice(0, 3)}-${s.slice(3, 7)}-${s.slice(7)}`;
};
// The host proves it holds the key that makes this code by signing this visit's id (web/hostauth.js helloProof);
// the key itself never comes here (safety round 2, J13). The id is proven too (idProven), so a proof seen once
// can't be used by anyone else.
async function hostOk(msg, room, id) {
  if (typeof msg.hp !== "string" || !/^[0-9a-f]{64}$/.test(msg.hp) || typeof msg.hsig !== "string" || !/^[0-9a-f]{128}$/.test(msg.hsig)) return false;
  try {
    const pub = Uint8Array.from(msg.hp.match(/../g), (h) => parseInt(h, 16));
    if (codeOfPub(pub) !== room) return false;
    const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`juntos-hello|${room}|${id}`)));
    return await schnorr.verifyAsync(Uint8Array.from(msg.hsig.match(/../g), (h) => parseInt(h, 16)), d, pub);
  } catch (_) {
    return false;
  }
}
// an older page still sends the key itself
export function keyMakesCode(key, code) {
  if (!/^[0-9a-f]{64}$/.test(key || "")) return false;
  try {
    return codeOfPub(schnorr.getPublicKey(Uint8Array.from(key.match(/../g), (h) => parseInt(h, 16)))) === code;
  } catch (_) {
    return false;
  }
}

// limits (APP-RULES safety 5), far above a real call: setting up links to 15 others is a few hundred messages
const BUDGET_MS = 10000;
const BUDGET = { in: 1500, none: 10 }; // messages per socket per 10 s (in: has said hello), then it is closed
const MAX_SOCKETS = 250; // per room (MAX_PEOPLE in the call + people waiting to be let in)
const HELLO_MS = 10000; // a socket that has not said hello by then is closed

// a socket that never says who it is does not stay open
export function idleClose(ws) {
  setTimeout(() => {
    if (!(ws.deserializeAttachment() || {}).id) try { ws.close(1008, "no hello"); } catch (_) {}
  }, HELLO_MS);
}
// each socket's message budget; over it, the socket is closed
export function overBudget(room, ws) {
  const b = (room.budget ||= new Map());
  const now = Date.now();
  let x = b.get(ws);
  if (!x || now - x.t > BUDGET_MS) b.set(ws, (x = { t: now, n: 0 }));
  if (++x.n <= ((ws.deserializeAttachment() || {}).id ? BUDGET.in : BUDGET.none)) return false;
  try { ws.close(1008, "too many messages"); } catch (_) {}
  return true;
}

const MESH_MAX = 16;
const MAX_PEOPLE = 200;
const MAX_KIDS = 6; // the most children a device may say it can feed
const MAX_MSG = 64 * 1024;
const ROOM_KEEP = 31 * 24 * 3600 * 1000; // a room's host and lock are forgotten a month after its last use
const HOST_CMDS = new Set(["lock", "admit", "admit-all", "deny", "remove", "pass", "talk", "perm", "cohost", "end"]);
// What everyone may do, set by the hosts (Meet's host management: chat, present, audio locks). Hosts and co-hosts
// always may. "talk" off = nobody may speak unless a host lets them one by one (Zoom's "Mute all" without "Allow
// participants to unmute themselves"). A host never switches anyone's microphone on or off: who isn't allowed to
// speak isn't heard, and their own microphone switch stays as they left it.
const PERMS = { talk: true, share: true, chat: true, caps: true };
const MAX_TALK = 200; // people with their own speaking permission kept per room
const MAX_IN = 300; // people already let in, kept per room (their link coming back doesn't ask again)
// A passcode, like Zoom's: 4 to 10 letters or numbers (case matters). Wrong tries are limited per network.
const PASS_RE = /^[A-Za-z0-9]{4,10}$/;
const PASS_TRIES = 5; // wrong passcodes in a row from one network ...
const PASS_WAIT = 60 * 1000; // ... then it waits this long

async function passHash(room, pass) {
  return sha("pass|" + room + "|" + pass);
}

// A hello that proves its id (safety round 2, J2): the id is the start of the visit's key (web/hostauth.js idOf) and
// the hello is signed with it. Only a proven id can take over its own earlier link, come back into a locked call,
// or be a co-host; an unproven one (an old page) is a plain guest and can't push anyone out.
const unhex = (s) => Uint8Array.from(s.match(/../g) || [], (h) => parseInt(h, 16));
async function idProven(msg, room, id) {
  if (typeof msg.ck !== "string" || !/^[0-9a-f]{64}$/.test(msg.ck) || msg.ck.slice(0, 16) !== id) return false;
  if (typeof msg.idp !== "string" || !/^[0-9a-f]{128}$/.test(msg.idp)) return false;
  try {
    const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`juntos-id|${room}|${id}`)));
    return await schnorr.verifyAsync(unhex(msg.idp), d, unhex(msg.ck));
  } catch (_) {
    return false;
  }
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
    // tests only (wrangler.test.toml: every request comes here first): the pages as shipped, plus this computer in
    // their CSP so test relays and test servers on other local ports can be reached. Never set when deployed.
    if (env.TEST_LOCAL_CSP === "1" && env.ASSETS) return testPage(req, env);
    return new Response("not found", { status: 404 });
  },
};

const LOCAL_CSP = " http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:*";
async function testPage(req, env) {
  const r = await env.ASSETS.fetch(req);
  if (!(r.headers.get("content-type") || "").includes("text/html")) return r;
  const html = (await r.text()).replace(/(connect-src [^;"]*)/, (m) => m + LOCAL_CSP);
  const h = new Headers(r.headers);
  h.delete("content-length");
  return new Response(html, { status: r.status, headers: h });
}

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
  constructor(state, env) {
    // tests only (wrangler dev --var MESH_MAX:4): the tree from a few people on, so one PC can run it
    this.meshMax = Number(env && env.MESH_MAX) || MESH_MAX;
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

  // the host (who started the call) and the co-hosts the host chose
  hosts() {
    return this.peers().filter((p) => p.a.host || p.a.co);
  }

  // permissions, speaking per person and co-hosts live in storage: the room may sleep between messages
  async loadPerms() {
    if (this.perms) return;
    const st = this.state.storage;
    this.perms = { ...PERMS, ...((await st.get("perms")) || {}) };
    this.talk = (await st.get("talk")) || {};
    this.cos = (await st.get("cos")) || {};
    this.in = (await st.get("in")) || {};
  }
  permMsg(by) {
    return { t: "perms", perms: this.perms, talk: this.talk, ...(by ? { by } : {}) };
  }
  role(a) {
    return a.host ? "host" : a.co ? "co" : "";
  }

  // let someone in: they get everyone already here, everyone hears about them
  admit(ws, a) {
    const others = this.peers().filter((p) => p.ws !== ws && p.a.id !== a.id); // an old link of theirs isn't someone else
    // remembered only while the call is locked (the only time it matters); locking remembers everyone already in.
    // Each write counts against the free plan's 100,000 rows written a day, so a join writes nothing it needn't.
    if (this.in && !this.in[a.id] && this.locked) {
      this.in[a.id] = 1;
      const ids = Object.keys(this.in);
      if (ids.length > MAX_IN) delete this.in[ids[0]];
      this.state.storage.put("in", this.in);
    }
    ws.serializeAttachment({ id: a.id, name: a.name, host: !!a.host, co: !!a.co, cap: a.cap || 2, pub: a.pub || "" });
    const me = { ws, a: ws.deserializeAttachment() };
    const big = others.some((p) => p.a.tree) || others.length + 1 > this.meshMax;
    this.send(ws, { t: "peers", big, peers: others.map((p) => ({ id: p.a.id, name: p.a.name, host: !!(p.a.host || p.a.co), role: this.role(p.a), pub: p.a.pub || "" })) });
    this.send(ws, { t: "room", locked: !!this.locked, host: !!(a.host || a.co), owner: !!a.host, pass: !!this.hasPass });
    this.send(ws, this.permMsg());
    for (const p of others) this.send(p.ws, { t: "join", id: a.id, name: a.name, host: !!(a.host || a.co), role: this.role(a), pub: a.pub || "" });
    if (big) {
      const all = [...others, me];
      const changed = new Set([me]);
      if (!others.some((p) => p.a.tree)) {
        // the call just grew past a mesh: everyone goes into the tree, the devices that can feed most nearest the top
        all.sort((x, y) => (y.a.cap || 2) - (x.a.cap || 2));
        for (const p of all) this.setA(p, { tree: true, parent: null });
        for (const p of all.slice(1)) this.attach(all, p);
        all.forEach((p) => changed.add(p));
      } else {
        const parent = this.attach(all, me);
        if (parent) changed.add(parent);
      }
      this.sendTree(all, changed);
    }
    // a co-host coming back hears who is waiting
    if (a.co) for (const p of this.peers(true)) if (p.a.wait) this.send(ws, { t: "knock", id: p.a.id, name: p.a.name });
  }

  setA(p, patch) {
    p.a = { ...p.a, ...patch };
    p.ws.serializeAttachment(p.a);
  }

  // hang p under the person nearest the top who still has room for a child (p's own branch hangs from p and
  // isn't reachable from the top, so it's never chosen); returns the new parent, or null if p is the top
  attach(all, p) {
    const kids = (id) => all.filter((q) => q !== p && q.a.tree && q.a.parent === id);
    const root = all.find((q) => q !== p && q.a.tree && !q.a.parent);
    if (!root) {
      this.setA(p, { tree: true, parent: null });
      return null;
    }
    const queue = [root];
    for (let i = 0; i < queue.length; i++) {
      const q = queue[i];
      const k = kids(q.a.id);
      if (k.length < (q.a.cap || 2)) {
        this.setA(p, { tree: true, parent: q.a.id });
        return q;
      }
      queue.push(...k);
    }
    this.setA(p, { tree: true, parent: root.a.id });
    return root;
  }

  // each person's links: their parent and their children
  sendTree(all, who) {
    for (const p of who) {
      if (!p || !all.includes(p)) continue;
      const kids = all.filter((q) => q.a.tree && q.a.parent === p.a.id).map((q) => q.a.id);
      this.send(p.ws, { t: "tree", parent: p.a.parent || null, kids });
    }
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
      // server: this call uses the server (a passcode, ask-to-join, or people already in it through the server);
      // asked by someone who found nobody through the relays
      const server = pass || !!(await this.state.storage.get("locked")) || this.peers(true).length > 0;
      return Response.json({ pass, server }, { headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
    }
    if (this.state.getWebSockets().length >= MAX_SOCKETS) return new Response("full", { status: 429 });
    const pair = new WebSocketPair();
    // the room's name (for the passcode hash) and a daily hash of the network (for the wrong-passcode limit)
    this.state.acceptWebSocket(pair[1], [req.headers.get("x-room") || "", req.headers.get("x-ip-key") || "ip:none"]);
    idleClose(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  send(ws, msg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch (_) {}
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== "string" || raw.length > MAX_MSG) return;
    if (overBudget(this, ws)) return;
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
      const name = cleanName(msg.name, 60);
      // how many children this device says it can feed in a big call, and its public key (relayed messages are signed)
      const cap = Math.max(1, Math.min(MAX_KIDS, Math.floor(Number(msg.cap)) || 2));
      const pub = typeof msg.pub === "string" && /^[A-Za-z0-9_-]{40,120}(\.[A-Za-z0-9_-]{40,120})?$/.test(msg.pub) ? msg.pub : "";
      if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) return ws.close(1008, "bad id");
      const [room, net] = this.state.getTags(ws);
      const proven = await idProven(msg, room, id);
      // the same id already here: only its own key may take that link over (after the passcode, below)
      if (!proven && this.peers(true).some((p) => p.a.id === id && p.ws !== ws)) return ws.close(4004, "id in use");
      if (this.peers().filter((p) => p.a.id !== id).length >= MAX_PEOPLE) {
        this.send(ws, { t: "full", max: MAX_PEOPLE });
        return ws.close(1008, "full");
      }
      // a tree needs every device in it to pass sound and pictures on (WebCodecs; a device that can't sends no
      // key): if one can't, the newcomer is told the call is full, and nobody already in is pushed out
      const now = this.peers().filter((p) => p.ws !== ws && p.a.id !== id);
      if ((now.some((p) => p.a.tree) || now.length + 1 > this.meshMax) && (!pub || now.some((p) => !p.a.pub))) {
        this.send(ws, { t: "full", max: this.meshMax });
        return ws.close(1008, "full");
      }
      // The person who started the call holds a secret key (kept on their device): the call's code is made from
      // it, and the host proves it by signing this visit's id. Nobody ever becomes host by asking first (safety
      // round 2, J4): an empty room has no host until its code's maker comes. A room an older version let
      // somebody claim (a stored hash) loses that claim, and what was set with it, when the maker comes. Calls with
      // an old random code keep the host hash they already have; nobody can claim a new one.
      const st = this.state.storage;
      const hostHash = await st.get("host");
      let host = false;
      const key = typeof msg.key === "string" ? msg.key.slice(0, 80) : "";
      if ((proven && (await hostOk(msg, room, id))) || keyMakesCode(key, room)) {
        host = true;
        if (!(await st.get("hostProven"))) {
          if (hostHash) {
            for (const k of ["locked", "pass", "opened", "host"]) await st.delete(k);
            this.locked = false;
            // whoever claimed it before is in the call no longer as its host: they come back as a guest
            for (const p of this.peers()) if (p.ws !== ws && p.a.host) p.ws.close(4001, "host changed");
          }
          await st.put("hostProven", true);
        }
      } else if (key.length >= 16 && hostHash && !(await st.get("hostProven"))) host = (await sha(key)) === hostHash;
      // the host's own short link carrying the lock and the passcode (a planned call, the other server): applied,
      // and nobody joins
      if (Array.isArray(msg.ctl)) {
        if (!host) return ws.close(4005, "not host");
        for (const c of msg.ctl.slice(0, 4)) if (c && (c.t === "lock" || c.t === "pass")) await this.hostCmd({ id, name }, c, ws);
        if (!(await st.get("opened"))) await st.put("opened", true);
        this.send(ws, { t: "ctl-ok" });
        return ws.close(1000, "ok");
      }
      if (this.locked === undefined) this.locked = !!(await st.get("locked"));
      // the host's choices when starting the call (people ask to join, a passcode), only the first time
      if (host && msg.claim && msg.opts && !(await st.get("opened"))) {
        if (msg.opts.lock) await st.put("locked", (this.locked = true));
        if (PASS_RE.test(msg.opts.pass || "")) await st.put("pass", await passHash(room, msg.opts.pass));
      }
      if (host && !(await st.get("opened"))) await st.put("opened", true);
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
      // past the passcode: a proven id now replaces its own earlier link (a reload, a dropped connection)
      for (const p of this.peers(true))
        if (p.a.id === id && p.ws !== ws) {
          p.ws.serializeAttachment({});
          try {
            p.ws.close(4004, "replaced");
          } catch (_) {}
        }
      // "last used" moves at most once a day (the room is forgotten a month after it)
      if (Date.now() - ((await st.get("seen")) || 0) > 24 * 3600 * 1000) {
        await st.put("seen", Date.now());
        await st.setAlarm(Date.now() + ROOM_KEEP);
      }
      await this.loadPerms();
      const co = !host && proven && !!this.cos[id];
      const hosts = this.hosts();
      // locked (or sent out earlier): ask to join, a host decides. With no host here nobody could answer, so come in.
      // someone already let in whose link to the server dropped comes straight back (ids are random per visit)
      const back = proven && !!this.in[id] && !msg.knock;
      if (!host && !co && !back && (this.locked || msg.knock) && hosts.length) {
        ws.serializeAttachment({ id, name, wait: true, cap, pub });
        this.send(ws, { t: "waiting" });
        for (const p of hosts) this.send(p.ws, { t: "knock", id, name });
        return;
      }
      return this.admit(ws, { id, name, host, co, cap, pub });
    }
    if (!me.id) return;
    // someone still waiting to be let in sends nothing to the people inside, handshakes included (safety round 2, J10)
    if (me.wait) return;
    if (msg.t === "signal" && typeof msg.to === "string") {
      const target = this.peers().find((p) => p.a.id === msg.to);
      if (target) this.send(target.ws, { t: "signal", from: me.id, data: msg.data });
      return;
    }
    if ((me.host || me.co) && HOST_CMDS.has(msg.t)) return this.hostCmd(me, msg, ws);
    if (msg.t === "name") {
      const name = cleanName(msg.name, 60);
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
      if (this.locked && this.in) {
        for (const p of this.peers()) this.in[p.a.id] = 1;
        const ids = Object.keys(this.in);
        for (const id of ids.slice(0, Math.max(0, ids.length - MAX_IN))) delete this.in[id];
        await this.state.storage.put("in", this.in);
      }
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
    } else if (msg.t === "remove" && target && !target.a.wait && !target.a.host && (!target.a.co || me.host)) {
      this.send(target.ws, { t: "removed", by: me.name });
      target.ws.serializeAttachment({});
      target.ws.close(4002, "removed");
      if (this.in) {
        delete this.in[target.a.id];
        await this.state.storage.put("in", this.in);
      }
      for (const p of this.peers()) this.send(p.ws, { t: "leave", id: target.a.id, removed: true });
    } else if (msg.t === "end") {
      // Meet's "End the call for everyone": everyone is sent out, the hosts and whoever is waiting to come in too
      // (breakout rooms are inside the same call, so they end with it)
      for (const p of all) {
        this.send(p.ws, { t: "ended", by: me.name });
        p.ws.serializeAttachment({});
        try {
          p.ws.close(4005, "ended");
        } catch (_) {}
      }
      await this.loadPerms();
      this.in = {};
      await this.state.storage.put("in", this.in);
    } else if (msg.t === "talk" || msg.t === "perm" || msg.t === "cohost") {
      await this.loadPerms();
      const st = this.state.storage;
      if (msg.t === "talk" && msg.id === "*") {
        // everyone at once: the per-person choices start over
        this.perms.talk = !!msg.on;
        this.talk = {};
        await st.put({ perms: this.perms, talk: this.talk });
      } else if (msg.t === "talk") {
        if (!target || target.a.wait || target.a.host || target.a.co) return;
        delete this.talk[target.a.id];
        if (!!msg.on !== this.perms.talk) this.talk[target.a.id] = !!msg.on;
        const ids = Object.keys(this.talk);
        if (ids.length > MAX_TALK) delete this.talk[ids[0]];
        await st.put("talk", this.talk);
      } else if (msg.t === "perm") {
        if (!["share", "chat", "caps"].includes(msg.key)) return;
        this.perms[msg.key] = !!msg.on;
        await st.put("perms", this.perms);
      } else {
        // only the host makes or unmakes co-hosts (Meet: "Grant host controls")
        if (!me.host || !target || target.a.wait || target.a.host) return;
        const on = !!msg.on;
        target.ws.serializeAttachment({ ...target.a, co: on });
        if (on) this.cos[target.a.id] = 1;
        else delete this.cos[target.a.id];
        await st.put("cos", this.cos);
        for (const p of this.peers()) this.send(p.ws, { t: "role", id: target.a.id, role: on ? "co" : "", by: me.name });
        if (on) for (const p of this.peers(true)) if (p.a.wait) this.send(target.ws, { t: "knock", id: p.a.id, name: p.a.name });
        return;
      }
      for (const p of this.peers()) this.send(p.ws, this.permMsg(me.name));
    }
  }

  async webSocketClose(ws) {
    this.budget?.delete(ws);
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
    if (me.tree) {
      // the tree closes over the gap: the children of who left hang on elsewhere (each with its own branch)
      const all = this.peers().filter((p) => p.ws !== ws && p.a.tree);
      const orphans = all.filter((p) => p.a.parent === me.id).sort((x, y) => (y.a.cap || 2) - (x.a.cap || 2));
      const changed = new Set(orphans);
      if (me.parent) changed.add(all.find((p) => p.a.id === me.parent));
      if (!me.parent && orphans.length) this.setA(orphans.shift(), { parent: null });
      for (const o of orphans) changed.add(this.attach(all, o));
      this.sendTree(all, changed);
    }
    // the last host left: nobody can answer anyone asking to join, so they come in
    if ((me.host || me.co) && !this.hosts().length) for (const p of this.peers(true)) if (p.a.wait) this.admit(p.ws, p.a);
  }
}
