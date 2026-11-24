// giveUp (web/rtc.js): the caller retries a stuck direct link twice, unless a helper already waits for this pair.
// 2026-11-24 big_test: the other side (lower id) had moved to a helper and drops direct signals; the caller kept making
// fresh offers nobody answered (~21 s each with a relay) and gave up after the helper's offer had expired (30 s, J5),
// so the pair stayed stuck for good ("retries 2 gave up", have-local-offer). Run: node worker/giveup_test.mjs
import { Mesh } from "../web/rtc.js";
import { Fwd } from "../web/fwd.js";

let fails = 0;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) fails++; };

function fakeMesh() {
  const m = { peers: new Map(), closed: false, retries: 0, needs: 0, taken: [] };
  m.emit = () => {};
  m.retry = (id) => { m.retries++; const q = { id, offerer: true, state: "connecting" }; m.peers.set(id, q); };
  m.fwd = Object.create(Fwd.prototype);
  m.fwd.m = m;
  m.fwd.earlyOn = new Map();
  m.fwd.need = () => { m.needs++; };
  m.fwd.on = (from, of) => { m.taken.push([from, of]); };
  return m;
}
const stuck = (id) => ({ id, offerer: true, state: "connecting" });

let m = fakeMesh();
let p = stuck("b"); m.peers.set("b", p);
Mesh.prototype.giveUp.call(m, p);
check(m.retries === 1 && !p.gaveUp, "no helper waiting: the caller starts a fresh connection");

m = fakeMesh();
p = stuck("b"); m.peers.set("b", p);
m.fwd.earlyOn.set("b", { from: "h", sid: "s", name: "B", at: Date.now() });
Mesh.prototype.giveUp.call(m, p);
check(m.retries === 0 && p.gaveUp, "a helper already waits: no fresh offer (the other side drops it), give up now");
check(m.taken.length === 1 && m.taken[0][0] === "h", "and the waiting helper is taken at once");

m = fakeMesh();
p = stuck("b"); m.peers.set("b", p);
m.fwd.earlyOn.set("b", { from: "h", sid: "s", name: "B", at: Date.now() - 31000 });
Mesh.prototype.giveUp.call(m, p);
check(m.retries === 1 && m.taken.length === 0, "a helper's offer older than 30 s (J5) is not taken; the caller retries");

// a tree call (big): the link to my parent has no helper; it is tried again every TREE_RETRY_MS while it is my link
// (2026-11-24 tree_test: one failed parent link cut a device off for the rest of the call)
const { TREE_RETRY_MS } = await import("../web/rtc.js");
m = fakeMesh();
m.big = { links: new Set(["b"]) };
p = stuck("b"); p.autoRetries = 2; m.peers.set("b", p);
Mesh.prototype.giveUp.call(m, p);
check(m.retries === 0 && m.needs === 0, "tree link out of quick retries: no helper asked, nothing at once");
await new Promise((r) => setTimeout(r, TREE_RETRY_MS + 300));
check(m.retries === 1 && m.peers.get("b").autoRetries === 3, `and tried again after ${TREE_RETRY_MS} ms`);

m = fakeMesh();
m.big = { links: new Set(["b"]) };
p = stuck("b"); p.autoRetries = 2; m.peers.set("b", p);
Mesh.prototype.giveUp.call(m, p);
m.big.links.delete("b"); // the server gave me another parent meanwhile
await new Promise((r) => setTimeout(r, TREE_RETRY_MS + 300));
check(m.retries === 0, "not when they are no longer my link");

// the link to my parent failed again after the tree retry: ask the server to hang me on someone else (tree-move,
// tree_move_test.mjs); not for a child's link, and not before the tree retry failed
const { TREE_MOVE_AFTER } = await import("../web/rtc.js");
const asks = (parent, tries) => {
  const m = fakeMesh();
  m.sent = [];
  m.sendSignal = (x) => m.sent.push(x);
  m.big = { links: new Set(["b"]), parent };
  const p = stuck("b"); p.autoRetries = tries; m.peers.set("b", p);
  Mesh.prototype.giveUp.call(m, p);
  clearTimeout(p.treeRetry);
  return m.sent.filter((x) => x.t === "tree-move" && x.parent === "b").length;
};
check(TREE_MOVE_AFTER >= 3 && asks("b", TREE_MOVE_AFTER) === 1, `my parent's link failed ${TREE_MOVE_AFTER} times: I ask to move`);
check(asks("b", 2) === 0, "only the quick retries failed: no move yet");
check(asks("x", TREE_MOVE_AFTER) === 0, "a child's link failing: I don't move");

console.log(fails ? `${fails} FAILED` : "ALL OK");
process.exit(fails ? 1 : 0);
