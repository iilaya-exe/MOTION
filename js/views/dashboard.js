import { store } from "../store.js";
import { $, esc } from "../dom.js";
import { icon } from "../icons.js";
import { dateKey, overdueLabel, parseDateKey, todayKey } from "../lib/dates.js";
import { getHolidaysForYear } from "../lib/holidays.js";
import { classesOnDay, colorClass, formatTime, minutesUntil, nowMinutes, toMinutes } from "../lib/schedule.js";
import { addTask, toggleTaskDone } from "./tasks.js";
import { openNewClass } from "../modals/class-editor.js";
import { friendlyDate } from "../ui/date-picker.js";

/* Today. The date is the title; four numbers say what the day holds; the day
   itself is drawn as a timetable with the class in progress, the work tied to
   each class, and a highlighter on the current time. Everything here is
   derived — nothing new is stored. */

let ticker = null;

/** The next 7 days including today, as date keys. */
function weekKeys() {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return dateKey(d);
  });
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const shortDay = (key) => parseDateKey(key).toLocaleDateString(undefined, { weekday: "short" });

// ------------------------------------------------------------------ stats --

function renderStats({ classesToday, dueToday, overdue, doneToday, eventsThisWeek }) {
  $("statDueToday").textContent = dueToday.length;
  const inProgress = dueToday.filter((t) => t.status === "progress").length;
  $("statDueMeta").textContent = dueToday.length ? (inProgress ? `${inProgress} in progress` : "None started") : "Nothing due";

  $("statOverdue").textContent = overdue.length;
  $("statOverdue").classList.toggle("is-late", overdue.length > 0);
  const oldest = [...overdue].sort((a, b) => a.due.localeCompare(b.due))[0];
  $("statOverdueMeta").textContent = oldest ? oldest.text : "All caught up";

  const total = dueToday.length + overdue.length + doneToday.length;
  const pct = total ? Math.round((doneToday.length / total) * 100) : 0;
  $("statDoneToday").textContent = doneToday.length;
  $("statDoneOf").textContent = total ? `of ${total}` : "";
  $("statDoneBar").style.width = `${pct}%`;
  $("statDoneBar").parentElement.title = total ? `${pct}% of today's work` : "Nothing due today";

  $("statEvents").textContent = eventsThisWeek.length;
  const first = eventsThisWeek[0];
  $("statEventsMeta").textContent = first
    ? `${eventsThisWeek.length === 1 ? "event" : "events"} · ${first.title} ${shortDay([...first.dates].sort().find((d) => d >= todayKey()) || first.dates[0])}`
    : "No events";

  // The summary line under the date. The class count keeps its own id: the
  // timeline below is checked against it.
  const parts = [
    `<span id="statClasses">${classesToday.length}</span> ${classesToday.length === 1 ? "class" : "classes"}`,
    dueToday.length ? plural(dueToday.length, "task") + " due" : "",
    overdue.length ? `${overdue.length} overdue` : "",
  ].filter(Boolean);
  $("todayLabel").innerHTML = parts.join(" · ");
}

// ---------------------------------------------------------------- the day --

function taskChip(task, today) {
  const overdue = !task.done && task.due && task.due < today;
  return (
    `<li class="tl-task${task.done ? " done" : ""}${overdue ? " is-overdue" : ""}">` +
    `<input type="checkbox" data-action="toggle-task" data-id="${esc(task.id)}"` +
    `${task.done ? " checked" : ""} aria-label="${esc(task.text)}">` +
    `<span class="tl-task-text">${esc(task.text)}</span>` +
    (overdue ? `<span class="badge overdue">${esc(overdueLabel(task.due))}</span>` : "") +
    "</li>"
  );
}

/** "38 min left" / "1 h 5 min left". */
function leftLabel(mins) {
  const h = Math.floor(mins / 60);
  return h ? `${h} h ${mins % 60} min left` : `${mins} min left`;
}

