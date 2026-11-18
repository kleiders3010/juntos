import { Mesh, randomId } from "./rtc.js";
import { Background, BACKGROUNDS } from "./bg.js";
import { Board, COLORS, SIZES, TOOLS } from "./board.js";
import { Recorder } from "./rec.js";
import { t, translatePage } from "./i18n.js";
import { Activities } from "./act.js";
import { Breakout } from "./breakout.js";
import { Notes } from "./notes.js";
import { Annotate } from "./annotate.js";
import { scheduleSheet, inviteSheet, paintUpcoming } from "./schedule.js";

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
  vol: "M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z",
  volOff: "M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z",
  pen: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
  rect: "M3 3h18v18H3V3zm2 2v14h14V5H5z",
  ellipse: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16z",
  arrow: "M4 18.6L15.6 7H9V5h10v10h-2V8.4L5.4 20z",
  text: "M5 4v3h5.5v12h3V7H19V4z",
  eraser: "M16.24 3.56l4.95 4.94a2 2 0 0 1 0 2.83L12 20.53A5 5 0 0 1 8.46 22H4.5l-2.12-2.12a2 2 0 0 1 0-2.83L13.4 3.56a2 2 0 0 1 2.84 0zM4.22 15.58l3.54 3.53a3 3 0 0 0 4.24 0l3.53-3.53-4.95-4.95-6.36 6.36z",
  hand: "M23 5.5V20c0 2.2-1.8 4-4 4h-7.3c-1.08 0-2.1-.43-2.85-1.19L1 14.83s1.26-1.23 1.3-1.25c.22-.19.49-.29.79-.29.22 0 .42.06.6.16.04.01 4.31 2.46 4.31 2.46V4c0-.83.67-1.5 1.5-1.5S11 3.17 11 4v7h1V1.5c0-.83.67-1.5 1.5-1.5S15 .67 15 1.5V11h1V2.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5V11h1V5.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5z",
  undo: "M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z",
  poll: "M10 20h4V4h-4v16zm-6 0h4v-8H4v8zM16 9v11h4V9h-4z",
  notes: "M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z",
  rooms: "M6 13c-2.2 0-4 1.8-4 4s1.8 4 4 4 4-1.8 4-4-1.8-4-4-4zm6-10C9.8 3 8 4.8 8 7s1.8 4 4 4 4-1.8 4-4-1.8-4-4-4zm6 10c-2.2 0-4 1.8-4 4s1.8 4 4 4 4-1.8 4-4-1.8-4-4-4z",
  layout: "M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z",
  cc: "M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z",
  pip: "M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z",
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
    paintUpcoming($("upcoming"), schedOpts());
  }
}
window.addEventListener("popstate", route);

$("start").onclick = () => {
  const code = newCode();
  // who starts the call is its host (mute, remove, lock): a secret only this device keeps
  try {
    localStorage.setItem(`juntos.host.${code}`, randomId() + randomId());
  } catch {}
  history.pushState({}, "", `/r/${code}`);
  route();
};
// planned calls: "Schedule for later" and the list of calls planned on this device
const schedOpts = () => ({ t, toast, isPhone, newCode, hostKey: () => randomId() + randomId(), changed: () => paintUpcoming($("upcoming"), schedOpts()) });
$("schedule").onclick = () => scheduleSheet(schedOpts());
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
  S.an?.update();
}

// how I am, for the others (and for their recordings: a shared screen leads the picture)
function myState() {
  return { k: "state", mic: S.mic, cam: S.cam, screen: !!S.screen };
}

function setMic(on) {
  S.mic = on;
  if (S.micTrack) S.micTrack.enabled = on;
  paintToggles();
  if (S.mesh) S.mesh.broadcast(myState());
  capSync();
}

async function setCam(on) {
  S.cam = on;
  if (S.camTrack) S.camTrack.enabled = on;
  refreshLocalVideo();
  paintToggles();
  if (S.mesh) {
    await S.mesh.setTracks(S.micTrack, videoOut());
    S.mesh.broadcast(myState());
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
  lobbyMeter();
}
// the microphone's level in the lobby, so you see it hears you before you go in
function lobbyMeter() {
  clearInterval(lobbyMeter.timer);
  const m = $("pMeter");
  if (!S.micTrack) return (m.parentNode.hidden = true);
  m.parentNode.hidden = false;
  const ac = (openDevices.ac ||= new (window.AudioContext || window.webkitAudioContext)());
  const an = ac.createAnalyser();
  an.fftSize = 512;
  let tr = null;
  const buf = new Uint8Array(an.fftSize);
  lobbyMeter.timer = setInterval(() => {
    if ($("lobby").hidden) {
      clearInterval(lobbyMeter.timer);
      return tr?.stop();
    }
    if (!tr || tr.src !== S.micTrack) {
      tr?.stop();
      tr = micCopy();
      ac.createMediaStreamSource(new MediaStream([tr])).connect(an);
    }
    ac.resume?.();
    an.getByteTimeDomainData(buf);
    let sum = 0;
    for (const b of buf) sum += (b - 128) ** 2;
    m.firstChild.style.width = `${Math.min(100, Math.sqrt(sum / buf.length) * 4)}%`;
    m.classList.toggle("off", !S.mic);
  }, 100);
}
$("pCheck").onclick = openDevices;
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
  S.isHost = false;
  S.locked = false;
  S.waiting = false;
  S.knocks = new Map();
  paintKnocks();
  watchMuted();
  S.mesh = new Mesh({
    room: S.code,
    name,
    signalUrl: SIGNAL,
    key: localStorage.getItem(`juntos.host.${S.code}`),
    knock: !!localStorage.getItem(`juntos.out.${S.code}`),
  });
  const mesh = S.mesh;
  mesh.addEventListener("host", (e) => onHost(e.detail));
  mesh.setTracks(S.mic ? S.micTrack : S.micTrack, videoOut());
  if (S.micTrack) S.micTrack.enabled = S.mic;
  mesh.addEventListener("peer", (e) => renderPeer(e.detail.id));
  mesh.addEventListener("left", (e) => {
    document.querySelector(`.tile[data-id="${e.detail.id}"]`)?.remove();
    S.hands.delete(e.detail.id);
    if (!document.querySelector(".tile.spot")) $("grid").classList.remove("hasSpot");
    if (S.recBy?.delete(e.detail.id)) paintRec();
    if (S.capWant.delete(e.detail.id)) capSync();
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
    mesh.sendTo(e.detail.id, { ...myState(), hand: S.hands.has("me") });
    if (S.board && S.board.items.length) mesh.sendTo(e.detail.id, S.board.snapshot());
    const mainChat = S.chat.filter((c) => !c.room); // a breakout room's chat stays in the room
    if (mainChat.length) mesh.sendTo(e.detail.id, { k: "history", chat: mainChat.slice(-200) });
    if (S.recorder) mesh.sendTo(e.detail.id, { k: "rec", on: true });
    if (S.capsOn) mesh.sendTo(e.detail.id, { k: "capwant", on: true });
    if (S.act.any()) mesh.sendTo(e.detail.id, S.act.snapshotFor(e.detail.id));
    S.br.greet(e.detail.id);
    S.notes.greet(e.detail.id);
    S.an.greet(e.detail.id);
  });
  mesh.addEventListener("message", (e) => onMessage(e.detail.from, e.detail.msg));
  S.br.reset();
  mesh.route = (id) => S.br.same(id);
  mesh.connect();
  capReset();
  S.act.reset(S.code);
  S.notes.reset(S.code);
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
  } else if (S.waiting) text = t("Asking to join. Someone in the call will let you in.");
  else if (!S.joined) text = t("Connecting…");
  else if (!S.mesh.peers.size) text = t("Waiting for others. Invite them with the link.");
  el.hidden = !text;
  el.textContent = text;
  el.className = `netState ${cls}`;
}
$("netState").onclick = () => $("invite").click();

