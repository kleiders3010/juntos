// Attendance report, like Meet's (its paid plans email the organizer a sheet: name, time joined, time exited,
// duration; someone who rejoins keeps the first join and the last exit, with the time added up). Here it is made on
// the host's own device from who the call shows in People, from when the host joined, and saved as a .csv.
// People are told apart by the name they typed (ids change when someone rejoins).

const key = (name) => String(name).trim().toLowerCase();

export class Attendance {
  constructor() {
    this.reset();
  }

  reset() {
    this.people = new Map(); // key -> { name, first, last, ms, joins }
    this.open = new Map(); // peer id -> { key, at }
    this.since = 0;
    this.code = "";
  }

  start(code, myName, at = Date.now()) {
    this.reset();
    this.code = code;
    this.since = at;
    this.came("me", myName, at);
  }

  came(id, name, at = Date.now()) {
    if (!this.since || !name || this.open.has(id)) return;
    const k = key(name);
    let p = this.people.get(k);
    if (!p) this.people.set(k, (p = { name: String(name).trim(), first: at, last: 0, ms: 0, joins: 0 }));
    p.joins++;
    p.last = 0; // here now
    this.open.set(id, { key: k, at });
  }

  went(id, at = Date.now()) {
    const o = this.open.get(id);
    if (!o) return;
    this.open.delete(id);
    const p = this.people.get(o.key);
    p.ms += at - o.at;
    p.last = at;
  }

  // I left: everyone's time stops now
  end(at = Date.now()) {
    for (const id of [...this.open.keys()]) this.went(id, at);
  }

  any() {
    return this.people.size > 0;
  }

  rows(at = Date.now()) {
    const live = new Map();
    for (const o of this.open.values()) live.set(o.key, (live.get(o.key) || 0) + (at - o.at));
    return [...this.people.entries()]
      .map(([k, p]) => ({ ...p, ms: p.ms + (live.get(k) || 0), here: live.has(k) }))
      .sort((a, b) => a.first - b.first);
  }

  csv(t, at = Date.now()) {
    const pad = (n) => String(n).padStart(2, "0");
    const when = (ms) => {
      const d = new Date(ms);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };
    const long = (ms) => {
      const s = Math.round(ms / 1000);
      return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
    };
    const cell = (v) => (/[",\r\n]/.test(v) || /^[=+\-@]/.test(v) ? `"${(/^[=+\-@]/.test(v) ? "'" : "") + v.replace(/"/g, '""')}"` : v);
    const head = [t("Name"), t("First joined"), t("Last left"), t("Time in the call"), t("Times joined")];
    const lines = [head.map(cell).join(",")];
    for (const r of this.rows(at)) lines.push([r.name, when(r.first), r.here ? t("still in the call") : when(r.last), long(r.ms), String(r.joins)].map(cell).join(","));
    return "﻿" + lines.join("\r\n") + "\r\n";
  }

  download(t) {
    const pad = (n) => String(n).padStart(2, "0");
    const d = new Date(this.since || Date.now());
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([this.csv(t)], { type: "text/csv;charset=utf-8" }));
    a.download = `Juntos attendance ${this.code} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}.csv`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
}
