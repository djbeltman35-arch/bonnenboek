// Bonnenboek service worker: app shell offline, API always live.
const CACHE = "bonnenboek-v10";
const SHARE = "bonnenboek-gedeeld";
const SHELL = ["/", "/index.html", "/app.js", "/manifest.webmanifest", "/icons/icon.svg", "/icons/icon-192.png", "/icons/apple-touch-icon.png", "/handleiding.html"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== SHARE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
// Android "Delen naar Bonnenboek": bewaar de gedeelde bon(nen) en open de app.
async function handleShare(req) {
  const form = await req.formData();
  const cache = await caches.open(SHARE);
  for (const k of await cache.keys()) await cache.delete(k);
  let i = 0;
  for (const f of form.getAll("bon")) {
    if (!(f instanceof File) || !f.size) continue;
    await cache.put(`/gedeeld/${i++}`, new Response(f, { headers: { "content-type": f.type || "application/octet-stream", "x-name": encodeURIComponent(f.name || "bon") } }));
  }
  const text = [form.get("title"), form.get("text"), form.get("url")].filter(Boolean).join("\n").trim();
  if (text) await cache.put("/gedeeld/tekst", new Response(text));
  return Response.redirect("/?gedeeld=1#overzicht", 303);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method === "POST" && new URL(req.url).pathname === "/delen") { e.respondWith(handleShare(req)); return; }
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) return; // never cache shared data
  const isFont = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (url.origin !== location.origin && !isFont) return;
  if (isFont) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res;
    })));
    return;
  }
  // network first, fall back to cache (so updates arrive quickly but the app opens offline)
  e.respondWith(
    fetch(req, { cache: "no-cache" }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || (req.mode === "navigate" ? caches.match("/index.html") : undefined))),
  );
});

// Meldingen (betaalverzoeken)
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text() }; }
  e.waitUntil((async () => {
    await self.registration.showNotification(d.title || "Bonnenboek", {
      body: d.body || "", icon: "/icons/icon-192.png", badge: "/icons/icon-192.png",
      data: { url: d.url || "/", vervallen: !!d.vervallen }, tag: d.tag, renotify: !!d.tag && !d.vervallen, silent: !!d.vervallen,
    });
    const open = (await self.registration.getNotifications()).filter((n) => !(n.data && n.data.vervallen));
    if (self.navigator.setAppBadge) {
      if (open.length) self.navigator.setAppBadge(open.length).catch(() => {});
      else self.navigator.clearAppBadge().catch(() => {});
    }
  })());
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  if (self.navigator.clearAppBadge) self.navigator.clearAppBadge().catch(() => {});
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if ("focus" in c) { c.navigate(url).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
