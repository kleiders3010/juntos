// Calls for later, like Meet's "Create a meeting for later" and Zoom's Schedule: a title, a day and time, how long,
// whether it repeats. Juntos makes the link now (this device stays its host); the invitation can be copied, added to
// Google Calendar or Outlook.com, or saved as a calendar file (.ics) for any other calendar. A QR code opens the link
// on a phone. The calls planned on this device are listed on the start page. Nothing goes to a server.
import { qrCanvas } from "./qr.js";

const KEY = "juntos.sched";
export const REPEATS = [
  ["", "Doesn't repeat"],
  ["daily", "Every day"],
  ["weekdays", "Every weekday (Monday to Friday)"],
  ["weekly", "Every week"],
  ["biweekly", "Every 2 weeks"],
  ["monthly", "Every month"],
];
const RRULE = {
  daily: "FREQ=DAILY",
  weekdays: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  weekly: "FREQ=WEEKLY",
  biweekly: "FREQ=WEEKLY;INTERVAL=2",
  monthly: "FREQ=MONTHLY",
};
export const DURATIONS = [15, 30, 45, 60, 90, 120, 180];

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const pad = (n, w = 2) => String(n).padStart(w, "0");
const lang = () => document.documentElement.lang || "en";

export function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}
function store(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {}
}

/** The next time a planned call happens that hasn't ended yet (ms), or null when a one-off call is over. */
export function nextStart(c, now = Date.now()) {
  const d = new Date(c.start);
  const end = (x) => x.getTime() + c.dur * 60000;
  if (!c.rep) return end(d) > now ? d.getTime() : null;
  let guard = 0;
  const step = () => {
    if (c.rep === "daily") d.setDate(d.getDate() + 1);
    else if (c.rep === "weekdays") do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6);
    else if (c.rep === "weekly") d.setDate(d.getDate() + 7);
    else if (c.rep === "biweekly") d.setDate(d.getDate() + 14);
    else d.setMonth(d.getMonth() + 1);
  };
  if (c.rep === "weekdays") while (d.getDay() === 0 || d.getDay() === 6) step();
  // jump close first so an old daily call doesn't loop thousands of times
  const days = Math.floor((now - end(d)) / 86400000) - 31;
  if (days > 0 && c.rep !== "monthly") {
    const per = { daily: 1, weekdays: 7, weekly: 7, biweekly: 14 }[c.rep];
    d.setDate(d.getDate() + Math.floor(days / per) * per);
    if (c.rep === "weekdays") while (d.getDay() === 0 || d.getDay() === 6) step();
  }
  while (end(d) <= now && guard++ < 5000) step();
  return d.getTime();
}

export function when(ms, dur, t, short = false) {
  const a = new Date(ms);
  const b = new Date(ms + dur * 60000);
  const day = new Intl.DateTimeFormat(lang(), short ? { weekday: "short", day: "numeric", month: "short" } : { weekday: "long", day: "numeric", month: "long" }).format(a);
  if (short) return `${day} · ${new Intl.DateTimeFormat(lang(), { hour: "numeric", minute: "2-digit" }).format(a)}`;
  const hm = new Intl.DateTimeFormat(lang(), { hour: "numeric", minute: "2-digit" });
  return `${day} · ${hm.format(a)} – ${hm.format(b)} (${tz().replace(/_/g, " ")})`;
}

export function invitation(c, url, t) {
  const lines = [c.title || t("Juntos call"), when(nextStart(c) ?? c.start, c.dur, t)];
  if (c.rep) lines.push(t(REPEATS.find((r) => r[0] === c.rep)[1]));
  lines.push("", `${t("Join")}: ${url}`);
  if (passOf(c.code)) lines.push(`${t("Passcode")}: ${passOf(c.code)}`);
  lines.push(t("No account or app needed."));
  return lines.join("\n");
}

// ---- who may come in: like Zoom's passcode and waiting room (and Meet with "Quick access" off) ----
export const PASS_RE = /^[A-Za-z0-9]{4,10}$/;
export function passOf(code) {
  try {
    return localStorage.getItem(`juntos.pass.${code}`) || "";
  } catch {
    return "";
  }
}
// The link to a call. With a passcode it carries it after "#", like Zoom's one-click join link: the part after
// "#" never reaches any server, the page reads it and fills the passcode in.
export function callUrl(code) {
  const p = passOf(code);
  return new URL(`r/${code}`, import.meta.url).href + (p ? `#p=${encodeURIComponent(p)}` : "");
}
// A ready-made passcode: 6 digits, like Zoom's (a decision). Guessing it is held back by the server: 5 wrong tries
// per network, and 30 for the whole call in 10 minutes lock it (safety round 2, J9).
export function newPass() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0] % 1000000).padStart(6, "0");
}

