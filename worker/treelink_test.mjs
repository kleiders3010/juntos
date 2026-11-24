// A tree link that was passed on by a helper before the call became a tree (web/rtc.js onTree).
// 2026-11-24 tree_test 20 people: a device's link to its parent was a helper pair from the full-mesh part of the call
// (no connection of its own: pc null, sealed messages "open"). onTree took it as there, so the device never called its
// parent; it also ignores every signal from a helper pair, so the parent's side couldn't fix it; tree sound and
// pictures travel only on a link's own media channel, so that device and everyone under it heard nobody.
// The same for a helper pair's "they will call, wait" placeholder: in a tree the child always calls.
// Run: node worker/treelink_test.mjs
import { Mesh } from "../web/rtc.js";
import { Fwd } from "../web/fwd.js";

// browser-only types onTree touches (node has none)
globalThis.MediaStream ||= class { constructor() { this.t = []; } getTracks() { return this.t; } removeTrack(x) { this.t = this.t.filter((y) => y !== x); } };
globalThis.MediaStreamTrackGenerator ||= class {};

let fails = 0;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) fails++; };

function fakeMesh() {
  const m = Object.create(Mesh.prototype);
  Object.assign(m, { peers: new Map(), known: new Map(), closed: false, big: { links: new Set(), parent: null }, calls: [], channels: [] });
  m.goBig = () => true;
  m.emit = () => {};
  m.drop = (id) => m.peers.delete(id);
  m.call = (id) => m.calls.push(id);
  m.mediaChannel = (p) => m.channels.push(p.id);
  m.fwd = new Fwd(m);
  return m;
}
const real = (id) => ({ id, pc: { close() {} }, dc: { readyState: "open" }, name: id, stream: new MediaStream(), state: "connected", cid: "c" + id });
const viaPeer = (id, helper) => ({ id, via: helper, pc: null, dc: { readyState: "open", send() {} }, name: id, stream: new MediaStream(), state: "connected", cid: "" });
const placeholder = (id) => ({ id, pc: null, dc: { readyState: "connecting", send() {} }, name: id, stream: new MediaStream(), state: "connecting", cid: "" });

// my parent P is reached through helper H; my child K waits behind a placeholder; H is a real connection
let m = fakeMesh();
for (const id of ["P", "K", "H"]) m.known.set(id, id);
m.peers.set("H", real("H"));
m.peers.set("P", viaPeer("P", "H"));
m.fwd.via.set("sid1", "P");
m.fwd.asked.set("P", Date.now());
m.peers.set("K", placeholder("K"));
m.onTree({ t: "tree", parent: "P", kids: ["K"] });
check(m.calls.includes("P"), "a parent reached only through a helper is called directly");
check(!m.peers.get("P")?.via, "and is no longer the helper pair");
check(![...m.fwd.via.values()].includes("P") && !m.fwd.asked.has("P"), "the helper's stream for them is forgotten");
const k = m.peers.get("K");
check(k && k.far && !m.calls.includes("K"), "a child behind a placeholder: waits for the child's call (it calls in a tree)");
check(m.peers.get("H")?.far && !m.calls.includes("H"), "a real connection that isn't a tree link: closed as usual, not called");

// a real parent link: left as it is
m = fakeMesh();
m.known.set("P", "P");
const rp = real("P");
m.peers.set("P", rp);
m.onTree({ t: "tree", parent: "P", kids: [] });
check(m.peers.get("P") === rp && !m.calls.length, "a real parent link stays, nothing new is called");

console.log(fails ? `${fails} FAILED` : "ALL OK");
process.exit(fails ? 1 : 0);
