/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║  VICO Tékton — Service Worker                           ║
 * ║  Archivo: tekton-sw.js                                  ║
 * ║  Estrategia: Cache-first para assets, Network-first     ║
 * ║              para navegación HTML.                      ║
 * ║  Registrado desde: index.html                    ║
 * ╚══════════════════════════════════════════════════════════╝
 */

// ─── Versión de caché — incrementar en cada deploy ────────
const CACHE_NAME = "tekton-vico-v3";

// ─── App Shell: archivos críticos a cachear en install ────
const APP_SHELL = [
  "./",
  "./index.html",
  "./tekton-manifest.json",
  "./tekton-icon.png",
];

// ──────────────────────────────────────────────────────────
// INSTALL — Pre-cachear el App Shell
// ──────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  console.log("[TEKTON SW] Instalando — cache:", CACHE_NAME);
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        console.log("[TEKTON SW] Cacheando App Shell…");
        return cache.addAll(APP_SHELL);
      })
      .then(() => {
        console.log("[TEKTON SW] App Shell cacheado correctamente");
      })
      .catch((err) => {
        console.error("[TEKTON SW] Error al cachear App Shell:", err);
      })
  );
  // Activar inmediatamente sin esperar a que cierren las tabs
  self.skipWaiting();
});

// ──────────────────────────────────────────────────────────
// ACTIVATE — Limpiar cachés antiguas
// ──────────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  console.log("[TEKTON SW] Activando — limpiando cachés antiguas");
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => {
              console.log("[TEKTON SW] Eliminando caché obsoleta:", key);
              return caches.delete(key);
            })
        )
      )
      .then(() => {
        console.log("[TEKTON SW] Activado. Tomando control de clientes…");
        return self.clients.claim();
      })
  );
});

// ──────────────────────────────────────────────────────────
// FETCH — Estrategia de red
// ──────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  // Ignorar peticiones que no sean GET
  if (event.request.method !== "GET") return;

  // Ignorar extensiones de Chrome y URLs no-http
  if (!event.request.url.startsWith("http")) return;

  const url = new URL(event.request.url);

  // ── Navegación HTML: Network-first (frescura garantizada)
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const cloned = response.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(event.request, cloned));
          }
          return response;
        })
        .catch(() => {
          // Fallback offline: servir index desde caché
          return (
            caches.match("./index.html") ||
            caches.match("./") ||
            new Response(
              `<!doctype html><html lang="es"><head><meta charset="UTF-8">
               <meta name="viewport" content="width=device-width,initial-scale=1">
               <title>VICO Tékton — Sin conexión</title>
               <style>
                 body{margin:0;background:#05070d;color:#fff;font-family:Inter,system-ui;
                 display:grid;place-items:center;min-height:100vh;text-align:center}
                 h1{font-size:2rem;margin-bottom:1rem}
                 p{color:#94a3b8;max-width:42ch}
                 button{margin-top:1.5rem;padding:12px 24px;border:0;border-radius:999px;
                 background:#2563eb;color:#fff;cursor:pointer;font-size:1rem}
               </style></head>
               <body>
                 <div>
                   <p style="font-size:3rem">◈</p>
                   <h1>VICO Tékton</h1>
                   <p>Parece que estás sin conexión. La app se cargará cuando vuelva la red.</p>
                   <button onclick="location.reload()">Reintentar</button>
                 </div>
               </body></html>`,
              { headers: { "Content-Type": "text/html; charset=utf-8" } }
            )
          );
        })
    );
    return;
  }

  // ── Assets estáticos: Cache-first con actualización en background
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200 && response.type !== "opaque") {
            const cloned = response.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(event.request, cloned));
          }
          return response;
        })
        .catch(() => cached || new Response("", { status: 408 }));

      // Retornar caché inmediatamente si existe, y actualizar en background
      return cached || networkFetch;
    })
  );
});

// ──────────────────────────────────────────────────────────
// PUSH — Notificaciones push
// ──────────────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  const data = event.data
    ? event.data.json()
    : { title: "VICO Tékton", body: "Tienes una notificación nueva" };

  event.waitUntil(
    self.registration.showNotification(data.title || "VICO Tékton", {
      body: data.body || "",
      icon: "./tekton-icon.png",
      badge: "./tekton-icon.png",
      tag: data.tag || "tekton-notification",
      renotify: true,
      vibrate: [100, 50, 100],
      actions: data.actions || [],
      data: data.url ? { url: data.url } : undefined,
    })
  );
});

// ──────────────────────────────────────────────────────────
// NOTIFICATION CLICK — Abrir / enfocar ventana al tocar
// ──────────────────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || "./";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Si ya hay una ventana abierta, enfocarla
        for (const client of clientList) {
          if (client.url === targetUrl && "focus" in client) {
            return client.focus();
          }
        }
        // Si no hay ventana, abrir una nueva
        return clients.openWindow(targetUrl);
      })
  );
});

// ──────────────────────────────────────────────────────────
// MESSAGE — Comunicación con el cliente React
// ──────────────────────────────────────────────────────────
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    console.log("[TEKTON SW] SKIP_WAITING recibido — activando nueva versión");
    self.skipWaiting();
  }

  if (event.data === "GET_VERSION") {
    event.ports[0]?.postMessage({ version: CACHE_NAME });
  }
});
