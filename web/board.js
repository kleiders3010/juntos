// Shared whiteboard. Everything is kept in board units (one shared plane, no edges), so a drawing looks
// the same on a tall phone and a wide computer; each person moves and zooms their own view of it.
// Items go to everyone over the data channels; everyone keeps the whole board, so a newcomer gets it
// from whoever is there.
//
// Items: { id, t: "pen", color, size, pts: [[x,y],...] } | { id, t: "rect"|"ellipse"|"arrow", color, size, x1, y1, x2, y2 }
//        | { id, t: "text", color, size, x, y, text }
// Messages: { k: "bitem", it } (new or growing item), { k: "bdel", id }, { k: "bclear" }, { k: "bstate", items }

export const COLORS = ["#1b1b1f", "#d93025", "#1a73e8", "#188038", "#f9ab00"];
export const SIZES = [3, 8, 18]; // pen width in board units; text is 9x that
export const TOOLS = ["pen", "rect", "ellipse", "arrow", "text", "eraser", "hand"];
const PAGE = { w: 960, h: 540 }; // what a fresh board shows: a 16:9 page, centred
const ZMIN = 0.1;
const ZMAX = 8;

export class Board {
  constructor(canvas, send) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.send = send; // (msg) => void
    this.items = [];
    this.mine = []; // ids I made, newest last (undo)
    this.tool = "pen";
    this.color = COLORS[0];
    this.size = 1; // index into SIZES
    this.view = null; // { x, y, z }: the board point at the top-left corner, and the zoom
    this.current = null;
    this.pointers = new Map(); // pointerId -> [x, y] on screen (two fingers: move and zoom)
    this.onview = null; // called when the zoom changes (the zoom label)
    canvas.addEventListener("pointerdown", (e) => this.down(e));
    canvas.addEventListener("pointermove", (e) => this.move(e));
    canvas.addEventListener("pointerup", (e) => this.up(e));
    canvas.addEventListener("pointercancel", (e) => this.up(e, true));
    canvas.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  // ---------- view ----------
  screen(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  toBoard([sx, sy]) {
    const v = this.view;
    return [v.x + sx / v.z, v.y + sy / v.z];
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    if (!this.view) return this.fit(!this.items.length); // first look: everything there is, or the empty page
    // a new size (the board made big, a turned phone): the point in the middle stays in the middle
    if (this.size0) {
      const cx = this.view.x + this.size0[0] / 2 / this.view.z;
      const cy = this.view.y + this.size0[1] / 2 / this.view.z;
      this.view.x = cx - r.width / 2 / this.view.z;
      this.view.y = cy - r.height / 2 / this.view.z;
    }
    this.size0 = [r.width, r.height];
    this.draw();
  }

  /** Show everything on the board (or the empty page). */
  fit(pageOnly) {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    let b = { x1: 0, y1: 0, x2: PAGE.w, y2: PAGE.h };
    if (!pageOnly && this.items.length) {
      b = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
      for (const it of this.items) {
        const k = bounds(it);
        b.x1 = Math.min(b.x1, k.x1);
        b.y1 = Math.min(b.y1, k.y1);
        b.x2 = Math.max(b.x2, k.x2);
        b.y2 = Math.max(b.y2, k.y2);
      }
      const pad = Math.max(40, (b.x2 - b.x1) * 0.06);
      b = { x1: b.x1 - pad, y1: b.y1 - pad, x2: b.x2 + pad, y2: b.y2 + pad };
    }
    const z = clamp(Math.min(r.width / (b.x2 - b.x1), r.height / (b.y2 - b.y1)), ZMIN, ZMAX);
    this.view = { z, x: (b.x1 + b.x2) / 2 - r.width / 2 / z, y: (b.y1 + b.y2) / 2 - r.height / 2 / z };
    this.size0 = [r.width, r.height];
    this.changed();
  }

  /** Zoom by a factor around a screen point (default: the middle). */
  zoom(f, at) {
    const r = this.canvas.getBoundingClientRect();
    const [sx, sy] = at || [r.width / 2, r.height / 2];
    const [bx, by] = this.toBoard([sx, sy]);
    const z = clamp(this.view.z * f, ZMIN, ZMAX);
    this.view = { z, x: bx - sx / z, y: by - sy / z };
    this.changed();
  }

  pan(dx, dy) {
    this.view.x -= dx / this.view.z;
    this.view.y -= dy / this.view.z;
    this.draw();
  }

  changed() {
    this.draw();
    this.onview?.(this.view.z);
  }

  wheel(e) {
    e.preventDefault();
    if (!this.view) return;
    // pinch on a touchpad and Ctrl + wheel zoom; the plain wheel (or two fingers on a touchpad) moves
    if (e.ctrlKey || e.metaKey) this.zoom(Math.exp(-e.deltaY * 0.01), this.screen(e));
    else this.pan(-e.deltaX, -e.deltaY);
  }

  // ---------- drawing ----------
  down(e) {
    if (!this.view) return;
    e.preventDefault();
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch (_) {}
    this.pointers.set(e.pointerId, this.screen(e));
    if (this.pointers.size === 2) {
      // a second finger: this is a move/zoom, not a drawing
      this.cancelCurrent();
      this.pinch = this.pinchState();
      return;
    }
    if (this.pointers.size > 2) return;
    const p = this.toBoard(this.screen(e)).map(r1); // kept as sent: everyone holds the same numbers
    const panning = this.tool === "hand" || e.button === 1 || e.button === 2 || this.space;
    if (panning) {
      this.panFrom = this.screen(e);
      this.canvas.classList.add("panning");
      return;
    }
    if (this.tool === "eraser") {
      this.erasing = true;
      this.eraseAt(p);
      return;
    }
    if (this.tool === "text") return; // placed on release (a tap)
    const id = Math.random().toString(36).slice(2, 10);
    const base = { id, color: this.color, size: SIZES[this.size] };
    this.current = this.tool === "pen" ? { ...base, t: "pen", pts: [p] } : { ...base, t: this.tool, x1: p[0], y1: p[1], x2: p[0], y2: p[1] };
    this.items.push(this.current);
    this.lastSent = 0;
    this.draw();
  }

  move(e) {
    if (!this.pointers.has(e.pointerId)) return;
    e.preventDefault();
    const s = this.screen(e);
    this.pointers.set(e.pointerId, s);
    if (this.pinch) {
      const now = this.pinchState();
      const [bx, by] = this.toBoard(this.pinch.mid);
      const z = clamp(this.view.z * (now.dist / this.pinch.dist), ZMIN, ZMAX);
      // the board point that was under the fingers stays under them
      this.view = { z, x: bx - now.mid[0] / z, y: by - now.mid[1] / z };
      this.pinch = now;
      this.changed();
      return;
    }
    if (this.panFrom) {
      this.pan(s[0] - this.panFrom[0], s[1] - this.panFrom[1]);
      this.panFrom = s;
      return;
    }
    const p = this.toBoard(s).map(r1);
    if (this.erasing) return this.eraseAt(p);
    const c = this.current;
    if (!c) return;
    if (c.t === "pen") c.pts.push(p);
    else {
      c.x2 = p[0];
      c.y2 = p[1];
    }
    this.draw();
    // live: the others see it grow
    if (c.t !== "pen" || c.pts.length - this.lastSent >= 4) this.flush();
  }

  up(e, cancelled) {
    if (!this.pointers.has(e.pointerId)) return;
    const s = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      return;
    }
    this.canvas.classList.remove("panning");
    if (this.panFrom) {
      this.panFrom = null;
      return;
    }
    this.erasing = false;
    if (this.tool === "text" && !cancelled) return this.placeText(this.toBoard(s).map(r1), s);
    const c = this.current;
    if (!c) return;
    this.current = null;
    // a tap with a shape tool makes nothing
    if (c.t !== "pen" && Math.hypot(c.x2 - c.x1, c.y2 - c.y1) * this.view.z < 4) {
      this.items = this.items.filter((x) => x !== c);
      this.draw();
      return;
    }
    this.mine.push(c.id);
    this.flush(c);
  }

