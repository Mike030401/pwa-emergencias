const express = require("express");
const webpush = require("web-push");
const cors = require("cors");
const bodyParser = require("body-parser");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ==============================
//   CONFIG VAPID
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
//   LISTA DE SUBSCRIPCIONES
// ==============================
let subscriptions = [];

// ==============================
//   API PARA LA APP
// ==============================
app.get("/api/incidents", (req, res) => {
    // Puedes poner datos reales aquí
    res.json([
        { id: 1, titulo: "Accidente", descripcion: "Choque leve en el centro" },
        { id: 2, titulo: "Incendio", descripcion: "Fuego en un lote baldío" }
    ]);
});

// ==============================
//   ENVIAR PUBLIC KEY AL CLIENTE
// ==============================
app.get("/vapidPublicKey", (req, res) => {
    res.send(PUBLIC_KEY);
});

// ==============================
//   GUARDAR SUBSCRIPCIÓN
// ==============================
app.post("/api/subscribe", (req, res) => {
    const sub = req.body;

    if (!subscriptions.find(s => s.endpoint === sub.endpoint)) {
        subscriptions.push(sub);
        console.log("Nueva suscripción guardada");
    }

    res.status(201).json({ message: "Subscripción guardada" });
});

// ==============================
//   ENVIAR NOTIFICACIÓN
// ==============================
app.post("/send-notification", async (req, res) => {
    const payload = JSON.stringify({
        title: req.body.title || "🚨 Emergencia",
        body: req.body.body || "Nueva incidencia reportada",
        url: req.body.url || "/"
    });

    const results = await Promise.allSettled(
        subscriptions.map(sub => webpush.sendNotification(sub, payload))
    );

    subscriptions = subscriptions.filter((_, i) => results[i].status === "fulfilled");

    res.json({
        ok: true,
        message: "Notificaciones enviadas",
        results
    });
});

// ==============================
//   LEVANTAR SERVIDOR
// ==============================
app.listen(4000, () => {
    console.log("Servidor escuchando en http://localhost:4000");
});
