import { store } from "./store.js";
import { $ } from "./dom.js";

import * as nav from "./ui/nav.js";
import * as router from "./ui/router.js";
import * as modal from "./ui/modal.js";
import * as undo from "./ui/undo.js";
import * as theme from "./ui/theme.js";

import * as dashboard from "./views/dashboard.js";
import * as tasks from "./views/tasks.js";
import * as calendar from "./views/calendar.js";
import * as schedule from "./views/schedule.js";
import * as checklists from "./views/checklists.js";
import * as notes from "./views/notes.js";

import * as dayModal from "./modals/day.js";
import * as eventEditor from "./modals/event-editor.js";
import * as classEditor from "./modals/class-editor.js";
import * as fullSchedule from "./modals/full-schedule.js";

/** Escape closes the topmost layer only, in the order they stack visually. */
function handleEscape(e) {
  if (e.key !== "Escape") return;

  if (classEditor.isClassEditorOpen()) classEditor.closeClassEditor();
  else if (fullSchedule.isFullScheduleOpen()) fullSchedule.closeFullSchedule();
  else if (eventEditor.isEventEditorOpen()) eventEditor.closeEventEditor();
  else if (dayModal.isDayModalOpen()) dayModal.closeDayModal();
  else if (nav.isNavOpen()) nav.closeNav();
  else undo.dismiss();
}

async function boot() {
  await store.load();

  nav.registerView("dashboard", dashboard.render);
  nav.registerView("tasks", tasks.render);
  nav.registerView("calendar", calendar.render);
  nav.registerView("schedule", schedule.render);
  nav.registerView("checklists", checklists.render);
  nav.registerView("notes", notes.render);

  // The sidebar's page list highlights the open page, so it follows every switch.
  nav.setAfterSwitch(notes.renderPageList);

  [
    nav, theme, modal, undo,
    dashboard, tasks, calendar, schedule, checklists, notes,
    dayModal, eventEditor, classEditor, fullSchedule,
  ].forEach((module) => module.mount());

  document.addEventListener("keydown", handleEscape);

  // The hash decides the first view, so a reload, a bookmark and the back
  // button all land where the user expects instead of on the dashboard.
  router.start(({ view, pageId }) => {
    if (pageId && store.state.pages.some((p) => p.id === pageId)) {
      store.state.currentPageId = pageId;
    }
    nav.switchView(view);
    nav.closeNav();
  });

  calendar.render(); // pre-render so the month is ready before it is first shown

  $("loadingOverlay").classList.add("hidden");
}

boot();