  pinchState() {
    const [a, b] = [...this.pointers.values()];
    return { mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], dist: Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1])) };
  }

  cancelCurrent() {
    const c = this.current;
    this.current = null;
    this.erasing = false;
    if (!c) return;
    this.items = this.items.filter((x) => x !== c);
    if (this.lastSent) this.send({ k: "bdel", id: c.id });
    this.draw();
  }

  flush(c = this.current) {
    if (!c) return;
    this.send({ k: "bitem", it: c.t === "pen" ? { ...c, pts: [...c.pts] } : { ...c } });
    this.lastSent = c.t === "pen" ? c.pts.length : 1;
  }

  // Text: a box where the tap was; Enter or tapping away puts it on the board, Esc drops it.
  placeText(p, s) {
    this.textBox?.commit();
    const size = SIZES[this.size] * 9;
    const input = document.createElement("input");
    input.className = "boardText";
    input.style.left = `${s[0]}px`;
    input.style.top = `${s[1]}px`;
    input.style.color = this.color;
    input.style.fontSize = `${Math.max(12, size * this.view.z)}px`;
    input.setAttribute("enterkeyhint", "done");
    const color = this.color;
    let done = false;
    const commit = () => {
      if (done) return;
      done = true;
      input.remove();
      this.textBox = null;
      const text = input.value.trim();
      if (!text) return;
      const it = { id: Math.random().toString(36).slice(2, 10), t: "text", color, size, x: p[0], y: p[1], text: text.slice(0, 500) };
      this.items.push(it);
      this.mine.push(it.id);
      this.send({ k: "bitem", it });
      this.draw();
    };
    input.onkeydown = (e) => {
      if (e.key === "Enter") commit();
      if (e.key === "Escape") {
        input.value = "";
        commit();
      }
      e.stopPropagation();
    };
    input.onblur = commit;
    this.canvas.parentElement.append(input);
    this.textBox = { commit };
    setTimeout(() => input.focus());
  }

  eraseAt(p) {
    const r = 10 / this.view.z;
    const hit = this.items.filter((it) => near(it, p, r, this.ctx));
    if (!hit.length) return;
    const gone = new Set(hit.map((it) => it.id));
    this.items = this.items.filter((it) => !gone.has(it.id));
    for (const id of gone) this.send({ k: "bdel", id });
    this.draw();
  }

  // ---------- shared ----------
  // Everything received is cleaned to the shapes the board draws, the board holds at most MAX_ITEMS, an item is
  // changed only by whoever made it, and a host can bring back what someone else cleared (safety round 3, N8)
  receive(msg, from = "") {
    if (msg.k === "bitem") {
      const it = cleanItem(msg.it);
      if (!it) return;
      it.by = from;
      const i = this.items.findIndex((s) => s.id === it.id);
      if (i >= 0) {
        if (this.items[i].by !== from) return;
        this.items[i] = it;
      } else if (this.items.length < MAX_ITEMS) this.items.push(it);
    } else if (msg.k === "bdel") {
      this.items = this.items.filter((s) => s.id !== msg.id);
    } else if (msg.k === "bclear") {
      if (this.items.length && !(this.isHost && this.isHost(from))) this.wiped = this.items;
      this.items = [];
    } else if (msg.k === "bstate") {
      // a newcomer's copy from someone already here: keep items from both
      const have = new Set(this.items.map((s) => s.id));
      for (const s of (Array.isArray(msg.items) ? msg.items : []).slice(0, MAX_ITEMS)) {
        const it = cleanItem(s);
        if (it && !have.has(it.id) && this.items.length < MAX_ITEMS) {
          it.by = from;
          this.items.push(it);
          have.add(it.id);
        }
      }
    }
    this.draw();
  }

  clear() {
    this.items = [];
    this.mine = [];
    this.send({ k: "bclear" });
    this.draw();
  }

  /** Take back my last item (not someone else's). */
  undo() {
    // a host first brings back a board someone else cleared, for everyone
    if (this.wiped && this.amHost && this.amHost()) {
      const back = this.wiped;
      this.wiped = null;
      const have = new Set(this.items.map((s) => s.id));
      this.items.push(...back.filter((s) => !have.has(s.id)));
      this.send({ k: "bstate", items: back });
      return this.draw();
    }
    while (this.mine.length) {
      const id = this.mine.pop();
      if (!this.items.some((s) => s.id === id)) continue;
      this.items = this.items.filter((s) => s.id !== id);
      this.send({ k: "bdel", id });
      this.draw();
      return;
    }
  }

  snapshot() {
    return { k: "bstate", items: this.items };
  }

  draw() {
    const { ctx, canvas, view } = this;
    if (!view) return;
    const dpr = canvas.width / Math.max(1, canvas.getBoundingClientRect().width);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const z = view.z * dpr;
    // dots every 40 units (every 200 when far out): you can see the board move
    const step = view.z < 0.35 ? 200 : 40;
    if (step * z >= 10) {
      ctx.fillStyle = "#d1d5db";
      const x0 = Math.floor(view.x / step) * step;
      const y0 = Math.floor(view.y / step) * step;
      const s = Math.max(1, 1.2 * dpr);
      for (let x = x0; (x - view.x) * z < canvas.width; x += step)
        for (let y = y0; (y - view.y) * z < canvas.height; y += step) ctx.fillRect((x - view.x) * z - s / 2, (y - view.y) * z - s / 2, s, s);
    }
    ctx.setTransform(z, 0, 0, z, -view.x * z, -view.y * z);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const it of this.items) paint(ctx, it);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}

