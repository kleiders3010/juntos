// Safety round 3 (research/safety-audit-2026-11-22/juntos.md in SelfSustainment): host documents. Run: node safety3_test.mjs
// N1: a host document is numbered by the host's clock and is good for a day, so one kept from an earlier session of
//     the same link can't replace today's; a co-host's counter is capped.
import { newHost, HostDocs, signDoc, pubOf, DOC_AGE } from "../web/hostauth.js";

let fails = 0;
const ok = (c, what) => {
  console.log((c ? "ok   " : "FAIL ") + what);
  if (!c) fails++;
};

const h = newHost();
const by = pubOf(h.key);
const base = { code: h.code, cv: 0, by, name: "Ana", host: "abcdefgh", locked: false, perms: {}, talk: {}, cos: {}, out: [], deny: [], admit: [], end: 0 };

// today's document, made the normal way, is numbered by the clock
const docs = new HostDocs(h.code);
const w = await docs.next((d) => void (d.host = "abcdefgh"), { hostSk: h.key, name: "Ana" });
const r = await docs.take(w);
ok(!!r && Math.abs(r.doc.hv - Date.now()) < 60000, "a new host document is numbered by the clock");

// an old session's document (high counter, old numbering) is refused
const old = await signDoc({ ...base, hv: 500, end: 0 }, h.key);
ok(!(await new HostDocs(h.code).take(old)), "a document numbered the old way (a counter) is refused");
const yesterday = await signDoc({ ...base, hv: Date.now() - DOC_AGE - 60000 }, h.key);
ok(!(await new HostDocs(h.code).take(yesterday)), "a document older than a day is refused");
ok(!(await docs.take(yesterday)), "an old document never replaces today's");

// the next one is above everything seen
const w2 = await docs.next((d) => void (d.locked = true), { hostSk: h.key, name: "Ana" });
const r2 = await docs.take(w2);
ok(!!r2 && r2.doc.hv > r.doc.hv && r2.doc.locked, "the next document is numbered above the last");

// a co-host counter past the cap is refused
const huge = await signDoc({ ...base, hv: Date.now(), cv: 1e300 }, h.key);
ok(!(await new HostDocs(h.code).read(huge)), "a counter past the cap is refused");

console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
