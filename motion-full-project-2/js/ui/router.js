/* Hash routing.
   The hash is the single source of truth for "where am I": clicking a nav item
   sets the hash, and the resulting hashchange is what actually switches the
   view. Keeping it one-directional means the back button, a bookmark, a pasted
   link and a reload all take exactly the same path through the code. */

const VIEWS = ["dashboard", "tasks", "calendar", "schedule", "checklists", "notes"];
const DEFAULT_VIEW = "dashboard";

/** `#/notes/<pageId>` → { view: "notes", pageId } */
export function parseHash(hash = window.location.hash) {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const view = VIEWS.includes(parts[0]) ? parts[0] : DEFAULT_VIEW;
  return { view, pageId: view === "notes" ? parts[1] || null : null };
}

export function hashFor(view, pageId) {
  return view === "notes" && pageId ? `#/notes/${pageId}` : `#/${view}`;
}

/**
 * Navigate. Writing the hash is enough — the hashchange listener does the work.
 * If the hash is already correct (first load, or re-clicking the current view)
 * nothing fires, so the caller gets an explicit re-render instead.
 */
export function go(view, pageId = null, { replace = false } = {}) {
  const next = hashFor(view, pageId);
  if (window.location.hash === next) return false;

  if (replace) {
    history.replaceState(null, "", next);
    return false;
  }

  window.location.hash = next;
  return true;
}

/** @param {(route: {view: string, pageId: string|null}) => void} handler */
export function start(handler) {
  window.addEventListener("hashchange", () => handler(parseHash()));

  // Normalise a missing or junk hash so the address bar always shows the route.
  const route = parseHash();
  if (window.location.hash !== hashFor(route.view, route.pageId)) {
    history.replaceState(null, "", hashFor(route.view, route.pageId));
  }

  handler(route);
}