function renderDay(classesToday, tasksToday, holidays, eventsToday, today) {
  const host = $("todayTimeline");
  const nowM = nowMinutes();

  // First run: no timetable at all. The day panel explains the one step that
  // makes the rest of Today work.
  if (!store.state.classes.length) {
    host.innerHTML =
      '<div class="first-run">' +
      '<div class="fr-text"><h3>Start with your timetable</h3>' +
      "<p>Add each class once, with its days and times. Motion repeats it every week, shows what&rsquo;s on now, and files your tasks under the right subject.</p>" +
      `<div class="fr-actions"><button type="button" class="btn" data-action="add-class">${icon("plus")}Add a class</button>` +
      '<label class="btn secondary" for="importDataInput">Import a backup</label></div></div>' +
      '<div class="fr-sketch" aria-hidden="true">' +
      [1, 2, 3, 4].map((i) => `<span class="fr-col" style="left:${i * 20}%"></span>`).join("") +
      [[0, 4, 26], [1, 4, 26], [2, 4, 26], [0, 38, 26], [2, 38, 26], [4, 38, 26], [1, 72, 26], [3, 72, 26]]
        .map(([d, top, h], i) =>
          `<span class="fr-blk${i === 0 ? " is-filled" : ""}" style="left:calc(${d * 20}% + 6px);top:${top}%;height:${h}%"></span>`)
        .join("") +
      "</div></div>" +
      looseTasks(tasksToday, today, false);
    return;
  }

  const allDay =
    holidays.map((h) => `<span class="tl-chip ${h.type}"><i></i>${esc(h.name)}</span>`).join("") +
    eventsToday.map((e) => `<span class="tl-chip event">${esc(e.title)}</span>`).join("");

  // A task hangs off a class only if that class actually meets today.
  const byClass = new Map(classesToday.map((c) => [c.id, []]));
  const loose = [];
  tasksToday.forEach((t) => {
    if (t.subjectId && byClass.has(t.subjectId)) byClass.get(t.subjectId).push(t);
    else loose.push(t);
  });

  if (!classesToday.length) {
    host.innerHTML =
      (allDay ? `<div class="tl-allday">${allDay}</div>` : "") +
      `<div class="tl-empty">No classes today.</div>` +
      looseTasks(loose, today, false);
    return;
  }

  // Hours on the scale: the classes' span, widened to take in the current time
  // when it is close, so the "now" line usually has somewhere to sit.
  const starts = classesToday.map((c) => toMinutes(c.start));
  const ends = classesToday.map((c) => toMinutes(c.end));
  let first = Math.floor(Math.min(...starts) / 60);
  let last = Math.ceil(Math.max(...ends) / 60);
  const nowH = nowM / 60;
  if (nowH >= first - 2 && nowH < first) first = Math.floor(nowH);
  if (nowH > last && nowH <= last + 2) last = Math.ceil(nowH + 0.01);
  if (last - first < 4) last = first + 4;
  const HOUR = 64;
  const y = (min) => ((min - first * 60) / 60) * HOUR;

  let grid = "";
  for (let h = first; h <= last; h++) {
    const near = Math.abs(h * 60 - nowM) < 36;
    grid += `<div class="tl-hour" style="top:${y(h * 60)}px">${near ? "" : `<span>${esc(formatTime(`${String(h % 24).padStart(2, "0")}:00`))}</span>`}</div>`;
  }

  classesToday.forEach((c) => {
    const s = toMinutes(c.start);
    const e = toMinutes(c.end);
    const isNow = s <= nowM && nowM < e;
    const isPast = e <= nowM;
    const tasks = byClass.get(c.id);
    grid +=
      `<div class="tl-item ${colorClass(c)}${isNow ? " is-now" : ""}${isPast ? " is-past" : ""}" style="top:${y(s) + 2}px;min-height:${y(e) - y(s) - 4}px">` +
      `<div class="tl-title">${c.emoji ? `<span class="class-emoji">${esc(c.emoji)}</span>` : ""}${esc(c.subject)}` +
      (c.section ? ` <span class="tl-code">${esc(c.section)}</span>` : "") + "</div>" +
      `<div class="tl-meta"><span class="tl-time">${icon("clock")}${esc(formatTime(c.start))} – ${esc(formatTime(c.end))}</span>` +
      (c.room ? `<span>${icon("pin")}${esc(c.room)}</span>` : "") + "</div>" +
      (isNow
        ? `<div class="tl-progress"><i style="width:${Math.round(((nowM - s) / (e - s)) * 100)}%"></i></div><div class="tl-left">${leftLabel(e - nowM)}</div>`
        : "") +
      (tasks.length ? `<ul class="tl-tasks">${tasks.map((t) => taskChip(t, today)).join("")}</ul>` : "") +
      "</div>";
  });

  // The current time, with the highlighter. Outside the scale it pins to the
  // nearer edge, so the marker is always there to orient by.
  const clamped = Math.min(Math.max(nowM, first * 60), last * 60);
  const nowLabel = formatTime(`${String(Math.floor(nowM / 60)).padStart(2, "0")}:${String(nowM % 60).padStart(2, "0")}`);
  grid += `<div class="tl-now${clamped !== nowM ? " is-edge" : ""}" style="top:${y(clamped)}px"><span class="mark">${esc(nowLabel.replace(/\s?[AP]M$/i, ""))}</span></div>`;

  host.innerHTML =
    (allDay ? `<div class="tl-allday">${allDay}</div>` : "") +
    `<div class="tl-day" style="height:${y(last * 60) + 8}px">${grid}</div>` +
    looseTasks(loose, today, true);
}

