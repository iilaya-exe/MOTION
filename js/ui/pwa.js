import { $ } from "../dom.js";

/* Progressive-web-app plumbing: register the worker, tell the user when a new
   version is ready, and show when they have gone offline.

   Service workers only run over https or on localhost, and never from file://,
   so every branch here is guarded — the app must work identically without one. */

const isTestRun = new URLSearchParams(window.location.search).has("e2e");

function showUpdateToast(worker) {
  const host = $("undoToast");
  host.innerHTML =
    '<span class="undo-text">A new version of Motion is ready.</span>' +
    '<button class="undo-btn" data-action="reload">Reload</button>' +
    '<button class="undo-close" data-action="dismiss" aria-label="Dismiss">&times;</button>';
  host.classList.remove("hidden");

  host.addEventListener(
    "click",
    (e) => {
      if (!e.target.closest('[data-action="reload"]')) return;
      // Ask the waiting worker to take over, then reload into the new version.
      worker?.postMessage?.({ type: "SKIP_WAITING" });
      window.location.reload();
    },
    { once: true }
  );
}

function watchForUpdates(registration) {
  registration.addEventListener("updatefound", () => {
    const incoming = registration.installing;
    if (!incoming) return;

    incoming.addEventListener("statechange", () => {
      // A worker that reaches "installed" while one is already controlling the
      // page is an update, not a first install.
      if (incoming.state === "installed" && navigator.serviceWorker.controller) {
        showUpdateToast(incoming);
      }
    });
  });
}

function watchConnection() {
  const paint = () => document.body.classList.toggle("is-offline", !navigator.onLine);
  window.addEventListener("online", paint);
  window.addEventListener("offline", paint);
  paint();
}

export function mount() {
  watchConnection();

  // The test harness drives the app in an iframe; a worker caching that run
  // would only add noise and could serve stale files to the suite.
  if (isTestRun) return;
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") return;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .then(watchForUpdates)
      .catch((err) => console.warn("Service worker registration failed.", err));
  });
}
