import { store } from "../store.js";
import { $, esc } from "../dom.js";
import { icon } from "../icons.js";
import { classesOnDay, colorClass, formatTime, minutesUntil, nowMinutes, toMinutes } from "../lib/schedule.js";

/* Class countdown.
   Lives outside every view so it survives navigation, and ticks once a second
   without ever re-rendering a view: only the digits and a class name change, so
   the cost is one textContent write per second.

   Thresholds escalate the colour and fire a one-shot pulse as the class nears. */

const LEAD_MINUTES = 60;
const CUES = [30, 15, 5];

/** Which cues have already fired, keyed by class id, so each fires once. */
let firedCues = new Map();
let ticker = null;
let lastKey = "";

/** @returns {{cls, secondsLeft, phase, ongoing}|null} */
export function timerState(now = new Date()) {
  const classes = classesOnDay(store.state.classes, now.getDay());
  if (!classes.length) return null;

  const mins = nowMinutes();
  const secondsIntoMinute = now.getSeconds();

  const ongoing = classes.find((c) => toMinutes(c.start) <= mins && mins < toMinutes(c.end));
  if (ongoing) {
    return {
      cls: ongoing,
      ongoing: true,
      secondsLeft: (toMinutes(ongoing.end) - mins) * 60 - secondsIntoMinute,
      phase: "ongoing",
    };
  }

  const next = classes.find((c) => minutesUntil(c) > 0);
  if (!next) return null;

  const minsLeft = minutesUntil(next);
  if (minsLeft > LEAD_MINUTES) return null;

  const secondsLeft = minsLeft * 60 - secondsIntoMinute;
  const phase = minsLeft <= 5 ? "critical" : minsLeft <= 15 ? "urgent" : minsLeft <= 30 ? "warn" : "soon";

  return { cls: next, ongoing: false, secondsLeft, phase };
}

/** mm:ss under an hour, h:mm:ss above it. */
export function formatCountdown(totalSeconds) {
  const s = Math.max(0, totalSeconds);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return hrs ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

function cueFor(minsLeft) {
  return CUES.find((c) => minsLeft === c) ?? null;
}

/** Full redraw — only when the class or phase actually changes. */
function paintShell(host, state) {
  const { cls, ongoing, phase } = state;

  host.className = `class-timer ${colorClass(cls)} phase-${phase}`;
  host.innerHTML =
    '<div class="ct-ring" aria-hidden="true"></div>' +
    '<div class="ct-body">' +
    `<div class="ct-label">${ongoing ? "Ends in" : "Starts in"}</div>` +
    '<div class="ct-count" id="ctCount">--:--</div>' +
    "</div>" +
    '<div class="ct-class">' +
    `<div class="ct-name">${cls.emoji ? `<span class="ct-emoji">${esc(cls.emoji)}</span>` : ""}${esc(cls.subject)}</div>` +
    `<div class="ct-meta">${icon("clock")}${esc(formatTime(cls.start))}` +
    (cls.room ? ` · ${esc(cls.room)}` : "") +
    "</div></div>" +
    `<button class="ct-hide" data-action="hide-timer" title="Hide until the next class" aria-label="Hide timer">${icon("close")}</button>`;
}

let dismissedFor = null;

export function tick() {
  const host = $("classTimer");
  if (!host) return;

  const state = timerState();

  if (!state || dismissedFor === state.cls.id) {
    host.classList.add("hidden");
    lastKey = "";
    return;
  }

  const key = `${state.cls.id}:${state.phase}`;
  if (key !== lastKey) {
    paintShell(host, state);
    host.classList.remove("hidden");
    lastKey = key;

    // Pulse once when crossing into a new phase, but never on first paint.
    if (state.phase !== "soon" && state.phase !== "ongoing") {
      host.classList.remove("pulse");
      void host.offsetWidth; // restart the animation
      host.classList.add("pulse");
    }
  }

  const count = $("ctCount");
  if (count) count.textContent = formatCountdown(state.secondsLeft);

  // One-shot cues at 30 / 15 / 5 minutes.
  if (!state.ongoing) {
    const minsLeft = Math.ceil(state.secondsLeft / 60);
    const cue = cueFor(minsLeft);
    const seen = firedCues.get(state.cls.id) || new Set();
    if (cue && !seen.has(cue)) {
      seen.add(cue);
      firedCues.set(state.cls.id, seen);
      host.classList.remove("pulse");
      void host.offsetWidth;
      host.classList.add("pulse");
    }
  }
}

export function mount() {
  $("classTimer").addEventListener("click", (e) => {
    if (!e.target.closest('[data-action="hide-timer"]')) return;
    dismissedFor = timerState()?.cls.id ?? null;
    tick();
  });

  tick();
  if (!ticker) ticker = setInterval(tick, 1000);
}
