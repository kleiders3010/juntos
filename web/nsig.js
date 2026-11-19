// Finding the others in a call without our server: public Nostr relays carry the handshake.
//
// Our server (a Cloudflare Worker) has a free daily allowance; every join through it uses some. So a call that
// doesn't need the server (no lock, no passcode, no host control used) finds its people through public Nostr
// relays instead: anyone can post short-lived ("ephemeral", kinds 20000-29999) messages there and listen for
// them, and relays don't keep them. Several relays are used at once, the same ones on every device in the call
// (picked from the call's name), so one relay being down changes nothing.
//
// What the relays see: the device's IP address and an unreadable tag for the call (a hash of its name).
// Everything posted is encrypted (AES-GCM) with a key made from the call's name, which only people with the
// link have; each device signs with a new random Nostr key per visit, so nothing ties visits together.
import { schnorr } from "./vendor/noble-secp256k1/index.js";

// Checked 2026-11-18 (research/relaycheck.mjs): these carried a 1.5 KB ephemeral event between two
// connections in 0.2-1.7 s with no sign-in or proof of work. Fastest first.
export const RELAYS = [
  "wss://bucket.coracle.social",
  "wss://nostr.liberty.fans",
  "wss://relay.guggero.org",
  "wss://relay.dwadziesciajeden.pl",
  "wss://nostr.hifish.org",
  "wss://relay.wavlake.com",
  "wss://relay.fundstr.me",
  "wss://no.str.cr",
  "wss://relay.ditto.pub",
  "wss://relay.nostr.com",
  "wss://nostrelay.circum.space",
  "wss://nostr.overmind.lol",
  "wss://fanfares.nostr1.com",
  "wss://relay.nostrhub.fr",
  "wss://nostr.azzamo.net",
  "wss://nostr.data.haus",
  "wss://relay.nostr.net",
  "wss://nostr-01.yakihonne.com",
  "wss://relay.angor.io",
  "wss://relay.mostro.network",
];
const USE = 5; // relays per call
const MAX_AGE = 90; // s: older messages (a relay replaying) are ignored

const te = new TextEncoder();
const td = new TextDecoder();
const hex = (u) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const sha = async (s) => new Uint8Array(await crypto.subtle.digest("SHA-256", typeof s === "string" ? te.encode(s) : s));
const b64 = (u) => btoa(String.fromCharCode(...u));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const NOSTR_OK = typeof WebSocket === "function" && !!globalThis.crypto?.subtle;

export class NostrSignal {
  /** onMsg(obj) gets every readable message for this call (my own excluded by the caller). */
  constructor({ room, relays, onMsg }) {
    this.room = room;
    this.list = relays && relays.length ? relays : RELAYS;
    this.onMsg = onMsg;
    this.socks = new Map(); // url -> WebSocket
    this.seen = new Set();
    this.closed = false;
    const k = schnorr.keygen();
    this.sk = k.secretKey;
    this.pub = hex(k.publicKey);
    this.ready = this.start();
  }

  async start() {
    const topic = hex(await sha("juntos-topic|" + this.room));
    this.topic = topic;
    this.kind = 20000 + (parseInt(topic.slice(0, 6), 16) % 10000);
    this.key = await crypto.subtle.importKey("raw", await sha("juntos-key|" + this.room), "AES-GCM", false, ["encrypt", "decrypt"]);
    // the same relays on every device in this call: ordered by a hash of (call, relay)
    const ranked = await Promise.all(this.list.map(async (u) => [hex(await sha(topic + u)), u]));
    this.order = ranked.sort((a, b) => (a[0] < b[0] ? -1 : 1)).map((x) => x[1]);
    this.want = this.order.slice(0, Math.min(USE, this.order.length));
    this.next = this.want.length;
    await Promise.race([Promise.all(this.want.map((u) => this.open(u))), new Promise((r) => setTimeout(r, 5000))]);
    // too few answered: add the next ones in the same order (other devices do the same)
    while (this.up < Math.min(3, this.want.length) && this.next < this.order.length) {
      const extra = this.order.slice(this.next, this.next + 3);
      this.next += extra.length;
      this.want.push(...extra);
      await Promise.race([Promise.all(extra.map((u) => this.open(u))), new Promise((r) => setTimeout(r, 4000))]);
    }
    return this.up;
  }

  get up() {
    return [...this.socks.values()].filter((w) => w.readyState === 1).length;
  }

  open(url, tries = 0) {
    return new Promise((res) => {
      if (this.closed) return res(false);
      let ws;
      try {
        ws = new WebSocket(url);
      } catch (_) {
        return res(false);
      }
      this.socks.set(url, ws);
      ws.onopen = () => {
        ws.send(JSON.stringify(["REQ", "j", { kinds: [this.kind], "#x": [this.topic], since: Math.floor(Date.now() / 1000) - 30 }]));
        tries = 0;
        res(true);
      };
      ws.onerror = () => res(false);
      ws.onclose = () => {
        res(false);
        if (this.closed || this.socks.get(url) !== ws) return;
        // a relay dropped us: try it again a little later
        setTimeout(() => !this.closed && this.open(url, tries + 1), Math.min(30000, 2000 * 2 ** tries));
      };
      ws.onmessage = (e) => this.onEvent(e.data);
    });
  }

  async onEvent(raw) {
    let d;
    try {
      d = JSON.parse(raw);
    } catch (_) {
      return;
    }
    if (d[0] !== "EVENT" || !d[2] || typeof d[2].content !== "string") return;
    const ev = d[2];
    if (this.seen.has(ev.id) || ev.kind !== this.kind) return;
    this.seen.add(ev.id);
    if (this.seen.size > 5000) this.seen = new Set([...this.seen].slice(-2500));
    if (Math.abs(Date.now() / 1000 - ev.created_at) > MAX_AGE) return;
    try {
      const all = unb64(ev.content);
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.subarray(0, 12) }, this.key, all.subarray(12));
      const obj = JSON.parse(td.decode(plain));
      if (obj && typeof obj === "object" && Math.abs(Date.now() - (obj.at || 0)) < MAX_AGE * 1000) this.onMsg(obj);
    } catch (_) {}
  }

  async send(obj) {
    await this.ready;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, this.key, te.encode(JSON.stringify({ ...obj, at: Date.now() }))));
    const content = new Uint8Array(12 + ct.length);
    content.set(iv);
    content.set(ct, 12);
    const ev = { pubkey: this.pub, created_at: Math.floor(Date.now() / 1000), kind: this.kind, tags: [["x", this.topic]], content: b64(content) };
    const id = await sha(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]));
    const msg = JSON.stringify(["EVENT", { ...ev, id: hex(id), sig: hex(await schnorr.signAsync(id, this.sk)) }]);
    this.seen.add(hex(id));
    let sent = 0;
    for (const ws of this.socks.values())
      if (ws.readyState === 1) {
        ws.send(msg);
        sent++;
      }
    return sent;
  }

  close() {
    this.closed = true;
    for (const ws of this.socks.values())
      try {
        ws.close();
      } catch (_) {}
    this.socks.clear();
  }
}
