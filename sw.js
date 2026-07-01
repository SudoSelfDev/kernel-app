/* Kernel service worker — network-first for the app shell, cache fallback for offline.
   Network-first means a deploy shows up on the next open — no stale-mix of old CSS
   with new HTML. Vault data is never cached here (it lives in localStorage,
   fetched live from the GitHub API). */
const CACHE = "kernel-shell-v33";
const SHELL = ["./", "index.html", "style.css", "app.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  // fetch shell files bypassing the HTTP cache so a new version never precaches stale assets
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(SHELL.map((u) =>
        fetch(u, { cache: "reload" }).then((r) => r.ok && c.put(u, r)).catch(() => {})
      )))
      .then(() => self.skipWaiting())
  );
});

// let the page tell a waiting worker to activate immediately
self.addEventListener("message", (e) => {
  if (e.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.hostname === "api.github.com") return; // data: network only
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
