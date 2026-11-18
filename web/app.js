import { Mesh } from "./rtc.js";
import { Background, BACKGROUNDS } from "./bg.js";
import { Board, COLORS } from "./board.js";
import { Recorder } from "./rec.js";
import { t, translatePage } from "./i18n.js";

translatePage();
const t2 = t; // the translator, where "t" is a tile

// ---------- small helpers ----------
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
// The page and its signaling share one host (meet.jurisgames.com); ?signal= points elsewhere for testing.
const SIGNAL = params.get("signal") || (location.protocol === "https:" ? `wss://${location.host}` : "wss://meet.jurisgames.com");
const isPhone = matchMedia("(max-width: 640px)").matches;

const ICON = {
  mic: "M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z",
  micOff: "M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z",
  cam: "M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z",
  camOff: "M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z",
  screen: "M21 3H3c-1.11 0-2 .89-2 2v14c0 1.11.89 2 2 2h18c1.11 0 2-.89 2-2V5c0-1.11-.89-2-2-2zm0 16.02H3V4.98h18v14.04zM10 12H8l4-4 4 4h-2v4h-4v-4z",
  chat: "M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z",
  board: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
  rec: "M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16z",
  end: "M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z",
  more: "M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z",
  people: "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z",
  bg: "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20zm0 2v16a8 8 0 0 1 0-16z",
  flip: "M20 5h-3.17L15 3H9L7.17 5H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-5 11.5V14H9v2.5L5.5 13 9 9.5V12h6V9.5l3.5 3.5-3.5 3.5z",
  gear: "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z",
  full: "M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z",
  fullExit: "M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z",
};
const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[name]}"/></svg>`;

function toast(text) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = text;
  $("toasts").appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

function show(page) {
  for (const p of document.querySelectorAll(".page")) p.hidden = p.id !== page;
}

// Room codes look like "kfa-rmzq-tde": easy to read out loud, nothing to mix up (no l/1/o/0).
function newCode() {
  const abc = "abcdefghijkmnpqrstuvwxyz";
  const r = new Uint8Array(10);
  crypto.getRandomValues(r);
  const s = Array.from(r, (b) => abc[b % abc.length]).join("");
  return `${s.slice(0, 3)}-${s.slice(3, 7)}-${s.slice(7)}`;
}

function codeFrom(text) {
  const t = text.trim().toLowerCase();
  const m = t.match(/([a-z0-9]{3,8}-[a-z0-9]{3,8}-[a-z0-9]{3,8})/) || t.match(/\/r\/([a-z0-9-]{4,64})/);
  if (m) return m[1];
  return /^[a-z0-9-]{4,64}$/.test(t) ? t : null;
}

// ---------- state ----------
const S = {
  code: null,
  mic: true,
  cam: true,
  camStream: null,
  micTrack: null,
  camTrack: null,
  bg: null,
  bgMode: localStorage.getItem("bg") || "none",
  screen: null,
  mesh: null,
  board: null,
  chat: [], // { from, name, text, at }
  hands: new Set(),
  recorder: null,
  panel: null,
  facing: "user",
};

// ---------- routing ----------
function route() {
  const m = location.pathname.match(/^\/r\/([a-z0-9-]{4,64})$/);
  if (m) {
    S.code = m[1];
    openLobby();
  } else {
    show("home");
  }
}
window.addEventListener("popstate", route);

$("start").onclick = () => {
  const code = newCode();
  history.pushState({}, "", `/r/${code}`);
  route();
};
$("joinForm").onsubmit = (e) => {
  e.preventDefault();
  const code = codeFrom($("joinCode").value);
  if (!code) return toast(t("That code doesn't look right"));
  history.pushState({}, "", `/r/${code}`);
  route();
};

// ---------- camera and mic ----------
async function getMedia() {
  if (!navigator.mediaDevices?.getUserMedia) {
    // Some in-app browsers (inside chat apps) can't use the camera at all: you can still watch and listen.
    S.mic = false;
    S.cam = false;
    $("lobbyMsg").textContent = t("This browser can't use your camera or microphone. Open the link in Safari or Chrome.");
    return false;
  }
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(localStorage.getItem("micId")), video: camConstraints(localStorage.getItem("camId")) });
    S.camStream = s;
    S.micTrack = s.getAudioTracks()[0] || null;
    S.camTrack = s.getVideoTracks()[0] || null;
    return true;
  } catch (e) {
    // Try mic only, then nothing: a call without a camera still works.
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      S.camStream = s;
      S.micTrack = s.getAudioTracks()[0];
      S.cam = false;
      $("lobbyMsg").textContent = t("No camera found. You can still talk.");
      return true;
    } catch (_) {
      S.mic = false;
      S.cam = false;
      $("lobbyMsg").textContent = t("Camera and microphone are blocked. Allow them in your browser to be seen and heard.");
      return false;
    }
  }
}