function onMessage(from, m) {
  const p = S.mesh.peers.get(from);
  const who = (p && p.name) || t("Someone");
  // chat, hands, reactions and captions from someone in another breakout room aren't for me
  if (["chat", "hand", "react", "cap", "ana", "and", "anc", "ano", "anp", "ans"].includes(m.k) && !S.br.same(from)) return;
  if (S.br.receive(from, m)) {
    // breakout rooms
  } else if (m.k === "chat") {
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
      tile.classList.toggle("screen", !!m.screen);
      layout();
    }
    if (m.hand !== undefined) setHand(from, m.hand, who, true);
  } else if (m.k === "hand") {
    setHand(from, m.on, who);
  } else if (m.k === "react") {
    react(from, m.e);
  } else if (m.k === "cap") {
    if (S.capsOn) showCap(from, who, String(m.text || "").slice(0, 500), !!m.final);
  } else if (m.k === "capwant") {
    capWanted(from, !!m.on, who);
  } else if (m.k === "capno") {
    if (S.capsOn) showCap(from, who, m.why === "browser" ? t("(their browser can't make captions)") : t("(they turned off captions of their voice)"), true, true);
  } else if (m.k === "rec") {
    S.recBy ||= new Set();
    if (m.on) S.recBy.add(from);
    else S.recBy.delete(from);
    paintRec();
  } else if (S.notes.receive(from, m)) {
    // shared notes
  } else if (S.an.receive(from, m)) {
    // drawing on a shared screen
  } else if (S.act.receive(from, m)) {
    // polls and Q&A
  } else if (["bitem", "bdel", "bclear", "bstate"].includes(m.k)) {
    ensureBoard().receive(m);
    if (m.k === "bitem" && S.panel !== "board") badge("bBoard");
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
  t.innerHTML = `<video autoplay playsinline></video><div class="avatar"></div><div class="label"><span class="micmark">${svg("micOff")}</span><span class="nm"></span><span class="hand" hidden>✋</span></div><div class="status" hidden></div><button class="fsBtn" title="${t2("Full screen")}">${svg("full")}</button>${id === "me" ? "" : `<button class="volBtn" title="${t2("Volume")}"></button>`}`;
  t.querySelector(".nm").textContent = name;
  t.querySelector(".avatar").textContent = (name || "?").trim().charAt(0).toUpperCase();
  t.querySelector(".fsBtn").onclick = (e) => {
    e.stopPropagation();
    spotlight(t);
  };
  t.ondblclick = () => spotlight(t);
  const vb = t.querySelector(".volBtn");
  if (vb)
    vb.onclick = (e) => {
      e.stopPropagation();
      openVolume(t);
    };
  return t;
}

// ---------- how loud each person is (only on this device) ----------
// Up to 100 %: the tile's own volume. Above (to boost a quiet person): the voice goes through a gain and a
// limiter (so it doesn't crackle) and the tile itself goes quiet. Remembered per name on this device.
const VOL_MAX = 300;
function volFor(name) {
  const v = localStorage.getItem(`juntos.vol.${name || ""}`);
  return v === null ? 100 : Math.max(0, Math.min(VOL_MAX, Number(v) || 0));
}

function applyVolume(tile, p) {
  const v = tile.querySelector("video");
  const pct = tile.classList.contains("away") ? 0 : volFor(p.name); // in another breakout room: not heard
  const tr = p.stream.getAudioTracks()[0];
  if (pct > 100 && tr) {
    const ctx = (S.out ||= new (window.AudioContext || window.webkitAudioContext)());
    if (S.sink && ctx.setSinkId) ctx.setSinkId(S.sink).catch(() => {});
    if (!p.boost || p.boost.track !== tr) {
      p.boost?.src.disconnect();
      const src = ctx.createMediaStreamSource(new MediaStream([tr]));
      const gain = ctx.createGain();
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -3;
      lim.knee.value = 0;
      lim.ratio.value = 20;
      lim.attack.value = 0.003;
      lim.release.value = 0.1;
      src.connect(gain).connect(lim).connect(ctx.destination);
      p.boost = { track: tr, src, gain };
    }
    p.boost.gain.gain.value = pct / 100;
    v.volume = 1;
    // the tile goes quiet only once the boosted voice can really play (a page may not make sound yet)
    Promise.resolve(ctx.resume?.()).then(() => {
      if (p.boost) v.muted = ctx.state === "running";
    });
  } else {
    if (p.boost) {
      p.boost.src.disconnect();
      p.boost = null;
    }
    v.muted = false;
    v.volume = pct / 100;
  }
  const b = tile.querySelector(".volBtn");
  if (b) {
    b.innerHTML = svg(pct === 0 ? "volOff" : "vol") + (pct === 100 ? "" : `<span>${pct}%</span>`);
    b.classList.toggle("changed", pct !== 100);
  }
}

function openVolume(tile) {
  const p = S.mesh?.peers.get(tile.dataset.id);
  if (!p) return;
  document.querySelector(".volPop")?.remove();
  const pop = document.createElement("div");
  pop.className = "volPop";
  const head = document.createElement("div");
  head.className = "volHead";
  const name = document.createElement("span");
  name.textContent = p.name || t("Someone");
  const val = document.createElement("b");
  head.append(name, val);
  const range = document.createElement("input");
  range.type = "range";
  range.min = 0;
  range.max = VOL_MAX;
  range.step = 10;
  range.value = volFor(p.name);
  const reset = document.createElement("button");
  reset.className = "ghost";
  reset.textContent = t("Normal");
  const paint = () => {
    val.textContent = `${range.value}%`;
    reset.hidden = Number(range.value) === 100;
  };
  range.oninput = () => {
    localStorage.setItem(`juntos.vol.${p.name || ""}`, range.value);
    applyVolume(tile, p);
    paint();
  };
  reset.onclick = () => {
    range.value = 100;
    range.oninput();
  };
  const hint = document.createElement("p");
  hint.className = "small";
  hint.textContent = t("Only for you. Above 100% makes a quiet voice louder.");
  pop.append(head, range, reset, hint);
  pop.onclick = (e) => e.stopPropagation();
  pop.ondblclick = (e) => e.stopPropagation();
  tile.append(pop);
  paint();
  const away = (e) => {
    if (pop.contains(e.target)) return;
    pop.remove();
    document.removeEventListener("pointerdown", away, true);
  };
  setTimeout(() => document.addEventListener("pointerdown", away, true));
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
    tile.classList.toggle("away", !S.br.same(id));
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
  applyVolume(tile, p);
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
      const loud = Math.sqrt(sum / buf.length) > 6;
      tile.classList.toggle("speaking", loud);
      // a running measure of talking (for spotlight / sidebar): up while talking, slowly down after
      tile.talk = Math.max(0, Math.min(3000, (tile.talk || 0) + (loud ? 150 : -75)));
      setTimeout(tick, 150);
    };
    tick();
  } catch (_) {}
}

// ---------- layouts (like Meet: auto, tiled, spotlight, sidebar), only for this device ----------
// auto = everyone the same size, and a shared screen big with the people beside it.
// Remembered: { layout, hideNoVideo, self: "grid" | "float" | "hide" }.
const VIEW_DEFAULT = { layout: "auto", hideNoVideo: false, self: "grid" };
S.view = { ...VIEW_DEFAULT, ...(JSON.parse(localStorage.getItem("juntos.view") || "null") || {}) };
function saveView() {
  localStorage.setItem("juntos.view", JSON.stringify(S.view));
  layout();
}

// who leads spotlight / sidebar: someone pinned, a shared screen, else whoever talks (switching only
// after a clear turn, so the picture doesn't jump at every "mm-hm")
S.speaker = null;
S.speakerAt = 0;
setInterval(() => {
  const g = $("grid");
  if (!g || !["spotlight", "sidebar"].includes(g.dataset.mode)) return;
  const others = [...g.children].filter((x) => x.dataset.id !== "me" && !x.classList.contains("away"));
  const best = others.reduce((a, x) => ((x.talk || 0) > (a?.talk || 0) ? x : a), null);
  const cur = S.speaker?.isConnected ? S.speaker : null;
  if (best && best !== cur && (best.talk || 0) >= 600 && (cur?.talk || 0) < 300 && Date.now() - S.speakerAt > 2000) {
    S.speaker = best;
    S.speakerAt = Date.now();
    layout();
  }
}, 300);

