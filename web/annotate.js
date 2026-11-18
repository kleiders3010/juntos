// Drawing on a shared screen, like Zoom's annotation (studied: support.zoom.com KB0067931 "Using annotation tools":
// text, draw, spotlight/arrow, vanishing pen, eraser, format, undo/redo, clear, save; "Disable annotation for
// others" and "Show names of annotators" for the one sharing) and Meet's annotate while presenting (pen,
// highlighter, text, colours; everyone sees it).
// Marks live over the shared picture on every device, placed in the shared picture's own coordinates (0..10000 on
// each side), so they stay on the right spot whatever size or layout each person has. Nothing goes to a server:
// they travel with the call like the chat and are gone when the sharing stops.
const KINDS = ["ana", "and", "anc", "ano", "anp", "ans"];
const FADE = 3000; // ms a vanishing pen mark stays
const COLORS = ["#ef4444", "#facc15", "#22c55e", "#3b82f6", "#ffffff", "#111827"];
const WIDTHS = { pen: 4, hl: 22, fade: 6, arrow: 5, rect: 4 }; // thousandths of the picture's height
const MAXPTS = 3000;
const rid = () => [...crypto.getRandomValues(new Uint32Array(2))].map((x) => x.toString(36)).join("");
const clampN = (v) => Math.max(0, Math.min(10000, Math.round(+v || 0)));

const ICONS = {
  annotate: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
  pen: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
  hl: "M6 14l3 3v5h6v-5l3-3V9H6v5zm5-12h2v3h-2zM3.5 5.88l1.41-1.41 2.12 2.12L5.62 8 3.5 5.88zm13.46.71 2.12-2.12 1.41 1.41L18.38 8l-1.42-1.41z",
  fade: "M7 14c-1.66 0-3 1.34-3 3 0 1.31-1.16 2-2 2 .92 1.22 2.49 2 4 2 2.21 0 4-1.79 4-4 0-1.66-1.34-3-3-3zm13.71-9.37-1.34-1.34a1 1 0 0 0-1.41 0L9 12.25 11.75 15l8.96-8.96a1 1 0 0 0 0-1.41z",
  arrow: "M5 19 17.6 6.4V13h2V3h-10v2h6.6L3.6 17.6z",
  rect: "M3 5v14h18V5H3zm16 12H5V7h14v10z",
  text: "M5 4v3h5.5v12h3V7H19V4z",
  pointer: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 14a4 4 0 1 1 0-8 4 4 0 0 1 0 8z",
  eraser: "M16.24 3.56 21.19 8.5a2 2 0 0 1 0 2.83L12 20.5h8V22H8.5l-4.2-4.2a2 2 0 0 1 0-2.83L13.4 3.56a2 2 0 0 1 2.84 0zM6.4 15.73l3.54 3.54 3.53-3.54-3.53-3.53-3.54 3.53z",
  undo: "M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62A7.95 7.95 0 0 1 20.08 16l2.37-.78A10.5 10.5 0 0 0 12.5 8z",
  redo: "M18.4 10.6A10.46 10.46 0 0 0 1.55 15.22l2.36.78A7.95 7.95 0 0 1 16.62 12.38L13 16h9V7l-3.6 3.6z",
  clear: "M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
  save: "M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67 2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2v9.67z",
  more: "M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  close: "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
};
const svg = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[n]}"/></svg>`;

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) e[k] = v;
    else if (k === "text") e.textContent = v;
    else if (k === "html") e.innerHTML = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k);
  return e;
}

// a mark as received: only known kinds, numbers in range, short text
function clean(i) {
  if (!i || typeof i.id !== "string" || i.id.length > 40) return null;
  const t = ["pen", "hl", "fade", "arrow", "rect", "text"].includes(i.t) ? i.t : null;
  if (!t) return null;
  const p = Array.isArray(i.p) ? i.p.slice(0, MAXPTS * 2).map(clampN) : [];
  if (p.length < 2 || p.length % 2) return null;
  return {
    id: i.id,
    t,
    c: COLORS.includes(i.c) ? i.c : COLORS[0],
    w: Math.max(1, Math.min(60, +i.w || WIDTHS[t] || 4)),
    p,
    s: t === "text" ? String(i.s || "").slice(0, 300) : undefined,
    n: String(i.n || "").slice(0, 60),
  };
}

