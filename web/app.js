import { Mesh, randomId } from "./rtc.js";
import { newHost } from "./hostauth.js";
import { Background, BACKGROUNDS } from "./bg.js";
import { Light, watchDark } from "./light.js";
import { Board, COLORS, SIZES, TOOLS } from "./board.js";
import { Recorder } from "./rec.js";
import { t, translatePage, LANG } from "./i18n.js";
import * as captr from "./captr.js";
import { Attendance } from "./attend.js";
import { Activities } from "./act.js";
import { Breakout } from "./breakout.js";
import { Notes } from "./notes.js";
import { Annotate } from "./annotate.js";
import { openFeedback } from "./feedback.js";
import { scheduleSheet, inviteSheet, paintUpcoming, securityFields, keepSecurity, passOf, callUrl, newPass, PASS_RE } from "./schedule.js";
import { Net } from "./net.js";

translatePage();
const t2 = t; // the translator, where "t" is a tile

// ---------- small helpers ----------
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
// The page and its signaling share one host (meet.jurisgames.com); ?signal= points elsewhere for testing.
// where the page itself is served from: "/" on meet.jurisgames.com, "/juntos/" on the copy on GitHub Pages
const BASE = new URL("./", import.meta.url).pathname;
// the copy on GitHub Pages (used when Cloudflare is down) has no room server of its own
const MIRROR = location.hostname.endsWith(".github.io");
const SIGNAL = params.get("signal") || (location.protocol === "https:" && !MIRROR ? `wss://${location.host}` : "wss://meet.jurisgames.com");
// the second room server (the game host, same room code): used when the first can't be reached; tests: ?signal2=
const SIGNAL2 = params.get("signal2") || (params.get("signal") ? null : "wss://games.jurisgames.com/juntos");
// Finding each other through public Nostr relays (rtc.js, nsig.js): on by default; a page pointed at a test server
// (?signal=) uses only that server, unless test relays are given (?relays=ws://...,ws://...)
const RELAYS = params.get("relays") ? params.get("relays").split(",").filter((u) => /^wss?:\/\//.test(u)) : params.get("signal") ? null : [];
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
  popOut: "M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z",
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

function toast(text, action) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = text;
  if (action) {
    const b = document.createElement("button");
    b.className = "toastBtn";
    b.name = action.name || "";
    b.textContent = action.label;
    b.onclick = () => {
      t.remove();
      action.run();
    };
    t.append(b);
  }
  $("toasts").appendChild(t);
  setTimeout(() => t.remove(), action ? 10000 : 4000);
}

