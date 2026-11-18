// UI language: the browser's, or ?lang=xx in the link. English text is the key; other languages map it.
// Add a language: copy the "es" block, translate the right-hand side.

const DICT = {
  es: { // Spanish as spoken in Argentina (vos)
    "Juntos · free video calls": "Juntos · videollamadas gratis",
    "Free video calls for everyone.": "Videollamadas gratis para todos.",
    "No account, no time limit.": "Sin cuenta, sin límite de tiempo.",
    "Start a call": "Iniciar una llamada",
    "Enter a code or link": "Escribí un código o enlace",
    "Join": "Unirse",
    "Install app": "Instalar la app",
    "Open source": "Código abierto",
    "Camera is off": "La cámara está apagada",
    "Microphone": "Micrófono",
    "Camera": "Cámara",
    "Background": "Fondo",
    "Ready to join?": "¿Listo para entrar?",
    "Your name": "Tu nombre",
    "Join now": "Entrar",
    "Invite people": "Invitar gente",
    "● Recording": "● Grabando",
    "Close": "Cerrar",
    "Send a message": "Escribí un mensaje",
    "Send": "Enviar",
    "You left the call": "Saliste de la llamada",
    "Rejoin": "Volver a entrar",
    "Back to start": "Volver al inicio",
    "That code doesn't look right": "Ese código no parece correcto",
    "No camera found. You can still talk.": "No se encontró una cámara. Igual podés hablar.",
    "Camera and microphone are blocked. Allow them in your browser to be seen and heard.":
      "La cámara y el micrófono están bloqueados. Permitilos en el navegador para que te vean y escuchen.",
    "Backgrounds don't work on this device": "Los fondos no funcionan en este dispositivo",
    "Turn off": "Apagar",
    "Turn on": "Encender",
    "Background: {name}": "Fondo: {name}",
    "Type your name so people know who you are.": "Escribí tu nombre para que sepan quién sos.",
    "{name} left": "{name} salió",
    "{name} joined": "{name} entró",
    "Someone": "Alguien",
    "This call is full ({max} people)": "Esta llamada está llena ({max} personas)",
    "You're the first one here. Invite people with the link.": "Sos el primero. Invitá gente con el enlace.",
    "Mic": "Micrófono",
    "Share screen": "Compartir pantalla",
    "Chat": "Chat",
    "Board": "Pizarra",
    "People": "Personas",
    "People ({n})": "Personas ({n})",
    "Record": "Grabar",
    "React": "Reaccionar",
    "Hand / react": "Mano / reacción",
    "More": "Más",
    "Leave": "Salir",
    "Switch camera": "Cambiar cámara",
    "You": "Vos",
    "(you)": "(vos)",
    "Eraser": "Borrador",
    "Pen": "Lápiz",
    "Clear": "Borrar todo",
    "Turn on your camera to pick a background.": "Encendé la cámara para elegir un fondo.",
    "Your picture…": "Tu imagen…",
    "{name} raised a hand": "{name} levantó la mano",
    "Lower hand": "Bajar la mano",
    "✋ Raise hand": "✋ Levantar la mano",
    "You're sharing your screen": "Estás compartiendo tu pantalla",
    "Couldn't switch camera": "No se pudo cambiar de cámara",
    "Recording saved to your downloads": "La grabación se guardó en tus descargas",
    "Recording. Everyone in the call can see that.": "Grabando. Todos en la llamada lo ven.",
    "Join my call": "Entrá a mi llamada",
    "Join my call on Juntos": "Entrá a mi llamada en Juntos",
    "Link copied. Send it to anyone.": "Enlace copiado. Mandalo a quien quieras.",
    "Copy this link:": "Copiá este enlace:",
    "None": "Ninguno",
    "Blur": "Desenfoque",
    "Strong blur": "Desenfoque fuerte",
    "Warm": "Cálido",
    "Green": "Verde",
    "Cool": "Frío",
    "Meeting": "Reunión",
    "{name} started recording": "{name} empezó a grabar",
    "{name} stopped recording": "{name} dejó de grabar",
    "Joining…": "Entrando…",
    "This browser can't make video calls. Open the link in Safari or Chrome.":
      "Este navegador no puede hacer videollamadas. Abrí el enlace en Safari o Chrome.",
    "This browser can't use your camera or microphone. Open the link in Safari or Chrome.":
      "Este navegador no puede usar tu cámara ni tu micrófono. Abrí el enlace en Safari o Chrome.",
    "· connecting": "· conectando",
  },
};

function pick() {
  const asked = new URLSearchParams(location.search).get("lang");
  if (asked) {
    try { localStorage.setItem("lang", asked); } catch {}
  }
  const want = [asked, safeGet("lang"), ...(navigator.languages || [navigator.language])].filter(Boolean);
  for (const l of want) {
    const base = String(l).toLowerCase().split("-")[0];
    if (base === "en") return "en";
    if (DICT[base]) return base;
  }
  return "en";
}

function safeGet(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}

export const LANG = pick();
const table = DICT[LANG] || {};

/** t("{name} left", { name }) -> the text in the UI language, placeholders filled. */
export function t(text, vars) {
  let s = table[text] ?? text;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Translates the static page: text nodes and title / placeholder / alt attributes. */
export function translatePage(root = document) {
  document.documentElement.lang = LANG;
  if (LANG === "en") return;
  document.title = t(document.title);
  const walker = document.createTreeWalker(root.body || root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const raw = n.nodeValue;
    const s = raw.trim();
    if (!s) continue;
    // "Open source · <a>" keeps its separator
    const core = s.replace(/\s*·\s*$/, "");
    if (table[core]) n.nodeValue = raw.replace(core, table[core]);
  }
  for (const el of (root.body || root).querySelectorAll("[title],[placeholder]")) {
    for (const a of ["title", "placeholder"]) if (el.hasAttribute(a)) el.setAttribute(a, t(el.getAttribute(a)));
  }
}