function videoOut() {
  if (!S.cam) return null;
  if (S.screen) return S.screen;
  return (S.bg && S.bg.track) || S.camTrack;
}

async function applyBackground(mode) {
  S.bgMode = mode;
  localStorage.setItem("bg", mode);
  if (!S.camTrack) return;
  if (mode === "none") {
    if (S.bg) await S.bg.set("none"); // back to the live camera (stop() alone left the call on the last drawn picture)
  } else {
    if (!S.bg) S.bg = new Background(S.camTrack);
    S.bg.onBroken = () => toast(t("Backgrounds don't work on this device"));
    try {
      await S.bg.set(mode);
    } catch (e) {
      toast(t("Backgrounds don't work on this device"));
      S.bgMode = "none";
    }
  }
  refreshLocalVideo();
  if (S.mesh) await S.mesh.setTracks(S.mic ? S.micTrack : null, videoOut());
}

function refreshLocalVideo() {
  const t = S.screen || (S.bg && S.bgMode !== "none" ? S.bg.track : S.camTrack);
  const stream = t ? new MediaStream([t]) : null;
  const pv = $("previewVideo");
  if (pv.srcObject?.getVideoTracks()[0] !== t) pv.srcObject = stream;
  $("previewOff").hidden = !!(S.cam && t);
  const self = document.querySelector('.tile[data-id="me"] video');
  if (self && self.srcObject?.getVideoTracks()[0] !== t) self.srcObject = stream;
  const tile = document.querySelector('.tile[data-id="me"]');
  if (tile) {
    tile.classList.toggle("camoff", !(S.cam && t));
    tile.classList.toggle("mirror", !S.screen && S.facing === "user");
  }
}

function setMic(on) {
  S.mic = on;
  if (S.micTrack) S.micTrack.enabled = on;
  paintToggles();
  if (S.mesh) S.mesh.broadcast({ k: "state", mic: on, cam: S.cam });
}

async function setCam(on) {
  S.cam = on;
  if (S.camTrack) S.camTrack.enabled = on;
  refreshLocalVideo();
  paintToggles();
  if (S.mesh) {
    await S.mesh.setTracks(S.micTrack, videoOut());
    S.mesh.broadcast({ k: "state", mic: S.mic, cam: on });
  }
}

function paintToggles() {
  for (const [id, on, a, b] of [
    ["pMic", S.mic, "mic", "micOff"],
    ["pCam", S.cam, "cam", "camOff"],
    ["bMic", S.mic, "mic", "micOff"],
    ["bCam", S.cam, "cam", "camOff"],
  ]) {
    const el = $(id);
    if (!el) continue;
    el.innerHTML = svg(on ? a : b) + (el.dataset.label ? `<span>${el.dataset.label}</span>` : "");
    el.classList.toggle("danger", !on);
    el.title = on ? t("Turn off") : t("Turn on");
  }
  const meTile = document.querySelector('.tile[data-id="me"]');
  if (meTile) meTile.classList.toggle("muted", !S.mic);
}

// ---------- lobby ----------
async function openLobby() {
  show("lobby");
  $("name").value = localStorage.getItem("name") || "";
  $("pBg").innerHTML = svg("bg");
  $("pDev").innerHTML = svg("gear");
  if (!S.camStream) await (S.mediaReady ||= getMedia());
  refreshLocalVideo();
  paintToggles();
  if (S.bgMode !== "none" && S.camTrack) applyBackground(S.bgMode);
  ($("name").value ? $("enter") : $("name")).focus();
}
$("pMic").onclick = () => setMic(!S.mic);
$("pCam").onclick = () => setCam(!S.cam);
$("pBg").onclick = () => {
  const order = ["none", "blur", "blur-strong", ...BACKGROUNDS.filter((b) => b.src).map((b) => b.id)];
  const next = order[(order.indexOf(S.bgMode) + 1) % order.length];
  applyBackground(next);
  toast(t("Background: {name}", { name: t((BACKGROUNDS.find((b) => b.id === next) || { label: next }).label) }));
};
$("pDev").onclick = openDevices;
$("name").addEventListener("keydown", (e) => e.key === "Enter" && $("enter").click());
$("enter").onclick = async () => {
  const name = $("name").value.trim();
  if (!name) {
    $("name").focus();
    $("lobbyMsg").textContent = t("Type your name so people know who you are.");
    return;
  }
  localStorage.setItem("name", name);
  if (typeof RTCPeerConnection === "undefined") {
    $("lobbyMsg").textContent = t("This browser can't make video calls. Open the link in Safari or Chrome.");
    return;
  }
  // Joining before the camera and mic are ready would send nothing to the others.
  $("enter").disabled = true;
  askNotices();
  await (S.mediaReady ||= getMedia());
  $("enter").disabled = false;
  enterCall(name);
};

