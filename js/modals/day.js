import { store } from "../store.js";
import { $, esc, isHidden, show } from "../dom.js";
import { icon } from "../icons.js";
import * as modal from "../ui/modal.js";
import { ask } from "../ui/confirm.js";
import { formatDateLabel } from "../lib/dates.js";
import { getHolidaysForYear } from "../lib/holidays.js";
import { openNewEvent, openEditEvent } from "./event-editor.js";
import { render as renderCalendar } from "../views/calendar.js";

/** The day the modal is showing, or null when closed. */
let dateKey = null;

export const currentDateKey = () => dateKey;
export const isDayModalOpen = () => !isHidden($("modalOverlay"));

export function openDayModal(key) {
  dateKey = key;
  modal.open("modalOverlay");
  renderDayModal();
}

export function closeDayModal() {
  modal.close("modalOverlay");
  dateKey = null;
}

/** Re-shows the modal after the event editor closes on top of it. */
export function reopenDayModal() {
  if (!dateKey) return;
  modal.open("modalOverlay");
  renderDayModal();
}

export function hideDayModal() {
  modal.close("modalOverlay");
}

export function renderDayModal() {
  if (!dateKey) return;

  $("modalDateLabel").textContent = formatDateLabel(dateKey);

  const year = Number(dateKey.split("-")[0]);
  const holidays = getHolidaysForYear(year)[dateKey] || [];

  show($("modalHolidaysSection"), holidays.length > 0);
  if (holidays.length) {
    $("modalHolidayList").innerHTML = holidays
      .map(
        (h) =>
          `<li class="modal-holiday-item ${h.type}"><span>${esc(h.name)}</span>` +
          `<span class="modal-holiday-type">${h.type === "regular" ? "Regular Holiday" : "Special Holiday"}</span></li>`
      )
      .join("");
  }

  const events = store.state.eventsList.filter((ev) => ev.dates.includes(dateKey));
  $("modalEventList").innerHTML = events.length
    ? events
        .map((ev) => {
          const multi =
            ev.dates.length > 1
              ? ` <span class="modal-event-count">(${ev.dates.length} dates)</span>`
              : "";
          return (
            "<li>" +
            `<span class="modal-event-text" data-action="edit-event" data-id="${esc(ev.id)}">${esc(ev.title)}${multi}</span>` +
            `<button class="icon-btn danger-hover" data-action="remove-date-from-event" data-id="${esc(ev.id)}" title="Remove from this day">${icon("close")}</button>` +
            "</li>"
          );
        })
        .join("")
    : '<li class="empty-row">No events yet.</li>';

  const tasks = store.state.tasks.filter((t) => t.due === dateKey);
  show($("modalTasksSection"), tasks.length > 0);
  if (tasks.length) {
    $("modalTaskList").innerHTML = tasks
      .map(
        (t) =>
          `<li class="${t.done ? "done" : ""}">${icon(t.done ? "checkCircle" : "circle")}` +
          `<span>${esc(t.text)}</span></li>`
      )
      .join("");
  }
}

export function mount() {
  $("modalAddEventBtn").addEventListener("click", () => {
    if (dateKey) openNewEvent(dateKey);
  });

  $("modalEventList").addEventListener("click", async (e) => {
    const editEl = e.target.closest('[data-action="edit-event"]');
    if (editEl) {
      openEditEvent(editEl.dataset.id);
      return;
    }

    const rmBtn = e.target.closest('[data-action="remove-date-from-event"]');
    if (!rmBtn || !dateKey) return;

    const ev = store.state.eventsList.find((x) => x.id === rmBtn.dataset.id);
    if (!ev) return;

    // Removing the only remaining date deletes the event outright, so say so.
    const isLast = ev.dates.length === 1;
    const ok = await ask({
      title: isLast ? `Delete "${ev.title}"?` : "Remove from this day?",
      message: isLast
        ? "This is its only date, so the event will be deleted."
        : `"${ev.title}" will stay on its other ${ev.dates.length - 1} date(s).`,
      confirmLabel: isLast ? "Delete" : "Remove",
    });
    if (!ok) return;

    ev.dates = ev.dates.filter((d) => d !== dateKey);
    // An event with no dates left has nowhere to live.
    if (!ev.dates.length) {
      store.state.eventsList = store.state.eventsList.filter((x) => x.id !== ev.id);
    }

    store.save();
    renderDayModal();
    renderCalendar();
  });

  $("modalCloseBtn").addEventListener("click", closeDayModal);

  $("modalOverlay").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeDayModal();
  });
}
