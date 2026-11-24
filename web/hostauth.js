// Host controls without our server: who may talk, share, chat; co-hosts; locking the call ("people ask to join"),
// letting people in or not; removing someone. The host's choices are one small document, signed with the host's
// key, that every device in the call keeps, passes to newcomers, and applies to itself. No server checks anything.
//
// Who is the host: the call's code is made from the host's public key (its first bytes, as letters), so anyone
// with the code can check that a document was signed by whoever started the call. Calls whose code was made the
// old way (a random code) can't be checked like this: their host controls go through our server, as before.
// Co-hosts: the host lists a co-host's key (a new one per visit) in the document; a co-host's documents carry the
// host-signed one they build on, can't change who the co-hosts are, and are replaced by the host's next one.
// The passcode stays with the server: only a gatekeeper can limit how many guesses someone gets.
import { schnorr } from "./vendor/noble-secp256k1/index.js";

const ABC = "abcdefghijkmnpqrstuvwxyz";
const LIST = 100; // the most ids kept in each list (sent out, refused, let in)
const MAX_TALK = 300;
const hex = (u) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (s) => Uint8Array.from(s.match(/../g) || [], (h) => parseInt(h, 16));
const HEX64 = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9_-]{6,40}$/;
const te = new TextEncoder();
// A host document is numbered by the host's clock (ms) and is good for a day (safety round 3, N1): one kept from an
// earlier session of the same link can't replace today's. A co-host's counter is capped so it can't run out.
export const DOC_AGE = 24 * 3600 * 1000;
const SKEW = 24 * 3600 * 1000;
const CV_MAX = 1e6;
const digest = async (s) => new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(s)));

// codes look like "kfa-rmzq-tde": easy to read out loud, nothing to mix up (no l/1/o/0)
// A new call's code: 15 letters (abcde-fghij-kmnpq) from the host's public key (safety round 2, J3: with 10 letters
// a graphics card could find a key that makes a chosen code, or the code behind a relay tag, in hours). Calls made
// before keep their 10-letter code (abc-defg-hij) and still prove their host the old way.
export function codeOf(pub) {
  const s = Array.from(pub.subarray(0, 15), (b) => ABC[b % ABC.length]).join("");
  return `${s.slice(0, 5)}-${s.slice(5, 10)}-${s.slice(10)}`;
}
export function oldCodeOf(pub) {
  const s = Array.from(pub.subarray(0, 10), (b) => ABC[b % ABC.length]).join("");
  return `${s.slice(0, 3)}-${s.slice(3, 7)}-${s.slice(7)}`;
}

// Which of the two room servers (0 Cloudflare, 1 the game host) a call starts on, from its code; the lobby asks the
// same one. Every version of the app works this out the same way, so the rule itself never changes.
export function serverIndex(room, n) {
  let h = 0;
  for (const c of room) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return n > 1 ? h % n : 0;
}
export const GAME_HOST = 1;

/** A new call: the host's secret key and the code made from its public key. New codes are picked to start on the
 *  game host (item 46: Cloudflare's daily allowance is touched only when the host doesn't answer; older apps read the
 *  code the same way). About two tries; the code keeps 15 letters, one bit fewer to guess. */
export function newHost() {
  for (;;) {
    const k = schnorr.keygen();
    const code = codeOf(k.publicKey);
    if (serverIndex(code, 2) === GAME_HOST) return { key: hex(k.secretKey), code };
  }
}

/** The public key of a host key made by newHost ("" for an old-style key). */
export function pubOf(key) {
  if (!HEX64.test(key || "")) return "";
  try {
    return hex(schnorr.getPublicKey(unhex(key)));
  } catch (_) {
    return "";
  }
}

export const ownsCode = (pub, code) => HEX64.test(pub || "") && (codeOf(unhex(pub)) === code || oldCodeOf(unhex(pub)) === code);

/** A key for this visit (signs my documents if I'm made a co-host). */
export function newSigner() {
  const k = schnorr.keygen();
  return { sk: k.secretKey, pub: hex(k.publicKey) };
}

