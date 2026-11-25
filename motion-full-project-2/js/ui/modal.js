import { $, $$, isHidden } from "../dom.js";

/* Modal focus management.
   Two things every dialog owes a keyboard user: Tab must not wander out into
   the page behind it, and closing must put focus back where it came from. The
   modals are static markup toggled with .hidden, so opening and closing go
   through here rather than each module touching classList itself. */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The element that had focus before each open, keyed by overlay id. */
const returnFocusTo = new Map();

const visibleFocusable = (overlay) =>
  $$(FOCUSABLE, overlay).filter((el) => el.offsetParent !== null || el === document.activeElement);

export const isOpen = (id) => !isHidden($(id));

export function open(id, focusId) {
  const overlay = $(id);
  returnFocusTo.set(id, document.activeElement);
  overlay.classList.remove("hidden");

  const target = focusId ? $(focusId) : visibleFocusable(overlay)[0];
  target?.focus();
}

export function close(id) {
  $(id).classList.add("hidden");

  const previous = returnFocusTo.get(id);
  returnFocusTo.delete(id);

  // Only restore if the element is still in the document and still focusable.
  if (previous?.isConnected && typeof previous.focus === "function") previous.focus();
}

/** Cycles Tab within whichever overlay is currently on top. */
export function mount() {
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;

    const overlays = $$(".modal-overlay:not(.hidden)");
    if (!overlays.length) return;

    const overlay = overlays[overlays.length - 1];
    const items = visibleFocusable(overlay);
    if (!items.length) return;

    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;

    // Focus outside the dialog (or on its edge) wraps back inside.
    if (!overlay.contains(active)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  });
}
