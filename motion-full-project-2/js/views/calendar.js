import { store } from "../store.js";
import { $, esc } from "../dom.js";
import { MONTH_NAMES, overdueLabel, parseDateKey, todayKey } from "../lib/dates.js";
import { icon } from "../icons.js";
import { classesOnDay, colorClass, formatTime } from "../lib/schedule.js";
import { getHolidaysForYear } from "../lib/holidays.js";
import { buildMonthWeeks } from "../lib/calendar.js";
import { openDayModal } from "../modals/day.js";
import { openEditEvent, openNewEvent } from "../modals/event-editor.js";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const view = { year: new Date().getFullYear(), month: new Date().getMonth(), selected: todayKey() };

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// The panel beside the month: everything on the selected day, read-only, with
// the day dialog one click away for editing.
function renderAside() {
  const aside = $("calAside");
  const key = view.selected;
  const state = store.state;
  const date = parseDateKey(key);
  const holidays = getHolidaysForYear(date.getFullYear())[key] || [];
  const events = state.eventsList.filter((ev) => ev.dates.includes(key));
  const classes = classesOnDay(state.classes, date.getDay());
  const tasks = state.tasks.filter((t) => t.due === key).sort((a, b) => a.done - b.done);
  const title = date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const section = (label, items) =>
    items.length ? `<div class="ca-sec"><h4>${label}</h4><ul>${items.join("")}</ul></div>` : "";

  const body =
    section("Holidays", holidays.map((h) =>
      `<li class="ca-hol ${h.type}"><i></i><span>${esc(h.name)}</span><small>${h.type === "regular" ? "Regular" : "Special"}</small></li>`)) +
    section("Events", events.map((ev) =>
      `<li class="ca-ev" data-id="${esc(ev.id)}"><span>${esc(ev.title)}</span>${ev.dates.length > 1 ? `<small>${plural(ev.dates.length, "day")}</small>` : ""}</li>`)) +
    section("Classes", classes.map((c) =>
      `<li class="ca-cls ${colorClass(c)}"><i></i><span>${esc(c.subject)}</span><small class="mono">${formatTime(c.start)}</small></li>`)) +
    section("Due", tasks.map((t) => {
      const late = !t.done && key < todayKey();
      return `<li class="ca-task${t.done ? " done" : ""}"><span>${esc(t.text)}</span>` +
        (late ? `<small class="is-late mono">${esc(overdueLabel(key))}</small>` : "") + "</li>";
    }));

  aside.innerHTML =
    `<div class="ca-head"><h3>${esc(title)}</h3>` +
    (key === todayKey() ? '<span class="mark">Today</span>' : "") + "</div>" +
    (body || '<p class="ca-empty">Nothing on this day</p>') +
    '<div class="ca-actions">' +
    `<button class="btn secondary" data-action="open-day">Open day</button>` +
    `<button class="btn secondary" data-action="add-event">${icon("plus")}Add event</button></div>`;
}

const asideShown = () => getComputedStyle($("calAside")).display !== "none";

