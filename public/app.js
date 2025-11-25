// =========================
// Registrar Service Worker
// =========================
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js')
        .then(() => console.log('SW registrado correctamente'))
        .catch(err => console.error('Error registrando SW:', err));
}

// =========================
// IndexedDB
// =========================
const DB_NAME = 'pwa-emergencias';
const STORE_INCIDENTS = 'incidentes';

function idbOpen() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);

        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_INCIDENTS)) {
                db.createObjectStore(STORE_INCIDENTS, { keyPath: 'id' });
            }
        };

        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbWrite(store, dataArray) {
    const db = await idbOpen();
    const tx = db.transaction(store, "readwrite");
    const os = tx.objectStore(store);

    dataArray.forEach(item => os.put(item));

    return new Promise(resolve => {
        tx.oncomplete = () => resolve(true);
    });
}

async function idbRead(store) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readonly");
        const os = tx.objectStore(store);
        const req = os.getAll();

        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// =========================
// Pintar incidentes
// =========================
async function renderIncidents(data) {
    const list = document.getElementById("incidentList");
    if (!list) return console.warn("No existe #incidentList en el DOM");

    list.innerHTML = "";

    data.forEach(item => {
        const li = document.createElement("li");
        li.innerHTML = `<strong>${item.title}</strong><br>${item.description}`;
        list.appendChild(li);
    });
}

// =========================
// Fetch remoto
// =========================
async function fetchIncidents() {
    try {
        const resp = await fetch("/api/incidents");
        const data = await resp.json();

        renderIncidents(data);
        await idbWrite(STORE_INCIDENTS, data);

    } catch (err) {
        console.warn("Sin conexión, cargando IndexedDB");
        const cached = await idbRead(STORE_INCIDENTS);
        renderIncidents(cached);
    }
}

fetchIncidents();

// =========================
// Push Notifications
// =========================
const subscribeBtn = document.getElementById("subscribeBtn");

async function subscribeToPush() {
    if (!('serviceWorker' in navigator)) return alert('SW no soportado');
    if (!('PushManager' in window)) return alert('Push no soportado');

    const reg = await navigator.serviceWorker.ready;
    const perm = await Notification.requestPermission();

    if (perm !== "granted") {
        return alert("Permiso de notificaciones rechazado");
    }

    const vapidResp = await fetch('/vapidPublicKey');
    const vapidKey = await vapidResp.text();
    const convertedKey = urlBase64ToUint8Array(vapidKey);

    const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedKey
    });

    await fetch('/api/subscribe', {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sub)
    });

    alert("Suscripción creada");
}

if (subscribeBtn) {
    subscribeBtn.addEventListener("click", subscribeToPush);
}

// =========================
// Utility
// =========================
function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");

    const rawData = atob(base64);
    const array = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        array[i] = rawData.charCodeAt(i);
    }

    return array;
}
