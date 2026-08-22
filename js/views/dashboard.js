import { store } from "../store.js";
import { $, esc } from "../dom.js";
import { icon } from "../icons.js";
import { dateKey, formatDateSpan, formatShortDate, todayKey } from "../lib/dates.js";
import { getHolidaysForYear } from "../lib/holidays.js";
import {
  classStatus, classesOnDay, colorClass, formatTime, minutesUntil, nowMinutes, toMinutes,
} from "../lib/schedule.js";
import { formatCountdown, timerState } from "../ui/class-timer.js";
import { addTask, toggleTaskDone } from "./tasks.js";

/* The Today timeline is the one place the four separate lists meet: the class
   schedule provides the spine, and tasks hang off the class they belong to.
   Everything here is derived — nothing new is stored. */

let ticker = null;

/* Keyed to the date rather than random, so it does not reshuffle on every
   render — a line that changes mid-session reads as a glitch. */
const MOTTOS = [
  "Small steps, every day.",
  "One thing at a time.",
  "Done beats perfect.",
  "Start with the hardest one.",
  "Future you says thanks.",
  "Momentum over motivation.",
  "Finish what you started.",
];

const mottoForToday = () => MOTTOS[new Date().getDate() % MOTTOS.length];

function greetingFor(hour) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** The next 7 days including today, as date keys. */
function weekKeys() {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return dateKey(d);
  });
}

// ------------------------------------------------------------------ stats --

function renderStats(dueToday, overdue, eventsThisWeek, classesToday, doneToday) {
  const checklistsInProgress = store.state.checklists.filter(
    (cl) => cl.items.length > 0 && cl.items.some((i) => !i.done)
  ).length;

  $("statDueToday").textContent = dueToday.length;
  $("statOverdue").textContent = overdue.length;
  $("statClasses").textContent = classesToday.length;
  $("statEvents").textContent = eventsThisWeek.length;
  $("statChecklists").textContent = checklistsInProgress;
  $("statDoneToday").textContent = doneToday.length;
}

/** "Up next": the ongoing class, else the next one today, else tomorrow's first. */
function renderNextClass(classesToday) {
  const host = $("nextClass");
  const now = nowMinutes();

  const ongoing = classesToday.find((c) => toMinutes(c.start) <= now && now < toMinutes(c.end));
  const next = ongoing || classesToday.find((c) => minutesUntil(c) > 0);

  if (!next) {
    $("nextMeta").textContent = "";
    host.innerHTML = classesToday.length
      ? '<div class="widget-empty">All done for today.</div>'
      : '<div class="widget-empty">No classes today.</div>';
    return;
  }

  const status = classStatus(next);
  $("nextMeta").textContent = ongoing ? "In progress" : `${minutesUntil(next)} min away`;

  host.innerHTML =
    `<div class="next-class ${colorClass(next)}">` +
    `<div class="nc-mark">${next.emoji ? esc(next.emoji) : icon("book")}</div>` +
    "<div class=\"nc-body\">" +
    `<div class="nc-name">${esc(next.subject)}` +
    (next.section ? ` <span class="class-section">(${esc(next.section)})</span>` : "") +
    "</div>" +
    `<div class="nc-meta"><span>${icon("clock")}${esc(formatTime(next.start))} – ${esc(formatTime(next.end))}</span>` +
    (next.room ? `<span>${icon("pin")}${esc(next.room)}</span>` : "") +
    "</div></div>" +
    `<span class="cls-status s-${status}">${
      { ongoing: "Ongoing", soon: "Starting soon", upcoming: "Upcoming", done: "Done" }[status]
    }</span></div>`;
}

/** Share of today's work already ticked off, as a conic-gradient ring. */
function renderDayRing(dueToday, overdue, doneToday) {
  const open = dueToday.length + overdue.length;
  const total = open + doneToday.length;
  const pct = total ? Math.round((doneToday.length / total) * 100) : 0;

  $("dayRing").style.setProperty("--pct", pct);
  $("dayRingPct").textContent = `${pct}%`;
  $("dayRing").classList.toggle("is-complete", total > 0 && pct === 100);

  $("dayRingLegend").innerHTML =
    `<div><b>${doneToday.length}</b> completed</div>` +
    `<div><b>${open}</b> remaining</div>` +
    (overdue.length ? `<div class="legend-warn"><b>${overdue.length}</b> overdue</div>` : "");
}

