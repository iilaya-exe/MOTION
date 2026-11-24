import { store } from "../store.js";
import { $, esc, isHidden } from "../dom.js";
import { icon } from "../icons.js";
import { DAY_CHIPS, DAY_FULL } from "../lib/dates.js";
import {
  classesOnDay,
  classStatus,
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
import { formatCountdown, timerState } from "../ui/class-timer.js";
import { isMobile } from "../ui/nav.js";

const STATUS_LABEL = { ongoing: "Ongoing", soon: "Starting soon", upcoming: "Upcoming", done: "Done" };

/** The class-status pill shown on rows and in the timetable. */
const statusPill = (status) =>
  `<span class="cls-status s-${status}">${STATUS_LABEL[status]}</span>`;

/** Open task count per class, so the timetable shows where the work is. */
const openTaskCount = (classId) =>
  store.state.tasks.filter((t) => t.subjectId === classId && !t.done).length;


let selectedDay = new Date().getDay();
let ticker = null;

// ------------------------------------------------------------- view switch ---
/* Week (timetable), Day (the day picker and list) or List (the table only).
   Remembered per device; phones start on Day, where a timetable is cramped. */
const VIEWS = ["week", "day", "list"];
const VIEW_KEY = "motionScheduleView";

function savedView() {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (VIEWS.includes(v)) return v;
  } catch {
    /* storage blocked: fall through to the default */
  }
  return isMobile() ? "day" : "week";
}

let view = savedView();

function setView(next) {
  if (!VIEWS.includes(next)) return;
  view = next;
  try {
    localStorage.setItem(VIEW_KEY, next);
  } catch {
    /* not remembered, still applied */
  }
  applyView();
}

function applyView() {
  $("view-schedule").dataset.schedView = view;
  document.querySelectorAll("#schedViewSwitch [data-view]").forEach((b) => {
    const on = b.dataset.view === view;
    b.classList.toggle("active", on);
    b.setAttribute("aria-checked", String(on));
    b.tabIndex = on ? 0 : -1;
  });
}

// ----------------------------------------------------------- week timetable ---
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // timetables start on Monday
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Lays overlapping classes side by side: each gets a lane and a lane count. */
function layoutDay(items) {
  const sorted = [...items].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  const placed = [];
  let cluster = [];
  let clusterEnd = -1;

  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((p) => p.lane + 1));
    cluster.forEach((p) => (p.lanes = lanes));
    cluster = [];
  };

  sorted.forEach((c) => {
    const start = toMinutes(c.start);
    const end = Math.max(toMinutes(c.end), start + 15);
    if (start >= clusterEnd) {
      flush();
      clusterEnd = end;
    } else {
      clusterEnd = Math.max(clusterEnd, end);
    }
    const busy = new Set(cluster.filter((p) => p.end > start).map((p) => p.lane));
    let lane = 0;
    while (busy.has(lane)) lane++;
    const entry = { c, start, end, lane, lanes: 1 };
    cluster.push(entry);
    placed.push(entry);
  });
  flush();
  return placed;
}

