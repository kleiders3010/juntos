// Item 46: how much signalling the game host's copy of Juntos carries (the rented host: one core, 2 GiB, every game
// in it). Media goes device to device, so the server only passes the handshakes. Runs kinetic/server.mjs locally (never
// the live host), opens CALLS calls of PEOPLE each (spread over fake addresses), and every pair does a handshake like a
// browser's (an offer and an answer of 3 KB, 10 small candidates each way). Prints memory, CPU and how long a
// handshake message takes to arrive.
//   CALLS=50 PEOPLE=4 node worker/load_test.mjs
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const KIN = join(here, "..", "kinetic");
execFileSync("node", ["pack.mjs"], { cwd: KIN });
const { WebSocket } = await import(pathToFileURL(join(KIN, "node_modules", "ws", "wrapper.mjs")).href);
const CALLS = Number(process.env.CALLS) || 50;
const PEOPLE = Number(process.env.PEOPLE) || 4;
const PORT = Number(process.env.PORT) || 8853;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const data = mkdtempSync(join(tmpdir(), "juntos-load-"));
const probe = join(data, "probe.mjs");
writeFileSync(probe, `let c0 = process.cpuUsage(); setInterval(() => { const c = process.cpuUsage(c0);
  process.stderr.write("probe " + process.memoryUsage().rss + " " + (c.user + c.system) + "\\n"); }, 500).unref();`);
const srv = spawn("node", ["--import", pathToFileURL(probe).href, "server.mjs"], { cwd: KIN, windowsHide: true,
  stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, PORT: String(PORT), BIND: "127.0.0.1", DATA_DIR: join(data, "d") } });
let rss = 0, peak = 0, cpu = 0;
srv.stderr.on("data", (d) => {
  for (const l of String(d).split("\n")) {
    const m = l.match(/^probe (\d+) (\d+)/);
    if (m) { rss = Number(m[1]); peak = Math.max(peak, rss); cpu = Number(m[2]); }
  }
});
for (let i = 0; i < 80; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).status < 500) break; } catch {}
  await wait(100);
}
await wait(600);
const idle = rss;
const MB = (b) => (b / 1048576).toFixed(0) + " MB";
let addr = 0;
const ipOf = (n) => `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${Math.floor(n / 4) & 255}`; // a household: 4 an address
const arrive = [];
let refused = 0;
const person = (code, n) => new Promise((res) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/${code}`, { headers: { "x-forwarded-for": ipOf(addr++) } });
  ws.pid = `load${n}x${code}`.slice(0, 40);
  ws.on("open", () => ws.send(JSON.stringify({ t: "hello", id: ws.pid, name: "P" + n, cap: 2 })));
  ws.on("message", (d) => {
    const m = JSON.parse(String(d));
    if (m.t === "room") res(ws);
    if (m.t === "full" || m.t === "wait") { refused++; res(null); }
    if (m.t === "signal" && m.data?.at) arrive.push(Date.now() - m.data.at);
  });
  ws.on("error", () => { refused++; res(null); });
  ws.on("close", () => res(null));
  setTimeout(() => res(null), 10000);
});
const t0 = Date.now();
const calls = [];
for (let c = 0; c < CALLS; c++) {
  const code = `load-${String(c).padStart(5, "0")}-call`;
  const ppl = [];
  for (let p = 0; p < PEOPLE; p++) ppl.push(await person(code, c * 1000 + p));
  calls.push(ppl.filter(Boolean));
}
const joinMs = Date.now() - t0;
await wait(1000);
const afterJoin = rss;
const sdp = "x".repeat(3000), cand = "c".repeat(200);
const cpu0 = cpu, h0 = Date.now();
let sent = 0;
// every pair: offer, answer, 10 candidates each way, spread over 2 s (a browser trickles them)
for (const ppl of calls) for (let i = 0; i < ppl.length; i++) for (let j = i + 1; j < ppl.length; j++) {
  const a = ppl[i], b = ppl[j];
  const go = (from, to, body, ms) => setTimeout(() => {
    if (from.readyState === 1) { from.send(JSON.stringify({ t: "signal", to: to.pid, data: { at: Date.now(), body } })); sent++; }
  }, ms);
  const start = Math.random() * 2000;
  go(a, b, sdp, start);
  go(b, a, sdp, start + 50);
  for (let k = 0; k < 10; k++) { go(a, b, cand, start + 60 + k * 40); go(b, a, cand, start + 70 + k * 40); }
}
await wait(6000);
const usedCpu = (cpu - cpu0) / 1000, ms = Date.now() - h0;
arrive.sort((x, y) => x - y);
const p = (q) => arrive[Math.min(arrive.length - 1, Math.floor(q * arrive.length))];
const joined = calls.reduce((s, c) => s + c.length, 0);
console.log(JSON.stringify({
  calls: CALLS, peoplePerCall: PEOPLE, joined, refused, joinedIn: joinMs + " ms",
  memIdle: MB(idle), memAfterJoin: MB(afterJoin), memPeak: MB(peak),
  memPerPerson: ((afterJoin - idle) / 1024 / Math.max(1, joined)).toFixed(1) + " KB",
  handshakeMessages: { sent, arrived: arrive.length },
  serverCpu: usedCpu.toFixed(0) + " ms of " + ms + " ms (" + (100 * usedCpu / ms).toFixed(0) + "% of one core)",
  arriveMs: { p50: p(0.5), p95: p(0.95), max: arrive[arrive.length - 1] },
}));
for (const c of calls) for (const ws of c) ws.terminate();
srv.kill();
await wait(300);
try { rmSync(data, { recursive: true, force: true }); } catch {}
process.exit(0);
