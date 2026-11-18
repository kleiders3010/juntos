// Shared notes, like Zoom's in-meeting Notes shared to the meeting (studied: Tufts and other Zoom help guides:
// "Collaborating" = everyone edits, "Viewing" = everyone only reads; only the host decides) and like the notes
// document Meet attaches to a call (support.google.com/meet/answer/14754931: everyone is told notes are being
// taken; Google Docs' meeting notes template: date, attendees, notes, action items).
// One text per call that everyone writes in at the same time. Nothing is kept on a server: every device holds the
// text and catches newcomers up. Edits merge character by character (a small RGA sequence: every character has an
// id [clock, writer] and the id of the character it was typed after), so two people typing at once never lose a
// letter. Save it as a .txt, also after leaving.
const MAXLEN = 100000; // characters in the notes (a long document; keeps the sync message small)
const BATCH = 2000; // characters per message
const KINDS = ["nop", "nsync", "nset"];
const rid = () => [...crypto.getRandomValues(new Uint32Array(2))].map((x) => x.toString(36)).join("");

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) e[k] = v;
    else if (k === "text") e.textContent = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k);
  return e;
}

// ids are "clock.writer"; a later (bigger) id sorts first among characters typed after the same one
function parse(id) {
  const i = id.indexOf(".");
  return [+id.slice(0, i), id.slice(i + 1)];
}
function greater(a, b) {
  const [ta, pa] = parse(a);
  const [tb, pb] = parse(b);
  return ta !== tb ? ta > tb : pa > pb;
}
const okId = (id) => typeof id === "string" && id.length < 40 && /^\d+\.[a-z0-9]+$/.test(id);

export class Notes {
  // o: { t, send(m), sendTo(id, m), hosts() (ids of the hosts among the others), amHost(), myName(), names() (everyone in the call), notify(text), badge() }
  constructor(o) {
    this.o = o;
    this.t = o.t;
    this.code = null;
    this.items = [];
    this.byId = new Map();
    this.text = "";
    this.textIds = [];
    this.edit = { who: "all", ver: 0 };
  }

  // a new call code starts empty; the same code (rejoining) keeps the text and merges it with the others'
  reset(code) {
    if (this.code === code) return;
    this.code = code;
    this.items = []; // { id, o (typed after), c, d (deleted) } in document order
    this.byId = new Map();
    this.last = null;
    this.textIds = [];
    this.pending = []; // characters typed after one that hasn't arrived yet
    this.pendingDel = new Set();
    this.clock = 0;
    this.me = rid();
    this.edit = { who: "all", ver: 0 };
    this.text = "";
    this.started = false; // someone has written: told once
    this.writers = new Map(); // name -> until
    this.render();
  }
  any() {
    return this.text.trim().length > 0;
  }
  canEdit() {
    return this.edit.who === "all" || this.o.amHost();
  }

  // ---------- the merge ----------
  integrate(id, o, c) {
    if (this.byId.has(id)) return true;
    let i = 0;
    if (o) {
      const at = this.byId.get(o);
      if (!at) return false;
      i = this.last?.id === o ? this.lastIx + 1 : this.items.indexOf(at) + 1;
    }
    while (i < this.items.length && greater(this.items[i].id, id)) i++;
    const it = { id, o, c, d: false };
    if (this.pendingDel.delete(id)) it.d = true;
    this.items.splice(i, 0, it);
    this.byId.set(id, it);
    this.last = it;
    this.lastIx = i;
    const ts = parse(id)[0];
    if (ts > this.clock) this.clock = ts;
    return true;
  }
  del(id) {
    const it = this.byId.get(id);
    if (it) it.d = true;
    else this.pendingDel.add(id);
  }
  applyOps(ops) {
    let room = MAXLEN - this.items.length;
    for (const op of ops) {
      if (!Array.isArray(op)) continue;
      if (op[0] === "d" && okId(op[1])) this.del(op[1]);
      else if (op[0] === "i" && okId(op[1]) && (op[2] === "" || okId(op[2])) && typeof op[3] === "string" && op[3].length === 1) {
        if (room <= 0) continue;
        if (this.integrate(op[1], op[2], op[3])) room--;
        else this.pending.push(op);
      }
    }
    // characters typed after ones that just arrived
    for (let again = true; again && this.pending.length; ) {
      again = false;
      const left = [];
      for (const op of this.pending) {
        if (this.integrate(op[1], op[2], op[3])) again = true;
        else left.push(op);
      }
      this.pending = left.slice(-MAXLEN);
    }
  }
  visible() {
    return this.items.filter((x) => !x.d);
  }

