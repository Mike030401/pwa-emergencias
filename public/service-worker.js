const CACHE_STATIC_NAME   = 'static-v4';
const CACHE_DYNAMIC_NAME  = 'dynamic-v2';
const CACHE_INMUTABLE_NAME = 'inmutable-v1';

const APP_SHELL = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/manifest.json',
    '/pages/offline.html',
    '/icons/icon-192.png', // Asegúrate de incluir todos los iconos aquí
    '/icons/icon-144.png' // Icono reportado en el error
];

const INMUTABLE_SHELL = [
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css'
];

// Función para limpiar cachés antiguos
function cleanCache(cacheName, maxItems) {
    caches.open(cacheName)
        .then(cache => {
            return cache.keys()
                .then(keys => {
                    if (keys.length > maxItems) {
                        cache.delete(keys[0])
                            .then(cleanCache(cacheName, maxItems));
                    }
                });
        });
}

// Instalación: Carga archivos estáticos e inmutables.
self.addEventListener('install', e => {

    const cacheStatic = caches.open(CACHE_STATIC_NAME)
        .then(cache => cache.addAll(APP_SHELL));

    const cacheInmutable = caches.open(CACHE_INMUTABLE_NAME)
        .then(cache => cache.addAll(INMUTABLE_SHELL));

    e.waitUntil(Promise.all([cacheStatic, cacheInmutable]));

});

// Activación: Elimina cachés obsoletos.
self.addEventListener('activate', e => {

    const cacheWhiteList = [CACHE_STATIC_NAME, CACHE_DYNAMIC_NAME, CACHE_INMUTABLE_NAME];

    e.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.map(key => {
                    if (cacheWhiteList.indexOf(key) === -1) {
                        return caches.delete(key);
                    }
                })
            );
        })
    );

});

// Fetch: Estrategia de caché (Cache First with Network Fallback)
self.addEventListener('fetch', e => {

    // 1. Estrategia Cache Only para rutas de API (la lógica IDB está en app.js)
    // Devolvemos el control para que app.js maneje la respuesta offline con IndexedDB
    if (e.request.url.includes('/api/incidents')) {
        // Devuelve una respuesta vacía o ignora si no es un GET
        if (e.request.method === 'GET') {
            return e.respondWith(
                fetch(e.request).catch(err => {
                    // Cuando falla la red, app.js sabe buscar en IndexedDB.
                    return new Response(null, { status: 503, statusText: 'Offline' });
                })
            );
        }
    }


    // 2. Estrategia Cache First con Network Fallback (Para el App Shell)
    const respuesta = caches.match(e.request)
        .then(res => {

            if (res) {
                return res; // Si está en caché, lo devuelve.
            } else {
                
                // Si NO está en caché, va a la red.
                return fetch(e.request)
                    .then(newRes => {
                        return caches.open(CACHE_DYNAMIC_NAME)
                            .then(cache => {
                                // Guarda el nuevo recurso en caché dinámico
                                cache.put(e.request, newRes.clone());
                                cleanCache(CACHE_DYNAMIC_NAME, 50); // Mantiene solo 50 elementos
                                return newRes;
                            });
                    })
                    .catch(() => {
                        // Si falla la red (y no estaba en caché)
                        // Devuelve el fallback para las páginas principales
                        if (e.request.headers.get('accept').includes('text/html')) {
                            return caches.match('/pages/offline.html');
                        }
                    });
            }
        });

    e.respondWith(respuesta);
});

// =========================
// NOTIFICACIONES PUSH
// =========================

self.addEventListener('push', e => {
    
    // Si no hay datos, usa un payload por defecto
    const data = e.data.json() || {
        title: 'Nueva Notificación',
        body: 'Alerta del centro de control',
        icon: '/icons/icon-192.png'
    };

    const title = data.title;
    const options = {
        body: data.body,
        icon: data.icon,
        badge: data.icon // Pequeño icono en la barra de notificaciones
    };

    e.waitUntil(self.registration.showNotification(title, options));

});