export class Annotate {
  // o: { t, send(m) (to my breakout room), sendTo(id, m), myId(), myName(), amHost(), isHost(id), name(id),
  //      sharing(id) (is this one sharing their screen), focus(tile) (make the tile big), notify(text) }
  constructor(o) {
    this.o = o;
    this.t = o.t;
    this.shares = new Map(); // sharer id -> { items: Map(id -> mark, with by and at), opts: { others, names }, ptrs: Map(by -> {x, y, at, n}) }
    this.tiles = new Map(); // sharer id -> { tile, canvas }
    this.active = null; // sharer id I am drawing on
    this.tool = "pen";
    this.color = COLORS[0];
    this.mine = []; // my marks, newest last (undo)
    this.redo = [];
    this.opts = { others: true, names: true }; // mine, when I share
    this.loop = this.loop.bind(this);
    addEventListener("keydown", (e) => this.key(e), true); // before the call's own Esc (leave full screen)
  }

  share(sid) {
    let s = this.shares.get(sid);
    if (!s) this.shares.set(sid, (s = { items: new Map(), opts: { others: true, names: true }, ptrs: new Map() }));
    return s;
  }
  id(tile) {
    return tile.dataset.id === "me" ? this.o.myId() : tile.dataset.id;
  }
  isMine(sid) {
    return sid === this.o.myId();
  }
  canDraw(sid) {
    return this.isMine(sid) || this.share(sid).opts.others;
  }
  canEraseAll(sid) {
    return this.isMine(sid) || this.o.amHost();
  }

  // ---------- which tiles show a shared screen (called whenever the grid or someone's state changes) ----------
  update() {
    const now = new Set();
    for (const tile of document.querySelectorAll("#grid .tile[data-id]")) {
      const sid = this.id(tile);
      if (!sid || !this.o.sharing(tile.dataset.id)) continue;
      now.add(sid);
      let e = this.tiles.get(sid);
      if (!e || e.tile !== tile) {
        e?.canvas.remove();
        e?.btn.remove();
        const canvas = h("canvas", { class: "anCanvas" });
        const btn = h("button", { class: "anBtn", title: this.t("Draw on the screen"), html: svg("annotate") });
        btn.onclick = (ev) => {
          ev.stopPropagation();
          this.active === sid ? this.close() : this.open(sid);
        };
        tile.append(canvas, btn);
        e = { tile, canvas, btn };
        this.tiles.set(sid, e);
        this.events(sid, e);
      }
      e.btn.hidden = !this.canDraw(sid);
    }
    for (const [sid, e] of this.tiles) {
      if (now.has(sid)) continue;
      // the sharing stopped: its marks go with it (as in Zoom)
      if (this.active === sid) this.close();
      e.canvas.remove();
      e.btn.remove();
      this.tiles.delete(sid);
      this.shares.delete(sid);
      this.mine = this.mine.filter((m) => m.sid !== sid);
      this.redo = this.redo.filter((m) => m.sid !== sid);
    }
    if (!now.has(this.o.myId())) this.opts = { others: true, names: true };
    // marks for a screen whose person is here but no longer sharing
    for (const sid of [...this.shares.keys()]) {
      if (now.has(sid)) continue;
      const tile = document.querySelector(`#grid .tile[data-id="${sid === this.o.myId() ? "me" : CSS.escape(sid)}"]`);
      if (tile) this.shares.delete(sid);
    }
    this.dirty = true;
    if (this.tiles.size && !this.running) {
      this.running = true;
      requestAnimationFrame(this.loop);
    }
  }