function show(page) {
  for (const p of document.querySelectorAll(".page")) p.hidden = p.id !== page;
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
// how good each connection is, the bars, data saver / audio only, stepping down on a weak connection
S.netq = new Net({ mesh: () => S.mesh, t, grid: () => $("grid"), keepVideo: () => !!S.recorder || !!S.pip, changed: () => paintNet() });

// ---------- "Send feedback": what happened in the call, without names or content ----------
// joins, leaves, reconnects and connection states, by time; people are p1, p2... (never names)
const DIAG = [];
function diag(ev, extra) {
  DIAG.push({ at: Date.now(), ev, ...extra });
  if (DIAG.length > 200) DIAG.shift();
}
function callDetails() {
  const ids = new Map();
  const who = (id) => (id ? (ids.has(id) || ids.set(id, `p${ids.size + 1}`), ids.get(id)) : undefined);
  const ago = (at) => `${Math.round((Date.now() - at) / 1000)}s ago`;
  const peers = S.mesh ? [...S.mesh.peers.values()] : [];
  return {
    app: document.referrer.startsWith("android-app://") ? "android app" : "web",
    call: {
      inCall: !!S.mesh,
      people: S.mesh ? peers.length + 1 : 0,
      host: !!S.isHost,
      locked: !!S.locked,
      passcode: !!S.hasPass,
      mic: !!S.mic,
      camera: !!S.cam,
      sharingScreen: !!S.screen,
      background: S.bgMode,
      videoQuality: S.netq.pref,
      stepDown: S.netq.level,
      recording: !!S.recorder,
    },
    devices: S.devKinds || null,
    connections: peers.map((p) => ({ p: who(p.id), state: p.state, ice: p.pc ? p.pc.iceConnectionState : "tree", viaRelay: !!p.relayTried })),
    // how each person's sound is being played here (a voice that arrives but isn't heard)
    playback: {
      speakerPicked: !!S.sink,
      boostContext: S.out ? S.out.state : null,
      people: peers.map((p) => {
        const tile = document.querySelector(`.tile[data-id="${p.id}"]`);
        const v = tile?.querySelector("audio");
        const tr = p.stream?.getAudioTracks()[0];
        return {
          p: who(p.id),
          tile: !!tile,
          paused: v ? v.paused : null,
          started: v ? v.readyState > 0 : null,
          muted: v ? v.muted : null,
          volume: v ? v.volume : null,
          ownSpeaker: v ? !!v.sinkId : null,
          tapToHear: !!tile?.classList.contains("tapToPlay"),
          otherRoom: !!tile?.classList.contains("away"),
          boosted: !!p.boost,
          sound: tr ? { state: tr.readyState, enabled: tr.enabled, muted: tr.muted } : null,
        };
      }),
    },
    events: DIAG.map(({ at, ev, id, ...x }) => ({ when: ago(at), ev, p: who(id), ...x })),
    measurements: S.netq.log.slice(-120).map((m) => ({ when: ago(m.at), p: who(m.id), rttMs: m.rtt, lossPct: m.loss, jitterMs: m.jitter, kbps: m.kbps, bars: m.bars })),
  };
}
function feedback() {
  openFeedback({
    app: "juntos",
    t,
    toast,
    detailsLabel: "Include recent call technical details",
    detailsNote: "Connection numbers (delay, lost packets, video size), how many people, devices by kind, browser and system, recent errors. Never sound, video, chat, notes or anyone's name.",
    details: callDetails,
  });
}

// ---------- routing ----------
function route() {
  const m = location.pathname.slice(BASE.length - 1).match(/^\/r\/([a-z0-9-]{4,64})$/);
  if (m) {
    S.code = m[1];
    // a link with the passcode in it (".../r/code#p=123456"): keep it, and take it off the address bar
    const hp = location.hash.match(/^#p=([A-Za-z0-9]{4,10})$/);
    if (hp) {
      try {
        localStorage.setItem(`juntos.pass.${S.code}`, hp[1]);
      } catch {}
      history.replaceState(history.state, "", `${BASE}r/${S.code}${location.search}`);
    }
    openLobby();
  } else {
    show("home");
    paintUpcoming($("upcoming"), schedOpts());
  }
}
window.addEventListener("popstate", route);

// who can join a new call: everyone with the link (default), people ask to join, a passcode
const startSec = securityFields(t);
$("startOpts").append(startSec.box);
const paintStartOpts = () => {
  const v = { ask: startSec.box.querySelector('[name="ask"]').checked, pass: startSec.box.querySelector('[name="usePass"]').checked };
  $("startOpts").querySelector("summary").textContent =
    v.ask && v.pass ? t("Who can join: passcode, and they ask") : v.ask ? t("Who can join: people ask, you let them in") : v.pass ? t("Who can join: people with the passcode") : t("Who can join: anyone with the link");
};
startSec.box.addEventListener("change", paintStartOpts);
paintStartOpts();
if (startSec.box.querySelector('[name="ask"]').checked || startSec.box.querySelector('[name="usePass"]').checked) $("startOpts").open = true;
$("start").onclick = () => {
  const sec = startSec.value();
  if (!sec) return ($("startOpts").open = true);
  // who starts the call is its host (mute, remove, lock): a secret key only this device keeps; the call's code is
  // made from its public half, so everyone in the call can check the host's choices without a server
  const { code, key } = newHost();
  try {
    localStorage.setItem(`juntos.host.${code}`, key);
  } catch {}
  keepSecurity(code, sec);
  history.pushState({}, "", `${BASE}r/${code}`);
  route();
};
// planned calls: "Schedule for later" and the list of calls planned on this device
const schedOpts = () => ({ t, toast, isPhone, newHost, claim: claimRoom, changed: () => paintUpcoming($("upcoming"), schedOpts()) });
// A planned call with a passcode or "ask to join": its host claims the room right away (so the passcode holds before
// the host arrives), then hangs up. Nobody else is in a room made a second ago.
function claimRoom(code, key, opts) {
  // on both room servers: the passcode holds whichever one the call ends up using
  for (const url of [SIGNAL, SIGNAL2].filter(Boolean))
    try {
      const ws = new WebSocket(`${url}/ws/${code}`);
      ws.onopen = () => ws.send(JSON.stringify({ t: "hello", id: randomId(), name: "", key, claim: true, opts }));
      ws.onmessage = (e) => JSON.parse(e.data).t === "room" && ws.close();
      setTimeout(() => ws.close(), 15000);
    } catch {}
}
$("schedule").onclick = () => scheduleSheet(schedOpts());
$("joinForm").onsubmit = (e) => {
  e.preventDefault();
  const code = codeFrom($("joinCode").value);
  if (!code) return toast(t("That code doesn't look right"));
  history.pushState({}, "", `${BASE}r/${code}`);
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

// the camera picture before any background: brightened when "Adjust video lighting" is on
function camSrc() {
  if (!S.camTrack) return null;
  if (!S.lightOn) return S.camTrack;
  if (S.light?.camera !== S.camTrack) {
    S.light?.stop();
    S.light = new Light(S.camTrack);
  }
  return S.light.track;
}
// turning the adjustment on or off: the background effect is rebuilt on the new picture
async function setLight(on) {
  S.lightOn = on;
  localStorage.setItem("juntos.light", on ? "on" : "off");
  if (!on) {
    S.light?.stop();
    S.light = null;
  } else S.darkWatch?.();
  if (S.bg) {
    S.bg.stop();
    S.bg = null;
  }
  if (S.bgMode !== "none" && S.camTrack) await applyBackground(S.bgMode);
  refreshLocalVideo();
  await S.mesh?.setTracks(audioOut(), videoOut());
}
// like Meet: while it is off, a picture that stays too dark gets the suggestion to turn it on (once per call)
function suggestLight() {
  S.darkWatch?.();
  S.darkWatch = null;
  if (S.lightOn || !S.camTrack || localStorage.getItem("juntos.light") === "off") return;
  S.darkWatch = watchDark(S.camTrack, () => {
    S.darkWatch = null;
    if (!S.lightOn && S.cam) toast(t("You look dark"), { label: t("Adjust lighting"), name: "lightOn", run: () => setLight(true) });
  });
}

// what my picture is: a shared screen goes out whether or not the camera is on
function videoOut() {
  if (S.screen) return S.screen;
  if (!S.cam) return null;
  return S.bg && S.bgMode !== "none" ? S.bg.track : camSrc();
}

async function applyBackground(mode) {
  S.bgMode = mode;
  localStorage.setItem("bg", mode);
  if (!S.camTrack) return;
  if (mode === "none") {
    if (S.bg) await S.bg.set("none"); // back to the live camera (stop() alone left the call on the last drawn picture)
  } else {
    if (S.bg && S.bg.camera !== camSrc()) {
      S.bg.stop();
      S.bg = null;
    }
    if (!S.bg) S.bg = new Background(camSrc());
    S.bg.onBroken = () => toast(t("Backgrounds don't work on this device"));
    try {
      await S.bg.set(mode);
    } catch (e) {
      toast(t("Backgrounds don't work on this device"));
      S.bgMode = "none";
    }
  }
  refreshLocalVideo();
  if (S.mesh) await S.mesh.setTracks(audioOut(), videoOut());
}

function refreshLocalVideo() {
  const t = S.screen || (S.bg && S.bgMode !== "none" ? S.bg.track : camSrc());
  const stream = t ? new MediaStream([t]) : null;
  const pv = $("previewVideo");
  if (pv.srcObject?.getVideoTracks()[0] !== t) pv.srcObject = stream;
  const showing = !!(t && (S.screen || S.cam)); // a shared screen shows even with the camera off
  $("previewOff").hidden = showing;
  const self = document.querySelector('.tile[data-id="me"] video');
  if (self && self.srcObject?.getVideoTracks()[0] !== t) self.srcObject = stream;
  const tile = document.querySelector('.tile[data-id="me"]');
  if (tile) {
    tile.classList.toggle("camoff", !showing);
    tile.classList.toggle("mirror", !S.screen && S.facing === "user");
  }
  S.an?.update();
}

// ---------- what each person may do (the room server keeps it; every device applies it) ----------
S.perms = { talk: true, share: true, chat: true, caps: true };
S.talkOv = {}; // person id -> may speak, where a host chose for that person
function roleOf(id) {
  if (id === "me" || id === S.mesh?.id) return S.isOwner ? "host" : S.isHost ? "co" : "";
  return S.mesh?.owners.has(id) ? "host" : S.mesh?.hosts.has(id) ? "co" : "";
}
function may(id, key) {
  if (roleOf(id)) return true;
  if (key !== "talk") return S.perms[key] !== false;
  const o = S.talkOv[id === "me" ? S.mesh?.id : id];
  return o === undefined ? S.perms.talk !== false : o;
}
// my voice goes out only while my own switch is on and I'm allowed to speak
function micLive() {
  return !!S.mic && may("me", "talk");
}
// not allowed to speak: say so and raise my hand to ask (my own switch stays as it is)
function askToSpeak() {
  if (!S.hands.has("me")) {
    toggleHand();
    toast(t("A host hasn't allowed you to speak. Your hand is raised to ask."));
  } else toast(t("A host hasn't allowed you to speak yet. Your hand is raised."));
}

// how I am, for the others (and for their recordings: a shared screen leads the picture)
function myState() {
  return { k: "state", mic: micLive(), cam: S.cam, screen: !!S.screen };
}

function setMic(on) {
  // not allowed to speak: the mic button asks to speak; my own switch stays as I left it
  if (S.mesh && !may("me", "talk")) return askToSpeak();
  S.mic = on;
  if (S.micTrack) S.micTrack.enabled = micLive();
  if (!on) document.querySelector('#grid .tile[data-id="me"]')?.classList.remove("speaking"); // dark at once when muted
  paintToggles();
  if (S.mesh) S.mesh.broadcast(myState());
  capSync();
}

async function setCam(on) {
  // a camera that stopped (unplugged, taken by another app) is opened again when turned back on
  if (on && S.camTrack && S.camTrack.readyState === "ended" && !(await useCamera(camConstraints(localStorage.getItem("camId"))))) return;
  S.cam = on;
  if (S.camTrack) S.camTrack.enabled = on;
  refreshLocalVideo();
  paintToggles();
  if (S.mesh) {
    await S.mesh.setTracks(audioOut(), videoOut());
    S.mesh.broadcast(myState());
  }
}

function paintToggles() {
  for (const [id, on, a, b] of [
    ["pMic", S.mic, "mic", "micOff"],
    ["pCam", S.cam, "cam", "camOff"],
    ["bMic", micLive(), "mic", "micOff"],
    ["bCam", S.cam, "cam", "camOff"],
  ]) {
    const el = $(id);
    if (!el) continue;
    el.innerHTML = svg(on ? a : b) + (el.dataset.label ? `<span>${el.dataset.label}</span>` : "");
    el.classList.toggle("danger", !on);
    el.title = on ? t("Turn off") : t("Turn on");
  }
  const noTalk = !!S.mesh && !may("me", "talk");
  $("bMic")?.classList.toggle("blocked", noTalk);
  if (noTalk) $("bMic")?.setAttribute("title", t("A host hasn't allowed you to speak"));
  const meTile = document.querySelector('.tile[data-id="me"]');
  if (meTile) meTile.classList.toggle("muted", !S.mic);
}

// ---------- lobby ----------
async function openLobby() {
  show("lobby");
  $("name").value = localStorage.getItem("name") || "";
  askPass();
  $("pBg").innerHTML = svg("bg");
  $("pDev").innerHTML = svg("gear");
  if (!S.camStream) await (S.mediaReady ||= getMedia());
  refreshLocalVideo();
  paintToggles();
  if (S.bgMode !== "none" && S.camTrack) applyBackground(S.bgMode);
  ($("name").value ? $("enter") : $("name")).focus();
  lobbyMeter();
}
// The lobby asks for the passcode only when the call has one (the host never types it). The answer is yes / no.
async function askPass(msg) {
  const box = $("passcode");
  box.value = passOf(S.code);
  if (msg) {
    box.hidden = false;
    $("lobbyMsg").textContent = msg;
    return box.focus();
  }
  box.hidden = true;
  if (localStorage.getItem(`juntos.host.${S.code}`)) return;
  // the link already carries the passcode: no need to ask the server (each ask counts against its free daily requests)
  if (box.value) return (box.hidden = false);
  // through the relays the lobby doesn't ask the server either: a call that needs a passcode says so on joining
  if (RELAYS) return;
  try {
    const r = await (await fetch(`${SIGNAL.replace(/^ws/, "http")}/info/${S.code}`, { cache: "no-store" })).json();
    box.hidden = !r.pass;
    if (r.pass && !box.value) $("lobbyMsg").textContent = t("This call has a passcode. Type it to join.");
  } catch {}
}
// the passcode wasn't right (or is missing): back to the lobby to type it
function passRefused(m) {
  S.netq.stop();
  S.mesh?.leave();
  S.mesh = null;
  S.knocks?.clear();
  paintKnocks();
  closePanel();
  callNotice(false);
  try {
    if (m.wrong) localStorage.removeItem(`juntos.pass.${S.code}`);
  } catch {}
  show("lobby");
  $("enter").disabled = false;
  lobbyMeter();
  askPass(m.wait ? t("Too many wrong tries. Wait {n} seconds and try again.", { n: m.wait }) : m.wrong ? t("That passcode isn't right. Check it and try again.") : t("This call has a passcode. Type it to join."));
  if (m.wrong) $("passcode").select();
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
  if (!$("passcode").hidden) {
    const pass = $("passcode").value.trim();
    if (!PASS_RE.test(pass)) {
      $("passcode").focus();
      $("lobbyMsg").textContent = t("Type the passcode: 4 to 10 letters or numbers.");
      return;
    }
    try {
      localStorage.setItem(`juntos.pass.${S.code}`, pass);
    } catch {}
  }
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
  S.hasPass = false;
  S.waiting = false;
  S.knocks = new Map();
  paintKnocks();
  watchMuted();
  suggestLight();
  S.mesh = new Mesh({
    room: S.code,
    name,
    signalUrl: SIGNAL,
    backupUrl: SIGNAL2,
    relays: RELAYS,
    key: localStorage.getItem(`juntos.host.${S.code}`),
    knock: !!localStorage.getItem(`juntos.out.${S.code}`),
    pass: passOf(S.code),
    opts: (() => {
      try {
        return JSON.parse(localStorage.getItem(`juntos.start.${S.code}`) || "null");
      } catch {
        return null;
      }
    })(),
  });
  const mesh = S.mesh;
  diag("enter");
  // attendance, for the hosts (People > Save attendance, and after leaving)
  S.att ||= new Attendance();
  S.att.start(S.code, name);
  S.wasHost = false;
  mesh.addEventListener("peer", (e) => {
    const p = mesh.peers.get(e.detail.id);
    if (p?.name) S.att.came(e.detail.id, p.name);
  });
  mesh.addEventListener("left", (e) => S.att.went(e.detail.id));
  navigator.mediaDevices?.enumerateDevices?.().then((l) => (S.devKinds = l.reduce((o, d) => ((o[d.kind] = (o[d.kind] || 0) + 1), o), {}))).catch(() => {});
  const states = new Map();
  for (const ev of ["signal-open", "signal-lost", "joined", "full"]) mesh.addEventListener(ev, (e) => diag(ev, e.detail?.count != null ? { count: e.detail.count } : undefined));
  mesh.addEventListener("someone-joining", (e) => diag("join", { id: e.detail.id }));
  mesh.addEventListener("left", (e) => diag("leave", { id: e.detail.id }));
  mesh.addEventListener("host", (e) => diag(`host:${e.detail.t}`));
  mesh.addEventListener("peer", (e) => {
    const p = mesh.peers.get(e.detail.id);
    if (p && states.get(p.id) !== p.state) {
      states.set(p.id, p.state);
      diag("connection", { id: p.id, state: p.state });
    }
  });
  mesh.addEventListener("host", (e) => onHost(e.detail));
  mesh.setTracks(audioOut(), videoOut());
  if (S.micTrack) S.micTrack.enabled = micLive();
  mesh.addEventListener("peer", (e) => renderPeer(e.detail.id));
  mesh.addEventListener("left", (e) => {
    document.querySelector(`.tile[data-id="${e.detail.id}"]`)?.remove();
    S.hands.delete(e.detail.id);
    S.netq.left(e.detail.id);
    S.pinAll = S.pinAll.filter((x) => x !== e.detail.id);
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
    if (S.isHost && S.pinAll.length) mesh.sendTo(e.detail.id, { k: "pinall", ids: S.pinAll });
    if (S.board && S.board.items.length) mesh.sendTo(e.detail.id, S.board.snapshot());
    const mainChat = S.chat.filter((c) => !c.room); // a breakout room's chat stays in the room
    if (mainChat.length) mesh.sendTo(e.detail.id, { k: "history", chat: mainChat.slice(-200) });
    if (S.recorder) mesh.sendTo(e.detail.id, { k: "rec", on: true });
    if (S.capsOn) mesh.sendTo(e.detail.id, { k: "capwant", on: true });
    if (S.act.any()) mesh.sendTo(e.detail.id, S.act.snapshotFor(e.detail.id));
    S.br.greet(e.detail.id);
    S.notes.greet(e.detail.id);
    S.an.greet(e.detail.id);
    S.netq.greet(e.detail.id);
  });
  mesh.addEventListener("message", (e) => onMessage(e.detail.from, e.detail.msg));
  S.br.reset();
  mesh.route = (id) => S.br.same(id);
  mesh.connect();
  capReset();
  S.act.reset(S.code);
  S.notes.reset(S.code);
  callControls();
  S.netq.start();
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
  else if (S.netq.note()) {
    text = S.netq.note();
    cls = "warn";
  }
  el.hidden = !text;
  el.textContent = text;
  el.className = `netState ${cls}`;
}
$("netState").onclick = () => $("invite").click();

function onMessage(from, m) {
  const p = S.mesh.peers.get(from);
  const who = (p && p.name) || t("Someone");
  if (S.netq.receive(from, m)) return; // what they need from my picture, how their connection is
  // chat, hands, reactions and captions from someone in another breakout room aren't for me
  if (["chat", "hand", "react", "cap", "ana", "and", "anc", "ano", "anp", "ans"].includes(m.k) && !S.br.same(from)) return;
  if (S.br.receive(from, m)) {
    // breakout rooms
  } else if (m.k === "chat") {
    if (!may(from, "chat")) return;
    addChat({ from, name: who, text: String(m.text).slice(0, 2000), at: Date.now() });
  } else if (m.k === "history") {
    for (const c of m.chat || []) if (!S.chat.some((x) => x.at === c.at && x.text === c.text)) S.chat.push(c);
    S.chat.sort((a, b) => a.at - b.at);
    renderChat();
  } else if (m.k === "state") {
    const tile = document.querySelector(`.tile[data-id="${from}"]`);
    if (tile) {
      tile.dataset.mic = m.mic ? "1" : "0";
      const scr = !!m.screen && may(from, "share"); // a screen shared without permission isn't shown
      tile.classList.toggle("muted", !m.mic || !may(from, "talk"));
      tile.classList.toggle("camoff", (!m.cam && !scr) || (!!m.screen && !scr)); // their shared screen shows even with their camera off
      tile.classList.toggle("screen", scr);
      layout();
    }
    if (m.hand !== undefined) setHand(from, m.hand, who, true);
  } else if (m.k === "hand") {
    setHand(from, m.on, who);
  } else if (m.k === "pinall") {
    if (roleOf(from) && Array.isArray(m.ids)) takePinAll(m.ids.filter((x) => typeof x === "string"), who);
  } else if (m.k === "lowerhand") {
    if (!roleOf(from) || typeof m.id !== "string") return;
    if ((m.id === "*" || m.id === S.mesh.id) && S.hands.has("me")) {
      toggleHand();
      toast(t("{name} lowered your hand", { name: who }));
    }
    if (m.id === "*") for (const h of [...S.hands]) h !== "me" && setHand(h, false, "", true);
    else if (m.id !== S.mesh.id) setHand(m.id, false, "", true);
  } else if (m.k === "react") {
    react(from, m.e);
  } else if (m.k === "cap") {
    const lang = typeof m.lang === "string" ? m.lang.slice(0, 20) : "";
    if (lang) S.capSeen.add(captr.base(lang));
    if (S.capsOn) showCap(from, who, String(m.text || "").slice(0, 500), !!m.final, false, lang);
  } else if (m.k === "capwant") {
    capWanted(from, !!m.on && may(from, "caps"), who);
  } else if (m.k === "capno") {
    if (S.capsOn) showCap(from, who, m.why === "browser" ? t("(their browser can't make captions)") : m.why === "broken" ? t("(their captions aren't working on their device right now)") : t("(they turned off captions of their voice)"), true, true);
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
  watchMe();
  watchDevices();
  refreshLocalVideo();
  paintToggles();
  layout();
}

function makeTile(id, name) {
  const t = document.createElement("div");
  t.className = "tile";
  t.dataset.id = id;
  t.innerHTML = `<video autoplay playsinline></video><div class="avatar"></div><div class="label"><span class="micmark">${svg("micOff")}</span><span class="nm"></span><span class="hand" hidden>✋</span><button class="bars" hidden><i></i><i></i><i></i><i></i></button></div><div class="status" hidden></div><button class="fsBtn" title="${t2("Full screen")}">${svg("full")}</button>${id === "me" || isPhone ? "" : `<button class="popBtn" name="popOut" title="${t2("Open in new window")}">${svg("popOut")}</button><div class="poppedNote"></div>`}${id === "me" ? "" : `<button class="volBtn" title="${t2("Volume")}"></button><audio autoplay></audio>`}`;
  // the voice plays from its own <audio>: a video element with no picture (camera off, or video not sent to
  // save data) never starts, and its sound would never start with it
  if (id !== "me") t.querySelector("video").muted = true;
  t.querySelector(".nm").textContent = name;
  t.querySelector(".avatar").textContent = (name || "?").trim().charAt(0).toUpperCase();
  t.querySelector(".fsBtn").onclick = (e) => {
    e.stopPropagation();
    spotlight(t);
  };
  const pop = t.querySelector(".popBtn");
  if (pop)
    pop.onclick = (e) => {
      e.stopPropagation();
      popOut(t);
    };
  t.ondblclick = () => spotlight(t);
  t.querySelector(".poppedNote")?.addEventListener("click", (e) => {
    e.stopPropagation();
    dock();
  });
  // a picture paused to save data: tapping it makes it the big one, which is then shown
  t.onclick = () => {
    if (t.classList.contains("paused") && !t.classList.contains("spot")) spotlight(t);
  };
  t.querySelector(".bars").onclick = (e) => {
    e.stopPropagation();
    netPop(t);
  };
  const vb = t.querySelector(".volBtn");
  if (vb)
    vb.onclick = (e) => {
      e.stopPropagation();
      openVolume(t);
    };
  return t;
}

// the details behind the connection bars
function netPop(tile) {
  const had = tile.querySelector(".netPop");
  document.querySelector(".netPop")?.remove();
  if (had) return;
  const pop = document.createElement("div");
  pop.className = "netPop volPop";
  for (const line of S.netq.details(tile.dataset.id)) {
    const p = document.createElement("p");
    p.textContent = line;
    pop.append(p);
  }
  pop.onclick = (e) => e.stopPropagation();
  pop.ondblclick = (e) => e.stopPropagation();
  tile.append(pop);
  const away = (e) => {
    if (pop.contains(e.target) || e.target.closest?.(".bars")) return;
    pop.remove();
    document.removeEventListener("pointerdown", away, true);
  };
  setTimeout(() => document.addEventListener("pointerdown", away, true));
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
  const v = tile.querySelector("audio");
  // in another breakout room, or not allowed to speak: not heard
  const pct = tile.classList.contains("away") || !may(tile.dataset.id, "talk") ? 0 : volFor(p.name);
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
    const shown = tile.classList.contains("away") ? 0 : volFor(p.name); // my own volume choice, not the host's permission
    b.innerHTML = svg(shown === 0 ? "volOff" : "vol") + (shown === 100 ? "" : `<span>${shown}%</span>`);
    b.classList.toggle("changed", shown !== 100);
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

// Pins, like Meet's: the button on a picture makes it big; with someone already big, it pins this one too (up to
// 6, sharing the big space); on a pinned one it unpins it. Esc unpins everyone. Only on this device, unless a host
// pins someone for everyone (up to 3).
const PIN_MAX = 6; // pinned: Meet's limit for yourself
const PIN_ALL_MAX = 3; // pinned: Meet's limit for a host pinning for everyone
function spotlight(tile, on = !tile.classList.contains("spot")) {
  const spots = [...document.querySelectorAll(".tile.spot")];
  if (on && !spots.includes(tile) && spots.length >= PIN_MAX) return toast(t("You can pin up to {n} people", { n: PIN_MAX }));
  tile.classList.toggle("spot", on);
  if (on) tile.dataset.pinAt = Date.now();
  paintPins();
}
function unpinAll() {
  for (const x of document.querySelectorAll(".tile.spot")) x.classList.remove("spot");
  paintPins();
}
function paintPins() {
  const any = !!document.querySelector(".tile.spot");
  $("grid").classList.toggle("hasSpot", any);
  for (const x of document.querySelectorAll("#grid .tile")) {
    const b = x.querySelector(".fsBtn");
    if (!b) continue;
    const on = x.classList.contains("spot");
    b.innerHTML = svg(on ? "fullExit" : "full");
    b.title = on ? t2("Unpin") : any ? t2("Pin too") : t2("Full screen");
  }
  layout();
}
addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.querySelector(".tile.spot")) unpinAll();
});
// Like Meet's "Open in new window": someone's shared screen moves to a window of its own (put it on another screen,
// size it as you like). Closing that window brings it back; it closes by itself when the sharing stops or they leave.
function popOut(tile) {
  if (S.popped) dock();
  const id = tile.dataset.id;
  const w = window.open("", `juntos-screen-${id}`, "popup,width=1024,height=640");
  if (!w) return toast(t("Your browser blocked the new window"));
  const d = w.document;
  d.title = t("{name}'s screen", { name: S.mesh.peers.get(id)?.name || t("Someone") });
  d.body.innerHTML = "";
  d.body.style.cssText = "margin:0;background:#000;overflow:hidden";
  const v = d.createElement("video");
  v.autoplay = v.playsInline = v.muted = true; // the sound keeps playing in the call
  v.style.cssText = "width:100vw;height:100vh;object-fit:contain;display:block";
  const back = d.createElement("button");
  back.textContent = t("Back to the call");
  back.name = "dock";
  back.style.cssText = "position:fixed;top:12px;right:12px;padding:8px 14px;border:0;border-radius:10px;background:rgba(0,0,0,.6);color:#fff;font:14px system-ui;cursor:pointer";
  back.onclick = () => dock();
  d.body.append(v, back);
  tile.classList.add("popped");
  tile.querySelector(".poppedNote").textContent = t("Showing in its own window. Click to bring it back.");
  S.popped = { id, w, v, tile };
  const follow = () => {
    const p = S.popped;
    if (!p || p.w !== w) return clearInterval(p?.timer);
    if (w.closed || !tile.isConnected || !tile.classList.contains("screen")) return dock();
    const src = tile.querySelector("video").srcObject;
    if (v.srcObject !== src) v.srcObject = src; // the picture can be renegotiated
    if (v.paused && src) v.play().catch(() => {});
  };
  follow();
  S.popped.timer = setInterval(follow, 500);
  w.addEventListener("pagehide", () => setTimeout(() => S.popped?.w === w && dock(), 0));
  w.focus();
  layout();
}
function dock() {
  const p = S.popped;
  if (!p) return;
  S.popped = null;
  clearInterval(p.timer);
  p.tile.classList.remove("popped");
  if (!p.w.closed) p.w.close();
  layout();
}
addEventListener("pagehide", () => S.popped && !S.popped.w.closed && S.popped.w.close());

// a host pins people for everyone: everyone's view shows those (each person can still change their own)
S.pinAll = []; // ids the hosts pinned for everyone
function tileOf(id) {
  return document.querySelector(`#grid .tile[data-id="${id === S.mesh?.id ? "me" : id}"]`);
}
function pinForAll(id, on) {
  const ids = on ? [...S.pinAll.filter((x) => x !== id), id] : S.pinAll.filter((x) => x !== id);
  if (ids.length > PIN_ALL_MAX) return toast(t("You can pin up to {n} people for everyone", { n: PIN_ALL_MAX }));
  S.mesh.roomcast({ k: "pinall", ids });
  takePinAll(ids);
}
function takePinAll(ids, by) {
  const was = S.pinAll;
  S.pinAll = ids.slice(0, PIN_ALL_MAX);
  for (const id of was) if (!S.pinAll.includes(id)) tileOf(id)?.classList.remove("spot");
  if (S.pinAll.length) for (const x of document.querySelectorAll(".tile.spot")) if (!S.pinAll.includes(x.dataset.id === "me" ? S.mesh.id : x.dataset.id)) x.classList.remove("spot");
  for (const id of S.pinAll) tileOf(id)?.classList.add("spot");
  paintPins();
  renderPeople();
  if (by && S.pinAll.length) {
    const names = S.pinAll.map((id) => (id === S.mesh.id ? t("you") : S.mesh.peers.get(id)?.name || "")).filter(Boolean).join(", ");
    toast(t("{name} pinned {who} for everyone", { name: by, who: names }));
  }
}

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
    v.play().catch(() => {});
    watchVoice(tile, p.stream);
  }
  const a = tile.querySelector("audio");
  const voice = p.stream.getAudioTracks()[0];
  if (voice && a.srcObject?.getAudioTracks()[0] !== voice) {
    a.srcObject = new MediaStream([voice]);
    if (S.sink) a.setSinkId?.(S.sink).catch(() => {});
    a.play().catch(() => tile.classList.add("tapToPlay"));
  }
  applyVolume(tile, p);
  paintStatus(tile, p);
  paintNet();
  renderPeople();
}

