const CACHE_NAME = "boo-night-v11";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js?v=11",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png",
  "./assets/ghosts/expression-sheet.png",
  "./assets/ghosts/sleeping.png",
  "./assets/audio/touch-1.wav",
  "./assets/audio/touch-2.wav",
  "./assets/audio/shy.wav",
  "./assets/audio/bump-1.wav",
  "./assets/audio/bump-2.wav",
  "./assets/audio/whoosh.wav",
  "./assets/audio/appear.wav",
  "./assets/audio/pop.wav",
  "./assets/audio/magic.wav",
  "./assets/audio/bubble.wav",
  "./assets/audio/moon.wav",
  "./assets/audio/Ground%20BGM.mp3",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const networkFirst = event.request.mode === "navigate"
    || ["index.html", "app.js", "styles.css", "manifest.webmanifest"].includes(url.pathname.split("/").pop());

  if (networkFirst) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" })
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request)),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      return response;
    })),
  );
});