export async function signDoc(doc, sk) {
  const body = JSON.stringify(doc);
  return { body, sig: hex(await schnorr.signAsync(await digest(body), typeof sk === "string" ? unhex(sk) : sk)) };
}

async function sigOk(w, pub) {
  try {
    return HEX64.test(pub) && /^[0-9a-f]{128}$/.test(w.sig) && (await schnorr.verifyAsync(unhex(w.sig), await digest(w.body), unhex(pub)));
  } catch (_) {
    return false;
  }
}

const ids = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === "string" && ID.test(x)).slice(-LIST) : []);

// the shape every document must have (anything else is dropped)
function clean(d, code) {
  if (!d || typeof d !== "object" || d.code !== code || !Number.isInteger(d.hv) || !Number.isInteger(d.cv) || d.hv < 1 || d.cv < 0 || d.cv > CV_MAX) return null;
  const p = d.perms && typeof d.perms === "object" ? d.perms : {};
  const talk = {};
  if (d.talk && typeof d.talk === "object") for (const [k, v] of Object.entries(d.talk).slice(0, MAX_TALK)) if (ID.test(k)) talk[k] = !!v;
  const cos = {};
  if (d.cos && typeof d.cos === "object") for (const [k, v] of Object.entries(d.cos).slice(0, 50)) if (ID.test(k) && HEX64.test(v)) cos[k] = v;
  return {
    code,
    hv: d.hv,
    cv: d.cv,
    by: String(d.by || ""),
    name: String(d.name || "").slice(0, 60),
    host: ID.test(d.host || "") ? d.host : "",
    locked: !!d.locked,
    perms: { talk: p.talk !== false, share: p.share !== false, chat: p.chat !== false, caps: p.caps !== false },
    talk,
    cos,
    out: ids(d.out),
    deny: ids(d.deny),
    admit: ids(d.admit),
    // when a host ended the call for everyone (their clock, ms); 0 = never
    end: Number.isSafeInteger(d.end) && d.end > 0 ? d.end : 0,
  };
}

const newer = (a, b) => !b || a.hv > b.hv || (a.hv === b.hv && a.cv > b.cv);

function lastHv(code) {
  try {
    return Number(globalThis.localStorage?.getItem("juntos-hv:" + code)) || 0;
  } catch (_) {
    return 0;
  }
}
function saveHv(code, hv) {
  try {
    globalThis.localStorage?.setItem("juntos-hv:" + code, String(hv));
  } catch (_) {}
}

export class HostDocs {
  constructor(code) {
    this.code = code;
    this.doc = null; // the newest valid document
    this.wire = null; // and how it travels ({ body, sig, base? })
    this.hostWire = null; // the newest one the host signed (a co-host's document carries it)
  }

  /** The document in w if it is valid (and its signer may sign it); null otherwise. */
  async read(w, depth = 0) {
    if (!w || typeof w !== "object" || typeof w.body !== "string" || typeof w.sig !== "string" || w.body.length > 30000) return null;
    let d;
    try {
      d = clean(JSON.parse(w.body), this.code);
    } catch (_) {
      return null;
    }
    if (!d) return null;
    if (ownsCode(d.by, this.code)) {
      if (d.cv !== 0 || d.hv < Date.now() - DOC_AGE || d.hv > Date.now() + SKEW || !(await sigOk(w, d.by))) return null;
      this.maxHv = Math.max(this.maxHv || 0, d.hv); // the host's next one is numbered above every one seen
      return d;
    }
    // a co-host's: built on a host-signed document that lists their key, keeping its co-hosts and host
    if (depth) return null;
    const b = await this.read(w.base, 1);
    if (!b || !ownsCode(b.by, this.code) || b.hv !== d.hv || d.cv < 1) return null;
    if (!Object.values(b.cos).includes(d.by) || JSON.stringify(d.cos) !== JSON.stringify(b.cos) || d.host !== b.host) return null;
    // a co-host can't send out the host or another co-host
    if ([...d.out, ...d.deny].some((id) => id === b.host || b.cos[id])) return null;
    return (await sigOk(w, d.by)) ? d : null;
  }

