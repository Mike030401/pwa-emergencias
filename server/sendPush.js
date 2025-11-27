const express = require('express');
const bodyParser = require('body-parser');
const webpush = require('web-push');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));
app.use(cors());
app.use(bodyParser.json());

const VAPID_PUBLIC = process.env.VAPID_PUBLIC;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE;

if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    console.error("❌ ERROR: Las claves VAPID no existen. Asegúrate de configurarlas.");
    process.exit(1);
}

webpush.setVapidDetails(
    "mailto:admin@emergencias.com",
    VAPID_PUBLIC,
    VAPID_PRIVATE
);

// Variables de Estado (Simulación de Base de Datos en memoria)
let subscriptions = [];
let incidents = [
    { id: 1, title: "Accidente vehicular", description: "Choque en Avenida Central, unidad de bomberos enviada.", lat: 19.43, lng: -99.13, status: 'ABIERTA' },
    { id: 2, title: "Fuego menor", description: "Lote baldío con quema controlada. Monitoreo policial.", lat: 19.44, lng: -99.12, status: 'EN_CURSO' }
];
const DEMO_USERS = [
    { email: 'policia@emergencias.com', password: '123456', role: 'policia' },
    { email: 'bombero@emergencias.com', password: '123456', role: 'bombero' },
    { email: 'medico@emergencias.com', password: '123456', role: 'medico' }
];

// Función utilitaria para agregar o actualizar un incidente
function saveIncident(newIncident) {
    if (!newIncident.id) {
        newIncident.id = Date.now();
    }
    const index = incidents.findIndex(i => String(i.id) === String(newIncident.id));
    if (index !== -1) {
        incidents[index] = { ...incidents[index], ...newIncident };
    } else {
        newIncident.status = newIncident.status || 'ABIERTA';
        // Asignar un ID único basado en el índice si es nuevo
        newIncident.id = incidents.length + 1; 
        incidents.unshift(newIncident);
    }
}

// ===================================
// RUTAS API
// ===================================

// [NUEVO] Maneja el login del operador
app.post("/api/login", (req, res) => {
    const { email, password } = req.body;
    const user = DEMO_USERS.find(u => u.email === email && u.password === password);
    
    if (user) {
        res.json({ ok: true, user: { email: user.email, role: user.role } });
    } else {
        res.status(401).json({ ok: false, error: "Credenciales inválidas" });
    }
});

// [MODIFICADO] Retorna todos los incidentes (para el listado)
app.get("/api/incidents", (req, res) => {
    // Ordenar por ID para simular un orden cronológico, o usar el orden por defecto
    res.json(incidents);
});

// [NUEVO] Retorna incidentes activos (para el mapa)
app.get("/api/emergencias", (req, res) => {
    res.json(incidents.filter(i => i.status !== 'CERRADA'));
});

// [NUEVO] Maneja el reporte de nueva emergencia/ubicación
app.post("/api/reportar", (req, res) => {
    const report = req.body;
    // CORRECCIÓN 1: El ID debe ser el mismo que se guardó en la cola, si existe.
    // Aunque app.js lo genera, si lo enviamos, lo usamos para el reintento.
    const newIncident = {
        id: report.id, // Si viene de la cola, tiene el ID temporal de la cola
        title: report.titulo || 'Reporte de Ubicación',
        description: report.descripcion || 'Ubicación enviada por operador.',
        lat: report.lat,
        lng: report.lng,
        timestamp: report.timestamp,
        status: 'ABIERTA'
    };
    saveIncident(newIncident);
    console.log("🆕 Reporte de Ubicación recibido.");
    res.json({ ok: true, id: newIncident.id });
});

// [NUEVO] Maneja el cambio de estado (Asignar/Cerrar)
app.post("/api/emergencia/estado", (req, res) => {
    const { id, estado } = req.body;
    const incidentToUpdate = incidents.find(i => String(i.id) === String(id));
    
    // ⚠️ CORRECCIÓN 2: Si el incidente ya fue cerrado o no encontrado, 
    // debemos devolver 200 para que el Service Worker BORRE el item de la cola.
    // Si devolvemos 404, el SW lo reintentará infinitamente.
    if (!incidentToUpdate) {
        console.warn(`⚠️ Incidente ${id} no encontrado. Respondiendo 200 OK para limpiar cola.`);
        return res.json({ ok: true, warning: "Incidente no encontrado, asumiendo completado." });
    }
    
    incidentToUpdate.status = estado;
    console.log(`✅ Incidente ${id} actualizado a estado: ${estado}`);

    res.json({ ok: true, incident: incidentToUpdate });
});


// [PUSH] Clave VAPID pública
app.get("/vapidPublicKey", (req, res) => {
    res.send(VAPID_PUBLIC);
});

// [PUSH] Suscripción
app.post("/save-subscription", (req, res) => {
    const sub = req.body;
    if (!subscriptions.find(s => s.endpoint === sub.endpoint)) {
        subscriptions.push(sub);
        console.log("🔥 Nueva subscripción registrada.");
    }
    res.status(201).json({ ok: true });
});

// [PUSH] Enviar notificación de prueba (desde el botón del cliente)
app.post("/send-notification", async (req, res) => {
    const payload = JSON.stringify({
        title: req.body.title || "🔔 PRUEBA EXITOSA",
        body: req.body.body || "¡Las notificaciones Push funcionan correctamente!",
        icon: "/icons/icon-192.png"
    });

    const results = await Promise.allSettled(
        subscriptions.map(s => webpush.sendNotification(s, payload))
    );
    // Filtrar subscripciones que fallaron (asumiendo que son endpoints expirados)
    subscriptions = subscriptions.filter((_, i) => results[i].status === "fulfilled");
    const successCount = results.filter(r => r.status === "fulfilled").length;
    console.log(`📢 Prueba enviada. Éxitos: ${successCount}`);
    res.json({ ok: true, message: `Prueba enviada a ${successCount} suscriptores.` });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor Push iniciado en puerto ${PORT}`));