  // ---------- drawing ----------
  // where the shared picture is inside the tile (object-fit contain or cover), in CSS pixels
  frame(sid) {
    const e = this.tiles.get(sid);
    if (!e) return null;
    const v = e.tile.querySelector("video");
    const cw = e.tile.clientWidth;
    const ch = e.tile.clientHeight;
    const vw = v.videoWidth || 16;
    const vh = v.videoHeight || 9;
    const r = getComputedStyle(v).objectFit === "cover" ? Math.max(cw / vw, ch / vh) : Math.min(cw / vw, ch / vh);
    return { x: (cw - vw * r) / 2, y: (ch - vh * r) / 2, w: vw * r, h: vh * r, cw, ch };
  }

  loop() {
    if (!this.tiles.size) {
      this.running = false;
      return;
    }
    const now = Date.now();
    for (const [sid, e] of this.tiles) {
      const s = this.share(sid);
      const f = this.frame(sid);
      const dpr = devicePixelRatio || 1;
      const W = Math.round(f.cw * dpr);
      const H = Math.round(f.ch * dpr);
      const moving = [...s.items.values()].some((m) => m.t === "fade") || s.ptrs.size || s.names?.size;
      if (!this.dirty && !moving && e.canvas.width === W && e.canvas.height === H && e.f && e.f.w === f.w && e.f.h === f.h) continue;
      e.f = f;
      if (e.canvas.width !== W || e.canvas.height !== H) {
        e.canvas.width = W;
        e.canvas.height = H;
      }
      const ctx = e.canvas.getContext("2d");
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.paint(ctx, sid, f.x, f.y, f.w, f.h, now, true);
    }
    this.dirty = false;
    requestAnimationFrame(this.loop);
  }

  // everything on one shared screen, in the rectangle (x, y, w, h); also used by recordings and Save
  paint(ctx, sid, x, y, w, h, now = Date.now(), live = false) {
    const s = this.shares.get(sid);
    if (!s) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    const X = (v) => x + (v / 10000) * w;
    const Y = (v) => y + (v / 10000) * h;
    for (const [id, m] of s.items) {
      let alpha = 1;
      if (m.t === "fade") {
        const age = now - m.at;
        if (age > FADE) {
          s.items.delete(id);
          continue;
        }
        alpha = Math.min(1, (FADE - age) / 800);
      }
      const lw = Math.max(m.t === "hl" ? 10 : 3, (m.w / 1000) * h); // never a hair line on a small tile
      ctx.globalAlpha = m.t === "hl" ? 0.38 * alpha : alpha;
      ctx.strokeStyle = ctx.fillStyle = m.c;
      ctx.lineWidth = lw;
      ctx.lineCap = m.t === "hl" ? "square" : "round";
      ctx.lineJoin = "round";
      const p = m.p;
      if (m.t === "text") {
        const size = Math.max(10, h * 0.035 * (m.w / 4));
        ctx.font = `600 ${size}px system-ui, sans-serif`;
        ctx.textBaseline = "top";
        ctx.lineWidth = Math.max(2, size / 7);
        ctx.strokeStyle = m.c === "#111827" ? "rgba(255,255,255,.85)" : "rgba(0,0,0,.65)";
        const lines = m.s.split("\n");
        lines.forEach((ln, i) => {
          ctx.strokeText(ln, X(p[0]), Y(p[1]) + i * size * 1.2);
          ctx.fillText(ln, X(p[0]), Y(p[1]) + i * size * 1.2);
        });
        ctx.textBaseline = "alphabetic";
      } else if (m.t === "rect") {
        const [x0, y0, x1, y1] = [X(p[0]), Y(p[1]), X(p[p.length - 2]), Y(p[p.length - 1])];
        ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      } else if (m.t === "arrow") {
        const [x0, y0, x1, y1] = [X(p[0]), Y(p[1]), X(p[p.length - 2]), Y(p[p.length - 1])];
        const a = Math.atan2(y1 - y0, x1 - x0);
        const head = Math.max(10, lw * 3.5);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1 - Math.cos(a) * head * 0.6, y1 - Math.sin(a) * head * 0.6);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - head * Math.cos(a - 0.45), y1 - head * Math.sin(a - 0.45));
        ctx.lineTo(x1 - head * Math.cos(a + 0.45), y1 - head * Math.sin(a + 0.45));
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(X(p[0]), Y(p[1]));
        if (p.length === 2) ctx.lineTo(X(p[0]) + 0.1, Y(p[1]));
        for (let i = 2; i < p.length; i += 2) ctx.lineTo(X(p[i]), Y(p[i + 1]));
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    if (live) {
      ctx.font = "600 13px system-ui, sans-serif";
      // who made a new mark: their name beside it for a moment (the sharer can turn this off)
      for (const [id, n] of s.names || []) {
        const m = s.items.get(id);
        if (!m || now - n.at > 2500 || !s.opts.names) {
          s.names.delete(id);
          continue;
        }
        const tsz = Math.max(10, h * 0.035 * (m.w / 4));
        const px = m.t === "text" ? X(m.p[0]) : X(m.p[m.p.length - 2]) + 10;
        const py = m.t === "text" ? Y(m.p[1]) + m.s.split(/\n/).length * tsz * 1.2 + 4 : Y(m.p[m.p.length - 1]) + 6;
        this.tag(ctx, m.n, px, py, m.c, Math.min(1, (2500 - (now - n.at)) / 500));
      }
      // pointers (Zoom's spotlight / arrow): a dot with the name, gone a moment after it stops moving
      for (const [by, q] of s.ptrs) {
        const age = now - q.at;
        if (q.x < 0 || age > 2500) {
          s.ptrs.delete(by);
          continue;
        }
        const a = Math.min(1, (2500 - age) / 600);
        ctx.globalAlpha = a;
        ctx.fillStyle = "rgba(239,68,68,.35)";
        ctx.beginPath();
        ctx.arc(X(q.x), Y(q.y), 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ef4444";
        ctx.beginPath();
        ctx.arc(X(q.x), Y(q.y), 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        if (by !== this.o.myId()) this.tag(ctx, q.n, X(q.x) + 14, Y(q.y) + 8, "#ef4444", a);
      }
    }
    ctx.restore();
  }

  tag(ctx, text, x, y, color, alpha) {
    if (!text) return;
    ctx.globalAlpha = alpha;
    ctx.font = "600 13px system-ui, sans-serif";
    const w = ctx.measureText(text).width + 12;
    ctx.fillStyle = "rgba(17,24,39,.85)";
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, w, 20, 6) : ctx.rect(x, y, w, 20);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + 6, y + 10.5);
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = color;
    ctx.fillRect(x, y + 4, 3, 12);
    ctx.globalAlpha = 1;
  }