// ---------- the call ----------
function enterCall(name) {
  show("call");
  $("roomCode").textContent = S.code;
  buildBar();
  buildGrid();
  S.mesh = new Mesh({ room: S.code, name, signalUrl: SIGNAL });
  const mesh = S.mesh;
  mesh.setTracks(S.mic ? S.micTrack : S.micTrack, videoOut());
  if (S.micTrack) S.micTrack.enabled = S.mic;
  mesh.addEventListener("peer", (e) => renderPeer(e.detail.id));
  mesh.addEventListener("left", (e) => {
    document.querySelector(`.tile[data-id="${e.detail.id}"]`)?.remove();
    S.hands.delete(e.detail.id);
    if (!document.querySelector(".tile.spot")) $("grid").classList.remove("hasSpot");
    if (S.recBy?.delete(e.detail.id)) paintRec();
    layout();
    paintNet();
    if (e.detail.name) toast(t("{name} left", { name: e.detail.name }));
    renderPeople();
  });
  mesh.addEventListener("someone-joining", (e) => toast(t("{name} joined", { name: e.detail.name || t("Someone") })));
  mesh.addEventListener("full", (e) => toast(t("This call is full ({max} people)", { max: e.detail.max })));
  S.net = "connecting";
  S.joined = false;
  mesh.addEventListener("joined", () => {
    S.joined = true;
    paintNet();
  });
  mesh.addEventListener("signal-open", () => {
    S.net = "open";
    paintNet();
  });
  mesh.addEventListener("signal-lost", () => {
    S.net = "lost";
    paintNet();
  });
  addEventListener("offline", paintNet);
  addEventListener("online", paintNet);
  paintNet();
  mesh.addEventListener("channel-open", (e) => {
    // catch the newcomer up: board, chat, how I am
    mesh.sendTo(e.detail.id, { k: "state", mic: S.mic, cam: S.cam, hand: S.hands.has("me") });
    if (S.board && S.board.strokes.length) mesh.sendTo(e.detail.id, S.board.snapshot());
    if (S.chat.length) mesh.sendTo(e.detail.id, { k: "history", chat: S.chat.slice(-200) });
    if (S.recorder) mesh.sendTo(e.detail.id, { k: "rec", on: true });
  });
  mesh.addEventListener("message", (e) => onMessage(e.detail.from, e.detail.msg));
  mesh.connect();
  callControls();
  window.addEventListener("beforeunload", () => mesh.leave());
}

// The line at the top: is the call reachable, and is anyone else here yet?
function paintNet() {
  const el = $("netState");
  if (!el || !S.mesh) return;
  let text = "";
  let cls = "";
  if (!navigator.onLine || S.net === "lost") {
    text = t("No connection. Reconnecting…");
    cls = "bad";
  } else if (!S.joined) text = t("Connecting…");
  else if (!S.mesh.peers.size) text = t("Waiting for others. Invite them with the link.");
  el.hidden = !text;
  el.textContent = text;
  el.className = `netState ${cls}`;
}
$("netState").onclick = () => $("invite").click();

function onMessage(from, m) {
  const p = S.mesh.peers.get(from);
  const who = (p && p.name) || t("Someone");
  if (m.k === "chat") {
    addChat({ from, name: who, text: String(m.text).slice(0, 2000), at: Date.now() });
  } else if (m.k === "history") {
    for (const c of m.chat || []) if (!S.chat.some((x) => x.at === c.at && x.text === c.text)) S.chat.push(c);
    S.chat.sort((a, b) => a.at - b.at);
    renderChat();
  } else if (m.k === "state") {
    const tile = document.querySelector(`.tile[data-id="${from}"]`);
    if (tile) {
      tile.classList.toggle("muted", !m.mic);
      tile.classList.toggle("camoff", !m.cam);
    }
    if (m.hand !== undefined) setHand(from, m.hand, who, true);
  } else if (m.k === "hand") {
    setHand(from, m.on, who);
  } else if (m.k === "react") {
    react(from, m.e);
  } else if (m.k === "rec") {
    S.recBy ||= new Set();
    if (m.on) S.recBy.add(from);
    else S.recBy.delete(from);
    paintRec();
  } else if (["stroke", "clear", "board"].includes(m.k)) {
    ensureBoard().receive(m);
    if (m.k === "stroke" && S.panel !== "board") badge("bBoard");
  } else if (m.k === "unstroke") {
    ensureBoard().remove(m.id);
  }
}

// ---------- grid ----------
function buildGrid() {
  const grid = $("grid");
  grid.innerHTML = "";
  grid.appendChild(makeTile("me", `${localStorage.getItem("name")} ${t("(you)")}`));
  const v = grid.querySelector('.tile[data-id="me"] video');
  v.muted = true;
  refreshLocalVideo();
  paintToggles();
  layout();
}

