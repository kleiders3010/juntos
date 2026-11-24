// Item 46: new calls start on the game host, the rule that reads a code stays the one every app version uses.
//   node worker/split_test.mjs
import { newHost, serverIndex, GAME_HOST } from "../web/hostauth.js";
import { serverIndex as fromRtc } from "../web/rtc.js";

let fail = 0;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) fail++; };
const codes = Array.from({ length: 300 }, () => newHost().code);
check(codes.every((c) => serverIndex(c, 2) === GAME_HOST), "300 new calls all start on the game host");
check(codes.every((c) => /^[a-km-z]{5}-[a-km-z]{5}-[a-km-z]{5}$/.test(c)), "new codes keep their 15-letter shape");
check(new Set(codes).size === codes.length, "no two the same");
// pinned: the reading rule of 1.0.x/1.1.x (web/rtc.js before 2026-11-23), so old apps pick the same server
const old = (room, n) => { let h = 0; for (const c of room) h = (h * 31 + c.charCodeAt(0)) >>> 0; return n > 1 ? h % n : 0; };
const sample = [...codes, "abc-defg-hij", "kfa-rmzq-tde", "aaaaa-bbbbb-ccccc", "zzz-zzzz-zzz"];
check(sample.every((c) => serverIndex(c, 2) === old(c, 2) && fromRtc(c, 2) === old(c, 2)), "every code reads the same as in older apps");
check(serverIndex("abc-defg-hij", 1) === 0, "one server: always that one");
console.log(fail ? `FAIL ${fail}` : "split OK");
process.exit(fail ? 1 : 0);