  // for a recording: draws the marks over a shared screen drawn at (x, y, w, h)
  overlay(tileId) {
    const sid = tileId === "me" ? this.o.myId() : tileId;
    return this.shares.has(sid) ? (ctx, x, y, w, h) => this.paint(ctx, sid, x, y, w, h) : null;
  }

  // ---------- my input ----------
  open(sid) {
    if (!this.canDraw(sid)) return;
    if (this.active) this.close();
    const e = this.tiles.get(sid);
    if (!e) return;
    this.active = sid;
    e.tile.classList.add("annotating");
    if (!e.tile.classList.contains("spot") && !e.tile.classList.contains("main")) this.o.focus(e.tile);
    e.bar = this.toolbar(sid);
    e.tile.append(e.bar);
    this.dirty = true;
  }

  close() {
    const e = this.tiles.get(this.active);
    this.text?.remove();
    this.text = null;
    if (e) {
      e.tile.classList.remove("annotating");
      e.bar?.remove();
      e.bar = null;
    }
    if (this.active && this.tool === "pointer" && this.tiles.has(this.active)) this.o.send({ k: "anp", s: this.active, x: -1, y: -1 });
    this.active = null;
  }

  toolbar(sid) {
    const t = this.t;
    const bar = h("div", { class: "anBar", onpointerdown: (e) => e.stopPropagation(), ondblclick: (e) => e.stopPropagation() });
    const tools = [
      ["pen", t("Pen")],
      ["hl", t("Highlighter")],
      ["fade", t("Vanishing pen (fades after a few seconds)")],
      ["arrow", t("Arrow")],
      ["rect", t("Box")],
      ["text", t("Text")],
      ["pointer", t("Pointer (everyone sees where you point)")],
      ["eraser", t("Eraser")],
    ];
    const paint = () => {
      for (const b of bar.querySelectorAll("[data-tool]")) b.classList.toggle("on", b.dataset.tool === this.tool);
      for (const b of bar.querySelectorAll("[data-color]")) b.classList.toggle("on", b.dataset.color === this.color);
      bar.querySelector('[name="undo"]').disabled = !this.mine.some((m) => m.sid === sid);
      bar.querySelector('[name="redo"]').disabled = !this.redo.some((m) => m.sid === sid);
      this.tiles.get(sid).tile.dataset.tool = this.tool;
    };
    this.paintBar = paint;
    for (const [k, label] of tools)
      bar.append(h("button", { "data-tool": k, title: label, "aria-label": label, html: svg(k), onclick: () => ((this.tool = k), paint()) }));
    bar.append(h("span", { class: "anSep" }));
    for (const c of COLORS)
      bar.append(h("button", { class: "anColor", "data-color": c, title: t("Colour"), "aria-label": t("Colour"), style: `--c:${c}`, onclick: () => ((this.color = c), paint()) }));
    bar.append(h("span", { class: "anSep" }));
    bar.append(h("button", { name: "undo", title: t("Undo (Ctrl+Z)"), "aria-label": t("Undo"), html: svg("undo"), onclick: () => this.undo(sid) }));
    bar.append(h("button", { name: "redo", title: t("Redo (Ctrl+Y)"), "aria-label": t("Redo"), html: svg("redo"), onclick: () => this.redoOne(sid) }));
    bar.append(h("button", { name: "clear", title: t("Clear"), "aria-label": t("Clear"), html: svg("clear"), onclick: (e) => this.clearMenu(sid, e.currentTarget) }));
    bar.append(h("button", { name: "save", title: t("Save a picture (.png)"), "aria-label": t("Save a picture (.png)"), html: svg("save"), onclick: () => this.save(sid) }));
    if (this.isMine(sid)) bar.append(h("button", { name: "opts", title: t("Options"), "aria-label": t("Options"), html: svg("more"), onclick: (e) => this.optsMenu(e.currentTarget) }));
    bar.append(h("button", { name: "close", title: t("Stop drawing (Esc)"), "aria-label": t("Stop drawing (Esc)"), html: svg("close"), onclick: () => this.close() }));
    queueMicrotask(paint);
    return bar;
  }