const TYPES = new Set(["pen", "rect", "ellipse", "arrow", "text"]);
const MAX_ITEMS = 3000;
const num = (v) => (Number.isFinite(+v) ? Math.max(-1e6, Math.min(1e6, +v)) : 0);

// an item as received: only the fields its kind draws with, numbers in range, short text
function cleanItem(i) {
  if (!i || typeof i !== "object" || typeof i.id !== "string" || !i.id || i.id.length > 40 || !TYPES.has(i.t)) return null;
  const it = { id: i.id, t: i.t, color: COLORS.includes(i.color) ? i.color : COLORS[0], size: Math.max(1, Math.min(SIZES[SIZES.length - 1] * 9, num(i.size) || 1)) };
  if (i.t === "pen") {
    const pts = Array.isArray(i.pts) ? i.pts.slice(0, 5000).filter((p) => Array.isArray(p)).map((p) => [num(p[0]), num(p[1])]) : [];
    if (!pts.length) return null;
    it.pts = pts;
  } else if (i.t === "text") {
    Object.assign(it, { x: num(i.x), y: num(i.y), text: String(i.text ?? "").slice(0, 500) });
  } else Object.assign(it, { x1: num(i.x1), y1: num(i.y1), x2: num(i.x2), y2: num(i.y2) });
  return it;
}

