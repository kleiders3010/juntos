// Polls and Q&A, like Meet's (studied: support.google.com/meet/answer/10165071 polls, /10146000 Q&A).
// Polls: a question with 2 to 10 answers; "responses without names"; "show everyone the results" (else only who
// started it and the host see them); one vote each, not changed; who started it (or the host) ends or deletes it.
// Q&A: anyone asks (anonymously if the host allows it), anyone upvotes, sort by popular or recent, filter; the host
// marks answered, hides, deletes, and can hold each question until approved; you can delete your own question.
// Nothing is kept on a server: every device in the call holds the same list and catches newcomers up. Save it all
// as a .txt (Meet emails a report instead).
const MAXQ = 500; // pinned: Meet's limit per Q&A
const MAXP = 100;
const MAXOPT = 10;
const rid = () => [...crypto.getRandomValues(new Uint32Array(2))].map((x) => x.toString(36)).join("");
async function sha(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s)));
  return [...new Uint8Array(b)].slice(0, 12).map((x) => x.toString(16).padStart(2, "0")).join("");
}
const clip = (s, n) => String(s ?? "").slice(0, n);
const KINDS = ["act", "actdel", "vote", "qup", "actset", "actsync"];

function clean(it) {
  if (!it || typeof it.id !== "string" || !it.id || it.id.length > 40) return null;
  const base = { id: it.id, at: +it.at || Date.now(), ver: +it.ver || 0, lock: clip(it.lock, 40) };
  if (it.type === "poll") {
    const opts = (Array.isArray(it.opts) ? it.opts : []).slice(0, MAXOPT).map((x) => clip(x, 200));
    if (opts.length < 2 || !clip(it.q, 300).trim()) return null;
    return { ...base, type: "poll", q: clip(it.q, 300), opts, byName: clip(it.byName, 60), anon: !!it.anon, show: !!it.show, ended: !!it.ended };
  }
  if (it.type === "q" && clip(it.text, 500).trim()) {
    return { ...base, type: "q", text: clip(it.text, 500), anon: !!it.anon, byName: it.anon ? "" : clip(it.byName, 60), answered: !!it.answered, hidden: !!it.hidden, approved: it.approved !== false };
  }
  return null;
}

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

export class Activities {
  // o: { t, send(m), sendTo(id, m), hosts() (ids of the hosts among the others), amHost(), myName(), notify(text), badge() }
  constructor(o) {
    this.o = o;
    this.t = o.t;
    this.code = null;
    this.tab = "polls";
    this.sort = "popular";
    this.filter = "all";
  }

  // a new call code starts empty; the same code (rejoining) keeps what was there
  reset(code) {
    if (this.code === code) return;
    this.code = code;
    this.items = new Map();
    this.dels = new Set();
    this.votes = new Map(); // poll id -> Map(ballot -> { opt, name })
    this.ups = new Map(); // question id -> Set(person keys)
    this.set = { qa: true, anon: true, mod: false, ver: 0 };
    let saved = {};
    try {
      saved = JSON.parse(sessionStorage.getItem(`juntos.act.${code}`) || "{}");
    } catch (_) {}
    this.secrets = saved.secrets || {}; // what proves an item is mine (also after reconnecting)
    this.myVotes = saved.votes || {};
    this.key = saved.key || rid();
    this.save();
    this.render();
  }
  save() {
    sessionStorage.setItem(`juntos.act.${this.code}`, JSON.stringify({ secrets: this.secrets, votes: this.myVotes, key: this.key }));
  }
  any() {
    return !!this.items?.size;
  }
  mine(it) {
    return !!this.secrets[it.id];
  }
  isHost(from) {
    return this.o.hosts().has(from);
  }
  count(type) {
    let n = 0;
    for (const x of this.items.values()) if (x.type === type) n++;
    return n;
  }
  seesResults(p) {
    return p.show || this.mine(p) || this.o.amHost();
  }
  visibleQ(q) {
    if (this.o.amHost()) return true;
    if (!q.approved || q.hidden) return this.mine(q) && !q.hidden;
    return true;
  }

