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
const digest = async (s) => new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(s)));

// codes look like "kfa-rmzq-tde": easy to read out loud, nothing to mix up (no l/1/o/0)
export function codeOf(pub) {
  const s = Array.from(pub.subarray(0, 10), (b) => ABC[b % ABC.length]).join("");
  return `${s.slice(0, 3)}-${s.slice(3, 7)}-${s.slice(7)}`;
}

/** A new call: the host's secret key and the code made from its public key. */
export function newHost() {
  const k = schnorr.keygen();
  return { key: hex(k.secretKey), code: codeOf(k.publicKey) };
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

export const ownsCode = (pub, code) => HEX64.test(pub || "") && codeOf(unhex(pub)) === code;

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
  if (!d || typeof d !== "object" || d.code !== code || !Number.isInteger(d.hv) || !Number.isInteger(d.cv) || d.hv < 1 || d.cv < 0) return null;
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
  };
}

const newer = (a, b) => !b || a.hv > b.hv || (a.hv === b.hv && a.cv > b.cv);

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
      if (d.cv !== 0 || !(await sigOk(w, d.by))) return null;
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
      d.hv = Math.max(cur ? cur.hv : 0, this.maxHv || 0) + 1;
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

// the host saying hello (coming back to a locked call): proof that this visit's id is the host's
const helloBody = (room, id) => `juntos-hello|${room}|${id}`;
export async function helloProof(key, room, id) {
  return hex(await schnorr.signAsync(await digest(helloBody(room, id)), unhex(key)));
}
export async function helloOk(pub, sig, room, id) {
  return typeof sig === "string" && ownsCode(pub, room) && sigOk({ body: helloBody(room, id), sig }, pub);
}

export const LIST_MAX = LIST;
export const TALK_MAX = MAX_TALK;