function makeTile(id, name) {
  const t = document.createElement("div");
  t.className = "tile";
  t.dataset.id = id;
  t.innerHTML = `<video autoplay playsinline></video><div class="avatar"></div><div class="label"><span class="micmark">${svg("micOff")}</span><span class="nm"></span><span class="hand" hidden>✋</span></div><div class="status" hidden></div><button class="fsBtn" title="${t2("Full screen")}">${svg("full")}</button>`;
  t.querySelector(".nm").textContent = name;
  t.querySelector(".avatar").textContent = (name || "?").trim().charAt(0).toUpperCase();
  t.querySelector(".fsBtn").onclick = (e) => {
    e.stopPropagation();
    spotlight(t);
  };
  t.ondblclick = () => spotlight(t);
  return t;
}

// One person fills the screen; the same button (or Esc) brings everyone back.
function spotlight(tile) {
  const on = !tile.classList.contains("spot");
  for (const x of document.querySelectorAll(".tile.spot")) {
    x.classList.remove("spot");
    x.querySelector(".fsBtn").innerHTML = svg("full");
  }
  $("grid").classList.toggle("hasSpot", on);
  if (on) {
    tile.classList.add("spot");
    tile.querySelector(".fsBtn").innerHTML = svg("fullExit");
  }
  layout();
}
addEventListener("keydown", (e) => {
  const s = document.querySelector(".tile.spot");
  if (e.key === "Escape" && s) spotlight(s);
});

// What a tile shows while its connection isn't up: connecting, another route, or a way to try again.
function paintStatus(tile, p) {
  const st = tile.querySelector(".status");
  let text = "";
  if (p.gaveUp) text = t2("Couldn't connect to {name}", { name: p.name || t2("Someone") });
  else if (p.state === "disconnected") text = t2("Reconnecting…");
  else if (p.relaying) text = t2("Trying another way…");
  else if (p.state !== "connected") text = t2("Connecting…");
  st.hidden = !text;
  if (!text) return;
  st.innerHTML = `${p.gaveUp ? "" : '<i class="spin"></i>'}<span></span>`;
  st.querySelector("span").textContent = text;
  if (p.gaveUp) {
    const b = document.createElement("button");
    b.className = "primary";
    b.textContent = t2("Try again");
    b.onclick = (e) => {
      e.stopPropagation();
      S.mesh.retry(p.id);
    };
    st.append(b);
  }
}

function renderPeer(id) {
  const p = S.mesh.peers.get(id);
  if (!p) return;
  let tile = document.querySelector(`.tile[data-id="${id}"]`);
  if (!tile) {
    tile = makeTile(id, p.name || "Joining…");
    $("grid").appendChild(tile);
    layout();
  }
  tile.querySelector(".nm").textContent = p.name || "Joining…";
  tile.querySelector(".avatar").textContent = (p.name || "?").trim().charAt(0).toUpperCase();
  const v = tile.querySelector("video");
  if (v.srcObject !== p.stream && p.stream.getTracks().length) {
    v.srcObject = p.stream;
    if (S.sink) v.setSinkId?.(S.sink).catch(() => {});
    v.play().catch(() => tile.classList.add("tapToPlay"));
    watchVoice(tile, p.stream);
  }
  paintStatus(tile, p);
  paintNet();
  renderPeople();
}

// Who is talking: a soft ring around their tile.
function watchVoice(tile, stream) {
  const tr = stream.getAudioTracks()[0];
  if (!tr) return;
  try {
    const ac = (watchVoice.ac ||= new (window.AudioContext || window.webkitAudioContext)());
    const src = ac.createMediaStreamSource(new MediaStream([tr]));
    const an = ac.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    const buf = new Uint8Array(an.fftSize);
    const tick = () => {
      if (!tile.isConnected) return;
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const b of buf) sum += (b - 128) ** 2;
      tile.classList.toggle("speaking", Math.sqrt(sum / buf.length) > 6);
      setTimeout(tick, 150);
    };
    tick();
  } catch (_) {}
}

function layout() {
  const n = $("grid").children.length;
  const wide = innerWidth > innerHeight;
  const cols = n <= 1 ? 1 : n <= 2 ? (wide ? 2 : 1) : n <= 4 ? 2 : n <= 9 ? 3 : 4;
  $("grid").style.setProperty("--cols", cols);
  let i = 0;
  for (const tile of $("grid").children) if (!tile.classList.contains("spot")) tile.style.setProperty("--i", i++);
}
addEventListener("resize", layout);
document.addEventListener("click", (e) => {
  const t = e.target.closest(".tile.tapToPlay");
  if (t) {
    t.querySelector("video").play();
    t.classList.remove("tapToPlay");
  }
});

// ---------- the bar ----------
function button(id, icon, label, onclick, cls = "") {
  const b = document.createElement("button");
  b.id = id;
  b.className = `round ${cls}`;
  label = t(label);
  b.dataset.label = label;
  b.innerHTML = svg(icon) + `<span>${label}</span>`;
  b.title = label;
  b.onclick = onclick;
  return b;
}

