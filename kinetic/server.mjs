// Juntos's second room server, for the game host on Kinetic (GeneralGames, next to Chess Tactics).
//
// Kleider, 2026-11-18: "I don't want the app relaying forever onto the same service, all parts of the app should work
// even if one the pieces break down". The room server (worker/src/index.js) runs on Cloudflare as a Durable Object;
// this runs the very same Room class on Node, with a small stand-in for the Durable Object parts it uses (its
// websockets with their attachments and tags, its storage, its alarm). Same code, same protocol: the app uses one
// server or the other and nothing else changes.
//
// Game host contract (ChessTactics/docs/HOSTING.md "Adding a future game"): listen on PORT; keep files in
// DATA_DIR; stop on "stop" read from the input; GET /api/health as JSON. The host strips the public path
// (/juntos), so this sees /ws/<room> and /info/<room>, and passes the visitor's address in x-forwarded-for.
//
// Not here: relay (TURN) credentials (/turn), which only Cloudflare hands out.
import http from "node:http";
import { webcrypto, createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, renameSync } from "node:fs";
import { join } from "node:path";
import { WebSocketServer } from "ws";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (typeof Response.json !== "function")
  Response.json = (d, init = {}) => new Response(JSON.stringify(d), { ...init, headers: { ...(init.headers || {}), "content-type": "application/json" } });

const { Room, idleClose } = await import(process.env.JUNTOS_ROOM || "./room.mjs");

const PORT = Number(process.env.PORT) || 8799;
const BIND = process.env.BIND || "127.0.0.1"; // behind the game host's door only (safety round 2, J18)
const DATA = process.env.DATA_DIR || join(process.cwd(), "data");
const MAX_ROOMS = 5000; // rooms held in memory at once (a room with nobody in it is put away after IDLE_MS)
const IDLE_MS = 10 * 60 * 1000;
const MAX_SOCKETS = 3000;
const MAX_MSG = 64 * 1024;
mkdirSync(DATA, { recursive: true });
// how busy this server is goes only to whoever has the ops key (data/ops-key; the deploy's "is anyone online?"),
// everyone else hears "ok" (audit R17)
let opsKey = process.env.OPS_KEY || "";
if (!opsKey) try { opsKey = readFileSync(join(DATA, "ops-key"), "utf8").trim(); } catch (_) {}
const isOps = (req) => {
  const k = String(req.headers["x-ops-key"] || "");
  if (!opsKey || k.length !== opsKey.length) return false;
  let d = 0;
  for (let i = 0; i < k.length; i++) d |= k.charCodeAt(i) ^ opsKey.charCodeAt(i);
  return d === 0;
};


// What the sweep needs to know of each room file on disk: read once at start, then kept up to date on every write,
// so the sweep never re-reads the folder (APP-RULES safety 14: work proportional to what changed).
const disk = new Map(); // file -> { name, alarm, ... }
const summary = (m) => ({ name: m.__name || "", alarm: Number(m.__alarm) || 0, seen: Number(m.seen) || 0 });
for (const f of readdirSync(DATA)) {
  if (!f.endsWith(".json")) continue;
  try { disk.set(join(DATA, f), summary(JSON.parse(readFileSync(join(DATA, f), "utf8")))); } catch (_) {}
}

// ---- the Durable Object stand-in ----

const fileOf = (name) => join(DATA, createHash("sha256").update(name).digest("hex").slice(0, 32) + ".json");
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