// My own tile lights up while I talk too: a quick sign that my microphone works. It follows the microphone in
// use (switched in Devices), and stays dark while muted.
function watchMe() {
  clearInterval(watchMe.timer);
  const ac = (watchVoice.ac ||= new (window.AudioContext || window.webkitAudioContext)());
  let tr = null, an = null;
  const buf = new Uint8Array(512);
  watchMe.timer = setInterval(() => {
    const tile = document.querySelector('#grid .tile[data-id="me"]');
    if (!tile) return clearInterval(watchMe.timer);
    if (S.micTrack !== tr) {
      tr = S.micTrack;
      an = null;
      if (tr) {
        an = ac.createAnalyser();
        an.fftSize = 512;
        ac.createMediaStreamSource(new MediaStream([tr])).connect(an);
      }
    }
    if (ac.state === "suspended") ac.resume().catch(() => {});
    let loud = false;
    if (an && S.mic && tr.enabled) {
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const b of buf) sum += (b - 128) ** 2;
      loud = Math.sqrt(sum / buf.length) > 6;
    }
    tile.classList.toggle("speaking", loud);
    // like Meet: a raised hand goes down once its owner has spoken a little
    if (loud && S.hands.has("me") && (S.handTalk = (S.handTalk || 0) + 150) > 2500) {
      toggleHand();
      toast(t("Your hand was lowered because you spoke"));
    }
    if (capOn && loud) {
      capTalk += 150;
      if (capTalk > 12000) capWarn("silent", false); // 12 s of talking and not one word of text
    }
  }, 150);
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
      if (loud) tile.spokeAt = Date.now(); // big calls show the video of who spoke last
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
  const screen = tiles.find((x) => x.classList.contains("screen") && !x.classList.contains("popped") && x.dataset.id !== "me");
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
  // several pinned: they share the big space in pin order (the others stay small on the side)
  const spots = tiles.filter((x) => x.classList.contains("spot") && !x.classList.contains("off")).sort((a, b) => (a.dataset.pinAt || 0) - (b.dataset.pinAt || 0));
  for (const x of tiles) if (!spots.includes(x) || spots.length < 2 || mode !== "tiled") for (const k of ["left", "top", "width", "height", "right", "bottom", "margin"]) x.style.removeProperty(k);
  if (mode === "tiled" && spots.length > 1) {
    const W0 = g.clientWidth || innerWidth;
    const H0 = g.clientHeight || innerHeight;
    const side = tiles.length > spots.length ? (wide ? 184 : 112) : 0;
    const n = spots.length;
    const sc = wide ? (n <= 2 ? 2 : n <= 4 ? 2 : 3) : n <= 3 ? 1 : 2;
    const sr = Math.ceil(n / sc);
    const w = (W0 - side) / sc;
    const h = H0 / sr;
    spots.forEach((x, i) => {
      x.style.left = `${(i % sc) * w}px`;
      x.style.top = `${Math.floor(i / sc) * h}px`;
      x.style.width = `${w - 4}px`;
      x.style.height = `${h - 4}px`;
      x.style.right = x.style.bottom = "auto"; // (a tile's auto margins would centre it in the whole space)
      x.style.margin = "0";
    });
  }
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
  S.netq?.wants();
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
    t.querySelector("audio")?.play().catch(() => {});
    t.querySelector("video").play().catch(() => {});
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
  if (!may("me", "chat")) return toast(t("A host turned off chat"));
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
  if (on) unpinAll();
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
  if (S.bg && S.bg.camera !== camSrc()) {
    S.bg.stop();
    S.bg = null;
  }
  if (!S.bg) S.bg = new Background(camSrc());
  await S.bg.setImage(f);
  S.bgMode = "img:custom";
  refreshLocalVideo();
  await S.mesh.setTracks(audioOut(), videoOut());
  renderBackgrounds();
};