function buildBar() {
  const bar = $("bar");
  bar.innerHTML = "";
  bar.append(button("bMic", "mic", "Mic", () => setMic(!S.mic)));
  bar.append(button("bCam", "cam", "Camera", () => setCam(!S.cam)));
  const extra = [];
  if (navigator.mediaDevices?.getDisplayMedia && !isPhone) extra.push(button("bScreen", "screen", "Share screen", toggleScreen));
  extra.push(button("bChat", "chat", "Chat", () => openPanel("chat")));
  extra.push(button("bBoard", "board", "Board", () => openPanel("board")));
  extra.push(button("bBg", "bg", "Background", () => openPanel("bg")));
  extra.push(button("bDev", "gear", "Devices", openDevices));
  extra.push(button("bPeople", "people", "People", () => openPanel("people")));
  if (Recorder.supported()) extra.push(button("bRec", "rec", "Record", toggleRec));
  const react = button("bReact", "more", "React", openReactions);
  react.innerHTML = `<b class="emoji">✋</b><span>${t("Hand / react")}</span>`;
  extra.push(react);
  if (isPhone) {
    bar.append(button("bChat2", "chat", "Chat", () => openPanel("chat")));
    bar.append(button("bMore", "more", "More", () => openMore(extra)));
  } else {
    bar.append(...extra);
  }
  bar.append(button("bLeave", "end", "Leave", leave, "end"));
  paintToggles();
}

function openMore(items) {
  const sheet = document.createElement("div");
  sheet.className = "sheet";
  const inner = document.createElement("div");
  inner.className = "sheetInner";
  for (const it of items) {
    const onclick = it.onclick;
    it.onclick = () => {
      sheet.remove();
      onclick();
    };
    inner.append(it);
  }
  const flip = button("bFlip", "flip", "Switch camera", flipCamera);
  const fo = flip.onclick;
  flip.onclick = () => {
    sheet.remove();
    fo();
  };
  inner.append(flip);
  sheet.append(inner);
  sheet.onclick = (e) => e.target === sheet && sheet.remove();
  document.body.append(sheet);
}

function badge(id) {
  $(id)?.classList.add("badge");
}

// ---------- side panel ----------
function openPanel(which) {
  if (S.panel === which) return closePanel();
  S.panel = which;
  $("panel").hidden = false;
  $("panelTitle").textContent = t({ chat: "Chat", board: "Board", bg: "Background", people: "People" }[which]);
  for (const p of ["chat", "board", "bg", "people"]) $(`${p}Pane`).hidden = p !== which;
  $({ chat: "bChat", board: "bBoard", bg: "bBg", people: "bPeople" }[which])?.classList.remove("badge");
  $("bChat2")?.classList.remove("badge");
  if (which === "chat") {
    renderChat();
    if (!isPhone) $("chatText").focus();
  }
  if (which === "board") ensureBoard().resize();
  if (which === "bg") renderBackgrounds();
  if (which === "people") renderPeople();
}

function closePanel() {
  S.panel = null;
  $("panel").hidden = true;
}
$("panelClose").onclick = closePanel;

// chat
function addChat(c) {
  S.chat.push(c);
  renderChat();
  if (S.panel !== "chat") {
    badge("bChat");
    badge("bChat2");
    if (c.from !== "me") toast(`${c.name}: ${c.text.slice(0, 80)}`);
  }
}
function renderChat() {
  const log = $("chatLog");
  log.innerHTML = "";
  for (const c of S.chat) {
    const d = document.createElement("div");
    d.className = "msg" + (c.from === "me" ? " mine" : "");
    const who = document.createElement("b");
    who.textContent = c.from === "me" ? t("You") : c.name;
    const tm = document.createElement("time");
    tm.textContent = new Date(c.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const tx = document.createElement("p");
    tx.textContent = c.text;
    d.append(who, tm, tx);
    log.append(d);
  }
  log.scrollTop = log.scrollHeight;
}
$("chatForm").onsubmit = (e) => {
  e.preventDefault();
  const text = $("chatText").value.trim();
  if (!text) return;
  $("chatText").value = "";
  const c = { from: "me", name: localStorage.getItem("name"), text, at: Date.now() };
  S.mesh.broadcast({ k: "chat", text });
  addChat(c);
};

// board
function ensureBoard() {
  if (!S.board) {
    S.board = new Board($("boardCanvas"), (m) => S.mesh && S.mesh.broadcast(m));
    const tools = $("boardTools");
    for (const c of COLORS) {
      const b = document.createElement("button");
      b.className = "swatch";
      b.style.background = c;
      b.title = c === "#ffffff" ? t("Eraser") : t("Pen");
      b.onclick = () => {
        S.board.color = c;
        S.board.erase = c === "#ffffff";
        for (const x of tools.querySelectorAll(".swatch")) x.classList.toggle("on", x === b);
      };
      tools.append(b);
    }
    tools.firstChild.classList.add("on");
    const clear = document.createElement("button");
    clear.className = "chip";
    clear.textContent = t("Clear");
    clear.onclick = () => S.board.clear();
    tools.append(clear);
  }
  return S.board;
}

// backgrounds
function renderBackgrounds() {
  const box = $("bgChoices");
  box.innerHTML = "";
  if (!S.camTrack) {
    box.textContent = t("Turn on your camera to pick a background.");
    return;
  }
  for (const b of BACKGROUNDS) {
    const el = document.createElement("button");
    el.className = "bgChoice" + (S.bgMode === b.id ? " on" : "");
    if (b.src) el.style.backgroundImage = `url(${b.src})`;
    el.textContent = b.src ? "" : t(b.label);
    el.title = t(b.label);
    el.onclick = async () => {
      await applyBackground(b.id);
      renderBackgrounds();
    };
    box.append(el);
  }
  const up = document.createElement("button");
  up.className = "bgChoice";
  up.textContent = t("Your picture…");
  up.onclick = () => $("bgFile").click();
  box.append(up);
}
$("bgFile").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f || !S.camTrack) return;
  if (!S.bg) S.bg = new Background(S.camTrack);
  await S.bg.setImage(f);
  S.bgMode = "img:custom";
  refreshLocalVideo();
  await S.mesh.setTracks(S.micTrack, videoOut());
  renderBackgrounds();
};

