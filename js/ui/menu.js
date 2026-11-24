/* Dropdown menus: a button that opens a list of actions.

   One implementation for every menu in the app, so they all behave the same:
   click or Enter/Space/↓ opens and focuses the first item, ↑/↓/Home/End move,
   Escape or Tab closes and returns focus, a click outside closes, and picking
   an item closes before its own click handler runs. */

const open = new Set();

function items(menu) {
  return [...menu.querySelectorAll('[role="menuitem"]:not(.hidden):not([disabled])')];
}

export function closeAll(except) {
  open.forEach((m) => {
    if (m !== except) m.close(false);
  });
}

export const isAnyMenuOpen = () => open.size > 0;

/**
 * @param {HTMLElement} button  the trigger
 * @param {HTMLElement} menu    the list; items carry role="menuitem"
 * @param {{ onOpen?: () => void, align?: "start" | "end" }} [opts]
 */
export function bindMenu(button, menu, opts = {}) {
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  menu.setAttribute("role", "menu");
  menu.classList.add("hidden");

  const api = {
    isOpen: () => !menu.classList.contains("hidden"),
    open(focusFirst = true) {
      closeAll(api);
      opts.onOpen?.();
      menu.classList.remove("hidden");
      button.setAttribute("aria-expanded", "true");
      open.add(api);
      if (focusFirst) items(menu)[0]?.focus();
    },
    close(returnFocus = true) {
      if (!api.isOpen()) return;
      menu.classList.add("hidden");
      button.setAttribute("aria-expanded", "false");
      open.delete(api);
      if (returnFocus) button.focus({ preventScroll: true });
    },
  };

  button.addEventListener("click", (e) => {
    e.stopPropagation();
    if (api.isOpen()) api.close();
    else api.open(e.detail === 0); // keyboard "clicks" focus the first item
  });

  // ↓ opens the menu, or moves into it when a click already opened it.
  button.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown") return;
    e.preventDefault();
    if (api.isOpen()) items(menu)[0]?.focus();
    else api.open(true);
  });

  menu.addEventListener("keydown", (e) => {
    const list = items(menu);
    const i = list.indexOf(document.activeElement);
    const move = (to) => {
      e.preventDefault();
      list[(to + list.length) % list.length]?.focus();
    };
    if (e.key === "ArrowDown") move(i + 1);
    else if (e.key === "ArrowUp") move(i - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(list.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      api.close();
    } else if (e.key === "Tab") api.close(false);
  });

  // Picking an item closes the menu; the item's own handler still runs.
  menu.addEventListener("click", (e) => {
    if (e.target.closest('[role="menuitem"]')) api.close(false);
  });

  document.addEventListener("mousedown", (e) => {
    if (api.isOpen() && !menu.contains(e.target) && !button.contains(e.target)) api.close(false);
  });

  return api;
}
