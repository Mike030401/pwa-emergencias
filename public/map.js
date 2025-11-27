// ===========================================
// maps.js — LÓGICA DE MAPA Y GEOLOCALIZACIÓN
// ===========================================

// Variable Globales del Mapa
let map = null;
let userMarker = null;
let emergencyMarkers = [];

// ===========================================
// UTILIDADES UI
// ===========================================

// Helper para mostrar modales (asumimos que app.js lo expuso)
function showMapModal(title, body) {
    if (window.App && typeof window.App.showModal === 'function') {
        window.App.showModal(title, body);
    } else {
        alert(title + '\n\n' + body);
    }
}

// Helper para escapar HTML (asumimos que app.js lo expuso)
function escapeHtml(str) {
    if (window.App && typeof window.App.escapeHtml === 'function') {
        return window.App.escapeHtml(str);
    }
    return ('' + (str || '')).replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// ===========================================
// MARCADORES
// ===========================================

function clearMarkers() {
    emergencyMarkers.forEach(m => map.removeLayer(m));
    emergencyMarkers = [];
}

/**
 * Coloca marcadores en el mapa usando una lista de incidentes.
 * @param {Array<Object>} list - Lista de incidentes con lat/lng.
 */
function placeEmergencyMarkers(list = []) {
    if (!map) return;
    clearMarkers();
    
    // Filtra incidentes para mostrar solo los que tienen coordenadas válidas y no están cerrados
    const activeMarkers = list.filter(e => {
        const lat = parseFloat(e.lat || e.latitude || e.latitud);
        const lng = parseFloat(e.lng || e.longitude || e.longitud);
        const status = (e.status || 'ABIERTA').toUpperCase();

        if (Number.isNaN(lat) || Number.isNaN(lng) || status === 'CERRADA') return false;
        
        // Normalización para consistencia con Leaflet
        e.lat = lat;
        e.lng = lng;
        return true;
    });

    activeMarkers.forEach(e => {
        const title = escapeHtml(e.title || e.titulo || 'Incidente');
        const desc = escapeHtml(e.description || e.descripcion || '');
        
        const m = L.marker([e.lat, e.lng]).addTo(map).bindPopup(`<strong>${title}</strong><br>${desc}`);
        emergencyMarkers.push(m);
    });
}


/**
 * Carga emergencias desde la caché (IndexedDB) a través de window.App.
 */
async function loadEmergenciesFromCache() {
    if (!map) return;
    
    if (window.App && typeof window.App.getCachedIncidents === 'function') {
        try {
            const cached = await window.App.getCachedIncidents();
            placeEmergencyMarkers(cached);
        } catch (e) {
            console.error("No se pudo cargar la caché de incidentes para el mapa:", e);
        }
    } else {
        console.warn("window.App.getCachedIncidents no está disponible. ¿app.js cargó primero?");
    }
}

// ===========================================
// UBICACIÓN DEL USUARIO
// ===========================================

/**
 * Centra el mapa en la posición actual del usuario.
 * Expuesta como window.Map.centerOnUser.
 */
function centerOnUser() {
    if (!navigator.geolocation) { 
        showMapModal('GPS', 'Geolocalización no soportada'); 
        return; 
    }
    
    if (!map) {
        console.error('El mapa aún no está inicializado.');
        return;
    }
    
    navigator.geolocation.getCurrentPosition(pos => {
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        
        map.setView([lat, lng], 15);
        if (userMarker) map.removeLayer(userMarker);
        
        userMarker = L.marker([lat, lng]).addTo(map)
            .bindPopup('Tu ubicación')
            .openPopup();

    }, err => showMapModal('GPS', 'No se pudo obtener la ubicación: ' + (err.message || err.code)));
}

// ===========================================
// INICIAR MAPA
// ===========================================

/**
 * Inicializa el mapa Leaflet.
 * Expuesta como window.Map.init.
 */
function initMap() {
    if (!document.getElementById('mapid')) return;
    
    // Verificar si el mapa ya existe para evitar doble inicialización
    if (map) return; 
    
    map = L.map('mapid', { preferCanvas: true }).setView([19.4326, -99.1332], 13); // CDMX por default

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '© OpenStreetMap'
    }).addTo(map);

    // 1. Cargar marcadores desde la caché (siempre intentar la fuente offline)
    loadEmergenciesFromCache();
    
    // 2. Intentar centrar el mapa al inicio
    centerOnUser(); 
}

// ===========================================
// EXPOSICIÓN GLOBAL (API)
// ===========================================

// Exponemos un objeto API del mapa para que app.js y el HTML lo usen
window.Map = window.Map || {};
window.Map.init = initMap;
window.Map.centerOnUser = centerOnUser;
window.Map.loadEmergenciesFromCache = loadEmergenciesFromCache;


// ===========================================
// LISTENERS (Conexión al DOM)
// ===========================================

// Inicializa el mapa cuando el DOM esté listo
document.addEventListener("DOMContentLoaded", initMap); 

// Conectar botones del HTML a las funciones expuestas.
// Asumimos que app.js ya cableó estos botones si existen.
// Pero si quieres tener control aquí:
// safeAddListener('btn-center-me', 'click', centerOnUser); 
// safeAddListener('btn-report-emergency', 'click', window.App.reportMyLocation); // Asume que App expone reportMyLocation