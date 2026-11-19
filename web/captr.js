// Translated captions, like Meet's (which keeps them for paid plans): each person's own browser translates the
// captions it receives into the language they pick, on the device (the Translator API of Chrome and Edge on
// computers). Nothing is sent anywhere to translate. Elsewhere captions show as they were said.

export const CAN = typeof self !== "undefined" && "Translator" in self;

// "es-AR" -> "es"
export const base = (l) => String(l || "").toLowerCase().split(/[-_]/)[0];

// the languages offered to translate into (the Translator API has these on Chrome and Edge)
export const TARGETS = ["es", "en", "pt", "fr", "de", "it", "nl", "pl", "ru", "uk", "tr", "ar", "hi", "ja", "ko", "zh"];

export function langName(code, ui) {
  try {
    const n = new Intl.DisplayNames([ui || "en"], { type: "language" }).of(code);
    return n ? n[0].toLocaleUpperCase(ui || "en") + n.slice(1) : code;
  } catch {
    return code;
  }
}

const made = new Map(); // "es>en" -> Translator
const state = new Map(); // "es>en" -> "ok" | "need" (a click downloads it) | "busy" | "no"

// Get a translator ready. "need": the browser must download it, which takes a click (call again from one).
export async function prepare(from, to, click) {
  from = base(from);
  to = base(to);
  const key = `${from}>${to}`;
  if (!CAN || !from || !to || from === to) return "no";
  const s = state.get(key);
  if (s === "ok" || s === "no" || s === "busy") return s;
  let av;
  try {
    av = await self.Translator.availability({ sourceLanguage: from, targetLanguage: to });
  } catch {
    av = "unavailable";
  }
  if (av === "unavailable") {
    state.set(key, "no");
    return "no";
  }
  if (av !== "available" && !click && !navigator.userActivation?.isActive) {
    state.set(key, "need");
    return "need";
  }
  state.set(key, "busy");
  try {
    made.set(key, await self.Translator.create({ sourceLanguage: from, targetLanguage: to }));
    state.set(key, "ok");
    return "ok";
  } catch {
    state.set(key, "need"); // it wanted a click after all, or the download failed: a click tries again
    return "need";
  }
}

export const status = (from, to) => state.get(`${base(from)}>${base(to)}`) || "";

// the text in `to`, or null (not ready, can't, failed)
export async function translate(text, from, to) {
  const tr = made.get(`${base(from)}>${base(to)}`);
  if (!tr || !text) return null;
  try {
    return await tr.translate(text);
  } catch {
    return null;
  }
}