// people
function renderPeople() {
  const ul = $("peopleList");
  if (!ul || !S.mesh) return;
  ul.innerHTML = "";
  const add = (name, extra) => {
    const li = document.createElement("li");
    li.textContent = name + (extra ? ` ${extra}` : "");
    ul.append(li);
  };
  add(`${localStorage.getItem("name")} ${t("(you)")}`, S.hands.has("me") ? "✋" : "");
  for (const p of S.mesh.peers.values()) add(p.name || t("Joining…"), (S.hands.has(p.id) ? "✋ " : "") + (p.state === "connected" ? "" : t("· connecting")));
  $("bPeople")?.querySelector("span") && ($("bPeople").querySelector("span").textContent = t("People ({n})", { n: S.mesh.peers.size + 1 }));
}

// hand and reactions
function setHand(id, on, who, quiet) {
  if (on) S.hands.add(id);
  else S.hands.delete(id);
  const tile = document.querySelector(`.tile[data-id="${id}"]`);
  if (tile) tile.querySelector(".hand").hidden = !on;
  if (on && !quiet && id !== "me") toast(t("{name} raised a hand", { name: who }));
  renderPeople();
}
function openReactions() {
  const box = $("reactions");
  if (!box.hidden) return (box.hidden = true);
  box.innerHTML = "";
  const hand = document.createElement("button");
  hand.className = "chip";
  hand.textContent = S.hands.has("me") ? t("Lower hand") : t("✋ Raise hand");
  hand.onclick = () => {
    const on = !S.hands.has("me");
    setHand("me", on);
    S.mesh.broadcast({ k: "hand", on });
    box.hidden = true;
  };
  box.append(hand);
  for (const e of ["👍", "❤️", "😂", "👏", "🎉", "😮"]) {
    const b = document.createElement("button");
    b.className = "emojiBtn";
    b.textContent = e;
    b.onclick = () => {
      react("me", e);
      S.mesh.broadcast({ k: "react", e });
      box.hidden = true;
    };
    box.append(b);
  }
  box.hidden = false;
}
function react(id, e) {
  if (!["👍", "❤️", "😂", "👏", "🎉", "😮"].includes(e)) return;
  const tile = document.querySelector(`.tile[data-id="${id}"]`);
  if (!tile) return;
  const f = document.createElement("div");
  f.className = "float";
  f.textContent = e;
  tile.append(f);
  setTimeout(() => f.remove(), 2600);
}

// screen sharing (replaces your camera while it lasts)
async function toggleScreen() {
  if (S.screen) return stopScreen();
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
    S.screen = s.getVideoTracks()[0];
    S.screen.onended = stopScreen;
    $("bScreen")?.classList.add("on");
    refreshLocalVideo();
    await S.mesh.setTracks(S.mic ? S.micTrack : S.micTrack, S.screen);
    toast(t("You're sharing your screen"));
  } catch (_) {}
}
async function stopScreen() {
  if (!S.screen) return;
  S.screen.stop();
  S.screen = null;
  $("bScreen")?.classList.remove("on");
  refreshLocalVideo();
  await S.mesh.setTracks(S.micTrack, videoOut());
}

