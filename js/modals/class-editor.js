import { store } from "../store.js";
import { $, isHidden } from "../dom.js";
import { uid } from "../lib/id.js";
import { DAY_ABBR } from "../lib/dates.js";
import { CLASS_COLORS, toMinutes } from "../lib/schedule.js";
import { render as renderSchedule } from "../views/schedule.js";

/** Working copy; committed to the store only on Save. */
let draft = null;

export const isClassEditorOpen = () => !isHidden($("classModalOverlay"));

export function openNewClass(selectedDay) {
  draft = {
    id: null,
    subject: "",
    section: "",
    room: "",
    days: selectedDay >= 0 ? [selectedDay] : [],
    start: "08:00",
    end: "09:00",
    color: CLASS_COLORS[store.state.classes.length % CLASS_COLORS.length],
  };
  showEditor();
}

export function openEditClass(id) {
  const c = store.state.classes.find((x) => x.id === id);
  if (!c) return;
  draft = {
    id: c.id,
    subject: c.subject,
    section: c.section,
    room: c.room,
    days: [...c.days],
    start: c.start,
    end: c.end,
    color: CLASS_COLORS.includes(c.color) ? c.color : "indigo",
  };
  showEditor();
}

function showEditor() {
  $("classModalTitle").textContent = draft.id ? "Edit Class" : "Add Class";
  $("classSubjectInput").value = draft.subject;
  $("classSectionInput").value = draft.section;
  $("classRoomInput").value = draft.room;
  $("classStartInput").value = draft.start;
  $("classEndInput").value = draft.end;
  $("classDeleteBtn").classList.toggle("hidden", !draft.id);

  renderDayToggle();
  renderColorRow();

  $("classModalOverlay").classList.remove("hidden");
  $("classSubjectInput").focus();
}

export function closeClassEditor() {
  $("classModalOverlay").classList.add("hidden");
  draft = null;
}

function renderColorRow() {
  $("classColorRow").innerHTML = CLASS_COLORS.map(
    (name) =>
      `<button class="swatch c-${name}${draft.color === name ? " on" : ""}" ` +
      `data-color="${name}" title="${name}" aria-label="${name}"></button>`
  ).join("");
}

function renderDayToggle() {
  $("classDayToggle").innerHTML = DAY_ABBR.map((label, i) => {
    const on = draft.days.includes(i);
    return `<button class="${on ? "on" : ""}" data-day="${i}" aria-pressed="${on}">${label}</button>`;
  }).join("");
}

export function mount() {
  $("classColorRow").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-color]");
    if (!btn || !draft) return;
    draft.color = btn.dataset.color;
    renderColorRow();
  });

  $("classDayToggle").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-day]");
    if (!btn || !draft) return;
    const d = Number(btn.dataset.day);
    const at = draft.days.indexOf(d);
    if (at === -1) draft.days.push(d);
    else draft.days.splice(at, 1);
    renderDayToggle();
  });

  $("classCancelBtn").addEventListener("click", closeClassEditor);

  $("classModalOverlay").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeClassEditor();
  });

  $("classSaveBtn").addEventListener("click", () => {
    const subject = $("classSubjectInput").value.trim();
    const start = $("classStartInput").value;
    const end = $("classEndInput").value;

    if (!subject) return alert("Please enter a subject.");
    if (!draft.days.length) return alert("Please pick at least one day.");
    if (!start || !end) return alert("Please set both a start and end time.");
    if (toMinutes(end) <= toMinutes(start)) {
      return alert("The end time must be after the start time.");
    }

    const payload = {
      subject,
      section: $("classSectionInput").value.trim(),
      room: $("classRoomInput").value.trim(),
      days: [...draft.days],
      start,
      end,
      color: draft.color,
    };

    if (draft.id) {
      const c = store.state.classes.find((x) => x.id === draft.id);
      if (c) Object.assign(c, payload);
    } else {
      store.state.classes.push({ ...payload, id: uid() });
    }

    store.save();
    closeClassEditor();
    renderSchedule();
  });

  $("classDeleteBtn").addEventListener("click", () => {
    if (!draft?.id) return;
    const c = store.state.classes.find((x) => x.id === draft.id);
    if (!confirm(`Delete "${c ? c.subject : "this class"}"? This cannot be undone.`)) return;

    store.state.classes = store.state.classes.filter((x) => x.id !== draft.id);
    store.save();
    closeClassEditor();
    renderSchedule();
  });
}
