/* app.js — PWA Emergencias (optimizado, modular, todo en 1 archivo)
    Funcionalidades:
    - Registro Service Worker
    - IndexedDB (incidentes + cola de reportes offline)
    - Carga y render de incidentes
    - Leaflet map + marcadores + centrar usuario + reportar ubicación
    - Login (backend fallback + demo users)
    - Push subscription (VAPID) + envío al servidor
    - Manejo offline / reintentos (incluyendo acciones del operador)
*/

(() => {
    'use strict';

    /* ---------- CONFIG ---------- */
    const DB_NAME = 'pwa-emergencias';
    const DB_VER = 1;
    const STORE_INCIDENTS = 'incidentes';
    const STORE_QUEUE = 'outbox'; // reportes pendientes a enviar cuando vuelva la red
    const API = {
        incidents: '/api/incidents',
        emergencias: '/api/emergencias',
        report: ['/api/reportar', '/api/report', '/api/reportar-emergencia'], // try these in order
        changeStatus: '/api/emergencia/estado', // NUEVO ENDPOINT
        subscribe: '/save-subscription', // Ajustado a la convención del backend
        sendNotification: '/send-notification', // Ajustado a la convención del backend
        vapidKey: '/vapidPublicKey',
        login: '/api/login'
    };

    /* ---------- UTIL (DOM safe selectors) ---------- */
    const $ = (id) => document.getElementById(id);
    const exists = (id) => !!$(id);
    const escapeHtml = (str) => ('' + (str || '')).replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

    function safeAddListener(id, evt, fn) {
        const el = $(id);
        if (el) el.addEventListener(evt, fn);
    }

    /* ---------- MODALS / UI HELPERS ---------- */
    function showModal(title, body) {
        const modal = $('modal');
        if (!modal) {
            alert(title + '\n\n' + body);
            return;
        }
        $('modal-title').textContent = title;
        $('modal-body').textContent = body;
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
    function closeModal() {
        const modal = $('modal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }

    safeAddListener('modal-close', 'click', closeModal);

    /* ---------- SIMPLE AUTH (demo + optional backend) ---------- */
    function getSavedUser() {
        try { return JSON.parse(localStorage.getItem('pwaUser')); } catch (e) { return null; }
    }
    function saveUser(u) { localStorage.setItem('pwaUser', JSON.stringify(u)); }
    function clearUser() { localStorage.removeItem('pwaUser'); }

    function applyUserToUI(user) {
        if (!user) return;
        const btnLogout = $('btn-logout');
        if (btnLogout) btnLogout.classList.remove('hidden');
        const roleLabel = $('label-role');
        if (roleLabel) roleLabel.textContent = user.role ? `(${user.role})` : '';
        const status = $('pwa-status');
        if (status) status.textContent = `Usuario: ${user.email || user.role || 'operador'}`;
    }
    function removeUserFromUI() {
        const btnLogout = $('btn-logout');
        if (btnLogout) btnLogout.classList.add('hidden');
        const roleLabel = $('label-role');
        if (roleLabel) roleLabel.textContent = '';
        const status = $('pwa-status');
        if (status) status.textContent = 'Sin sesión';
    }

    async function tryLoginServer(email, password) {
        if (!API.login) return null;
        try {
            const r = await fetch(API.login, {
                method: 'POST', headers: {'content-type':'application/json'},
                body: JSON.stringify({ email, password })
            });
            if (!r.ok) return null;
            const j = await r.json();
            if (j && j.ok && j.user) return j.user;
            return null;
        } catch (e) {
            return null;
        }
    }

    function initAuth() {
        // buttons
        safeAddListener('btn-open-login', 'click', () => {
            const lm = $('loginModal'); if (!lm) return;
            lm.classList.remove('hidden'); lm.classList.add('flex');
        });
        safeAddListener('loginCancel', 'click', () => {
            const lm = $('loginModal'); if (!lm) return;
            lm.classList.add('hidden'); lm.classList.remove('flex');
        });

        safeAddListener('loginSubmit', 'click', async () => {
            const email = $('loginEmail') ? $('loginEmail').value.trim() : '';
            const password = $('loginPassword') ? $('loginPassword').value.trim() : '';
            if (!email || !password) { showModal('Error', 'Completa correo y contraseña'); return; }

            // try backend first
            const srvUser = await tryLoginServer(email, password);
            if (srvUser) {
                saveUser(srvUser);
                $('loginModal').classList.add('hidden'); $('loginModal').classList.remove('flex');
                applyUserToUI(srvUser);
                return;
            }

            // demo fallback users
            const demoUsers = [
                { email: 'policia@emergencias.com', password: '123456', role: 'policia' },
                { email: 'bombero@emergencias.com', password: '123456', role: 'bombero' },
                { email: 'medico@emergencias.com', password: '123456', role: 'medico' }
            ];
            const found = demoUsers.find(u => u.email === email && u.password === password);
            if (!found) { showModal('Error', 'Credenciales incorrectas'); return; }
            const user = { email: found.email, role: found.role };
            saveUser(user);
            $('loginModal').classList.add('hidden'); $('loginModal').classList.remove('flex');
            applyUserToUI(user);
        });

        safeAddListener('btn-logout', 'click', () => {
            clearUser();
            removeUserFromUI();
            showModal('Sesión', 'Has cerrado sesión');
        });

        // apply existing user
        const user = getSavedUser();
        if (user) applyUserToUI(user);
    }

    /* ---------- INDEXEDDB (promisified) ---------- */
    function idbOpen() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VER);
            req.onupgradeneeded = (ev) => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE_INCIDENTS)) {
                    db.createObjectStore(STORE_INCIDENTS, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(STORE_QUEUE)) {
                    db.createObjectStore(STORE_QUEUE, { autoIncrement: true });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function idbWrite(store, items = []) {
        const db = await idbOpen();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(store, 'readwrite');
            const os = tx.objectStore(store);
            if (Array.isArray(items)) items.forEach(it => os.put(it));
            else os.put(items);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    }

    async function idbReadAll(store) {
        const db = await idbOpen();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(store, 'readonly');
            const os = tx.objectStore(store);
            const rq = os.getAll();
            rq.onsuccess = () => resolve(rq.result);
            rq.onerror = () => reject(rq.error);
        });
    }

    async function idbAddToQueue(payload) {
        const db = await idbOpen();
        return new Promise(async (resolve, reject) => {
            try {
                const tx = db.transaction(STORE_QUEUE, 'readwrite');
                const os = tx.objectStore(STORE_QUEUE);
                os.add(payload);
                tx.oncomplete = async () => {
                    // CRUCIAL: Registrar el sync después de guardar
                    if ('serviceWorker' in navigator && 'SyncManager' in window) {
                        const registration = await navigator.serviceWorker.ready;
                        registration.sync.register('sync-report-queue');
                    }
                    resolve(true);
                };
                tx.onerror = () => reject(tx.error);
            } catch (e) {
                reject(e);
            }
        });
    }

    async function idbClearStore(store) {
        const db = await idbOpen();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(store, 'readwrite');
            tx.objectStore(store).clear();
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    }
    
    /* ---------- OPERATOR ACTIONS (changeStatus: send or queue) ---------- */

    async function trySendStatusUpdate(payload) {
        if (!API.changeStatus) return false;
        try {
            const r = await fetch(API.changeStatus, { 
                method: 'POST', 
                headers: {'content-type':'application/json'}, 
                body: JSON.stringify(payload) 
            });
            return r.ok;
        } catch (e) {
            return false; // Error de red
        }
    }

    /**
     * Lógica central para cambiar el estado de un incidente (usado por botones de UI).
     * Expuesto globalmente como window.App.changeIncidentStatus.
     * @param {string|number} id - ID del incidente
     * @param {string} newStatus - Nuevo estado (e.g., 'EN_CURSO', 'CERRADA')
     */
    async function changeIncidentStatus(id, newStatus) {
        const payload = { 
            id: String(id), 
            estado: newStatus 
        };

        // La acción para la cola offline
        const action = {
            url: API.changeStatus,
            method: 'POST',
            body: payload
        };

        try {
            const sent = await trySendStatusUpdate(payload);
            
            if (sent) {
                showModal('Éxito', `Incidente ${id} actualizado a **${newStatus}**.`);
            } else {
                // Falla de red/servidor. Guardar en cola.
                await idbAddToQueue(action);
                showModal('Guardado Offline', `Incidente ${id} guardado en cola. Se enviará al servidor al recuperar la conexión.`);
            }
        } catch (e) {
            // Fallo inesperado. Guardar en cola.
            await idbAddToQueue(action); 
            showModal('Guardado Local', 'Ocurrió un error. Se guardó localmente para reintento posterior.');
        }
        
        // Refrescar UI
        await loadIncidentsToUI();
        // Si tienes maps.js cargado, también lo refrescamos (se llama a través de window.App)
        if (window.Map && typeof window.Map.loadEmergenciesFromCache === 'function') {
            window.Map.loadEmergenciesFromCache();
        }
    }

    /* ---------- INCIDENTS: fetch, render, fallback ---------- */
    async function fetchIncidentsFromNetwork() {
        // try main endpoint then fallback endpoint names
        try {
            let resp = await fetch(API.incidents);
            if (!resp.ok) resp = await fetch(API.emergencias);
            if (!resp.ok) throw new Error('No OK response');
            const data = await resp.json();
            return Array.isArray(data) ? data : [];
        } catch (e) {
            throw e;
        }
    }

    async function loadIncidentsToUI() {
        const container = $('incidents-container');
        if (!container) return;
        container.innerHTML = `<div class="col-span-full text-center p-8 text-gray-500">Cargando incidentes...</div>`;
        try {
            const data = await fetchIncidentsFromNetwork();
            // save to IDB for offline
            if (data && data.length) {
                // normalize ids if needed
                const normalized = data.map(d => {
                    if (!d.id) {
                        if (d.idincidente) d.id = d.idincidente;
                        else d.id = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
                    }
                    return d;
                });
                await idbWrite(STORE_INCIDENTS, normalized);
            }
            renderIncidents(data);
            const lbl = $('connection-label'); if (lbl) lbl.textContent = 'Online';
        } catch (err) {
            console.warn('Fetch incidents failed, trying cache:', err);
            const cached = await idbReadAll(STORE_INCIDENTS);
            if (cached && cached.length) renderIncidents(cached);
            else {
                container.innerHTML = `<div class="col-span-full text-center p-8 text-yellow-700 bg-yellow-100 rounded">Sin datos (offline)</div>`;
            }
            const lbl = $('connection-label'); if (lbl) lbl.textContent = 'Offline';
        }
    }

    function renderIncidentCard(i) {
        const title = i.title || i.titulo || 'Incidente';
        const desc = i.description || i.descripcion || '';
        const id = i.id || i.idincidente || '—';
        const status = (i.status || 'ABIERTA').toUpperCase();
        
        let statusColor = 'bg-red-500';
        if (status === 'EN_CURSO') statusColor = 'bg-yellow-600';
        if (status === 'CERRADA') statusColor = 'bg-green-600';
        
        const btnAsignarDisabled = status === 'EN_CURSO' || status === 'CERRADA' ? 'disabled' : '';
        const btnCerrarDisabled = status === 'CERRADA' ? 'disabled' : '';

        return `
            <div class="incident-card bg-white p-4 rounded shadow">
            <div class="flex items-start gap-3">
                <div class="text-2xl">${/accident|accidente/i.test(title) ? '🚑' : '⚠️'}</div>
                <div class="flex-1">
                <h4 class="font-semibold">${escapeHtml(title)}</h4>
                <p class="text-sm text-gray-600 mt-1">${escapeHtml(desc)}</p>
                <div class="flex justify-between items-center mt-2">
                    <div class="text-xs text-gray-400">ID: ${escapeHtml(String(id))}</div>
                    <span class="${statusColor} text-white text-xs font-semibold px-2 py-0.5 rounded">${status}</span>
                </div>
                </div>
            </div>
            
            <div class="flex gap-2 mt-3 pt-2 border-t border-gray-100">
                <button onclick="window.App.changeIncidentStatus('${id}', 'EN_CURSO')" 
                        class="flex-1 px-2 py-1 bg-yellow-600 hover:bg-yellow-700 text-white rounded text-xs disabled:opacity-50"
                        ${btnAsignarDisabled}>
                Asignar
                </button>
                <button onclick="window.App.changeIncidentStatus('${id}', 'CERRADA')" 
                        class="flex-1 px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs disabled:opacity-50"
                        ${btnCerrarDisabled}>
                Cerrar
                </button>
            </div>
            </div>
        `;
    }

    function renderIncidents(list = []) {
        const container = $('incidents-container');
        if (!container) return;
        container.innerHTML = '';
        
        // Muestra solo los incidentes que no estén CERRADA
        const activeList = list.filter(i => (i.status || 'ABIERTA').toUpperCase() !== 'CERRADA');
        
        if (!activeList || activeList.length === 0) {
            container.innerHTML = '<div class="col-span-full text-center p-8 text-gray-500">No hay incidentes activos.</div>';
            return;
        }
        
        const fragment = document.createDocumentFragment();
        activeList.forEach(i => {
            const cardHtml = renderIncidentCard(i);
            const div = document.createElement('div');
            // Usamos innerHTML para renderizar la tarjeta y luego solo tomamos el primer elemento
            div.innerHTML = cardHtml; 
            fragment.appendChild(div.firstElementChild); 
        });
        container.appendChild(fragment);
    }
    
    /* ---------- MAP (Leaflet) - Lógica de mapa movida a maps.js, solo quedan helpers aquí ---------- */
    // NOTA: Toda la lógica de Leaflet (initMap, loadEmergenciesOnMap, centerOnUser)
    // debe ser movida a maps.js para evitar duplicidad y asegurar la carga ordenada.
    // Asumimos que maps.js se cargará después de este archivo.
    
    /* ---------- REPORT (send or queue) ---------- */
    async function trySendReport(payload) {
        // try multiple endpoints
        for (const ep of API.report) {
            try {
                const r = await fetch(ep, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(payload) });
                if (r.ok) return true;
            } catch (e) {
                // continue to next
            }
        }
        return false;
    }

    async function reportMyLocation() {
        if (!navigator.geolocation) { showModal('GPS', 'Geolocalización no soportada'); return; }
        navigator.geolocation.getCurrentPosition(async (pos) => {
            const payload = {
                titulo: 'Emergencia reportada (usuario)',
                descripcion: 'Ubicación enviada por operador',
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                timestamp: Date.now()
            };

            // Intentar envío optimista y luego cachear/enrolar en cola
            try {
                const sent = await trySendReport(payload);
                if (sent) {
                    showModal('Enviado', 'Tu ubicación fue reportada como emergencia.');
                } else {
                    await idbAddToQueue(payload);
                    showModal('Guardado local', 'No hay conexión. El reporte se guardó y se enviará al reconectar.');
                }
            } catch (e) {
                await idbAddToQueue(payload);
                showModal('Guardado local', 'Ocurrió un error. Se guardó localmente para reintento posterior.');
            }

            // refresh incidents & map (try)
            await loadIncidentsToUI();
            if (window.Map && typeof window.Map.loadEmergenciesFromCache === 'function') {
                window.Map.loadEmergenciesFromCache();
            }
        }, err => showModal('GPS', 'No se pudo obtener la ubicación: '+ (err.message || err.code)));
    }

    safeAddListener('btn-report-emergency', 'click', reportMyLocation);

    /* ---------- SYNC QUEUE (attempt to flush outbox) ---------- */
    async function flushOutbox() {
        try {
            const queue = await idbReadAll(STORE_QUEUE);
            if (!queue || queue.length === 0) return;
            
            for (const item of queue) {
                let ok = false;
                
                // Determinar el endpoint correcto para el reintento
                if (item.url === API.changeStatus) {
                    ok = await trySendStatusUpdate(item.body);
                } else {
                    ok = await trySendReport(item.body);
                }
                
                if (!ok) throw new Error('Network fail while flushing');
            }
            
            // if all sent, clear queue
            await idbClearStore(STORE_QUEUE);
            console.log('Outbox flushed');
            
            // reload incidents and map after flush
            await loadIncidentsToUI();
            if (window.Map && typeof window.Map.loadEmergenciesFromCache === 'function') {
                window.Map.loadEmergenciesFromCache();
            }

        } catch (e) {
            console.warn('flushOutbox failed:', e);
        }
    }

    // try flush when network comes back
    window.addEventListener('online', () => {
        const lbl = $('connection-label'); if (lbl) lbl.textContent = 'Online';
        flushOutbox();
    });

    window.addEventListener('offline', () => {
        const lbl = $('connection-label'); if (lbl) lbl.textContent = 'Offline';
    });
    
    /* ---------- SERVICE WORKER & PUSH ---------- */
    async function registerServiceWorker() {
        if (!('serviceWorker' in navigator)) {
            const status = $('pwa-status'); if (status) status.textContent = 'Service Worker no soportado';
            return null;
        }
        try {
            const reg = await navigator.serviceWorker.register('/service-worker.js');
            const status = $('pwa-status'); if (status) status.textContent = 'Service Worker: Registrado';
            const btn = $('btn-activate-push'); if (btn) btn.disabled = false;
            await navigator.serviceWorker.ready;
            return reg;
        } catch (err) {
            console.error('SW register error', err);
            const status = $('pwa-status'); if (status) status.textContent = 'Error registrando SW';
            return null;
        }
    }

    async function getVapidPublicKey() {
        try {
            const r = await fetch(API.vapidKey);
            if (!r.ok) throw new Error('No VAPID');
            const key = await r.text();
            const el = $('vapid-key-display');
            if (el) {
                const span = el.querySelector('span');
                if (span) span.textContent = key.substring(0, 40) + '...';
            }
            return key;
        } catch (e) {
            console.warn('getVapidPublicKey failed', e);
            const el = $('vapid-key-display'); if (el) el.textContent = 'Clave VAPID pública: no disponible';
            return null;
        }
    }

    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        return Uint8Array.from([...rawData].map(ch => ch.charCodeAt(0)));
    }

    async function subscribeToPush() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            showModal('Push', 'Notificaciones no soportadas en este navegador');
            return;
        }
        try {
            const reg = await navigator.serviceWorker.ready;
            const vapid = await getVapidPublicKey();
            if (!vapid) { showModal('Push', 'Clave VAPID no disponible'); return; }

            const sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(vapid)
            });

            await fetch(API.subscribe, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(sub) });

            showModal('Push', 'Suscripción creada correctamente');
            const sendBtn = $('btn-send-test'); if (sendBtn) sendBtn.disabled = false;
            const btn = $('btn-activate-push'); if (btn) btn.textContent = 'Suscrito';
        } catch (e) {
            console.error('subscribeToPush error', e);
            showModal('Push', 'No se pudo suscribir a Push: ' + (e.message || e));
            const btn = $('btn-activate-push'); if (btn) { btn.disabled = false; btn.textContent = 'Activar Notificaciones'; }
        }
    }

    async function sendTestNotification() {
        const btn = $('btn-send-test'); if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }
        try {
            await fetch(API.sendNotification, {
                method: 'POST', headers: {'content-type':'application/json'},
                body: JSON.stringify({ title: 'Prueba PWA', body: 'Notificación de prueba enviada desde PWA' })
            });
            showModal('Push', 'Solicitud de notificación enviada al servidor');
        } catch (e) {
            console.error('sendTestNotification', e);
            showModal('Push', 'No se pudo enviar la prueba: ' + (e.message || e));
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Enviar Prueba'; }
        }
    }

    safeAddListener('btn-activate-push', 'click', subscribeToPush);
    safeAddListener('btn-send-test', 'click', sendTestNotification);

    /* ---------- EXPOSICIÓN GLOBAL (Para HTML y maps.js) ---------- */

    /**
     * Expone la lista de incidentes cacheados (para que maps.js la use).
     */
    async function getCachedIncidents() {
        return await idbReadAll(STORE_INCIDENTS);
    }

    window.App = window.App || {};
    window.App.changeIncidentStatus = changeIncidentStatus;
    window.App.getCachedIncidents = getCachedIncidents; // Necesario para maps.js
    window.App.loadIncidents = loadIncidentsToUI; // Opción para refrescar la lista


    /* ---------- BOOTSTRAP / INIT ---------- */
    function wireUI() {
        safeAddListener('btn-update-incidents', 'click', loadIncidentsToUI);
        safeAddListener('btn-refresh', 'click', loadIncidentsToUI);
        // La lógica de centrar usuario y reportar está en maps.js ahora
        // safeAddListener('btn-center-me', 'click', centerOnUser);
        // safeAddListener('btn-report-emergency', 'click', reportMyLocation);
    }

    async function init() {
        wireUI();
        initAuth();

        await registerServiceWorker();

        // Carga de incidentes inicial
        await loadIncidentsToUI();
        
        // El mapa debe iniciar en maps.js después de que app.js haya cargado
        // y expuesto window.App.getCachedIncidents

        // try to flush outbox if online
        if (navigator.onLine) await flushOutbox();
    }

    // start when DOM is loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // close modals on Esc
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
            const lm = $('loginModal'); if (lm) { lm.classList.add('hidden'); lm.classList.remove('flex'); }
        }
    });

})(); // EOF