  // ---------- from the others ----------
  receive(from, m) {
    if (!KINDS.includes(m?.k) || !this.items) return false;
    if (m.k === "act") this.upsert(from, m.item, m.proof, false);
    else if (m.k === "actdel") this.remove(from, m.id, m.proof);
    else if (m.k === "vote") this.addVote(m.poll, m.opt, m.ballot, m.name);
    else if (m.k === "qup") this.addUp(m.q, m.key, m.on);
    else if (m.k === "actset") {
      if (this.isHost(from) && +m.set?.ver > this.set.ver) this.applySet(m.set);
    } else if (m.k === "actsync") {
      for (const id of (m.dels || []).slice(0, 2000)) this.forget(String(id));
      for (const it of (m.items || []).slice(0, MAXQ + MAXP)) this.upsert(from, it, null, true);
      for (const [poll, list] of Object.entries(m.votes || {})) for (const [b, opt, name] of (list || []).slice(0, 5000)) this.addVote(poll, opt, b, name, true);
      for (const [q, keys] of Object.entries(m.ups || {})) for (const k of (keys || []).slice(0, 5000)) this.addUp(q, k, true, true);
      if (this.isHost(from) && +m.set?.ver > this.set.ver) this.applySet(m.set);
      this.changed();
    }
    return true;
  }
  applySet(s) {
    this.set = { qa: !!s.qa, anon: !!s.anon, mod: !!s.mod, ver: +s.ver };
    this.changed();
  }
  forget(id) {
    this.dels.add(id);
    this.items.delete(id);
    this.votes.delete(id);
    this.ups.delete(id);
  }
  async upsert(from, raw, proof, viaSync) {
    const it = clean(raw);
    if (!it || this.dels.has(it.id)) return;
    const cur = this.items.get(it.id);
    if (!cur) {
      if (this.count(it.type) >= (it.type === "q" ? MAXQ : MAXP)) return;
      if (it.type === "q" && !this.set.qa && !viaSync && !this.isHost(from)) return;
      this.items.set(it.id, it);
      if (!viaSync) this.announce(it);
      return this.changed();
    }
    if (it.ver <= cur.ver) return;
    const host = this.isHost(from);
    const owner = !!proof && (await sha(proof)) === cur.lock;
    if (cur.type === "poll" && (host || owner || viaSync)) {
      cur.ended ||= it.ended; // an ended poll stays ended
      cur.show = it.show;
    }
    if (cur.type === "q" && (host || viaSync)) {
      const was = cur.approved;
      cur.answered = it.answered;
      cur.hidden = it.hidden;
      cur.approved ||= it.approved;
      if (!was && cur.approved && !viaSync) this.announce(cur);
    }
    cur.ver = it.ver;
    this.changed();
  }
  async remove(from, id, proof) {
    const cur = this.items.get(id);
    if (!cur) return;
    if (this.isHost(from) || (proof && (await sha(proof)) === cur.lock)) {
      this.forget(id);
      this.changed();
    }
  }
  addVote(poll, opt, ballot, name, quiet) {
    if (typeof poll !== "string" || typeof ballot !== "string" || !Number.isInteger(opt) || opt < 0 || opt >= MAXOPT) return;
    const p = this.items.get(poll);
    if (p?.ended && !quiet) return;
    if (!this.votes.has(poll)) this.votes.set(poll, new Map());
    const v = this.votes.get(poll);
    if (v.has(ballot) || v.size > 5000) return;
    v.set(ballot, { opt, name: p?.anon ? "" : clip(name, 60) });
    if (!quiet) this.changed();
  }
  addUp(q, key, on, quiet) {
    if (typeof q !== "string" || typeof key !== "string") return;
    if (!this.ups.has(q)) this.ups.set(q, new Set());
    const s = this.ups.get(q);
    if (on) s.add(key);
    else s.delete(key);
    if (!quiet) this.changed();
  }
  announce(it) {
    const t = this.t;
    if (it.type === "poll") this.o.notify(t("{name} started a poll: {q}", { name: it.byName || t("Someone"), q: it.q.slice(0, 80) }));
    else if (this.visibleQ(it) && !it.hidden) this.o.notify(it.approved ? t("New question: {q}", { q: it.text.slice(0, 80) }) : t("A question is waiting for your approval"));
    this.o.badge();
  }

