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
    "Privacy": "Privacidad",
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
    "Record this call": "Grabar esta llamada",
    "Who's talking": "Quien habla",
    "Big, with everyone else small": "En grande, y los demás chiquitos",
    "Everyone": "Todos",
    "All the same size": "Todos del mismo tamaño",
    "Also show in the video:": "Que también se vea en el video:",
    "Reactions": "Reacciones",
    "Raised hands": "Manos levantadas",
    "Chat messages": "Mensajes del chat",
    "Everyone's voices and the picture above, saved as a video on this device. Nothing is uploaded. Everyone sees that you're recording.": "Las voces de todos y la imagen elegida, guardadas como video en este dispositivo. No se sube nada. Todos ven que estás grabando.",
    "Cancel": "Cancelar",
    "Start recording": "Empezar a grabar",
    "Volume": "Volumen",
    "Rectangle": "Rectángulo",
    "Circle": "Círculo",
    "Arrow": "Flecha",
    "Text": "Texto",
    "Move the board": "Mover la pizarra",
    "Colour": "Color",
    "Thin": "Fino",
    "Medium": "Mediano",
    "Thick": "Grueso",
    "Undo": "Deshacer",
    "Clear for everyone?": "¿Borrar para todos?",
    "Show everything": "Ver todo",
    "Zoom out": "Alejar",
    "Zoom in": "Acercar",
    "Back to the side": "Volver al costado",
    "Make the board big": "Agrandar la pizarra",
    "Normal": "Normal",
    "Only for you. Above 100% makes a quiet voice louder.": "Solo para vos. Más de 100% sube a quien se escucha bajito.",
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
    "Devices": "Dispositivos",
    "Full screen": "Pantalla completa",
    "Couldn't connect to {name}": "No se pudo conectar con {name}",
    "Reconnecting…": "Reconectando…",
    "Trying another way…": "Probando otro camino…",
    "Connecting…": "Conectando…",
    "Try again": "Reintentar",
    "No connection. Reconnecting…": "Sin conexión. Reconectando…",
    "Waiting for others. Invite them with the link.": "Esperando a los demás. Invitalos con el enlace.",
    "Stop": "Detener",
    "REC": "GRABANDO",
    "{name} is recording": "{name} está grabando",
    "Couldn't switch microphone": "No se pudo cambiar el micrófono",
    "Speaker": "Parlante",
    "Allow the camera and microphone to see their names.": "Permití la cámara y el micrófono para ver sus nombres.",
    "Done": "Listo",
    "You're in a call": "Estás en una llamada",
    "With {n} more. Tap to go back.": "Con {n} más. Tocá para volver.",
    "Tap to go back.": "Tocá para volver.",
    "Call on Juntos": "Llamada en Juntos",
    "Layout": "Diseño",
    "Auto": "Automático",
    "Everyone the same size; a shared screen big": "Todos del mismo tamaño; una pantalla compartida, en grande",
    "Tiled": "Mosaico",
    "Everyone the same size": "Todos del mismo tamaño",
    "Spotlight": "Destacado",
    "Only who's talking (or a shared screen)": "Solo quien habla (o una pantalla compartida)",
    "Sidebar": "Barra lateral",
    "Who's talking big, the others beside": "Quien habla en grande, los demás al costado",
    "Your own picture:": "Tu propia imagen:",
    "With everyone": "Con todos",
    "Small, in a corner": "Chiquita, en una esquina",
    "Hidden": "Oculta",
    "The others still see you": "Los demás te siguen viendo",
    "Hide people with their camera off": "Ocultar a quienes tienen la cámara apagada",
    "Only on this device. Pin someone with the button on their picture.": "Solo en este dispositivo. Para fijar a alguien, usá el botón en su imagen.",
    "Asking to join. Someone in the call will let you in.": "Pidiendo entrar. Alguien de la llamada te va a dejar pasar.",
    "Nobody let you in this time.": "Esta vez no te dejaron entrar.",
    "{name} removed you from the call": "{name} te sacó de la llamada",
    "{name} locked the call. New people ask to join.": "{name} cerró la llamada. Quien llegue pide entrar.",
    "{name} unlocked the call": "{name} abrió la llamada",
    "{name} muted you": "{name} te silenció",
    "{name} wants to join": "{name} quiere entrar",
    "Let in": "Dejar entrar",
    "Deny": "Rechazar",
    "Mute everyone": "Silenciar a todos",
    "Everyone else is muted. They can unmute themselves.": "Silenciaste a todos. Cada uno puede volver a activar su micrófono.",
    "Unlock the call": "Abrir la llamada",
    "Lock the call": "Cerrar la llamada",
    "When locked, new people ask to join and you let them in.": "Cerrada, quien llegue pide entrar y vos lo dejás pasar.",
    "🔒 Locked: new people ask to join.": "🔒 Cerrada: quien llegue pide entrar.",
    "Host": "Anfitrión",
    "Mute": "Silenciar",
    "Remove": "Sacar",
    "Remove?": "¿Sacar?",
    "You're out of the call": "Saliste de la llamada",
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