function looseTasks(list, today, hasClasses) {
  if (!list.length) return "";
  return (
    `<div class="tl-loose"><div class="tl-loose-head">${hasClasses ? "Not tied to a class" : "Due today"}</div>` +
    `<ul class="tl-tasks">${list.map((t) => taskChip(t, today)).join("")}</ul></div>`
  );
}

/** The line in the Today panel's header: what is on now, or next. */
function renderNow(classesToday) {
  const host = $("nextClass");
  const nowM = nowMinutes();
  const live = classesToday.find((c) => toMinutes(c.start) <= nowM && nowM < toMinutes(c.end));
  const next = classesToday.find((c) => minutesUntil(c) > 0);

  if (live) host.textContent = `${live.subject} · ${leftLabel(toMinutes(live.end) - nowM)}`;
  else if (next) host.textContent = `Next: ${next.subject} at ${formatTime(next.start)}`;
  else if (classesToday.length) host.textContent = "Classes are done for today";
  else host.textContent = "";
}

// ----------------------------------------------------------- side columns --

function renderDueNext(today) {
  const open = store.state.tasks
    .filter((t) => !t.done && t.due)
    .sort((a, b) => a.due.localeCompare(b.due) || (a.createdAt || 0) - (b.createdAt || 0))
    .slice(0, 6);
  const undated = store.state.tasks.filter((t) => !t.done && !t.due).length;

  $("todayMeta").textContent = open.length ? String(open.length + undated) : "";
  $("dueNext").innerHTML = open.length
    ? open
        .map((t) => {
          const late = t.due < today;
          const when = late ? overdueLabel(t.due) : t.due === today ? "today" : friendlyDate(t.due);
          return (
            `<li><input type="checkbox" data-action="toggle-task" data-id="${esc(t.id)}" aria-label="${esc(t.text)}">` +
            `<span class="due-text">${esc(t.text)}</span><span class="due-when${late ? " is-late" : ""}">${esc(when.toLowerCase() === "today" ? "today" : when)}</span></li>`
          );
        })
        .join("")
    : '<li class="due-empty">Nothing due. Add one above.</li>';
}