/** The options for a new call: people ask to join (you let them in), a passcode. The choice is remembered. */
export function securityFields(t) {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem("juntos.secure") || "{}");
  } catch {}
  const ask = el("input", { type: "checkbox", name: "ask", checked: !!saved.ask });
  const usePass = el("input", { type: "checkbox", name: "usePass", checked: !!saved.pass });
  const pass = el("input", { name: "pass", value: newPass(), maxLength: 10, autocomplete: "off", spellcheck: false, autocapitalize: "off", pattern: "[A-Za-z0-9]{4,10}", title: t("4 to 10 letters or numbers") });
  const sync = () => {
    pass.hidden = !usePass.checked;
    pass.required = usePass.checked;
  };
  usePass.onchange = () => {
    sync();
    if (usePass.checked) pass.select();
  };
  sync();
  const box = el(
    "div",
    { className: "secure" },
    el("label", { className: "check" }, ask, el("span", { textContent: t("People ask to join, you let them in") })),
    el("div", { className: "passRow" }, el("label", { className: "check" }, usePass, el("span", { textContent: t("Passcode") })), pass),
  );
  return {
    box,
    pass,
    // { ask, pass } or null when the passcode isn't valid (the field says why)
    value() {
      const v = { ask: ask.checked, pass: usePass.checked ? pass.value.trim() : "" };
      if (usePass.checked && !PASS_RE.test(v.pass)) {
        pass.reportValidity();
        return null;
      }
      try {
        localStorage.setItem("juntos.secure", JSON.stringify({ ask: v.ask, pass: usePass.checked }));
      } catch {}
      return v;
    },
  };
}
// A new call's options, kept on this device: they apply when its host first opens it (or when it is planned)
export function keepSecurity(code, v) {
  try {
    if (v.ask || v.pass) localStorage.setItem(`juntos.start.${code}`, JSON.stringify({ lock: !!v.ask, pass: v.pass || "" }));
    if (v.pass) localStorage.setItem(`juntos.pass.${code}`, v.pass);
  } catch {}
}

// ---- calendars ----
const stampUTC = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
};
const stampLocal = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
};
const isoLocal = (ms) => {
  const d = new Date(ms);
  const off = -d.getTimezoneOffset();
  const s = off < 0 ? "-" : "+";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00${s}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
};

export function googleUrl(c, url, t) {
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: c.title || t("Juntos call"),
    dates: `${stampLocal(c.start)}/${stampLocal(c.start + c.dur * 60000)}`,
    ctz: tz(),
    details: `${t("Join")}: ${url}\n${t("No account or app needed.")}`,
    location: url,
  });
  if (c.rep) q.set("recur", `RRULE:${RRULE[c.rep]}`);
  return `https://calendar.google.com/calendar/render?${q}`;
}

