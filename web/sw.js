// The "you're in a call" notification on phones (tapping it brings the call back), and the page shown with no connection.
// Pages and files still come fresh from the server every time (network first); only when the network fails is the
// small offline page shown, instead of the browser's error page (UX review U-J14: the Android app showed Chrome's).
const CACHE = "juntos-offline-1";
const OFFLINE = new URL("offline", self.registration.scope).href;
const FILES = ["offline", "offline.js", "i18n.js", "feedback.js", "schedule.js", "qr.js", "style.css", "img/icon-192.png"].map((f) => new URL(f, self.registration.scope).href);

// The copy is made again after any page that loads while it is missing: a copy that failed (no connection at the first
// visit) must not stay empty for good, and the install itself never fails, so the call notification always works.
let kept = false;
const keep = () =>
  kept ? Promise.resolve() : caches.open(CACHE).then((c) => c.match(OFFLINE).then((r) => (r ? r : c.addAll(FILES)))).then(() => (kept = true)).catch(() => {});
self.addEventListener("install", (e) => {
  e.waitUntil(keep().then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then(
        (r) => {
          e.waitUntil(keep());
          return r;
        },
        () => caches.match(OFFLINE).then((r) => r || Response.error()),
      ),
    );
    return;
  }
  // the offline page's own files, from the cache only when the network fails
  const url = req.url.split(/[?#]/)[0];
  if (FILES.includes(url)) e.respondWith(fetch(req).catch(() => caches.match(url).then((r) => r || Response.error())));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => new URL(c.url).pathname === new URL(url, self.location.origin).pathname);
      return open ? open.focus() : self.clients.openWindow(url);
    }),
  );
});
