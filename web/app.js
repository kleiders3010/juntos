import { Mesh } from "./rtc.js";
import { Background, BACKGROUNDS } from "./bg.js";
import { Board, COLORS } from "./board.js";
import { Recorder } from "./rec.js";

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
  if (!code) return toast("That code doesn't look right");
  history.pushState({}, "", `/r/${code}`);
  route();
};

// ---------- camera and mic ----------
async function getMedia() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: S.facing, frameRate: { ideal: 24 } },
    });
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
      $("lobbyMsg").textContent = "No camera found. You can still talk.";
      return true;
    } catch (_) {
      S.mic = false;
      S.cam = false;
      $("lobbyMsg").textContent = "Camera and microphone are blocked. Allow them in your browser to be seen and heard.";
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
    if (S.bg) S.bg.stop();
  } else {
    if (!S.bg) S.bg = new Background(S.camTrack);
    try {
      await S.bg.set(mode);
    } catch (e) {
      toast("Backgrounds don't work on this device");
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
    el.title = on ? "Turn off" : "Turn on";
  }
  const meTile = document.querySelector('.tile[data-id="me"]');
  if (meTile) meTile.classList.toggle("muted", !S.mic);
}

// ---------- lobby ----------
async function openLobby() {
  show("lobby");
  $("name").value = localStorage.getItem("name") || "";
  $("pBg").innerHTML = svg("bg");
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
  toast(`Background: ${(BACKGROUNDS.find((b) => b.id === next) || { label: next }).label}`);
};
$("name").addEventListener("keydown", (e) => e.key === "Enter" && $("enter").click());
$("enter").onclick = async () => {
  const name = $("name").value.trim();
  if (!name) {
    $("name").focus();
    $("lobbyMsg").textContent = "Type your name so people know who you are.";
    return;
  }
  localStorage.setItem("name", name);
  // Joining before the camera and mic are ready would send nothing to the others.
  $("enter").disabled = true;
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
    layout();
    if (e.detail.name) toast(`${e.detail.name} left`);
    renderPeople();
  });
  mesh.addEventListener("someone-joining", (e) => toast(`${e.detail.name || "Someone"} joined`));
  mesh.addEventListener("full", (e) => toast(`This call is full (${e.detail.max} people)`));
  mesh.addEventListener("joined", (e) => {
    if (e.detail.count === 0) toast("You're the first one here. Invite people with the link.");
  });
  mesh.addEventListener("channel-open", (e) => {
    // catch the newcomer up: board, chat, how I am
    mesh.sendTo(e.detail.id, { k: "state", mic: S.mic, cam: S.cam, hand: S.hands.has("me") });
    if (S.board && S.board.strokes.length) mesh.sendTo(e.detail.id, S.board.snapshot());
    if (S.chat.length) mesh.sendTo(e.detail.id, { k: "history", chat: S.chat.slice(-200) });
    if (S.recorder) mesh.sendTo(e.detail.id, { k: "rec", on: true });
  });
  mesh.addEventListener("message", (e) => onMessage(e.detail.from, e.detail.msg));
  mesh.connect();
  window.addEventListener("beforeunload", () => mesh.leave());
}

