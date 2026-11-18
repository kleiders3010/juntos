// Shared whiteboard: strokes in 0..1 coordinates, sent to everyone over the data channels.
// Everyone keeps the whole board, so a newcomer gets it from whoever is there.

export const COLORS = ["#1b1b1f", "#d93025", "#1a73e8", "#188038", "#f9ab00", "#ffffff"];

export class Board {
  constructor(canvas, send) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.send = send; // (msg) => void
    this.strokes = []; // { id, color, width, points: [[x,y],...], erase }
    this.color = COLORS[0];
    this.erase = false;
    this.current = null;
    const down = (e) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const id = Math.random().toString(36).slice(2);
      this.current = { id, color: this.color, width: this.erase ? 0.03 : 0.004, erase: this.erase, points: [this.pos(e)] };
      this.strokes.push(this.current);
      this.lastSent = 0;
    };
    const move = (e) => {
      if (!this.current) return;
      e.preventDefault();
      this.current.points.push(this.pos(e));
      this.draw();
      // live: send the growing stroke every few points
      if (this.current.points.length - this.lastSent >= 4) this.flush();
    };
    const up = () => {
      if (!this.current) return;
      this.flush();
      this.current = null;
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  flush() {
    const s = this.current;
    this.send({ k: "stroke", s: { ...s, points: s.points.map(([x, y]) => [round(x), round(y)]) } });
    this.lastSent = s.points.length;
  }

  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.draw();
  }

  receive(msg) {
    if (msg.k === "stroke") {
      const i = this.strokes.findIndex((s) => s.id === msg.s.id);
      if (i >= 0) this.strokes[i] = msg.s;
      else this.strokes.push(msg.s);
    } else if (msg.k === "clear") {
      this.strokes = [];
    } else if (msg.k === "board") {
      // a newcomer's copy from someone already here: keep strokes from both
      const have = new Set(this.strokes.map((s) => s.id));
      for (const s of msg.strokes) if (!have.has(s.id)) this.strokes.push(s);
    }
    this.draw();
  }

  clear() {
    this.strokes = [];
    this.send({ k: "clear" });
    this.draw();
  }

  undo() {
    const mine = this.strokes.length - 1;
    if (mine < 0) return;
    const s = this.strokes.pop();
    this.send({ k: "unstroke", id: s.id });
    this.draw();
  }

  remove(id) {
    this.strokes = this.strokes.filter((s) => s.id !== id);
    this.draw();
  }

  snapshot() {
    return { k: "board", strokes: this.strokes };
  }

  draw() {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const s of this.strokes) {
      ctx.strokeStyle = s.erase ? "#ffffff" : s.color;
      ctx.lineWidth = s.width * Math.min(w, h) * 1.5;
      ctx.beginPath();
      s.points.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)));
      if (s.points.length === 1) ctx.lineTo(s.points[0][0] * w + 0.1, s.points[0][1] * h);
      ctx.stroke();
    }
  }
}

function round(v) {
  return Math.round(v * 10000) / 10000;
}