  menu(anchor, entries) {
    document.querySelector(".anMenu")?.remove();
    const m = h("div", { class: "anMenu", onpointerdown: (e) => e.stopPropagation() });
    for (const [label, fn, checked] of entries) {
      const b = h("button", { text: label, onclick: () => (m.remove(), fn()) });
      if (checked !== undefined) b.setAttribute("aria-checked", checked ? "true" : "false"), b.setAttribute("role", "menuitemcheckbox");
      m.append(b);
    }
    anchor.closest(".anBar").append(m);
    const away = (e) => {
      if (m.contains(e.target)) return;
      m.remove();
      document.removeEventListener("pointerdown", away, true);
    };
    setTimeout(() => document.addEventListener("pointerdown", away, true));
  }

  clearMenu(sid, anchor) {
    const t = this.t;
    const entries = [[t("Clear my drawings"), () => this.clear(sid, true)]];
    if (this.canEraseAll(sid)) entries.push([t("Clear everyone's drawings"), () => this.clear(sid, false)]);
    this.menu(anchor, entries);
  }

  optsMenu(anchor) {
    const t = this.t;
    this.menu(anchor, [
      [t("Let others draw"), () => this.setOpts({ others: !this.opts.others }), this.opts.others],
      [t("Show who drew"), () => this.setOpts({ names: !this.opts.names }), this.opts.names],
    ]);
  }

  setOpts(o) {
    Object.assign(this.opts, o);
    const sid = this.o.myId();
    this.share(sid).opts = { ...this.opts };
    this.o.send({ k: "ano", s: sid, ...this.opts });
    this.o.notify(this.opts.others ? this.t("Others can draw on your screen") : this.t("Only you can draw on your screen"));
  }

