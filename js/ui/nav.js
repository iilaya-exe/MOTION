import { $, $$ } from "../dom.js";

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
      switchView(el.dataset.view);
      if (isMobile()) closeNav();
    });
  });

  $("menuBtn").addEventListener("click", () => setNavOpen(!isNavOpen()));
  $("sidebarBackdrop").addEventListener("click", closeNav);

  // Returning to desktop width must not leave the drawer state stuck on.
  MOBILE_QUERY.addEventListener("change", () => {
    if (!isMobile()) closeNav();
  });
}
