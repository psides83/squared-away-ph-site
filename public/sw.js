/* Push only: private pages and API responses are never cached. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("push", (event) => {
  let message = {};
  try {
    message = event.data?.json() ?? {};
  } catch {}
  const allowed = ["/admin/inventory/recovery", "/admin/invoices/recurring"];
  const url = allowed.includes(message.url)
    ? message.url
    : "/admin/settings/notifications";
  event.waitUntil(
    self.registration.showNotification(
      typeof message.title === "string" ? message.title : "Squared Away",
      {
        body:
          typeof message.body === "string"
            ? message.body
            : "Open the app to review your barn office.",
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        tag: typeof message.tag === "string" ? message.tag : "squared-away",
        data: { url },
      },
    ),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const allowed = [
    "/admin/inventory/recovery",
    "/admin/invoices/recurring",
    "/admin/settings/notifications",
  ];
  const path = allowed.includes(event.notification.data?.url)
    ? event.notification.data.url
    : "/admin/settings/notifications";
  const url = new URL(path, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const window of windows) {
        if (new URL(window.url).origin === self.location.origin) {
          await window.navigate(url);
          await window.focus();
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