function renderQuickActions() {
  $("quickActions").innerHTML = [
    ["#/tasks", "checkSquare", "All tasks"],
    ["#/schedule", "clock", "Schedule"],
    ["#/calendar", "calendarSm", "Calendar"],
    ["#/checklists", "checklist", "Checklists"],
  ]
    .map(([href, ic, label]) => `<a class="quick-action" href="${href}">${icon(ic)}${label}</a>`)
    .join("");
}

/** Countdown panel at the top of Home; digits are refreshed by the ticker. */
function renderHomeTimer() {
  const host = $("homeTimer");
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
    `</div><div class="tp-count" id="homeTimerCount">${formatCountdown(state.secondsLeft)}</div></div>` +
    '<div class="tp-info">' +
    `<div class="tp-name">${cls.emoji ? `<span class="class-emoji">${esc(cls.emoji)}</span>` : ""}${esc(cls.subject)}</div>` +
    '<div class="tp-meta">' +
    `<span>${icon("clock")}${esc(formatTime(cls.start))} – ${esc(formatTime(cls.end))}</span>` +
    (cls.room ? `<span>${icon("pin")}${esc(cls.room)}</span>` : "") +
    "</div></div>";
}

// --------------------------------------------------------------- timeline --

function taskChip(task) {
  return (
    `<li class="tl-task${task.done ? " done" : ""}">` +
    `<input type="checkbox" data-action="toggle-task" data-id="${esc(task.id)}"` +
    `${task.done ? " checked" : ""} aria-label="${esc(task.text)}">` +
    `<span class="tl-task-text">${esc(task.text)}</span>` +
    `<span class="badge priority-${esc(task.priority)}">${esc(task.priority)}</span>` +
    "</li>"
  );
}

function classBlock(c, tasks, nowM) {
  const isNow = toMinutes(c.start) <= nowM && nowM < toMinutes(c.end);
  const isPast = toMinutes(c.end) <= nowM;

  return (
    `<li class="tl-item ${colorClass(c)}${isNow ? " is-now" : ""}${isPast ? " is-past" : ""}">` +
    `<div class="tl-time"><b>${esc(formatTime(c.start))}</b><span>${esc(formatTime(c.end))}</span></div>` +
    '<div class="tl-rail"></div>' +
    '<div class="tl-body">' +
    `<div class="tl-title">` +
    (c.emoji ? `<span class="class-emoji">${esc(c.emoji)}</span>` : "") +
    esc(c.subject) +
    (c.section ? ` <span class="class-section">(${esc(c.section)})</span>` : "") +
    (isNow ? ' <span class="now-pill">Now</span>' : "") +
    "</div>" +
    (c.room ? `<div class="tl-meta">${icon("pin")}${esc(c.room)}</div>` : "") +
    (tasks.length ? `<ul class="tl-tasks">${tasks.map(taskChip).join("")}</ul>` : "") +
    "</li>"
  );
}

function renderTimeline(classesToday, tasksToday, holidays, eventsToday) {
  const host = $("todayTimeline");
  const nowM = nowMinutes();

  // All-day band: holidays and events have no time, so they sit above the spine.
  const banners =
    holidays.map((h) => `<span class="tl-chip ${h.type}">${esc(h.name)}</span>`).join("") +
    eventsToday.map((e) => `<span class="tl-chip event">${esc(e.title)}</span>`).join("");

  // A task hangs off a class only if that class actually meets today.
  const byClass = new Map(classesToday.map((c) => [c.id, []]));
  const loose = [];
  tasksToday.forEach((t) => {
    if (t.subjectId && byClass.has(t.subjectId)) byClass.get(t.subjectId).push(t);
    else loose.push(t);
  });

  let items = "";
  let nowPlaced = false;

  classesToday.forEach((c) => {
    if (!nowPlaced && toMinutes(c.start) > nowM) {
      items += '<li class="tl-now"><span>Now</span></li>';
      nowPlaced = true;
    }
    items += classBlock(c, byClass.get(c.id), nowM);
  });

  if (classesToday.length && !nowPlaced) items += '<li class="tl-now"><span>Now</span></li>';

  const looseBlock = loose.length
    ? '<div class="tl-loose"><div class="tl-loose-head">' +
      (classesToday.length ? "Not tied to a class" : "Due today") +
      `</div><ul class="tl-tasks">${loose.map(taskChip).join("")}</ul></div>`
    : "";

  if (!classesToday.length && !loose.length && !banners) {
    host.innerHTML =
      '<div class="tl-empty">Nothing scheduled today. Add a class in <b>Schedule</b> ' +
      "or a task above to fill this in.</div>";
    return;
  }

  host.innerHTML =
    (banners ? `<div class="tl-allday">${banners}</div>` : "") +
    (items ? `<ol class="tl-list">${items}</ol>` : "") +
    looseBlock;
}

