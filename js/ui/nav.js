import { $, $$ } from "../dom.js";
import * as router from "./router.js";

/* View switching and the mobile drawer. The view modules register their render
   functions here rather than nav importing all six, which would create an import
   cycle (a view imports a modal, the modal re-renders the view). */

const renderers = new Map();

export function registerView(name, renderFn) {
  renderers.set(name, renderFn);
}

/** Called after every view switch — the sidebar's page list tracks the active view. */
let onAfterSwitch = () => {};
export function setAfterSwitch(fn) {
  onAfterSwitch = fn;
}

const MOBILE_QUERY = window.matchMedia("(max-width: 768px)");

/* Collapsed state lives on <html> rather than in the store: it is per-device
   chrome, not workspace data, and index.html reads it before first paint so the
   sidebar never renders expanded and then snaps shut. */
const SIDEBAR_KEY = "motionSidebar";

export const isSidebarCollapsed = () =>
  document.documentElement.getAttribute("data-sidebar") === "collapsed";

export function setSidebarCollapsed(collapsed) {
  const root = document.documentElement;

  if (collapsed) root.setAttribute("data-sidebar", "collapsed");
  else root.removeAttribute("data-sidebar");

  try {
    localStorage.setItem(SIDEBAR_KEY, collapsed ? "collapsed" : "expanded");
  } catch {
    /* preference just will not persist */
  }

  const btn = $("sidebarToggle");
  btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
  btn.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
  btn.setAttribute("title", `${collapsed ? "Expand" : "Collapse"} sidebar (⌘B)`);
}

export const isMobile = () => MOBILE_QUERY.matches;

export function setNavOpen(open) {
  $("sidebar").classList.toggle("open", open);
  $("sidebarBackdrop").classList.toggle("show", open);
  document.body.classList.toggle("nav-open", open);

  const menuBtn = $("menuBtn");
  menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
  menuBtn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
}

export const closeNav = () => setNavOpen(false);
export const isNavOpen = () => $("sidebar").classList.contains("open");

export function switchView(name) {
  $$(".view").forEach((v) => v.classList.add("hidden"));
  $(`view-${name}`)?.classList.remove("hidden");

  $$(".nav-item[data-view]").forEach((n) => n.classList.remove("active"));
  document.querySelector(`.nav-item[data-view="${name}"]`)?.classList.add("active");

  renderers.get(name)?.();
  onAfterSwitch();
}

export function mount() {
  $$(".nav-item[data-view]").forEach((el) => {
    el.addEventListener("click", () => {
      // Setting the hash is what switches the view; if it is already correct
      // no hashchange fires, so re-render explicitly.
      if (!router.go(el.dataset.view)) switchView(el.dataset.view);
      if (isMobile()) closeNav();
    });
  });

  $("menuBtn").addEventListener("click", () => setNavOpen(!isNavOpen()));

  $("sidebarToggle").addEventListener("click", () => setSidebarCollapsed(!isSidebarCollapsed()));

  // ⌘B / Ctrl+B, the convention in editors and Notion alike. Ignored while
  // typing, so it cannot fire from inside the note editor or a text field.
  document.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() !== "b" || !(e.metaKey || e.ctrlKey)) return;
    if (isMobile()) return;

    const el = document.activeElement;
    const typing =
      el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
    if (typing) return;

    e.preventDefault();
    setSidebarCollapsed(!isSidebarCollapsed());
  });

  // Sync the button to whatever index.html decided before paint.
  setSidebarCollapsed(isSidebarCollapsed());
  $("sidebarBackdrop").addEventListener("click", closeNav);

  // Returning to desktop width must not leave the drawer state stuck on.
  MOBILE_QUERY.addEventListener("change", () => {
    if (!isMobile()) closeNav();
  });
}