export function outlookUrl(c, url, t) {
  const q = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: c.title || t("Juntos call"),
    startdt: isoLocal(c.start),
    enddt: isoLocal(c.start + c.dur * 60000),
    body: `${t("Join")}: ${url}\n${t("No account or app needed.")}`,
    location: url,
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${q}`;
}

// The time zone as a VTIMEZONE, so a repeating call stays at the same local time across daylight saving changes.
// Found from the browser's own clock: the offsets during the year and the days they change.
function vtimezone(year) {
  const off = (ms) => -new Date(ms).getTimezoneOffset();
  const fmtOff = (m) => `${m < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(m) / 60))}${pad(Math.abs(m) % 60)}`;
  const changes = [];
  let t0 = Date.UTC(year, 0, 1);
  for (let day = 1; day <= 366; day++) {
    const t1 = Date.UTC(year, 0, 1 + day);
    if (off(t0) !== off(t1)) {
      let lo = t0;
      let hi = t1;
      while (hi - lo > 60000) {
        const mid = lo + Math.floor((hi - lo) / 120000) * 60000;
        if (off(mid) === off(lo)) lo = mid;
        else hi = mid;
      }
      changes.push({ at: hi, from: off(lo), to: off(hi) });
    }
    t0 = t1;
  }
  const out = ["BEGIN:VTIMEZONE", `TZID:${tz()}`];
  if (!changes.length) {
    const o = fmtOff(off(Date.UTC(year, 0, 1)));
    out.push("BEGIN:STANDARD", "DTSTART:19700101T000000", `TZOFFSETFROM:${o}`, `TZOFFSETTO:${o}`, "END:STANDARD");
  } else {
    for (const ch of changes) {
      const w = new Date(ch.at + ch.from * 60000); // the wall clock just before the change, read with UTC getters
      const dim = new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth() + 1, 0)).getUTCDate();
      const nth = w.getUTCDate() + 7 > dim ? -1 : Math.ceil(w.getUTCDate() / 7);
      const dayCode = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][w.getUTCDay()];
      const kind = ch.to > ch.from ? "DAYLIGHT" : "STANDARD";
      out.push(
        `BEGIN:${kind}`,
        `DTSTART:1970${pad(w.getUTCMonth() + 1)}${pad(w.getUTCDate())}T${pad(w.getUTCHours())}${pad(w.getUTCMinutes())}00`,
        `RRULE:FREQ=YEARLY;BYMONTH=${w.getUTCMonth() + 1};BYDAY=${nth}${dayCode}`,
        `TZOFFSETFROM:${fmtOff(ch.from)}`,
        `TZOFFSETTO:${fmtOff(ch.to)}`,
        `END:${kind}`,
      );
    }
  }
  out.push("END:VTIMEZONE");
  return out;
}

const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
function fold(line) {
  // lines over 75 bytes continue on the next line after a space (RFC 5545 3.1)
  const enc = new TextEncoder();
  const out = [];
  let cur = "";
  for (const ch of line) {
    if (enc.encode(cur + ch).length > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
    }
    cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function ics(c, url, t, now = Date.now()) {
  const title = c.title || t("Juntos call");
  const body = `${t("Join")}: ${url}\n${t("No account or app needed.")}`;
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Juntos//meet.jurisgames.com//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  if (c.rep) lines.push(...vtimezone(new Date(c.start).getFullYear()));
  lines.push("BEGIN:VEVENT", `UID:${c.code}@meet.jurisgames.com`, `DTSTAMP:${stampUTC(now)}`);
  if (c.rep) {
    lines.push(`DTSTART;TZID=${tz()}:${stampLocal(c.start)}`, `DTEND;TZID=${tz()}:${stampLocal(c.start + c.dur * 60000)}`, `RRULE:${RRULE[c.rep]}`);
  } else {
    lines.push(`DTSTART:${stampUTC(c.start)}`, `DTEND:${stampUTC(c.start + c.dur * 60000)}`);
  }
  lines.push(
    `SUMMARY:${esc(title)}`,
    `DESCRIPTION:${esc(body)}`,
    `LOCATION:${esc(url)}`,
    `URL:${url}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(title)}`,
    "TRIGGER:-PT10M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  );
  return lines.map(fold).join("\r\n") + "\r\n";
}

// ---- the sheets ----
function sheet(cls) {
  const s = document.createElement("div");
  s.className = "sheet";
  const inner = document.createElement("div");
  inner.className = `sheetInner devices recSheet ${cls}`;
  s.append(inner);
  s.onclick = (e) => {
    if (e.target === s) s.remove();
  };
  const esc = (e) => {
    if (!s.isConnected) return document.removeEventListener("keydown", esc, true);
    if (e.key === "Escape" && s === [...document.querySelectorAll(".sheet")].pop()) {
      e.stopPropagation();
      s.remove();
      document.removeEventListener("keydown", esc, true);
    }
  };
  document.addEventListener("keydown", esc, true);
  document.body.append(s);
  return [s, inner];
}
function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

async function copy(text, done, toast, t) {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    prompt(t("Copy this:"), text);
  }
}

/** The link, Copy / Share and the QR code: shared by the in-call Invite sheet and a planned call. */
export function linkBlock(inner, url, { t, toast, isPhone, share, copied }) {
  const row = el("div", { className: "schedLink" });
  const input = el("input", { value: url, readOnly: true, name: "link" });
  input.onfocus = () => input.select();
  const cp = el("button", { className: "primary", name: "copy", textContent: t("Copy link") });
  cp.onclick = () => {
    copy(url, copied || t("Link copied. Send it to anyone."), toast, t);
  };
  row.append(input, cp);
  inner.append(row);
  if (navigator.share && isPhone) {
    const sh = el("button", { className: "secondary", name: "share", textContent: t("Share…") });
    sh.onclick = () => navigator.share(share).catch(() => {});
    inner.append(sh);
  }
  const qr = el("figure", { className: "schedQr" }, qrCanvas(url, 220), el("figcaption", { textContent: t("Scan to open it on a phone") }));
  inner.append(qr);
}

/** In the call: "Invite people" shows the link, Copy, Share on phones, and a QR code to join from a phone. */
export function inviteSheet(url, o) {
  if (document.querySelector(".inviteSheet")) return;
  const [s, inner] = sheet("inviteSheet schedSheet");
  const who = o.locked ? "The call is locked: people with the link ask to join." : "Anyone with the link can join.";
  inner.append(el("h3", { textContent: o.t("Invite people") }), el("p", { className: "small", textContent: o.t(who) }));
  if (o.pass) inner.append(el("p", { className: "small passLine", textContent: o.t("Passcode: {pass}. It is in the link, so people with the link don't type it.", { pass: o.pass }) }));
  linkBlock(inner, url, { ...o, share: { title: o.t("Join my call"), text: o.t("Join my call on Juntos"), url } });
  const done = el("button", { className: "ghost", name: "done", textContent: o.t("Done") });
  done.onclick = () => s.remove();
  inner.append(el("div", { className: "row2" }, done));
  inner.querySelector('[name="copy"]').focus();
}

/** The start page: "Schedule for later" asks when, then shows the planned call (link, calendars, QR). */
export function scheduleSheet(o) {
  const { t } = o;
  const [s, inner] = sheet("schedSheet");
  inner.append(el("h3", { textContent: t("Schedule a call") }));
  const title = el("input", { name: "title", placeholder: t("Title (optional)"), maxLength: 120 });
  const start = new Date(Date.now() + 30 * 60000);
  start.setMinutes(start.getMinutes() < 30 ? 30 : 60, 0, 0);
  const date = el("input", { type: "date", name: "date", value: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`, required: true });
  const time = el("input", { type: "time", name: "time", value: `${pad(start.getHours())}:${pad(start.getMinutes())}`, required: true, step: 300 });
  const dur = el("select", { name: "dur" });
  for (const m of DURATIONS) dur.append(el("option", { value: m, textContent: m < 60 ? t("{n} minutes", { n: m }) : m === 60 ? t("1 hour") : t("{n} hours", { n: m / 60 }) }));
  dur.value = "60";
  const rep = el("select", { name: "rep" });
  for (const [v, label] of REPEATS) rep.append(el("option", { value: v, textContent: t(label) }));
  const lab = (text, ...kids) => el("label", { className: "devRow" }, el("span", { textContent: text }), ...kids);
  const form = el("form", { className: "schedForm" });
  form.append(
    lab(t("Title"), title),
    el("div", { className: "schedWhen" }, lab(t("Day"), date), lab(t("Starts"), time)),
    el("div", { className: "schedWhen" }, lab(t("How long"), dur), lab(t("Repeats"), rep)),
    el("p", { className: "small", textContent: t("Times are in your time zone ({tz}). The link works any time, before or after.", { tz: tz().replace(/_/g, " ") }) }),
  );
  const sec = securityFields(t);
  form.append(sec.box);
  const cancel = el("button", { type: "button", className: "ghost", textContent: t("Cancel") });
  cancel.onclick = () => s.remove();
  form.append(el("div", { className: "row2" }, cancel, el("button", { className: "primary", name: "create", textContent: t("Create link") })));
  form.onsubmit = (e) => {
    e.preventDefault();
    const [y, mo, d] = date.value.split("-").map(Number);
    const [h, mi] = time.value.split(":").map(Number);
    if (!y || Number.isNaN(h)) return;
    const v = sec.value();
    if (!v) return;
    const { code, key } = o.newHost();
    try {
      localStorage.setItem(`juntos.host.${code}`, key); // whoever plans the call is its host on this device
    } catch {
      o.toast(o.t("This device couldn't keep the host key for this call: if you reload or leave, you won't be its host."));
    }
    keepSecurity(code, v);
    // a passcode or asking to join must hold before the host arrives: the room is claimed with them now
    if (v.ask || v.pass) o.claim?.(code, key, { lock: v.ask, pass: v.pass });
    const c = { code, title: title.value.trim(), start: new Date(y, mo - 1, d, h, mi).getTime(), dur: Number(dur.value), rep: rep.value };
    store([...load().filter((x) => x.code !== c.code), c]);
    s.remove();
    plannedSheet(c, o);
    o.changed?.();
  };
  inner.append(form);
  title.focus();
}

