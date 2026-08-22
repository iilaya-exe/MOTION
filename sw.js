/* Service worker — the whole app is precached on install, so once it has been
   opened it works with no network at all. That is honest here rather than a
   trick: the data already lives on the device, so there is nothing to fetch.

   Bump CACHE whenever the shell changes. The old cache is deleted on activate,
   which is what makes a deploy actually reach people instead of being masked by
   a stale cache forever. */

const CACHE = "motion-v5";

const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./favicon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",

  "./css/tokens.css",
  "./css/base.css",
  "./css/components.css",
  "./css/calendar.css",
  "./css/timeline.css",
  "./css/timer.css",
  "./css/home.css",
  "./css/tasks.css",
  "./css/checklists.css",
  "./css/schedule.css",
  "./css/notes.css",
  "./css/responsive.css",

  "./js/main.js",
  "./js/store.js",
  "./js/dom.js",
  "./js/icons.js",
  "./js/lib/id.js",
  "./js/lib/dates.js",
  "./js/lib/calendar.js",
  "./js/lib/schedule.js",
  "./js/lib/holidays.js",
  "./js/lib/storage.js",
  "./js/lib/defaults.js",
  "./js/lib/schedule-export.js",
  "./js/ui/nav.js",
  "./js/ui/router.js",
  "./js/ui/theme.js",
  "./js/ui/modal.js",
  "./js/ui/undo.js",
  "./js/ui/pwa.js",
  "./js/ui/class-timer.js",
  "./js/ui/confirm.js",
  "./js/views/dashboard.js",
  "./js/views/tasks.js",
  "./js/views/calendar.js",
  "./js/views/schedule.js",
  "./js/views/checklists.js",
  "./js/views/notes.js",
  "./js/modals/day.js",
  "./js/modals/event-editor.js",
  "./js/modals/class-editor.js",
  "./js/modals/full-schedule.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Individually, so one bad path cannot fail the whole install and leave
      // the app with no worker at all.
      .then((cache) => Promise.all(ASSETS.map((url) => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: try the network so a deploy is picked up promptly, but fall
  // back to the cached shell the moment the connection is missing.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html", { ignoreSearch: true }))
    );
    return;
  }

  // Everything else: serve from cache first for instant loads, and refresh the
  // entry in the background so the next visit gets the newer file.
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => cached);

      return cached || network;
    })
  );
});