function hourLabel(h) {
  const suffix = h >= 12 && h < 24 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1} ${suffix}`;
}

function renderWeek() {
  const host = $("weekTimetable");
  const { classes } = store.state;

  if (!classes.length) {
    host.innerHTML =
      '<div class="tt-empty"><p>No classes yet. Add your timetable once and it repeats every week.</p>' +
      `<button type="button" class="btn" data-action="tt-add">${icon("plus")}Add a class</button></div>`;
    return;
  }

  // Weekends only appear when something is scheduled on them.
  const days = WEEK_ORDER.filter((d) => d >= 1 && d <= 5 || classes.some((c) => c.days.includes(d)));

  const starts = classes.map((c) => toMinutes(c.start));
  const ends = classes.map((c) => toMinutes(c.end));
  const first = Math.max(0, Math.floor(Math.min(...starts) / 60));
  const last = Math.min(24, Math.ceil(Math.max(...ends) / 60));
  const hours = Math.max(last - first, 1);

  const now = new Date();
  const today = now.getDay();
  const nowMin = nowMinutes();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));

  const pct = (min) => ((min - first * 60) / (hours * 60)) * 100;

  let html = `<div class="tt-grid" style="--days:${days.length};--hours:${hours}">`;

  // Header row.
  html += '<div class="tt-corner"></div>';
  days.forEach((d) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + ((d + 6) % 7));
    const label = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    html += `<div class="tt-dayname${d === today ? " today" : ""}">${DAY_SHORT[d]}<small>${esc(label)}</small></div>`;
  });

  // Hour labels.
  html += '<div class="tt-hours">';
  // The first hour sits on the top edge, so its label hangs below the line.
  html += `<span class="tt-hour is-first" style="top:0">${hourLabel(first)}</span>`;
  for (let h = first + 1; h < last; h++) {
    html += `<span class="tt-hour" style="top:${pct(h * 60)}%">${hourLabel(h)}</span>`;
  }
  html += "</div>";

  // Day columns.
  days.forEach((d) => {
    html += `<div class="tt-col${d === today ? " today" : ""}" data-day="${d}" title="Add a class on ${DAY_FULL[d]}">`;
    for (let h = first + 1; h < last; h++) {
      html += `<span class="tt-line" style="top:${pct(h * 60)}%"></span>`;
    }
    layoutDay(classesOnDay(classes, d)).forEach(({ c, start, end, lane, lanes }) => {
      const tasks = openTaskCount(c.id);
      const past = d === today && end <= nowMin;
      html +=
        `<button type="button" class="tt-block ${colorClass(c)}${past ? " is-past" : ""}" data-id="${esc(c.id)}" ` +
        `style="top:${pct(start)}%;height:${pct(end) - pct(start)}%;` +
        `left:calc(${(lane / lanes) * 100}% + 4px);width:calc(${100 / lanes}% - 8px)" ` +
        `title="${esc(c.subject)}, ${esc(formatTime(c.start))} – ${esc(formatTime(c.end))}${c.room ? ", " + esc(c.room) : ""}">` +
        `<span class="tt-name">${c.emoji ? `<span class="class-emoji">${esc(c.emoji)}</span>` : ""}${esc(c.subject)}</span>` +
        `<span class="tt-meta">${esc(formatTime(c.start))}${c.room ? " · " + esc(c.room) : ""}</span>` +
        (tasks ? `<span class="tt-tasks">${tasks} task${tasks === 1 ? "" : "s"}</span>` : "") +
        "</button>";
    });
    if (d === today && nowMin > first * 60 && nowMin < last * 60) {
      html += `<span class="tt-now" style="top:${pct(nowMin)}%" aria-hidden="true"></span>`;
    }
    html += "</div>";
  });

  html += "</div>";
  host.innerHTML = html;
}

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
    `<div class="now-title">` +
    (current.emoji ? `<span class="class-emoji">${esc(current.emoji)}</span>` : "") +
    esc(current.subject) +
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
    list.innerHTML =
      `<li class="sched-empty">No classes on ${DAY_FULL[selectedDay]}. ` +
      `<button type="button" class="link-btn" data-action="add-on-day">Add one</button></li>`;
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
        `<span class="class-name">` +
        (c.emoji ? `<span class="class-emoji">${esc(c.emoji)}</span>` : icon("book")) +
        esc(c.subject) +
        (c.section ? ` <span class="class-section">(${esc(c.section)})</span>` : "") +
        (isToday ? " " + statusPill(classStatus(c, selectedDay, m)) : "") +
        (openTaskCount(c.id)
          ? ` <span class="task-count">${openTaskCount(c.id)} task${openTaskCount(c.id) === 1 ? "" : "s"}</span>`
          : "") +
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
    "<thead><tr><th>#</th><th>Subject</th><th>Section</th><th>Schedule</th><th>Facility</th><th>Tasks</th></tr></thead><tbody>" +
    rows
      .map(
        (c, i) =>
          `<tr data-id="${esc(c.id)}" title="Click to edit">` +
          `<td>${i + 1}</td>` +
          `<td><span class="subject-tag ${colorClass(c)}">` +
          (c.emoji ? `<span class="class-emoji">${esc(c.emoji)}</span>` : '<span class="subject-dot"></span>') +
          `${esc(c.subject)}</span></td>` +
          `<td>${esc(c.section || "—")}</td>` +
          `<td>${esc(describeDays(c.days))} (${esc(formatTime(c.start))} – ${esc(formatTime(c.end))})</td>` +
          `<td>${esc(c.room || "—")}</td>` +
          `<td>${openTaskCount(c.id) ? `<span class="task-count">${openTaskCount(c.id)}</span>` : "—"}</td>` +
          "</tr>"
      )
      .join("") +
    "</tbody>";
}