function layout() {
  S.an?.update(); // drawing on shared screens: which tiles show one
  const g = $("grid");
  const v = S.view;
  const tiles = [...g.children].filter((x) => !x.classList.contains("away")); // people in other breakout rooms aren't shown
  const me = g.querySelector('.tile[data-id="me"]');
  const alone = tiles.length <= 1;
  const screen = tiles.find((x) => x.classList.contains("screen") && x.dataset.id !== "me");
  let mode = v.layout === "auto" ? (screen ? "sidebar" : "tiled") : v.layout;
  if (document.body.classList.contains("boardBig") || alone) mode = "tiled";
  let main = null;
  if (mode !== "tiled") {
    const spoken = S.speaker?.isConnected && S.speaker.parentNode === g ? S.speaker : null;
    main = g.querySelector(".tile.spot") || screen || spoken || tiles.find((x) => x.dataset.id !== "me") || me;
  }
  g.dataset.mode = mode;
  for (const x of tiles) {
    const isMe = x === me;
    const float = isMe && v.self === "float" && !alone && x !== main;
    const off =
      !alone &&
      x !== main &&
      ((isMe && v.self === "hide") ||
        (!isMe && v.hideNoVideo && x.classList.contains("camoff") && !x.classList.contains("screen")) ||
        (mode === "spotlight" && !float));
    x.classList.toggle("off", off);
    x.classList.toggle("main", x === main);
    x.classList.toggle("floatMe", float && !off);
  }
  const shown = tiles.filter((x) => !x.classList.contains("off") && !x.classList.contains("floatMe"));
  const n = mode === "tiled" ? shown.length : 1;
  const wide = innerWidth > innerHeight;
  const cols = n <= 1 ? 1 : n <= 2 ? (wide ? 2 : 1) : n <= 4 ? 2 : n <= 9 ? 3 : 4;
  g.style.setProperty("--cols", cols);
  // sidebar: the others in a column on the right (a row at the bottom on a tall screen), sized to fit
  const thumbs = shown.filter((x) => x !== main);
  const k = Math.max(1, thumbs.length);
  const W = g.clientWidth || innerWidth;
  const H = g.clientHeight || innerHeight;
  let th, tw;
  if (wide) {
    th = Math.max(48, Math.min(113, (H - 8 * (k - 1)) / k));
    tw = Math.round(th * 16 / 9);
  } else {
    tw = Math.max(64, Math.min(120, (W - 6 * (k - 1)) / k));
    th = Math.round(tw * 3 / 4);
  }
  g.style.setProperty("--tw", `${tw}px`);
  g.style.setProperty("--th", `${th}px`);
  g.classList.toggle("tall", !wide);
  let i = 0;
  for (const tile of tiles) if (!tile.classList.contains("spot") && !tile.classList.contains("main")) tile.style.setProperty("--i", tile.classList.contains("off") || tile.classList.contains("floatMe") ? 0 : i++);
  let j = 0;
  for (const tile of tiles) tile.style.setProperty("--b", j++);
}

function layoutSheet() {
  const sheet = document.createElement("div");
  sheet.className = "sheet";
  const inner = document.createElement("div");
  inner.className = "sheetInner devices recSheet layoutSheet";
  const close = () => sheet.remove();
  const h = document.createElement("h3");
  h.textContent = t2("Layout");
  inner.append(h);
  const seg = (key, choices) => {
    const box = document.createElement("div");
    box.className = "seg";
    box.dataset.key = key;
    for (const [id, name, hint] of choices) {
      const b = document.createElement("button");
      b.dataset.v = id;
      b.innerHTML = `<b></b><small></small>`;
      b.firstChild.textContent = name;
      b.lastChild.textContent = hint;
      b.classList.toggle("on", S.view[key] === id);
      b.onclick = () => {
        S.view[key] = id;
        for (const x of box.children) x.classList.toggle("on", x === b);
        saveView();
      };
      box.append(b);
    }
    return box;
  };
  inner.append(
    seg("layout", [
      ["auto", t2("Auto"), t2("Everyone the same size; a shared screen big")],
      ["tiled", t2("Tiled"), t2("Everyone the same size")],
      ["spotlight", t2("Spotlight"), t2("Only who's talking (or a shared screen)")],
      ["sidebar", t2("Sidebar"), t2("Who's talking big, the others beside")],
    ]),
  );
  const p = document.createElement("p");
  p.className = "small";
  p.textContent = t2("Your own picture:");
  inner.append(p);
  const self = seg("self", [
    ["grid", t2("With everyone"), ""],
    ["float", t2("Small, in a corner"), ""],
    ["hide", t2("Hidden"), t2("The others still see you")],
  ]);
  self.classList.add("three");
  inner.append(self);
  const l = document.createElement("label");
  l.className = "check";
  const c = document.createElement("input");
  c.type = "checkbox";
  c.name = "hideNoVideo";
  c.checked = S.view.hideNoVideo;
  c.onchange = () => {
    S.view.hideNoVideo = c.checked;
    saveView();
  };
  l.append(c, document.createTextNode(t2("Hide people with their camera off")));
  inner.append(l);
  const note = document.createElement("p");
  note.className = "small";
  note.textContent = t2("Only on this device. Pin someone with the button on their picture.");
  inner.append(note);
  const row = document.createElement("div");
  row.className = "row2";
  const done = document.createElement("button");
  done.className = "primary";
  done.textContent = t2("Done");
  done.onclick = close;
  row.append(done);
  inner.append(row);
  sheet.append(inner);
  sheet.onclick = (e) => {
    if (e.target === sheet) close(); // a block body: an onclick that returns false cancels the click
  };
  document.body.append(sheet);
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
  const rooms = button("bBreak", "rooms", "Breakout rooms", () => openPanel("br"));
  rooms.hidden = !S.isHost; // only the host makes rooms (shown once the call says who the host is)
  extra.push(rooms);
  extra.push(button("bAct", "poll", "Polls and Q&A", () => openPanel("act")));
  extra.push(button("bNotes", "notes", "Notes", () => openPanel("notes")));
  extra.push(button("bLayout", "layout", "Layout", layoutSheet));
  extra.push(button("bCaps", "cc", "Captions", captionsSheet));
  if (pipSupported()) extra.push(button("bPip", "pip", "Small window", openPip));
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
  sheet.onclick = (e) => {
    if (e.target === sheet) sheet.remove(); // a block: an onclick that returns false cancels the click (checkboxes stopped working)
  };
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
  $("panelTitle").textContent = t({ chat: "Chat", board: "Board", bg: "Background", people: "People", act: "Polls and Q&A", br: "Breakout rooms", notes: "Notes" }[which]);
  for (const p of ["chat", "board", "bg", "people", "act", "br", "notes"]) $(`${p}Pane`).hidden = p !== which;
  $({ chat: "bChat", board: "bBoard", bg: "bBg", people: "bPeople", act: "bAct", br: "bBreak", notes: "bNotes" }[which])?.classList.remove("badge");
  $("bChat2")?.classList.remove("badge");
  if (which === "chat") {
    renderChat();
    if (!isPhone) $("chatText").focus();
  }
  $("boardMax").hidden = which !== "board";
  if (which === "board") {
    ensureBoard();
    setBoardBig(!!S.boardBig);
  } else if (S.boardBig) setBoardBig(false);
  if (which === "bg") renderBackgrounds();
  if (which === "people") renderPeople();
  if (which === "act") S.act.render();
  if (which === "notes") S.notes.render();
  if (which === "br") S.br.render();
}

function closePanel() {
  if (S.boardBig) setBoardBig(false);
  S.panel = null;
  $("panel").hidden = true;
}
$("panelClose").onclick = closePanel;
$("boardMax").onclick = () => setBoardBig(!S.boardBig);

// chat
function addChat(c) {
  c.room = S.br?.here || 0;
  S.chat.push(c);
  S.recorder?.event({ kind: "chat", name: c.from === "me" ? localStorage.getItem("name") || "" : c.name, text: c.text });
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
    if ((c.room || 0) !== (S.br?.here || 0)) continue; // each breakout room has its own chat
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
  S.mesh.roomcast({ k: "chat", text });
  addChat(c);
};