  // ---------- my typing ----------
  // the textarea changed: what was removed and what was typed, as character operations
  local(value) {
    if (!this.canEdit()) return this.paint(true);
    const old = this.text;
    if (value.length > MAXLEN) value = value.slice(0, MAXLEN);
    let p = 0;
    while (p < old.length && p < value.length && old[p] === value[p]) p++;
    let s = 0;
    while (s < old.length - p && s < value.length - p && old[old.length - 1 - s] === value[value.length - 1 - s]) s++;
    const vis = this.visible();
    const ops = [];
    for (let i = p; i < old.length - s; i++) {
      vis[i].d = true;
      ops.push(["d", vis[i].id]);
    }
    let o = p > 0 ? vis[p - 1].id : "";
    for (const c of value.slice(p, value.length - s)) {
      const id = `${++this.clock}.${this.me}`;
      this.integrate(id, o, c);
      ops.push(["i", id, o, c]);
      o = id;
    }
    const vis2 = this.visible();
    this.text = vis2.map((x) => x.c).join("");
    this.textIds = vis2.map((x) => x.id);
    for (let i = 0; i < ops.length; i += BATCH) this.o.send({ k: "nop", ops: ops.slice(i, i + BATCH), name: this.o.myName() });
    if (ops.length) this.started = true;
  }
  template() {
    const t = this.t;
    const d = new Date();
    const date = d.toLocaleDateString(document.documentElement.lang || undefined, { year: "numeric", month: "long", day: "numeric" });
    const names = this.o.names().filter(Boolean).join(", ");
    const lines = [
      t("Notes · {date}", { date }),
      `${t("Attendees")}: ${names}`,
      "",
      t("Notes"),
      "- ",
      "",
      t("Action items"),
      "[ ] ",
    ];
    const value = lines.join("\n") + (this.text ? "\n\n" + this.text : "");
    this.local(value);
    this.paint(true);
    const ta = this.el?.querySelector("textarea");
    if (ta) {
      ta.focus();
      const at = lines.slice(0, 5).join("\n").length; // after "- " under Notes
      ta.setSelectionRange(at, at);
    }
  }

  // ---------- from the others ----------
  receive(from, m) {
    if (!KINDS.includes(m?.k) || !this.code) return false;
    if (m.k === "nset") {
      if (this.o.hosts().has(from) && +m.ver > this.edit.ver && ["all", "host"].includes(m.who)) {
        this.edit = { who: m.who, ver: +m.ver };
        this.o.notify(m.who === "host" ? this.t("Only the host can edit the notes now") : this.t("Everyone can edit the notes now"));
        this.paint(true);
      }
      return true;
    }
    if (m.k === "nop") {
      // "only the host can edit" is kept by each person's own box (read only); every edit that was made is still
      // taken, so a letter typed just before the switch doesn't leave one copy different from the others
      this.applyOps((Array.isArray(m.ops) ? m.ops : []).slice(0, BATCH));
      const name = String(m.name || "").slice(0, 60) || this.t("Someone");
      this.writers.set(name, Date.now() + 3000);
      clearTimeout(this.wTimer);
      this.wTimer = setTimeout(() => this.paintWriters(), 3100);
    } else if (m.k === "nsync") {
      if (this.o.hosts().has(from) && +m.edit?.ver > this.edit.ver && ["all", "host"].includes(m.edit.who)) this.edit = { who: m.edit.who, ver: +m.edit.ver };
      this.applyOps((Array.isArray(m.ops) ? m.ops : []).slice(0, BATCH));
    }
    const had = this.text;
    this.paint();
    if (!this.started && this.any()) {
      this.started = true;
      if (m.k === "nop" && !had.trim()) this.o.notify(this.t("{name} is taking notes", { name: String(m.name || "").slice(0, 60) || this.t("Someone") }));
    }
    if (this.text !== had) this.o.badge();
    this.paintWriters();
    return true;
  }
  // a newcomer gets the whole text (deleted characters too, so later edits from others still find their place)
  greet(id) {
    if (!this.items.length && !this.edit.ver) return;
    const all = [];
    for (const x of this.items) {
      all.push(["i", x.id, x.o, x.c]);
      if (x.d) all.push(["d", x.id]);
    }
    if (!all.length) return this.o.sendTo(id, { k: "nsync", ops: [], edit: this.edit });
    for (let i = 0; i < all.length; i += BATCH) this.o.sendTo(id, { k: "nsync", ops: all.slice(i, i + BATCH), edit: this.edit });
  }
  setWho(who) {
    if (!this.o.amHost()) return;
    this.edit = { who, ver: Date.now() };
    this.o.send({ k: "nset", who, ver: this.edit.ver });
    this.paint(true);
  }

