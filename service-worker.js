const CACHE_NAME = "pwa-emergencias-v1";
const APP_SHELL = [
    "/",
    "/index.html",
    "/styles.css",
    "/app.js",
    "/manifest.json",
    "/pages/offline.html",
    "/icons/icon-192.png",
    "/icons/icon-512.png"
];

// =============================
//   INSTALL
// =============================
self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
    );
    self.skipWaiting(); // activa rápido el SW
});

// =============================
//   ACTIVATE
// =============================
self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(k => k !== CACHE_NAME)
                    .map(k => caches.delete(k))
            )
        )
    );
    self.clients.claim();
});

// =============================
//   FETCH (modo offline)
// =============================
self.addEventListener("fetch", event => {
    event.respondWith(
        fetch(event.request)
            .catch(() =>
                caches.match(event.request)
                    .then(resp => resp || caches.match("/pages/offline.html"))
            )
    );
});

// =============================
//   PUSH NOTIFICATIONS
// =============================
self.addEventListener("push", event => {

    if (!event.data) {
        console.error("❌ Push event sin datos");
        return;
    }

    const data = event.data.json();

    const options = {
        body: data.body || "Tienes una nueva notificación",
        icon: data.icon || "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        data: {
            url: data.url || "/" // abrir app al tocar
        }
    };

    event.waitUntil(
        self.registration.showNotification(data.title || "Emergencia", options)
    );
});

// =============================
//   CLICK EN NOTIFICACIÓN
// =============================
self.addEventListener("notificationclick", event => {
    event.notification.close();

    // abrir ventana de detalle
    const url = event.notification.data.url || "/";

    event.waitUntil(
        clients.matchAll({ type: "window", includeUncontrolled: true })
            .then(clientList => {
                for (const client of clientList) {
                    if (client.url === url && "focus" in client) {
                        return client.focus();
                    }
                }
                if (clients.openWindow) {
                    return clients.openWindow(url);
                }
            })
    );
});
