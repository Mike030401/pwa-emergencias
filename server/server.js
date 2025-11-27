const express = require("express");
const webpush = require("web-push");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path"); // Necesario para servir archivos estáticos si la app.js está allí
require("dotenv").config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Servir archivos estáticos (asumiendo que tu index.html y assets están en una carpeta 'public')
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR)); 

// ==============================
//   CONFIG VAPID
// ==============================
const PUBLIC_KEY = process.env.VAPID_PUBLIC;
const PRIVATE_KEY = process.env.VAPID_PRIVATE;

if (!PUBLIC_KEY || !PRIVATE_KEY) {
    console.error("❌ ERROR: VAPID keys no cargadas. Revisa tu .env");
    process.exit(1);
}

webpush.setVapidDetails(
    "mailto:tu_correo@gmail.com",
    PUBLIC_KEY,
    PRIVATE_KEY
);

// ==============================
//   SIMULACIÓN DE BASE DE DATOS EN MEMORIA
// ==============================
let subscriptions = [];
let incidents = [
    // Datos iniciales con estado
    { id: 1, title: "Accidente vehicular", description: "Choque en Av. Central, 2 heridos.", lat: 19.43, lng: -99.13, status: 'ABIERTA' },
    { id: 2, title: "Fuego menor", description: "Lote baldío con quema controlada.", lat: 19.44, lng: -99.12, status: 'EN_CURSO' }
];

const DEMO_USERS = [
    { id: 101, email: 'policia@emergencias.com', password: '123456', role: 'policia' },
    { id: 102, email: 'bombero@emergencias.com', password: '123456', role: 'bombero' },
    { id: 103, email: 'medico@emergencias.com', password: '123456', role: 'medico' }
];

// Función utilitaria para agregar o actualizar un incidente
function saveIncident(newIncident) {
    const index = incidents.findIndex(i => String(i.id) === String(newIncident.id));
    
    if (index !== -1) {
        // Actualizar incidente existente
        incidents[index] = { ...incidents[index], ...newIncident };
    } else {
        // Crear nuevo incidente
        if (!newIncident.id || String(newIncident.id).includes('-')) {
             // Asigna un ID numérico si no viene de la cola con un ID temporal
            newIncident.id = incidents.reduce((max, i) => (i.id > max ? i.id : max), 0) + 1;
        }
        newIncident.status = newIncident.status || 'ABIERTA';
        incidents.unshift(newIncident);
    }
}


// ==================================
//     RUTAS API
// ==================================

// 1. LOGIN
app.post("/api/login", (req, res) => {
    const { email, password } = req.body;
    
    // Busca en la simulación de usuarios
    const user = DEMO_USERS.find(u => u.email === email && u.password === password);

    if (!user) {
        return res.status(401).json({ ok: false, message: "Credenciales incorrectas" });
    }

    res.json({
        ok: true,
        user: {
            id: user.id,
            email: user.email,
            role: user.role
        }
    });
});

// 2. LISTADO COMPLETO (Usado por app.js para caché)
app.get("/api/incidents", (req, res) => {
    // Retorna todos los incidentes, incluyendo los cerrados
    res.json(incidents);
});

// 3. LISTADO PARA MAPA (Usado por app.js, aunque maps.js usa la caché ahora)
app.get("/api/emergencias", (req, res) => {
    // Retorna solo incidentes activos (no cerrados)
    res.json(incidents.filter(i => i.status !== 'CERRADA'));
});


// 4. CAMBIO DE ESTADO DEL OPERADOR (CRUCIAL para Background Sync)
app.post("/api/emergencia/estado", (req, res) => {
    const { id, estado } = req.body;
    const incidentToUpdate = incidents.find(i => String(i.id) === String(id));
    
    // Si el incidente no existe, devolvemos 200 OK para que el SW borre la cola.
    if (!incidentToUpdate) {
        console.warn(`⚠️ Incidente ${id} (para cambio de estado a ${estado}) no encontrado. Respondiendo 200 OK para limpiar cola.`);
        return res.json({ ok: true, warning: "Incidente no encontrado o ya procesado." });
    }
    
    incidentToUpdate.status = estado;
    console.log(`✅ Incidente ${id} actualizado a estado: ${estado}`);

    res.json({ ok: true, incident: incidentToUpdate });
});


// 5. REPORTE DE EMERGENCIA (CRUCIAL para Background Sync)
app.post("/api/reportar", (req, res) => {
    const report = req.body;
    
    const newIncident = {
        id: report.id, // Usa el ID temporal de la cola si existe
        title: report.titulo || 'Reporte de Ubicación (Sync)',
        description: report.descripcion || 'Ubicación enviada por operador.',
        lat: report.lat,
        lng: report.lng,
        timestamp: report.timestamp,
        status: 'ABIERTA'
    };
    
    saveIncident(newIncident);
    console.log(`🆕 Reporte de Ubicación recibido (ID: ${newIncident.id}).`);
    res.json({ ok: true, id: newIncident.id });
});


// ==============================
//   RUTAS PUSH
// ==============================

// ENVIAR PUBLIC KEY AL CLIENTE
app.get("/vapidPublicKey", (req, res) => {
    res.send(PUBLIC_KEY);
});

// GUARDAR SUBSCRIPCIÓN
app.post("/save-subscription", (req, res) => { // Ajustado a /save-subscription para coincidir con app.js
    const sub = req.body;

    if (!subscriptions.find(s => s.endpoint === sub.endpoint)) {
        subscriptions.push(sub);
        console.log("🔥 Nueva suscripción guardada");
    }

    res.status(201).json({ message: "Subscripción guardada" });
});

// ENVIAR NOTIFICACIÓN
app.post("/send-notification", async (req, res) => {
    const payload = JSON.stringify({
        title: req.body.title || "🚨 Emergencia",
        body: req.body.body || "Nueva incidencia reportada",
        url: req.body.url || "/"
    });

    const results = await Promise.allSettled(
        subscriptions.map(sub => webpush.sendNotification(sub, payload))
    );
    
    // Filtrar subscripciones expiradas
    subscriptions = subscriptions.filter((_, i) => results[i].status === "fulfilled");
    const successCount = results.filter(r => r.status === "fulfilled").length;

    res.json({
        ok: true,
        message: `Notificaciones enviadas con ${successCount} éxitos`,
        results
    });
});

// ==============================
//   LEVANTAR SERVIDOR
// ==============================
const PORT = process.env.PORT || 4000;
// ¡CRÍTICO!: Escuchar en 0.0.0.0 para que Render pueda acceder al puerto.
app.listen(PORT, '0.0.0.0', () => { 
    console.log(`🚀 Servidor escuchando en puerto ${PORT} en todas las interfaces.`);
});