class Storage {
  constructor(name) {
    this.name = name;
    this.file = fileOf(name);
    try {
      this.map = new Map(Object.entries(JSON.parse(readFileSync(this.file, "utf8"))));
    } catch (_) {
      this.map = new Map();
    }
  }
  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      try {
        if (!this.map.size) {
          disk.delete(this.file);
          return void unlinkSync(this.file);
        }
        const all = Object.fromEntries(this.map);
        writeFileSync(this.file + ".tmp", JSON.stringify(all));
        renameSync(this.file + ".tmp", this.file);
        disk.set(this.file, summary(all));
      } catch (e) { console.error("juntos: writing a room failed:", e && e.message); } // said, never silent (APP-RULES safety 45)
    }, 200);
  }
  async get(k) {
    if (Array.isArray(k)) return new Map(k.filter((x) => this.map.has(x)).map((x) => [x, clone(this.map.get(x))]));
    return clone(this.map.get(k));
  }
  async put(k, v) {
    if (typeof k === "object") for (const [a, b] of Object.entries(k)) this.map.set(a, clone(b));
    else this.map.set(k, clone(v));
    this.save();
  }
  async delete(k) {
    const ks = Array.isArray(k) ? k : [k];
    let n = 0;
    for (const x of ks) n += this.map.delete(x) ? 1 : 0;
    this.save();
    return Array.isArray(k) ? n : n > 0;
  }
  async deleteAll() {
    this.map.clear();
    this.save();
  }
  async list({ prefix = "" } = {}) {
    return new Map([...this.map].filter(([k]) => k.startsWith(prefix) && k !== "__alarm").map(([k, v]) => [k, clone(v)]));
  }
  async setAlarm(t) {
    this.map.set("__alarm", Number(t));
    this.save();
  }
  async getAlarm() {
    return this.map.get("__alarm") ?? null;
  }
}

class State {
  constructor(name) {
    this.storage = new Storage(name);
    this.sockets = new Set();
  }
  acceptWebSocket(ws, tags) {
    ws.tags = tags || [];
    this.sockets.add(ws);
  }
  getWebSockets() {
    return [...this.sockets];
  }
  getTags(ws) {
    return ws.tags || [];
  }
}

const rooms = new Map(); // name -> { room, state, idle }

function roomOf(name) {
  let r = rooms.get(name);
  if (!r) {
    if (rooms.size >= MAX_ROOMS) sweep(true);
    const state = new State(name);
    r = { name, state, room: new Room(state, process.env), idle: Date.now() };
    rooms.set(name, r);
  }
  return r;
}

// due alarms run; rooms nobody is in are put away (their storage stays on disk)
async function sweep(force) {
  const now = Date.now();
  for (const [name, r] of rooms) {
    const due = r.state.storage.map.get("__alarm");
    if (due && due <= now) {
      r.state.storage.map.delete("__alarm");
      try {
        await r.room.alarm();
      } catch (_) {}
    }
    if (!r.state.sockets.size && (force || now - r.idle > IDLE_MS)) rooms.delete(name);
  }
  // rooms on disk only: their alarms (a room forgotten a month after it was last used)
  if (!force)
    for (const [file, s] of [...disk]) {
      if (s.alarm && s.alarm <= now && s.seen && now - s.seen > 31 * 24 * 3600 * 1000) {
        disk.delete(file);
        try { unlinkSync(file); } catch (_) {}
      }
    }
}
setInterval(sweep, 60 * 1000).unref();