// ---------- host controls: the person who started the call can lock it, let people in, mute, remove ----------
function onHost(m) {
  if (m.t === "room") {
    S.isHost = m.host;
    S.isOwner = !!m.owner;
    S.act.render();
    if ($("bBreak")) $("bBreak").hidden = !S.isHost;
    S.br.render();
    S.notes.render();
    S.locked = m.locked;
    S.hasPass = !!m.pass;
    S.waiting = false;
    localStorage.removeItem(`juntos.out.${S.code}`);
    paintNet();
  } else if (m.t === "waiting") {
    S.waiting = true;
    paintNet();
  } else if (m.t === "passcode") {
    return passRefused(m);
  } else if (m.t === "pass") {
    S.hasPass = m.on;
    $("peopleList")?.querySelector(".passRow.editing")?.classList.remove("editing"); // saved: show the new one
    try {
      if (m.pass) localStorage.setItem(`juntos.pass.${S.code}`, m.pass);
      else localStorage.removeItem(`juntos.pass.${S.code}`);
    } catch {}
    toast(m.on ? t("{name} set a passcode for new people", { name: m.by }) : t("{name} removed the passcode", { name: m.by }));
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
  } else if (m.t === "perms") {
    return applyPerms(m);
  } else if (m.t === "role") {
    const me = m.id === S.mesh?.id;
    if (me) {
      S.isHost = !!m.role;
      hostViews();
      toast(m.role ? t("{name} made you a co-host", { name: m.by }) : t("{name} took back your co-host controls", { name: m.by }));
      applyPerms({ perms: S.perms, talk: S.talkOv }); // a co-host may do everything
      if (!m.role) {
        S.knocks.clear();
        paintKnocks();
      }
    } else {
      for (const tile of document.querySelectorAll("#grid .tile[data-id]")) if (tile.dataset.id === m.id) refreshPeer(m.id);
      S.act.render();
    }
  }
  renderPeople();
}

