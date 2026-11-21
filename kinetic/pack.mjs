// The room code is written once (worker/src/index.js) and copied here as room.mjs, so both servers run the same
// thing. `node pack.mjs` makes room.mjs; `node pack.mjs <folder>` also puts server.mjs + room.mjs into <folder>
// (the game host's games/juntos/).
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// room.mjs imports the signature library from the web folder; here it sits next to it as noble.js
const src = readFileSync(join(here, "../worker/src/index.js"), "utf8").replace('"../../web/vendor/noble-secp256k1/index.js"', '"./noble.js"');
writeFileSync(join(here, "room.mjs"), src);
copyFileSync(join(here, "../web/vendor/noble-secp256k1/index.js"), join(here, "noble.js"));
const out = process.argv[2];
if (out) {
  mkdirSync(out, { recursive: true });
  for (const f of ["server.mjs", "room.mjs", "noble.js", "package.json"]) copyFileSync(join(here, f), join(out, f));
}
console.log("room.mjs made" + (out ? `; copied to ${out}` : ""));
