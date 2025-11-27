// ===========================================
// map.js — PWA Optimizado (offline-first)
// ===========================================

let map = null;
let userMarker = null;
let emergencyMarkers = [];

// Nombre del store en IndexedDB para marcadores y estado
const MAP_DB = 'pwa-emergencias';
const STORE_NAME = 'mapState';

/* ===========================================
   UTILIDADES
=========================================== */
function showModal(title, body) {
    if (window.App && typeof window.App.showModal === 'function') {
        window.App.showModal(title, body);
    } else {
        alert(title + '\n\n' + body);
    }
}

function escapeHtml(str) {
    if (window.App && typeof window.App.escapeHtml === 'function') {
        return window.App.escapeHtml(str);
    }
    return ('' + (str || '')).replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function safeAddListener(id, event, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, fn);
}

/* ===========================================
   INDEXEDDB HELPERS
=========================================== */
function openDB(name = MAP_DB, version = 1) {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(name, version);
        req.onerror = () => reject(req.error);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            }
        };
        req.onsuccess = () => resolve(req.result);
    });
}

async function saveMapState({ center, zoom, markers }) {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    await store.clear(); // Limpiar antiguo estado
    await store.add({ center, zoom, markers });
    await tx.done;
}

async function loadMapState() {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    return new Promise((resolve) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result[0] || null);
        req.onerror = () => resolve(null);
    });
}

/* ===========================================
   MARCADORES
=========================================== */
function clearMarkers() {
    emergencyMarkers.forEach(m => map.removeLayer(m));
    emergencyMarkers = [];
}

function placeEmergencyMarkers(list = []) {
    if (!map) return;
    clearMarkers();

    const activeMarkers = list.filter(e => {
        const lat = parseFloat(e.lat || e.latitude || e.latitud);
        const lng = parseFloat(e.lng || e.longitude || e.longitud);
        const status = (e.status || 'ABIERTA').toUpperCase();
        if (Number.isNaN(lat) || Number.isNaN(lng) || status === 'CERRADA') return false;
        e.lat = lat; e.lng = lng;
        return true;
    });

    activeMarkers.forEach(e => {
        const title = escapeHtml(e.title || e.titulo || 'Incidente');
        const desc = escapeHtml(e.description || e.descripcion || '');
        const m = L.marker([e.lat, e.lng]).addTo(map).bindPopup(`<strong>${title}</strong><br>${desc}`);
        emergencyMarkers.push(m);
    });

    // Guardar estado en IndexedDB
    const state = {
        center: map.getCenter(),
        zoom: map.getZoom(),
        markers: activeMarkers
    };
    saveMapState(state).catch(console.error);
}

/* ===========================================
   UBICACIÓN DEL USUARIO
=========================================== */
function centerOnUser() {
    if (!navigator.geolocation) {
        showModal('GPS', 'Geolocalización no soportada');
        return;
    }
    if (!map) return;

    navigator.geolocation.getCurrentPosition(pos => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;

        map.setView([lat, lng], 15);
        if (userMarker) map.removeLayer(userMarker);

        userMarker = L.marker([lat, lng]).addTo(map)
            .bindPopup('Tu ubicación')
            .openPopup();
    }, err => showModal('GPS', 'No se pudo obtener la ubicación: ' + (err.message || err.code)));
}

/* ===========================================
   CARGA OFFLINE
=========================================== */
async function loadEmergenciesFromCache() {
    if (!map) return;

    let cached = [];
    if (window.App && typeof window.App.getCachedIncidents === 'function') {
        try { cached = await window.App.getCachedIncidents(); } 
        catch (e) { console.warn("No se pudo cargar cache de incidentes:", e); }
    }

    // Intentar restaurar estado del mapa (centro y zoom)
    const savedState = await loadMapState();
    if (savedState) {
        map.setView(savedState.center, savedState.zoom);
        placeEmergencyMarkers(savedState.markers);
    } else {
        placeEmergencyMarkers(cached);
    }
}

/* ===========================================
   INICIALIZAR MAPA
=========================================== */
function initMap() {
    if (!document.getElementById('mapid')) return;
    if (map) return;

    map = L.map('mapid', { preferCanvas: true }).setView([19.4326, -99.1332], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
    }).addTo(map);

    // Cargar datos offline primero
    loadEmergenciesFromCache();

    // Intentar centrar usuario
    centerOnUser();
}

/* ===========================================
   EXPOSICIÓN GLOBAL
=========================================== */
window.Map = window.Map || {};
window.Map.init = initMap;
window.Map.centerOnUser = centerOnUser;
window.Map.loadEmergenciesFromCache = loadEmergenciesFromCache;

/* ===========================================
   EVENTOS DOM
=========================================== */
document.addEventListener("DOMContentLoaded", initMap);
safeAddListener('btn-center-me', 'click', centerOnUser);