// board
function ensureBoard() {
  if (!S.board) {
    const b = (S.board = new Board($("boardCanvas"), (m) => S.mesh && S.mesh.broadcast(m)));
    const tools = $("boardTools");
    const group = (cls) => {
      const g = document.createElement("div");
      g.className = `bGroup ${cls}`;
      tools.append(g);
      return g;
    };
    const pick = (g, btn) => {
      for (const x of g.children) x.classList.toggle("on", x === btn);
    };
    const names = { pen: "Pen", rect: "Rectangle", ellipse: "Circle", arrow: "Arrow", text: "Text", eraser: "Eraser", hand: "Move the board" };
    const tg = group("bTools");
    for (const id of TOOLS) {
      const x = document.createElement("button");
      x.className = "bTool";
      x.dataset.tool = id;
      x.title = t(names[id]);
      x.innerHTML = svg(id);
      x.onclick = () => {
        b.tool = id;
        pick(tg, x);
        $("boardCanvas").dataset.tool = id;
      };
      tg.append(x);
    }
    tg.firstChild.classList.add("on");
    $("boardCanvas").dataset.tool = b.tool;
    const cg = group("bColors");
    for (const c of COLORS) {
      const x = document.createElement("button");
      x.className = "swatch";
      x.style.background = c;
      x.title = t("Colour");
      x.onclick = () => {
        b.color = c;
        pick(cg, x);
      };
      cg.append(x);
    }
    cg.firstChild.classList.add("on");
    const sg = group("bSizes");
    SIZES.forEach((s, i) => {
      const x = document.createElement("button");
      x.className = "bSize";
      x.title = t(["Thin", "Medium", "Thick"][i]);
      x.innerHTML = `<i style="width:${4 + i * 5}px;height:${4 + i * 5}px"></i>`;
      x.onclick = () => {
        b.size = i;
        pick(sg, x);
      };
      sg.append(x);
    });
    sg.children[b.size].classList.add("on");
    const ag = group("bActions");
    const undo = document.createElement("button");
    undo.className = "bTool";
    undo.title = t("Undo");
    undo.innerHTML = svg("undo");
    undo.onclick = () => b.undo();
    const clear = document.createElement("button");
    clear.className = "chip";
    clear.textContent = t("Clear");
    // clearing wipes everyone's drawings: the first tap asks, the second does it
    clear.onclick = () => {
      if (!clear.classList.contains("sure")) {
        clear.classList.add("sure");
        clear.textContent = t("Clear for everyone?");
        clearTimeout(clear.timer);
        clear.timer = setTimeout(() => {
          clear.classList.remove("sure");
          clear.textContent = t("Clear");
        }, 3000);
        return;
      }
      clearTimeout(clear.timer);
      clear.classList.remove("sure");
      clear.textContent = t("Clear");
      b.clear();
    };
    ag.append(undo, clear);
    // zoom, over the board's corner
    const zoom = $("boardZoom");
    const zl = document.createElement("button");
    zl.className = "zLabel";
    zl.title = t("Show everything");
    const zb = (label, title, f) => {
      const x = document.createElement("button");
      x.textContent = label;
      x.title = t(title);
      x.onclick = f;
      return x;
    };
    zoom.append(zb("−", "Zoom out", () => b.zoom(1 / 1.25)), zl, zb("+", "Zoom in", () => b.zoom(1.25)));
    zl.onclick = () => b.fit();
    b.onview = (z) => (zl.textContent = `${Math.round(z * 100)}%`);
    if (b.view) b.onview(b.view.z);
    // keys: Ctrl+Z takes back, holding Space moves the board
    addEventListener("keydown", (e) => {
      if (S.panel !== "board" || e.target.closest("input, textarea")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        b.undo();
      } else if (e.key === " ") {
        e.preventDefault();
        b.space = true;
      }
    });
    addEventListener("keyup", (e) => {
      if (e.key === " ") b.space = false;
    });
  }
  return S.board;
}

