// machine-queue: light
// rtc.js viaRelay (2026-11-24): a /turn fetch that never answers must not hold the link's give-up for ever (the pair
// then never reaches a helper), and a failed fetch is asked again by the next link instead of meaning "no relay" for
// the rest of the call. Run: node worker/relay_fetch_test.mjs  (prints OK or throws)
import { Mesh } from "../web/rtc.js";
import assert from "node:assert/strict";

let calls = 0;
globalThis.fetch = (url, opts = {}) => {
  calls++;
  // a server that never answers: only the caller's timeout signal ends it
  return new Promise((_, reject) => opts.signal && opts.signal.addEventListener("abort", () => reject(opts.signal.reason)));
};
const gaveUp = [];
const fake = {
  relay: null,
  signalUrl: "ws://127.0.0.1:1",
  peers: new Map(),
  emit() {},
  giveUp(p) { gaveUp.push(p.id); },
};
const p = { id: "b", relayTried: false };
fake.peers.set("b", p);
const t0 = Date.now();
const done = Mesh.prototype.viaRelay.call(fake, p);
const slow = new Promise((r) => setTimeout(() => r("hung"), 12000));
const res = await Promise.race([done.then(() => "returned"), slow]);
assert.equal(res, "returned", "viaRelay still waits on a /turn that never answers after 12 s");
// pinned: 8 s timeout in viaRelay; it gives up (no relay) once it ends
assert.ok(Date.now() - t0 < 11000);
assert.deepEqual(gaveUp, ["b"]);
assert.equal(fake.relay, null, "a failed /turn is kept for the rest of the call");
assert.equal(calls, 1);
console.log("OK");
process.exit(0);