function onMessage(from, m) {
  const p = S.mesh.peers.get(from);
  const who = (p && p.name) || "Someone";
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
    $("recDot").hidden = !m.on && !S.recorder;
    toast(m.on ? `${who} started recording` : `${who} stopped recording`);
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
  grid.appendChild(makeTile("me", `${localStorage.getItem("name")} (you)`));
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
  t.innerHTML = `<video autoplay playsinline></video><div class="avatar"></div><div class="label"><span class="micmark">${svg("micOff")}</span><span class="nm"></span><span class="hand" hidden>✋</span></div>`;
  t.querySelector(".nm").textContent = name;
  t.querySelector(".avatar").textContent = (name || "?").trim().charAt(0).toUpperCase();
  t.ondblclick = () => t.classList.toggle("big");
  return t;
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
    v.play().catch(() => tile.classList.add("tapToPlay"));
    watchVoice(tile, p.stream);
  }
  tile.classList.toggle("connecting", p.state !== "connected");
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
  if (navigator.mediaDevices.getDisplayMedia && !isPhone) extra.push(button("bScreen", "screen", "Share screen", toggleScreen));
  extra.push(button("bChat", "chat", "Chat", () => openPanel("chat")));
  extra.push(button("bBoard", "board", "Board", () => openPanel("board")));
  extra.push(button("bBg", "bg", "Background", () => openPanel("bg")));
  extra.push(button("bPeople", "people", "People", () => openPanel("people")));
  if (Recorder.supported()) extra.push(button("bRec", "rec", "Record", toggleRec));
  const react = button("bReact", "more", "React", openReactions);
  react.innerHTML = `<b class="emoji">✋</b><span>Hand / react</span>`;
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
  $("panelTitle").textContent = { chat: "Chat", board: "Board", bg: "Background", people: "People" }[which];
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
    who.textContent = c.from === "me" ? "You" : c.name;
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
      b.title = c === "#ffffff" ? "Eraser" : "Pen";
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
    clear.textContent = "Clear";
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
    box.textContent = "Turn on your camera to pick a background.";
    return;
  }
  for (const b of BACKGROUNDS) {
    const el = document.createElement("button");
    el.className = "bgChoice" + (S.bgMode === b.id ? " on" : "");
    if (b.src) el.style.backgroundImage = `url(${b.src})`;
    el.textContent = b.src ? "" : b.label;
    el.title = b.label;
    el.onclick = async () => {
      await applyBackground(b.id);
      renderBackgrounds();
    };
    box.append(el);
  }
  const up = document.createElement("button");
  up.className = "bgChoice";
  up.textContent = "Your picture…";
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
  add(`${localStorage.getItem("name")} (you)`, S.hands.has("me") ? "✋" : "");
  for (const p of S.mesh.peers.values()) add(p.name || "Joining…", (S.hands.has(p.id) ? "✋ " : "") + (p.state === "connected" ? "" : "· connecting"));
  $("bPeople")?.querySelector("span") && ($("bPeople").querySelector("span").textContent = `People (${S.mesh.peers.size + 1})`);
}

// hand and reactions
function setHand(id, on, who, quiet) {
  if (on) S.hands.add(id);
  else S.hands.delete(id);
  const tile = document.querySelector(`.tile[data-id="${id}"]`);
  if (tile) tile.querySelector(".hand").hidden = !on;
  if (on && !quiet && id !== "me") toast(`${who} raised a hand`);
  renderPeople();
}
function openReactions() {
  const box = $("reactions");
  if (!box.hidden) return (box.hidden = true);
  box.innerHTML = "";
  const hand = document.createElement("button");
  hand.className = "chip";
  hand.textContent = S.hands.has("me") ? "Lower hand" : "✋ Raise hand";
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
    toast("You're sharing your screen");
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

async function flipCamera() {
  S.facing = S.facing === "user" ? "environment" : "user";
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: S.facing, width: { ideal: 640 }, height: { ideal: 480 } } });
    S.camTrack?.stop();
    S.camTrack = s.getVideoTracks()[0];
    if (S.bg) {
      S.bg.stop();
      S.bg = null;
    }
    if (S.bgMode !== "none") await applyBackground(S.bgMode);
    refreshLocalVideo();
    await S.mesh.setTracks(S.micTrack, videoOut());
  } catch (_) {
    toast("Couldn't switch camera");
  }
}

// recording (on this device)
async function toggleRec() {
  if (S.recorder) {
    await S.recorder.stop();
    S.recorder = null;
    $("bRec").classList.remove("on");
    $("recDot").hidden = true;
    S.mesh.broadcast({ k: "rec", on: false });
    toast("Recording saved to your downloads");
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
  $("bRec").classList.add("on");
  $("recDot").hidden = false;
  S.mesh.broadcast({ k: "rec", on: true });
  toast("Recording. Everyone in the call can see that.");
}

// invite
$("invite").onclick = async () => {
  const url = `${location.origin}/r/${S.code}`;
  if (navigator.share && isPhone) {
    try {
      await navigator.share({ title: "Join my call", text: "Join my call on Juntos", url });
      return;
    } catch (_) {}
  }
  try {
    await navigator.clipboard.writeText(url);
    toast("Link copied. Send it to anyone.");
  } catch (_) {
    prompt("Copy this link:", url);
  }
};

async function leave() {
  if (S.recorder) await toggleRec();
  S.mesh?.leave();
  S.mesh = null;
  closePanel();
  show("ended");
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