export function render() {
  const state = store.state;
  $("calLabel").textContent = `${MONTH_NAMES[view.month]} ${view.year}`;

  const today = todayKey();
  const holidays = getHolidaysForYear(view.year);
  const weeks = buildMonthWeeks(view.year, view.month, state.eventsList);

  const tasksByDate = {};
  state.tasks.forEach((t) => {
    if (t.due) tasksByDate[t.due] = (tasksByDate[t.due] || 0) + 1;
  });

  const prefix = `${view.year}-${String(view.month + 1).padStart(2, "0")}-`;
  const evCount = state.eventsList.filter((ev) => ev.dates.some((d) => d.startsWith(prefix))).length;
  const holCount = Object.keys(holidays).filter((k) => k.startsWith(prefix)).length;
  $("calSub").innerHTML =
    `<span class="mono">${evCount}</span> event${evCount === 1 ? "" : "s"} · ` +
    `<span class="mono">${holCount}</span> holiday${holCount === 1 ? "" : "s"} this month`;

  let html = `<div class="cal-dow-row">${DOW.map((d) => `<div class="cal-dow">${d}</div>`).join("")}</div>`;

  weeks.forEach((week, wi) => {
    const weekClass =
      "cal-week" + (wi === 0 ? " is-first" : "") + (wi === weeks.length - 1 ? " is-last" : "");

    html += `<div class="${weekClass}" style="grid-template-rows:${week.gridTemplateRows};">`;

    // Layer 1: day boxes, each spanning the full week height.
    week.dayKeys.forEach((key, idx) => {
      const mod = !key ? " blank" : (key === today ? " today" : "") + (key === view.selected ? " selected" : "");
      const attr = key ? ` data-date="${key}"` : "";
      html += `<div class="cal-daybox${mod}" style="grid-column:${idx + 1};"${attr}></div>`;
    });

    // Layer 2: day number, holiday chips and task count, pinned to row 1.
    week.dayKeys.forEach((key, idx) => {
      if (!key) return;

      const count = tasksByDate[key] || 0;
      let head =
        `<div class="cal-dayhead${key === today ? " today" : ""}" style="grid-column:${idx + 1};">` +
        `<div class="cal-dayhead-top"><span class="cal-daynum${key === today ? " mark" : ""}">${Number(key.split("-")[2])}</span>`;

      if (count) {
        head += `<span class="cal-task-indicator">${count} task${count === 1 ? "" : "s"}</span>`;
      }
      head += "</div>";

      (holidays[key] || []).forEach((h) => {
        head += `<div class="cal-holiday-chip ${h.type}" title="${esc(h.name)}"><i></i>${esc(h.name)}</div>`;
      });

      html += head + "</div>";
    });

    // Layer 3: event bars.
    week.bars.forEach((bar) => {
      const caps = (bar.capStart ? " cap-start" : "") + (bar.capEnd ? " cap-end" : "");
      html +=
        `<div class="cal-event-bar${caps}" data-id="${esc(bar.ev.id)}" title="${esc(bar.ev.title)}" ` +
        `style="grid-column:${bar.startCol + 1} / ${bar.endCol + 2};grid-row:${bar.lane + 2};">` +
        `${esc(bar.ev.title)}</div>`;
    });

    if (week.overflowCount > 0) {
      html +=
        `<div class="cal-more-events" style="grid-column:1 / 8;grid-row:${week.overflowRow};">` +
        `+${week.overflowCount} more</div>`;
    }

    html += "</div>";
  });

  $("calGrid").innerHTML = html;
  renderAside();
}

function step(delta) {
  view.month += delta;
  if (view.month < 0) {
    view.month = 11;
    view.year--;
  } else if (view.month > 11) {
    view.month = 0;
    view.year++;
  }
  render();
}

export function mount() {
  $("prevMonthBtn").addEventListener("click", () => step(-1));
  $("nextMonthBtn").addEventListener("click", () => step(1));

  $("todayBtn").addEventListener("click", () => {
    const now = new Date();
    view.year = now.getFullYear();
    view.month = now.getMonth();
    view.selected = todayKey();
    render();
  });

  $("newEventBtn").addEventListener("click", () => openNewEvent(null));

  $("calGrid").addEventListener("click", (e) => {
    const bar = e.target.closest(".cal-event-bar");
    if (bar) {
      openEditEvent(bar.dataset.id);
      return;
    }

    const cell = e.target.closest(".cal-daybox");
    if (!cell || cell.classList.contains("blank")) return;
    // With room for the side panel a click selects the day; on narrow screens
    // there is no panel, so it opens the day straight away.
    if (!asideShown() || view.selected === cell.dataset.date) {
      openDayModal(cell.dataset.date);
      return;
    }
    view.selected = cell.dataset.date;
    render();
  });

  $("calAside").addEventListener("click", (e) => {
    const ev = e.target.closest(".ca-ev");
    if (ev) return openEditEvent(ev.dataset.id);
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    if (btn.dataset.action === "open-day") openDayModal(view.selected);
    if (btn.dataset.action === "add-event") openNewEvent(view.selected);
  });
}