// what the host side shows changed (I became or stopped being a co-host)
function hostViews() {
  S.act.render();
  if ($("bBreak")) $("bBreak").hidden = !S.isHost;
  S.br.render();
  S.notes.render();
}
function refreshPeer(id) {
  const tile = document.querySelector(`#grid .tile[data-id="${CSS.escape(id)}"]`);
  const p = S.mesh?.peers.get(id);
  if (tile && p) {
    applyVolume(tile, p);
    tile.classList.toggle("muted", tile.dataset.mic === "0" || !may(id, "talk"));
  }
}

// the hosts changed what people may do: apply it to me (my own mic switch is never changed) and to the others
function applyPerms(m) {
  const before = { ...S.perms, talk: may("me", "talk") };
  const first = !S.permsSeen;
  S.permsSeen = true;
  S.perms = { talk: true, share: true, chat: true, caps: true, ...(m.perms || {}) };
  S.talkOv = m.talk && typeof m.talk === "object" ? m.talk : {};
  const talk = may("me", "talk");
  if (S.micTrack) S.micTrack.enabled = micLive();
  if (talk !== before.talk) {
    if (S.ptt && !talk) {
      // holding Space to talk (the switch itself was off): it ends here
      S.ptt = false;
      $("pttNote").hidden = true;
      S.mic = false;
    }
    if (talk && S.hands.has("me")) {
      setHand("me", false);
      S.mesh?.roomcast({ k: "hand", on: false });
    }
    if (!first || !talk)
      toast(
        talk
          ? S.mic
            ? t("{name} allowed you to speak", { name: m.by || t("A host") })
            : t("{name} allowed you to speak. Your mic is off: turn it on when you want to talk.", { name: m.by || t("A host") })
          : t("{name} hasn't allowed you to speak. Raise your hand to ask.", { name: m.by || t("A host") }),
      );
  }
  if (S.screen && !may("me", "share")) {
    stopScreen();
    toast(t("A host turned off screen sharing"));
  }
  if (S.capsOn && !may("me", "caps")) {
    setCaps(false, true);
    toast(t("A host turned off captions"));
  }
  if (!first && !S.isHost) {
    for (const k of ["share", "chat", "caps"])
      if (before[k] !== S.perms[k])
        toast(
          t(
            {
              share: S.perms.share ? "{name} let everyone share their screen" : "{name} turned off screen sharing",
              chat: S.perms.chat ? "{name} turned chat back on" : "{name} turned off chat",
              caps: S.perms.caps ? "{name} let everyone use captions" : "{name} turned off captions",
            }[k],
            { name: m.by || t("A host") },
          ),
        );
  }
  paintToggles();
  S.mesh?.broadcast(myState());
  capSync();
  for (const id of S.mesh?.peers.keys() || []) refreshPeer(id);
  paintChatLock();
  renderPeople();
}
function paintChatLock() {
  const off = !!S.mesh && !may("me", "chat");
  const box = $("chatText");
  if (!box) return;
  box.disabled = off;
  box.placeholder = off ? t("A host turned off chat") : t("Send a message");
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
  // like Zoom's waiting room: with several people waiting, let them all in at once
  if ((S.knocks?.size || 0) > 1) {
    const card = document.createElement("div");
    card.className = "knock knockAll";
    const who = document.createElement("span");
    who.textContent = t("{n} people want to join", { n: S.knocks.size });
    const all = document.createElement("button");
    all.className = "primary";
    all.name = "admitAll";
    all.textContent = t("Let everyone in");
    all.onclick = () => S.mesh.host({ t: "admit-all" });
    card.append(who, all);
    box.append(card);
  }
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

// The host's passcode row in People: add one, change it, remove it. New people need it; who is in stays.
function passRow() {
  if (S.passEditor) return S.passEditor;
  const li = document.createElement("li");
  li.className = "hostRow passRow";
  const pass = passOf(S.code);
  const label = document.createElement("span");
  label.className = "small";
  const btn = (text, name, act) => {
    const b = document.createElement("button");
    b.className = "chip";
    b.name = name;
    b.textContent = text;
    b.onclick = act;
    return b;
  };
  const edit = (start) => {
    li.innerHTML = "";
    li.classList.add("editing");
    const input = document.createElement("input");
    input.name = "newPass";
    input.value = start;
    input.maxLength = 10;
    input.autocomplete = "off";
    input.title = t("4 to 10 letters or numbers");
    const save = btn(t("Save"), "savePass", () => {
      const v = input.value.trim();
      if (!PASS_RE.test(v)) return toast(t("Type the passcode: 4 to 10 letters or numbers."));
      S.mesh.host({ t: "pass", pass: v });
    });
    save.classList.add("on");
    input.onkeydown = (e) => {
      if (e.key === "Enter") save.click(); // a block: returning false would stop typing
    };
    li.append(input, save, btn(t("Cancel"), "cancelPass", () => {
      li.classList.remove("editing");
      renderPeople();
    }));
    input.select();
  };
  if (S.hasPass) {
    label.textContent = pass ? t("🔑 Passcode: {pass}", { pass }) : t("🔑 Passcode on");
    li.append(label, btn(t("Change"), "changePass", () => edit(newPass())), btn(t("Remove"), "removePass", () => S.mesh.host({ t: "pass", pass: "" })));
  } else {
    li.append(btn(t("Add a passcode"), "addPass", () => edit(newPass())));
  }
  return li;
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

// what everyone may do (hosts and co-hosts always may), like Meet's host management locks
function permRow() {
  const li = document.createElement("li");
  li.className = "permRow";
  const head = document.createElement("div");
  head.className = "small permHead";
  head.textContent = t("Everyone can:");
  li.append(head);
  for (const [key, label] of [
    ["talk", t("Speak")],
    ["share", t("Share their screen")],
    ["chat", t("Send chat messages")],
    ["caps", t("Turn on captions")],
  ]) {
    const lab = document.createElement("label");
    lab.className = "check";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.name = `perm-${key}`;
    box.checked = S.perms[key] !== false;
    // speaking for everyone at once starts over the choices made person by person
    box.onchange = () => S.mesh.host(key === "talk" ? { t: "talk", id: "*", on: box.checked } : { t: "perm", key, on: box.checked });
    lab.append(box, ` ${label}`);
    li.append(lab);
  }
  return li;
}

// people
function renderPeople() {
  const ul = $("peopleList");
  if (!ul || !S.mesh) return;
  // the passcode being typed survives a redraw (People redraws whenever someone's connection changes)
  const editing = ul.querySelector(".passRow.editing");
  const focus = editing?.contains(document.activeElement) && document.activeElement;
  const sel = focus && [focus.selectionStart, focus.selectionEnd];
  S.passEditor = editing || null;
  ul.innerHTML = "";
  // who hosts the call, for everyone to see
  const owner = S.isOwner ? `${localStorage.getItem("name")} ${t("(you)")}` : [...S.mesh.peers.values()].find((p) => S.mesh.owners.has(p.id))?.name;
  if (owner) {
    const li = document.createElement("li");
    li.className = "hostLine";
    li.textContent = t("Host: {name}", { name: owner });
    ul.append(li);
  }
  if (S.isHost) {
    S.wasHost = true;
    const li = document.createElement("li");
    li.className = "hostRow";
    const att = document.createElement("button");
    att.className = "chip";
    att.name = "attSave";
    att.textContent = t("Save attendance (.csv)");
    att.title = t("Who came, when they joined and left, and how long they stayed (from when you joined)");
    att.onclick = () => S.att.download(t);
    const lock = document.createElement("button");
    lock.className = "chip" + (S.locked ? " on" : "");
    lock.id = "lockBtn";
    lock.textContent = S.locked ? t("Unlock the call") : t("Lock the call");
    lock.title = t("When locked, new people ask to join and you let them in.");
    lock.onclick = () => S.mesh.host({ t: "lock", on: !S.locked });
    li.append(lock, att);
    ul.append(li);
    ul.append(passRow());
    ul.append(permRow());
    if (focus && focus.isConnected) {
      focus.focus();
      focus.setSelectionRange(...sel);
    }
  }
  if (S.locked) {
    const li = document.createElement("li");
    li.className = "lockNote";
    li.textContent = t("🔒 Locked: new people ask to join.");
    ul.append(li);
  }
  if (S.hasPass && !S.isHost) {
    const li = document.createElement("li");
    li.className = "lockNote";
    li.textContent = t("🔑 New people need the passcode (it is in the invite link).");
    ul.append(li);
  }
  const add = (name, extra, id) => {
    const role = roleOf(id || "me");
    const talk = may(id || "me", "talk");
    const li = document.createElement("li");
    li.className = "person";
    li.dataset.role = role;
    const nm = document.createElement("span");
    nm.className = "pName";
    nm.textContent = name + (extra ? ` ${extra}` : "");
    li.append(nm);
    if (role) {
      const tag = document.createElement("span");
      tag.className = "hostTag" + (role === "co" ? " co" : "");
      tag.textContent = role === "host" ? t("Host") : t("Co-host");
      li.append(tag);
    }
    if (!talk) {
      const tag = document.createElement("span");
      tag.className = "noTalkTag";
      tag.textContent = t("Not allowed to speak");
      li.append(tag);
    }
    if (id && S.isHost && !role) {
      // speaking is a permission, separate from their own mic switch (which a host never touches)
      const sp = document.createElement("button");
      sp.className = "chip talkBtn" + (talk ? "" : " on");
      sp.textContent = talk ? t("Don't allow to speak") : t("Allow to speak");
      sp.onclick = () => S.mesh.host({ t: "talk", id, on: !talk });
      li.append(sp);
    }
    if (id && S.isOwner && role !== "host") {
      const co = document.createElement("button");
      co.className = "chip coBtn";
      co.textContent = role === "co" ? t("Remove as co-host") : t("Make co-host");
      co.title = t("Co-hosts have the same controls as you, except making co-hosts.");
      co.onclick = () => S.mesh.host({ t: "cohost", id, on: role !== "co" });
      li.append(co);
    }
    if (id && S.isHost) {
      const pin = document.createElement("button");
      const on = S.pinAll.includes(id);
      pin.className = "chip" + (on ? " on" : "");
      pin.name = "pinAll";
      pin.textContent = on ? t("Unpin for everyone") : t("Pin for everyone");
      pin.onclick = () => pinForAll(id, !on);
      li.append(pin);
    }
    if (id && S.isHost && role !== "host" && (role !== "co" || S.isOwner)) li.append(sureButton(t("Remove"), t("Remove?"), () => S.mesh.host({ t: "remove", id })));
    ul.append(li);
  };
  handsRow(ul);
  add(`${localStorage.getItem("name")} ${t("(you)")}`, S.hands.has("me") ? "✋" : "", null);
  // hosts first, then raised hands (they may be asking to speak), then everyone else as they came
  const order = (p) => (roleOf(p.id) === "host" ? 0 : roleOf(p.id) ? 1 : S.hands.has(p.id) ? 2 : 3);
  for (const p of [...S.mesh.peers.values()].sort((a, b) => order(a) - order(b)))
    add(
      p.name || t("Joining…"),
      (S.hands.has(p.id) ? "✋ " : "") + (p.state === "connected" ? "" : t("· connecting")) + (S.br.roomOf(p.id) ? ` · ${S.br.room(S.br.roomOf(p.id))}` : ""),
      p.id,
    );
  $("bPeople")?.querySelector("span") && ($("bPeople").querySelector("span").textContent = t("People ({n})", { n: S.mesh.peers.size + 1 }));
  S.br.refresh();
}

// Raised hands, like Meet's: in the order they went up; hosts lower one or all
function handsRow(ul) {
  if (!S.hands.size) return;
  const li = document.createElement("li");
  li.className = "handsRow";
  const head = document.createElement("div");
  head.className = "handsHead";
  head.textContent = t("Raised hands ({n})", { n: S.hands.size });
  li.append(head);
  if (S.isHost && S.hands.size > 1) {
    const all = document.createElement("button");
    all.className = "chip";
    all.name = "lowerAll";
    all.textContent = t("Lower all");
    all.onclick = () => lowerHand("*");
    head.append(all);
  }
  const ol = document.createElement("ol");
  for (const id of S.hands) {
    const row = document.createElement("li");
    const nm = document.createElement("span");
    nm.textContent = id === "me" ? `${localStorage.getItem("name")} ${t("(you)")}` : S.mesh.peers.get(id)?.name || "";
    row.append(nm);
    if (id === "me" || S.isHost) {
      const b = document.createElement("button");
      b.className = "chip";
      b.name = "lowerHand";
      b.textContent = t("Lower hand");
      b.onclick = () => (id === "me" ? toggleHand() : lowerHand(id));
      row.append(b);
    }
    ol.append(row);
  }
  li.append(ol);
  ul.append(li);
}
// a host lowers someone's hand ("*": everyone's); each person lowers their own when told
function lowerHand(id) {
  S.mesh.roomcast({ k: "lowerhand", id });
  if (id === "*") for (const h of [...S.hands]) h !== "me" && setHand(h, false, "", true);
  else setHand(id, false, "", true);
  if (id === "*" && S.hands.has("me")) toggleHand();
}

// hand and reactions
function setHand(id, on, who, quiet) {
  if (on) S.hands.add(id);
  else S.hands.delete(id);
  if (id === "me") S.handTalk = 0;
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

// What the others hear from me: my microphone, plus the sound of what I'm sharing while I share a tab or screen
// with sound. Both go out mixed in one track, so muting my microphone (the track switched off) leaves the shared
// sound playing, as in Meet and Zoom.
function audioOut() {
  const m = S.shareMix;
  if (!m) return S.micTrack;
  if (m.mic !== S.micTrack) {
    m.micSrc?.disconnect();
    m.mic = S.micTrack;
    m.micSrc = S.micTrack ? m.ac.createMediaStreamSource(new MediaStream([S.micTrack])) : null;
    m.micSrc?.connect(m.out);
  }
  return m.out.stream.getAudioTracks()[0];
}
function shareSound(track) {
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  const out = ac.createMediaStreamDestination();
  ac.createMediaStreamSource(new MediaStream([track])).connect(out);
  S.shareMix = { ac, out, track, mic: null, micSrc: null };
  ac.resume?.().catch(() => {});
}
function stopShareSound() {
  const m = S.shareMix;
  if (!m) return;
  S.shareMix = null;
  m.track.stop();
  m.ac.close().catch(() => {});
}

// screen sharing (replaces your camera while it lasts), with the sound of the tab or screen when the browser offers it
// (Chrome and Edge: a tab, or the whole screen on Windows; not a single window). The call's own sound stays out.
async function toggleScreen() {
  if (S.screen) return stopScreen();
  if (!may("me", "share")) return toast(t("A host turned off screen sharing"));
  try {
    let s;
    try {
      s = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false, restrictOwnAudio: true },
        systemAudio: "include",
        selfBrowserSurface: "exclude",
      });
    } catch (e) {
      if (e && e.name === "NotAllowedError") throw e; // they said no: don't ask again
      s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
    }
    const snd = s.getAudioTracks()[0];
    if (snd) shareSound(snd);
    S.screen = s.getVideoTracks()[0];
    S.screen.onended = stopScreen;
    $("bScreen")?.classList.add("on");
    refreshLocalVideo();
    await S.mesh.setTracks(audioOut(), S.screen);
    S.mesh.broadcast(myState());
    toast(S.shareMix ? t("You're sharing your screen, with its sound") : t("You're sharing your screen"));
  } catch (_) {}
}
async function stopScreen() {
  if (!S.screen) return;
  S.screen.stop();
  S.screen = null;
  stopShareSound();
  $("bScreen")?.classList.remove("on");
  refreshLocalVideo();
  await S.mesh.setTracks(audioOut(), videoOut());
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
    if (!may("me", "talk")) return askToSpeak();
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
// Brave has the API but its speech service never answers (Brave doesn't use Google's), so it made nothing, silently
const IS_BRAVE = !!navigator.brave;
let SR = IS_BRAVE ? null : window.SpeechRecognition || window.webkitSpeechRecognition;
S.capsOn = localStorage.getItem("juntos.captions") === "on";
S.capShare = localStorage.getItem("juntos.capshare") !== "off";
S.capSize = localStorage.getItem("juntos.capsize") || "large";
S.capLang = localStorage.getItem("juntos.caplang") || "";
S.capTo = captr.CAN ? localStorage.getItem("juntos.capto") || "" : ""; // translate the others' captions into this
S.capSeen = new Set(); // the languages the others' captions came in
S.capNeed = new Set(); // languages whose translation the browser downloads only after a click
S.capWant = new Set(); // who in the call wants captions (peer ids)
S.capLines = new Map(); // speaker id -> the line they're saying now: { el, done, note, entry, timer, pause }
S.transcript = []; // { at, name, text }: one per caption line
// Captions read like a dialogue: each speaker's turn starts its own line with their name, and a long turn is broken
// into lines (a sentence ending, a pause or a length), never one running stream.
const CAP_LINE = 90; // characters: a finished phrase reaching this ends the line
const CAP_PAUSE = 1500; // ms of quiet after a finished phrase ends the line
const CAP_SHOWN = 4; // lines on screen
const CAP_GONE = 9000; // ms a line stays after it ends
let capRec = null;
let capOn = false;
let capFails = 0;
let capToldMe = false;
let capHeard = false; // this browser has turned speech into text at least once
let capTalk = 0; // ms I've been talking, while captions listen, since the last text came out

// My captions can't reach anyone: never silently. A lasting warning on my captions button and in the captions
// sheet says why, and whoever wants my captions is told. "stop": this browser can't do it at all (stop trying);
// otherwise keep trying, and the warning goes away as soon as text comes out.
const CAP_WHY = {
  browser: "This browser can't turn your voice into text. Chrome, Edge or Firefox can.",
  blocked: "This browser isn't allowed to turn your voice into text (check the microphone and speech permissions).",
  mic: "This device can't listen for captions while it's in the call (phones often allow only one at a time).",
  lang: "This browser can't make captions in the language you picked. Pick another under \"I speak\".",
  silent: "You're talking but no captions come out of this browser, so the others don't get any.",
};
S.capBroken = "";
function capWarn(why, stop) {
  if (stop) {
    SR = null;
    capOn = false;
    const r = capRec;
    capRec = null;
    try {
      r?.abort();
    } catch {}
  }
  if (S.capBroken !== why) {
    S.capBroken = why;
    toast(t(CAP_WHY[why]));
    for (const id of S.capWant) S.mesh?.sendTo(id, { k: "capno", why: stop ? "browser" : "broken" });
  }
  paintCaps();
}
function capGiveUp(why = "browser") {
  capWarn(why, true);
}
function capFixed() {
  if (!S.capBroken) return;
  S.capBroken = "";
  paintCaps();
}

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
  const warn = !!(S.capBroken && (S.capsOn || S.capWant.size)); // only matters while someone wants captions
  $("bCaps")?.classList.toggle("warn", warn);
  $("bCaps")?.setAttribute("title", warn ? t(CAP_WHY[S.capBroken]) : t("Captions"));
}