function renderWeek(eventsThisWeek, holidaysByKey) {
  const keys = weekKeys();
  const from = parseDateKey(keys[0]);
  const to = parseDateKey(keys[6]);
  const fmt = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  $("weekRange").textContent = `${fmt(from)} – ${fmt(to)}`;

  const rows = [];
  eventsThisWeek.forEach((ev) => {
    const days = [...ev.dates].sort();
    const start = days.find((d) => d >= keys[0]) || days[0];
    rows.push({ key: start, title: ev.title, sub: days.length > 1 ? `${days.length} days` : "" });
  });
  keys.forEach((k) => {
    (holidaysByKey[k] || []).forEach((h) => rows.push({ key: k, title: h.name, sub: h.type === "regular" ? "Regular holiday" : "Special holiday" }));
  });
  rows.sort((a, b) => a.key.localeCompare(b.key));

  $("dashUpcoming").innerHTML = rows.length
    ? rows
        .map((r) => {
          const d = parseDateKey(r.key);
          return (
            `<li><span class="wk-date"><b>${d.getDate()}</b><small>${esc(d.toLocaleDateString(undefined, { weekday: "short" }))}</small></span>` +
            `<span class="wk-text">${esc(r.title)}${r.sub ? `<small>${esc(r.sub)}</small>` : ""}</span></li>`
          );
        })
        .join("")
    : '<li class="due-empty">No events in the next 7 days.</li>';
}

// ----------------------------------------------------------------- render --

export function render() {
  const state = store.state;
  const now = new Date();
  const today = todayKey();

  $("greeting").textContent = now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  const classesToday = classesOnDay(state.classes, now.getDay());
  const dueToday = state.tasks.filter((t) => t.due === today && !t.done);
  const overdue = state.tasks.filter((t) => t.due && t.due < today && !t.done);
  const doneToday = state.tasks.filter((t) => t.due === today && t.done);

  const week = weekKeys();
  // Distinct events overlapping the window — a 5-day event is one event.
  const eventsThisWeek = state.eventsList
    .filter((ev) => ev.dates.some((d) => week.includes(d)))
    .sort((a, b) => [...a.dates].sort()[0].localeCompare([...b.dates].sort()[0]));

  const holidaysYear = getHolidaysForYear(now.getFullYear());
  const holidaysByKey = {};
  week.forEach((k) => {
    const y = Number(k.slice(0, 4));
    const list = (y === now.getFullYear() ? holidaysYear : getHolidaysForYear(y))[k];
    if (list) holidaysByKey[k] = list;
  });

  renderStats({ classesToday, dueToday, overdue, doneToday, eventsThisWeek });
  renderNow(classesToday);
  renderDay(
    classesToday,
    // Overdue work is today's problem too, so it appears alongside what is due.
    [...overdue, ...dueToday],
    holidaysYear[today] || [],
    state.eventsList.filter((ev) => ev.dates.includes(today)),
    today
  );
  renderDueNext(today);
  renderWeek(eventsThisWeek, holidaysByKey);
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
  $("homeNewTaskBtn").addEventListener("click", () => {
    input.scrollIntoView({ block: "center", behavior: "smooth" });
    input.focus({ preventScroll: true });
  });

  // Ticking a task from the day or the due list goes through the same logic
  // as the Tasks screen, so repeating tasks roll forward.
  const onToggle = (e) => {
    const box = e.target.closest('[data-action="toggle-task"]');
    if (!box) return;
    toggleTaskDone(box.dataset.id, box.checked);
    render();
  };
  $("todayTimeline").addEventListener("change", onToggle);
  $("dueNext").addEventListener("change", onToggle);

  $("todayTimeline").addEventListener("click", (e) => {
    if (e.target.closest('[data-action="add-class"]')) openNewClass(new Date().getDay());
  });

  // Keeps the "now" line and the live class honest.
  if (!ticker) {
    ticker = setInterval(() => {
      if (!$("view-dashboard").classList.contains("hidden")) render();
    }, 30000);
  }
}