// The board as the main thing, everyone small and floating over its corner (and the board is what
// a recording shows, like a shared screen).
function setBoardBig(on) {
  S.boardBig = on;
  document.body.classList.toggle("boardBig", on);
  $("boardMax").innerHTML = svg(on ? "fullExit" : "full");
  $("boardMax").title = t(on ? "Back to the side" : "Make the board big");
  if (on) for (const x of document.querySelectorAll(".tile.spot")) spotlight(x);
  layout(); // the big board puts everyone in the floating column, whatever the layout
  requestAnimationFrame(() => S.board?.resize());
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

// ---------- host controls: the person who started the call can lock it, let people in, mute, remove ----------
function onHost(m) {
  if (m.t === "room") {
    S.isHost = m.host;
    S.act.render();
    if ($("bBreak")) $("bBreak").hidden = !S.isHost;
    S.br.render();
    S.notes.render();
    S.locked = m.locked;
    S.waiting = false;
    localStorage.removeItem(`juntos.out.${S.code}`);
    paintNet();
  } else if (m.t === "waiting") {
    S.waiting = true;
    paintNet();
  } else if (m.t === "denied") {
    leave(t("Nobody let you in this time."));
  } else if (m.t === "removed") {
    localStorage.setItem(`juntos.out.${S.code}`, "1");
    leave(t("{name} removed you from the call", { name: m.by || t("Someone") }));
  } else if (m.t === "knock") {
    S.knocks.set(m.id, m.name);
    paintKnocks();
  } else if (m.t === "knock-gone") {
    S.knocks.delete(m.id);
    paintKnocks();
  } else if (m.t === "lock") {
    S.locked = m.on;
    toast(m.on ? t("{name} locked the call. New people ask to join.", { name: m.by }) : t("{name} unlocked the call", { name: m.by }));
  } else if (m.t === "mute") {
    if (S.mic) setMic(false);
    toast(t("{name} muted you", { name: m.by || t("Someone") }));
  }
  renderPeople();
}

// someone asks to join a locked call: a card for the host to let them in
function paintKnocks() {
  let box = $("knocks");
  if (!box) {
    box = document.createElement("div");
    box.id = "knocks";
    box.className = "knocks";
    $("call").append(box);
  }
  box.innerHTML = "";
  for (const [id, name] of S.knocks || []) {
    const card = document.createElement("div");
    card.className = "knock";
    const who = document.createElement("span");
    who.textContent = t("{name} wants to join", { name: name || t("Someone") });
    const yes = document.createElement("button");
    yes.className = "primary";
    yes.textContent = t("Let in");
    yes.onclick = () => S.mesh.host({ t: "admit", id });
    const no = document.createElement("button");
    no.className = "chip";
    no.textContent = t("Deny");
    no.onclick = () => S.mesh.host({ t: "deny", id });
    card.append(who, yes, no);
    box.append(card);
  }
  box.hidden = !box.children.length;
}

// a button that asks once before doing something hard to undo
function sureButton(label, sure, act) {
  const b = document.createElement("button");
  b.className = "chip";
  b.textContent = label;
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

// people
function renderPeople() {
  const ul = $("peopleList");
  if (!ul || !S.mesh) return;
  ul.innerHTML = "";
  if (S.isHost) {
    const li = document.createElement("li");
    li.className = "hostRow";
    const muteAll = document.createElement("button");
    muteAll.className = "chip";
    muteAll.textContent = t("Mute everyone");
    muteAll.onclick = () => {
      S.mesh.host({ t: "mute", id: "*" });
      toast(t("Everyone else is muted. They can unmute themselves."));
    };
    const lock = document.createElement("button");
    lock.className = "chip" + (S.locked ? " on" : "");
    lock.id = "lockBtn";
    lock.textContent = S.locked ? t("Unlock the call") : t("Lock the call");
    lock.title = t("When locked, new people ask to join and you let them in.");
    lock.onclick = () => S.mesh.host({ t: "lock", on: !S.locked });
    li.append(muteAll, lock);
    ul.append(li);
  }
  if (S.locked) {
    const li = document.createElement("li");
    li.className = "lockNote";
    li.textContent = t("🔒 Locked: new people ask to join.");
    ul.append(li);
  }
  const add = (name, extra, id, host) => {
    const li = document.createElement("li");
    li.className = "person";
    const nm = document.createElement("span");
    nm.className = "pName";
    nm.textContent = name + (extra ? ` ${extra}` : "");
    li.append(nm);
    if (host) {
      const tag = document.createElement("span");
      tag.className = "hostTag";
      tag.textContent = t("Host");
      li.append(tag);
    }
    if (id && S.isHost) {
      const mute = document.createElement("button");
      mute.className = "chip";
      mute.textContent = t("Mute");
      mute.onclick = () => S.mesh.host({ t: "mute", id });
      li.append(mute);
      if (!host) li.append(sureButton(t("Remove"), t("Remove?"), () => S.mesh.host({ t: "remove", id })));
    }
    ul.append(li);
  };
  add(`${localStorage.getItem("name")} ${t("(you)")}`, S.hands.has("me") ? "✋" : "", null, S.isHost);
  for (const p of S.mesh.peers.values())
    add(
      p.name || t("Joining…"),
      (S.hands.has(p.id) ? "✋ " : "") + (p.state === "connected" ? "" : t("· connecting")) + (S.br.roomOf(p.id) ? ` · ${S.br.room(S.br.roomOf(p.id))}` : ""),
      p.id,
      S.mesh.hosts.has(p.id),
    );
  $("bPeople")?.querySelector("span") && ($("bPeople").querySelector("span").textContent = t("People ({n})", { n: S.mesh.peers.size + 1 }));
  S.br.refresh();
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
function toggleHand() {
  const on = !S.hands.has("me");
  setHand("me", on);
  S.mesh.roomcast({ k: "hand", on });
  return on;
}
function openReactions() {
  const box = $("reactions");
  if (!box.hidden) return (box.hidden = true);
  box.innerHTML = "";
  const hand = document.createElement("button");
  hand.className = "chip";
  hand.textContent = S.hands.has("me") ? t("Lower hand") : t("✋ Raise hand");
  hand.onclick = () => {
    toggleHand();
    box.hidden = true;
  };
  box.append(hand);
  for (const e of ["👍", "❤️", "😂", "👏", "🎉", "😮"]) {
    const b = document.createElement("button");
    b.className = "emojiBtn";
    b.textContent = e;
    b.onclick = () => {
      react("me", e);
      S.mesh.roomcast({ k: "react", e });
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
  S.recorder?.event({ kind: "react", id, e });
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
    await S.mesh.setTracks(S.micTrack, S.screen);
    S.mesh.broadcast(myState());
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
  S.mesh.broadcast(myState());
}

// ---------- talking while muted, push to talk, keyboard shortcuts ----------
// Talking with the mic off: a note says so (listening to a copy of the mic, which nobody receives).
function watchMuted() {
  clearInterval(watchMuted.timer);
  const ac = (openDevices.ac ||= new (window.AudioContext || window.webkitAudioContext)());
  let tr = null, an = null, loud = 0, lastShown = 0;
  const buf = new Uint8Array(512);
  const stop = () => {
    tr?.stop();
    tr = null;
    loud = 0;
  };
  watchMuted.timer = setInterval(() => {
    if ($("call").hidden) {
      stop();
      return clearInterval(watchMuted.timer);
    }
    if (S.mic || !S.micTrack || S.ptt) {
      if (S.mic) $("mutedNote").hidden = true;
      return stop();
    }
    if (!tr || tr.src !== S.micTrack) {
      tr?.stop();
      tr = micCopy();
      an = ac.createAnalyser();
      an.fftSize = 512;
      ac.createMediaStreamSource(new MediaStream([tr])).connect(an);
    }
    an.getByteTimeDomainData(buf);
    let sum = 0;
    for (const b of buf) sum += (b - 128) ** 2;
    loud = Math.sqrt(sum / buf.length) > 6 ? loud + 1 : 0;
    // about a second of talking, and not again for half a minute
    if (loud >= 5 && Date.now() - lastShown > 30000) {
      lastShown = Date.now();
      showMuted();
    }
  }, 200);
}
function showMuted() {
  const n = $("mutedNote");
  n.innerHTML = `${svg("micOff")}<span></span><button class="primary"></button>`;
  n.querySelector("span").textContent = isPhone ? t("You're muted") : t("You're muted. Hold Space to talk, or press M.");
  n.querySelector("button").textContent = t("Unmute");
  n.querySelector("button").onclick = () => {
    n.hidden = true;
    setMic(true);
  };
  n.hidden = false;
  clearTimeout(showMuted.timer);
  showMuted.timer = setTimeout(() => (n.hidden = true), 6000);
}

function typing(e) {
  return e.target.closest?.("input, textarea, select, [contenteditable]");
}
function pttEnd() {
  if (!S.ptt) return;
  S.ptt = false;
  $("pttNote").hidden = true;
  setMic(false);
}
addEventListener("keydown", (e) => {
  if ($("call").hidden || typing(e) || e.altKey) return;
  const k = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) {
    // the keys Meet uses
    if (k === "d") setMic(!S.mic);
    else if (k === "e") setCam(!S.cam);
    else return;
    return e.preventDefault();
  }
  if (e.key === " ") {
    // hold Space to talk while muted (on the board Space moves the board; a focused field keeps its Space)
    if (S.panel === "board" || (e.target !== document.body && !e.target.closest("#bar, #grid"))) return;
    e.preventDefault();
    if (e.repeat || S.mic || S.ptt || !S.micTrack) return;
    S.ptt = true;
    $("mutedNote").hidden = true;
    $("pttNote").textContent = t("Talking… let go of Space to mute");
    $("pttNote").hidden = false;
    return setMic(true);
  }
  if (document.querySelector(".sheet")) return;
  if (k === "m") setMic(!S.mic);
  else if (k === "v") setCam(!S.cam);
  else if (k === "h") toast(toggleHand() ? t("Hand raised") : t("Hand lowered"));
  else if (k === "c") openPanel("chat");
  else if (e.key === "?") shortcutsSheet();
  else return;
  e.preventDefault();
});
addEventListener("keyup", (e) => e.key === " " && pttEnd());
addEventListener("blur", pttEnd);

// ---------- live captions ----------
// Each person's own browser turns their own voice into text (Web Speech API) and sends the words to whoever has
// captions on. Nobody's browser listens unless someone in the call wants captions, and never while muted.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
S.capsOn = localStorage.getItem("juntos.captions") === "on";
S.capShare = localStorage.getItem("juntos.capshare") !== "off";
S.capSize = localStorage.getItem("juntos.capsize") || "large";
S.capLang = localStorage.getItem("juntos.caplang") || "";
S.capWant = new Set(); // who in the call wants captions (peer ids)
S.capLines = new Map(); // speaker id -> { el, done, timer }
S.transcript = []; // { at, name, text }
let capRec = null;
let capOn = false;
let capFails = 0;
let capToldMe = false;

function capReset() {
  if (S.capCode !== S.code) S.transcript = [];
  S.capCode = S.code;
  S.capWant.clear();
  S.capLines.clear();
  capToldMe = false;
  paintCaps();
  capSync();
}

function paintCaps() {
  const box = $("captions");
  box.hidden = !S.capsOn;
  box.className = `captions ${S.capSize}`;
  if (!S.capsOn) box.innerHTML = "";
  $("bCaps")?.classList.toggle("on", S.capsOn);
}

// listen to my own voice only while someone wants captions, my mic is on and I haven't turned it off
function capSync() {
  const need = !!(SR && S.mesh && S.mic && S.capShare && (S.capsOn || S.capWant.size));
  if (need === capOn) return;
  capOn = need;
  capFails = 0;
  if (need) capStart();
  else if (capRec) {
    const r = capRec;
    capRec = null;
    try {
      r.abort();
    } catch {}
  }
}

function capStart() {
  if (!capOn || capRec) return;
  const r = new SR();
  capRec = r;
  r.continuous = true;
  r.interimResults = true;
  r.lang = S.capLang || navigator.language || "en-US";
  r.onresult = (e) => {
    capFails = 0;
    let fin = "";
    let now = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) fin += e.results[i][0].transcript;
      else now += e.results[i][0].transcript;
    }
    if (fin.trim()) capSend(fin.trim(), true);
    if (now.trim()) capSend(now.trim(), false);
  };
  r.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "language-not-supported") {
      capOn = false;
      toast(t("Captions don't work in this browser"));
    } else if (e.error !== "no-speech" && e.error !== "aborted") capFails++;
  };
  // the browser stops listening now and then (silence, a time limit): start again while still wanted
  r.onend = () => {
    if (capRec !== r) return;
    capRec = null;
    if (capOn) setTimeout(capStart, Math.min(300 * 2 ** capFails, 15000));
  };
  try {
    r.start();
  } catch {
    capRec = null;
  }
}

function capSend(text, final) {
  text = text.slice(0, 500);
  const m = { k: "cap", text, final };
  for (const id of S.capWant) if (S.br.same(id)) S.mesh?.sendTo(id, m);
  if (S.capsOn) showCap("me", t("You"), text, final);
}

// someone turned their captions on or off
function capWanted(from, on, who) {
  if (on) {
    S.capWant.add(from);
    if (!SR || !S.capShare) S.mesh.sendTo(from, { k: "capno", why: SR ? "off" : "browser" });
    else if (!capToldMe) {
      capToldMe = true;
      toast(t("{name} turned on captions: your browser turns what you say into text", { name: who }));
    }
  } else S.capWant.delete(from);
  capSync();
}

function showCap(id, name, text, final, note) {
  const box = $("captions");
  let L = S.capLines.get(id);
  if (!L) {
    const el = document.createElement("div");
    el.className = "capLine";
    el.dataset.id = id;
    el.innerHTML = "<b></b><span></span>";
    box.append(el);
    L = { el, done: "", timer: 0 };
    S.capLines.set(id, L);
    while (box.children.length > 3) {
      const old = box.firstElementChild;
      S.capLines.delete(old.dataset.id);
      old.remove();
    }
  }
  L.el.classList.toggle("note", !!note);
  L.el.firstChild.textContent = name;
  if (final) {
    L.done = `${L.done} ${text}`.trim().slice(-400);
    if (!note) S.transcript.push({ at: Date.now(), name: id === "me" ? localStorage.getItem("name") || name : name, text });
  }
  let s = final ? L.done : `${L.done} ${text}`.trim();
  if (s.length > 160) s = "… " + s.slice(-160).replace(/^\S*\s/, "");
  L.el.lastChild.textContent = s;
  clearTimeout(L.timer);
  L.timer = setTimeout(() => {
    L.el.remove();
    if (S.capLines.get(id) === L) S.capLines.delete(id);
  }, 8000);
}