// ---------- cameras, microphones, speakers ----------
function camConstraints(id) {
  const v = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } };
  return id ? { ...v, deviceId: { ideal: id } } : { ...v, facingMode: S.facing };
}
function micConstraints(id) {
  const a = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  return id ? { ...a, deviceId: { ideal: id } } : a;
}

async function useCamera(video) {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video });
    S.camTrack?.stop();
    S.camTrack = s.getVideoTracks()[0];
    S.camTrack.enabled = S.cam;
    localStorage.setItem("camId", S.camTrack.getSettings().deviceId || "");
    S.facing = S.camTrack.getSettings().facingMode || S.facing;
    if (S.bg) {
      S.bg.stop();
      S.bg = null;
    }
    if (S.bgMode !== "none") await applyBackground(S.bgMode);
    refreshLocalVideo();
    await S.mesh?.setTracks(S.micTrack, videoOut());
    return true;
  } catch (_) {
    toast(t("Couldn't switch camera"));
    return false;
  }
}

async function useMic(id) {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(id) });
    S.micTrack?.stop();
    S.micTrack = s.getAudioTracks()[0];
    S.micTrack.enabled = S.mic;
    localStorage.setItem("micId", S.micTrack.getSettings().deviceId || id);
    await S.mesh?.setTracks(S.micTrack, videoOut());
    return true;
  } catch (_) {
    toast(t("Couldn't switch microphone"));
    return false;
  }
}

// where the others' voices come out (computers and Android; iPhones choose it in the system)
function useSpeaker(id) {
  S.sink = id;
  localStorage.setItem("sinkId", id);
  for (const v of document.querySelectorAll('.tile:not([data-id="me"]) video')) v.setSinkId?.(id).catch(() => {});
}
S.sink = localStorage.getItem("sinkId") || "";

async function flipCamera() {
  S.facing = S.facing === "user" ? "environment" : "user";
  await useCamera({ ...camConstraints(null), facingMode: S.facing });
}

// One sheet for choosing the camera, microphone and speaker, with a live level of the microphone.
async function openDevices() {
  const list = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const sheet = document.createElement("div");
  sheet.className = "sheet";
  const inner = document.createElement("div");
  inner.className = "sheetInner devices";
  const close = () => {
    sheet.remove();
    clearInterval(meterTimer);
  };
  const row = (label, kind, current, pick) => {
    const items = list.filter((d) => d.kind === kind);
    if (!items.length) return;
    const l = document.createElement("label");
    l.className = "devRow";
    l.innerHTML = `<span>${t(label)}</span>`;
    const sel = document.createElement("select");
    items.forEach((d, i) => sel.append(new Option(d.label || `${t(label)} ${i + 1}`, d.deviceId)));
    if (current && items.some((d) => d.deviceId === current)) sel.value = current;
    sel.onchange = () => pick(sel.value);
    l.append(sel);
    inner.append(l);
    return l;
  };
  row("Camera", "videoinput", S.camTrack?.getSettings().deviceId, (id) =>
    useCamera({ ...camConstraints(null), facingMode: undefined, deviceId: { exact: id } }));
  const micRow = row("Microphone", "audioinput", S.micTrack?.getSettings().deviceId, async (id) => {
    await useMic(id);
    startMeter();
  });
  if ("setSinkId" in HTMLMediaElement.prototype) row("Speaker", "audiooutput", S.sink || "default", useSpeaker);
  // the level bar moves when the microphone hears you
  const meter = document.createElement("div");
  meter.className = "meter";
  meter.innerHTML = "<i></i>";
  micRow?.append(meter);
  let meterTimer = null;
  const startMeter = () => {
    clearInterval(meterTimer);
    if (!S.micTrack) return;
    const ac = (openDevices.ac ||= new (window.AudioContext || window.webkitAudioContext)());
    ac.resume?.();
    const an = ac.createAnalyser();
    an.fftSize = 512;
    ac.createMediaStreamSource(new MediaStream([S.micTrack])).connect(an);
    const buf = new Uint8Array(an.fftSize);
    meterTimer = setInterval(() => {
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const b of buf) sum += (b - 128) ** 2;
      meter.firstChild.style.width = `${Math.min(100, Math.sqrt(sum / buf.length) * 4)}%`;
      meter.classList.toggle("off", !S.mic);
    }, 100);
  };
  startMeter();
  if (!list.some((d) => d.label)) {
    const p = document.createElement("p");
    p.className = "small";
    p.textContent = t("Allow the camera and microphone to see their names.");
    inner.append(p);
  }
  const done = document.createElement("button");
  done.className = "primary";
  done.textContent = t("Done");
  done.onclick = close;
  inner.append(done);
  sheet.append(inner);
  sheet.onclick = (e) => e.target === sheet && close();
  document.body.append(sheet);
}

