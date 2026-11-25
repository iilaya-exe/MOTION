import { $, esc } from "../dom.js";

/* Undo toast.
   Deleting is the only irreversible thing the app does, so every delete hands
   its restore function here instead of hiding behind a confirm() dialog. The
   snapshot is captured by the caller (usually the removed object plus the index
   it sat at), which keeps this module ignorant of the data model. */

const VISIBLE_MS = 8000;

let timer = null;
let pending = null;

function host() {
  return $("undoToast");
}

export function dismiss() {
  clearTimeout(timer);
  timer = null;
  pending = null;
  host().classList.add("hidden");
}

/**
 * @param {string} message shown to the user, e.g. `Deleted "Buy milk"`
 * @param {() => void} restore puts the thing back; also re-renders
 */
export function offer(message, restore) {
  pending = restore;

  host().innerHTML =
    `<span class="undo-text">${esc(message)}</span>` +
    '<button class="undo-btn" data-action="undo">Undo</button>' +
    '<button class="undo-close" data-action="dismiss" aria-label="Dismiss">&times;</button>';

  host().classList.remove("hidden");

  clearTimeout(timer);
  timer = setTimeout(dismiss, VISIBLE_MS);
}

export function mount() {
  host().addEventListener("click", (e) => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (!action) return;

    if (action === "undo" && pending) {
      const restore = pending;
      dismiss();
      restore();
    } else if (action === "dismiss") {
      dismiss();
    }
  });
}
