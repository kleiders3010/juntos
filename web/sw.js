// Only for the "you're in a call" notification on phones: tapping it brings the call back.
// No caching: every page load comes fresh from the server.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => new URL(c.url).pathname === new URL(url, self.location.origin).pathname);
      return open ? open.focus() : self.clients.openWindow(url);
    }),
  );
});