/** A planned call: when, the link, the invitation, calendars, the QR code. */
export function plannedSheet(c, o) {
  const { t } = o;
  const url = callUrl(c.code);
  const [s, inner] = sheet("schedSheet plannedSheet");
  inner.append(el("h3", { textContent: c.title || t("Juntos call") }));
  const rep = REPEATS.find((r) => r[0] === c.rep);
  inner.append(el("p", { className: "schedTime", textContent: when(nextStart(c) ?? c.start, c.dur, t) + (c.rep ? ` · ${t(rep[1])}` : "") }));
  linkBlock(inner, url, { ...o, share: { title: c.title || t("Juntos call"), text: invitation(c, url, t) } });
  const inv = el("button", { className: "secondary", name: "invitation", textContent: t("Copy invitation") });
  inv.onclick = () => copy(invitation(c, url, t), t("Invitation copied"), o.toast, t);
  const cal = el("div", { className: "schedCal" });
  const a = (name, href, text) => el("a", { className: "chip", name, href, target: "_blank", rel: "noopener noreferrer", textContent: text });
  const file = el("button", { className: "chip", name: "ics", textContent: t("Calendar file (.ics)") });
  file.onclick = () => {
    const blob = new Blob([ics(c, url, t)], { type: "text/calendar;charset=utf-8" });
    const link = el("a", { href: URL.createObjectURL(blob), download: `${(c.title || t("Juntos call")).replace(/[\\/:*?"<>|]+/g, " ").trim()}.ics` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  };
  cal.append(el("span", { textContent: t("Add to calendar") }), a("google", googleUrl(c, url, t), "Google Calendar"), a("outlook", outlookUrl(c, url, t), "Outlook.com"), file);
  inner.append(inv, cal);
  // Outlook.com's add-event link has no repeat; the .ics carries it
  if (c.rep) inner.append(el("p", { className: "small", textContent: t("Outlook.com adds one date; to repeat it there, use the calendar file.") }));
  const open = el("a", { className: "ghost", name: "open", href: url, textContent: t("Open the call now") });
  const done = el("button", { className: "primary", name: "done", textContent: t("Done") });
  done.onclick = () => s.remove();
  inner.append(el("div", { className: "row2" }, open, done));
  done.focus();
}

/** The calls planned on this device, on the start page: the next ones first; one-off calls disappear when over. */
export function paintUpcoming(box, o) {
  const { t } = o;
  const now = Date.now();
  const list = load()
    .map((c) => ({ c, at: nextStart(c, now) }))
    .filter((x) => x.at !== null);
  // planned calls more than a day over are forgotten
  store(load().filter((c) => nextStart(c, now - 86400000) !== null));
  list.sort((x, y) => x.at - y.at);
  box.replaceChildren();
  box.hidden = !list.length;
  if (!list.length) return;
  box.append(el("h2", { textContent: t("Planned on this device") }));
  for (const { c, at } of list) {
    const row = el("div", { className: "upItem" });
    const info = el("button", { className: "upInfo", name: "details" }, el("b", { textContent: c.title || t("Juntos call") }), el("span", { textContent: when(at, c.dur, t, true) }));
    info.onclick = () => plannedSheet(c, o);
    const open = el("a", { className: "chip", name: "open", href: new URL(`r/${c.code}`, import.meta.url).pathname, textContent: at - now < 15 * 60000 ? t("Join now") : t("Open") });
    const del = el("button", { className: "upDel", name: "remove", title: t("Remove from this list"), textContent: "×" });
    del.onclick = () => {
      store(load().filter((x) => x.code !== c.code));
      paintUpcoming(box, o);
      // (UX review U-J23: it went at once, with no way back)
      o.toast?.(t("Removed “{title}”", { title: c.title || t("Juntos call") }), {
        label: t("Undo"),
        name: "undoRemove",
        run: () => {
          if (!load().some((x) => x.code === c.code)) store([...load(), c]);
          paintUpcoming(box, o);
        },
      });
    };
    row.append(info, open, del);
    box.append(row);
  }
}