  // catching a newcomer up (questions still waiting for approval only go to hosts)
  snapshotFor(id) {
    const host = this.isHost(id);
    const items = [...this.items.values()].filter((x) => x.type === "poll" || x.approved || host).map((x) => ({ ...x }));
    const votes = {};
    for (const [p, v] of this.votes) votes[p] = [...v].map(([b, x]) => [b, x.opt, x.name]);
    const ups = {};
    for (const [q, s] of this.ups) ups[q] = [...s];
    return { k: "actsync", items, dels: [...this.dels], votes, ups, set: this.set };
  }

  // ---------- my own actions ----------
  async create(it) {
    const secret = rid() + rid();
    it.id = rid();
    it.at = Date.now();
    it.ver = it.at;
    it.lock = await sha(secret);
    const c = clean(it);
    if (!c) return;
    this.secrets[c.id] = secret;
    this.save();
    this.items.set(c.id, c);
    if (c.type === "q" && !c.approved) for (const h of this.o.hosts()) this.o.sendTo(h, { k: "act", item: c });
    else this.o.send({ k: "act", item: c });
    this.changed();
    return c;
  }
  startPoll(q, opts, anon, show) {
    return this.create({ type: "poll", q, opts, anon, show, ended: false, byName: this.o.myName() });
  }
  ask(text, anon) {
    const held = this.set.mod && !this.o.amHost();
    return this.create({ type: "q", text, anon: anon && this.set.anon, byName: this.o.myName(), approved: !held });
  }
  update(it, change) {
    Object.assign(it, change, { ver: Math.max(Date.now(), it.ver + 1) });
    this.o.send({ k: "act", item: it, proof: this.secrets[it.id] });
    this.changed();
  }
  del(it) {
    this.o.send({ k: "actdel", id: it.id, proof: this.secrets[it.id] });
    this.forget(it.id);
    this.changed();
  }
  vote(p, opt) {
    if (this.myVotes[p.id] !== undefined || p.ended) return;
    const ballot = rid();
    this.myVotes[p.id] = opt;
    this.save();
    const name = p.anon ? undefined : this.o.myName();
    this.addVote(p.id, opt, ballot, name);
    this.o.send({ k: "vote", poll: p.id, opt, ballot, name });
  }
  upvote(q) {
    const on = !this.ups.get(q.id)?.has(this.key);
    this.addUp(q.id, this.key, on);
    this.o.send({ k: "qup", q: q.id, key: this.key, on });
  }
  setSettings(change) {
    this.set = { ...this.set, ...change, ver: Math.max(Date.now(), this.set.ver + 1) };
    this.o.send({ k: "actset", set: this.set });
    this.changed();
  }