function setCaps(on) {
  S.capsOn = on;
  localStorage.setItem("juntos.captions", on ? "on" : "off");
  S.capLines.clear();
  paintCaps();
  S.mesh?.broadcast({ k: "capwant", on });
  capSync();
}

// ---------- picture-in-picture: the call in a small window over every other window ----------
// Like Meet's (studied: support.google.com/meet/answer/13665919): a small window you move and resize, with who's
// talking, captions, notices and the buttons (mic, camera, hand, captions, back to the call, leave), opening by
// itself when you switch tabs if the browser allows it. Chrome and Edge on computers get the whole small window
// (Document Picture-in-Picture); other browsers float the video of who's talking (Safari, Firefox, phones).
const docPip = "documentPictureInPicture" in window;
const vidPip = !!document.pictureInPictureEnabled;
function pipSupported() {
  return docPip || vidPip;
}
// who is shown: a shared screen, then who's talking, then the others by how much they talk; me last, small
function pipTiles() {
  const all = [...($("grid")?.children || [])].filter((x) => !x.classList.contains("away"));
  const me = all.find((x) => x.dataset.id === "me");
  const others = all.filter((x) => x !== me);
  const rank = (x) => (x.classList.contains("screen") ? 1e9 : 0) + (x === S.speaker ? 1e8 : 0) + (x.classList.contains("camoff") ? 0 : 1e4) + (x.talk || 0);
  others.sort((a, b) => rank(b) - rank(a));
  return { main: others.slice(0, 3), me };
}
function pipMirror(box, src, cls) {
  let m = box.querySelector(`.tile[data-id="${CSS.escape(src.dataset.id)}"]`);
  if (!m) {
    m = box.ownerDocument.createElement("div");
    m.innerHTML = `<video autoplay playsinline muted></video><div class="avatar"></div><div class="label"></div>`;
    m.dataset.id = src.dataset.id;
  }
  m.className = [...src.classList].filter((c) => !["main", "spot", "floatMe", "off"].includes(c)).join(" ") + " " + cls;
  const v = m.querySelector("video");
  const sv = src.querySelector("video");
  if (v.srcObject !== sv.srcObject) v.srcObject = sv.srcObject;
  if (v.paused && v.srcObject) v.play().catch(() => {});
  m.querySelector(".avatar").textContent = src.querySelector(".avatar").textContent;
  const lab = src.querySelector(".label").innerHTML;
  if (m.querySelector(".label").innerHTML !== lab) m.querySelector(".label").innerHTML = lab;
  return m;
}
function pipPaint() {
  const w = S.pip;
  if (!w) return;
  const d = w.document;
  const { main, me } = pipTiles();
  const grid = d.getElementById("pipGrid");
  const keep = [...main.map((x) => pipMirror(grid, x, "")), ...(me ? [pipMirror(grid, me, main.length ? "pipMe" : "")] : [])];
  for (const x of [...grid.children]) if (!keep.includes(x)) x.remove();
  keep.forEach((x, i) => grid.children[i] !== x && grid.insertBefore(x, grid.children[i] || null));
  grid.dataset.n = main.length || 1;
  const caps = d.getElementById("pipCaps");
  caps.className = $("captions").className;
  caps.hidden = $("captions").hidden;
  if (caps.innerHTML !== $("captions").innerHTML) caps.innerHTML = $("captions").innerHTML;
  const toasts = d.getElementById("pipToasts");
  if (toasts.innerHTML !== $("toasts").innerHTML) toasts.innerHTML = $("toasts").innerHTML;
  for (const [id, on, a, b] of [["qMic", S.mic, "mic", "micOff"], ["qCam", S.cam, "cam", "camOff"]]) {
    const el = d.getElementById(id);
    const want = svg(on ? a : b);
    if (el.dataset.icon !== want) {
      el.innerHTML = want;
      el.dataset.icon = want;
    }
    el.classList.toggle("danger", !on);
  }
  d.getElementById("qHand").classList.toggle("on", S.hands.has("me"));
  d.getElementById("qCaps").classList.toggle("on", !!S.capsOn);
}
async function openPip() {
  if (!S.mesh) return;
  if (S.pip) return S.pip.focus?.();
  if (!docPip) return videoPip();
  let w;
  try {
    w = await documentPictureInPicture.requestWindow({ width: 360, height: 300 });
  } catch (_) {
    return videoPip();
  }
  S.pip = w;
  const d = w.document;
  d.documentElement.lang = document.documentElement.lang;
  d.title = t("Call on Juntos");
  for (const l of document.querySelectorAll('link[rel="stylesheet"]')) {
    const c = d.createElement("link");
    c.rel = "stylesheet";
    c.href = l.href;
    d.head.append(c);
  }
  d.body.className = "pipBody";
  d.body.innerHTML = `<div id="pipToasts" class="toasts"></div><div id="pipGrid" class="pipGrid"></div><div id="pipCaps" class="captions" hidden></div><div class="pipBar"></div>`;
  const bar = d.querySelector(".pipBar");
  const btn = (id, icon, label, fn, cls = "") => {
    const b = d.createElement("button");
    b.id = id;
    b.className = `round ${cls}`;
    b.title = t(label);
    b.setAttribute("aria-label", t(label));
    b.innerHTML = icon.startsWith("<") ? icon : svg(icon);
    b.onclick = () => {
      fn();
      pipPaint();
    };
    bar.append(b);
  };
  btn("qMic", "mic", "Mic", () => setMic(!S.mic));
  btn("qCam", "cam", "Camera", () => setCam(!S.cam));
  btn("qHand", '<b class="emoji">✋</b>', "Raise hand", toggleHand);
  btn("qCaps", "cc", "Captions", () => setCaps(!S.capsOn));
  btn("qBack", "full", "Back to the call", backFromPip);
  btn("qLeave", "end", "Leave", () => leave(), "end");
  pipPaint();
  S.pipTimer = setInterval(pipPaint, 250);
  w.addEventListener("pagehide", () => {
    clearInterval(S.pipTimer);
    S.pip = null;
    $("bPip")?.classList.remove("on");
  });
  $("bPip")?.classList.add("on");
}
function backFromPip() {
  S.pip?.close();
  window.focus();
}
// other browsers: the video of who's talking floats (the browser's own small window)
async function videoPip() {
  if (!vidPip) return;
  if (document.pictureInPictureElement) return document.exitPictureInPicture().catch(() => {});
  const { main, me } = pipTiles();
  const tile = main.find((x) => !x.classList.contains("camoff")) || main[0] || me;
  const v = tile?.querySelector("video");
  if (!v?.srcObject) return toast(t("Nobody has a camera on yet"));
  try {
    await v.requestPictureInPicture();
  } catch (_) {
    toast(t("This browser can't float the call"));
  }
}
function closePip() {
  S.pip?.close();
  if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
}

