// Which public Nostr relays carry an ephemeral event (kind 2xxxx, tag x) from one connection to another,
// with no sign-in or proof of work, and how fast. Run: node research/relaycheck.mjs
import { schnorr } from "../web/vendor/noble-secp256k1/index.js";

const RELAYS = process.argv.slice(2).length ? process.argv.slice(2) : [
  "wss://bucket.coracle.social", "wss://fanfares.nostr1.com", "wss://no.str.cr", "wss://nostr-01.yakihonne.com",
  "wss://nostr-pub.wellorder.net", "wss://nostr.azzamo.net", "wss://nostr.chaima.info", "wss://nostr.data.haus",
  "wss://nostr.hifish.org", "wss://nostr.liberty.fans", "wss://nostr.overmind.lol", "wss://nostr.sathoarder.com",
  "wss://nostrelay.circum.space", "wss://relay.angor.io", "wss://relay.ditto.pub", "wss://relay.dwadziesciajeden.pl",
  "wss://relay.fundstr.me", "wss://relay.guggero.org", "wss://relay.masize.com", "wss://relay.minibolt.info",
  "wss://relay.mostro.network", "wss://relay.nostr.com", "wss://relay.nostr.net", "wss://relay.nostrhub.fr",
  "wss://relay.notoshi.win", "wss://relay.primal.net", "wss://relay.snort.social", "wss://relay.wavlake.com",
  "wss://soloco.nl", "wss://yabu.me", "wss://relay.damus.io", "wss://nos.lol",
];
const hex = (u) => Buffer.from(u).toString("hex");
const topic = hex(crypto.getRandomValues(new Uint8Array(16)));
const KIND = 20000 + (parseInt(topic.slice(0, 6), 16) % 10000);

async function event(content) {
  const { secretKey, publicKey } = schnorr.keygen();
  const ev = { pubkey: hex(publicKey), created_at: Math.floor(Date.now() / 1000), kind: KIND, tags: [["x", topic]], content };
  const id = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]))));
  return { ...ev, id: hex(id), sig: hex(await schnorr.signAsync(id, secretKey)) };
}

function open(url) {
  return new Promise((res) => {
    const ws = new WebSocket(url);
    const t = setTimeout(() => (ws.close(), res(null)), 5000);
    ws.onopen = () => (clearTimeout(t), res(ws));
    ws.onerror = () => (clearTimeout(t), res(null));
  });
}

async function check(url) {
  const [a, b] = await Promise.all([open(url), open(url)]);
  if (!a || !b) return { url, ok: false, why: "no connection" };
  const notes = [];
  const got = new Promise((res) => {
    a.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d[0] === "EVENT") res(true);
      else if (d[0] !== "EOSE") notes.push(d.slice(0, 3).join(" ").slice(0, 80));
    };
    setTimeout(() => res(false), 5000);
  });
  b.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d[0] === "OK" && !d[2]) notes.push("refused: " + d[3]);
    else if (d[0] !== "OK") notes.push(d.slice(0, 3).join(" ").slice(0, 80));
  };
  a.send(JSON.stringify(["REQ", "s", { kinds: [KIND], "#x": [topic], since: Math.floor(Date.now() / 1000) - 60 }]));
  await new Promise((r) => setTimeout(r, 700));
  const t0 = performance.now();
  b.send(JSON.stringify(["EVENT", await event("x".repeat(1500))])); // about an encrypted offer's size
  const ok = await got;
  a.close();
  b.close();
  return { url, ok, ms: ok ? Math.round(performance.now() - t0) : null, why: notes.join(" | ") };
}

const res = await Promise.all(RELAYS.map(check));
for (const r of res.sort((x, y) => (y.ok - x.ok) || (x.ms - y.ms))) console.log(r.ok ? "OK  " : "--  ", r.url, r.ms ?? "", r.why);
console.log(res.filter((r) => r.ok).length, "of", res.length, "carried it");
process.exit(0);