// One home line is one address: an IPv6 address counts by its /64 (a home gets billions of them), an IPv4 one as itself
// (safety round 2, J7/J9). Only a hash of it is ever kept.
function netOf(ip) {
  ip = String(ip || "unknown").trim().replace(/^::ffff:(?=\d+\.)/i, "");
  if (!ip.includes(":")) return ip;
  const [a, b = ""] = ip.split("%")[0].split("::");
  const head = a ? a.split(":") : [], tail = b ? b.split(":") : [];
  const all = ip.includes("::") ? [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill("0"), ...tail] : head;
  return all.slice(0, 4).map((x) => (parseInt(x, 16) || 0).toString(16)).join(":") + "::/64";
}
// the key of the one-way code of addresses (safety round 2, J18): made once, kept in the data folder, never printed
let ipSalt = process.env.IP_SALT || "";
if (!ipSalt)
  try {
    ipSalt = readFileSync(join(DATA, "ip-salt"), "utf8").trim();
  } catch (_) {
    ipSalt = Array.from(webcrypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
    try {
      mkdirSync(DATA, { recursive: true });
      writeFileSync(join(DATA, "ip-salt"), ipSalt);
    } catch (_) {}
  }
const ipSaltKey = webcrypto.subtle.importKey("raw", new TextEncoder().encode(ipSalt), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
async function ipKey(req) {
  const ip = netOf(String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0]);
  const day = new Date().toISOString().slice(0, 10);
  const h = await webcrypto.subtle.sign("HMAC", await ipSaltKey, new TextEncoder().encode(day + "|juntos|" + ip));
  return "ip:" + day + ":" + [...new Uint8Array(h).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- http and websockets ----

const ROOM_PATH = /^\/(ws|info)\/([a-z0-9-]{4,64})$/;
const JOIN_LIMIT = Number(process.env.JOIN_LIMIT) || 120; // links and lobby questions per address per minute (the Worker's JOINS)
const NEW_PER_MINUTE = Number(process.env.NEW_PER_MINUTE) || 30; // rooms one address may open in a minute
const MAX_FILES = 50000; // stored rooms; past this no new ones (rooms already kept still work)
const joins = new Map();
const starts = new Map();
setInterval(() => (joins.clear(), starts.clear()), 60000).unref();
let sockets = 0;
const started = Date.now();

const server = http.createServer(async (req, res) => {
  const path = (req.url || "/").split("?")[0];
  const cors = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
  if (path === "/api/health" || path === "/health") {
    res.writeHead(200, { "content-type": "application/json", ...cors });
    if (!isOps(req)) return res.end(JSON.stringify({ ok: true }));
    return res.end(JSON.stringify({ ok: true, rooms: rooms.size, people: sockets, upMinutes: Math.round((Date.now() - started) / 60000) }));
  }
  const m = path.match(ROOM_PATH);
  if (m && m[1] === "info") {
    // the same per-address count as new links, and a room nobody is in is asked without being kept: /info for
    // made-up names can't push rooms out (safety round 3, N5)
    const ip = await ipKey(req);
    const j = (joins.get(ip) || 0) + 1;
    joins.set(ip, j);
    if (j > JOIN_LIMIT) {
      res.writeHead(429, cors);
      return res.end();
    }
    try {
      const held = rooms.get(m[2]);
      const room = held ? held.room : new Room(new State(m[2]), process.env);
      const r = await room.fetch(new Request("https://room/info"));
      res.writeHead(200, { "content-type": "application/json", ...cors });
      return res.end(await r.text());
    } catch (_) {
      res.writeHead(500, cors);
      return res.end();
    }
  }
  res.writeHead(m ? 426 : 404, { "content-type": "text/plain", ...cors });
  res.end(m ? "expected a websocket" : "not found");
});

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MSG + 1024 });
server.on("upgrade", async (req, socket, head) => {
  const m = (req.url || "").split("?")[0].match(ROOM_PATH);
  if (!m || m[1] !== "ws" || sockets >= MAX_SOCKETS) return socket.destroy();
  const ip = await ipKey(req);
  // the same guards as Ronda's game host (safety round 2, J7): links per address per minute, new rooms per address per
  // minute, and no new rooms once the data folder is full (it shares a disk with the other games)
  const j = (joins.get(ip) || 0) + 1;
  joins.set(ip, j);
  if (j > JOIN_LIMIT) return socket.destroy();
  if (!rooms.has(m[2])) {
    const n = (starts.get(ip) || 0) + 1;
    starts.set(ip, n);
    if (n > NEW_PER_MINUTE || disk.size >= MAX_FILES) return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const r = roomOf(m[2]);
    sockets++;
    let att = null;
    ws.serializeAttachment = (v) => (att = clone(v));
    ws.deserializeAttachment = () => clone(att);
    r.state.acceptWebSocket(ws, [m[2], ip]);
    idleClose(ws);
    // one room's messages are handled one at a time, in order (a Durable Object does the same)
    const run = (f) => (r.chain = (r.chain || Promise.resolve()).then(f).catch((e) => console.error("juntos room error:", e && e.message)));
    ws.on("message", (data, binary) => {
      if (binary) return;
      run(() => r.room.webSocketMessage(ws, data.toString()));
    });
    ws.on("close", () => {
      sockets--;
      run(async () => {
        await r.room.webSocketClose(ws);
        r.state.sockets.delete(ws);
        r.idle = Date.now();
      });
    });
    ws.on("error", () => {});
  });
});

server.listen(PORT, BIND, () => console.log(`Juntos room server on ${BIND}:${PORT}`));

process.stdin.on("data", (d) => {
  const cmd = String(d).trim();
  if (cmd === "stop") {
    console.log("stopping");
    for (const r of rooms.values()) r.state.storage.save();
    setTimeout(() => process.exit(0), 400);
  } else if (cmd === "status") console.log(`rooms ${rooms.size}, people ${sockets}, up ${Math.round((Date.now() - started) / 60000)} min`);
});
process.stdin.resume();