// listen to my own voice only while someone wants captions, my mic is on and I haven't turned it off
function capSync() {
  const need = !!(SR && S.mesh && micLive() && S.capShare && (S.capsOn || S.capWant.size));
  if (need === capOn) return;
  capOn = need;
  capFails = 0;
  capTalk = 0;
  if (need) capStart();
  else if (capRec) {
    const r = capRec;
    capRec = null;
    try {
      r.abort();
    } catch {}
  }
}

// Captions follow the microphone picked in Devices where the browser can listen to a given microphone
// (start(track): Chrome 135+ on computers). A browser that can must refuse a stopped track, one that can't
// ignores it and listens to the default microphone: that tells them apart, once.
let capTrackOK = null;
const MIC_NOTE = "Captions hear your default microphone ({name}), not the one picked in Devices. Make it the default in your computer's sound settings, or use Chrome, where captions follow the picked one.";
function capByTrack() {
  if (capTrackOK !== null || !SR || !S.micTrack) return !!capTrackOK;
  const dead = S.micTrack.clone();
  dead.stop();
  const r = new SR();
  try {
    r.start(dead);
    capTrackOK = false;
    try {
      r.abort();
    } catch {}
  } catch {
    capTrackOK = true;
  }
  return capTrackOK;
}
// Elsewhere captions hear the system's default microphone: when that isn't the one the call uses, say so (in the
// captions sheet, and once as a note) instead of quietly captioning another microphone.
S.capOtherMic = "";
async function capCheckMic() {
  S.capOtherMic = "";
  if (!SR || capByTrack() || !S.micTrack) return;
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
    const def = devs.find((d) => d.deviceId === "default") || devs[0];
    const mine = S.micTrack.getSettings();
    if (def && mine.groupId && def.groupId && def.groupId !== mine.groupId) {
      S.capOtherMic = (def.label || "").replace(/^(Default|Predeterminado) - /, "") || t("Microphone");
      if (capOn && !capCheckMic.told) {
        capCheckMic.told = true;
        toast(t("Captions hear your default microphone ({name}), not the one picked in Devices", { name: S.capOtherMic }));
      }
    }
  } catch {}
}
// the microphone was switched: listen to the new one
function capRestart() {
  capCheckMic();
  if (!capRec) return;
  const r = capRec;
  capRec = null;
  try {
    r.abort();
  } catch {}
  capStart();
}