  clear(sid, mineOnly) {
    this.apply(sid, this.o.myId(), { k: "anc", s: sid, mine: mineOnly });
    this.o.send({ k: "anc", s: sid, mine: mineOnly });
  }

  undo(sid) {
    for (let i = this.mine.length - 1; i >= 0; i--) {
      const m = this.mine[i];
      if (m.sid !== sid) continue;
      this.mine.splice(i, 1);
      if (!this.share(sid).items.has(m.item.id)) continue; // erased meanwhile
      this.redo.push(m);
      this.apply(sid, this.o.myId(), { k: "and", s: sid, ids: [m.item.id] });
      this.o.send({ k: "and", s: sid, ids: [m.item.id] });
      break;
    }
    this.paintBar?.();
  }

  redoOne(sid) {
    for (let i = this.redo.length - 1; i >= 0; i--) {
      const m = this.redo[i];
      if (m.sid !== sid) continue;
      this.redo.splice(i, 1);
      this.put(sid, m.item);
      break;
    }
    this.paintBar?.();
  }

  // a new or growing mark of mine: kept, drawn, sent
  put(sid, item, done = true) {
    this.apply(sid, this.o.myId(), { k: "ana", s: sid, i: item });
    if (done && !this.mine.some((m) => m.item.id === item.id)) {
      this.mine.push({ sid, item });
      this.redo = this.redo.filter((m) => m.sid !== sid);
    }
    this.o.send({ k: "ana", s: sid, i: item });
    this.paintBar?.();
  }

  key(e) {
    if (!this.active || this.text || e.target.closest?.("input, textarea, select, [contenteditable]")) return;
    if (e.key === "Escape") {
      e.stopImmediatePropagation();
      this.close();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z") && !e.shiftKey) {
      e.preventDefault();
      this.undo(this.active);
    } else if ((e.ctrlKey || e.metaKey) && (e.key === "y" || ((e.key === "z" || e.key === "Z") && e.shiftKey))) {
      e.preventDefault();
      this.redoOne(this.active);
    }
  }