// recording (on this device)
// While recording: the button turns red and says Stop, and a red pill with the time runs at the top
// (tap it to stop). The others see "<name> is recording" in the same place.
function paintRec() {
  const b = $("bRec");
  const mine = !!S.recorder;
  if (b) {
    b.classList.toggle("recording", mine);
    b.querySelector("span").textContent = mine ? t("Stop") : t("Record");
  }
  const others = [...(S.recBy || [])].map((id) => S.mesh?.peers.get(id)?.name).filter(Boolean);
  const dot = $("recDot");
  clearInterval(paintRec.timer);
  dot.hidden = !mine && !others.length;
  dot.classList.toggle("mine", mine);
  if (mine) {
    const tick = () => {
      const s = Math.floor((Date.now() - S.recorder.startedAt) / 1000);
      dot.textContent = `● ${t("REC")} ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    };
    tick();
    paintRec.timer = setInterval(tick, 1000);
  } else if (others.length) dot.textContent = `● ${t("{name} is recording", { name: others.join(", ") })}`;
}
$("recDot").onclick = () => S.recorder && toggleRec();

async function toggleRec() {
  if (S.recorder) {
    const r = S.recorder;
    S.recorder = null;
    paintRec();
    await r.stop();
    S.mesh.broadcast({ k: "rec", on: false });
    toast(t("Recording saved to your downloads"));
    return;
  }
  S.recorder = new Recorder(() =>
    [...document.querySelectorAll(".tile")].map((t) => ({
      video: t.querySelector("video"),
      name: t.querySelector(".nm").textContent,
      stream: t.dataset.id === "me" ? (S.micTrack ? new MediaStream([S.micTrack]) : null) : S.mesh.peers.get(t.dataset.id)?.stream,
    })),
  );
  S.recorder.start();
  paintRec();
  S.mesh.broadcast({ k: "rec", on: true });
}

// invite
$("invite").onclick = async () => {
  const url = `${location.origin}/r/${S.code}`;
  if (navigator.share && isPhone) {
    try {
      await navigator.share({ title: t("Join my call"), text: t("Join my call on Juntos"), url });
      return;
    } catch (_) {}
  }
  try {
    await navigator.clipboard.writeText(url);
    toast(t("Link copied. Send it to anyone."));
  } catch (_) {
    prompt(t("Copy this link:"), url);
  }
};

async function leave() {
  if (S.recorder) await toggleRec();
  S.mesh?.leave();
  S.mesh = null;
  closePanel();
  callNotice(false);
  show("ended");
}

// ---------- "you're in a call" while the app is in the background (phones) ----------
// A quiet notification while you're in another app (tap it to come back), and the phone's call
// controls (mute, camera, hang up) where the system shows them.
const swReady = "serviceWorker" in navigator ? navigator.serviceWorker.register("/sw.js").then(() => navigator.serviceWorker.ready).catch(() => null) : Promise.resolve(null);
async function callNotice(show) {
  const reg = await swReady;
  if (!reg) return;
  for (const n of await reg.getNotifications({ tag: "juntos-call" }).catch(() => [])) n.close();
  if (!show || !S.mesh || typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const n = S.mesh.peers.size;
  reg.showNotification(t("You're in a call"), {
    tag: "juntos-call",
    body: n ? t("With {n} more. Tap to go back.", { n }) : t("Tap to go back."),
    icon: "/img/icon-192.png",
    badge: "/img/icon-192.png",
    silent: true,
    requireInteraction: true,
    data: { url: location.href },
  }).catch(() => {});
}
document.addEventListener("visibilitychange", () => callNotice(document.hidden && !!S.mesh));
function askNotices() {
  // asked once, when joining a call from a phone (the moment it makes sense)
  if (isPhone && typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission().catch(() => {});
}
function callControls() {
  const ms = navigator.mediaSession;
  if (!ms) return;
  try {
    ms.metadata = new MediaMetadata({ title: t("Call on Juntos"), artist: S.code, artwork: [{ src: "/img/icon-512.png", sizes: "512x512", type: "image/png" }] });
    ms.setActionHandler("hangup", () => leave());
    ms.setActionHandler("togglemicrophone", () => setMic(!S.mic));
    ms.setActionHandler("togglecamera", () => setCam(!S.cam));
  } catch (_) {}
}
$("rejoin").onclick = () => enterCall(localStorage.getItem("name"));
$("homeBtn").onclick = () => {
  for (const t of S.camStream?.getTracks() || []) t.stop();
  S.camStream = null;
  S.mediaReady = null;
  S.camTrack = null;
  S.micTrack = null;
  S.bg?.stop();
  S.bg = null;
  history.pushState({}, "", "/");
  route();
};

window.__S = S;
route();

// ---------- install (Chrome / Edge on computers and Android: the browser offers it, we show a button) ----------
let installEvent = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installEvent = e;
  $("install").hidden = false;
});
$("install").onclick = async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice;
  installEvent = null;
  $("install").hidden = true;
};
window.addEventListener("appinstalled", () => ($("install").hidden = true));
