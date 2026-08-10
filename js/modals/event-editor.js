import { store } from "../store.js";
import { $, esc, isHidden } from "../dom.js";
import { icon } from "../icons.js";
import * as modal from "../ui/modal.js";
import * as undo from "../ui/undo.js";
import { uid } from "../lib/id.js";
import { dateKey, formatShortDate, parseDateKey } from "../lib/dates.js";
import { render as renderCalendar } from "../views/calendar.js";
import { hideDayModal, isDayModalOpen, reopenDayModal } from "./day.js";

const MAX_RANGE_DAYS = 366;

/** Working copy; committed to the store only on Save. */
let draft = null;
/** Whether the day modal was underneath, so it can be restored on close. */
let cameFromDayModal = false;

export const isEventEditorOpen = () => !isHidden($("eventModalOverlay"));

function showEditor() {
  cameFromDayModal = isDayModalOpen();
  hideDayModal();
  modal.open("eventModalOverlay", "eventTitleInput");
  renderEditor();
}

export function openNewEvent(dateKeyOrNull) {
  draft = { id: null, title: "", dates: dateKeyOrNull ? [dateKeyOrNull] : [] };
  showEditor();
}

export function openEditEvent(id) {
  const ev = store.state.eventsList.find((e) => e.id === id);
  if (!ev) return;
  draft = { id: ev.id, title: ev.title, dates: [...ev.dates] };
  showEditor();
}

export function closeEventEditor() {
  modal.close("eventModalOverlay");
  draft = null;
  if (cameFromDayModal) reopenDayModal();
  cameFromDayModal = false;
}

function renderEditor() {
  $("eventModalTitle").textContent = draft.id ? "Edit Event" : "New Event";
  $("eventTitleInput").value = draft.title;
  $("eventDeleteBtn").classList.toggle("hidden", !draft.id);
  renderDateChips();
}

function renderDateChips() {
  const list = $("eventDatesList");
  const dates = [...draft.dates].sort();

  if (!dates.length) {
    list.innerHTML = '<span class="hint-text">No dates added yet.</span>';
    return;
  }

  list.innerHTML = dates
    .map(
      (d) =>
        `<span class="date-chip">${esc(formatShortDate(d))}` +
        `<button data-action="remove-date" data-date="${esc(d)}" title="Remove date">${icon("close")}</button></span>`
    )
    .join("");
}

function addRange() {
  const startInput = $("eventDateInput");
  const endInput = $("eventDateEndInput");

  let start = startInput.value;
  let end = endInput.value;
  if (!start) return;
  if (end && end < start) [start, end] = [end, start];

  const startDate = parseDateKey(start);
  const endDate = end ? parseDateKey(end) : startDate;
  const dayCount = Math.round((endDate - startDate) / 86400000) + 1;

  if (dayCount > MAX_RANGE_DAYS) {
    alert("Please pick a range of one year or less.");
    return;
  }

  const cursor = new Date(startDate.getTime());
  for (let i = 0; i < dayCount; i++) {
    const key = dateKey(cursor);
    if (!draft.dates.includes(key)) draft.dates.push(key);
    cursor.setDate(cursor.getDate() + 1);
  }

  renderDateChips();
  startInput.value = "";
  endInput.value = "";
}

export function mount() {
  $("eventAddDateBtn").addEventListener("click", addRange);

  $("eventDatesList").addEventListener("click", (e) => {
    const btn = e.target.closest('[data-action="remove-date"]');
    if (!btn) return;
    draft.dates = draft.dates.filter((d) => d !== btn.dataset.date);
    renderDateChips();
  });

  $("eventSaveBtn").addEventListener("click", () => {
    const title = $("eventTitleInput").value.trim();
    if (!title) return alert("Please enter a title for this event.");
    if (!draft.dates.length) return alert("Please add at least one date for this event.");

    if (draft.id) {
      const ev = store.state.eventsList.find((e) => e.id === draft.id);
      if (ev) {
        ev.title = title;
        ev.dates = [...draft.dates];
      }
    } else {
      store.state.eventsList.push({ id: uid(), title, dates: [...draft.dates] });
    }

    store.save();
    renderCalendar();
    closeEventEditor();
  });

  $("eventDeleteBtn").addEventListener("click", () => {
    if (!draft?.id) return;
    const ev = store.state.eventsList.find((e) => e.id === draft.id);
    if (!ev) return;

    const index = store.state.eventsList.indexOf(ev);
    store.state.eventsList.splice(index, 1);
    store.save();
    renderCalendar();
    closeEventEditor();

    undo.offer(`Deleted "${ev.title}"`, () => {
      store.state.eventsList.splice(index, 0, ev);
      store.save();
      renderCalendar();
    });
  });

  $("eventCancelBtn").addEventListener("click", closeEventEditor);

  $("eventModalOverlay").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeEventEditor();
  });
}