function paint(ctx, it) {
  ctx.strokeStyle = ctx.fillStyle = it.color;
  ctx.lineWidth = it.size;
  if (it.t === "pen") {
    const p = it.pts || [];
    if (!p.length) return;
    ctx.beginPath();
    p.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (p.length === 1) ctx.lineTo(p[0][0] + 0.1, p[0][1]);
    ctx.stroke();
  } else if (it.t === "rect") {
    ctx.strokeRect(Math.min(it.x1, it.x2), Math.min(it.y1, it.y2), Math.abs(it.x2 - it.x1), Math.abs(it.y2 - it.y1));
  } else if (it.t === "ellipse") {
    ctx.beginPath();
    ctx.ellipse((it.x1 + it.x2) / 2, (it.y1 + it.y2) / 2, Math.abs(it.x2 - it.x1) / 2, Math.abs(it.y2 - it.y1) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (it.t === "arrow") {
    const a = Math.atan2(it.y2 - it.y1, it.x2 - it.x1);
    const head = Math.max(14, it.size * 4);
    ctx.beginPath();
    ctx.moveTo(it.x1, it.y1);
    ctx.lineTo(it.x2, it.y2);
    ctx.moveTo(it.x2 - head * Math.cos(a - 0.45), it.y2 - head * Math.sin(a - 0.45));
    ctx.lineTo(it.x2, it.y2);
    ctx.lineTo(it.x2 - head * Math.cos(a + 0.45), it.y2 - head * Math.sin(a + 0.45));
    ctx.stroke();
  } else if (it.t === "text") {
    ctx.font = `${it.size}px system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    ctx.fillText(String(it.text || ""), it.x, it.y);
    ctx.textBaseline = "alphabetic";
  }
}

function bounds(it) {
  if (it.t === "pen") {
    const xs = it.pts.map((p) => p[0]);
    const ys = it.pts.map((p) => p[1]);
    return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
  }
  if (it.t === "text") return { x1: it.x, y1: it.y - it.size / 2, x2: it.x + it.size * 0.55 * String(it.text).length, y2: it.y + it.size / 2 };
  return { x1: Math.min(it.x1, it.x2), y1: Math.min(it.y1, it.y2), x2: Math.max(it.x1, it.x2), y2: Math.max(it.y1, it.y2) };
}

// Is board point p within r of what the item draws? (the eraser)
function near(it, p, r, ctx) {
  const reach = r + it.size / 2;
  if (it.t === "pen") {
    const pts = it.pts;
    if (pts.length === 1) return Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) <= reach;
    for (let i = 1; i < pts.length; i++) if (segDist(p, pts[i - 1], pts[i]) <= reach) return true;
    return false;
  }
  if (it.t === "text") {
    ctx.font = `${it.size}px system-ui, sans-serif`;
    const w = ctx.measureText(String(it.text)).width;
    return p[0] >= it.x - r && p[0] <= it.x + w + r && Math.abs(p[1] - it.y) <= it.size / 2 + r;
  }
  if (it.t === "arrow") return segDist(p, [it.x1, it.y1], [it.x2, it.y2]) <= reach;
  const b = bounds(it);
  if (it.t === "rect") {
    const edges = [[[b.x1, b.y1], [b.x2, b.y1]], [[b.x2, b.y1], [b.x2, b.y2]], [[b.x2, b.y2], [b.x1, b.y2]], [[b.x1, b.y2], [b.x1, b.y1]]];
    return edges.some(([a, c]) => segDist(p, a, c) <= reach);
  }
  // ellipse: how far from the outline, measured along the radius
  const cx = (b.x1 + b.x2) / 2;
  const cy = (b.y1 + b.y2) / 2;
  const rx = Math.max(1, (b.x2 - b.x1) / 2);
  const ry = Math.max(1, (b.y2 - b.y1) / 2);
  const k = Math.hypot((p[0] - cx) / rx, (p[1] - cy) / ry);
  return Math.abs(k - 1) * Math.min(rx, ry) <= reach;
}

function segDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = dx * dx + dy * dy;
  const t = l ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l, 0, 1) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function r1(v) {
  return Math.round(v * 10) / 10;
}