function capStart() {
  if (!capOn || capRec) return;
  if (capCheckMic.at !== S.micTrack) {
    capCheckMic.at = S.micTrack;
    capCheckMic();
  }
  const r = new SR();
  capRec = r;
  r.continuous = true;
  r.interimResults = true;
  r.lang = S.capLang || navigator.language || "en-US";
  r.onresult = (e) => {
    capFails = 0;
    capHeard = true;
    capTalk = 0;
    capFixed();
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
    if (e.error === "not-allowed" || e.error === "service-not-allowed") capGiveUp("blocked");
    else if (e.error === "language-not-supported") capWarn("lang", false);
    else if (e.error !== "no-speech" && e.error !== "aborted") {
      capFails++;
      // keeps failing and has never made text here: say so (the call holding the mic on phones, a speech service
      // that never answers, ...)
      if (capFails >= 3 && !capHeard) capGiveUp(e.error === "audio-capture" ? "mic" : "browser");
    }
  };
  // the browser stops listening now and then (silence, a time limit): start again while still wanted
  r.onend = () => {
    if (capRec !== r) return;
    capRec = null;
    if (capOn) setTimeout(capStart, Math.min(300 * 2 ** capFails, 15000));
  };
  try {
    if (capByTrack() && S.micTrack && S.micTrack.readyState === "live") r.start(S.micTrack);
    else r.start();
  } catch {
    capRec = null;
  }
}

function capSend(text, final) {
  text = text.slice(0, 500);
  const m = { k: "cap", text, final, lang: S.capLang || navigator.language || "en-US" };
  for (const id of S.capWant) if (S.br.same(id)) S.mesh?.sendTo(id, m);
  if (S.capsOn) showCap("me", t("You"), text, final);
}

// someone turned their captions on or off
function capWanted(from, on, who) {
  if (on) {
    S.capWant.add(from);
    if (!SR || !S.capShare) S.mesh.sendTo(from, { k: "capno", why: SR ? "off" : "browser" });
    else if (S.capBroken) S.mesh.sendTo(from, { k: "capno", why: "broken" });
    else if (!capToldMe) {
      capToldMe = true;
      toast(t("{name} turned on captions: your browser turns what you say into text", { name: who }));
    }
  } else S.capWant.delete(from);
  capSync();
}

// a new caption line; the same person going on doesn't repeat the name (CSS shows it again once it's the top line)
function capNewLine(id, name, note) {
  const box = $("captions");
  const el = document.createElement("div");
  el.className = "capLine live";
  el.dataset.id = id;
  el.innerHTML = "<b></b><span></span>";
  el.firstChild.textContent = name;
  const prev = box.lastElementChild;
  if (!note && prev && prev.dataset.id === id && !prev.classList.contains("note")) el.classList.add("cont");
  if (note) el.classList.add("note");
  box.append(el);
  // too many: the oldest finished line goes first, then the oldest still being said
  while (box.children.length > CAP_SHOWN) {
    const old = [...box.children].find((x) => !x.classList.contains("live")) || box.firstElementChild;
    if (S.capLines.get(old.dataset.id)?.el === old) S.capLines.delete(old.dataset.id);
    old.remove();
  }
  return el;
}

function capEndLine(id, L) {
  clearTimeout(L.pause);
  if (S.capLines.get(id) === L) S.capLines.delete(id);
  L.el.classList.remove("live");
  clearTimeout(L.timer);
  L.timer = setTimeout(() => L.el.remove(), CAP_GONE);
}

// the words on screen: translated when I translate captions and they came in another language. The first words show
// as said until their translation is there; after that a line only changes when its new translation is ready.
function capText(L, s, lang, entry) {
  const to = S.capTo;
  L.s = s;
  if (!to || !lang || captr.base(lang) === captr.base(to)) {
    L.el.lastChild.textContent = s;
    return;
  }
  const st = captr.status(lang, to);
  if (st !== "ok") {
    L.el.lastChild.textContent = s;
    // ready in a moment: the line on screen gets translated then, not only the next words
    if (!st)
      captr.prepare(lang, to).then((r) => {
        capTrNote(lang, r);
        if (r === "ok" && L.el.isConnected && S.capTo === to) capText(L, L.s, lang, null);
      });
    return;
  }
  if (!L.trd) L.el.lastChild.textContent = s;
  const n = (L.seq = (L.seq || 0) + 1);
  captr.translate(s, lang, to).then((x) => {
    if (x == null || L.seq !== n) return;
    L.trd = true;
    L.el.lastChild.textContent = x;
    L.el.classList.add("tr");
  });
  if (entry) {
    const src = entry.text;
    captr.translate(src, lang, to).then((x) => {
      if (x != null && entry.text === src) Object.assign(entry, { tr: x, to });
    });
  }
}

// a translation the browser can't make yet (it downloads after a click) or at all: said once per language
const capTold = new Set();
function capTrNote(lang, r) {
  const l = captr.base(lang);
  if (r === "need") S.capNeed.add(l);
  else S.capNeed.delete(l);
  if ((r !== "need" && r !== "no") || capTold.has(`${l}${r}`)) return;
  capTold.add(`${l}${r}`);
  const vars = { lang: captr.langName(l, LANG), to: captr.langName(S.capTo, LANG) };
  toast(r === "need" ? t("Captions in {lang}: click anywhere to get their translation", vars) : t("Your browser can't translate {lang} into {to}", vars));
}
// any click or key is the go-ahead the browser wants before it downloads a translation
for (const ev of ["pointerdown", "keydown"])
  addEventListener(ev, () => {
    if (!S.capTo) return;
    for (const l of S.capNeed) captr.prepare(l, S.capTo, true).then((r) => capTrNote(l, r));
  }, true);

function showCap(id, name, text, final, note, lang) {
  let L = S.capLines.get(id);
  if (L && (note || L.note || !L.el.isConnected)) {
    capEndLine(id, L);
    L = null;
  }
  if (!L) {
    L = { el: capNewLine(id, name, note), done: "", note: !!note, entry: null, timer: 0, pause: 0 };
    S.capLines.set(id, L);
  }
  L.el.firstChild.textContent = name;
  clearTimeout(L.pause);
  if (final) {
    L.done = `${L.done} ${text}`.trim().slice(-400);
    if (!note) {
      if (!L.entry) S.transcript.push((L.entry = { at: Date.now(), name: id === "me" ? localStorage.getItem("name") || name : name, text: "" }));
      L.entry.text = L.done;
    }
  }
  let s = final ? L.done : `${L.done} ${text}`.trim();
  if (s.length > 2 * CAP_LINE) s = "… " + s.slice(-2 * CAP_LINE).replace(/^\S*\s/, ""); // one breath with no pause
  capText(L, s, note ? "" : lang, final && !note ? L.entry : null);
  clearTimeout(L.timer);
  L.timer = setTimeout(() => {
    L.el.remove();
    if (S.capLines.get(id) === L) S.capLines.delete(id);
  }, 8000); // they went quiet in the middle of a phrase
  if (final) {
    if (note || L.done.length >= CAP_LINE || /[.?!…。？！]$/.test(L.done)) capEndLine(id, L);
    else L.pause = setTimeout(() => capEndLine(id, L), CAP_PAUSE);
  }
}

