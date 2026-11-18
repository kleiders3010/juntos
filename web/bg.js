// Background blur / replacement, on this device only (MediaPipe selfie segmentation, Apache-2.0).
// Takes the camera track, returns a processed track drawn on a canvas.

let segmenterPromise = null;

async function segmenter() {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      const { FilesetResolver, ImageSegmenter } = await import("./vendor/mediapipe/vision_bundle.mjs");
      const files = await FilesetResolver.forVisionTasks(new URL("./vendor/mediapipe/wasm", import.meta.url).href);
      return ImageSegmenter.createFromOptions(files, {
        baseOptions: { modelAssetPath: new URL("./vendor/mediapipe/selfie_segmenter.tflite", import.meta.url).href, delegate: "GPU" },
        runningMode: "VIDEO",
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
    })().catch((e) => {
      segmenterPromise = null;
      throw e;
    });
  }
  return segmenterPromise;
}

export const BACKGROUNDS = [
  { id: "none", label: "None" },
  { id: "blur", label: "Blur" },
  { id: "blur-strong", label: "Strong blur" },
  { id: "img:room", label: "Warm", src: "/img/bg-room.jpg" },
  { id: "img:plants", label: "Green", src: "/img/bg-plants.jpg" },
  { id: "img:office", label: "Cool", src: "/img/bg-office.jpg" },
];

/**
 * Wraps a camera track. `set(id)` switches effect (or a custom image via `setImage(file)`).
 * `track` is what goes to the call: the raw camera when the effect is "none".
 */
export class Background {
  constructor(cameraTrack) {
    this.camera = cameraTrack;
    this.mode = "none";
    this.image = null;
    this.video = document.createElement("video");
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = new MediaStream([cameraTrack]);
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d");
    this.small = document.createElement("canvas"); // blur by shrinking (works where ctx.filter doesn't, e.g. Safari)
    this.mask = document.createElement("canvas");
    this.out = null;
    this.running = false;
    this.stats = { ticks: 0, skipped: 0, draws: 0 };
    window.__juntosBg = this; // read by worker/bg_test.py
  }

  get track() {
    return this.mode === "none" ? this.camera : this.out;
  }

  async set(mode) {
    if (mode.startsWith("img:")) {
      const b = BACKGROUNDS.find((x) => x.id === mode);
      if (b) this.image = await loadImage(new URL(b.src, document.baseURI).href);
    }
    this.mode = mode;
    if (mode !== "none") await this.start();
    else this.running = false;
    return this.track;
  }

  async setImage(file) {
    this.image = await loadImage(URL.createObjectURL(file));
    this.mode = "img:custom";
    await this.start();
    return this.track;
  }

  async start() {
    const seg = await segmenter();
    if (this.running) return;
    await this.video.play().catch(() => {});
    for (let i = 0; i < 50 && !this.video.videoWidth; i++) await new Promise((r) => setTimeout(r, 50));
    const w = this.video.videoWidth || 640;
    const h = this.video.videoHeight || 480;
    this.canvas.width = w;
    this.canvas.height = h;
    this.small.width = Math.max(16, Math.round(w / 16));
    this.small.height = Math.max(12, Math.round(h / 16));
    if (!this.out) this.out = this.canvas.captureStream(24).getVideoTracks()[0];
    this.running = true;
    const mctx = this.mask.getContext("2d");
    let maskData = null;
    let last = -1;
    let lastDraw = performance.now();
    let lastMove = performance.now();
    let fails = 0;
    let lastTick = 0;
    const plain = () => this.ctx.drawImage(this.video, 0, 0, w, h); // the camera as it is, no effect
    const frame = (ev) => {
      if (!this.running) return;
      this.stats.ticks++;
      const now = performance.now();
      // Ticks queue up while a frame is being worked on. Old ones are skipped, or a slow device falls
      // further and further behind until the picture looks frozen (and the tab runs out of memory).
      if (performance.timeOrigin + now - ev.data > 30 && now - lastTick < 200) return void this.stats.skipped++;
      lastTick = now;
      if (this.video.currentTime !== last) lastMove = now;
      else if (now - lastMove > 1000) {
        this.video.play().catch(() => {}); // the browser paused the hidden camera video: wake it
        lastMove = now;
      }
      if (this.video.readyState >= 2 && this.video.currentTime !== last) {
        last = this.video.currentTime;
        if (this.broken) {
          plain();
          return;
        }
        try {
          seg.segmentForVideo(this.video, performance.now(), (r) => {
            const m = r.confidenceMasks && r.confidenceMasks[0];
            if (!m) return;
            // the mask has its own size (the model's): keep it, and scale it when drawing
            if (this.mask.width !== m.width || this.mask.height !== m.height || !maskData) {
              this.mask.width = m.width;
              this.mask.height = m.height;
              maskData = mctx.createImageData(m.width, m.height);
            }
            const conf = m.getAsFloat32Array();
            const d = maskData.data;
            for (let i = 0; i < conf.length; i++) d[i * 4 + 3] = Math.min(255, Math.max(0, (conf[i] - 0.25) * 2 * 255));
            mctx.putImageData(maskData, 0, 0);
            this.draw(w, h);
            this.stats.draws++;
            lastDraw = performance.now();
            fails = 0;
          });
        } catch (e) {
          if (++fails === 1) console.error("background", e);
          if (fails >= 25) {
            // the effect keeps failing on this device: send the plain camera rather than a still picture
            this.broken = true;
            this.onBroken?.();
          }
        }
        // nothing drawn for a second (effect stuck): keep the picture moving with the plain camera
        if (performance.now() - lastDraw > 1000) plain();
      }
    };
    // A worker's timer keeps running when the tab is in the background (requestAnimationFrame
    // stops, which would freeze your video for everyone else). It sends the time it fired.
    if (!this.ticker) {
      const src = "setInterval(() => postMessage(performance.timeOrigin + performance.now()), 40)";
      this.ticker = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
    }
    this.ticker.onmessage = frame;
  }

  draw(w, h) {
    const ctx = this.ctx;
    // 1. the background: blurred camera or the chosen image
    if (this.mode.startsWith("blur")) {
      const sc = this.mode === "blur-strong" ? 1 : 2;
      const sw = Math.round(this.small.width * sc);
      const sh = Math.round(this.small.height * sc);
      const sctx = this.small.getContext("2d");
      sctx.drawImage(this.video, 0, 0, sw, sh);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(this.small, 0, 0, sw, sh, 0, 0, w, h);
    } else if (this.image) {
      cover(ctx, this.image, w, h);
    }
    // 2. the person: the camera frame kept only where the mask says "person", drawn on top
    if (!this.person) this.person = document.createElement("canvas");
    const p = this.person;
    if (p.width !== w || p.height !== h) {
      p.width = w;
      p.height = h;
    }
    const pctx = p.getContext("2d");
    pctx.globalCompositeOperation = "copy";
    pctx.drawImage(this.video, 0, 0, w, h);
    pctx.globalCompositeOperation = "destination-in";
    pctx.drawImage(this.mask, 0, 0, w, h);
    ctx.drawImage(p, 0, 0);
  }

  stop() {
    this.running = false;
    if (this.ticker) this.ticker.onmessage = null;
  }
}

function cover(ctx, img, w, h) {
  const r = Math.max(w / img.width, h / img.height);
  const iw = img.width * r;
  const ih = img.height * r;
  ctx.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);
}

function loadImage(src) {
  return new Promise((ok, fail) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = fail;
    i.src = src;
  });
}
