const express = require('express');
const bodyParser = require('body-parser');
const webpush = require('web-push');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ==============================
//   VAPID KEYS
// ==============================
const VAPID_PUBLIC = process.env.VAPID_PUBLIC;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE;

if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    console.error("❌ ERROR: Las claves VAPID no existen en el .env");
    process.exit(1);
}

webpush.setVapidDetails(
    "mailto:admin@emergencias.com",
    VAPID_PUBLIC,
    VAPID_PRIVATE
);

// ==============================
//   Subscripciones
// ==============================
let subscriptions = [];

// Clave pública para cliente
app.get("/vapidPublicKey", (req, res) => {
    res.send(VAPID_PUBLIC);
});

// Guardar subscripción
app.post("/api/subscribe", (req, res) => {
    const sub = req.body;

    if (!subscriptions.find(s => s.endpoint === sub.endpoint)) {
        subscriptions.push(sub);
        console.log("🔥 Nueva subscripción registrada:", sub.endpoint);
    }

    res.status(201).json({ ok: true });
});

// Enviar notificación
app.post("/api/notify-all", async (req, res) => {
    const payload = JSON.stringify({
        title: req.body.title || "🚨 Emergencia",
        body: req.body.body || "Nueva emergencia registrada",
        icon: "/icons/icon-192.png"
    });

    const results = await Promise.allSettled(
        subscriptions.map(s => webpush.sendNotification(s, payload))
    );

    console.log("📢 Notificaciones enviadas:", results);

    res.json({ ok: true });
});

app.listen(3000, () => console.log("🚀 Servidor Push iniciado en http://localhost:3000"));
