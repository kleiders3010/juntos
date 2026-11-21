// A name as others see it (audit R17): no control characters, no marks that flip the text's direction or hide in
// it (so "Ana" can't be made to look like someone else), spaces folded. The joiner inside an emoji (a family, a
// rainbow flag) stays. Same rule in Ronda, Juntos and Sumate.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u115f\u1160\u180e\u200b\u200c\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\u3164\ufeff\uffa0\ufff9-\ufffb]/g;
const LONE_JOINER = /(?<![\p{Extended_Pictographic}\p{Emoji_Modifier}\ufe0f])\u200d|\u200d(?!\p{Extended_Pictographic})/gu;
export const cleanName = (v, n) => String(v ?? "").replace(/\s+/g, " ").replace(INVISIBLE, "").replace(LONE_JOINER, "").replace(/ {2,}/g, " ").trim().slice(0, n);
