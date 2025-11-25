const express = require('express');
const bodyParser = require('body-parser');
const webpush = require('web-push');
const cors = require('cors');
// Módulos necesarios para manejar rutas relativas
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
    console.error("❌ ERROR: Las claves VAPID no existen. Configúralas como Variables de Entorno en Render.");
    process.exit(1);
}

webpush.setVapidDetails(
    "mailto:admin@emergencias.com",
    VAPID_PUBLIC,
    VAPID_PRIVATE
);

let subscriptions = [];
let incidents = [
    { id: 1, title: "Accidente vehicular", description: "Choque en Avenida Central, unidad de bomberos enviada." },
    { id: 2, title: "Fuego menor", description: "Lote baldío con quema controlada. Monitoreo policial." }
];


app.get("/vapidPublicKey", (req, res) => {
    res.send(VAPID_PUBLIC);
});

app.post("/api/subscribe", (req, res) => {
    const sub = req.body;
    if (!subscriptions.find(s => s.endpoint === sub.endpoint)) {
        subscriptions.push(sub);
        console.log("🔥 Nueva subscripción registrada:", sub.endpoint);
    }
    res.status(201).json({ ok: true });
});

app.get("/api/incidents", (req, res) => {
    res.json(incidents);
});

app.post("/api/notify-all", async (req, res) => {
    const payload = JSON.stringify({
        title: req.body.title || "🚨 Emergencia",
        body: req.body.body || "Nueva emergencia registrada",
        icon: "/icons/icon-192.png"
    });

    const results = await Promise.allSettled(
        subscriptions.map(s => webpush.sendNotification(s, payload))
    );
    subscriptions = subscriptions.filter((_, i) => results[i].status === "fulfilled");
    console.log("📢 Notificaciones enviadas:", results.length);
    res.json({ ok: true });
});

app.get("/api/send-test", async (req, res) => {
    const payload = JSON.stringify({
        title: "🔔 PRUEBA EXITOSA",
        body: "¡Las notificaciones Push funcionan correctamente!",
        icon: "/icons/icon-192.png"
    });

    try {
        const results = await Promise.allSettled(
            subscriptions.map(s => webpush.sendNotification(s, payload))
        );
        subscriptions = subscriptions.filter((_, i) => results[i].status === "fulfilled");
        const successCount = results.filter(r => r.status === "fulfilled").length;
        console.log(`📢 Prueba de Notificación enviada. Éxitos: ${successCount}`);
        res.json({ ok: true, message: `Prueba enviada a ${subscriptions.length} suscriptores.` });
    } catch (error) {
        console.error("❌ Error al enviar la notificación de prueba:", error);
        res.status(500).json({ ok: false, error: "Error al enviar la prueba" });
    }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => console.log(`🚀 Servidor Push iniciado en puerto ${PORT}`));