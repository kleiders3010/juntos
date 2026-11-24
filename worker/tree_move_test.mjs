// Tree calls: a device that can't reach its parent asks to hang on someone else ("tree-move", worker index.js).
// Only the asker moves, only off its own current parent, at most once every TREE_MOVE_MS, never back onto it.
// Runs the room code on the kinetic server (the same code, pack.mjs) with MESH_MAX 2 so 5 people make a tree.
//   node worker/tree_move_test.mjs
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const KIN = join(here, "..", "kinetic");
execFileSync("node", ["pack.mjs"], { cwd: KIN });
const { WebSocket } = await import(pathToFileURL(join(KIN, "node_modules", "ws", "wrapper.mjs")).href);
const roomMod = await import(pathToFileURL(join(KIN, "room.mjs")).href);
const TREE_MOVE_MS = roomMod.Room.TREE_MOVE_MS;

const PORT = 8843;
let fail = 0;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) fail++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// The Cloudflare runtime refuses to start a Worker whose module exports anything but functions and classes
// (2026-11-24: "export const TREE_MOVE_MS" passed this test and broke the Worker): same module, checked here.
const notFn = Object.keys(roomMod).filter((k) => k !== "default" && typeof roomMod[k] !== "function");
check(!notFn.length, `the Worker module exports only functions and classes${notFn.length ? ": not " + notFn.join(", ") : ""}`);
check(TREE_MOVE_MS > 0, `Room.TREE_MOVE_MS is ${TREE_MOVE_MS}`);

const data = mkdtempSync(join(tmpdir(), "juntos-move-"));
const srv = spawn("node", ["server.mjs"], { cwd: KIN, windowsHide: true, stdio: "ignore",
  env: { ...process.env, PORT: String(PORT), BIND: "127.0.0.1", DATA_DIR: data, MESH_MAX: "2" } });
for (let i = 0; i < 50; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).status < 500) break; } catch {}
  await wait(100);
}
const room = "mv" + Math.random().toString(36).slice(2, 10);
const people = {};
const join1 = (name) => new Promise((res) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/${room}`);
  const id = "id" + name + Math.random().toString(36).slice(2, 10);
  const p = { ws, id, name, tree: null, trees: 0 };
  ws.on("open", () => ws.send(JSON.stringify({ t: "hello", id, name, cap: 2, pub: "a".repeat(44) })));
  ws.on("message", (d) => {
    const m = JSON.parse(String(d));
    if (m.t === "tree") { p.tree = m; p.trees++; }
    if (m.t === "peers") res(p);
  });
  setTimeout(() => res(p), 4000);
});
try {
  for (const n of ["Ana", "Beto", "Caro", "Dani", "Eva"]) { people[n] = await join1(n); await wait(150); }
  await wait(500);
  const byId = (id) => Object.values(people).find((p) => p.id === id);
  const parentOf = (n) => people[n].tree && people[n].tree.parent;
  check(Object.values(people).every((p) => p.tree), "5 people with MESH_MAX 2: everyone is in a tree");
  const { Dani, Eva } = people;
  const old = parentOf("Dani");
  check(!!old, `Dani hangs on ${old && byId(old)?.name}`);

  // the root can't move
  const root = Object.values(people).find((p) => p.tree && !p.tree.parent);
  const rootTrees = root.trees;
  root.ws.send(JSON.stringify({ t: "tree-move", parent: null }));
  // someone can't move off a parent that isn't theirs (nor move another person)
  const evaTrees = Eva.trees;
  const notEva = Object.values(people).find((p) => p.id !== parentOf("Eva") && p !== Eva);
  Eva.ws.send(JSON.stringify({ t: "tree-move", parent: notEva.id }));
  await wait(400);
  check(root.trees === rootTrees, "the top of the tree asking to move: nothing changes");
  check(Eva.trees === evaTrees, "asking to move off someone who isn't my parent: nothing changes");

  // Dani moves off her parent
  const before = Dani.trees;
  Dani.ws.send(JSON.stringify({ t: "tree-move", parent: old }));
  await wait(400);
  const now = parentOf("Dani");
  check(Dani.trees > before && now && now !== old, `Dani asks to move: hangs on ${byId(now)?.name} now, not ${byId(old)?.name}`);
  check(!(byId(old).tree.kids || []).includes(Dani.id), `${byId(old)?.name} is told Dani is no longer a child`);
  check((byId(now).tree.kids || []).includes(Dani.id), `${byId(now)?.name} is told Dani is a child`);

  // again at once: refused (at most once every TREE_MOVE_MS)
  const t2 = Dani.trees;
  Dani.ws.send(JSON.stringify({ t: "tree-move", parent: now }));
  await wait(400);
  check(Dani.trees === t2 && parentOf("Dani") === now, `a second move within ${TREE_MOVE_MS} ms: nothing changes`);
} finally {
  for (const p of Object.values(people)) try { p.ws.close(); } catch {}
  srv.kill();
  await wait(300);
  try { rmSync(data, { recursive: true, force: true }); } catch {}
}
console.log(fail ? `${fail} FAILED` : "ALL OK");
process.exit(fail ? 1 : 0);
