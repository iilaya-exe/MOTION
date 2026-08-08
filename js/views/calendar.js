import { store } from "../store.js";
import { $, esc } from "../dom.js";
import { MONTH_NAMES, todayKey } from "../lib/dates.js";
import { getHolidaysForYear } from "../lib/holidays.js";
import { buildMonthWeeks } from "../lib/calendar.js";
import { openDayModal } from "../modals/day.js";
import { openEditEvent, openNewEvent } from "../modals/event-editor.js";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const view = { year: new Date().getFullYear(), month: new Date().getMonth() };

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

  let html = `<div class="cal-dow-row">${DOW.map((d) => `<div class="cal-dow">${d}</div>`).join("")}</div>`;

  weeks.forEach((week, wi) => {
    const weekClass =
      "cal-week" + (wi === 0 ? " is-first" : "") + (wi === weeks.length - 1 ? " is-last" : "");

    html += `<div class="${weekClass}" style="grid-template-rows:${week.gridTemplateRows};">`;

    // Layer 1: day boxes, each spanning the full week height.
    week.dayKeys.forEach((key, idx) => {
      const mod = !key ? " blank" : key === today ? " today" : "";
      const attr = key ? ` data-date="${key}"` : "";
      html += `<div class="cal-daybox${mod}" style="grid-column:${idx + 1};"${attr}></div>`;
    });

    // Layer 2: day number, holiday chips and task count, pinned to row 1.
    week.dayKeys.forEach((key, idx) => {
      if (!key) return;

      const count = tasksByDate[key] || 0;
      let head =
        `<div class="cal-dayhead${key === today ? " today" : ""}" style="grid-column:${idx + 1};">` +
        `<div class="cal-dayhead-top"><span class="cal-daynum">${Number(key.split("-")[2])}</span>`;

      if (count) {
        head += `<span class="cal-task-indicator"><span class="cal-task-dot"></span>${count}</span>`;
      }
      head += "</div>";

      (holidays[key] || []).forEach((h) => {
        head += `<div class="cal-holiday-chip ${h.type}">${esc(h.name)}</div>`;
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
    if (cell && !cell.classList.contains("blank")) openDayModal(cell.dataset.date);
  });
}
