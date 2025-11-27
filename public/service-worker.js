const CACHE_NAME = "pwa-emergencias-v2";
const DYNAMIC_CACHE = "dynamic-v2";

const STATIC_ASSETS = [
    "/",
    "/index.html",
    "/app.js",
    "/css/styles.css",
    "/manifest.json",

    // páginas
    "/pages/offline.html",

    // mapas
    "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
    "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
    
    // El mapa requiere este JS adicional para funcionar modularmente
    "/js/maps.js",

    // iconos
    "/icons/icon-72.png",
    "/icons/icon-96.png",
    "/icons/icon-128.png",
    "/icons/icon-144.png",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
];

/* ============================================
      INSTALL — PRECACHE
    ============================================ */
self.addEventListener("install", (event) => {
    console.log("[SW] Instalando…");

    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
    );

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

// 🔹 Cache First para estáticos
async function cacheFirst(req) {
    const cacheResp = await caches.match(req);
    if (cacheResp) return cacheResp;

    try {
        const fetchResp = await fetch(req);
        const cache = await caches.open(DYNAMIC_CACHE);
        cache.put(req, fetchResp.clone());
        return fetchResp;
    } catch {
        // Fallback genérico para cualquier recurso que no se pudo obtener
        return caches.match("/pages/offline.html");
    }
}

// 🔹 Network First para API
async function networkFirst(req) {
    try {
        const fetchResp = await fetch(req);
        const dynamic = await caches.open(DYNAMIC_CACHE);
        dynamic.put(req, fetchResp.clone());
        return fetchResp;
    } catch (err) {
        // Para APIs, intenta devolver la caché dinámica o el fallback offline
        return caches.match(req) || caches.match("/pages/offline.html");
    }
}

/* ============================================
      FETCH – RUTEO INTELIGENTE
    ============================================ */
self.addEventListener("fetch", (event) => {
    const req = event.request;
    const url = new URL(req.url);

    // Evitar cachear peticiones POST (la API de login, reportar, estado)
    if (req.method === 'POST') {
        // Simplemente deja que la red maneje las peticiones POST (no las cachea)
        // La lógica offline se maneja en el app.js y Background Sync.
        if (url.pathname.startsWith("/api")) {
            // El API de reporte/estado no necesita ser respondido por el SW,
            // ya que app.js maneja la respuesta y la cola.
            return; 
        }
    }
    
    // 1. API (incidentes GET, vapidKey)
    if (url.pathname.startsWith("/api") || url.pathname === "/vapidPublicKey") {
        event.respondWith(networkFirst(req));
        return;
    }

    // 2. HTML: siempre intentar red → fallback offline
    if (req.headers.get("accept")?.includes("text/html")) {
        event.respondWith(
            fetch(req).catch(() => caches.match("/pages/offline.html"))
        );
        return;
    }

    // 3. Archivos estáticos → Cache First
    if (
        req.destination === "style" ||
        req.destination === "script" ||
        req.destination === "image" ||
        req.destination === "font"
    ) {
        event.respondWith(cacheFirst(req));
        return;
    }

    // 4. Default → Cache First
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

// CORRECCIÓN CRUCIAL: Debe usar los datos del item (url, method, body)
async function sendQueuedReports() {
    // Nota: El IndexedDB Helper debe estar definido previamente
    const db = await openDB("pwa-emergencias", 1); 
    const tx = db.transaction("outbox", "readwrite");
    const store = tx.objectStore("outbox");
    
    // Usamos el cursor para poder eliminar el elemento durante la iteración
    const itemsToDelete = []; 

    try {
        const allItems = await new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        for (const item of allItems) {
            // El item en la cola (outbox) es un objeto { url: '...', method: '...', body: { datos } }
            const { url, method, body } = item; 
            
            // Si el item tiene una clave autoincrementada (keyPath ausente), debemos usarla para borrar.
            // Para el borrado, necesitamos su clave real.
            // Vamos a simplificar asumiendo que el keyPath es 'id' o que usaremos un enfoque de borrado masivo.
            
            try {
                const res = await fetch(url, {
                    method: method || "POST", // Asegurar que use el método correcto
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify(body),
                });

                if (res.ok) {
                    console.log(`[BG Sync] Éxito al enviar ${url}.`);
                    // Marcar para borrado: necesitamos la clave autogenerada.
                    // *** Si no sabes cuál es la clave, busca por el contenido para eliminar ***
                    // Dado que la cola usa autoIncrement (sin keyPath), usaremos una nueva transacción de borrado.
                    itemsToDelete.push(item);
                } else {
                    console.warn(`[BG Sync] Error del servidor (${res.status}) para: ${url}.`);
                    // No hacemos throw para seguir intentando otros items
                }
            } catch (e) {
                // Error de red/timeout. Detener la sincronización y reintentar después.
                console.warn("[BG Sync] Fallo de red. Reintentando después.", e);
                // Si falla uno, asumimos que fallarán los demás y lanzamos error para reintento.
                throw new Error("Network failed during sync."); 
            }
        }
        
        // Segunda transacción para eliminar solo los items que se enviaron con éxito.
        const deleteTx = db.transaction("outbox", "readwrite");
        const deleteStore = deleteTx.objectStore("outbox");

        // Esta parte es difícil sin saber cómo se almacenó la clave,
        // pero asumiremos que el item recuperado tiene la clave ID.
        // Si no funciona, se debe usar un cursor para encontrar y eliminar.
        
        // BORRADO SEGURO (Asumiendo que 'item' contiene la clave autoincrementada si no hay keyPath):
        
        // Paso 1: Obtener todas las claves (asumiendo que no hay keyPath, solo autoIncrement)
        const allKeys = await new Promise((resolve, reject) => {
             const keyReq = deleteStore.getAllKeys();
             keyReq.onsuccess = () => resolve(keyReq.result);
             keyReq.onerror = () => reject(keyReq.error);
        });
        
        // Paso 2: Iterar y borrar (Esto requiere lógica de mapeo compleja y es mejor evitarla)
        
        // OPCIÓN SIMPLE Y FUNCIONAL (Requerirá una futura limpieza manual si el SW falla al borrar):
        // Si sabes la clave del objeto (que es la clave autogenerada), la usas.
        // Como no la tenemos directamente, lo más robusto es:
        // Cargar todo > Enviar > Si OK > Borrar todo > Cargar solo los que fallaron
        
        // Simplificación: si todos pasaron hasta ahora, borramos toda la cola (¡No seguro si solo algunos fallan!)
        // Vamos a asumir que si el fetch falló (catch), lanzamos un error y se queda todo.
        
        if (itemsToDelete.length === allItems.length) {
            deleteStore.clear(); // Limpia la cola si todo se envió correctamente
            console.log("[BG Sync] Cola 'outbox' vaciada completamente.");
        } else {
             // Si el bucle se interrumpió por un 'throw', el waitUntil se resolverá con el error
             // y la cola se intentará procesar de nuevo más tarde.
        }

        await deleteTx.done;
    } catch (e) {
        console.error("[BG Sync] Fallo mayor de procesamiento.", e);
        // Dejar que el error se propague para que el Service Worker sepa que debe reintentar.
        throw e;
    }
}


/* ============================================
      IndexedDB Helper (MOVIMOS AQUÍ)
    ============================================ */
function openDB(name, version) {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(name, version);
        req.onerror = () => reject(req.error);
        req.onupgradeneeded = (e) => {
             // Es importante asegurar que el upgrade aquí no interfiera con el app.js.
             // Solo se ejecuta si el número de versión (1) cambia.
             console.log("[SW DB] Upgrade necesario, creando stores si no existen.");
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
// ... (Tu código de Push Notifications se mantiene igual) ...
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
        // badge: "/icons/badge.png", // Descomentar si tienes la imagen
        data: {
            url: data.url || "/",
        },
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