function saveTranscript() {
  const pad = (n) => String(n).padStart(2, "0");
  const d = new Date();
  const lines = S.transcript.map((x) => {
    const a = new Date(x.at);
    return `[${pad(a.getHours())}:${pad(a.getMinutes())}] ${x.name}: ${x.text}`;
  });
  const head = `Juntos ${S.code || ""}, ${d.toLocaleDateString()}`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([`${head}\r\n\r\n${lines.join("\r\n")}\r\n`], { type: "text/plain;charset=utf-8" }));
  a.download = `Juntos captions ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}.txt`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function captionsSheet() {
  const sheet = document.createElement("div");
  sheet.className = "sheet";
  const inner = document.createElement("div");
  inner.className = "sheetInner devices recSheet capSheet";
  const h = document.createElement("h3");
  h.textContent = t("Captions");
  inner.append(h);
  const check = (name, text, on, change) => {
    const l = document.createElement("label");
    l.className = "check";
    const c = document.createElement("input");
    c.type = "checkbox";
    c.name = name;
    c.checked = on;
    c.onchange = () => change(c.checked);
    l.append(c, document.createTextNode(text));
    inner.append(l);
  };
  check("caps", t("Show captions"), S.capsOn, setCaps);
  const size = document.createElement("div");
  size.className = "seg three";
  size.dataset.key = "capSize";
  for (const [id, name] of [["normal", t("Normal")], ["large", t("Large")], ["huge", t("Huge")]]) {
    const b = document.createElement("button");
    b.dataset.v = id;
    b.innerHTML = "<b></b>";
    b.firstChild.textContent = name;
    b.classList.toggle("on", S.capSize === id);
    b.onclick = () => {
      S.capSize = id;
      localStorage.setItem("juntos.capsize", id);
      for (const x of size.children) x.classList.toggle("on", x === b);
      paintCaps();
    };
    size.append(b);
  }
  const sl = document.createElement("p");
  sl.className = "small";
  sl.textContent = t("Text size");
  inner.append(sl, size);
  if (SR) {
    const ll = document.createElement("p");
    ll.className = "small";
    ll.textContent = t("I speak");
    const sel = document.createElement("select");
    sel.name = "capLang";
    for (const [v, name] of [
      ["", t("The language of this device")],
      ["es-ES", "Español"],
      ["en-US", "English"],
      ["pt-BR", "Português"],
      ["fr-FR", "Français"],
      ["de-DE", "Deutsch"],
      ["it-IT", "Italiano"],
    ]) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = name;
      o.selected = S.capLang === v;
      sel.append(o);
    }
    sel.onchange = () => {
      S.capLang = sel.value;
      localStorage.setItem("juntos.caplang", sel.value);
      if (capRec) capRec.stop(); // starts again in the new language
    };
    inner.append(ll, sel);
    check("capShare", t("Turn my voice into captions for the others"), S.capShare, (on) => {
      S.capShare = on;
      localStorage.setItem("juntos.capshare", on ? "on" : "off");
      if (!on) for (const id of S.capWant) S.mesh?.sendTo(id, { k: "capno", why: "off" });
      capSync();
    });
  } else {
    const p = document.createElement("p");
    p.className = "small";
    p.textContent = t("This browser can't turn your voice into text (Chrome, Edge and Safari can). You still see what the others say.");
    inner.append(p);
  }
  const save = document.createElement("button");
  save.className = "chip";
  save.name = "capSave";
  save.textContent = t("Save captions (.txt)");
  save.disabled = !S.transcript.length;
  save.onclick = saveTranscript;
  inner.append(save);
  const note = document.createElement("p");
  note.className = "small";
  note.textContent = t("Each person's browser turns their own voice into text. Chrome, Edge and Safari may send the sound to Google, Microsoft or Apple to do it.");
  inner.append(note);
  const done = document.createElement("button");
  done.className = "primary";
  done.textContent = t("Done");
  done.onclick = () => sheet.remove();
  inner.append(done);
  sheet.append(inner);
  sheet.onclick = (e) => {
    if (e.target === sheet) sheet.remove();
  };
  document.body.append(sheet);
}

function shortcutsSheet() {
  const sheet = document.createElement("div");
  sheet.className = "sheet";
  const inner = document.createElement("div");
  inner.className = "sheetInner devices recSheet keysSheet";
  const h = document.createElement("h3");
  h.textContent = t("Keyboard shortcuts");
  inner.append(h);
  const dl = document.createElement("dl");
  for (const [keys, what] of [
    ["M  ·  Ctrl+D", "Microphone on / off"],
    ["Space", "Hold to talk while muted"],
    ["V  ·  Ctrl+E", "Camera on / off"],
    ["H", "Raise / lower your hand"],
    ["C", "Chat"],
    ["Esc", "Unpin"],
    ["?", "This list"],
  ]) {
    const dt = document.createElement("dt");
    dt.textContent = keys;
    const dd = document.createElement("dd");
    dd.textContent = t(what);
    dl.append(dt, dd);
  }
  inner.append(dl);
  const done = document.createElement("button");
  done.className = "primary";
  done.textContent = t("Done");
  done.onclick = () => sheet.remove();
  inner.append(done);
  sheet.append(inner);
  sheet.onclick = (e) => {
    if (e.target === sheet) sheet.remove();
  };
  document.body.append(sheet);
  done.focus();
}

// ---------- cameras, microphones, speakers ----------
function camConstraints(id) {
  const v = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } };
  return id ? { ...v, deviceId: { ideal: id } } : { ...v, facingMode: S.facing };
}
function micConstraints(id) {
  const a = { echoCancellation: true, noiseSuppression: S.noise, autoGainControl: true };
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

// a copy of the microphone for a level meter (heard by nobody); useMic stops them all
function micCopy() {
  const c = S.micTrack.clone();
  c.src = S.micTrack;
  c.enabled = true;
  (S.micCopies ||= new Set()).add(c);
  return c;
}
async function useMic(id) {
  // a browser shares one capture between the tracks of a microphone: while any of them is open, a new one
  // keeps the old settings (the noise switch did nothing), so everything on it stops first
  for (const c of S.micCopies || []) c.stop();
  S.micCopies?.clear();
  S.micTrack?.stop();
  try {
    let s;
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(id) });
    } catch (e) {
      s = await navigator.mediaDevices.getUserMedia({ audio: true }); // never left without a microphone
      toast(t("Couldn't switch microphone"));
    }
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
  S.out?.setSinkId?.(id).catch(() => {}); // boosted voices
}
S.sink = localStorage.getItem("sinkId") || "";
S.noise = localStorage.getItem("juntos.noise") !== "off"; // the browser's own noise reduction (on unless turned off)

// a short two-note chime as a WAV, so it can be played on the chosen speaker
function chime() {
  const rate = 22050, n = Math.round(rate * 0.9), d = new DataView(new ArrayBuffer(44 + n * 2));
  const w = (o, s) => [...s].forEach((c, i) => d.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); d.setUint32(4, 36 + n * 2, true); w(8, "WAVEfmt "); d.setUint32(16, 16, true); d.setUint16(20, 1, true);
  d.setUint16(22, 1, true); d.setUint32(24, rate, true); d.setUint32(28, rate * 2, true); d.setUint16(32, 2, true);
  d.setUint16(34, 16, true); w(36, "data"); d.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = i / rate, f = s < 0.45 ? 660 : 880, local = s % 0.45;
    const env = Math.min(1, local * 40) * Math.exp(-local * 5);
    d.setInt16(44 + i * 2, Math.sin(2 * Math.PI * f * s) * env * 0.5 * 32767, true);
  }
  return URL.createObjectURL(new Blob([d], { type: "audio/wav" }));
}
function playOnSpeaker(url) {
  const a = new Audio(url);
  if (S.sink) a.setSinkId?.(S.sink).catch(() => {});
  return a.play().then(() => a).catch(() => null);
}

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
  const noise = document.createElement("label");
  noise.className = "check";
  noise.innerHTML = `<input type="checkbox" name="noise"><span></span>`;
  noise.lastChild.textContent = t("Reduce background noise");
  noise.firstChild.checked = S.noise;
  noise.firstChild.onchange = async () => {
    S.noise = noise.firstChild.checked;
    localStorage.setItem("juntos.noise", S.noise ? "on" : "off");
    await useMic(S.micTrack?.getSettings().deviceId || localStorage.getItem("micId"));
    startMeter();
  };
  inner.append(noise);
  const tests = document.createElement("div");
  tests.className = "devTests";
  const testBtn = (name, label, run) => {
    const b = document.createElement("button");
    b.className = "chip";
    b.name = name;
    b.textContent = t(label);
    b.onclick = async () => {
      if (b.disabled) return;
      b.disabled = true;
      try {
        await run(b);
      } finally {
        b.disabled = false;
        b.textContent = t(label);
      }
    };
    tests.append(b);
  };
  testBtn("testSpeaker", "Play a test sound", async (b) => {
    b.textContent = t("Playing…");
    const a = await playOnSpeaker((chime.url ||= chime()));
    if (!a) return toast(t("Couldn't play a sound here"));
    await new Promise((r) => (a.onended = r));
  });
  if (window.MediaRecorder && S.micTrack) {
    // say something, hear it back: the way to know the others hear you
    testBtn("testMic", "Test microphone", async (b) => {
      const tr = S.micTrack.clone();
      tr.enabled = true;
      const rec = new MediaRecorder(new MediaStream([tr]));
      const parts = [];
      rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
      const done = new Promise((r) => (rec.onstop = r));
      rec.start();
      for (let s = 3; s > 0; s--) {
        b.textContent = t("Say something… {n}", { n: s });
        await new Promise((r) => setTimeout(r, 1000));
      }
      rec.stop();
      await done;
      tr.stop();
      b.textContent = t("Playing it back…");
      const a = await playOnSpeaker(URL.createObjectURL(new Blob(parts, { type: rec.mimeType })));
      if (!a) return toast(t("Couldn't play a sound here"));
      await new Promise((r) => (a.onended = r));
    });
  }
  inner.append(tests);
  if (!isPhone) {
    const k = document.createElement("button");
    k.className = "linkBtn";
    k.textContent = t("Keyboard shortcuts");
    k.onclick = () => {
      close();
      shortcutsSheet();
    };
    inner.append(k);
  }
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
  sheet.onclick = (e) => {
    if (e.target === sheet) close(); // a block: an onclick that returns false cancels the click (checkboxes stopped working)
  };
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
$("recDot").onclick = () => {
  if (S.recorder) toggleRec();
};

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
  recordSheet();
}