  // ---------- the report (.txt) ----------
  tally(p) {
    const counts = p.opts.map(() => 0);
    const names = p.opts.map(() => []);
    for (const v of this.votes.get(p.id)?.values() || []) {
      if (v.opt >= counts.length) continue;
      counts[v.opt]++;
      if (v.name) names[v.opt].push(v.name);
    }
    return { counts, names, total: counts.reduce((a, b) => a + b, 0) };
  }
  report() {
    const t = this.t;
    const host = this.o.amHost();
    const out = [];
    const polls = [...this.items.values()].filter((x) => x.type === "poll").sort((a, b) => a.at - b.at);
    if (polls.length) out.push(t("Polls"), "");
    for (const p of polls) {
      out.push(`${p.q}  (${p.byName}${p.ended ? ", " + t("ended") : ""})`);
      if (!this.seesResults(p)) {
        out.push("  " + t("Only who started the poll and the host see the results"), "");
        continue;
      }
      const { counts, names, total } = this.tally(p);
      p.opts.forEach((o, i) => {
        const pct = total ? Math.round((100 * counts[i]) / total) : 0;
        out.push(`  ${o}: ${counts[i]} (${pct} %)` + ((this.mine(p) || host) && names[i].length ? `: ${names[i].join(", ")}` : ""));
      });
      out.push("");
    }
    const qs = [...this.items.values()].filter((x) => x.type === "q" && this.visibleQ(x)).sort((a, b) => a.at - b.at);
    if (qs.length) out.push(t("Questions"), "");
    for (const q of qs) {
      const tags = [q.answered && t("Answered"), q.hidden && t("Hidden"), !q.approved && t("Pending approval")].filter(Boolean);
      out.push(`${q.text}  (${q.anon ? t("Anonymous") : q.byName}, ${(this.ups.get(q.id)?.size || 0) === 1 ? t("1 upvote") : t("{n} upvotes", { n: this.ups.get(q.id)?.size || 0 })}${tags.length ? ", " + tags.join(", ") : ""})`);
    }
    return out.join("\r\n") + "\r\n";
  }
  download() {
    const pad = (n) => String(n).padStart(2, "0");
    const d = new Date();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([this.report()], { type: "text/plain;charset=utf-8" }));
    a.download = `Juntos ${this.t("polls and questions")} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ---------- the panel ----------
  mount(el) {
    const t = this.t;
    this.el = el;
    el.innerHTML = "";
    const tabs = h("div", { class: "seg actTabs" });
    for (const [id, label] of [["polls", t("Polls")], ["qa", t("Q&A")]]) {
      tabs.append(h("button", { "data-v": id, text: label, onclick: () => ((this.tab = id), this.render()) }));
    }
    // polls
    const pollList = h("div", { class: "actList", id: "pollList" });
    const draft = h("form", { class: "actForm", id: "pollDraft", hidden: true });
    const opts = h("div", { class: "pollOpts" });
    const addOpt = () => {
      if (opts.children.length >= MAXOPT) return;
      opts.append(h("input", { name: "opt", maxlength: 200, placeholder: t("Option {n}", { n: opts.children.length + 1 }), autocomplete: "off" }));
      more.hidden = opts.children.length >= MAXOPT;
    };
    const more = h("button", { type: "button", class: "chip", text: t("Add an option"), onclick: addOpt });
    draft.append(
      h("input", { name: "q", maxlength: 300, placeholder: t("Ask a question"), autocomplete: "off" }),
      opts,
      more,
      h("label", { class: "check" }, h("input", { type: "checkbox", name: "anon" }), " " + t("Responses without names")),
      h("label", { class: "check" }, h("input", { type: "checkbox", name: "show" }), " " + t("Show everyone the results")),
      h("div", { class: "actRow" }, h("button", { type: "button", class: "secondary", text: t("Cancel"), onclick: () => ((draft.hidden = true), (start.hidden = false)) }), h("button", { class: "primary", text: t("Launch") })),
      h("p", { class: "actMsg", id: "pollMsg" }),
    );
    const resetDraft = () => {
      draft.reset();
      opts.innerHTML = "";
      addOpt();
      addOpt();
    };
    draft.onsubmit = async (e) => {
      e.preventDefault();
      const q = draft.q.value.trim();
      const answers = [...opts.querySelectorAll("input")].map((x) => x.value.trim()).filter(Boolean);
      if (!q || answers.length < 2) {
        draft.querySelector("#pollMsg").textContent = t("Write the question and at least two options");
        return;
      }
      await this.startPoll(q, answers, draft.anon.checked, draft.show.checked);
      draft.hidden = true;
      start.hidden = false;
    };
    const start = h("button", { class: "primary", id: "pollStart", text: t("Start a poll"), onclick: () => (resetDraft(), (draft.hidden = false), (start.hidden = true), draft.q.focus()) });
    const polls = h("div", { class: "actView", id: "actPolls" }, start, draft, pollList);
    // Q&A
    const hostSet = h("div", { class: "actHost", id: "qaHost" });
    const askForm = h(
      "form",
      { class: "actForm", id: "askForm" },
      h("textarea", { name: "text", maxlength: 500, rows: 2, placeholder: t("Ask a question") }),
      h("label", { class: "check", id: "askAnon" }, h("input", { type: "checkbox", name: "anon" }), " " + t("Post anonymously")),
      h("div", { class: "actRow" }, h("button", { class: "primary", text: t("Post") })),
    );
    askForm.onsubmit = async (e) => {
      e.preventDefault();
      const text = askForm.text.value.trim();
      if (!text) return;
      await this.ask(text, askForm.anon.checked);
      askForm.text.value = "";
    };
    const sel = (name, opts2, cur, fn) => {
      const s = h("select", { name });
      for (const [v, label] of opts2) s.append(h("option", { value: v, text: label, selected: v === cur }));
      s.onchange = () => fn(s.value);
      return s;
    };
    const tools = h(
      "div",
      { class: "actRow actTools" },
      sel("sort", [["popular", t("Popular")], ["recent", t("Recent")]], this.sort, (v) => ((this.sort = v), this.render())),
      h("span", { id: "qaFilterBox" }),
    );
    const qa = h("div", { class: "actView", id: "actQa" }, hostSet, h("p", { class: "actMsg", id: "qaOff" }), askForm, tools, h("div", { class: "actList", id: "qaList" }));
    const save = h("button", { class: "secondary actSave", name: "actSave", text: t("Save polls and questions (.txt)"), onclick: () => this.download() });
    el.append(tabs, polls, qa, save);
    this.render();
  }

  changed() {
    this.render();
    this.o.onChange?.();
  }

  render() {
    const el = this.el;
    if (!el || !this.items) return;
    const t = this.t;
    const host = this.o.amHost();
    for (const b of el.querySelectorAll(".actTabs button")) b.classList.toggle("on", b.dataset.v === this.tab);
    el.querySelector("#actPolls").hidden = this.tab !== "polls";
    el.querySelector("#actQa").hidden = this.tab !== "qa";
    el.querySelector(".actSave").hidden = !this.any();

    // polls, newest first
    const pl = el.querySelector("#pollList");
    pl.innerHTML = "";
    const polls = [...this.items.values()].filter((x) => x.type === "poll").sort((a, b) => b.at - a.at);
    if (!polls.length) pl.append(h("p", { class: "actEmpty", text: t("No polls yet") }));
    for (const p of polls) {
      const card = h("div", { class: "actCard poll" + (p.ended ? " ended" : ""), "data-id": p.id });
      card.append(h("div", { class: "actQ", text: p.q }), h("div", { class: "actBy", text: [p.byName, p.anon && t("responses without names"), p.ended && t("ended")].filter(Boolean).join(" · ") }));
      const voted = this.myVotes[p.id];
      if (voted === undefined && !p.ended) {
        const f = h("form", { class: "pollVote" });
        p.opts.forEach((o, i) => f.append(h("label", { class: "check" }, h("input", { type: "radio", name: "v", value: i }), " " + o)));
        f.append(h("button", { class: "primary", text: t("Vote") }));
        f.onsubmit = (e) => {
          e.preventDefault();
          const c = f.querySelector("input:checked");
          if (c) this.vote(p, +c.value);
        };
        card.append(f);
      } else if (voted !== undefined) card.append(h("div", { class: "actMine", text: t("You voted: {a}", { a: p.opts[voted] ?? "" }) }));
      if (this.seesResults(p)) {
        const { counts, names, total } = this.tally(p);
        const res = h("div", { class: "pollRes" });
        p.opts.forEach((o, i) => {
          const pct = total ? Math.round((100 * counts[i]) / total) : 0;
          const bar = h("div", { class: "resBar" }, h("i"));
          bar.firstChild.style.width = `${pct}%`;
          res.append(
            h("div", { class: "resRow" }, h("span", { class: "resOpt", text: o }), h("span", { class: "resNum", text: `${counts[i]} · ${pct} %` })),
            bar,
            ...((this.mine(p) || host) && names[i].length ? [h("div", { class: "resNames", text: names[i].join(", ") })] : []),
          );
        });
        res.append(h("div", { class: "actBy", text: total === 1 ? t("1 vote") : t("{n} votes", { n: total }) }));
        card.append(res);
      } else if (voted !== undefined || p.ended) card.append(h("div", { class: "actBy", text: t("Only who started the poll and the host see the results") }));
      if (this.mine(p) || host) {
        const row = h("div", { class: "actRow" });
        if (!p.ended) row.append(h("button", { class: "chip", name: "end", text: t("End the poll"), onclick: () => this.update(p, { ended: true }) }));
        row.append(h("button", { class: "chip", name: "show", text: p.show ? t("Hide results from everyone") : t("Show everyone the results"), onclick: () => this.update(p, { show: !p.show }) }));
        row.append(h("button", { class: "chip", name: "del", text: t("Delete"), onclick: () => this.del(p) }));
        card.append(row);
      }
      pl.append(card);
    }

    // Q&A
    const hs = el.querySelector("#qaHost");
    hs.innerHTML = "";
    hs.hidden = !host;
    if (host) {
      const ck = (name, label, on, key) => {
        const i = h("input", { type: "checkbox", name, checked: on });
        i.onchange = () => this.setSettings({ [key]: i.checked });
        return h("label", { class: "check" }, i, " " + label);
      };
      hs.append(
        ck("qaOn", t("Allow questions"), this.set.qa, "qa"),
        ck("qaAnon", t("Allow anonymous questions"), this.set.anon, "anon"),
        ck("qaMod", t("Hide each question until a host approves"), this.set.mod, "mod"),
      );
    }
    const off = !this.set.qa && !host;
    el.querySelector("#qaOff").textContent = off ? t("The host turned off questions") : this.set.mod && !host ? t("The host approves each question before others see it") : "";
    el.querySelector("#askForm").hidden = off;
    el.querySelector("#askAnon").hidden = !this.set.anon;
    const fb = el.querySelector("#qaFilterBox");
    const filters = [["all", t("All questions")], ["open", t("Not answered")], ["answered", t("Answered")]];
    if (host) filters.push(["hidden", t("Hidden")], ["pending", t("Pending approval")]);
    if (!filters.some(([v]) => v === this.filter)) this.filter = "all";
    if (fb.dataset.host !== String(host)) {
      fb.dataset.host = String(host);
      fb.innerHTML = "";
      const s = h("select", { name: "filter" });
      for (const [v, label] of filters) s.append(h("option", { value: v, text: label, selected: v === this.filter }));
      s.onchange = () => ((this.filter = s.value), this.render());
      fb.append(s);
    }
    const ql = el.querySelector("#qaList");
    ql.innerHTML = "";
    const ups = (q) => this.ups.get(q.id)?.size || 0;
    let qs = [...this.items.values()].filter((x) => x.type === "q" && this.visibleQ(x));
    const f = this.filter;
    qs = qs.filter((q) =>
      f === "hidden" ? q.hidden : f === "pending" ? !q.approved : (host ? !q.hidden : true) && (f === "open" ? !q.answered : f === "answered" ? q.answered : true),
    );
    qs.sort((a, b) => (this.sort === "popular" ? ups(b) - ups(a) || a.at - b.at : b.at - a.at));
    if (!qs.length) ql.append(h("p", { class: "actEmpty", text: t("No questions yet") }));
    for (const q of qs) {
      const mineUp = this.ups.get(q.id)?.has(this.key);
      const tags = [q.answered && t("Answered"), q.hidden && t("Hidden"), !q.approved && t("Pending approval")].filter(Boolean);
      const when = new Date(q.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const card = h(
        "div",
        { class: "actCard q" + (q.answered ? " answered" : ""), "data-id": q.id },
        h("div", { class: "qMain" }, h("div", { class: "actQ", text: q.text }), h("div", { class: "actBy", text: [q.anon ? t("Anonymous") : q.byName, when, ...tags].join(" · ") })),
        h("button", { class: "upBtn" + (mineUp ? " on" : ""), name: "up", title: t("Upvote"), "aria-pressed": mineUp ? "true" : "false", text: `▲ ${ups(q)}`, onclick: () => this.upvote(q), disabled: !q.approved }),
      );
      const row = h("div", { class: "actRow" });
      if (host) {
        if (!q.approved) row.append(h("button", { class: "chip", name: "approve", text: t("Approve"), onclick: () => this.update(q, { approved: true }) }));
        row.append(h("button", { class: "chip", name: "answered", text: q.answered ? t("Not answered") : t("Mark as answered"), onclick: () => this.update(q, { answered: !q.answered }) }));
        row.append(h("button", { class: "chip", name: "hide", text: q.hidden ? t("Show") : t("Hide"), onclick: () => this.update(q, { hidden: !q.hidden }) }));
      }
      if (host || this.mine(q)) row.append(h("button", { class: "chip", name: "del", text: t("Delete"), onclick: () => this.del(q) }));
      if (row.children.length) card.append(row);
      ql.append(card);
    }
  }
}
