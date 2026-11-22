/* global self, URL */
// Service worker de los avisos push para Caro (RF18). Solo muestra los avisos y abre la
// agenda al tocarlos: no guarda nada en caché.

self.addEventListener("push", (event) => {
  // El servidor envía { title, body, url } (PushPayload en @caro/shared).
  let payload;
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }
  // Siempre se muestra un aviso: el navegador lo exige por cada push recibido.
  event.waitUntil(
    self.registration.showNotification(payload.title || "Caro Restrepo Nails", {
      body: payload.body || "",
      icon: "/icon-192.png",
      lang: "es-CO",
      data: { url: payload.url || "/admin/agenda" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/admin/agenda", self.location.origin);
  // Solo direcciones del mismo sitio.
  const target = url.origin === self.location.origin ? url.href : self.location.origin + "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => client.url === target);
      return open ? open.focus() : self.clients.openWindow(target);
    }),
  );
});
