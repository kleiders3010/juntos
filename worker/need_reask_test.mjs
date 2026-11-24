// machine-queue: light
// fwd.js need() asks again (2026-11-24 big_test 16 people, 14:58): P14 (lower id) asked its connections for a helper
// to P10 once, when it had just joined and few of its links were open; nobody answered _can, it never asked again and
// the pair stayed apart for the rest of the call ("P14's side of P10: new/connecting gave up ... asked").
// Now an ask with no helper reached after REASK_MS is sent again (a few times), and stops once the pair is passed on.
// Run: node worker/need_reask_test.mjs
// pinned: the ids (a1 < h9, helper z5) and the 40 ms ask interval are this test's own stand-ins, not app values
import { Fwd } from "../web/fwd.js";

let fails = 0;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const link = (id, sent) => ({ id, state: "connected", dc: { readyState: "open", send: (s) => sent.push([id, JSON.parse(s)]) } });
function side(id) {
  const sent = [];
  const m = { id, peers: new Map(), closed: false, big: null, emit() {} };
  const f = new Fwd(m);
  f.sendKey = () => {};
  f.REASK_MS = 40;
  m.fwd = f;
  return { m, f, sent };
}
const needs = (sent) => sent.filter(([, x]) => x.k === "_need" && x.id === "h9").length;

// nobody answers: the lower id asks again
let s = side("a1");
s.m.peers.set("z5", link("z5", s.sent));
let p = { id: "h9", state: "connecting", gaveUp: true, dc: { readyState: "connecting" } };
s.m.peers.set("h9", p);
s.f.need(p);
check(needs(s.sent) === 1, "the first ask goes out");
await wait(110);
check(needs(s.sent) >= 2, `with no helper the ask is sent again (${needs(s.sent)} asks)`);

// the pair got passed on: no more asks
s.sent.length = 0;
p.via = "z5";
await wait(110);
check(needs(s.sent) === 0, `once passed on, it stops asking (${needs(s.sent)} asks)`);

// gone from the call (a new peer object, or closed): no more asks
s = side("a1");
s.m.peers.set("z5", link("z5", s.sent));
p = { id: "h9", state: "connecting", gaveUp: true, dc: { readyState: "connecting" } };
s.m.peers.set("h9", p);
s.f.need(p);
s.m.peers.delete("h9");
await wait(110);
check(needs(s.sent) === 1, `someone who left is not asked about again (${needs(s.sent)} asks)`);

// it gives up asking after a few rounds
s = side("a1");
s.m.peers.set("z5", link("z5", s.sent));
p = { id: "h9", state: "connecting", gaveUp: true, dc: { readyState: "connecting" } };
s.m.peers.set("h9", p);
s.f.need(p);
await wait(40 * 12);
const n = needs(s.sent);
check(n >= 4 && n <= 7, `asks stop after a few rounds (${n} asks)`);

console.log(fails ? `${fails} FAILED` : "ALL OK");
process.exit(fails ? 1 : 0);
