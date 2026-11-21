// Breakout rooms, like Meet's (studied: support.google.com/meet/answer/13054147, the host and the participant pages).
// The host splits the call into up to 100 rooms: people are spread automatically, moved one by one or shuffled,
// with an optional timer. Each person gets an invitation (Join, or stay in the main call). In a room: the time left,
// Ask for help, Return to main call. The host joins and leaves any room, edits rooms while open, and closes them:
// everyone gets 30 seconds, then is back in the main call (Close now skips the wait). A timer that runs out closes
// the rooms the same way. Room chat is deleted when the rooms end.
// Everyone stays connected to everyone (so the host still reaches every room); each device sends its sound and
// picture only to the people in its own room, and chat, captions, hands and reactions stay in the room.
const MAXR = 100; // pinned: Meet's limit of rooms in a call
const GRACE = 30000; // pinned: Meet's 30 seconds before people are moved back
const TIMERS = [0, 5, 10, 15, 20, 30, 45, 60]; // minutes; 0 = no timer
const KINDS = ["br", "brwhere", "brhelp"];

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
const clampRoom = (r, n) => Math.max(0, Math.min(n ?? MAXR, Math.floor(+r) || 0));
const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export class Breakout {
  // o: { t, mesh(), amHost(), notify(text), onMove(), onEnd(), call (the element the bar and cards go in) }
  constructor(o) {
    this.o = o;
    this.t = o.t;
    this.tick = setInterval(() => this.onTick(), 500);
    this.reset();
  }

  reset() {
    this.plan = null; // { v, n, assign: { id: room }, ends (local time, 0 = no timer), closing (local time or 0), timer }
    this.here = 0; // my room (0 = the main call)
    this.where = new Map(); // id -> room, as each person says
    this.declined = -1; // the plan version whose invitation I turned down (or left)
    this.help = new Map(); // host: id -> room of whoever asked for help
    this.later = new Set(); // host: help requests put off ("Later"); the room still shows it asked
    this.asked = false;
    this.draft = null; // host: rooms being set up or edited { n, assign, timer }
    this.from = ""; // name of the host who opened the rooms
    this.paint();
  }

  room(r) {
    return r ? this.t("Room {n}", { n: r }) : this.t("Main call");
  }
  roomOf(id) {
    return id === "me" ? this.here : this.where.get(id) || 0;
  }
  same(id) {
    return this.roomOf(id) === this.here;
  }
  myId() {
    return this.o.mesh()?.id;
  }
  mine() {
    return this.plan ? this.plan.assign[this.myId()] || 0 : 0;
  }
  others() {
    const m = this.o.mesh();
    return m ? [...m.peers.values()] : [];
  }

  // ---- messages ----
  receive(from, m) {
    if (!m || !KINDS.includes(m.k)) return false;
    const mesh = this.o.mesh();
    if (m.k === "br") {
      if (mesh?.hosts.has(from)) {
        this.from = mesh.peers.get(from)?.name || "";
        this.apply(m);
      }
    } else if (m.k === "brwhere") {
      // only the main call, the room the host gave them, or (a host) any room: nobody sits in on another room by
      // saying so (safety round 2, J18)
      const r = clampRoom(m.room);
      if (r && !mesh?.hosts.has(from) && !(this.plan && this.plan.assign[from] === r)) return true;
      this.where.set(from, r);
      if (!m.room) this.help.delete(from);
      this.o.onMove();
    } else if (m.k === "brhelp" && this.o.amHost()) {
      if (m.on) {
        this.help.set(from, clampRoom(m.room));
        this.later.delete(from); // the card at the top says it (Join or Later)
      } else this.help.delete(from);
    }
    this.paint();
    return true;
  }

  msg() {
    const p = this.plan;
    const now = Date.now();
    return { k: "br", v: p.v, n: p.n, assign: p.assign, timer: p.timer, left: p.ends ? Math.max(1, p.ends - now) : 0, closing: p.closing ? Math.max(1, p.closing - now) : 0 };
  }

  // a newcomer: where I am, and (host) the rooms that are open
  greet(id) {
    const mesh = this.o.mesh();
    if (this.here) mesh.sendTo(id, { k: "brwhere", room: this.here });
    if (this.plan && this.o.amHost()) mesh.sendTo(id, this.msg());
  }

  apply(m) {
    if (!m.n) return this.end();
    const n = clampRoom(m.n, MAXR) || 1;
    const assign = {};
    for (const [id, r] of Object.entries(m.assign || {}).slice(0, 500)) if (typeof id === "string" && id.length <= 40) assign[id] = clampRoom(r, n);
    const now = Date.now();
    const old = this.plan;
    this.plan = { v: +m.v || 0, n, assign, timer: +m.timer || 0, ends: m.left > 0 ? now + +m.left : 0, closing: m.closing > 0 ? now + Math.min(GRACE, +m.closing) : 0 };
    if (this.here > n) this.move(0);
    // turned down and my room didn't change (the host edited other rooms): don't ask again
    if (old && this.declined === old.v && old.assign[this.myId()] === assign[this.myId()]) this.declined = this.plan.v;
    this.paint();
  }

  // the rooms ended (closed, or the time ran out): everyone back in the main call, room chat gone
  end() {
    const was = !!this.plan;
    this.plan = null;
    this.draft = null;
    this.help.clear();
    this.declined = -1;
    if (this.here) this.move(0);
    if (was) {
      this.o.onEnd();
      this.o.notify(this.t("Breakout rooms ended. You're back in the main call."));
    }
    this.paint();
  }

  move(r) {
    if (this.here === r) return;
    if (this.asked) this.askHelp(false);
    this.here = r;
    this.o.mesh()?.broadcast({ k: "brwhere", room: r });
    this.o.onMove();
    this.paint();
  }

  askHelp(on) {
    this.asked = on;
    const mesh = this.o.mesh();
    for (const id of mesh?.hosts || []) mesh.sendTo(id, { k: "brhelp", on, room: this.here });
    if (on) this.o.notify(this.t("The host was asked to come help"));
    this.paint();
  }

  onTick() {
    const p = this.plan;
    if (!p) return;
    const now = Date.now();
    if (p.closing && now >= p.closing) return this.end();
    // the timer ran out: close like the host would (30 seconds, then back)
    if (p.ends && now >= p.ends && !p.closing) p.closing = now + GRACE;
    this.paintBar();
    if (this.o.amHost() && this.pane && !this.pane.hidden && !this.draft) this.paintClock();
  }

  // ---- host ----
  people() {
    // everyone the host can put in a room (not the host: the host stays in the main call, like Meet)
    return this.others().filter((p) => !this.o.mesh().hosts.has(p.id));
  }
  spread(n, ids) {
    const a = {};
    ids.forEach((id, i) => (a[id] = (i % n) + 1));
    return a;
  }
  shuffle() {
    const ids = this.people().map((p) => p.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    this.draft.assign = this.spread(this.draft.n, ids);
    this.draft.touched = true;
    this.render();
  }
  setup() {
    this.draft = this.plan ? { n: this.plan.n, assign: { ...this.plan.assign }, timer: this.plan.timer, touched: true } : { n: 1, assign: {}, timer: 0, touched: false };
    this.render();
  }
  // who is in the call changed: the open panel follows (people arrive while the host sets up)
  refresh() {
    const key = this.people().map((p) => `${p.id}:${p.name}`).join();
    if (key === this.seen) return;
    this.seen = key;
    if (this.o.amHost() && this.pane && !this.pane.hidden) this.render();
  }
  open() {
    const d = this.draft;
    const was = this.plan;
    const now = Date.now();
    const keepEnds = was && was.timer === d.timer ? was.ends : 0;
    this.plan = { v: (was?.v || 0) + 1, n: d.n, assign: d.assign, timer: d.timer, ends: keepEnds || (d.timer ? now + d.timer * 60000 : 0), closing: 0 };
    this.draft = null;
    this.o.mesh().broadcast(this.msg());
    if (this.here > d.n) this.move(0);
    this.render();
    this.paint();
  }
  setTimer(min) {
    const p = this.plan;
    p.timer = min;
    p.ends = min ? Date.now() + min * 60000 : 0;
    p.closing = 0;
    this.o.mesh().broadcast(this.msg());
    this.render();
  }
  close(now) {
    if (now) {
      this.o.mesh().broadcast({ k: "br", n: 0 });
      return this.end();
    }
    this.plan.closing = Date.now() + GRACE;
    this.o.mesh().broadcast(this.msg());
    this.render();
    this.paint();
  }

  mount(el) {
    this.pane = el;
    this.render();
  }

  render() {
    const el = this.pane;
    if (!el) return;
    const t = this.t;
    el.innerHTML = "";
    if (!this.o.amHost()) {
      el.append(h("p", { class: "actEmpty", text: t("Only the host can make breakout rooms.") }));
      return;
    }
    if (!this.plan && !this.draft) this.setup();
    if (this.draft) return this.renderSetup(el);
    this.renderOpen(el);
  }

  renderSetup(el) {
    const t = this.t;
    const d = this.draft;
    const people = this.people();
    const ids = people.map((p) => p.id);
    if (!d.touched) {
      // spread automatically (about two per room) until the host changes something
      d.n = Math.max(1, Math.min(MAXR, Math.ceil(ids.length / 2)));
      d.assign = this.spread(d.n, ids);
    }
    for (const id of ids)
      if (!(id in d.assign)) {
        // someone new: with rooms open, the main call until moved; while setting up, the emptiest room
        const count = (r) => ids.filter((x) => d.assign[x] === r).length;
        d.assign[id] = this.plan ? 0 : Array.from({ length: d.n }, (_, i) => i + 1).reduce((a, r) => (count(r) < count(a) ? r : a), 1);
      }
    const n = h("input", { type: "number", name: "rooms", min: 1, max: MAXR, value: d.n, "aria-label": t("Rooms") });
    n.onchange = () => {
      d.n = clampRoom(n.value, MAXR) || 1;
      d.assign = this.spread(d.n, ids);
      d.touched = true;
      this.render();
    };
    const timer = h("select", { name: "timer", "aria-label": t("Timer") }, TIMERS.map((m) => h("option", { value: m, selected: m === d.timer, text: m ? t("{n} min", { n: m }) : t("No timer") })));
    timer.onchange = () => (d.timer = +timer.value); // the timer alone keeps the automatic spread
    el.append(
      h("div", { class: "brRow" }, h("label", {}, t("Rooms"), " ", n), h("button", { class: "chip", name: "shuffle", onclick: () => this.shuffle(), text: t("Shuffle") })),
      h("div", { class: "brRow" }, h("label", {}, "⏳ ", t("Timer"), " ", timer)),
    );
    if (!people.length) el.append(h("p", { class: "actEmpty", text: t("Rooms need people: invite them with the link first.") }));
    const opts = (id) => {
      const s = h("select", { name: "move", "data-id": id, "aria-label": t("Room") }, Array.from({ length: d.n + 1 }, (_, r) => h("option", { value: r, selected: (d.assign[id] || 0) === r, text: this.room(r) })));
      s.onchange = () => {
        d.assign[id] = +s.value;
        d.touched = true;
        this.render();
      };
      return s;
    };
    for (let r = 1; r <= d.n; r++) {
      const inRoom = people.filter((p) => (d.assign[p.id] || 0) === r);
      el.append(h("div", { class: "actCard brRoom", "data-room": r }, h("b", { text: this.room(r) }), inRoom.length ? inRoom.map((p) => h("div", { class: "brPerson" }, h("span", { text: p.name || t("Someone") }), opts(p.id))) : h("span", { class: "actBy", text: t("Nobody yet") })));
    }
    const main = people.filter((p) => !d.assign[p.id]);
    if (main.length) el.append(h("div", { class: "actCard brRoom", "data-room": 0 }, h("b", { text: this.room(0) }), main.map((p) => h("div", { class: "brPerson" }, h("span", { text: p.name || t("Someone") }), opts(p.id)))));
    const go = this.plan
      ? [h("button", { class: "primary", name: "save", onclick: () => this.open(), text: t("Save") }), h("button", { class: "secondary", name: "cancel", onclick: () => ((this.draft = null), this.render()), text: t("Cancel") })]
      : [h("button", { class: "primary", name: "openRooms", disabled: !people.length, onclick: () => this.open(), text: t("Open rooms") })];
    el.append(h("div", { class: "brRow brGo" }, go));
  }

  renderOpen(el) {
    const t = this.t;
    const p = this.plan;
    el.append(h("div", { class: "brRow" }, h("b", { class: "brClock" }), this.timerSelect()));
    for (let r = 0; r <= p.n; r++) {
      const there = this.others().filter((x) => this.roomOf(x.id) === r);
      const invited = r ? this.others().filter((x) => p.assign[x.id] === r && this.roomOf(x.id) !== r) : [];
      const help = [...this.help.values()].includes(r);
      const me = this.here === r;
      const btn = !r ? null : me ? h("button", { class: "chip", name: "leaveRoom", onclick: () => this.move(0), text: t("Leave") }) : h("button", { class: "chip", name: "joinRoom", onclick: () => this.join(r), text: t("Join") });
      el.append(
        h("div", { class: "actCard brRoom" + (help ? " help" : ""), "data-room": r },
          h("div", { class: "brRow" }, h("b", { text: this.room(r) }), help ? h("span", { class: "brHelpTag", text: t("Asked for help") }) : null, btn),
          me ? h("span", { class: "brPerson", text: t("You") }) : null,
          there.map((x) => h("span", { class: "brPerson", text: x.name || t("Someone") })),
          invited.map((x) => h("span", { class: "brPerson actBy", text: t("{name} (invited)", { name: x.name || t("Someone") }) })),
          !r || there.length || me || invited.length ? null : h("span", { class: "actBy", text: t("Nobody yet") }),
        ),
      );
    }
    const closeBtn = p.closing
      ? h("button", { class: "secondary danger", name: "closeNow", onclick: () => this.close(true), text: t("Close now") })
      : this.sure(t("Close rooms"), t("Close all rooms"), () => this.close(false));
    el.append(h("div", { class: "brRow brGo" }, h("button", { class: "secondary", name: "edit", onclick: () => this.setup(), text: t("Edit rooms") }), closeBtn));
    this.paintClock();
  }

  timerSelect() {
    const t = this.t;
    const p = this.plan;
    const s = h("select", { name: "timer", "aria-label": t("Timer") }, TIMERS.map((m) => h("option", { value: m, selected: m === p.timer, text: m ? t("{n} min", { n: m }) : t("No timer") })));
    s.onchange = () => this.setTimer(+s.value);
    return s;
  }

  sure(label, sure, act) {
    const b = h("button", { class: "secondary", name: "closeRooms", text: label });
    b.onclick = () => {
      if (!b.classList.contains("sure")) {
        b.classList.add("sure");
        b.textContent = sure;
        setTimeout(() => {
          b.classList.remove("sure");
          b.textContent = label;
        }, 3000);
        return;
      }
      act();
    };
    return b;
  }

  paintClock() {
    const c = this.pane?.querySelector(".brClock");
    if (c) c.textContent = this.status();
  }

  status() {
    const p = this.plan;
    const t = this.t;
    if (!p) return "";
    const now = Date.now();
    if (p.closing) return t("Rooms close in {time}", { time: mmss(p.closing - now) });
    if (p.ends) return t("{time} left", { time: mmss(p.ends - now) });
    return t("Rooms are open");
  }

  join(r) {
    this.declined = -1;
    for (const [id, room] of this.help) if (room === r) this.help.delete(id);
    this.move(r);
    this.paint();
    this.render();
  }

  // ---- what everyone sees: the bar at the top of the call and the invitation ----
  paint() {
    this.paintBar();
    if (this.o.amHost() && this.pane && !this.pane.hidden && !this.draft) this.render();
  }

  paintBar() {
    const t = this.t;
    let bar = document.getElementById("brBar");
    if (!bar) {
      bar = h("div", { id: "brBar", class: "brBar", hidden: true });
      this.o.call.append(bar);
    }
    const p = this.plan;
    const mine = this.mine();
    const invite = p && !p.closing && mine && this.here !== mine && this.declined !== p.v;
    // host: a card per help request, Join or Later (like Meet's notice)
    const calls = this.o.amHost() && p ? [...this.help].filter(([id, r]) => !this.later.has(id) && r !== this.here) : [];
    const key = JSON.stringify([!!p, this.here, mine, invite, this.asked, !!p?.closing, this.o.amHost(), calls]);
    if (bar.dataset.key !== key) {
      bar.dataset.key = key;
      bar.innerHTML = "";
      if (p) {
        // an invitation is only the invitation; otherwise where I am and the time
        if (!invite) bar.append(h("b", { class: "brWhere", text: this.room(this.here) }), h("span", { class: "brTime" }));
        if (invite) {
          bar.classList.add("invite");
          bar.append(
            h("span", { class: "brAsk", text: this.from ? t("{name} invites you to {room}", { name: this.from, room: this.room(mine) }) : t("You're invited to {room}", { room: this.room(mine) }) }),
            h("button", { class: "primary", name: "brJoin", onclick: () => this.move(mine), text: t("Join") }),
            h("button", { class: "chip", name: "brStay", onclick: () => ((this.declined = p.v), this.paint()), text: t("Cancel") }),
          );
        } else bar.classList.remove("invite");
        if (!invite && !this.here && mine && !p.closing) bar.append(h("button", { class: "chip", name: "brJoin", onclick: () => this.move(mine), text: t("Join {room}", { room: this.room(mine) }) }));
        if (this.here && !this.o.amHost()) bar.append(h("button", { class: "chip" + (this.asked ? " on" : ""), name: "brHelp", onclick: () => this.askHelp(!this.asked), text: this.asked ? t("Cancel ask for help") : t("Ask for help") }));
        if (this.here) bar.append(h("button", { class: "chip", name: "brBack", onclick: () => ((this.declined = p.v), this.move(0)), text: t("Return to main call") }));
        for (const [id, r] of calls) {
          const name = this.o.mesh()?.peers.get(id)?.name || t("Someone");
          bar.append(
            h("div", { class: "brCall" },
              h("span", { text: t("{name} in {room} asks for help", { name, room: this.room(r) }) }),
              h("button", { class: "primary", name: "helpJoin", onclick: () => this.join(r), text: t("Join") }),
              h("button", { class: "chip", name: "helpLater", onclick: () => (this.later.add(id), this.paint()), text: t("Later") }),
            ),
          );
        }
      }
    }
    bar.hidden = !p;
    // notices go below the bar, however tall it is
    document.body.style.setProperty("--brH", `${p ? bar.offsetHeight : 0}px`);
    const time = bar.querySelector(".brTime");
    if (time && p) {
      time.textContent = this.status();
      const now = Date.now();
      time.classList.toggle("soon", !!p.closing || (!!p.ends && p.ends - now <= GRACE));
    }
  }
}
