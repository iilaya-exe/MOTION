import { store } from "./store.js";
import { $ } from "./dom.js";

import * as nav from "./ui/nav.js";
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
    nav, theme,
    dashboard, tasks, calendar, schedule, checklists, notes,
    dayModal, eventEditor, classEditor, fullSchedule,
  ].forEach((module) => module.mount());

  document.addEventListener("keydown", handleEscape);

  nav.switchView("dashboard");
  calendar.render(); // pre-render so the month is ready before it is first shown

  $("loadingOverlay").classList.add("hidden");
}

boot();
