// Adjust video lighting, like Meet's ("Adjust video lighting": brightens you when you look too dark, a dim room or a
// bright window behind you, and follows the light as it changes). Takes the camera track, returns a brightened one.
// Two steps, both plain canvas (no ctx.filter, which Safari lacks): the picture is multiplied (added onto itself with
// "lighter") only as far as its brightest part stays below white, so a face isn't burnt out; what is still missing
// comes from "screen" passes, which lift the dark parts and never clip (a bright window behind you stays as it is).

export const DARK = 85; // average brightness (0-255) below which a picture counts as too dark
const BRIGHT = 110; // what a dark picture is brought up to
const MAX_MUL = 4; // at most 4 times as bright: more only shows the camera's noise
const TOP = 200; // the brightest twentieth of the picture is not pushed above this
const MAX_SCREEN = 2; // screen passes at most

// the average brightness of what a video element shows, and that of its brightest twentieth, from a tiny copy
function brightness(video, probe) {
  const c = probe.getContext("2d", { willReadFrequently: true });
  c.drawImage(video, 0, 0, probe.width, probe.height);
  const d = c.getImageData(0, 0, probe.width, probe.height).data;
  const ys = [];
  let s = 0;
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    ys.push(y);
    s += y;
  }
  ys.sort((a, b) => a - b);
  return { mean: s / ys.length, top: ys[Math.floor(ys.length * 0.95)] };
}
function probeCanvas() {
  const p = document.createElement("canvas");
  p.width = 32;
  p.height = 24;
  return p;
}
function videoOf(track) {
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.srcObject = new MediaStream([track]);
  v.play().catch(() => {});
  return v;
}

// what to do for a measured picture: `mul` times as bright, then `screen` passes (each about doubles the dark parts)
export function plan({ mean, top }) {
  if (mean >= BRIGHT) return { mul: 1, screen: 0 };
  const mul = Math.max(1, Math.min(MAX_MUL, BRIGHT / Math.max(mean, 1), TOP / Math.max(top, 1)));
  // screen passes only when part of the picture was already bright (a window behind you): in a dark room the
  // multiplier alone brings the face up, and screening on top of it would push the face to white
  const screen = top >= TOP ? Math.max(0, Math.min(MAX_SCREEN, Math.log2(BRIGHT / Math.max(mean, 1)))) : 0;
  return { mul, screen };
}

export class Light {
  constructor(cameraTrack) {
    this.camera = cameraTrack;
    this.video = videoOf(cameraTrack);
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d");
    this.probe = probeCanvas();
    this.mul = 1;
    this.screen = 0;
    this.target = { mul: 1, screen: 0 };
    this.seen = null; // the last brightness measured
    this.out = this.canvas.captureStream(24).getVideoTracks()[0];
    this.running = true;
    window.__juntosLight = this; // read by worker/light_test.py
    let lastMeasure = 0;
    let last = -1;
    const frame = () => {
      if (!this.running) return;
      const v = this.video;
      if (v.paused) v.play().catch(() => {});
      if (!this.camera.enabled || v.readyState < 2 || v.currentTime === last) return;
      last = v.currentTime;
      const w = v.videoWidth || 640;
      const h = v.videoHeight || 480;
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
      const now = performance.now();
      if (now - lastMeasure > 400) {
        lastMeasure = now;
        this.seen = brightness(v, this.probe);
        this.target = plan(this.seen);
      }
      // follow the light gently: about two seconds to settle, no flicker
      this.mul += (this.target.mul - this.mul) * 0.06;
      this.screen += (this.target.screen - this.screen) * 0.06;
      const ctx = this.ctx;
      ctx.globalCompositeOperation = "copy";
      ctx.globalAlpha = 1;
      ctx.drawImage(v, 0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      for (let g = this.mul - 1; g > 0.02; g -= 1) {
        ctx.globalAlpha = Math.min(1, g);
        ctx.drawImage(v, 0, 0, w, h);
      }
      ctx.globalCompositeOperation = "screen";
      for (let g = this.screen; g > 0.02; g -= 1) {
        ctx.globalAlpha = Math.min(1, g);
        ctx.drawImage(this.canvas, 0, 0); // the brightened picture screened onto itself
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
    };
    // a worker's timer keeps running in a background tab (requestAnimationFrame stops), like bg.js
    const src = "setInterval(() => postMessage(0), 40)";
    this.ticker = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
    this.ticker.onmessage = frame;
  }

  // how much is being added in all (read by the test)
  get gain() {
    return this.mul - 1 + this.screen;
  }

  get track() {
    return this.out;
  }

  stop() {
    this.running = false;
    this.ticker?.terminate();
    this.out?.stop();
    this.video.srcObject = null;
  }
}

// Like Meet's recommendation: watch the camera while the adjustment is off and call `onDark` once the picture has been
// too dark for 5 seconds in a row. Returns a function that stops watching.
export function watchDark(track, onDark) {
  const v = videoOf(track);
  const probe = probeCanvas();
  let darkFor = 0;
  const timer = setInterval(() => {
    if (!track.enabled || track.readyState !== "live" || v.readyState < 2) return void (darkFor = 0);
    darkFor = brightness(v, probe).mean < DARK ? darkFor + 1 : 0;
    if (darkFor >= 5) {
      stop();
      onDark();
    }
  }, 1000);
  const stop = () => {
    clearInterval(timer);
    v.srcObject = null;
  };
  return stop;
}
