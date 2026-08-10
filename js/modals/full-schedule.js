import { store } from "../store.js";
import * as modal from "../ui/modal.js";
import { $, esc, isHidden } from "../dom.js";
import { DAY_FULL } from "../lib/dates.js";
import {
  classesOnDay,
  colorClass,
  formatTime,
  layoutDayBlocks,
  nowMinutes,
  toMinutes,
  weekDaysShown,
} from "../lib/schedule.js";
import { openEditClass } from "./class-editor.js";

const HOUR_H = 58;

const hour12 = (hr) => (hr % 12 === 0 ? 12 : hr % 12);
const hourRangeLabel = (hr) => `${hour12(hr)}:00-${hour12(hr + 1)}:00`;

export const isFullScheduleOpen = () => !isHidden($("fullSchedOverlay"));

function renderWeekGrid() {
  const host = $("weekGrid");
  const { classes } = store.state;

  if (!classes.length) {
    host.innerHTML = '<div class="sched-empty">No classes yet — add one to see your week.</div>';
    return;
  }

  // The grid spans only the hours actually in use, rounded outward.
  const fromHr = Math.floor(Math.min(...classes.map((c) => toMinutes(c.start))) / 60);
  let toHr = Math.ceil(Math.max(...classes.map((c) => toMinutes(c.end))) / 60);
  if (toHr <= fromHr) toHr = fromHr + 1;

  const days = weekDaysShown(classes);
  const today = new Date().getDay();
  const nowM = nowMinutes();

  let html =
    `<div class="week-grid" style="grid-template-columns:78px repeat(${days.length},minmax(112px,1fr));--hour-h:${HOUR_H}px;">` +
    '<div class="wk-corner">Time</div>';

  days.forEach((d) => {
    html += `<div class="wk-dayhead${d === today ? " is-today" : ""}">${DAY_FULL[d]}</div>`;
  });

  html += '<div class="wk-times">';
  for (let hr = fromHr; hr < toHr; hr++) {
    html += `<div class="wk-time">${hourRangeLabel(hr)}</div>`;
  }
  html += "</div>";

  days.forEach((d) => {
    html += `<div class="wk-col${d === today ? " is-today" : ""}">`;
    for (let hr = fromHr; hr < toHr; hr++) html += '<div class="wk-slot"></div>';

    const items = classesOnDay(classes, d).map((c) => ({
      c,
      s: toMinutes(c.start),
      e: toMinutes(c.end),
    }));

    layoutDayBlocks(items).forEach((it) => {
      const top = ((it.s - fromHr * 60) / 60) * HOUR_H;
      const height = Math.max(((it.e - it.s) / 60) * HOUR_H, 22);
      const widthPct = 100 / it.lanes;
      const leftPct = it.lane * widthPct;
      const isNow = d === today && it.s <= nowM && nowM < it.e;
      const label = it.c.subject + (it.c.section ? `-${it.c.section}` : "");
      const tooltip =
        `${label} · ${formatTime(it.c.start)} – ${formatTime(it.c.end)}` +
        (it.c.room ? ` · ${it.c.room}` : "");

      html +=
        `<div class="wk-block ${colorClass(it.c)}${isNow ? " is-now" : ""}" data-id="${esc(it.c.id)}" ` +
        `title="${esc(tooltip)}" ` +
        `style="top:${top.toFixed(1)}px;height:${height.toFixed(1)}px;` +
        `left:calc(${leftPct}% + 3px);width:calc(${widthPct}% - 6px);">` +
        `<b>${esc(label)}</b>` +
        (it.c.room ? `<span>${esc(it.c.room)}</span>` : "") +
        "</div>";
    });

    html += "</div>";
  });

  html += "</div>";

  html +=
    '<div class="week-legend">' +
    classes
      .slice()
      .sort((a, b) => a.subject.localeCompare(b.subject))
      .map(
        (c) =>
          `<span class="${colorClass(c)}"><i></i>${esc(c.subject)}` +
          (c.section ? `-${esc(c.section)}` : "") +
          "</span>"
      )
      .join("") +
    "</div>";

  host.innerHTML = html;
}

export function openFullSchedule() {
  renderWeekGrid();
  modal.open("fullSchedOverlay");
}

export function closeFullSchedule() {
  modal.close("fullSchedOverlay");
}

export function mount() {
  $("fullSchedCloseBtn").addEventListener("click", closeFullSchedule);

  $("fullSchedOverlay").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeFullSchedule();
  });

  $("weekGrid").addEventListener("click", (e) => {
    const block = e.target.closest(".wk-block");
    if (!block) return;
    closeFullSchedule();
    openEditClass(block.dataset.id);
  });
}