  // ---------- saving ----------
  report() {
    return this.text.replace(/\r?\n/g, "\r\n") + "\r\n";
  }
  download() {
    const pad = (n) => String(n).padStart(2, "0");
    const d = new Date();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([this.report()], { type: "text/plain;charset=utf-8" }));
    a.download = `Juntos ${this.t("notes")} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ---------- the panel ----------
  mount(el) {
    const t = this.t;
    this.el = el;
    el.innerHTML = "";
    const who = h("select", { name: "who", "aria-label": t("Who can edit"), onchange: () => this.setWho(who.value) });
    who.append(h("option", { value: "all", text: t("Everyone can edit") }), h("option", { value: "host", text: t("Only the host can edit") }));
    const ta = h("textarea", {
      class: "notesText",
      name: "notes",
      maxlength: MAXLEN,
      spellcheck: "true",
      placeholder: t("Notes everyone in the call can see and write in"),
      oninput: () => this.local(ta.value),
    });
    el.append(
      h("div", { class: "notesHead" }, h("span", { class: "notesWho" }), who),
      h("button", { class: "secondary notesTpl", name: "template", text: t("Use the meeting notes template"), onclick: () => this.template() }),
      ta,
      h("div", { class: "notesWriting", "aria-live": "polite" }),
      h(
        "div",
        { class: "notesFoot" },
        h("button", { class: "secondary", name: "copy", text: t("Copy"), onclick: () => this.copy() }),
        h("button", { class: "secondary", name: "save", text: t("Save (.txt)"), onclick: () => this.download() }),
      ),
    );
    this.render();
  }
  async copy() {
    try {
      await navigator.clipboard.writeText(this.text);
      this.o.notify(this.t("Notes copied"));
    } catch (_) {
      this.o.notify(this.t("Couldn't copy; use Save instead"));
    }
  }
  render() {
    this.paint(true);
  }
  // put the text in the box, keeping my cursor next to the same character
  paint(force) {
    const text = this.visible().map((x) => x.c).join("");
    if (!this.el) {
      this.text = text;
      this.textIds = this.visible().map((x) => x.id);
      return;
    }
    const t = this.t;
    const ta = this.el.querySelector("textarea");
    if (ta && (force || ta.value !== text)) {
      const focused = document.activeElement === ta;
      let a = null;
      let b = null;
      if (focused) {
        const vis = this.items.filter((x) => !x.d);
        const before = (n) => (n > 0 && n <= this.textIds?.length ? this.textIds[n - 1] : null);
        a = before(ta.selectionStart);
        b = before(ta.selectionEnd);
        const at = (id, n) => (id === null ? (n === 0 ? 0 : null) : vis.findIndex((x) => x.id === id) + 1 || null);
        a = at(a, ta.selectionStart);
        b = at(b, ta.selectionEnd);
      }
      if (ta.value !== text) ta.value = text;
      if (focused && a !== null) ta.setSelectionRange(a, b ?? a);
    }
    this.text = text;
    this.textIds = this.items.filter((x) => !x.d).map((x) => x.id);
    if (ta) ta.readOnly = !this.canEdit();
    const who = this.el.querySelector("select[name=who]");
    if (who) {
      who.value = this.edit?.who || "all";
      who.hidden = !this.o.amHost();
    }
    const label = this.el.querySelector(".notesWho");
    // the host sees the choice itself; the others see what it is
    if (label) label.textContent = this.o.amHost() ? t("Who can edit") : this.edit?.who === "host" ? t("Only the host can edit") : t("Everyone can edit");
    const tpl = this.el.querySelector("[name=template]");
    if (tpl) tpl.hidden = !this.canEdit() || /\S/.test(text);
  }
  paintWriters() {
    const box = this.el?.querySelector(".notesWriting");
    if (!box) return;
    const now = Date.now();
    const names = [...this.writers].filter(([, until]) => until > now).map(([n]) => n);
    for (const [n, until] of this.writers) if (until <= now) this.writers.delete(n);
    box.textContent = names.length ? this.t("{name} is writing…", { name: names.join(", ") }) : "";
  }
}