function setCaps(on, keep) {
  if (on && S.mesh && !may("me", "caps")) return toast(t("A host turned off captions"));
  S.capsOn = on;
  if (!keep) localStorage.setItem("juntos.captions", on ? "on" : "off");
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
  const lines = [];
  let last = null;
  for (const x of S.transcript) {
    if (!last || last.name !== x.name || x.at - last.at > 60000) {
      const a = new Date(x.at);
      if (last) lines.push("");
      lines.push(`[${pad(a.getHours())}:${pad(a.getMinutes())}] ${x.name}`);
    }
    lines.push(x.text);
    if (x.tr) lines.push(`  (${captr.langName(x.to, LANG)}) ${x.tr}`);
    last = x;
  }
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
  // translated captions (only this device's view; nobody else is told)
  const tl = document.createElement("p");
  tl.className = "small";
  tl.textContent = t("Translate captions into");
  const to = document.createElement("select");
  to.name = "capTo";
  for (const v of ["", ...captr.TARGETS]) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v ? captr.langName(v, LANG) : t("Don't translate");
    o.selected = S.capTo === v;
    to.append(o);
  }
  to.disabled = !captr.CAN;
  const tn = document.createElement("p");
  tn.className = "small capTrNote";
  tn.textContent = captr.CAN
    ? t("Your browser translates them on this device; nothing is sent anywhere to translate.")
    : t("Translated captions need Chrome or Edge on a computer.");
  const gets = document.createElement("div");
  const paintGets = () => {
    gets.replaceChildren();
    if (!S.capTo) return;
    for (const l of S.capNeed) {
      const b = document.createElement("button");
      b.className = "chip";
      b.name = "capGet";
      b.textContent = t("Translate from {lang} (download)", { lang: captr.langName(l, LANG) });
      b.onclick = () => {
        b.disabled = true;
        captr.prepare(l, S.capTo, true).then((r) => {
          capTrNote(l, r);
          paintGets();
        });
      };
      gets.append(b);
    }
  };
  to.onchange = () => {
    S.capTo = to.value;
    localStorage.setItem("juntos.capto", to.value);
    S.capNeed.clear();
    for (const l of S.capSeen) captr.prepare(l, to.value, true).then((r) => {
      capTrNote(l, r);
      paintGets();
    });
    paintGets();
  };
  paintGets();
  inner.append(tl, to, tn, gets);
  if (S.capBroken) {
    const w = document.createElement("p");
    w.className = "small capWarn";
    w.textContent = t(CAP_WHY[S.capBroken]);
    inner.append(w);
  }
  if (S.capOtherMic) {
    const w = document.createElement("p");
    w.className = "small capWarn capMic";
    w.textContent = t(MIC_NOTE, { name: S.capOtherMic });
    inner.append(w);
  }
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
  } else if (!S.capBroken) {
    const p = document.createElement("p");
    p.className = "small";
    p.textContent = IS_BRAVE
      ? t("Brave can't turn your voice into text (its speech service doesn't work). Chrome, Edge or Firefox can. You still see what the others say.")
      : t("This browser can't turn your voice into text (Chrome, Edge, Safari and Firefox on computers can). You still see what the others say.");
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
  note.textContent = t("Each person's browser turns their own voice into text. Chrome, Edge and Safari may send the sound to Google, Microsoft or Apple to do it; Firefox does it on the device.");
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
    await S.mesh?.setTracks(audioOut(), videoOut());
    if (S.darkWatch) suggestLight();
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
    S.micTrack.enabled = micLive();
    localStorage.setItem("micId", S.micTrack.getSettings().deviceId || id);
    await S.mesh?.setTracks(audioOut(), videoOut());
    capRestart();
    return true;
  } catch (_) {
    toast(t("Couldn't switch microphone"));
    return false;
  }
}

// A microphone or camera can stop in the middle of a call (a headset unplugged, Bluetooth dropping, another app
// taking it, the system ending it): nobody hears or sees me any more, while my buttons still say "on". Seen in a
// big-call test, where every connection kept sending a microphone that had ended. The microphone is opened
// again (the one picked in Devices, else any); a camera that stopped is turned off, with a note either way.
function watchDevices() {
  clearInterval(watchDevices.timer);
  watchDevices.timer = setInterval(async () => {
    if (!S.mesh || S.mesh.closed || watchDevices.busy) return;
    watchDevices.busy = true;
    try {
      if (S.micTrack && S.micTrack.readyState === "ended") {
        const ok = await useMic(localStorage.getItem("micId") || "");
        toast(ok && S.micTrack?.readyState === "live" ? t("Your microphone stopped. It's back: {name}", { name: S.micTrack.label || t("Microphone") }) : t("Your microphone stopped working. Check it, or pick another in Devices"));
      }
      if (S.camTrack && S.camTrack.readyState === "ended" && S.cam) {
        await setCam(false);
        toast(t("Your camera stopped, so it's off now. Turn it on to try again"));
      }
    } finally {
      watchDevices.busy = false;
    }
  }, 2000);
}

// where the others' voices come out (computers and Android; iPhones choose it in the system)
function useSpeaker(id) {
  S.sink = id;
  localStorage.setItem("sinkId", id);
  for (const v of document.querySelectorAll('.tile:not([data-id="me"]) audio')) v.setSinkId?.(id).catch(() => {});
  S.out?.setSinkId?.(id).catch(() => {}); // boosted voices
}
S.sink = localStorage.getItem("sinkId") || "";
S.noise = localStorage.getItem("juntos.noise") !== "off"; // the browser's own noise reduction (on unless turned off)
S.lightOn = localStorage.getItem("juntos.light") === "on"; // off until chosen, like Meet (which suggests it when you look dark)

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
  const light = document.createElement("label");
  light.className = "check";
  light.innerHTML = `<input type="checkbox" name="light"><span></span>`;
  light.lastChild.textContent = t("Adjust video lighting (may slow down older devices)");
  light.firstChild.checked = S.lightOn;
  light.firstChild.onchange = () => setLight(light.firstChild.checked);
  inner.append(light);
  inner.append(S.netq.section());
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
  // something wrong with sound, picture or the connection: tell the person who makes Juntos, with the call's numbers
  const fb = document.createElement("button");
  fb.className = "linkBtn";
  fb.name = "feedback";
  fb.textContent = t("Report a problem or idea");
  fb.onclick = () => {
    close();
    feedback();
  };
  inner.append(fb);
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
      camoff: t.classList.contains("camoff") || t.classList.contains("paused"), // paused to save data: the name, not a frozen picture
      screen: t.dataset.id === "me" ? !!S.screen : t.classList.contains("screen"),
      hand: S.hands.has(t.dataset.id),
      overlay: S.an.overlay(t.dataset.id), // drawings on a shared screen
      stream: t.dataset.id === "me" ? (audioOut() ? new MediaStream([audioOut()]) : null) : S.mesh.peers.get(t.dataset.id)?.stream,
    })).concat(S.boardBig && S.panel === "board" ? [{ id: "board", video: $("boardCanvas"), name: t("Board"), screen: true }] : []),
    opts,
  );
  S.recorder.start();
  paintRec();
  S.mesh.broadcast({ k: "rec", on: true });
}

// invite
$("feedbackHome").onclick = $("endedFeedback").onclick = (e) => {
  e.preventDefault();
  feedback();
};
$("invite").onclick = () => inviteSheet(S.hasPass ? callUrl(S.code) : `${location.origin}${BASE}r/${S.code}`, { t, toast, isPhone, locked: S.locked, pass: S.hasPass ? passOf(S.code) : "" });

async function leave(why) {
  // why: set when the call ended you (removed, not let in); a click passes an event
  $("endedMsg").textContent = typeof why === "string" ? why : "";
  $("endedTitle").textContent = typeof why === "string" ? t("You're out of the call") : t("You left the call");
  if (S.recorder) await toggleRec();
  S.knocks?.clear();
  paintKnocks();
  S.netq.stop();
  S.att?.end();
  S.mesh?.leave();
  S.mesh = null;
  S.br.reset();
  S.chat = S.chat.filter((c) => !c.room);
  closePip();
  capSync();
  diag("left the call");
  const save = $("endedCaps");
  save.hidden = !S.transcript.length;
  save.onclick = saveTranscript;
  $("endedAct").hidden = !S.act.any();
  $("endedAct").onclick = () => S.act.download();
  $("endedNotes").hidden = !S.notes.any();
  $("endedNotes").onclick = () => S.notes.download();
  $("endedAtt").hidden = !(S.wasHost && S.att?.any());
  $("endedAtt").onclick = () => S.att.download(t);
  closePanel();
  callNotice(false);
  show("ended");
}

// ---------- "you're in a call" while the app is in the background (phones) ----------
// A quiet notification while you're in another app (tap it to come back), and the phone's call
// controls (mute, camera, hang up) where the system shows them.
const swReady = "serviceWorker" in navigator ? navigator.serviceWorker.register(`${BASE}sw.js`).then(() => navigator.serviceWorker.ready).catch(() => null) : Promise.resolve(null);
async function callNotice(show) {
  const reg = await swReady;
  if (!reg) return;
  for (const n of await reg.getNotifications({ tag: "juntos-call" }).catch(() => [])) n.close();
  if (!show || !S.mesh || typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const n = S.mesh.peers.size;
  reg.showNotification(t("You're in a call"), {
    tag: "juntos-call",
    body: n ? t("With {n} more. Tap to go back.", { n }) : t("Tap to go back."),
    icon: `${BASE}img/icon-192.png`,
    badge: `${BASE}img/icon-192.png`,
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
    ms.metadata = new MediaMetadata({ title: t("Call on Juntos"), artist: S.code, artwork: [{ src: `${BASE}img/icon-512.png`, sizes: "512x512", type: "image/png" }] });
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
  dock();
  S.light?.stop();
  S.light = null;
  S.darkWatch?.();
  S.darkWatch = null;
  history.pushState({}, "", BASE);
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
