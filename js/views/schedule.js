import { store } from "../store.js";
import { $, esc, isHidden } from "../dom.js";
import { icon } from "../icons.js";
import { DAY_CHIPS, DAY_FULL } from "../lib/dates.js";
import {
  classesOnDay,
  colorClass,
  describeDays,
  formatTime,
  nextClassToday,
  nowMinutes,
  ongoingClass,
  toMinutes,
} from "../lib/schedule.js";
import { openEditClass, openNewClass } from "../modals/class-editor.js";
import { openFullSchedule } from "../modals/full-schedule.js";

let selectedDay = new Date().getDay();
let ticker = null;

function renderNowCard() {
  const card = $("nowCard");
  const { classes } = store.state;
  const current = ongoingClass(classes);

  if (!current) {
    const next = nextClassToday(classes);
    const msg = !classes.length
      ? "No classes yet — add one to get started."
      : next
        ? `Next up: <b>${esc(next.subject)}</b> at ${esc(formatTime(next.start))}`
        : "Nothing left on the schedule today.";

    card.className = "now-card";
    card.innerHTML = `<div class="now-empty">No Ongoing Class</div><div class="now-next">${msg}</div>`;
    return;
  }

  const left = Math.max(toMinutes(current.end) - nowMinutes(), 0);
  const leftText =
    left >= 60 ? `${Math.floor(left / 60)}h ${left % 60}m left` : `${left} min left`;

  card.className = `now-card live ${colorClass(current)}`;
  card.innerHTML =
    '<div class="now-label"><span class="live-dot"></span>Ongoing Class</div>' +
    `<div class="now-title">${esc(current.subject)}` +
    (current.section ? ` <span class="class-section">(${esc(current.section)})</span>` : "") +
    "</div>" +
    '<div class="now-meta">' +
    `<span>${icon("clock")}${esc(formatTime(current.start))} – ${esc(formatTime(current.end))}</span>` +
    (current.room ? `<span>${icon("pin")}${esc(current.room)}</span>` : "") +
    "</div>" +
    `<div class="now-remaining">${esc(leftText)}</div>`;
}

function renderDayPicker() {
  const today = new Date().getDay();

  $("dayPicker").innerHTML = DAY_CHIPS.map((label, i) => {
    let cls = "day-chip";
    if (i === selectedDay) cls += " selected";
    if (i === today) cls += " today";
    if (classesOnDay(store.state.classes, i).length) cls += " has-class";
    return `<button class="${cls}" data-day="${i}" title="${DAY_FULL[i]}">${label}</button>`;
  }).join("");
}

function renderDayClasses() {
  const today = new Date().getDay();

  $("dayHeading").textContent =
    selectedDay === today ? "Classes Today" : `Classes on ${DAY_FULL[selectedDay]}`;

  const items = classesOnDay(store.state.classes, selectedDay);
  const list = $("dayClassList");

  if (!items.length) {
    list.innerHTML = `<li class="sched-empty">No classes on ${DAY_FULL[selectedDay]}.</li>`;
    return;
  }

  const m = nowMinutes();
  const isToday = selectedDay === today;

  list.innerHTML = items
    .map((c) => {
      const isNow = isToday && toMinutes(c.start) <= m && m < toMinutes(c.end);
      const isPast = isToday && toMinutes(c.end) <= m;

      return (
        `<li class="class-row ${colorClass(c)}${isNow ? " is-now" : ""}${isPast ? " is-past" : ""}" data-id="${esc(c.id)}">` +
        `<span class="class-name">${icon("book")}${esc(c.subject)}` +
        (c.section ? ` <span class="class-section">(${esc(c.section)})</span>` : "") +
        (isNow ? ' <span class="now-pill">Now</span>' : "") +
        "</span>" +
        `<span class="class-when">${icon("clock")}${esc(formatTime(c.start))} – ${esc(formatTime(c.end))}</span>` +
        `<span class="class-where">${c.room ? icon("pin") + esc(c.room) : ""}</span>` +
        "</li>"
      );
    })
    .join("");
}

function renderAllClasses() {
  const table = $("allClassesTable");
  const { classes } = store.state;

  if (!classes.length) {
    table.innerHTML =
      '<tbody><tr><td class="sched-empty" style="border:none;">No classes added yet. Use <b>Add Class</b> above.</td></tr></tbody>';
    return;
  }

  const rows = classes.slice().sort((a, b) => {
    const da = Math.min(...(a.days.length ? a.days : [7]));
    const db = Math.min(...(b.days.length ? b.days : [7]));
    return da - db || toMinutes(a.start) - toMinutes(b.start);
  });

  table.innerHTML =
    "<thead><tr><th>#</th><th>Subject</th><th>Section</th><th>Schedule</th><th>Facility</th></tr></thead><tbody>" +
    rows
      .map(
        (c, i) =>
          `<tr data-id="${esc(c.id)}" title="Click to edit">` +
          `<td>${i + 1}</td>` +
          `<td><span class="subject-tag ${colorClass(c)}"><span class="subject-dot"></span>${esc(c.subject)}</span></td>` +
          `<td>${esc(c.section || "—")}</td>` +
          `<td>${esc(describeDays(c.days))} (${esc(formatTime(c.start))} – ${esc(formatTime(c.end))})</td>` +
          `<td>${esc(c.room || "—")}</td>` +
          "</tr>"
      )
      .join("") +
    "</tbody>";
}

export function render() {
  renderNowCard();
  renderDayPicker();
  renderDayClasses();
  renderAllClasses();
}

/** Keeps the live card and "Now" highlight honest without a full re-render. */
function startTicker() {
  if (ticker) return;
  ticker = setInterval(() => {
    if (isHidden($("view-schedule"))) return;
    renderNowCard();
    renderDayClasses();
  }, 30000);
}

export function mount() {
  $("dayPicker").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-day]");
    if (!btn) return;
    selectedDay = Number(btn.dataset.day);
    renderDayPicker();
    renderDayClasses();
  });

  $("dayClassList").addEventListener("click", (e) => {
    const row = e.target.closest(".class-row");
    if (row) openEditClass(row.dataset.id);
  });

  $("allClassesTable").addEventListener("click", (e) => {
    const row = e.target.closest("tr[data-id]");
    if (row) openEditClass(row.dataset.id);
  });

  $("addClassBtn").addEventListener("click", () => openNewClass(selectedDay));
  $("fullSchedBtn").addEventListener("click", openFullSchedule);

  startTicker();
}