  events(sid, e) {
    const c = e.canvas;
    const pos = (ev) => {
      const f = this.frame(sid);
      const r = c.getBoundingClientRect();
      return [clampN(((ev.clientX - r.left - f.x) / f.w) * 10000), clampN(((ev.clientY - r.top - f.y) / f.h) * 10000), f];
    };
    let cur = null;
    let lastSend = 0;
    let lastPtr = 0;
    c.addEventListener("dblclick", (ev) => ev.stopPropagation());
    c.addEventListener("pointerdown", (ev) => {
      if (this.active !== sid || ev.button > 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      const [x, y] = pos(ev);
      if (this.tool === "text") return this.typeAt(sid, x, y, ev);
      c.setPointerCapture(ev.pointerId);
      if (this.tool === "eraser") {
        cur = { erase: true };
        this.eraseAt(sid, ev);
      } else if (this.tool === "pointer") {
        cur = { ptr: true };
        this.sendPtr(sid, x, y);
      } else {
        cur = { id: rid(), t: this.tool, c: this.color, w: WIDTHS[this.tool], p: [x, y], n: this.o.myName() };
        this.put(sid, cur, false);
      }
    });
    c.addEventListener("pointermove", (ev) => {
      if (this.active !== sid) return;
      const [x, y, f] = pos(ev);
      if (this.tool === "pointer" && (cur?.ptr || ev.pointerType === "mouse")) {
        if (Date.now() - lastPtr > 50) {
          lastPtr = Date.now();
          this.sendPtr(sid, x, y);
        }
        return;
      }
      if (!cur) return;
      if (cur.erase) return this.eraseAt(sid, ev);
      if (cur.ptr) return;
      const p = cur.p;
      if (cur.t === "arrow" || cur.t === "rect") {
        cur.p = [p[0], p[1], x, y];
      } else {
        const dx = ((x - p[p.length - 2]) / 10000) * f.w;
        const dy = ((y - p[p.length - 1]) / 10000) * f.h;
        if (dx * dx + dy * dy < 4 || p.length >= MAXPTS * 2) return;
        p.push(x, y);
      }
      this.apply(sid, this.o.myId(), { k: "ana", s: sid, i: cur });
      if (Date.now() - lastSend > 60) {
        lastSend = Date.now();
        this.o.send({ k: "ana", s: sid, i: cur });
      }
    });
    const end = () => {
      if (cur && !cur.erase && !cur.ptr) this.put(sid, cur);
      cur = null;
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    c.addEventListener("pointerleave", () => {
      if (this.active === sid && this.tool === "pointer") this.sendPtr(sid, -1, -1);
    });
  }

  sendPtr(sid, x, y) {
    this.apply(sid, this.o.myId(), { k: "anp", s: sid, x, y });
    this.o.send({ k: "anp", s: sid, x, y });
  }

  eraseAt(sid, ev) {
    const s = this.share(sid);
    const f = this.frame(sid);
    const r = this.tiles.get(sid).canvas.getBoundingClientRect();
    const px = ev.clientX - r.left;
    const py = ev.clientY - r.top;
    const X = (v) => f.x + (v / 10000) * f.w;
    const Y = (v) => f.y + (v / 10000) * f.h;
    const near = (m) => {
      const p = m.p;
      const tol = 8 + ((m.w / 1000) * f.h) / 2;
      if (m.t === "text") {
        const size = Math.max(10, f.h * 0.035 * (m.w / 4));
        const lines = m.s.split("\n");
        const w = Math.max(...lines.map((l) => l.length)) * size * 0.6;
        return px >= X(p[0]) - 6 && px <= X(p[0]) + w + 6 && py >= Y(p[1]) - 6 && py <= Y(p[1]) + lines.length * size * 1.2 + 6;
      }
      let pts = p;
      if (m.t === "rect") {
        const [a, b, c2, d] = [p[0], p[1], p[p.length - 2], p[p.length - 1]];
        pts = [a, b, c2, b, c2, d, a, d, a, b];
      }
      for (let i = 0; i < pts.length; i += 2) {
        const x1 = X(pts[i]), y1 = Y(pts[i + 1]);
        const x2 = X(pts[Math.min(i + 2, pts.length - 2)]), y2 = Y(pts[Math.min(i + 3, pts.length - 1)]);
        const dx = x2 - x1, dy = y2 - y1;
        const L = dx * dx + dy * dy;
        const k = L ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L)) : 0;
        const ex = x1 + k * dx - px, ey = y1 + k * dy - py;
        if (ex * ex + ey * ey <= tol * tol) return true;
      }
      return false;
    };
    const me = this.o.myId();
    const ids = [...s.items.values()].filter((m) => (m.by === me || this.canEraseAll(sid)) && near(m)).map((m) => m.id);
    if (!ids.length) return;
    this.apply(sid, me, { k: "and", s: sid, ids });
    this.o.send({ k: "and", s: sid, ids });
  }

  typeAt(sid, x, y, ev) {
    const e = this.tiles.get(sid);
    this.text?.remove();
    const r = e.canvas.getBoundingClientRect();
    const f = this.frame(sid);
    const size = Math.max(10, f.h * 0.035);
    const ta = h("textarea", { class: "anText", rows: 1, placeholder: this.t("Type, then Enter"), "aria-label": this.t("Text") });
    ta.style.cssText = `left:${ev.clientX - r.left}px;top:${ev.clientY - r.top}px;font-size:${size}px;color:${this.color}`;
    e.tile.append(ta);
    this.text = ta;
    let done = false;
    const commit = () => {
      if (done) return;
      done = true;
      const s = ta.value.trim();
      ta.remove();
      if (this.text === ta) this.text = null;
      if (s) this.put(sid, { id: rid(), t: "text", c: this.color, w: 4, p: [x, y], s: s.slice(0, 300), n: this.o.myName() });
    };
    ta.onkeydown = (k) => {
      k.stopPropagation();
      if (k.key === "Enter" && !k.shiftKey) {
        k.preventDefault();
        commit();
      } else if (k.key === "Escape") {
        done = true;
        ta.remove();
        this.text = null;
      }
    };
    ta.oninput = () => {
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
    };
    ta.onblur = commit;
    ta.onpointerdown = (k) => k.stopPropagation();
    setTimeout(() => ta.focus());
  }

