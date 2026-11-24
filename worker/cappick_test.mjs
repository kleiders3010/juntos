// capPick (web/cappick.js): the big-call video cap holds who is shown while several people talk.
// Run: node worker/cappick_test.mjs
import * as cp from "../web/cappick.js";
const { capPick, capPicker, CAP_SWAP_MS } = cp;

let fails = 0;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) fails++; };
const CAP = 9; // pinned: VIDEO_CAP in net.js
const people = (n, now) => Array.from({ length: n }, (_, i) => ({ id: i, top: false, on: false, spokeAt: now - i * 10 }));

// everyone talks all the time (the test's fake microphones): 50 rounds of fresh, shuffled times
let ps = people(15, 1e6);
let shown = null, changes = 0;
for (let round = 0; round < 50; round++) {
  const now = 1e6 + round * 700;
  for (const p of ps) p.spokeAt = now - Math.floor(Math.random() * 600);
  const got = capPick(ps, CAP);
  for (const p of ps) p.on = got.has(p);
  const ids = [...got].map((p) => p.id).sort().join(",");
  if (shown !== null && ids !== shown) changes++;
  shown = ids;
  if (got.size > CAP) { check(false, `round ${round}: ${got.size} shown`); break; }
}
check(changes === 0, `everyone talking: the same ${CAP} stay on (changes over 50 rounds: ${changes})`);

// someone new speaks while one of the shown has been quiet for longer than CAP_SWAP_MS: they swap
ps = people(15, 1e6);
let got = capPick(ps, CAP);
for (const p of ps) p.on = got.has(p);
const quiet = ps.find((p) => p.on && p.id === 8);
quiet.spokeAt = 1e6 - 20000;
const fresh = ps.find((p) => !p.on);
fresh.spokeAt = 1e6 + 5000;
got = capPick(ps, CAP);
check(got.has(fresh) && !got.has(quiet) && got.size === CAP, "a new speaker replaces the one quiet the longest");

// a new speaker within CAP_SWAP_MS of the shown ones waits
ps = people(15, 1e6);
got = capPick(ps, CAP);
for (const p of ps) p.on = got.has(p);
const close = ps.find((p) => !p.on);
close.spokeAt = Math.min(...ps.filter((p) => p.on).map((p) => p.spokeAt)) + CAP_SWAP_MS - 500;
got = capPick(ps, CAP);
check(!got.has(close) && got.size === CAP, `a speaker less than ${CAP_SWAP_MS} ms newer doesn't push anyone out`);

// pinned / big / screen always get a place, even over a shown speaker
ps = people(15, 1e6);
got = capPick(ps, CAP);
for (const p of ps) p.on = got.has(p);
const pin = ps.find((p) => !p.on);
pin.top = true;
pin.spokeAt = 0;
got = capPick(ps, CAP);
check(got.has(pin) && got.size === CAP, "a pinned picture always gets a place");

check(capPick(people(5, 1e6), CAP).size === 5, "fewer people than the cap: everyone shown");

// people talk on and off, as the test's fake microphones heard through the call do (2026-11-24 big_test: last spoke
// 0-7 s ago at the cap's changes, 194 changes in 3 s over 16 viewers): each comparison alone passed CAP_SWAP_MS, so
// the pictures kept swapping. A viewer replaces at most one shown picture every CAP_SWAP_MS.
{
  const pick = capPicker ? capPicker(CAP) : (items) => capPick(items, CAP);
  const ps = people(16, 0).map((p) => ({ ...p, spokeAt: 0 }));
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const swapsAt = [];
  let maxShown = 0;
  for (let now = 1000; now < 60000; now += 700) {
    for (const p of ps) if (rnd() < 0.2) p.spokeAt = now - Math.floor(rnd() * 700);
    const got = pick(ps, now);
    maxShown = Math.max(maxShown, got.size);
    const out = ps.filter((p) => p.on && !got.has(p)).length;
    for (let k = 0; k < out; k++) swapsAt.push(now);
    for (const p of ps) p.on = got.has(p);
  }
  let worst = 0;
  for (const t of swapsAt) worst = Math.max(worst, swapsAt.filter((u) => u >= t && u < t + 5000).length);
  check(maxShown <= CAP, `talking on and off: never more than ${CAP} shown (${maxShown})`);
  check(worst <= Math.ceil(5000 / CAP_SWAP_MS), `talking on and off: at most one picture replaced every ${CAP_SWAP_MS} ms (worst 5 s: ${worst})`);
  check(swapsAt.length > 0, "and the shown ones do change over a minute (who talks is still followed)");
  if (capPicker) {
    const fresh = capPicker(CAP);
    check(fresh(people(5, 1e6), 1e6).size === 5 && fresh(people(12, 1e6), 1e6 + 10).size === CAP, "free places fill at once, no wait");
  } else check(false, "capPicker (the cap with memory of its last swap) exists");
}

console.log(fails ? `${fails} FAILED` : "ALL OK");
process.exit(fails ? 1 : 0);