function renderTimerPanel() {
  const host = $("schedTimer");
  const state = timerState();

  if (!state) {
    host.classList.add("hidden");
    return;
  }

  const { cls, ongoing, phase } = state;
  host.classList.remove("hidden");
  host.className = `timer-panel ${colorClass(cls)} phase-${phase}`;
  host.innerHTML =
    '<div><div class="tp-label">' +
    (ongoing ? "Ends in" : "Starts in") +
    `</div><div class="tp-count" id="schedTimerCount">${formatCountdown(state.secondsLeft)}</div></div>` +
    '<div class="tp-info">' +
    `<div class="tp-name">${cls.emoji ? `<span class="class-emoji">${esc(cls.emoji)}</span>` : ""}${esc(cls.subject)}` +
    (cls.section ? ` <span class="class-section">(${esc(cls.section)})</span>` : "") +
    "</div>" +
    '<div class="tp-meta">' +
    `<span>${icon("clock")}${esc(formatTime(cls.start))} – ${esc(formatTime(cls.end))}</span>` +
    (cls.room ? `<span>${icon("pin")}${esc(cls.room)}</span>` : "") +
    "</div></div>";
}

export function render() {
  applyView();
  renderTimerPanel();
  renderNowCard();
  renderDayPicker();
  renderDayClasses();
  renderWeek();
  renderAllClasses();
}

/** Keeps the live card and "Now" highlight honest without a full re-render. */
function startTicker() {
  if (ticker) return;
  // Digits every second (one text write); the heavier redraw stays on 30s.
  setInterval(() => {
    if (isHidden($("view-schedule"))) return;
    const el = $("schedTimerCount");
    const state = timerState();
    if (el && state) el.textContent = formatCountdown(state.secondsLeft);
    else if (!state) renderTimerPanel();
  }, 1000);

  ticker = setInterval(() => {
    if (isHidden($("view-schedule"))) return;
    renderTimerPanel();
    renderNowCard();
    renderDayClasses();
    renderWeek();
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
    if (e.target.closest('[data-action="add-on-day"]')) return openNewClass(selectedDay);
    const row = e.target.closest(".class-row");
    if (row) openEditClass(row.dataset.id);
  });

  $("allClassesTable").addEventListener("click", (e) => {
    const row = e.target.closest("tr[data-id]");
    if (row) openEditClass(row.dataset.id);
  });

  $("addClassBtn").addEventListener("click", () => openNewClass(selectedDay));

  $("schedViewSwitch").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-view]");
    if (btn) setView(btn.dataset.view);
  });
  // Arrow keys move between the three options, as in any radio group.
  $("schedViewSwitch").addEventListener("keydown", (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    setView(VIEWS[(VIEWS.indexOf(view) + step + VIEWS.length) % VIEWS.length]);
    document.querySelector(`#schedViewSwitch [data-view="${view}"]`)?.focus();
  });

  $("weekTimetable").addEventListener("click", (e) => {
    const block = e.target.closest(".tt-block");
    if (block) return openEditClass(block.dataset.id);
    if (e.target.closest('[data-action="tt-add"]')) return openNewClass(selectedDay);
    // An empty spot in a day's column starts a class on that day.
    const col = e.target.closest(".tt-col");
    if (col) openNewClass(Number(col.dataset.day));
  });
  $("fullSchedBtn").addEventListener("click", openFullSchedule);

  startTicker();
}
