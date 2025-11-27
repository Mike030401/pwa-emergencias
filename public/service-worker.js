const CACHE_NAME = "pwa-emergencias-v2";
const DYNAMIC_CACHE = "dynamic-v2";

// Archivos locales
const STATIC_ASSETS_LOCAL = [
    "/",
    "/index.html",
    "/login.html",
    "/app.js",
    "/map.js",
    "/auth.js",
    "/css/styles.css",
    "/manifest.json",
    "/pages/offline.html",
    "/icons/icon-72.png",
    "/icons/icon-96.png",
    "/icons/icon-128.png",
    "/icons/icon-144.png",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
];

// Archivos externos (Leaflet)
const STATIC_ASSETS_EXTERNAL = [
    "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
    "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
];

/* ============================================
      INSTALL — PRECACHE
============================================ */
self.addEventListener("install", (event) => {
    console.log("[SW] Instalando…");

    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);

        // Cachear locales uno por uno
        for (const file of STATIC_ASSETS_LOCAL) {
            try {
                await cache.add(file);
                console.log(`[SW] Archivo local cacheado: ${file}`);
            } catch (err) {
                console.warn(`[SW] No se pudo cachear local: ${file}`, err);
            }
        }

        // Cachear externos (solo si hay CORS)
        for (const url of STATIC_ASSETS_EXTERNAL) {
            try {
                const response = await fetch(url, { mode: 'cors' });
                await cache.put(url, response.clone());
                console.log(`[SW] Archivo externo cacheado: ${url}`);
            } catch (err) {
                console.warn(`[SW] No se pudo cachear externo: ${url}`, err);
            }
        }
    })());

    self.skipWaiting();
});

/* ============================================
      ACTIVATE — BORRAR CACHES ANTIGUOS
============================================ */
self.addEventListener("activate", (event) => {
    console.log("[SW] Activado");

    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((k) => k !== CACHE_NAME && k !== DYNAMIC_CACHE)
                    .map((k) => caches.delete(k))
            )
        )
    );

    self.clients.claim();
});

/* ============================================
      ESTRATEGIAS DE CACHE
============================================ */
// Cache First
async function cacheFirst(req) {
    const cacheResp = await caches.match(req);
    if (cacheResp) return cacheResp;

    try {
        const fetchResp = await fetch(req);
        if (req.method === "GET") {
            const cache = await caches.open(DYNAMIC_CACHE);
            cache.put(req, fetchResp.clone());
        }
        return fetchResp;
    } catch (err) {
        console.warn("[SW] Fetch failed, returning offline page", err);
        return caches.match("/pages/offline.html");
    }
}

// Network First
async function networkFirst(req) {
    try {
        const fetchResp = await fetch(req);
        if (req.method === "GET") {
            const dynamic = await caches.open(DYNAMIC_CACHE);
            dynamic.put(req, fetchResp.clone());
        }
        return fetchResp;
    } catch (err) {
        return caches.match(req) || caches.match("/pages/offline.html");
    }
}

/* ============================================
      FETCH – RUTEO INTELIGENTE
============================================ */
self.addEventListener("fetch", (event) => {
    const req = event.request;
    const url = new URL(req.url);

    if (req.method === 'POST') {
        if (url.pathname.startsWith("/api")) return;
    }

    if (url.pathname.startsWith("/api") || url.pathname === "/vapidPublicKey") {
        event.respondWith(networkFirst(req));
        return;
    }

    if (req.headers.get("accept")?.includes("text/html")) {
        event.respondWith(fetch(req).catch(() => caches.match("/pages/offline.html")));
        return;
    }

    if (
        req.destination === "style" ||
        req.destination === "script" ||
        req.destination === "image" ||
        req.destination === "font"
    ) {
        event.respondWith(cacheFirst(req));
        return;
    }

    event.respondWith(cacheFirst(req));
});

/* ============================================
      BACKGROUND SYNC
============================================ */
self.addEventListener("sync", (event) => {
    if (event.tag === "sync-report-queue") {
        console.log("[SW] Background Sync iniciado.");
        event.waitUntil(sendQueuedReports());
    }
});

async function sendQueuedReports() {
    const db = await openDB("pwa-emergencias", 1);
    const tx = db.transaction("outbox", "readwrite");
    const store = tx.objectStore("outbox");

    try {
        const allItems = await new Promise((resolve, reject) => {
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });

        for (const item of allItems) {
            const { url, method, body, id } = item;
            try {
                const res = await fetch(url, {
                    method: method || "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify(body),
                });

                if (res.ok && id != null) {
                    store.delete(id); // eliminar solo si tiene id
                    console.log(`[BG Sync] Éxito al enviar ${url}`);
                }
            } catch (e) {
                console.warn("[BG Sync] Fallo de red. Reintentando después.", e);
                throw e;
            }
        }
    } catch (e) {
        console.error("[BG Sync] Error en procesamiento", e);
        throw e;
    }
}

/* ============================================
      IndexedDB Helper
============================================ */
function openDB(name, version) {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(name, version);
        req.onerror = () => reject(req.error);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains("incidentes")) {
                db.createObjectStore("incidentes", { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains("outbox")) {
                db.createObjectStore("outbox", { autoIncrement: true });
            }
        };
        req.onsuccess = () => resolve(req.result);
    });
}

/* ============================================
      PUSH NOTIFICATIONS
============================================ */
self.addEventListener("push", (event) => {
    let data = {};
    try {
        data = event.data.json();
    } catch {
        data = { title: "Emergencia", body: "Nueva alerta recibida" };
    }

    const title = data.title || "Emergencia";
    const options = {
        body: data.body || "Se ha reportado una nueva emergencia.",
        icon: "/icons/icon-192.png",
        data: { url: data.url || "/" },
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const url = event.notification.data?.url || "/";
    event.waitUntil(
        clients.matchAll({ type: "window" }).then((clientsList) => {
            const open = clientsList.find((c) => c.url === url);
            if (open) return open.focus();
            return clients.openWindow(url);
        })
    );
});
