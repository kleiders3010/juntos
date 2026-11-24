// machine-queue: light
// fwd.js _fwdask (2026-11-24 big_test 16 people under load): the lower id had moved to a helper while the higher id's
// own link was still "connecting"; the helper's offer to the higher id came early, waited 30 s at most (J5) and expired
// before that link gave up, so the higher id never took the helper and got none of the lower id's wants or sealed
// messages ("asked off, sender has None ... viewer end via, sender end direct connecting", 17 and 51 such pairs).
// Now the higher id, when its link gives up with no offer waiting, asks its connections; only a helper that already
// passes this pair on answers, with the same offer (J5 still holds: taken only after my own link gave up).
// Run: node worker/fwdask_test.mjs
// pinned: the ids (a1 < h9, helpers z5/y4, outsider x3) and stream ids are this test's own stand-ins, not app values
import { Fwd } from "../web/fwd.js";

let fails = 0;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) fails++; };

const link = (id, sent) => ({ id, state: "connected", dc: { readyState: "open", send: (s) => sent.push([id, JSON.parse(s)]) } });
function side(id) {
  const sent = [];
  const m = { id, peers: new Map(), closed: false, big: null, emit() {} };
  const f = new Fwd(m);
  m.fwd = f;
  return { m, f, sent };
}

// the higher id gives up with nothing waiting: it asks its connections whether someone passes the lower id on
let s = side("h9");
s.m.peers.set("z5", link("z5", s.sent));
s.m.peers.set("y4", link("y4", s.sent));
let p = { id: "a1", state: "connecting", gaveUp: true, dc: { readyState: "connecting" } };
s.m.peers.set("a1", p);
s.f.gaveUp(p);
const asks = s.sent.filter(([, x]) => x.k === "_fwdask" && x.of === "a1").map(([to]) => to).sort();
check(asks.join() === "y4,z5", `the higher id asks every connection about the lower one (${JSON.stringify(s.sent)})`);

// the lower id gives up: it asks for a helper the usual way (_need), never _fwdask
s = side("a1");
s.m.peers.set("z5", link("z5", s.sent));
p = { id: "h9", state: "connecting", gaveUp: true, dc: { readyState: "connecting" } };
s.m.peers.set("h9", p);
s.f.gaveUp(p);
check(!s.sent.some(([, x]) => x.k === "_fwdask"), "the lower id does not send _fwdask");

// an offer that is still waiting is taken; no ask then
s = side("h9");
s.m.peers.set("z5", link("z5", s.sent));
p = { id: "a1", state: "connecting", gaveUp: true, dc: { readyState: "connecting" } };
s.m.peers.set("a1", p);
let took = null;
s.f.on = (from, of) => { took = [from, of]; };
s.f.earlyOn.set("a1", { from: "z5", sid: "S", name: "A", at: Date.now() });
s.f.gaveUp(p);
check(took && took[0] === "z5" && !s.sent.some(([, x]) => x.k === "_fwdask"), "a waiting offer is taken at once, nobody is asked");

// the helper: it passes a1 <-> h9 on, and announced a1 to h9 under stream S1: an ask from h9 gets the same offer again
s = side("z5");
s.m.peers.set("h9", link("h9", s.sent));
s.m.peers.set("a1", link("a1", s.sent));
s.f.helping.set("a1|h9", { a: "a1", b: "h9", senders: {}, ann: { h9: { of: "a1", sid: "S1", name: "Ana" }, a1: { of: "h9", sid: "S2", name: "Hu" } } });
s.f.onMsg("h9", { k: "_fwdask", of: "a1" });
const again = s.sent.filter(([to, x]) => to === "h9" && x.k === "_fwdon");
check(again.length === 1 && again[0][1].of === "a1" && again[0][1].sid === "S1" && again[0][1].name === "Ana", `the helper repeats its offer to the asker (${JSON.stringify(s.sent)})`);

// a helper that does not pass this pair on stays quiet; so does one asked by someone outside the pair
s.sent.length = 0;
s.f.onMsg("h9", { k: "_fwdask", of: "q7" });
s.m.peers.set("x3", link("x3", s.sent));
s.f.onMsg("x3", { k: "_fwdask", of: "a1" });
check(s.sent.length === 0, `no offer for a pair I don't help, nor to someone outside it (${JSON.stringify(s.sent)})`);

console.log(fails ? `${fails} FAILED` : "ALL OK");
process.exit(fails ? 1 : 0);