  /** Take w if it is valid and newer than what I have: returns { prev, doc } or null. */
  async take(w, same) {
    const d = await this.read(w);
    if (!d || !(newer(d, this.doc) || (same && d.hv === this.doc.hv && d.cv === this.doc.cv && w.sig !== this.wire.sig))) return null;
    const prev = this.doc;
    this.doc = d;
    this.wire = w;
    (this.log ||= []).push([d.hv, d.cv, d.locked, d.host.slice(0, 4), same ? "same" : "new"]);
    if (this.log.length > 30) this.log.shift();
    if (d.cv === 0) this.hostWire = w;
    return { prev, doc: d };
  }

  /** The next document after a host control: signed with the host key (sk) or as a co-host (signer). */
  async next(change, { hostSk, signer, name }) {
    const cur = this.doc;
    const d = clean({ ...(cur || {}), code: this.code, hv: 1, cv: 0 }, this.code);
    if (change(d) === false) return null;
    for (const k of ["out", "deny", "admit"]) d[k] = [...new Set(d[k])].slice(-LIST);
    d.name = name;
    if (hostSk) {
      // the host's clock, above every number seen and every one this device signed for this code before
      d.hv = Math.max(Date.now(), (cur ? cur.hv : 0) + 1, (this.maxHv || 0) + 1, lastHv(this.code) + 1);
      saveHv(this.code, d.hv);
      d.cv = 0;
      d.by = pubOf(typeof hostSk === "string" ? hostSk : hex(hostSk));
      return signDoc(d, hostSk);
    }
    if (!cur || !this.hostWire) return null;
    d.hv = cur.hv;
    d.cv = cur.cv + 1;
    d.by = signer.pub;
    return { ...(await signDoc(d, signer.sk)), base: this.hostWire };
  }
}

// A visit's id is the start of its signing key (safety round 2, J1/J2): only whoever holds that key can be that
// person, on the relays (their events are signed with it) and on the room server (the hello carries this proof).
export const idOf = (pub) => String(pub || "").slice(0, 16);
// To a room server both proofs carry the time they were made (t, ms), checked there to a few minutes (safety round 3,
// N13: a proof over fixed text worked for ever for whoever saw one). On the relays the event's own signature already
// ties a message to its sender, so the proof there stays without a time.
const idBody = (room, id, t) => `juntos-id|${room}|${id}` + (t ? `|${t}` : "");
export async function idProof(sk, room, id, t) {
  return hex(await schnorr.signAsync(await digest(idBody(room, id, t)), typeof sk === "string" ? unhex(sk) : sk));
}

// the host saying hello (coming back to a locked call): proof that this visit's id is the host's
const helloBody = (room, id, t) => `juntos-hello|${room}|${id}` + (t ? `|${t}` : "");
export async function helloProof(key, room, id, t) {
  return hex(await schnorr.signAsync(await digest(helloBody(room, id, t)), unhex(key)));
}
// A hello from the host on a link of its own (a planned call's claim, the lock and passcode sent to the other room
// server): a fresh visit key, its id proof and the host's proof. The host's secret key is never sent (J13).
export async function hostHello(key, room, extra = {}) {
  const s = newSigner();
  const id = idOf(s.pub);
  const hp = pubOf(key);
  const at = Date.now();
  const host = ownsCode(hp, room) ? { hp, hsig: await helloProof(key, room, id, at) } : { key };
  return { t: "hello", id, ck: s.pub, at, idp: await idProof(s.sk, room, id, at), name: "", ...host, ...extra };
}
export async function helloOk(pub, sig, room, id) {
  return typeof sig === "string" && ownsCode(pub, room) && sigOk({ body: helloBody(room, id), sig }, pub);
}

export const LIST_MAX = LIST;
export const TALK_MAX = MAX_TALK;