// What a recording holds, said before it starts (like Meet's "make sure everyone is ready"), with the choices
// remembered on this device: the layout, and what of the call shows in the picture.
const REC_DEFAULT = { layout: "speaker", reactions: true, hands: true, chat: true };
function recOptions() {
  try {
    return { ...REC_DEFAULT, ...JSON.parse(localStorage.getItem("juntos.rec") || "{}") };
  } catch (_) {
    return { ...REC_DEFAULT };
  }
}

function recordSheet() {
  const o = recOptions();
  const sheet = document.createElement("div");
  sheet.className = "sheet";
  const inner = document.createElement("div");
  inner.className = "sheetInner devices recSheet";
  const close = () => sheet.remove();
  const h = document.createElement("h3");
  h.textContent = t("Record this call");
  inner.append(h);
  const seg = document.createElement("div");
  seg.className = "seg";
  const choices = [
    ["speaker", t("Who's talking"), t("Big, with everyone else small")],
    ["grid", t("Everyone"), t("All the same size")],
  ];
  for (const [id, name, hint] of choices) {
    const b = document.createElement("button");
    b.dataset.layout = id;
    b.innerHTML = `<b></b><small></small>`;
    b.firstChild.textContent = name;
    b.lastChild.textContent = hint;
    b.onclick = () => {
      o.layout = id;
      for (const x of seg.children) x.classList.toggle("on", x === b);
    };
    b.classList.toggle("on", o.layout === id);
    seg.append(b);
  }
  inner.append(seg);
  const show = document.createElement("p");
  show.className = "small";
  show.textContent = t("Also show in the video:");
  inner.append(show);
  for (const [key, label] of [["reactions", t("Reactions")], ["hands", t("Raised hands")], ["chat", t("Chat messages")]]) {
    const l = document.createElement("label");
    l.className = "check";
    const c = document.createElement("input");
    c.type = "checkbox";
    c.name = key;
    c.checked = !!o[key];
    c.onchange = () => (o[key] = c.checked);
    l.append(c, document.createTextNode(label));
    inner.append(l);
  }
  const note = document.createElement("p");
  note.className = "small";
  note.textContent = t("Everyone's voices and the picture above, saved as a video on this device. Nothing is uploaded. Everyone sees that you're recording.");
  inner.append(note);
  const row = document.createElement("div");
  row.className = "row2";
  const cancel = document.createElement("button");
  cancel.className = "ghost";
  cancel.textContent = t("Cancel");
  cancel.onclick = close;
  const go = document.createElement("button");
  go.className = "primary";
  go.id = "recGo";
  go.textContent = t("Start recording");
  go.onclick = () => {
    localStorage.setItem("juntos.rec", JSON.stringify(o));
    close();
    startRec(o);
  };
  row.append(cancel, go);
  inner.append(row);
  sheet.append(inner);
  sheet.onclick = (e) => {
    if (e.target === sheet) close(); // a block: an onclick that returns false cancels the click (checkboxes stopped working)
  };
  document.body.append(sheet);
}

function startRec(opts) {
  if (S.recorder) return;
  S.recorder = new Recorder(() =>
    [...document.querySelectorAll("#grid .tile:not(.away)")].map((t) => ({
      id: t.dataset.id,
      video: t.querySelector("video"),
      name: t.dataset.id === "me" ? localStorage.getItem("name") || "" : t.querySelector(".nm").textContent, // no "(you)" in the file
      camoff: t.classList.contains("camoff"),
      screen: t.dataset.id === "me" ? !!S.screen : t.classList.contains("screen"),
      hand: S.hands.has(t.dataset.id),
      overlay: S.an.overlay(t.dataset.id), // drawings on a shared screen
      stream: t.dataset.id === "me" ? (S.micTrack ? new MediaStream([S.micTrack]) : null) : S.mesh.peers.get(t.dataset.id)?.stream,
    })).concat(S.boardBig && S.panel === "board" ? [{ id: "board", video: $("boardCanvas"), name: t("Board"), screen: true }] : []),
    opts,
  );
  S.recorder.start();
  paintRec();
  S.mesh.broadcast({ k: "rec", on: true });
}

// invite
$("invite").onclick = () => inviteSheet(`${location.origin}/r/${S.code}`, { t, toast, isPhone, locked: S.locked });

async function leave(why) {
  // why: set when the call ended you (removed, not let in); a click passes an event
  $("endedMsg").textContent = typeof why === "string" ? why : "";
  $("endedTitle").textContent = typeof why === "string" ? t("You're out of the call") : t("You left the call");
  if (S.recorder) await toggleRec();
  S.knocks?.clear();
  paintKnocks();
  S.mesh?.leave();
  S.mesh = null;
  S.br.reset();
  S.chat = S.chat.filter((c) => !c.room);
  closePip();
  capSync();
  const save = $("endedCaps");
  save.hidden = !S.transcript.length;
  save.onclick = saveTranscript;
  $("endedAct").hidden = !S.act.any();
  $("endedAct").onclick = () => S.act.download();
  $("endedNotes").hidden = !S.notes.any();
  $("endedNotes").onclick = () => S.notes.download();
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
  // switching tabs opens the small window by itself (Chrome / Edge, once the person allows it for the site)
  try {
    ms.setActionHandler("enterpictureinpicture", () => openPip());
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

// polls and Q&A (act.js): the panel lives in #actPane
S.act = new Activities({
  t,
  send: (m) => S.mesh?.broadcast(m),
  sendTo: (id, m) => S.mesh?.sendTo(id, m),
  hosts: () => S.mesh?.hosts || new Set(),
  amHost: () => !!S.isHost,
  myName: () => localStorage.getItem("name") || "",
  notify: toast,
  badge: () => {
    if (S.panel !== "act") {
      badge("bAct");
      badge("bMore");
    }
  },
});
S.act.mount($("actPane"));

// shared notes (notes.js): the whole call writes in one text, in #notesPane
S.notes = new Notes({
  t,
  send: (m) => S.mesh?.broadcast(m),
  sendTo: (id, m) => S.mesh?.sendTo(id, m),
  hosts: () => S.mesh?.hosts || new Set(),
  amHost: () => !!S.isHost,
  myName: () => localStorage.getItem("name") || "",
  names: () => [localStorage.getItem("name") || "", ...[...(S.mesh?.peers.values() || [])].map((p) => p.name || "")],
  notify: toast,
  badge: () => {
    if (S.panel !== "notes") {
      badge("bNotes");
      badge("bMore");
    }
  },
});
S.notes.mount($("notesPane"));

// drawing on a shared screen (annotate.js): a pen button on the shared screen's tile
S.an = new Annotate({
  t,
  send: (m) => S.mesh?.roomcast(m),
  sendTo: (id, m) => S.mesh?.sendTo(id, m),
  myId: () => S.mesh?.id || "me",
  myName: () => localStorage.getItem("name") || "",
  amHost: () => !!S.isHost,
  isHost: (id) => !!S.mesh?.hosts.has(id),
  name: (id) => (id === S.mesh?.id ? localStorage.getItem("name") || "" : S.mesh?.peers.get(id)?.name || t("Someone")),
  sharing: (id) => {
    if (id === "me") return !!S.screen;
    const tile = document.querySelector(`#grid .tile[data-id="${CSS.escape(id)}"]`);
    return !!tile && tile.classList.contains("screen") && !tile.classList.contains("away");
  },
  focus: (tile) => spotlight(tile),
  notify: toast,
});

// breakout rooms (breakout.js): the host's panel lives in #brPane, the bar and invitation at the top of the call
function brMoved() {
  for (const tile of document.querySelectorAll("#grid .tile[data-id]")) {
    const id = tile.dataset.id;
    if (id === "me") continue;
    const away = !S.br.same(id);
    if (tile.classList.contains("away") === away) continue;
    tile.classList.toggle("away", away);
    const p = S.mesh?.peers.get(id);
    if (p) applyVolume(tile, p);
    // together again: how I am (a hand raised in the room meanwhile)
    if (!away) S.mesh?.sendTo(id, { ...myState(), hand: S.hands.has("me") });
  }
  S.mesh?.reroute();
  layout();
  renderChat();
  renderPeople();
}
S.br = new Breakout({
  t,
  mesh: () => S.mesh,
  amHost: () => !!S.isHost,
  notify: toast,
  onMove: brMoved,
  onEnd: () => {
    S.chat = S.chat.filter((c) => !c.room); // room chat is deleted when the rooms end, like Meet
    renderChat();
  },
  call: $("call"),
});
S.br.mount($("brPane"));
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