// ----------------------------------------------------------------- render --

export function render() {
  const state = store.state;
  const now = new Date();
  const today = todayKey();

  $("greeting").textContent = greetingFor(now.getHours());
  $("todayLabel").textContent = now.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const classesToday = classesOnDay(state.classes, now.getDay());
  const dueToday = state.tasks.filter((t) => t.due === today && !t.done);
  const overdue = state.tasks.filter((t) => t.due && t.due < today && !t.done);

  const week = weekKeys();
  // Count distinct events overlapping the window — a 5-day event is one event,
  // not five, and it still counts if only part of it falls inside.
  const eventsThisWeek = state.eventsList.filter((ev) => ev.dates.some((d) => week.includes(d)));

  const doneToday = state.tasks.filter((t) => t.due === today && t.done);

  renderStats(dueToday, overdue, eventsThisWeek, classesToday, doneToday);
  renderNextClass(classesToday);
  renderDayRing(dueToday, overdue, doneToday);
  renderQuickActions();
  renderHomeTimer();
  $("homeMotto").textContent = mottoForToday();

  renderTimeline(
    classesToday,
    // Overdue work is today's problem too, so it appears alongside what is due.
    [...overdue, ...dueToday],
    getHolidaysForYear(now.getFullYear())[today] || [],
    state.eventsList.filter((ev) => ev.dates.includes(today))
  );

  $("todayMeta").textContent = [
    classesToday.length ? `${classesToday.length} class${classesToday.length === 1 ? "" : "es"}` : "",
    dueToday.length ? `${dueToday.length} due` : "",
    overdue.length ? `${overdue.length} overdue` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  // One row per event (not per day), showing its full span, earliest first.
  const upcoming = eventsThisWeek
    .map((ev) => {
      const sorted = [...ev.dates].sort();
      return { text: ev.title, span: formatDateSpan(sorted), sortKey: sorted[0] };
    })
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  $("dashUpcoming").innerHTML = upcoming.length
    ? upcoming
        .map(
          (i) =>
            `<li><span>${esc(i.text)}</span><span class="muted">${esc(i.span)}</span></li>`
        )
        .join("")
    : '<li><span class="muted">No events in the next 7 days.</span></li>';
}

export function mount() {
  const input = $("quickTaskInput");

  const submit = () => {
    addTask(input.value, todayKey(), "medium");
    input.value = "";
    render();
  };

  $("quickTaskBtn").addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });

  $("todayTimeline").addEventListener("change", (e) => {
    const box = e.target.closest('[data-action="toggle-task"]');
    if (!box) return;
    toggleTaskDone(box.dataset.id, box.checked);
    render();
  });

  // Keeps the "Now" marker and the past/ongoing shading honest.
  if (!ticker) {
    // Only the countdown digits move every second; the full redraw stays on 60s.
    setInterval(() => {
      if ($("view-dashboard").classList.contains("hidden")) return;
      const el = $("homeTimerCount");
      const state = timerState();
      if (el && state) el.textContent = formatCountdown(state.secondsLeft);
      else if (!state) renderHomeTimer();
    }, 1000);

    ticker = setInterval(() => {
      if (!$("view-dashboard").classList.contains("hidden")) render();
    }, 60000);
  }
}
