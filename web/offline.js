// The page the service worker shows when Juntos opens with no connection (UX review U-J14): what is wrong, Try again,
// and the calls planned on this device (they are kept here, so they can be read without the internet).
import { t, translatePage } from "./i18n.js";
import { load, nextStart, when } from "./schedule.js";

translatePage();
document.getElementById("retry").onclick = () => {
  location.reload();
};
// back online: the real page
addEventListener("online", () => location.reload());

const now = Date.now();
const list = load()
  .map((c) => ({ c, at: nextStart(c, now) }))
  .filter((x) => x.at !== null)
  .sort((x, y) => x.at - y.at);
const box = document.getElementById("upcoming");
if (list.length) {
  const h = document.createElement("h2");
  h.textContent = t("Planned on this device");
  box.append(h);
  for (const { c, at } of list) {
    const row = document.createElement("div");
    row.className = "upItem";
    const info = document.createElement("div");
    info.className = "upInfo";
    const b = document.createElement("b");
    b.textContent = c.title || t("Juntos call");
    const s = document.createElement("span");
    s.textContent = when(at, c.dur, t, true);
    info.append(b, s);
    row.append(info);
    box.append(row);
  }
  box.hidden = false;
}
