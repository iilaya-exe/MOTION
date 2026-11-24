import { $ } from "../dom.js";
import { isMobile } from "./nav.js";

/* Phone navigation: a bottom tab bar for the five main screens, and one
   floating "+" that adds whatever belongs on the screen you are on. Both are
   CSS-hidden above phone width; the sidebar drawer still holds checklists,
   note folders and settings. */

const currentView = () => document.querySelector(".view:not(.hidden)")?.id.replace("view-", "") || "";

/** What "+" does on each screen, and what it says it does. */
const ADD = {
  dashboard: ["Add a task for today", () => focusField("quickTaskInput")],
  tasks: ["New task", () => focusField("taskTextInput")],
  calendar: ["New event", () => $("newEventBtn").click()],
  schedule: ["New class", () => $("addClassBtn").click()],
  checklists: ["New checklist", () => focusField("newChecklistInput")],
  notes: ["New note", () => $("newPageBtn").click()],
};

function focusField(id) {
  const el = $(id);
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.focus({ preventScroll: true });
}

/** Called after every view switch: marks the tab and relabels "+". */
export function sync(view = currentView()) {
  document.querySelectorAll("#tabBar [data-view]").forEach((tab) => {
    if (tab.dataset.view === view) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  });
  const fab = $("fabBtn");
  const add = ADD[view];
  fab.classList.toggle("hidden", !add);
  if (add) {
    fab.setAttribute("aria-label", add[0]);
    fab.title = add[0];
  }
}

const isTextEntry = (el) =>
  el && (el.isContentEditable || el.tagName === "TEXTAREA" ||
    (el.tagName === "INPUT" && !["checkbox", "radio", "button", "submit", "range", "color", "file"].includes(el.type)));

export function mount() {
  $("fabBtn").addEventListener("click", () => ADD[currentView()]?.[1]());

  // With the on-screen keyboard up, the bar would ride on top of it and cover
  // what is being typed, so it steps aside while a text field has focus.
  document.addEventListener("focusin", (e) => {
    if (isMobile() && isTextEntry(e.target)) document.body.classList.add("is-typing");
  });
  document.addEventListener("focusout", () => {
    // Wait a beat: focus moving between two fields should not flash the bar.
    setTimeout(() => {
      if (!isTextEntry(document.activeElement)) document.body.classList.remove("is-typing");
    }, 120);
  });

  sync();
}
