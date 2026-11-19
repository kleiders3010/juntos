// Adjust video lighting, like Meet's ("Adjust video lighting": brightens you when you look too dark, a dim room or a
// bright window behind you, and follows the light as it changes). Takes the camera track, returns a brightened one.
// The brightening multiplies the picture by up to 4 (the picture added onto itself with "lighter") and works wherever
// a canvas does: no ctx.filter, which Safari lacks.

export const DARK = 85; // average brightness (0-255) below which a picture counts as too dark
const BRIGHT = 110; // what a dark picture is brought up to
const MAX_GAIN = 3; // at most 4 times as bright: more only shows the camera's noise

// the average brightness of what a video element shows, read from a tiny copy
function brightness(video, probe) {
  const c = probe.getContext("2d", { willReadFrequently: true });
  c.drawImage(video, 0, 0, probe.width, probe.height);
  const d = c.getImageData(0, 0, probe.width, probe.height).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return s / (d.length / 4);
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

// how much to add for a measured brightness
// (the extra on top of the picture itself: 1 = twice as bright)
export function gainFor(m) {
  return Math.max(0, Math.min(MAX_GAIN, BRIGHT / Math.max(m, 1) - 1));
}

export class Light {
  constructor(cameraTrack) {
    this.camera = cameraTrack;
    this.video = videoOf(cameraTrack);
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d");
    this.probe = probeCanvas();
    this.gain = 0;
    this.target = 0;
    this.seen = -1; // the last brightness measured
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
        this.target = gainFor(this.seen);
      }
      // follow the light gently: about two seconds to settle, no flicker
      this.gain += (this.target - this.gain) * 0.06;
      const ctx = this.ctx;
      ctx.globalCompositeOperation = "copy";
      ctx.globalAlpha = 1;
      ctx.drawImage(v, 0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      for (let g = this.gain; g > 0.02; g -= 1) {
        ctx.globalAlpha = Math.min(1, g);
        ctx.drawImage(v, 0, 0, w, h);
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
    };
    // a worker's timer keeps running in a background tab (requestAnimationFrame stops), like bg.js
    const src = "setInterval(() => postMessage(0), 40)";
    this.ticker = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
    this.ticker.onmessage = frame;
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
    darkFor = brightness(v, probe) < DARK ? darkFor + 1 : 0;
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
