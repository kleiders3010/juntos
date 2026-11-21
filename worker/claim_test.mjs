// APP-RULES safety 2 (Ronda audit R2, same pattern here): a call's host is whoever holds the key its code is made
// from. Someone who knows the link and claims the room first (on the game host before a move, or before the host
// arrives) is replaced as soon as the real host comes, and what they set (lock, passcode) goes with them.
//   node worker/claim_test.mjs
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const KIN = join(here, "..", "kinetic");
execFileSync("node", ["pack.mjs"], { cwd: KIN });
const { WebSocket } = await import(pathToFileURL(join(KIN, "node_modules", "ws", "wrapper.mjs")).href);
const { keyMakesCode } = await import(pathToFileURL(join(KIN, "room.mjs")).href);
const { newHost } = await import(pathToFileURL(join(here, "..", "web", "hostauth.js")).href);

const PORT = 8842;
let fail = 0;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) fail++; };
const real = newHost();
const fake = newHost(); // a key that makes another code
// pinned: audit R2, the key a code is made from proves its host
check(keyMakesCode(real.key, real.code), "the host's key makes its own code");
check(!keyMakesCode(fake.key, real.code), "another key does not");
check(!keyMakesCode("abc", real.code), "nor anything that is not a key");

const data = mkdtempSync(join(tmpdir(), "juntos-claim-"));
const srv = spawn("node", ["server.mjs"], { cwd: KIN, windowsHide: true, stdio: "ignore",
  env: { ...process.env, PORT: String(PORT), BIND: "127.0.0.1", DATA_DIR: data } });
for (let i = 0; i < 50; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).status < 500) break; } catch {}
  await new Promise((r) => setTimeout(r, 100));
}
const hello = (key, opts) => new Promise((res) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/${real.code}`);
  const id = "id" + Math.random().toString(36).slice(2, 12);
  ws.on("open", () => ws.send(JSON.stringify({ t: "hello", id, name: "x", cap: 2, key, claim: true, ...(opts ? { opts } : {}) })));
  ws.on("message", (d) => { const m = JSON.parse(String(d)); if (m.t === "room") res({ ws, m }); });
  setTimeout(() => res({ ws, m: null }), 4000);
});
const a = await hello(fake.key, { lock: true, pass: "123456" });
check(a.m?.owner === true, "someone with the link claims the empty room first (old rule for random codes)");
const b = await hello(real.key);
// pinned: audit R2
check(b.m?.owner === true, "the real host arrives and is the host");
check(b.m?.locked === false && b.m?.pass === false, "the lock and passcode the first one set are gone");
a.ws.close(); b.ws.close();
await new Promise((r) => setTimeout(r, 300));
const c = await hello(fake.key);
// pinned: audit R2
check(c.m && c.m.owner === false, "the first one comes back: no longer the host");
c.ws.close();
srv.kill();
await new Promise((r) => setTimeout(r, 300));
try { rmSync(data, { recursive: true, force: true }); } catch {}
console.log(fail ? `FAIL ${fail}` : "claim OK");
process.exit(fail ? 1 : 0);
