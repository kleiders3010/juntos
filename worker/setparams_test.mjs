// setParams (web/rtc.js): one change at a time, always the latest; a refused change (InvalidModificationError) is
// tried again after pauses (SETPARAMS_RETRY_MS), never in a loop. Run: node worker/setparams_test.mjs
import { setParams, SETPARAMS_RETRY_MS } from "../web/rtc.js";

let fails = 0;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) fails++; };
const quiet = console.warn;
console.warn = () => {};

function fake(refusals) {
  const s = { applied: [], calls: 0, enc: { active: true } };
  s.getParameters = () => ({ encodings: [{ ...s.enc }] });
  s.setParameters = async (p) => {
    s.calls++;
    await new Promise((r) => setTimeout(r, 5));
    if (refusals-- > 0) { const e = new Error("changed"); e.name = "InvalidModificationError"; throw e; }
    s.enc = p.encodings[0];
    s.applied.push(s.enc.active);
  };
  return s;
}
const off = (p) => { p.encodings[0].active = false; };
const on = (p) => { p.encodings[0].active = true; };

let s = fake(1);
await setParams(s, off);
check(s.enc.active === false && s.calls === 2, "a refused 'off' is tried again and lands");

s = fake(2);
await setParams(s, off);
check(s.enc.active === false && s.calls === 3, "a change refused twice lands on the third try");

const n = SETPARAMS_RETRY_MS.length;
s = fake(n + 5);
await setParams(s, off);
check(s.calls === 1 + n && s.enc.active === true, `a change refused every time stops after ${n} retries`);

s = fake(0);
setParams(s, off); setParams(s, on); await setParams(s, off);
check(s.enc.active === false && s.calls <= 2, "changes queued while one is under way: only the latest follows");

s = fake(1);
setParams(s, off); await setParams(s, on);
check(s.enc.active === true, "a refused change with a newer one waiting: the newer one wins");

console.warn = quiet;
console.log(fails ? `${fails} FAILED` : "ALL OK");
process.exit(fails ? 1 : 0);
