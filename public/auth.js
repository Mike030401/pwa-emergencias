// ===============================
//  VERIFICAR SESIÓN
// ===============================
const user = localStorage.getItem("user");

if (user && window.location.pathname.includes("login.html")) {
    window.location.href = "/index.html";
}

// ===============================
//  LOGIN
// ===============================
const loginBtn = document.getElementById("loginBtn");

if (loginBtn) {
    loginBtn.addEventListener("click", login);
}

async function login() {
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();
    const msg = document.getElementById("loginMessage");

    if (!email || !password) {
        msg.textContent = "Completa todos los campos";
        return;
    }

    try {
        const resp = await fetch("/api/login", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email, password })
        });

        const data = await resp.json();

        if (!data.ok) {
            msg.textContent = data.message;
            return;
        }

        // Guardar sesión local
        localStorage.setItem("user", JSON.stringify(data.user));

        // Redirigir a la app
        window.location.href = "/index.html";

    } catch (err) {
        msg.textContent = "Error de conexión";
        console.error(err);
    }
}

function logout() {
    localStorage.removeItem("user");
    window.location.href = "/login.html";
}


// ===============================
//  PROTEGER PAGINAS
// ===============================
if (!user && window.location.pathname.includes("index.html")) {
    window.location.href = "/login.html";
}