  // a picture of the shared screen as it is now, with the drawings (at the screen's own size)
  save(sid) {
    const e = this.tiles.get(sid);
    if (!e) return;
    const v = e.tile.querySelector("video");
    const w = v.videoWidth || 1280;
    const hh = v.videoHeight || 720;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = hh;
    const ctx = c.getContext("2d");
    try {
      ctx.drawImage(v, 0, 0, w, hh);
    } catch (_) {}
    this.paint(ctx, sid, 0, 0, w, hh);
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    c.toBlob((b) => {
      if (!b) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = `Juntos screen ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, "image/png");
  }

  // ---------- from the others ----------
  apply(sid, from, m) {
    if (!this.tiles.has(sid) && !this.shares.has(sid)) return; // not (or no longer) sharing
    const s = this.share(sid);
    const isSharer = from === sid;
    if (m.k === "ana") {
      if (!isSharer && !s.opts.others) return; // the sharer turned drawing off for the others
      const i = clean(m.i);
      if (!i) return;
      const old = s.items.get(i.id);
      if (old && old.by !== from) return; // nobody changes someone else's mark
      i.by = from;
      i.at = Date.now();
      if (!old && from !== this.o.myId() && s.opts.names) (s.names ||= new Map()).set(i.id, { at: Date.now() });
      s.items.set(i.id, i);
    } else if (m.k === "and") {
      const all = isSharer || this.o.isHost(from);
      for (const id of (m.ids || []).slice(0, 5000)) {
        const it = s.items.get(id);
        if (it && (all || it.by === from)) s.items.delete(id);
      }
    } else if (m.k === "anc") {
      const all = !m.mine && (isSharer || this.o.isHost(from));
      for (const [id, it] of s.items) if (all || it.by === from) s.items.delete(id);
    } else if (m.k === "ano") {
      if (!isSharer) return;
      s.opts = { others: !!m.others, names: !!m.names };
      const e = this.tiles.get(sid);
      if (e) e.btn.hidden = !this.canDraw(sid);
      if (!s.opts.others && this.active === sid && !this.isMine(sid)) {
        this.close();
        this.o.notify(this.t("{name} turned off drawing on their screen", { name: this.o.name(sid) }));
      }
    } else if (m.k === "anp") {
      if (!isSharer && !s.opts.others) return;
      s.ptrs.set(from, { x: +m.x < 0 ? -1 : clampN(m.x), y: clampN(m.y), at: Date.now(), n: this.o.name(from) });
    }
    this.dirty = true;
  }

  receive(from, m) {
    if (!m || !KINDS.includes(m.k)) return false;
    if (m.k === "ans") {
      const s = this.share(m.s);
      if (m.o && from === m.s) s.opts = { others: !!m.o.others, names: !!m.o.names };
      for (const raw of (m.items || []).slice(0, 2000)) {
        const i = clean(raw);
        if (!i || s.items.has(i.id) || i.t === "fade") continue;
        i.by = typeof raw.by === "string" ? raw.by.slice(0, 40) : from;
        i.at = Date.now();
        s.items.set(i.id, i);
      }
      this.update();
      return true;
    }
    if (typeof m.s !== "string") return true;
    this.apply(m.s, from, m);
    return true;
  }

  // a newcomer: the marks on every screen being shared now (and my options if I'm sharing)
  greet(id) {
    for (const [sid, s] of this.shares) {
      const items = [...s.items.values()].filter((i) => i.t !== "fade").map(({ at, ...i }) => i);
      const mine = this.isMine(sid);
      if (items.length || mine) this.o.sendTo(id, { k: "ans", s: sid, items, ...(mine ? { o: this.opts } : {}) });
    }
  }
}
